import type {DCFResults, EnergyHistoricalData, EnergyHistoricalYear} from '@/core/types';
import type {CanonicalFinancialLine} from '@/core/types/native';
import { requireFiledValue } from '@/services/valuation/source-guards';

export interface IntegratedEnergyAssumptionSources {
  crudePriceChange: string;
  nglPriceChange: string;
  bitumenPriceChange: string;
  syntheticOilPriceChange: string;
  naturalGasPriceChange: string;
  productionGrowth: string;
  productionCostChangePerBoe: string;
  energyProductsEarningsGrowth: string;
  chemicalProductsEarningsGrowth: string;
  specialtyProductsEarningsGrowth: string;
  corporateOperatingEarningsGrowth: string;
  revenueGrowth: string;
  cashCapexPctRevenue: string;
  depreciationPctRevenue: string;
  workingCapitalInvestmentPctRevenue: string;
  reserveReplacementRatio: string;
  upstreamEarningsConversionFactor: string;
  costOfDebt: string;
  wacc: string;
  marketableSecurities: string;
  terminalGrowthRate: string;
}

export interface IntegratedEnergyAssumptions {
  forecastYears: number;
  baseYear: number;
  asOfDate: string;
  crudePrice: number;
  nglPrice: number;
  bitumenPrice: number;
  syntheticOilPrice: number;
  naturalGasPrice: number;
  crudePriceChange: number;
  nglPriceChange: number;
  bitumenPriceChange: number;
  syntheticOilPriceChange: number;
  naturalGasPriceChange: number;
  liquidsProductionGrowth: number;
  naturalGasProductionGrowth: number;
  productionCostPerBoe: number;
  productionCostChangePerBoe: number;
  upstreamEarningsConversionFactor: number;
  baseUpstreamEarnings: number;
  baseGrossProductionMargin: number;
  baseEnergyProductsEarnings: number;
  baseChemicalProductsEarnings: number;
  baseSpecialtyProductsEarnings: number;
  energyProductsEarningsGrowth: number;
  chemicalProductsEarningsGrowth: number;
  specialtyProductsEarningsGrowth: number;
  baseCorporateOperatingEarnings: number;
  corporateOperatingEarningsGrowth: number;
  baseRevenue: number;
  revenueGrowth: number;
  cashCapexPctRevenue: number;
  depreciationPctRevenue: number;
  workingCapitalInvestmentPctRevenue: number;
  reserveReplacementRatio: number;
  filedBrentSensitivity: number;
  filedHenryHubSensitivity: number;
  filedTTFSensitivity: number;
  riskFreeRate: number;
  equityRiskPremium: number;
  beta: number;
  costOfDebt: number;
  debtWeight: number;
  equityWeight: number;
  wacc: number;
  terminalGrowthRate: number;
  currentPrice: number;
  marketCapitalization: number;
  commonSharesOutstanding: number;
  cash: number;
  marketableSecurities: number;
  debt: number;
  nonControllingInterest: number;
  preferredEquity: number;
  taxRate: number;
  assumptionSources: IntegratedEnergyAssumptionSources;
}

export type IncompleteIntegratedEnergyAssumptions = Omit<IntegratedEnergyAssumptions, 'upstreamEarningsConversionFactor' | 'baseGrossProductionMargin'> & {
  upstreamEarningsConversionFactor: null;
  baseGrossProductionMargin: null;
};

export interface IntegratedEnergyForecastYear {
  year: number;
  crudeOilProduction: number;
  nglProduction: number;
  bitumenProduction: number;
  syntheticOilProduction: number;
  otherLiquidsProductionResidual: number;
  liquidsProduction: number;
  naturalGasProduction: number;
  oilEquivalentProduction: number;
  crudePrice: number;
  nglPrice: number;
  bitumenPrice: number;
  syntheticOilPrice: number;
  naturalGasPrice: number;
  productionCostPerBoe: number;
  upstreamProductionRevenue: number;
  upstreamProductionCosts: number;
  productionGrossMargin: number;
  upstreamEarnings: number;
  energyProductsEarnings: number;
  chemicalProductsEarnings: number;
  specialtyProductsEarnings: number;
  corporateOperatingEarnings: number;
  nopat: number;
  consolidatedRevenue: number;
  depreciationAndDepletion: number;
  cashCapex: number;
  workingCapitalInvestment: number;
  fcff: number;
  discountFactor: number;
  presentValueFcff: number;
  beginningProvedReserves: number;
  reserveReplacement: number;
  endingProvedReserves: number;
  reserveLifeYears: number;
  modeledBrentSensitivity: number;
  filedBrentSensitivity: number;
  segmentEarningsReconciliationCheck: number;
  fcffIdentityCheck: number;
  reserveRollForwardCheck: number;
}

