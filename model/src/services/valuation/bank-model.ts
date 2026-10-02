import type {
  BankHistoricalData,
  DCFResults,
} from '@/core/types';
import type { CanonicalFinancialLine } from '@/core/types/native';

export interface BankAssumptionSources {
  earningAssetGrowth: string;
  loanGrowth: string;
  depositGrowth: string;
  earningAssetYield: string;
  fundingCost: string;
  noninterestIncomeGrowth: string;
  efficiencyRatio: string;
  provisionRate: string;
  taxRate: string;
  payoutRatio: string;
  terminalGrowthRate: string;
}

export interface BankModelAssumptions {
  forecastYears: number;
  earningAssetGrowth: number;
  loanGrowth: number;
  depositGrowth: number;
  earningAssetYield: number;
  fundingCost: number;
  noninterestIncomeGrowth: number;
  efficiencyRatio: number;
  provisionRate: number;
  taxRate: number;
  payoutRatio: number;
  minimumCet1Ratio: number;
  minimumCet1RatioSource: string;
  riskFreeRate: number;
  riskFreeRateSource: string;
  equityRiskPremium: number;
  equityRiskPremiumSource: string;
  beta: number;
  betaSource: string;
  marketDataAsOfDate: string;
  terminalGrowthRate: number;
  currentPrice: number;
  dilutedSharesOutstanding: number;
  assumptionSources: BankAssumptionSources;
}

export interface BankForecastYear {
  year: number;
  averageEarningAssets: number;
  interestBearingLiabilities: number;
  loansAndLeases: number;
  deposits: number;
  interestIncome: number;
  interestExpense: number;
  netInterestIncome: number;
  noninterestIncome: number;
  totalRevenue: number;
  noninterestExpense: number;
  provisionForCreditLosses: number;
  pretaxIncome: number;
  taxExpense: number;
  netIncome: number;
  openingCommonEquity: number;
  commonDistributions: number;
  endingCommonEquity: number;
  openingCet1Capital: number;
  cet1CapitalBeforeDistributions: number;
  requiredCet1Capital: number;
  endingCet1Capital: number;
  endingRiskWeightedAssets: number;
  cet1Ratio: number;
  residualIncome: number;
  presentValueResidualIncome: number;
}

export interface BankModelResult extends DCFResults {
  valuationBasis: 'equity';
  enterpriseValue: null;
  costOfEquity: number;
  terminalGrowthUsed: number;
  terminalResidualIncome: number;
  bankForecasts: BankForecastYear[];
}

const REQUIRED_BANK_LINES = [
  'interest_income',
  'interest_expense',
  'net_interest_income',
  'noninterest_income',
  'noninterest_expense',
  'provision_for_credit_losses',
  'loans_and_leases',
  'deposits',
  'interest_bearing_liabilities',
  'interest_earning_assets',
  'risk_weighted_assets',
  'cet1_capital',
  'minimum_cet1_ratio',
  'common_equity',
  'common_equity_distributions',
  'diluted_shares',
] as const;

function requireFinite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`Bank model assumption ${name} must be finite.`);
  return value;
}

function requireRate(value: number, name: string, {allowZero = true}: {allowZero?: boolean} = {}): number {
  requireFinite(value, name);
  if ((allowZero ? value < 0 : value <= 0) || value >= 1) {
    throw new Error(`Bank model assumption ${name} must be ${allowZero ? 'between 0 and 100%' : 'greater than 0 and below 100%'}.`);
  }
  return value;
}

function sourcedValue(line: CanonicalFinancialLine | undefined, name: string, year: number): number {
  if (!line || (line.source !== 'sec_native' && line.source !== 'derived')) {
    throw new Error(`FY${year} bank input ${name} is missing or ambiguous.`);
  }
  if (typeof line.value !== 'number' || !Number.isFinite(line.value)) {
    throw new Error(`FY${year} bank input ${name} has no numeric value.`);
  }
  if (line.sources.length === 0) {
    throw new Error(`FY${year} bank input ${name} has no filing provenance.`);
  }
  for (const source of line.sources) {
    if (!source.accession || !source.filed || source.fiscal_period !== `FY ${year}`) {
      throw new Error(`FY${year} bank input ${name} has incomplete filing provenance.`);
    }
  }
  return line.value;
}

