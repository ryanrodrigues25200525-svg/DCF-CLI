from __future__ import annotations

from typing import Any

from openpyxl.worksheet.worksheet import Worksheet

from .utils import _first_float, _force_set, _safe_set_or_clear, _scale, _to_float


def _normalize_comp_name(comp: dict[str, Any]) -> str | None:
    company = comp.get("company")
    if not (isinstance(company, str) and company.strip()):
        company = comp.get("name") or comp.get("companyName")
    ticker = comp.get("ticker") or comp.get("symbol")
    if isinstance(company, str) and company.strip() and isinstance(ticker, str) and ticker.strip():
        return f"{company} ({ticker})"
    if isinstance(company, str) and company.strip():
        return company
    if isinstance(ticker, str) and ticker.strip():
        return ticker
    return None

def _normalize_comp_shares(raw: Any) -> float | None:
    shares = _to_float(raw)
    if shares is None:
        return None
    return shares / 1_000_000.0 if abs(shares) >= 1_000_000 else shares

def _clear_comp_row(comps_ws: Worksheet, row: int) -> None:
    for col in ("B", "C", "D", "E", "G", "M", "O", "P", "Q", "R", "S"):
        _safe_set_or_clear(comps_ws, f"{col}{row}", None)

def _sanitize_growth_rate(value: float | None) -> float | None:
    if value is None:
        return None
    return max(-0.25, min(0.60, value))

def _normalized_ntm_metric(
    *,
    ltm_value: float | None,
    ntm_value: float | None,
    growth_rate: float | None = None,
    default_growth_rate: float = 0.03,
) -> float | None:
    # Prefer explicit NTM values when available.
    # If absent/invalid, build a forward proxy from free-source growth fields.
    if ntm_value is None or ntm_value <= 0:
        if ltm_value is None or ltm_value <= 0:
            return None
        growth = _sanitize_growth_rate(growth_rate)
        if growth is None:
            growth = _sanitize_growth_rate(default_growth_rate) or 0.03
        return ltm_value * (1.0 + growth)

    # Heuristic: payload may provide NTM in billions while LTM is in either
    # dollars or millions depending on upstream source.
    if ltm_value is not None and 0 < ntm_value < 1000:
        if ltm_value >= 1_000_000:
            # LTM likely in raw dollars; convert "billions" to dollars.
            return ntm_value * 1_000_000_000
        if ltm_value >= 1000:
            # LTM likely in millions; convert "billions" to millions.
            return ntm_value * 1000
    return ntm_value

def _map_comps(comps_ws: Worksheet, payload: dict[str, Any], divisor: float) -> None:
    comps = payload.get("comps", []) or []
    assumptions = payload.get("assumptions")
    assumptions = assumptions if isinstance(assumptions, dict) else {}
    default_growth_rate = _to_float(assumptions.get("revenueGrowth"))
    if default_growth_rate is None:
        default_growth_rate = _to_float(assumptions.get("revenueGrowthRate"))
    if default_growth_rate is None:
        default_growth_rate = 0.03

    for index in range(6):
        row = 8 + index
        comp = comps[index] if index < len(comps) and isinstance(comps[index], dict) else None
        if comp is None:
            _clear_comp_row(comps_ws, row)
            continue

        name = _normalize_comp_name(comp)
        price = _first_float(comp, "price", "sharePrice")
        shares = _normalize_comp_shares(_first_float(comp, "sharesOutstanding", "shares", "shares_outstanding"))
        beta = _first_float(comp, "beta")
        ev = _first_float(comp, "ev", "enterpriseValue", "enterprise_value")
        de_ratio = _first_float(comp, "debtToEquity", "deRatio", "de_ratio")
        ebitda = _first_float(comp, "ebitda", "ebitdaLtm", "ebitda_ltm")
        revenue = _first_float(comp, "revenue", "revenueLtm", "revenue_ltm")
        ebitda_ntm_raw = _first_float(comp, "ebitdaNtm", "ntmEbitda", "ebitda_ntm")
        revenue_ntm_raw = _first_float(comp, "revenueNtm", "ntmRevenue", "revenue_ntm")
        comp_growth = _first_float(comp, "revenueGrowth", "growth")
        ticker_raw = comp.get("ticker") or comp.get("symbol")
        ticker = ticker_raw.strip().upper() if isinstance(ticker_raw, str) and ticker_raw.strip() else None

        market_cap = _first_float(comp, "marketCap", "market_cap", "equityValue")
        total_debt = _first_float(comp, "totalDebt", "debt")
        cash = _first_float(comp, "cash")

        if ev is None and market_cap is not None:
            ev = market_cap + (total_debt or 0.0) - (cash or 0.0)
        if shares is None and market_cap is not None and price is not None and price > 0:
            shares = market_cap / price
        if ebitda is None:
            ev_ebitda = _first_float(comp, "evEbitda", "ev_ebitda")
            if ev is not None and ev_ebitda is not None and ev_ebitda > 0:
                ebitda = ev / ev_ebitda
        if revenue is None:
            ev_rev = _first_float(comp, "evRev", "evRevenue", "ev_rev", "ev_revenue")
            if ev is not None and ev_rev is not None and ev_rev > 0:
                revenue = ev / ev_rev
        if de_ratio is None and total_debt is not None and market_cap and market_cap > 0:
            de_ratio = total_debt / market_cap
        revenue_ntm = _normalized_ntm_metric(
            ltm_value=revenue,
            ntm_value=revenue_ntm_raw,
            growth_rate=comp_growth,
            default_growth_rate=default_growth_rate,
        )
        ebitda_ntm = _normalized_ntm_metric(
            ltm_value=ebitda,
            ntm_value=ebitda_ntm_raw,
            growth_rate=comp_growth,
            default_growth_rate=default_growth_rate,
        )

        _safe_set_or_clear(comps_ws, f"B{row}", name)
        _safe_set_or_clear(comps_ws, f"C{row}", price)
        _safe_set_or_clear(comps_ws, f"D{row}", shares)
        _safe_set_or_clear(comps_ws, f"E{row}", beta)
        _safe_set_or_clear(comps_ws, f"G{row}", _scale(ev, divisor) if ev is not None else None)
        _safe_set_or_clear(comps_ws, f"M{row}", de_ratio)
        _safe_set_or_clear(comps_ws, f"O{row}", ticker)
        _safe_set_or_clear(comps_ws, f"P{row}", _scale(ebitda, divisor) if ebitda is not None else None)
        _safe_set_or_clear(comps_ws, f"Q{row}", _scale(ebitda_ntm, divisor) if ebitda_ntm is not None else None)
        _safe_set_or_clear(comps_ws, f"R{row}", _scale(revenue, divisor) if revenue is not None else None)
        _safe_set_or_clear(comps_ws, f"S{row}", _scale(revenue_ntm, divisor) if revenue_ntm is not None else None)

def _harden_comps_ratio_formulas(comps_ws: Worksheet) -> None:
    # Avoid propagating #DIV/0! when one or more peer rows are missing inputs.
    for row in range(8, 14):
        _force_set(comps_ws, f"H{row}", f'=IFERROR(P{row}/R{row},"")')
        _force_set(comps_ws, f"I{row}", f'=IFERROR($G{row}/P{row},"")')
        _force_set(comps_ws, f"J{row}", f'=IFERROR($G{row}/Q{row},"")')
        _force_set(comps_ws, f"K{row}", f'=IFERROR($G{row}/R{row},"")')
        _force_set(comps_ws, f"L{row}", f'=IFERROR($G{row}/S{row},"")')
