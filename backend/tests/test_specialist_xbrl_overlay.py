"""Specialist selector tables stay well-formed; the overlay wraps them safely."""

from __future__ import annotations

from app.services import edgar, xbrl_facts

_SELECTOR_KEYS = {"concept", "dimensions", "transform", "unit", "unit_scale"}


def _tables():
    return {
        "telecom": (edgar._TELECOM_XBRL_SELECTORS, None, None),
        "energy": (edgar._ENERGY_XBRL_SELECTORS, None, None),
        "bank": (edgar._BANK_XBRL_SELECTORS, None, None),
        "insurance": (edgar._INSURANCE_XBRL_SELECTORS, edgar._INSURANCE_XBRL_YEAR_SHIFTS, None),
        "life": (edgar._LIFE_XBRL_SELECTORS, None, edgar._LIFE_XBRL_YEAR_REMAPS),
        "asset_manager": (edgar._ASSET_MANAGER_XBRL_SELECTORS, None, None),
        "reit": (edgar._REIT_XBRL_SELECTORS, None, None),
        "mortgage_reit": (edgar._MORTGAGE_REIT_XBRL_SELECTORS, None, None),
    }


def _flatten(selectors):
    """Asset-manager selectors are keyed per ticker; flatten for inspection."""
    if selectors and all(isinstance(value, dict) for value in selectors.values()):
        return {
            f"{outer}/{inner}": parts
            for outer, table in selectors.items()
            for inner, parts in table.items()
        }
    return selectors


def test_specialist_selector_tables_are_well_formed():
    for name, (selectors, shifts, remaps) in _tables().items():
        selectors = _flatten(selectors)
        assert selectors, name
        for metric, parts in selectors.items():
            assert metric and parts, name
            for part in parts:
                assert set(part) <= _SELECTOR_KEYS, (name, metric, part)
                assert ":" in str(part["concept"]), (name, metric)
                assert part.get("transform") in (None, "x100", "x-1"), (name, metric)
                assert str(part.get("unit") or "USD") in {"USD", "percent", "USD per share", "shares"}, (name, metric)
                # A declared label the conversion table cannot convert would render the selector dead.
                assert str(part.get("unit_scale") or "") in {"", *xbrl_facts._UNIT_SCALE_FACTORS}, (name, metric)
                for axis, member in (part.get("dimensions") or {}).items():
                    assert ":" in axis and ":" in member, (name, metric)
        for shifted_metric in (shifts or {}):
            assert shifted_metric in selectors, (name, shifted_metric)
        for remapped_metric, year_map in (remaps or {}).items():
            assert remapped_metric in selectors, (name, remapped_metric)
            assert year_map and all(isinstance(k, int) and isinstance(v, int) for k, v in year_map.items())


def test_overlay_returns_narrative_facts_when_xbrl_missing():
    facts = [{"concept": "TelecomMobilityRevenue", "fiscal_year": 2025, "value": 1.0}]
    assert edgar._overlay_specialist_xbrl(facts, None, edgar._TELECOM_XBRL_SELECTORS) == facts


class _Query:
    def __init__(self, rows: list) -> None:
        self.rows = list(rows)

    def by_concept(self, concept: str, exact: bool = True):
        self.rows = [row for row in self.rows if row.get("concept") == concept]
        return self

    def by_dimension(self, axis, member=None):
        if axis is None and member is None:
            self.rows = [row for row in self.rows if not any(str(key).startswith("dim_") for key in row)]
        else:
            column = "dim_" + str(axis).replace(":", "_")
            self.rows = [row for row in self.rows if row.get(column) == member]
        return self

    def execute(self):
        return list(self.rows)


class _Xbrl:
    def __init__(self, rows: list) -> None:
        self._rows = rows
        self.facts = self

    def query(self):
        return _Query(self._rows)


def test_overlay_year_shift_maps_prior_instant_to_report_year():
    xbrl = _Xbrl([{
        "concept": "us-gaap:LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseNet",
        "numeric_value": 40_142_000_000.0,
        "fiscal_year": 2024,
        "fiscal_period": "FY",
        "decimals": "-6",
    }])
    facts = [{
        "concept": "InsuranceUnpaidLossReservesBeginning", "fiscal_year": 2025,
        "value": 40_142.0, "unit": "USD", "unit_scale": "millions",
        "period_end": "2025-12-31",
        "source_statement": "reserve rollforward",
    }, {
        "concept": "InsuranceCombinedRatio", "fiscal_year": 2025,
        "value": 90.1, "unit": "percent", "unit_scale": "percent",
        "source_statement": "underwriting table",
    }]
    merged = edgar._overlay_specialist_xbrl(
        facts, xbrl, edgar._INSURANCE_XBRL_SELECTORS,
        year_shifts=edgar._INSURANCE_XBRL_YEAR_SHIFTS,
    )
    assert merged[0]["value"] == 40_142.0
    assert merged[0]["unit_scale"] == "millions"
    # the fact keeps the parsed fiscal-year period, not the shifted XBRL instant
    assert merged[0]["period_end"] == "2025-12-31"
    assert "value from XBRL" in merged[0]["source_statement"]
    # unmapped metric keeps the narrative fact untouched
    assert merged[1] == facts[1]


def test_overlay_leaves_facts_unmatched_when_a_selector_part_is_missing():
    xbrl = _Xbrl([{
        "concept": "us-gaap:IncreaseDecreaseInReceivables",
        "numeric_value": 1_526.0,
        "fiscal_year": 2025,
        "fiscal_period": "FY",
        "decimals": "-6",
    }])
    facts = [{
        "concept": "TelecomWorkingCapitalChange", "fiscal_year": 2025,
        "value": 1_986.0, "unit": "USD", "unit_scale": "millions",
        "source_statement": "cash-flow components",
    }]
    merged = edgar._overlay_specialist_xbrl(facts, xbrl, edgar._TELECOM_XBRL_SELECTORS)
    assert merged[0] == facts[0]


