import type {DCFResults} from '@/core/types';
import type {LifeInsuranceFilingFact} from '@/core/types/native';

export const LIFE_INSURANCE_FORECAST_YEARS = 5;

export type LifeInsuranceEarningsBasis =
  | 'after_tax_adjusted_earnings_available_to_common'
  | 'pre_tax_adjusted_operating_income';

export type LifeInsuranceSegmentFact = LifeInsuranceFilingFact;

export interface LifeInsuranceSegmentAssumption {
  segment: string;
  baseEarnings: number;
  annualGrowth: number[];
}

export interface LifeInsuranceForecastAssumptions {
  earningsBasis: LifeInsuranceEarningsBasis;
  normalizedTaxRate?: number;
  segments: LifeInsuranceSegmentAssumption[];
}

export interface LifeInsuranceCapitalSchedule {
  netCapitalAdditions: number[];
  permittedUpstreamDividends: number[];
}

export interface LifeInsuranceDcfAssumptions extends LifeInsuranceForecastAssumptions {
  ticker: 'MET' | 'PRU';
  baseYear: number;
  forecastYears: 5;
  capitalSchedule: LifeInsuranceCapitalSchedule;
  riskFreeRate: number;
  equityRiskPremium: number;
  beta: number;
  terminalGrowthRate: number;
  marketDataAsOfDate: string;
  currentPrice: number;
  dilutedSharesOutstanding: number;
  parentCash: number;
  parentCashReserve: number;
  parentDebt: number;
  preferredEquity: number;
  nonControllingInterest: number;
}

export interface LifeInsuranceForecastYear {
  year: number;
  adjustedEarningsBeforeTax: number | null;
  adjustedEarningsAfterTax: number;
  netCapitalAddition: number;
  cashAvailableBeforeUpstreamLimit: number;
  permittedUpstreamDividends: number;
  distributableEarnings: number;
  discountFactor: number;
  presentValueOfDistributableEarnings: number;
}

export interface LifeInsuranceDcfResult extends DCFResults {
  costOfEquity: number;
  terminalGrowthUsed: number;
  terminalDistributableEarnings: number;
  lifeInsuranceForecasts: LifeInsuranceForecastYear[];
}

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`Life-insurance assumption ${label} must be finite.`);
  return value;
}

function requireRange(value: number, label: string, minimum: number, maximum: number): number {
  const checked = requireFinite(value, label);
  if (checked < minimum || checked > maximum) {
    throw new Error(`Life-insurance assumption ${label} must be between ${minimum} and ${maximum}.`);
  }
  return checked;
}

