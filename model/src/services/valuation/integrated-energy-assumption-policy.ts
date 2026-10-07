import type {CanonicalFinancialLine, NativeUnifiedPayload} from '@/core/types/native';
import type {EnergyHistoricalData, EnergyHistoricalYear} from '@/core/types';
import type {IncompleteIntegratedEnergyAssumptions, IntegratedEnergyAssumptions, IntegratedEnergyAssumptionSources} from './integrated-energy-model';
import { median as medianOf, requireFiledValue } from '@/services/valuation/source-guards';

function filedValue(line: CanonicalFinancialLine | undefined, name: string, year: number): number {
  return requireFiledValue(line, name, year, 'integrated energy');
}
function filedOrZero(line: CanonicalFinancialLine | undefined, name: string, year: number): number {
  if (line?.source === 'not_applicable' && line.sources.length > 0
    && line.sources.every((source) => source.accession && source.filed)) return 0;
  return filedValue(line, name, year);
}

function lineSource(line: CanonicalFinancialLine | undefined, name: string, year: number): string {
  if (!line) throw new Error(`FY${year} integrated-energy source disclosure ${name} is unavailable.`);
  return `FY${year} ${line.method}; ${line.sources.map((source) =>
    `${source.concept || line.concept || name} (accession ${source.accession}, filed ${source.filed}, ${source.fiscal_period || 'period unavailable'}, ${source.unit || 'unit unavailable'} ${source.unit_scale || ''})`,
  ).join('; ')}`;
}

function median(values: number[], name: string): number {
  return medianOf(values, {label: 'integrated energy', name});
}
function freshTimestamp(value: number | null | undefined, name: string): void {
  const now = Date.now();
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > now || now - value > 24 * 60 * 60 * 1000) {
    throw new Error(`A current ${name} timestamp within 24 hours is required for the integrated-energy valuation.`);
  }
}

function positive(value: number | null | undefined, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`Integrated-energy model requires positive ${name}.`);
  return value;
}

function productionGrossMargin(year: EnergyHistoricalYear): number {
  const energy = year.energy;
  const crude = filedValue(energy.crude_oil_production, 'crude oil production', year.year);
  const ngl = filedValue(energy.ngl_production, 'NGL production', year.year);
  const bitumen = filedValue(energy.bitumen_production, 'bitumen production', year.year);
  const synthetic = filedValue(energy.synthetic_oil_production, 'synthetic oil production', year.year);
  const gas = filedValue(energy.natural_gas_production_available_for_sale, 'natural gas available for sale', year.year);
  const oilEquivalent = filedValue(energy.oil_equivalent_production, 'oil-equivalent production', year.year);
  const crudePrice = filedValue(energy.average_crude_price, 'crude realized price', year.year);
  const nglPrice = filedValue(energy.average_ngl_price, 'NGL realized price', year.year);
  const bitumenPrice = filedValue(energy.average_bitumen_price, 'bitumen realized price', year.year);
  const syntheticPrice = filedValue(energy.average_synthetic_oil_price, 'synthetic oil realized price', year.year);
  const gasPrice = filedValue(energy.average_natural_gas_price, 'natural gas realized price', year.year);
  const cost = filedValue(energy.average_production_cost_per_oil_equivalent_barrel, 'production cost per BOE', year.year);
  const otherLiquidsResidual = filedValue(energy.liquids_production, 'total liquids production', year.year)
    - crude - ngl - bitumen - synthetic;
  const revenueMillions = (crude * crudePrice * 365 + ngl * nglPrice * 365 + bitumen * bitumenPrice * 365
    + synthetic * syntheticPrice * 365 + otherLiquidsResidual * crudePrice * 365
    + (gas / 1_000) * gasPrice * 365) / 1_000_000;
  const productionCostMillions = oilEquivalent * cost * 365 / 1_000_000;
  return (revenueMillions - productionCostMillions) * 1_000_000;
}

export function buildSourcedIntegratedEnergyModelAssumptions(
  data: NativeUnifiedPayload,
  history: EnergyHistoricalData,
): IntegratedEnergyAssumptions {
  const assumptions = buildIntegratedEnergyAssumptionValues(data, history, false);
  if (assumptions.baseGrossProductionMargin === null || assumptions.upstreamEarningsConversionFactor === null) {
    throw new Error('Filed crude production is required for a ready integrated-energy model.');
  }
  return {
    ...assumptions,
    baseGrossProductionMargin: assumptions.baseGrossProductionMargin,
    upstreamEarningsConversionFactor: assumptions.upstreamEarningsConversionFactor,
  };
}

