from __future__ import annotations

from typing import Any

from openpyxl.workbook import Workbook

from .comps import _harden_comps_ratio_formulas, _map_comps
from .cover import (
    _align_income_statement_labels,
    _map_company_labels,
    _map_cover_sheet,
    _map_currency_labels,
)
from .data import _build_timeline, _map_data_sheets, _map_year_headers
from .dcf import (
    _add_prior_actual_year_display_column,
    _apply_capex_schedule_to_dcf,
    _apply_scenario_snapshots_to_dcf,
    _finalize_assumption_block_cleanup,
    _finalize_timeline_headers,
    _harden_growth_rate_formulas,
    _map_dcf_base_inputs,
    _map_sensitivity_blocks,
    _normalize_dcf_waterfall_formulas,
    _normalize_public_dcf_layout,
    _remove_assumption_breakdown,
    _replace_template_placeholders,
    _reset_dcf_sheet_view_to_top,
    _sync_scenario_formula_backbone,
    _sync_shared_scenario_inputs,
)
from .utils import (
    SHEET_COMPS,
    SHEET_COVER,
    SHEET_DATA_ORIGINAL,
    SHEET_DATA_RECALCULATED,
    SHEET_DCF_BASE,
    SHEET_DCF_BEAR,
    SHEET_DCF_BULL,
    SHEET_OUTPUTS,
    SHEET_OUTPUTS_LEGACY,
    SHEET_WACC,
    WACC_LOOP_MODE_ITERATIVE,
    _payload_company_name,
    _payload_ticker,
    _resolve_amount_scale_divisor,
    _sheet,
    resolve_wacc_loop_mode,
)
from .wacc import (
    _apply_required_wacc_formulas,
    _harden_wacc_peer_aggregate_formulas,
    _map_wacc_inputs,
)


def apply_payload_to_workbook(workbook: Workbook, payload: dict[str, Any]) -> None:
    divisor = _resolve_amount_scale_divisor(payload)

    cover = _sheet(workbook, SHEET_COVER)
    outputs = _sheet(workbook, SHEET_OUTPUTS)
    dcf_base = _sheet(workbook, SHEET_DCF_BASE)
    dcf_bull = _sheet(workbook, SHEET_DCF_BULL)
    dcf_bear = _sheet(workbook, SHEET_DCF_BEAR)
    wacc = _sheet(workbook, SHEET_WACC)
    comps_ws = _sheet(workbook, SHEET_COMPS)
    data_recalc = _sheet(workbook, SHEET_DATA_RECALCULATED)
    data_original = _sheet(workbook, SHEET_DATA_ORIGINAL)

    ticker = _payload_ticker(payload)
    company_name = _payload_company_name(payload)

    _map_cover_sheet(cover, payload, ticker, company_name)
    _map_company_labels(company_name, ticker, outputs, dcf_base, dcf_bull, dcf_bear, wacc, comps_ws)
    _map_currency_labels(outputs, dcf_base, dcf_bull, dcf_bear, wacc, comps_ws)

    _map_dcf_base_inputs(dcf_base, payload, divisor)
    _sync_shared_scenario_inputs(dcf_bull, dcf_base, nwc_multiplier=1.0)
    _sync_shared_scenario_inputs(dcf_bear, dcf_base, nwc_multiplier=1.0)
    _align_income_statement_labels(dcf_base, dcf_bull, dcf_bear, data_original, data_recalc)

    _map_wacc_inputs(wacc, payload)
    _apply_required_wacc_formulas(wacc, payload)

    timeline_years, historical_years = _build_timeline(payload)
    _map_year_headers(outputs, dcf_base, dcf_bull, dcf_bear, data_original, data_recalc, timeline_years, historical_years, payload)
    _map_data_sheets(data_original, data_recalc, payload, divisor, timeline_years)

    _map_comps(comps_ws, payload, divisor)
    _harden_comps_ratio_formulas(comps_ws)
    _harden_wacc_peer_aggregate_formulas(wacc)

    _normalize_public_dcf_layout(outputs, dcf_base, dcf_bull, dcf_bear, payload, divisor)
    _sync_scenario_formula_backbone(dcf_base, dcf_bull, dcf_bear)
    _apply_capex_schedule_to_dcf(dcf_base, dcf_bull, dcf_bear, payload, timeline_years, divisor)
    _apply_scenario_snapshots_to_dcf(dcf_base, dcf_bull, dcf_bear, payload, timeline_years, divisor)

    _map_sensitivity_blocks(dcf_base, dcf_bull, dcf_bear, payload, divisor)

    _finalize_timeline_headers(outputs, dcf_base, dcf_bull, dcf_bear, timeline_years, historical_years)
    _replace_template_placeholders(company_name=company_name, ticker=ticker, sheets=(outputs, dcf_base, dcf_bull, dcf_bear))
    _reset_dcf_sheet_view_to_top(outputs, dcf_base, dcf_bull, dcf_bear)
    _remove_assumption_breakdown(workbook, cover)
