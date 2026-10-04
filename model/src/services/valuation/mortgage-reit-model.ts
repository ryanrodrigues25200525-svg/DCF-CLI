import type {DCFResults, MortgageReitHistoricalData, MortgageReitHistoricalYear} from '@/core/types';
import type {CanonicalFinancialLine, MortgageReitCanonicalFinancials} from '@/core/types/native';

export interface MortgageReitAssumptionSources {
  assetYield: string;
  assetYieldChange: string;
  fundingCost: string;
  fundingCostChange: string;
  swapRatio: string;
  swapRatioChange: string;
  swapNetPayRate: string;
  swapNetPayRateChange: string;
  investmentAssetsToCommonEquity: string;
  mortgageBorrowingsToCommonEquity: string;
  otherIncomePctAverageAssets: string;
  operatingExpensesPctAverageAssets: string;
  preferredDividendYield: string;
  payoutRatio: string;
  dividendPerShareGrowth: string;
  marketValueChangePerShare: string;
  taxRate: string;
  costOfEquity: string;
  terminalGrowthRate: string;
  commonSharesOutstanding: string;
  commonBookValuePerShare: string;
  preferredLiquidationPreference: string;
  currentPrice: string;
}

export interface MortgageReitModelAssumptions {
  forecastYears: number;
  baseYear: number;
  asOfDate: string;
  assetYield: number;
  assetYieldChange: number;
  aggregateCostOfFunds: number;
  fundingCostChange: number;
  averageSwapRatio: number;
  swapRatioChange: number;
  averageSwapNetPayRate: number;
  swapNetPayRateChange: number;
  investmentAssetsToCommonEquity: number;
  mortgageBorrowingsToCommonEquity: number;
  otherIncomePctAverageAssets: number;
  operatingExpensesPctAverageAssets: number;
  preferredDividendYield: number;
  payoutRatio: number;
  dividendPerShareGrowth: number;
  marketValueChangePerShare: number;
  taxRate: number;
  riskFreeRate: number;
  equityRiskPremium: number;
  beta: number;
  costOfEquity: number;
  terminalGrowthRate: number;
  currentPrice: number;
  commonSharesOutstanding: number;
  commonBookValuePerShare: number;
  preferredLiquidationPreference: number;
  cash: number;
  debt: number;
  assumptionSources: MortgageReitAssumptionSources;
}

export interface MortgageReitForecastYear {
  year: number;
  beginningTangibleBookValuePerCommonShare: number;
  commonSharesOutstanding: number;
  beginningCommonEquityCapitalBase: number;
  investmentAssetsToCommonEquity: number;
  averageInvestmentAssets: number;
  mortgageBorrowingsToCommonEquity: number;
  averageMortgageBorrowings: number;
  assetYield: number;
  economicInterestIncome: number;
  aggregateCostOfFunds: number;
  unhedgedCostOfFunds: number;
  averageSwapRatio: number;
  averageSwapNetPayRate: number;
  hedgeCostOfFundsAdjustment: number;
  economicInterestExpense: number;
  netInterestIncome: number;
  otherIncome: number;
  operatingExpenses: number;
  preferredDividends: number;
  taxes: number;
  earningsAvailableToCommon: number;
  earningsPerShare: number;
  payoutRatio: number;
  commonDividendPerShare: number;
  marketValueChangePerShare: number;
  endingTangibleBookValuePerCommonShare: number;
  residualIncomePerShare: number;
  discountFactor: number;
  presentValueResidualIncomePerShare: number;
  netInterestIncomeCheck: number;
  bookValueRollforwardCheck: number;
}

export interface MortgageReitModelResult extends DCFResults {
  valuationBasis: 'equity';
  costOfEquity: number;
  terminalGrowthUsed: number;
  terminalResidualIncomePerShare: number;
  mortgageReitForecasts: MortgageReitForecastYear[];
}

