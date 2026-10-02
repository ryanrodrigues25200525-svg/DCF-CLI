import type {
  AssetManagerCanonicalFinancials,
  AssetManagerHistoricalData,
  AssetManagerHistoricalYear,
  BlockedModel,
  BankCanonicalFinancials,
  InsuranceCanonicalFinancials,
  ReitCanonicalFinancials,
  TelecomCanonicalFinancials,
  MortgageReitCanonicalFinancials,
  MortgageReitHistoricalData,
  MortgageReitHistoricalYear,
  EnergyCanonicalFinancials,
  PharmaCanonicalFinancials,
  EnergyHistoricalData,
  EnergyHistoricalYear,
  CanonicalAnnualFinancials,
  CanonicalFinancialLine,
  CanonicalFinancialsPayload,
  CanonicalSourceRecord,
  NativeSourceFact,
  NativeSourceFactComponent,
  LifeInsuranceFilingFact,
  PharmaNativeFact,
  PipelineAssetNativeFact,
  NativeSourceFiling,
  CompanyType,
  ModelBuildStatus,
  ModelEligibility,
  ModelReadinessGap,
  NativeMarketSnapshot,
  PreferredValuationModel,
  NativeFinancialsPayload,
  NativeProfilePayload,
  NativeStatementRow,
  NativeUnifiedPayload,
  UnifiedCompleteness,
  UnifiedDataQualityEntry,
} from '@/core/types';
import {isProductionModelRoute} from '@/core/types/native';
import {selectBiotechAssetsForRnpv, selectOtherBiotechAssetsForRnpv} from '@/services/valuation/biotech-rnpv-model';
import type { AssetManagerModelExportData, BiotechModelExportData, BankModelExportData, CompData, DcfExportPayload, DcfWorkbookPayload, IncompleteAssetManagerModelExportData, IncompleteBankModelExportData, IncompleteBiotechModelExportData, IncompleteComparableModelExportData, IncompleteDcfExportPayload, IncompleteIntegratedEnergyModelExportData, IncompleteInsuranceModelExportData, IncompleteLifeInsuranceModelExportData, IncompleteMaturePharmaModelExportData, IncompleteMortgageReitModelExportData, IncompleteReitModelExportData, IncompleteTelecomModelExportData, IncompleteUtilityModelExportData, IntegratedEnergyModelExportData, InsuranceModelExportData, MaturePharmaModelExportData, ModelAssumptions, MortgageReitModelExportData, ReitModelExportData, TelecomModelExportData, UtilityModelExportData, WorkbookInputRequirement } from '@/services/exporters/excel/types';
import type { BankModelAssumptions } from '@/services/valuation/bank-model';
import type { InsuranceModelAssumptions } from '@/services/valuation/insurance-model';
import type { ReitModelAssumptions } from '@/services/valuation/reit-model';
import type { AssetManagerModelAssumptions } from '@/services/valuation/asset-manager-model';
import type { TelecomModelAssumptions } from '@/services/valuation/telecom-model';
import type { MortgageReitModelAssumptions } from '@/services/valuation/mortgage-reit-model';
import type { IntegratedEnergyAssumptions } from '@/services/valuation/integrated-energy-model';

const COMPANY_TYPES: readonly CompanyType[] = [
  'operating', 'bank', 'insurance', 'reit', 'utility', 'asset_manager', 'high_growth', 'distressed',
];

const PREFERRED_MODELS: readonly PreferredValuationModel[] = [
  'unlevered_dcf', 'levered_dcf', 'ddm', 'residual_income', 'bank_residual_income', 'insurance_pnc_residual_income', 'reit_affo', 'utility_dcf',
  'revenue_multiple', 'ev_ebitda', 'asset_manager_aum_dcf', 'telecom_subscriber_dcf', 'mortgage_reit_residual_income', 'integrated_energy_dcf', 'mature_pharma_product_dcf', 'biotech_pipeline_rnpv', 'life_insurer_distributable_earnings_dcf', 'ptbv', 'pbv', 'nav', 'dividend_yield',
];

const CANONICAL_LINE_SOURCES = [
  'sec_native', 'derived', 'market_derived', 'missing', 'ambiguous', 'not_applicable',
] as const;

const CANONICAL_FIELDS = [
  'revenue', 'cost_of_revenue', 'gross_profit', 'ebit', 'ebitda', 'interest_expense',
  'income_tax_expense', 'net_income', 'depreciation', 'stock_based_comp', 'cfo', 'capex',
  'cash', 'marketable_securities', 'marketable_securities_current', 'marketable_securities_noncurrent',
  'long_term_debt_current', 'commercial_paper', 'current_debt', 'long_term_debt', 'debt',
  'operating_lease_liability_current', 'operating_lease_liability_noncurrent', 'lease_liabilities',
  'book_value', 'accounts_receivable',
  'inventory', 'accounts_payable', 'total_assets', 'total_liabilities', 'retained_earnings',
  'dividends_paid', 'non_controlling_interest', 'preferred_equity', 'total_current_assets',
  'other_current_assets', 'ppe_net', 'other_assets', 'other_liabilities', 'total_current_liabilities',
  'other_current_liabilities', 'deferred_revenue', 'research_and_development', 'general_and_administrative',
  'marketing', 'rent', 'bad_debt', 'other_operating_expenses', 'deferred_tax', 'other_non_cash',
  'nwc_change', 'operating_net_working_capital', 'fcff', 'balance_sheet_check', 'tax_rate', 'shares',
] as const;

const BANK_CANONICAL_FIELDS = [
  'interest_income', 'interest_expense', 'net_interest_income', 'noninterest_income',
  'noninterest_expense', 'provision_for_credit_losses', 'loans_and_leases', 'deposits',
  'interest_bearing_liabilities', 'interest_earning_assets', 'risk_weighted_assets',
  'cet1_capital', 'minimum_cet1_ratio', 'common_equity', 'common_equity_distributions', 'diluted_shares',
] as const;

const INSURANCE_CANONICAL_FIELDS = [
  'net_premiums_written', 'net_premiums_earned', 'losses_and_lae', 'acquisition_expenses',
  'general_operating_expenses', 'underwriting_expenses', 'loss_ratio', 'expense_ratio',
  'combined_ratio', 'prior_year_reserve_development', 'underwriting_income', 'net_investment_income',
  'invested_assets', 'unpaid_loss_reserves_beginning', 'losses_incurred_for_reserve_rollforward',
  'losses_paid_for_reserve_rollforward', 'reserve_other_changes', 'unpaid_loss_reserves',
  'reinsurance_recoverable', 'gross_loss_reserves', 'reserve_rollforward_check',
  'other_operations_pretax_income', 'statutory_capital_surplus',
  'minimum_statutory_capital', 'common_equity', 'common_equity_distributions', 'diluted_shares',
  'net_income', 'tax_rate', 'reported_pretax_income', 'other_pretax_adjustments',
] as const;

const REIT_CANONICAL_FIELDS = [
  'net_income_available_to_common', 'nareit_bridge_net_income', 'real_estate_depreciation',
  'disposition_gains_nareit_adjustment', 'nci_nareit_adjustment', 'unconsolidated_nareit_adjustment',
  'nareit_ffo', 'modified_ffo_fx_adjustment', 'modified_ffo_deferred_tax_adjustment',
  'modified_ffo_current_tax_adjustment', 'modified_ffo_nci_adjustment', 'modified_ffo_unconsolidated_adjustment', 'modified_ffo',
  'core_ffo_disposition_adjustment', 'core_ffo_tax_adjustment', 'core_ffo_debt_extinguishment_adjustment',
  'core_ffo_nci_adjustment', 'core_ffo_unconsolidated_adjustment', 'core_ffo',
  'tenant_improvements_and_lease_commissions', 'property_improvements', 'recurring_capex',
  'analyst_affo', 'same_store_noi_net_effective', 'same_store_noi_cash', 'same_store_noi_growth',
  'occupancy', 'real_estate_segment_noi', 'strategic_capital_segment_noi', 'common_distributions',
] as const;

const ASSET_MANAGER_CANONICAL_FIELDS = [
  'aum', 'beginning_aum', 'average_aum', 'net_flows', 'realizations', 'acquisitions', 'market_change', 'fx_change', 'scope_change',
  'depreciation', 'acquisition_amortization', 'working_capital_change', 'base_fees', 'base_fee_yield',
  'capital_allocation_income', 'performance_fees', 'securities_lending_revenue',
  'technology_revenue', 'distribution_revenue', 'administrative_other_revenue', 'other_revenue', 'unmapped_revenue',
] as const;

const TELECOM_CANONICAL_FIELDS = [
  'capital_expenditures', 'working_capital_change', 'interest_bearing_debt', 'cost_of_debt',
  'wireless_subscribers', 'postpaid_subscribers', 'postpaid_phone_subscribers', 'prepaid_subscribers', 'reseller_subscribers',
  'wireless_net_additions', 'postpaid_phone_net_additions', 'postpaid_churn', 'postpaid_phone_churn',
  'mobility_revenue', 'mobility_service_revenue', 'mobility_equipment_revenue', 'mobility_operating_income', 'mobility_depreciation',
  'business_wireline_revenue', 'business_wireline_operating_income', 'business_wireline_depreciation',
  'consumer_wireline_revenue', 'consumer_broadband_revenue', 'consumer_wireline_operating_income', 'consumer_wireline_depreciation',
  'broadband_connections', 'fiber_broadband_connections', 'broadband_net_additions', 'fiber_broadband_net_additions',
  'latin_america_revenue', 'latin_america_operating_income', 'communications_revenue', 'communications_operating_income',
] as const;

const MORTGAGE_REIT_CANONICAL_FIELDS = [
  'investment_securities_fair_value', 'total_assets', 'repo_and_other_debt', 'total_liabilities', 'total_stockholders_equity',
  'net_book_value_per_common_share', 'tangible_book_value_per_common_share', 'period_end_common_shares',
  'preferred_equity_carrying_value', 'preferred_equity_liquidation_preference', 'gaap_interest_income', 'gaap_interest_expense',
  'gaap_net_interest_income', 'economic_interest_income', 'economic_interest_expense', 'other_gain_net', 'operating_expenses',
  'net_income', 'preferred_dividends', 'net_income_available_to_common', 'other_comprehensive_income', 'comprehensive_income',
  'comprehensive_income_available_to_common', 'common_dividends_per_share', 'average_investment_securities_at_cost',
  'average_tba_dollar_roll_position_at_cost', 'average_total_assets_fair_value', 'average_repo_borrowings',
  'average_mortgage_borrowings', 'average_stockholders_equity', 'average_at_risk_leverage', 'period_end_at_risk_leverage',
  'economic_return_on_tangible_common_equity', 'expenses_pct_average_assets', 'average_asset_yield',
  'average_aggregate_cost_of_funds', 'average_net_interest_spread', 'average_swap_notional', 'average_swap_ratio', 'average_swap_net_pay_rate',
] as const;

const ENERGY_CANONICAL_FIELDS = [
  'weighted_average_diluted_shares', 'current_debt', 'long_term_debt', 'interest_bearing_debt',
  'crude_oil_production', 'ngl_production', 'bitumen_production', 'synthetic_oil_production',
  'liquids_production', 'natural_gas_production_available_for_sale', 'oil_equivalent_production',
  'average_crude_price', 'average_ngl_price', 'average_bitumen_price', 'average_synthetic_oil_price', 'average_natural_gas_price',
  'average_production_cost_per_oil_equivalent_barrel', 'proved_oil_equivalent_reserves',
  'proved_developed_oil_equivalent_reserves', 'proved_undeveloped_oil_equivalent_reserves',
  'upstream_earnings_gaap', 'energy_products_earnings_gaap', 'chemical_products_earnings_gaap',
  'specialty_products_earnings_gaap', 'corporate_financing_earnings_gaap', 'upstream_depreciation_and_depletion',
  'energy_products_depreciation_and_depletion', 'chemical_products_depreciation_and_depletion',
  'specialty_products_depreciation_and_depletion', 'upstream_ppe_additions_including_noncash',
  'energy_products_ppe_additions_including_noncash', 'chemical_products_ppe_additions_including_noncash',
  'specialty_products_ppe_additions_including_noncash', 'cash_capex', 'operating_working_capital_investment',
  'corporate_interest_revenue', 'brent_2026_earnings_sensitivity', 'henry_hub_2026_earnings_sensitivity',
  'ttf_2026_earnings_sensitivity',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object`);
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${path} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, path: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') throw new TypeError(`${path} must be a string or null`);
  return value;
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${path} must be a finite number`);
  return value;
}

