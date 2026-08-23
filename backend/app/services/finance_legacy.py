from __future__ import annotations

import asyncio
import logging
import math
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import yfinance as yf

from app.core.cache_versions import (
    MACRO_TTL_SECONDS,
    MARKET_TTL_SECONDS,
    macro_context_key,
    macro_market_returns_key,
    macro_treasury_key,
    market_key,
)
from app.services import cache
from app.services.peer_universe import CURATED_PEERS
from app.services.stockdex_service import StockdexService

logger = logging.getLogger("finance-service")

TICKER_CANONICAL_MAP: Dict[str, str] = {
    # Block, Inc. ticker migration
    "SQ": "XYZ",
}

FALLBACK_PEERS_BY_SECTOR: Dict[str, List[str]] = {
    "technology": ["MSFT", "AAPL", "NVDA", "AMD"],
    "information technology": ["MSFT", "AAPL", "NVDA", "AMD"],
    "communication services": ["GOOGL", "META", "NFLX", "DIS"],
    "consumer discretionary": ["AMZN", "WMT", "TGT", "COST"],
    "consumer staples": ["WMT", "COST", "PG", "KO"],
    "financial": ["JPM", "BAC", "C", "GS"],
    "financial services": ["JPM", "BAC", "C", "GS"],
    "healthcare": ["JNJ", "PFE", "MRK", "ABBV"],
    "health care": ["JNJ", "PFE", "MRK", "ABBV"],
    "industrials": ["CAT", "DE", "HON", "GE"],
    "energy": ["XOM", "CVX", "COP", "SLB"],
    "real estate": ["AMT", "PLD", "EQIX", "SPG"],
    "utilities": ["NEE", "DUK", "SO", "AEP"],
    "materials": ["LIN", "APD", "ECL", "NEM"],
}

FALLBACK_PEERS_BY_INDUSTRY_KEYWORD: Dict[str, List[str]] = {
    "semiconductor": ["NVDA", "AMD", "AVGO", "INTC", "QCOM", "TXN", "MU", "ADI"],
    "software": ["MSFT", "ORCL", "ADBE", "CRM", "NOW", "INTU", "SNOW", "SAP"],
    "internet retail": ["AMZN", "BABA", "MELI", "EBAY", "SHOP", "SE"],
    "discount stores": ["WMT", "COST", "TGT", "DG", "DLTR", "BJ"],
    "home improvement": ["HD", "LOW", "FND", "WSM", "RH"],
    "apparel retail": ["NKE", "LULU", "ROST", "TJX", "GPS", "ANF"],
    "banks": ["JPM", "BAC", "WFC", "C", "GS", "MS", "USB", "PNC"],
    "capital markets": ["GS", "MS", "SCHW", "BLK", "KKR", "BX"],
    "credit services": ["AFRM", "PYPL", "XYZ", "SOFI", "UPST", "COF", "SYF"],
    "financial technology": ["AFRM", "PYPL", "XYZ", "SOFI", "UPST", "NU"],
    "buy now pay later": ["AFRM", "SEZL", "PYPL", "UPST", "SOFI"],
    "insurance": ["PGR", "TRV", "ALL", "AIG", "MET", "PRU", "CB"],
    "pharmaceutical": ["JNJ", "PFE", "MRK", "ABBV", "BMY", "LLY", "AMGN"],
    "biotech": ["GILD", "REGN", "VRTX", "BIIB", "MRNA", "ALNY"],
    "medical devices": ["ABT", "BSX", "SYK", "MDT", "ISRG", "EW"],
    "oil": ["XOM", "CVX", "COP", "EOG", "SLB", "OXY", "MPC", "PSX"],
    "utilities": ["NEE", "DUK", "SO", "AEP", "EXC", "SRE", "D"],
    "reit": ["AMT", "PLD", "EQIX", "SPG", "O", "PSA", "WELL"],
    "telecom": ["VZ", "T", "TMUS", "CMCSA", "CHTR", "BCE"],
    "airline": ["DAL", "UAL", "AAL", "LUV", "ALK"],
    "aerospace": ["BA", "LMT", "RTX", "NOC", "GD", "TDG"],
    "auto": ["TSLA", "GM", "F", "TM", "HMC", "RACE", "RIVN", "LCID"],
    "chemicals": ["LIN", "APD", "ECL", "DD", "DOW", "SHW", "PPG"],
    "mining": ["NEM", "FCX", "SCCO", "RIO", "BHP", "AA", "TECK"],
}

