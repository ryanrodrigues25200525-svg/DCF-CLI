"""Core XBRL fact helpers: dimension normalization, annual selection, sums, overlay."""

from __future__ import annotations

import pytest

from app.services import xbrl_facts


def _raw_row(**overrides) -> dict:
    row = {
        "concept": "us-gaap:Revenues",
        "numeric_value": 1_000.0,
        "fiscal_year": 2025,
        "fiscal_period": "FY",
        "period_start": "2025-01-01",
        "period_end": "2025-12-31",
        "decimals": "-6",
    }
    row.update(overrides)
    return row


def test_normalize_fact_row_maps_dimension_columns_to_axis_qnames():
    row = xbrl_facts._normalize_fact_row(_raw_row(**{
        "dim_srt_ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
        "dim_us-gaap_StatementBusinessSegmentsAxis": "t:CommunicationsMember",
    }))
    assert row is not None
    assert row["dimensions"] == {
        "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
        "us-gaap:StatementBusinessSegmentsAxis": "t:CommunicationsMember",
    }


def test_dimension_matched_requires_exact_axis_set():
    row = xbrl_facts._normalize_fact_row(_raw_row(**{
        "dim_us-gaap_StatementEquityComponentsAxis": "us-gaap:RetainedEarningsMember",
        "dim_dei_LegalEntityAxis": "met:MetropolitanLifeInsuranceCompanyMember",
    }))
    assert row is not None
    assert xbrl_facts.dimension_matched(row, {
        "us-gaap:StatementEquityComponentsAxis": "us-gaap:RetainedEarningsMember",
        "dei:LegalEntityAxis": "met:MetropolitanLifeInsuranceCompanyMember",
    })
    # parent-company duplicate carries an extra axis; it must not match
    assert not xbrl_facts.dimension_matched(row, {
        "us-gaap:StatementEquityComponentsAxis": "us-gaap:RetainedEarningsMember",
    })


def test_annual_lookup_prefers_full_year_duration_over_quarter():
    quarter = xbrl_facts._normalize_fact_row(_raw_row(
        numeric_value=200.0, fiscal_period="Q1",
        period_start="2025-01-01", period_end="2025-03-31",
    ))
    year = xbrl_facts._normalize_fact_row(_raw_row(numeric_value=900.0))
    assert quarter is not None and year is not None
    lookup = xbrl_facts.annual_lookup([quarter, year])
    assert lookup[2025]["value"] == 900.0
    assert lookup[2025]["fiscal_period"] == "FY"


def test_annual_lookup_prefers_higher_precision_when_period_ties():
    coarse = xbrl_facts._normalize_fact_row(_raw_row(numeric_value=1_000_000_000.0, decimals="-6"))
    precise = xbrl_facts._normalize_fact_row(_raw_row(numeric_value=1_234_567_890.0, decimals="0"))
    assert coarse is not None and precise is not None
    lookup = xbrl_facts.annual_lookup([coarse, precise])
    assert lookup[2025]["value"] == 1_234_567_890.0


def test_sum_lookups_keeps_only_years_all_parts_cover():
    us = xbrl_facts.annual_lookup([
        xbrl_facts._normalize_fact_row(_raw_row(numeric_value=5_063.0, member="country:US")),
    ])
    non_us = xbrl_facts.annual_lookup([
        xbrl_facts._normalize_fact_row(_raw_row(numeric_value=16_291.0, fiscal_year=2025, member="us-gaap:NonUsMember")),
        xbrl_facts._normalize_fact_row(_raw_row(numeric_value=13_000.0, fiscal_year=2024, member="us-gaap:NonUsMember")),
    ])
    summed = xbrl_facts.sum_lookups([us, non_us])
    assert list(summed) == [2025]
    assert summed[2025]["value"] == 21_354.0
    assert "country:US" in summed[2025]["provenance"]
    assert "us-gaap:NonUsMember" in summed[2025]["provenance"]


def test_overlay_applies_unit_overrides_and_precomputed_provenance():
    facts = [{
        "metric": "TelecomCostOfDebt", "value": 4.2, "unit": "percent",
        "unit_scale": "actual", "period_end": "2025-12-31",
        "source_statement": "filing narrative",
    }, {
        "metric": "TelecomMobilityRevenue", "value": 89_482_000_000.0, "unit": "USD",
        "unit_scale": "actual", "period_end": "2025-12-31",
        "source_statement": "filing narrative",
    }, {
        "metric": "TelecomSubscribers", "value": 250.0, "unit": "millions",
        "unit_scale": "actual", "period_end": "2025-12-31",
        "source_statement": "filing narrative",
    }]
    rows = {
        ("TelecomCostOfDebt", 2025): {
            "value": 4.2, "unit": "percent", "unit_scale": "actual",
            "period_end": "2025-12-31",
            "provenance": "us-gaap:LongtermDebtWeightedAverageInterestRate (consolidated, no dimension) x100",
        },
        ("TelecomMobilityRevenue", 2025): {
            "value": 89_482_000_000.0, "period_end": "2025-12-31",
            "provenance": "us-gaap:Revenues @ us-gaap:SubsegmentsAxis (t:MobilityMember)",
        },
    }
    merged = xbrl_facts.overlay_xbrl_values(
        facts, rows, lambda fact: (fact["metric"], 2025),
    )
    assert merged[0]["unit"] == "percent"
    assert "LongtermDebtWeightedAverageInterestRate" in merged[0]["source_statement"]
    assert merged[1]["value"] == 89_482_000_000.0
    assert merged[1]["unit_scale"] == "actual"
    # unmatched facts pass through untouched
    assert merged[2] == facts[2]


