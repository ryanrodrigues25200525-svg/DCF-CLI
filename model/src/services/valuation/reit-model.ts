import type { DCFResults, ReitHistoricalData } from '@/core/types';
import type { CanonicalFinancialLine } from '@/core/types/native';
import { requireFiledValue } from '@/services/valuation/source-guards';

export interface ReitAssumptionSources {
  sameStoreNoiGrowth: string;
  targetOccupancy: string;
  recurringCapexRatio: string;
  payoutRatio: string;
  terminalGrowthRate: string;
  navCapRate: string;
}

export interface ReitModelAssumptions {
  forecastYears: number;
  sameStoreNoiGrowth: number;
  targetOccupancy: number;
  recurringCapexRatio: number;
  payoutRatio: number;
  terminalGrowthRate: number;
  navCapRate: number;
  riskFreeRate: number;
  riskFreeRateSource: string;
  equityRiskPremium: number;
  equityRiskPremiumSource: string;
  beta: number;
  betaSource: string;
  marketCapitalization: number;
  marketDataAsOfDate: string;
  currentPrice: number;
  dilutedSharesOutstanding: number;
  assumptionSources: ReitAssumptionSources;
}

export type IncompleteReitModelAssumptions = Omit<ReitModelAssumptions, 'sameStoreNoiGrowth'> & {
  sameStoreNoiGrowth: null;
};

export interface ReitForecastYear {
  year: number;
  openingSameStoreNoi: number;
  sameStoreNoi: number;
  occupancy: number;
  coreFfo: number;
  recurringCapex: number;
  analystAffo: number;
  commonDistributions: number;
  distributionCoverage: number;
  presentValueAffo: number;
}

export interface ReitModelResult extends DCFResults {
  valuationBasis: 'equity';
  enterpriseValue: null;
  costOfEquity: number;
  terminalGrowthUsed: number;
  terminalAffo: number;
  navCapRateUsed: number;
  navValue: number;
  navPerShare: number;
  reitForecasts: ReitForecastYear[];
}

const REQUIRED_REIT_LINES = [
  'nareit_ffo', 'core_ffo', 'recurring_capex', 'analyst_affo',
  'same_store_noi_net_effective', 'real_estate_segment_noi',
] as const;

function requireFinite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`REIT model assumption ${name} must be finite.`);
  return value;
}

function filedValue(line: CanonicalFinancialLine | undefined, name: string, year: number): number {
  return requireFiledValue(line, name, year, 'REIT');
}
function validateHistory(history: ReitHistoricalData): {
  year: number;
  coreFfo: number;
  analystAffo: number;
  sameStoreNoi: number;
  realEstateNoi: number;
  occupancy: number;
  cash: number;
  longTermDebt: number;
  preferredEquity: number;
  nonControllingInterest: number;
  shares: number;
  distributions: number;
} {
  if (history.annual.length < 3 || history.annual.some((item, index) => item.year !== history.years[index])) {
    throw new Error('REIT model requires three ordered, filed fiscal years.');
  }
  const latest = history.annual.at(-1);
  if (!latest) throw new Error('REIT history is empty.');
  const values: Record<string, number> = {};
  for (const field of REQUIRED_REIT_LINES) {
    values[field] = filedValue(latest.reit[field], field, latest.year);
  }
  for (const annual of history.annual.slice(-3)) {
    for (const field of ['nareit_ffo', 'core_ffo', 'recurring_capex', 'analyst_affo', 'same_store_noi_net_effective'] as const) {
      filedValue(annual.reit[field], field, annual.year);
    }
  }
  values.occupancy = filedValue(latest.reit.occupancy, 'occupancy', latest.year);
  values.distributions = filedValue(latest.reit.common_distributions, 'common_distributions', latest.year);
  values.cash = filedValue(latest.cash, 'cash', latest.year);
  values.longTermDebt = filedValue(latest.longTermDebt, 'long_term_debt', latest.year);
  values.preferredEquity = filedValue(latest.preferredEquity, 'preferred_equity', latest.year);
  values.nonControllingInterest = filedValue(latest.nonControllingInterest, 'non_controlling_interest', latest.year);
  values.shares = filedValue(latest.dilutedShares, 'diluted_shares', latest.year);

  if (values.core_ffo <= 0 || values.analyst_affo <= 0 || values.same_store_noi_net_effective <= 0
    || values.real_estate_segment_noi <= 0 || values.shares <= 0 || values.longTermDebt < 0
    || values.cash < 0 || values.preferredEquity < 0 || values.nonControllingInterest < 0
    || values.occupancy <= 0 || values.occupancy >= 1) {
    throw new Error(`FY${latest.year} REIT operating, share, or balance-sheet inputs are outside supported ranges.`);
  }
  return {
    year: latest.year,
    coreFfo: values.core_ffo,
    analystAffo: values.analyst_affo,
    sameStoreNoi: values.same_store_noi_net_effective,
    realEstateNoi: values.real_estate_segment_noi,
    occupancy: values.occupancy,
    cash: values.cash,
    longTermDebt: values.longTermDebt,
    preferredEquity: values.preferredEquity,
    nonControllingInterest: values.nonControllingInterest,
    shares: values.shares,
    distributions: values.distributions,
  };
}

