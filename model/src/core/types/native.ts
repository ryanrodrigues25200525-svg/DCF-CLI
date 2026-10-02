export type NativeScalar = string | number | null;
export type NativeStatementCell = NativeScalar | boolean;
export type NativeKeyMetricValue = NativeScalar | Array<number | null>;

export interface NativeStatementRow {
    concept?: string | null;
    label?: string | null;
    standard_concept?: string | null;
    level?: number | null;
    decimals?: number | null;
    [key: string]: NativeStatementCell | undefined;
}

export interface NativeStatements {
    income_statement: NativeStatementRow[];
    balance_sheet: NativeStatementRow[];
    cashflow_statement: NativeStatementRow[];
}

export interface NativeKeyMetrics {
    revenue?: NativeKeyMetricValue;
    net_income?: NativeKeyMetricValue;
    operating_income?: NativeKeyMetricValue;
    total_assets?: NativeKeyMetricValue;
    total_liabilities?: NativeKeyMetricValue;
    stockholders_equity?: NativeKeyMetricValue;
    operating_cash_flow?: NativeKeyMetricValue;
    capital_expenditures?: NativeKeyMetricValue;
    free_cash_flow?: NativeKeyMetricValue;
    shares_outstanding_basic?: NativeKeyMetricValue;
    shares_outstanding_diluted?: NativeKeyMetricValue;
    [key: string]: NativeKeyMetricValue | undefined;
}

export interface NativeFinancialsPayload {
    ticker: string;
    cik: string;
    name: string;
    source: string;
    periods_requested: number;
    statements: NativeStatements;
    key_metrics: NativeKeyMetrics;
    shares_outstanding?: number | null;
    public_float?: number | null;
    is_financial_institution?: boolean | null;
    fiscal_year_end?: string | null;
    fetched_at_ms: number | null;
    source_filings?: NativeSourceFiling[];
    source_facts?: NativeSourceFact[];
    bank_filing_facts?: NativeSourceFact[];
    insurance_filing_facts?: NativeSourceFact[];
    life_insurance_filing_facts?: LifeInsuranceFilingFact[];
    reit_filing_facts?: NativeSourceFact[];
    mortgage_reit_filing_facts?: NativeSourceFact[];
    energy_filing_facts?: NativeSourceFact[];
    pharma_filing_facts?: PharmaNativeFact[];
    pipeline_assets?: PipelineAssetNativeFact[];
    asset_management_filing_facts?: NativeSourceFact[];
    telecom_filing_facts?: NativeSourceFact[];
    issuer_debt_cost_facts?: NativeSourceFact[];
    [key: string]: unknown;
}

export interface NativeSourceFiling {
    form: string;
    filing_date: string;
    report_date: string;
    accession_number: string;
    primary_document?: string | null;
}

export interface NativeSourceFact {
    concept: string;
    label?: string | null;
    value: number;
    unit?: string | null;
    period_end: string;
    fiscal_year: number;
    fiscal_period: string;
    accession_number?: string | null;
    filing_date?: string | null;
    form?: string | null;
    report_date?: string | null;
    primary_document?: string | null;
    unit_scale?: string | null;
    source_statement?: string | null;
    source_components?: NativeSourceFactComponent[];
}

export interface NativeSourceFactComponent {
    concept: string;
    label: string;
    value: number;
    unit: string;
    unit_scale: string;
    period_end: string;
    fiscal_year: number;
    fiscal_period: string;
    accession_number: string;
    filing_date: string;
    form: string;
    report_date: string;
    primary_document?: string | null;
    source_statement: string;
}

export interface PharmaNativeFact {
    metric: 'product_revenue' | 'reported_total_revenue' | 'marketable_securities' | 'basic_patent_expiration_year' | 'pending_patent_term_extension_year';
    product_name: string;
    indication?: string | null;
    region?: string | null;
    value: number;
    unit: string;
    unit_scale: string;
    period_end: string;
    fiscal_year: number;
    fiscal_period: string;
    accession_number: string;
    filing_date: string;
    form: string;
    report_date: string;
    primary_document?: string | null;
    source_statement: string;
    reported_text?: string | null;
}

