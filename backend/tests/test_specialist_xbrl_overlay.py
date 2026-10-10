"""Specialist selector tables stay well-formed; the overlay wraps them safely."""

from __future__ import annotations

from app.services import edgar

_SELECTOR_KEYS = {"concept", "dimensions", "transform", "unit", "unit_scale"}


def _tables():
    return {
        "telecom": (edgar._TELECOM_XBRL_SELECTORS, None, None),
        "energy": (edgar._ENERGY_XBRL_SELECTORS, None, None),
        "bank": (edgar._BANK_XBRL_SELECTORS, None, None),
        "insurance": (edgar._INSURANCE_XBRL_SELECTORS, edgar._INSURANCE_XBRL_YEAR_SHIFTS, None),
        "life": (edgar._LIFE_XBRL_SELECTORS, None, edgar._LIFE_XBRL_YEAR_REMAPS),
        "asset_manager": (edgar._ASSET_MANAGER_XBRL_SELECTORS, None, None),
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
                assert str(part.get("unit") or "USD") in {"USD", "percent"}, (name, metric)
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
    assert merged[0]["value"] == 40_142_000_000.0
    assert merged[0]["unit_scale"] == "actual"
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
