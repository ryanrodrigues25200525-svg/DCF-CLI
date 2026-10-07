"""Filing-derived readiness (ticker-agnostic) for AGNC/XOM/PFE/MRNA gates."""

from __future__ import annotations

import time

from app.services.valuation.classifier import classify_company


def _line(value=1.0):
    return {
        "value": value,
        "source": "sec_native",
        "confidence": 0.9,
        "method": "test",
        "sources": [{"accession": "0000000000-26-000001", "filed": "2026-02-01"}],
    }


def _na_line():
    line = _line()
    line["source"] = "not_applicable"
    line["method"] = "test not applicable"
    return line


def _market():
    now_ms = int(time.time() * 1000)
    market = {
        "current_price": 10.0,
        "beta": 1.0,
        "market_cap": 1e9,
        "shares_outstanding": 1e8,
        "fallback_used": False,
        "source": "test_live",
        "fetched_at_ms": now_ms,
    }
    valuation_context = {
        "risk_free_rate": 0.04,
        "equity_risk_premium": 0.05,
        "treasury_rate_source": "test_treasury",
        "erp_source": "test_erp",
        "fetched_at_ms": now_ms,
        "as_of_date": "2026-02-01",
    }
    return market, valuation_context


MORTGAGE_FIELDS = (
    "average_investment_securities_at_cost", "average_tba_dollar_roll_position_at_cost",
    "average_mortgage_borrowings", "average_stockholders_equity", "average_asset_yield",
    "average_aggregate_cost_of_funds", "average_net_interest_spread", "economic_interest_income",
    "economic_interest_expense", "operating_expenses", "preferred_dividends",
    "net_income_available_to_common", "tangible_book_value_per_common_share",
    "net_book_value_per_common_share", "preferred_equity_liquidation_preference",
    "common_dividends_per_share", "period_end_common_shares", "average_at_risk_leverage",
    "average_swap_notional", "average_swap_ratio", "average_swap_net_pay_rate",
    "expenses_pct_average_assets",
)


def _mortgage_annual_row():
    return {"mortgage_reit": {f: _line() for f in MORTGAGE_FIELDS}, "shares": _line(100.0)}


def _mortgage_canonical():
    annual = [_mortgage_annual_row() for _ in range(4)]
    latest_mortgage = {
        f: _line()
        for f in (
            "investment_securities_fair_value", "total_assets", "repo_and_other_debt",
            "total_liabilities", "total_stockholders_equity",
        )
    }
    latest = {"mortgage_reit": latest_mortgage, "cash": _line(), "debt": _line()}
    return {"annual": annual, "latest": latest, "currency": "USD", "metadata": {}}


def test_synthetic_agency_mreit_resolves_readiness():
    """Non-AGNC agency mREIT with filed schedules must resolve readiness via filing facts."""
    market, valuation_context = _market()
    profile = {
        "ticker": "TST",
        "sector": "Financial Services",
        "industry": "Mortgage agency mREIT",
        "sic": "6798",
        "sic_description": "Real estate investment trust mortgage agency mbs mortgage-backed",
    }
    result = classify_company(
        profile,
        canonical_financials=_mortgage_canonical(),
        market=market,
        valuation_context=valuation_context,
        market_status="live",
        valuation_status="live",
    )
    assert result.preferred_model == "mortgage_reit_residual_income"
    assert result.required_input_readiness.get("agency_mreit_source_contract") is True, (
        "ticker gate blocked synthetic issuer: "
        + "; ".join(m.reason for m in result.blocked_models)
    )
    assert result.supported_by_current_engine is True

