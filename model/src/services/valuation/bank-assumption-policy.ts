import type { BankHistoricalData, NativeUnifiedPayload } from '@/core/types';
import type { CanonicalFinancialLine } from '@/core/types/native';
import type { BankModelAssumptions } from './bank-model';

function requireFiledValue(line: CanonicalFinancialLine | undefined, name: string, year: number): number {
  if (!line || (line.source !== 'sec_native' && line.source !== 'derived')) {
    throw new Error(`FY${year} bank assumption input ${name} is missing or ambiguous.`);
  }
  if (typeof line.value !== 'number' || !Number.isFinite(line.value)) {
    throw new Error(`FY${year} bank assumption input ${name} has no numeric value.`);
  }
  if (line.sources.length === 0 || line.sources.some((source) => !source.accession || !source.filed)) {
    throw new Error(`FY${year} bank assumption input ${name} has incomplete filing provenance.`);
  }
  return line.value;
}

function filedLineSource(line: CanonicalFinancialLine, year: number): string {
  const sources = line.sources.map((source) =>
    `${source.concept || line.concept || 'derived'} accession ${source.accession} filed ${source.filed}`,
  );
  return `FY${year} ${line.method}: ${sources.join('; ')}`;
}

function cagrFromFiledHistory(
  historical: BankHistoricalData,
  field: 'loans_and_leases' | 'deposits',
): {rate: number; source: string} {
  const values = historical.annual.flatMap((year) => {
    const value = requireFiledValue(year.bank[field], field, year.year);
    if (value <= 0) throw new Error(`FY${year.year} bank assumption input ${field} must be positive for CAGR.`);
    return [{year: year.year, value}];
  });
  if (values.length < 3) throw new Error(`Bank assumption ${field} needs at least three filed annual observations.`);
  const first = values[0];
  const last = values[values.length - 1];
  const periods = last.year - first.year;
  if (periods <= 0) throw new Error(`Bank assumption ${field} has no positive history span.`);
  return {
    rate: Math.pow(last.value / first.value, 1 / periods) - 1,
    source: `FY${first.year}–FY${last.year} SEC ${field} CAGR (${first.value} to ${last.value}).`,
  };
}

function requirePositiveMarketInput(value: number | null | undefined, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`A live positive ${name} is required for the bank valuation.`);
  }
  return value;
}

function requireCurrentSource(value: string | null | undefined, name: string): string {
  if (!value?.trim() || /\b(default|stale|unavailable)\b/i.test(value)) {
    throw new Error(`A current source for ${name} is required for the bank valuation.`);
  }
  return value.trim();
}

function requireFreshTimestamp(value: number | null | undefined, name: string): void {
  const maxAgeMs = 24 * 60 * 60 * 1000;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > Date.now() || Date.now() - value > maxAgeMs) {
    throw new Error(`A market ${name} timestamp within 24 hours is required for the bank valuation.`);
  }
}

type SourcedBankAssumptionValues = Omit<BankModelAssumptions, 'minimumCet1Ratio' | 'minimumCet1RatioSource'> & {
  minimumCet1Ratio: number | null;
  minimumCet1RatioSource: string;
};

