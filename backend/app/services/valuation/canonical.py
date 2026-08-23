from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List

YEAR_RE = re.compile(r"(?:19|20)\d{2}")


def _norm(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def _to_number(value: Any) -> float:
    try:
        parsed = float(value)
    except Exception:
        return 0.0
    return parsed if parsed == parsed and parsed not in (float("inf"), float("-inf")) else 0.0


def _positive(value: Any) -> float:
    parsed = _to_number(value)
    return parsed if parsed > 0 else 0.0


def _years(rows: Iterable[Dict[str, Any]]) -> List[int]:
    years: set[int] = set()
    for row in rows:
        for key in row.keys():
            match = YEAR_RE.search(str(key))
            if match:
                years.add(int(match.group(0)))
    return sorted(years)


def _value_for_year(row: Dict[str, Any], year: int) -> float:
    selected_key = None
    for key in row.keys():
        match = YEAR_RE.search(str(key))
        if match and int(match.group(0)) == year:
            selected_key = key if selected_key is None or str(key) > str(selected_key) else selected_key
    return _to_number(row.get(selected_key)) if selected_key else 0.0


def _line(value: float, *, source: str, confidence: float, method: str, concept: str | None = None) -> Dict[str, Any]:
    return {
        "value": value,
        "source": source,
        "confidence": confidence,
        "method": method,
        "concept": concept,
    }


def _row_key(row: Dict[str, Any]) -> str:
    return " ".join(
        _norm(row.get(key))
        for key in ("standard_concept", "concept", "label")
    )


def _find_rows(rows: List[Dict[str, Any]], *needles: str, exact: bool = False, exclude: tuple[str, ...] = ()) -> List[Dict[str, Any]]:
    normalized_needles = tuple(_norm(needle) for needle in needles)
    normalized_exclude = tuple(_norm(item) for item in exclude)
    matched: List[Dict[str, Any]] = []
    for row in rows:
        key = _row_key(row)
        if any(item and item in key for item in normalized_exclude):
            continue
        parts = {_norm(row.get("standard_concept")), _norm(row.get("concept")), _norm(row.get("label"))}
        if exact:
            if any(needle in parts for needle in normalized_needles):
                matched.append(row)
        elif any(needle and needle in key for needle in normalized_needles):
            matched.append(row)
    return matched


def _pick_series(rows: List[Dict[str, Any]], years: List[int], *needles: str, exact: bool = False, exclude: tuple[str, ...] = ()) -> List[Dict[str, Any]]:
    matches = _find_rows(rows, *needles, exact=exact, exclude=exclude)
    series: List[Dict[str, Any]] = []
    for year in years:
        picked_row = None
        picked_value = 0.0
        for row in matches:
            value = _value_for_year(row, year)
            if picked_row is None or abs(value) > abs(picked_value):
                picked_row = row
                picked_value = value
        series.append(
            _line(
                picked_value,
                source="sec_native" if picked_row else "missing",
                confidence=0.9 if picked_row else 0.0,
                method="direct" if picked_row else "missing",
                concept=str((picked_row or {}).get("concept") or (picked_row or {}).get("standard_concept") or "") or None,
            )
        )
    return series


def _latest(series: List[Dict[str, Any]]) -> Dict[str, Any]:
    return series[-1] if series else _line(0.0, source="missing", confidence=0.0, method="missing")


def build_canonical_financials(native_financials: Dict[str, Any] | None, market: Dict[str, Any] | None) -> Dict[str, Any]:
    native_financials = native_financials or {}
    market = market or {}
    statements = native_financials.get("statements") or {}
    rows: List[Dict[str, Any]] = []
    for key in ("income_statement", "balance_sheet", "cashflow_statement"):
        value = statements.get(key)
        if isinstance(value, list):
            rows.extend([row for row in value if isinstance(row, dict)])

    years = _years(rows)
    key_metrics = native_financials.get("key_metrics") or {}

    revenue = _pick_series(rows, years, "revenue", "contractrevenue", "productrevenue")
    net_income = _pick_series(rows, years, "netincome", "profitorloss")
    tax = _pick_series(rows, years, "incometaxexpense", "incometaxexpensebenefit")
    interest = _pick_series(rows, years, "interestexpense")
    ebit_direct = _pick_series(
        rows,
        years,
        "operatingincome",
        "operatingincomeloss",
        exact=True,
        exclude=("nonoperating", "non-operating"),
    )
    ebit: List[Dict[str, Any]] = []
    for idx, year in enumerate(years):
        direct = ebit_direct[idx]
        if abs(direct["value"]) > 0:
            ebit.append(direct)
            continue
        derived = (net_income[idx]["value"] or 0) + (tax[idx]["value"] or 0) + abs(interest[idx]["value"] or 0)
        ebit.append(_line(derived, source="derived", confidence=0.7 if derived else 0.0, method="pretax_plus_interest"))

    depreciation = _pick_series(rows, years, "depreciation", "amortization", "depreciationandamortization")
    ebitda = [
        _line(
            ebit[idx]["value"] + depreciation[idx]["value"],
            source="derived",
            confidence=min(ebit[idx]["confidence"], 0.8),
            method="ebit_plus_da",
        )
        for idx in range(len(years))
    ]
    cfo = _pick_series(rows, years, "netcashfromoperatingactivities", "operatingcashflow")
    capex = _pick_series(
        rows,
        years,
        "paymentstoacquirepropertyplantandequipment",
        "paymentsforpurchaseofpropertyplantandequipment",
        "capitalexpenditures",
        "purchaseofpropertyplantandequipment",
    )
    capex = [_line(abs(item["value"]), source=item["source"], confidence=item["confidence"], method=item["method"], concept=item.get("concept")) for item in capex]
    cash = _pick_series(rows, years, "cashandcashequivalents", "cashandcashequivalentsatcarryingvalue")
    debt_current = _pick_series(rows, years, "shorttermdebt", "debtcurrent", "longtermdebtcurrent")
    debt_long = _pick_series(rows, years, "longtermdebt", "longtermdebtnoncurrent")
    debt = [
        _line(
            debt_current[idx]["value"] + debt_long[idx]["value"],
            source="sec_native",
            confidence=max(debt_current[idx]["confidence"], debt_long[idx]["confidence"]),
            method="current_plus_long_term_debt",
        )
        for idx in range(len(years))
    ]
    book_value = _pick_series(rows, years, "stockholdersequity", "shareholdersequity", "totalequity")

    shares_value = (
        _positive(native_financials.get("shares_outstanding"))
        or _positive(key_metrics.get("shares_outstanding_diluted"))
        or _positive(key_metrics.get("shares_outstanding_basic"))
    )
    price = _positive(market.get("current_price"))
    market_cap = _positive(market.get("market_cap"))
    if shares_value <= 0 and price > 0 and market_cap > 0:
        shares_value = market_cap / price
    shares = _line(
        shares_value,
        source="sec_native" if _positive(native_financials.get("shares_outstanding")) else "market_derived" if shares_value else "missing",
        confidence=0.85 if shares_value else 0.0,
        method="reported_or_market_cap_div_price",
    )

    annual = []
    for idx, year in enumerate(years):
        annual.append({
            "year": year,
            "revenue": revenue[idx],
            "ebit": ebit[idx],
            "ebitda": ebitda[idx],
            "net_income": net_income[idx],
            "cfo": cfo[idx],
            "capex": capex[idx],
            "cash": cash[idx],
            "debt": debt[idx],
            "book_value": book_value[idx],
            "shares": shares,
        })

    latest = annual[-1] if annual else {}
    return {
        "currency": market.get("currency") or "USD",
        "scale": "actual",
        "metadata": {
            "is_financial_institution": bool(native_financials.get("is_financial_institution")),
        },
        "years": years,
        "annual": annual,
        "latest": latest,
        "quality": {
            "has_revenue": bool(_latest(revenue)["value"]),
            "has_ebit": bool(_latest(ebit)["value"]),
            "has_capex": bool(_latest(capex)["value"]),
            "has_shares": bool(shares["value"]),
        },
    }