interface ValidatedHistory {
  recent: MortgageReitHistoricalYear[];
  latest: MortgageReitHistoricalYear;
  assetYield: number[];
  costOfFunds: number[];
  assetMultipliers: number[];
  fundingMultipliers: number[];
  preferredDividendYields: number[];
  payoutRatios: number[];
}

function filedValue(line: CanonicalFinancialLine | undefined, name: string, year: number): number {
  if (!line || !['sec_native', 'derived'].includes(line.source) || typeof line.value !== 'number' || !Number.isFinite(line.value)) {
    throw new Error(`FY${year} mortgage-REIT input ${name} is missing or ambiguous.`);
  }
  if (!line.sources.length || line.sources.some((source) => !source.accession || !source.filed)) {
    throw new Error(`FY${year} mortgage-REIT input ${name} has incomplete SEC provenance.`);
  }
  return line.value;
}

function validateHistory(history: MortgageReitHistoricalData): ValidatedHistory {
  if (history.annual.length !== 4 || history.years.length !== 4) {
    throw new Error('Mortgage-REIT model requires an opening book-value observation and three operating years.');
  }
  for (let index = 0; index < history.annual.length; index += 1) {
    const year = history.annual[index]!.year;
    if (history.years[index] !== year || (index > 0 && year !== history.annual[index - 1]!.year + 1)) {
      throw new Error('Mortgage-REIT history must contain four consecutive fiscal years.');
    }
  }
  const opening = history.annual[0]!;
  filedValue(opening.mortgageReit.tangible_book_value_per_common_share, 'opening tangible book value per common share', opening.year);
  const recent = history.annual.slice(-3);
  for (const item of recent) {
    const year = item.year;
    const reit = item.mortgageReit;
    const required: Array<[keyof MortgageReitCanonicalFinancials, string]> = [
      ['average_investment_securities_at_cost', 'average investment securities'],
      ['average_tba_dollar_roll_position_at_cost', 'average TBA position'],
      ['average_mortgage_borrowings', 'average mortgage borrowings'],
      ['average_asset_yield', 'economic asset yield'],
      ['average_aggregate_cost_of_funds', 'aggregate cost of funds'],
      ['average_net_interest_spread', 'average net interest spread'],
      ['economic_interest_income', 'economic interest income'],
      ['economic_interest_expense', 'economic interest expense'],
      ['operating_expenses', 'operating expenses'],
      ['preferred_dividends', 'preferred dividends'],
      ['net_income_available_to_common', 'net income available to common'],
      ['tangible_book_value_per_common_share', 'tangible book value per common share'],
      ['net_book_value_per_common_share', 'net book value per common share'],
      ['preferred_equity_liquidation_preference', 'preferred liquidation preference'],
      ['common_dividends_per_share', 'common dividends per share'],
      ['period_end_common_shares', 'period-end common shares'],
    ];
    const values = Object.fromEntries(required.map(([field, label]) => [label, filedValue(reit[field], label, year)]));
    if (
      values['average investment securities'] <= 0 || values['average mortgage borrowings'] <= 0
      || values['economic asset yield'] <= 0 || values['economic asset yield'] > 0.2
      || values['aggregate cost of funds'] < 0 || values['aggregate cost of funds'] > 0.2
      || values['average net interest spread'] < -0.1 || values['average net interest spread'] > 0.2
      || values['tangible book value per common share'] <= 0 || values['net book value per common share'] <= 0
      || values['preferred liquidation preference'] < 0 || values['period-end common shares'] <= 0
    ) {
      throw new Error(`FY${year} mortgage-REIT spread, leverage, book, or share data are outside supported ranges.`);
    }
    const spreadCheck = values['economic asset yield'] - values['aggregate cost of funds'];
    if (Math.abs(spreadCheck - values['average net interest spread']) > 0.0002) {
      throw new Error(`FY${year} filed mortgage-REIT asset yield less cost of funds does not reconcile to reported spread.`);
    }
  }

  const assetYield = recent.map((item) => filedValue(item.mortgageReit.average_asset_yield, 'asset yield', item.year));
  const costOfFunds = recent.map((item) => filedValue(item.mortgageReit.average_aggregate_cost_of_funds, 'cost of funds', item.year));
  const assetMultipliers: number[] = [];
  const fundingMultipliers: number[] = [];
  const preferredDividendYields: number[] = [];
  const payoutRatios: number[] = [];
  for (let index = 0; index < recent.length; index += 1) {
    const item = recent[index]!;
    const reit = item.mortgageReit;
    const portfolioAssets = filedValue(reit.average_investment_securities_at_cost, 'average investment securities', item.year)
      + filedValue(reit.average_tba_dollar_roll_position_at_cost, 'average TBA position', item.year);
    const averageEquity = filedValue(reit.average_stockholders_equity, 'average stockholders equity', item.year);
    if (portfolioAssets <= 0 || averageEquity <= 0) throw new Error(`FY${item.year} average mortgage-REIT capital balances must be positive.`);
    assetMultipliers.push(portfolioAssets / averageEquity);
    fundingMultipliers.push(filedValue(reit.average_mortgage_borrowings, 'average mortgage borrowings', item.year) / averageEquity);
    const preferredBook = filedValue(reit.preferred_equity_liquidation_preference, 'preferred liquidation preference', item.year);
    if (preferredBook > 0) preferredDividendYields.push(filedValue(reit.preferred_dividends, 'preferred dividends', item.year) / preferredBook);
    const dilutedShares = filedValue(item.dilutedShares, 'diluted shares', item.year);
    const commonEps = filedValue(reit.net_income_available_to_common, 'net income available to common', item.year) / dilutedShares;
    const declaredDividend = filedValue(reit.common_dividends_per_share, 'common dividends per share', item.year);
    if (commonEps > 0) payoutRatios.push(declaredDividend / commonEps);
  }
  const latest = recent.at(-1);
  if (!latest) throw new Error('Mortgage-REIT annual history is empty.');
  return {recent, latest, assetYield, costOfFunds, assetMultipliers, fundingMultipliers, preferredDividendYields, payoutRatios};
}

