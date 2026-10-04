import type {AssetManagerHistoricalData, AssetManagerHistoricalYear, DCFResults} from '@/core/types';
import type {AssetManagerCanonicalFinancials, CanonicalFinancialLine} from '@/core/types/native';
import { requireFiledValue } from '@/services/valuation/source-guards';

export interface AssetManagerModelAssumptionSources {
  marketReturnRate: string;
  netFlowRate: string;
  realizationsRate: string;
  acquisitionRate: string;
  fxChangeRate: string;
  scopeChangeRate: string;
  baseFeeYield: string;
  performanceFeeYield: string;
  capitalAllocationYield: string;
  securitiesLendingYield: string;
  technologyRevenueBase: string;
  technologyRevenueGrowth: string;
  distributionFeeYield: string;
  administrativeOtherRevenueGrowth: string;
  otherRevenueGrowth: string;
  unmappedRevenueGrowth: string;
  operatingMargin: string;
  taxRate: string;
  depreciationPctRevenue: string;
  acquisitionAmortizationPctRevenue: string;
  capexPctRevenue: string;
  workingCapitalChangePctRevenue: string;
  costOfDebt: string;
  wacc: string;
  terminalGrowthRate: string;
}

export interface AssetManagerModelAssumptions {
  forecastYears: number;
  baseYear: number;
  asOfDate: string;
  marketReturnRate: number;
  netFlowRate: number;
  realizationsRate: number;
  acquisitionRate: number;
  fxChangeRate: number;
  scopeChangeRate: number;
  baseFeeYield: number;
  performanceFeeYield: number;
  capitalAllocationYield: number;
  securitiesLendingYield: number;
  technologyRevenueBase: number;
  technologyRevenueGrowth: number;
  distributionFeeYield: number;
  administrativeOtherRevenueGrowth: number;
  otherRevenueGrowth: number;
  unmappedRevenueGrowth: number;
  operatingMargin: number;
  taxRate: number;
  depreciationPctRevenue: number;
  acquisitionAmortizationPctRevenue: number;
  capexPctRevenue: number;
  workingCapitalChangePctRevenue: number;
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
  dilutedShares: number;
  cash: number;
  marketableSecurities: number;
  debt: number;
  nonControllingInterest: number;
  preferredEquity: number;
  assumptionSources: AssetManagerModelAssumptionSources;
}

export type IncompleteAssetManagerModelAssumptions = Omit<AssetManagerModelAssumptions, 'baseFeeYield'> & {
  baseFeeYield: null;
};

export interface AssetManagerForecastYear {
  year: number;
  beginningAum: number;
  marketReturnRate: number;
  marketChange: number;
  netFlowRate: number;
  netFlows: number;
  realizationsRate: number;
  realizations: number;
  acquisitionRate: number;
  acquisitions: number;
  fxChangeRate: number;
  fxChange: number;
  scopeChangeRate: number;
  scopeChange: number;
  endingAum: number;
  averageAum: number;
  baseFeeYield: number;
  baseFees: number;
  performanceFeeYield: number;
  performanceFees: number;
  capitalAllocationIncome: number;
  securitiesLendingRevenue: number;
  technologyRevenue: number;
  distributionRevenue: number;
  administrativeOtherRevenue: number;
  otherRevenue: number;
  unmappedRevenue: number;
  totalRevenue: number;
  operatingMargin: number;
  operatingExpenses: number;
  ebit: number;
  taxRate: number;
  cashTaxes: number;
  nopat: number;
  depreciation: number;
  acquisitionAmortization: number;
  capex: number;
  workingCapitalChange: number;
  fcff: number;
  discountFactor: number;
  presentValueFcff: number;
}

export interface AssetManagerModelResult extends DCFResults {
  valuationBasis: 'enterprise';
  wacc: number;
  terminalGrowthUsed: number;
  terminalFcff: number;
  assetManagerForecasts: AssetManagerForecastYear[];
}

interface ValidatedHistory {
  recent: AssetManagerHistoricalYear[];
  latest: AssetManagerHistoricalYear;
  latestAssetManager: AssetManagerCanonicalFinancials;
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`Asset-manager model assumption ${name} must be finite.`);
  return value;
}

