from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import yfinance as yf

from app.core.cache_versions import (
    MARKET_TTL_SECONDS,
    market_key,
)
from app.services import cache
from app.services.stockdex_service import StockdexService

from .utils import (
    _extract_earnings_date,
    _is_missing_numeric,
    _is_missing_string,
    _to_positive_float,
)

logger = logging.getLogger("finance-market")

MARKET_NUMERIC_CORE_FIELDS = ("current_price", "market_cap")
MARKET_STRING_CORE_FIELDS = ("sector", "industry")

_MARKET_DATA_INFLIGHT: Dict[str, asyncio.Task] = {}
_MARKET_DATA_INFLIGHT_LOCK = asyncio.Lock()

async def get_financials_cache_ttl(ticker: str) -> int:
    """
    Determine cache TTL for financials based on proximity to next earnings date.
    Returns TTL in seconds.
    """
    default_ttl = 24 * 3600
    try:
        next_dt = await _get_next_earnings_date(ticker)
        if not next_dt:
            return default_ttl
        now = datetime.now(timezone.utc)
        # Use absolute proximity: refresh more aggressively close to earnings.
        delta_days = abs((next_dt - now).total_seconds()) / 86400.0
        if delta_days <= 3:
            return 3600
        if delta_days <= 14:
            return 6 * 3600
        return default_ttl
    except Exception as e:
        logger.warning(f"Failed to compute earnings-based TTL for {ticker}: {e}")
        return default_ttl

async def _get_next_earnings_date(ticker: str) -> Optional[datetime]:
    try:
        t = yf.Ticker(ticker)
        cal = await asyncio.to_thread(lambda: t.calendar)
        dt = _extract_earnings_date(cal)
        if dt:
            return dt
        # Fallback to earnings dates table (if available)
        ed = await asyncio.to_thread(lambda: getattr(t, "get_earnings_dates", None))
        if callable(ed):
            df = await asyncio.to_thread(lambda: t.get_earnings_dates(limit=1))
            if df is not None and not df.empty:
                idx = df.index[0]
                if hasattr(idx, "to_pydatetime"):
                    return idx.to_pydatetime().astimezone(timezone.utc)
        return None
    except Exception:
        return None

def _needs_market_enrichment(data: Dict[str, Any]) -> bool:
    if not data:
        return True
    for field in MARKET_NUMERIC_CORE_FIELDS:
        if _is_missing_numeric(data.get(field)):
            return True
    for field in MARKET_STRING_CORE_FIELDS:
        if _is_missing_string(data.get(field)):
            return True
    return False

def _has_usable_market_snapshot(data: Dict[str, Any]) -> bool:
    if not data:
        return False
    price = _to_positive_float(data.get("current_price"))
    market_cap = _to_positive_float(data.get("market_cap"))
    shares_outstanding = _to_positive_float(data.get("shares_outstanding"))
    return price > 0 and (market_cap > 0 or shares_outstanding > 0)

def _derive_market_fields(data: Dict[str, Any]) -> Dict[str, Any]:
    result = dict(data or {})
    price = _to_positive_float(result.get("current_price"))
    market_cap = _to_positive_float(result.get("market_cap"))
    shares_outstanding = _to_positive_float(result.get("shares_outstanding"))

    if market_cap <= 0 and price > 0 and shares_outstanding > 0:
        result["market_cap"] = price * shares_outstanding
        market_cap = _to_positive_float(result.get("market_cap"))

    if shares_outstanding <= 0 and price > 0 and market_cap > 0:
        result["shares_outstanding"] = market_cap / price

    return result