export interface LifeInsuranceFilingFact {
    metric: string;
    segment?: string | null;
    capital_group?: string | null;
    value: number;
    unit: 'USD' | 'ratio';
    unit_scale: 'millions' | 'ratio';
    fiscal_year: number;
    fiscal_period: string;
    accession_number: string;
    filing_date: string;
    form: '10-K' | '10-K/A';
    report_date: string;
    primary_document?: string | null;
    source_statement: string;
    earnings_basis: 'after_tax_adjusted_earnings_available_to_common' | 'pre_tax_adjusted_operating_income' | 'not_applicable';
    comparison_operator?: 'greater_than' | 'equal' | 'less_than' | null;
}

export interface PipelineAssetNativeFact {
    asset_id: string;
    asset_name: string;
    stage?: string | null;
    development_status: 'disclosed' | 'explicitly_paused';
    partner?: string | null;
    accession_number: string;
    filing_date: string;
    report_date: string;
    form: string;
    primary_document?: string | null;
    source_statement: string;
}

export type CanonicalLineSource =
    | 'sec_native'
    | 'derived'
    | 'market_derived'
    | 'missing'
    | 'ambiguous'
    | 'not_applicable';

export interface CanonicalSourceRecord {
    concept: string | null;
    label: string | null;
    statement: string | null;
    row_id: string | null;
    fiscal_period: string | null;
    reported_value: number | null;
    accession: string | null;
    filed: string | null;
    form: string | null;
    report_date: string | null;
    period_end?: string | null;
    currency: string | null;
    unit: string | null;
    unit_scale: string | null;
    source_fiscal_year?: number | null;
}

export interface CanonicalCandidate {
    concept: string | null;
    value: number | null;
    source?: CanonicalSourceRecord;
}

export interface CanonicalFinancialLine {
    value: number | null;
    source: CanonicalLineSource;
    confidence: number;
    method: string;
    concept: string | null;
    sources: CanonicalSourceRecord[];
    candidates?: CanonicalCandidate[];
}

export interface PharmaProductRevenue {
    product_name: string;
    indication: string | null;
    revenue: CanonicalFinancialLine;
}

export interface PharmaPatentDisclosure {
    product_name: string;
    region: 'us' | 'major_europe' | 'japan';
    metric: 'basic_patent_expiration_year' | 'pending_patent_term_extension_year';
    year: CanonicalFinancialLine;
    reported_text: string;
}

export interface PharmaCanonicalFinancials {
    products: PharmaProductRevenue[];
    patents: PharmaPatentDisclosure[];
    reported_total_revenue: CanonicalFinancialLine;
}

