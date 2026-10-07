from __future__ import annotations

import math
import re
import time
from typing import Any, Dict

from .model_eligibility import BlockedModel, ModelEligibility, ModelReadinessGap, OperatingArchetype, PRODUCTION_MODEL_ROUTES

_REQUIRED_BANK_INPUTS = (
    "interest_income",
    "interest_expense",
    "net_interest_income",
    "noninterest_income",
    "noninterest_expense",
    "provision_for_credit_losses",
    "loans_and_leases",
    "deposits",
    "interest_bearing_liabilities",
    "interest_earning_assets",
    "risk_weighted_assets",
    "cet1_capital",
    "minimum_cet1_ratio",
    "common_equity",
    "common_equity_distributions",
    "diluted_shares",
)

_REQUIRED_PC_INSURANCE_INPUTS = (
    "net_premiums_written",
    "net_premiums_earned",
    "losses_and_lae",
    "acquisition_expenses",
    "general_operating_expenses",
    "underwriting_expenses",
    "loss_ratio",
    "expense_ratio",
    "combined_ratio",
    "prior_year_reserve_development",
    "underwriting_income",
    "net_investment_income",
    "invested_assets",
    "unpaid_loss_reserves_beginning",
    "losses_incurred_for_reserve_rollforward",
    "losses_paid_for_reserve_rollforward",
    "reserve_other_changes",
    "unpaid_loss_reserves",
    "reinsurance_recoverable",
    "gross_loss_reserves",
    "reserve_rollforward_check",
    "other_operations_pretax_income",
    "statutory_capital_surplus",
    "minimum_statutory_capital",
    "common_equity",
    "common_equity_distributions",
    "diluted_shares",
    "net_income",
    "tax_rate",
    "reported_pretax_income",
    "other_pretax_adjustments",
)

_ALTERNATIVE_ASSET_MANAGER_TERMS = (
    "alternative asset", "alternative investment", "private equity", "private credit",
    "private markets", "private capital",
)


def _line_ready(line: Any) -> bool:
    sources = line.get("sources") if isinstance(line, dict) else None
    return bool(
        isinstance(line, dict)
        and line.get("source") in {"sec_native", "derived"}
        and isinstance(line.get("value"), (int, float))
        and math.isfinite(float(line["value"]))
        and isinstance(sources, list)
        and len(sources) > 0
        and all(
            isinstance(source, dict)
            and source.get("accession")
            and source.get("filed")
            for source in sources
        )
    )


def _line_ready_or_not_applicable(line: Any) -> bool:
    if _line_ready(line):
        return True
    sources = line.get("sources") if isinstance(line, dict) else None
    return bool(
        isinstance(line, dict)
        and line.get("source") == "not_applicable"
        and str(line.get("method") or "").strip()
        and isinstance(sources, list)
        and sources
        and all(
            isinstance(source, dict)
            and source.get("accession")
            and source.get("filed")
            for source in sources
        )
    )


def _asset_manager_history_ready(
    annual: list[Any],
    field: str,
    *,
    strictly_positive: bool,
    allow_negative: bool = False,
) -> bool:
    if len(annual) < 3:
        return False
    recent = annual[-3:]
    years = [
        _to_finite_number(record.get("year")) if isinstance(record, dict) else None
        for record in recent
    ]
    if any(year is None or not float(year).is_integer() for year in years):
        return False
    if any(int(years[idx]) != int(years[idx - 1]) + 1 for idx in range(1, len(years))):
        return False
    for record in recent:
        asset_manager = record.get("asset_manager") if isinstance(record, dict) else None
        line = asset_manager.get(field) if isinstance(asset_manager, dict) else None
        value = _to_finite_number(line.get("value")) if isinstance(line, dict) else None
        if not _line_ready(line) or value is None or (strictly_positive and value <= 0) or (value < 0 and not allow_negative):
            return False
    return True


def _asset_manager_rollforward_history_ready(annual: list[Any]) -> bool:
    if len(annual) < 3:
        return False
    recent = annual[-3:]
    years = [
        _to_finite_number(record.get("year")) if isinstance(record, dict) else None
        for record in recent
    ]
    if any(year is None or not float(year).is_integer() for year in years):
        return False
    if any(int(years[idx]) != int(years[idx - 1]) + 1 for idx in range(1, len(years))):
        return False

    for record in recent:
        manager = record.get("asset_manager") if isinstance(record, dict) else None
        if not isinstance(manager, dict):
            return False
        required = {name: manager.get(name) for name in (
            "beginning_aum", "aum", "net_flows", "market_change", "scope_change",
        )}
        if any(not _line_ready(line) for line in required.values()):
            return False
        optional = {name: manager.get(name) for name in ("realizations", "acquisitions", "fx_change")}
        reported_optional = [line for line in optional.values() if _line_ready(line)]
        components = [*required.values(), *reported_optional]
        values = [_to_finite_number(line.get("value")) if isinstance(line, dict) else None for line in components]
        if any(value is None for value in values):
            return False
        beginning, ending, net_flows, market_change, scope_change, *other_changes = values
        calculated_ending = beginning + net_flows + market_change + scope_change + sum(other_changes)
        tolerance = max(1.0, abs(float(ending)) * 1e-9)
        if abs(float(ending) - float(calculated_ending)) > tolerance:
            return False
    return True


def _asset_manager_revenue_history_ready(annual: list[Any]) -> bool:
    if len(annual) < 3:
        return False
    recent = annual[-3:]
    for index, record in enumerate(recent):
        if index > 0 and record.get("year") != recent[index - 1].get("year") + 1:
            return False
        revenue_line = record.get("revenue") if isinstance(record, dict) else None
        asset_manager = record.get("asset_manager") if isinstance(record, dict) else None
        if not _line_ready(revenue_line) or not isinstance(asset_manager, dict):
            return False
        component_fields = (
            "base_fees", "performance_fees", "capital_allocation_income", "securities_lending_revenue",
            "technology_revenue", "distribution_revenue", "administrative_other_revenue", "other_revenue",
            "unmapped_revenue",
        )
        total_component_revenue = 0.0
        for field in component_fields:
            line = asset_manager.get(field)
            if isinstance(line, dict) and line.get("source") == "ambiguous":
                return False
            if _line_ready(line):
                value = _to_finite_number(line.get("value"))
                if value is None:
                    return False
                total_component_revenue += value
            elif field in {"base_fees", "performance_fees", "unmapped_revenue"}:
                return False
        reported_revenue = _to_finite_number(revenue_line.get("value")) if isinstance(revenue_line, dict) else None
        if reported_revenue is None or abs(reported_revenue - total_component_revenue) > max(1.0, abs(reported_revenue) * 1e-9):
            return False
    return True


def _operating_tax_rate_ready(annual: list[Any]) -> bool:
    recent = annual[-3:]
    valid_rates = []
    for record in recent:
        tax_line = record.get("tax_rate") if isinstance(record, dict) else None
        value = tax_line.get("value") if isinstance(tax_line, dict) else None
        if _line_ready(tax_line) and _positive_number(value) and float(value) <= 0.5:
            valid_rates.append(float(value))
        elif _line_ready(tax_line) and isinstance(value, (int, float)) and value == 0:
            valid_rates.append(0.0)
    latest_tax = recent[-1].get("tax_rate") if recent and isinstance(recent[-1], dict) else None
    latest_value = latest_tax.get("value") if isinstance(latest_tax, dict) else None
    if (
        _line_ready(latest_tax)
        and isinstance(latest_value, (int, float))
        and math.isfinite(float(latest_value))
        and 0 <= float(latest_value) <= 0.5
    ):
        return True
    if not valid_rates:
        return False
    normalized_rate = sum(valid_rates) / len(valid_rates)
    return math.isfinite(normalized_rate) and 0 <= normalized_rate <= 0.5 and len(valid_rates) >= 2


def _three_year_operating_profile_ready(annual: list[Any], archetype: OperatingArchetype) -> bool:
    if len(annual) < 3:
        return False
    recent = annual[-3:]
    margins: list[float] = []
    gross_margins: list[float] = []
    capex_ratios: list[float] = []
    depreciation_ratios: list[float] = []
    for record in recent:
        if not isinstance(record, dict):
            return False
        lines = {name: record.get(name) for name in ("revenue", "ebit", "gross_profit", "capex", "depreciation")}
        if any(not _line_ready(line) for line in lines.values()):
            return False
        revenue = _to_finite_number((lines["revenue"] or {}).get("value"))
        if revenue is None or revenue <= 0:
            return False
        ebit = _to_finite_number((lines["ebit"] or {}).get("value"))
        gross_profit = _to_finite_number((lines["gross_profit"] or {}).get("value"))
        capex = _to_finite_number((lines["capex"] or {}).get("value"))
        depreciation = _to_finite_number((lines["depreciation"] or {}).get("value"))
        if any(value is None for value in (ebit, gross_profit, capex, depreciation)):
            return False
        margins.append(float(ebit) / revenue)
        gross_margins.append(float(gross_profit) / revenue)
        capex_ratios.append(abs(float(capex)) / revenue)
        depreciation_ratios.append(abs(float(depreciation)) / revenue)
    base_margin = sum(margins) / len(margins) if archetype in {"consumer_retail", "standard_operating"} else margins[-1]
    normalized_margin = sum(margins) / len(margins)
    normalized_gross_margin = sum(gross_margins) / len(gross_margins)
    normalized_capex = sum(capex_ratios) / len(capex_ratios)
    normalized_depreciation = sum(depreciation_ratios) / len(depreciation_ratios)
    return bool(
        math.isfinite(base_margin)
        and 0 < base_margin <= 1
        and math.isfinite(normalized_margin)
        and 0 < normalized_margin <= 1
        and math.isfinite(normalized_gross_margin)
        and 0 < normalized_gross_margin <= 1
        and math.isfinite(normalized_capex)
        and 0 <= normalized_capex <= 1
        and math.isfinite(normalized_depreciation)
        and 0 <= normalized_depreciation <= 1
    )


def _debt_cost_ready(annual: list[Any], native_financials: Dict[str, Any]) -> bool:
    if len(annual) < 2:
        return False
    current = annual[-1] if isinstance(annual[-1], dict) else {}
    prior = annual[-2] if isinstance(annual[-2], dict) else {}
    debt_line = current.get("debt")
    prior_debt_line = prior.get("debt")
    debt_value = debt_line.get("value") if isinstance(debt_line, dict) else None
    prior_debt_value = prior_debt_line.get("value") if isinstance(prior_debt_line, dict) else None
    if not _line_ready(debt_line) or not _line_ready(prior_debt_line):
        return False
    if not isinstance(debt_value, (int, float)) or not isinstance(prior_debt_value, (int, float)):
        return False
    if debt_value < 0 or prior_debt_value < 0:
        return False
    if debt_value == 0:
        return True

    interest_line = current.get("interest_expense")
    if _line_ready(interest_line):
        average_debt = (float(prior_debt_value) + float(debt_value)) / 2
        interest_value = interest_line.get("value")
        if average_debt <= 0 or not isinstance(interest_value, (int, float)):
            return False
        cost_of_debt = abs(float(interest_value)) / average_debt
        return math.isfinite(cost_of_debt) and 0.01 <= cost_of_debt <= 0.2

    debt_cost_facts = native_financials.get("issuer_debt_cost_facts")
    if not isinstance(debt_cost_facts, list):
        return False
    year = current.get("year")
    return any(
        isinstance(fact, dict)
        and fact.get("concept") == "IssuerRecentDebtIssueEffectiveRateRangeMidpoint"
        and fact.get("fiscal_year") == year
        and fact.get("unit") == "percent"
        and fact.get("unit_scale") == "percent"
        and isinstance(fact.get("value"), (int, float))
        and 0 < fact["value"] < 20
        and fact.get("accession_number")
        and fact.get("filing_date")
        for fact in debt_cost_facts
    )