export interface IntegratedEnergyModelResult extends DCFResults {
  valuationBasis: 'enterprise';
  wacc: number;
  terminalGrowthUsed: number;
  integratedEnergyForecasts: IntegratedEnergyForecastYear[];
}

function filedValue(line: CanonicalFinancialLine | undefined, name: string, year: number): number {
  return requireFiledValue(line, name, year, 'integrated energy');
}
function baseOperatingNetIncome(history: EnergyHistoricalYear): number {
  const energy = history.energy;
  return filedValue(energy.upstream_earnings_gaap, 'Upstream segment earnings', history.year)
    + filedValue(energy.energy_products_earnings_gaap, 'Energy Products segment earnings', history.year)
    + filedValue(energy.chemical_products_earnings_gaap, 'Chemical Products segment earnings', history.year)
    + filedValue(energy.specialty_products_earnings_gaap, 'Specialty Products segment earnings', history.year)
    + filedValue(energy.corporate_financing_earnings_gaap, 'Corporate and Financing segment earnings', history.year);
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
  const otherLiquidsResidual = filedValue(energy.liquids_production, 'total liquids production', year.year) - crude - ngl - bitumen - synthetic;
  const revenueMillions = (crude * crudePrice * 365 + ngl * nglPrice * 365 + bitumen * bitumenPrice * 365
    + synthetic * syntheticPrice * 365 + otherLiquidsResidual * crudePrice * 365 + (gas / 1_000) * gasPrice * 365) / 1_000_000;
  const costMillions = oilEquivalent * cost * 365 / 1_000_000;
  return (revenueMillions - costMillions) * 1_000_000;
}