export interface CanonicalAnnualFinancials {
    year: number;
    revenue: CanonicalFinancialLine;
    cost_of_revenue: CanonicalFinancialLine;
    gross_profit: CanonicalFinancialLine;
    ebit: CanonicalFinancialLine;
    ebitda: CanonicalFinancialLine;
    interest_expense: CanonicalFinancialLine;
    income_tax_expense: CanonicalFinancialLine;
    net_income: CanonicalFinancialLine;
    depreciation: CanonicalFinancialLine;
    stock_based_comp: CanonicalFinancialLine;
    cfo: CanonicalFinancialLine;
    capex: CanonicalFinancialLine;
    cash: CanonicalFinancialLine;
    current_debt: CanonicalFinancialLine;
    long_term_debt: CanonicalFinancialLine;
    debt: CanonicalFinancialLine;
    operating_lease_liability_current: CanonicalFinancialLine;
    operating_lease_liability_noncurrent: CanonicalFinancialLine;
    lease_liabilities: CanonicalFinancialLine;
    book_value: CanonicalFinancialLine;
    accounts_receivable: CanonicalFinancialLine;
    inventory: CanonicalFinancialLine;
    accounts_payable: CanonicalFinancialLine;
    total_assets: CanonicalFinancialLine;
    total_liabilities: CanonicalFinancialLine;
    retained_earnings: CanonicalFinancialLine;
    dividends_paid: CanonicalFinancialLine;
    non_controlling_interest: CanonicalFinancialLine;
    preferred_equity: CanonicalFinancialLine;
    marketable_securities: CanonicalFinancialLine;
    marketable_securities_current: CanonicalFinancialLine;
    marketable_securities_noncurrent: CanonicalFinancialLine;
    long_term_debt_current: CanonicalFinancialLine;
    commercial_paper: CanonicalFinancialLine;
    total_current_assets: CanonicalFinancialLine;
    other_current_assets: CanonicalFinancialLine;
    ppe_net: CanonicalFinancialLine;
    other_assets: CanonicalFinancialLine;
    other_liabilities: CanonicalFinancialLine;
    total_current_liabilities: CanonicalFinancialLine;
    other_current_liabilities: CanonicalFinancialLine;
    deferred_revenue: CanonicalFinancialLine;
    research_and_development: CanonicalFinancialLine;
    general_and_administrative: CanonicalFinancialLine;
    marketing: CanonicalFinancialLine;
    rent: CanonicalFinancialLine;
    bad_debt: CanonicalFinancialLine;
    other_operating_expenses: CanonicalFinancialLine;
    deferred_tax: CanonicalFinancialLine;
    other_non_cash: CanonicalFinancialLine;
    nwc_change: CanonicalFinancialLine;
    operating_net_working_capital: CanonicalFinancialLine;
    fcff: CanonicalFinancialLine;
    balance_sheet_check: CanonicalFinancialLine;
    tax_rate: CanonicalFinancialLine;
    shares: CanonicalFinancialLine;
    bank?: BankCanonicalFinancials | null;
    insurance?: InsuranceCanonicalFinancials | null;
    reit?: ReitCanonicalFinancials | null;
    asset_manager?: AssetManagerCanonicalFinancials | null;
    telecom?: TelecomCanonicalFinancials | null;
    mortgage_reit?: MortgageReitCanonicalFinancials | null;
    energy?: EnergyCanonicalFinancials | null;
    pharma?: PharmaCanonicalFinancials | null;
    [key: string]: BankCanonicalFinancials | InsuranceCanonicalFinancials | ReitCanonicalFinancials | AssetManagerCanonicalFinancials | TelecomCanonicalFinancials | MortgageReitCanonicalFinancials | EnergyCanonicalFinancials | PharmaCanonicalFinancials | CanonicalFinancialLine | number | Record<string, unknown> | null | undefined;
}

export interface BankCanonicalFinancials {
    interest_income: CanonicalFinancialLine;
    interest_expense: CanonicalFinancialLine;
    net_interest_income: CanonicalFinancialLine;
    noninterest_income: CanonicalFinancialLine;
    noninterest_expense: CanonicalFinancialLine;
    provision_for_credit_losses: CanonicalFinancialLine;
    loans_and_leases: CanonicalFinancialLine;
    deposits: CanonicalFinancialLine;
    interest_bearing_liabilities: CanonicalFinancialLine;
    interest_earning_assets: CanonicalFinancialLine;
    risk_weighted_assets: CanonicalFinancialLine;
    cet1_capital: CanonicalFinancialLine;
    minimum_cet1_ratio: CanonicalFinancialLine;
    common_equity: CanonicalFinancialLine;
    common_equity_distributions: CanonicalFinancialLine;
    diluted_shares: CanonicalFinancialLine;
}

export interface InsuranceCanonicalFinancials {
    net_premiums_written: CanonicalFinancialLine;
    net_premiums_earned: CanonicalFinancialLine;
    losses_and_lae: CanonicalFinancialLine;
    acquisition_expenses: CanonicalFinancialLine;
    general_operating_expenses: CanonicalFinancialLine;
    underwriting_expenses: CanonicalFinancialLine;
    loss_ratio: CanonicalFinancialLine;
    expense_ratio: CanonicalFinancialLine;
    combined_ratio: CanonicalFinancialLine;
    prior_year_reserve_development: CanonicalFinancialLine;
    underwriting_income: CanonicalFinancialLine;
    net_investment_income: CanonicalFinancialLine;
    invested_assets: CanonicalFinancialLine;
    unpaid_loss_reserves_beginning: CanonicalFinancialLine;
    losses_incurred_for_reserve_rollforward: CanonicalFinancialLine;
    losses_paid_for_reserve_rollforward: CanonicalFinancialLine;
    reserve_other_changes: CanonicalFinancialLine;
    unpaid_loss_reserves: CanonicalFinancialLine;
    reinsurance_recoverable: CanonicalFinancialLine;
    gross_loss_reserves: CanonicalFinancialLine;
    reserve_rollforward_check: CanonicalFinancialLine;
    other_operations_pretax_income: CanonicalFinancialLine;
    statutory_capital_surplus: CanonicalFinancialLine;
    minimum_statutory_capital: CanonicalFinancialLine;
    common_equity: CanonicalFinancialLine;
    common_equity_distributions: CanonicalFinancialLine;
    diluted_shares: CanonicalFinancialLine;
    net_income: CanonicalFinancialLine;
    tax_rate: CanonicalFinancialLine;
    reported_pretax_income: CanonicalFinancialLine;
    other_pretax_adjustments: CanonicalFinancialLine;
}