function validateAssumptions(assumptions: ReitModelAssumptions): number {
  if (assumptions.forecastYears !== 5) throw new Error('REIT model uses a five-year forecast horizon.');
  for (const field of ['sameStoreNoiGrowth'] as const) {
    requireFinite(assumptions[field], field);
    if (assumptions[field] <= -1) throw new Error(`REIT model assumption ${field} must be greater than -100%.`);
  }
  for (const [field, value] of [
    ['recurringCapexRatio', assumptions.recurringCapexRatio],
    ['terminalGrowthRate', assumptions.terminalGrowthRate],
    ['navCapRate', assumptions.navCapRate],
    ['riskFreeRate', assumptions.riskFreeRate],
    ['equityRiskPremium', assumptions.equityRiskPremium],
  ] as const) {
    requireFinite(value, field);
    if (value < 0 || value >= 1) throw new Error(`REIT model assumption ${field} must be between 0% and 100%.`);
  }
  requireFinite(assumptions.targetOccupancy, 'targetOccupancy');
  if (assumptions.targetOccupancy <= 0 || assumptions.targetOccupancy >= 1) {
    throw new Error('REIT target occupancy must be greater than 0% and below 100%.');
  }
  if (assumptions.recurringCapexRatio >= 1) throw new Error('REIT recurring-capex ratio must be below 100% of Core FFO.');
  requireFinite(assumptions.payoutRatio, 'payoutRatio');
  if (assumptions.payoutRatio < 0) throw new Error('REIT common distribution payout ratio must be non-negative.');
  requireFinite(assumptions.beta, 'beta');
  requireFinite(assumptions.currentPrice, 'currentPrice');
  requireFinite(assumptions.dilutedSharesOutstanding, 'dilutedSharesOutstanding');
  if (assumptions.beta <= 0 || assumptions.currentPrice <= 0 || assumptions.dilutedSharesOutstanding <= 0) {
    throw new Error('REIT valuation requires positive beta, market price, and diluted shares.');
  }
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(assumptions.marketDataAsOfDate)) {
    throw new Error('REIT valuation requires a dated current market context.');
  }
  for (const source of [
    assumptions.riskFreeRateSource,
    assumptions.equityRiskPremiumSource,
    assumptions.betaSource,
    ...Object.values(assumptions.assumptionSources),
  ]) {
    if (!source.trim() || /\b(default|stale|unavailable)\b/i.test(source)) {
      throw new Error('REIT assumptions require current sources or explicit analyst inputs.');
    }
  }
  const costOfEquity = assumptions.riskFreeRate + assumptions.beta * assumptions.equityRiskPremium;
  if (!Number.isFinite(costOfEquity) || costOfEquity <= assumptions.terminalGrowthRate) {
    throw new Error('REIT terminal AFFO growth must be below the sourced cost of equity.');
  }
  return costOfEquity;
}