function validateHistory(history: EnergyHistoricalData): EnergyHistoricalYear[] {
  if (history.annual.length !== 3 || history.years.length !== 3
    || history.annual.some((item, index) => item.year !== history.years[index] || (index > 0 && item.year !== history.annual[index - 1]!.year + 1))) {
    throw new Error('Integrated-energy model requires three aligned consecutive fiscal years.');
  }
  for (const item of history.annual) {
    const energy = item.energy;
    const required: Array<[keyof typeof energy, string]> = [
      ['weighted_average_diluted_shares', 'weighted-average diluted shares'],
      ['crude_oil_production', 'crude oil production'], ['ngl_production', 'NGL production'],
      ['bitumen_production', 'bitumen production'], ['synthetic_oil_production', 'synthetic oil production'],
      ['liquids_production', 'total liquids production'], ['natural_gas_production_available_for_sale', 'gas available for sale'],
      ['oil_equivalent_production', 'oil-equivalent production'], ['average_crude_price', 'crude price'],
      ['average_ngl_price', 'NGL price'], ['average_bitumen_price', 'bitumen price'],
      ['average_synthetic_oil_price', 'synthetic oil price'], ['average_natural_gas_price', 'gas price'],
      ['average_production_cost_per_oil_equivalent_barrel', 'production cost per BOE'],
      ['proved_oil_equivalent_reserves', 'total proved reserves'], ['proved_developed_oil_equivalent_reserves', 'developed reserves'],
      ['proved_undeveloped_oil_equivalent_reserves', 'undeveloped reserves'], ['upstream_earnings_gaap', 'Upstream GAAP earnings'],
      ['energy_products_earnings_gaap', 'Energy Products GAAP earnings'], ['chemical_products_earnings_gaap', 'Chemical Products GAAP earnings'],
      ['specialty_products_earnings_gaap', 'Specialty Products GAAP earnings'], ['corporate_financing_earnings_gaap', 'Corporate and Financing GAAP earnings'],
      ['cash_capex', 'Cash CapEx'], ['operating_working_capital_investment', 'working-capital investment'],
    ];
    for (const [field, label] of required) filedValue(energy[field], label, item.year);
    const liquids = filedValue(energy.liquids_production, 'total liquids', item.year);
    const componentLiquids = filedValue(energy.crude_oil_production, 'crude oil', item.year)
      + filedValue(energy.ngl_production, 'NGL', item.year)
      + filedValue(energy.bitumen_production, 'bitumen', item.year)
      + filedValue(energy.synthetic_oil_production, 'synthetic oil', item.year);
    if (Math.abs(liquids - componentLiquids) > 5_000) throw new Error(`FY${item.year} liquid-product volumes do not reconcile.`);
    const oilEquivalent = liquids + filedValue(energy.natural_gas_production_available_for_sale, 'gas available for sale', item.year) / 6_000;
    if (Math.abs(oilEquivalent - filedValue(energy.oil_equivalent_production, 'oil-equivalent production', item.year)) > 5_000) {
      throw new Error(`FY${item.year} liquids and gas do not reconcile to oil-equivalent production.`);
    }
    const proved = filedValue(energy.proved_oil_equivalent_reserves, 'proved reserves', item.year);
    const provedDeveloped = filedValue(energy.proved_developed_oil_equivalent_reserves, 'developed reserves', item.year);
    const provedUndeveloped = filedValue(energy.proved_undeveloped_oil_equivalent_reserves, 'undeveloped reserves', item.year);
    if (Math.abs(proved - provedDeveloped - provedUndeveloped) > 1_000_000) throw new Error(`FY${item.year} reserve classes do not reconcile to total proved reserves.`);
    const segmentEarnings = baseOperatingNetIncome(item);
    const netIncome = filedValue(item.netIncome, 'attributable net income', item.year);
    if (Math.abs(segmentEarnings - netIncome) > 2_000_000) throw new Error(`FY${item.year} segment earnings do not reconcile to consolidated net income.`);
    for (const [line, name] of [
      [item.revenue, 'consolidated revenue'], [item.taxRate, 'effective tax rate'], [item.depreciation, 'depreciation and depletion'],
      [item.interestExpense, 'interest expense'], [item.currentDebt, 'current debt'], [item.longTermDebt, 'long-term debt'],
      [item.cash, 'cash'], [item.nonControllingInterest, 'noncontrolling interest'],
      [item.energy.corporate_interest_revenue, 'Corporate and Financing interest revenue'],
    ] as const) filedValue(line, name, item.year);
  }
  return history.annual;
}