function validateAssumptions(assumptions: LifeInsuranceDcfAssumptions): number {
  if (!Number.isInteger(assumptions.baseYear) || assumptions.forecastYears !== LIFE_INSURANCE_FORECAST_YEARS) {
    throw new Error(`Life-insurance DCF requires an integer base year and ${LIFE_INSURANCE_FORECAST_YEARS} forecast years.`);
  }
  if (assumptions.ticker !== 'MET' && assumptions.ticker !== 'PRU') {
    throw new Error('The first life-insurance DCF source contract supports only MET and PRU.');
  }
  if (assumptions.segments.length === 0 || assumptions.segments.some((segment) => !segment.segment.trim())) {
    throw new Error('Life-insurance DCF requires identified earnings segments.');
  }
  if (new Set(assumptions.segments.map((segment) => segment.segment)).size !== assumptions.segments.length) {
    throw new Error('Life-insurance segment names must be unique.');
  }
  if (assumptions.segments.some((segment) => segment.annualGrowth.length !== LIFE_INSURANCE_FORECAST_YEARS)) {
    throw new Error(`Each life-insurance segment requires ${LIFE_INSURANCE_FORECAST_YEARS} growth assumptions.`);
  }
  if (assumptions.capitalSchedule.netCapitalAdditions.length !== LIFE_INSURANCE_FORECAST_YEARS
    || assumptions.capitalSchedule.permittedUpstreamDividends.length !== LIFE_INSURANCE_FORECAST_YEARS) {
    throw new Error(`Life-insurance capital and upstream-capacity inputs require ${LIFE_INSURANCE_FORECAST_YEARS} years.`);
  }
  if (assumptions.earningsBasis === 'pre_tax_adjusted_operating_income' && assumptions.normalizedTaxRate === undefined) {
    throw new Error('PRU pre-tax adjusted operating income requires a normalized tax-rate input.');
  }
  if (assumptions.earningsBasis === 'after_tax_adjusted_earnings_available_to_common' && assumptions.normalizedTaxRate !== undefined) {
    throw new Error('MET adjusted earnings are after tax and must not be taxed again.');
  }
  if (assumptions.normalizedTaxRate !== undefined) requireRange(assumptions.normalizedTaxRate, 'normalized tax rate', 0, 0.6);
  for (const segment of assumptions.segments) {
    requireRange(segment.baseEarnings, `${segment.segment} base earnings`, -1e15, 1e15);
    for (const [index, growth] of segment.annualGrowth.entries()) {
      requireRange(growth, `${segment.segment} FY${assumptions.baseYear + index + 1} growth`, -0.95, 2);
    }
  }
  assumptions.capitalSchedule.netCapitalAdditions.forEach((value, index) => requireRange(
    value, `FY${assumptions.baseYear + index + 1} net capital addition`, -1e15, 1e15,
  ));
  assumptions.capitalSchedule.permittedUpstreamDividends.forEach((value, index) => requireRange(
    value, `FY${assumptions.baseYear + index + 1} permitted upstream dividends`, 0, 1e15,
  ));
  const riskFreeRate = requireRange(assumptions.riskFreeRate, 'risk-free rate', 0.001, 0.3);
  const equityRiskPremium = requireRange(assumptions.equityRiskPremium, 'equity-risk premium', 0.001, 0.3);
  const beta = requireRange(assumptions.beta, 'beta', 0.01, 5);
  requireRange(assumptions.currentPrice, 'current share price', 0.01, 1e6);
  requireRange(assumptions.dilutedSharesOutstanding, 'diluted shares', 1, 1e15);
  requireRange(assumptions.parentCash, 'holding-company cash', 0, 1e15);
  requireRange(assumptions.parentCashReserve, 'holding-company cash reserve', 0, 1e15);
  if (assumptions.parentCash < assumptions.parentCashReserve) {
    throw new Error('Life-insurance parent cash must meet or exceed its reserve.');
  }
  requireRange(assumptions.parentDebt, 'parent-company debt', 0, 1e15);
  requireRange(assumptions.preferredEquity, 'preferred equity', 0, 1e15);
  requireRange(assumptions.nonControllingInterest, 'noncontrolling interest', 0, 1e15);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(assumptions.marketDataAsOfDate)) {
    throw new Error('Life-insurance DCF requires a dated market context.');
  }
  const costOfEquity = riskFreeRate + beta * equityRiskPremium;
  if (!Number.isFinite(costOfEquity) || costOfEquity < 0.02 || costOfEquity > 0.5) {
    throw new Error('Life-insurance cost of equity must be between 2% and 50%.');
  }
  const maximumTerminalGrowth = Math.min(0.1, costOfEquity - 0.005);
  requireRange(assumptions.terminalGrowthRate, 'terminal growth', 0, maximumTerminalGrowth);
  return costOfEquity;
}

