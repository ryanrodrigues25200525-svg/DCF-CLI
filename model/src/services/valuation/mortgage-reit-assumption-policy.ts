import type {NativeUnifiedPayload} from '@/core/types/native';
import type {MortgageReitHistoricalData, MortgageReitHistoricalYear} from '@/core/types';
import type {MortgageReitModelAssumptions, MortgageReitAssumptionSources} from './mortgage-reit-model';

function filedValue(line: {value: number | null; source: string; sources: Array<{accession: string | null; filed: string | null}>}, name: string, year: number): number {
  if (!['sec_native', 'derived'].includes(line.source) || typeof line.value !== 'number' || !Number.isFinite(line.value)) {
    throw new Error(`FY${year} mortgage-REIT assumption input ${name} is missing or ambiguous.`);
  }
  if (!line.sources.length || line.sources.some((source) => !source.accession || !source.filed)) {
    throw new Error(`FY${year} mortgage-REIT assumption ${name} lacks SEC filing provenance.`);
  }
  return line.value;
}

function lineSource(line: {method: string; concept: string | null; sources: Array<{
  concept: string | null;
  accession: string | null;
  filed: string | null;
  fiscal_period?: string | null;
}>}, year: number): string {
  return `FY${year} ${line.method}; ${line.sources.map((source) =>
    `${source.concept || line.concept || 'derived SEC line'} (accession ${source.accession}, filed ${source.filed}, ${source.fiscal_period || 'fiscal period unavailable'})`,
  ).join('; ')}`;
}

function median(values: number[], name: string): number {
  if (!values.length || values.some((value) => !Number.isFinite(value))) throw new Error(`Mortgage-REIT ${name} requires finite filed history.`);
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function freshTimestamp(value: number | null | undefined, name: string): void {
  const now = Date.now();
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > now || now - value > 24 * 60 * 60 * 1000) {
    throw new Error(`A current ${name} timestamp within 24 hours is required for the mortgage-REIT valuation.`);
  }
}

function positive(value: number | null | undefined, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`Mortgage-REIT model requires a positive ${name}.`);
  return value;
}

function optionalFiledValue(line: {value: number | null; source: string; sources: Array<{accession: string | null; filed: string | null}>} | null | undefined): number | null {
  if (!line || !['sec_native', 'derived'].includes(line.source) || typeof line.value !== 'number' || !Number.isFinite(line.value)) return null;
  if (!line.sources.length || line.sources.some((source) => !source.accession || !source.filed)) return null;
  return line.value;
}

function validatedCommonTangibleEquity(item: MortgageReitHistoricalYear): number {
  const perShare = filedValue(item.mortgageReit.tangible_book_value_per_common_share, 'tangible book value per common share', item.year);
  const shares = filedValue(item.mortgageReit.period_end_common_shares, 'period-end common shares', item.year);
  return perShare * shares;
}