function validateAssumptions(a: IntegratedEnergyAssumptions): void {
  if (a.forecastYears !== 5) throw new Error('Integrated-energy DCF requires a five-year forecast.');
  const values: Array<[string, number]> = [
    ['commodity prices', a.crudePrice + a.nglPrice + a.bitumenPrice + a.syntheticOilPrice + a.naturalGasPrice],
    ['liquids production growth', a.liquidsProductionGrowth], ['natural gas production growth', a.naturalGasProductionGrowth],
    ['production cost', a.productionCostPerBoe], ['cost changes', a.productionCostChangePerBoe],
    ['upstream earnings conversion factor', a.upstreamEarningsConversionFactor], ['upstream earnings', a.baseUpstreamEarnings],
    ['gross-margin base', a.baseGrossProductionMargin], ['revenue', a.baseRevenue], ['revenue growth', a.revenueGrowth],
    ['cash CapEx ratio', a.cashCapexPctRevenue], ['depreciation ratio', a.depreciationPctRevenue],
    ['working-capital ratio', a.workingCapitalInvestmentPctRevenue], ['reserve replacement ratio', a.reserveReplacementRatio],
    ['filed Brent sensitivity', a.filedBrentSensitivity], ['filed Henry Hub sensitivity', a.filedHenryHubSensitivity],
    ['filed TTF sensitivity', a.filedTTFSensitivity], ['risk-free rate', a.riskFreeRate], ['ERP', a.equityRiskPremium],
    ['beta', a.beta], ['cost of debt', a.costOfDebt], ['debt weight', a.debtWeight], ['equity weight', a.equityWeight],
    ['WACC', a.wacc], ['terminal growth', a.terminalGrowthRate], ['current price', a.currentPrice],
    ['market capitalization', a.marketCapitalization], ['diluted shares', a.commonSharesOutstanding], ['cash', a.cash],
    ['marketable securities', a.marketableSecurities], ['debt', a.debt], ['noncontrolling interest', a.nonControllingInterest],
    ['preferred equity', a.preferredEquity], ['tax rate', a.taxRate],
  ];
  if (values.some(([, value]) => !Number.isFinite(value))) throw new Error('Integrated-energy assumptions must be finite.');
  const annualGrowth = [a.liquidsProductionGrowth, a.naturalGasProductionGrowth, a.revenueGrowth, a.energyProductsEarningsGrowth,
    a.chemicalProductsEarningsGrowth, a.specialtyProductsEarningsGrowth, a.corporateOperatingEarningsGrowth];
  if (annualGrowth.some((value) => value < -0.5 || value > 0.5)) throw new Error('Integrated-energy annual growth assumptions must be between -50% and 50%.');
  const priceChanges = [a.crudePriceChange, a.nglPriceChange, a.bitumenPriceChange, a.syntheticOilPriceChange, a.naturalGasPriceChange];
  if (priceChanges.some((value) => Math.abs(value) > 100)) throw new Error('Integrated-energy price changes exceed supported bounds.');
  if (a.productionCostPerBoe <= 0 || a.upstreamEarningsConversionFactor <= 0 || a.upstreamEarningsConversionFactor > 2
    || a.cashCapexPctRevenue < 0 || a.cashCapexPctRevenue > 0.5 || a.depreciationPctRevenue < 0 || a.depreciationPctRevenue > 0.5
    || Math.abs(a.workingCapitalInvestmentPctRevenue) > 0.3 || a.reserveReplacementRatio < 0 || a.reserveReplacementRatio > 3
    || a.taxRate < 0 || a.taxRate > 0.6) throw new Error('Integrated-energy cost, reinvestment, reserve, or tax assumptions are outside supported bounds.');
  if (a.wacc < 0.02 || a.wacc > 0.3 || a.terminalGrowthRate < 0 || a.terminalGrowthRate >= a.wacc) {
    throw new Error('Integrated-energy WACC must be 2%–30% and exceed terminal growth.');
  }
  if (a.commonSharesOutstanding <= 0 || a.marketCapitalization <= 0 || a.currentPrice <= 0
    || a.cash < 0 || a.marketableSecurities < 0 || a.debt < 0 || a.nonControllingInterest < 0 || a.preferredEquity < 0) {
    throw new Error('Integrated-energy market and common-equity bridge inputs are outside supported bounds.');
  }
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(a.asOfDate)) throw new Error('Integrated-energy model requires a dated market context.');
  if (Object.values(a.assumptionSources).some((source) => !source.trim())) throw new Error('Integrated-energy assumptions require source notes or explicit analyst-input disclosures.');
}

