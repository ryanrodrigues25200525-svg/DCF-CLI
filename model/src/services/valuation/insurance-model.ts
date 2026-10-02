import type { DCFResults, InsuranceHistoricalData } from '@/core/types';
import type { CanonicalFinancialLine } from '@/core/types/native';

export interface InsuranceAssumptionSources {
  premiumGrowth: string;
  lossRatio: string;
  expenseRatio: string;
  priorYearReserveDevelopmentRate: string;
  netInvestmentIncomeYield: string;
  investedAssetGrowth: string;
  paidLossRatio: string;
  reserveOtherChangesRate: string;
  otherOperationsPretaxGrowth: string;
  otherPretaxAdjustmentGrowth: string;
  taxRate: string;
  payoutRatio: string;
  minimumStatutoryCapitalToPremiumRatio: string;
  terminalGrowthRate: string;
}

export interface InsuranceModelAssumptions {
  forecastYears: number;
  premiumGrowth: number;
  lossRatio: number;
  expenseRatio: number;
  priorYearReserveDevelopmentRate: number;
  netInvestmentIncomeYield: number;
  investedAssetGrowth: number;
  paidLossRatio: number;
  reserveOtherChangesRate: number;
  otherOperationsPretaxGrowth: number;
  otherPretaxAdjustmentGrowth: number;
  taxRate: number;
  payoutRatio: number;
  minimumStatutoryCapitalToPremiumRatio: number;
  minimumStatutoryCapitalSource: string;
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
  assumptionSources: InsuranceAssumptionSources;
}

export interface InsuranceForecastYear {
  year: number;
  netPremiumsWritten: number;
  netPremiumsEarned: number;
  lossRatio: number;
  expenseRatio: number;
  combinedRatio: number;
  priorYearReserveDevelopment: number;
  lossesAndLAE: number;
  underwritingExpenses: number;
  underwritingIncome: number;
  endingInvestedAssets: number;
  averageInvestedAssets: number;
  netInvestmentIncome: number;
  otherOperationsPretaxIncome: number;
  otherPretaxAdjustments: number;
  pretaxIncome: number;
  taxExpense: number;
  netIncome: number;
  openingLossReserves: number;
  lossesIncurredForReserves: number;
  lossesPaid: number;
  reserveOtherChanges: number;
  endingNetLossReserves: number;
  endingReinsuranceRecoverable: number;
  endingGrossLossReserves: number;
  reserveRollforwardCheck: number;
  openingStatutoryCapitalSurplus: number;
  requiredStatutoryCapital: number;
  statutoryCapitalBeforeDistributions: number;
  commonDistributions: number;
  endingStatutoryCapitalSurplus: number;
  openingCommonEquity: number;
  endingCommonEquity: number;
  residualIncome: number;
  presentValueResidualIncome: number;
}

export interface InsuranceModelResult extends DCFResults {
  valuationBasis: 'equity';
  enterpriseValue: null;
  costOfEquity: number;
  terminalGrowthUsed: number;
  terminalResidualIncome: number;
  insuranceForecasts: InsuranceForecastYear[];
}

const REQUIRED_INSURANCE_LINES = [
  'net_premiums_written', 'net_premiums_earned', 'losses_and_lae', 'underwriting_expenses',
  'loss_ratio', 'expense_ratio', 'combined_ratio', 'prior_year_reserve_development',
  'underwriting_income', 'net_investment_income', 'invested_assets',
  'unpaid_loss_reserves_beginning', 'losses_incurred_for_reserve_rollforward',
  'losses_paid_for_reserve_rollforward', 'reserve_other_changes', 'unpaid_loss_reserves',
  'reinsurance_recoverable', 'gross_loss_reserves', 'reserve_rollforward_check',
  'other_operations_pretax_income', 'statutory_capital_surplus', 'minimum_statutory_capital',
  'common_equity', 'common_equity_distributions', 'diluted_shares', 'net_income',
  'tax_rate', 'reported_pretax_income', 'other_pretax_adjustments',
] as const;

function requireFinite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`Insurance model assumption ${name} must be finite.`);
  return value;
}

function requireSourcedValue(line: CanonicalFinancialLine | undefined, name: string, year: number): number {
  if (!line || (line.source !== 'sec_native' && line.source !== 'derived')) {
    throw new Error(`FY${year} P&C input ${name} is missing or ambiguous.`);
  }
  if (typeof line.value !== 'number' || !Number.isFinite(line.value)) {
    throw new Error(`FY${year} P&C input ${name} has no numeric value.`);
  }
  if (line.sources.length === 0 || line.sources.some((source) => !source.accession || !source.filed || source.fiscal_period !== `FY ${year}`)) {
    throw new Error(`FY${year} P&C input ${name} has incomplete filing provenance.`);
  }
  return line.value;
}

