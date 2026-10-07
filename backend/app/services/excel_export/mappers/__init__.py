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
from .bank_model import apply_bank_model, apply_incomplete_bank_model
from .insurance_model import apply_insurance_model
from .insurance_model import apply_incomplete_insurance_model
from .reit_model import apply_reit_model, apply_incomplete_reit_model
from .asset_manager_model import apply_asset_manager_model, apply_incomplete_asset_manager_model
from .telecom_model import apply_telecom_model, apply_incomplete_telecom_model
from .mortgage_reit_model import apply_mortgage_reit_model, apply_incomplete_mortgage_reit_model
from .integrated_energy_model import apply_integrated_energy_model, apply_incomplete_integrated_energy_model
from .mature_pharma_model import apply_mature_pharma_model, apply_incomplete_mature_pharma_model
from .comparable_model import apply_comparable_model, apply_incomplete_comparable_model
from .utility_model import apply_utility_model, apply_incomplete_utility_model
from .biotech_model import apply_biotech_model, apply_incomplete_biotech_model
from .life_insurance_model import apply_incomplete_life_insurance_model
from .dcf import (
    _add_prior_actual_year_display_column,
    _apply_capex_schedule_to_dcf,
    apply_incomplete_operating_dcf,
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
from .review import _map_data_review_sheet
from .incomplete import apply_incomplete_workbook
from app.services.valuation.model_eligibility import COMPARABLE_VALUATION_METHODS, PRODUCTION_MODEL_ROUTES
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


def _life_fact_value(fact: dict[str, Any], camel: str, snake: str) -> Any:
    value = fact.get(camel)
    return value if value is not None else fact.get(snake)


def _life_insurance_source_contract_resolves(life_model: Any) -> bool:
    """Return True when payload filing facts resolve a complete filing-derived contract."""
    if not isinstance(life_model, dict):
        return False
    facts = life_model.get("filingFacts")
    if not isinstance(facts, list) or not facts:
        return False
    try:
        from app.services.valuation.life_contract import resolve_life_source_contract
    except ImportError:
        return False
    snake_facts = [
        {
            "metric": fact.get("metric"),
            "segment": fact.get("segment"),
            "capital_group": _life_fact_value(fact, "capitalGroup", "capital_group"),
            "unit": fact.get("unit"),
            "unit_scale": _life_fact_value(fact, "unitScale", "unit_scale"),
            "fiscal_year": _life_fact_value(fact, "fiscalYear", "fiscal_year"),
            "earnings_basis": _life_fact_value(fact, "earningsBasis", "earnings_basis"),
        }
        for fact in facts if isinstance(fact, dict)
    ]
    try:
        contract = resolve_life_source_contract(snake_facts)
    except Exception:
        return False
    if contract is None:
        return False
    return life_model.get("earningsBasis") == contract.get("earningsBasis")


def apply_payload_to_workbook(workbook: Workbook, payload: dict[str, Any]) -> None:
    build_status = payload.get("buildStatus", "ready")
    should_build_incomplete_operating_dcf = (
        build_status == "input_required"
        and payload.get("valuationModel") == "unlevered_dcf"
        and isinstance(payload.get("assumptions"), dict)
    )
    bank_model = payload.get("bankModel") if isinstance(payload.get("bankModel"), dict) else {}
    bank_assumptions = bank_model.get("assumptions") if isinstance(bank_model.get("assumptions"), dict) else {}
    should_build_incomplete_bank_model = (
        build_status == "input_required"
        and payload.get("valuationModel") == "bank_residual_income"
        and bank_assumptions.get("minimumCet1Ratio") is None
    )
    insurance_model = payload.get("insuranceModel") if isinstance(payload.get("insuranceModel"), dict) else {}
    should_build_incomplete_insurance_model = (
        build_status == "input_required"
        and payload.get("valuationModel") == "insurance_pnc_residual_income"
        and isinstance(insurance_model.get("history"), dict)
        and any(
            isinstance(item, dict) and item.get("key") == "unpaid_loss_reserves"
            for item in payload.get("requiredInputs", []) if isinstance(payload.get("requiredInputs"), list)
        )
    )
    reit_model = payload.get("reitModel") if isinstance(payload.get("reitModel"), dict) else {}
    reit_requirements = payload.get("requiredInputs")
    reit_requirements = reit_requirements if isinstance(reit_requirements, list) else []
    should_build_incomplete_reit_model = (
        build_status == "input_required"
        and payload.get("valuationModel") == "reit_affo"
        and isinstance(reit_model.get("history"), dict)
        and any(isinstance(item, dict) and item.get("key") == "same_store_noi_growth" for item in reit_requirements)
    )
    mortgage_reit_model = payload.get("mortgageReitModel") if isinstance(payload.get("mortgageReitModel"), dict) else {}
    mortgage_reit_requirements = payload.get("requiredInputs")
    mortgage_reit_requirements = mortgage_reit_requirements if isinstance(mortgage_reit_requirements, list) else []
    should_build_incomplete_mortgage_reit_model = (
        build_status == "input_required"
        and payload.get("valuationModel") == "mortgage_reit_residual_income"
        and isinstance(mortgage_reit_model.get("history"), dict)
        and any(isinstance(item, dict) and item.get("key") == "average_repo_borrowings" for item in mortgage_reit_requirements)
    )
    asset_manager_model = payload.get("assetManagerModel") if isinstance(payload.get("assetManagerModel"), dict) else {}
    asset_manager_requirements = payload.get("requiredInputs")
    asset_manager_requirements = asset_manager_requirements if isinstance(asset_manager_requirements, list) else []
    should_build_incomplete_asset_manager_model = (
        build_status == "input_required"
        and payload.get("valuationModel") == "asset_manager_aum_dcf"
        and isinstance(asset_manager_model.get("history"), dict)
        and any(isinstance(item, dict) and item.get("key") == "base_fee_yield" for item in asset_manager_requirements)
    )
    telecom_model = payload.get("telecomModel") if isinstance(payload.get("telecomModel"), dict) else {}
    telecom_requirements = payload.get("requiredInputs")
    telecom_requirements = telecom_requirements if isinstance(telecom_requirements, list) else []
    should_build_incomplete_telecom_model = (
        build_status == "input_required"
        and payload.get("valuationModel") == "telecom_subscriber_dcf"
        and isinstance(telecom_model.get("history"), dict)
        and any(isinstance(item, dict) and item.get("key") == "postpaid_phone_churn" for item in telecom_requirements)
    )
    integrated_energy_model = payload.get("integratedEnergyModel") if isinstance(payload.get("integratedEnergyModel"), dict) else {}
    integrated_energy_requirements = payload.get("requiredInputs")
    integrated_energy_requirements = integrated_energy_requirements if isinstance(integrated_energy_requirements, list) else []
    should_build_incomplete_integrated_energy_model = (
        build_status == "input_required"
        and payload.get("valuationModel") == "integrated_energy_dcf"
        and isinstance(integrated_energy_model.get("history"), dict)
        and any(isinstance(item, dict) and item.get("key") == "crude_oil_production" for item in integrated_energy_requirements)
    )
    mature_pharma_model = payload.get("maturePharmaModel") if isinstance(payload.get("maturePharmaModel"), dict) else {}
    mature_pharma_requirements = payload.get("requiredInputs")
    mature_pharma_requirements = mature_pharma_requirements if isinstance(mature_pharma_requirements, list) else []
    should_build_incomplete_mature_pharma_model = (
        build_status == "input_required"
        and payload.get("valuationModel") == "mature_pharma_product_dcf"
        and isinstance(mature_pharma_model.get("history"), dict)
        and any(isinstance(item, dict) and str(item.get("key") or "").startswith("product_revenue:") for item in mature_pharma_requirements)
    )
    comparable_model = payload.get("comparableModel") if isinstance(payload.get("comparableModel"), dict) else {}
    comparable_requirements = payload.get("requiredInputs")
    comparable_requirements = comparable_requirements if isinstance(comparable_requirements, list) else []
    should_build_incomplete_comparable_model = (
        build_status == "input_required"
        and payload.get("valuationModel") in COMPARABLE_VALUATION_METHODS
        and comparable_model.get("method") == payload.get("valuationModel")
        and any(
            isinstance(item, dict)
            and (str(item.get("key") or "").startswith("peer_ebitda:") or str(item.get("key") or "").startswith("peer_revenue:"))
            for item in comparable_requirements
        )
    )
    utility_model = payload.get("utilityModel") if isinstance(payload.get("utilityModel"), dict) else {}
    should_build_incomplete_utility_model = (
        build_status == "input_required"
        and payload.get("valuationModel") == "utility_dcf"
        and isinstance(utility_model.get("assumptionSources"), dict)
        and any(isinstance(item, dict) and str(item.get("key") or "") == "jurisdictional_rate_base"
                for item in payload.get("requiredInputs", []) if isinstance(payload.get("requiredInputs"), list))
    )
    biotech_model = payload.get("biotechModel") if isinstance(payload.get("biotechModel"), dict) else {}
    biotech_requirements = payload.get("requiredInputs")
    biotech_requirements = biotech_requirements if isinstance(biotech_requirements, list) else []
    should_build_incomplete_biotech_model = (
        build_status == "input_required"
        and payload.get("valuationModel") == "biotech_pipeline_rnpv"
        and isinstance(biotech_model.get("pipelineAssets"), list)
        and any(isinstance(item, dict) and item.get("key") == "commercial_fcf_margin" for item in biotech_requirements)
    )
    life_insurance_model = payload.get("lifeInsuranceModel") if isinstance(payload.get("lifeInsuranceModel"), dict) else {}
    should_build_incomplete_life_insurance_model = (
        build_status == "input_required"
        and payload.get("valuationModel") == "life_insurer_distributable_earnings_dcf"
        and _life_insurance_source_contract_resolves(life_insurance_model)
    )
    if build_status == "input_required" and not (
        should_build_incomplete_operating_dcf or should_build_incomplete_bank_model
        or should_build_incomplete_insurance_model or should_build_incomplete_reit_model
        or should_build_incomplete_mortgage_reit_model or should_build_incomplete_asset_manager_model
        or should_build_incomplete_telecom_model or should_build_incomplete_integrated_energy_model
        or should_build_incomplete_mature_pharma_model
        or should_build_incomplete_comparable_model
        or should_build_incomplete_utility_model
        or should_build_incomplete_biotech_model
        or should_build_incomplete_life_insurance_model
    ):
        apply_incomplete_workbook(workbook, payload)
        return
    if build_status not in {"ready", "input_required"}:
        raise ValueError(f"Unsupported workbook build status: {build_status}.")

    valuation_model = payload.get("valuationModel")
    if valuation_model is not None and valuation_model not in PRODUCTION_MODEL_ROUTES:
        raise ValueError(f"The {valuation_model} workbook is not implemented.")

    if valuation_model == "bank_residual_income":
        apply_bank_model(workbook, payload)
        if should_build_incomplete_bank_model:
            input_cells = apply_incomplete_workbook(workbook, payload, preserve_existing=True)
            apply_incomplete_bank_model(workbook, payload, input_cells)
        return

    if valuation_model == "insurance_pnc_residual_income":
        apply_insurance_model(workbook, payload)
        if should_build_incomplete_insurance_model:
            input_cells = apply_incomplete_workbook(workbook, payload, preserve_existing=True)
            apply_incomplete_insurance_model(workbook, payload, input_cells)
        return

    if valuation_model == "reit_affo":
        apply_reit_model(workbook, payload)
        if should_build_incomplete_reit_model:
            input_cells = apply_incomplete_workbook(workbook, payload, preserve_existing=True)
            apply_incomplete_reit_model(workbook, payload, input_cells)
        return

    if valuation_model == "asset_manager_aum_dcf":
        apply_asset_manager_model(workbook, payload)
        if should_build_incomplete_asset_manager_model:
            input_cells = apply_incomplete_workbook(workbook, payload, preserve_existing=True)
            apply_incomplete_asset_manager_model(workbook, payload, input_cells)
        return

    if valuation_model == "telecom_subscriber_dcf":
        apply_telecom_model(workbook, payload)
        if should_build_incomplete_telecom_model:
            input_cells = apply_incomplete_workbook(workbook, payload, preserve_existing=True)
            apply_incomplete_telecom_model(workbook, payload, input_cells)
        return

    if valuation_model == "mortgage_reit_residual_income":
        apply_mortgage_reit_model(workbook, payload)
        if should_build_incomplete_mortgage_reit_model:
            input_cells = apply_incomplete_workbook(workbook, payload, preserve_existing=True)
            apply_incomplete_mortgage_reit_model(workbook, payload, input_cells)
        return

    if valuation_model == "integrated_energy_dcf":
        apply_integrated_energy_model(workbook, payload)
        if should_build_incomplete_integrated_energy_model:
            input_cells = apply_incomplete_workbook(workbook, payload, preserve_existing=True)
            apply_incomplete_integrated_energy_model(workbook, payload, input_cells)
        return

    if valuation_model == "mature_pharma_product_dcf":
        apply_mature_pharma_model(workbook, payload)
        if should_build_incomplete_mature_pharma_model:
            input_cells = apply_incomplete_workbook(workbook, payload, preserve_existing=True)
            apply_incomplete_mature_pharma_model(workbook, payload, input_cells)
        return

    if valuation_model in COMPARABLE_VALUATION_METHODS:
        if should_build_incomplete_comparable_model:
            apply_incomplete_comparable_model(workbook, payload)
        else:
            apply_comparable_model(workbook, payload)
        return

    if valuation_model == "utility_dcf":
        if should_build_incomplete_utility_model:
            input_cells = apply_incomplete_workbook(workbook, payload, preserve_existing=True)
            apply_incomplete_utility_model(workbook, payload, input_cells)
        else:
            apply_utility_model(workbook, payload)
        return

    if valuation_model == "biotech_pipeline_rnpv":
        if should_build_incomplete_biotech_model:
            input_cells = apply_incomplete_workbook(workbook, payload, preserve_existing=True)
            apply_incomplete_biotech_model(workbook, payload, input_cells)
        else:
            apply_biotech_model(workbook, payload)
        return

    if valuation_model == "life_insurer_distributable_earnings_dcf":
        if not should_build_incomplete_life_insurance_model:
            raise ValueError("Life-insurance workbooks require a validated input-required filing-derived source contract.")
        input_cells = apply_incomplete_workbook(workbook, payload, preserve_existing=True)
        apply_incomplete_life_insurance_model(workbook, payload, input_cells)
        return

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
    peer_count = _harden_comps_ratio_formulas(comps_ws, payload)
    _harden_wacc_peer_aggregate_formulas(wacc, peer_count)

    _normalize_public_dcf_layout(
        outputs,
        dcf_base,
        dcf_bull,
        dcf_bear,
        data_recalc,
        payload,
        divisor,
        timeline_years,
        historical_years,
    )
    _sync_scenario_formula_backbone(dcf_base, dcf_bull, dcf_bear)
    _apply_capex_schedule_to_dcf(dcf_base, dcf_bull, dcf_bear, payload, timeline_years, divisor)
    _apply_scenario_snapshots_to_dcf(dcf_base, dcf_bull, dcf_bear, payload, timeline_years, divisor)
    _harden_growth_rate_formulas(dcf_base, dcf_bull, dcf_bear)

    _map_sensitivity_blocks(dcf_base, dcf_bull, dcf_bear, payload, divisor)

    _finalize_timeline_headers(outputs, dcf_base, dcf_bull, dcf_bear, timeline_years, historical_years)
    _replace_template_placeholders(company_name=company_name, ticker=ticker, sheets=(outputs, dcf_base, dcf_bull, dcf_bear))
    _reset_dcf_sheet_view_to_top(outputs, dcf_base, dcf_bull, dcf_bear)
    _remove_assumption_breakdown(workbook, cover)
    _map_data_review_sheet(workbook, payload)
    if should_build_incomplete_operating_dcf:
        input_cells = apply_incomplete_workbook(workbook, payload, preserve_existing=True)
        apply_incomplete_operating_dcf(workbook, payload, input_cells, timeline_years, historical_years)