function buildSourcedBankAssumptionValues(
  data: NativeUnifiedPayload,
  historical: BankHistoricalData,
  minimumCet1Ratio: number | null,
  minimumCet1RatioSource: string,
): SourcedBankAssumptionValues {
  if (!['live', 'cached'].includes(data.data_quality.market.status) || data.market.fallback_used === true) {
    throw new Error('Bank valuation requires a current, non-fallback market snapshot.');
  }
  if (!['live', 'cached'].includes(data.data_quality.valuation_context.status)) {
    throw new Error('Bank valuation requires current risk-free and equity-risk-premium inputs.');
  }
  requireFreshTimestamp(data.market.fetched_at_ms, 'snapshot');
  requireFreshTimestamp(data.valuation_context.fetched_at_ms, 'valuation context');
  const latest = historical.annual.at(-1);
  const prior = historical.annual.at(-2);
  if (!latest || !prior) throw new Error('Bank valuation requires at least two filed fiscal years.');

  const loanGrowth = cagrFromFiledHistory(historical, 'loans_and_leases');
  const depositGrowth = cagrFromFiledHistory(historical, 'deposits');
  const currentLoans = requireFiledValue(latest.bank.loans_and_leases, 'loans_and_leases', latest.year);
  const priorLoans = requireFiledValue(prior.bank.loans_and_leases, 'loans_and_leases', prior.year);
  const interestIncome = requireFiledValue(latest.bank.interest_income, 'interest_income', latest.year);
  const interestExpense = requireFiledValue(latest.bank.interest_expense, 'interest_expense', latest.year);
  const netInterestIncome = requireFiledValue(latest.bank.net_interest_income, 'net_interest_income', latest.year);
  const earningAssets = requireFiledValue(latest.bank.interest_earning_assets, 'interest_earning_assets', latest.year);
  const interestBearingLiabilities = requireFiledValue(latest.bank.interest_bearing_liabilities, 'interest_bearing_liabilities', latest.year);
  const noninterestIncome = requireFiledValue(latest.bank.noninterest_income, 'noninterest_income', latest.year);
  const noninterestExpense = requireFiledValue(latest.bank.noninterest_expense, 'noninterest_expense', latest.year);
  const provision = requireFiledValue(latest.bank.provision_for_credit_losses, 'provision_for_credit_losses', latest.year);
  const distributions = requireFiledValue(latest.bank.common_equity_distributions, 'common_equity_distributions', latest.year);
  const netIncome = requireFiledValue(latest.netIncome, 'net_income', latest.year);
  const taxRate = requireFiledValue(latest.taxRate, 'tax_rate', latest.year);
  if (netIncome <= 0) throw new Error(`FY${latest.year} net income must be positive to source the bank payout ratio.`);
  if (provision < 0) throw new Error(`FY${latest.year} provision for credit losses is a release; an analyst must set a forecast provision rate.`);
  if (minimumCet1Ratio !== null && (minimumCet1Ratio <= 0 || minimumCet1Ratio >= 1)) {
    throw new Error(`FY${latest.year} minimum CET1 ratio is outside a valid range.`);
  }

  const noninterestObservations = historical.annual.flatMap((year) => {
    const line = year.bank.noninterest_income;
    if ((line.source !== 'sec_native' && line.source !== 'derived') || typeof line.value !== 'number' || line.value <= 0) return [];
    return [{year: year.year, value: requireFiledValue(line, 'noninterest_income', year.year), line}];
  });
  const recentNoninterest = noninterestObservations.slice(-3);
  let noninterestIncomeGrowth: number;
  let noninterestIncomeGrowthSource: string;
  if (
    recentNoninterest.length === 3
    && recentNoninterest[2].year === latest.year
    && recentNoninterest[1].year === recentNoninterest[0].year + 1
    && recentNoninterest[2].year === recentNoninterest[1].year + 1
  ) {
    noninterestIncomeGrowth = Math.pow(recentNoninterest[2].value / recentNoninterest[0].value, 1 / 2) - 1;
    noninterestIncomeGrowthSource = `FY${recentNoninterest[0].year}–FY${recentNoninterest[2].year} filed noninterest-income CAGR; ${filedLineSource(recentNoninterest[0].line, recentNoninterest[0].year)}; ${filedLineSource(recentNoninterest[2].line, recentNoninterest[2].year)}`;
  } else {
    const revenueSeries = historical.annual.map((year) => ({
      year: year.year,
      value: requireFiledValue(year.totalRevenue, 'total_revenue', year.year),
    }));
    if (revenueSeries.length < 3 || revenueSeries.some((item) => item.value <= 0)) {
      throw new Error('Bank noninterest-income growth proxy requires three positive filed revenue periods.');
    }
    const firstRevenue = revenueSeries[0];
    const lastRevenue = revenueSeries[revenueSeries.length - 1];
    const revenuePeriods = lastRevenue.year - firstRevenue.year;
    if (revenuePeriods <= 0) throw new Error('Bank revenue history has no positive fiscal span.');
    noninterestIncomeGrowth = Math.pow(lastRevenue.value / firstRevenue.value, 1 / revenuePeriods) - 1;
    noninterestIncomeGrowthSource = `Proxy: FY${firstRevenue.year}–FY${lastRevenue.year} total revenue CAGR because a comparative noninterest-income series is unavailable.`;
  }
  const efficiencyDenominator = netInterestIncome + noninterestIncome;
  if (efficiencyDenominator <= 0) throw new Error('Latest filed bank total revenue must be positive.');

  const riskFreeRate = requirePositiveMarketInput(data.valuation_context.risk_free_rate, 'risk-free rate');
  const equityRiskPremium = requirePositiveMarketInput(data.valuation_context.equity_risk_premium, 'equity risk premium');
  const beta = requirePositiveMarketInput(data.market.beta, 'beta');
  const currentPrice = requirePositiveMarketInput(data.market.current_price, 'current share price');
  const dilutedSharesOutstanding = requireFiledValue(latest.bank.diluted_shares, 'diluted_shares', latest.year);
  const marketDataAsOfDate = data.valuation_context.as_of_date;
  if (!marketDataAsOfDate || !/^20\d{2}-\d{2}-\d{2}$/.test(marketDataAsOfDate)) {
    throw new Error('Bank valuation requires a dated live market context.');
  }
  const tax = latest.taxRate.value;
  if (tax === null || !Number.isFinite(tax) || tax < 0 || tax >= 1) {
    throw new Error(`FY${latest.year} effective tax rate is not suitable for a bank forecast.`);
  }
  const averageLoans = (priorLoans + currentLoans) / 2;
  if (averageLoans <= 0) throw new Error('Filed average loan balance is not positive.');

  return {
    forecastYears: 5,
    earningAssetGrowth: loanGrowth.rate,
    loanGrowth: loanGrowth.rate,
    depositGrowth: depositGrowth.rate,
    earningAssetYield: interestIncome / earningAssets,
    fundingCost: interestExpense / interestBearingLiabilities,
    noninterestIncomeGrowth,
    efficiencyRatio: noninterestExpense / efficiencyDenominator,
    provisionRate: provision / averageLoans,
    taxRate: tax,
    payoutRatio: distributions / netIncome,
    minimumCet1Ratio,
    minimumCet1RatioSource,
    riskFreeRate,
    riskFreeRateSource: requireCurrentSource(data.valuation_context.treasury_rate_source, 'risk-free rate'),
    equityRiskPremium,
    equityRiskPremiumSource: requireCurrentSource(data.valuation_context.erp_source, 'equity risk premium'),
    beta,
    betaSource: requireCurrentSource(data.market.source, 'beta'),
    marketDataAsOfDate,
    terminalGrowthRate: 0.025,
    currentPrice,
    dilutedSharesOutstanding,
    assumptionSources: {
      earningAssetGrowth: `Proxy: ${loanGrowth.source}`,
      loanGrowth: loanGrowth.source,
      depositGrowth: depositGrowth.source,
      earningAssetYield: `FY${latest.year} interest income divided by filed average earning assets; ${filedLineSource(latest.bank.interest_income, latest.year)}; ${filedLineSource(latest.bank.interest_earning_assets, latest.year)}`,
      fundingCost: `FY${latest.year} interest expense divided by filed average interest-bearing liabilities; ${filedLineSource(latest.bank.interest_expense, latest.year)}; ${filedLineSource(latest.bank.interest_bearing_liabilities, latest.year)}`,
      noninterestIncomeGrowth: noninterestIncomeGrowthSource,
      efficiencyRatio: `FY${latest.year} noninterest expense divided by net interest income plus noninterest income.`,
      provisionRate: `FY${latest.year} filed credit provision divided by average FY${prior.year}–FY${latest.year} loans.`,
      taxRate: filedLineSource(latest.taxRate, latest.year),
      payoutRatio: `FY${latest.year} filed common dividends and repurchases divided by net income available to common.`,
      terminalGrowthRate: 'Analyst base-case assumption: 2.5% nominal terminal residual-income growth; editable in the workbook.',
    },
  };
}