DEFAULT_PEER_SYMBOLS: List[str] = [
    "MSFT", "AAPL", "GOOGL", "AMZN", "META", "NVDA", "JPM", "XOM",
    "WMT", "COST", "JNJ", "PG", "HD", "BAC", "UNH", "CVX",
]
PEER_PROFILE_TIMEOUT_SECONDS = 3.0
PEER_DETAILS_MAX_CONCURRENCY = max(1, int(os.getenv("PEER_DETAILS_MAX_CONCURRENCY", "4")))

_MARKET_DATA_INFLIGHT: Dict[str, asyncio.Task] = {}
_MARKET_DATA_INFLIGHT_LOCK = asyncio.Lock()
_MARKET_CONTEXT_INFLIGHT: Optional[asyncio.Task] = None
_MARKET_CONTEXT_INFLIGHT_LOCK = asyncio.Lock()


def _low_memory_mode_enabled() -> bool:
    raw = os.getenv("LOW_MEMORY_MODE")
    if raw is not None:
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    return bool(os.getenv("RENDER"))


async def _resolve_peer_symbols(ticker: str, market_snapshot: Optional[Dict[str, Any]] = None) -> List[str]:
    normalized_ticker = ticker.upper()
    curated = CURATED_PEERS.get(normalized_ticker, [])
    if curated:
        return [s for s in curated if s.upper() != normalized_ticker]

    market_data: Dict[str, Any] = market_snapshot or {}
    sector = ""
    industry = ""
    if market_data:
        sector = str(market_data.get("sector") or "").strip().lower()
        industry = str(market_data.get("industry") or "").strip().lower()
    else:
        try:
            market_data = await fetch_market_data(ticker)
            sector = str(market_data.get("sector") or "").strip().lower()
            industry = str(market_data.get("industry") or "").strip().lower()
        except Exception:
            pass

    if not sector or not industry:
        # If market provider metadata is missing, try yfinance profile fields directly.
        try:
            info = await asyncio.wait_for(
                asyncio.to_thread(lambda: yf.Ticker(ticker).info),
                timeout=PEER_PROFILE_TIMEOUT_SECONDS,
            )
            if not sector:
                sector = str((info or {}).get("sector") or "").strip().lower()
            if not industry:
                industry = str((info or {}).get("industry") or "").strip().lower()
        except Exception:
            pass

    candidates: List[str] = []
    seen = {normalized_ticker}

    def add_symbols(symbols: List[str]) -> None:
        for symbol in symbols:
            upper = str(symbol).strip().upper()
            upper = TICKER_CANONICAL_MAP.get(upper, upper)
            if not upper or upper in seen:
                continue
            seen.add(upper)
            candidates.append(upper)

    if sector:
        for key, symbols in FALLBACK_PEERS_BY_SECTOR.items():
            if key in sector:
                add_symbols(symbols)

    searchable_text = f"{sector} {industry}".strip()
    if searchable_text:
        for keyword, symbols in FALLBACK_PEERS_BY_INDUSTRY_KEYWORD.items():
            if keyword in searchable_text:
                add_symbols(symbols)

    if not candidates:
        add_symbols(DEFAULT_PEER_SYMBOLS)

    return candidates


def _safe_log10(value: Any) -> float:
    parsed = _to_positive_float(value)
    if parsed <= 0:
        return 0.0
    return math.log10(parsed)


def _rank_peer_details(
    peers: List[Dict[str, Any]],
    target_ticker: str,
    target_market_cap: float,
    target_sector: str,
    target_industry: str,
) -> List[Dict[str, Any]]:
    target_sector_norm = str(target_sector or "").strip().lower()
    target_industry_norm = str(target_industry or "").strip().lower()
    target_log_mcap = _safe_log10(target_market_cap)

    def score(peer: Dict[str, Any]) -> float:
        peer_ticker = str(peer.get("symbol") or peer.get("ticker") or "").upper()
        if peer_ticker == target_ticker.upper():
            return float("-inf")

        peer_sector = str(peer.get("sector") or "").strip().lower()
        peer_industry = str(peer.get("industry") or "").strip().lower()
        peer_log_mcap = _safe_log10(peer.get("marketCap"))

        s = 0.0

        if target_industry_norm and peer_industry:
            if target_industry_norm == peer_industry:
                s += 2.4
            elif target_industry_norm in peer_industry or peer_industry in target_industry_norm:
                s += 1.6

        if target_sector_norm and peer_sector:
            if target_sector_norm == peer_sector:
                s += 1.2
            elif target_sector_norm in peer_sector or peer_sector in target_sector_norm:
                s += 0.7

        if target_log_mcap > 0 and peer_log_mcap > 0:
            s -= min(abs(peer_log_mcap - target_log_mcap), 3.0)
        elif _to_positive_float(peer.get("marketCap")) > 0:
            s += 0.2

        if _to_positive_float(peer.get("evRevenue")) > 0:
            s += 0.3
        if _to_positive_float(peer.get("evEbitda")) > 0:
            s += 0.3

        return s

    return sorted(peers, key=score, reverse=True)