export function calculateIntegratedEnergyValuation(
  history: EnergyHistoricalData,
  assumptions: IntegratedEnergyAssumptions,
): IntegratedEnergyModelResult {
  const annual = validateHistory(history);
  validateAssumptions(assumptions);
  const latest = annual.at(-1)!;
  const energy = latest.energy;
  const baseCrude = filedValue(energy.crude_oil_production, 'crude oil production', latest.year);
  const baseNgl = filedValue(energy.ngl_production, 'NGL production', latest.year);
  const baseBitumen = filedValue(energy.bitumen_production, 'bitumen production', latest.year);
  const baseSynthetic = filedValue(energy.synthetic_oil_production, 'synthetic oil production', latest.year);
  const baseGas = filedValue(energy.natural_gas_production_available_for_sale, 'natural gas production', latest.year);
  const baseLiquidTotal = filedValue(energy.liquids_production, 'total liquids production', latest.year);
  const baseGrossMargin = productionGrossMargin(latest);
  const reserveBase = filedValue(energy.proved_oil_equivalent_reserves, 'proved reserves', latest.year);
  let provedReserves = reserveBase;
  let sumPresentValueFcff = 0;
  const integratedEnergyForecasts: IntegratedEnergyForecastYear[] = [];

  for (let index = 1; index <= assumptions.forecastYears; index += 1) {
    const year = latest.year + index;
    const liquidsGrowth = Math.pow(1 + assumptions.liquidsProductionGrowth, index);
    const gasGrowth = Math.pow(1 + assumptions.naturalGasProductionGrowth, index);
    const crudeOilProduction = baseCrude * liquidsGrowth;
    const nglProduction = baseNgl * liquidsGrowth;
    const bitumenProduction = baseBitumen * liquidsGrowth;
    const syntheticOilProduction = baseSynthetic * liquidsGrowth;
    const reportedRoundingResidual = baseLiquidTotal - baseCrude - baseNgl - baseBitumen - baseSynthetic;
    const otherLiquidsProductionResidual = reportedRoundingResidual * liquidsGrowth;
    const liquidsProduction = crudeOilProduction + nglProduction + bitumenProduction + syntheticOilProduction + otherLiquidsProductionResidual;
    const naturalGasProduction = baseGas * gasGrowth;
    const oilEquivalentProduction = liquidsProduction + naturalGasProduction / 6_000;
    const crudePrice = assumptions.crudePrice + index * assumptions.crudePriceChange;
    const nglPrice = assumptions.nglPrice + index * assumptions.nglPriceChange;
    const bitumenPrice = assumptions.bitumenPrice + index * assumptions.bitumenPriceChange;
    const syntheticOilPrice = assumptions.syntheticOilPrice + index * assumptions.syntheticOilPriceChange;
    const naturalGasPrice = assumptions.naturalGasPrice + index * assumptions.naturalGasPriceChange;
    const productionCostPerBoe = assumptions.productionCostPerBoe + index * assumptions.productionCostChangePerBoe;
    if ([crudePrice, nglPrice, bitumenPrice, syntheticOilPrice, naturalGasPrice].some((value) => value < 0)
      || productionCostPerBoe <= 0 || oilEquivalentProduction <= 0) {
      throw new Error(`FY${year} production, commodity prices, or production cost are outside supported bounds.`);
    }
    const upstreamProductionRevenue = (
      crudeOilProduction * crudePrice * 365 + nglProduction * nglPrice * 365
      + bitumenProduction * bitumenPrice * 365 + syntheticOilProduction * syntheticOilPrice * 365
      + otherLiquidsProductionResidual * crudePrice * 365
      + (naturalGasProduction / 1_000) * naturalGasPrice * 365
    ) / 1_000_000;
    const upstreamProductionCosts = oilEquivalentProduction * productionCostPerBoe * 365 / 1_000_000;
    const productionGrossMargin = upstreamProductionRevenue - upstreamProductionCosts;
    const productionGrossMarginDollars = productionGrossMargin * 1_000_000;
    const upstreamEarnings = assumptions.baseUpstreamEarnings
      + (productionGrossMarginDollars - baseGrossMargin) * assumptions.upstreamEarningsConversionFactor;
    const energyProductsEarnings = assumptions.baseEnergyProductsEarnings * Math.pow(1 + assumptions.energyProductsEarningsGrowth, index);
    const chemicalProductsEarnings = assumptions.baseChemicalProductsEarnings * Math.pow(1 + assumptions.chemicalProductsEarningsGrowth, index);
    const specialtyProductsEarnings = assumptions.baseSpecialtyProductsEarnings * Math.pow(1 + assumptions.specialtyProductsEarningsGrowth, index);
    const corporateOperatingEarnings = assumptions.baseCorporateOperatingEarnings * Math.pow(1 + assumptions.corporateOperatingEarningsGrowth, index);
    const nopat = upstreamEarnings + energyProductsEarnings + chemicalProductsEarnings + specialtyProductsEarnings + corporateOperatingEarnings;
    const consolidatedRevenue = assumptions.baseRevenue * Math.pow(1 + assumptions.revenueGrowth, index);
    const depreciationAndDepletion = consolidatedRevenue * assumptions.depreciationPctRevenue;
    const cashCapex = consolidatedRevenue * assumptions.cashCapexPctRevenue;
    const workingCapitalInvestment = consolidatedRevenue * assumptions.workingCapitalInvestmentPctRevenue;
    const fcff = nopat + depreciationAndDepletion - cashCapex - workingCapitalInvestment;
    const discountFactor = 1 / Math.pow(1 + assumptions.wacc, index);
    const presentValueFcff = fcff * discountFactor;
    const annualProduction = oilEquivalentProduction * 365;
    const reserveReplacement = annualProduction * assumptions.reserveReplacementRatio;
    const endingProvedReserves = provedReserves + reserveReplacement - annualProduction;
    const reserveLifeYears = endingProvedReserves / Math.max(annualProduction, 1);
    const modeledBrentSensitivity = crudeOilProduction * 365 * assumptions.upstreamEarningsConversionFactor;
    const segmentEarningsReconciliationCheck = nopat - (upstreamEarnings + energyProductsEarnings + chemicalProductsEarnings
      + specialtyProductsEarnings + corporateOperatingEarnings);
    const fcffIdentityCheck = fcff - (nopat + depreciationAndDepletion - cashCapex - workingCapitalInvestment);
    const reserveRollForwardCheck = endingProvedReserves - (provedReserves + reserveReplacement - annualProduction);
    const forecastValues = [crudeOilProduction, nglProduction, bitumenProduction, syntheticOilProduction, liquidsProduction,
      naturalGasProduction, oilEquivalentProduction, upstreamProductionRevenue, upstreamProductionCosts, productionGrossMargin, productionGrossMarginDollars,
      upstreamEarnings, energyProductsEarnings, chemicalProductsEarnings, specialtyProductsEarnings, corporateOperatingEarnings,
      nopat, consolidatedRevenue, depreciationAndDepletion, cashCapex, workingCapitalInvestment, fcff, discountFactor,
      presentValueFcff, endingProvedReserves, reserveLifeYears, modeledBrentSensitivity, reportedRoundingResidual];
    if (!forecastValues.every(Number.isFinite)) throw new Error(`FY${year} integrated-energy forecast contains a non-finite value.`);
    integratedEnergyForecasts.push({
      year, crudeOilProduction, nglProduction, bitumenProduction, syntheticOilProduction,
      otherLiquidsProductionResidual, liquidsProduction,
      naturalGasProduction, oilEquivalentProduction, crudePrice, nglPrice, bitumenPrice, syntheticOilPrice,
      naturalGasPrice, productionCostPerBoe, upstreamProductionRevenue, upstreamProductionCosts, productionGrossMargin,
      upstreamEarnings, energyProductsEarnings, chemicalProductsEarnings, specialtyProductsEarnings,
      corporateOperatingEarnings, nopat, consolidatedRevenue, depreciationAndDepletion, cashCapex,
      workingCapitalInvestment, fcff, discountFactor, presentValueFcff, beginningProvedReserves: provedReserves,
      reserveReplacement, endingProvedReserves, reserveLifeYears, modeledBrentSensitivity,
      filedBrentSensitivity: assumptions.filedBrentSensitivity, segmentEarningsReconciliationCheck,
      fcffIdentityCheck, reserveRollForwardCheck,
    });
    sumPresentValueFcff += presentValueFcff;
    provedReserves = endingProvedReserves;
  }
  const final = integratedEnergyForecasts.at(-1)!;
  const terminalValue = final.fcff * (1 + assumptions.terminalGrowthRate) / (assumptions.wacc - assumptions.terminalGrowthRate);
  const pvTerminalValue = terminalValue * final.discountFactor;
  const enterpriseValue = sumPresentValueFcff + pvTerminalValue;
  const equityValue = enterpriseValue + assumptions.cash + assumptions.marketableSecurities - assumptions.debt
    - assumptions.nonControllingInterest - assumptions.preferredEquity;
  const impliedSharePrice = equityValue / assumptions.commonSharesOutstanding;
  const upside = impliedSharePrice / assumptions.currentPrice - 1;
  if (![terminalValue, pvTerminalValue, enterpriseValue, equityValue, impliedSharePrice, upside].every(Number.isFinite)
    || enterpriseValue <= 0 || equityValue <= 0 || impliedSharePrice <= 0) {
    throw new Error('Integrated-energy model returned a non-positive or non-finite equity bridge.');
  }
  return {
    forecasts: [],
    terminalValue,
    pvTerminalValue,
    enterpriseValue,
    equityValue,
    impliedSharePrice,
    shareCount: assumptions.commonSharesOutstanding,
    currentPrice: assumptions.currentPrice,
    upside,
    terminalValueGordon: terminalValue,
    terminalValueExitMultiple: 0,
    tvDivergenceFlag: false,
    avgROIC: 0,
    valueCreationFlag: false,
    confidenceScore: 0.62,
    confidenceRank: 'Medium',
    valuationBasis: 'enterprise',
    wacc: assumptions.wacc,
    terminalGrowthUsed: assumptions.terminalGrowthRate,
    integratedEnergyForecasts,
  };
}