function latestInsuranceInputs(historical: InsuranceHistoricalData): {
  year: number;
  values: Record<(typeof REQUIRED_INSURANCE_LINES)[number], number>;
  sourceConfidence: number;
} {
  const latest = historical.annual.at(-1);
  if (!latest?.insurance) throw new Error('P&C model requires filed General Insurance history.');
  const values = {} as Record<(typeof REQUIRED_INSURANCE_LINES)[number], number>;
  const confidence: number[] = [];
  for (const field of REQUIRED_INSURANCE_LINES) {
    const line = latest.insurance[field];
    values[field] = requireSourcedValue(line, field, latest.year);
    if (!Number.isFinite(line.confidence) || line.confidence < 0 || line.confidence > 1) {
      throw new Error(`FY${latest.year} P&C input ${field} has invalid source confidence.`);
    }
    confidence.push(line.confidence);
  }
  if (values.net_premiums_written <= 0 || values.net_premiums_earned <= 0
    || values.invested_assets <= 0 || values.unpaid_loss_reserves <= 0
    || values.statutory_capital_surplus <= 0 || values.minimum_statutory_capital <= 0
    || values.common_equity <= 0 || values.net_income <= 0 || values.diluted_shares <= 0) {
    throw new Error(`FY${latest.year} P&C operating, reserve, statutory-capital, and equity balances must be positive.`);
  }
  const underwritingExpenseCheck = values.net_premiums_earned - values.losses_and_lae - values.underwriting_expenses;
  if (Math.abs(underwritingExpenseCheck - values.underwriting_income) > Math.max(1, values.net_premiums_earned * 0.001)) {
    throw new Error(`FY${latest.year} P&C underwriting income does not reconcile to earned premium, losses, and expenses.`);
  }
  const ratioCheck = values.loss_ratio + values.expense_ratio;
  if (Math.abs(ratioCheck - values.combined_ratio) > 0.005) {
    throw new Error(`FY${latest.year} reported P&C loss, expense, and combined ratios do not reconcile.`);
  }
  if (Math.abs(values.reserve_rollforward_check) > 1_000_000) {
    throw new Error(`FY${latest.year} filed P&C loss-reserve roll-forward does not reconcile within $1 million.`);
  }
  return {
    year: latest.year,
    values,
    sourceConfidence: confidence.reduce((sum, value) => sum + value, 0) / confidence.length,
  };
}

function validateAssumptions(assumptions: InsuranceModelAssumptions): number {
  if (assumptions.forecastYears !== 5) throw new Error('P&C insurance model uses a five-year forecast horizon.');
  for (const field of ['premiumGrowth', 'investedAssetGrowth', 'otherOperationsPretaxGrowth', 'otherPretaxAdjustmentGrowth'] as const) {
    requireFinite(assumptions[field], field);
    if (assumptions[field] <= -1) throw new Error(`Insurance assumption ${field} must be greater than -100%.`);
  }
  for (const [field, value] of [
    ['lossRatio', assumptions.lossRatio],
    ['expenseRatio', assumptions.expenseRatio],
    ['netInvestmentIncomeYield', assumptions.netInvestmentIncomeYield],
    ['paidLossRatio', assumptions.paidLossRatio],
    ['taxRate', assumptions.taxRate],
    ['minimumStatutoryCapitalToPremiumRatio', assumptions.minimumStatutoryCapitalToPremiumRatio],
    ['riskFreeRate', assumptions.riskFreeRate],
    ['equityRiskPremium', assumptions.equityRiskPremium],
    ['terminalGrowthRate', assumptions.terminalGrowthRate],
  ] as const) {
    requireFinite(value, field);
    if (value < 0 || value >= 1) throw new Error(`Insurance assumption ${field} must be between 0% and 100%.`);
  }
  requireFinite(assumptions.priorYearReserveDevelopmentRate, 'priorYearReserveDevelopmentRate');
  requireFinite(assumptions.reserveOtherChangesRate, 'reserveOtherChangesRate');
  requireFinite(assumptions.payoutRatio, 'payoutRatio');
  if (assumptions.payoutRatio < 0) throw new Error('Insurance payout ratio must be non-negative.');
  requireFinite(assumptions.beta, 'beta');
  requireFinite(assumptions.currentPrice, 'currentPrice');
  requireFinite(assumptions.dilutedSharesOutstanding, 'dilutedSharesOutstanding');
  if (assumptions.beta <= 0 || assumptions.currentPrice <= 0 || assumptions.dilutedSharesOutstanding <= 0) {
    throw new Error('Insurance valuation requires positive beta, current price, and diluted shares.');
  }
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(assumptions.marketDataAsOfDate)) throw new Error('Insurance valuation requires a dated market context.');
  for (const source of [
    assumptions.minimumStatutoryCapitalSource,
    assumptions.riskFreeRateSource,
    assumptions.equityRiskPremiumSource,
    assumptions.betaSource,
    ...Object.values(assumptions.assumptionSources),
  ]) {
    if (!source.trim() || /\b(default|stale|unavailable)\b/i.test(source)) {
      throw new Error('Insurance assumptions require a current source or an explicit analyst input.');
    }
  }
  const costOfEquity = assumptions.riskFreeRate + assumptions.beta * assumptions.equityRiskPremium;
  if (!Number.isFinite(costOfEquity) || costOfEquity <= assumptions.terminalGrowthRate) {
    throw new Error('Insurance terminal growth must be below the sourced cost of equity.');
  }
  return costOfEquity;
}

