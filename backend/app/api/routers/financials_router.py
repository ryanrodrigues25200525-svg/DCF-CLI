from __future__ import annotations

import asyncio
import logging
import math
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.cache_versions import (
    FINANCIALS_TTL_SECONDS,
    MACRO_TTL_SECONDS,
    MARKET_TTL_SECONDS,
    PEERS_TTL_SECONDS,
    macro_context_key,
    market_key,
    native_financials_key,
    peers_key,
    profile_key,
)
from app.core.config import settings
from app.infrastructure.repository import FinancialRepository, get_repository
from app.models.schemas import CompanyProfile
from app.services import cache, edgar, finance
from app.services.peer_universe import CURATED_PEERS
from app.services.valuation import build_canonical_financials, classify_company

router = APIRouter()
logger = logging.getLogger("sec-service")


def _sanitize_json_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _sanitize_json_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize_json_value(v) for v in value]
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
    return value


def _single_ticker_cache_enabled() -> bool:
    return os.getenv("SINGLE_TICKER_CACHE", "false").strip().lower() in {"1", "true", "yes", "on"}


async def _purge_other_ticker_cache(repo: FinancialRepository, ticker: str) -> None:
    normalized = ticker.strip().upper()
    if not normalized:
        return

    deleted = 0
    deleted += await repo.delete_prefix_except("native_unified_v1_%", keep_like=f"native_unified_v1_{normalized}_%")
    deleted += await repo.delete_prefix_except("native_fins_v1_%", keep_like=f"native_fins_v1_{normalized}_%")
    deleted += await repo.delete_prefix_except("profile_%", keep_exact=profile_key(normalized))
    deleted += await repo.delete_prefix_except("market_data_%", keep_exact=market_key(normalized))
    deleted += await repo.delete_prefix_except("peers_v1_%", keep_exact=peers_key(normalized))

    if deleted > 0:
        logger.info("single_ticker_cache purge ticker=%s deleted_rows=%d", normalized, deleted)


def _is_sequence_non_empty(value: Any) -> bool:
    return isinstance(value, list) and len(value) > 0


def _has_usable_financials(payload: dict[str, Any] | None) -> bool:
    if not isinstance(payload, dict):
        return False

    statements = payload.get("statements")
    if not isinstance(statements, dict):
        return False

    for key in ("income_statement", "balance_sheet", "cashflow_statement"):
        if _is_sequence_non_empty(statements.get(key)):
            return True

    key_metrics = payload.get("key_metrics")
    if isinstance(key_metrics, dict):
        for key in ("revenue", "net_income", "operating_cash_flow"):
            value = key_metrics.get(key)
            if isinstance(value, (int, float)) and value not in (0, None):
                return True
    return False


def _canonicalize_valuation_context(market_context: dict[str, Any] | None) -> dict[str, Any]:
    payload = market_context or {}
    fetched_at_ms = payload.get("fetched_at_ms") or payload.get("lastUpdated") or payload.get("last_updated")
    return {
        "risk_free_rate": payload.get("risk_free_rate", payload.get("riskFreeRate", 0.0)),
        "equity_risk_premium": payload.get("equity_risk_premium", payload.get("equityRiskPremium", 0.0)),
        "fetched_at_ms": fetched_at_ms,
        "treasury_rate_source": payload.get("treasury_rate_source", payload.get("treasuryRateSource")),
        "erp_source": payload.get("erp_source", payload.get("erpSource")),
        "as_of_date": payload.get("as_of_date", payload.get("asOfDate")),
    }


def _normalize_peer_bundle(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        peers = value.get("peers")
        return {
            "peers": peers if isinstance(peers, list) else [],
            "source": value.get("source", "unknown"),
            "fallback_used": bool(value.get("fallback_used", False)),
            "notes": value.get("notes"),
            "fetched_at_ms": value.get("fetched_at_ms"),
        }
    if isinstance(value, list):
        return {
            "peers": value,
            "source": "legacy_cache",
            "fallback_used": False,
            "notes": None,
            "fetched_at_ms": None,
        }
    return {
        "peers": [],
        "source": "unavailable",
        "fallback_used": True,
        "notes": None,
        "fetched_at_ms": None,
    }


def _build_data_quality_entry(
    *,
    status: str,
    source: str,
    fetched_at_ms: Any,
    fallback_used: bool,
    notes: str | None = None,
) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "status": status,
        "source": source,
        "fetched_at_ms": int(fetched_at_ms) if isinstance(fetched_at_ms, (int, float)) else None,
        "fallback_used": fallback_used,
    }
    if notes:
        entry["notes"] = notes
    return entry