export function buildSourcedBankModelAssumptions(
  data: NativeUnifiedPayload,
  historical: BankHistoricalData,
): BankModelAssumptions {
  const latest = historical.annual.at(-1);
  if (!latest) throw new Error('Bank valuation requires at least one filed fiscal year.');
  const minimumCet1Ratio = requireFiledValue(latest.bank.minimum_cet1_ratio, 'minimum_cet1_ratio', latest.year);
  if (minimumCet1Ratio <= 0 || minimumCet1Ratio >= 1) {
    throw new Error(`FY${latest.year} minimum CET1 ratio is outside a valid range.`);
  }
  const minimumSource = latest.bank.minimum_cet1_ratio?.sources[0];
  if (!minimumSource) throw new Error('Filed minimum CET1 requirement has no source metadata.');
  const assumptions = buildSourcedBankAssumptionValues(
    data,
    historical,
    minimumCet1Ratio,
    `${minimumSource.concept} accession ${minimumSource.accession} filed ${minimumSource.filed}`,
  );
  if (assumptions.minimumCet1Ratio === null) throw new Error('Filed minimum CET1 ratio is required for a ready bank model.');
  return {...assumptions, minimumCet1Ratio: assumptions.minimumCet1Ratio};
}

export function buildSourcedIncompleteBankModelAssumptions(
  data: NativeUnifiedPayload,
  historical: BankHistoricalData,
): SourcedBankAssumptionValues & {minimumCet1Ratio: null} {
  const latest = historical.annual.at(-1);
  if (!latest) throw new Error('Incomplete bank workbook requires filed annual history.');
  const line = latest.bank.minimum_cet1_ratio;
  if ((line.source === 'sec_native' || line.source === 'derived')
    && typeof line.value === 'number' && Number.isFinite(line.value)
    && line.sources.length > 0 && line.sources.every((source) => source.accession && source.filed)) {
    throw new Error('The latest filed minimum CET1 ratio is available; the bank workbook should be complete.');
  }
  const assumptions = buildSourcedBankAssumptionValues(
    data,
    historical,
    null,
    'Missing filed minimum CET1 ratio; enter the filed requirement and source on Input Required.',
  );
  return {...assumptions, minimumCet1Ratio: null};
}