def _current_peer_median(
    peers: list[Any],
    *,
    ticker: str,
    market_status: str | None,
    peer_status: str | None,
    peer_source: Any,
    peer_fallback_used: Any,
    peer_fetched_at_ms: Any,
    metric: str,
) -> float | None:
    if (
        peer_status not in {"live", "cached"}
        or peer_fallback_used is True
        or not _current_source(peer_source)
        or not _fresh_timestamp(peer_fetched_at_ms)
        or market_status not in {"live", "cached"}
    ):
        return None
    unique: dict[str, float] = {}
    for peer in peers:
        if not isinstance(peer, dict):
            continue
        candidate_symbol = str(peer.get("ticker") or peer.get("symbol") or "").strip().upper()
        if not candidate_symbol or candidate_symbol == ticker or candidate_symbol in unique:
            continue
        enterprise_value = peer.get("enterpriseValue", peer.get("enterprise_value"))
        denominator = peer.get("ebitda") if metric == "ev_ebitda" else peer.get("revenue")
        multiple = (
            peer.get("evEbitda", peer.get("ev_ebitda"))
            if metric == "ev_ebitda"
            else peer.get("evRevenue", peer.get("ev_revenue"))
        )
        if not all(_positive_number(value) for value in (enterprise_value, denominator, multiple)):
            continue
        calculated_multiple = float(enterprise_value) / float(denominator)
        if not math.isfinite(calculated_multiple) or not 0 < calculated_multiple < 100:
            continue
        if abs(calculated_multiple - float(multiple)) > max(0.25, calculated_multiple * 0.05):
            continue
        unique[candidate_symbol] = calculated_multiple
    if len(unique) < 3:
        return None
    median_values = sorted(unique.values())
    middle = len(median_values) // 2
    median_multiple = median_values[middle] if len(median_values) % 2 else (median_values[middle - 1] + median_values[middle]) / 2
    return median_multiple if math.isfinite(median_multiple) and median_multiple > 0 else None


def _current_peer_multiple_ready(
    peers: list[Any],
    *,
    ticker: str,
    market_status: str | None,
    peer_status: str | None,
    peer_source: Any,
    peer_fallback_used: Any,
    peer_fetched_at_ms: Any,
) -> bool:
    median_multiple = _current_peer_median(
        peers,
        ticker=ticker,
        market_status=market_status,
        peer_status=peer_status,
        peer_source=peer_source,
        peer_fallback_used=peer_fallback_used,
        peer_fetched_at_ms=peer_fetched_at_ms,
        metric="ev_ebitda",
    )
    return median_multiple is not None and 2 <= median_multiple <= 30


def _text(*parts: Any) -> str:
    return " ".join(str(part or "") for part in parts).lower()


def _positive_number(value: Any) -> bool:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return False
    return math.isfinite(parsed) and parsed > 0


def _to_finite_number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _fresh_timestamp(value: Any, max_age_hours: float = 24.0) -> bool:
    try:
        timestamp = float(value)
    except (TypeError, ValueError):
        return False
    now = time.time() * 1000
    age_ms = now - timestamp
    return math.isfinite(timestamp) and timestamp > 0 and 0 <= age_ms <= max_age_hours * 60 * 60 * 1000


def _current_source(value: Any) -> bool:
    source = str(value or "").strip().lower()
    return bool(source) and not any(token in source for token in ("default", "stale", "unavailable"))


def _operating_archetype(profile: Dict[str, Any]) -> OperatingArchetype:
    sector = str(profile.get("sector") or "").strip().lower()
    industry = str(profile.get("industry") or "").strip().lower()
    sic = re.sub(r"\D", "", str(profile.get("sic") or ""))
    description = _text(profile.get("sic_description"), industry, sector)
    sic_code = int(sic) if len(sic) == 4 else 0

    if any(token in description for token in ("biotech", "biotechnology", "biopharmaceutical")) or sic_code == 2836:
        return "biotechnology"
    if any(token in description for token in ("pharma", "pharmaceutical", "drug manufacturer")) or sic_code in {2833, 2834, 2835}:
        return "mature_pharma"
    if any(token in description for token in ("telecom", "wireless carrier", "wireless telecommunication")) or sic_code in {4812, 4813}:
        return "telecommunications"
    # Semiconductor equipment and materials carry the word "materials" in
    # their industry description; resolve them before the energy/materials
    # token below so they are not misrouted to the integrated-energy branch.
    if "semiconductor" in description or sic_code == 3674:
        return "semiconductor"
    if any(token in description for token in ("energy", "oil & gas", "oil and gas", "petroleum", "mining", "coal", "materials")) or 1000 <= sic_code <= 1499 or 2900 <= sic_code <= 2999:
        return "energy_materials"
    if any(token in description for token in ("software", "saas", "application software", "systems software")) or 7370 <= sic_code <= 7379:
        return "subscription_software"
    if "technology" in sector or any(token in description for token in ("hardware", "computer", "consumer electronics")) or 3570 <= sic_code <= 3579 or sic_code == 3661:
        return "technology_hardware"
    if any(token in description for token in ("consumer", "retail", "discount store", "restaurant", "apparel", "hotel", "travel", "automobile")) or 5200 <= sic_code <= 5999:
        return "consumer_retail"
    if any(token in description for token in ("industrial", "manufacturing", "machinery", "aerospace", "heavy equipment", "transportation")) or 3500 <= sic_code <= 3999:
        return "industrial_manufacturing"
    if any(token in description for token in ("healthcare provider", "health care provider", "medical device", "hospital", "healthcare services", "health care services")):
        return "standard_operating"
    if any(token in description for token in ("media", "entertainment", "publishing", "broadcasting", "advertising")) and "communication services" in sector:
        return "standard_operating"
    return "unclassified_operating"


def _blocked_operating_archetype_reason(archetype: OperatingArchetype) -> str:
    return {
        "energy_materials": "Energy and materials model is unavailable until production, reserve, commodity-price, and sustaining-capex schedules are implemented.",
        "telecommunications": "Telecommunications model is unavailable until subscriber, ARPU, churn, and network-capex drivers are implemented.",
        "mature_pharma": "Pharma model is unavailable until product, patent-expiry, and pipeline schedules are implemented.",
        "biotechnology": "Biotech valuation is unavailable until marketed-product, patent-expiry, and risk-adjusted pipeline cash flows are implemented.",
        "unclassified_operating": "No specialist archetype matched this issuer, so the generic operating DCF is offered as a blank-input workbook for analyst completion. No valuation is shown until its inputs are reviewed.",
        "standard_operating": "",
        "technology_hardware": "",
        "subscription_software": "",
        "consumer_retail": "",
        "industrial_manufacturing": "",
        "semiconductor": "",
    }[archetype]


def _comparable_fallback(
    *,
    ticker: str,
    archetype: OperatingArchetype | None,
    company_type: Any,
    canonical_financials: Dict[str, Any],
    market: Dict[str, Any],
    market_status: str | None,
    peers: list[Any],
    peer_status: str | None,
    peer_source: str | None,
    peer_fallback_used: bool | None,
    peer_fetched_at_ms: Any,
    blocked_models: list[Any],
) -> ModelEligibility | None:
    """Market-multiple fallback for issuers whose specialized archetype model
    has no source contract for this issuer.

    Only the trading-multiple route is offered (never a generic DCF for
    production- or product-dependent archetypes), and it uses the same source
    discipline as the standard operating branch: positive filed target metric,
    complete filed equity bridge, live price with filed shares, and a current
    peer record. Fallback-sourced peers leave the route input_required so every
    peer is analyst-confirmed before it enters the median. Returns None when
    even the multiple route cannot be staged, so the caller's original hard
    block stays in place.

    Keep the readiness keys and thresholds in sync with the standard operating
    branch below (the source of truth for the multiple routes).
    """
    annual = canonical_financials.get("annual") if isinstance(canonical_financials, dict) else None
    annual = annual if isinstance(annual, list) else []
    latest_record = annual[-1] if annual and isinstance(annual[-1], dict) else {}
    if not latest_record:
        return None
    shares_ready = bool(
        _line_ready(latest_record.get("shares"))
        and _positive_number((latest_record.get("shares") or {}).get("value"))
    )
    bridge_fields_ready = bool(
        all(
            _line_ready_or_not_applicable(latest_record.get(field))
            for field in ("cash", "marketable_securities", "preferred_equity", "non_controlling_interest")
        )
        and _line_ready(latest_record.get("debt"))
    )
    market_current = bool(
        market_status in {"live", "cached"}
        and market.get("fallback_used") is not True
        and _current_source(market.get("source"))
        and _fresh_timestamp(market.get("fetched_at_ms"))
    )
    peer_ev_ebitda_multiple = _current_peer_median(
        peers,
        ticker=ticker,
        market_status=market_status,
        peer_status=peer_status,
        peer_source=peer_source,
        peer_fallback_used=peer_fallback_used,
        peer_fetched_at_ms=peer_fetched_at_ms,
        metric="ev_ebitda",
    )
    peer_ev_revenue_multiple = _current_peer_median(
        peers,
        ticker=ticker,
        market_status=market_status,
        peer_status=peer_status,
        peer_source=peer_source,
        peer_fallback_used=peer_fallback_used,
        peer_fetched_at_ms=peer_fetched_at_ms,
        metric="ev_revenue",
    )
    readiness: Dict[str, bool] = {
        "filed_diluted_share_count": shares_ready,
        "multiple_positive_filed_ebitda": bool(
            _line_ready(latest_record.get("ebitda"))
            and _positive_number((latest_record.get("ebitda") or {}).get("value"))
        ),
        "multiple_positive_filed_revenue": bool(
            _line_ready(latest_record.get("revenue"))
            and _positive_number((latest_record.get("revenue") or {}).get("value"))
        ),
        "multiple_source_ready_equity_bridge": bridge_fields_ready,
        "multiple_live_price_and_filed_shares": bool(
            market_current and _positive_number(market.get("current_price")) and shares_ready
        ),
        "multiple_three_current_ev_ebitda_peers": bool(
            peer_ev_ebitda_multiple is not None and peer_ev_ebitda_multiple < 100
        ),
        "multiple_three_current_ev_revenue_peers": bool(
            peer_ev_revenue_multiple is not None and peer_ev_revenue_multiple < 50
        ),
    }
    readiness["ev_ebitda_route"] = all(readiness[key] for key in (
        "multiple_positive_filed_ebitda",
        "multiple_source_ready_equity_bridge",
        "multiple_live_price_and_filed_shares",
        "multiple_three_current_ev_ebitda_peers",
    ))
    readiness["revenue_multiple_route"] = all(readiness[key] for key in (
        "multiple_positive_filed_revenue",
        "multiple_source_ready_equity_bridge",
        "multiple_live_price_and_filed_shares",
        "multiple_three_current_ev_revenue_peers",
    ))
    if readiness["ev_ebitda_route"] or readiness["revenue_multiple_route"]:
        preferred = "ev_ebitda" if readiness["ev_ebitda_route"] else "revenue_multiple"
        return ModelEligibility(
            company_type=company_type,
            preferred_model=preferred,
            operating_archetype=archetype,
            required_input_readiness=readiness,
            allowed_models=[preferred],
            blocked_models=blocked_models,
            supported_by_current_engine=True,
        )
    preferred = "ev_ebitda" if readiness["multiple_positive_filed_ebitda"] else "revenue_multiple"
    target_ready = (
        readiness["multiple_positive_filed_ebitda"]
        if preferred == "ev_ebitda"
        else readiness["multiple_positive_filed_revenue"]
    )
    # Mirror the standard operating branch: a positive filed target metric is
    # enough to surface the route as input_required, so bridge or price gaps
    # render as named requirements instead of an opaque unsupported block.
    if target_ready:
        return ModelEligibility(
            company_type=company_type,
            preferred_model=preferred,
            operating_archetype=archetype,
            required_input_readiness=readiness,
            allowed_models=[preferred],
            blocked_models=blocked_models,
            supported_by_current_engine=False,
        )
    return None


def _telecom_history_ready(annual: list[Any], field: str, *, strictly_positive: bool = False) -> bool:
    if len(annual) < 3:
        return False
    recent = annual[-3:]
    years = [_to_finite_number(record.get("year")) if isinstance(record, dict) else None for record in recent]
    if any(year is None or not float(year).is_integer() for year in years):
        return False
    if any(int(years[index]) != int(years[index - 1]) + 1 for index in range(1, len(years))):
        return False
    for record in recent:
        telecom = record.get("telecom") if isinstance(record, dict) else None
        line = telecom.get(field) if isinstance(telecom, dict) else None
        value = _to_finite_number(line.get("value")) if isinstance(line, dict) else None
        if not _line_ready(line) or value is None or (strictly_positive and value <= 0):
            return False
    return True


