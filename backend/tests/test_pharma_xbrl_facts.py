"""XBRL-sourced pharma values.

Product revenue and the reported total come from the filing's XBRL facts
(`us-gaap:Revenues` on the product axis / undimensioned) when tagged; the
narrative parser supplies the row set, indications and patent disclosures and
stays the fallback when a value is not tagged.
"""

from __future__ import annotations

import asyncio

from app.services import edgar as edgar_svc
from app.services import xbrl_facts
from app.services.valuation.canonical import _pharma_filing_line


def _narrative_fact(metric: str, product_name: str, value: float, **overrides) -> dict:
    fact = {
        "metric": metric,
        "product_name": product_name,
        "indication": "Oncology",
        "value": value,
        "unit": "USD",
        "unit_scale": "millions",
        "period_end": "2025-12-31",
        "fiscal_year": 2025,
        "fiscal_period": "FY",
        "accession_number": "0000078003-26-000026",
        "filing_date": "2026-02-26",
        "form": "10-K",
        "report_date": "2025-12-31",
        "source_statement": "SEC 10-K Note 17, Significant Revenues by Product",
    }
    fact.update(overrides)
    return fact


def _xbrl_row(member: str, label: str, value: float, *, year: int = 2025) -> dict:
    return {
        "concept": "us-gaap:Revenues",
        "member": member,
        "member_label": label,
        "dimension": "srt:ProductOrServiceAxis",
        "full_dimension_label": f"Product and Service: {label}",
        "value": value,
        "decimals": "-6",
        "currency": "USD",
        "unit_ref": "usd",
        "period_start": f"{year}-01-01",
        "period_end": f"{year}-12-31",
        "fiscal_year": year,
        "fiscal_period": "FY",
        "statement_role": "http://www.pfizer.com/role/ConsolidatedStatementsofOperations",
        "fact_id": "f-3094",
    }


def _general_row(value: float, *, year: int = 2025) -> dict:
    row = _xbrl_row("", "", value, year=year)
    row.update({"member": None, "member_label": None, "dimension": None, "full_dimension_label": None, "fact_id": None})
    return row


def test_normalize_metric_label_drops_qualifiers_and_punctuation():
    assert xbrl_facts.normalize_metric_label("Adcetris (e)") == xbrl_facts.normalize_metric_label("Adcetris")
    assert xbrl_facts.normalize_metric_label("Enbrel (a)") == xbrl_facts.normalize_metric_label("Enbrel (Outside the U.S. and Canada)")
    assert xbrl_facts.normalize_metric_label("Nurtec ODT/Vydura") == "nurtec odt vydura"


def test_dedupe_fact_rows_collapses_repeated_contexts():
    row = _xbrl_row("pfe:ComirnatyMember", "Comirnaty", 4_367_000_000.0)
    other = _xbrl_row("pfe:ComirnatyMember", "Comirnaty", 4_367_000_000.0, year=2024)
    assert xbrl_facts.dedupe_fact_rows([row, dict(row), other]) == [row, other]


def test_load_filing_xbrl_without_accession_returns_none():
    assert asyncio.run(xbrl_facts.load_filing_xbrl(object(), {"accession_number": ""})) is None


def test_index_keys_products_by_normalized_label_and_year():
    index = edgar_svc._pharma_xbrl_fact_index(
        [_xbrl_row("pfe:EliquisMember", "Eliquis", 7_961_000_000.0, year=2025),
         _xbrl_row("pfe:EliquisMember", "Eliquis", 7_366_000_000.0, year=2024)],
        [_general_row(62_579_000_000.0, year=2025), _general_row(63_627_000_000.0, year=2024)],
    )
    assert index["products"]["eliquis"][2025]["value"] == 7_961_000_000.0
    assert index["products"]["eliquis"][2024]["value"] == 7_366_000_000.0
    assert index["totals"][2025]["member"] is None


def test_merge_overlays_xbrl_values_with_provenance():
    facts = [
        _narrative_fact("product_revenue", "Adcetris (e)", 907.0),
        _narrative_fact("reported_total_revenue", "Total revenues", 62_579.0),
        _narrative_fact("basic_patent_expiration_year", "Ibrance", 2027.0, unit="calendar year", unit_scale="actual"),
    ]
    index = edgar_svc._pharma_xbrl_fact_index(
        [_xbrl_row("pfe:AdcetrisMember", "Adcetris", 907_000_000.0)],
        [_general_row(62_579_000_000.0)],
    )
    merged = edgar_svc._merge_pharma_xbrl_facts(facts, index)

    product = merged[0]
    assert product["value"] == 907_000_000.0
    assert product["unit"] == "USD" and product["unit_scale"] == "actual"
    assert product["period_end"] == "2025-12-31"
    assert product["indication"] == "Oncology"
    assert product["source_statement"].endswith(
        "value from XBRL us-gaap:Revenues @ srt:ProductOrServiceAxis (pfe:AdcetrisMember)"
    )

    total = merged[1]
    assert total["value"] == 62_579_000_000.0
    assert total["source_statement"].endswith("value from XBRL us-gaap:Revenues (consolidated, no dimension)")

    patent = merged[2]
    assert patent == facts[2]


def test_merge_keeps_narrative_value_when_product_not_tagged():
    facts = [_narrative_fact("product_revenue", "Obscure Product", 12.0)]
    merged = edgar_svc._merge_pharma_xbrl_facts(facts, {"products": {}, "totals": {}})
    assert merged == facts


def test_pharma_filing_line_accepts_raw_xbrl_dollars():
    line = _pharma_filing_line(_narrative_fact(
        "product_revenue", "Adcetris", 907_000_000.0, unit="USD", unit_scale="actual",
    ))
    assert line["value"] == 907_000_000.0
    assert line["source"] == "sec_native"

    millions = _pharma_filing_line(_narrative_fact("product_revenue", "Adcetris", 907.0))
    assert millions["value"] == 907_000_000.0

    unscalable = _pharma_filing_line(_narrative_fact(
        "product_revenue", "Adcetris", 907.0, unit="USD", unit_scale="thousands",
    ))
    assert unscalable["value"] is None