function filedValue(line: CanonicalFinancialLine | undefined, name: string, year: number): number {
  return requireFiledValue(line, name, year, 'asset-manager');
}
function optionalFiledValue(line: CanonicalFinancialLine | undefined, name: string, year: number): number {
  if (!line) throw new Error(`FY${year} asset-manager input ${name} is unavailable.`);
  if (line.source === 'missing') return 0;
  if (line.source === 'not_applicable') {
    if (!line.method.trim() || !line.sources.length || line.sources.some((source) => !source.accession || !source.filed)) {
      throw new Error(`FY${year} asset-manager input ${name} is marked not applicable without filed provenance.`);
    }
    return 0;
  }
  return filedValue(line, name, year);
}

function optionalMovement(line: CanonicalFinancialLine, name: string, year: number): number {
  if (line.source === 'missing') return 0;
  if (line.source === 'not_applicable') return optionalFiledValue(line, name, year);
  return filedValue(line, name, year);
}

function validateHistory(history: AssetManagerHistoricalData): ValidatedHistory {
  if (history.annual.length < 3 || history.annual.length !== history.years.length) {
    throw new Error('Asset-manager DCF requires at least three aligned annual periods.');
  }
  const recent = history.annual.slice(-3);
  for (let index = 0; index < recent.length; index += 1) {
    const year = recent[index]?.year;
    if (!year || history.years.at(-3 + index) !== year) {
      throw new Error('Asset-manager DCF annual fiscal years do not align.');
    }
    if (index > 0 && year !== recent[index - 1]!.year + 1) {
      throw new Error('Asset-manager DCF requires three consecutive fiscal years.');
    }
    const item = recent[index]!;
    const manager = item.assetManager;
    const required = [
      ['beginning_aum', manager.beginning_aum],
      ['aum', manager.aum],
      ['average_aum', manager.average_aum],
      ['net_flows', manager.net_flows],
      ['market_change', manager.market_change],
      ['scope_change', manager.scope_change],
      ['base_fees', manager.base_fees],
      ['base_fee_yield', manager.base_fee_yield],
      ['performance_fees', manager.performance_fees],
      ['depreciation', manager.depreciation],
      ['working_capital_change', manager.working_capital_change],
      ['unmapped_revenue', manager.unmapped_revenue],
      ['revenue', item.revenue],
      ['EBIT', item.ebit],
      ['tax rate', item.taxRate],
      ['CapEx', item.capex],
    ] as const;
    const values = Object.fromEntries(required.map(([name, line]) => [name, filedValue(line, name, year)]));
    if (
      values.beginning_aum <= 0 || values.aum <= 0 || values.average_aum <= 0
      || values.base_fees <= 0 || values.base_fee_yield <= 0 || values.performance_fees < 0
      || values.depreciation < 0 || values.revenue <= 0 || values.ebit <= 0
      || values.tax_rate < 0 || values.tax_rate > 0.5 || values.capex < 0
    ) {
      throw new Error(`FY${year} asset-manager revenue, AUM, fee, tax, or capital-spending inputs are outside supported ranges.`);
    }

    const optionalRevenue = [
      ['capital allocation income', manager.capital_allocation_income],
      ['securities lending revenue', manager.securities_lending_revenue],
      ['technology revenue', manager.technology_revenue],
      ['distribution revenue', manager.distribution_revenue],
      ['administrative and other revenue', manager.administrative_other_revenue],
      ['other revenue', manager.other_revenue],
    ] as const;
    const mappedRevenue = optionalRevenue.reduce((sum, [name, line]) => sum + optionalMovement(line, name, year),
      values.base_fees + values.performance_fees + values.unmapped_revenue);
    const totalRevenue = filedValue(item.revenue, 'revenue', year);
    if (Math.abs(mappedRevenue - totalRevenue) > Math.max(1, Math.abs(totalRevenue) * 1e-9)) {
      throw new Error(`FY${year} mapped asset-manager revenue does not reconcile to consolidated revenue.`);
    }

    const optionalChanges = [
      ['realizations', manager.realizations],
      ['acquisitions', manager.acquisitions],
      ['FX change', manager.fx_change],
    ] as const;
    const changes = optionalChanges.reduce((sum, [name, line]) => sum + optionalMovement(line, name, year),
      values.beginning_aum + values.net_flows + values.market_change + values.scope_change);
    if (Math.abs(changes - values.aum) > Math.max(1, values.aum * 1e-9)) {
      throw new Error(`FY${year} filed AUM drivers do not reconcile to ending AUM.`);
    }
  }

  const latest = recent.at(-1);
  if (!latest) throw new Error('Asset-manager history is empty.');
  return {recent, latest, latestAssetManager: latest.assetManager};
}