def _build_symbol_fallback(symbol: str) -> Dict[str, Any]:
    return {
        "symbol": symbol,
        "name": symbol,
        "price": 0.0,
        "marketCap": 0.0,
        "enterpriseValue": 0.0,
        "peRatio": None,
        "pbRatio": None,
        "evRevenue": None,
        "evEbitda": None,
        "revenueGrowth": None,
        "margin": None,
        "ebitda": 0.0,
        "revenue": 0.0,
        "netIncome": 0.0,
        "beta": None,
        "sector": None,
        "industry": None,
        "totalDebt": 0.0,
        "cash": 0.0,
        "taxRate": 0.21,
    }

MARKET_NUMERIC_CORE_FIELDS = ("current_price", "market_cap")
MARKET_STRING_CORE_FIELDS = ("sector", "industry")

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

def _extract_earnings_date(calendar_obj) -> Optional[datetime]:
    try:
        # yfinance calendar is typically a DataFrame with index labels.
        if hasattr(calendar_obj, "index") and hasattr(calendar_obj, "loc"):
            if "Earnings Date" in calendar_obj.index:
                val = calendar_obj.loc["Earnings Date"]
                # may be a Series with 1-2 dates
                for v in getattr(val, "values", []):
                    dt = _coerce_datetime(v)
                    if dt:
                        return dt
            if "Earnings Date" in getattr(calendar_obj, "columns", []):
                val = calendar_obj["Earnings Date"]
                for v in getattr(val, "values", []):
                    dt = _coerce_datetime(v)
                    if dt:
                        return dt
        # Sometimes calendar is a dict-like
        if isinstance(calendar_obj, dict) and "Earnings Date" in calendar_obj:
            val = calendar_obj["Earnings Date"]
            if isinstance(val, (list, tuple)):
                for v in val:
                    dt = _coerce_datetime(v)
                    if dt:
                        return dt
            return _coerce_datetime(val)
    except Exception:
        return None
    return None

def _coerce_datetime(val) -> Optional[datetime]:
    try:
        if val is None:
            return None
        if isinstance(val, datetime):
            return val.astimezone(timezone.utc)
        # pandas Timestamp
        if hasattr(val, "to_pydatetime"):
            return val.to_pydatetime().astimezone(timezone.utc)
        # string
        if isinstance(val, str):
            dt = datetime.fromisoformat(val)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
    except Exception:
        return None
    return None

def _is_missing_numeric(value: Any) -> bool:
    try:
        return float(value or 0) <= 0
    except Exception:
        return True

def _to_positive_float(value: Any) -> float:
    try:
        parsed = float(value or 0.0)
    except Exception:
        return 0.0
    return parsed if parsed > 0 else 0.0


def _sanitize_multiple(value: Any, *, max_value: float) -> Optional[float]:
    try:
        parsed = float(value)
    except Exception:
        return None
    if not math.isfinite(parsed) or parsed <= 0 or parsed > max_value:
        return None
    return parsed


def _is_financial_like_company(sector: str, industry: str) -> bool:
    text = f"{sector or ''} {industry or ''}".lower()
    keywords = (
        "financial",
        "bank",
        "insurance",
        "capital markets",
        "asset management",
        "credit services",
    )
    return any(keyword in text for keyword in keywords)

def _is_missing_string(value: Any) -> bool:
    if value is None:
        return True
    return not str(value).strip()

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

    # Fetch info and fast_info in parallel to maximize chance of getting price/mcap quickly
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

    # 1. Try to build from info (most complete metadata)
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

    # 2. Augment or replace with fast_info if core fields are still missing
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

    # Use Yahoo fallback if usable, otherwise return whatever Stockdex provided.
    result = yahoo_result if _has_usable_market_snapshot(yahoo_result) else stockdex_result
    if result:
        result["fetched_at_ms"] = now_ms
        # If we still don't have a usable snapshot, cache for a very short time
        ttl_seconds = MARKET_TTL_SECONDS if _has_usable_market_snapshot(result) else 60
        await cache.set_to_cache(cache_key, result, ttl_seconds=ttl_seconds)
    return result