export interface ReitCanonicalFinancials {
    net_income_available_to_common: CanonicalFinancialLine;
    nareit_bridge_net_income: CanonicalFinancialLine;
    real_estate_depreciation: CanonicalFinancialLine;
    disposition_gains_nareit_adjustment: CanonicalFinancialLine;
    nci_nareit_adjustment: CanonicalFinancialLine;
    unconsolidated_nareit_adjustment: CanonicalFinancialLine;
    nareit_ffo: CanonicalFinancialLine;
    modified_ffo_fx_adjustment: CanonicalFinancialLine;
    modified_ffo_deferred_tax_adjustment: CanonicalFinancialLine;
    modified_ffo_current_tax_adjustment: CanonicalFinancialLine;
    modified_ffo_nci_adjustment: CanonicalFinancialLine;
    modified_ffo_unconsolidated_adjustment: CanonicalFinancialLine;
    modified_ffo: CanonicalFinancialLine;
    core_ffo_disposition_adjustment: CanonicalFinancialLine;
    core_ffo_tax_adjustment: CanonicalFinancialLine;
    core_ffo_debt_extinguishment_adjustment: CanonicalFinancialLine;
    core_ffo_nci_adjustment: CanonicalFinancialLine;
    core_ffo_unconsolidated_adjustment: CanonicalFinancialLine;
    core_ffo: CanonicalFinancialLine;
    tenant_improvements_and_lease_commissions: CanonicalFinancialLine;
    property_improvements: CanonicalFinancialLine;
    recurring_capex: CanonicalFinancialLine;
    analyst_affo: CanonicalFinancialLine;
    same_store_noi_net_effective: CanonicalFinancialLine;
    same_store_noi_cash: CanonicalFinancialLine;
    same_store_noi_growth: CanonicalFinancialLine;
    occupancy: CanonicalFinancialLine;
    real_estate_segment_noi: CanonicalFinancialLine;
    strategic_capital_segment_noi: CanonicalFinancialLine;
    common_distributions: CanonicalFinancialLine;
}

export interface AssetManagerCanonicalFinancials {
    aum: CanonicalFinancialLine;
    beginning_aum: CanonicalFinancialLine;
    average_aum: CanonicalFinancialLine;
    net_flows: CanonicalFinancialLine;
    realizations: CanonicalFinancialLine;
    acquisitions: CanonicalFinancialLine;
    market_change: CanonicalFinancialLine;
    fx_change: CanonicalFinancialLine;
    scope_change: CanonicalFinancialLine;
    depreciation: CanonicalFinancialLine;
    acquisition_amortization: CanonicalFinancialLine;
    working_capital_change: CanonicalFinancialLine;
    base_fees: CanonicalFinancialLine;
    base_fee_yield: CanonicalFinancialLine;
    capital_allocation_income: CanonicalFinancialLine;
    performance_fees: CanonicalFinancialLine;
    securities_lending_revenue: CanonicalFinancialLine;
    technology_revenue: CanonicalFinancialLine;
    distribution_revenue: CanonicalFinancialLine;
    administrative_other_revenue: CanonicalFinancialLine;
    other_revenue: CanonicalFinancialLine;
    unmapped_revenue: CanonicalFinancialLine;
}