class _FakeQuery:
    def __init__(self, rows: list) -> None:
        self.rows = rows
        self.calls: list = []

    def by_concept(self, concept: str, exact: bool = True):
        self.calls.append(("by_concept", concept, exact))
        self.rows = [row for row in self.rows if row.get("concept") == concept]
        return self

    def by_dimension(self, axis, member=None):
        self.calls.append(("by_dimension", axis, member))
        if axis is None and member is None:
            self.rows = [
                row for row in self.rows
                if not any(str(key).startswith("dim_") for key in row)
            ]
        else:
            column = "dim_" + str(axis).replace(":", "_")
            self.rows = [row for row in self.rows if row.get(column) == member]
        return self

    def execute(self):
        return list(self.rows)


class _FakeFacts:
    def __init__(self, rows: list) -> None:
        self.query_obj = _FakeQuery(rows)

    def query(self):
        return self.query_obj


class _FakeXbrl:
    def __init__(self, rows: list) -> None:
        self.facts = _FakeFacts(rows)


def test_concept_facts_requests_dimensionless_facts_when_unpinned():
    raw = _raw_row(fact_id="f1")
    xbrl = _FakeXbrl([raw])
    rows = xbrl_facts.concept_facts(xbrl, "us-gaap:Revenues")
    assert len(rows) == 1
    assert ("by_dimension", None, None) in xbrl.facts.query_obj.calls


def test_concept_facts_pins_axes_and_rejects_extra_contexts():
    pinned = _raw_row(fact_id="f1", dim_dei_LegalEntityAxis="met:MetropolitanLifeInsuranceCompanyMember")
    duplicate = _raw_row(
        fact_id="f2",
        numeric_value=99.0,
        dim_dei_LegalEntityAxis="met:MetropolitanLifeInsuranceCompanyMember",
        dim_srt_ConsolidatedEntitiesAxis="srt:ParentCompanyMember",
    )
    xbrl = _FakeXbrl([pinned, duplicate])
    rows = xbrl_facts.concept_facts(
        xbrl, "us-gaap:Revenues",
        dimensions={"dei:LegalEntityAxis": "met:MetropolitanLifeInsuranceCompanyMember"},
    )
    assert [row.get("fact_id") for row in rows] == ["f1"]


class _FreshFakeFacts:
    """Each query() starts from the full row list (real Facts are immutable)."""

    def __init__(self, rows: list) -> None:
        self.rows = rows

    def query(self):
        return _FakeQuery(self.rows)


class _FreshFakeXbrl:
    def __init__(self, rows: list) -> None:
        self.facts = _FreshFakeFacts(rows)


def test_metric_lookup_applies_transform_and_percent_unit_override():
    xbrl = _FreshFakeXbrl([
        _raw_row(concept="us-gaap:LongtermDebtWeightedAverageInterestRate", numeric_value=0.042),
    ])
    lookup = xbrl_facts.metric_lookup(xbrl, [{
        "concept": "us-gaap:LongtermDebtWeightedAverageInterestRate",
        "transform": "x100",
        "unit": "percent",
        "unit_scale": "percent",
    }])
    assert lookup[2025]["value"] == pytest.approx(4.2)
    assert lookup[2025]["unit"] == "percent"
    assert lookup[2025]["unit_scale"] == "percent"
    assert "x100" in lookup[2025]["provenance"]


def test_metric_lookup_is_empty_when_one_part_lacks_the_year():
    xbrl = _FreshFakeXbrl([
        _raw_row(concept="us-gaap:PremiumsWrittenNet", numeric_value=23_675_000_000.0),
    ])
    lookup = xbrl_facts.metric_lookup(xbrl, [
        {"concept": "us-gaap:PremiumsWrittenNet"},
        {"concept": "us-gaap:PremiumsEarnedNet"},
    ])
    assert lookup == {}


def test_metric_lookup_sums_parts_with_per_part_transforms():
    xbrl = _FreshFakeXbrl([
        _raw_row(concept="us-gaap:IncreaseDecreaseInReceivables", numeric_value=1_526.0),
        _raw_row(concept="us-gaap:IncreaseDecreaseInOtherAccountsPayableAndAccruedLiabilities", numeric_value=884.0),
    ])
    lookup = xbrl_facts.metric_lookup(xbrl, [
        {"concept": "us-gaap:IncreaseDecreaseInReceivables"},
        {"concept": "us-gaap:IncreaseDecreaseInOtherAccountsPayableAndAccruedLiabilities", "transform": "x-1"},
    ])
    assert lookup[2025]["value"] == 642.0
    assert "x-1" in lookup[2025]["provenance"]


def test_build_metric_rows_skips_metrics_without_facts():
    xbrl = _FreshFakeXbrl([_raw_row(concept="us-gaap:Revenues", numeric_value=100.0)])
    rows = xbrl_facts.build_metric_rows(xbrl, {
        "Mapped": [{"concept": "us-gaap:Revenues"}],
        "Unmapped": [{"concept": "us-gaap:OtherConcept"}],
    })
    assert set(rows) == {"Mapped"}