export function calculateInsuranceValuation(
  historical: InsuranceHistoricalData,
  assumptions: InsuranceModelAssumptions,
): InsuranceModelResult {
  const costOfEquity = validateAssumptions(assumptions);
  const {year: lastActualYear, values, sourceConfidence} = latestInsuranceInputs(historical);
  const openingStatutoryCapital = values.statutory_capital_surplus;
  const requiredCapital = values.minimum_statutory_capital;
  const minimumCapitalToPremiumRatio = assumptions.minimumStatutoryCapitalToPremiumRatio;
  const latestPremiums = values.net_premiums_written;
  const latestEarnedPremiums = values.net_premiums_earned;
  const latestInvestedAssets = values.invested_assets;
  const latestOtherOperations = values.other_operations_pretax_income;
  const latestOtherPretaxAdjustments = values.other_pretax_adjustments;
  const latestReserves = values.unpaid_loss_reserves;
  const latestRecoverables = values.reinsurance_recoverable;
  const reportedPriorYearDevelopment = values.prior_year_reserve_development;

  const insuranceForecasts: InsuranceForecastYear[] = [];
  let priorWritten = latestPremiums;
  let priorEarned = latestEarnedPremiums;
  let priorInvestedAssets = latestInvestedAssets;
  let priorOtherOperations = latestOtherOperations;
  let priorOtherAdjustments = latestOtherPretaxAdjustments;
  let openingLossReserves = latestReserves;
  let openingStatutoryCapitalSurplus = openingStatutoryCapital;
  let openingCommonEquity = values.common_equity;
  let pvForecastResidualIncome = 0;
  const recoverableToNetReserveRatio = latestReserves > 0 ? latestRecoverables / latestReserves : 0;

  for (let index = 1; index <= assumptions.forecastYears; index += 1) {
    const year = lastActualYear + index;
    const netPremiumsWritten = priorWritten * (1 + assumptions.premiumGrowth);
    const netPremiumsEarned = priorEarned * (1 + assumptions.premiumGrowth);
    const priorYearReserveDevelopment = assumptions.priorYearReserveDevelopmentRate;
    // Positive filed development is favorable; lower future development therefore raises the loss ratio.
    const lossRatio = Math.max(0, assumptions.lossRatio + reportedPriorYearDevelopment - priorYearReserveDevelopment);
    const expenseRatio = assumptions.expenseRatio;
    const combinedRatio = lossRatio + expenseRatio;
    const lossesAndLAE = netPremiumsEarned * lossRatio;
    const underwritingExpenses = netPremiumsEarned * expenseRatio;
    const underwritingIncome = netPremiumsEarned - lossesAndLAE - underwritingExpenses;
    const investedAssets = priorInvestedAssets * (1 + assumptions.investedAssetGrowth);
    const averageInvestedAssets = (priorInvestedAssets + investedAssets) / 2;
    const netInvestmentIncome = averageInvestedAssets * assumptions.netInvestmentIncomeYield;
    const otherOperationsPretaxIncome = priorOtherOperations * (1 + assumptions.otherOperationsPretaxGrowth);
    const otherPretaxAdjustments = priorOtherAdjustments * (1 + assumptions.otherPretaxAdjustmentGrowth);
    const pretaxIncome = underwritingIncome + netInvestmentIncome + otherOperationsPretaxIncome + otherPretaxAdjustments;
    const taxExpense = Math.max(0, pretaxIncome * assumptions.taxRate);
    const netIncome = pretaxIncome - taxExpense;

    const lossesIncurredForReserves = lossesAndLAE;
    const lossesPaid = lossesIncurredForReserves * assumptions.paidLossRatio;
    const reserveOtherChanges = netPremiumsEarned * assumptions.reserveOtherChangesRate;
    const endingNetLossReserves = openingLossReserves + lossesIncurredForReserves - lossesPaid + reserveOtherChanges;
    if (endingNetLossReserves <= 0) throw new Error(`FY${year} projected net loss reserves are not positive.`);
    const endingReinsuranceRecoverable = endingNetLossReserves * recoverableToNetReserveRatio;
    const endingGrossLossReserves = endingNetLossReserves + endingReinsuranceRecoverable;
    const reserveRollforwardCheck = openingLossReserves + lossesIncurredForReserves - lossesPaid + reserveOtherChanges - endingNetLossReserves;

    const requiredStatutoryCapital = netPremiumsWritten * minimumCapitalToPremiumRatio;
    const statutoryCapitalBeforeDistributions = openingStatutoryCapitalSurplus + netIncome;
    const distributionCapacity = statutoryCapitalBeforeDistributions - requiredStatutoryCapital;
    if (distributionCapacity < 0) throw new Error(`FY${year} statutory capital falls below the filed minimum before distributions.`);
    const targetDistributions = Math.max(0, netIncome * assumptions.payoutRatio);
    const commonDistributions = Math.min(targetDistributions, distributionCapacity);
    const endingStatutoryCapitalSurplus = statutoryCapitalBeforeDistributions - commonDistributions;
    const endingCommonEquity = openingCommonEquity + netIncome - commonDistributions;
    if (endingCommonEquity <= 0) throw new Error(`FY${year} projected common equity is not positive.`);
    const residualIncome = netIncome - costOfEquity * openingCommonEquity;
    const presentValueResidual = residualIncome / Math.pow(1 + costOfEquity, index);
    pvForecastResidualIncome += presentValueResidual;

    insuranceForecasts.push({
      year,
      netPremiumsWritten,
      netPremiumsEarned,
      lossRatio,
      expenseRatio,
      combinedRatio,
      priorYearReserveDevelopment,
      lossesAndLAE,
      underwritingExpenses,
      underwritingIncome,
      endingInvestedAssets: investedAssets,
      averageInvestedAssets,
      netInvestmentIncome,
      otherOperationsPretaxIncome,
      otherPretaxAdjustments,
      pretaxIncome,
      taxExpense,
      netIncome,
      openingLossReserves,
      lossesIncurredForReserves,
      lossesPaid,
      reserveOtherChanges,
      endingNetLossReserves,
      endingReinsuranceRecoverable,
      endingGrossLossReserves,
      reserveRollforwardCheck,
      openingStatutoryCapitalSurplus,
      requiredStatutoryCapital,
      statutoryCapitalBeforeDistributions,
      commonDistributions,
      endingStatutoryCapitalSurplus,
      openingCommonEquity,
      endingCommonEquity,
      residualIncome,
      presentValueResidualIncome: presentValueResidual,
    });

    priorWritten = netPremiumsWritten;
    priorEarned = netPremiumsEarned;
    priorInvestedAssets = investedAssets;
    priorOtherOperations = otherOperationsPretaxIncome;
    priorOtherAdjustments = otherPretaxAdjustments;
    openingLossReserves = endingNetLossReserves;
    openingStatutoryCapitalSurplus = endingStatutoryCapitalSurplus;
    openingCommonEquity = endingCommonEquity;
  }

  const finalYear = insuranceForecasts[insuranceForecasts.length - 1];
  const terminalResidualIncome = finalYear.residualIncome * (1 + assumptions.terminalGrowthRate)
    / (costOfEquity - assumptions.terminalGrowthRate);
  const pvTerminalResidualIncome = terminalResidualIncome / Math.pow(1 + costOfEquity, assumptions.forecastYears);
  const rawEquityValue = values.common_equity + pvForecastResidualIncome + pvTerminalResidualIncome;
  const equityValue = Math.max(0, rawEquityValue);
  const impliedSharePrice = equityValue / assumptions.dilutedSharesOutstanding;
  const confidenceRank = sourceConfidence >= 0.9 ? 'High' : sourceConfidence >= 0.75 ? 'Medium' : 'Low';

  return {
    forecasts: [],
    terminalValue: terminalResidualIncome,
    pvTerminalValue: pvTerminalResidualIncome,
    enterpriseValue: null,
    equityValue,
    impliedSharePrice,
    shareCount: assumptions.dilutedSharesOutstanding,
    currentPrice: assumptions.currentPrice,
    upside: impliedSharePrice / assumptions.currentPrice - 1,
    terminalValueGordon: terminalResidualIncome,
    terminalValueExitMultiple: 0,
    tvDivergenceFlag: false,
    avgROIC: 0,
    valueCreationFlag: equityValue > values.common_equity,
    confidenceScore: sourceConfidence,
    confidenceRank,
    companyType: 'insurance',
    preferredModel: 'insurance_pnc_residual_income',
    isValuationSupported: true,
    isSensitivitySupported: false,
    valuationBasis: 'equity',
    costOfEquity,
    terminalGrowthUsed: assumptions.terminalGrowthRate,
    terminalResidualIncome,
    insuranceForecasts,
  };
}