ENERGY_FIELDS = (
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


def _energy_canonical():
    annual = [{"energy": {f: _line() for f in ENERGY_FIELDS}} for _ in range(3)]
    latest_energy = {f: _line() for f in ENERGY_FIELDS}
    latest_energy.update({
        "brent_2026_earnings_sensitivity": _line(),
        "henry_hub_2026_earnings_sensitivity": _line(),
        "ttf_2026_earnings_sensitivity": _line(),
        "interest_bearing_debt": _line(),
    })
    latest = {"energy": latest_energy, "cash": _line(), "non_controlling_interest": _na_line(), "preferred_equity": _na_line()}
    return {"annual": annual, "latest": latest, "currency": "USD", "metadata": {}}


def test_synthetic_energy_resolves_readiness():
    """Non-XOM integrated energy issuer with filed schedules must resolve readiness."""
    market, valuation_context = _market()
    profile = {
        "ticker": "TST",
        "sector": "Energy",
        "industry": "Oil & Gas Integrated",
        "sic": "2911",
        "sic_description": "petroleum refining energy integrated oil and gas",
    }
    result = classify_company(
        profile,
        canonical_financials=_energy_canonical(),
        market=market,
        valuation_context=valuation_context,
        market_status="live",
        valuation_status="live",
    )
    assert result.preferred_model == "integrated_energy_dcf"
    assert result.required_input_readiness.get("xom_integrated_source_contract") is True, (
        "ticker gate blocked synthetic issuer: "
        + "; ".join(m.reason for m in result.blocked_models)
    )

PHARMA_PRODUCTS = ("Alpha", "Beta")
PHARMA_TOTAL = 100.0


def _pharma_product(name, value):
    return {"product_name": name, "revenue": _line(value)}


def _pharma_patent(product_name):
    return {"product_name": product_name, "region": "us", "metric": "basic_patent_expiration_year", "year": _line(2030.0)}


def _pharma_canonical():
    def row():
        total_each = PHARMA_TOTAL / len(PHARMA_PRODUCTS)
        return {
            "revenue": _line(PHARMA_TOTAL),
            "ebit": _line(10.0),
            "tax_rate": _line(0.2),
            "depreciation": _line(5.0),
            "capex": _line(4.0),
            "nwc_change": _line(1.0),
            "pharma": {
                "products": [_pharma_product(name, total_each * 0.7) for name in PHARMA_PRODUCTS],
                "reported_total_revenue": _line(PHARMA_TOTAL),
            },
        }
    annual = [row() for _ in range(3)]
    total_each = PHARMA_TOTAL / len(PHARMA_PRODUCTS)
    latest = {
        "revenue": _line(PHARMA_TOTAL),
        "ebit": _line(10.0),
        "cash": _line(),
        "debt": _line(),
        "marketable_securities": _na_line(),
        "non_controlling_interest": _na_line(),
        "preferred_equity": _na_line(),
        "shares": _line(100.0),
        "pharma": {
            "products": [_pharma_product(name, total_each * 0.7) for name in PHARMA_PRODUCTS],
            "reported_total_revenue": _line(PHARMA_TOTAL),
            "patents": [_pharma_patent(name) for name in PHARMA_PRODUCTS] + [
                _pharma_patent(f"Other{i}") for i in range(8)
            ],
        },
    }
    return {"annual": annual, "latest": latest, "currency": "USD", "metadata": {}}


def test_synthetic_pharma_resolves_readiness():
    """Non-PFE pharma issuer with filed product/patent tables must resolve readiness."""
    market, valuation_context = _market()
    profile = {
        "ticker": "TST",
        "sector": "Healthcare",
        "industry": "Drug Manufacturers - General",
        "sic": "2834",
        "sic_description": "pharmaceutical preparations",
    }
    result = classify_company(
        profile,
        canonical_financials=_pharma_canonical(),
        market=market,
        valuation_context=valuation_context,
        market_status="live",
        valuation_status="live",
    )
    assert result.preferred_model == "mature_pharma_product_dcf"
    assert result.required_input_readiness.get("pfe_product_and_patent_source_contract") is True, (
        "ticker gate blocked synthetic issuer: "
        + "; ".join(m.reason for m in result.blocked_models)
    )

def _pipeline_asset(asset_id):
    return {
        "asset_id": asset_id,
        "accession_number": "0000000000-26-000001",
        "filing_date": "2026-02-01",
        "form": "10-K",
        "source_statement": "SEC 10-K pipeline table",
    }


def _biotech_canonical():
    latest = {
        "revenue": _line(100.0),
        "ebit": _line(-10.0),
        "cash": _line(),
        "debt": _line(),
        "marketable_securities": _na_line(),
        "non_controlling_interest": _na_line(),
        "preferred_equity": _na_line(),
        "shares": _line(100.0),
    }
    return {"annual": [], "latest": latest, "currency": "USD", "metadata": {}}


def test_synthetic_biotech_resolves_pipeline_inventory():
    """Non-MRNA biotech with filed pipeline assets must resolve inventory readiness."""
    market, valuation_context = _market()
    profile = {
        "ticker": "TST",
        "sector": "Healthcare",
        "industry": "Biotechnology",
        "sic": "2836",
        "sic_description": "biological products biotech",
    }
    result = classify_company(
        profile,
        canonical_financials=_biotech_canonical(),
        market=market,
        valuation_context=valuation_context,
        market_status="live",
        valuation_status="live",
        native_financials={"pipeline_assets": [_pipeline_asset(f"asset-{i}") for i in range(5)]},
    )
    assert result.preferred_model == "biotech_pipeline_rnpv"
    assert result.required_input_readiness.get("source_backed_pipeline_asset_inventory") is True, (
        "ticker gate blocked synthetic issuer: "
        + "; ".join(m.reason for m in result.blocked_models)
    )


def _company(sic):
    return type("Company", (), {"sic": sic})()


def test_edgar_fetch_gates_route_by_sic_not_ticker():
    """Energy/pharma/biotech filing fetches must trigger on SIC capability, not ticker."""
    from app.services import edgar as edgar_module

    assert edgar_module._is_energy_filer(_company("2911")) is True
    assert edgar_module._is_energy_filer(_company("6798")) is False
    assert edgar_module._is_pharma_filer(_company("2834")) is True
    assert edgar_module._is_pharma_filer(_company("6798")) is False
    assert edgar_module._is_biotech_filer(_company("2836")) is True
    assert edgar_module._is_biotech_filer(_company("6798")) is False
