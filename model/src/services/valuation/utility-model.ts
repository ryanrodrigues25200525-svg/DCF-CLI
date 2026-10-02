import type {DCFResults} from '@/core/types';

export const UTILITY_FORECAST_YEARS = 5;

export interface UtilityModelAssumptions {
  baseYear: number;
  baseRateBase: number;
  authorizedEquityRatio: number;
  allowedRoe: number;
  rateBaseAdditions: number[];
  rateBaseDepreciation: number[];
  dividendPayoutRatio: number;
  riskFreeRate: number;
  equityRiskPremium: number;
  beta: number;
  terminalGrowthRate: number;
  currentPrice: number;
  dilutedShares: number;
}

export interface UtilityForecastYear {
  year: number;
  openingRateBase: number;
  additions: number;
  depreciationAndRetirements: number;
  closingRateBase: number;
  averageRateBase: number;
  allowedEquityEarnings: number;
  commonDividends: number;
  discountFactor: number;
  presentValueOfDividends: number;
}

export type UtilityValuationResult = Omit<DCFResults, 'forecasts'> & {
  forecasts: UtilityForecastYear[];
  rateBase: number[];
  costOfEquity: number;
  terminalGrowthRate: number;
};

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  return value;
}

function requireRange(value: number, label: string, minimum: number, maximum: number): number {
  const checked = requireFinite(value, label);
  if (checked < minimum || checked > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return checked;
}

export function calculateUtilityValuation(assumptions: UtilityModelAssumptions): UtilityValuationResult {
  const forecastYears = assumptions.rateBaseAdditions.length;
  if (forecastYears !== UTILITY_FORECAST_YEARS || assumptions.rateBaseDepreciation.length !== forecastYears) {
    throw new Error(`Utility DDM requires ${UTILITY_FORECAST_YEARS} aligned rate-base forecast periods.`);
  }
  const baseRateBase = requireFinite(assumptions.baseRateBase, 'Base regulated rate base');
  if (baseRateBase <= 0) throw new Error('Base regulated rate base must be positive.');
  const equityRatio = requireRange(assumptions.authorizedEquityRatio, 'Authorized equity ratio', 0.01, 0.99);
  const allowedRoe = requireRange(assumptions.allowedRoe, 'Allowed return on equity', 0.001, 0.5);
  const payoutRatio = requireRange(assumptions.dividendPayoutRatio, 'Dividend payout ratio', 0, 1);
  const beta = requireRange(assumptions.beta, 'Beta', 0.01, 5);
  const riskFreeRate = requireRange(assumptions.riskFreeRate, 'Risk-free rate', 0.001, 0.3);
  const equityRiskPremium = requireRange(assumptions.equityRiskPremium, 'Equity risk premium', 0.001, 0.3);
  const costOfEquity = riskFreeRate + beta * equityRiskPremium;
  const terminalGrowthRate = requireRange(assumptions.terminalGrowthRate, 'Terminal growth rate', -0.05, costOfEquity - 0.005);
  const currentPrice = requireRange(assumptions.currentPrice, 'Current share price', 0.01, 1_000_000);
  const dilutedShares = requireRange(assumptions.dilutedShares, 'Diluted shares', 1, 1e15);

  let openingRateBase = baseRateBase;
  const forecasts: UtilityForecastYear[] = [];
  for (let index = 0; index < forecastYears; index += 1) {
    const additions = requireRange(assumptions.rateBaseAdditions[index]!, `FY${assumptions.baseYear + index + 1} rate-base additions`, 0, 1e15);
    const depreciationAndRetirements = requireRange(assumptions.rateBaseDepreciation[index]!, `FY${assumptions.baseYear + index + 1} rate-base depreciation and retirements`, 0, 1e15);
    const closingRateBase = openingRateBase + additions - depreciationAndRetirements;
    if (closingRateBase <= 0) throw new Error(`FY${assumptions.baseYear + index + 1} closing rate base must be positive.`);
    const averageRateBase = (openingRateBase + closingRateBase) / 2;
    const allowedEquityEarnings = averageRateBase * equityRatio * allowedRoe;
    const commonDividends = allowedEquityEarnings * payoutRatio;
    const discountFactor = 1 / (1 + costOfEquity) ** (index + 1);
    forecasts.push({
      year: assumptions.baseYear + index + 1,
      openingRateBase,
      additions,
      depreciationAndRetirements,
      closingRateBase,
      averageRateBase,
      allowedEquityEarnings,
      commonDividends,
      discountFactor,
      presentValueOfDividends: commonDividends * discountFactor,
    });
    openingRateBase = closingRateBase;
  }

  const lastDividend = forecasts.at(-1)!.commonDividends;
  const terminalValue = lastDividend * (1 + terminalGrowthRate) / (costOfEquity - terminalGrowthRate);
  const pvTerminalValue = terminalValue / (1 + costOfEquity) ** forecastYears;
  const equityValue = forecasts.reduce((sum, year) => sum + year.presentValueOfDividends, 0) + pvTerminalValue;
  const impliedSharePrice = equityValue / dilutedShares;

  return {
    forecasts,
    rateBase: forecasts.map((year) => year.closingRateBase),
    terminalValue,
    pvTerminalValue,
    enterpriseValue: null,
    equityValue,
    impliedSharePrice,
    shareCount: dilutedShares,
    currentPrice,
    upside: impliedSharePrice / currentPrice - 1,
    terminalValueGordon: terminalValue,
    terminalValueExitMultiple: 0,
    tvDivergenceFlag: false,
    avgROIC: 0,
    valueCreationFlag: false,
    confidenceScore: 0.5,
    confidenceRank: 'Low',
    companyType: 'utility',
    preferredModel: 'utility_dcf',
    isValuationSupported: true,
    isSensitivitySupported: true,
    valuationBasis: 'equity',
    costOfEquity,
    terminalGrowthRate,
    modelWarning: 'Direct common-equity dividend DCF based on regulated rate base and allowed returns; the model does not calculate enterprise value or corporate FCFF.',
  };
}
