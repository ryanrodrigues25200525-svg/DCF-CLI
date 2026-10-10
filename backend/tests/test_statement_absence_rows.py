"""Absence-aware statement rows: canonical placeholders must never masquerade
as filer presentation in downstream absence proofs."""
from __future__ import annotations

from app.services import edgar as edgar_service
from app.services.valuation.canonical import (
    NON_CONTROLLING_INTEREST_CONCEPTS,
    _filed_absence_line,
    build_canonical_financials,
)


class _FakeStatementItem:
    def __init__(
        self,
        concept,
        source,
        value=None,
        label=None,
        section=None,
        confidence=0.5,
        is_abstract=False,
        children=(),
    ):
        self.concept = concept
        self.label = label or concept
        self.source = source
        self.value = value
        self.section = section
        self.confidence = confidence
        self.is_abstract = is_abstract
        self.children = list(children)


class _FakeStructuredStatement:
    def __init__(self, items):
        self.items = items


class _FakeCompany:
    def __init__(self, by_type, failing=()):
        self._by_type = by_type
        self._failing = set(failing)

    def get_structured_statement(
        self,
        statement_type,
        fiscal_year=None,
        fiscal_period=None,
        use_canonical=True,
        include_missing=False,
    ):
        assert include_missing is True
        assert fiscal_period == "FY"
        if statement_type in self._failing:
            raise RuntimeError("structured builder failed")
        return self._by_type.get(statement_type)


def _absence_company():
    return _FakeCompany(
        {
            "IncomeStatement": _FakeStructuredStatement([]),
            "BalanceSheet": _FakeStructuredStatement([
                _FakeStatementItem("us-gaap:CashAndCashEquivalentsAtCarryingValue", "fact", value=1000.0),
                _FakeStatementItem("us-gaap:ShortTermInvestments", "placeholder", value=5.0),
                _FakeStatementItem("us-gaap:AssetsAbstract", "placeholder", is_abstract=True),
                _FakeStatementItem("us-gaap:LongTermDebt", "placeholder", section="Liabilities"),
                _FakeStatementItem("us-gaap:Goodwill", "placeholder", section="Assets", confidence=0.4),
                _FakeStatementItem(
                    "us-gaap:IntangibleAssetsAbstract",
                    "placeholder",
                    is_abstract=True,
                    children=[
                        _FakeStatementItem("us-gaap:IntangibleAssetsNetExcludingGoodwill", "placeholder"),
                    ],
                ),
            ]),
            "CashFlow": _FakeStructuredStatement([
                _FakeStatementItem("us-gaap:PaymentsToAcquirePropertyPlantAndEquipment", "placeholder"),
            ]),
        }
    )


def test_placeholder_items_become_is_missing_rows():
    statements = {
        "income_statement": [],
        "balance_sheet": [{"concept": "us-gaap:LongTermDebt", "label": "Long-term debt"}],
        "cashflow_statement": [],
    }

    gaps = edgar_service._absence_rows_for_statements(_absence_company(), 2024, statements)

    assert gaps["income_statement"] == []
    balance = {row["concept"]: row for row in gaps["balance_sheet"]}
    # Only true placeholders: valued, abstract, and already-reported concepts are skipped.
    assert set(balance) == {"us-gaap:Goodwill", "us-gaap:IntangibleAssetsNetExcludingGoodwill"}
    goodwill = balance["us-gaap:Goodwill"]
    assert goodwill["is_missing"] is True
    assert goodwill["statement"] == "BalanceSheet"
    assert goodwill["section"] == "Assets"
    assert goodwill["confidence"] == 0.4
    assert goodwill["row_id"] == "BalanceSheet:us-gaap:Goodwill:placeholder"
    cashflow = gaps["cashflow_statement"]
    assert [row["statement"] for row in cashflow] == ["CashFlowStatement"]
    assert cashflow[0]["is_missing"] is True


def test_no_fiscal_year_gives_no_rows():
    statements = {"income_statement": [], "balance_sheet": [], "cashflow_statement": []}

    gaps = edgar_service._absence_rows_for_statements(_absence_company(), None, statements)

    assert all(rows == [] for rows in gaps.values())


def test_failing_statement_type_is_skipped():
    company = _FakeCompany(_absence_company()._by_type, failing=("CashFlow",))
    statements = {"income_statement": [], "balance_sheet": [{"concept": "us-gaap:LongTermDebt"}], "cashflow_statement": []}

    gaps = edgar_service._absence_rows_for_statements(company, 2024, statements)

    assert gaps["cashflow_statement"] == []
    assert gaps["balance_sheet"]


def test_filed_absence_scan_ignores_placeholder_rows():
    native = {
        "source_facts": [{
            "concept": "us-gaap:MarketableSecuritiesCurrent",
            "period_end": "2023-12-31",
            "fiscal_period": "FY",
        }],
        "source_filings": [],
    }
    filings = [{
        "form": "10-K",
        "filing_date": "2025-02-01",
        "report_date": "2024-12-31",
        "accession_number": "0000000000-25-000001",
    }]
    kwargs = {
        "concepts": ("MarketableSecuritiesCurrent",),
        "field": "marketable_securities_current",
        "currency": "USD",
    }

    placeholder_line = _filed_absence_line(
        native,
        [2024],
        filings,
        [{"concept": "MarketableSecuritiesCurrent", "is_missing": True}],
        2024,
        **kwargs,
    )
    assert placeholder_line["source"] == "not_applicable"

    presented_line = _filed_absence_line(
        native,
        [2024],
        filings,
        [{"concept": "MarketableSecuritiesCurrent"}],
        2024,
        **kwargs,
    )
    assert presented_line["source"] == "missing"
    assert presented_line["method"] == "previously_reported_marketable_securities_current_is_not_currently_mapped"


def _nci_native(nci_row):
    return {
        "currency": "USD",
        "statements": {
            "income_statement": [{"concept": "us-gaap:Revenues", "label": "Revenue", "FY 2024": 100.0}],
            "balance_sheet": [nci_row],
            "cashflow_statement": [],
        },
        "source_filings": [{
            "form": "10-K",
            "filing_date": "2025-02-01",
            "report_date": "2024-12-31",
            "accession_number": "0000000000-25-000001",
        }],
        "source_facts": [],
    }


def test_nci_absence_ignores_placeholder_rows():
    concept = NON_CONTROLLING_INTEREST_CONCEPTS[0]
    placeholder = build_canonical_financials(
        _nci_native({"concept": concept, "is_missing": True, "statement": "BalanceSheet"}),
        {"currency": "USD"},
    )
    placeholder_record = next(item for item in placeholder["annual"] if item["year"] == 2024)
    assert placeholder_record["non_controlling_interest"]["source"] == "not_applicable"

    reported = build_canonical_financials(
        _nci_native({"concept": NON_CONTROLLING_INTEREST_CONCEPTS[1]}),
        {"currency": "USD"},
    )
    reported_record = next(item for item in reported["annual"] if item["year"] == 2024)
    assert reported_record["non_controlling_interest"]["source"] == "missing"
