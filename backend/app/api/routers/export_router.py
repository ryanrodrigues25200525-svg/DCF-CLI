from __future__ import annotations

import asyncio
import re
from typing import Any

from fastapi import APIRouter, Body
from fastapi.responses import Response

from app.services import finance
from app.services.excel_export.exporter import export_dcf_excel

router = APIRouter()
PEER_FETCH_TIMEOUT_SECONDS = 1.5

_STATIC_TECH_PEER_FALLBACKS: list[dict[str, Any]] = [
    {
        "symbol": "MSFT",
        "name": "Microsoft Corporation",
        "price": 420.0,
        "marketCap": 3_100_000_000_000,
        "enterpriseValue": 3_150_000_000_000,
        "ebitda": 160_000_000_000,
        "revenue": 260_000_000_000,
        "beta": 0.95,
        "totalDebt": 85_000_000_000,
        "cash": 80_000_000_000,
    },
    {
        "symbol": "GOOGL",
        "name": "Alphabet Inc.",
        "price": 195.0,
        "marketCap": 2_300_000_000_000,
        "enterpriseValue": 2_250_000_000_000,
        "ebitda": 130_000_000_000,
        "revenue": 360_000_000_000,
        "beta": 1.10,
        "totalDebt": 70_000_000_000,
        "cash": 120_000_000_000,
    },
    {
        "symbol": "META",
        "name": "Meta Platforms, Inc.",
        "price": 620.0,
        "marketCap": 1_550_000_000_000,
        "enterpriseValue": 1_500_000_000_000,
        "ebitda": 95_000_000_000,
        "revenue": 180_000_000_000,
        "beta": 1.20,
        "totalDebt": 30_000_000_000,
        "cash": 80_000_000_000,
    },
    {
        "symbol": "AMZN",
        "name": "Amazon.com, Inc.",
        "price": 220.0,
        "marketCap": 2_400_000_000_000,
        "enterpriseValue": 2_500_000_000_000,
        "ebitda": 140_000_000_000,
        "revenue": 650_000_000_000,
        "beta": 1.30,
        "totalDebt": 180_000_000_000,
        "cash": 80_000_000_000,
    },
    {
        "symbol": "NVDA",
        "name": "NVIDIA Corporation",
        "price": 180.0,
        "marketCap": 4_200_000_000_000,
        "enterpriseValue": 4_180_000_000_000,
        "ebitda": 120_000_000_000,
        "revenue": 175_000_000_000,
        "beta": 1.60,
        "totalDebt": 20_000_000_000,
        "cash": 40_000_000_000,
    },
    {
        "symbol": "ORCL",
        "name": "Oracle Corporation",
        "price": 165.0,
        "marketCap": 470_000_000_000,
        "enterpriseValue": 560_000_000_000,
        "ebitda": 62_000_000_000,
        "revenue": 58_000_000_000,
        "beta": 1.05,
        "totalDebt": 110_000_000_000,
        "cash": 20_000_000_000,
    },
]


def _sanitize_filename_part(value: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]+', "", value.strip())
    return cleaned or "ticker"


def _to_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        parsed = float(value)
        return parsed if parsed == parsed else None
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            parsed = float(stripped)
            return parsed if parsed == parsed else None
        except ValueError:
            return None
    return None


