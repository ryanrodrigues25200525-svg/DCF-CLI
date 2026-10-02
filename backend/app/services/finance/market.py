from __future__ import annotations

import asyncio
import io
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Dict, Optional
from urllib.parse import quote

import httpx
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

_MARKET_DATA_INFLIGHT: Dict[str, asyncio.Task] = {}
_MARKET_DATA_INFLIGHT_LOCK = asyncio.Lock()
YAHOO_CHART_TIMEOUT_SECONDS = 5.0
YAHOO_INFO_TIMEOUT_SECONDS = 2.0
YAHOO_FAST_INFO_TIMEOUT_SECONDS = 2.0
OPENBB_QUOTE_TIMEOUT_SECONDS = 6.0

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

def has_usable_market_snapshot(data: Dict[str, Any]) -> bool:
    if not data:
        return False
    price = _to_positive_float(data.get("current_price"))
    market_cap = _to_positive_float(data.get("market_cap"))
    shares_outstanding = _to_positive_float(data.get("shares_outstanding"))
    return price > 0 and (market_cap > 0 or shares_outstanding > 0)


def has_market_price(data: Dict[str, Any]) -> bool:
    return _to_positive_float((data or {}).get("current_price")) > 0

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


def _has_market_price(data: Dict[str, Any]) -> bool:
    return has_market_price(data)


async def _fetch_yahoo_chart_snapshot(ticker: str) -> Dict[str, Any]:
    """Fetch a public Yahoo chart quote when Stockdex and yfinance metadata are unavailable."""
    symbol = quote((ticker or "").strip().upper(), safe="")
    if not symbol:
        return {}
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    try:
        async with httpx.AsyncClient(
            timeout=YAHOO_CHART_TIMEOUT_SECONDS,
            headers={"User-Agent": "Mozilla/5.0 (compatible; DCFBuilder/2.0)"},
        ) as client:
            response = await client.get(url, params={"range": "5d", "interval": "1d"})
            response.raise_for_status()
            body = response.json()
    except Exception as exc:
        logger.info("Yahoo chart quote unavailable for %s: %s", ticker, exc)
        return {}

    chart = body.get("chart") if isinstance(body, dict) else None
    if not isinstance(chart, dict) or chart.get("error"):
        return {}
    results = chart.get("result")
    if not isinstance(results, list) or not results or not isinstance(results[0], dict):
        return {}
    result = results[0]
    meta = result.get("meta") if isinstance(result.get("meta"), dict) else {}
    current_price = _to_positive_float(meta.get("regularMarketPrice"))
    if current_price <= 0:
        indicators = result.get("indicators")
        quotes = indicators.get("quote") if isinstance(indicators, dict) else None
        quote_rows = quotes[0] if isinstance(quotes, list) and quotes and isinstance(quotes[0], dict) else {}
        closes = quote_rows.get("close") if isinstance(quote_rows, dict) else None
        if isinstance(closes, list):
            current_price = next(
                (_to_positive_float(close) for close in reversed(closes) if _to_positive_float(close) > 0),
                0.0,
            )
    if current_price <= 0:
        return {}

    return {
        "current_price": current_price,
        "currency": meta.get("currency"),
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
        "name": meta.get("longName") or meta.get("shortName"),
        "source": "yahoo_chart",
    }


@lru_cache(maxsize=1)
def _get_openbb_app():
    # OpenBB prints a one-time extension-build banner on first import; keep it out of CLI output.
    with redirect_stdout(io.StringIO()):
        from openbb import obb

    return obb


def _openbb_result_record(response: Any) -> Dict[str, Any]:
    rows = response.get("results") if isinstance(response, dict) else getattr(response, "results", None)
    if not isinstance(rows, list) or not rows:
        return {}
    row = rows[0]
    if isinstance(row, dict):
        return row
    if hasattr(row, "model_dump"):
        dumped = row.model_dump()
        return dumped if isinstance(dumped, dict) else {}
    if hasattr(row, "dict"):
        dumped = row.dict()
        return dumped if isinstance(dumped, dict) else {}
    return {}


def _query_openbb_yahoo_snapshot(ticker: str) -> Dict[str, Any]:
    openbb = _get_openbb_app()
    quote_record: Dict[str, Any] = {}
    profile_record: Dict[str, Any] = {}

    with ThreadPoolExecutor(max_workers=2) as executor:
        quote_future = executor.submit(openbb.equity.price.quote, symbol=ticker, provider="yfinance")
        profile_future = executor.submit(openbb.equity.profile, symbol=ticker, provider="yfinance")
        try:
            quote_record = _openbb_result_record(quote_future.result())
        except Exception as exc:
            logger.info("OpenBB Yahoo quote unavailable for %s: %s", ticker, exc)
        try:
            profile_record = _openbb_result_record(profile_future.result())
        except Exception as exc:
            logger.info("OpenBB Yahoo profile unavailable for %s: %s", ticker, exc)

    def first_value(*values: Any) -> Any:
        return next((value for value in values if value is not None and value != ""), None)

    result = {
        "current_price": first_value(
            quote_record.get("last_price"), quote_record.get("current_price"),
            quote_record.get("price"), profile_record.get("current_price"),
        ),
        "market_cap": first_value(profile_record.get("market_cap"), quote_record.get("market_cap")),
        "shares_outstanding": first_value(
            profile_record.get("shares_outstanding"), quote_record.get("shares_outstanding"),
        ),
        "currency": first_value(quote_record.get("currency"), profile_record.get("currency")),
        "beta": first_value(profile_record.get("beta"), quote_record.get("beta")),
        "sector": profile_record.get("sector"),
        "industry": first_value(profile_record.get("industry_category"), profile_record.get("industry")),
        "exchange": first_value(profile_record.get("stock_exchange"), quote_record.get("exchange")),
        "name": first_value(profile_record.get("name"), quote_record.get("name")),
        "source": "openbb_yfinance",
    }
    return {key: value for key, value in result.items() if value is not None}