type IntegratedEnergyAssumptionValues = Omit<IntegratedEnergyAssumptions, 'baseGrossProductionMargin' | 'upstreamEarningsConversionFactor'> & {
  baseGrossProductionMargin: number | null;
  upstreamEarningsConversionFactor: number | null;
};

function hasFiledCrudeProduction(line: CanonicalFinancialLine): boolean {
  return (line.source === 'sec_native' || line.source === 'derived')
    && typeof line.value === 'number' && Number.isFinite(line.value)
    && line.sources.length > 0 && line.sources.every((source) => source.accession && source.filed);
}

function buildIntegratedEnergyAssumptionValues(
  data: NativeUnifiedPayload,
  history: EnergyHistoricalData,
  allowMissingCrudeProduction: boolean,
): IntegratedEnergyAssumptionValues {
  if (data.canonical_financials.currency?.toUpperCase() !== 'USD') throw new Error('Integrated energy DCF requires USD-denominated canonical financials.');
  if (history.annual.length !== 3 || history.years.length !== 3
    || history.annual.some((item, index) => item.year !== history.years[index] || (index > 0 && item.year !== history.annual[index - 1]!.year + 1))) {
    throw new Error('Integrated-energy DCF requires three aligned consecutive annual periods.');
  }
  if (!['live', 'cached'].includes(data.data_quality.market.status) || data.market.fallback_used === true) {
    throw new Error('Integrated-energy DCF requires current non-fallback market inputs.');
  }
  if (!['live', 'cached'].includes(data.data_quality.valuation_context.status)) {
    throw new Error('Integrated-energy DCF requires current interest-rate and ERP inputs.');
  }
  freshTimestamp(data.market.fetched_at_ms, 'market');
  freshTimestamp(data.valuation_context.fetched_at_ms, 'valuation context');
  const recent = history.annual;
  const latest = recent.at(-1);
  if (!latest) throw new Error('Integrated-energy DCF requires filed annual history.');
  const latestEnergy = latest.energy;
  const currentPrice = positive(data.market.current_price, 'share price');
  const marketCapitalization = positive(data.market.market_cap, 'market capitalization');
  const commonSharesOutstanding = positive(data.market.shares_outstanding, 'current shares outstanding');
  const beta = positive(data.market.beta, 'market beta');
  const riskFreeRate = positive(data.valuation_context.risk_free_rate, 'risk-free rate');
  const equityRiskPremium = positive(data.valuation_context.equity_risk_premium, 'equity risk premium');
  const taxRate = median(recent.map((item) => filedValue(item.taxRate, 'effective tax rate', item.year)), 'effective tax rate');
  const latestTaxRate = filedValue(latest.taxRate, 'latest effective tax rate', latest.year);
  const debtBalances = recent.map((item) => filedValue(item.currentDebt, 'current debt', item.year)
    + filedValue(item.longTermDebt, 'long-term debt', item.year));
  const debt = debtBalances.at(-1)!;
  const costOfDebt = median(recent.slice(1).map((item, index) => {
    const averageDebt = (debtBalances[index]! + debtBalances[index + 1]!) / 2;
    if (averageDebt <= 0) throw new Error(`FY${item.year} average interest-bearing debt must be positive.`);
    return filedValue(item.interestExpense, 'interest expense', item.year) / averageDebt;
  }), 'cost of debt');
  const debtWeight = debt / (marketCapitalization + debt);
  const equityWeight = 1 - debtWeight;
  const costOfEquity = riskFreeRate + beta * equityRiskPremium;
  const wacc = equityWeight * costOfEquity + debtWeight * costOfDebt * (1 - taxRate);
  const terminalGrowthRate = 0.025;
  if (wacc < 0.02 || wacc > 0.3 || terminalGrowthRate >= wacc) {
    throw new Error('Integrated-energy WACC must be 2%–30% and exceed terminal growth.');
  }
  const upstreamEarnings = filedValue(latestEnergy.upstream_earnings_gaap, 'Upstream GAAP earnings', latest.year);
  const crudeProductionIsFiled = hasFiledCrudeProduction(latestEnergy.crude_oil_production);
  const baseGrossProductionMargin = allowMissingCrudeProduction && !crudeProductionIsFiled
    ? null
    : productionGrossMargin(latest);
  if (upstreamEarnings <= 0 || (baseGrossProductionMargin !== null && baseGrossProductionMargin <= 0)) {
    throw new Error('Filed Upstream results do not support a sourced earnings conversion factor.');
  }
  const upstreamEarningsConversionFactor = baseGrossProductionMargin === null
    ? null
    : upstreamEarnings / baseGrossProductionMargin;
  const revenueHistory = recent.map((item) => filedValue(item.revenue, 'consolidated sales', item.year));
  const cashCapexPctRevenue = median(recent.map((item, index) =>
    filedValue(item.energy.cash_capex, 'Cash CapEx', item.year) / revenueHistory[index]!), 'Cash CapEx as a percent of sales');
  const depreciationPctRevenue = median(recent.map((item, index) =>
    filedValue(item.depreciation, 'depreciation and depletion', item.year) / revenueHistory[index]!), 'depreciation and depletion as a percent of sales');
  const workingCapitalInvestmentPctRevenue = median(recent.map((item, index) =>
    filedValue(item.energy.operating_working_capital_investment, 'operating working-capital investment', item.year) / revenueHistory[index]!),
  'operating working-capital investment as a percent of sales');
  const latestInterestRevenue = filedValue(latestEnergy.corporate_interest_revenue, 'Corporate and Financing interest revenue', latest.year);
  const interestExpense = filedValue(latest.interestExpense, 'interest expense', latest.year);
  const baseCorporateOperatingEarnings = filedValue(latestEnergy.corporate_financing_earnings_gaap, 'Corporate and Financing GAAP earnings', latest.year)
    - (latestInterestRevenue - interestExpense) * (1 - latestTaxRate);

  const cash = filedValue(latest.cash, 'cash', latest.year);
  // Equity-company earnings and production are included in the segment DCF; do not also add the combined investments/advances balance.
  const marketableSecurities = 0;
  const nonControllingInterest = filedOrZero(latest.nonControllingInterest, 'noncontrolling interest', latest.year);
  const preferredEquity = filedOrZero(latest.preferredEquity, 'preferred equity', latest.year);
  const sources: IntegratedEnergyAssumptionSources = {
    crudePriceChange: 'Analyst input: $0.00/bbl annual change to the FY2025 filed total crude realization; update for a price case.',
    nglPriceChange: 'Analyst input: $0.00/bbl annual NGL-price change in the base case.',
    bitumenPriceChange: 'Analyst input: $0.00/bbl annual bitumen-price change in the base case.',
    syntheticOilPriceChange: 'Analyst input: $0.00/bbl annual synthetic-oil price change in the base case.',
    naturalGasPriceChange: 'Analyst input: $0.00/Mcf annual change to the FY2025 filed total natural-gas realization.',
    productionGrowth: 'Analyst input: 0.0% annual liquids and gas production growth; the historical period includes acquisitions and large project start-ups.',
    productionCostChangePerBoe: 'Analyst input: $0.00/BOE annual change to the FY2025 filed production-cost base.',
    energyProductsEarningsGrowth: 'Analyst input: 0.0% annual growth of FY2025 filed GAAP Energy Products earnings.',
    chemicalProductsEarningsGrowth: 'Analyst input: 0.0% annual growth of FY2025 filed GAAP Chemical Products earnings.',
    specialtyProductsEarningsGrowth: 'Analyst input: 0.0% annual growth of FY2025 filed GAAP Specialty Products earnings.',
    corporateOperatingEarningsGrowth: 'Analyst input: 0.0% annual growth of Corporate and Financing operating earnings after removing the after-tax net interest effect.',
    revenueGrowth: 'Analyst input: 0.0% annual consolidated revenue growth in the base case; it is an explicit operating-scale assumption, not consensus.',
    cashCapexPctRevenue: `Median FY2023–FY2025 filed non-GAAP Cash CapEx / SEC consolidated sales and other operating revenue. ${lineSource(latestEnergy.cash_capex, 'cash CapEx', latest.year)}`,
    depreciationPctRevenue: `Median FY2023–FY2025 SEC depreciation and depletion / consolidated sales. ${lineSource(latest.depreciation, 'depreciation', latest.year)}`,
    workingCapitalInvestmentPctRevenue: `Median FY2023–FY2025 derived operational working-capital investment / consolidated sales; each period sums filed receivable, inventory, other current asset, and payable cash-flow impacts.`,
    reserveReplacementRatio: 'Analyst input: 100% annual reserve replacement in the base case; this reserve-life check is not added to enterprise value.',
    upstreamEarningsConversionFactor: upstreamEarningsConversionFactor === null
      ? `Missing filed FY${latest.year} crude production; enter the annual production value and source on Input Required before deriving the upstream conversion factor.`
      : `FY${latest.year} Upstream GAAP earnings divided by the FY${latest.year} filed production-price and production-cost proxy. It anchors the starting level and is visible for analyst review.`,
    costOfDebt: 'Median FY2024–FY2025 filed interest expense divided by average filed current plus long-term debt.',
    wacc: `CAPM cost of equity uses risk-free rate ${riskFreeRate.toFixed(4)}, beta ${beta.toFixed(3)}, ERP ${equityRiskPremium.toFixed(4)}, current market capitalization, filed debt, and effective tax rate as of ${data.valuation_context.as_of_date}.`,
    marketableSecurities: 'No separate marketable-securities adjustment is included: the combined SEC investments/advances line includes equity-method operations whose earnings and production are already in the forecast segments.',
    terminalGrowthRate: 'Analyst input: 2.5% perpetual FCFF growth, editable and required to remain below WACC.',
  };

  return {
    forecastYears: 5,
    baseYear: latest.year,
    asOfDate: String(data.valuation_context.as_of_date),
    crudePrice: filedValue(latestEnergy.average_crude_price, 'total crude realization', latest.year),
    nglPrice: filedValue(latestEnergy.average_ngl_price, 'total NGL realization', latest.year),
    bitumenPrice: filedValue(latestEnergy.average_bitumen_price, 'total bitumen realization', latest.year),
    syntheticOilPrice: filedValue(latestEnergy.average_synthetic_oil_price, 'total synthetic oil realization', latest.year),
    naturalGasPrice: filedValue(latestEnergy.average_natural_gas_price, 'total natural gas realization', latest.year),
    crudePriceChange: 0,
    nglPriceChange: 0,
    bitumenPriceChange: 0,
    syntheticOilPriceChange: 0,
    naturalGasPriceChange: 0,
    liquidsProductionGrowth: 0,
    naturalGasProductionGrowth: 0,
    productionCostPerBoe: filedValue(latestEnergy.average_production_cost_per_oil_equivalent_barrel, 'production cost per BOE', latest.year),
    productionCostChangePerBoe: 0,
    upstreamEarningsConversionFactor,
    baseUpstreamEarnings: upstreamEarnings,
    baseGrossProductionMargin,
    baseEnergyProductsEarnings: filedValue(latestEnergy.energy_products_earnings_gaap, 'Energy Products GAAP earnings', latest.year),
    baseChemicalProductsEarnings: filedValue(latestEnergy.chemical_products_earnings_gaap, 'Chemical Products GAAP earnings', latest.year),
    baseSpecialtyProductsEarnings: filedValue(latestEnergy.specialty_products_earnings_gaap, 'Specialty Products GAAP earnings', latest.year),
    energyProductsEarningsGrowth: 0,
    chemicalProductsEarningsGrowth: 0,
    specialtyProductsEarningsGrowth: 0,
    baseCorporateOperatingEarnings,
    corporateOperatingEarningsGrowth: 0,
    baseRevenue: revenueHistory.at(-1)!,
    revenueGrowth: 0,
    cashCapexPctRevenue,
    depreciationPctRevenue,
    workingCapitalInvestmentPctRevenue,
    reserveReplacementRatio: 1,
    filedBrentSensitivity: filedValue(latestEnergy.brent_2026_earnings_sensitivity, '2026 Brent price sensitivity', latest.year),
    filedHenryHubSensitivity: filedValue(latestEnergy.henry_hub_2026_earnings_sensitivity, '2026 Henry Hub sensitivity', latest.year),
    filedTTFSensitivity: filedValue(latestEnergy.ttf_2026_earnings_sensitivity, '2026 TTF sensitivity', latest.year),
    riskFreeRate,
    equityRiskPremium,
    beta,
    costOfDebt,
    debtWeight,
    equityWeight,
    wacc,
    terminalGrowthRate,
    currentPrice,
    marketCapitalization,
    commonSharesOutstanding,
    cash,
    marketableSecurities,
    debt,
    nonControllingInterest,
    preferredEquity,
    taxRate,
    assumptionSources: sources,
  };
}

export function buildSourcedIncompleteIntegratedEnergyAssumptions(
  data: NativeUnifiedPayload,
  history: EnergyHistoricalData,
): IncompleteIntegratedEnergyAssumptions {
  const latest = history.annual.at(-1);
  if (!latest) throw new Error('Incomplete integrated-energy workbook requires filed annual history.');
  if (hasFiledCrudeProduction(latest.energy.crude_oil_production)) {
    throw new Error('Latest filed crude production is available; the integrated-energy workbook should be complete.');
  }
  const assumptions = buildIntegratedEnergyAssumptionValues(data, history, true);
  return {...assumptions, baseGrossProductionMargin: null, upstreamEarningsConversionFactor: null};
}