function validateAssumptions(assumptions: AssetManagerModelAssumptions): void {
  if (assumptions.forecastYears !== 5) throw new Error('Asset-manager DCF requires a five-year forecast horizon.');
  for (const [name, value] of [
    ['marketReturnRate', assumptions.marketReturnRate], ['netFlowRate', assumptions.netFlowRate],
    ['realizationsRate', assumptions.realizationsRate], ['acquisitionRate', assumptions.acquisitionRate],
    ['fxChangeRate', assumptions.fxChangeRate], ['scopeChangeRate', assumptions.scopeChangeRate],
  ] as const) {
    finite(value, name);
    if (value <= -1 || value > 2) throw new Error(`Asset-manager ${name} must be greater than -100% and no more than 200%.`);
  }
  for (const [name, value] of [
    ['baseFeeYield', assumptions.baseFeeYield], ['performanceFeeYield', assumptions.performanceFeeYield],
    ['capitalAllocationYield', assumptions.capitalAllocationYield], ['securitiesLendingYield', assumptions.securitiesLendingYield],
    ['distributionFeeYield', assumptions.distributionFeeYield], ['depreciationPctRevenue', assumptions.depreciationPctRevenue],
    ['acquisitionAmortizationPctRevenue', assumptions.acquisitionAmortizationPctRevenue], ['capexPctRevenue', assumptions.capexPctRevenue],
  ] as const) {
    finite(value, name);
    if (value < 0 || value > 1) throw new Error(`Asset-manager ${name} must be between 0% and 100%.`);
  }
  finite(assumptions.technologyRevenueBase, 'technologyRevenueBase');
  if (assumptions.technologyRevenueBase < 0) throw new Error('Asset-manager technology revenue base must be non-negative.');
  for (const [name, value] of [
    ['technologyRevenueGrowth', assumptions.technologyRevenueGrowth],
    ['administrativeOtherRevenueGrowth', assumptions.administrativeOtherRevenueGrowth],
    ['otherRevenueGrowth', assumptions.otherRevenueGrowth],
    ['unmappedRevenueGrowth', assumptions.unmappedRevenueGrowth],
  ] as const) {
    finite(value, name);
    if (value <= -1 || value > 2) throw new Error(`Asset-manager ${name} must be greater than -100% and no more than 200%.`);
  }
  finite(assumptions.operatingMargin, 'operatingMargin');
  if (assumptions.operatingMargin <= 0 || assumptions.operatingMargin > 1) {
    throw new Error('Asset-manager operating margin must be above 0% and no more than 100%.');
  }
  finite(assumptions.taxRate, 'taxRate');
  if (assumptions.taxRate < 0 || assumptions.taxRate > 0.5) throw new Error('Asset-manager cash tax rate must be between 0% and 50%.');
  finite(assumptions.workingCapitalChangePctRevenue, 'workingCapitalChangePctRevenue');
  if (Math.abs(assumptions.workingCapitalChangePctRevenue) > 1) {
    throw new Error('Asset-manager working-capital investment as a percent of revenue must be between -100% and 100%.');
  }
  if (assumptions.wacc < 0.02 || assumptions.wacc > 0.4 || assumptions.terminalGrowthRate < 0
    || assumptions.terminalGrowthRate > 0.08 || assumptions.terminalGrowthRate >= assumptions.wacc) {
    throw new Error('Asset-manager valuation requires terminal growth between 0% and 8% and below a supported WACC.');
  }
  for (const [name, value] of [
    ['riskFreeRate', assumptions.riskFreeRate], ['equityRiskPremium', assumptions.equityRiskPremium],
    ['beta', assumptions.beta], ['costOfDebt', assumptions.costOfDebt], ['debtWeight', assumptions.debtWeight],
    ['equityWeight', assumptions.equityWeight], ['currentPrice', assumptions.currentPrice],
    ['marketCapitalization', assumptions.marketCapitalization], ['dilutedShares', assumptions.dilutedShares],
    ['cash', assumptions.cash], ['marketableSecurities', assumptions.marketableSecurities], ['debt', assumptions.debt],
    ['nonControllingInterest', assumptions.nonControllingInterest], ['preferredEquity', assumptions.preferredEquity],
  ] as const) finite(value, name);
  if (assumptions.riskFreeRate <= 0 || assumptions.equityRiskPremium <= 0 || assumptions.beta <= 0
    || assumptions.costOfDebt < 0 || assumptions.debtWeight < 0 || assumptions.equityWeight <= 0
    || assumptions.currentPrice <= 0 || assumptions.marketCapitalization <= 0 || assumptions.dilutedShares <= 0
    || assumptions.cash < 0 || assumptions.marketableSecurities < 0 || assumptions.debt < 0
    || assumptions.nonControllingInterest < 0 || assumptions.preferredEquity < 0) {
    throw new Error('Asset-manager valuation requires positive market inputs and non-negative bridge claims.');
  }
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(assumptions.asOfDate)) {
    throw new Error('Asset-manager valuation requires a dated market context.');
  }
  const assumptionSources = Object.values(assumptions.assumptionSources);
  if (assumptionSources.some((source) => !source.trim() || /\b(default|stale|unavailable)\b/i.test(source))) {
    throw new Error('Asset-manager assumptions require current filed sources or explicit analyst inputs.');
  }
}