async def _fetch_openbb_yahoo_snapshot(ticker: str) -> Dict[str, Any]:
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_query_openbb_yahoo_snapshot, ticker),
            timeout=OPENBB_QUOTE_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.info("OpenBB Yahoo provider unavailable for %s: %s", ticker, exc)
        return {}

def _merge_market_data(primary: Dict[str, Any], fallback: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(primary or {})
    for key, value in (fallback or {}).items():
        if key in {"current_price", "market_cap", "shares_outstanding", "beta"}:
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
    Fetch Yahoo-backed market data through OpenBB, then Stockdex/yfinance and chart fallbacks.
    Returns a dictionary matching the CompanyProfile schema extensions.
    """
    normalized_ticker = (ticker or "").strip().upper()
    cache_key = market_key(normalized_ticker)
    try:
        if cached := await cache.get_from_cache(cache_key):
            if _has_market_price(cached):
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
    openbb_result = _derive_market_fields(await _fetch_openbb_yahoo_snapshot(normalized_ticker) or {})
    if _has_market_price(openbb_result):
        now_ms = int(time.time() * 1000)
        openbb_result["fetched_at_ms"] = now_ms
        ttl = MARKET_TTL_SECONDS if has_usable_market_snapshot(openbb_result) else 60
        await cache.set_to_cache(cache_key, openbb_result, ttl_seconds=ttl)
        return openbb_result

    stockdex_result = _derive_market_fields(await StockdexService.fetch_market_data(normalized_ticker) or {})
    now_ms = int(time.time() * 1000)

    if _has_market_price(stockdex_result):
        stockdex_result["fetched_at_ms"] = now_ms
        ttl = MARKET_TTL_SECONDS if has_usable_market_snapshot(stockdex_result) else 60
        await cache.set_to_cache(cache_key, stockdex_result, ttl_seconds=ttl)
        return stockdex_result

    logger.info("Stockdex market snapshot incomplete for %s, falling back to Yahoo Finance", normalized_ticker)
    ticker_obj = yf.Ticker(normalized_ticker)

    async def get_info():
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(lambda: ticker_obj.info),
                timeout=YAHOO_INFO_TIMEOUT_SECONDS,
            )
        except Exception as e:
            logger.warning(f"yfinance info fetch failed for {normalized_ticker}: {e}")
            return {}

    async def get_fast_info():
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(lambda: ticker_obj.fast_info),
                timeout=YAHOO_FAST_INFO_TIMEOUT_SECONDS,
            )
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
                "source": "yahoo_finance_info",
            }
        )

    if not has_usable_market_snapshot(yahoo_result) and fast_info:
        def _read_fast(attr: str, key: str):
            if isinstance(fast_info, dict):
                return fast_info.get(key)
            try:
                return getattr(fast_info, attr, None)
            except Exception as exc:
                logger.debug("yfinance fast_info field %s unavailable for %s: %s", attr, normalized_ticker, exc)
                return None

        fast_data = _derive_market_fields(
            {
                "current_price": _read_fast("last_price", "lastPrice")
                or _read_fast("regular_market_price", "regularMarketPrice"),
                "market_cap": _read_fast("market_cap", "marketCap"),
                "shares_outstanding": _read_fast("shares", "shares"),
                "currency": _read_fast("currency", "currency"),
                "source": "yahoo_finance_fast_info",
            }
        )
        yahoo_result = _merge_market_data(yahoo_result, fast_data)

    if not _has_market_price(yahoo_result):
        chart_result = await _fetch_yahoo_chart_snapshot(normalized_ticker)
        yahoo_result = _merge_market_data(yahoo_result, chart_result)
        if _has_market_price(chart_result):
            yahoo_result["source"] = chart_result.get("source")

    result = yahoo_result if _has_market_price(yahoo_result) else stockdex_result
    if result:
        result["fetched_at_ms"] = now_ms
        ttl_seconds = MARKET_TTL_SECONDS if has_usable_market_snapshot(result) else 60
        await cache.set_to_cache(cache_key, result, ttl_seconds=ttl_seconds)
    return result