function latestBankInputs(historical: BankHistoricalData): {
  year: number;
  values: Record<(typeof REQUIRED_BANK_LINES)[number], number>;
  sourceConfidence: number;
} {
  const latest = historical.annual.at(-1);
  if (!latest) throw new Error('Bank model requires at least one filed fiscal year.');
  const values = {} as Record<(typeof REQUIRED_BANK_LINES)[number], number>;
  const confidenceScores: number[] = [];
  for (const field of REQUIRED_BANK_LINES) {
    values[field] = sourcedValue(latest.bank[field], field, latest.year);
    const confidence = latest.bank[field].confidence;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error(`FY${latest.year} bank input ${field} has invalid source confidence.`);
    }
    confidenceScores.push(confidence);
  }
  if (values.interest_income <= 0 || values.interest_expense < 0
    || values.interest_earning_assets <= 0 || values.interest_bearing_liabilities <= 0
    || values.loans_and_leases <= 0 || values.deposits <= 0
    || values.risk_weighted_assets <= 0 || values.cet1_capital <= 0
    || values.common_equity <= 0 || values.diluted_shares <= 0) {
    throw new Error(`FY${latest.year} bank operating and capital balances must be positive.`);
  }
  const netInterestCheck = values.interest_income - values.interest_expense;
  if (Math.abs(netInterestCheck - values.net_interest_income) > Math.max(1, Math.abs(values.net_interest_income) * 0.005)) {
    throw new Error(`FY${latest.year} bank interest income, expense, and net interest income do not reconcile.`);
  }
  return {
    year: latest.year,
    values,
    sourceConfidence: confidenceScores.reduce((sum, value) => sum + value, 0) / confidenceScores.length,
  };
}

function validateAssumptions(assumptions: BankModelAssumptions): number {
  if (!Number.isInteger(assumptions.forecastYears) || assumptions.forecastYears < 1 || assumptions.forecastYears > 10) {
    throw new Error('Bank forecast horizon must be between one and ten years.');
  }
  for (const name of ['earningAssetGrowth', 'loanGrowth', 'depositGrowth', 'noninterestIncomeGrowth'] as const) {
    requireFinite(assumptions[name], name);
    if (assumptions[name] <= -1) throw new Error(`Bank model assumption ${name} must be greater than -100%.`);
  }
  requireRate(assumptions.earningAssetYield, 'earningAssetYield', {allowZero: false});
  requireRate(assumptions.fundingCost, 'fundingCost');
  requireRate(assumptions.efficiencyRatio, 'efficiencyRatio');
  requireRate(assumptions.provisionRate, 'provisionRate');
  requireRate(assumptions.taxRate, 'taxRate');
  requireFinite(assumptions.payoutRatio, 'payoutRatio');
  if (assumptions.payoutRatio < 0 || assumptions.payoutRatio > 2) {
    throw new Error('Bank target payout ratio must be between zero and 200%.');
  }
  requireRate(assumptions.minimumCet1Ratio, 'minimumCet1Ratio', {allowZero: false});
  requireRate(assumptions.riskFreeRate, 'riskFreeRate');
  requireRate(assumptions.equityRiskPremium, 'equityRiskPremium');
  requireFinite(assumptions.beta, 'beta');
  if (assumptions.beta <= 0) throw new Error('Bank model assumption beta must be greater than zero.');
  requireRate(assumptions.terminalGrowthRate, 'terminalGrowthRate');
  requireFinite(assumptions.currentPrice, 'currentPrice');
  if (assumptions.currentPrice <= 0) throw new Error('Bank current share price must be greater than zero.');
  requireFinite(assumptions.dilutedSharesOutstanding, 'dilutedSharesOutstanding');
  if (assumptions.dilutedSharesOutstanding <= 0) throw new Error('Bank diluted share count must be greater than zero.');

  for (const [name, source] of [
    ['minimumCet1Ratio', assumptions.minimumCet1RatioSource],
    ['riskFreeRate', assumptions.riskFreeRateSource],
    ['equityRiskPremium', assumptions.equityRiskPremiumSource],
    ['beta', assumptions.betaSource],
  ] as const) {
    if (!source.trim() || /\b(default|stale|unavailable)\b/i.test(source)) {
      throw new Error(`Bank model assumption ${name} must have a current source.`);
    }
  }
  for (const [name, source] of Object.entries(assumptions.assumptionSources)) {
    if (!source.trim() || /\b(default|stale|unavailable)\b/i.test(source)) {
      throw new Error(`Bank model assumption ${name} must identify a current source or an explicit analyst input.`);
    }
  }
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(assumptions.marketDataAsOfDate)) {
    throw new Error('Bank market inputs require a dated valuation context.');
  }

  const costOfEquity = assumptions.riskFreeRate + assumptions.beta * assumptions.equityRiskPremium;
  if (!Number.isFinite(costOfEquity) || costOfEquity <= 0 || assumptions.terminalGrowthRate >= costOfEquity) {
    throw new Error('Terminal growth must be below the sourced cost of equity.');
  }
  return costOfEquity;
}