def _merge_market_data(primary: Dict[str, Any], fallback: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(primary or {})
    for key, value in (fallback or {}).items():
        if key in MARKET_NUMERIC_CORE_FIELDS or key in {"shares_outstanding", "beta"}:
            if _is_missing_numeric(merged.get(key)) and not _is_missing_numeric(value):
                merged[key] = value
        elif key in {"currency", "sector", "industry"}:
            if _is_missing_string(merged.get(key)) and not _is_missing_string(value):
                merged[key] = value
        elif merged.get(key) is None and value is not None:
            merged[key] = value
    return merged

async def fetch_market_data(ticker: str) -> Dict[str, Any]:
    """
    Fetch live market data for a ticker using Stockdex (Primary) with yfinance (Fallback).
    Returns a dictionary matching the CompanyProfile schema extensions.
    """
    normalized_ticker = (ticker or "").strip().upper()
    cache_key = market_key(normalized_ticker)
    try:
        if cached := await cache.get_from_cache(cache_key):
            if _has_usable_market_snapshot(cached):
                logger.debug(f"Cache hit for market data {normalized_ticker}")
                return cached
            logger.info(f"Ignoring incomplete market cache for {normalized_ticker}; refetching")

        async with _MARKET_DATA_INFLIGHT_LOCK:
            in_flight = _MARKET_DATA_INFLIGHT.get(cache_key)
            if in_flight is None:
                in_flight = asyncio.create_task(_fetch_and_cache_market_data(normalized_ticker, cache_key))
                _MARKET_DATA_INFLIGHT[cache_key] = in_flight

        try:
            return await asyncio.shield(in_flight)
        finally:
            async with _MARKET_DATA_INFLIGHT_LOCK:
                if _MARKET_DATA_INFLIGHT.get(cache_key) is in_flight:
                    _MARKET_DATA_INFLIGHT.pop(cache_key, None)
    except Exception as e:
        logger.warning(f"Error fetching market data for {normalized_ticker}: {e}")
        return {}

async def _fetch_and_cache_market_data(normalized_ticker: str, cache_key: str) -> Dict[str, Any]:
    stockdex_result = _derive_market_fields(await StockdexService.fetch_market_data(normalized_ticker) or {})
    now_ms = int(time.time() * 1000)

    if _has_usable_market_snapshot(stockdex_result):
        stockdex_result["fetched_at_ms"] = now_ms
        await cache.set_to_cache(cache_key, stockdex_result, ttl_seconds=MARKET_TTL_SECONDS)
        return stockdex_result

    logger.info("Stockdex market snapshot incomplete for %s, falling back to Yahoo Finance", normalized_ticker)
    ticker_obj = yf.Ticker(normalized_ticker)

    async def get_info():
        try:
            return await asyncio.to_thread(lambda: ticker_obj.info)
        except Exception as e:
            logger.warning(f"yfinance info fetch failed for {normalized_ticker}: {e}")
            return {}

    async def get_fast_info():
        try:
            return await asyncio.to_thread(lambda: ticker_obj.fast_info)
        except Exception as e:
            logger.warning(f"yfinance fast_info fetch failed for {normalized_ticker}: {e}")
            return None

    info_task = asyncio.create_task(get_info())
    fast_info_task = asyncio.create_task(get_fast_info())

    info, fast_info = await asyncio.gather(info_task, fast_info_task)

    yahoo_result: Dict[str, Any] = {}

    if info:
        yahoo_result = _derive_market_fields(
            {
                "current_price": info.get("currentPrice") or info.get("regularMarketPrice"),
                "market_cap": info.get("marketCap"),
                "shares_outstanding": info.get("sharesOutstanding"),
                "currency": info.get("currency"),
                "beta": info.get("beta"),
                "sector": info.get("sector"),
                "industry": info.get("industry"),
            }
        )

    if not _has_usable_market_snapshot(yahoo_result) and fast_info:
        def _read_fast(attr: str, key: str):
            if isinstance(fast_info, dict):
                return fast_info.get(key)
            return getattr(fast_info, attr, None)

        fast_data = _derive_market_fields(
            {
                "current_price": _read_fast("last_price", "lastPrice")
                or _read_fast("regular_market_price", "regularMarketPrice"),
                "market_cap": _read_fast("market_cap", "marketCap"),
                "shares_outstanding": _read_fast("shares", "shares"),
                "currency": _read_fast("currency", "currency"),
            }
        )
        yahoo_result = _merge_market_data(yahoo_result, fast_data)

    result = yahoo_result if _has_usable_market_snapshot(yahoo_result) else stockdex_result
    if result:
        result["fetched_at_ms"] = now_ms
        ttl_seconds = MARKET_TTL_SECONDS if _has_usable_market_snapshot(result) else 60
        await cache.set_to_cache(cache_key, result, ttl_seconds=ttl_seconds)
    return result