def _pick(comp: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in comp and comp[key] is not None:
            return comp[key]
    return None


def _normalize_peer(comp: dict[str, Any]) -> dict[str, Any] | None:
    ticker_raw = _pick(comp, "ticker", "symbol")
    ticker = ticker_raw.strip().upper() if isinstance(ticker_raw, str) and ticker_raw.strip() else ""
    if not ticker:
        return None

    company_raw = _pick(comp, "company", "name", "companyName")
    company = company_raw.strip() if isinstance(company_raw, str) and company_raw.strip() else ticker

    price = _to_float(_pick(comp, "price", "sharePrice", "currentPrice", "current_price"))
    market_cap = _to_float(_pick(comp, "marketCap", "market_cap", "equityValue"))
    shares = _to_float(_pick(comp, "sharesOutstanding", "shares", "shares_outstanding"))
    total_debt = _to_float(_pick(comp, "totalDebt", "debt"))
    cash = _to_float(_pick(comp, "cash"))
    beta = _to_float(_pick(comp, "beta", "rawBeta"))
    ev = _to_float(_pick(comp, "ev", "enterpriseValue", "enterprise_value"))
    ebitda = _to_float(_pick(comp, "ebitda", "ebitdaLtm", "ebitda_ltm"))
    ebitda_ntm = _to_float(_pick(comp, "ebitdaNtm", "ntmEbitda", "ebitda_ntm"))
    revenue = _to_float(_pick(comp, "revenue", "revenueLtm", "revenue_ltm", "revenue_ttm"))
    revenue_ntm = _to_float(_pick(comp, "revenueNtm", "ntmRevenue", "revenue_ntm"))
    ev_ebitda = _to_float(_pick(comp, "evEbitda", "ev_ebitda"))
    ev_revenue = _to_float(_pick(comp, "evRev", "evRevenue", "ev_revenue", "ev_rev"))
    de_ratio = _to_float(_pick(comp, "debtToEquity", "deRatio", "de_ratio"))

    if price and price > 0 and (shares is None or shares <= 0) and market_cap and market_cap > 0:
        shares = market_cap / price

    if ev is None or ev <= 0:
        if market_cap and market_cap > 0:
            ev = market_cap + (total_debt or 0.0) - (cash or 0.0)

    if (ebitda is None or ebitda <= 0) and ev and ev > 0 and ev_ebitda and ev_ebitda > 0:
        ebitda = ev / ev_ebitda

    if (revenue is None or revenue <= 0) and ev and ev > 0 and ev_revenue and ev_revenue > 0:
        revenue = ev / ev_revenue

    if (de_ratio is None or de_ratio < 0) and total_debt is not None and total_debt >= 0 and market_cap and market_cap > 0:
        de_ratio = total_debt / market_cap

    # Reasonable fallback if beta feed is missing.
    if beta is None or beta <= 0:
        beta = 1.0

    if not ticker:
        return None

    normalized = {
        "company": company,
        "ticker": ticker,
        "price": price if price is not None and price > 0 else None,
        "sharesOutstanding": shares if shares is not None and shares > 0 else None,
        "beta": beta,
        "ev": ev if ev is not None and ev > 0 else None,
        "debtToEquity": de_ratio if de_ratio is not None and de_ratio >= 0 else 0.0,
        "ebitda": ebitda,
        "revenue": revenue,
        "marketCap": market_cap if market_cap is not None and market_cap > 0 else (shares * price if (shares and price) else None),
        "totalDebt": total_debt if total_debt is not None and total_debt >= 0 else None,
        "cash": cash if cash is not None and cash >= 0 else None,
    }
    if ebitda_ntm is not None:
        normalized["ebitdaNtm"] = ebitda_ntm
    if revenue_ntm is not None:
        normalized["revenueNtm"] = revenue_ntm
    return normalized


def _prefer_live_peer_fetch(payload: dict[str, Any]) -> bool:
    ui_meta = payload.get("uiMeta")
    if not isinstance(ui_meta, dict):
        return False
    flag = ui_meta.get("preferLivePeerFetch")
    if isinstance(flag, bool):
        return flag
    if isinstance(flag, str):
        return flag.strip().lower() in {"1", "true", "yes", "on"}
    return False


async def _enrich_peers_if_needed(payload: dict[str, Any]) -> dict[str, Any]:
    company = payload.get("company") if isinstance(payload.get("company"), dict) else {}
    ticker_raw = company.get("ticker") if isinstance(company, dict) else None
    ticker = ticker_raw.strip().upper() if isinstance(ticker_raw, str) and ticker_raw.strip() else ""
    if not ticker:
        return payload

    provided = payload.get("comps")
    provided_list = provided if isinstance(provided, list) else []

    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()

    for comp in provided_list:
        if not isinstance(comp, dict):
            continue
        item = _normalize_peer(comp)
        if not item:
            continue
        symbol = item["ticker"]
        if symbol in seen or symbol == ticker:
            continue
        seen.add(symbol)
        normalized.append(item)

    prefer_live_refresh = _prefer_live_peer_fetch(payload)

    if len(normalized) < 6 and prefer_live_refresh:
        try:
            fetched = await asyncio.wait_for(finance.fetch_peer_data(ticker), timeout=PEER_FETCH_TIMEOUT_SECONDS)
        except Exception:
            fetched = []
        for comp in fetched:
            if not isinstance(comp, dict):
                continue
            item = _normalize_peer(comp)
            if not item:
                continue
            symbol = item["ticker"]
            if symbol in seen or symbol == ticker:
                continue
            seen.add(symbol)
            normalized.append(item)
            if len(normalized) >= 6:
                break

    if len(normalized) < 6 and prefer_live_refresh:
        for comp in _STATIC_TECH_PEER_FALLBACKS:
            item = _normalize_peer(comp)
            if not item:
                continue
            symbol = item["ticker"]
            if symbol in seen or symbol == ticker:
                continue
            seen.add(symbol)
            normalized.append(item)
            if len(normalized) >= 6:
                break

    payload["comps"] = normalized[:6]
    return payload


@router.post("/dcf/excel")
async def export_excel(payload: dict = Body(...)) -> Response:
    payload = await _enrich_peers_if_needed(payload)
    output = await asyncio.to_thread(export_dcf_excel, payload)
    ticker_raw = (
        payload.get("company", {}).get("ticker")
        if isinstance(payload.get("company"), dict)
        else None
    )
    ticker = _sanitize_filename_part(str(ticker_raw or "ticker")).lower()[:20]
    filename = f"{ticker}_dcf.xlsx"

    return Response(
        content=output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