export function calculateBankValuation(
  historical: BankHistoricalData,
  assumptions: BankModelAssumptions,
): BankModelResult {
  const costOfEquity = validateAssumptions(assumptions);
  const {year: lastActualYear, values, sourceConfidence} = latestBankInputs(historical);
  const openingCapitalRatio = values.cet1_capital / values.risk_weighted_assets;
  if (openingCapitalRatio <= 0) throw new Error(`FY${lastActualYear} bank CET1 ratio is not positive.`);

  const bankForecasts: BankForecastYear[] = [];
  let priorEarningAssets = values.interest_earning_assets;
  let priorInterestBearingLiabilities = values.interest_bearing_liabilities;
  let priorLoans = values.loans_and_leases;
  let priorDeposits = values.deposits;
  let priorNoninterestIncome = values.noninterest_income;
  let openingCommonEquity = values.common_equity;
  let openingCet1Capital = values.cet1_capital;
  let openingRiskWeightedAssets = values.risk_weighted_assets;
  let presentValueResidualIncome = 0;

  for (let index = 1; index <= assumptions.forecastYears; index += 1) {
    const year = lastActualYear + index;
    const averageEarningAssets = priorEarningAssets * (1 + assumptions.earningAssetGrowth);
    const interestBearingLiabilities = priorInterestBearingLiabilities * (1 + assumptions.depositGrowth);
    const loansAndLeases = priorLoans * (1 + assumptions.loanGrowth);
    const deposits = priorDeposits * (1 + assumptions.depositGrowth);
    const interestIncome = averageEarningAssets * assumptions.earningAssetYield;
    const interestExpense = interestBearingLiabilities * assumptions.fundingCost;
    const netInterestIncome = interestIncome - interestExpense;
    const noninterestIncome = priorNoninterestIncome * (1 + assumptions.noninterestIncomeGrowth);
    const totalRevenue = netInterestIncome + noninterestIncome;
    const noninterestExpense = totalRevenue * assumptions.efficiencyRatio;
    const averageLoans = (priorLoans + loansAndLeases) / 2;
    const provisionForCreditLosses = averageLoans * assumptions.provisionRate;
    const pretaxIncome = totalRevenue - noninterestExpense - provisionForCreditLosses;
    const taxExpense = Math.max(0, pretaxIncome * assumptions.taxRate);
    const netIncome = pretaxIncome - taxExpense;

    const endingRiskWeightedAssets = openingRiskWeightedAssets * (1 + assumptions.earningAssetGrowth);
    const requiredCet1Capital = endingRiskWeightedAssets * assumptions.minimumCet1Ratio;
    const cet1CapitalBeforeDistributions = openingCet1Capital + netIncome;
    const availableDistributionCapacity = cet1CapitalBeforeDistributions - requiredCet1Capital;
    if (availableDistributionCapacity < 0) {
      throw new Error(`FY${year} projected CET1 capital falls below the minimum ratio before distributions.`);
    }
    const targetDistributions = Math.max(0, netIncome * assumptions.payoutRatio);
    const commonDistributions = Math.min(targetDistributions, availableDistributionCapacity);
    const endingCet1Capital = cet1CapitalBeforeDistributions - commonDistributions;
    const endingCommonEquity = openingCommonEquity + netIncome - commonDistributions;
    if (endingCommonEquity <= 0) throw new Error(`FY${year} projected common equity is not positive.`);

    const residualIncome = netIncome - costOfEquity * openingCommonEquity;
    const presentValueResidual = residualIncome / Math.pow(1 + costOfEquity, index);
    presentValueResidualIncome += presentValueResidual;
    const cet1Ratio = endingCet1Capital / endingRiskWeightedAssets;
    if (cet1Ratio + 1e-12 < assumptions.minimumCet1Ratio) {
      throw new Error(`FY${year} capital-constrained distributions breach the minimum CET1 ratio.`);
    }

    bankForecasts.push({
      year,
      averageEarningAssets,
      interestBearingLiabilities,
      loansAndLeases,
      deposits,
      interestIncome,
      interestExpense,
      netInterestIncome,
      noninterestIncome,
      totalRevenue,
      noninterestExpense,
      provisionForCreditLosses,
      pretaxIncome,
      taxExpense,
      netIncome,
      openingCommonEquity,
      commonDistributions,
      endingCommonEquity,
      openingCet1Capital,
      cet1CapitalBeforeDistributions,
      requiredCet1Capital,
      endingCet1Capital,
      endingRiskWeightedAssets,
      cet1Ratio,
      residualIncome,
      presentValueResidualIncome: presentValueResidual,
    });

    priorEarningAssets = averageEarningAssets;
    priorInterestBearingLiabilities = interestBearingLiabilities;
    priorLoans = loansAndLeases;
    priorDeposits = deposits;
    priorNoninterestIncome = noninterestIncome;
    openingCommonEquity = endingCommonEquity;
    openingCet1Capital = endingCet1Capital;
    openingRiskWeightedAssets = endingRiskWeightedAssets;
  }

  const finalForecast = bankForecasts[bankForecasts.length - 1];
  const terminalResidualIncome = finalForecast.residualIncome * (1 + assumptions.terminalGrowthRate)
    / (costOfEquity - assumptions.terminalGrowthRate);
  const pvTerminalResidualIncome = terminalResidualIncome / Math.pow(1 + costOfEquity, assumptions.forecastYears);
  const rawEquityValue = values.common_equity + presentValueResidualIncome + pvTerminalResidualIncome;
  const equityValue = Math.max(0, rawEquityValue);
  const impliedSharePrice = equityValue / assumptions.dilutedSharesOutstanding;

  return {
    forecasts: [],
    terminalValue: terminalResidualIncome,
    pvTerminalValue: pvTerminalResidualIncome,
    enterpriseValue: null,
    equityValue,
    impliedSharePrice,
    shareCount: assumptions.dilutedSharesOutstanding,
    currentPrice: assumptions.currentPrice,
    upside: (impliedSharePrice / assumptions.currentPrice) - 1,
    terminalValueGordon: terminalResidualIncome,
    terminalValueExitMultiple: 0,
    tvDivergenceFlag: false,
    avgROIC: 0,
    valueCreationFlag: equityValue > values.common_equity,
    confidenceScore: sourceConfidence,
    confidenceRank: sourceConfidence >= 0.9 ? 'High' : sourceConfidence >= 0.75 ? 'Medium' : 'Low',
    companyType: 'bank',
    preferredModel: 'bank_residual_income',
    isValuationSupported: true,
    isSensitivitySupported: false,
    valuationBasis: 'equity',
    costOfEquity,
    terminalGrowthUsed: assumptions.terminalGrowthRate,
    terminalResidualIncome,
    bankForecasts,
  };
}