export interface TelecomCanonicalFinancials {
    capital_expenditures: CanonicalFinancialLine;
    working_capital_change: CanonicalFinancialLine;
    interest_bearing_debt: CanonicalFinancialLine;
    cost_of_debt: CanonicalFinancialLine;
    wireless_subscribers: CanonicalFinancialLine;
    postpaid_subscribers: CanonicalFinancialLine;
    postpaid_phone_subscribers: CanonicalFinancialLine;
    prepaid_subscribers: CanonicalFinancialLine;
    reseller_subscribers: CanonicalFinancialLine;
    wireless_net_additions: CanonicalFinancialLine;
    postpaid_phone_net_additions: CanonicalFinancialLine;
    postpaid_churn: CanonicalFinancialLine;
    postpaid_phone_churn: CanonicalFinancialLine;
    mobility_revenue: CanonicalFinancialLine;
    mobility_service_revenue: CanonicalFinancialLine;
    mobility_equipment_revenue: CanonicalFinancialLine;
    mobility_operating_income: CanonicalFinancialLine;
    mobility_depreciation: CanonicalFinancialLine;
    business_wireline_revenue: CanonicalFinancialLine;
    business_wireline_operating_income: CanonicalFinancialLine;
    business_wireline_depreciation: CanonicalFinancialLine;
    consumer_wireline_revenue: CanonicalFinancialLine;
    consumer_broadband_revenue: CanonicalFinancialLine;
    consumer_wireline_operating_income: CanonicalFinancialLine;
    consumer_wireline_depreciation: CanonicalFinancialLine;
    broadband_connections: CanonicalFinancialLine;
    fiber_broadband_connections: CanonicalFinancialLine;
    broadband_net_additions: CanonicalFinancialLine;
    fiber_broadband_net_additions: CanonicalFinancialLine;
    latin_america_revenue: CanonicalFinancialLine;
    latin_america_operating_income: CanonicalFinancialLine;
    communications_revenue: CanonicalFinancialLine;
    communications_operating_income: CanonicalFinancialLine;
}

export interface MortgageReitCanonicalFinancials {
    investment_securities_fair_value: CanonicalFinancialLine;
    total_assets: CanonicalFinancialLine;
    repo_and_other_debt: CanonicalFinancialLine;
    total_liabilities: CanonicalFinancialLine;
    total_stockholders_equity: CanonicalFinancialLine;
    net_book_value_per_common_share: CanonicalFinancialLine;
    tangible_book_value_per_common_share: CanonicalFinancialLine;
    period_end_common_shares: CanonicalFinancialLine;
    preferred_equity_carrying_value: CanonicalFinancialLine;
    preferred_equity_liquidation_preference: CanonicalFinancialLine;
    gaap_interest_income: CanonicalFinancialLine;
    gaap_interest_expense: CanonicalFinancialLine;
    gaap_net_interest_income: CanonicalFinancialLine;
    economic_interest_income: CanonicalFinancialLine;
    economic_interest_expense: CanonicalFinancialLine;
    other_gain_net: CanonicalFinancialLine;
    operating_expenses: CanonicalFinancialLine;
    net_income: CanonicalFinancialLine;
    preferred_dividends: CanonicalFinancialLine;
    net_income_available_to_common: CanonicalFinancialLine;
    other_comprehensive_income: CanonicalFinancialLine;
    comprehensive_income: CanonicalFinancialLine;
    comprehensive_income_available_to_common: CanonicalFinancialLine;
    common_dividends_per_share: CanonicalFinancialLine;
    average_investment_securities_at_cost: CanonicalFinancialLine;
    average_tba_dollar_roll_position_at_cost: CanonicalFinancialLine;
    average_total_assets_fair_value: CanonicalFinancialLine;
    average_repo_borrowings: CanonicalFinancialLine;
    average_mortgage_borrowings: CanonicalFinancialLine;
    average_stockholders_equity: CanonicalFinancialLine;
    average_at_risk_leverage: CanonicalFinancialLine;
    period_end_at_risk_leverage: CanonicalFinancialLine;
    economic_return_on_tangible_common_equity: CanonicalFinancialLine;
    expenses_pct_average_assets: CanonicalFinancialLine;
    average_asset_yield: CanonicalFinancialLine;
    average_aggregate_cost_of_funds: CanonicalFinancialLine;
    average_net_interest_spread: CanonicalFinancialLine;
    average_swap_notional: CanonicalFinancialLine;
    average_swap_ratio: CanonicalFinancialLine;
    average_swap_net_pay_rate: CanonicalFinancialLine;
}