export function buildSourcedMortgageReitModelAssumptions(
  data: NativeUnifiedPayload,
  history: MortgageReitHistoricalData,
): MortgageReitModelAssumptions {
  if (data.canonical_financials.currency?.toUpperCase() !== 'USD') throw new Error('Mortgage-REIT model requires USD-denominated canonical financials.');
  if (history.annual.length !== 4 || history.years.length !== 4) {
    throw new Error('Mortgage-REIT model requires an opening book-value observation and three operating years.');
  }
  if (history.annual.some((item, index) => item.year !== history.years[index] || (index > 0 && item.year !== history.annual[index - 1]!.year + 1))) {
    throw new Error('Mortgage-REIT model requires four consecutive, aligned filed periods.');
  }
  if (!['live', 'cached'].includes(data.data_quality.market.status) || data.market.fallback_used === true) {
    throw new Error('Mortgage-REIT model requires a current non-fallback market snapshot.');
  }
  if (!['live', 'cached'].includes(data.data_quality.valuation_context.status)) {
    throw new Error('Mortgage-REIT model requires current risk-free and equity-risk-premium inputs.');
  }
  freshTimestamp(data.market.fetched_at_ms, 'market');
  freshTimestamp(data.valuation_context.fetched_at_ms, 'valuation context');

  const recent = history.annual.slice(-3);
  const latest = recent.at(-1);
  const previous = recent.at(-2);
  if (!latest || !previous) throw new Error('Mortgage-REIT model history is incomplete.');
  const latestMortgageReit = latest.mortgageReit;
  const riskFreeRate = positive(data.valuation_context.risk_free_rate, 'risk-free rate');
  const equityRiskPremium = positive(data.valuation_context.equity_risk_premium, 'equity risk premium');
  const beta = positive(data.market.beta, 'market beta');
  const currentPrice = positive(data.market.current_price, 'share price');
  const commonSharesOutstanding = positive(
    filedValue(latestMortgageReit.period_end_common_shares, 'period-end common shares', latest.year),
    'period-end common share count',
  );
  const commonBookValuePerShare = positive(
    filedValue(latestMortgageReit.tangible_book_value_per_common_share, 'tangible book value per common share', latest.year),
    'tangible book value per common share',
  );
  const preferredLiquidationPreference = filedValue(
    latestMortgageReit.preferred_equity_liquidation_preference,
    'preferred liquidation preference',
    latest.year,
  );
  const assetYield = positive(filedValue(latestMortgageReit.average_asset_yield, 'average asset yield', latest.year), 'filed average asset yield');
  const aggregateCostOfFunds = filedValue(latestMortgageReit.average_aggregate_cost_of_funds, 'aggregate cost of funds', latest.year);
  const averageSwapRatio = filedValue(latestMortgageReit.average_swap_ratio, 'average swap ratio', latest.year);
  const averageSwapNetPayRate = filedValue(latestMortgageReit.average_swap_net_pay_rate, 'average swap net pay rate', latest.year);
  const preferredDividendYields = recent.map((item) => {
    const preferredDividends = filedValue(item.mortgageReit.preferred_dividends, 'preferred dividends', item.year);
    const prior = history.annual[history.annual.indexOf(item) - 1];
    const currentLiquidation = filedValue(item.mortgageReit.preferred_equity_liquidation_preference, 'preferred liquidation preference', item.year);
    const priorLiquidation = prior
      ? optionalFiledValue(prior.mortgageReit.preferred_equity_liquidation_preference) ?? currentLiquidation
      : currentLiquidation;
    const averageLiquidation = (currentLiquidation + priorLiquidation) / 2;
    if (averageLiquidation <= 0) throw new Error(`FY${item.year} preferred-stock liquidation preference is not positive.`);
    return preferredDividends / averageLiquidation;
  });
  const preferredDividendYield = median(preferredDividendYields, 'preferred dividend yield');
  const openingPreferredBalanceAvailable = optionalFiledValue(history.annual[0]?.mortgageReit.preferred_equity_liquidation_preference) !== null;

  const investmentMultipliers: number[] = [];
  const fundingMultipliers: number[] = [];
  // AGNC did not report period-end common shares for FY2022 in the source tables.
  // Calibrate average-balance leverage only on FY2024–FY2025, where both endpoints
  // have filed share counts, rather than manufacturing an opening common-equity balance.
  for (let index = 2; index < history.annual.length; index += 1) {
    const prior = history.annual[index - 1]!;
    const current = history.annual[index]!;
    const priorEquity = validatedCommonTangibleEquity(prior);
    const currentEquity = validatedCommonTangibleEquity(current);
    const averageCommonEquity = (priorEquity + currentEquity) / 2;
    if (averageCommonEquity <= 0) throw new Error(`FY${current.year} average tangible common equity is not positive.`);
    const investmentAssets = filedValue(current.mortgageReit.average_investment_securities_at_cost, 'average investment securities at cost', current.year)
      + filedValue(current.mortgageReit.average_tba_dollar_roll_position_at_cost, 'average TBA dollar-roll position', current.year);
    const mortgageBorrowings = filedValue(current.mortgageReit.average_mortgage_borrowings, 'average mortgage borrowings', current.year);
    investmentMultipliers.push(investmentAssets / averageCommonEquity);
    fundingMultipliers.push(mortgageBorrowings / averageCommonEquity);
  }
  const investmentAssetsToCommonEquity = median(investmentMultipliers, 'investment assets to tangible common equity');
  const mortgageBorrowingsToCommonEquity = median(fundingMultipliers, 'mortgage borrowings to tangible common equity');
  const payoutRatio = Math.min(1.5, filedValue(latestMortgageReit.common_dividends_per_share, 'common dividends per share', latest.year)
    / (filedValue(latestMortgageReit.net_income_available_to_common, 'net income available to common', latest.year)
      / filedValue(latest.dilutedShares, 'weighted average diluted shares', latest.year)));
  const operatingExpensesPctAverageAssets = median(recent.map((item) =>
    filedValue(item.mortgageReit.expenses_pct_average_assets, 'expenses as percent of average assets', item.year) / 100,
  ), 'operating expense ratio');
  const taxRate = 0;
  const costOfEquity = riskFreeRate + beta * equityRiskPremium;
  const terminalGrowthRate = 0.025;
  if (costOfEquity < 0.02 || costOfEquity > 0.4 || terminalGrowthRate >= costOfEquity) {
    throw new Error('Mortgage-REIT cost of equity must exceed terminal growth and remain within supported bounds.');
  }
  const commonDividendsPerShare = filedValue(latestMortgageReit.common_dividends_per_share, 'common dividends per share', latest.year);
  const sources: MortgageReitAssumptionSources = {
    assetYield: `FY${latest.year} filed weighted-average investment/TBA asset yield. ${lineSource(latestMortgageReit.average_asset_yield, latest.year)}`,
    assetYieldChange: 'Analyst input: 0.0 percentage-point annual change in asset yield; edit for the forward interest-rate and reinvestment case.',
    fundingCost: `FY${latest.year} filed aggregate cost of funds including repo/TBA/swap economics. ${lineSource(latestMortgageReit.average_aggregate_cost_of_funds, latest.year)}`,
    fundingCostChange: 'Analyst input: 0.0 percentage-point annual change in pre-hedge repo/TBA funding cost; swap coverage and net pay rate are modeled separately.',
    swapRatio: `FY${latest.year} filed average swap notional / mortgage borrowings ratio. ${lineSource(latestMortgageReit.average_swap_ratio, latest.year)}`,
    swapRatioChange: 'Analyst input: 0.0 annual change in swap notional / mortgage borrowing ratio; edit to sensitize hedge coverage.',
    swapNetPayRate: `FY${latest.year} filed average swap net pay/(receive) rate. Negative values represent a net receipt and reduce funding cost. ${lineSource(latestMortgageReit.average_swap_net_pay_rate, latest.year)}`,
    swapNetPayRateChange: 'Analyst input: 0.0 percentage-point annual change in swap net pay/(receive) rate; edit to sensitize hedge economics.',
    investmentAssetsToCommonEquity: `Median FY2024–FY2025 average investment securities plus net TBA balance divided by average tangible common equity; FY2022 opening common shares are not filed, so leverage calibration uses years with filed endpoint shares. See Data Review.`,
    mortgageBorrowingsToCommonEquity: `Median FY2024–FY2025 average mortgage borrowings divided by average tangible common equity; FY2022 opening common shares are not filed, so leverage calibration uses years with filed endpoint shares. See Data Review.`,
    otherIncomePctAverageAssets: 'Analyst input: 0.0% of average assets in other gains/losses; GAAP fair-value marks remain separate and are not extrapolated.',
    operatingExpensesPctAverageAssets: `Median FY2023–FY2025 filed operating expenses as a percent of average total assets. See Data Review.`,
    preferredDividendYield: `Median FY2023–FY2025 preferred cash dividends divided by preferred liquidation preference. ${openingPreferredBalanceAvailable ? 'Beginning/ending balances are averaged.' : 'FY2023 uses its filed year-end balance because FY2022 preferred liquidation preference is unavailable; later years use beginning/ending averages.'} See Data Review.`,
    payoutRatio: `FY${latest.year} filed dividends per common share divided by filed net income available to common per diluted share; editable because taxable income and GAAP earnings differ.`,
    dividendPerShareGrowth: 'Analyst input: 0.0% dividend growth from the latest filed annual common dividend; edit for a dividend policy case.',
    marketValueChangePerShare: 'Analyst input: 0.0 tangible book-value mark-to-market change per common share in the base case; rate and spread stress cases are editable.',
    taxRate: 'Analyst input: 0.0% entity-level corporate tax in the base case under REIT treatment; verify taxable subsidiaries and excise tax separately.',
    costOfEquity: `CAPM cost of equity uses risk-free rate ${riskFreeRate.toFixed(4)} from ${data.valuation_context.treasury_rate_source}, beta ${beta.toFixed(3)} from ${data.market.source}, and ERP ${equityRiskPremium.toFixed(4)} from ${data.valuation_context.erp_source}, dated ${data.valuation_context.as_of_date}.`,
    terminalGrowthRate: 'Analyst input: 2.5% perpetual residual-income growth, editable and required to remain below cost of equity.',
    commonSharesOutstanding: `FY${latest.year} period-end shares from ${lineSource(latestMortgageReit.period_end_common_shares, latest.year)}.`,
    commonBookValuePerShare: `FY${latest.year} tangible net book value per common share from ${lineSource(latestMortgageReit.tangible_book_value_per_common_share, latest.year)}.`,
    preferredLiquidationPreference: `FY${latest.year} preferred-stock liquidation preference from ${lineSource(latestMortgageReit.preferred_equity_liquidation_preference, latest.year)}.`,
    currentPrice: `Current market price ${currentPrice.toFixed(2)} from ${data.market.source}; snapshot timestamp ${new Date(data.market.fetched_at_ms!).toISOString()}; valuation context dated ${data.valuation_context.as_of_date}.`,
  };

  return {
    forecastYears: 5,
    baseYear: latest.year,
    asOfDate: String(data.valuation_context.as_of_date),
    assetYield,
    assetYieldChange: 0,
    aggregateCostOfFunds,
    fundingCostChange: 0,
    averageSwapRatio,
    swapRatioChange: 0,
    averageSwapNetPayRate,
    swapNetPayRateChange: 0,
    investmentAssetsToCommonEquity,
    mortgageBorrowingsToCommonEquity,
    otherIncomePctAverageAssets: 0,
    operatingExpensesPctAverageAssets,
    preferredDividendYield,
    payoutRatio: Number.isFinite(payoutRatio) && payoutRatio > 0 ? payoutRatio : 1,
    dividendPerShareGrowth: 0,
    marketValueChangePerShare: 0,
    taxRate,
    riskFreeRate,
    equityRiskPremium,
    beta,
    costOfEquity,
    terminalGrowthRate,
    currentPrice,
    commonSharesOutstanding,
    commonBookValuePerShare,
    preferredLiquidationPreference,
    cash: filedValue(latest.cash, 'cash and cash equivalents', latest.year),
    debt: filedValue(latestMortgageReit.repo_and_other_debt, 'period-end repo and other debt', latest.year),
    assumptionSources: sources,
  };
}