def _derive_degradation_level(
    *,
    has_financials: bool,
    has_market: bool,
    has_valuation_context: bool,
    has_peers: bool,
    has_insider_trades: bool,
    quality: dict[str, dict[str, Any]],
) -> str:
    if not has_financials or not has_valuation_context:
        return "high"
    if not has_market or quality["valuation_context"]["status"] in {"default", "stale"}:
        return "moderate"
    if not has_peers or any(
        item["fallback_used"] for key, item in quality.items() if key != "insider_trades"
    ):
        return "low"
    return "none"


async def _get_profile_payload(ticker: str, repo: FinancialRepository) -> tuple[dict[str, Any], str]:
    cache_key = profile_key(ticker)
    cached = await cache.get_from_cache(cache_key, repo=repo)
    if isinstance(cached, dict) and cached:
        return cached, "cached"

    profile = await edgar.fetch_company_profile(ticker)
    payload = profile.model_dump(by_alias=True) if hasattr(profile, "model_dump") else profile
    await cache.set_to_cache(cache_key, payload, ttl_seconds=FINANCIALS_TTL_SECONDS, repo=repo)
    return payload, "live"


async def _get_financials_payload(ticker: str, years: int, repo: FinancialRepository) -> tuple[dict[str, Any], str]:
    cache_key = native_financials_key(ticker, years)
    cached = await cache.get_from_cache(cache_key, repo=repo)
    if isinstance(cached, dict) and _has_usable_financials(cached):
        return cached, "cached"

    result = _sanitize_json_value(await edgar.fetch_company_financials_native(ticker, years))
    await cache.set_to_cache(cache_key, result, ttl_seconds=FINANCIALS_TTL_SECONDS, repo=repo)
    return result, "live"


async def _get_market_payload(ticker: str, repo: FinancialRepository) -> tuple[dict[str, Any], str]:
    cache_key = market_key(ticker)
    cached = await cache.get_from_cache(cache_key, repo=repo)
    if isinstance(cached, dict) and cached:
        return cached, "cached"

    market = _sanitize_json_value(await finance.fetch_market_data(ticker) or {})
    await cache.set_to_cache(cache_key, market, ttl_seconds=MARKET_TTL_SECONDS, repo=repo)
    return market, "live"


async def _get_valuation_context_payload(repo: FinancialRepository) -> tuple[dict[str, Any], str]:
    cache_key = macro_context_key()
    cached = await cache.get_from_cache(cache_key, repo=repo)
    if isinstance(cached, dict) and cached:
        return _canonicalize_valuation_context(cached), "cached"

    market_context = _sanitize_json_value(await finance.fetch_market_context() or {})
    canonical = _canonicalize_valuation_context(market_context)
    await cache.set_to_cache(cache_key, canonical, ttl_seconds=MACRO_TTL_SECONDS, repo=repo)
    return canonical, "live"


async def _get_peer_bundle_payload(ticker: str, repo: FinancialRepository) -> tuple[dict[str, Any], str]:
    cache_key = peers_key(ticker)
    cached = await cache.get_from_cache(cache_key, repo=repo)
    normalized_cached = _normalize_peer_bundle(cached)
    if normalized_cached["peers"]:
        return normalized_cached, "cached"

    peer_bundle = _sanitize_json_value(await finance.fetch_peer_data_bundle(ticker))
    normalized_bundle = _normalize_peer_bundle(peer_bundle)
    await cache.set_to_cache(cache_key, normalized_bundle, ttl_seconds=PEERS_TTL_SECONDS, repo=repo)
    return normalized_bundle, "live"


@router.get("/{ticker}", response_model=CompanyProfile)
async def get_company_profile(ticker: str, repo: FinancialRepository = Depends(get_repository)):
    """Get company profile information by ticker."""
    cache_key = profile_key(ticker)

    if cached := await cache.get_from_cache(cache_key, repo=repo):
        logger.info("Cache hit: profile for %s", ticker)
        return cached

    profile = await edgar.fetch_company_profile(ticker)
    market_data = await finance.fetch_market_data(ticker)
    if market_data:
        for k, v in market_data.items():
            if v is not None and hasattr(profile, k):
                setattr(profile, k, v)

    await cache.set_to_cache(cache_key, profile, repo=repo)
    return profile