async def fetch_peer_data(ticker: str) -> List[Dict[str, Any]]:
    bundle = await fetch_peer_data_bundle(ticker)
    return bundle["peers"]


async def fetch_peer_data_bundle(ticker: str) -> Dict[str, Any]:
    """
    Fetch peer companies using curated symbols first.
    Dynamic yfinance-wide peer discovery is intentionally disabled by default to
    keep request latency bounded on free-tier hosting.
    """
    try:
        target_market_snapshot = await fetch_market_data(ticker)
        target_market_cap = _to_positive_float(target_market_snapshot.get("market_cap"))
        target_sector = str(target_market_snapshot.get("sector") or "")
        target_industry = str(target_market_snapshot.get("industry") or "")

        peer_symbols = await _resolve_peer_symbols(ticker, market_snapshot=target_market_snapshot)
        candidate_source = "curated" if CURATED_PEERS.get(ticker.upper()) else "sector_industry_fallback"
        if not peer_symbols:
            peer_symbols = [s for s in DEFAULT_PEER_SYMBOLS if s.upper() != ticker.upper()]
            candidate_source = "default_symbols"
        low_memory_mode = _low_memory_mode_enabled()
        max_symbols = 4 if low_memory_mode else 8
        max_candidates = max_symbols if low_memory_mode else max(max_symbols * 3, 12)
        candidate_symbols = peer_symbols[:max_candidates]
        details = await asyncio.wait_for(
            _fetch_peer_details(candidate_symbols, low_memory=low_memory_mode),
            timeout=8.0 if low_memory_mode else 12.0,
        )
        if details:
            ranked = _rank_peer_details(
                peers=details,
                target_ticker=ticker,
                target_market_cap=target_market_cap,
                target_sector=target_sector,
                target_industry=target_industry,
            )
            top = ranked[:max_symbols]

            if len(top) < max_symbols:
                existing = {
                    str(p.get("symbol") or p.get("ticker") or "").upper()
                    for p in top
                }
                for symbol in candidate_symbols:
                    upper = symbol.upper()
                    if upper in existing:
                        continue
                    top.append(_build_symbol_fallback(upper))
                    existing.add(upper)
                    if len(top) >= max_symbols:
                        break

            used_symbol_fallback = any(
                _to_positive_float(peer.get("marketCap")) <= 0 and _to_positive_float(peer.get("enterpriseValue")) <= 0
                for peer in top
            )
            notes = None
            if used_symbol_fallback:
                notes = "One or more peer rows were backfilled from lightweight symbol fallbacks."

            return {
                "peers": top,
                "source": candidate_source,
                "fallback_used": used_symbol_fallback or candidate_source != "curated",
                "notes": notes,
                "fetched_at_ms": int(time.time() * 1000),
            }

        # If all market-data providers fail, return lightweight placeholders so
        # comparables UI still has rows and user can proceed.
        logger.warning(f"Peer detail fetch returned empty for {ticker}; using symbol-only fallback set")
        return {
            "peers": [_build_symbol_fallback(symbol) for symbol in candidate_symbols[:max_symbols]],
            "source": "symbol_only_fallback",
            "fallback_used": True,
            "notes": "Peer detail providers returned empty results; using symbol-only placeholders.",
            "fetched_at_ms": int(time.time() * 1000),
        }
    except Exception as e:
        logger.warning(f"Error fetching peers for {ticker}: {e}")
        return {
            "peers": [],
            "source": "unavailable",
            "fallback_used": True,
            "notes": str(e),
            "fetched_at_ms": int(time.time() * 1000),
        }