export interface EnergyCanonicalFinancials {
    weighted_average_diluted_shares: CanonicalFinancialLine;
    current_debt: CanonicalFinancialLine;
    long_term_debt: CanonicalFinancialLine;
    interest_bearing_debt: CanonicalFinancialLine;
    crude_oil_production: CanonicalFinancialLine;
    ngl_production: CanonicalFinancialLine;
    bitumen_production: CanonicalFinancialLine;
    synthetic_oil_production: CanonicalFinancialLine;
    liquids_production: CanonicalFinancialLine;
    natural_gas_production_available_for_sale: CanonicalFinancialLine;
    oil_equivalent_production: CanonicalFinancialLine;
    average_crude_price: CanonicalFinancialLine;
    average_ngl_price: CanonicalFinancialLine;
    average_bitumen_price: CanonicalFinancialLine;
    average_synthetic_oil_price: CanonicalFinancialLine;
    average_natural_gas_price: CanonicalFinancialLine;
    average_production_cost_per_oil_equivalent_barrel: CanonicalFinancialLine;
    proved_oil_equivalent_reserves: CanonicalFinancialLine;
    proved_developed_oil_equivalent_reserves: CanonicalFinancialLine;
    proved_undeveloped_oil_equivalent_reserves: CanonicalFinancialLine;
    upstream_earnings_gaap: CanonicalFinancialLine;
    energy_products_earnings_gaap: CanonicalFinancialLine;
    chemical_products_earnings_gaap: CanonicalFinancialLine;
    specialty_products_earnings_gaap: CanonicalFinancialLine;
    corporate_financing_earnings_gaap: CanonicalFinancialLine;
    upstream_depreciation_and_depletion: CanonicalFinancialLine;
    energy_products_depreciation_and_depletion: CanonicalFinancialLine;
    chemical_products_depreciation_and_depletion: CanonicalFinancialLine;
    specialty_products_depreciation_and_depletion: CanonicalFinancialLine;
    upstream_ppe_additions_including_noncash: CanonicalFinancialLine;
    energy_products_ppe_additions_including_noncash: CanonicalFinancialLine;
    chemical_products_ppe_additions_including_noncash: CanonicalFinancialLine;
    specialty_products_ppe_additions_including_noncash: CanonicalFinancialLine;
    cash_capex: CanonicalFinancialLine;
    operating_working_capital_investment: CanonicalFinancialLine;
    corporate_interest_revenue: CanonicalFinancialLine;
    brent_2026_earnings_sensitivity: CanonicalFinancialLine;
    henry_hub_2026_earnings_sensitivity: CanonicalFinancialLine;
    ttf_2026_earnings_sensitivity: CanonicalFinancialLine;
}

export interface CanonicalFinancialsPayload {
    currency: string | null;
    scale: string;
    metadata: Record<string, unknown>;
    years: number[];
    annual: CanonicalAnnualFinancials[];
    latest: CanonicalAnnualFinancials | null;
    quality: Record<string, boolean>;
}

export interface NativeProfilePayload {
    cik: string;
    ticker: string;
    name: string;
    exchange?: string | null;
    sector?: string | null;
    industry?: string | null;
    sic?: string | null;
    sic_description?: string | null;
    fiscal_year_end?: string | null;
    current_price?: number | null;
    market_cap?: number | null;
    currency?: string | null;
    beta?: number | null;
    [key: string]: unknown;
}

export interface NativeMarketContextPayload {
    riskFreeRate?: number;
    equityRiskPremium?: number;
    lastUpdated?: number;
    risk_free_rate?: number;
    equity_risk_premium?: number;
    last_updated?: number;
    fetched_at_ms?: number;
    treasuryRateSource?: string | null;
    treasury_rate_source?: string | null;
    erpSource?: string | null;
    erp_source?: string | null;
    as_of_date?: string | null;
}

export interface UnifiedDataQualityEntry {
    status: "live" | "cached" | "stale" | "default" | "unavailable";
    source: string;
    fetched_at_ms: number | null;
    fallback_used: boolean;
    notes?: string | null;
}

export interface UnifiedCompleteness {
    has_financials: boolean;
    has_market: boolean;
    has_valuation_context: boolean;
    has_peers: boolean;
    has_insider_trades: boolean;
    degradation_level: "none" | "low" | "moderate" | "high";
}

export interface NativeValuationContextPayload {
    risk_free_rate: number | null;
    equity_risk_premium: number | null;
    fetched_at_ms: number | null;
    treasury_rate_source?: string | null;
    erp_source?: string | null;
    as_of_date?: string | null;
}