async def _build_native_unified_payload(
    ticker: str, years: int, repo: FinancialRepository
) -> dict[str, Any]:
    async def _optional_with_timeout(task: Any, timeout_seconds: float, fallback: Any) -> Any:
        try:
            return await asyncio.wait_for(task, timeout=timeout_seconds)
        except Exception:
            return fallback

    profile_task = _get_profile_payload(ticker, repo)
    native_financials_task = _get_financials_payload(ticker, years, repo)
    market_task = _optional_with_timeout(_get_market_payload(ticker, repo), timeout_seconds=8.0, fallback=({}, "unavailable"))
    valuation_context_task = _optional_with_timeout(
        _get_valuation_context_payload(repo),
        timeout_seconds=3.0,
        fallback=({}, "unavailable"),
    )
    peers_task = _optional_with_timeout(
        _get_peer_bundle_payload(ticker, repo),
        timeout_seconds=5.0,
        fallback=(
            {"peers": [], "source": "unavailable", "fallback_used": True, "notes": "Peer enrichment timed out.", "fetched_at_ms": None},
            "unavailable",
        ),
    )

    (profile_result, native_financials_result, market_result, valuation_context_result, peers_result) = await asyncio.gather(
        profile_task,
        native_financials_task,
        market_task,
        valuation_context_task,
        peers_task,
    )

    profile, _profile_state = profile_result
    native_financials, financials_state = native_financials_result
    market, market_state = market_result
    valuation_context, valuation_context_state = valuation_context_result
    peer_bundle, peers_state = peers_result
    peers = peer_bundle["peers"]
    insider_trades: list[dict[str, Any]] = []

    if market and isinstance(profile, dict):
        for key in ("current_price", "market_cap", "currency", "beta", "sector", "industry"):
            value = market.get(key)
            if value is not None:
                profile[key] = value

    valuation_status = valuation_context_state
    valuation_source = str(
        valuation_context.get("treasury_rate_source")
        or valuation_context.get("erp_source")
        or "backend_valuation_context"
    )
    valuation_fallback = False
    if valuation_status == "unavailable":
        valuation_status = "unavailable"
    elif str(valuation_source).startswith("default"):
        valuation_status = "default"
        valuation_fallback = True
    elif valuation_context_state == "cached":
        valuation_status = "cached"
    else:
        valuation_status = "live"

    financials_ok = _has_usable_financials(native_financials)

    if not financials_ok and not settings.edgar_identity_configured:
        raise HTTPException(
            status_code=403,
            detail="SEC identity not configured. Please set your Name and Email in Settings to enable data fetching."
        )

    market_ok = bool(market)
    peers_ok = len(peers) > 0
    canonical_financials = build_canonical_financials(native_financials, market)
    model_eligibility = classify_company(profile, canonical_financials)

    data_quality = {
        "financials": _build_data_quality_entry(
            status=financials_state if financials_ok else "unavailable",
            source="edgartools_native",
            fetched_at_ms=native_financials.get("fetched_at_ms"),
            fallback_used=False,
            notes=None if financials_ok else "Native statements were unavailable or incomplete.",
        ),
        "market": _build_data_quality_entry(
            status=market_state if market_ok else "unavailable",
            source="stockdex_yfinance",
            fetched_at_ms=market.get("fetched_at_ms"),
            fallback_used=market_state != "live",
            notes=None if market_ok else "Market snapshot unavailable; price/market cap may be missing.",
        ),
        "valuation_context": _build_data_quality_entry(
            status=valuation_status,
            source=valuation_source,
            fetched_at_ms=valuation_context.get("fetched_at_ms"),
            fallback_used=valuation_fallback,
            notes=None if valuation_context else "Valuation context unavailable.",
        ),
        "peers": _build_data_quality_entry(
            status=peers_state if peers_ok else "unavailable",
            source=str(peer_bundle.get("source") or "peer_pipeline"),
            fetched_at_ms=peer_bundle.get("fetched_at_ms"),
            fallback_used=bool(peer_bundle.get("fallback_used", False)),
            notes=peer_bundle.get("notes"),
        ),
        "insider_trades": _build_data_quality_entry(
            status="unavailable",
            source="lazy_disabled",
            fetched_at_ms=None,
            fallback_used=False,
            notes="Insider trades are intentionally lazy-loaded and do not block the primary valuation load.",
        ),
    }

    completeness = {
        "has_financials": financials_ok,
        "has_market": market_ok,
        "has_valuation_context": bool(valuation_context),
        "has_peers": peers_ok,
        "has_insider_trades": False,
    }
    completeness["degradation_level"] = _derive_degradation_level(
        has_financials=bool(completeness["has_financials"]),
        has_market=bool(completeness["has_market"]),
        has_valuation_context=bool(completeness["has_valuation_context"]),
        has_peers=bool(completeness["has_peers"]),
        has_insider_trades=False,
        quality=data_quality,
    )

    return {
        "profile": profile,
        "financials_native": native_financials,
        "market": market,
        "canonical_financials": canonical_financials,
        "model_eligibility": model_eligibility,
        "market_context": valuation_context,
        "valuation_context": valuation_context,
        "peers": peers,
        "insider_trades": insider_trades,
        "data_quality": data_quality,
        "completeness": completeness,
        "source_metadata": {
            "financials": "edgartools_native",
            "profile": "SEC Edgar",
            "market_data": "Stockdex primary / Yahoo fallback",
            "market_context": "backend_canonical_valuation_context",
            "peers": "backend_peer_pipeline",
            "insider_trades": "lazy_optional",
        },
    }