async def _fetch_peer_details(symbols: List[str], low_memory: bool = False) -> List[Dict[str, Any]]:
    """
    Fetch detailed info for a list of peer symbols.
    """
    async def fetch_single_peer(symbol: str) -> Optional[Dict[str, Any]]:
        try:
            # Parallel fetch for yf info (for sector/name) and stockdex (for cleaner metrics)
            ticker_obj = yf.Ticker(symbol)
            yf_info_timeout = 2.0 if low_memory else 3.0
            stockdex_timeout = 1.5 if low_memory else 2.5
            yf_info_task = asyncio.wait_for(asyncio.to_thread(lambda: ticker_obj.info), timeout=yf_info_timeout)
            sd_data_task = asyncio.wait_for(StockdexService.fetch_market_data(symbol), timeout=stockdex_timeout)
            yf_info_result, sd_data_result = await asyncio.gather(
                yf_info_task, sd_data_task, return_exceptions=True
            )

            yf_info = yf_info_result if isinstance(yf_info_result, dict) else {}
            sd_data = sd_data_result if isinstance(sd_data_result, dict) else {}

            if not yf_info and not sd_data:
                return None

            price = _to_positive_float(
                sd_data.get("current_price") or yf_info.get("currentPrice") or yf_info.get("regularMarketPrice")
            )
            mkt_cap = _to_positive_float(sd_data.get("market_cap") or yf_info.get("marketCap"))
            ebitda = _to_positive_float(sd_data.get("ebitda") or yf_info.get("ebitda"))
            rev = _to_positive_float(sd_data.get("revenue_ttm") or yf_info.get("totalRevenue"))
            enterprise_value = _to_positive_float(
                yf_info.get("enterpriseValue")
                or (mkt_cap + (yf_info.get("totalDebt") or 0) - (yf_info.get("cash") or 0))
            )
            sector = str(yf_info.get("sector") or "")
            industry = str(yf_info.get("industry") or "")
            is_financial_like = _is_financial_like_company(sector, industry)
            ev_revenue_raw = (enterprise_value / rev) if (enterprise_value > 0 and rev > 0) else None
            ev_ebitda_raw = (
                (enterprise_value / ebitda)
                if (enterprise_value > 0 and ebitda > 0 and not is_financial_like)
                else None
            )
            ev_revenue = _sanitize_multiple(ev_revenue_raw, max_value=1000.0)
            ev_ebitda = _sanitize_multiple(ev_ebitda_raw, max_value=300.0)
            ebitda_margin = None
            if rev > 0 and ebitda > 0:
                ebitda_margin = ebitda / rev
            if ebitda_margin is None:
                ebitda_margin = sd_data.get("operating_margin") or yf_info.get("ebitdaMargins")

            return {
                "symbol": symbol,
                "name": yf_info.get("shortName") or sd_data.get("name") or symbol,
                "price": price,
                "marketCap": mkt_cap,
                "enterpriseValue": enterprise_value or None,
                "peRatio": sd_data.get("pe_ratio") or yf_info.get("forwardPE") or yf_info.get("trailingPE"),
                "pbRatio": yf_info.get("priceToBook"),
                "evRevenue": ev_revenue,
                "evEbitda": ev_ebitda,
                "revenueGrowth": yf_info.get("revenueGrowth"),
                "margin": ebitda_margin,
                "ebitda": ebitda,
                "revenue": rev,
                "netIncome": yf_info.get("netIncome") or 0.0,
                "beta": sd_data.get("beta") or yf_info.get("beta"),
                "sector": sector,
                "industry": industry,
                "totalDebt": sd_data.get("total_debt") or yf_info.get("totalDebt") or 0,
                "cash": sd_data.get("total_cash") or yf_info.get("cash") or 0,
                "taxRate": yf_info.get("effectiveTaxRate") or 0.21,
            }
        except Exception as e:
            logger.warning(f"Failed to fetch peer data for {symbol}: {e}")
        return None

    if low_memory:
        peer_results: List[Optional[Dict[str, Any]]] = []
        for symbol in symbols:
            peer_results.append(await fetch_single_peer(symbol))
    else:
        semaphore = asyncio.Semaphore(PEER_DETAILS_MAX_CONCURRENCY)

        async def fetch_bounded(symbol: str) -> Optional[Dict[str, Any]]:
            async with semaphore:
                return await fetch_single_peer(symbol)

        tasks = [fetch_bounded(s) for s in symbols]
        peer_results = await asyncio.gather(*tasks)
    return [r for r in peer_results if r is not None]

async def fetch_market_context() -> Dict[str, Any]:
    """
    Fetch global market context (Risk Free Rate, ERP) using yfinance macro indices only.
    """
    cache_key = macro_context_key()
    if cached := await cache.get_from_cache(cache_key):
        return cached

    global _MARKET_CONTEXT_INFLIGHT
    async with _MARKET_CONTEXT_INFLIGHT_LOCK:
        in_flight = _MARKET_CONTEXT_INFLIGHT
        if in_flight is None:
            in_flight = asyncio.create_task(_fetch_and_cache_market_context(cache_key))
            _MARKET_CONTEXT_INFLIGHT = in_flight

    try:
        return await asyncio.shield(in_flight)
    finally:
        async with _MARKET_CONTEXT_INFLIGHT_LOCK:
            if _MARKET_CONTEXT_INFLIGHT is in_flight:
                _MARKET_CONTEXT_INFLIGHT = None