function validateAssumptions(assumptions: MortgageReitModelAssumptions): void {
  if (assumptions.forecastYears !== 5) throw new Error('Mortgage-REIT model requires a five-year forecast.');
  for (const [name, value] of [
    ['assetYield', assumptions.assetYield], ['aggregateCostOfFunds', assumptions.aggregateCostOfFunds],
    ['averageSwapRatio', assumptions.averageSwapRatio], ['averageSwapNetPayRate', assumptions.averageSwapNetPayRate],
    ['investmentAssetsToCommonEquity', assumptions.investmentAssetsToCommonEquity],
    ['mortgageBorrowingsToCommonEquity', assumptions.mortgageBorrowingsToCommonEquity],
    ['operatingExpensesPctAverageAssets', assumptions.operatingExpensesPctAverageAssets],
    ['preferredDividendYield', assumptions.preferredDividendYield], ['payoutRatio', assumptions.payoutRatio],
    ['taxRate', assumptions.taxRate], ['riskFreeRate', assumptions.riskFreeRate],
    ['equityRiskPremium', assumptions.equityRiskPremium], ['beta', assumptions.beta],
    ['costOfEquity', assumptions.costOfEquity], ['terminalGrowthRate', assumptions.terminalGrowthRate],
    ['currentPrice', assumptions.currentPrice], ['commonSharesOutstanding', assumptions.commonSharesOutstanding],
    ['commonBookValuePerShare', assumptions.commonBookValuePerShare],
    ['preferredLiquidationPreference', assumptions.preferredLiquidationPreference],
    ['cash', assumptions.cash], ['debt', assumptions.debt],
  ] as const) {
    if (!Number.isFinite(value)) throw new Error(`Mortgage-REIT assumption ${name} must be finite.`);
  }
  for (const [name, value] of [['assetYield', assumptions.assetYield], ['aggregateCostOfFunds', assumptions.aggregateCostOfFunds]] as const) {
    if (value < 0 || value > 0.2) throw new Error(`Mortgage-REIT ${name} must be between 0% and 20%.`);
  }
  for (const [name, value] of [
    ['assetYieldChange', assumptions.assetYieldChange], ['fundingCostChange', assumptions.fundingCostChange],
    ['swapRatioChange', assumptions.swapRatioChange], ['swapNetPayRateChange', assumptions.swapNetPayRateChange],
  ] as const) {
    if (!Number.isFinite(value) || value < -0.1 || value > 0.1) throw new Error(`Mortgage-REIT ${name} must be between -10% and 10%.`);
  }
  if (assumptions.averageSwapRatio < 0 || assumptions.averageSwapRatio > 2
    || assumptions.averageSwapNetPayRate < -0.2 || assumptions.averageSwapNetPayRate > 0.2) {
    throw new Error('Mortgage-REIT swap ratio or net pay rate is outside supported bounds.');
  }
  for (const [name, value] of [['otherIncomePctAverageAssets', assumptions.otherIncomePctAverageAssets], ['marketValueChangePerShare', assumptions.marketValueChangePerShare]] as const) {
    if (!Number.isFinite(value)) throw new Error(`Mortgage-REIT ${name} must be finite.`);
  }
  if (assumptions.operatingExpensesPctAverageAssets < 0 || assumptions.operatingExpensesPctAverageAssets > 0.05
    || assumptions.preferredDividendYield < 0 || assumptions.preferredDividendYield > 0.2
    || assumptions.payoutRatio < 0 || assumptions.payoutRatio > 2
    || assumptions.dividendPerShareGrowth < -0.5 || assumptions.dividendPerShareGrowth > 0.5
    || assumptions.taxRate < 0 || assumptions.taxRate > 0.5) {
    throw new Error('Mortgage-REIT operating costs, preferred dividend, payout, or tax assumptions are outside supported bounds.');
  }
  if (assumptions.investmentAssetsToCommonEquity <= 0 || assumptions.mortgageBorrowingsToCommonEquity < 0
    || assumptions.beta <= 0 || assumptions.costOfEquity < 0.02 || assumptions.costOfEquity > 0.4
    || assumptions.terminalGrowthRate < 0 || assumptions.terminalGrowthRate >= assumptions.costOfEquity) {
    throw new Error('Mortgage-REIT leverage and residual-income valuation assumptions are outside supported bounds.');
  }
  if (assumptions.currentPrice <= 0 || assumptions.commonSharesOutstanding <= 0 || assumptions.commonBookValuePerShare <= 0
    || assumptions.preferredLiquidationPreference < 0 || assumptions.cash < 0 || assumptions.debt < 0) {
    throw new Error('Mortgage-REIT current market and book-value inputs are outside supported bounds.');
  }
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(assumptions.asOfDate)) throw new Error('Mortgage-REIT model requires a dated market context.');
  if (Object.values(assumptions.assumptionSources).some((source) => !source.trim())) {
    throw new Error('Mortgage-REIT assumptions require filed sources or explicit analyst-input disclosures.');
  }
}