function nullableFiniteNumber(value: unknown, path: string): number | null {
  if (value === undefined || value === null) return null;
  return requireFiniteNumber(value, path);
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean`);
  return value;
}

function requireStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value.map((item, index) => requireString(item, `${path}[${index}]`));
}

function parseEnum<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  if (typeof value === 'string') {
    for (const choice of choices) {
      if (choice === value) return choice;
    }
  }
  throw new TypeError(`${path} must be one of: ${choices.join(', ')}`);
}

function parseModelList(value: unknown, path: string): PreferredValuationModel[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value.map((item, index) => parseEnum(item, PREFERRED_MODELS, `${path}[${index}]`));
}

function parseBlockedModels(value: unknown): BlockedModel[] {
  if (!Array.isArray(value)) throw new TypeError('model_eligibility.blocked_models must be an array');
  return value.map((item, index) => {
    const path = `model_eligibility.blocked_models[${index}]`;
    if (!isRecord(item)) throw new TypeError(`${path} must be an object`);
    if (typeof item.reason !== 'string' || item.reason.trim() === '') {
      throw new TypeError(`${path}.reason must be a non-empty string`);
    }
    return {
      model: parseEnum(item.model, PREFERRED_MODELS, `${path}.model`),
      reason: item.reason,
    };
  });
}

function parseModelReadinessGaps(value: unknown): ModelReadinessGap[] {
  if (!Array.isArray(value)) throw new TypeError('model_eligibility.missing_input_gaps must be an array');
  return value.map((item, index) => {
    const path = `model_eligibility.missing_input_gaps[${index}]`;
    if (!isRecord(item)) throw new TypeError(`${path} must be an object`);
    return {
      key: requireString(item.key, `${path}.key`),
      label: requireString(item.label, `${path}.label`),
      reason: requireString(item.reason, `${path}.reason`),
    };
  });
}

export function parseModelEligibility(value: unknown): ModelEligibility {
  if (!isRecord(value)) throw new TypeError('model_eligibility must be an object');
  if (typeof value.supported_by_current_engine !== 'boolean') {
    throw new TypeError('model_eligibility.supported_by_current_engine must be a boolean');
  }
  if (typeof value.model_route_available !== 'boolean') {
    throw new TypeError('model_eligibility.model_route_available must be a boolean');
  }
  const status = parseEnum(value.status, ['ready', 'input_required', 'unsupported'] as const, 'model_eligibility.status') as ModelBuildStatus;

  const subtype = value.subtype === undefined || value.subtype === null
    ? value.subtype as null | undefined
    : parseEnum(value.subtype, [
        'commercial_bank', 'investment_bank', 'other_financial',
        'traditional_asset_manager', 'alternative_asset_manager',
        'pc_insurer', 'life_insurer', 'reinsurer', 'other_insurer',
        'equity_reit', 'mortgage_reit', 'other_reit',
        'regulated_utility', 'mixed_utility', 'merchant_utility',
      ] as const, 'model_eligibility.subtype');
  const operatingArchetype = value.operating_archetype === undefined || value.operating_archetype === null
    ? value.operating_archetype as null | undefined
    : parseEnum(value.operating_archetype, [
        'standard_operating', 'technology_hardware', 'subscription_software', 'consumer_retail',
        'industrial_manufacturing', 'semiconductor', 'energy_materials', 'telecommunications',
        'mature_pharma', 'biotechnology', 'unclassified_operating',
      ] as const, 'model_eligibility.operating_archetype');
  const readiness = value.required_input_readiness === undefined
    ? undefined
    : requireRecord(value.required_input_readiness, 'model_eligibility.required_input_readiness');
  const preferredModel = parseEnum(value.preferred_model, PREFERRED_MODELS, 'model_eligibility.preferred_model');
  const allowedModels = parseModelList(value.allowed_models, 'model_eligibility.allowed_models');
  const missingInputGaps = parseModelReadinessGaps(value.missing_input_gaps);
  if (allowedModels.some((model) => !isProductionModelRoute(model))) {
    throw new TypeError('model_eligibility.allowed_models contains an unimplemented model route');
  }
  if (value.supported_by_current_engine && (!isProductionModelRoute(preferredModel) || !allowedModels.includes(preferredModel))) {
    throw new TypeError('model_eligibility claims support for a model without a production route');
  }
  if (status === 'ready' && (!value.supported_by_current_engine || !value.model_route_available
    || !allowedModels.includes(preferredModel) || missingInputGaps.length > 0)) {
    throw new TypeError('model_eligibility ready status conflicts with route or input readiness');
  }
  if (status === 'input_required' && (value.supported_by_current_engine || !value.model_route_available
    || !allowedModels.includes(preferredModel) || missingInputGaps.length === 0)) {
    throw new TypeError('model_eligibility input_required status needs an implemented route and at least one readiness gap');
  }
  if (status === 'unsupported' && (value.supported_by_current_engine || value.model_route_available || allowedModels.length > 0)) {
    throw new TypeError('model_eligibility unsupported status cannot claim a production route');
  }
  return {
    company_type: parseEnum(value.company_type, COMPANY_TYPES, 'model_eligibility.company_type'),
    preferred_model: preferredModel,
    allowed_models: allowedModels,
    blocked_models: parseBlockedModels(value.blocked_models),
    supported_by_current_engine: value.supported_by_current_engine,
    status,
    model_route_available: value.model_route_available,
    missing_input_gaps: missingInputGaps,
    subtype,
    operating_archetype: operatingArchetype,
    required_input_readiness: readiness
      ? Object.fromEntries(Object.entries(readiness).map(([name, ready]) => [
          name,
          requireBoolean(ready, `model_eligibility.required_input_readiness.${name}`),
        ]))
      : undefined,
  };
}

function parseProfile(value: unknown): NativeProfilePayload {
  const profile = requireRecord(value, 'profile');
  return {
    ...profile,
    cik: requireString(profile.cik, 'profile.cik'),
    ticker: requireString(profile.ticker, 'profile.ticker'),
    name: requireString(profile.name, 'profile.name'),
    exchange: optionalString(profile.exchange, 'profile.exchange'),
    sector: optionalString(profile.sector, 'profile.sector'),
    industry: optionalString(profile.industry, 'profile.industry'),
    sic: optionalString(profile.sic, 'profile.sic'),
    sic_description: optionalString(profile.sic_description, 'profile.sic_description'),
    fiscal_year_end: optionalString(profile.fiscal_year_end ?? profile.fiscalYearEnd, 'profile.fiscalYearEnd'),
    currency: optionalString(profile.currency, 'profile.currency'),
    current_price: nullableFiniteNumber(profile.current_price ?? profile.currentPrice, 'profile.currentPrice'),
    market_cap: nullableFiniteNumber(profile.market_cap ?? profile.marketCap, 'profile.marketCap'),
    beta: nullableFiniteNumber(profile.beta, 'profile.beta'),
  };
}

function parseStatementRow(value: unknown, path: string): NativeStatementRow {
  const row = requireRecord(value, path);
  for (const [key, cell] of Object.entries(row)) {
    if (/^FY\s+(?:19|20)\d{2}$/.test(key) && cell !== null) {
      requireFiniteNumber(cell, `${path}.${key}`);
      continue;
    }
    if (cell === null || typeof cell === 'string' || typeof cell === 'boolean') continue;
    if (typeof cell === 'number' && Number.isFinite(cell)) continue;
    throw new TypeError(`${path}.${key} must be a finite number, string, or null`);
  }
  return row as NativeStatementRow;
}

function parseStatementRows(value: unknown, path: string): NativeStatementRow[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value.map((row, index) => parseStatementRow(row, `${path}[${index}]`));
}

function parseKeyMetrics(value: unknown, path: string): NativeFinancialsPayload['key_metrics'] {
  const metrics = requireRecord(value, path);
  for (const [name, item] of Object.entries(metrics)) {
    if (item === null || typeof item === 'string') continue;
    if (typeof item === 'number' && Number.isFinite(item)) continue;
    if (Array.isArray(item) && item.every((entry) => entry === null || (typeof entry === 'number' && Number.isFinite(entry)))) continue;
    throw new TypeError(`${path}.${name} must be a scalar or an array of finite numbers and nulls`);
  }
  return metrics as NativeFinancialsPayload['key_metrics'];
}

function parseNativeSourceFiling(value: unknown, path: string): NativeSourceFiling {
  const filing = requireRecord(value, path);
  return {
    form: requireString(filing.form, `${path}.form`),
    filing_date: requireString(filing.filing_date, `${path}.filing_date`),
    report_date: requireString(filing.report_date, `${path}.report_date`),
    accession_number: requireString(filing.accession_number, `${path}.accession_number`),
    primary_document: optionalString(filing.primary_document, `${path}.primary_document`),
  };
}

function parseNativeSourceFact(value: unknown, path: string): NativeSourceFact {
  const fact = requireRecord(value, path);
  return {
    concept: requireString(fact.concept, `${path}.concept`),
    label: optionalString(fact.label, `${path}.label`),
    value: requireFiniteNumber(fact.value, `${path}.value`),
    unit: optionalString(fact.unit, `${path}.unit`),
    period_end: requireString(fact.period_end, `${path}.period_end`),
    fiscal_year: requireFiniteNumber(fact.fiscal_year, `${path}.fiscal_year`),
    fiscal_period: requireString(fact.fiscal_period, `${path}.fiscal_period`),
    accession_number: optionalString(fact.accession_number, `${path}.accession_number`),
    filing_date: optionalString(fact.filing_date, `${path}.filing_date`),
    form: optionalString(fact.form, `${path}.form`),
    report_date: optionalString(fact.report_date, `${path}.report_date`),
    primary_document: optionalString(fact.primary_document, `${path}.primary_document`),
    unit_scale: optionalString(fact.unit_scale, `${path}.unit_scale`),
    source_statement: optionalString(fact.source_statement, `${path}.source_statement`),
    source_components: parseObjectList(fact.source_components ?? [], `${path}.source_components`, parseNativeSourceFactComponent),
  };
}

function parseNativeSourceFactComponent(value: unknown, path: string): NativeSourceFactComponent {
  const component = requireRecord(value, path);
  const fiscalYear = requireFiniteNumber(component.fiscal_year, `${path}.fiscal_year`);
  if (!Number.isInteger(fiscalYear)) throw new TypeError(`${path}.fiscal_year must be an integer`);
  return {
    concept: requireString(component.concept, `${path}.concept`),
    label: requireString(component.label, `${path}.label`),
    value: requireFiniteNumber(component.value, `${path}.value`),
    unit: requireString(component.unit, `${path}.unit`),
    unit_scale: requireString(component.unit_scale, `${path}.unit_scale`),
    period_end: requireString(component.period_end, `${path}.period_end`),
    fiscal_year: fiscalYear,
    fiscal_period: requireString(component.fiscal_period, `${path}.fiscal_period`),
    accession_number: requireString(component.accession_number, `${path}.accession_number`),
    filing_date: requireString(component.filing_date, `${path}.filing_date`),
    form: requireString(component.form, `${path}.form`),
    report_date: requireString(component.report_date, `${path}.report_date`),
    primary_document: optionalString(component.primary_document, `${path}.primary_document`),
    source_statement: requireString(component.source_statement, `${path}.source_statement`),
  };
}

function parsePharmaNativeFact(value: unknown, path: string): PharmaNativeFact {
  const fact = requireRecord(value, path);
  const metricValues = ['product_revenue', 'reported_total_revenue', 'marketable_securities', 'basic_patent_expiration_year', 'pending_patent_term_extension_year'] as const;
  const metric = requireString(fact.metric, `${path}.metric`);
  if (!metricValues.includes(metric as typeof metricValues[number])) throw new TypeError(`${path}.metric is unsupported`);
  const fiscalYear = requireFiniteNumber(fact.fiscal_year, `${path}.fiscal_year`);
  if (!Number.isInteger(fiscalYear)) throw new TypeError(`${path}.fiscal_year must be an integer`);
  const region = optionalString(fact.region, `${path}.region`);
  if (region !== undefined && region !== null && !['us', 'major_europe', 'japan'].includes(region)) {
    throw new TypeError(`${path}.region is unsupported`);
  }
  return {
    metric: metric as PharmaNativeFact['metric'],
    product_name: requireString(fact.product_name, `${path}.product_name`),
    indication: optionalString(fact.indication, `${path}.indication`),
    region,
    value: requireFiniteNumber(fact.value, `${path}.value`),
    unit: requireString(fact.unit, `${path}.unit`),
    unit_scale: requireString(fact.unit_scale, `${path}.unit_scale`),
    period_end: requireString(fact.period_end, `${path}.period_end`),
    fiscal_year: fiscalYear,
    fiscal_period: requireString(fact.fiscal_period, `${path}.fiscal_period`),
    accession_number: requireString(fact.accession_number, `${path}.accession_number`),
    filing_date: requireString(fact.filing_date, `${path}.filing_date`),
    form: requireString(fact.form, `${path}.form`),
    report_date: requireString(fact.report_date, `${path}.report_date`),
    primary_document: optionalString(fact.primary_document, `${path}.primary_document`),
    source_statement: requireString(fact.source_statement, `${path}.source_statement`),
    reported_text: optionalString(fact.reported_text, `${path}.reported_text`),
  };
}

function parseLifeInsuranceFilingFact(value: unknown, path: string): LifeInsuranceFilingFact {
  const fact = requireRecord(value, path);
  const fiscalYear = requireFiniteNumber(fact.fiscal_year, `${path}.fiscal_year`);
  if (!Number.isInteger(fiscalYear)) throw new TypeError(`${path}.fiscal_year must be an integer`);
  const unit = parseEnum(fact.unit, ['USD', 'ratio'] as const, `${path}.unit`);
  const unitScale = parseEnum(fact.unit_scale, ['millions', 'ratio'] as const, `${path}.unit_scale`);
  if (unit === 'ratio' && unitScale !== 'ratio') throw new TypeError(`${path}.ratio facts must use ratio unit_scale`);
  const earningsBasis = parseEnum(fact.earnings_basis, [
    'after_tax_adjusted_earnings_available_to_common', 'pre_tax_adjusted_operating_income', 'not_applicable',
  ] as const, `${path}.earnings_basis`);
  const comparisonOperator = fact.comparison_operator === undefined || fact.comparison_operator === null
    ? fact.comparison_operator as null | undefined
    : parseEnum(fact.comparison_operator, ['greater_than', 'equal', 'less_than'] as const, `${path}.comparison_operator`);
  const filingDate = requireString(fact.filing_date, `${path}.filing_date`);
  const reportDate = requireString(fact.report_date, `${path}.report_date`);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(filingDate) || !/^20\d{2}-\d{2}-\d{2}$/.test(reportDate)) {
    throw new TypeError(`${path} must include ISO filing and report dates`);
  }
  const metric = requireString(fact.metric, `${path}.metric`);
  const segment = optionalString(fact.segment, `${path}.segment`);
  const capitalGroup = optionalString(fact.capital_group, `${path}.capital_group`);
  if (['adjusted_earnings_available_to_common', 'adjusted_operating_income_pretax'].includes(metric) && !segment) {
    throw new TypeError(`${path}.earnings fact must identify its reported segment`);
  }
  if (metric.endsWith('_floor') && !comparisonOperator) {
    throw new TypeError(`${path}.threshold fact must identify its comparison operator`);
  }
  return {
    metric,
    segment: segment ?? undefined,
    capital_group: capitalGroup ?? undefined,
    value: requireFiniteNumber(fact.value, `${path}.value`),
    unit,
    unit_scale: unitScale,
    fiscal_year: fiscalYear,
    fiscal_period: requireString(fact.fiscal_period, `${path}.fiscal_period`),
    accession_number: requireString(fact.accession_number, `${path}.accession_number`),
    filing_date: filingDate,
    form: parseEnum(fact.form, ['10-K', '10-K/A'] as const, `${path}.form`),
    report_date: reportDate,
    primary_document: optionalString(fact.primary_document, `${path}.primary_document`),
    source_statement: requireString(fact.source_statement, `${path}.source_statement`),
    earnings_basis: earningsBasis,
    comparison_operator: comparisonOperator ?? undefined,
  };
}

function parsePipelineAssetNativeFact(value: unknown, path: string): PipelineAssetNativeFact {
  const asset = requireRecord(value, path);
  return {
    asset_id: requireString(asset.asset_id, `${path}.asset_id`),
    asset_name: requireString(asset.asset_name, `${path}.asset_name`),
    stage: optionalString(asset.stage, `${path}.stage`),
    development_status: parseEnum(asset.development_status, ['disclosed', 'explicitly_paused'] as const, `${path}.development_status`),
    partner: optionalString(asset.partner, `${path}.partner`),
    accession_number: requireString(asset.accession_number, `${path}.accession_number`),
    filing_date: requireString(asset.filing_date, `${path}.filing_date`),
    report_date: requireString(asset.report_date, `${path}.report_date`),
    form: requireString(asset.form, `${path}.form`),
    primary_document: optionalString(asset.primary_document, `${path}.primary_document`),
    source_statement: requireString(asset.source_statement, `${path}.source_statement`),
  };
}

function parseObjectList<T>(value: unknown, path: string, parse: (item: unknown, itemPath: string) => T): T[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value.map((item, index) => parse(item, `${path}[${index}]`));
}

function parseNativeFinancials(value: unknown): NativeFinancialsPayload {
  const financials = requireRecord(value, 'financials_native');
  const statements = requireRecord(financials.statements, 'financials_native.statements');
  const periodsRequested = requireFiniteNumber(financials.periods_requested, 'financials_native.periods_requested');
  if (!Number.isInteger(periodsRequested) || periodsRequested < 1) {
    throw new TypeError('financials_native.periods_requested must be a positive integer');
  }
  const isFinancialInstitution = financials.is_financial_institution;
  if (isFinancialInstitution !== undefined && isFinancialInstitution !== null && typeof isFinancialInstitution !== 'boolean') {
    throw new TypeError('financials_native.is_financial_institution must be a boolean or null');
  }
  return {
    ...financials,
    ticker: requireString(financials.ticker, 'financials_native.ticker'),
    cik: requireString(financials.cik, 'financials_native.cik'),
    name: requireString(financials.name, 'financials_native.name'),
    source: requireString(financials.source, 'financials_native.source'),
    periods_requested: periodsRequested,
    statements: {
      income_statement: parseStatementRows(statements.income_statement, 'financials_native.statements.income_statement'),
      balance_sheet: parseStatementRows(statements.balance_sheet, 'financials_native.statements.balance_sheet'),
      cashflow_statement: parseStatementRows(statements.cashflow_statement, 'financials_native.statements.cashflow_statement'),
    },
    key_metrics: parseKeyMetrics(financials.key_metrics, 'financials_native.key_metrics'),
    source_filings: parseObjectList(financials.source_filings ?? [], 'financials_native.source_filings', parseNativeSourceFiling),
    source_facts: parseObjectList(financials.source_facts ?? [], 'financials_native.source_facts', parseNativeSourceFact),
    bank_filing_facts: parseObjectList(financials.bank_filing_facts ?? [], 'financials_native.bank_filing_facts', parseNativeSourceFact),
    insurance_filing_facts: parseObjectList(financials.insurance_filing_facts ?? [], 'financials_native.insurance_filing_facts', parseNativeSourceFact),
    life_insurance_filing_facts: parseObjectList(financials.life_insurance_filing_facts ?? [], 'financials_native.life_insurance_filing_facts', parseLifeInsuranceFilingFact),
    reit_filing_facts: parseObjectList(financials.reit_filing_facts ?? [], 'financials_native.reit_filing_facts', parseNativeSourceFact),
    asset_management_filing_facts: parseObjectList(financials.asset_management_filing_facts ?? [], 'financials_native.asset_management_filing_facts', parseNativeSourceFact),
    telecom_filing_facts: parseObjectList(financials.telecom_filing_facts ?? [], 'financials_native.telecom_filing_facts', parseNativeSourceFact),
    mortgage_reit_filing_facts: parseObjectList(financials.mortgage_reit_filing_facts ?? [], 'financials_native.mortgage_reit_filing_facts', parseNativeSourceFact),
    energy_filing_facts: parseObjectList(financials.energy_filing_facts ?? [], 'financials_native.energy_filing_facts', parseNativeSourceFact),
    pharma_filing_facts: parseObjectList(financials.pharma_filing_facts ?? [], 'financials_native.pharma_filing_facts', parsePharmaNativeFact),
    pipeline_assets: parseObjectList(financials.pipeline_assets ?? [], 'financials_native.pipeline_assets', parsePipelineAssetNativeFact),
    issuer_debt_cost_facts: parseObjectList(financials.issuer_debt_cost_facts ?? [], 'financials_native.issuer_debt_cost_facts', parseNativeSourceFact),
    shares_outstanding: nullableFiniteNumber(financials.shares_outstanding, 'financials_native.shares_outstanding'),
    public_float: nullableFiniteNumber(financials.public_float, 'financials_native.public_float'),
    is_financial_institution: isFinancialInstitution as boolean | null | undefined,
    fiscal_year_end: optionalString(financials.fiscal_year_end, 'financials_native.fiscal_year_end'),
    fetched_at_ms: nullableFiniteNumber(financials.fetched_at_ms, 'financials_native.fetched_at_ms'),
  };
}

function parseValuationContext(value: unknown, path: string): NativeUnifiedPayload['valuation_context'] {
  const context = requireRecord(value, path);
  return {
    risk_free_rate: nullableFiniteNumber(context.risk_free_rate ?? context.riskFreeRate, `${path}.risk_free_rate`),
    equity_risk_premium: nullableFiniteNumber(context.equity_risk_premium ?? context.equityRiskPremium, `${path}.equity_risk_premium`),
    fetched_at_ms: nullableFiniteNumber(context.fetched_at_ms ?? context.fetchedAtMs, `${path}.fetched_at_ms`),
    treasury_rate_source: optionalString(context.treasury_rate_source ?? context.treasuryRateSource, `${path}.treasury_rate_source`),
    erp_source: optionalString(context.erp_source ?? context.erpSource, `${path}.erp_source`),
    as_of_date: optionalString(context.as_of_date ?? context.asOfDate, `${path}.as_of_date`),
  };
}

function optionalFiniteNumber(value: unknown, path: string): number | null | undefined {
  if (value === undefined) return undefined;
  return nullableFiniteNumber(value, path);
}

function parseMarketSnapshot(value: unknown): NativeMarketSnapshot {
  const market = requireRecord(value, 'market');
  const parsed: NativeMarketSnapshot = { ...market };
  const numericFields = [
    ['current_price', 'currentPrice'],
    ['market_cap', 'marketCap'],
    ['shares_outstanding', 'sharesOutstanding'],
    ['beta', 'beta'],
    ['fetched_at_ms', 'fetchedAtMs'],
    ['debt', 'debt'],
    ['cash', 'cash'],
    ['net_debt', 'netDebt'],
    ['enterprise_value', 'enterpriseValue'],
  ] as const;
  for (const [snakeKey, camelKey] of numericFields) {
    const sourceKey = Object.hasOwn(market, snakeKey) ? snakeKey : camelKey;
    if (Object.hasOwn(market, sourceKey)) {
      parsed[snakeKey] = optionalFiniteNumber(market[sourceKey], `market.${snakeKey}`);
    }
  }
  const stringFields = [
    ['ticker', 'ticker'],
    ['currency', 'currency'],
    ['sector', 'sector'],
    ['industry', 'industry'],
    ['exchange', 'exchange'],
    ['source', 'source'],
    ['notes', 'notes'],
  ] as const;
  for (const [key, sourceKey] of stringFields) {
    if (Object.hasOwn(market, sourceKey)) parsed[key] = optionalString(market[sourceKey], `market.${key}`);
  }
  if (Object.hasOwn(market, 'fallback_used')) {
    const fallback = market.fallback_used;
    if (fallback !== null && fallback !== undefined && typeof fallback !== 'boolean') {
      throw new TypeError('market.fallback_used must be a boolean or null');
    }
    parsed.fallback_used = fallback;
  }
  return parsed;
}

function parseDataQuality(value: unknown): Record<string, UnifiedDataQualityEntry> {
  const quality = requireRecord(value, 'data_quality');
  const statuses = ['live', 'cached', 'stale', 'default', 'unavailable'] as const;
  return Object.fromEntries(Object.entries(quality).map(([name, rawEntry]) => {
    const path = `data_quality.${name}`;
    const entry = requireRecord(rawEntry, path);
    const status = parseEnum(entry.status, statuses, `${path}.status`);
    return [name, {
      status,
      source: requireString(entry.source, `${path}.source`),
      fetched_at_ms: nullableFiniteNumber(entry.fetched_at_ms, `${path}.fetched_at_ms`),
      fallback_used: requireBoolean(entry.fallback_used, `${path}.fallback_used`),
      notes: optionalString(entry.notes, `${path}.notes`),
    }];
  }));
}

function parseCanonicalSourceRecord(value: unknown, path: string): CanonicalSourceRecord {
  const source = requireRecord(value, path);
  return {
    concept: optionalString(source.concept, `${path}.concept`) ?? null,
    label: optionalString(source.label, `${path}.label`) ?? null,
    statement: optionalString(source.statement, `${path}.statement`) ?? null,
    row_id: optionalString(source.row_id, `${path}.row_id`) ?? null,
    fiscal_period: optionalString(source.fiscal_period, `${path}.fiscal_period`) ?? null,
    reported_value: nullableFiniteNumber(source.reported_value, `${path}.reported_value`),
    accession: optionalString(source.accession, `${path}.accession`) ?? null,
    filed: optionalString(source.filed, `${path}.filed`) ?? null,
    form: optionalString(source.form, `${path}.form`) ?? null,
    report_date: optionalString(source.report_date, `${path}.report_date`) ?? null,
    period_end: optionalString(source.period_end, `${path}.period_end`),
    currency: optionalString(source.currency, `${path}.currency`) ?? null,
    unit: optionalString(source.unit, `${path}.unit`) ?? null,
    unit_scale: optionalString(source.unit_scale, `${path}.unit_scale`) ?? null,
    source_fiscal_year: source.source_fiscal_year === undefined || source.source_fiscal_year === null
      ? source.source_fiscal_year
      : requireFiniteNumber(source.source_fiscal_year, `${path}.source_fiscal_year`),
  };
}

function parseCanonicalLine(value: unknown, path: string): CanonicalFinancialLine {
  const line = requireRecord(value, path);
  if (!Object.hasOwn(line, 'value')) throw new TypeError(`${path}.value is required`);
  const result: CanonicalFinancialLine = {
    value: nullableFiniteNumber(line.value, `${path}.value`),
    source: parseEnum(line.source, CANONICAL_LINE_SOURCES, `${path}.source`),
    confidence: requireFiniteNumber(line.confidence, `${path}.confidence`),
    method: requireString(line.method, `${path}.method`),
    concept: optionalString(line.concept, `${path}.concept`) ?? null,
    sources: parseObjectList(line.sources, `${path}.sources`, parseCanonicalSourceRecord),
  };
  if (line.candidates !== undefined) {
    result.candidates = parseObjectList(line.candidates, `${path}.candidates`, (candidateValue, candidatePath) => {
      const candidate = requireRecord(candidateValue, candidatePath);
      return {
        concept: optionalString(candidate.concept, `${candidatePath}.concept`) ?? null,
        value: nullableFiniteNumber(candidate.value, `${candidatePath}.value`),
        ...(candidate.source === undefined ? {} : {source: parseCanonicalSourceRecord(candidate.source, `${candidatePath}.source`)}),
      };
    });
  }
  return result;
}

function parseCanonicalAnnual(value: unknown, path: string): CanonicalAnnualFinancials {
  const annual = requireRecord(value, path);
  const year = requireFiniteNumber(annual.year, `${path}.year`);
  if (!Number.isInteger(year)) throw new TypeError(`${path}.year must be an integer`);
  const parsed: Record<string, unknown> = {year};
  for (const field of CANONICAL_FIELDS) {
    parsed[field] = parseCanonicalLine(annual[field], `${path}.${field}`);
  }
  if (annual.bank === undefined || annual.bank === null) {
    parsed.bank = annual.bank as null | undefined;
  } else {
    const bank = requireRecord(annual.bank, `${path}.bank`);
    const parsedBank: Record<string, CanonicalFinancialLine> = {};
    for (const field of BANK_CANONICAL_FIELDS) {
      parsedBank[field] = parseCanonicalLine(bank[field], `${path}.bank.${field}`);
    }
    parsed.bank = parsedBank as unknown as BankCanonicalFinancials;
  }
  if (annual.insurance === undefined || annual.insurance === null) {
    parsed.insurance = annual.insurance as null | undefined;
  } else {
    const insurance = requireRecord(annual.insurance, `${path}.insurance`);
    const parsedInsurance: Record<string, CanonicalFinancialLine> = {};
    for (const field of INSURANCE_CANONICAL_FIELDS) {
      parsedInsurance[field] = parseCanonicalLine(insurance[field], `${path}.insurance.${field}`);
    }
    parsed.insurance = parsedInsurance as unknown as InsuranceCanonicalFinancials;
  }
  if (annual.reit === undefined || annual.reit === null) {
    parsed.reit = annual.reit as null | undefined;
  } else {
    const reit = requireRecord(annual.reit, `${path}.reit`);
    const parsedReit: Record<string, CanonicalFinancialLine> = {};
    for (const field of REIT_CANONICAL_FIELDS) {
      parsedReit[field] = parseCanonicalLine(reit[field], `${path}.reit.${field}`);
    }
    parsed.reit = parsedReit as unknown as ReitCanonicalFinancials;
  }
  if (annual.asset_manager === undefined || annual.asset_manager === null) {
    parsed.asset_manager = annual.asset_manager as null | undefined;
  } else {
    const assetManager = requireRecord(annual.asset_manager, `${path}.asset_manager`);
    const parsedAssetManager: Record<string, CanonicalFinancialLine> = {};
    for (const field of ASSET_MANAGER_CANONICAL_FIELDS) {
      parsedAssetManager[field] = parseCanonicalLine(assetManager[field], `${path}.asset_manager.${field}`);
    }
    parsed.asset_manager = parsedAssetManager as unknown as AssetManagerCanonicalFinancials;
  }
  if (annual.telecom === undefined || annual.telecom === null) {
    parsed.telecom = annual.telecom as null | undefined;
  } else {
    const telecom = requireRecord(annual.telecom, `${path}.telecom`);
    const parsedTelecom: Record<string, CanonicalFinancialLine> = {};
    for (const field of TELECOM_CANONICAL_FIELDS) {
      parsedTelecom[field] = parseCanonicalLine(telecom[field], `${path}.telecom.${field}`);
    }
    parsed.telecom = parsedTelecom as unknown as TelecomCanonicalFinancials;
  }
  if (annual.mortgage_reit === undefined || annual.mortgage_reit === null) {
    parsed.mortgage_reit = annual.mortgage_reit as null | undefined;
  } else {
    const mortgageReit = requireRecord(annual.mortgage_reit, `${path}.mortgage_reit`);
    const parsedMortgageReit: Record<string, CanonicalFinancialLine> = {};
    for (const field of MORTGAGE_REIT_CANONICAL_FIELDS) {
      parsedMortgageReit[field] = parseCanonicalLine(mortgageReit[field], `${path}.mortgage_reit.${field}`);
    }
    parsed.mortgage_reit = parsedMortgageReit as unknown as MortgageReitCanonicalFinancials;
  }
  if (annual.energy === undefined || annual.energy === null) {
    parsed.energy = annual.energy as null | undefined;
  } else {
    const energy = requireRecord(annual.energy, `${path}.energy`);
    const parsedEnergy: Record<string, CanonicalFinancialLine> = {};
    for (const field of ENERGY_CANONICAL_FIELDS) {
      parsedEnergy[field] = parseCanonicalLine(energy[field], `${path}.energy.${field}`);
    }
    parsed.energy = parsedEnergy as unknown as EnergyCanonicalFinancials;
  }
  if (annual.pharma === undefined || annual.pharma === null) {
    parsed.pharma = annual.pharma as null | undefined;
  } else {
    const pharma = requireRecord(annual.pharma, `${path}.pharma`);
    const products = parseObjectList(pharma.products, `${path}.pharma.products`, (productValue, productPath) => {
      const product = requireRecord(productValue, productPath);
      return {
        product_name: requireString(product.product_name, `${productPath}.product_name`),
        indication: optionalString(product.indication, `${productPath}.indication`) ?? null,
        revenue: parseCanonicalLine(product.revenue, `${productPath}.revenue`),
      };
    });
    const regions = ['us', 'major_europe', 'japan'] as const;
    const patentMetrics = ['basic_patent_expiration_year', 'pending_patent_term_extension_year'] as const;
    const patents = parseObjectList(pharma.patents ?? [], `${path}.pharma.patents`, (patentValue, patentPath) => {
      const patent = requireRecord(patentValue, patentPath);
      return {
        product_name: requireString(patent.product_name, `${patentPath}.product_name`),
        region: parseEnum(patent.region, regions, `${patentPath}.region`),
        metric: parseEnum(patent.metric, patentMetrics, `${patentPath}.metric`),
        year: parseCanonicalLine(patent.year, `${patentPath}.year`),
        reported_text: requireString(patent.reported_text, `${patentPath}.reported_text`),
      };
    });
    parsed.pharma = {
      products,
      patents,
      reported_total_revenue: parseCanonicalLine(pharma.reported_total_revenue, `${path}.pharma.reported_total_revenue`),
    } as PharmaCanonicalFinancials;
  }
  return parsed as unknown as CanonicalAnnualFinancials;
}

function parseCanonicalFinancials(value: unknown): CanonicalFinancialsPayload {
  const canonical = requireRecord(value, 'canonical_financials');
  if (!Array.isArray(canonical.years)) throw new TypeError('canonical_financials.years must be an array');
  const years = canonical.years.map((year, index) => {
    const parsed = requireFiniteNumber(year, `canonical_financials.years[${index}]`);
    if (!Number.isInteger(parsed)) throw new TypeError(`canonical_financials.years[${index}] must be an integer`);
    return parsed;
  });
  const annual = parseObjectList(canonical.annual, 'canonical_financials.annual', parseCanonicalAnnual);
  const latest = canonical.latest === null || canonical.latest === undefined
    ? null
    : parseCanonicalAnnual(canonical.latest, 'canonical_financials.latest');
  const metadata = requireRecord(canonical.metadata, 'canonical_financials.metadata');
  const quality = requireRecord(canonical.quality, 'canonical_financials.quality');
  const parsedQuality = Object.fromEntries(Object.entries(quality).map(([name, status]) => [
    name,
    requireBoolean(status, `canonical_financials.quality.${name}`),
  ]));
  if (annual.length !== years.length) throw new TypeError('canonical_financials.annual must align with years');
  return {
    currency: optionalString(canonical.currency, 'canonical_financials.currency') ?? null,
    scale: requireString(canonical.scale, 'canonical_financials.scale'),
    metadata,
    years,
    annual,
    latest,
    quality: parsedQuality,
  };
}

function parseBankModelExportData(value: unknown, allowMissingMinimumCet1Ratio = false): BankModelExportData | IncompleteBankModelExportData {
  const bankModel = requireRecord(value, 'export.bankModel');
  const history = requireRecord(bankModel.history, 'export.bankModel.history');
  if (!Array.isArray(history.years)) throw new TypeError('export.bankModel.history.years must be an array');
  const years = history.years.map((year, index) => {
    const parsed = requireFiniteNumber(year, `export.bankModel.history.years[${index}]`);
    if (!Number.isInteger(parsed)) throw new TypeError(`export.bankModel.history.years[${index}] must be an integer`);
    return parsed;
  });
  const annual = parseObjectList(history.annual, 'export.bankModel.history.annual', (item, path) => {
    const record = requireRecord(item, path);
    const year = requireFiniteNumber(record.year, `${path}.year`);
    if (!Number.isInteger(year)) throw new TypeError(`${path}.year must be an integer`);
    const bank = requireRecord(record.bank, `${path}.bank`);
    const parsedBank: Record<string, CanonicalFinancialLine> = {};
    for (const field of BANK_CANONICAL_FIELDS) {
      parsedBank[field] = parseCanonicalLine(bank[field], `${path}.bank.${field}`);
    }
    return {
      year,
      bank: parsedBank as unknown as BankCanonicalFinancials,
      totalRevenue: parseCanonicalLine(record.totalRevenue, `${path}.totalRevenue`),
      netIncome: parseCanonicalLine(record.netIncome, `${path}.netIncome`),
      taxRate: parseCanonicalLine(record.taxRate, `${path}.taxRate`),
    };
  });
  if (annual.length === 0 || annual.length !== years.length
    || annual.some((item, index) => item.year !== years[index])) {
    throw new TypeError('export.bankModel.history.annual must align with fiscal years');
  }

  const rawAssumptions = requireRecord(bankModel.assumptions, 'export.bankModel.assumptions');
  const numericFields = [
    'forecastYears', 'earningAssetGrowth', 'loanGrowth', 'depositGrowth', 'earningAssetYield',
    'fundingCost', 'noninterestIncomeGrowth', 'efficiencyRatio', 'provisionRate', 'taxRate',
    'payoutRatio', 'minimumCet1Ratio', 'riskFreeRate', 'equityRiskPremium', 'beta',
    'terminalGrowthRate', 'currentPrice', 'dilutedSharesOutstanding',
  ] as const;
  const parsedAssumptions: Record<string, unknown> = {};
  for (const field of numericFields) {
    if (field === 'minimumCet1Ratio' && allowMissingMinimumCet1Ratio && rawAssumptions[field] === null) {
      parsedAssumptions[field] = null;
    } else {
      parsedAssumptions[field] = requireFiniteNumber(rawAssumptions[field], `export.bankModel.assumptions.${field}`);
    }
  }
  if (!Number.isInteger(parsedAssumptions.forecastYears)) {
    throw new TypeError('export.bankModel.assumptions.forecastYears must be an integer');
  }
  for (const field of ['minimumCet1RatioSource', 'riskFreeRateSource', 'equityRiskPremiumSource', 'betaSource', 'marketDataAsOfDate'] as const) {
    parsedAssumptions[field] = requireString(rawAssumptions[field], `export.bankModel.assumptions.${field}`);
  }
  const assumptionSources = requireRecord(rawAssumptions.assumptionSources, 'export.bankModel.assumptions.assumptionSources');
  const sourceFields = [
    'earningAssetGrowth', 'loanGrowth', 'depositGrowth', 'earningAssetYield', 'fundingCost',
    'noninterestIncomeGrowth', 'efficiencyRatio', 'provisionRate', 'taxRate', 'payoutRatio',
    'terminalGrowthRate',
  ] as const;
  parsedAssumptions.assumptionSources = Object.fromEntries(sourceFields.map((field) => [
    field,
    requireString(assumptionSources[field], `export.bankModel.assumptions.assumptionSources.${field}`),
  ]));
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(parsedAssumptions.marketDataAsOfDate))) {
    throw new TypeError('export.bankModel.assumptions.marketDataAsOfDate must be an ISO date');
  }
  if (allowMissingMinimumCet1Ratio && parsedAssumptions.minimumCet1Ratio === null) {
    return {
      history: {years, annual},
      assumptions: parsedAssumptions as unknown as IncompleteBankModelExportData['assumptions'],
    };
  }
  return {
    history: {years, annual},
    assumptions: parsedAssumptions as unknown as BankModelAssumptions,
  };
}

function parseInsuranceModelExportData(value: unknown): InsuranceModelExportData {
  const insuranceModel = requireRecord(value, 'export.insuranceModel');
  const history = requireRecord(insuranceModel.history, 'export.insuranceModel.history');
  if (!Array.isArray(history.years)) throw new TypeError('export.insuranceModel.history.years must be an array');
  const years = history.years.map((year, index) => {
    const parsed = requireFiniteNumber(year, `export.insuranceModel.history.years[${index}]`);
    if (!Number.isInteger(parsed)) throw new TypeError(`export.insuranceModel.history.years[${index}] must be an integer`);
    return parsed;
  });
  const annual = parseObjectList(history.annual, 'export.insuranceModel.history.annual', (item, path) => {
    const record = requireRecord(item, path);
    const year = requireFiniteNumber(record.year, `${path}.year`);
    if (!Number.isInteger(year)) throw new TypeError(`${path}.year must be an integer`);
    const rawInsurance = requireRecord(record.insurance, `${path}.insurance`);
    const parsedInsurance: Record<string, CanonicalFinancialLine> = {};
    for (const field of INSURANCE_CANONICAL_FIELDS) {
      parsedInsurance[field] = parseCanonicalLine(rawInsurance[field], `${path}.insurance.${field}`);
    }
    return {
      year,
      insurance: parsedInsurance as unknown as InsuranceCanonicalFinancials,
      totalRevenue: parseCanonicalLine(record.totalRevenue, `${path}.totalRevenue`),
      netIncome: parseCanonicalLine(record.netIncome, `${path}.netIncome`),
      taxRate: parseCanonicalLine(record.taxRate, `${path}.taxRate`),
    };
  });
  if (annual.length === 0 || annual.length !== years.length
    || annual.some((item, index) => item.year !== years[index])) {
    throw new TypeError('insurance history annual rows must align with fiscal years');
  }

  const rawAssumptions = requireRecord(insuranceModel.assumptions, 'export.insuranceModel.assumptions');
  const numericFields = [
    'forecastYears', 'premiumGrowth', 'lossRatio', 'expenseRatio', 'priorYearReserveDevelopmentRate',
    'netInvestmentIncomeYield', 'investedAssetGrowth', 'paidLossRatio', 'reserveOtherChangesRate',
    'otherOperationsPretaxGrowth', 'otherPretaxAdjustmentGrowth', 'taxRate', 'payoutRatio',
    'minimumStatutoryCapitalToPremiumRatio', 'riskFreeRate', 'equityRiskPremium', 'beta',
    'terminalGrowthRate', 'currentPrice', 'dilutedSharesOutstanding',
  ] as const;
  const parsedAssumptions: Record<string, unknown> = {};
  for (const field of numericFields) parsedAssumptions[field] = requireFiniteNumber(rawAssumptions[field], `export.insuranceModel.assumptions.${field}`);
  if (!Number.isInteger(parsedAssumptions.forecastYears)) {
    throw new TypeError('export.insuranceModel.assumptions.forecastYears must be an integer');
  }
  for (const field of [
    'minimumStatutoryCapitalSource', 'riskFreeRateSource', 'equityRiskPremiumSource',
    'betaSource', 'marketDataAsOfDate',
  ] as const) {
    parsedAssumptions[field] = requireString(rawAssumptions[field], `export.insuranceModel.assumptions.${field}`);
  }
  const assumptionSources = requireRecord(rawAssumptions.assumptionSources, 'export.insuranceModel.assumptions.assumptionSources');
  const sourceFields = [
    'premiumGrowth', 'lossRatio', 'expenseRatio', 'priorYearReserveDevelopmentRate',
    'netInvestmentIncomeYield', 'investedAssetGrowth', 'paidLossRatio', 'reserveOtherChangesRate',
    'otherOperationsPretaxGrowth', 'otherPretaxAdjustmentGrowth', 'taxRate', 'payoutRatio',
    'minimumStatutoryCapitalToPremiumRatio', 'terminalGrowthRate',
  ] as const;
  parsedAssumptions.assumptionSources = Object.fromEntries(sourceFields.map((field) => [
    field,
    requireString(assumptionSources[field], `export.insuranceModel.assumptions.assumptionSources.${field}`),
  ]));
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(parsedAssumptions.marketDataAsOfDate))) {
    throw new TypeError('export.insuranceModel.assumptions.marketDataAsOfDate must be an ISO date');
  }
  return {
    history: {years, annual},
    assumptions: parsedAssumptions as unknown as InsuranceModelAssumptions,
  };
}

function parseReitModelExportData(value: unknown, allowMissingSameStoreNoiGrowth = false): ReitModelExportData | IncompleteReitModelExportData {
  const reitModel = requireRecord(value, 'export.reitModel');
  const history = requireRecord(reitModel.history, 'export.reitModel.history');
  if (!Array.isArray(history.years)) throw new TypeError('export.reitModel.history.years must be an array');
  const years = history.years.map((year, index) => {
    const parsed = requireFiniteNumber(year, `export.reitModel.history.years[${index}]`);
    if (!Number.isInteger(parsed)) throw new TypeError(`export.reitModel.history.years[${index}] must be an integer`);
    return parsed;
  });
  const annual = parseObjectList(history.annual, 'export.reitModel.history.annual', (item, path) => {
    const record = requireRecord(item, path);
    const year = requireFiniteNumber(record.year, `${path}.year`);
    if (!Number.isInteger(year)) throw new TypeError(`${path}.year must be an integer`);
    const rawReit = requireRecord(record.reit, `${path}.reit`);
    const parsedReit: Record<string, CanonicalFinancialLine> = {};
    for (const field of REIT_CANONICAL_FIELDS) {
      parsedReit[field] = parseCanonicalLine(rawReit[field], `${path}.reit.${field}`);
    }
    return {
      year,
      reit: parsedReit as unknown as ReitCanonicalFinancials,
      netIncome: parseCanonicalLine(record.netIncome, `${path}.netIncome`),
      commonEquity: parseCanonicalLine(record.commonEquity, `${path}.commonEquity`),
      cash: parseCanonicalLine(record.cash, `${path}.cash`),
      longTermDebt: parseCanonicalLine(record.longTermDebt, `${path}.longTermDebt`),
      preferredEquity: parseCanonicalLine(record.preferredEquity, `${path}.preferredEquity`),
      nonControllingInterest: parseCanonicalLine(record.nonControllingInterest, `${path}.nonControllingInterest`),
      dilutedShares: parseCanonicalLine(record.dilutedShares, `${path}.dilutedShares`),
    };
  });
  if (annual.length !== 3 || years.length !== 3 || annual.some((item, index) => item.year !== years[index])) {
    throw new TypeError('REIT history must contain three aligned filed annual periods');
  }

  const rawAssumptions = requireRecord(reitModel.assumptions, 'export.reitModel.assumptions');
  const numericFields = [
    'forecastYears', 'sameStoreNoiGrowth', 'targetOccupancy', 'recurringCapexRatio', 'payoutRatio', 'terminalGrowthRate',
    'navCapRate', 'riskFreeRate', 'equityRiskPremium', 'beta', 'marketCapitalization', 'currentPrice', 'dilutedSharesOutstanding',
  ] as const;
  const parsedAssumptions: Record<string, unknown> = {};
  for (const field of numericFields) {
    if (field === 'sameStoreNoiGrowth' && allowMissingSameStoreNoiGrowth && rawAssumptions[field] === null) {
      parsedAssumptions[field] = null;
    } else {
      parsedAssumptions[field] = requireFiniteNumber(rawAssumptions[field], `export.reitModel.assumptions.${field}`);
    }
  }
  if (!Number.isInteger(parsedAssumptions.forecastYears)) {
    throw new TypeError('export.reitModel.assumptions.forecastYears must be an integer');
  }
  for (const field of ['riskFreeRateSource', 'equityRiskPremiumSource', 'betaSource', 'marketDataAsOfDate'] as const) {
    parsedAssumptions[field] = requireString(rawAssumptions[field], `export.reitModel.assumptions.${field}`);
  }
  const assumptionSources = requireRecord(rawAssumptions.assumptionSources, 'export.reitModel.assumptions.assumptionSources');
  const sourceFields = ['sameStoreNoiGrowth', 'targetOccupancy', 'recurringCapexRatio', 'payoutRatio', 'terminalGrowthRate', 'navCapRate'] as const;
  parsedAssumptions.assumptionSources = Object.fromEntries(sourceFields.map((field) => [
    field,
    requireString(assumptionSources[field], `export.reitModel.assumptions.assumptionSources.${field}`),
  ]));
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(parsedAssumptions.marketDataAsOfDate))) {
    throw new TypeError('export.reitModel.assumptions.marketDataAsOfDate must be an ISO date');
  }
  if (allowMissingSameStoreNoiGrowth && parsedAssumptions.sameStoreNoiGrowth === null) {
    return {
      history: {years, annual},
      assumptions: parsedAssumptions as unknown as IncompleteReitModelExportData['assumptions'],
    };
  }
  return {
    history: {years, annual},
    assumptions: parsedAssumptions as unknown as ReitModelAssumptions,
  };
}

function parseAssetManagerCanonicalFinancials(value: unknown, path: string): AssetManagerCanonicalFinancials {
  const assetManager = requireRecord(value, path);
  const parsed: Record<string, CanonicalFinancialLine> = {};
  for (const field of ASSET_MANAGER_CANONICAL_FIELDS) {
    parsed[field] = parseCanonicalLine(assetManager[field], `${path}.${field}`);
  }
  return parsed as unknown as AssetManagerCanonicalFinancials;
}

function parseAssetManagerExportHistoryYear(value: unknown, path: string): AssetManagerHistoricalYear {
  const record = requireRecord(value, path);
  const year = requireFiniteNumber(record.year, `${path}.year`);
  if (!Number.isInteger(year)) throw new TypeError(`${path}.year must be an integer`);
  return {
    year,
    assetManager: parseAssetManagerCanonicalFinancials(record.assetManager ?? record.asset_manager, `${path}.assetManager`),
    revenue: parseCanonicalLine(record.revenue, `${path}.revenue`),
    ebit: parseCanonicalLine(record.ebit, `${path}.ebit`),
    interestExpense: parseCanonicalLine(record.interestExpense ?? record.interest_expense, `${path}.interestExpense`),
    incomeTaxExpense: parseCanonicalLine(record.incomeTaxExpense ?? record.income_tax_expense, `${path}.incomeTaxExpense`),
    taxRate: parseCanonicalLine(record.taxRate ?? record.tax_rate, `${path}.taxRate`),
    depreciation: parseCanonicalLine(record.depreciation, `${path}.depreciation`),
    capex: parseCanonicalLine(record.capex, `${path}.capex`),
    nwcChange: parseCanonicalLine(record.nwcChange ?? record.nwc_change, `${path}.nwcChange`),
    cash: parseCanonicalLine(record.cash, `${path}.cash`),
    marketableSecurities: parseCanonicalLine(record.marketableSecurities ?? record.marketable_securities, `${path}.marketableSecurities`),
    debt: parseCanonicalLine(record.debt, `${path}.debt`),
    leaseLiabilities: parseCanonicalLine(record.leaseLiabilities ?? record.lease_liabilities, `${path}.leaseLiabilities`),
    nonControllingInterest: parseCanonicalLine(record.nonControllingInterest ?? record.non_controlling_interest, `${path}.nonControllingInterest`),
    preferredEquity: parseCanonicalLine(record.preferredEquity ?? record.preferred_equity, `${path}.preferredEquity`),
    dilutedShares: parseCanonicalLine(record.dilutedShares ?? record.diluted_shares, `${path}.dilutedShares`),
  };
}

function parseAssetManagerModelExportData(value: unknown, allowMissingBaseFeeYield = false): AssetManagerModelExportData | IncompleteAssetManagerModelExportData {
  const assetManagerModel = requireRecord(value, 'export.assetManagerModel');
  const rawHistory = requireRecord(assetManagerModel.history, 'export.assetManagerModel.history');
  const rawYears = rawHistory.years;
  if (!Array.isArray(rawYears)) throw new TypeError('export.assetManagerModel.history.years must be an array');
  const years = rawYears.map((item, index) => {
    const year = requireFiniteNumber(item, `export.assetManagerModel.history.years[${index}]`);
    if (!Number.isInteger(year)) throw new TypeError(`export.assetManagerModel.history.years[${index}] must be an integer`);
    return year;
  });
  const annual = parseObjectList(rawHistory.annual, 'export.assetManagerModel.history.annual', parseAssetManagerExportHistoryYear);
  if (years.length !== 3 || annual.length !== 3 || annual.some((item, index) => item.year !== years[index])) {
    throw new TypeError('export.assetManagerModel.history must contain three aligned annual periods');
  }
  if (years.some((year, index) => index > 0 && year !== years[index - 1]! + 1)) {
    throw new TypeError('export.assetManagerModel.history must contain three consecutive fiscal years');
  }

  const rawAssumptions = requireRecord(assetManagerModel.assumptions, 'export.assetManagerModel.assumptions');
  const numericFields = [
    'forecastYears', 'baseYear', 'marketReturnRate', 'netFlowRate', 'realizationsRate', 'acquisitionRate', 'fxChangeRate',
    'scopeChangeRate', 'baseFeeYield', 'performanceFeeYield', 'capitalAllocationYield', 'securitiesLendingYield',
    'technologyRevenueBase', 'technologyRevenueGrowth', 'distributionFeeYield', 'administrativeOtherRevenueGrowth', 'otherRevenueGrowth',
    'unmappedRevenueGrowth', 'operatingMargin', 'taxRate', 'depreciationPctRevenue', 'acquisitionAmortizationPctRevenue',
    'capexPctRevenue', 'workingCapitalChangePctRevenue', 'riskFreeRate', 'equityRiskPremium', 'beta', 'costOfDebt',
    'debtWeight', 'equityWeight', 'wacc', 'terminalGrowthRate', 'currentPrice', 'marketCapitalization', 'dilutedShares',
    'cash', 'marketableSecurities', 'debt', 'nonControllingInterest', 'preferredEquity',
  ] as const;
  const parsedAssumptions: Record<string, unknown> = {};
  for (const field of numericFields) {
    if (field === 'baseFeeYield' && allowMissingBaseFeeYield && rawAssumptions[field] === null) {
      parsedAssumptions[field] = null;
    } else {
      parsedAssumptions[field] = requireFiniteNumber(rawAssumptions[field], `export.assetManagerModel.assumptions.${field}`);
    }
  }
  if (parsedAssumptions.forecastYears !== 5 || !Number.isInteger(parsedAssumptions.baseYear)) {
    throw new TypeError('export.assetManagerModel.assumptions requires a five-year horizon and integer base year');
  }
  parsedAssumptions.asOfDate = requireString(rawAssumptions.asOfDate, 'export.assetManagerModel.assumptions.asOfDate');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(parsedAssumptions.asOfDate))) {
    throw new TypeError('export.assetManagerModel.assumptions.asOfDate must be an ISO date');
  }
  if (Number(parsedAssumptions.terminalGrowthRate) >= Number(parsedAssumptions.wacc)) {
    throw new TypeError('export.assetManagerModel terminal growth must be below WACC');
  }
  const rawSources = requireRecord(rawAssumptions.assumptionSources, 'export.assetManagerModel.assumptions.assumptionSources');
  const sourceFields = [
    'marketReturnRate', 'netFlowRate', 'realizationsRate', 'acquisitionRate', 'fxChangeRate', 'scopeChangeRate',
    'baseFeeYield', 'performanceFeeYield', 'capitalAllocationYield', 'securitiesLendingYield', 'technologyRevenueGrowth',
    'technologyRevenueBase',
    'distributionFeeYield', 'administrativeOtherRevenueGrowth', 'otherRevenueGrowth', 'unmappedRevenueGrowth',
    'operatingMargin', 'taxRate', 'depreciationPctRevenue', 'acquisitionAmortizationPctRevenue', 'capexPctRevenue',
    'workingCapitalChangePctRevenue', 'costOfDebt', 'wacc', 'terminalGrowthRate',
  ] as const;
  parsedAssumptions.assumptionSources = Object.fromEntries(sourceFields.map((field) => [
    field,
    requireString(rawSources[field], `export.assetManagerModel.assumptions.assumptionSources.${field}`),
  ]));

  if (allowMissingBaseFeeYield && parsedAssumptions.baseFeeYield === null) {
    return {
      history: {years, annual},
      assumptions: parsedAssumptions as unknown as IncompleteAssetManagerModelExportData['assumptions'],
    };
  }
  return {
    history: {years, annual},
    assumptions: parsedAssumptions as unknown as AssetManagerModelAssumptions,
  };
}

function parseTelecomModelExportData(value: unknown, allowMissingChurn = false): TelecomModelExportData | IncompleteTelecomModelExportData {
  const telecomModel = requireRecord(value, 'export.telecomModel');
  const rawHistory = requireRecord(telecomModel.history, 'export.telecomModel.history');
  if (!Array.isArray(rawHistory.years)) throw new TypeError('export.telecomModel.history.years must be an array');
  const years = rawHistory.years.map((item, index) => {
    const year = requireFiniteNumber(item, `export.telecomModel.history.years[${index}]`);
    if (!Number.isInteger(year)) throw new TypeError(`export.telecomModel.history.years[${index}] must be an integer`);
    return year;
  });
  const annual = parseObjectList(rawHistory.annual, 'export.telecomModel.history.annual', (item, path) => {
    const record = requireRecord(item, path);
    const year = requireFiniteNumber(record.year, `${path}.year`);
    if (!Number.isInteger(year)) throw new TypeError(`${path}.year must be an integer`);
    const rawTelecom = requireRecord(record.telecom, `${path}.telecom`);
    const parsedTelecom: Record<string, CanonicalFinancialLine> = {};
    for (const field of TELECOM_CANONICAL_FIELDS) parsedTelecom[field] = parseCanonicalLine(rawTelecom[field], `${path}.telecom.${field}`);
    return {
      year,
      telecom: parsedTelecom as unknown as TelecomCanonicalFinancials,
      revenue: parseCanonicalLine(record.revenue, `${path}.revenue`),
      ebit: parseCanonicalLine(record.ebit, `${path}.ebit`),
      interestExpense: parseCanonicalLine(record.interestExpense ?? record.interest_expense, `${path}.interestExpense`),
      taxRate: parseCanonicalLine(record.taxRate ?? record.tax_rate, `${path}.taxRate`),
      depreciation: parseCanonicalLine(record.depreciation, `${path}.depreciation`),
      capex: parseCanonicalLine(record.capex, `${path}.capex`),
      nwcChange: parseCanonicalLine(record.nwcChange ?? record.nwc_change, `${path}.nwcChange`),
      cash: parseCanonicalLine(record.cash, `${path}.cash`),
      marketableSecurities: parseCanonicalLine(record.marketableSecurities ?? record.marketable_securities, `${path}.marketableSecurities`),
      debt: parseCanonicalLine(record.debt, `${path}.debt`),
      nonControllingInterest: parseCanonicalLine(record.nonControllingInterest ?? record.non_controlling_interest, `${path}.nonControllingInterest`),
      preferredEquity: parseCanonicalLine(record.preferredEquity ?? record.preferred_equity, `${path}.preferredEquity`),
      dilutedShares: parseCanonicalLine(record.dilutedShares ?? record.diluted_shares, `${path}.dilutedShares`),
    };
  });
  if (years.length !== 4 || annual.length !== 4 || annual.some((item, index) => item.year !== years[index])
    || years.some((year, index) => index > 0 && year !== years[index - 1]! + 1)) {
    throw new TypeError('export.telecomModel.history must contain four aligned annual periods');
  }

  const rawAssumptions = requireRecord(telecomModel.assumptions, 'export.telecomModel.assumptions');
  const numericFields = [
    'forecastYears', 'baseYear', 'postpaidGrossAddRate', 'postpaidPhoneMonthlyChurn', 'otherWirelessSubscriberGrowth',
    'serviceRevenuePerSubscriberGrowth', 'equipmentRevenuePerSubscriberGrowth', 'broadbandNetAdditionsRate',
    'broadbandRevenuePerConnectionGrowth', 'consumerNonBroadbandRevenueGrowth', 'businessWirelineRevenueGrowth',
    'latinAmericaRevenueGrowth', 'otherRevenueGrowth', 'mobilityOperatingMargin', 'businessWirelineOperatingMargin',
    'consumerWirelineOperatingMargin', 'latinAmericaOperatingMargin', 'unallocatedOperatingIncomeMargin', 'taxRate',
    'depreciationPctRevenue', 'capexPctRevenue', 'workingCapitalChangePctRevenue', 'riskFreeRate', 'equityRiskPremium',
    'beta', 'costOfDebt', 'debtWeight', 'equityWeight', 'wacc', 'terminalGrowthRate', 'currentPrice',
    'marketCapitalization', 'dilutedShares', 'cash', 'marketableSecurities', 'debt', 'nonControllingInterest', 'preferredEquity',
  ] as const;
  const parsedAssumptions: Record<string, unknown> = {};
  for (const field of numericFields) {
    if (allowMissingChurn && ['postpaidGrossAddRate', 'postpaidPhoneMonthlyChurn'].includes(field)
      && rawAssumptions[field] === null) {
      parsedAssumptions[field] = null;
    } else {
      parsedAssumptions[field] = requireFiniteNumber(rawAssumptions[field], `export.telecomModel.assumptions.${field}`);
    }
  }
  if (parsedAssumptions.forecastYears !== 5 || !Number.isInteger(parsedAssumptions.baseYear)) {
    throw new TypeError('export.telecomModel.assumptions requires a five-year horizon and integer base year');
  }
  parsedAssumptions.asOfDate = requireString(rawAssumptions.asOfDate, 'export.telecomModel.assumptions.asOfDate');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(parsedAssumptions.asOfDate))) throw new TypeError('export.telecomModel.assumptions.asOfDate must be an ISO date');
  if (Number(parsedAssumptions.terminalGrowthRate) >= Number(parsedAssumptions.wacc)) throw new TypeError('export.telecomModel terminal growth must be below WACC');
  if (years.at(-1) !== parsedAssumptions.baseYear) throw new TypeError('export.telecomModel base year must match the latest actual');
  const rawSources = requireRecord(rawAssumptions.assumptionSources, 'export.telecomModel.assumptions.assumptionSources');
  const sourceFields = [
    'postpaidGrossAddRate', 'postpaidPhoneMonthlyChurn', 'otherWirelessSubscriberGrowth', 'serviceRevenuePerSubscriberGrowth',
    'equipmentRevenuePerSubscriberGrowth', 'broadbandNetAdditionsRate', 'broadbandRevenuePerConnectionGrowth',
    'consumerNonBroadbandRevenueGrowth', 'businessWirelineRevenueGrowth', 'latinAmericaRevenueGrowth', 'otherRevenueGrowth',
    'mobilityOperatingMargin', 'businessWirelineOperatingMargin', 'consumerWirelineOperatingMargin', 'latinAmericaOperatingMargin',
    'unallocatedOperatingIncomeMargin', 'taxRate', 'depreciationPctRevenue', 'capexPctRevenue', 'workingCapitalChangePctRevenue',
    'costOfDebt', 'wacc', 'terminalGrowthRate',
  ] as const;
  parsedAssumptions.assumptionSources = Object.fromEntries(sourceFields.map((field) => [
    field,
    requireString(rawSources[field], `export.telecomModel.assumptions.assumptionSources.${field}`),
  ]));
  if (allowMissingChurn && parsedAssumptions.postpaidGrossAddRate === null && parsedAssumptions.postpaidPhoneMonthlyChurn === null) {
    return {history: {years, annual}, assumptions: parsedAssumptions as unknown as IncompleteTelecomModelExportData['assumptions']};
  }
  return {history: {years, annual}, assumptions: parsedAssumptions as unknown as TelecomModelAssumptions};
}

function parseMortgageReitModelExportData(value: unknown): MortgageReitModelExportData {
  const model = requireRecord(value, 'export.mortgageReitModel');
  const rawHistory = requireRecord(model.history, 'export.mortgageReitModel.history');
  if (!Array.isArray(rawHistory.years)) throw new TypeError('export.mortgageReitModel.history.years must be an array');
  const years = rawHistory.years.map((item, index) => {
    const year = requireFiniteNumber(item, `export.mortgageReitModel.history.years[${index}]`);
    if (!Number.isInteger(year)) throw new TypeError(`export.mortgageReitModel.history.years[${index}] must be an integer`);
    return year;
  });
  const annual = parseObjectList(rawHistory.annual, 'export.mortgageReitModel.history.annual', (item, path) => {
    const record = requireRecord(item, path);
    const year = requireFiniteNumber(record.year, `${path}.year`);
    if (!Number.isInteger(year)) throw new TypeError(`${path}.year must be an integer`);
    const rawMortgageReit = requireRecord(record.mortgageReit ?? record.mortgage_reit, `${path}.mortgageReit`);
    const mortgageReit: Record<string, CanonicalFinancialLine> = {};
    for (const field of MORTGAGE_REIT_CANONICAL_FIELDS) mortgageReit[field] = parseCanonicalLine(rawMortgageReit[field], `${path}.mortgageReit.${field}`);
    return {
      year,
      mortgageReit: mortgageReit as unknown as MortgageReitCanonicalFinancials,
      netIncome: parseCanonicalLine(record.netIncome ?? record.net_income, `${path}.netIncome`),
      taxRate: parseCanonicalLine(record.taxRate ?? record.tax_rate, `${path}.taxRate`),
      cash: parseCanonicalLine(record.cash, `${path}.cash`),
      marketableSecurities: parseCanonicalLine(record.marketableSecurities ?? record.marketable_securities, `${path}.marketableSecurities`),
      nonControllingInterest: parseCanonicalLine(record.nonControllingInterest ?? record.non_controlling_interest, `${path}.nonControllingInterest`),
      dilutedShares: parseCanonicalLine(record.dilutedShares ?? record.diluted_shares, `${path}.dilutedShares`),
    } satisfies MortgageReitHistoricalYear;
  });
  if (years.length !== 4 || annual.length !== 4 || annual.some((item, index) => item.year !== years[index])
    || years.some((year, index) => index > 0 && year !== years[index - 1]! + 1)) {
    throw new TypeError('export.mortgageReitModel.history must contain four aligned consecutive annual periods');
  }

  const rawAssumptions = requireRecord(model.assumptions, 'export.mortgageReitModel.assumptions');
  const numericFields = [
    'forecastYears', 'baseYear', 'assetYield', 'assetYieldChange', 'aggregateCostOfFunds', 'fundingCostChange',
    'averageSwapRatio', 'swapRatioChange', 'averageSwapNetPayRate', 'swapNetPayRateChange',
    'investmentAssetsToCommonEquity', 'mortgageBorrowingsToCommonEquity', 'otherIncomePctAverageAssets',
    'operatingExpensesPctAverageAssets', 'preferredDividendYield', 'payoutRatio', 'dividendPerShareGrowth',
    'marketValueChangePerShare', 'taxRate', 'riskFreeRate', 'equityRiskPremium', 'beta', 'costOfEquity',
    'terminalGrowthRate', 'currentPrice', 'commonSharesOutstanding', 'commonBookValuePerShare',
    'preferredLiquidationPreference', 'cash', 'debt',
  ] as const;
  const parsed: Record<string, unknown> = {};
  for (const field of numericFields) parsed[field] = requireFiniteNumber(rawAssumptions[field], `export.mortgageReitModel.assumptions.${field}`);
  if (parsed.forecastYears !== 5 || !Number.isInteger(parsed.baseYear)) {
    throw new TypeError('export.mortgageReitModel.assumptions requires a five-year forecast and integer base year');
  }
  parsed.asOfDate = requireString(rawAssumptions.asOfDate, 'export.mortgageReitModel.assumptions.asOfDate');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(parsed.asOfDate))) throw new TypeError('export.mortgageReitModel.assumptions.asOfDate must be an ISO date');
  if (Number(parsed.terminalGrowthRate) >= Number(parsed.costOfEquity)) throw new TypeError('export.mortgageReitModel terminal growth must be below cost of equity');
  if (years.at(-1) !== parsed.baseYear) throw new TypeError('export.mortgageReitModel base year must match the latest actual');
  const rawSources = requireRecord(rawAssumptions.assumptionSources, 'export.mortgageReitModel.assumptions.assumptionSources');
  const sourceFields = [
    'assetYield', 'fundingCost', 'investmentAssetsToCommonEquity', 'mortgageBorrowingsToCommonEquity',
    'otherIncomePctAverageAssets', 'operatingExpensesPctAverageAssets', 'preferredDividendYield', 'payoutRatio',
    'dividendPerShareGrowth', 'marketValueChangePerShare', 'taxRate', 'costOfEquity', 'terminalGrowthRate',
    'commonSharesOutstanding', 'commonBookValuePerShare', 'preferredLiquidationPreference', 'currentPrice',
    'assetYieldChange', 'fundingCostChange', 'swapRatio', 'swapRatioChange', 'swapNetPayRate', 'swapNetPayRateChange',
  ] as const;
  parsed.assumptionSources = Object.fromEntries(sourceFields.map((field) => [
    field,
    requireString(rawSources[field], `export.mortgageReitModel.assumptions.assumptionSources.${field}`),
  ]));
  return {
    history: {years, annual} satisfies MortgageReitHistoricalData,
    assumptions: parsed as unknown as MortgageReitModelAssumptions,
  };
}

function parseIntegratedEnergyModelExportData(value: unknown, allowMissingCrudeProduction = false): IntegratedEnergyModelExportData | IncompleteIntegratedEnergyModelExportData {
  const model = requireRecord(value, 'export.integratedEnergyModel');
  const rawHistory = requireRecord(model.history, 'export.integratedEnergyModel.history');
  if (!Array.isArray(rawHistory.years)) throw new TypeError('export.integratedEnergyModel.history.years must be an array');
  const years = rawHistory.years.map((item, index) => {
    const year = requireFiniteNumber(item, `export.integratedEnergyModel.history.years[${index}]`);
    if (!Number.isInteger(year)) throw new TypeError(`export.integratedEnergyModel.history.years[${index}] must be an integer`);
    return year;
  });
  const annual = parseObjectList(rawHistory.annual, 'export.integratedEnergyModel.history.annual', (item, path) => {
    const record = requireRecord(item, path);
    const year = requireFiniteNumber(record.year, `${path}.year`);
    if (!Number.isInteger(year)) throw new TypeError(`${path}.year must be an integer`);
    const rawEnergy = requireRecord(record.energy, `${path}.energy`);
    const energy: Record<string, CanonicalFinancialLine> = {};
    for (const field of ENERGY_CANONICAL_FIELDS) energy[field] = parseCanonicalLine(rawEnergy[field], `${path}.energy.${field}`);
    return {
      year,
      energy: energy as unknown as EnergyCanonicalFinancials,
      revenue: parseCanonicalLine(record.revenue, `${path}.revenue`),
      netIncome: parseCanonicalLine(record.netIncome ?? record.net_income, `${path}.netIncome`),
      interestExpense: parseCanonicalLine(record.interestExpense ?? record.interest_expense, `${path}.interestExpense`),
      taxRate: parseCanonicalLine(record.taxRate ?? record.tax_rate, `${path}.taxRate`),
      depreciation: parseCanonicalLine(record.depreciation, `${path}.depreciation`),
      cashFlowFromOperations: parseCanonicalLine(record.cashFlowFromOperations ?? record.cash_flow_from_operations, `${path}.cashFlowFromOperations`),
      cash: parseCanonicalLine(record.cash, `${path}.cash`),
      currentDebt: parseCanonicalLine(record.currentDebt ?? record.current_debt, `${path}.currentDebt`),
      longTermDebt: parseCanonicalLine(record.longTermDebt ?? record.long_term_debt, `${path}.longTermDebt`),
      debt: parseCanonicalLine(record.debt, `${path}.debt`),
      marketableSecurities: parseCanonicalLine(record.marketableSecurities ?? record.marketable_securities, `${path}.marketableSecurities`),
      preferredEquity: parseCanonicalLine(record.preferredEquity ?? record.preferred_equity, `${path}.preferredEquity`),
      nonControllingInterest: parseCanonicalLine(record.nonControllingInterest ?? record.non_controlling_interest, `${path}.nonControllingInterest`),
      dilutedShares: parseCanonicalLine(record.dilutedShares ?? record.diluted_shares, `${path}.dilutedShares`),
    } satisfies EnergyHistoricalYear;
  });
  if (years.length !== 3 || annual.length !== 3 || annual.some((item, index) => item.year !== years[index])
    || years.some((year, index) => index > 0 && year !== years[index - 1]! + 1)) {
    throw new TypeError('export.integratedEnergyModel.history must contain three aligned annual periods');
  }
  const rawAssumptions = requireRecord(model.assumptions, 'export.integratedEnergyModel.assumptions');
  const numericFields = [
    'forecastYears', 'baseYear', 'crudePrice', 'nglPrice', 'bitumenPrice', 'syntheticOilPrice', 'naturalGasPrice',
    'crudePriceChange', 'nglPriceChange', 'bitumenPriceChange', 'syntheticOilPriceChange', 'naturalGasPriceChange',
    'liquidsProductionGrowth', 'naturalGasProductionGrowth', 'productionCostPerBoe', 'productionCostChangePerBoe',
    'upstreamEarningsConversionFactor', 'baseUpstreamEarnings', 'baseGrossProductionMargin', 'baseEnergyProductsEarnings',
    'baseChemicalProductsEarnings', 'baseSpecialtyProductsEarnings', 'energyProductsEarningsGrowth',
    'chemicalProductsEarningsGrowth', 'specialtyProductsEarningsGrowth', 'baseCorporateOperatingEarnings',
    'corporateOperatingEarningsGrowth', 'baseRevenue', 'revenueGrowth', 'cashCapexPctRevenue',
    'depreciationPctRevenue', 'workingCapitalInvestmentPctRevenue', 'reserveReplacementRatio',
    'filedBrentSensitivity', 'filedHenryHubSensitivity', 'filedTTFSensitivity', 'riskFreeRate', 'equityRiskPremium',
    'beta', 'costOfDebt', 'debtWeight', 'equityWeight', 'wacc', 'terminalGrowthRate', 'currentPrice',
    'marketCapitalization', 'commonSharesOutstanding', 'cash', 'marketableSecurities', 'debt',
    'nonControllingInterest', 'preferredEquity', 'taxRate',
  ] as const;
  const parsed: Record<string, unknown> = {};
  for (const field of numericFields) {
    if (allowMissingCrudeProduction && ['upstreamEarningsConversionFactor', 'baseGrossProductionMargin'].includes(field)
      && rawAssumptions[field] === null) {
      parsed[field] = null;
    } else {
      parsed[field] = requireFiniteNumber(rawAssumptions[field], `export.integratedEnergyModel.assumptions.${field}`);
    }
  }
  if (parsed.forecastYears !== 5 || !Number.isInteger(parsed.baseYear)) {
    throw new TypeError('export.integratedEnergyModel.assumptions requires a five-year forecast and integer base year');
  }
  parsed.asOfDate = requireString(rawAssumptions.asOfDate, 'export.integratedEnergyModel.assumptions.asOfDate');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(parsed.asOfDate))) throw new TypeError('export.integratedEnergyModel.assumptions.asOfDate must be an ISO date');
  if (Number(parsed.terminalGrowthRate) >= Number(parsed.wacc)) throw new TypeError('export.integratedEnergyModel terminal growth must be below WACC');
  if (years.at(-1) !== parsed.baseYear) throw new TypeError('export.integratedEnergyModel base year must match the latest actual');
  const rawSources = requireRecord(rawAssumptions.assumptionSources, 'export.integratedEnergyModel.assumptions.assumptionSources');
  const sourceFields = [
    'crudePriceChange', 'nglPriceChange', 'bitumenPriceChange', 'syntheticOilPriceChange', 'naturalGasPriceChange',
    'productionGrowth', 'productionCostChangePerBoe', 'energyProductsEarningsGrowth', 'chemicalProductsEarningsGrowth',
    'specialtyProductsEarningsGrowth', 'corporateOperatingEarningsGrowth', 'revenueGrowth', 'cashCapexPctRevenue',
    'depreciationPctRevenue', 'workingCapitalInvestmentPctRevenue', 'reserveReplacementRatio',
    'upstreamEarningsConversionFactor', 'costOfDebt', 'wacc', 'marketableSecurities', 'terminalGrowthRate',
  ] as const;
  parsed.assumptionSources = Object.fromEntries(sourceFields.map((field) => [
    field,
    requireString(rawSources[field], `export.integratedEnergyModel.assumptions.assumptionSources.${field}`),
  ]));
  if (allowMissingCrudeProduction
    && parsed.upstreamEarningsConversionFactor === null && parsed.baseGrossProductionMargin === null) {
    return {
      history: {years, annual} satisfies EnergyHistoricalData,
      assumptions: parsed as unknown as IncompleteIntegratedEnergyModelExportData['assumptions'],
    };
  }
  return {
    history: {years, annual} satisfies EnergyHistoricalData,
    assumptions: parsed as unknown as IntegratedEnergyAssumptions,
  };
}

function parseMaturePharmaModelExportData(value: unknown, allowMissingProductRevenue = false): MaturePharmaModelExportData | IncompleteMaturePharmaModelExportData {
  const model = requireRecord(value, 'export.maturePharmaModel');
  const rawHistory = requireRecord(model.history, 'export.maturePharmaModel.history');
  if (!Array.isArray(rawHistory.years)) throw new TypeError('export.maturePharmaModel.history.years must be an array');
  const years = rawHistory.years.map((item, index) => {
    const year = requireFiniteNumber(item, `export.maturePharmaModel.history.years[${index}]`);
    if (!Number.isInteger(year)) throw new TypeError(`export.maturePharmaModel.history.years[${index}] must be an integer`);
    return year;
  });
  const annual = parseObjectList(rawHistory.annual, 'export.maturePharmaModel.history.annual', (item, path) => {
    const record = requireRecord(item, path);
    const year = requireFiniteNumber(record.year, `${path}.year`);
    if (!Number.isInteger(year)) throw new TypeError(`${path}.year must be an integer`);
    const rawPharma = requireRecord(record.pharma, `${path}.pharma`);
    const products = parseObjectList(rawPharma.products, `${path}.pharma.products`, (productItem, productPath) => {
      const product = requireRecord(productItem, productPath);
      return {
        product_name: requireString(product.product_name, `${productPath}.product_name`),
        indication: optionalString(product.indication, `${productPath}.indication`) ?? null,
        revenue: parseCanonicalLine(product.revenue, `${productPath}.revenue`),
      };
    });
    const patents = parseObjectList(rawPharma.patents ?? [], `${path}.pharma.patents`, (patentItem, patentPath) => {
      const patent = requireRecord(patentItem, patentPath);
      return {
        product_name: requireString(patent.product_name, `${patentPath}.product_name`),
        region: parseEnum(patent.region, ['us', 'major_europe', 'japan'] as const, `${patentPath}.region`),
        metric: parseEnum(patent.metric, ['basic_patent_expiration_year', 'pending_patent_term_extension_year'] as const, `${patentPath}.metric`),
        year: parseCanonicalLine(patent.year, `${patentPath}.year`),
        reported_text: requireString(patent.reported_text, `${patentPath}.reported_text`),
      };
    });
    return {
      year,
      pharma: {
        products,
        patents,
        reported_total_revenue: parseCanonicalLine(rawPharma.reportedTotalRevenue ?? rawPharma.reported_total_revenue, `${path}.pharma.reportedTotalRevenue`),
      },
      revenue: parseCanonicalLine(record.revenue, `${path}.revenue`),
      ebit: parseCanonicalLine(record.ebit, `${path}.ebit`),
      interestExpense: parseCanonicalLine(record.interestExpense ?? record.interest_expense, `${path}.interestExpense`),
      taxRate: parseCanonicalLine(record.taxRate ?? record.tax_rate, `${path}.taxRate`),
      depreciation: parseCanonicalLine(record.depreciation, `${path}.depreciation`),
      capex: parseCanonicalLine(record.capex, `${path}.capex`),
      nwcChange: parseCanonicalLine(record.nwcChange ?? record.nwc_change, `${path}.nwcChange`),
      cash: parseCanonicalLine(record.cash, `${path}.cash`),
      marketableSecurities: parseCanonicalLine(record.marketableSecurities ?? record.marketable_securities, `${path}.marketableSecurities`),
      debt: parseCanonicalLine(record.debt, `${path}.debt`),
      nonControllingInterest: parseCanonicalLine(record.nonControllingInterest ?? record.non_controlling_interest, `${path}.nonControllingInterest`),
      preferredEquity: parseCanonicalLine(record.preferredEquity ?? record.preferred_equity, `${path}.preferredEquity`),
      dilutedShares: parseCanonicalLine(record.dilutedShares ?? record.diluted_shares, `${path}.dilutedShares`),
    };
  });
  if (years.length !== 3 || annual.length !== 3 || annual.some((item, index) => item.year !== years[index])
    || years.some((year, index) => index > 0 && year !== years[index - 1]! + 1)) {
    throw new TypeError('export.maturePharmaModel.history must contain three aligned annual periods');
  }
  const rawAssumptions = requireRecord(model.assumptions, 'export.maturePharmaModel.assumptions');
  const numericFields = [
    'forecastYears', 'baseYear', 'otherRevenueBase', 'otherRevenueGrowth', 'ebitMargin', 'taxRate', 'depreciationPctRevenue',
    'capexPctRevenue', 'workingCapitalInvestmentPctRevenue', 'riskFreeRate', 'equityRiskPremium', 'beta', 'costOfDebt',
    'debtWeight', 'equityWeight', 'wacc', 'terminalGrowthRate', 'currentPrice', 'marketCapitalization',
    'commonSharesOutstanding', 'cash', 'marketableSecurities', 'debt', 'nonControllingInterest', 'preferredEquity',
  ] as const;
  const parsed: Record<string, unknown> = {};
  for (const field of numericFields) {
    if (allowMissingProductRevenue && ['otherRevenueBase', 'otherRevenueGrowth'].includes(field)
      && rawAssumptions[field] === null) {
      parsed[field] = null;
    } else {
      parsed[field] = requireFiniteNumber(rawAssumptions[field], `export.maturePharmaModel.assumptions.${field}`);
    }
  }
  parsed.asOfDate = requireString(rawAssumptions.asOfDate, 'export.maturePharmaModel.assumptions.asOfDate');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(parsed.asOfDate))) throw new TypeError('export.maturePharmaModel.assumptions.asOfDate must be an ISO date');
  if (parsed.forecastYears !== 5 || years.at(-1) !== parsed.baseYear || Number(parsed.terminalGrowthRate) >= Number(parsed.wacc)) {
    throw new TypeError('export.maturePharmaModel assumptions require five forecast years, a matching base year, and terminal growth below WACC');
  }
  const rawProducts = parseObjectList(rawAssumptions.products, 'export.maturePharmaModel.assumptions.products', (item, path) => {
    const product = requireRecord(item, path);
    const optionalYear = (field: string): number | null => {
      const value = product[field];
      if (value === undefined || value === null) return null;
      const year = requireFiniteNumber(value, `${path}.${field}`);
      if (!Number.isInteger(year)) throw new TypeError(`${path}.${field} must be an integer year or null`);
      return year;
    };
    return {
      productName: requireString(product.productName, `${path}.productName`),
      indication: requireString(product.indication, `${path}.indication`),
      usPatentExpiryYear: optionalYear('usPatentExpiryYear'),
      majorEuropePatentExpiryYear: optionalYear('majorEuropePatentExpiryYear'),
      japanPatentExpiryYear: optionalYear('japanPatentExpiryYear'),
      pendingUsExtensionYear: optionalYear('pendingUsExtensionYear'),
      modeledGlobalLoeYear: optionalYear('modeledGlobalLoeYear'),
      preLoeGrowthRate: allowMissingProductRevenue && product.preLoeGrowthRate === null
        ? null
        : requireFiniteNumber(product.preLoeGrowthRate, `${path}.preLoeGrowthRate`),
      firstYearErosionRate: requireFiniteNumber(product.firstYearErosionRate, `${path}.firstYearErosionRate`),
      postLoeAnnualErosionRate: requireFiniteNumber(product.postLoeAnnualErosionRate, `${path}.postLoeAnnualErosionRate`),
      sourceNote: requireString(product.sourceNote, `${path}.sourceNote`),
    };
  });
  const rawSources = requireRecord(rawAssumptions.assumptionSources, 'export.maturePharmaModel.assumptions.assumptionSources');
  const sourceFields = [
    'productGrowth', 'modeledGlobalLoeYear', 'firstYearErosionRate', 'postLoeAnnualErosionRate', 'otherRevenueGrowth',
    'ebitMargin', 'taxRate', 'depreciationPctRevenue', 'capexPctRevenue', 'workingCapitalInvestmentPctRevenue',
    'wacc', 'terminalGrowthRate', 'marketableSecurities',
  ] as const;
  parsed.assumptionSources = Object.fromEntries(sourceFields.map((field) => [
    field,
    requireString(rawSources[field], `export.maturePharmaModel.assumptions.assumptionSources.${field}`),
  ]));
  if (years.at(-1) !== Number(parsed.baseYear) || rawProducts.length !== annual.at(-1)!.pharma.products.length) {
    throw new TypeError('export.maturePharmaModel assumptions must match the latest filed base year and product rows');
  }
  if (allowMissingProductRevenue && (parsed.otherRevenueGrowth === null || parsed.otherRevenueBase === null
    || rawProducts.some((product) => product.preLoeGrowthRate === null))) {
    return {
      history: {years, annual},
      assumptions: {...parsed, products: rawProducts} as unknown as IncompleteMaturePharmaModelExportData['assumptions'],
    };
  }
  return {
    history: {years, annual},
    assumptions: {...parsed, products: rawProducts} as unknown as MaturePharmaModelExportData['assumptions'],
  };
}

function parseCompleteness(value: unknown): UnifiedCompleteness {
  const completeness = requireRecord(value, 'completeness');
  const levels = ['none', 'low', 'moderate', 'high'] as const;
  return {
    has_financials: requireBoolean(completeness.has_financials, 'completeness.has_financials'),
    has_market: requireBoolean(completeness.has_market, 'completeness.has_market'),
    has_valuation_context: requireBoolean(completeness.has_valuation_context, 'completeness.has_valuation_context'),
    has_peers: requireBoolean(completeness.has_peers, 'completeness.has_peers'),
    has_insider_trades: requireBoolean(completeness.has_insider_trades, 'completeness.has_insider_trades'),
    degradation_level: parseEnum(completeness.degradation_level, levels, 'completeness.degradation_level'),
  };
}

function requireObjectList(value: unknown, path: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value.map((item, index) => requireRecord(item, `${path}[${index}]`));
}

export function parseUnifiedCompanyResponse(value: unknown): NativeUnifiedPayload {
  const response = requireRecord(value, 'response');
  const canonical = parseCanonicalFinancials(response.canonical_financials);
  const market = requireRecord(response.market, 'market');
  const sourceMetadata = requireRecord(response.source_metadata, 'source_metadata');
  for (const [name, source] of Object.entries(sourceMetadata)) {
    if (typeof source !== 'string') throw new TypeError(`source_metadata.${name} must be a string`);
  }
  return {
    profile: parseProfile(response.profile),
    financials_native: parseNativeFinancials(response.financials_native),
    canonical_financials: canonical,
    model_eligibility: parseModelEligibility(response.model_eligibility),
    market: parseMarketSnapshot(market),
    market_context: parseValuationContext(response.market_context, 'market_context'),
    valuation_context: parseValuationContext(response.valuation_context, 'valuation_context'),
    peers: requireObjectList(response.peers, 'peers'),
    insider_trades: requireObjectList(response.insider_trades, 'insider_trades'),
    data_quality: parseDataQuality(response.data_quality),
    completeness: parseCompleteness(response.completeness),
    source_metadata: sourceMetadata as Record<string, string>,
  };
}

function validateHistoricalSeries(value: unknown, path: string): void {
  const series = requireRecord(value, path);
  for (const [name, values] of Object.entries(series)) {
    if (!Array.isArray(values)) throw new TypeError(`${path}.${name} must be an array`);
    values.forEach((item, index) => {
      if (item !== null) requireFiniteNumber(item, `${path}.${name}[${index}]`);
    });
  }
}

function requireExportField(record: Record<string, unknown>, key: string, path: string): unknown {
  if (!(key in record)) throw new TypeError(`${path}.${key} is required`);
  return record[key];
}

function parseWorkbookInputRequirements(value: unknown): WorkbookInputRequirement[] {
  if (!Array.isArray(value)) throw new TypeError('export.requiredInputs must be an array');
  return value.map((item, index) => {
    const path = `export.requiredInputs[${index}]`;
    if (!isRecord(item)) throw new TypeError(`${path} must be an object`);
    const fiscalYear = item.fiscalYear === undefined || item.fiscalYear === null
      ? item.fiscalYear as null | undefined
      : requireFiniteNumber(item.fiscalYear, `${path}.fiscalYear`);
    if (typeof fiscalYear === 'number' && !Number.isInteger(fiscalYear)) {
      throw new TypeError(`${path}.fiscalYear must be an integer`);
    }
    const asOfDate = optionalString(item.asOfDate, `${path}.asOfDate`);
    if (typeof asOfDate === 'string' && !/^20\d{2}-\d{2}-\d{2}$/.test(asOfDate)) {
      throw new TypeError(`${path}.asOfDate must be an ISO date`);
    }
    if (typeof item.sourceReferenceRequired !== 'boolean') {
      throw new TypeError(`${path}.sourceReferenceRequired must be a boolean`);
    }
    const minimumValue = item.minimumValue === undefined || item.minimumValue === null
      ? item.minimumValue as null | undefined
      : requireFiniteNumber(item.minimumValue, `${path}.minimumValue`);
    const maximumValue = item.maximumValue === undefined || item.maximumValue === null
      ? item.maximumValue as null | undefined
      : requireFiniteNumber(item.maximumValue, `${path}.maximumValue`);
    let allowedValues: number[] | undefined;
    if (item.allowedValues !== undefined && item.allowedValues !== null) {
      if (!Array.isArray(item.allowedValues) || item.allowedValues.length === 0) {
        throw new TypeError(`${path}.allowedValues must be a nonempty array of finite numbers`);
      }
      allowedValues = item.allowedValues.map((value, allowedIndex) =>
        requireFiniteNumber(value, `${path}.allowedValues[${allowedIndex}]`));
      if (new Set(allowedValues).size !== allowedValues.length) {
        throw new TypeError(`${path}.allowedValues must not contain duplicates`);
      }
      if (allowedValues.some((allowed) => (typeof minimumValue === 'number' && allowed < minimumValue)
        || (typeof maximumValue === 'number' && allowed > maximumValue))) {
        throw new TypeError(`${path}.allowedValues must stay within the numeric bounds`);
      }
    }
    if (typeof minimumValue === 'number' && typeof maximumValue === 'number' && minimumValue > maximumValue) {
      throw new TypeError(`${path}.minimumValue cannot exceed maximumValue`);
    }
    return {
      key: requireString(item.key, `${path}.key`),
      label: requireString(item.label, `${path}.label`),
      inputType: parseEnum(item.inputType, ['reported_fact', 'market_data', 'analyst_assumption'] as const, `${path}.inputType`),
      sourceStatus: parseEnum(item.sourceStatus, ['missing', 'ambiguous', 'not_disclosed'] as const, `${path}.sourceStatus`),
      reason: requireString(item.reason, `${path}.reason`),
      fiscalYear: fiscalYear ?? undefined,
      asOfDate: asOfDate ?? undefined,
      unit: optionalString(item.unit, `${path}.unit`) ?? undefined,
      minimumValue: minimumValue ?? undefined,
      maximumValue: maximumValue ?? undefined,
      allowedValues,
      sourceReferenceRequired: item.sourceReferenceRequired,
    };
  });
}

function parseUtilityAssumptionSources(value: unknown, path: string): Record<string, string> {
  const sources = requireRecord(value, path);
  return Object.fromEntries(Object.entries(sources).map(([key, source]) => [
    key,
    requireString(source, `${path}.${key}`),
  ]));
}

function parseIncompleteUtilityModelExportData(value: unknown): IncompleteUtilityModelExportData {
  const model = requireRecord(value, 'export.utilityModel');
  const baseYear = requireFiniteNumber(model.baseYear, 'export.utilityModel.baseYear');
  if (!Number.isInteger(baseYear)) throw new TypeError('export.utilityModel.baseYear must be an integer');
  const forecastYears = requireFiniteNumber(model.forecastYears, 'export.utilityModel.forecastYears');
  if (forecastYears !== 5) throw new TypeError('export.utilityModel.forecastYears must be five');
  const asOfDate = requireString(model.asOfDate, 'export.utilityModel.asOfDate');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(asOfDate)) throw new TypeError('export.utilityModel.asOfDate must be an ISO date');
  const optionalPositive = (field: string): number | undefined => {
    if (model[field] === undefined || model[field] === null) return undefined;
    const value = requireFiniteNumber(model[field], `export.utilityModel.${field}`);
    if (value <= 0) throw new TypeError(`export.utilityModel.${field} must be positive when supplied`);
    return value;
  };
  const marketInputs = {
    riskFreeRate: optionalPositive('riskFreeRate'),
    equityRiskPremium: optionalPositive('equityRiskPremium'),
    beta: optionalPositive('beta'),
    currentPrice: optionalPositive('currentPrice'),
    dilutedShares: optionalPositive('dilutedShares'),
  };
  const assumptionSources = parseUtilityAssumptionSources(model.assumptionSources, 'export.utilityModel.assumptionSources');
  for (const [field, amount] of Object.entries(marketInputs)) {
    if (amount !== undefined && !assumptionSources[field]) {
      throw new TypeError(`export.utilityModel.assumptionSources.${field} is required`);
    }
  }
  return {baseYear, forecastYears: 5, ...marketInputs, asOfDate, assumptionSources};
}

function parseUtilityModelExportData(value: unknown): UtilityModelExportData {
  const model = requireRecord(value, 'export.utilityModel');
  const raw = requireRecord(model.assumptions, 'export.utilityModel.assumptions');
  const baseYear = requireFiniteNumber(raw.baseYear, 'export.utilityModel.assumptions.baseYear');
  if (!Number.isInteger(baseYear)) throw new TypeError('export.utilityModel.assumptions.baseYear must be an integer');
  const parseAmounts = (candidate: unknown, path: string): number[] => {
    if (!Array.isArray(candidate)) throw new TypeError(`${path} must be an array`);
    return candidate.map((amount, index) => requireFiniteNumber(amount, `${path}[${index}]`));
  };
  const rateBaseAdditions = parseAmounts(raw.rateBaseAdditions, 'export.utilityModel.assumptions.rateBaseAdditions');
  const rateBaseDepreciation = parseAmounts(raw.rateBaseDepreciation, 'export.utilityModel.assumptions.rateBaseDepreciation');
  if (rateBaseAdditions.length !== 5 || rateBaseDepreciation.length !== 5) {
    throw new TypeError('utility assumptions require five rate-base addition and depreciation periods');
  }
  const assumptions = {
    baseYear,
    baseRateBase: requireFiniteNumber(raw.baseRateBase, 'export.utilityModel.assumptions.baseRateBase'),
    authorizedEquityRatio: requireFiniteNumber(raw.authorizedEquityRatio, 'export.utilityModel.assumptions.authorizedEquityRatio'),
    allowedRoe: requireFiniteNumber(raw.allowedRoe, 'export.utilityModel.assumptions.allowedRoe'),
    rateBaseAdditions,
    rateBaseDepreciation,
    dividendPayoutRatio: requireFiniteNumber(raw.dividendPayoutRatio, 'export.utilityModel.assumptions.dividendPayoutRatio'),
    riskFreeRate: requireFiniteNumber(raw.riskFreeRate, 'export.utilityModel.assumptions.riskFreeRate'),
    equityRiskPremium: requireFiniteNumber(raw.equityRiskPremium, 'export.utilityModel.assumptions.equityRiskPremium'),
    beta: requireFiniteNumber(raw.beta, 'export.utilityModel.assumptions.beta'),
    terminalGrowthRate: requireFiniteNumber(raw.terminalGrowthRate, 'export.utilityModel.assumptions.terminalGrowthRate'),
    currentPrice: requireFiniteNumber(raw.currentPrice, 'export.utilityModel.assumptions.currentPrice'),
    dilutedShares: requireFiniteNumber(raw.dilutedShares, 'export.utilityModel.assumptions.dilutedShares'),
  };
  if (assumptions.baseRateBase <= 0 || assumptions.rateBaseAdditions.some((amount) => amount < 0)
    || assumptions.rateBaseDepreciation.some((amount) => amount < 0)) {
    throw new TypeError('utility rate-base inputs must be positive or non-negative as appropriate');
  }
  const asOfDate = requireString(raw.asOfDate, 'export.utilityModel.assumptions.asOfDate');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(asOfDate)) throw new TypeError('export.utilityModel.assumptions.asOfDate must be an ISO date');
  return {assumptions: {
    ...assumptions,
    asOfDate,
    assumptionSources: parseUtilityAssumptionSources(raw.assumptionSources, 'export.utilityModel.assumptions.assumptionSources'),
  }};
}

function parseBiotechModelExportData(value: unknown): BiotechModelExportData {
  const model = requireRecord(value, 'export.biotechModel');
  const pipelineAssets = parseObjectList(model.pipelineAssets, 'export.biotechModel.pipelineAssets', parsePipelineAssetNativeFact);
  const raw = requireRecord(model.assumptions, 'export.biotechModel.assumptions');
  const parseNumbers = (candidate: unknown, path: string, count: number): number[] => {
    if (!Array.isArray(candidate) || candidate.length !== count) throw new TypeError(`${path} must contain ${count} values`);
    return candidate.map((item, index) => requireFiniteNumber(item, `${path}[${index}]`));
  };
  const baseYear = requireFiniteNumber(raw.baseYear, 'export.biotechModel.assumptions.baseYear');
  if (!Number.isInteger(baseYear)) throw new TypeError('export.biotechModel.assumptions.baseYear must be an integer');
  const assets = parseObjectList(raw.assets, 'export.biotechModel.assumptions.assets', (item, path) => {
    const asset = requireRecord(item, path);
    const launchYear = requireFiniteNumber(asset.launchYear, `${path}.launchYear`);
    const exclusivityYear = requireFiniteNumber(asset.exclusivityYear, `${path}.exclusivityYear`);
    const yearsToPeak = requireFiniteNumber(asset.yearsToPeak, `${path}.yearsToPeak`);
    if (![launchYear, exclusivityYear, yearsToPeak].every(Number.isInteger)) throw new TypeError(`${path} years must be integers`);
    return {
      assetId: requireString(asset.assetId, `${path}.assetId`),
      include: requireFiniteNumber(asset.include, `${path}.include`),
      launchYear,
      peakSales: requireFiniteNumber(asset.peakSales, `${path}.peakSales`),
      yearsToPeak,
      exclusivityYear,
      postLoeErosion: requireFiniteNumber(asset.postLoeErosion, `${path}.postLoeErosion`),
      probabilityOfSuccess: requireFiniteNumber(asset.probabilityOfSuccess, `${path}.probabilityOfSuccess`),
      retainedShare: requireFiniteNumber(asset.retainedShare, `${path}.retainedShare`),
      contributionMargin: requireFiniteNumber(asset.contributionMargin, `${path}.contributionMargin`),
      developmentCostPv: requireFiniteNumber(asset.developmentCostPv, `${path}.developmentCostPv`),
    };
  });
  const asOfDate = requireString(raw.asOfDate, 'export.biotechModel.assumptions.asOfDate');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(asOfDate)) throw new TypeError('export.biotechModel.assumptions.asOfDate must be an ISO date');
  const assumptionSources = parseUtilityAssumptionSources(raw.assumptionSources, 'export.biotechModel.assumptions.assumptionSources');
  return {
    baseYear,
    forecastYears: 10,
    commercialRevenueBase: requireFiniteNumber(raw.commercialRevenueBase, 'export.biotechModel.assumptions.commercialRevenueBase'),
    pipelineAssets,
    assumptions: {
      baseYear,
      commercialRevenueBase: requireFiniteNumber(raw.commercialRevenueBase, 'export.biotechModel.assumptions.commercialRevenueBase'),
      commercialRevenueGrowth: parseNumbers(raw.commercialRevenueGrowth, 'export.biotechModel.assumptions.commercialRevenueGrowth', 10),
      commercialFcfMargin: requireFiniteNumber(raw.commercialFcfMargin, 'export.biotechModel.assumptions.commercialFcfMargin'),
      otherPipelineRnpv: requireFiniteNumber(raw.otherPipelineRnpv, 'export.biotechModel.assumptions.otherPipelineRnpv'),
      terminalGrowthRate: requireFiniteNumber(raw.terminalGrowthRate, 'export.biotechModel.assumptions.terminalGrowthRate'),
      riskFreeRate: requireFiniteNumber(raw.riskFreeRate, 'export.biotechModel.assumptions.riskFreeRate'),
      equityRiskPremium: requireFiniteNumber(raw.equityRiskPremium, 'export.biotechModel.assumptions.equityRiskPremium'),
      beta: requireFiniteNumber(raw.beta, 'export.biotechModel.assumptions.beta'),
      costOfDebt: requireFiniteNumber(raw.costOfDebt, 'export.biotechModel.assumptions.costOfDebt'),
      normalizedTaxRate: requireFiniteNumber(raw.normalizedTaxRate, 'export.biotechModel.assumptions.normalizedTaxRate'),
      marketCapitalization: requireFiniteNumber(raw.marketCapitalization, 'export.biotechModel.assumptions.marketCapitalization'),
      dilutedShares: requireFiniteNumber(raw.dilutedShares, 'export.biotechModel.assumptions.dilutedShares'),
      currentPrice: requireFiniteNumber(raw.currentPrice, 'export.biotechModel.assumptions.currentPrice'),
      cash: requireFiniteNumber(raw.cash, 'export.biotechModel.assumptions.cash'),
      marketableSecurities: requireFiniteNumber(raw.marketableSecurities, 'export.biotechModel.assumptions.marketableSecurities'),
      debt: requireFiniteNumber(raw.debt, 'export.biotechModel.assumptions.debt'),
      preferredEquity: requireFiniteNumber(raw.preferredEquity, 'export.biotechModel.assumptions.preferredEquity'),
      nonControllingInterest: requireFiniteNumber(raw.nonControllingInterest, 'export.biotechModel.assumptions.nonControllingInterest'),
      assets,
      asOfDate,
      assumptionSources,
    } as BiotechModelExportData['assumptions'],
  };
}

function parseIncompleteBiotechModelExportData(
  value: unknown,
  requiredInputs: readonly WorkbookInputRequirement[],
): IncompleteBiotechModelExportData {
  const model = requireRecord(value, 'export.biotechModel');
  const baseYear = requireFiniteNumber(model.baseYear, 'export.biotechModel.baseYear');
  if (!Number.isInteger(baseYear)) throw new TypeError('export.biotechModel.baseYear must be an integer');
  if (requireFiniteNumber(model.forecastYears, 'export.biotechModel.forecastYears') !== 10) {
    throw new TypeError('export.biotechModel.forecastYears must be ten');
  }
  const pipelineAssets = parseObjectList(model.pipelineAssets, 'export.biotechModel.pipelineAssets', parsePipelineAssetNativeFact);
  const ids = pipelineAssets.map((asset) => asset.asset_id);
  if (pipelineAssets.length < 5 || new Set(ids).size !== ids.length) {
    throw new TypeError('export.biotechModel.pipelineAssets must contain unique live SEC asset rows');
  }
  const asOfDate = requireString(model.asOfDate, 'export.biotechModel.asOfDate');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(asOfDate)) throw new TypeError('export.biotechModel.asOfDate must be an ISO date');
  const assets = selectBiotechAssetsForRnpv(pipelineAssets);
  const otherAssets = selectOtherBiotechAssetsForRnpv(pipelineAssets);
  const required = new Set<string>([
    'commercial_fcf_margin:', 'unmapped_pipeline_rnpv:', 'terminal_growth_rate:',
    'biotech_cost_of_debt:', 'biotech_normalized_tax_rate:',
  ]);
  for (let year = baseYear + 1; year <= baseYear + 10; year += 1) required.add(`commercial_revenue_growth:${year}`);
  for (const asset of assets) {
    for (const field of ['include', 'launch_year', 'peak_sales', 'years_to_peak', 'exclusivity_year', 'post_loe_erosion', 'probability_of_success', 'retained_share', 'contribution_margin', 'development_cost_pv']) {
      required.add(`asset_${field}:${asset.asset_id}:`);
    }
  }
  for (const asset of otherAssets) {
    required.add(`asset_scope_include:${asset.asset_id}:`);
    required.add(`asset_scope_rnpv:${asset.asset_id}:`);
  }
  const available = new Set(requiredInputs.map((input) => `${input.key}:${input.fiscalYear ?? ''}`));
  if (assets.length === 0 || [...required].some((identity) => !available.has(identity))) {
    throw new TypeError('input-required biotech model has an incomplete assumption manifest');
  }
  const binaryInputs = new Set([
    ...assets.map((asset) => `asset_include:${asset.asset_id}`),
    ...otherAssets.map((asset) => `asset_scope_include:${asset.asset_id}`),
  ]);
  if (requiredInputs.some((input) => binaryInputs.has(input.key)
    && !(input.allowedValues?.length === 2 && input.allowedValues.includes(0) && input.allowedValues.includes(1)))) {
    throw new TypeError('biotech asset inclusion inputs must allow only 0 or 1');
  }
  return {
    baseYear,
    forecastYears: 10,
    commercialRevenueBase: requireFiniteNumber(model.commercialRevenueBase, 'export.biotechModel.commercialRevenueBase'),
    pipelineAssets,
    riskFreeRate: requireFiniteNumber(model.riskFreeRate, 'export.biotechModel.riskFreeRate'),
    equityRiskPremium: requireFiniteNumber(model.equityRiskPremium, 'export.biotechModel.equityRiskPremium'),
    beta: requireFiniteNumber(model.beta, 'export.biotechModel.beta'),
    asOfDate,
    assumptionSources: parseUtilityAssumptionSources(model.assumptionSources, 'export.biotechModel.assumptionSources'),
  };
}

function parseIncompleteLifeInsuranceModelExportData(
  value: unknown,
  requiredInputs: readonly WorkbookInputRequirement[],
): IncompleteLifeInsuranceModelExportData {
  const model = requireRecord(value, 'export.lifeInsuranceModel');
  const ticker = parseEnum(model.ticker, ['MET', 'PRU'] as const, 'export.lifeInsuranceModel.ticker');
  const baseYear = requireFiniteNumber(model.baseYear, 'export.lifeInsuranceModel.baseYear');
  if (!Number.isInteger(baseYear) || requireFiniteNumber(model.forecastYears, 'export.lifeInsuranceModel.forecastYears') !== 5) {
    throw new TypeError('export.lifeInsuranceModel requires an integer base year and five forecast years');
  }
  const earningsBasis = parseEnum(model.earningsBasis, [
    'after_tax_adjusted_earnings_available_to_common', 'pre_tax_adjusted_operating_income',
  ] as const, 'export.lifeInsuranceModel.earningsBasis');
  const expectedBasis = ticker === 'MET' ? 'after_tax_adjusted_earnings_available_to_common' : 'pre_tax_adjusted_operating_income';
  const expectedMetric = ticker === 'MET' ? 'adjusted_earnings_available_to_common' : 'adjusted_operating_income_pretax';
  if (earningsBasis !== expectedBasis) throw new TypeError(`export.lifeInsuranceModel.earningsBasis is invalid for ${ticker}`);
  const filingFacts = parseObjectList(model.filingFacts, 'export.lifeInsuranceModel.filingFacts', parseLifeInsuranceFilingFact);
  const expectedSegments = ticker === 'MET'
    ? ['Group Benefits', 'RIS', 'Asia', 'Latin America', 'EMEA', 'MIM', 'Corporate & Other']
    : ['PGIM', 'Retirement Strategies', 'Group Insurance', 'Individual Life', 'International Businesses', 'Corporate and Other'];
  for (const year of [baseYear - 2, baseYear - 1, baseYear]) {
    const rows = filingFacts.filter((fact) => fact.metric === expectedMetric && fact.fiscal_year === year);
    const segments = rows.map((fact) => fact.segment);
    if (segments.length !== expectedSegments.length || expectedSegments.some((segment) => !segments.includes(segment))) {
      throw new TypeError(`export.lifeInsuranceModel is missing FY${year} ${ticker} segment earnings facts`);
    }
  }
  const requiredCapitalMetric = ticker === 'MET' ? 'statement_based_combined_rbc_ratio_floor' : 'statutory_capital_and_surplus';
  const requiredCapacityGroup = ticker === 'MET' ? 'Metropolitan Life Insurance Company' : 'PICA';
  const hasRequiredCapitalFact = filingFacts.some((fact) => fact.metric === requiredCapitalMetric && fact.fiscal_year === baseYear);
  const hasDividendCapacityFact = filingFacts.some((fact) => fact.metric === 'permitted_ordinary_dividend_without_approval'
    && fact.capital_group?.startsWith(requiredCapacityGroup) && fact.fiscal_year === baseYear + 1);
  if (!hasRequiredCapitalFact || !hasDividendCapacityFact) {
    throw new TypeError(`export.lifeInsuranceModel is missing ${ticker} statutory-capital or dividend disclosures`);
  }
  const asOfDate = requireString(model.asOfDate, 'export.lifeInsuranceModel.asOfDate');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(asOfDate)) throw new TypeError('export.lifeInsuranceModel.asOfDate must be an ISO date');
  const required = new Set<string>([
    'life_parent_cash:', 'life_parent_cash_reserve:', 'life_parent_debt:',
    'life_preferred_equity:', 'life_non_controlling_interest:', 'terminal_growth_rate:',
  ]);
  for (let year = baseYear + 1; year <= baseYear + 5; year += 1) {
    required.add(`life_net_capital_addition:${year}`);
    required.add(`life_permitted_upstream_dividends:${year}`);
    for (const segment of expectedSegments) required.add(`life_segment_earnings_growth:${segment}:${year}`);
  }
  if (ticker === 'PRU') required.add('life_normalized_tax_rate:');
  if (model.currentPrice === undefined || model.currentPrice === null) required.add('life_current_share_price:');
  if (model.dilutedShares === undefined || model.dilutedShares === null) required.add(`life_diluted_shares:${baseYear}`);
  if (model.riskFreeRate === undefined || model.riskFreeRate === null) required.add('life_risk_free_rate:');
  if (model.equityRiskPremium === undefined || model.equityRiskPremium === null) required.add('life_equity_risk_premium:');
  if (model.beta === undefined || model.beta === null) required.add('life_beta:');
  const provided = new Set(requiredInputs.map((input) => `${input.key}:${input.fiscalYear ?? ''}`));
  if ([...required].some((identity) => !provided.has(identity))) {
    throw new TypeError('input-required life-insurance export has an incomplete source and assumption manifest');
  }
  return {
    ticker,
    baseYear,
    forecastYears: 5,
    earningsBasis,
    filingFacts,
    riskFreeRate: model.riskFreeRate == null ? null : requireFiniteNumber(model.riskFreeRate, 'export.lifeInsuranceModel.riskFreeRate'),
    equityRiskPremium: model.equityRiskPremium == null ? null : requireFiniteNumber(model.equityRiskPremium, 'export.lifeInsuranceModel.equityRiskPremium'),
    beta: model.beta == null ? null : requireFiniteNumber(model.beta, 'export.lifeInsuranceModel.beta'),
    currentPrice: model.currentPrice == null ? null : requireFiniteNumber(model.currentPrice, 'export.lifeInsuranceModel.currentPrice'),
    dilutedShares: model.dilutedShares == null ? null : requireFiniteNumber(model.dilutedShares, 'export.lifeInsuranceModel.dilutedShares'),
    asOfDate,
    assumptionSources: parseUtilityAssumptionSources(model.assumptionSources, 'export.lifeInsuranceModel.assumptionSources'),
  };
}

function parseIncompleteDcfExportPayload(payload: Record<string, unknown>): IncompleteDcfExportPayload {
  const company = requireRecord(requireExportField(payload, 'company', 'export'), 'export.company');
  for (const field of ['name', 'ticker', 'currency', 'unitsScale', 'asOfDate']) {
    requireString(company[field], `export.company.${field}`);
  }
  if (!['units', 'thousands', 'millions', 'billions'].includes(String(company.unitsScale))) {
    throw new TypeError('export.company.unitsScale is not a supported scale');
  }
  if (company.operatingArchetype !== undefined && company.operatingArchetype !== null) {
    parseEnum(company.operatingArchetype, [
      'standard_operating', 'technology_hardware', 'subscription_software', 'consumer_retail',
      'industrial_manufacturing', 'semiconductor', 'energy_materials', 'telecommunications',
      'mature_pharma', 'biotechnology', 'unclassified_operating',
    ] as const, 'export.company.operatingArchetype');
  }

  const valuationModel = parseEnum(payload.valuationModel, PREFERRED_MODELS, 'export.valuationModel');
  if (!isProductionModelRoute(valuationModel)) {
    throw new TypeError('input-required workbooks need an implemented production model route');
  }
  const requiredInputs = parseWorkbookInputRequirements(payload.requiredInputs);
  if (requiredInputs.length === 0) throw new TypeError('input-required workbooks need at least one required input');

  const historicals = requireRecord(requireExportField(payload, 'historicals', 'export'), 'export.historicals');
  const years = requireExportField(historicals, 'years', 'export.historicals');
  if (!Array.isArray(years) || years.some((year) => typeof year !== 'number' || !Number.isInteger(year))) {
    throw new TypeError('export.historicals.years must be an array of integer years');
  }
  validateHistoricalSeries(requireExportField(historicals, 'income', 'export.historicals'), 'export.historicals.income');
  validateHistoricalSeries(requireExportField(historicals, 'balance', 'export.historicals'), 'export.historicals.balance');
  validateHistoricalSeries(requireExportField(historicals, 'cashflow', 'export.historicals'), 'export.historicals.cashflow');
  const canonicalFinancials = parseCanonicalFinancials(requireExportField(payload, 'canonicalFinancials', 'export'));

  const forecastPeriods = payload.forecasts === undefined
    ? undefined
    : (() => {
        if (!Array.isArray(payload.forecasts)) throw new TypeError('export.forecasts must be an array');
        return payload.forecasts.map((item, index) => {
          const path = `export.forecasts[${index}]`;
          const forecast = requireRecord(item, path);
          const year = requireFiniteNumber(forecast.year, `${path}.year`);
          if (!Number.isInteger(year)) throw new TypeError(`${path}.year must be an integer`);
          for (const field of ['revenue', 'ebit', 'ebitda', 'ufcf', 'fcff']) {
            if (forecast[field] !== undefined && forecast[field] !== null) {
              throw new TypeError(`${path}.${field} must be omitted for an incomplete workbook`);
            }
          }
          return {year};
        });
      })();

  let assumptions: ModelAssumptions | undefined;
  if (payload.assumptions !== undefined && payload.assumptions !== null) {
    const assumptionRecord = requireRecord(payload.assumptions, 'export.assumptions');
    for (const field of ['scenarioMode', 'revenueMethod', 'capexMethod', 'daMethod', 'wcMethod']) {
      requireString(assumptionRecord[field], `export.assumptions.${field}`);
    }
    const horizon = requireFiniteNumber(assumptionRecord.horizonYears, 'export.assumptions.horizonYears');
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > 15) {
      throw new TypeError('export.assumptions.horizonYears must be an integer between 1 and 15');
    }
    requireFiniteNumber(assumptionRecord.taxRate, 'export.assumptions.taxRate');
    const wacc = requireRecord(assumptionRecord.wacc, 'export.assumptions.wacc');
    for (const field of ['rf', 'erp', 'beta']) requireFiniteNumber(wacc[field], `export.assumptions.wacc.${field}`);
    const terminal = requireRecord(assumptionRecord.terminal, 'export.assumptions.terminal');
    requireString(terminal.method, 'export.assumptions.terminal.method');
    assumptions = assumptionRecord as unknown as ModelAssumptions;
  }

  let market: IncompleteDcfExportPayload['market'];
  if (payload.market !== undefined && payload.market !== null) {
    const marketRecord = requireRecord(payload.market, 'export.market');
    const optionalMarketNumber = (field: string): number | null | undefined => {
      const value = marketRecord[field];
      if (value === undefined || value === null) return value;
      return requireFiniteNumber(value, `export.market.${field}`);
    };
    market = {
      currentPrice: optionalMarketNumber('currentPrice'),
      sharesDiluted: optionalMarketNumber('sharesDiluted'),
      marketCap: optionalMarketNumber('marketCap'),
      netDebt: optionalMarketNumber('netDebt'),
      cash: optionalMarketNumber('cash'),
      debt: optionalMarketNumber('debt'),
      minorityInterest: optionalMarketNumber('minorityInterest'),
      preferredEquity: optionalMarketNumber('preferredEquity'),
      nonOperatingAssets: optionalMarketNumber('nonOperatingAssets'),
    };
  }

  let bankModel: IncompleteBankModelExportData | undefined;
  const hasMinimumCet1Requirement = requiredInputs.some((input) => input.key === 'minimum_cet1_ratio');
  if (payload.bankModel !== undefined && payload.bankModel !== null) {
    if (valuationModel !== 'bank_residual_income') {
      throw new TypeError('export.bankModel is only valid for bank_residual_income');
    }
    const parsedBankModel = parseBankModelExportData(payload.bankModel, true);
    if (parsedBankModel.assumptions.minimumCet1Ratio !== null) {
      throw new TypeError('input-required bank exports must leave the filed minimum CET1 ratio blank');
    }
    if (!hasMinimumCet1Requirement) {
      throw new TypeError('input-required bank exports need a minimum_cet1_ratio workbook input');
    }
    bankModel = parsedBankModel as IncompleteBankModelExportData;
  } else if (valuationModel === 'bank_residual_income' && hasMinimumCet1Requirement) {
    throw new TypeError('input-required bank exports need dedicated bank history and assumptions');
  }

  let insuranceModel: IncompleteInsuranceModelExportData | undefined;
  const hasUnpaidLossReservesRequirement = requiredInputs.some((input) => input.key === 'unpaid_loss_reserves');
  if (payload.insuranceModel !== undefined && payload.insuranceModel !== null) {
    if (valuationModel !== 'insurance_pnc_residual_income') {
      throw new TypeError('export.insuranceModel is only valid for insurance_pnc_residual_income');
    }
    const parsedInsuranceModel = parseInsuranceModelExportData(payload.insuranceModel);
    const latestReserve = parsedInsuranceModel.history.annual.at(-1)?.insurance?.unpaid_loss_reserves;
    const latestYear = parsedInsuranceModel.history.annual.at(-1)?.year;
    const latestReserveIsFiled = latestReserve
      && (latestReserve.source === 'sec_native' || latestReserve.source === 'derived')
      && typeof latestReserve.value === 'number'
      && latestReserve.sources.length > 0
      && latestReserve.sources.every((source) => source.accession && source.filed && source.fiscal_period === `FY ${latestYear}`);
    if (latestReserveIsFiled) {
      throw new TypeError('input-required P&C exports must leave the latest unpaid loss reserves blank');
    }
    if (!hasUnpaidLossReservesRequirement) {
      throw new TypeError('input-required P&C exports need an unpaid_loss_reserves workbook input');
    }
    insuranceModel = parsedInsuranceModel as IncompleteInsuranceModelExportData;
  } else if (valuationModel === 'insurance_pnc_residual_income' && hasUnpaidLossReservesRequirement) {
    throw new TypeError('input-required P&C exports need dedicated insurance history and assumptions');
  }

  let reitModel: IncompleteReitModelExportData | undefined;
  const hasSameStoreNoiGrowthRequirement = requiredInputs.some((input) => input.key === 'same_store_noi_growth');
  if (payload.reitModel !== undefined && payload.reitModel !== null) {
    if (valuationModel !== 'reit_affo') {
      throw new TypeError('export.reitModel is only valid for reit_affo');
    }
    const parsedReitModel = parseReitModelExportData(payload.reitModel, true);
    if (parsedReitModel.assumptions.sameStoreNoiGrowth !== null) {
      throw new TypeError('input-required REIT exports must leave same-store NOI growth blank');
    }
    const latest = parsedReitModel.history.annual.at(-1);
    const line = latest?.reit.same_store_noi_growth;
    const lineIsFiled = latest && line
      && (line.source === 'sec_native' || line.source === 'derived')
      && typeof line.value === 'number'
      && line.sources.length > 0
      && line.sources.every((source) => source.accession && source.filed);
    if (lineIsFiled) throw new TypeError('input-required REIT exports must include a missing or ambiguous latest growth fact');
    if (!hasSameStoreNoiGrowthRequirement) {
      throw new TypeError('input-required REIT exports need a same_store_noi_growth workbook input');
    }
    reitModel = parsedReitModel as IncompleteReitModelExportData;
  } else if (valuationModel === 'reit_affo' && hasSameStoreNoiGrowthRequirement) {
    throw new TypeError('input-required REIT exports need dedicated REIT history and assumptions');
  }

  let mortgageReitModel: IncompleteMortgageReitModelExportData | undefined;
  const hasAverageRepoBorrowingsRequirement = requiredInputs.some((input) => input.key === 'average_repo_borrowings');
  if (payload.mortgageReitModel !== undefined && payload.mortgageReitModel !== null) {
    if (valuationModel !== 'mortgage_reit_residual_income') {
      throw new TypeError('export.mortgageReitModel is only valid for mortgage_reit_residual_income');
    }
    const parsedMortgageReitModel = parseMortgageReitModelExportData(payload.mortgageReitModel);
    const latest = parsedMortgageReitModel.history.annual.at(-1);
    const line = latest?.mortgageReit.average_repo_borrowings;
    const lineIsFiled = line
      && (line.source === 'sec_native' || line.source === 'derived')
      && typeof line.value === 'number' && Number.isFinite(line.value)
      && line.sources.length > 0 && line.sources.every((source) => source.accession && source.filed);
    if (lineIsFiled) throw new TypeError('input-required mortgage REIT exports must have a missing latest average_repo_borrowings fact');
    if (!hasAverageRepoBorrowingsRequirement) {
      throw new TypeError('input-required mortgage REIT exports need an average_repo_borrowings workbook input');
    }
    mortgageReitModel = parsedMortgageReitModel as IncompleteMortgageReitModelExportData;
  } else if (valuationModel === 'mortgage_reit_residual_income' && hasAverageRepoBorrowingsRequirement) {
    throw new TypeError('input-required mortgage REIT exports need dedicated mortgage REIT history and assumptions');
  }

  let assetManagerModel: IncompleteAssetManagerModelExportData | undefined;
  const missingBaseFeeInputs = requiredInputs.filter((input) => input.key === 'base_fee_yield');
  if (payload.assetManagerModel !== undefined && payload.assetManagerModel !== null) {
    if (valuationModel !== 'asset_manager_aum_dcf') {
      throw new TypeError('export.assetManagerModel is only valid for asset_manager_aum_dcf');
    }
    const parsedAssetManagerModel = parseAssetManagerModelExportData(payload.assetManagerModel, true);
    if (parsedAssetManagerModel.assumptions.baseFeeYield !== null || missingBaseFeeInputs.length === 0) {
      throw new TypeError('input-required asset-manager exports need a blank baseFeeYield assumption and yearly input rows');
    }
    for (const requirement of missingBaseFeeInputs) {
      const line = parsedAssetManagerModel.history.annual.find((item) => item.year === requirement.fiscalYear)?.assetManager.base_fee_yield;
      const lineIsFiled = line
        && (line.source === 'sec_native' || line.source === 'derived')
        && typeof line.value === 'number'
        && line.sources.length > 0
        && line.sources.every((source) => source.accession && source.filed);
      if (lineIsFiled) throw new TypeError(`input-required asset-manager export has no missing base fee yield in FY${requirement.fiscalYear}`);
    }
    assetManagerModel = parsedAssetManagerModel as IncompleteAssetManagerModelExportData;
  } else if (valuationModel === 'asset_manager_aum_dcf' && missingBaseFeeInputs.length > 0) {
    throw new TypeError('input-required asset-manager exports need dedicated history and assumptions');
  }

  let telecomModel: IncompleteTelecomModelExportData | undefined;
  const missingChurnInputs = requiredInputs.filter((input) => input.key === 'postpaid_phone_churn');
  if (payload.telecomModel !== undefined && payload.telecomModel !== null) {
    if (valuationModel !== 'telecom_subscriber_dcf') {
      throw new TypeError('export.telecomModel is only valid for telecom_subscriber_dcf');
    }
    const parsedTelecomModel = parseTelecomModelExportData(payload.telecomModel, true);
    if (parsedTelecomModel.assumptions.postpaidGrossAddRate !== null
      || parsedTelecomModel.assumptions.postpaidPhoneMonthlyChurn !== null
      || missingChurnInputs.length === 0) {
      throw new TypeError('input-required telecom exports need blank churn and gross-add assumptions plus annual inputs');
    }
    for (const requirement of missingChurnInputs) {
      const line = parsedTelecomModel.history.annual.find((item) => item.year === requirement.fiscalYear)?.telecom?.postpaid_phone_churn;
      const lineIsFiled = line
        && (line.source === 'sec_native' || line.source === 'derived')
        && typeof line.value === 'number'
        && line.sources.length > 0 && line.sources.every((source) => source.accession && source.filed);
      if (lineIsFiled) throw new TypeError(`input-required telecom export has no missing churn input for FY${requirement.fiscalYear}`);
    }
    telecomModel = parsedTelecomModel as IncompleteTelecomModelExportData;
  } else if (valuationModel === 'telecom_subscriber_dcf' && missingChurnInputs.length > 0) {
    throw new TypeError('input-required telecom exports need dedicated history and assumptions');
  }

  let integratedEnergyModel: IncompleteIntegratedEnergyModelExportData | undefined;
  const missingCrudeProductionInputs = requiredInputs.filter((input) => input.key === 'crude_oil_production');
  if (payload.integratedEnergyModel !== undefined && payload.integratedEnergyModel !== null) {
    if (valuationModel !== 'integrated_energy_dcf') {
      throw new TypeError('export.integratedEnergyModel is only valid for integrated_energy_dcf');
    }
    const parsedEnergyModel = parseIntegratedEnergyModelExportData(payload.integratedEnergyModel, true);
    if (parsedEnergyModel.assumptions.baseGrossProductionMargin !== null
      || parsedEnergyModel.assumptions.upstreamEarningsConversionFactor !== null
      || missingCrudeProductionInputs.length === 0) {
      throw new TypeError('input-required energy exports must withhold crude-derived assumptions and identify the missing year');
    }
    for (const requirement of missingCrudeProductionInputs) {
      const line = parsedEnergyModel.history.annual.find((item) => item.year === requirement.fiscalYear)?.energy.crude_oil_production;
      const lineIsFiled = line
        && (line.source === 'sec_native' || line.source === 'derived')
        && typeof line.value === 'number'
        && line.sources.length > 0 && line.sources.every((source) => source.accession && source.filed);
      if (lineIsFiled) throw new TypeError(`input-required integrated-energy export has no missing crude production in FY${requirement.fiscalYear}`);
    }
    integratedEnergyModel = parsedEnergyModel as IncompleteIntegratedEnergyModelExportData;
  } else if (valuationModel === 'integrated_energy_dcf' && missingCrudeProductionInputs.length > 0) {
    throw new TypeError('input-required integrated-energy exports need dedicated production history and assumptions');
  }

  let maturePharmaModel: IncompleteMaturePharmaModelExportData | undefined;
  const missingProductInputs = requiredInputs.filter((input) => input.key.startsWith('product_revenue:'));
  if (payload.maturePharmaModel !== undefined && payload.maturePharmaModel !== null) {
    if (valuationModel !== 'mature_pharma_product_dcf') {
      throw new TypeError('export.maturePharmaModel is only valid for mature_pharma_product_dcf');
    }
    const parsedPharmaModel = parseMaturePharmaModelExportData(payload.maturePharmaModel, true);
    if (parsedPharmaModel.assumptions.otherRevenueGrowth !== null || missingProductInputs.length === 0) {
      throw new TypeError('input-required mature-pharma exports need missing product rows and a blank residual-growth assumption');
    }
    for (const requirement of missingProductInputs) {
      const productName = requirement.label.split(' — ').at(-1)?.trim() ?? '';
      const slug = productName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const productKey = `product_revenue:${slug}`;
      const line = parsedPharmaModel.history.annual.find((item) => item.year === requirement.fiscalYear)?.pharma.products.find((item) => item.product_name === productName)?.revenue;
      const productAssumption = parsedPharmaModel.assumptions.products.find((item) => item.productName === productName);
      const lineIsFiled = line
        && (line.source === 'sec_native' || line.source === 'derived')
        && typeof line.value === 'number'
        && line.sources.length > 0 && line.sources.every((source) => source.accession && source.filed);
      if (requirement.key !== productKey || !productName || lineIsFiled || productAssumption?.preLoeGrowthRate !== null) {
        throw new TypeError(`input-required mature-pharma export has no missing product revenue for ${productName} FY${requirement.fiscalYear}`);
      }
    }
    maturePharmaModel = parsedPharmaModel as IncompleteMaturePharmaModelExportData;
  } else if (valuationModel === 'mature_pharma_product_dcf' && missingProductInputs.length > 0) {
    throw new TypeError('input-required mature-pharma exports need dedicated product and patent history');
  }

  let utilityModel: IncompleteUtilityModelExportData | undefined;
  if (payload.utilityModel !== undefined && payload.utilityModel !== null) {
    if (valuationModel !== 'utility_dcf') throw new TypeError('export.utilityModel is only valid for utility_dcf');
    utilityModel = parseIncompleteUtilityModelExportData(payload.utilityModel);
    const requiredPeriods = new Set<string>([
      `jurisdictional_rate_base:${utilityModel.baseYear}`,
      `allowed_roe:${utilityModel.baseYear}`,
      `authorized_equity_ratio:${utilityModel.baseYear}`,
      `dividend_payout_ratio:${utilityModel.baseYear}`,
      'terminal_growth_rate:',
    ]);
    for (let year = utilityModel.baseYear + 1; year <= utilityModel.baseYear + 5; year += 1) {
      requiredPeriods.add(`rate_base_additions:${year}`);
      requiredPeriods.add(`rate_base_depreciation:${year}`);
    }
    const provided = new Set(requiredInputs.map((item) => `${item.key}:${item.fiscalYear ?? ''}`));
    if ([...requiredPeriods].some((period) => !provided.has(period))) {
      throw new TypeError('incomplete utility exports need a base regulatory input and five-year rate-base schedule');
    }
  } else if (valuationModel === 'utility_dcf') {
    throw new TypeError('input-required utility exports need live market inputs and a dedicated rate-base model');
  }

  let biotechModel: IncompleteBiotechModelExportData | undefined;
  if (payload.biotechModel !== undefined && payload.biotechModel !== null) {
    if (valuationModel !== 'biotech_pipeline_rnpv') throw new TypeError('export.biotechModel is only valid for biotech_pipeline_rnpv');
    biotechModel = parseIncompleteBiotechModelExportData(payload.biotechModel, requiredInputs);
  } else if (valuationModel === 'biotech_pipeline_rnpv') {
    throw new TypeError('input-required biotech exports need source-backed assets and a DCF model');
  }

  let lifeInsuranceModel: IncompleteLifeInsuranceModelExportData | undefined;
  if (payload.lifeInsuranceModel !== undefined && payload.lifeInsuranceModel !== null) {
    if (valuationModel !== 'life_insurer_distributable_earnings_dcf') {
      throw new TypeError('export.lifeInsuranceModel is only valid for life_insurer_distributable_earnings_dcf');
    }
    lifeInsuranceModel = parseIncompleteLifeInsuranceModelExportData(payload.lifeInsuranceModel, requiredInputs);
  } else if (valuationModel === 'life_insurer_distributable_earnings_dcf') {
    throw new TypeError('input-required life-insurance exports need source-backed segment earnings and capital disclosures');
  }

  const isComparableRoute = valuationModel === 'ev_ebitda' || valuationModel === 'revenue_multiple';
  const comparableInputRequirements = requiredInputs.filter((input) => input.key.startsWith('peer_'));
  let comparableModel: IncompleteComparableModelExportData | undefined;
  if (payload.comparableModel !== undefined && payload.comparableModel !== null) {
    if (!isComparableRoute) throw new TypeError('export.comparableModel is only valid for multiple valuation routes');
    const model = requireRecord(payload.comparableModel, 'export.comparableModel');
    const method = parseEnum(model.method, ['ev_ebitda', 'revenue_multiple'] as const, 'export.comparableModel.method');
    if (method !== valuationModel) throw new TypeError('export.comparableModel.method must match export.valuationModel');
    const targetMetric = requireFiniteNumber(model.targetMetric, 'export.comparableModel.targetMetric');
    if (targetMetric <= 0) throw new TypeError('export.comparableModel.targetMetric must be positive');
    const peerStatus = parseEnum(model.peerStatus, ['live', 'cached'] as const, 'export.comparableModel.peerStatus');
    const peerSource = requireString(model.peerSource, 'export.comparableModel.peerSource');
    if (/\b(default|stale|unavailable)\b/i.test(peerSource)) throw new TypeError('export.comparableModel.peerSource must be current');
    if (model.peerFallbackUsed !== false) throw new TypeError('input-required comparables cannot use fallback peers');
    const peerFetchedAtMs = requireFiniteNumber(model.peerFetchedAtMs, 'export.comparableModel.peerFetchedAtMs');
    if (!Number.isInteger(peerFetchedAtMs) || Date.now() - peerFetchedAtMs < 0 || Date.now() - peerFetchedAtMs > 24 * 60 * 60 * 1000) {
      throw new TypeError('export.comparableModel.peerFetchedAtMs must be within the last 24 hours');
    }
    if (comparableInputRequirements.length === 0) throw new TypeError('input-required comparables need a peer denominator input');
    comparableModel = {method, targetMetric, peerStatus, peerSource, peerFallbackUsed: false, peerFetchedAtMs};
  } else if (isComparableRoute && comparableInputRequirements.length > 0) {
    throw new TypeError('input-required comparable peer metrics need a current non-fallback peer set');
  }

  let comps: CompData[] | undefined;
  if (payload.comps !== undefined && payload.comps !== null) {
    if (!Array.isArray(payload.comps)) throw new TypeError('export.comps must be an array');
    comps = payload.comps.map((item, index) => {
      const path = `export.comps[${index}]`;
      const peer = requireRecord(item, path);
      const optionalNumber = (field: string): number | undefined => {
        const value = peer[field];
        return value === undefined || value === null ? undefined : requireFiniteNumber(value, `${path}.${field}`);
      };
      return {
        company: requireString(peer.company, `${path}.company`),
        ...(optionalString(peer.ticker, `${path}.ticker`) ? {ticker: String(peer.ticker)} : {}),
        marketCap: requireFiniteNumber(peer.marketCap, `${path}.marketCap`),
        ev: requireFiniteNumber(peer.ev, `${path}.ev`),
        ...(optionalNumber('revenue') !== undefined ? {revenue: optionalNumber('revenue')} : {}),
        ...(optionalNumber('ebitda') !== undefined ? {ebitda: optionalNumber('ebitda')} : {}),
        ...(optionalNumber('evRev') !== undefined ? {evRev: optionalNumber('evRev')} : {}),
        ...(optionalNumber('evEbitda') !== undefined ? {evEbitda: optionalNumber('evEbitda')} : {}),
        ...(optionalNumber('growth') !== undefined ? {growth: optionalNumber('growth')} : {}),
        ...(optionalNumber('margin') !== undefined ? {margin: optionalNumber('margin')} : {}),
        ...(optionalNumber('beta') !== undefined ? {beta: optionalNumber('beta')} : {}),
        ...(optionalNumber('totalDebt') !== undefined ? {totalDebt: optionalNumber('totalDebt')} : {}),
        ...(optionalNumber('taxRate') !== undefined ? {taxRate: optionalNumber('taxRate')} : {}),
        ...(optionalNumber('price') !== undefined ? {price: optionalNumber('price')} : {}),
        ...(optionalNumber('sharesOutstanding') !== undefined ? {sharesOutstanding: optionalNumber('sharesOutstanding')} : {}),
        ...(optionalNumber('depreciation') !== undefined ? {depreciation: optionalNumber('depreciation')} : {}),
      };
    });
  }

  if (payload.uiMeta !== undefined && payload.uiMeta !== null) {
    const meta = requireRecord(payload.uiMeta, 'export.uiMeta');
    if (meta.warnings !== undefined) requireStringArray(meta.warnings, 'export.uiMeta.warnings');
    if (meta.sourceNotes !== undefined) requireStringArray(meta.sourceNotes, 'export.uiMeta.sourceNotes');
  }

  return {
    buildStatus: 'input_required',
    requiredInputs,
    company: company as unknown as IncompleteDcfExportPayload['company'],
    valuationModel,
    ...(market ? {market} : {}),
    historicals: historicals as unknown as IncompleteDcfExportPayload['historicals'],
    canonicalFinancials,
    ...(bankModel ? {bankModel} : {}),
    ...(insuranceModel ? {insuranceModel} : {}),
    ...(reitModel ? {reitModel} : {}),
    ...(mortgageReitModel ? {mortgageReitModel} : {}),
    ...(assetManagerModel ? {assetManagerModel} : {}),
    ...(telecomModel ? {telecomModel} : {}),
    ...(integratedEnergyModel ? {integratedEnergyModel} : {}),
    ...(maturePharmaModel ? {maturePharmaModel} : {}),
    ...(utilityModel ? {utilityModel} : {}),
    ...(biotechModel ? {biotechModel} : {}),
    ...(lifeInsuranceModel ? {lifeInsuranceModel} : {}),
    ...(assumptions ? {assumptions} : {}),
    ...(forecastPeriods ? {forecasts: forecastPeriods} : {}),
    ...(comparableModel ? {comparableModel} : {}),
    ...(comps ? {comps} : {}),
    uiMeta: payload.uiMeta as IncompleteDcfExportPayload['uiMeta'],
  };
}

export function parseDcfExportPayload(value: unknown): DcfWorkbookPayload {
  const payload = requireRecord(value, 'export');
  const buildStatus = payload.buildStatus ?? 'ready';
  if (buildStatus === 'input_required') return parseIncompleteDcfExportPayload(payload);
  if (buildStatus !== 'ready') throw new TypeError('export.buildStatus must be ready or input_required');
  const requiredInputs = payload.requiredInputs === undefined
    ? []
    : parseWorkbookInputRequirements(payload.requiredInputs);
  if (requiredInputs.length > 0) throw new TypeError('ready exports cannot include missing required inputs');
  const company = requireRecord(requireExportField(payload, 'company', 'export'), 'export.company');
  const valuationModel = payload.valuationModel === undefined || payload.valuationModel === null
    ? null
    : parseEnum(payload.valuationModel, PREFERRED_MODELS, 'export.valuationModel');
  for (const field of ['name', 'ticker', 'currency', 'unitsScale', 'asOfDate']) {
    requireString(company[field], `export.company.${field}`);
  }
  if (!['units', 'thousands', 'millions', 'billions'].includes(String(company.unitsScale))) {
    throw new TypeError('export.company.unitsScale is not a supported scale');
  }
  const comparableRoutes = ['ev_ebitda', 'revenue_multiple'] as const;
  if (comparableRoutes.includes(valuationModel as typeof comparableRoutes[number])) {
    const multiple = requireRecord(payload.comparableModel, 'export.comparableModel');
    if (multiple.method !== valuationModel) {
      throw new TypeError('export.comparableModel.method must match export.valuationModel');
    }
    if (requireFiniteNumber(multiple.targetMetric, 'export.comparableModel.targetMetric') <= 0
      || requireFiniteNumber(multiple.selectedMultiple, 'export.comparableModel.selectedMultiple') <= 0) {
      throw new TypeError('export.comparableModel target metric and selected multiple must be positive');
    }
    parseEnum(multiple.peerStatus, ['live', 'cached'] as const, 'export.comparableModel.peerStatus');
    requireString(multiple.peerSource, 'export.comparableModel.peerSource');
    if (typeof multiple.peerFallbackUsed !== 'boolean' || multiple.peerFallbackUsed) {
      throw new TypeError('export.comparableModel.peerFallbackUsed must be false');
    }
    const peerFetchedAt = requireFiniteNumber(multiple.peerFetchedAtMs, 'export.comparableModel.peerFetchedAtMs');
    if (!Number.isInteger(peerFetchedAt) || peerFetchedAt <= 0) {
      throw new TypeError('export.comparableModel.peerFetchedAtMs must be a positive integer');
    }
  } else if (payload.comparableModel !== undefined && payload.comparableModel !== null) {
    throw new TypeError('export.comparableModel is only valid for multiple valuation routes');
  }
  if (company.operatingArchetype !== undefined && company.operatingArchetype !== null) {
    parseEnum(company.operatingArchetype, [
      'standard_operating', 'technology_hardware', 'subscription_software', 'consumer_retail',
      'industrial_manufacturing', 'semiconductor', 'energy_materials', 'telecommunications',
      'mature_pharma', 'biotechnology', 'unclassified_operating',
    ] as const, 'export.company.operatingArchetype');
  }

  const market = requireRecord(requireExportField(payload, 'market', 'export'), 'export.market');
  if (requireFiniteNumber(market.currentPrice, 'export.market.currentPrice') <= 0) {
    throw new TypeError('export.market.currentPrice must be positive');
  }
  if (requireFiniteNumber(market.sharesDiluted, 'export.market.sharesDiluted') <= 0) {
    throw new TypeError('export.market.sharesDiluted must be positive');
  }
  if (market.marketCap !== undefined && market.marketCap !== null
    && requireFiniteNumber(market.marketCap, 'export.market.marketCap') <= 0) {
    throw new TypeError('export.market.marketCap must be positive when supplied');
  }

  const historicals = requireRecord(requireExportField(payload, 'historicals', 'export'), 'export.historicals');
  const years = requireExportField(historicals, 'years', 'export.historicals');
  if (!Array.isArray(years) || years.some((year) => typeof year !== 'number' || !Number.isInteger(year))) {
    throw new TypeError('export.historicals.years must be an array of integer years');
  }
  validateHistoricalSeries(requireExportField(historicals, 'income', 'export.historicals'), 'export.historicals.income');
  validateHistoricalSeries(requireExportField(historicals, 'balance', 'export.historicals'), 'export.historicals.balance');
  validateHistoricalSeries(requireExportField(historicals, 'cashflow', 'export.historicals'), 'export.historicals.cashflow');

  const assumptions = requireRecord(requireExportField(payload, 'assumptions', 'export'), 'export.assumptions');
  for (const field of ['scenarioMode', 'revenueMethod', 'capexMethod', 'daMethod', 'wcMethod']) {
    requireString(assumptions[field], `export.assumptions.${field}`);
  }
  const horizon = requireFiniteNumber(assumptions.horizonYears, 'export.assumptions.horizonYears');
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 15) {
    throw new TypeError('export.assumptions.horizonYears must be an integer between 1 and 15');
  }
  requireFiniteNumber(assumptions.taxRate, 'export.assumptions.taxRate');
  const wacc = requireRecord(assumptions.wacc, 'export.assumptions.wacc');
  for (const field of ['rf', 'erp', 'beta']) requireFiniteNumber(wacc[field], `export.assumptions.wacc.${field}`);
  if (wacc.betaSource !== undefined && wacc.betaSource !== null) {
    requireString(wacc.betaSource, 'export.assumptions.wacc.betaSource');
  }
  const terminal = requireRecord(assumptions.terminal, 'export.assumptions.terminal');
  requireString(terminal.method, 'export.assumptions.terminal.method');

  const forecasts = requireExportField(payload, 'forecasts', 'export');
  if (!Array.isArray(forecasts)) throw new TypeError('export.forecasts must be an array');
  forecasts.forEach((forecast, index) => {
    const path = `export.forecasts[${index}]`;
    const item = requireRecord(forecast, path);
    const year = requireFiniteNumber(item.year, `${path}.year`);
    if (!Number.isInteger(year)) throw new TypeError(`${path}.year must be an integer`);
  });
  const isBankModel = String(payload.valuationModel || '') === 'bank_residual_income';
  if (isBankModel) {
    if (payload.bankModel === undefined || payload.bankModel === null) {
      throw new TypeError('export.bankModel is required for bank_residual_income');
    }
    parseBankModelExportData(payload.bankModel);
  } else if (payload.bankModel !== undefined && payload.bankModel !== null) {
    throw new TypeError('export.bankModel is only valid for bank_residual_income');
  }
  const isInsuranceModel = String(payload.valuationModel || '') === 'insurance_pnc_residual_income';
  if (isInsuranceModel) {
    if (payload.insuranceModel === undefined || payload.insuranceModel === null) {
      throw new TypeError('export.insuranceModel is required for insurance_pnc_residual_income');
    }
    parseInsuranceModelExportData(payload.insuranceModel);
  } else if (payload.insuranceModel !== undefined && payload.insuranceModel !== null) {
    throw new TypeError('export.insuranceModel is only valid for insurance_pnc_residual_income');
  }
  const isReitModel = String(payload.valuationModel || '') === 'reit_affo';
  if (isReitModel) {
    if (payload.reitModel === undefined || payload.reitModel === null) {
      throw new TypeError('export.reitModel is required for reit_affo');
    }
    parseReitModelExportData(payload.reitModel);
  } else if (payload.reitModel !== undefined && payload.reitModel !== null) {
    throw new TypeError('export.reitModel is only valid for reit_affo');
  }
  const isAssetManagerModel = String(payload.valuationModel || '') === 'asset_manager_aum_dcf';
  if (isAssetManagerModel) {
    if (payload.assetManagerModel === undefined || payload.assetManagerModel === null) {
      throw new TypeError('export.assetManagerModel is required for asset_manager_aum_dcf');
    }
    parseAssetManagerModelExportData(payload.assetManagerModel);
  } else if (payload.assetManagerModel !== undefined && payload.assetManagerModel !== null) {
    throw new TypeError('export.assetManagerModel is only valid for asset_manager_aum_dcf');
  }
  const isTelecomModel = String(payload.valuationModel || '') === 'telecom_subscriber_dcf';
  if (isTelecomModel) {
    if (payload.telecomModel === undefined || payload.telecomModel === null) {
      throw new TypeError('export.telecomModel is required for telecom_subscriber_dcf');
    }
    parseTelecomModelExportData(payload.telecomModel);
  } else if (payload.telecomModel !== undefined && payload.telecomModel !== null) {
    throw new TypeError('export.telecomModel is only valid for telecom_subscriber_dcf');
  }
  const isMortgageReitModel = String(payload.valuationModel || '') === 'mortgage_reit_residual_income';
  if (isMortgageReitModel) {
    if (payload.mortgageReitModel === undefined || payload.mortgageReitModel === null) {
      throw new TypeError('export.mortgageReitModel is required for mortgage_reit_residual_income');
    }
    parseMortgageReitModelExportData(payload.mortgageReitModel);
  } else if (payload.mortgageReitModel !== undefined && payload.mortgageReitModel !== null) {
    throw new TypeError('export.mortgageReitModel is only valid for mortgage_reit_residual_income');
  }
  const isIntegratedEnergyModel = String(payload.valuationModel || '') === 'integrated_energy_dcf';
  if (isIntegratedEnergyModel) {
    if (payload.integratedEnergyModel === undefined || payload.integratedEnergyModel === null) {
      throw new TypeError('export.integratedEnergyModel is required for integrated_energy_dcf');
    }
    parseIntegratedEnergyModelExportData(payload.integratedEnergyModel);
  } else if (payload.integratedEnergyModel !== undefined && payload.integratedEnergyModel !== null) {
    throw new TypeError('export.integratedEnergyModel is only valid for integrated_energy_dcf');
  }
  const isMaturePharmaModel = String(payload.valuationModel || '') === 'mature_pharma_product_dcf';
  if (isMaturePharmaModel) {
    if (payload.maturePharmaModel === undefined || payload.maturePharmaModel === null) {
      throw new TypeError('export.maturePharmaModel is required for mature_pharma_product_dcf');
    }
    parseMaturePharmaModelExportData(payload.maturePharmaModel);
  } else if (payload.maturePharmaModel !== undefined && payload.maturePharmaModel !== null) {
    throw new TypeError('export.maturePharmaModel is only valid for mature_pharma_product_dcf');
  }
  let utilityModel: UtilityModelExportData | undefined;
  if (String(payload.valuationModel || '') === 'utility_dcf') {
    if (payload.utilityModel === undefined || payload.utilityModel === null) {
      throw new TypeError('export.utilityModel is required for utility_dcf');
    }
    utilityModel = parseUtilityModelExportData(payload.utilityModel);
  } else if (payload.utilityModel !== undefined && payload.utilityModel !== null) {
    throw new TypeError('export.utilityModel is only valid for utility_dcf');
  }
  let biotechModel: BiotechModelExportData | undefined;
  if (String(payload.valuationModel || '') === 'biotech_pipeline_rnpv') {
    if (payload.biotechModel === undefined || payload.biotechModel === null) {
      throw new TypeError('export.biotechModel is required for biotech_pipeline_rnpv');
    }
    biotechModel = parseBiotechModelExportData(payload.biotechModel);
  } else if (payload.biotechModel !== undefined && payload.biotechModel !== null) {
    throw new TypeError('export.biotechModel is only valid for biotech_pipeline_rnpv');
  }
  const specialized = ['residual_income', 'bank_residual_income', 'insurance_pnc_residual_income', 'reit_affo', 'asset_manager_aum_dcf', 'telecom_subscriber_dcf', 'mortgage_reit_residual_income', 'integrated_energy_dcf', 'mature_pharma_product_dcf', 'utility_dcf', 'biotech_pipeline_rnpv', 'ev_ebitda', 'revenue_multiple'];
  if ((!payload.valuationModel || !specialized.includes(String(payload.valuationModel))) && forecasts.length === 0) {
    throw new TypeError('export.forecasts must contain a period for a standard DCF');
  }
  if (payload.valuationModel !== undefined) {
    parseEnum(payload.valuationModel, PREFERRED_MODELS, 'export.valuationModel');
  }

  const uiMeta = payload.uiMeta;
  if (uiMeta !== undefined && uiMeta !== null) {
    const meta = requireRecord(uiMeta, 'export.uiMeta');
    if (meta.warnings !== undefined) requireStringArray(meta.warnings, 'export.uiMeta.warnings');
    if (meta.sourceNotes !== undefined) requireStringArray(meta.sourceNotes, 'export.uiMeta.sourceNotes');
  }

  return {...payload, buildStatus: 'ready', requiredInputs: [], ...(utilityModel ? {utilityModel} : {}), ...(biotechModel ? {biotechModel} : {})} as unknown as DcfExportPayload;
}