def _telecom_reconciliation_ready(annual: list[Any]) -> bool:
    if len(annual) < 3:
        return False
    for record in annual[-3:]:
        if not isinstance(record, dict):
            return False
        telecom = record.get("telecom")
        if not isinstance(telecom, dict):
            return False
        values: dict[str, float] = {}
        for field in (
            "mobility_revenue", "mobility_service_revenue", "mobility_equipment_revenue",
            "business_wireline_revenue", "consumer_wireline_revenue", "latin_america_revenue",
            "communications_revenue", "mobility_operating_income", "business_wireline_operating_income",
            "consumer_wireline_operating_income", "communications_operating_income", "latin_america_operating_income",
        ):
            line = telecom.get(field)
            value = _to_finite_number(line.get("value")) if isinstance(line, dict) else None
            if not _line_ready(line) or value is None:
                return False
            values[field] = value
        revenue = _to_finite_number((record.get("revenue") or {}).get("value"))
        total_wireless = _to_finite_number((telecom.get("wireless_subscribers") or {}).get("value"))
        postpaid_phone = _to_finite_number((telecom.get("postpaid_phone_subscribers") or {}).get("value"))
        if revenue is None or total_wireless is None or postpaid_phone is None or revenue <= 0 or total_wireless <= postpaid_phone:
            return False
        if abs(values["mobility_revenue"] - values["mobility_service_revenue"] - values["mobility_equipment_revenue"]) > max(1.0, values["mobility_revenue"] * 1e-7):
            return False
        communication_revenue = values["mobility_revenue"] + values["business_wireline_revenue"] + values["consumer_wireline_revenue"]
        if abs(values["communications_revenue"] - communication_revenue) > max(1.0, values["communications_revenue"] * 1e-7):
            return False
        communication_income = values["mobility_operating_income"] + values["business_wireline_operating_income"] + values["consumer_wireline_operating_income"]
        if abs(values["communications_operating_income"] - communication_income) > max(1.0, abs(values["communications_operating_income"]) * 1e-7):
            return False
        segment_revenue = communication_revenue + values["latin_america_revenue"]
        if segment_revenue > revenue or revenue - segment_revenue > max(1.0, revenue * 0.01):
            return False
    return True


def _life_insurance_source_contract_ready(native_financials: Dict[str, Any] | None) -> bool:
    from .life_contract import resolve_life_source_contract
    if not isinstance(native_financials, dict):
        return False
    facts = native_financials.get("life_insurance_filing_facts")
    if not isinstance(facts, list):
        return False
    contract = resolve_life_source_contract(facts)
    if contract is None:
        return False
    annual = [fact for fact in facts if isinstance(fact, dict) and fact.get("metric") == contract["earningsMetric"]]
    for fact in annual:
        if (
            not isinstance(fact.get("value"), (int, float))
            or not math.isfinite(float(fact["value"]))
            or fact.get("unit") != "USD"
            or fact.get("unit_scale") != "millions"
            or fact.get("earnings_basis") != contract["earningsBasis"]
            or fact.get("form") not in {"10-K", "10-K/A"}
            or not fact.get("accession_number")
            or not fact.get("filing_date")
            or not fact.get("source_statement")
        ):
            return False
    return True


