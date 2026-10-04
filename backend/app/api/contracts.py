from __future__ import annotations

import math
import re
import time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictFloat, StrictInt, model_validator

from app.models.schemas import CompanyProfile
from app.services.valuation.model_eligibility import COMPARABLE_VALUATION_METHODS, ModelEligibility, OperatingArchetype, PreferredModel, PRODUCTION_MODEL_ROUTES


def _camel_case(name: str) -> str:
    head, *tail = name.split("_")
    return head + "".join(part.capitalize() for part in tail)


def _positive_number(value: Any) -> bool:
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(float(value))
        and value > 0
    )


class WireModel(BaseModel):
    model_config = ConfigDict(
        extra="allow",
        populate_by_name=True,
        allow_inf_nan=False,
    )


class NativeStatementRow(WireModel):
    concept: str | None = None
    label: str | None = None
    standard_concept: str | None = None
    statement: str | None = None
    row_id: str | None = None
    level: int | None = None
    decimals: int | None = None

    @model_validator(mode="before")
    @classmethod
    def validate_fiscal_year_values(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        for key, amount in value.items():
            if not re.fullmatch(r"FY\s+(?:19|20)\d{2}", str(key)) or amount is None:
                continue
            if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not math.isfinite(float(amount)):
                raise ValueError(f"{key} must be a finite number or null")
        return value


class NativeStatements(WireModel):
    income_statement: list[NativeStatementRow]
    balance_sheet: list[NativeStatementRow]
    cashflow_statement: list[NativeStatementRow]


class NativeSourceFiling(WireModel):
    form: str
    filing_date: str
    report_date: str
    accession_number: str
    primary_document: str | None = None


class NativeSourceFactComponent(WireModel):
    concept: str
    label: str
    value: StrictFloat | StrictInt
    unit: str
    unit_scale: str
    period_end: str
    fiscal_year: StrictInt
    fiscal_period: str
    accession_number: str
    filing_date: str
    form: str
    report_date: str
    primary_document: str | None = None
    source_statement: str


class NativeSourceFact(WireModel):
    concept: str
    value: StrictFloat | StrictInt
    label: str | None = None
    unit: str | None = None
    period_end: str
    fiscal_year: StrictInt
    fiscal_period: str
    accession_number: str | None = None
    filing_date: str | None = None
    form: str | None = None
    report_date: str | None = None
    primary_document: str | None = None
    unit_scale: str | None = None
    source_statement: str | None = None
    source_components: list[NativeSourceFactComponent] = Field(default_factory=list)


class LifeInsuranceFilingFact(WireModel):
    metric: str = Field(min_length=1)
    segment: str | None = None
    capital_group: str | None = None
    value: StrictFloat | StrictInt
    unit: Literal["USD", "ratio"]
    unit_scale: Literal["millions", "ratio"]
    fiscal_year: StrictInt
    fiscal_period: str
    accession_number: str = Field(min_length=1)
    filing_date: str = Field(min_length=10, max_length=10)
    form: Literal["10-K", "10-K/A"]
    report_date: str = Field(min_length=10, max_length=10)
    primary_document: str | None = None
    source_statement: str = Field(min_length=1)
    earnings_basis: Literal[
        "after_tax_adjusted_earnings_available_to_common",
        "pre_tax_adjusted_operating_income",
        "not_applicable",
    ]
    comparison_operator: Literal["greater_than", "equal", "less_than"] | None = None

    @model_validator(mode="after")
    def validate_life_insurance_fact(self) -> LifeInsuranceFilingFact:
        if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", self.report_date):
            raise ValueError("life_insurance.report_date must be an ISO date")
        if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", self.filing_date):
            raise ValueError("life_insurance.filing_date must be an ISO date")
        if self.unit == "ratio" and self.unit_scale != "ratio":
            raise ValueError("life_insurance ratio facts must use ratio unit_scale")
        if self.metric in {"adjusted_earnings_available_to_common", "adjusted_operating_income_pretax"} and not self.segment:
            raise ValueError("life_insurance earnings facts require a source segment")
        if self.metric == "adjusted_earnings_available_to_common" and self.earnings_basis != "after_tax_adjusted_earnings_available_to_common":
            raise ValueError("MET adjusted earnings must retain its after-tax basis")
        if self.metric == "adjusted_operating_income_pretax" and self.earnings_basis != "pre_tax_adjusted_operating_income":
            raise ValueError("PRU adjusted operating income must retain its pre-tax basis")
        if self.metric in {"statutory_capital_and_surplus", "statutory_net_income", "permitted_ordinary_dividend_without_approval", "paid_upstream_dividend"} and not self.capital_group:
            raise ValueError("life_insurance capital and dividend facts require a capital group")
        if self.metric.endswith("_floor") and self.comparison_operator is None:
            raise ValueError("life_insurance threshold facts require their comparison operator")
        return self


class PharmaNativeFact(WireModel):
    metric: Literal[
        "product_revenue",
        "reported_total_revenue",
        "marketable_securities",
        "basic_patent_expiration_year",
        "pending_patent_term_extension_year",
    ]
    product_name: str
    indication: str | None = None
    region: str | None = None
    value: StrictFloat | StrictInt
    unit: str
    unit_scale: str
    period_end: str
    fiscal_year: StrictInt
    fiscal_period: str
    accession_number: str
    filing_date: str
    form: str
    report_date: str
    primary_document: str | None = None
    source_statement: str
    reported_text: str | None = None


class PipelineAssetNativeFact(WireModel):
    asset_id: str = Field(min_length=1)
    asset_name: str = Field(min_length=1)
    stage: str | None = None
    development_status: Literal["disclosed", "explicitly_paused"]
    partner: str | None = None
    accession_number: str = Field(min_length=1)
    filing_date: str = Field(min_length=1)
    report_date: str = Field(min_length=1)
    form: str
    primary_document: str | None = None
    source_statement: str = Field(min_length=1)


class NativeFinancials(WireModel):
    ticker: str
    cik: str
    name: str
    source: str
    periods_requested: int = Field(ge=1, le=10)
    statements: NativeStatements
    source_filings: list[NativeSourceFiling] = Field(default_factory=list)
    source_facts: list[NativeSourceFact] = Field(default_factory=list)
    bank_filing_facts: list[NativeSourceFact] = Field(default_factory=list)
    insurance_filing_facts: list[NativeSourceFact] = Field(default_factory=list)
    life_insurance_filing_facts: list[LifeInsuranceFilingFact] = Field(default_factory=list)
    reit_filing_facts: list[NativeSourceFact] = Field(default_factory=list)
    mortgage_reit_filing_facts: list[NativeSourceFact] = Field(default_factory=list)
    energy_filing_facts: list[NativeSourceFact] = Field(default_factory=list)
    pharma_filing_facts: list[PharmaNativeFact] = Field(default_factory=list)
    pipeline_assets: list[PipelineAssetNativeFact] = Field(default_factory=list)
    asset_management_filing_facts: list[NativeSourceFact] = Field(default_factory=list)
    telecom_filing_facts: list[NativeSourceFact] = Field(default_factory=list)
    issuer_debt_cost_facts: list[NativeSourceFact] = Field(default_factory=list)
    key_metrics: dict[str, Any]
    shares_outstanding: float | None = None
    public_float: float | None = None
    is_financial_institution: bool | None = None
    fiscal_year_end: str | None = None
    fetched_at_ms: int | None = None


CanonicalLineSource = Literal[
    "sec_native", "derived", "market_derived", "missing", "ambiguous", "not_applicable"
]


class CanonicalSourceRecord(WireModel):
    concept: str | None = None
    label: str | None = None
    statement: str | None = None
    row_id: str | None = None
    fiscal_period: str | None = None
    reported_value: StrictFloat | StrictInt | None = None
    accession: str | None = None
    filed: str | None = None
    form: str | None = None
    report_date: str | None = None
    period_end: str | None = None
    currency: str | None = None
    unit: str | None = None
    unit_scale: str | None = None
    source_fiscal_year: int | None = None


class CanonicalCandidate(WireModel):
    concept: str | None = None
    value: StrictFloat | StrictInt | None = None
    source: CanonicalSourceRecord | None = None


class CanonicalFinancialLine(WireModel):
    value: StrictFloat | StrictInt | None = None
    source: CanonicalLineSource
    confidence: float = Field(ge=0, le=1)
    method: str
    concept: str | None = None
    sources: list[CanonicalSourceRecord] = Field(default_factory=list)
    candidates: list[CanonicalCandidate] = Field(default_factory=list)


def _has_filed_line_value(line: CanonicalFinancialLine, year: int) -> bool:
    return (
        line.source in {"sec_native", "derived"}
        and line.value is not None
        and bool(line.sources)
        and all(
            source.accession
            and source.filed
            and source.fiscal_period == f"FY {year}"
            for source in line.sources
        )
    )


def _has_filed_value_with_provenance(line: CanonicalFinancialLine) -> bool:
    return (
        line.source in {"sec_native", "derived"}
        and line.value is not None
        and bool(line.sources)
        and all(source.accession and source.filed for source in line.sources)
    )


class BankCanonicalFinancials(WireModel):
    interest_income: CanonicalFinancialLine
    interest_expense: CanonicalFinancialLine
    net_interest_income: CanonicalFinancialLine
    noninterest_income: CanonicalFinancialLine
    noninterest_expense: CanonicalFinancialLine
    provision_for_credit_losses: CanonicalFinancialLine
    loans_and_leases: CanonicalFinancialLine
    deposits: CanonicalFinancialLine
    interest_bearing_liabilities: CanonicalFinancialLine
    interest_earning_assets: CanonicalFinancialLine
    risk_weighted_assets: CanonicalFinancialLine
    cet1_capital: CanonicalFinancialLine
    minimum_cet1_ratio: CanonicalFinancialLine
    common_equity: CanonicalFinancialLine
    common_equity_distributions: CanonicalFinancialLine
    diluted_shares: CanonicalFinancialLine


class InsuranceCanonicalFinancials(WireModel):
    net_premiums_written: CanonicalFinancialLine
    net_premiums_earned: CanonicalFinancialLine
    losses_and_lae: CanonicalFinancialLine
    acquisition_expenses: CanonicalFinancialLine
    general_operating_expenses: CanonicalFinancialLine
    underwriting_expenses: CanonicalFinancialLine
    loss_ratio: CanonicalFinancialLine
    expense_ratio: CanonicalFinancialLine
    combined_ratio: CanonicalFinancialLine
    prior_year_reserve_development: CanonicalFinancialLine
    underwriting_income: CanonicalFinancialLine
    net_investment_income: CanonicalFinancialLine
    invested_assets: CanonicalFinancialLine
    unpaid_loss_reserves_beginning: CanonicalFinancialLine
    losses_incurred_for_reserve_rollforward: CanonicalFinancialLine
    losses_paid_for_reserve_rollforward: CanonicalFinancialLine
    reserve_other_changes: CanonicalFinancialLine
    unpaid_loss_reserves: CanonicalFinancialLine
    reinsurance_recoverable: CanonicalFinancialLine
    gross_loss_reserves: CanonicalFinancialLine
    reserve_rollforward_check: CanonicalFinancialLine
    other_operations_pretax_income: CanonicalFinancialLine
    statutory_capital_surplus: CanonicalFinancialLine
    minimum_statutory_capital: CanonicalFinancialLine
    common_equity: CanonicalFinancialLine
    common_equity_distributions: CanonicalFinancialLine
    diluted_shares: CanonicalFinancialLine
    net_income: CanonicalFinancialLine
    tax_rate: CanonicalFinancialLine
    reported_pretax_income: CanonicalFinancialLine
    other_pretax_adjustments: CanonicalFinancialLine


class ReitCanonicalFinancials(WireModel):
    net_income_available_to_common: CanonicalFinancialLine
    nareit_bridge_net_income: CanonicalFinancialLine
    real_estate_depreciation: CanonicalFinancialLine
    disposition_gains_nareit_adjustment: CanonicalFinancialLine
    nci_nareit_adjustment: CanonicalFinancialLine
    unconsolidated_nareit_adjustment: CanonicalFinancialLine
    nareit_ffo: CanonicalFinancialLine
    modified_ffo_fx_adjustment: CanonicalFinancialLine
    modified_ffo_deferred_tax_adjustment: CanonicalFinancialLine
    modified_ffo_current_tax_adjustment: CanonicalFinancialLine
    modified_ffo_nci_adjustment: CanonicalFinancialLine
    modified_ffo_unconsolidated_adjustment: CanonicalFinancialLine
    modified_ffo: CanonicalFinancialLine
    core_ffo_disposition_adjustment: CanonicalFinancialLine
    core_ffo_tax_adjustment: CanonicalFinancialLine
    core_ffo_debt_extinguishment_adjustment: CanonicalFinancialLine
    core_ffo_nci_adjustment: CanonicalFinancialLine
    core_ffo_unconsolidated_adjustment: CanonicalFinancialLine
    core_ffo: CanonicalFinancialLine
    tenant_improvements_and_lease_commissions: CanonicalFinancialLine
    property_improvements: CanonicalFinancialLine
    recurring_capex: CanonicalFinancialLine
    analyst_affo: CanonicalFinancialLine
    same_store_noi_net_effective: CanonicalFinancialLine
    same_store_noi_cash: CanonicalFinancialLine
    same_store_noi_growth: CanonicalFinancialLine
    occupancy: CanonicalFinancialLine
    real_estate_segment_noi: CanonicalFinancialLine
    strategic_capital_segment_noi: CanonicalFinancialLine
    common_distributions: CanonicalFinancialLine


class AssetManagerCanonicalFinancials(WireModel):
    aum: CanonicalFinancialLine
    beginning_aum: CanonicalFinancialLine
    average_aum: CanonicalFinancialLine
    net_flows: CanonicalFinancialLine
    realizations: CanonicalFinancialLine
    acquisitions: CanonicalFinancialLine
    market_change: CanonicalFinancialLine
    fx_change: CanonicalFinancialLine
    scope_change: CanonicalFinancialLine
    depreciation: CanonicalFinancialLine
    acquisition_amortization: CanonicalFinancialLine
    working_capital_change: CanonicalFinancialLine
    base_fees: CanonicalFinancialLine
    base_fee_yield: CanonicalFinancialLine
    capital_allocation_income: CanonicalFinancialLine
    performance_fees: CanonicalFinancialLine
    securities_lending_revenue: CanonicalFinancialLine
    technology_revenue: CanonicalFinancialLine
    distribution_revenue: CanonicalFinancialLine
    administrative_other_revenue: CanonicalFinancialLine
    other_revenue: CanonicalFinancialLine
    unmapped_revenue: CanonicalFinancialLine


class TelecomCanonicalFinancials(WireModel):
    capital_expenditures: CanonicalFinancialLine
    working_capital_change: CanonicalFinancialLine
    interest_bearing_debt: CanonicalFinancialLine
    cost_of_debt: CanonicalFinancialLine
    wireless_subscribers: CanonicalFinancialLine
    postpaid_subscribers: CanonicalFinancialLine
    postpaid_phone_subscribers: CanonicalFinancialLine
    prepaid_subscribers: CanonicalFinancialLine
    reseller_subscribers: CanonicalFinancialLine
    wireless_net_additions: CanonicalFinancialLine
    postpaid_phone_net_additions: CanonicalFinancialLine
    postpaid_churn: CanonicalFinancialLine
    postpaid_phone_churn: CanonicalFinancialLine
    mobility_revenue: CanonicalFinancialLine
    mobility_service_revenue: CanonicalFinancialLine
    mobility_equipment_revenue: CanonicalFinancialLine
    mobility_operating_income: CanonicalFinancialLine
    mobility_depreciation: CanonicalFinancialLine
    business_wireline_revenue: CanonicalFinancialLine
    business_wireline_operating_income: CanonicalFinancialLine
    business_wireline_depreciation: CanonicalFinancialLine
    consumer_wireline_revenue: CanonicalFinancialLine
    consumer_broadband_revenue: CanonicalFinancialLine
    consumer_wireline_operating_income: CanonicalFinancialLine
    consumer_wireline_depreciation: CanonicalFinancialLine
    broadband_connections: CanonicalFinancialLine
    fiber_broadband_connections: CanonicalFinancialLine
    broadband_net_additions: CanonicalFinancialLine
    fiber_broadband_net_additions: CanonicalFinancialLine
    latin_america_revenue: CanonicalFinancialLine
    latin_america_operating_income: CanonicalFinancialLine
    communications_revenue: CanonicalFinancialLine
    communications_operating_income: CanonicalFinancialLine


class MortgageReitCanonicalFinancials(WireModel):
    investment_securities_fair_value: CanonicalFinancialLine
    total_assets: CanonicalFinancialLine
    repo_and_other_debt: CanonicalFinancialLine
    total_liabilities: CanonicalFinancialLine
    total_stockholders_equity: CanonicalFinancialLine
    net_book_value_per_common_share: CanonicalFinancialLine
    tangible_book_value_per_common_share: CanonicalFinancialLine
    period_end_common_shares: CanonicalFinancialLine
    preferred_equity_carrying_value: CanonicalFinancialLine
    preferred_equity_liquidation_preference: CanonicalFinancialLine
    gaap_interest_income: CanonicalFinancialLine
    gaap_interest_expense: CanonicalFinancialLine
    gaap_net_interest_income: CanonicalFinancialLine
    economic_interest_income: CanonicalFinancialLine
    economic_interest_expense: CanonicalFinancialLine
    other_gain_net: CanonicalFinancialLine
    operating_expenses: CanonicalFinancialLine
    net_income: CanonicalFinancialLine
    preferred_dividends: CanonicalFinancialLine
    net_income_available_to_common: CanonicalFinancialLine
    other_comprehensive_income: CanonicalFinancialLine
    comprehensive_income: CanonicalFinancialLine
    comprehensive_income_available_to_common: CanonicalFinancialLine
    common_dividends_per_share: CanonicalFinancialLine
    average_investment_securities_at_cost: CanonicalFinancialLine
    average_tba_dollar_roll_position_at_cost: CanonicalFinancialLine
    average_total_assets_fair_value: CanonicalFinancialLine
    average_repo_borrowings: CanonicalFinancialLine
    average_mortgage_borrowings: CanonicalFinancialLine
    average_stockholders_equity: CanonicalFinancialLine
    average_at_risk_leverage: CanonicalFinancialLine
    period_end_at_risk_leverage: CanonicalFinancialLine
    economic_return_on_tangible_common_equity: CanonicalFinancialLine
    expenses_pct_average_assets: CanonicalFinancialLine
    average_asset_yield: CanonicalFinancialLine
    average_aggregate_cost_of_funds: CanonicalFinancialLine
    average_net_interest_spread: CanonicalFinancialLine
    average_swap_notional: CanonicalFinancialLine
    average_swap_ratio: CanonicalFinancialLine
    average_swap_net_pay_rate: CanonicalFinancialLine


class EnergyCanonicalFinancials(WireModel):
    weighted_average_diluted_shares: CanonicalFinancialLine
    current_debt: CanonicalFinancialLine
    long_term_debt: CanonicalFinancialLine
    interest_bearing_debt: CanonicalFinancialLine
    crude_oil_production: CanonicalFinancialLine
    ngl_production: CanonicalFinancialLine
    bitumen_production: CanonicalFinancialLine
    synthetic_oil_production: CanonicalFinancialLine
    liquids_production: CanonicalFinancialLine
    natural_gas_production_available_for_sale: CanonicalFinancialLine
    oil_equivalent_production: CanonicalFinancialLine
    average_crude_price: CanonicalFinancialLine
    average_ngl_price: CanonicalFinancialLine
    average_bitumen_price: CanonicalFinancialLine
    average_synthetic_oil_price: CanonicalFinancialLine
    average_natural_gas_price: CanonicalFinancialLine
    average_production_cost_per_oil_equivalent_barrel: CanonicalFinancialLine
    proved_oil_equivalent_reserves: CanonicalFinancialLine
    proved_developed_oil_equivalent_reserves: CanonicalFinancialLine
    proved_undeveloped_oil_equivalent_reserves: CanonicalFinancialLine
    upstream_earnings_gaap: CanonicalFinancialLine
    energy_products_earnings_gaap: CanonicalFinancialLine
    chemical_products_earnings_gaap: CanonicalFinancialLine
    specialty_products_earnings_gaap: CanonicalFinancialLine
    corporate_financing_earnings_gaap: CanonicalFinancialLine
    upstream_depreciation_and_depletion: CanonicalFinancialLine
    energy_products_depreciation_and_depletion: CanonicalFinancialLine
    chemical_products_depreciation_and_depletion: CanonicalFinancialLine
    specialty_products_depreciation_and_depletion: CanonicalFinancialLine
    upstream_ppe_additions_including_noncash: CanonicalFinancialLine
    energy_products_ppe_additions_including_noncash: CanonicalFinancialLine
    chemical_products_ppe_additions_including_noncash: CanonicalFinancialLine
    specialty_products_ppe_additions_including_noncash: CanonicalFinancialLine
    cash_capex: CanonicalFinancialLine
    operating_working_capital_investment: CanonicalFinancialLine
    corporate_interest_revenue: CanonicalFinancialLine
    brent_2026_earnings_sensitivity: CanonicalFinancialLine
    henry_hub_2026_earnings_sensitivity: CanonicalFinancialLine
    ttf_2026_earnings_sensitivity: CanonicalFinancialLine


class PharmaProductRevenue(WireModel):
    product_name: str
    indication: str | None = None
    revenue: CanonicalFinancialLine


class PharmaPatentDisclosure(WireModel):
    product_name: str
    region: Literal["us", "major_europe", "japan"]
    metric: Literal["basic_patent_expiration_year", "pending_patent_term_extension_year"]
    year: CanonicalFinancialLine
    reported_text: str


class PharmaCanonicalFinancials(WireModel):
    products: list[PharmaProductRevenue]
    patents: list[PharmaPatentDisclosure] = Field(default_factory=list)
    reported_total_revenue: CanonicalFinancialLine


class CanonicalAnnualFinancials(WireModel):
    year: StrictInt
    revenue: CanonicalFinancialLine
    cost_of_revenue: CanonicalFinancialLine
    gross_profit: CanonicalFinancialLine
    ebit: CanonicalFinancialLine
    ebitda: CanonicalFinancialLine
    interest_expense: CanonicalFinancialLine
    income_tax_expense: CanonicalFinancialLine
    net_income: CanonicalFinancialLine
    depreciation: CanonicalFinancialLine
    stock_based_comp: CanonicalFinancialLine
    cfo: CanonicalFinancialLine
    capex: CanonicalFinancialLine
    cash: CanonicalFinancialLine
    marketable_securities: CanonicalFinancialLine
    marketable_securities_current: CanonicalFinancialLine
    marketable_securities_noncurrent: CanonicalFinancialLine
    long_term_debt_current: CanonicalFinancialLine
    commercial_paper: CanonicalFinancialLine
    current_debt: CanonicalFinancialLine
    long_term_debt: CanonicalFinancialLine
    debt: CanonicalFinancialLine
    operating_lease_liability_current: CanonicalFinancialLine
    operating_lease_liability_noncurrent: CanonicalFinancialLine
    lease_liabilities: CanonicalFinancialLine
    book_value: CanonicalFinancialLine
    accounts_receivable: CanonicalFinancialLine
    inventory: CanonicalFinancialLine
    accounts_payable: CanonicalFinancialLine
    total_assets: CanonicalFinancialLine
    total_liabilities: CanonicalFinancialLine
    retained_earnings: CanonicalFinancialLine
    dividends_paid: CanonicalFinancialLine
    non_controlling_interest: CanonicalFinancialLine
    preferred_equity: CanonicalFinancialLine
    total_current_assets: CanonicalFinancialLine
    other_current_assets: CanonicalFinancialLine
    ppe_net: CanonicalFinancialLine
    other_assets: CanonicalFinancialLine
    other_liabilities: CanonicalFinancialLine
    total_current_liabilities: CanonicalFinancialLine
    other_current_liabilities: CanonicalFinancialLine
    deferred_revenue: CanonicalFinancialLine
    research_and_development: CanonicalFinancialLine
    general_and_administrative: CanonicalFinancialLine
    marketing: CanonicalFinancialLine
    rent: CanonicalFinancialLine
    bad_debt: CanonicalFinancialLine
    other_operating_expenses: CanonicalFinancialLine
    deferred_tax: CanonicalFinancialLine
    other_non_cash: CanonicalFinancialLine
    nwc_change: CanonicalFinancialLine
    operating_net_working_capital: CanonicalFinancialLine
    fcff: CanonicalFinancialLine
    balance_sheet_check: CanonicalFinancialLine
    tax_rate: CanonicalFinancialLine
    shares: CanonicalFinancialLine
    bank: BankCanonicalFinancials | None = None
    insurance: InsuranceCanonicalFinancials | None = None
    reit: ReitCanonicalFinancials | None = None
    asset_manager: AssetManagerCanonicalFinancials | None = None
    telecom: TelecomCanonicalFinancials | None = None
    mortgage_reit: MortgageReitCanonicalFinancials | None = None
    energy: EnergyCanonicalFinancials | None = None
    pharma: PharmaCanonicalFinancials | None = None


class CanonicalFinancials(WireModel):
    currency: str | None = None
    scale: str
    metadata: dict[str, Any]
    years: list[StrictInt]
    annual: list[CanonicalAnnualFinancials]
    latest: CanonicalAnnualFinancials | None = None
    quality: dict[str, bool]


class DataQualityEntry(WireModel):
    status: Literal["live", "cached", "stale", "default", "unavailable"]
    source: str
    fetched_at_ms: int | None
    fallback_used: bool
    notes: str | None = None


class Completeness(WireModel):
    has_financials: bool
    has_market: bool
    has_valuation_context: bool
    has_peers: bool
    has_insider_trades: bool
    degradation_level: Literal["none", "low", "moderate", "high"]


class ValuationContext(WireModel):
    risk_free_rate: float | None = None
    equity_risk_premium: float | None = None
    fetched_at_ms: int | None = None
    treasury_rate_source: str | None = None
    erp_source: str | None = None
    as_of_date: str | None = None


class MarketSnapshot(WireModel):
    ticker: str | None = None
    current_price: float | None = None
    market_cap: float | None = None
    shares_outstanding: float | None = None
    currency: str | None = None
    beta: float | None = None
    sector: str | None = None
    industry: str | None = None
    exchange: str | None = None
    source: str | None = None
    fetched_at_ms: int | None = None
    fallback_used: bool | None = None
    notes: str | None = None
    debt: float | None = None
    cash: float | None = None
    net_debt: float | None = None
    enterprise_value: float | None = None


class UnifiedCompanyResponse(WireModel):
    profile: CompanyProfile
    financials_native: NativeFinancials
    canonical_financials: CanonicalFinancials
    model_eligibility: ModelEligibility
    market: MarketSnapshot
    market_context: ValuationContext
    valuation_context: ValuationContext
    peers: list[dict[str, Any]]
    insider_trades: list[dict[str, Any]]
    data_quality: dict[str, DataQualityEntry]
    completeness: Completeness
    source_metadata: dict[str, str]


ExportNumber = StrictInt | StrictFloat | None


class ExportWireModel(BaseModel):
    model_config = ConfigDict(
        extra="allow",
        populate_by_name=True,
        alias_generator=_camel_case,
        allow_inf_nan=False,
    )


class ExportCompany(ExportWireModel):
    name: str
    ticker: str
    currency: str
    units_scale: Literal["units", "thousands", "millions", "billions"]
    as_of_date: str
    exchange: str | None = None
    cik: str | None = None
    fiscal_year_end: str | None = None
    sector: str | None = None
    industry: str | None = None
    operating_archetype: OperatingArchetype | None = None


class ExportMarket(ExportWireModel):
    current_price: ExportNumber = None
    shares_diluted: ExportNumber = None
    market_cap: ExportNumber = None
    net_debt: ExportNumber = None
    cash: ExportNumber = None
    debt: ExportNumber = None
    minority_interest: ExportNumber = None
    preferred_equity: ExportNumber = None
    non_operating_assets: ExportNumber = None


class HistoricalFinancials(ExportWireModel):
    years: list[int]
    income: dict[str, list[ExportNumber]]
    balance: dict[str, list[ExportNumber]]
    cashflow: dict[str, list[ExportNumber]]


class ExportWacc(ExportWireModel):
    rf: StrictFloat | StrictInt
    erp: StrictFloat | StrictInt
    beta: StrictFloat | StrictInt
    beta_source: str | None = None
    size_premium: ExportNumber = None
    cost_of_debt: ExportNumber = None
    debt_weight: ExportNumber = None
    equity_weight: ExportNumber = None


class ExportTerminal(ExportWireModel):
    method: Literal["Perpetuity", "ExitMultiple", "Both"]
    g: ExportNumber = None
    exit_multiple: ExportNumber = None
    exit_metric: Literal["EBITDA", "EBIT"] | None = None


class ExportAssumptions(ExportWireModel):
    scenario_mode: Literal["Conservative", "Base", "Aggressive"]
    horizon_years: int = Field(ge=1, le=15)
    revenue_method: Literal["TopDown", "BottomUp"]
    tax_rate: StrictFloat | StrictInt
    capex_method: Literal["%Revenue", "Absolute"]
    da_method: Literal["%Revenue", "%PPE", "HistoricalRatio"]
    wc_method: Literal["NWC_%Revenue", "Days"]
    wacc: ExportWacc
    terminal: ExportTerminal
    advanced_mode: bool = False
    revenue_growth_stage1: ExportNumber = None
    revenue_growth_stage2: ExportNumber = None
    revenue_growth_stage3: ExportNumber = None
    revenue_growth_stage1_years: StrictInt = Field(default=3, ge=1, le=15)
    revenue_growth_fade_years: StrictInt = Field(default=4, ge=1, le=15)
    ebit_margin_steady_state: ExportNumber = None
    ebit_margin_convergence_years: StrictInt = Field(default=5, ge=1, le=15)

    @model_validator(mode="after")
    def validate_advanced_operating_drivers(self) -> ExportAssumptions:
        if self.advanced_mode and any(value is None for value in (
            self.revenue_growth_stage1,
            self.revenue_growth_stage2,
            self.ebit_margin_steady_state,
        )):
            raise ValueError("advanced DCF assumptions require both revenue growth stages and a steady-state EBIT margin")
        return self


class BankModelExportAssumptions(ExportWireModel):
    forecast_years: StrictInt = Field(ge=1, le=10)
    earning_asset_growth: StrictFloat | StrictInt
    loan_growth: StrictFloat | StrictInt
    deposit_growth: StrictFloat | StrictInt
    earning_asset_yield: StrictFloat | StrictInt
    funding_cost: StrictFloat | StrictInt
    noninterest_income_growth: StrictFloat | StrictInt
    efficiency_ratio: StrictFloat | StrictInt
    provision_rate: StrictFloat | StrictInt
    tax_rate: StrictFloat | StrictInt
    payout_ratio: StrictFloat | StrictInt
    minimum_cet1_ratio: StrictFloat | StrictInt | None
    minimum_cet1_ratio_source: str
    risk_free_rate: StrictFloat | StrictInt
    risk_free_rate_source: str
    equity_risk_premium: StrictFloat | StrictInt
    equity_risk_premium_source: str
    beta: StrictFloat | StrictInt
    beta_source: str
    market_data_as_of_date: str
    terminal_growth_rate: StrictFloat | StrictInt
    current_price: StrictFloat | StrictInt
    diluted_shares_outstanding: StrictFloat | StrictInt
    assumption_sources: dict[str, str]

    @model_validator(mode="after")
    def validate_market_inputs(self) -> BankModelExportAssumptions:
        if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", self.market_data_as_of_date):
            raise ValueError("market_data_as_of_date must be an ISO date")
        for name, source in (
            ("minimum_cet1_ratio_source", self.minimum_cet1_ratio_source),
            ("risk_free_rate_source", self.risk_free_rate_source),
            ("equity_risk_premium_source", self.equity_risk_premium_source),
            ("beta_source", self.beta_source),
        ):
            if not source.strip() or re.search(r"\b(default|stale|unavailable)\b", source, re.IGNORECASE):
                raise ValueError(f"{name} must identify a current source")
        for name in (
            "earningAssetGrowth", "loanGrowth", "depositGrowth", "earningAssetYield", "fundingCost",
            "noninterestIncomeGrowth", "efficiencyRatio", "provisionRate", "taxRate", "payoutRatio",
            "terminalGrowthRate",
        ):
            source = self.assumption_sources.get(name, "")
            if not source.strip() or re.search(r"\b(default|stale|unavailable)\b", source, re.IGNORECASE):
                raise ValueError(f"assumption_sources.{name} must identify a source or explicit analyst input")
        if self.current_price <= 0 or self.diluted_shares_outstanding <= 0:
            raise ValueError("current price and diluted shares must be positive")
        return self


class BankModelExportHistoryYear(ExportWireModel):
    year: StrictInt
    bank: BankCanonicalFinancials
    total_revenue: CanonicalFinancialLine
    net_income: CanonicalFinancialLine
    tax_rate: CanonicalFinancialLine


class BankModelExportHistory(ExportWireModel):
    years: list[StrictInt]
    annual: list[BankModelExportHistoryYear]

    @model_validator(mode="after")
    def validate_alignment(self) -> BankModelExportHistory:
        if not self.years or len(self.years) != len(self.annual):
            raise ValueError("bank history annual rows must align with years")
        if [row.year for row in self.annual] != self.years:
            raise ValueError("bank history annual years must match the ordered year list")
        return self


class BankModelExportData(ExportWireModel):
    history: BankModelExportHistory
    assumptions: BankModelExportAssumptions


class InsuranceModelExportAssumptions(ExportWireModel):
    forecast_years: StrictInt = Field(ge=1, le=10)
    premium_growth: StrictFloat | StrictInt
    loss_ratio: StrictFloat | StrictInt
    expense_ratio: StrictFloat | StrictInt
    prior_year_reserve_development_rate: StrictFloat | StrictInt
    net_investment_income_yield: StrictFloat | StrictInt
    invested_asset_growth: StrictFloat | StrictInt
    paid_loss_ratio: StrictFloat | StrictInt
    reserve_other_changes_rate: StrictFloat | StrictInt
    other_operations_pretax_growth: StrictFloat | StrictInt
    other_pretax_adjustment_growth: StrictFloat | StrictInt
    tax_rate: StrictFloat | StrictInt
    payout_ratio: StrictFloat | StrictInt
    minimum_statutory_capital_to_premium_ratio: StrictFloat | StrictInt
    minimum_statutory_capital_source: str
    risk_free_rate: StrictFloat | StrictInt
    risk_free_rate_source: str
    equity_risk_premium: StrictFloat | StrictInt
    equity_risk_premium_source: str
    beta: StrictFloat | StrictInt
    beta_source: str
    market_data_as_of_date: str
    terminal_growth_rate: StrictFloat | StrictInt
    current_price: StrictFloat | StrictInt
    diluted_shares_outstanding: StrictFloat | StrictInt
    assumption_sources: dict[str, str]

    @model_validator(mode="after")
    def validate_market_inputs(self) -> InsuranceModelExportAssumptions:
        if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", self.market_data_as_of_date):
            raise ValueError("market_data_as_of_date must be an ISO date")
        for name, source in (
            ("minimum_statutory_capital_source", self.minimum_statutory_capital_source),
            ("risk_free_rate_source", self.risk_free_rate_source),
            ("equity_risk_premium_source", self.equity_risk_premium_source),
            ("beta_source", self.beta_source),
        ):
            if not source.strip() or re.search(r"\b(default|stale|unavailable)\b", source, re.IGNORECASE):
                raise ValueError(f"{name} must identify a current source")
        for name, source in self.assumption_sources.items():
            if not source.strip() or re.search(r"\b(default|stale|unavailable)\b", source, re.IGNORECASE):
                raise ValueError(f"assumption_sources.{name} must identify a source or explicit analyst input")
        if self.current_price <= 0 or self.diluted_shares_outstanding <= 0:
            raise ValueError("current price and diluted shares must be positive")
        return self


class InsuranceModelExportHistoryYear(ExportWireModel):
    year: StrictInt
    insurance: InsuranceCanonicalFinancials
    total_revenue: CanonicalFinancialLine
    net_income: CanonicalFinancialLine
    tax_rate: CanonicalFinancialLine


class InsuranceModelExportHistory(ExportWireModel):
    years: list[StrictInt]
    annual: list[InsuranceModelExportHistoryYear]

    @model_validator(mode="after")
    def validate_alignment(self) -> InsuranceModelExportHistory:
        if not self.years or len(self.years) != len(self.annual):
            raise ValueError("insurance history annual rows must align with years")
        if [row.year for row in self.annual] != self.years:
            raise ValueError("insurance history annual years must match the ordered year list")
        return self


class InsuranceModelExportData(ExportWireModel):
    history: InsuranceModelExportHistory
    assumptions: InsuranceModelExportAssumptions


class ReitModelExportAssumptions(ExportWireModel):
    forecast_years: StrictInt = Field(ge=1, le=10)
    same_store_noi_growth: StrictFloat | StrictInt | None
    target_occupancy: StrictFloat | StrictInt
    recurring_capex_ratio: StrictFloat | StrictInt
    payout_ratio: StrictFloat | StrictInt
    terminal_growth_rate: StrictFloat | StrictInt
    nav_cap_rate: StrictFloat | StrictInt
    risk_free_rate: StrictFloat | StrictInt
    risk_free_rate_source: str
    equity_risk_premium: StrictFloat | StrictInt
    equity_risk_premium_source: str
    beta: StrictFloat | StrictInt
    beta_source: str
    market_capitalization: StrictFloat | StrictInt
    market_data_as_of_date: str
    current_price: StrictFloat | StrictInt
    diluted_shares_outstanding: StrictFloat | StrictInt
    assumption_sources: dict[str, str]

    @model_validator(mode="after")
    def validate_market_inputs(self) -> ReitModelExportAssumptions:
        if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", self.market_data_as_of_date):
            raise ValueError("market_data_as_of_date must be an ISO date")
        for name, source in (
            ("risk_free_rate_source", self.risk_free_rate_source),
            ("equity_risk_premium_source", self.equity_risk_premium_source),
            ("beta_source", self.beta_source),
        ):
            if not source.strip() or re.search(r"\b(default|stale|unavailable)\b", source, re.IGNORECASE):
                raise ValueError(f"{name} must identify a current source")
        for name, source in self.assumption_sources.items():
            if not source.strip() or re.search(r"\b(default|stale|unavailable)\b", source, re.IGNORECASE):
                raise ValueError(f"assumption_sources.{name} must identify a source or explicit analyst input")
        if self.current_price <= 0 or self.diluted_shares_outstanding <= 0 or self.market_capitalization <= 0:
            raise ValueError("current price, diluted shares, and market capitalization must be positive")
        return self


class ReitModelExportHistoryYear(ExportWireModel):
    year: StrictInt
    reit: ReitCanonicalFinancials
    net_income: CanonicalFinancialLine
    common_equity: CanonicalFinancialLine
    cash: CanonicalFinancialLine
    long_term_debt: CanonicalFinancialLine
    preferred_equity: CanonicalFinancialLine
    non_controlling_interest: CanonicalFinancialLine
    diluted_shares: CanonicalFinancialLine


class ReitModelExportHistory(ExportWireModel):
    years: list[StrictInt]
    annual: list[ReitModelExportHistoryYear]

    @model_validator(mode="after")
    def validate_alignment(self) -> ReitModelExportHistory:
        if not self.years or len(self.years) != len(self.annual):
            raise ValueError("REIT history annual rows must align with fiscal years")
        if [row.year for row in self.annual] != self.years:
            raise ValueError("REIT history annual years must match the ordered year list")
        return self


class ReitModelExportData(ExportWireModel):
    history: ReitModelExportHistory
    assumptions: ReitModelExportAssumptions


class AssetManagerModelExportAssumptions(ExportWireModel):
    forecast_years: StrictInt = Field(ge=1, le=10)
    base_year: StrictInt
    as_of_date: str
    market_return_rate: StrictFloat | StrictInt
    net_flow_rate: StrictFloat | StrictInt
    realizations_rate: StrictFloat | StrictInt
    acquisition_rate: StrictFloat | StrictInt
    fx_change_rate: StrictFloat | StrictInt
    scope_change_rate: StrictFloat | StrictInt
    base_fee_yield: StrictFloat | StrictInt | None
    performance_fee_yield: StrictFloat | StrictInt
    capital_allocation_yield: StrictFloat | StrictInt
    securities_lending_yield: StrictFloat | StrictInt
    technology_revenue_base: StrictFloat | StrictInt
    technology_revenue_growth: StrictFloat | StrictInt
    distribution_fee_yield: StrictFloat | StrictInt
    administrative_other_revenue_growth: StrictFloat | StrictInt
    other_revenue_growth: StrictFloat | StrictInt
    unmapped_revenue_growth: StrictFloat | StrictInt
    operating_margin: StrictFloat | StrictInt
    tax_rate: StrictFloat | StrictInt
    depreciation_pct_revenue: StrictFloat | StrictInt
    acquisition_amortization_pct_revenue: StrictFloat | StrictInt
    capex_pct_revenue: StrictFloat | StrictInt
    working_capital_change_pct_revenue: StrictFloat | StrictInt
    risk_free_rate: StrictFloat | StrictInt
    equity_risk_premium: StrictFloat | StrictInt
    beta: StrictFloat | StrictInt
    cost_of_debt: StrictFloat | StrictInt
    debt_weight: StrictFloat | StrictInt
    equity_weight: StrictFloat | StrictInt
    wacc: StrictFloat | StrictInt
    terminal_growth_rate: StrictFloat | StrictInt
    current_price: StrictFloat | StrictInt
    market_capitalization: StrictFloat | StrictInt
    diluted_shares: StrictFloat | StrictInt
    cash: StrictFloat | StrictInt
    marketable_securities: StrictFloat | StrictInt
    debt: StrictFloat | StrictInt
    non_controlling_interest: StrictFloat | StrictInt
    preferred_equity: StrictFloat | StrictInt
    assumption_sources: dict[str, str]

    @model_validator(mode="after")
    def validate_model_assumptions(self) -> AssetManagerModelExportAssumptions:
        if self.forecast_years != 5:
            raise ValueError("asset-manager model workbook requires a five-year forecast")
        if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", self.as_of_date):
            raise ValueError("asset-manager as_of_date must be an ISO date")
        if self.terminal_growth_rate < 0 or self.terminal_growth_rate > 0.08 or self.terminal_growth_rate >= self.wacc:
            raise ValueError("asset-manager terminal growth must be between 0% and 8% and below WACC")
        if self.current_price <= 0 or self.market_capitalization <= 0 or self.diluted_shares <= 0:
            raise ValueError("asset-manager current price, market capitalization, and diluted shares must be positive")
        if self.technology_revenue_base < 0:
            raise ValueError("asset-manager technology revenue base cannot be negative")
        if self.operating_margin <= 0 or self.operating_margin > 1 or self.tax_rate < 0 or self.tax_rate > 0.5:
            raise ValueError("asset-manager operating margin or tax rate is outside supported bounds")
        required_sources = {
            "marketReturnRate", "netFlowRate", "realizationsRate", "acquisitionRate", "fxChangeRate", "scopeChangeRate",
            "baseFeeYield", "performanceFeeYield", "capitalAllocationYield", "securitiesLendingYield",
            "technologyRevenueBase", "technologyRevenueGrowth", "distributionFeeYield", "administrativeOtherRevenueGrowth", "otherRevenueGrowth",
            "unmappedRevenueGrowth", "operatingMargin", "taxRate", "depreciationPctRevenue",
            "acquisitionAmortizationPctRevenue", "capexPctRevenue", "workingCapitalChangePctRevenue", "costOfDebt", "wacc", "terminalGrowthRate",
        }
        if not required_sources.issubset(self.assumption_sources):
            raise ValueError("asset-manager assumption_sources is missing one or more driver disclosures")
        if any(not source.strip() or re.search(r"\b(default|stale|unavailable)\b", source, re.IGNORECASE)
            for source in self.assumption_sources.values()):
            raise ValueError("asset-manager assumption sources must be current or explicitly identified analyst inputs")
        return self


class AssetManagerModelExportHistoryYear(ExportWireModel):
    year: StrictInt
    asset_manager: AssetManagerCanonicalFinancials
    revenue: CanonicalFinancialLine
    ebit: CanonicalFinancialLine
    interest_expense: CanonicalFinancialLine
    income_tax_expense: CanonicalFinancialLine
    tax_rate: CanonicalFinancialLine
    depreciation: CanonicalFinancialLine
    capex: CanonicalFinancialLine
    nwc_change: CanonicalFinancialLine
    cash: CanonicalFinancialLine
    marketable_securities: CanonicalFinancialLine
    debt: CanonicalFinancialLine
    lease_liabilities: CanonicalFinancialLine
    non_controlling_interest: CanonicalFinancialLine
    preferred_equity: CanonicalFinancialLine
    diluted_shares: CanonicalFinancialLine


class AssetManagerModelExportHistory(ExportWireModel):
    years: list[StrictInt]
    annual: list[AssetManagerModelExportHistoryYear]

    @model_validator(mode="after")
    def validate_alignment(self) -> AssetManagerModelExportHistory:
        if len(self.years) != 3 or len(self.annual) != 3 or [row.year for row in self.annual] != self.years:
            raise ValueError("asset-manager history must contain three aligned filed annual periods")
        if any(self.years[index] != self.years[index - 1] + 1 for index in range(1, len(self.years))):
            raise ValueError("asset-manager history must contain three consecutive fiscal years")
        return self


class AssetManagerModelExportData(ExportWireModel):
    history: AssetManagerModelExportHistory
    assumptions: AssetManagerModelExportAssumptions


class TelecomModelExportAssumptions(ExportWireModel):
    forecast_years: StrictInt
    base_year: StrictInt
    as_of_date: str
    postpaid_gross_add_rate: StrictFloat | StrictInt | None
    postpaid_phone_monthly_churn: StrictFloat | StrictInt | None
    other_wireless_subscriber_growth: StrictFloat | StrictInt
    service_revenue_per_subscriber_growth: StrictFloat | StrictInt
    equipment_revenue_per_subscriber_growth: StrictFloat | StrictInt
    broadband_net_additions_rate: StrictFloat | StrictInt
    broadband_revenue_per_connection_growth: StrictFloat | StrictInt
    consumer_non_broadband_revenue_growth: StrictFloat | StrictInt
    business_wireline_revenue_growth: StrictFloat | StrictInt
    latin_america_revenue_growth: StrictFloat | StrictInt
    other_revenue_growth: StrictFloat | StrictInt
    mobility_operating_margin: StrictFloat | StrictInt
    business_wireline_operating_margin: StrictFloat | StrictInt
    consumer_wireline_operating_margin: StrictFloat | StrictInt
    latin_america_operating_margin: StrictFloat | StrictInt
    unallocated_operating_income_margin: StrictFloat | StrictInt
    tax_rate: StrictFloat | StrictInt
    depreciation_pct_revenue: StrictFloat | StrictInt
    capex_pct_revenue: StrictFloat | StrictInt
    working_capital_change_pct_revenue: StrictFloat | StrictInt
    risk_free_rate: StrictFloat | StrictInt
    equity_risk_premium: StrictFloat | StrictInt
    beta: StrictFloat | StrictInt
    cost_of_debt: StrictFloat | StrictInt
    debt_weight: StrictFloat | StrictInt
    equity_weight: StrictFloat | StrictInt
    wacc: StrictFloat | StrictInt
    terminal_growth_rate: StrictFloat | StrictInt
    current_price: StrictFloat | StrictInt
    market_capitalization: StrictFloat | StrictInt
    diluted_shares: StrictFloat | StrictInt
    cash: StrictFloat | StrictInt
    marketable_securities: StrictFloat | StrictInt
    debt: StrictFloat | StrictInt
    non_controlling_interest: StrictFloat | StrictInt
    preferred_equity: StrictFloat | StrictInt
    assumption_sources: dict[str, str]

    @model_validator(mode="after")
    def validate_telecom_assumptions(self) -> TelecomModelExportAssumptions:
        if self.forecast_years != 5:
            raise ValueError("telecom model workbook requires a five-year forecast")
        if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", self.as_of_date):
            raise ValueError("telecom as_of_date must be an ISO date")
        if self.terminal_growth_rate < 0 or self.terminal_growth_rate > 0.08 or self.terminal_growth_rate >= self.wacc:
            raise ValueError("telecom terminal growth must be between 0% and 8% and below WACC")
        if (self.postpaid_gross_add_rate is not None and self.postpaid_gross_add_rate < 0) or (
            self.postpaid_phone_monthly_churn is not None
            and (self.postpaid_phone_monthly_churn <= 0 or self.postpaid_phone_monthly_churn >= 0.1)
        ):
            raise ValueError("telecom postpaid additions or monthly churn is outside supported bounds")
        if self.tax_rate < 0 or self.tax_rate > 0.5 or any(
            value < -1 or value > 1 for value in (
                self.mobility_operating_margin, self.business_wireline_operating_margin,
                self.consumer_wireline_operating_margin, self.latin_america_operating_margin,
                self.unallocated_operating_income_margin,
            )
        ):
            raise ValueError("telecom tax rate or segment margin is outside supported bounds")
        if self.current_price <= 0 or self.market_capitalization <= 0 or self.diluted_shares <= 0:
            raise ValueError("telecom current price, market capitalization, and diluted shares must be positive")
        required_sources = {
            "postpaidGrossAddRate", "postpaidPhoneMonthlyChurn", "otherWirelessSubscriberGrowth",
            "serviceRevenuePerSubscriberGrowth", "equipmentRevenuePerSubscriberGrowth", "broadbandNetAdditionsRate",
            "broadbandRevenuePerConnectionGrowth", "consumerNonBroadbandRevenueGrowth", "businessWirelineRevenueGrowth",
            "latinAmericaRevenueGrowth", "otherRevenueGrowth", "mobilityOperatingMargin", "businessWirelineOperatingMargin",
            "consumerWirelineOperatingMargin", "latinAmericaOperatingMargin", "unallocatedOperatingIncomeMargin", "taxRate",
            "depreciationPctRevenue", "capexPctRevenue", "workingCapitalChangePctRevenue", "costOfDebt", "wacc", "terminalGrowthRate",
        }
        if not required_sources.issubset(self.assumption_sources):
            raise ValueError("telecom assumption_sources is missing one or more driver disclosures")
        if any(not source.strip() or re.search(r"\b(default|stale|unavailable)\b", source, re.IGNORECASE)
            for source in self.assumption_sources.values()):
            raise ValueError("telecom assumptions require filed sources or explicit analyst-input disclosures")
        return self


class TelecomModelExportHistoryYear(ExportWireModel):
    year: StrictInt
    telecom: TelecomCanonicalFinancials
    revenue: CanonicalFinancialLine
    ebit: CanonicalFinancialLine
    interest_expense: CanonicalFinancialLine
    tax_rate: CanonicalFinancialLine
    depreciation: CanonicalFinancialLine
    capex: CanonicalFinancialLine
    nwc_change: CanonicalFinancialLine
    cash: CanonicalFinancialLine
    marketable_securities: CanonicalFinancialLine
    debt: CanonicalFinancialLine
    non_controlling_interest: CanonicalFinancialLine
    preferred_equity: CanonicalFinancialLine
    diluted_shares: CanonicalFinancialLine


class TelecomModelExportHistory(ExportWireModel):
    years: list[StrictInt]
    annual: list[TelecomModelExportHistoryYear]

    @model_validator(mode="after")
    def validate_alignment(self) -> TelecomModelExportHistory:
        if len(self.years) != 4 or len(self.annual) != 4 or [row.year for row in self.annual] != self.years:
            raise ValueError("telecom history must contain four aligned annual periods for an opening customer balance")
        if any(self.years[index] != self.years[index - 1] + 1 for index in range(1, len(self.years))):
            raise ValueError("telecom history must contain consecutive fiscal years")
        return self


class TelecomModelExportData(ExportWireModel):
    history: TelecomModelExportHistory
    assumptions: TelecomModelExportAssumptions

    @model_validator(mode="after")
    def validate_base_year(self) -> TelecomModelExportData:
        if self.history.years[-1] != self.assumptions.base_year:
            raise ValueError("telecom base year must match the latest filed annual period")
        return self


class MortgageReitModelExportAssumptions(ExportWireModel):
    forecast_years: StrictInt
    base_year: StrictInt
    as_of_date: str
    asset_yield: StrictFloat | StrictInt
    asset_yield_change: StrictFloat | StrictInt
    aggregate_cost_of_funds: StrictFloat | StrictInt
    funding_cost_change: StrictFloat | StrictInt
    average_swap_ratio: StrictFloat | StrictInt
    swap_ratio_change: StrictFloat | StrictInt
    average_swap_net_pay_rate: StrictFloat | StrictInt
    swap_net_pay_rate_change: StrictFloat | StrictInt
    investment_assets_to_common_equity: StrictFloat | StrictInt
    mortgage_borrowings_to_common_equity: StrictFloat | StrictInt
    other_income_pct_average_assets: StrictFloat | StrictInt
    operating_expenses_pct_average_assets: StrictFloat | StrictInt
    preferred_dividend_yield: StrictFloat | StrictInt
    payout_ratio: StrictFloat | StrictInt
    dividend_per_share_growth: StrictFloat | StrictInt
    market_value_change_per_share: StrictFloat | StrictInt
    tax_rate: StrictFloat | StrictInt
    risk_free_rate: StrictFloat | StrictInt
    equity_risk_premium: StrictFloat | StrictInt
    beta: StrictFloat | StrictInt
    cost_of_equity: StrictFloat | StrictInt
    terminal_growth_rate: StrictFloat | StrictInt
    current_price: StrictFloat | StrictInt
    common_shares_outstanding: StrictFloat | StrictInt
    common_book_value_per_share: StrictFloat | StrictInt
    preferred_liquidation_preference: StrictFloat | StrictInt
    cash: StrictFloat | StrictInt
    debt: StrictFloat | StrictInt
    assumption_sources: dict[str, str]

    @model_validator(mode="after")
    def validate_mortgage_reit_assumptions(self) -> MortgageReitModelExportAssumptions:
        if self.forecast_years != 5:
            raise ValueError("mortgage-REIT model workbook requires a five-year forecast")
        if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", self.as_of_date):
            raise ValueError("mortgage-REIT as_of_date must be an ISO date")
        if not 0.02 <= self.cost_of_equity <= 0.4 or not 0 <= self.terminal_growth_rate <= 0.08 or self.terminal_growth_rate >= self.cost_of_equity:
            raise ValueError("mortgage-REIT terminal growth and cost of equity are outside supported bounds")
        if not 0 < self.asset_yield <= 0.2 or not 0 <= self.aggregate_cost_of_funds <= 0.2:
            raise ValueError("mortgage-REIT asset yield or cost of funds is outside supported bounds")
        if any(abs(value) > 0.1 for value in (
            self.asset_yield_change, self.funding_cost_change, self.swap_net_pay_rate_change,
        )):
            raise ValueError("mortgage-REIT annual yield changes cannot exceed 10 percentage points")
        if not 0 <= self.average_swap_ratio <= 2 or not -0.2 <= self.average_swap_net_pay_rate <= 0.2:
            raise ValueError("mortgage-REIT hedge ratio or swap net pay rate is outside supported bounds")
        if abs(self.swap_ratio_change) > 1:
            raise ValueError("mortgage-REIT annual swap ratio change cannot exceed 100 percentage points")
        if self.operating_expenses_pct_average_assets < 0 or self.operating_expenses_pct_average_assets > 0.05:
            raise ValueError("mortgage-REIT operating expense ratio is outside supported bounds")
        if self.preferred_dividend_yield < 0 or self.preferred_dividend_yield > 0.2 or self.payout_ratio < 0 or self.payout_ratio > 2:
            raise ValueError("mortgage-REIT preferred yield or common payout ratio is outside supported bounds")
        if not -0.5 <= self.dividend_per_share_growth <= 0.5 or self.tax_rate < 0 or self.tax_rate > 0.5:
            raise ValueError("mortgage-REIT dividend growth or tax rate is outside supported bounds")
        if self.investment_assets_to_common_equity <= 0 or self.mortgage_borrowings_to_common_equity < 0:
            raise ValueError("mortgage-REIT leverage assumptions must be non-negative")
        if self.current_price <= 0 or self.common_shares_outstanding <= 0 or self.common_book_value_per_share <= 0:
            raise ValueError("mortgage-REIT current price, common shares, and tangible book value must be positive")
        if self.preferred_liquidation_preference < 0 or self.cash < 0 or self.debt < 0:
            raise ValueError("mortgage-REIT preferred equity, cash, or debt cannot be negative")
        required_sources = {
            "assetYield", "fundingCost", "investmentAssetsToCommonEquity", "mortgageBorrowingsToCommonEquity",
            "otherIncomePctAverageAssets", "operatingExpensesPctAverageAssets", "preferredDividendYield", "payoutRatio",
            "dividendPerShareGrowth", "marketValueChangePerShare", "taxRate", "costOfEquity", "terminalGrowthRate",
            "commonSharesOutstanding", "commonBookValuePerShare", "preferredLiquidationPreference", "currentPrice",
            "assetYieldChange", "fundingCostChange", "swapRatio", "swapRatioChange", "swapNetPayRate", "swapNetPayRateChange",
        }
        if not required_sources.issubset(self.assumption_sources) or any(not source.strip() for source in self.assumption_sources.values()):
            raise ValueError("mortgage-REIT assumption sources must disclose each filed or analyst input")
        return self


class MortgageReitModelExportHistoryYear(ExportWireModel):
    year: StrictInt
    mortgage_reit: MortgageReitCanonicalFinancials
    net_income: CanonicalFinancialLine
    tax_rate: CanonicalFinancialLine
    cash: CanonicalFinancialLine
    marketable_securities: CanonicalFinancialLine
    non_controlling_interest: CanonicalFinancialLine
    diluted_shares: CanonicalFinancialLine


class MortgageReitModelExportHistory(ExportWireModel):
    years: list[StrictInt]
    annual: list[MortgageReitModelExportHistoryYear]

    @model_validator(mode="after")
    def validate_alignment(self) -> MortgageReitModelExportHistory:
        if len(self.years) != 4 or len(self.annual) != 4 or [row.year for row in self.annual] != self.years:
            raise ValueError("mortgage-REIT history must contain four aligned annual periods including opening book value")
        if any(self.years[index] != self.years[index - 1] + 1 for index in range(1, len(self.years))):
            raise ValueError("mortgage-REIT history must contain four consecutive fiscal years")
        return self


class MortgageReitModelExportData(ExportWireModel):
    history: MortgageReitModelExportHistory
    assumptions: MortgageReitModelExportAssumptions

    @model_validator(mode="after")
    def validate_base_year(self) -> MortgageReitModelExportData:
        if self.history.years[-1] != self.assumptions.base_year:
            raise ValueError("mortgage-REIT base year must match the latest filed annual period")
        return self


class IntegratedEnergyModelExportAssumptions(ExportWireModel):
    forecast_years: StrictInt
    base_year: StrictInt
    as_of_date: str
    crude_price: StrictFloat | StrictInt
    ngl_price: StrictFloat | StrictInt
    bitumen_price: StrictFloat | StrictInt
    synthetic_oil_price: StrictFloat | StrictInt
    natural_gas_price: StrictFloat | StrictInt
    crude_price_change: StrictFloat | StrictInt
    ngl_price_change: StrictFloat | StrictInt
    bitumen_price_change: StrictFloat | StrictInt
    synthetic_oil_price_change: StrictFloat | StrictInt
    natural_gas_price_change: StrictFloat | StrictInt
    liquids_production_growth: StrictFloat | StrictInt
    natural_gas_production_growth: StrictFloat | StrictInt
    production_cost_per_boe: StrictFloat | StrictInt
    production_cost_change_per_boe: StrictFloat | StrictInt
    upstream_earnings_conversion_factor: StrictFloat | StrictInt | None
    base_upstream_earnings: StrictFloat | StrictInt
    base_gross_production_margin: StrictFloat | StrictInt | None
    base_energy_products_earnings: StrictFloat | StrictInt
    base_chemical_products_earnings: StrictFloat | StrictInt
    base_specialty_products_earnings: StrictFloat | StrictInt
    energy_products_earnings_growth: StrictFloat | StrictInt
    chemical_products_earnings_growth: StrictFloat | StrictInt
    specialty_products_earnings_growth: StrictFloat | StrictInt
    base_corporate_operating_earnings: StrictFloat | StrictInt
    corporate_operating_earnings_growth: StrictFloat | StrictInt
    base_revenue: StrictFloat | StrictInt
    revenue_growth: StrictFloat | StrictInt
    cash_capex_pct_revenue: StrictFloat | StrictInt
    depreciation_pct_revenue: StrictFloat | StrictInt
    working_capital_investment_pct_revenue: StrictFloat | StrictInt
    reserve_replacement_ratio: StrictFloat | StrictInt
    filed_brent_sensitivity: StrictFloat | StrictInt
    filed_henry_hub_sensitivity: StrictFloat | StrictInt
    filed_ttf_sensitivity: StrictFloat | StrictInt = Field(alias="filedTTFSensitivity")
    risk_free_rate: StrictFloat | StrictInt
    equity_risk_premium: StrictFloat | StrictInt
    beta: StrictFloat | StrictInt
    cost_of_debt: StrictFloat | StrictInt
    debt_weight: StrictFloat | StrictInt
    equity_weight: StrictFloat | StrictInt
    wacc: StrictFloat | StrictInt
    terminal_growth_rate: StrictFloat | StrictInt
    current_price: StrictFloat | StrictInt
    market_capitalization: StrictFloat | StrictInt
    common_shares_outstanding: StrictFloat | StrictInt
    cash: StrictFloat | StrictInt
    marketable_securities: StrictFloat | StrictInt
    debt: StrictFloat | StrictInt
    non_controlling_interest: StrictFloat | StrictInt
    preferred_equity: StrictFloat | StrictInt
    tax_rate: StrictFloat | StrictInt
    assumption_sources: dict[str, str]

    @model_validator(mode="after")
    def validate_energy_assumptions(self) -> IntegratedEnergyModelExportAssumptions:
        if self.forecast_years != 5 or not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", self.as_of_date):
            raise ValueError("integrated-energy workbook requires five forecast years and a dated market snapshot")
        if self.wacc < 0.02 or self.wacc > 0.3 or self.terminal_growth_rate < 0 or self.terminal_growth_rate >= self.wacc:
            raise ValueError("integrated-energy WACC must be between 2% and 30% and exceed terminal growth")
        if any(value < -0.5 or value > 0.5 for value in (
            self.liquids_production_growth, self.natural_gas_production_growth, self.revenue_growth,
            self.energy_products_earnings_growth, self.chemical_products_earnings_growth,
            self.specialty_products_earnings_growth, self.corporate_operating_earnings_growth,
        )):
            raise ValueError("integrated-energy annual growth assumptions are outside supported bounds")
        if any(value <= 0 for value in (
            self.crude_price, self.ngl_price, self.bitumen_price, self.synthetic_oil_price,
            self.natural_gas_price, self.production_cost_per_boe,
            self.base_revenue, self.current_price, self.market_capitalization, self.common_shares_outstanding,
        )):
            raise ValueError("integrated-energy operating, market, or share-count inputs must be positive")
        if self.upstream_earnings_conversion_factor is not None and self.upstream_earnings_conversion_factor <= 0:
            raise ValueError("integrated-energy upstream earnings conversion factor must be positive when present")
        if any(value < 0 or value > 0.5 for value in (self.cash_capex_pct_revenue, self.depreciation_pct_revenue)):
            raise ValueError("integrated-energy CapEx or D&A ratio is outside supported bounds")
        if abs(self.working_capital_investment_pct_revenue) > 0.3 or not 0 <= self.reserve_replacement_ratio <= 3:
            raise ValueError("integrated-energy working-capital or reserve assumption is outside supported bounds")
        if self.tax_rate < 0 or self.tax_rate > 0.6 or self.debt_weight < 0 or self.debt_weight > 1 or self.equity_weight < 0 or self.equity_weight > 1:
            raise ValueError("integrated-energy tax rate or capital weights are outside supported bounds")
        required_sources = {
            "crudePriceChange", "nglPriceChange", "bitumenPriceChange", "syntheticOilPriceChange", "naturalGasPriceChange",
            "productionGrowth", "productionCostChangePerBoe", "energyProductsEarningsGrowth", "chemicalProductsEarningsGrowth",
            "specialtyProductsEarningsGrowth", "corporateOperatingEarningsGrowth", "revenueGrowth", "cashCapexPctRevenue",
            "depreciationPctRevenue", "workingCapitalInvestmentPctRevenue", "reserveReplacementRatio",
            "upstreamEarningsConversionFactor", "costOfDebt", "wacc", "marketableSecurities", "terminalGrowthRate",
        }
        if not required_sources.issubset(self.assumption_sources) or any(not source.strip() for source in self.assumption_sources.values()):
            raise ValueError("integrated-energy assumption sources must disclose each filed or analyst input")
        return self


class IntegratedEnergyModelExportHistoryYear(ExportWireModel):
    year: StrictInt
    energy: EnergyCanonicalFinancials
    revenue: CanonicalFinancialLine
    net_income: CanonicalFinancialLine
    interest_expense: CanonicalFinancialLine
    tax_rate: CanonicalFinancialLine
    depreciation: CanonicalFinancialLine
    cash_flow_from_operations: CanonicalFinancialLine
    cash: CanonicalFinancialLine
    current_debt: CanonicalFinancialLine
    long_term_debt: CanonicalFinancialLine
    debt: CanonicalFinancialLine
    marketable_securities: CanonicalFinancialLine
    preferred_equity: CanonicalFinancialLine
    non_controlling_interest: CanonicalFinancialLine
    diluted_shares: CanonicalFinancialLine


class IntegratedEnergyModelExportHistory(ExportWireModel):
    years: list[StrictInt]
    annual: list[IntegratedEnergyModelExportHistoryYear]

    @model_validator(mode="after")
    def validate_alignment(self) -> IntegratedEnergyModelExportHistory:
        if len(self.years) != 3 or len(self.annual) != 3 or [row.year for row in self.annual] != self.years:
            raise ValueError("integrated-energy history must contain three aligned annual periods")
        if any(self.years[index] != self.years[index - 1] + 1 for index in range(1, len(self.years))):
            raise ValueError("integrated-energy history must contain three consecutive fiscal years")
        return self


class IntegratedEnergyModelExportData(ExportWireModel):
    history: IntegratedEnergyModelExportHistory
    assumptions: IntegratedEnergyModelExportAssumptions

    @model_validator(mode="after")
    def validate_base_year(self) -> IntegratedEnergyModelExportData:
        if self.history.years[-1] != self.assumptions.base_year:
            raise ValueError("integrated-energy base year must match latest filed operating actuals")
        return self


class MaturePharmaProductExportAssumption(ExportWireModel):
    product_name: str
    indication: str
    us_patent_expiry_year: StrictInt | None
    major_europe_patent_expiry_year: StrictInt | None
    japan_patent_expiry_year: StrictInt | None
    pending_us_extension_year: StrictInt | None
    modeled_global_loe_year: StrictInt | None
    pre_loe_growth_rate: StrictFloat | StrictInt | None
    first_year_erosion_rate: StrictFloat | StrictInt
    post_loe_annual_erosion_rate: StrictFloat | StrictInt
    source_note: str

    @model_validator(mode="after")
    def validate_product_assumptions(self) -> MaturePharmaProductExportAssumption:
        if not self.product_name.strip() or not self.source_note.strip():
            raise ValueError("PFE product assumptions require a product name and source/analyst note")
        if self.pre_loe_growth_rate is not None and (self.pre_loe_growth_rate < -0.75 or self.pre_loe_growth_rate > 1.5):
            raise ValueError("PFE pre-LOE growth assumption is outside supported bounds")
        if not 0 <= self.first_year_erosion_rate <= 0.95 or not 0 <= self.post_loe_annual_erosion_rate <= 0.75:
            raise ValueError("PFE post-LOE erosion assumption is outside supported bounds")
        return self


class MaturePharmaExportAssumptions(ExportWireModel):
    forecast_years: StrictInt
    base_year: StrictInt
    as_of_date: str
    products: list[MaturePharmaProductExportAssumption]
    other_revenue_base: StrictFloat | StrictInt | None
    other_revenue_growth: StrictFloat | StrictInt | None
    ebit_margin: StrictFloat | StrictInt
    tax_rate: StrictFloat | StrictInt
    depreciation_pct_revenue: StrictFloat | StrictInt
    capex_pct_revenue: StrictFloat | StrictInt
    working_capital_investment_pct_revenue: StrictFloat | StrictInt
    risk_free_rate: StrictFloat | StrictInt
    equity_risk_premium: StrictFloat | StrictInt
    beta: StrictFloat | StrictInt
    cost_of_debt: StrictFloat | StrictInt
    debt_weight: StrictFloat | StrictInt
    equity_weight: StrictFloat | StrictInt
    wacc: StrictFloat | StrictInt
    terminal_growth_rate: StrictFloat | StrictInt
    current_price: StrictFloat | StrictInt
    market_capitalization: StrictFloat | StrictInt
    common_shares_outstanding: StrictFloat | StrictInt
    cash: StrictFloat | StrictInt
    marketable_securities: StrictFloat | StrictInt
    debt: StrictFloat | StrictInt
    non_controlling_interest: StrictFloat | StrictInt
    preferred_equity: StrictFloat | StrictInt
    assumption_sources: dict[str, str]

    @model_validator(mode="after")
    def validate_pharma_assumptions(self) -> MaturePharmaExportAssumptions:
        if self.forecast_years != 5 or not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", self.as_of_date):
            raise ValueError("mature-pharma workbook requires five forecast years and a dated market snapshot")
        if self.wacc < 0.02 or self.wacc > 0.3 or self.terminal_growth_rate < 0 or self.terminal_growth_rate >= self.wacc:
            raise ValueError("mature-pharma WACC must be between 2% and 30% and exceed terminal growth")
        if self.tax_rate < 0 or self.tax_rate > 0.6 or self.ebit_margin <= -0.5 or self.ebit_margin > 0.6:
            raise ValueError("mature-pharma tax or EBIT margin assumption is outside supported bounds")
        if (self.other_revenue_base is not None and self.other_revenue_base < 0) or (
            self.other_revenue_growth is not None and abs(self.other_revenue_growth) > 0.5
        ):
            raise ValueError("mature-pharma other/alliance revenue assumption is outside supported bounds")
        if any(value <= 0 for value in (self.current_price, self.market_capitalization, self.common_shares_outstanding)):
            raise ValueError("mature-pharma market and share-count inputs must be positive")
        required_sources = {
            "productGrowth", "modeledGlobalLoeYear", "firstYearErosionRate", "postLoeAnnualErosionRate",
            "otherRevenueGrowth", "ebitMargin", "taxRate", "depreciationPctRevenue", "capexPctRevenue",
            "workingCapitalInvestmentPctRevenue", "wacc", "terminalGrowthRate", "marketableSecurities",
        }
        if not required_sources.issubset(self.assumption_sources) or any(not source.strip() for source in self.assumption_sources.values()):
            raise ValueError("mature-pharma assumptions require a source/analyst note for each driver")
        return self


class MaturePharmaModelExportHistoryYear(ExportWireModel):
    year: StrictInt
    pharma: PharmaCanonicalFinancials
    revenue: CanonicalFinancialLine
    ebit: CanonicalFinancialLine
    interest_expense: CanonicalFinancialLine
    tax_rate: CanonicalFinancialLine
    depreciation: CanonicalFinancialLine
    capex: CanonicalFinancialLine
    nwc_change: CanonicalFinancialLine
    cash: CanonicalFinancialLine
    marketable_securities: CanonicalFinancialLine
    debt: CanonicalFinancialLine
    non_controlling_interest: CanonicalFinancialLine
    preferred_equity: CanonicalFinancialLine
    diluted_shares: CanonicalFinancialLine


class MaturePharmaModelExportHistory(ExportWireModel):
    years: list[StrictInt]
    annual: list[MaturePharmaModelExportHistoryYear]

    @model_validator(mode="after")
    def validate_alignment(self) -> MaturePharmaModelExportHistory:
        if len(self.years) != 3 or len(self.annual) != 3 or [row.year for row in self.annual] != self.years:
            raise ValueError("mature-pharma history must contain three aligned annual periods")
        if any(self.years[index] != self.years[index - 1] + 1 for index in range(1, len(self.years))):
            raise ValueError("mature-pharma history must contain three consecutive fiscal years")
        return self


class MaturePharmaModelExportData(ExportWireModel):
    history: MaturePharmaModelExportHistory
    assumptions: MaturePharmaExportAssumptions

    @model_validator(mode="after")
    def validate_base_year_and_products(self) -> MaturePharmaModelExportData:
        if self.history.years[-1] != self.assumptions.base_year:
            raise ValueError("mature-pharma base year must match latest filed product actuals")
        names = [product.product_name for product in self.history.annual[-1].pharma.products]
        assumed_names = [product.product_name for product in self.assumptions.products]
        if len(names) != len(set(names)) or set(names) != set(assumed_names):
            raise ValueError("mature-pharma product assumptions must match the latest filed product rows")
        return self


class ExportForecast(ExportWireModel):
    year: int
    revenue: ExportNumber = None
    ebit: ExportNumber = None
    ebitda: ExportNumber = None
    ufcf: ExportNumber = None
    fcff: ExportNumber = None


class ExportUiMeta(ExportWireModel):
    print_date: str | None = None
    warnings: list[str] | None = None
    source_notes: list[str] | None = None


class WorkbookInputRequirement(ExportWireModel):
    key: str = Field(min_length=1)
    label: str = Field(min_length=1)
    input_type: Literal["reported_fact", "market_data", "analyst_assumption"]
    source_status: Literal["missing", "ambiguous", "not_disclosed"]
    reason: str = Field(min_length=1)
    fiscal_year: StrictInt | None = None
    as_of_date: str | None = None
    unit: str | None = None
    minimum_value: ExportNumber = None
    maximum_value: ExportNumber = None
    allowed_values: list[StrictInt] | None = None
    source_reference_required: StrictBool

    @model_validator(mode="after")
    def validate_value_bounds(self) -> WorkbookInputRequirement:
        if self.minimum_value is not None and self.maximum_value is not None and self.minimum_value > self.maximum_value:
            raise ValueError("minimum_value cannot exceed maximum_value")
        if self.allowed_values is not None:
            if not self.allowed_values or len(self.allowed_values) != len(set(self.allowed_values)):
                raise ValueError("allowed_values must be nonempty and unique")
            if any((self.minimum_value is not None and value < self.minimum_value)
                or (self.maximum_value is not None and value > self.maximum_value) for value in self.allowed_values):
                raise ValueError("allowed_values must stay within numeric bounds")
        return self


class ComparableModelExportData(ExportWireModel):
    method: Literal["ev_ebitda", "revenue_multiple"]
    target_metric: StrictFloat | StrictInt = Field(gt=0)
    selected_multiple: StrictFloat | StrictInt = Field(gt=0)
    peer_status: Literal["live", "cached"]
    peer_source: str
    peer_fallback_used: StrictBool
    peer_fetched_at_ms: StrictInt = Field(gt=0)


class IncompleteComparableModelExportData(ExportWireModel):
    method: Literal["ev_ebitda", "revenue_multiple"]
    target_metric: StrictFloat | StrictInt = Field(gt=0)
    peer_status: Literal["live", "cached"]
    peer_source: str
    peer_fallback_used: StrictBool
    peer_fetched_at_ms: StrictInt = Field(gt=0)

    @model_validator(mode="after")
    def validate_current_peer_source(self) -> IncompleteComparableModelExportData:
        if any(token in self.peer_source.lower() for token in ("default", "stale", "unavailable")):
            raise ValueError("incomplete comparable exports require a current peer source")
        age_ms = int(time.time() * 1000) - self.peer_fetched_at_ms
        if age_ms < 0 or age_ms > 24 * 60 * 60 * 1000:
            raise ValueError("comparable peer data must be no more than 24 hours old")
        return self


class UtilityModelExportAssumptions(ExportWireModel):
    base_year: StrictInt
    base_rate_base: StrictFloat | StrictInt = Field(gt=0)
    authorized_equity_ratio: StrictFloat | StrictInt = Field(gt=0, lt=1)
    allowed_roe: StrictFloat | StrictInt = Field(gt=0, le=0.5)
    rate_base_additions: list[StrictFloat | StrictInt] = Field(min_length=5, max_length=5)
    rate_base_depreciation: list[StrictFloat | StrictInt] = Field(min_length=5, max_length=5)
    dividend_payout_ratio: StrictFloat | StrictInt = Field(ge=0, le=1)
    risk_free_rate: StrictFloat | StrictInt = Field(gt=0, le=0.3)
    equity_risk_premium: StrictFloat | StrictInt = Field(gt=0, le=0.3)
    beta: StrictFloat | StrictInt = Field(gt=0, le=5)
    terminal_growth_rate: StrictFloat | StrictInt = Field(ge=-0.05, le=0.1)
    current_price: StrictFloat | StrictInt = Field(gt=0)
    diluted_shares: StrictFloat | StrictInt = Field(gt=0)
    as_of_date: str
    assumption_sources: dict[str, str]

    @model_validator(mode="after")
    def validate_utility_ddm(self) -> UtilityModelExportAssumptions:
        cost_of_equity = self.risk_free_rate + self.beta * self.equity_risk_premium
        if self.terminal_growth_rate >= cost_of_equity:
            raise ValueError("utility terminal growth must remain below the CAPM cost of equity")
        if any(value < 0 for value in (*self.rate_base_additions, *self.rate_base_depreciation)):
            raise ValueError("utility rate-base additions and depreciation cannot be negative")
        if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", self.as_of_date):
            raise ValueError("utility market assumptions require an ISO as-of date")
        if not self.assumption_sources or any(not source.strip() for source in self.assumption_sources.values()):
            raise ValueError("utility assumptions require a source or analyst-basis note")
        return self


class UtilityModelExportData(ExportWireModel):
    assumptions: UtilityModelExportAssumptions


class IncompleteUtilityModelExportData(ExportWireModel):
    base_year: StrictInt
    forecast_years: Literal[5]
    risk_free_rate: StrictFloat | StrictInt | None = Field(default=None, gt=0, le=0.3)
    equity_risk_premium: StrictFloat | StrictInt | None = Field(default=None, gt=0, le=0.3)
    beta: StrictFloat | StrictInt | None = Field(default=None, gt=0, le=5)
    current_price: StrictFloat | StrictInt | None = Field(default=None, gt=0)
    diluted_shares: StrictFloat | StrictInt | None = Field(default=None, gt=0)
    as_of_date: str
    assumption_sources: dict[str, str]

    @model_validator(mode="after")
    def validate_utility_market_inputs(self) -> IncompleteUtilityModelExportData:
        if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", self.as_of_date):
            raise ValueError("incomplete utility workbook requires a dated market snapshot")
        source_keys = {
            "risk_free_rate": "riskFreeRate",
            "equity_risk_premium": "equityRiskPremium",
            "beta": "beta",
            "current_price": "currentPrice",
            "diluted_shares": "dilutedShares",
        }
        for field, source_key in source_keys.items():
            value = getattr(self, field)
            if value is not None and not self.assumption_sources.get(source_key, "").strip():
                raise ValueError(f"incomplete utility workbook requires a source note for {field}")
        return self


class BiotechAssetRnpvExportInput(ExportWireModel):
    asset_id: str = Field(min_length=1)
    include: Literal[0, 1]
    launch_year: StrictInt
    peak_sales: StrictFloat | StrictInt = Field(ge=0)
    years_to_peak: StrictInt = Field(ge=1, le=10)
    exclusivity_year: StrictInt
    post_loe_erosion: StrictFloat | StrictInt = Field(ge=0, le=0.99)
    probability_of_success: StrictFloat | StrictInt = Field(ge=0, le=1)
    retained_share: StrictFloat | StrictInt = Field(ge=0, le=1)
    contribution_margin: StrictFloat | StrictInt = Field(ge=-1, le=1)
    development_cost_pv: StrictFloat | StrictInt = Field(ge=0)


class BiotechModelExportAssumptions(ExportWireModel):
    base_year: StrictInt
    commercial_revenue_base: StrictFloat | StrictInt = Field(gt=0)
    commercial_revenue_growth: list[StrictFloat | StrictInt] = Field(min_length=10, max_length=10)
    commercial_fcf_margin: StrictFloat | StrictInt = Field(ge=-1, le=1)
    other_pipeline_rnpv: StrictFloat | StrictInt
    terminal_growth_rate: StrictFloat | StrictInt = Field(ge=0, le=0.1)
    risk_free_rate: StrictFloat | StrictInt = Field(gt=0, le=0.3)
    equity_risk_premium: StrictFloat | StrictInt = Field(gt=0, le=0.3)
    beta: StrictFloat | StrictInt = Field(gt=0, le=5)
    cost_of_debt: StrictFloat | StrictInt = Field(ge=0, le=0.3)
    normalized_tax_rate: StrictFloat | StrictInt = Field(ge=0, le=0.6)
    market_capitalization: StrictFloat | StrictInt = Field(gt=0)
    diluted_shares: StrictFloat | StrictInt = Field(gt=0)
    current_price: StrictFloat | StrictInt = Field(gt=0)
    cash: StrictFloat | StrictInt = Field(ge=0)
    marketable_securities: StrictFloat | StrictInt = Field(ge=0)
    debt: StrictFloat | StrictInt = Field(ge=0)
    preferred_equity: StrictFloat | StrictInt = Field(ge=0)
    non_controlling_interest: StrictFloat | StrictInt = Field(ge=0)
    assets: list[BiotechAssetRnpvExportInput] = Field(min_length=1)
    as_of_date: str
    assumption_sources: dict[str, str]

    @model_validator(mode="after")
    def validate_biotech_rnpv(self) -> BiotechModelExportAssumptions:
        if any(growth < -0.95 or growth > 2 for growth in self.commercial_revenue_growth):
            raise ValueError("biotech commercial revenue growth must be between -95% and 200%")
        cost_of_equity = self.risk_free_rate + self.beta * self.equity_risk_premium
        capital = self.market_capitalization + self.debt
        if capital <= 0:
            raise ValueError("biotech market equity and debt must form a positive capital structure")
        equity_weight = self.market_capitalization / capital
        debt_weight = self.debt / capital
        wacc = cost_of_equity * equity_weight + self.cost_of_debt * (1 - self.normalized_tax_rate) * debt_weight
        if wacc < 0.02 or wacc > 0.5 or self.terminal_growth_rate >= wacc:
            raise ValueError("biotech WACC must be supported and exceed terminal growth")
        if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", self.as_of_date):
            raise ValueError("biotech model requires a dated market snapshot")
        ids = [asset.asset_id for asset in self.assets]
        if len(ids) != len(set(ids)):
            raise ValueError("biotech asset inputs must have unique source identifiers")
        if not self.assumption_sources or any(not source.strip() for source in self.assumption_sources.values()):
            raise ValueError("biotech model assumptions require source or analyst-basis notes")
        return self


class BiotechModelExportData(ExportWireModel):
    base_year: StrictInt
    forecast_years: Literal[10]
    commercial_revenue_base: StrictFloat | StrictInt = Field(gt=0)
    pipeline_assets: list[PipelineAssetNativeFact] = Field(min_length=5)
    assumptions: BiotechModelExportAssumptions

    @model_validator(mode="after")
    def validate_biotech_source_base(self) -> BiotechModelExportData:
        if self.base_year != self.assumptions.base_year or self.commercial_revenue_base != self.assumptions.commercial_revenue_base:
            raise ValueError("biotech model base year and revenue must match the forecast assumptions")
        if self.forecast_years != 10:
            raise ValueError("biotech model requires a ten-year risk-adjusted forecast")
        return self


class IncompleteBiotechModelExportData(ExportWireModel):
    base_year: StrictInt
    forecast_years: Literal[10]
    commercial_revenue_base: StrictFloat | StrictInt = Field(gt=0)
    risk_free_rate: StrictFloat | StrictInt = Field(gt=0, le=0.3)
    equity_risk_premium: StrictFloat | StrictInt = Field(gt=0, le=0.3)
    beta: StrictFloat | StrictInt = Field(gt=0, le=5)
    pipeline_assets: list[PipelineAssetNativeFact] = Field(min_length=5)
    as_of_date: str
    assumption_sources: dict[str, str]

    @model_validator(mode="after")
    def validate_incomplete_biotech_sources(self) -> IncompleteBiotechModelExportData:
        if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", self.as_of_date):
            raise ValueError("incomplete biotech model requires a dated market snapshot")
        ids = [asset.asset_id for asset in self.pipeline_assets]
        if len(ids) != len(set(ids)):
            raise ValueError("incomplete biotech model requires unique SEC pipeline asset identifiers")
        if any(asset.form != "10-K" or not asset.accession_number or not asset.filing_date for asset in self.pipeline_assets):
            raise ValueError("incomplete biotech asset rows require 10-K source provenance")
        for key in ("riskFreeRate", "equityRiskPremium", "beta", "commercialRevenueBase", "cashDebtBridge"):
            if not self.assumption_sources.get(key, "").strip():
                raise ValueError(f"incomplete biotech model requires a source note for {key}")
        return self


class IncompleteLifeInsuranceModelExportData(ExportWireModel):
    ticker: Literal["MET", "PRU"]
    base_year: StrictInt
    forecast_years: Literal[5]
    earnings_basis: Literal[
        "after_tax_adjusted_earnings_available_to_common",
        "pre_tax_adjusted_operating_income",
    ]
    filing_facts: list[LifeInsuranceFilingFact] = Field(min_length=20)
    risk_free_rate: StrictFloat | StrictInt | None = Field(default=None, gt=0, le=0.3)
    equity_risk_premium: StrictFloat | StrictInt | None = Field(default=None, gt=0, le=0.3)
    beta: StrictFloat | StrictInt | None = Field(default=None, gt=0, le=5)
    current_price: StrictFloat | StrictInt | None = Field(default=None, gt=0)
    diluted_shares: StrictFloat | StrictInt | None = Field(default=None, gt=0)
    as_of_date: str
    assumption_sources: dict[str, str]

    @model_validator(mode="after")
    def validate_life_insurance_source_contract(self) -> IncompleteLifeInsuranceModelExportData:
        expected_basis = "after_tax_adjusted_earnings_available_to_common" if self.ticker == "MET" else "pre_tax_adjusted_operating_income"
        expected_metric = "adjusted_earnings_available_to_common" if self.ticker == "MET" else "adjusted_operating_income_pretax"
        if self.earnings_basis != expected_basis:
            raise ValueError(f"{self.ticker} life-insurance earnings basis does not match its filed measure")
        expected_segments = (
            {"Group Benefits", "RIS", "Asia", "Latin America", "EMEA", "MIM", "Corporate & Other"}
            if self.ticker == "MET" else
            {"PGIM", "Retirement Strategies", "Group Insurance", "Individual Life", "International Businesses", "Corporate and Other"}
        )
        years = sorted({fact.fiscal_year for fact in self.filing_facts if fact.metric == expected_metric})
        if len(years) < 3 or years[-3:] != list(range(self.base_year - 2, self.base_year + 1)):
            raise ValueError("life-insurance source facts must include three consecutive filed earnings years through the base year")
        for year in years[-3:]:
            rows = [fact for fact in self.filing_facts if fact.metric == expected_metric and fact.fiscal_year == year]
            segments = [fact.segment for fact in rows]
            if set(segments) != expected_segments or len(segments) != len(expected_segments):
                raise ValueError(f"life-insurance FY{year} segment earnings coverage is incomplete")
            if any(fact.unit != "USD" or fact.unit_scale != "millions" or fact.earnings_basis != expected_basis for fact in rows):
                raise ValueError(f"life-insurance FY{year} segment earnings definitions or units are inconsistent")
        if self.ticker == "MET":
            capital_ready = any(fact.metric == "statement_based_combined_rbc_ratio_floor" and fact.fiscal_year == self.base_year for fact in self.filing_facts)
            dividend_ready = any(fact.metric == "permitted_ordinary_dividend_without_approval"
                and fact.capital_group == "Metropolitan Life Insurance Company" and fact.fiscal_year == self.base_year + 1 for fact in self.filing_facts)
        else:
            capital_ready = any(fact.metric == "statutory_capital_and_surplus" and fact.capital_group == "PICA" and fact.fiscal_year == self.base_year for fact in self.filing_facts)
            dividend_ready = any(fact.metric == "permitted_ordinary_dividend_without_approval"
                and fact.capital_group.startswith("PICA") and fact.fiscal_year == self.base_year + 1 for fact in self.filing_facts)
        if not capital_ready or not dividend_ready:
            raise ValueError(f"life-insurance statutory capital or dividend source facts are incomplete for {self.ticker}")
        if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", self.as_of_date):
            raise ValueError("life-insurance market context requires an ISO as-of date")
        for key in ("earningsHistory", "capitalDisclosureScope", "riskFreeRate", "equityRiskPremium", "beta", "currentPrice", "dilutedShares"):
            if not self.assumption_sources.get(key, "").strip():
                raise ValueError(f"life-insurance workbook requires a source note for {key}")
        return self


def _biotech_model_asset(asset: PipelineAssetNativeFact) -> bool:
    return asset.development_status != "explicitly_paused" and bool(
        asset.stage and re.search(r"(?:phase\s*(?:[2-3]|1\s*/\s*[2-3])|registrational|regulatory)", asset.stage, re.IGNORECASE)
    )


def _biotech_model_other_asset(asset: PipelineAssetNativeFact) -> bool:
    return not _biotech_model_asset(asset)


class DcfExportRequest(ExportWireModel):
    build_status: Literal["ready", "input_required"] = "ready"
    required_inputs: list[WorkbookInputRequirement] = Field(default_factory=list)
    company: ExportCompany
    market: ExportMarket | None = None
    historicals: HistoricalFinancials | None = None
    canonical_financials: CanonicalFinancials | None = None
    assumptions: ExportAssumptions | None = None
    forecasts: list[ExportForecast] = Field(default_factory=list)
    valuation_model: PreferredModel | None = None
    bank_model: BankModelExportData | None = None
    insurance_model: InsuranceModelExportData | None = None
    reit_model: ReitModelExportData | None = None
    asset_manager_model: AssetManagerModelExportData | None = None
    telecom_model: TelecomModelExportData | None = None
    mortgage_reit_model: MortgageReitModelExportData | None = None
    integrated_energy_model: IntegratedEnergyModelExportData | None = None
    mature_pharma_model: MaturePharmaModelExportData | None = None
    utility_model: UtilityModelExportData | IncompleteUtilityModelExportData | None = None
    biotech_model: BiotechModelExportData | IncompleteBiotechModelExportData | None = None
    life_insurance_model: IncompleteLifeInsuranceModelExportData | None = None
    comparable_model: ComparableModelExportData | IncompleteComparableModelExportData | None = None
    scenarios: dict[str, Any] | None = None
    revenue_build: dict[str, Any] | None = None
    sensitivities: dict[str, Any] | None = None
    comps: list[dict[str, Any]] | None = None
    precedents: list[dict[str, Any]] | None = None
    ui_meta: ExportUiMeta | None = None

    @model_validator(mode="after")
    def require_standard_dcf_forecasts(self) -> DcfExportRequest:
        if self.build_status == "input_required":
            if self.valuation_model is None or self.valuation_model not in PRODUCTION_MODEL_ROUTES:
                raise ValueError("input-required exports need an implemented production model route")
            if not self.required_inputs:
                raise ValueError("input-required exports need at least one required workbook input")
            if self.historicals is None or self.canonical_financials is None:
                raise ValueError("input-required exports need source history and canonical provenance")
            if any(any(value is not None for value in (
                forecast.revenue, forecast.ebit, forecast.ebitda, forecast.ufcf, forecast.fcff,
            )) for forecast in self.forecasts):
                raise ValueError("input-required exports cannot include pre-calculated forecast values")
            has_minimum_cet1_input = any(item.key == "minimum_cet1_ratio" for item in self.required_inputs)
            if self.valuation_model == "bank_residual_income":
                if has_minimum_cet1_input:
                    if self.bank_model is None:
                        raise ValueError("incomplete bank exports need dedicated bank history and assumptions")
                    if self.bank_model.assumptions.minimum_cet1_ratio is not None:
                        raise ValueError("incomplete bank exports must leave minimum_cet1_ratio blank")
                elif self.bank_model is not None:
                    raise ValueError("incomplete bank model payloads require a minimum_cet1_ratio workbook input")
            elif self.bank_model is not None:
                raise ValueError("bank_model is only valid for bank_residual_income exports")
            has_unpaid_loss_reserves_input = any(item.key == "unpaid_loss_reserves" for item in self.required_inputs)
            if self.valuation_model == "insurance_pnc_residual_income":
                if has_unpaid_loss_reserves_input:
                    if self.insurance_model is None:
                        raise ValueError("incomplete P&C exports need dedicated insurance history and assumptions")
                    latest = self.insurance_model.history.annual[-1]
                    if _has_filed_line_value(latest.insurance.unpaid_loss_reserves, latest.year):
                        raise ValueError("incomplete P&C exports must leave latest unpaid_loss_reserves blank")
                elif self.insurance_model is not None:
                    raise ValueError("incomplete P&C model payloads require an unpaid_loss_reserves workbook input")
            elif self.insurance_model is not None:
                raise ValueError("insurance_model is only valid for insurance_pnc_residual_income exports")
            has_same_store_growth_input = any(item.key == "same_store_noi_growth" for item in self.required_inputs)
            if self.valuation_model == "reit_affo":
                if has_same_store_growth_input:
                    if self.reit_model is None:
                        raise ValueError("incomplete REIT exports need dedicated REIT history and assumptions")
                    latest = self.reit_model.history.annual[-1]
                    if self.reit_model.assumptions.same_store_noi_growth is not None:
                        raise ValueError("incomplete REIT exports must leave same_store_noi_growth blank")
                    if _has_filed_value_with_provenance(latest.reit.same_store_noi_growth):
                        raise ValueError("incomplete REIT exports must have a missing or ambiguous latest growth fact")
                elif self.reit_model is not None:
                    raise ValueError("incomplete REIT model payloads require a same_store_noi_growth workbook input")
            elif self.reit_model is not None:
                raise ValueError("reit_model is only valid for reit_affo exports")
            has_average_repo_input = any(item.key == "average_repo_borrowings" for item in self.required_inputs)
            if self.valuation_model == "mortgage_reit_residual_income":
                if has_average_repo_input:
                    if self.mortgage_reit_model is None:
                        raise ValueError("incomplete mortgage REIT exports need dedicated history and assumptions")
                    latest = self.mortgage_reit_model.history.annual[-1]
                    if _has_filed_value_with_provenance(latest.mortgage_reit.average_repo_borrowings):
                        raise ValueError("incomplete mortgage REIT exports must have a missing latest average_repo_borrowings fact")
                elif self.mortgage_reit_model is not None:
                    raise ValueError("incomplete mortgage REIT model payloads require an average_repo_borrowings workbook input")
            elif self.mortgage_reit_model is not None:
                raise ValueError("mortgage_reit_model is only valid for mortgage_reit_residual_income exports")
            missing_base_fee_inputs = [item for item in self.required_inputs if item.key == "base_fee_yield"]
            if self.valuation_model == "asset_manager_aum_dcf":
                if missing_base_fee_inputs:
                    if self.asset_manager_model is None:
                        raise ValueError("incomplete asset-manager exports need dedicated history and assumptions")
                    if self.asset_manager_model.assumptions.base_fee_yield is not None:
                        raise ValueError("incomplete asset-manager exports must leave the three-year base_fee_yield assumption blank")
                    for requirement in missing_base_fee_inputs:
                        annual = next((item for item in self.asset_manager_model.history.annual if item.year == requirement.fiscal_year), None)
                        if annual is None or _has_filed_value_with_provenance(annual.asset_manager.base_fee_yield):
                            raise ValueError(f"incomplete asset-manager export has no missing filed base_fee_yield for FY{requirement.fiscal_year}")
                elif self.asset_manager_model is not None:
                    raise ValueError("incomplete asset-manager model payloads require base_fee_yield workbook inputs")
            elif self.asset_manager_model is not None:
                raise ValueError("asset_manager_model is only valid for asset_manager_aum_dcf exports")
            missing_churn_inputs = [item for item in self.required_inputs if item.key == "postpaid_phone_churn"]
            if self.valuation_model == "telecom_subscriber_dcf":
                if missing_churn_inputs:
                    if self.telecom_model is None:
                        raise ValueError("incomplete telecom exports need dedicated subscriber history and assumptions")
                    if self.telecom_model.assumptions.postpaid_gross_add_rate is not None or self.telecom_model.assumptions.postpaid_phone_monthly_churn is not None:
                        raise ValueError("incomplete telecom exports must leave churn-derived assumptions blank")
                    for requirement in missing_churn_inputs:
                        annual = next((item for item in self.telecom_model.history.annual if item.year == requirement.fiscal_year), None)
                        if annual is None or _has_filed_value_with_provenance(annual.telecom.postpaid_phone_churn):
                            raise ValueError(f"incomplete telecom export has no missing postpaid phone churn for FY{requirement.fiscal_year}")
                elif self.telecom_model is not None:
                    raise ValueError("incomplete telecom model payloads require postpaid_phone_churn inputs")
            elif self.telecom_model is not None:
                raise ValueError("telecom_model is only valid for telecom_subscriber_dcf exports")
            has_crude_production_input = any(item.key == "crude_oil_production" for item in self.required_inputs)
            if self.valuation_model == "integrated_energy_dcf":
                if has_crude_production_input:
                    if self.integrated_energy_model is None:
                        raise ValueError("incomplete integrated-energy exports need dedicated production history and assumptions")
                    if self.integrated_energy_model.assumptions.base_gross_production_margin is not None or self.integrated_energy_model.assumptions.upstream_earnings_conversion_factor is not None:
                        raise ValueError("incomplete integrated-energy exports must withhold crude-derived upstream assumptions")
                    for requirement in (item for item in self.required_inputs if item.key == "crude_oil_production"):
                        annual = next((item for item in self.integrated_energy_model.history.annual if item.year == requirement.fiscal_year), None)
                        if annual is None or _has_filed_line_value(annual.energy.crude_oil_production, annual.year):
                            raise ValueError(f"incomplete integrated-energy export has no missing crude production for FY{requirement.fiscal_year}")
                elif self.integrated_energy_model is not None:
                    raise ValueError("incomplete integrated-energy model payloads require crude_oil_production inputs")
            elif self.integrated_energy_model is not None:
                raise ValueError("integrated_energy_model is only valid for integrated_energy_dcf exports")
            missing_product_inputs = [item for item in self.required_inputs if item.key.startswith("product_revenue:")]
            if self.valuation_model == "mature_pharma_product_dcf":
                if missing_product_inputs:
                    if self.mature_pharma_model is None:
                        raise ValueError("incomplete mature-pharma exports need product history and assumptions")
                    if self.mature_pharma_model.assumptions.other_revenue_growth is not None:
                        raise ValueError("incomplete mature-pharma exports must leave residual growth blank when product sales are missing")
                    for requirement in missing_product_inputs:
                        product_name = requirement.label.split(" — ", 1)[-1]
                        product_key = "product_revenue:" + re.sub(r"[^a-z0-9]+", "_", product_name.lower()).strip("_")
                        year_row = next((item for item in self.mature_pharma_model.history.annual if item.year == requirement.fiscal_year), None)
                        product_line = next((item.revenue for item in year_row.pharma.products if item.product_name == product_name), None) if year_row else None
                        assumption = next((item for item in self.mature_pharma_model.assumptions.products if item.product_name == product_name), None)
                        if product_key != requirement.key or product_line is None or _has_filed_value_with_provenance(product_line):
                            raise ValueError(f"incomplete mature-pharma export has no missing product revenue for {product_name} FY{requirement.fiscal_year}")
                        if assumption is None or assumption.pre_loe_growth_rate is not None:
                            raise ValueError(f"incomplete mature-pharma export must calculate {product_name} growth from restored product revenue")
                elif self.mature_pharma_model is not None:
                    raise ValueError("incomplete mature-pharma model payloads require product_revenue workbook inputs")
            elif self.mature_pharma_model is not None:
                raise ValueError("mature_pharma_model is only valid for mature_pharma_product_dcf exports")
            if self.valuation_model == "utility_dcf":
                if not isinstance(self.utility_model, IncompleteUtilityModelExportData):
                    raise ValueError("incomplete utility exports need a dated source-backed market snapshot")
                base_year = self.utility_model.base_year
                required_periods = {
                    ("jurisdictional_rate_base", base_year),
                    ("allowed_roe", base_year),
                    ("authorized_equity_ratio", base_year),
                    ("dividend_payout_ratio", base_year),
                    ("terminal_growth_rate", None),
                    *{
                        (key, year)
                        for year in range(base_year + 1, base_year + 6)
                        for key in ("rate_base_additions", "rate_base_depreciation")
                    },
                }
                actual_periods = {(item.key, item.fiscal_year) for item in self.required_inputs}
                if not required_periods.issubset(actual_periods):
                    raise ValueError("incomplete utility exports need rate base, regulatory-return, and five-year forecast inputs")
                if self.utility_model.forecast_years != 5:
                    raise ValueError("incomplete utility exports require a five-year rate-base forecast")
            elif self.utility_model is not None:
                raise ValueError("utility_model is only valid for utility_dcf exports")
            if self.valuation_model == "biotech_pipeline_rnpv":
                if not isinstance(self.biotech_model, IncompleteBiotechModelExportData):
                    raise ValueError("incomplete biotech exports need source-backed pipeline rows and a dated market context")
                if self.market is None or any(value is None for value in (
                    self.market.current_price, self.market.shares_diluted, self.market.market_cap,
                    self.market.cash, self.market.debt, self.market.non_operating_assets,
                    self.market.preferred_equity, self.market.minority_interest,
                )):
                    raise ValueError("incomplete biotech exports need a complete source-backed common-equity bridge")
                base_year = self.biotech_model.base_year
                required_periods = {
                    ("commercial_fcf_margin", None),
                    ("unmapped_pipeline_rnpv", None),
                    ("terminal_growth_rate", None),
                    ("biotech_cost_of_debt", None),
                    ("biotech_normalized_tax_rate", None),
                    *{("commercial_revenue_growth", year) for year in range(base_year + 1, base_year + 11)},
                }
                modeled_assets = [asset for asset in self.biotech_model.pipeline_assets if _biotech_model_asset(asset)]
                for asset in modeled_assets:
                    for suffix in (
                        "include", "launch_year", "peak_sales", "years_to_peak", "exclusivity_year",
                        "post_loe_erosion", "probability_of_success", "retained_share",
                        "contribution_margin", "development_cost_pv",
                    ):
                        required_periods.add((f"asset_{suffix}:{asset.asset_id}", None))
                other_assets = [asset for asset in self.biotech_model.pipeline_assets if _biotech_model_other_asset(asset)]
                for asset in other_assets:
                    required_periods.add((f"asset_scope_include:{asset.asset_id}", None))
                    required_periods.add((f"asset_scope_rnpv:{asset.asset_id}", None))
                provided_periods = {(item.key, item.fiscal_year) for item in self.required_inputs}
                if not modeled_assets or not required_periods.issubset(provided_periods):
                    raise ValueError("incomplete biotech exports need a complete commercial and source-disclosed pipeline manifest")
                binary_requirement_keys = {
                    (f"asset_include:{asset.asset_id}", None) for asset in modeled_assets
                } | {
                    (f"asset_scope_include:{asset.asset_id}", None) for asset in other_assets
                }
                binary_requirements = {
                    (item.key, item.fiscal_year): item for item in self.required_inputs
                }
                if any(set(binary_requirements[key].allowed_values or []) != {0, 1} for key in binary_requirement_keys):
                    raise ValueError("biotech asset inclusion inputs must allow only 0 or 1")
            elif self.biotech_model is not None:
                raise ValueError("biotech_model is only valid for biotech_pipeline_rnpv exports")
            if self.valuation_model == "life_insurer_distributable_earnings_dcf":
                if not isinstance(self.life_insurance_model, IncompleteLifeInsuranceModelExportData):
                    raise ValueError("incomplete life-insurance exports need a source-complete MET or PRU filing payload")
                life_model = self.life_insurance_model
                expected_periods = {
                    ("life_parent_cash", None),
                    ("life_parent_cash_reserve", None),
                    ("life_parent_debt", None),
                    ("life_preferred_equity", None),
                    ("life_non_controlling_interest", None),
                    ("terminal_growth_rate", None),
                }
                expected_metric = "adjusted_earnings_available_to_common" if life_model.ticker == "MET" else "adjusted_operating_income_pretax"
                expected_segments = {
                    fact.segment for fact in life_model.filing_facts
                    if fact.metric == expected_metric and fact.fiscal_year == life_model.base_year and fact.segment
                }
                if not expected_segments:
                    raise ValueError("life-insurance exports need source-backed segment earnings for the base year")
                for year in range(life_model.base_year + 1, life_model.base_year + 6):
                    expected_periods.add(("life_net_capital_addition", year))
                    expected_periods.add(("life_permitted_upstream_dividends", year))
                    expected_periods.update((f"life_segment_earnings_growth:{segment}", year) for segment in expected_segments)
                if life_model.ticker == "PRU":
                    expected_periods.add(("life_normalized_tax_rate", None))
                if life_model.risk_free_rate is None:
                    expected_periods.add(("life_risk_free_rate", None))
                if life_model.equity_risk_premium is None:
                    expected_periods.add(("life_equity_risk_premium", None))
                if life_model.beta is None:
                    expected_periods.add(("life_beta", None))
                if life_model.current_price is None:
                    expected_periods.add(("life_current_share_price", None))
                if life_model.diluted_shares is None:
                    expected_periods.add(("life_diluted_shares", life_model.base_year))
                provided_periods = {(item.key, item.fiscal_year) for item in self.required_inputs}
                if not expected_periods.issubset(provided_periods):
                    raise ValueError("incomplete life-insurance exports need the full earnings, capital, parent, market, and DCF input manifest")
            elif self.life_insurance_model is not None:
                raise ValueError("life_insurance_model is only valid for the input-required life-insurance route")
            comparable_routes = COMPARABLE_VALUATION_METHODS
            peer_denominator_inputs = [
                item for item in self.required_inputs
                if item.key.startswith("peer_ebitda:") or item.key.startswith("peer_revenue:")
            ]
            if self.valuation_model in comparable_routes:
                if peer_denominator_inputs:
                    if self.comparable_model is None or self.comparable_model.method != self.valuation_model:
                        raise ValueError("incomplete comparable exports need a matching current peer-source record")
                    if self.comparable_model.peer_fallback_used:
                        # Fallback market data never enters the median unconfirmed:
                        # every peer with a positive EV needs a confirmation input.
                        confirmed = {item.key.split(":", 1)[1].upper() for item in peer_denominator_inputs if ":" in item.key}
                        peers = self.comps or []
                        peer_tickers = {
                            str(peer.get("ticker") or "").strip().upper()
                            for peer in peers
                            if isinstance(peer, dict) and str(peer.get("ticker") or "").strip()
                            and _positive_number(peer.get("ev"))
                        }
                        missing_peer_tickers = {item.key.split(":", 1)[1].upper() for item in peer_denominator_inputs}
                        if len(peer_tickers | missing_peer_tickers) < 3:
                            raise ValueError("incomplete comparable workbook requires at least three peer rows including the missing denominator")
                        unconfirmed = {ticker for ticker in peer_tickers if ticker not in confirmed}
                        if unconfirmed:
                            raise ValueError(
                                "incomplete comparable exports on fallback peers need confirmation inputs for "
                                + ", ".join(sorted(unconfirmed))
                            )
                    else:
                        peers = self.comps or []
                        peer_tickers = {
                            str(peer.get("ticker") or "").strip().upper()
                            for peer in peers
                            if isinstance(peer, dict) and str(peer.get("ticker") or "").strip()
                            and _positive_number(peer.get("ev"))
                        }
                        missing_peer_tickers = {item.key.split(":", 1)[1].upper() for item in peer_denominator_inputs}
                        if len(peer_tickers | missing_peer_tickers) < 3:
                            raise ValueError("incomplete comparable workbook requires at least three peer rows including the missing denominator")
                elif self.comparable_model is not None:
                    raise ValueError("incomplete comparable source metadata requires peer denominator inputs")
            elif self.comparable_model is not None:
                raise ValueError("comparable_model is only valid for multiple valuation routes")
            return self

        if self.required_inputs:
            raise ValueError("ready exports cannot contain missing required inputs")
        if self.market is None or self.historicals is None or self.assumptions is None:
            raise ValueError("ready exports require market data, historicals, and assumptions")
        if self.market.current_price is None or self.market.current_price <= 0:
            raise ValueError("ready exports require a positive current share price")
        if self.market.shares_diluted is None or self.market.shares_diluted <= 0:
            raise ValueError("ready exports require a positive diluted share count")
        if self.valuation_model is not None and self.valuation_model not in PRODUCTION_MODEL_ROUTES:
            raise ValueError(f"The {self.valuation_model} workbook is not implemented.")
        if self.valuation_model == "life_insurer_distributable_earnings_dcf" or self.life_insurance_model is not None:
            raise ValueError("life-insurance DCF exports remain input-required until company-level capital and distribution assumptions are supplied")
        comparable_routes = COMPARABLE_VALUATION_METHODS
        specialized = {"bank_residual_income", "insurance_pnc_residual_income", "reit_affo", "utility_dcf", "biotech_pipeline_rnpv", "asset_manager_aum_dcf", "telecom_subscriber_dcf", "mortgage_reit_residual_income", "integrated_energy_dcf", "mature_pharma_product_dcf", *comparable_routes}
        if self.valuation_model not in specialized and not self.forecasts:
            raise ValueError("forecasts must contain at least one period for a DCF export")
        if self.valuation_model in comparable_routes:
            if not isinstance(self.comparable_model, ComparableModelExportData) or self.comparable_model.method != self.valuation_model:
                raise ValueError("a comparable_model matching the selected multiple route is required")
            if self.comparable_model.peer_fallback_used:
                raise ValueError("comparable-model exports require a curated non-fallback peer set")
            if any(token in self.comparable_model.peer_source.lower() for token in ("default", "stale", "unavailable")):
                raise ValueError("comparable-model exports require a current peer source")
            age_ms = int(time.time() * 1000) - self.comparable_model.peer_fetched_at_ms
            if age_ms < 0 or age_ms > 24 * 60 * 60 * 1000:
                raise ValueError("comparable-model peer data must be no more than 24 hours old")
        elif self.comparable_model is not None:
            raise ValueError("comparable_model is only valid for EV/EBITDA or EV/Revenue exports")
        if self.valuation_model == "bank_residual_income" and self.bank_model is None:
            raise ValueError("bank_model is required for bank_residual_income exports")
        if self.bank_model is not None and self.bank_model.assumptions.minimum_cet1_ratio is None:
            raise ValueError("ready bank exports require a filed minimum_cet1_ratio")
        if self.valuation_model != "bank_residual_income" and self.bank_model is not None:
            raise ValueError("bank_model is only valid for bank_residual_income exports")
        if self.valuation_model == "insurance_pnc_residual_income" and self.insurance_model is None:
            raise ValueError("insurance_model is required for insurance_pnc_residual_income exports")
        if self.insurance_model is not None and not _has_filed_line_value(
            self.insurance_model.history.annual[-1].insurance.unpaid_loss_reserves,
            self.insurance_model.history.annual[-1].year,
        ):
            raise ValueError("ready P&C exports require the latest filed unpaid_loss_reserves")
        if self.valuation_model != "insurance_pnc_residual_income" and self.insurance_model is not None:
            raise ValueError("insurance_model is only valid for insurance_pnc_residual_income exports")
        if self.valuation_model == "reit_affo" and self.reit_model is None:
            raise ValueError("reit_model is required for reit_affo exports")
        if self.reit_model is not None:
            latest = self.reit_model.history.annual[-1]
            if self.reit_model.assumptions.same_store_noi_growth is None or not _has_filed_value_with_provenance(
                latest.reit.same_store_noi_growth,
            ):
                raise ValueError("ready REIT exports require a filed latest same_store_noi_growth")
        if self.valuation_model != "reit_affo" and self.reit_model is not None:
            raise ValueError("reit_model is only valid for reit_affo exports")
        if self.valuation_model == "asset_manager_aum_dcf" and self.asset_manager_model is None:
            raise ValueError("asset_manager_model is required for asset_manager_aum_dcf exports")
        if self.asset_manager_model is not None:
            if self.asset_manager_model.assumptions.base_fee_yield is None or any(
                not _has_filed_value_with_provenance(item.asset_manager.base_fee_yield)
                for item in self.asset_manager_model.history.annual
            ):
                raise ValueError("ready asset-manager exports require three filed annual base_fee_yield inputs")
        if self.valuation_model != "asset_manager_aum_dcf" and self.asset_manager_model is not None:
            raise ValueError("asset_manager_model is only valid for asset_manager_aum_dcf exports")
        if self.valuation_model == "telecom_subscriber_dcf" and self.telecom_model is None:
            raise ValueError("telecom_model is required for telecom_subscriber_dcf exports")
        if self.telecom_model is not None:
            if self.telecom_model.assumptions.postpaid_gross_add_rate is None or self.telecom_model.assumptions.postpaid_phone_monthly_churn is None:
                raise ValueError("ready telecom exports require filed postpaid churn assumptions")
            if any(not _has_filed_value_with_provenance(item.telecom.postpaid_phone_churn) for item in self.telecom_model.history.annual[-3:]):
                raise ValueError("ready telecom exports require filed churn for each of the three annual periods")
        if self.valuation_model != "telecom_subscriber_dcf" and self.telecom_model is not None:
            raise ValueError("telecom_model is only valid for telecom_subscriber_dcf exports")
        if self.valuation_model == "mortgage_reit_residual_income" and self.mortgage_reit_model is None:
            raise ValueError("mortgage_reit_model is required for mortgage_reit_residual_income exports")
        if self.mortgage_reit_model is not None and not _has_filed_value_with_provenance(
            self.mortgage_reit_model.history.annual[-1].mortgage_reit.average_repo_borrowings,
        ):
            raise ValueError("ready mortgage REIT exports require latest filed average_repo_borrowings")
        if self.valuation_model != "mortgage_reit_residual_income" and self.mortgage_reit_model is not None:
            raise ValueError("mortgage_reit_model is only valid for mortgage_reit_residual_income exports")
        if self.valuation_model == "integrated_energy_dcf" and self.integrated_energy_model is None:
            raise ValueError("integrated_energy_model is required for integrated_energy_dcf exports")
        if self.integrated_energy_model is not None:
            if self.integrated_energy_model.assumptions.base_gross_production_margin is None or self.integrated_energy_model.assumptions.upstream_earnings_conversion_factor is None:
                raise ValueError("ready integrated-energy exports require filed crude production for the upstream base")
            if any(not _has_filed_line_value(item.energy.crude_oil_production, item.year) for item in self.integrated_energy_model.history.annual):
                raise ValueError("ready integrated-energy exports require three filed annual crude-production periods")
        if self.valuation_model != "integrated_energy_dcf" and self.integrated_energy_model is not None:
            raise ValueError("integrated_energy_model is only valid for integrated_energy_dcf exports")
        if self.valuation_model == "mature_pharma_product_dcf" and self.mature_pharma_model is None:
            raise ValueError("mature_pharma_model is required for mature_pharma_product_dcf exports")
        if self.mature_pharma_model is not None:
            assumptions = self.mature_pharma_model.assumptions
            if assumptions.other_revenue_base is None or assumptions.other_revenue_growth is None or any(
                item.pre_loe_growth_rate is None for item in assumptions.products
            ):
                raise ValueError("ready mature-pharma exports require complete product and residual revenue inputs")
            for year_row in self.mature_pharma_model.history.annual:
                if any(not _has_filed_value_with_provenance(product.revenue) for product in year_row.pharma.products):
                    raise ValueError(f"ready mature-pharma exports require filed product sales for FY{year_row.year}")
        if self.valuation_model != "mature_pharma_product_dcf" and self.mature_pharma_model is not None:
            raise ValueError("mature_pharma_model is only valid for mature_pharma_product_dcf exports")
        if self.valuation_model == "utility_dcf":
            if not isinstance(self.utility_model, UtilityModelExportData):
                raise ValueError("ready utility exports require complete rate-base DDM assumptions")
            if self.historicals is not None and self.historicals.years[-1] != self.utility_model.assumptions.base_year:
                raise ValueError("utility base year must match the latest filed financial period")
        elif self.utility_model is not None:
            raise ValueError("utility_model is only valid for utility_dcf exports")
        if self.valuation_model == "biotech_pipeline_rnpv":
            if not isinstance(self.biotech_model, BiotechModelExportData):
                raise ValueError("ready biotech exports require source-backed pipeline rows and complete rNPV assumptions")
            if self.historicals is not None and self.historicals.years[-1] != self.biotech_model.assumptions.base_year:
                raise ValueError("biotech model base year must match the latest filed commercial-revenue base")
        elif self.biotech_model is not None:
            raise ValueError("biotech_model is only valid for biotech_pipeline_rnpv exports")
        return self