export function calculateReitValuation(
  history: ReitHistoricalData,
  assumptions: ReitModelAssumptions,
): ReitModelResult {
  const costOfEquity = validateAssumptions(assumptions);
  const latest = validateHistory(history);
  const reitForecasts: ReitForecastYear[] = [];
  let openingSameStoreNoi = latest.sameStoreNoi;
  let coreFfo = latest.coreFfo;
  let pvForecastAffo = 0;

  for (let index = 1; index <= assumptions.forecastYears; index += 1) {
    const openingOccupancy = index === 1 ? latest.occupancy : assumptions.targetOccupancy;
    const occupancyAdjustment = assumptions.targetOccupancy / openingOccupancy;
    const sameStoreNoi = openingSameStoreNoi * (1 + assumptions.sameStoreNoiGrowth) * occupancyAdjustment;
    coreFfo *= (1 + assumptions.sameStoreNoiGrowth) * occupancyAdjustment;
    const recurringCapex = coreFfo * assumptions.recurringCapexRatio;
    const analystAffo = coreFfo - recurringCapex;
    if (analystAffo <= 0) throw new Error(`FY${latest.year + index} projected analyst AFFO is not positive.`);
    const commonDistributions = analystAffo * assumptions.payoutRatio;
    const distributionCoverage = commonDistributions > 0 ? analystAffo / commonDistributions : 0;
    const presentValueAffo = analystAffo / Math.pow(1 + costOfEquity, index);
    pvForecastAffo += presentValueAffo;
    reitForecasts.push({
      year: latest.year + index,
      openingSameStoreNoi,
      sameStoreNoi,
      occupancy: assumptions.targetOccupancy,
      coreFfo,
      recurringCapex,
      analystAffo,
      commonDistributions,
      distributionCoverage,
      presentValueAffo,
    });
    openingSameStoreNoi = sameStoreNoi;
  }

  const finalForecast = reitForecasts.at(-1);
  if (!finalForecast) throw new Error('REIT forecast is unavailable.');
  const terminalAffo = finalForecast.analystAffo * (1 + assumptions.terminalGrowthRate)
    / (costOfEquity - assumptions.terminalGrowthRate);
  const pvTerminalAffo = terminalAffo / Math.pow(1 + costOfEquity, assumptions.forecastYears);
  const equityValue = Math.max(0, pvForecastAffo + pvTerminalAffo);
  const impliedSharePrice = equityValue / assumptions.dilutedSharesOutstanding;
  const navValue = latest.realEstateNoi / assumptions.navCapRate + latest.cash
    - latest.longTermDebt - latest.preferredEquity - latest.nonControllingInterest;
  const navPerShare = navValue / assumptions.dilutedSharesOutstanding;

  return {
    forecasts: [],
    terminalValue: terminalAffo,
    pvTerminalValue: pvTerminalAffo,
    enterpriseValue: null,
    equityValue,
    impliedSharePrice,
    shareCount: assumptions.dilutedSharesOutstanding,
    currentPrice: assumptions.currentPrice,
    upside: impliedSharePrice / assumptions.currentPrice - 1,
    terminalValueGordon: terminalAffo,
    terminalValueExitMultiple: 0,
    tvDivergenceFlag: false,
    avgROIC: 0,
    valueCreationFlag: impliedSharePrice > assumptions.currentPrice,
    confidenceScore: 0.8,
    confidenceRank: 'Medium',
    companyType: 'reit',
    preferredModel: 'reit_affo',
    isValuationSupported: true,
    isSensitivitySupported: true,
    valuationBasis: 'equity',
    costOfEquity,
    terminalGrowthUsed: assumptions.terminalGrowthRate,
    terminalAffo,
    navCapRateUsed: assumptions.navCapRate,
    navValue,
    navPerShare,
    reitForecasts,
  };
}
