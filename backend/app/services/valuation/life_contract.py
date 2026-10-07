from __future__ import annotations

"""Filing-derived life-insurance source contracts.

Replaces ticker-equality gating (``ticker in {"MET", "PRU"}``) with
capability flags derived from filed facts. Any life insurer whose 10-K
yields the same schedule shape resolves a contract instead of throwing.
"""

from typing import Any, Dict, List, Optional

KNOWN_EARNINGS: Dict[str, str] = {
    "adjusted_earnings_available_to_common": "after_tax_adjusted_earnings_available_to_common",
    "adjusted_operating_income_pretax": "pre_tax_adjusted_operating_income",
}

CAPITAL_METRICS = (
    "statement_based_combined_rbc_ratio_floor",
    "naic_based_combined_rbc_ratio_floor",
    "statutory_capital_and_surplus",
    "statutory_net_income",
    "rbc_minimum_regulatory_threshold_floor",
)


def _as_facts(facts: Any) -> List[Dict[str, Any]]:
    if isinstance(facts, dict):
        facts = facts.get("life_insurance_filing_facts", facts.get("filing_facts", []))
    if not isinstance(facts, list):
        return []
    return [fact for fact in facts if isinstance(fact, dict)]


def resolve_life_source_contract(facts: Any) -> Optional[Dict[str, Any]]:
    """Resolve a source contract from filed facts, or None if incomplete.

    Contract shape: ``{earningsMetric, earningsBasis, segmentNames,
    capitalMetric, dividendCapacityGroup, requiresNormalizedTax}``.
    """
    rows = _as_facts(facts)
    if not rows:
        return None
    for metric, basis in KNOWN_EARNINGS.items():
        annual = [f for f in rows if f.get("metric") == metric]
        if not annual:
            continue
        years = sorted({f["fiscal_year"] for f in annual if isinstance(f.get("fiscal_year"), int)})
        if len(years) < 3 or years[-3:] != list(range(years[-1] - 2, years[-1] + 1)):
            continue
        base_year = years[-1]
        base_rows = [f for f in annual if f.get("fiscal_year") == base_year]
        segments = sorted({str(f.get("segment")) for f in base_rows if f.get("segment")})
        if not segments or len(segments) != len(base_rows):
            continue
        if any(
            f.get("unit") != "USD"
            or f.get("unit_scale") != "millions"
            or f.get("earnings_basis") != basis
            for f in base_rows
        ):
            continue
        for year in years[-3:]:
            year_rows = [f for f in annual if f.get("fiscal_year") == year]
            if {str(f.get("segment")) for f in year_rows if f.get("segment")} != set(segments):
                break
        else:
            capital_metric = next(
                (
                    m for m in CAPITAL_METRICS
                    if any(f.get("metric") == m and f.get("fiscal_year") == base_year for f in rows)
                ),
                None,
            )
            dividend_rows = [
                f for f in rows
                if f.get("metric") == "permitted_ordinary_dividend_without_approval"
                and f.get("fiscal_year") == base_year + 1
                and f.get("capital_group")
            ]
            if capital_metric is None or not dividend_rows:
                continue
            return {
                "earningsMetric": metric,
                "earningsBasis": basis,
                "baseYear": base_year,
                "segmentNames": segments,
                "capitalMetric": capital_metric,
                "dividendCapacityGroup": str(dividend_rows[0]["capital_group"]),
                "requiresNormalizedTax": basis == "pre_tax_adjusted_operating_income",
            }
    return None