export function calculateMortgageReitValuation(
  history: MortgageReitHistoricalData,
  assumptions: MortgageReitModelAssumptions,
): MortgageReitModelResult {
  const validated = validateHistory(history);
  validateAssumptions(assumptions);
  const latest = validated.latest;
  let beginningBookValuePerShare = assumptions.commonBookValuePerShare;
  let assetYield = assumptions.assetYield;
  let swapRatio = assumptions.averageSwapRatio;
  let swapNetPayRate = assumptions.averageSwapNetPayRate;
  const unhedgedBaseCostOfFunds = assumptions.aggregateCostOfFunds - swapRatio * swapNetPayRate;
  if (unhedgedBaseCostOfFunds < 0 || unhedgedBaseCostOfFunds > 0.2) {
    throw new Error('Mortgage-REIT implied pre-hedge funding cost is outside supported bounds.');
  }
  let commonDividendPerShare = filedValue(latest.mortgageReit.common_dividends_per_share, 'common dividends per share', latest.year);
  const mortgageReitForecasts: MortgageReitForecastYear[] = [];
  let presentValueResidualIncomePerShare = 0;

  for (let index = 1; index <= assumptions.forecastYears; index += 1) {
    const year = latest.year + index;
    assetYield += assumptions.assetYieldChange;
    swapRatio += assumptions.swapRatioChange;
    swapNetPayRate += assumptions.swapNetPayRateChange;
    const unhedgedCostOfFunds = unhedgedBaseCostOfFunds + index * assumptions.fundingCostChange;
    const hedgeCostOfFundsAdjustment = swapRatio * swapNetPayRate;
    const aggregateCostOfFunds = unhedgedCostOfFunds + hedgeCostOfFundsAdjustment;
    if (assetYield <= 0 || assetYield > 0.2 || unhedgedCostOfFunds < 0 || unhedgedCostOfFunds > 0.2
      || aggregateCostOfFunds < 0 || aggregateCostOfFunds > 0.2 || swapRatio < 0 || swapRatio > 2
      || swapNetPayRate < -0.2 || swapNetPayRate > 0.2) {
      throw new Error(`FY${year} mortgage-REIT forecast yield or funding cost is outside supported bounds.`);
    }
    const beginningCommonEquityCapitalBase = beginningBookValuePerShare * assumptions.commonSharesOutstanding;
    const averageInvestmentAssets = beginningCommonEquityCapitalBase * assumptions.investmentAssetsToCommonEquity;
    const averageMortgageBorrowings = beginningCommonEquityCapitalBase * assumptions.mortgageBorrowingsToCommonEquity;
    const economicInterestIncome = averageInvestmentAssets * assetYield;
    const economicInterestExpense = averageMortgageBorrowings * aggregateCostOfFunds;
    const netInterestIncome = economicInterestIncome - economicInterestExpense;
    const otherIncome = averageInvestmentAssets * assumptions.otherIncomePctAverageAssets;
    const operatingExpenses = averageInvestmentAssets * assumptions.operatingExpensesPctAverageAssets;
    const preferredDividends = assumptions.preferredLiquidationPreference * assumptions.preferredDividendYield;
    const preTaxIncome = netInterestIncome + otherIncome - operatingExpenses - preferredDividends;
    const taxes = Math.max(0, preTaxIncome) * assumptions.taxRate;
    const earningsAvailableToCommon = preTaxIncome - taxes;
    const earningsPerShare = earningsAvailableToCommon / assumptions.commonSharesOutstanding;
    const payoutCapacityPerShare = Math.max(0, earningsPerShare) * assumptions.payoutRatio;
    const dividendGrowthTargetPerShare = Math.max(0, commonDividendPerShare * (1 + assumptions.dividendPerShareGrowth));
    commonDividendPerShare = Math.min(payoutCapacityPerShare, dividendGrowthTargetPerShare);
    const endingTangibleBookValuePerCommonShare = beginningBookValuePerShare + earningsPerShare - commonDividendPerShare
      + assumptions.marketValueChangePerShare;
    const residualIncomePerShare = earningsPerShare - assumptions.costOfEquity * beginningBookValuePerShare;
    const discountFactor = 1 / Math.pow(1 + assumptions.costOfEquity, index);
    const presentValueOfResidualIncomePerShare = residualIncomePerShare * discountFactor;
    if (![beginningCommonEquityCapitalBase, averageInvestmentAssets, averageMortgageBorrowings, economicInterestIncome,
      economicInterestExpense, netInterestIncome, otherIncome, operatingExpenses, preferredDividends, taxes,
      earningsAvailableToCommon, earningsPerShare, commonDividendPerShare, endingTangibleBookValuePerCommonShare,
      residualIncomePerShare, discountFactor, presentValueOfResidualIncomePerShare].every(Number.isFinite)) {
      throw new Error(`FY${year} mortgage-REIT forecast contains a non-finite calculation.`);
    }
    mortgageReitForecasts.push({
      year,
      beginningTangibleBookValuePerCommonShare: beginningBookValuePerShare,
      commonSharesOutstanding: assumptions.commonSharesOutstanding,
      beginningCommonEquityCapitalBase,
      investmentAssetsToCommonEquity: assumptions.investmentAssetsToCommonEquity,
      averageInvestmentAssets,
      mortgageBorrowingsToCommonEquity: assumptions.mortgageBorrowingsToCommonEquity,
      averageMortgageBorrowings,
      assetYield,
      economicInterestIncome,
      aggregateCostOfFunds,
      unhedgedCostOfFunds,
      averageSwapRatio: swapRatio,
      averageSwapNetPayRate: swapNetPayRate,
      hedgeCostOfFundsAdjustment,
      economicInterestExpense,
      netInterestIncome,
      otherIncome,
      operatingExpenses,
      preferredDividends,
      taxes,
      earningsAvailableToCommon,
      earningsPerShare,
      payoutRatio: assumptions.payoutRatio,
      commonDividendPerShare,
      marketValueChangePerShare: assumptions.marketValueChangePerShare,
      endingTangibleBookValuePerCommonShare,
      residualIncomePerShare,
      discountFactor,
      presentValueResidualIncomePerShare: presentValueOfResidualIncomePerShare,
      netInterestIncomeCheck: netInterestIncome - (economicInterestIncome - economicInterestExpense),
      bookValueRollforwardCheck: endingTangibleBookValuePerCommonShare
        - (beginningBookValuePerShare + earningsPerShare - commonDividendPerShare + assumptions.marketValueChangePerShare),
    });
    presentValueResidualIncomePerShare += presentValueOfResidualIncomePerShare;
    beginningBookValuePerShare = endingTangibleBookValuePerCommonShare;
  }

  const terminalResidualIncomePerShare = mortgageReitForecasts.at(-1)!.residualIncomePerShare
    * (1 + assumptions.terminalGrowthRate) / (assumptions.costOfEquity - assumptions.terminalGrowthRate);
  const pvTerminalResidualIncomePerShare = terminalResidualIncomePerShare * mortgageReitForecasts.at(-1)!.discountFactor;
  const impliedSharePrice = assumptions.commonBookValuePerShare + presentValueResidualIncomePerShare + pvTerminalResidualIncomePerShare;
  const equityValue = impliedSharePrice * assumptions.commonSharesOutstanding;
  const upside = impliedSharePrice / assumptions.currentPrice - 1;
  if (![terminalResidualIncomePerShare, pvTerminalResidualIncomePerShare, impliedSharePrice, equityValue, upside].every(Number.isFinite)) {
    throw new Error('Mortgage-REIT valuation contains a non-finite residual-income or per-share result.');
  }
  const terminalValue = terminalResidualIncomePerShare * assumptions.commonSharesOutstanding;
  const pvTerminalValue = pvTerminalResidualIncomePerShare * assumptions.commonSharesOutstanding;
  return {
    forecasts: [],
    terminalValue,
    pvTerminalValue,
    enterpriseValue: null,
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
    confidenceScore: 0.68,
    confidenceRank: 'Medium',
    valuationBasis: 'equity',
    costOfEquity: assumptions.costOfEquity,
    terminalGrowthUsed: assumptions.terminalGrowthRate,
    terminalResidualIncomePerShare,
    mortgageReitForecasts,
  };
}