def classify_company(
    profile: Dict[str, Any] | None,
    canonical_financials: Dict[str, Any] | None = None,
    market: Dict[str, Any] | None = None,
    valuation_context: Dict[str, Any] | None = None,
    *,
    market_status: str | None = None,
    valuation_status: str | None = None,
    native_financials: Dict[str, Any] | None = None,
    peers: list[Any] | None = None,
    peer_status: str | None = None,
    peer_source: str | None = None,
    peer_fallback_used: bool | None = None,
    peer_fetched_at_ms: Any = None,
) -> ModelEligibility:
    profile = profile or {}
    canonical_financials = canonical_financials or {}
    market = market or {}
    valuation_context = valuation_context or {}
    native_financials = native_financials or {}
    peers = peers or []
    ticker = str(profile.get("ticker") or "").upper()
    text = _text(profile.get("sector"), profile.get("industry"), profile.get("sic"), profile.get("sic_description"))
    sic_code = int(re.sub(r"\D", "", str(profile.get("sic") or "")) or 0)
    latest = canonical_financials.get("latest") or {}
    metadata = canonical_financials.get("metadata") or {}

    revenue = float((latest.get("revenue") or {}).get("value") or 0)
    ebit = float((latest.get("ebit") or {}).get("value") or 0)
    debt = float((latest.get("debt") or {}).get("value") or 0)
    book_value = float((latest.get("book_value") or {}).get("value") or 0)
    debt_to_book = debt / book_value if book_value > 0 else 0

    if any(token in text for token in ("insurance", "reinsurance", "property casualty", "life insurance", "casualty insurance")):
        insurance_history = latest.get("insurance") if isinstance(latest.get("insurance"), dict) else {}
        is_pc_insurer = _line_ready(insurance_history.get("combined_ratio")) and _line_ready(insurance_history.get("net_premiums_written"))
        if is_pc_insurer:
            subtype = "pc_insurer"
        elif any(token in text for token in ("reinsurance", "reinsurer")):
            subtype = "reinsurer"
        elif any(token in text for token in ("life insurance", "life insurer", "annuity")) or sic_code in {6311, 6321, 6324}:
            subtype = "life_insurer"
        else:
            subtype = "other_insurer"
        readiness = {
            field: _line_ready(insurance_history.get(field))
            for field in _REQUIRED_PC_INSURANCE_INPUTS
        }
        readiness["live_market_price"] = bool(
            market_status in {"live", "cached"}
            and _positive_number(market.get("current_price"))
            and market.get("fallback_used") is not True
            and _current_source(market.get("source"))
            and _fresh_timestamp(market.get("fetched_at_ms"))
        )
        readiness["live_market_beta"] = bool(
            market_status in {"live", "cached"}
            and _positive_number(market.get("beta"))
            and market.get("fallback_used") is not True
            and _current_source(market.get("source"))
            and _fresh_timestamp(market.get("fetched_at_ms"))
        )
        readiness["live_risk_free_rate"] = bool(
            valuation_status in {"live", "cached"}
            and _positive_number(valuation_context.get("risk_free_rate"))
            and _current_source(valuation_context.get("treasury_rate_source"))
            and _fresh_timestamp(valuation_context.get("fetched_at_ms"))
        )
        readiness["live_equity_risk_premium"] = bool(
            valuation_status in {"live", "cached"}
            and _positive_number(valuation_context.get("equity_risk_premium"))
            and _current_source(valuation_context.get("erp_source"))
            and _fresh_timestamp(valuation_context.get("fetched_at_ms"))
        )
        readiness["dated_market_context"] = bool(
            re.fullmatch(r"20\d{2}-\d{2}-\d{2}", str(valuation_context.get("as_of_date") or ""))
        )
        if subtype == "life_insurer":
            life_source_ready = _life_insurance_source_contract_ready(native_financials)
            from .life_contract import resolve_life_source_contract as _resolve_life_contract
            _life_contract = _resolve_life_contract((native_financials or {}).get("life_insurance_filing_facts") if isinstance(native_financials, dict) else [])
            filed_shares_ready = _line_ready(latest.get("shares"))
            readiness = {
                "life_insurance_segment_earnings": life_source_ready,
                "life_insurance_statutory_source_facts": life_source_ready,
                "filed_diluted_shares": filed_shares_ready,
                "live_market_price": readiness["live_market_price"],
                "live_market_beta": readiness["live_market_beta"],
                "live_risk_free_rate": readiness["live_risk_free_rate"],
                "live_equity_risk_premium": readiness["live_equity_risk_premium"],
                "dated_market_context": readiness["dated_market_context"],
            }
            if not life_source_ready:
                return ModelEligibility(
                    company_type="insurance",
                    preferred_model="residual_income",
                    subtype=subtype,
                    status="unsupported",
                    model_route_available=False,
                    missing_input_gaps=[],
                    required_input_readiness=readiness,
                    allowed_models=[],
                    blocked_models=[BlockedModel(
                        model="residual_income",
                        reason=f"Life-insurance source contract is not mapped or complete for {ticker}.",
                    )],
                    supported_by_current_engine=False,
                )
            missing_inputs = [
                ModelReadinessGap(
                    key="life_insurance_earnings_forecast",
                    label="Five-year life-insurance segment earnings forecasts",
                    reason="Forecast the issuer's reported earnings measure by segment with a source or analyst rationale.",
                ),
                ModelReadinessGap(
                    key="life_insurance_capital_schedule",
                    label="Statutory capital retention and release schedule",
                    reason="Enter capital additions or releases by disclosed capital group; an RBC floor is not an exact capital balance.",
                ),
                ModelReadinessGap(
                    key="life_insurance_upstream_distribution",
                    label="Permitted upstream dividend capacity",
                    reason="Enter source-backed distribution capacity by legal entity or jurisdiction for each forecast year.",
                ),
                ModelReadinessGap(
                    key="life_insurance_parent_cash_bridge",
                    label="Holding-company cash reserve and claims",
                    reason="Enter parent-company cash above reserve and parent debt or senior claims with dated source references.",
                ),
                ModelReadinessGap(
                    key="terminal_growth_rate",
                    label="Terminal distributable-earnings growth",
                    reason="Enter terminal growth below the cost of equity and document the source or valuation rationale.",
                ),
            ]
            if _life_contract is not None and bool(_life_contract.get("requiresNormalizedTax")):
                missing_inputs.append(ModelReadinessGap(
                    key="life_insurance_tax_conversion",
                    label="Normalized tax rate for pre-tax adjusted operating income",
                    reason="The source earnings measure is before income taxes; enter a dated source or analyst tax assumption.",
                ))
            if not all(readiness[key] for key in ("live_risk_free_rate", "live_equity_risk_premium", "live_market_beta")):
                missing_inputs.append(ModelReadinessGap(
                    key="company_discount_rate_inputs",
                    label="Current cost-of-equity inputs",
                    reason="A dated current risk-free rate, equity-risk premium, and beta are required for CAPM.",
                ))
            if not readiness["live_market_price"]:
                missing_inputs.append(ModelReadinessGap(
                    key="live_current_share_price",
                    label="Current common share price",
                    reason="A dated current common share price is required for the equity bridge and per-share comparison.",
                ))
            if not readiness["filed_diluted_shares"]:
                missing_inputs.append(ModelReadinessGap(
                    key="life_diluted_shares",
                    label="Latest filed diluted share count",
                    reason="Use the latest filed diluted weighted-average common share count and retain its SEC source.",
                ))
            return ModelEligibility(
                company_type="insurance",
                preferred_model="life_insurer_distributable_earnings_dcf",
                subtype=subtype,
                status="input_required",
                model_route_available=True,
                missing_input_gaps=missing_inputs,
                required_input_readiness=readiness,
                allowed_models=["life_insurer_distributable_earnings_dcf"],
                blocked_models=[],
                supported_by_current_engine=False,
            )
        missing = [field for field, ready in readiness.items() if not ready]
        if subtype == "life_insurer":
            reason = "Life-insurance valuation is blocked because the current SEC feed lacks a source-ready RBC/required-capital schedule, policy-obligation rollforwards, and distributable-earnings inputs."
        elif subtype != "pc_insurer":
            reason = "Insurance model is unavailable until its premium, reserve, capital, and valuation schedules are complete."
        elif missing:
            reason = "P&C insurance model is blocked because filed drivers are incomplete: " + ", ".join(missing) + "."
        else:
            reason = ""
        eligible = subtype == "pc_insurer" and not missing
        return ModelEligibility(
            company_type="insurance",
            preferred_model="insurance_pnc_residual_income" if subtype == "pc_insurer" else "residual_income",
            subtype=subtype,
            required_input_readiness=readiness,
            allowed_models=["insurance_pnc_residual_income"] if eligible else [],
            blocked_models=[] if eligible else [
                BlockedModel(
                    model="insurance_pnc_residual_income" if subtype == "pc_insurer" else "residual_income",
                    reason=reason,
                ),
                BlockedModel(model="unlevered_dcf", reason="Insurance valuation should be book-value and ROE based."),
            ],
            supported_by_current_engine=eligible,
        )

    industry = _text(profile.get("industry"))
    manager_facts = native_financials.get("asset_management_filing_facts")
    manager_facts = manager_facts if isinstance(manager_facts, list) else []
    has_filed_aum_fact = any(
        isinstance(fact, dict)
        and str(fact.get("concept") or "").split(":")[-1] == "AssetManagerAum"
        and _positive_number(fact.get("value"))
        and fact.get("accession_number")
        and fact.get("filing_date")
        for fact in manager_facts
    )
    is_asset_manager_candidate = "asset management" in industry or has_filed_aum_fact
    if is_asset_manager_candidate:
        issuer_description = _text(profile.get("name"), profile.get("industry"), profile.get("sic_description"))
        is_alternative_manager = any(
            term in issuer_description for term in _ALTERNATIVE_ASSET_MANAGER_TERMS
        )
        subtype = "alternative_asset_manager" if is_alternative_manager else "traditional_asset_manager"
        annual = canonical_financials.get("annual") if isinstance(canonical_financials.get("annual"), list) else []
        readiness = {
            "three_consecutive_filed_aum_years": _asset_manager_history_ready(
                annual, "aum", strictly_positive=True,
            ),
            "three_consecutive_reconciled_fee_revenues": _asset_manager_revenue_history_ready(annual),
            "three_consecutive_filed_net_flow_years": _asset_manager_history_ready(
                annual, "net_flows", strictly_positive=False, allow_negative=True,
            ),
            "three_consecutive_filed_market_change_years": _asset_manager_history_ready(
                annual, "market_change", strictly_positive=False, allow_negative=True,
            ),
            "three_consecutive_filed_working_capital_change_years": _asset_manager_history_ready(
                annual, "working_capital_change", strictly_positive=False, allow_negative=True,
            ),
            "three_consecutive_reconciled_aum_rollforwards": _asset_manager_rollforward_history_ready(annual),
            "three_consecutive_filed_base_fee_years": _asset_manager_history_ready(
                annual, "base_fees", strictly_positive=True,
            ),
            "three_consecutive_filed_performance_fee_years": _asset_manager_history_ready(
                annual, "performance_fees", strictly_positive=False,
            ),
            "three_consecutive_average_aum_base_fee_yields": _asset_manager_history_ready(
                annual, "base_fee_yield", strictly_positive=True,
            ),
        }
        recent_operating_inputs = annual[-3:]
        readiness["three_consecutive_filed_operating_cashflow_inputs"] = len(recent_operating_inputs) == 3 and all(
            isinstance(record, dict)
            and all(_line_ready(record.get(field)) for field in ("revenue", "ebit", "tax_rate", "capex"))
            and isinstance(record.get("asset_manager"), dict)
            and _line_ready(record["asset_manager"].get("depreciation"))
            and _line_ready(record["asset_manager"].get("working_capital_change"))
            for record in recent_operating_inputs
        )

        def bridge_input_value(field: str) -> float | None:
            line = latest.get(field)
            if not _line_ready_or_not_applicable(line):
                return None
            if isinstance(line, dict) and line.get("source") == "not_applicable":
                return 0.0
            return _to_finite_number(line.get("value")) if isinstance(line, dict) else None

        cash = bridge_input_value("cash")
        marketable_securities = bridge_input_value("marketable_securities")
        debt_value = bridge_input_value("debt")
        non_controlling_interest = bridge_input_value("non_controlling_interest")
        preferred_equity = bridge_input_value("preferred_equity")
        diluted_shares = _to_finite_number((latest.get("shares") or {}).get("value")) if isinstance(latest.get("shares"), dict) else None
        readiness["source_ready_current_equity_bridge"] = bool(
            all(value is not None and value >= 0 for value in (
                cash, marketable_securities, debt_value, non_controlling_interest, preferred_equity,
            ))
            and _line_ready(latest.get("shares"))
            and diluted_shares is not None
            and diluted_shares > 0
        )
        readiness["production_calculation_and_workbook_route"] = "asset_manager_aum_dcf" in PRODUCTION_MODEL_ROUTES
        readiness["live_market_price"] = bool(
            market_status in {"live", "cached"}
            and _positive_number(market.get("current_price"))
            and market.get("fallback_used") is not True
            and _current_source(market.get("source"))
            and _fresh_timestamp(market.get("fetched_at_ms"))
        )
        readiness["live_market_capitalization"] = bool(
            market_status in {"live", "cached"}
            and _positive_number(market.get("market_cap"))
            and market.get("fallback_used") is not True
            and _current_source(market.get("source"))
            and _fresh_timestamp(market.get("fetched_at_ms"))
        )
        readiness["live_market_beta"] = bool(
            market_status in {"live", "cached"}
            and _positive_number(market.get("beta"))
            and 0.2 <= float(market.get("beta")) <= 3.0
            and market.get("fallback_used") is not True
            and _current_source(market.get("source"))
            and _fresh_timestamp(market.get("fetched_at_ms"))
        )
        readiness["live_risk_free_rate"] = bool(
            valuation_status in {"live", "cached"}
            and _positive_number(valuation_context.get("risk_free_rate"))
            and float(valuation_context.get("risk_free_rate")) <= 0.15
            and _current_source(valuation_context.get("treasury_rate_source"))
            and _fresh_timestamp(valuation_context.get("fetched_at_ms"))
        )
        readiness["live_equity_risk_premium"] = bool(
            valuation_status in {"live", "cached"}
            and _positive_number(valuation_context.get("equity_risk_premium"))
            and 0.02 <= float(valuation_context.get("equity_risk_premium")) <= 0.15
            and _current_source(valuation_context.get("erp_source"))
            and _fresh_timestamp(valuation_context.get("fetched_at_ms"))
        )
        readiness["dated_market_context"] = bool(
            re.fullmatch(r"20\d{2}-\d{2}-\d{2}", str(valuation_context.get("as_of_date") or ""))
        )

        if subtype == "alternative_asset_manager":
            readiness["dedicated_alternative_manager_economics_model"] = False
            route_reason = (
                "Alternative asset-manager valuation is unavailable until fee-related earnings, carried interest, "
                "principal investments, and GP commitments have a dedicated forecast and workbook."
            )
            eligible = False
        else:
            required_readiness = (
                "three_consecutive_filed_aum_years",
                "three_consecutive_reconciled_fee_revenues",
                "three_consecutive_filed_net_flow_years",
                "three_consecutive_filed_market_change_years",
                "three_consecutive_filed_working_capital_change_years",
                "three_consecutive_reconciled_aum_rollforwards",
                "three_consecutive_filed_base_fee_years",
                "three_consecutive_filed_performance_fee_years",
                "three_consecutive_average_aum_base_fee_yields",
                "three_consecutive_filed_operating_cashflow_inputs",
                "source_ready_current_equity_bridge",
                "live_market_price",
                "live_market_capitalization",
                "live_market_beta",
                "live_risk_free_rate",
                "live_equity_risk_premium",
                "dated_market_context",
                "production_calculation_and_workbook_route",
            )
            missing = [field for field in required_readiness if not readiness.get(field, False)]
            eligible = not missing
            route_reason = (
                "Traditional asset-manager model is blocked because required filed or current inputs are incomplete: "
                + ", ".join(missing) + "."
                if missing else ""
            )
        blocked_models = [] if eligible else [BlockedModel(model="asset_manager_aum_dcf", reason=route_reason)]
        blocked_models.append(BlockedModel(
            model="unlevered_dcf",
            reason="An operating-company DCF is not a validated substitute for asset-manager AUM and fee economics.",
        ))
        return ModelEligibility(
            company_type="asset_manager",
            preferred_model="asset_manager_aum_dcf",
            subtype=subtype,
            required_input_readiness=readiness,
            allowed_models=["asset_manager_aum_dcf"] if eligible else [],
            blocked_models=blocked_models,
            supported_by_current_engine=eligible,
        )

    if metadata.get("is_financial_institution") or any(token in text for token in ("bank", "depository", "commercial banks", "savings institution", "credit services")):
        investment_bank = any(token in text for token in (
            "investment bank", "investment banking", "capital markets", "security brokers",
            "securities brokers", "broker-dealer", "broker dealer", "investment services",
        ))
        has_deposits = isinstance((latest.get("bank") or {}).get("deposits"), dict) and (latest.get("bank") or {}).get("deposits", {}).get("value") is not None
        subtype = "investment_bank" if investment_bank else "commercial_bank" if has_deposits or any(
            token in text for token in ("commercial bank", "commercial banking", "national bank", "regional bank", "money center")
        ) else "other_financial"
        bank_history = latest.get("bank") if isinstance(latest.get("bank"), dict) else {}
        readiness: Dict[str, bool] = {}
        for field in _REQUIRED_BANK_INPUTS:
            line = bank_history.get(field)
            sources = line.get("sources") if isinstance(line, dict) else None
            readiness[field] = bool(
                isinstance(line, dict)
                and line.get("source") in {"sec_native", "derived"}
                and isinstance(line.get("value"), (int, float))
                and math.isfinite(float(line["value"]))
                and isinstance(sources, list)
                and len(sources) > 0
                and all(
                    isinstance(source, dict)
                    and source.get("accession")
                    and source.get("filed")
                    for source in sources
                )
            )
        readiness["live_market_price"] = bool(
            market_status in {"live", "cached"}
            and _positive_number(market.get("current_price"))
            and market.get("fallback_used") is not True
            and _current_source(market.get("source"))
            and _fresh_timestamp(market.get("fetched_at_ms"))
        )
        readiness["live_market_beta"] = bool(
            market_status in {"live", "cached"}
            and _positive_number(market.get("beta"))
            and market.get("fallback_used") is not True
            and _current_source(market.get("source"))
            and _fresh_timestamp(market.get("fetched_at_ms"))
        )
        readiness["live_risk_free_rate"] = bool(
            valuation_status in {"live", "cached"}
            and _positive_number(valuation_context.get("risk_free_rate"))
            and _current_source(valuation_context.get("treasury_rate_source"))
            and _fresh_timestamp(valuation_context.get("fetched_at_ms"))
        )
        readiness["live_equity_risk_premium"] = bool(
            valuation_status in {"live", "cached"}
            and _positive_number(valuation_context.get("equity_risk_premium"))
            and _current_source(valuation_context.get("erp_source"))
            and _fresh_timestamp(valuation_context.get("fetched_at_ms"))
        )
        readiness["dated_market_context"] = bool(
            re.fullmatch(r"20\d{2}-\d{2}-\d{2}", str(valuation_context.get("as_of_date") or ""))
        )
        if subtype == "investment_bank":
            blocked_reason = "Investment-bank valuation is unsupported; the commercial-bank operating and capital model does not apply to broker-dealers."
        elif subtype != "commercial_bank":
            blocked_reason = "This financial-institution subtype is unsupported by the commercial-bank model."
        else:
            missing_inputs = [name for name, ready in readiness.items() if not ready]
            blocked_reason = "Commercial bank model is blocked because required filed or live inputs are incomplete: " + ", ".join(missing_inputs) + "." if missing_inputs else ""
        if subtype == "other_financial":
            # Payment networks and credit-services issuers are operating
            # companies at their core; when the commercial-bank model's inputs
            # do not apply, a source-backed trading multiple is still honest.
            fallback = _comparable_fallback(
                ticker=ticker,
                archetype=None,
                company_type="operating",
                canonical_financials=canonical_financials,
                market=market,
                market_status=market_status,
                peers=peers,
                peer_status=peer_status,
                peer_source=peer_source,
                peer_fallback_used=peer_fallback_used,
                peer_fetched_at_ms=peer_fetched_at_ms,
                blocked_models=[
                    BlockedModel(model="bank_residual_income", reason=blocked_reason),
                    BlockedModel(model="unlevered_dcf", reason="Bank debt is operating capital; FCFF enterprise-value DCF is not appropriate."),
                ],
            )
            if fallback is not None:
                return fallback
        return ModelEligibility(
            company_type="bank",
            preferred_model="bank_residual_income",
            subtype=subtype,
            required_input_readiness=readiness,
            allowed_models=["bank_residual_income"] if subtype == "commercial_bank" and not missing_inputs else [],
            blocked_models=[] if subtype == "commercial_bank" and not missing_inputs else [
                BlockedModel(model="bank_residual_income", reason=blocked_reason),
                BlockedModel(model="unlevered_dcf", reason="Bank debt is operating capital; FCFF enterprise-value DCF is not appropriate."),
            ],
            supported_by_current_engine=subtype == "commercial_bank" and not missing_inputs,
        )

    if any(token in text for token in ("reit", "real estate investment trust")):
        mortgage_reit = any(token in text for token in ("mortgage", "agency mbs", "mortgage-backed"))
        subtype = "mortgage_reit" if mortgage_reit else "equity_reit"
        annual = canonical_financials.get("annual") if isinstance(canonical_financials.get("annual"), list) else []
        if mortgage_reit:
            history = annual[-3:]
            opening = annual[-4] if len(annual) >= 4 and isinstance(annual[-4], dict) else {}
            latest_mortgage = latest.get("mortgage_reit") if isinstance(latest.get("mortgage_reit"), dict) else {}
            mortgage_history = [
                row.get("mortgage_reit") if isinstance(row, dict) and isinstance(row.get("mortgage_reit"), dict) else {}
                for row in history
            ]
            core_history_fields = (
                "average_investment_securities_at_cost", "average_tba_dollar_roll_position_at_cost",
                "average_mortgage_borrowings", "average_stockholders_equity", "average_asset_yield",
                "average_aggregate_cost_of_funds", "average_net_interest_spread", "economic_interest_income",
                "economic_interest_expense", "operating_expenses", "preferred_dividends",
                "net_income_available_to_common", "tangible_book_value_per_common_share",
                "net_book_value_per_common_share", "preferred_equity_liquidation_preference",
                "common_dividends_per_share", "period_end_common_shares", "average_at_risk_leverage",
                "average_swap_notional", "average_swap_ratio", "average_swap_net_pay_rate", "expenses_pct_average_assets",
            )
            readiness: dict[str, bool] = {
                f"three_year_{field}": len(history) == 3 and all(_line_ready(row.get(field)) for row in mortgage_history)
                for field in core_history_fields
            }
            opening_reit = opening.get("mortgage_reit") if isinstance(opening.get("mortgage_reit"), dict) else {}
            readiness["opening_tangible_book_value"] = bool(
                len(annual) >= 4 and _line_ready(opening_reit.get("tangible_book_value_per_common_share"))
            )
            readiness["three_year_filed_diluted_shares"] = len(history) == 3 and all(
                isinstance(row, dict) and _line_ready(row.get("shares")) for row in history
            )
            for field in (
                "investment_securities_fair_value", "total_assets", "repo_and_other_debt",
                "total_liabilities", "total_stockholders_equity",
            ):
                readiness[f"latest_{field}"] = _line_ready(latest_mortgage.get(field))
            for field in ("cash", "debt"):
                readiness[f"filed_{field}"] = _line_ready(latest.get(field))
            readiness["usd_reporting_currency"] = str(canonical_financials.get("currency") or "").upper() == "USD"
            readiness["agency_mreit_source_contract"] = all(
                readiness.get(f"three_year_{field}") is True for field in core_history_fields
            )
            readiness["live_market_price"] = bool(
                market_status in {"live", "cached"}
                and _positive_number(market.get("current_price"))
                and market.get("fallback_used") is not True
                and _current_source(market.get("source"))
                and _fresh_timestamp(market.get("fetched_at_ms"))
            )
            readiness["live_market_beta"] = bool(
                market_status in {"live", "cached"}
                and _positive_number(market.get("beta"))
                and market.get("fallback_used") is not True
                and _current_source(market.get("source"))
                and _fresh_timestamp(market.get("fetched_at_ms"))
            )
            readiness["live_risk_free_rate"] = bool(
                valuation_status in {"live", "cached"}
                and _positive_number(valuation_context.get("risk_free_rate"))
                and _current_source(valuation_context.get("treasury_rate_source"))
                and _fresh_timestamp(valuation_context.get("fetched_at_ms"))
            )
            readiness["live_equity_risk_premium"] = bool(
                valuation_status in {"live", "cached"}
                and _positive_number(valuation_context.get("equity_risk_premium"))
                and _current_source(valuation_context.get("erp_source"))
                and _fresh_timestamp(valuation_context.get("fetched_at_ms"))
            )
            readiness["dated_market_context"] = bool(
                re.fullmatch(r"20\d{2}-\d{2}-\d{2}", str(valuation_context.get("as_of_date") or ""))
            )
            readiness["mortgage_reit_residual_income_route"] = (
                "mortgage_reit_residual_income" in PRODUCTION_MODEL_ROUTES
                and all(value for name, value in readiness.items() if name != "mortgage_reit_residual_income_route")
            )
            missing = [name for name, ready in readiness.items() if not ready]
            eligible = not missing
            if missing:
                reason = "Mortgage REIT model is blocked because required source data or production routes are incomplete: " + ", ".join(missing) + "."
            else:
                reason = ""
            return ModelEligibility(
                company_type="reit",
                preferred_model="mortgage_reit_residual_income",
                subtype=subtype,
                required_input_readiness=readiness,
                allowed_models=["mortgage_reit_residual_income"] if eligible else [],
                blocked_models=[] if eligible else [
                    BlockedModel(model="mortgage_reit_residual_income", reason=reason),
                    BlockedModel(model="unlevered_dcf", reason="Mortgage REIT leverage, hedging, and equity book-value economics are not modeled by a corporate FCFF DCF."),
                ],
                supported_by_current_engine=eligible,
            )
        recent_years = annual[-3:]
        latest_reit = latest.get("reit") if isinstance(latest.get("reit"), dict) else {}
        reit_history_fields = (
            "nareit_ffo", "core_ffo", "recurring_capex", "analyst_affo",
            "same_store_noi_net_effective", "real_estate_segment_noi",
        )
        readiness = {
            f"three_year_{field}": len(recent_years) == 3 and all(
                isinstance(annual_record, dict)
                and _line_ready((annual_record.get("reit") or {}).get(field))
                for annual_record in recent_years
            )
            for field in reit_history_fields
        }
        for field in ("occupancy", "common_distributions"):
            readiness[field] = _line_ready(latest_reit.get(field))
        for field in ("long_term_debt", "cash", "book_value", "preferred_equity", "non_controlling_interest", "shares"):
            readiness[field] = _line_ready(latest.get(field))
        readiness["live_market_price"] = bool(
            market_status in {"live", "cached"}
            and _positive_number(market.get("current_price"))
            and market.get("fallback_used") is not True
            and _current_source(market.get("source"))
            and _fresh_timestamp(market.get("fetched_at_ms"))
        )
        readiness["live_market_beta"] = bool(
            market_status in {"live", "cached"}
            and _positive_number(market.get("beta"))
            and market.get("fallback_used") is not True
            and _current_source(market.get("source"))
            and _fresh_timestamp(market.get("fetched_at_ms"))
        )
        readiness["live_market_capitalization"] = bool(
            market_status in {"live", "cached"}
            and _positive_number(market.get("market_cap"))
            and market.get("fallback_used") is not True
            and _current_source(market.get("source"))
            and _fresh_timestamp(market.get("fetched_at_ms"))
        )
        readiness["live_risk_free_rate"] = bool(
            valuation_status in {"live", "cached"}
            and _positive_number(valuation_context.get("risk_free_rate"))
            and _current_source(valuation_context.get("treasury_rate_source"))
            and _fresh_timestamp(valuation_context.get("fetched_at_ms"))
        )
        readiness["live_equity_risk_premium"] = bool(
            valuation_status in {"live", "cached"}
            and _positive_number(valuation_context.get("equity_risk_premium"))
            and _current_source(valuation_context.get("erp_source"))
            and _fresh_timestamp(valuation_context.get("fetched_at_ms"))
        )
        readiness["dated_market_context"] = bool(
            re.fullmatch(r"20\d{2}-\d{2}-\d{2}", str(valuation_context.get("as_of_date") or ""))
        )
        missing = [name for name, ready in readiness.items() if not ready]
        if mortgage_reit:
            reason = "Mortgage REIT valuation is unsupported until its agency MBS, repo funding, and book-value schedules are implemented."
        elif missing:
            reason = "Equity REIT model is blocked because filed property, FFO/AFFO, balance-sheet, or live-market inputs are incomplete: " + ", ".join(missing) + "."
        else:
            reason = ""
        eligible = subtype == "equity_reit" and not missing
        return ModelEligibility(
            company_type="reit",
            preferred_model="reit_affo",
            subtype=subtype,
            required_input_readiness=readiness,
            allowed_models=["reit_affo"] if eligible else [],
            blocked_models=[] if eligible else [
                BlockedModel(
                    model="reit_affo",
                    reason=reason,
                ),
                BlockedModel(model="unlevered_dcf", reason="REIT depreciation and FFO/AFFO economics make generic FCFF unreliable."),
            ],
            supported_by_current_engine=eligible,
        )

    if any(token in text for token in ("electric", "utility", "utilities", "gas utility", "water utility", "regulated")):
        mixed_utility = any(token in text for token in ("merchant utility", "unregulated generation"))
        subtype = "mixed_utility" if mixed_utility else "regulated_utility"
        readiness = {
            "jurisdictional_rate_base": False,
            "authorized_return_on_equity": False,
            "authorized_equity_ratio": False,
            "approved_rate_base_additions": False,
            "rate_base_depreciation": False,
            "dividend_payout_ratio": False,
            "terminal_growth_rate": False,
            "current_share_price": bool(
                market_status in {"live", "cached"}
                and _positive_number(market.get("current_price"))
                and market.get("fallback_used") is not True
                and _current_source(market.get("source"))
                and _fresh_timestamp(market.get("fetched_at_ms"))
            ),
            "filed_diluted_shares": bool(
                _line_ready(latest.get("shares"))
                and _positive_number((latest.get("shares") or {}).get("value"))
            ),
            "current_risk_free_rate": bool(
                valuation_status in {"live", "cached"}
                and _positive_number(valuation_context.get("risk_free_rate"))
                and _current_source(valuation_context.get("treasury_rate_source"))
                and _fresh_timestamp(valuation_context.get("fetched_at_ms"))
            ),
            "current_equity_risk_premium": bool(
                valuation_status in {"live", "cached"}
                and _positive_number(valuation_context.get("equity_risk_premium"))
                and _current_source(valuation_context.get("erp_source"))
                and _fresh_timestamp(valuation_context.get("fetched_at_ms"))
            ),
            "current_beta": bool(
                market_status in {"live", "cached"}
                and _positive_number(market.get("beta"))
                and market.get("fallback_used") is not True
                and _current_source(market.get("source"))
                and _fresh_timestamp(market.get("fetched_at_ms"))
            ),
            "regulated_and_unregulated_segments_separated": False if mixed_utility else True,
        }
        if mixed_utility:
            reason = "Mixed utility model is blocked until regulated and unregulated earnings, rate base, and capital flows are separated."
        else:
            reason = "Regulated utility valuation needs source-backed jurisdictional rate base, allowed ROE, authorized equity ratio, and approved rate-base additions. Enter the missing regulatory facts and forecast inputs in the utility workbook."
        utility_route_available = "utility_dcf" in PRODUCTION_MODEL_ROUTES
        return ModelEligibility(
            company_type="utility",
            preferred_model="utility_dcf",
            subtype=subtype,
            required_input_readiness=readiness,
            status="input_required" if utility_route_available else "unsupported",
            model_route_available=utility_route_available,
            missing_input_gaps=(
                [
                    {"key": key, "label": " ".join(part.capitalize() for part in key.split("_")), "reason": reason}
                    for key, ready in readiness.items() if ready is False
                ]
                if utility_route_available else []
            ),
            allowed_models=["utility_dcf"] if utility_route_available else [],
            blocked_models=(
                [BlockedModel(model="unlevered_dcf", reason="Regulated utilities require a rate-base and common-equity valuation.")]
                if utility_route_available
                else [
                    BlockedModel(model="utility_dcf", reason=reason),
                    BlockedModel(model="unlevered_dcf", reason="Regulated utilities require a rate-base and common-equity valuation."),
                ]
            ),
            supported_by_current_engine=False,
        )

    archetype = _operating_archetype(profile)
    if archetype == "telecommunications":
        annual = canonical_financials.get("annual") if isinstance(canonical_financials.get("annual"), list) else []
        telecom_latest = latest.get("telecom") if isinstance(latest.get("telecom"), dict) else {}
        readiness = {
            "three_year_wireless_subscribers": _telecom_history_ready(annual, "wireless_subscribers", strictly_positive=True),
            "three_year_postpaid_phone_subscribers": _telecom_history_ready(annual, "postpaid_phone_subscribers", strictly_positive=True),
            "three_year_postpaid_phone_net_additions": _telecom_history_ready(annual, "postpaid_phone_net_additions"),
            "three_year_postpaid_phone_churn": _telecom_history_ready(annual, "postpaid_phone_churn"),
            "three_year_mobility_service_and_equipment_revenue": (
                _telecom_history_ready(annual, "mobility_service_revenue", strictly_positive=True)
                and _telecom_history_ready(annual, "mobility_equipment_revenue")
            ),
            "three_year_reconciled_segments": _telecom_reconciliation_ready(annual),
            "three_year_broadband_connections_and_revenue": (
                _telecom_history_ready(annual, "broadband_connections", strictly_positive=True)
                and _telecom_history_ready(annual, "broadband_net_additions")
                and _telecom_history_ready(annual, "consumer_broadband_revenue", strictly_positive=True)
            ),
            "three_year_operating_working_capital": _telecom_history_ready(annual, "working_capital_change"),
            "three_year_network_capex": _telecom_history_ready(annual, "capital_expenditures", strictly_positive=True),
            "two_year_interest_bearing_debt": _telecom_history_ready(annual, "interest_bearing_debt", strictly_positive=True),
            "latest_filed_weighted_average_debt_cost": _line_ready(telecom_latest.get("cost_of_debt")),
            "three_year_filed_tax_rate": _operating_tax_rate_ready(annual),
            "three_year_filed_depreciation": bool(len(annual) >= 3 and all(
                isinstance(record, dict) and _line_ready(record.get("depreciation"))
                for record in annual[-3:]
            )),
            "usd_reporting_currency": str(canonical_financials.get("currency") or "").upper() == "USD",
            "source_backed_equity_bridge": bool(
                _line_ready(latest.get("cash"))
                and _line_ready_or_not_applicable(latest.get("marketable_securities"))
                and _line_ready(telecom_latest.get("interest_bearing_debt"))
                and _line_ready_or_not_applicable(latest.get("non_controlling_interest"))
                and _line_ready_or_not_applicable(latest.get("preferred_equity"))
                and _line_ready(latest.get("shares"))
                and _positive_number((latest.get("shares") or {}).get("value"))
            ),
            "live_market_price_beta_and_capitalization": bool(
                market_status in {"live", "cached"}
                and _positive_number(market.get("current_price"))
                and _positive_number(market.get("market_cap"))
                and _positive_number(market.get("beta"))
                and market.get("fallback_used") is not True
                and _current_source(market.get("source"))
                and _fresh_timestamp(market.get("fetched_at_ms"))
            ),
            "live_risk_free_rate_and_erp": bool(
                valuation_status in {"live", "cached"}
                and _positive_number(valuation_context.get("risk_free_rate"))
                and _positive_number(valuation_context.get("equity_risk_premium"))
                and _current_source(valuation_context.get("treasury_rate_source"))
                and _current_source(valuation_context.get("erp_source"))
                and _fresh_timestamp(valuation_context.get("fetched_at_ms"))
            ),
            "dated_market_context": bool(re.fullmatch(r"20\d{2}-\d{2}-\d{2}", str(valuation_context.get("as_of_date") or ""))),
            "production_calculation_and_workbook_route": "telecom_subscriber_dcf" in PRODUCTION_MODEL_ROUTES,
        }
        readiness["telecom_subscriber_dcf_route"] = all(
            ready for field, ready in readiness.items() if field != "telecom_subscriber_dcf_route"
        ) and readiness["production_calculation_and_workbook_route"] is True
        missing = [field for field, ready in readiness.items() if not ready]
        eligible = readiness["telecom_subscriber_dcf_route"] and revenue > 0 and ebit > 0
        reason = ""
        if missing:
            reason = "Telecom subscriber DCF is blocked because required filed or current inputs are incomplete: " + ", ".join(missing) + "."
        elif revenue <= 0 or ebit <= 0:
            reason = "Telecom subscriber DCF requires positive filed revenue and EBIT."
        return ModelEligibility(
            company_type="operating" if ebit > 0 else "high_growth",
            preferred_model="telecom_subscriber_dcf",
            operating_archetype=archetype,
            required_input_readiness=readiness,
            allowed_models=["telecom_subscriber_dcf"]
            if readiness["production_calculation_and_workbook_route"] and readiness["usd_reporting_currency"] else [],
            blocked_models=[] if eligible else [BlockedModel(model="telecom_subscriber_dcf", reason=reason)],
            supported_by_current_engine=eligible,
        )

    if archetype == "energy_materials":
        annual = canonical_financials.get("annual") if isinstance(canonical_financials.get("annual"), list) else []
        recent = annual[-3:]
        latest_energy = latest.get("energy") if isinstance(latest.get("energy"), dict) else {}
        history_fields = (
            "weighted_average_diluted_shares", "crude_oil_production", "ngl_production", "liquids_production",
            "natural_gas_production_available_for_sale", "oil_equivalent_production", "average_crude_price",
            "average_ngl_price", "average_natural_gas_price", "average_production_cost_per_oil_equivalent_barrel",
            "proved_oil_equivalent_reserves", "proved_developed_oil_equivalent_reserves",
            "proved_undeveloped_oil_equivalent_reserves", "upstream_earnings_gaap", "energy_products_earnings_gaap",
            "chemical_products_earnings_gaap", "specialty_products_earnings_gaap", "corporate_financing_earnings_gaap",
            "upstream_depreciation_and_depletion", "energy_products_depreciation_and_depletion",
            "chemical_products_depreciation_and_depletion", "specialty_products_depreciation_and_depletion",
            "upstream_ppe_additions_including_noncash", "energy_products_ppe_additions_including_noncash",
            "chemical_products_ppe_additions_including_noncash", "specialty_products_ppe_additions_including_noncash",
            "cash_capex", "operating_working_capital_investment", "corporate_interest_revenue",
        )
        readiness = {
            f"three_year_{field}": len(recent) == 3 and all(
                isinstance(row, dict) and isinstance(row.get("energy"), dict) and _line_ready(row["energy"].get(field))
                for row in recent
            )
            for field in history_fields
        }
        for field in (
            "brent_2026_earnings_sensitivity", "henry_hub_2026_earnings_sensitivity", "ttf_2026_earnings_sensitivity",
        ):
            readiness[f"filed_{field}"] = _line_ready(latest_energy.get(field))
        readiness["filed_common_equity_bridge"] = bool(
            _line_ready(latest.get("cash"))
            and _line_ready(latest_energy.get("interest_bearing_debt"))
            and _line_ready_or_not_applicable(latest.get("non_controlling_interest"))
            and _line_ready_or_not_applicable(latest.get("preferred_equity"))
        )
        readiness["marketable_investments_not_double_counted"] = _line_ready(latest_energy.get("upstream_earnings_gaap"))
        readiness["xom_integrated_source_contract"] = all(readiness.get(f"three_year_{field}") is True for field in history_fields)
        readiness["live_price_market_cap_beta_and_shares"] = bool(
            market_status in {"live", "cached"}
            and _positive_number(market.get("current_price"))
            and _positive_number(market.get("market_cap"))
            and _positive_number(market.get("beta"))
            and _positive_number(market.get("shares_outstanding"))
            and market.get("fallback_used") is not True
            and _current_source(market.get("source"))
            and _fresh_timestamp(market.get("fetched_at_ms"))
        )
        readiness["live_risk_free_rate_and_equity_risk_premium"] = bool(
            valuation_status in {"live", "cached"}
            and _positive_number(valuation_context.get("risk_free_rate"))
            and _positive_number(valuation_context.get("equity_risk_premium"))
            and _current_source(valuation_context.get("treasury_rate_source"))
            and _current_source(valuation_context.get("erp_source"))
            and _fresh_timestamp(valuation_context.get("fetched_at_ms"))
            and re.fullmatch(r"20\d{2}-\d{2}-\d{2}", str(valuation_context.get("as_of_date") or "")) is not None
        )
        readiness["dated_market_context"] = bool(
            re.fullmatch(r"20\d{2}-\d{2}-\d{2}", str(valuation_context.get("as_of_date") or ""))
        )
        readiness["integrated_energy_dcf_route"] = (
            "integrated_energy_dcf" in PRODUCTION_MODEL_ROUTES
            and all(value for name, value in readiness.items() if name != "integrated_energy_dcf_route")
        )
        missing = [field for field, ready in readiness.items() if not ready]
        eligible = not missing
        if missing:
            reason = "Energy and materials model is blocked because production, reserve, commodity-price, and sustaining-capex inputs or production routes are incomplete: " + ", ".join(missing) + "."
        else:
            reason = ""
        if not eligible:
            fallback = _comparable_fallback(
                ticker=ticker,
                archetype=archetype,
                company_type="operating" if ebit > 0 else "high_growth",
                canonical_financials=canonical_financials,
                market=market,
                market_status=market_status,
                peers=peers,
                peer_status=peer_status,
                peer_source=peer_source,
                peer_fallback_used=peer_fallback_used,
                peer_fetched_at_ms=peer_fetched_at_ms,
                blocked_models=[
                    BlockedModel(model="integrated_energy_dcf", reason=reason),
                    BlockedModel(model="unlevered_dcf", reason="Energy and materials require production, commodity-price, reserve, and segment-reinvestment schedules."),
                ],
            )
            if fallback is not None:
                return fallback
        return ModelEligibility(
            company_type="operating" if ebit > 0 else "high_growth",
            preferred_model="integrated_energy_dcf",
            operating_archetype=archetype,
            required_input_readiness=readiness,
            allowed_models=["integrated_energy_dcf"] if eligible else [],
            blocked_models=[] if eligible else [
                BlockedModel(model="integrated_energy_dcf", reason=reason),
                BlockedModel(model="unlevered_dcf", reason="Energy and materials require production, commodity-price, reserve, and segment-reinvestment schedules."),
            ],
            supported_by_current_engine=eligible,
        )

    if archetype == "mature_pharma":
        annual = canonical_financials.get("annual") if isinstance(canonical_financials.get("annual"), list) else []
        recent = annual[-3:]

        def pharma_products_for_year(row: Any) -> list[Dict[str, Any]]:
            pharma = row.get("pharma") if isinstance(row, dict) else None
            products = pharma.get("products") if isinstance(pharma, dict) else None
            return [product for product in products if isinstance(product, dict)] if isinstance(products, list) else []

        def pharma_product_history_ready() -> bool:
            if len(recent) != 3:
                return False
            product_names: set[str] | None = None
            for row in recent:
                products = pharma_products_for_year(row)
                if not products:
                    return False
                year_names: set[str] = set()
                for product in products:
                    if not isinstance(product, dict) or not isinstance(product.get("product_name"), str):
                        return False
                    if not _line_ready(product.get("revenue")):
                        return False
                    year_names.add(product["product_name"])
                if product_names is None:
                    product_names = year_names
                elif year_names != product_names:
                    return False
            return bool(product_names)

        def pharma_total_revenue_reconciles() -> bool:
            if len(recent) != 3:
                return False
            for row in recent:
                pharma = row.get("pharma") if isinstance(row, dict) else None
                if not isinstance(pharma, dict) or not _line_ready(pharma.get("reported_total_revenue")):
                    return False
                reported_total = _to_finite_number(pharma["reported_total_revenue"].get("value"))
                company_revenue = _to_finite_number(row.get("revenue", {}).get("value")) if isinstance(row.get("revenue"), dict) else None
                if reported_total is None or company_revenue is None or abs(reported_total - company_revenue) > max(1_000_000, abs(company_revenue) * 0.005):
                    return False
            return True

        def pharma_product_residual_valid() -> bool:
            for row in recent:
                pharma = row.get("pharma") if isinstance(row, dict) else None
                if not isinstance(pharma, dict) or not _line_ready(pharma.get("reported_total_revenue")):
                    return False
                products = pharma_products_for_year(row)
                reported_total = _to_finite_number(pharma["reported_total_revenue"].get("value"))
                if reported_total is None:
                    return False
                product_total = sum(float(product["revenue"]["value"]) for product in products)
                if product_total < 0 or product_total > reported_total * 1.005 or reported_total - product_total < 0:
                    return False
            return True

        latest_pharma = latest.get("pharma") if isinstance(latest.get("pharma"), dict) else {}
        patents = latest_pharma.get("patents") if isinstance(latest_pharma.get("patents"), list) else []
        us_patents = [patent for patent in patents if isinstance(patent, dict)
            and patent.get("region") == "us" and patent.get("metric") == "basic_patent_expiration_year"]

        def pharma_normalize_name(value: Any) -> str:
            text = re.sub(r"\s*\([a-z0-9]+\)\s*$", "", str(value or ""), flags=re.IGNORECASE)
            return re.sub(r"[^a-z0-9]", "", text.lower())

        def product_patent_aliases(product_name: str) -> set[str]:
            name = pharma_normalize_name(product_name)
            if name == "prevnarfamily":
                return {"prevnar13prevenar13", "prevnar20prevenar20"}
            if name == "vyndaqelfamily":
                return {"vyndaqelvyndamaxvynmac"}
            if name == "braftovimektovi":
                return {"braftovi", "mektovi"}
            return {name}

        def material_product_patent_coverage_ready() -> bool:
            products = latest_pharma.get("products") if isinstance(latest_pharma.get("products"), list) else []
            total_line = latest_pharma.get("reported_total_revenue")
            total_revenue = _to_finite_number(total_line.get("value")) if isinstance(total_line, dict) else None
            if total_revenue is None or total_revenue <= 0 or not products:
                return False
            patent_names = {pharma_normalize_name(patent.get("product_name")) for patent in us_patents
                if _line_ready(patent.get("year"))}
            covered = 0.0
            for product in products:
                if not isinstance(product, dict) or not _line_ready(product.get("revenue")):
                    return False
                if product_patent_aliases(str(product.get("product_name") or "")) & patent_names:
                    covered += float(product["revenue"]["value"])
            return covered / total_revenue >= 0.6

        readiness = {
            "pfe_product_and_patent_source_contract": pharma_product_history_ready() and pharma_total_revenue_reconciles() and pharma_product_residual_valid(),
            "three_year_filed_product_sales": pharma_product_history_ready(),
            "three_year_product_table_total_reconciles_to_company_revenue": pharma_total_revenue_reconciles(),
            "three_year_product_sales_leave_a_nonnegative_other_revenue_residual": pharma_product_residual_valid(),
            "latest_filed_regional_patent_schedule": len(us_patents) >= 10 and all(
                _line_ready(patent.get("year")) for patent in us_patents
            ),
            "at_least_60pct_of_total_revenue_has_filed_us_patent_schedule": material_product_patent_coverage_ready(),
            "three_year_operating_cash_flow_inputs": len(recent) == 3 and all(
                isinstance(row, dict) and all(_line_ready(row.get(field)) for field in (
                    "revenue", "ebit", "tax_rate", "depreciation", "capex", "nwc_change",
                ))
                for row in recent
            ),
            "filed_cash": _line_ready(latest.get("cash")),
            "filed_interest_bearing_debt": _line_ready(latest.get("debt")),
            "filed_marketable_securities_or_not_applicable": _line_ready_or_not_applicable(latest.get("marketable_securities")),
            "filed_noncontrolling_interest_or_not_applicable": _line_ready_or_not_applicable(latest.get("non_controlling_interest")),
            "filed_preferred_equity_or_not_applicable": _line_ready_or_not_applicable(latest.get("preferred_equity")),
            "filed_diluted_shares": _line_ready(latest.get("shares")),
            "live_price_market_cap_beta_and_shares": bool(
                market_status in {"live", "cached"}
                and _positive_number(market.get("current_price"))
                and _positive_number(market.get("market_cap"))
                and _positive_number(market.get("beta"))
                and _positive_number(market.get("shares_outstanding"))
                and market.get("fallback_used") is not True
                and _current_source(market.get("source"))
                and _fresh_timestamp(market.get("fetched_at_ms"))
            ),
            "live_risk_free_rate_and_equity_risk_premium": bool(
                valuation_status in {"live", "cached"}
                and _positive_number(valuation_context.get("risk_free_rate"))
                and _positive_number(valuation_context.get("equity_risk_premium"))
                and _current_source(valuation_context.get("treasury_rate_source"))
                and _current_source(valuation_context.get("erp_source"))
                and _fresh_timestamp(valuation_context.get("fetched_at_ms"))
            ),
            "dated_market_context": re.fullmatch(r"20\d{2}-\d{2}-\d{2}", str(valuation_context.get("as_of_date") or "")) is not None,
        }
        readiness["mature_pharma_product_dcf_route"] = (
            "mature_pharma_product_dcf" in PRODUCTION_MODEL_ROUTES
            and all(readiness.values())
            and revenue > 0
            and ebit > 0
        )
        missing = [field for field, ready in readiness.items() if not ready]
        eligible = not missing
        if missing:
            reason = "Mature-pharma product DCF is blocked because filed product, operating, market, or bridge inputs are incomplete: " + ", ".join(missing) + "."
        else:
            reason = ""
        if not eligible:
            fallback = _comparable_fallback(
                ticker=ticker,
                archetype=archetype,
                company_type="operating" if ebit > 0 else "high_growth",
                canonical_financials=canonical_financials,
                market=market,
                market_status=market_status,
                peers=peers,
                peer_status=peer_status,
                peer_source=peer_source,
                peer_fallback_used=peer_fallback_used,
                peer_fetched_at_ms=peer_fetched_at_ms,
                blocked_models=[
                    BlockedModel(model="mature_pharma_product_dcf", reason=reason),
                    BlockedModel(model="unlevered_dcf", reason="Pharmaceutical value depends on product-specific competition and loss-of-exclusivity schedules."),
                ],
            )
            if fallback is not None:
                return fallback
        return ModelEligibility(
            company_type="operating" if ebit > 0 else "high_growth",
            preferred_model="mature_pharma_product_dcf",
            operating_archetype=archetype,
            required_input_readiness=readiness,
            allowed_models=["mature_pharma_product_dcf"] if eligible else [],
            blocked_models=[] if eligible else [
                BlockedModel(model="mature_pharma_product_dcf", reason=reason),
                BlockedModel(model="unlevered_dcf", reason="Pharmaceutical value depends on product-specific competition and loss-of-exclusivity schedules."),
            ],
            supported_by_current_engine=eligible,
        )

    if archetype == "biotechnology":
        pipeline_assets = native_financials.get("pipeline_assets") if isinstance(native_financials, dict) else None
        pipeline_assets = pipeline_assets if isinstance(pipeline_assets, list) else []
        pipeline_inventory_ready = bool(
            len(pipeline_assets) >= 5
            and all(
                isinstance(asset, dict)
                and asset.get("asset_id")
                and asset.get("accession_number")
                and asset.get("filing_date")
                and asset.get("form") == "10-K"
                and asset.get("source_statement")
                for asset in pipeline_assets
            )
        )
        reported_revenue = latest.get("revenue") if isinstance(latest, dict) else None
        revenue_ready = _line_ready(reported_revenue) and _positive_number((reported_revenue or {}).get("value"))
        current_price_ready = bool(
            market_status in {"live", "cached"}
            and market.get("fallback_used") is not True
            and _positive_number(market.get("current_price"))
            and _current_source(market.get("source"))
            and _fresh_timestamp(market.get("fetched_at_ms"))
        )
        shares_ready = bool(_line_ready(latest.get("shares")) and _positive_number((latest.get("shares") or {}).get("value")))
        cash_ready = _line_ready(latest.get("cash"))
        debt_ready = _line_ready(latest.get("debt"))
        securities_ready = _line_ready_or_not_applicable(latest.get("marketable_securities"))
        preferred_ready = _line_ready_or_not_applicable(latest.get("preferred_equity"))
        nci_ready = _line_ready_or_not_applicable(latest.get("non_controlling_interest"))
        capm_ready = bool(
            valuation_status in {"live", "cached"}
            and _positive_number(valuation_context.get("risk_free_rate"))
            and _positive_number(valuation_context.get("equity_risk_premium"))
            and _positive_number(market.get("beta"))
            and _current_source(valuation_context.get("treasury_rate_source"))
            and _current_source(valuation_context.get("erp_source"))
            and _current_source(market.get("source"))
            and _fresh_timestamp(valuation_context.get("fetched_at_ms"))
            and _fresh_timestamp(market.get("fetched_at_ms"))
        )
        equity_bridge_ready = bool(
            shares_ready and cash_ready and debt_ready and securities_ready and preferred_ready and nci_ready
        )
        route_available = bool(
            "biotech_pipeline_rnpv" in PRODUCTION_MODEL_ROUTES
            and pipeline_inventory_ready and revenue_ready and current_price_ready and capm_ready and equity_bridge_ready
        )
        readiness = {
            "source_backed_pipeline_asset_inventory": pipeline_inventory_ready,
            "positive_filed_commercial_revenue_base": revenue_ready,
            "commercial_franchise_forecast_inputs": False,
            "pipeline_asset_economics": False,
            "other_pipeline_scope_value": False,
            "company_discount_rate_inputs": False,
            "terminal_growth_rate": False,
            "live_current_share_price": current_price_ready,
            "filed_diluted_share_count": shares_ready,
            "filed_cash": cash_ready,
            "filed_interest_bearing_debt": debt_ready,
            "filed_marketable_securities_or_not_applicable": securities_ready,
            "filed_preferred_equity_or_not_applicable": preferred_ready,
            "filed_non_controlling_interest_or_not_applicable": nci_ready,
            "live_capm_inputs": capm_ready,
            "source_backed_common_equity_bridge": equity_bridge_ready,
            "biotech_pipeline_rnpv_route": route_available,
        }
        gap_labels = {
            "commercial_franchise_forecast_inputs": "Commercial-franchise DCF assumptions",
            "pipeline_asset_economics": "Pipeline asset economics and risk assumptions",
            "other_pipeline_scope_value": "Other and early-stage pipeline value",
            "company_discount_rate_inputs": "Normalized debt cost and tax assumptions",
            "terminal_growth_rate": "Terminal commercial-franchise growth",
            "live_current_share_price": "Current share price",
            "filed_diluted_share_count": "Filed diluted share count",
            "filed_cash": "Filed cash balance",
            "filed_interest_bearing_debt": "Filed interest-bearing debt",
            "filed_marketable_securities_or_not_applicable": "Filed marketable securities or disposition",
            "filed_preferred_equity_or_not_applicable": "Filed preferred equity or disposition",
            "filed_non_controlling_interest_or_not_applicable": "Filed noncontrolling interest or disposition",
            "live_capm_inputs": "Current risk-free rate, beta, and equity-risk premium",
        }
        reason = (
            "MRNA pipeline rNPV uses its live 10-K program list, but commercial forecasts, success probabilities, "
            "launch timing, partner economics, and remaining development costs are not reported as valuation inputs."
        )
        gaps = [
            {"key": key, "label": label, "reason": reason}
            for key, label in gap_labels.items() if readiness.get(key) is False
        ]
        if route_available:
            return ModelEligibility(
                company_type="high_growth" if ebit <= 0 else "operating",
                preferred_model="biotech_pipeline_rnpv",
                operating_archetype=archetype,
                status="input_required",
                model_route_available=True,
                missing_input_gaps=gaps,
                required_input_readiness=readiness,
                allowed_models=["biotech_pipeline_rnpv"],
                blocked_models=[
                    BlockedModel(model="unlevered_dcf", reason="Biotechnology value depends on asset-level, probability-adjusted pipeline cash flows."),
                    BlockedModel(model="revenue_multiple", reason="A peer revenue multiple does not capture the disclosed pipeline's stage, launch, and risk profile."),
                ],
                supported_by_current_engine=False,
            )
        reason = (
            "The biotechnology pipeline route requires a live SEC source list of disclosed assets and a positive filed revenue base; "
            "filed pipeline, revenue, market, or bridge inputs are incomplete."
        )
        return ModelEligibility(
            company_type="high_growth" if ebit <= 0 else "operating",
            preferred_model="biotech_pipeline_rnpv",
            operating_archetype=archetype,
            required_input_readiness=readiness,
            allowed_models=[],
            blocked_models=[BlockedModel(model="biotech_pipeline_rnpv", reason=reason)],
            supported_by_current_engine=False,
        )

    archetype_block_reason = _blocked_operating_archetype_reason(archetype)
    if archetype_block_reason:
        is_unprofitable = revenue > 0 and ebit <= 0
        preferred_model = "revenue_multiple" if archetype == "biotechnology" and is_unprofitable else "unlevered_dcf"
        fallback = _comparable_fallback(
            ticker=ticker,
            archetype=archetype,
            company_type="high_growth" if is_unprofitable else "operating",
            canonical_financials=canonical_financials,
            market=market,
            market_status=market_status,
            peers=peers,
            peer_status=peer_status,
            peer_source=peer_source,
            peer_fallback_used=peer_fallback_used,
            peer_fetched_at_ms=peer_fetched_at_ms,
            blocked_models=[BlockedModel(model=preferred_model, reason=archetype_block_reason)],
        )
        if fallback is not None:
            return fallback
        return ModelEligibility(
            company_type="high_growth" if is_unprofitable else "operating",
            preferred_model=preferred_model,
            operating_archetype=archetype,
            # Offer the route whenever it exists. Withholding it produced
            # status="unsupported" and no workbook at all, which is the one
            # outcome the product should never give an issuer with filed
            # financials. The blocking reason stays recorded on the model, so
            # the workbook still opens with blank analyst inputs rather than a
            # fabricated number.
            allowed_models=[preferred_model] if preferred_model in PRODUCTION_MODEL_ROUTES else [],
            blocked_models=[BlockedModel(model=preferred_model, reason=archetype_block_reason)],
            supported_by_current_engine=False,
        )

    annual = canonical_financials.get("annual") if isinstance(canonical_financials.get("annual"), list) else []
    readiness: Dict[str, bool] = {}
    latest_record = annual[-1] if annual and isinstance(annual[-1], dict) else {}
    prior_record = annual[-2] if len(annual) >= 2 and isinstance(annual[-2], dict) else {}
    for field in ("revenue", "ebit", "gross_profit", "cost_of_revenue", "capex", "depreciation"):
        line = latest_record.get(field)
        readiness[f"filed_{field}"] = _line_ready(line)
    readiness["positive_revenue"] = readiness["filed_revenue"] and _positive_number((latest_record.get("revenue") or {}).get("value"))
    readiness["positive_ebit"] = readiness["filed_ebit"] and _positive_number((latest_record.get("ebit") or {}).get("value"))
    readiness["positive_gross_profit_and_cost_of_revenue"] = (
        readiness["filed_gross_profit"]
        and readiness["filed_cost_of_revenue"]
        and _positive_number((latest_record.get("gross_profit") or {}).get("value"))
        and _positive_number((latest_record.get("cost_of_revenue") or {}).get("value"))
    )
    # Informational, not blocking. EBIT is forecast from ebitMargin, not derived
    # from gross margin, so a filer that presents no cost-of-revenue line (most
    # utilities, telecoms, insurers and biotechs) can still be valued. This key is
    # excluded from dcf_missing below. The workbook row is left blank rather than
    # filled with a default, so nothing is invented.
    readiness["gross_margin_display_only"] = True
    if archetype == "subscription_software":
        readiness["aggregate_operating_working_capital"] = _line_ready(latest_record.get("operating_net_working_capital"))
    else:
        for field in ("accounts_receivable", "inventory", "accounts_payable"):
            readiness[f"working_capital_{field}"] = _line_ready_or_not_applicable(latest_record.get(field))
    readiness["two_year_filed_debt"] = bool(
        _line_ready(latest_record.get("debt"))
        and _line_ready(prior_record.get("debt"))
        and _to_finite_number((latest_record.get("debt") or {}).get("value")) is not None
        and _to_finite_number((prior_record.get("debt") or {}).get("value")) is not None
        and (latest_record.get("debt") or {}).get("value") >= 0
        and (prior_record.get("debt") or {}).get("value") >= 0
    )
    readiness["source_supported_tax_rate"] = _operating_tax_rate_ready(annual)
    readiness["three_year_operating_driver_history"] = _three_year_operating_profile_ready(annual, archetype)
    readiness["source_supported_cost_of_debt"] = _debt_cost_ready(annual, native_financials)
    readiness["filed_diluted_share_count"] = (
        _line_ready(latest_record.get("shares"))
        and _positive_number((latest_record.get("shares") or {}).get("value"))
    )
    for field in ("cash", "marketable_securities", "preferred_equity", "non_controlling_interest"):
        readiness[f"equity_bridge_{field}"] = _line_ready_or_not_applicable(latest_record.get(field))
    market_current = bool(
        market_status in {"live", "cached"}
        and market.get("fallback_used") is not True
        and _current_source(market.get("source"))
        and _fresh_timestamp(market.get("fetched_at_ms"))
    )
    readiness["live_price_market_cap_and_beta"] = bool(
        market_current
        and _positive_number(market.get("current_price"))
        and _positive_number(market.get("market_cap"))
        and _positive_number(market.get("beta"))
        and 0.2 <= float(market.get("beta")) <= 3.0
    )
    readiness["live_risk_free_rate_and_equity_risk_premium"] = bool(
        valuation_status in {"live", "cached"}
        and _current_source(valuation_context.get("treasury_rate_source"))
        and _current_source(valuation_context.get("erp_source"))
        and _fresh_timestamp(valuation_context.get("fetched_at_ms"))
        and _positive_number(valuation_context.get("risk_free_rate"))
        and float(valuation_context.get("risk_free_rate")) <= 0.15
        and _positive_number(valuation_context.get("equity_risk_premium"))
        and 0.02 <= float(valuation_context.get("equity_risk_premium")) <= 0.15
    )
    readiness["dated_market_context"] = bool(
        re.fullmatch(r"20\d{2}-\d{2}-\d{2}", str(valuation_context.get("as_of_date") or ""))
    )
    readiness["three_current_source_ready_peers"] = _current_peer_multiple_ready(
        peers,
        ticker=ticker,
        market_status=market_status,
        peer_status=peer_status,
        peer_source=peer_source,
        peer_fallback_used=peer_fallback_used,
        peer_fetched_at_ms=peer_fetched_at_ms,
    )
    dcf_missing = [
        field
        for field, ready in readiness.items()
        if not ready and field != "positive_gross_profit_and_cost_of_revenue"
    ]
    dcf_eligible = not dcf_missing

    latest_ebitda = latest_record.get("ebitda")
    latest_revenue = latest_record.get("revenue")
    bridge_fields_ready = all(
        _line_ready_or_not_applicable(latest_record.get(field))
        for field in ("cash", "marketable_securities", "preferred_equity", "non_controlling_interest")
    ) and _line_ready(latest_record.get("debt"))
    live_equity_price_ready = bool(
        market_current
        and _positive_number(market.get("current_price"))
        and readiness["filed_diluted_share_count"]
    )
    peer_ev_ebitda_multiple = _current_peer_median(
        peers,
        ticker=ticker,
        market_status=market_status,
        peer_status=peer_status,
        peer_source=peer_source,
        peer_fallback_used=peer_fallback_used,
        peer_fetched_at_ms=peer_fetched_at_ms,
        metric="ev_ebitda",
    )
    peer_ev_revenue_multiple = _current_peer_median(
        peers,
        ticker=ticker,
        market_status=market_status,
        peer_status=peer_status,
        peer_source=peer_source,
        peer_fallback_used=peer_fallback_used,
        peer_fetched_at_ms=peer_fetched_at_ms,
        metric="ev_revenue",
    )
    readiness["multiple_positive_filed_ebitda"] = (
        _line_ready(latest_ebitda) and _positive_number((latest_ebitda or {}).get("value"))
    )
    readiness["multiple_positive_filed_revenue"] = (
        _line_ready(latest_revenue) and _positive_number((latest_revenue or {}).get("value"))
    )
    readiness["multiple_source_ready_equity_bridge"] = bridge_fields_ready
    readiness["multiple_live_price_and_filed_shares"] = live_equity_price_ready
    readiness["multiple_three_current_ev_ebitda_peers"] = bool(
        peer_ev_ebitda_multiple is not None and peer_ev_ebitda_multiple < 100
    )
    readiness["multiple_three_current_ev_revenue_peers"] = bool(
        peer_ev_revenue_multiple is not None and peer_ev_revenue_multiple < 50
    )
    readiness["ev_ebitda_route"] = all(readiness[field] for field in (
        "multiple_positive_filed_ebitda",
        "multiple_source_ready_equity_bridge",
        "multiple_live_price_and_filed_shares",
        "multiple_three_current_ev_ebitda_peers",
    ))
    readiness["revenue_multiple_route"] = all(readiness[field] for field in (
        "multiple_positive_filed_revenue",
        "multiple_source_ready_equity_bridge",
        "multiple_live_price_and_filed_shares",
        "multiple_three_current_ev_revenue_peers",
    ))

    if dcf_eligible:
        preferred_model = "unlevered_dcf"
        allowed_models = [preferred_model]
        blocked_models = []
        eligible = True
    elif readiness["ev_ebitda_route"]:
        preferred_model = "ev_ebitda"
        allowed_models = [preferred_model]
        blocked_models = [BlockedModel(
            model="unlevered_dcf",
            reason="Operating DCF is blocked because required filed or live inputs are incomplete: " + ", ".join(dcf_missing) + ".",
        )]
        eligible = True
    elif archetype != "biotechnology" and readiness["revenue_multiple_route"]:
        preferred_model = "revenue_multiple"
        allowed_models = [preferred_model]
        blocked_models = [BlockedModel(
            model="unlevered_dcf",
            reason="Operating DCF is blocked because required filed or live inputs are incomplete: " + ", ".join(dcf_missing) + ".",
        )]
        eligible = True
    else:
        preferred_model = "ev_ebitda" if readiness["multiple_positive_filed_ebitda"] else "revenue_multiple"
        multiple_missing = [
            field for field in ("ev_ebitda_route", "revenue_multiple_route")
            if not readiness[field]
        ]
        company_type = "distressed" if debt_to_book > 3 else "high_growth" if revenue > 0 and ebit <= 0 else "operating"
        reason_parts = []
        if dcf_missing:
            reason_parts.append("Operating DCF inputs: " + ", ".join(dcf_missing))
        if multiple_missing:
            reason_parts.append("peer-multiple inputs: " + ", ".join(multiple_missing))
        reason = "No production valuation route is source-ready (" + "; ".join(reason_parts) + ")."
        selected_target_is_source_ready = (
            readiness["multiple_positive_filed_ebitda"] if preferred_model == "ev_ebitda"
            else readiness["multiple_positive_filed_revenue"]
        )
        if (
            preferred_model in {"ev_ebitda", "revenue_multiple"}
            and preferred_model in PRODUCTION_MODEL_ROUTES
            and selected_target_is_source_ready
            and not (preferred_model == "revenue_multiple" and archetype == "biotechnology")
        ):
            return ModelEligibility(
                company_type=company_type,
                preferred_model=preferred_model,
                operating_archetype=archetype,
                required_input_readiness=readiness,
                allowed_models=[preferred_model],
                blocked_models=[BlockedModel(model="unlevered_dcf", reason=reason)],
                supported_by_current_engine=False,
            )
        return ModelEligibility(
            company_type=company_type,
            preferred_model=preferred_model,
            operating_archetype=archetype,
            required_input_readiness=readiness,
            allowed_models=[],
            blocked_models=[
                BlockedModel(model="unlevered_dcf", reason=reason),
                BlockedModel(model="ev_ebitda", reason=reason),
                BlockedModel(model="revenue_multiple", reason=reason),
            ],
            supported_by_current_engine=False,
        )

    return ModelEligibility(
        company_type="distressed" if debt_to_book > 3 else "high_growth" if revenue > 0 and ebit <= 0 else "operating",
        preferred_model=preferred_model,
        operating_archetype=archetype,
        required_input_readiness=readiness,
        allowed_models=allowed_models,
        blocked_models=blocked_models,
        supported_by_current_engine=eligible,
    )