export function calculateLifeInsuranceDistributableEarnings(
  assumptions: LifeInsuranceDcfAssumptions,
): LifeInsuranceDcfResult {
  const costOfEquity = validateAssumptions(assumptions);
  const forecasts: LifeInsuranceForecastYear[] = [];
  const segmentEarnings = assumptions.segments.map((segment) => segment.baseEarnings);

  for (let index = 0; index < LIFE_INSURANCE_FORECAST_YEARS; index += 1) {
    const year = assumptions.baseYear + index + 1;
    const reportedAdjustedEarnings = assumptions.segments.reduce((sum, segment, segmentIndex) => {
      const next = segmentEarnings[segmentIndex]! * (1 + segment.annualGrowth[index]!);
      segmentEarnings[segmentIndex] = next;
      return sum + next;
    }, 0);
    const adjustedEarningsBeforeTax = assumptions.earningsBasis === 'pre_tax_adjusted_operating_income'
      ? reportedAdjustedEarnings
      : null;
    const adjustedEarningsAfterTax = assumptions.earningsBasis === 'after_tax_adjusted_earnings_available_to_common'
      ? reportedAdjustedEarnings
      : reportedAdjustedEarnings * (1 - assumptions.normalizedTaxRate!);
    const netCapitalAddition = assumptions.capitalSchedule.netCapitalAdditions[index]!;
    const cashAvailableBeforeUpstreamLimit = adjustedEarningsAfterTax - netCapitalAddition;
    const permittedUpstreamDividends = assumptions.capitalSchedule.permittedUpstreamDividends[index]!;
    const distributableEarnings = cashAvailableBeforeUpstreamLimit < 0
      ? cashAvailableBeforeUpstreamLimit
      : Math.min(cashAvailableBeforeUpstreamLimit, permittedUpstreamDividends);
    const discountFactor = 1 / (1 + costOfEquity) ** (index + 1);
    forecasts.push({
      year,
      adjustedEarningsBeforeTax,
      adjustedEarningsAfterTax,
      netCapitalAddition,
      cashAvailableBeforeUpstreamLimit,
      permittedUpstreamDividends,
      distributableEarnings,
      discountFactor,
      presentValueOfDistributableEarnings: distributableEarnings * discountFactor,
    });
  }

  const terminalDistributableEarnings = forecasts.at(-1)!.distributableEarnings;
  if (terminalDistributableEarnings <= 0) {
    throw new Error('Life-insurance DCF requires positive terminal distributable earnings.');
  }
  const terminalValue = terminalDistributableEarnings * (1 + assumptions.terminalGrowthRate)
    / (costOfEquity - assumptions.terminalGrowthRate);
  const pvTerminalValue = terminalValue / (1 + costOfEquity) ** LIFE_INSURANCE_FORECAST_YEARS;
  const pvForecastDistributableEarnings = forecasts.reduce((sum, forecast) => sum + forecast.presentValueOfDistributableEarnings, 0);
  const excessParentCash = assumptions.parentCash - assumptions.parentCashReserve;
  const equityValue = pvForecastDistributableEarnings + pvTerminalValue + excessParentCash - assumptions.parentDebt
    - assumptions.preferredEquity - assumptions.nonControllingInterest;
  const impliedSharePrice = equityValue / assumptions.dilutedSharesOutstanding;
  return {
    forecasts: [],
    lifeInsuranceForecasts: forecasts,
    costOfEquity,
    terminalGrowthUsed: assumptions.terminalGrowthRate,
    terminalDistributableEarnings,
    terminalValue,
    pvTerminalValue,
    enterpriseValue: null,
    equityValue,
    impliedSharePrice,
    shareCount: assumptions.dilutedSharesOutstanding,
    currentPrice: assumptions.currentPrice,
    upside: impliedSharePrice / assumptions.currentPrice - 1,
    terminalValueGordon: terminalValue,
    terminalValueExitMultiple: 0,
    tvDivergenceFlag: false,
    avgROIC: 0,
    valueCreationFlag: false,
    confidenceScore: 0.35,
    confidenceRank: 'Low',
    companyType: 'insurance',
    preferredModel: 'life_insurer_distributable_earnings_dcf',
    isValuationSupported: true,
    isSensitivitySupported: true,
    valuationBasis: 'equity',
    modelWarning: 'Life-insurance common-equity DCF based on issuer-specific adjusted earnings less statutory-capital retention and permitted upstream dividends; capital and distribution assumptions remain company- and jurisdiction-specific.',
  };
}