async def _fetch_and_cache_market_context(cache_key: str) -> Dict[str, Any]:
    default_rfr = 0.045
    default_erp = 0.055

    treasury_cache_key = macro_treasury_key()
    market_returns_cache_key = macro_market_returns_key()

    treasury_cached = await cache.get_from_cache(treasury_cache_key) or {}
    market_returns_cached = await cache.get_from_cache(market_returns_cache_key) or {}

    rfr = _to_positive_float(treasury_cached.get("value")) or default_rfr
    sp500_annual_return = _to_positive_float(market_returns_cached.get("value"))
    erp = max(0.03, min(0.09, sp500_annual_return - rfr)) if sp500_annual_return > 0 else default_erp

    treasury_source = "cached"
    if not treasury_cached:
        treasury_source = "default"
    if treasury_cached and treasury_cached.get("fetched_at_ms"):
        age_ms = int(time.time() * 1000) - int(treasury_cached["fetched_at_ms"])
        age_h = max(0, int(age_ms / (1000 * 3600)))
        treasury_source = f"cached_{age_h}h_ago"

    needs_treasury = not treasury_cached
    needs_market_returns = not market_returns_cached
    now_ms = int(time.time() * 1000)

    async def _fetch_treasury_10y() -> Optional[float]:
        try:
            ticker = yf.Ticker("^TNX")
            hist = await asyncio.to_thread(lambda: ticker.history(period="7d", interval="1d", auto_adjust=True))
            if hist is not None and not hist.empty:
                close = float(hist["Close"].dropna().iloc[-1])
                return close / 100.0 if close > 0 else None
        except Exception as e:
            logger.warning(f"Failed to fetch ^TNX macro data: {e}")
        return None

    async def _fetch_sp500_annualized_return() -> Optional[float]:
        try:
            ticker = yf.Ticker("^GSPC")
            hist = await asyncio.to_thread(lambda: ticker.history(period="6y", interval="1mo", auto_adjust=True))
            if hist is None or hist.empty:
                return None
            closes = hist["Close"].dropna()
            if closes.size < 24:
                return None
            start_price = float(closes.iloc[0])
            end_price = float(closes.iloc[-1])
            if start_price <= 0 or end_price <= 0:
                return None
            elapsed_years = max(1.0, (closes.index[-1] - closes.index[0]).days / 365.25)
            return (end_price / start_price) ** (1.0 / elapsed_years) - 1.0
        except Exception as e:
            logger.warning(f"Failed to fetch ^GSPC macro data: {e}")
        return None

    if needs_treasury or needs_market_returns:
        fetches = await asyncio.gather(
            asyncio.wait_for(_fetch_treasury_10y(), timeout=4.0) if needs_treasury else asyncio.sleep(0, result=None),
            asyncio.wait_for(_fetch_sp500_annualized_return(), timeout=4.0)
            if needs_market_returns
            else asyncio.sleep(0, result=None),
            return_exceptions=True,
        )
        treasury_result, market_returns_result = fetches

        if isinstance(treasury_result, float) and treasury_result > 0:
            rfr = treasury_result
            treasury_source = "live"
            await cache.set_to_cache(
                treasury_cache_key,
                {"value": rfr, "fetched_at_ms": now_ms},
                ttl_seconds=MACRO_TTL_SECONDS,
            )

        if isinstance(market_returns_result, float) and market_returns_result > 0:
            sp500_annual_return = market_returns_result
            await cache.set_to_cache(
                market_returns_cache_key,
                {"value": sp500_annual_return, "fetched_at_ms": now_ms},
                ttl_seconds=MACRO_TTL_SECONDS,
            )

        if sp500_annual_return > 0:
            erp = max(0.03, min(0.09, sp500_annual_return - rfr))

    if treasury_source == "default" and treasury_cached:
        treasury_source = "cached_0h_ago"
    if treasury_source == "default":
        treasury_source = "default_4.5pct"

    result = {
        "riskFreeRate": rfr,
        "equityRiskPremium": erp,
        "lastUpdated": now_ms,
        "fetched_at_ms": now_ms,
        "treasuryRateSource": treasury_source,
        "erpSource": "derived_from_sp500_returns" if sp500_annual_return > 0 else "default_5.5pct",
    }
    await cache.set_to_cache(cache_key, result, ttl_seconds=MACRO_TTL_SECONDS)
    return result
