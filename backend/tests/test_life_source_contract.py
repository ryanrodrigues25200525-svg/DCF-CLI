"""Third-insurer life source contract resolution (ticker-agnostic)."""

from __future__ import annotations

from app.services.valuation.life_contract import resolve_life_source_contract


def _fact(metric, segment=None, capital_group=None, year=2025, basis="after_tax_adjusted_earnings_available_to_common"):
    return {
        "metric": metric,
        "segment": segment,
        "capital_group": capital_group,
        "unit": "USD" if "rbc" not in metric and "dividend" not in metric and "floor" not in metric else ("ratio" if "floor" in metric else "USD"),
        "unit_scale": "ratio" if "floor" in metric else "millions",
        "fiscal_year": year,
        "earnings_basis": basis,
    }


def _third_insurer_facts():
    segments = ("Annuities", "Protection", "Corporate")
    facts = []
    for year in (2023, 2024, 2025):
        for segment in segments:
            facts.append(_fact("adjusted_earnings_available_to_common", segment=segment, year=year))
    facts.append(_fact("statutory_capital_and_surplus", capital_group="TST Life Insurance Co", year=2025,
                       basis="not_applicable"))
    facts.append(_fact("permitted_ordinary_dividend_without_approval", capital_group="TST Life Insurance Co",
                       year=2026, basis="not_applicable"))
    return facts


def test_third_insurer_resolves_contract():
    contract = resolve_life_source_contract(_third_insurer_facts())
    assert contract is not None
    assert contract["earningsMetric"] == "adjusted_earnings_available_to_common"
    assert contract["earningsBasis"] == "after_tax_adjusted_earnings_available_to_common"
    assert contract["segmentNames"] == ["Annuities", "Corporate", "Protection"]
    assert contract["requiresNormalizedTax"] is False


def test_incomplete_facts_resolve_none():
    assert resolve_life_source_contract([]) is None
    assert resolve_life_source_contract([_fact("adjusted_earnings_available_to_common", segment="Solo", year=2025)]) is None