@router.get("/{ticker}/unified")
async def get_unified_data(
    ticker: str,
    years: int = Query(5, ge=1, le=10),
    repo: FinancialRepository = Depends(get_repository),
):
    """Get unified payload with native edgartools financial statements."""
    payload = _sanitize_json_value(await _build_native_unified_payload(ticker, years, repo))

    if _single_ticker_cache_enabled():
        await _purge_other_ticker_cache(repo, ticker)
    return payload


@router.get("/{ticker}/unified/native")
async def get_unified_data_native(
    ticker: str,
    years: int = Query(5, ge=1, le=10),
    repo: FinancialRepository = Depends(get_repository),
):
    """Alias for native unified payload."""
    return await get_unified_data(ticker=ticker, years=years, repo=repo)


@router.get("/{ticker}/financials")
async def get_company_financials(
    ticker: str,
    years: int = Query(5, ge=1, le=10),
    repo: FinancialRepository = Depends(get_repository),
):
    """Get native edgartools financial statements."""
    cache_key = native_financials_key(ticker, years)
    if cached := await cache.get_from_cache(cache_key, repo=repo):
        cached = _sanitize_json_value(cached)
        await cache.set_to_cache(cache_key, cached, ttl_seconds=FINANCIALS_TTL_SECONDS, repo=repo)
        return cached

    result = _sanitize_json_value(await edgar.fetch_company_financials_native(ticker, years))
    await cache.set_to_cache(cache_key, result, ttl_seconds=FINANCIALS_TTL_SECONDS, repo=repo)
    return result


@router.get("/{ticker}/financials/native")
async def get_company_financials_native(
    ticker: str,
    years: int = Query(5, ge=1, le=10),
    repo: FinancialRepository = Depends(get_repository),
):
    """Alias for native financials payload."""
    return await get_company_financials(ticker=ticker, years=years, repo=repo)


@router.get("/{ticker}/market")
async def get_company_market(ticker: str, repo: FinancialRepository = Depends(get_repository)):
    """Get market data only for a ticker."""
    cache_key = market_key(ticker)
    if cached := await cache.get_from_cache(cache_key, repo=repo):
        return {"ticker": ticker.upper(), "market": cached, "source": "cache"}

    market = await finance.fetch_market_data(ticker)
    await cache.set_to_cache(cache_key, market, ttl_seconds=MARKET_TTL_SECONDS, repo=repo)
    return {"ticker": ticker.upper(), "market": market, "source": "live"}


@router.get("/{ticker}/peers")
async def get_company_peers(ticker: str, repo: FinancialRepository = Depends(get_repository)):
    """Get peer set with core market multiples."""
    cache_key = peers_key(ticker)
    if cached := await cache.get_from_cache(cache_key, repo=repo):
        bundle = _normalize_peer_bundle(cached)
        return {"ticker": ticker.upper(), "peers": bundle["peers"]}

    peer_bundle = _sanitize_json_value(await finance.fetch_peer_data_bundle(ticker))
    bundle = _normalize_peer_bundle(peer_bundle)
    await cache.set_to_cache(cache_key, bundle, ttl_seconds=PEERS_TTL_SECONDS, repo=repo)
    return {"ticker": ticker.upper(), "peers": bundle["peers"]}


@router.get("/{ticker}/filings")
async def get_company_filings(
    ticker: str, form: str = Query(None), limit: int = Query(10, ge=1, le=50)
):
    """Get company filings list."""
    return await edgar.fetch_filings(ticker, form, limit)


@router.get("/{ticker}/insider-trades")
async def get_insider_trades(ticker: str, limit: int = Query(20, ge=1, le=200)):
    """Get recent Form 4 insider trades."""
    try:
        trades = await edgar.fetch_insider_trades(ticker, limit)
        return {"ticker": ticker, "trades": trades}
    except Exception as e:
        logger.error("Insider trades error for %s: %s", ticker, e, exc_info=True)
        return {"ticker": ticker, "trades": []}


@router.get("/{ticker}/insiders")
async def get_insiders_alias(ticker: str, limit: int = Query(20, ge=1, le=200)):
    """Alias endpoint for insider trades."""
    return await get_insider_trades(ticker, limit)


@router.get("/{ticker}/peers/suggested")
async def get_suggested_peers(ticker: str):
    """Get a list of suggested peer tickers for a company."""
    normalized = ticker.strip().upper()
    peers = CURATED_PEERS.get(normalized, [])
    return {"ticker": normalized, "peers": peers}
