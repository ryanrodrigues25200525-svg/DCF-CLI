"""Provenance contract for `financials_native` source facts.

The FactQuery frame carries native per-fact provenance (`accession`,
`filing_date`, `form_type`) for every fact; the plain `to_dataframe()` view
does not. `_source_facts_for_statements` must prefer the native columns and
only fall back to the legacy year-keyed filing guess when a frame has none.
"""

from __future__ import annotations

import pandas as pd

from app.services import edgar as edgar_svc

_FILINGS = [
    {
        "form": "10-K",
        "filing_date": "2025-02-01",
        "report_date": "2024-12-31",
        "accession_number": "0000000000-25-000001",
        "primary_document": "newer.htm",
    },
    {
        "form": "10-K",
        "filing_date": "2024-02-01",
        "report_date": "2023-12-31",
        "accession_number": "0000000000-24-000002",
        "primary_document": "older.htm",
    },
]


def _statements(value: float = 100.0) -> dict:
    return {
        "income_statement": [{"concept": "us-gaap:Revenues", "FY 2024": value}],
        "balance_sheet": [],
        "cashflow_statement": [],
    }


def _native_fact(**overrides) -> dict:
    fact = {
        "concept": "us-gaap:Revenues",
        "label": "Revenues",
        "value": 100.0,
        "numeric_value": 100.0,
        "unit": "USD",
        "period_end": "2024-12-31",
        "fiscal_year": 2024,
        "fiscal_period": "FY",
        "accession": "0000000000-24-000002",
        "filing_date": "2024-02-01",
        "form_type": "10-K",
    }
    fact.update(overrides)
    return fact


def test_native_accession_wins_over_year_guess():
    """Native provenance must be used even when the year-keyed guess would
    pick a different (newer) filing for the same report year."""
    frame = pd.DataFrame([_native_fact()])

    facts = edgar_svc._source_facts_for_statements(frame, _statements(), _FILINGS, 5)

    assert len(facts) == 1
    fact = facts[0]
    assert fact["accession_number"] == "0000000000-24-000002"
    assert fact["filing_date"] == "2024-02-01"
    assert fact["form"] == "10-K"
    # report_date / primary_document join by accession, not by year.
    assert fact["report_date"] == "2023-12-31"
    assert fact["primary_document"] == "older.htm"


def test_native_accession_unknown_to_filing_window_keeps_native_fields():
    """An accession outside the fetched filing window still yields native
    accession/filing_date/form; the unjoinable filing-derived fields stay null."""
    frame = pd.DataFrame([_native_fact(accession="0000000000-21-000009", filing_date="2021-02-01")])

    facts = edgar_svc._source_facts_for_statements(frame, _statements(), _FILINGS, 5)

    assert len(facts) == 1
    assert facts[0]["accession_number"] == "0000000000-21-000009"
    assert facts[0]["filing_date"] == "2021-02-01"
    assert facts[0]["form"] == "10-K"
    assert facts[0]["report_date"] is None
    assert facts[0]["primary_document"] is None


def test_missing_native_filing_date_falls_back_to_joined_filing():
    frame = pd.DataFrame([_native_fact(accession="0000000000-25-000001", filing_date=float("nan"))])

    facts = edgar_svc._source_facts_for_statements(frame, _statements(), _FILINGS, 5)

    assert len(facts) == 1
    assert facts[0]["accession_number"] == "0000000000-25-000001"
    assert facts[0]["filing_date"] == "2025-02-01"
    assert facts[0]["report_date"] == "2024-12-31"


def test_legacy_frame_without_native_columns_uses_year_keyed_guess():
    """Frames from the plain facts view (no accession/filing_date/form_type)
    keep the previous behavior: newest filing whose report year matches."""
    frame = pd.DataFrame(
        [
            {
                "concept": "us-gaap:Revenues",
                "label": "Revenues",
                "value": 100.0,
                "numeric_value": 100.0,
                "unit": "USD",
                "period_end": "2024-12-31",
                "fiscal_year": 2024,
                "fiscal_period": "FY",
            }
        ]
    )

    facts = edgar_svc._source_facts_for_statements(frame, _statements(), _FILINGS, 5)

    assert len(facts) == 1
    assert facts[0]["accession_number"] == "0000000000-25-000001"
    assert facts[0]["filing_date"] == "2025-02-01"
    assert facts[0]["report_date"] == "2024-12-31"
    assert facts[0]["primary_document"] == "newer.htm"


def test_value_mismatch_still_filters_fact_rows():
    frame = pd.DataFrame([_native_fact(numeric_value=123.0, value=123.0)])

    facts = edgar_svc._source_facts_for_statements(frame, _statements(), _FILINGS, 5)

    assert facts == []


class _FakeFacts:
    def __init__(self, has_query: bool):
        self._has_query = has_query

    def query(self):
        if not self._has_query:
            raise RuntimeError("query unavailable")
        return self

    def to_dataframe(self):
        return pd.DataFrame(
            [{"concept": "us-gaap:Revenues", "provenance": "native" if self._has_query else "legacy"}]
        )


class _FakeFilingFrame:
    def to_pandas(self):
        return pd.DataFrame(
            [
                {
                    "accession_number": "0000000000-25-000001",
                    "filing_date": "2025-02-01",
                    "reportDate": "2024-12-31",
                    "form": "10-K",
                    "primaryDocument": "newer.htm",
                }
            ]
        )


class _FakeCompany:
    def __init__(self, has_query: bool):
        self._has_query = has_query

    def get_facts(self):
        return _FakeFacts(self._has_query)

    def get_filings(self, form):
        return _FakeFilingFrame()


def test_fetch_source_frames_prefers_fact_query_view():
    facts, filings = edgar_svc._fetch_source_frames(_FakeCompany(has_query=True), 5)

    assert facts["provenance"].tolist() == ["native"]
    assert filings[0]["accession_number"] == "0000000000-25-000001"
    assert filings[0]["primary_document"] == "newer.htm"


def test_fetch_source_frames_falls_back_when_query_unavailable():
    facts, _ = edgar_svc._fetch_source_frames(_FakeCompany(has_query=False), 5)

    assert facts["provenance"].tolist() == ["legacy"]