def test_overlay_reit_capex_and_segment_noi_take_xbrl_values():
    xbrl = _Xbrl([
        {
            "concept": "pld:PaymentForPropertyImprovements",
            "numeric_value": 327_355_000.0,
            "fiscal_year": 2025,
            "fiscal_period": "FY",
            "decimals": "-3",
        },
        {
            "concept": "us-gaap:OperatingIncomeLoss",
            "numeric_value": 6_187_608_000.0,
            "fiscal_year": 2025,
            "fiscal_period": "FY",
            "decimals": "-3",
            "member": "us-gaap:OperatingSegmentsMember",
            "dimension": "srt:ConsolidationItemsAxis",
            "dim_srt_ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
            "dim_us-gaap_StatementBusinessSegmentsAxis": "pld:RealEstateOperationsSegmentMember",
        },
    ])
    facts = [{
        "concept": "ReitPropertyImprovements", "fiscal_year": 2025,
        "value": 327_355.0, "unit": "USD", "unit_scale": "thousands",
        "period_end": "2025-12-31",
        "source_statement": "SEC 10-K cash-flow statement, development table",
    }, {
        "concept": "ReitRealEstateSegmentNOI", "fiscal_year": 2025,
        "value": 6_187_608.0, "unit": "USD", "unit_scale": "thousands",
        "period_end": "2025-12-31",
        "source_statement": "SEC 10-K segment table",
    }, {
        "concept": "ReitNareitFFO", "fiscal_year": 2025,
        "value": 5_680.0, "unit": "USD", "unit_scale": "millions",
        "period_end": "2025-12-31",
        "source_statement": "SEC 10-K FFO reconciliation",
    }]
    merged = edgar._overlay_specialist_xbrl(facts, xbrl, edgar._REIT_XBRL_SELECTORS)
    assert merged[0]["value"] == 327_355.0
    assert merged[0]["unit"] == "USD" and merged[0]["unit_scale"] == "thousands"
    assert merged[0]["period_end"] == "2025-12-31"
    assert "value from XBRL (pld:PaymentForPropertyImprovements (consolidated, no dimension))" in merged[0]["source_statement"]
    assert merged[1]["value"] == 6_187_608.0
    assert "us-gaap:OperatingIncomeLoss @ srt:ConsolidationItemsAxis (us-gaap:OperatingSegmentsMember)" in merged[1]["source_statement"]
    # the non-GAAP FFO bridge stays narrative-only
    assert merged[2] == facts[2]


def test_overlay_mortgage_reit_lines_keep_narrative_facts_on_label_disagreement():
    xbrl = _Xbrl([
        {
            "concept": "us-gaap:InterestIncomeExpenseNet",
            "numeric_value": 18_000_000.0,
            "fiscal_year": 2024,
            "fiscal_period": "FY",
            "decimals": "-6",
        },
        {
            "concept": "us-gaap:StockholdersEquity",
            "numeric_value": 1_968_000_000.0,
            "fiscal_year": 2025,
            "fiscal_period": "FY",
            "decimals": "-6",
            "member": "us-gaap:PreferredStockMember",
            "dimension": "us-gaap:StatementEquityComponentsAxis",
            "dim_us-gaap_StatementEquityComponentsAxis": "us-gaap:PreferredStockMember",
        },
        {
            "concept": "us-gaap:PreferredStockDividendsIncomeStatementImpact",
            "numeric_value": 132_000_000.0,
            "fiscal_year": 2024,
            "fiscal_period": "FY",
            "decimals": "-6",
        },
    ])
    facts = [{
        "concept": "MortgageReitGAAPNetInterestIncome", "fiscal_year": 2024,
        "value": 18.0, "unit": "USD", "unit_scale": "millions",
        "period_end": "2024-12-31",
        "source_statement": "SEC 10-K income statement, net interest income",
    }, {
        "concept": "MortgageReitPreferredEquityCarryingValue", "fiscal_year": 2025,
        "value": 1_968.0, "unit": "USD", "unit_scale": "millions",
        "period_end": "2025-12-31",
        "source_statement": "SEC 10-K consolidated balance sheet, preferred stock line",
    }, {
        "concept": "MortgageReitPreferredDividends", "fiscal_year": 2024,
        "value": 132.0, "unit": "EUR", "unit_scale": "millions",
        "period_end": "2024-12-31",
        "source_statement": "SEC 10-K statement of comprehensive income",
    }, {
        "concept": "MortgageReitAverageAssetYield", "fiscal_year": 2024,
        "value": 4.70, "unit": "percent", "unit_scale": "annual",
        "period_end": "2024-12-31",
        "source_statement": "SEC 10-K MD&A average-balance table",
    }]
    merged = edgar._overlay_specialist_xbrl(facts, xbrl, edgar._MORTGAGE_REIT_XBRL_SELECTORS)
    assert merged[0]["value"] == 18.0
    assert "value from XBRL (us-gaap:InterestIncomeExpenseNet (consolidated, no dimension))" in merged[0]["source_statement"]
    assert merged[1]["value"] == 1_968.0
    assert "us-gaap:StockholdersEquity @ us-gaap:StatementEquityComponentsAxis (us-gaap:PreferredStockMember)" in merged[1]["source_statement"]
    # the fact's declared unit disagrees with the selector's label pin
    assert merged[2] == facts[2]
    # the MD&A table is non-GAAP and stays narrative-only
    assert merged[3] == facts[3]
