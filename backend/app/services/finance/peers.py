from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Dict, List, Optional

import yfinance as yf

from app.services.peer_universe import CURATED_PEERS
from app.services.stockdex_service import StockdexService

from .utils import (
    _is_financial_like_company,
    _low_memory_mode_enabled,
    _safe_log10,
    _sanitize_multiple,
    _to_positive_float,
)

logger = logging.getLogger("finance-peers")

TICKER_CANONICAL_MAP: Dict[str, str] = {
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

# Vocabulary translation, not a peer list: the market-data provider reports Yahoo's
# display names ("Consumer Defensive") while the screener accepts normalized slugs
# ("consumer_defensive"). Eleven sectors, so this table cannot drift out of sync
# the way a hand-maintained peer list does.
_SECTOR_SLUG_BY_DISPLAY: Dict[str, str] = {
    "basic materials": "basic_materials",
    "communication services": "communication_services",
    "consumer cyclical": "consumer_cyclical",
    "consumer defensive": "consumer_defensive",
    "consumer discretionary": "consumer_cyclical",
    "energy": "energy",
    "financial services": "financial_services",
    "finance": "financial_services",
    "health care": "healthcare",
    "healthcare": "healthcare",
    "industrials": "industrials",
    "real estate": "real_estate",
    "technology": "technology",
    "utilities": "utilities",
}

# Symbols the screener returns that are not operating companies with comparable
# financials. Filtered out of derived sets rather than curated per ticker.
_NON_OPERATING_PEER_PREFIXES = (
    "XL", "VG", "IY", "TWN", "XOP", "OIH", "KRE", "XLF", "IYH", "IBB",
)


def _sector_slug(sector: str) -> Optional[str]:
    return _SECTOR_SLUG_BY_DISPLAY.get(str(sector or "").strip().lower())


def _looks_like_operating_peer(symbol: str) -> bool:
    upper = str(symbol or "").strip().upper()
    if not upper or not upper.isalpha():
        return False
    if upper in {"SPY", "QQQ", "DIA", "IWM", "VOO", "VTI"}:
        return False
    return not any(upper.startswith(prefix) for prefix in _NON_OPERATING_PEER_PREFIXES)


def _sec_filer_tickers() -> Optional[set[str]]:
    """Tickers with an SEC-filer identity, cached for the process lifetime.

    Used to keep foreign-listed lines and unsponsored ADRs out of derived peer
    sets: they report under different accounting and often lack the US GAAP
    statements the multiple is computed from.
    """
    global _SEC_FILER_CACHE
    if _SEC_FILER_CACHE is not None:
        return _SEC_FILER_CACHE
    try:
        from edgar.reference.tickers import get_company_tickers

        frame = get_company_tickers()
        column = next(
            (c for c in frame.columns if str(c).strip().lower() == "ticker"),
            None,
        )
        if column is None:
            raise KeyError(f"no ticker column in {list(frame.columns)}")
        _SEC_FILER_CACHE = {str(v).strip().upper() for v in frame[column] if str(v).strip()}
    except Exception as e:
        logger.warning(f"SEC filer ticker lookup unavailable; derived peers stay unfiltered: {e}")
        _SEC_FILER_CACHE = None
    return _SEC_FILER_CACHE


_SEC_FILER_CACHE: Optional[set[str]] = None


async def _derive_peer_symbols_from_screener(
    ticker: str,
    sector: str,
    target_market_cap: float,
    limit: int,
) -> List[str]:
    """Derive a peer set from the installed screener instead of a hardcoded list.

    Ranks same-sector candidates by how close their market cap is to the target's,
    so a $400B retailer gets $100-500B peers rather than microcaps. Returns an empty
    list when the screener is unavailable or the sector is unknown; callers then
    fall through to the existing tables.
    """
    slug = _sector_slug(sector)
    if not slug:
        return []

    def _query() -> List[Dict[str, Any]]:
        from openbb import obb  # Imported lazily: heavy, and optional at runtime.

        result = obb.equity.screener(
            provider="yfinance", region="us", sector=slug, limit=max(limit * 8, 60)
        )
        frame = result.to_df()
        filers = _sec_filer_tickers()
        rows: List[Dict[str, Any]] = []
        for record in frame.reset_index().to_dict("records"):
            symbol = str(record.get("symbol") or record.get("index") or "").strip().upper()
            cap = _to_positive_float(record.get("market_cap"))
            if not (symbol and cap) or symbol == ticker.upper():
                continue
            if not _looks_like_operating_peer(symbol):
                continue
            # An empty filer set means the lookup failed; don't silently drop everything.
            if filers and symbol not in filers:
                continue
            rows.append({"symbol": symbol, "market_cap": cap})
        return rows

    try:
        candidates = await asyncio.wait_for(asyncio.to_thread(_query), timeout=6.0)
    except Exception as e:  # provider down, empty result, or an unexpected schema
        logger.warning(f"Screener peer derivation failed for {ticker} ({sector}): {e}")
        return []

    if not candidates:
        return []

    target_log = _safe_log10(target_market_cap)
    if target_log is None:
        return []
    candidates.sort(key=lambda row: abs(_safe_log10(row["market_cap"]) - target_log))
    return [row["symbol"] for row in candidates[:limit]]
PEER_DETAILS_MAX_CONCURRENCY = max(1, int(os.getenv("PEER_DETAILS_MAX_CONCURRENCY", "4")))
_PEER_BUNDLE_INFLIGHT: Dict[str, asyncio.Task] = {}
_PEER_BUNDLE_INFLIGHT_LOCK = asyncio.Lock()

async def _resolve_peer_symbols(
    ticker: str, market_snapshot: Optional[Dict[str, Any]] = None
) -> tuple[List[str], str]:
    from .market import fetch_market_data  # Deferred import to avoid circularity
    normalized_ticker = ticker.upper()
    curated = CURATED_PEERS.get(normalized_ticker, [])
    if curated:
        seen = {normalized_ticker}
        resolved: List[str] = []
        for symbol in curated:
            upper = str(symbol).strip().upper()
            upper = TICKER_CANONICAL_MAP.get(upper, upper)
            if upper and upper not in seen:
                seen.add(upper)
                resolved.append(upper)
        return resolved, "curated"

    market_data: Dict[str, Any] = market_snapshot or {}
    sector = ""
    industry = ""
    target_market_cap = _to_positive_float(market_data.get("market_cap")) or 0.0
    if market_snapshot is not None:
        sector = str(market_data.get("sector") or "").strip().lower()
        industry = str(market_data.get("industry") or "").strip().lower()
    else:
        try:
            market_data = await fetch_market_data(ticker)
            sector = str(market_data.get("sector") or "").strip().lower()
            industry = str(market_data.get("industry") or "").strip().lower()
            target_market_cap = _to_positive_float(market_data.get("market_cap")) or 0.0
        except Exception:
            pass

    if not sector or not industry:
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

    # Screener first: a derived same-sector set ranked by market-cap proximity is a
    # real source, so it precedes the hardcoded tables below and is allowed to
    # satisfy the non-fallback requirement.
    derived: List[str] = []
    if sector and target_market_cap > 0:
        derived = await _derive_peer_symbols_from_screener(
            normalized_ticker, sector, target_market_cap, limit=8
        )
        for symbol in derived:
            upper = str(symbol).strip().upper()
            if upper and upper not in seen:
                seen.add(upper)
                candidates.append(upper)
        if candidates:
            return candidates, "derived_screener"

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

    if candidates:
        return candidates, "sector_industry_table"

    add_symbols(DEFAULT_PEER_SYMBOLS)
    return candidates, "default_symbols"

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

async def fetch_peer_data(ticker: str) -> List[Dict[str, Any]]:
    bundle = await fetch_peer_data_bundle(ticker)
    return bundle["peers"]

async def fetch_peer_data_bundle(ticker: str) -> Dict[str, Any]:
    normalized_ticker = (ticker or "").strip().upper()
    if not normalized_ticker:
        return {
            "peers": [],
            "source": "unavailable",
            "fallback_used": True,
            "notes": "Ticker is required to load comparable companies.",
            "fetched_at_ms": int(time.time() * 1000),
        }

    async with _PEER_BUNDLE_INFLIGHT_LOCK:
        task = _PEER_BUNDLE_INFLIGHT.get(normalized_ticker)
        if task is None:
            task = asyncio.create_task(_fetch_peer_data_bundle(normalized_ticker))
            _PEER_BUNDLE_INFLIGHT[normalized_ticker] = task
            task.add_done_callback(lambda finished: _clear_peer_bundle_inflight(normalized_ticker, finished))
    return await asyncio.shield(task)


def _clear_peer_bundle_inflight(ticker: str, task: asyncio.Task) -> None:
    if _PEER_BUNDLE_INFLIGHT.get(ticker) is task:
        _PEER_BUNDLE_INFLIGHT.pop(ticker, None)
    if not task.cancelled():
        task.exception()


async def _fetch_peer_data_bundle(ticker: str) -> Dict[str, Any]:
    from .market import fetch_market_data  # Deferred import to avoid circularity

    try:
        target_market_snapshot = await fetch_market_data(ticker)
        target_market_cap = _to_positive_float(target_market_snapshot.get("market_cap"))
        target_sector = str(target_market_snapshot.get("sector") or "")
        target_industry = str(target_market_snapshot.get("industry") or "")

        peer_symbols, peer_origin = await _resolve_peer_symbols(ticker, market_snapshot=target_market_snapshot)
        candidate_source = peer_origin
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
                "fallback_used": used_symbol_fallback or candidate_source in {"default_symbols", "unavailable"},
                "notes": notes,
                "fetched_at_ms": int(time.time() * 1000),
            }

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
    async def fetch_single_peer(symbol: str) -> Optional[Dict[str, Any]]:
        try:
            ticker_obj = await asyncio.to_thread(yf.Ticker, symbol)
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