function grow(value: number, rate: number, name: string): number {
  const forecast = value * (1 + rate);
  if (!Number.isFinite(forecast) || forecast < 0) throw new Error(`${name} forecast cannot be negative or non-finite.`);
  return forecast;
}

export function calculateAssetManagerValuation(
  history: AssetManagerHistoricalData,
  assumptions: AssetManagerModelAssumptions,
): AssetManagerModelResult {
  const validated = validateHistory(history);
  validateAssumptions(assumptions);
  const latest = validated.latest;
  const latestManager = validated.latestAssetManager;
  let beginningAum = filedValue(latestManager.aum, 'ending AUM', latest.year);
  let priorTechnology = ['missing', 'not_applicable'].includes(latestManager.technology_revenue.source)
    ? assumptions.technologyRevenueBase
    : optionalFiledValue(latestManager.technology_revenue, 'technology revenue', latest.year);
  let priorAdministrativeOther = optionalFiledValue(latestManager.administrative_other_revenue, 'administrative and other revenue', latest.year);
  let priorOtherRevenue = optionalFiledValue(latestManager.other_revenue, 'other revenue', latest.year);
  let priorUnmappedRevenue = filedValue(latestManager.unmapped_revenue, 'unmapped revenue reconciliation', latest.year);
  const assetManagerForecasts: AssetManagerForecastYear[] = [];
  let presentValueForecastFcff = 0;

  for (let index = 1; index <= assumptions.forecastYears; index += 1) {
    const marketChange = beginningAum * assumptions.marketReturnRate;
    const netFlows = beginningAum * assumptions.netFlowRate;
    const realizations = beginningAum * assumptions.realizationsRate;
    const acquisitions = beginningAum * assumptions.acquisitionRate;
    const fxChange = beginningAum * assumptions.fxChangeRate;
    const scopeChange = beginningAum * assumptions.scopeChangeRate;
    const endingAum = beginningAum + marketChange + netFlows + realizations + acquisitions + fxChange + scopeChange;
    if (!Number.isFinite(endingAum) || endingAum <= 0) throw new Error(`FY${latest.year + index} projected ending AUM is not positive.`);
    const averageAum = (beginningAum + endingAum) / 2;
    const baseFees = averageAum * assumptions.baseFeeYield;
    const performanceFees = averageAum * assumptions.performanceFeeYield;
    const capitalAllocationIncome = averageAum * assumptions.capitalAllocationYield;
    const securitiesLendingRevenue = averageAum * assumptions.securitiesLendingYield;
    const technologyRevenue = grow(priorTechnology, assumptions.technologyRevenueGrowth, 'technology revenue');
    const distributionRevenue = averageAum * assumptions.distributionFeeYield;
    const administrativeOtherRevenue = grow(priorAdministrativeOther, assumptions.administrativeOtherRevenueGrowth, 'administrative and other revenue');
    const otherRevenue = grow(priorOtherRevenue, assumptions.otherRevenueGrowth, 'other revenue');
    const unmappedRevenue = grow(priorUnmappedRevenue, assumptions.unmappedRevenueGrowth, 'unmapped revenue');
    const totalRevenue = baseFees + performanceFees + capitalAllocationIncome + securitiesLendingRevenue
      + technologyRevenue + distributionRevenue + administrativeOtherRevenue + otherRevenue + unmappedRevenue;
    if (!Number.isFinite(totalRevenue) || totalRevenue <= 0) throw new Error(`FY${latest.year + index} forecast revenue is not positive.`);
    const operatingExpenses = totalRevenue * (1 - assumptions.operatingMargin);
    const ebit = totalRevenue * assumptions.operatingMargin;
    const cashTaxes = ebit * assumptions.taxRate;
    const nopat = ebit - cashTaxes;
    const depreciation = totalRevenue * assumptions.depreciationPctRevenue;
    const acquisitionAmortization = totalRevenue * assumptions.acquisitionAmortizationPctRevenue;
    const capex = totalRevenue * assumptions.capexPctRevenue;
    const workingCapitalChange = totalRevenue * assumptions.workingCapitalChangePctRevenue;
    const fcff = nopat + depreciation + acquisitionAmortization - capex - workingCapitalChange;
    const discountFactor = 1 / Math.pow(1 + assumptions.wacc, index);
    const presentValueFcff = fcff * discountFactor;
    if (![operatingExpenses, ebit, cashTaxes, nopat, depreciation, acquisitionAmortization, capex,
      workingCapitalChange, fcff, discountFactor, presentValueFcff].every(Number.isFinite)) {
      throw new Error(`FY${latest.year + index} asset-manager forecast contains a non-finite calculation.`);
    }
    presentValueForecastFcff += presentValueFcff;
    assetManagerForecasts.push({
      year: latest.year + index,
      beginningAum,
      marketReturnRate: assumptions.marketReturnRate,
      marketChange,
      netFlowRate: assumptions.netFlowRate,
      netFlows,
      realizationsRate: assumptions.realizationsRate,
      realizations,
      acquisitionRate: assumptions.acquisitionRate,
      acquisitions,
      fxChangeRate: assumptions.fxChangeRate,
      fxChange,
      scopeChangeRate: assumptions.scopeChangeRate,
      scopeChange,
      endingAum,
      averageAum,
      baseFeeYield: assumptions.baseFeeYield,
      baseFees,
      performanceFeeYield: assumptions.performanceFeeYield,
      performanceFees,
      capitalAllocationIncome,
      securitiesLendingRevenue,
      technologyRevenue,
      distributionRevenue,
      administrativeOtherRevenue,
      otherRevenue,
      unmappedRevenue,
      totalRevenue,
      operatingMargin: assumptions.operatingMargin,
      operatingExpenses,
      ebit,
      taxRate: assumptions.taxRate,
      cashTaxes,
      nopat,
      depreciation,
      acquisitionAmortization,
      capex,
      workingCapitalChange,
      fcff,
      discountFactor,
      presentValueFcff,
    });
    beginningAum = endingAum;
    priorTechnology = technologyRevenue;
    priorAdministrativeOther = administrativeOtherRevenue;
    priorOtherRevenue = otherRevenue;
    priorUnmappedRevenue = unmappedRevenue;
  }

  const finalForecast = assetManagerForecasts.at(-1);
  if (!finalForecast) throw new Error('Asset-manager forecast is unavailable.');
  if (finalForecast.fcff <= 0) throw new Error('Asset-manager Gordon-growth valuation requires positive terminal FCFF.');
  const terminalValue = finalForecast.fcff * (1 + assumptions.terminalGrowthRate)
    / (assumptions.wacc - assumptions.terminalGrowthRate);
  const pvTerminalValue = terminalValue / Math.pow(1 + assumptions.wacc, assumptions.forecastYears);
  const enterpriseValue = presentValueForecastFcff + pvTerminalValue;
  const equityValue = enterpriseValue + assumptions.cash + assumptions.marketableSecurities - assumptions.debt
    - assumptions.nonControllingInterest - assumptions.preferredEquity;
  if (!Number.isFinite(enterpriseValue) || enterpriseValue <= 0 || !Number.isFinite(equityValue) || equityValue <= 0) {
    throw new Error('Asset-manager DCF produces non-positive enterprise or common-equity value.');
  }
  const impliedSharePrice = equityValue / assumptions.dilutedShares;

  return {
    forecasts: [],
    terminalValue,
    pvTerminalValue,
    enterpriseValue,
    equityValue,
    impliedSharePrice,
    shareCount: assumptions.dilutedShares,
    currentPrice: assumptions.currentPrice,
    upside: impliedSharePrice / assumptions.currentPrice - 1,
    terminalValueGordon: terminalValue,
    terminalValueExitMultiple: 0,
    tvDivergenceFlag: false,
    avgROIC: 0,
    valueCreationFlag: impliedSharePrice > assumptions.currentPrice,
    confidenceScore: 0.75,
    confidenceRank: 'Medium',
    companyType: 'asset_manager',
    preferredModel: 'asset_manager_aum_dcf',
    isValuationSupported: true,
    isSensitivitySupported: true,
    valuationBasis: 'enterprise',
    wacc: assumptions.wacc,
    terminalGrowthUsed: assumptions.terminalGrowthRate,
    terminalFcff: finalForecast.fcff,
    assetManagerForecasts,
  };
}