export interface NativeMarketSnapshot {
    ticker?: string | null;
    current_price?: number | null;
    market_cap?: number | null;
    shares_outstanding?: number | null;
    currency?: string | null;
    beta?: number | null;
    sector?: string | null;
    industry?: string | null;
    exchange?: string | null;
    source?: string | null;
    fetched_at_ms?: number | null;
    fallback_used?: boolean | null;
    notes?: string | null;
    debt?: number | null;
    cash?: number | null;
    net_debt?: number | null;
    enterprise_value?: number | null;
    [key: string]: unknown;
}

export type CompanyType =
    | 'operating'
    | 'bank'
    | 'insurance'
    | 'reit'
    | 'utility'
    | 'asset_manager'
    | 'high_growth'
    | 'distressed';

export type PreferredValuationModel =
    | 'unlevered_dcf'
    | 'levered_dcf'
    | 'ddm'
    | 'residual_income'
    | 'bank_residual_income'
    | 'insurance_pnc_residual_income'
    | 'reit_affo'
    | 'utility_dcf'
    | 'revenue_multiple'
    | 'ev_ebitda'
    | 'asset_manager_aum_dcf'
    | 'telecom_subscriber_dcf'
    | 'mortgage_reit_residual_income'
    | 'integrated_energy_dcf'
    | 'mature_pharma_product_dcf'
    | 'biotech_pipeline_rnpv'
    | 'life_insurer_distributable_earnings_dcf'
    | 'ptbv'
    | 'pbv'
    | 'nav'
    | 'dividend_yield';

export const PRODUCTION_MODEL_ROUTES = [
    'unlevered_dcf',
    'ev_ebitda',
    'revenue_multiple',
    'bank_residual_income',
    'insurance_pnc_residual_income',
    'reit_affo',
    'utility_dcf',
    'asset_manager_aum_dcf',
    'telecom_subscriber_dcf',
    'mortgage_reit_residual_income',
    'integrated_energy_dcf',
    'mature_pharma_product_dcf',
    'biotech_pipeline_rnpv',
    'life_insurer_distributable_earnings_dcf',
] as const satisfies readonly PreferredValuationModel[];

export type ProductionValuationModel = typeof PRODUCTION_MODEL_ROUTES[number];

export function isProductionModelRoute(value: unknown): value is ProductionValuationModel {
    return typeof value === 'string' && (PRODUCTION_MODEL_ROUTES as readonly string[]).includes(value);
}

export type OperatingArchetype =
    | 'standard_operating'
    | 'technology_hardware'
    | 'subscription_software'
    | 'consumer_retail'
    | 'industrial_manufacturing'
    | 'semiconductor'
    | 'energy_materials'
    | 'telecommunications'
    | 'mature_pharma'
    | 'biotechnology'
    | 'unclassified_operating';

export interface BlockedModel {
    model: PreferredValuationModel;
    reason: string;
}

export type ModelBuildStatus = 'ready' | 'input_required' | 'unsupported';

export interface ModelReadinessGap {
    key: string;
    label: string;
    reason: string;
}

export interface ModelEligibility {
    company_type: CompanyType;
    preferred_model: PreferredValuationModel;
    allowed_models: PreferredValuationModel[];
    blocked_models: BlockedModel[];
    supported_by_current_engine: boolean;
    status: ModelBuildStatus;
    model_route_available: boolean;
    missing_input_gaps: ModelReadinessGap[];
    operating_archetype?: OperatingArchetype | null;
    subtype?:
        | 'commercial_bank' | 'investment_bank' | 'other_financial'
        | 'traditional_asset_manager' | 'alternative_asset_manager'
        | 'pc_insurer' | 'life_insurer' | 'reinsurer' | 'other_insurer'
        | 'equity_reit' | 'mortgage_reit' | 'other_reit'
        | 'regulated_utility' | 'mixed_utility' | 'merchant_utility'
        | null;
    required_input_readiness?: Record<string, boolean>;
}

export interface NativeUnifiedPayload {
    profile: NativeProfilePayload;
    financials_native: NativeFinancialsPayload;
    canonical_financials: CanonicalFinancialsPayload;
    model_eligibility: ModelEligibility;
    market: NativeMarketSnapshot;
    market_context: NativeValuationContextPayload;
    valuation_context: NativeValuationContextPayload;
    peers: unknown[];
    insider_trades: unknown[];
    source_metadata: Record<string, string>;
    data_quality: Record<string, UnifiedDataQualityEntry>;
    completeness: UnifiedCompleteness;
}
