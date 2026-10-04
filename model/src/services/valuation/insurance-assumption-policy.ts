import type { InsuranceHistoricalData, NativeUnifiedPayload } from '@/core/types';
import type { CanonicalFinancialLine } from '@/core/types/native';
import type { InsuranceModelAssumptions } from './insurance-model';

function filedValue(line: CanonicalFinancialLine | undefined, name: string, year: number): number {
  if (!line || (line.source !== 'sec_native' && line.source !== 'derived')) {
    throw new Error(`FY${year} P&C assumption input ${name} is missing or ambiguous.`);
  }
  if (typeof line.value !== 'number' || !Number.isFinite(line.value)) {
    throw new Error(`FY${year} P&C assumption input ${name} has no numeric value.`);
  }
  if (line.sources.length === 0 || line.sources.some((source) => !source.accession || !source.filed)) {
    throw new Error(`FY${year} P&C assumption input ${name} has incomplete filing provenance.`);
  }
  return line.value;
}

function lineSource(line: CanonicalFinancialLine, year: number): string {
  return `FY${year} ${line.method}: ${line.sources.map((source) =>
    `${source.concept || line.concept || 'derived'} accession ${source.accession} filed ${source.filed}`,
  ).join('; ')}`;
}

function currentSource(value: string | null | undefined, name: string): string {
  if (!value?.trim() || /\b(default|stale|unavailable)\b/i.test(value)) {
    throw new Error(`A current source for ${name} is required for the P&C valuation.`);
  }
  return value.trim();
}

function positiveNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`P&C valuation requires a positive ${name}.`);
  }
  return value;
}

function freshTimestamp(value: number | null | undefined, name: string): void {
  const maxAgeMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > now || now - value > maxAgeMs) {
    throw new Error(`A market ${name} timestamp within 24 hours is required for the P&C valuation.`);
  }
}

export function buildSourcedInsuranceModelAssumptions(
  data: NativeUnifiedPayload,
  historical: InsuranceHistoricalData,
): InsuranceModelAssumptions {
  return buildInsuranceAssumptions(data, historical, false);
}

function buildInsuranceAssumptions(
  data: NativeUnifiedPayload,
  historical: InsuranceHistoricalData,
  allowMissingLatestUnpaidLossReserves: boolean,
): InsuranceModelAssumptions {
  if (!['live', 'cached'].includes(data.data_quality.market.status) || data.market.fallback_used === true) {
    throw new Error('P&C valuation requires a current, non-fallback market snapshot.');
  }
  if (!['live', 'cached'].includes(data.data_quality.valuation_context.status)) {
    throw new Error('P&C valuation requires current risk-free and equity-risk-premium inputs.');
  }
  freshTimestamp(data.market.fetched_at_ms, 'snapshot');
  freshTimestamp(data.valuation_context.fetched_at_ms, 'valuation context');
  const latestAnnual = historical.annual.at(-1);
  const priorAnnual = historical.annual.at(-2);
  if (!latestAnnual?.insurance || !priorAnnual?.insurance) {
    throw new Error('P&C forecast requires at least two filed years of premiums and reserves.');
  }
  const latest = latestAnnual.insurance;
  const prior = priorAnnual.insurance;
  const latestYear = latestAnnual.year;
  const previousYear = priorAnnual.year;

  const premiumsWritten = filedValue(latest.net_premiums_written, 'net_premiums_written', latestYear);
  const priorPremiumsWritten = filedValue(prior.net_premiums_written, 'net_premiums_written', previousYear);
  const premiumsEarned = filedValue(latest.net_premiums_earned, 'net_premiums_earned', latestYear);
  const latestInvestedAssets = filedValue(latest.invested_assets, 'invested_assets', latestYear);
  const priorInvestedAssets = filedValue(prior.invested_assets, 'invested_assets', previousYear);
  const latestInvestmentIncome = filedValue(latest.net_investment_income, 'net_investment_income', latestYear);
  const minimumStatutoryCapital = filedValue(latest.minimum_statutory_capital, 'minimum_statutory_capital', latestYear);
  const currentEquity = filedValue(latest.common_equity, 'common_equity', latestYear);
  const currentDistributions = filedValue(latest.common_equity_distributions, 'common_equity_distributions', latestYear);
  const currentNetIncome = filedValue(latest.net_income, 'net_income', latestYear);
  const taxRate = filedValue(latest.tax_rate, 'tax_rate', latestYear);
  if (premiumsWritten <= 0 || priorPremiumsWritten <= 0 || premiumsEarned <= 0
    || latestInvestedAssets <= 0 || priorInvestedAssets <= 0 || minimumStatutoryCapital <= 0
    || currentEquity <= 0 || currentNetIncome <= 0) {
    throw new Error(`FY${latestYear} P&C premium, investment, statutory-capital, income, and equity inputs must be positive.`);
  }

  const reserveObservations = historical.annual.slice(-3);
  if (reserveObservations.length < 3) throw new Error('P&C reserve assumptions require three filed annual observations.');
  const totalPaid = reserveObservations.reduce((sum, year) => {
    if (!year.insurance) throw new Error(`FY${year.year} P&C reserve schedule is missing.`);
    return sum + Math.abs(filedValue(year.insurance.losses_paid_for_reserve_rollforward, 'losses_paid_for_reserve_rollforward', year.year));
  }, 0);
  const totalIncurred = reserveObservations.reduce((sum, year) => {
    if (!year.insurance) throw new Error(`FY${year.year} P&C reserve schedule is missing.`);
    return sum + filedValue(year.insurance.losses_incurred_for_reserve_rollforward, 'losses_incurred_for_reserve_rollforward', year.year);
  }, 0);
  if (totalIncurred <= 0) throw new Error('Filed P&C incurred losses must be positive to derive paid-loss ratio.');

  const developmentLines = reserveObservations.map((year) => {
    if (!year.insurance) throw new Error(`FY${year.year} P&C history is missing.`);
    return filedValue(year.insurance.prior_year_reserve_development, 'prior_year_reserve_development', year.year);
  });
  const priorYearReserveDevelopmentRate = developmentLines.reduce((sum, value) => sum + value, 0) / developmentLines.length;
  const lossRatio = filedValue(latest.loss_ratio, 'loss_ratio', latestYear);
  const expenseRatio = filedValue(latest.expense_ratio, 'expense_ratio', latestYear);
  filedValue(latest.prior_year_reserve_development, 'prior_year_reserve_development', latestYear);
  const latestExpenses = filedValue(latest.underwriting_expenses, 'underwriting_expenses', latestYear);
  const latestUnderwritingIncome = filedValue(latest.underwriting_income, 'underwriting_income', latestYear);
  const latestLosses = filedValue(latest.losses_and_lae, 'losses_and_lae', latestYear);
  filedValue(latest.other_operations_pretax_income, 'other_operations_pretax_income', latestYear);
  filedValue(latest.other_pretax_adjustments, 'other_pretax_adjustments', latestYear);
  const currentOtherRevenue = filedValue(latest.net_investment_income, 'net_investment_income', latestYear);
  const currentLossReserves = allowMissingLatestUnpaidLossReserves
    ? null
    : filedValue(latest.unpaid_loss_reserves, 'unpaid_loss_reserves', latestYear);
  const currentReinsuranceRecoverable = filedValue(latest.reinsurance_recoverable, 'reinsurance_recoverable', latestYear);
  const underwritingDifference = premiumsEarned - latestLosses - latestExpenses - latestUnderwritingIncome;
  if (Math.abs(underwritingDifference) > premiumsEarned * 0.001) {
    throw new Error(`FY${latestYear} filed P&C underwriting income does not reconcile to premium, claims, and expense rows.`);
  }
  if ((currentLossReserves !== null && currentLossReserves <= 0)
    || currentReinsuranceRecoverable < 0 || currentOtherRevenue <= 0) {
    throw new Error(`FY${latestYear} P&C reserve and investment-income balances are invalid.`);
  }

  const riskFreeRate = positiveNumber(data.valuation_context.risk_free_rate, 'risk-free rate');
  const equityRiskPremium = positiveNumber(data.valuation_context.equity_risk_premium, 'equity risk premium');
  const beta = positiveNumber(data.market.beta, 'beta');
  const currentPrice = positiveNumber(data.market.current_price, 'current share price');
  const shares = positiveNumber(filedValue(latest.diluted_shares, 'diluted_shares', latestYear), 'SEC diluted share count');
  const marketDataAsOfDate = data.valuation_context.as_of_date;
  if (!marketDataAsOfDate || !/^20\d{2}-\d{2}-\d{2}$/.test(marketDataAsOfDate)) {
    throw new Error('P&C valuation requires a dated market context.');
  }
  const minStatLine = latest.minimum_statutory_capital;
  const minStatSource = minStatLine.sources[0];
  if (!minStatSource) throw new Error('Filed minimum statutory capital has no source metadata.');

  const premiumGrowth = premiumsWritten / priorPremiumsWritten - 1;
  const investedAssetGrowth = latestInvestedAssets / priorInvestedAssets - 1;
  const averageInvestedAssets = (latestInvestedAssets + priorInvestedAssets) / 2;
  const investmentYield = latestInvestmentIncome / averageInvestedAssets;
  if (investmentYield <= 0 || lossRatio < 0 || expenseRatio < 0 || taxRate < 0 || taxRate >= 1) {
    throw new Error(`FY${latestYear} P&C loss, expense, investment-yield, or tax assumptions are invalid.`);
  }

  return {
    forecastYears: 5,
    premiumGrowth,
    lossRatio,
    expenseRatio,
    priorYearReserveDevelopmentRate,
    netInvestmentIncomeYield: investmentYield,
    investedAssetGrowth,
    paidLossRatio: totalPaid / totalIncurred,
    reserveOtherChangesRate: 0,
    otherOperationsPretaxGrowth: 0,
    otherPretaxAdjustmentGrowth: 0,
    taxRate,
    payoutRatio: currentDistributions / currentNetIncome,
    minimumStatutoryCapitalToPremiumRatio: minimumStatutoryCapital / premiumsWritten,
    minimumStatutoryCapitalSource: `${minStatSource.concept} accession ${minStatSource.accession} filed ${minStatSource.filed}`,
    riskFreeRate,
    riskFreeRateSource: currentSource(data.valuation_context.treasury_rate_source, 'risk-free rate'),
    equityRiskPremium,
    equityRiskPremiumSource: currentSource(data.valuation_context.erp_source, 'equity risk premium'),
    beta,
    betaSource: currentSource(data.market.source, 'beta'),
    marketDataAsOfDate,
    terminalGrowthRate: 0.025,
    currentPrice,
    dilutedSharesOutstanding: shares,
    assumptionSources: {
      premiumGrowth: `FY${previousYear}–FY${latestYear} filed net-premium-written growth.`,
      lossRatio: `FY${latestYear} filed General Insurance loss ratio; it includes prior-year reserve development.`,
      expenseRatio: `FY${latestYear} filed General Insurance expense ratio.`,
      priorYearReserveDevelopmentRate: `FY2023–FY${latestYear} average filed prior-year reserve development ratio; positive values are favorable releases.`,
      netInvestmentIncomeYield: `FY${latestYear} General Insurance net investment income divided by average FY${previousYear}–FY${latestYear} invested assets.`,
      investedAssetGrowth: `FY${previousYear}–FY${latestYear} filed investment-balance growth.`,
      paidLossRatio: `FY${reserveObservations[0].year}–FY${latestYear} filed loss payments divided by losses incurred.`,
      reserveOtherChangesRate: 'Analyst assumption: 0.0% of earned premiums; FX, divestitures, and retroactive-reinsurance changes are shown separately and not projected as recurring items.',
      otherOperationsPretaxGrowth: 'Analyst assumption: 0.0% growth in the separately reported Other Operations pretax line.',
      otherPretaxAdjustmentGrowth: 'Analyst assumption: 0.0% growth in the filed-to-GAAP pretax reconciliation line.',
      taxRate: lineSource(latest.tax_rate, latestYear),
      payoutRatio: `FY${latestYear} filed common distributions divided by net income available to common.`,
      minimumStatutoryCapitalToPremiumRatio: `FY${latestYear} minimum required statutory capital divided by net premiums written.`,
      terminalGrowthRate: 'Analyst base-case assumption: 2.5% terminal residual-income growth; editable in the workbook.',
    },
  };
}

export function buildSourcedIncompleteInsuranceModelAssumptions(
  data: NativeUnifiedPayload,
  historical: InsuranceHistoricalData,
): InsuranceModelAssumptions {
  const latest = historical.annual.at(-1);
  if (!latest?.insurance) throw new Error('Incomplete P&C workbook requires filed annual history.');
  const line = latest.insurance.unpaid_loss_reserves;
  if ((line.source === 'sec_native' || line.source === 'derived')
    && typeof line.value === 'number' && Number.isFinite(line.value)
    && line.sources.length > 0
    && line.sources.every((source) => source.accession && source.filed && source.fiscal_period === `FY ${latest.year}`)) {
    throw new Error('The latest filed net loss reserve balance is available; the P&C workbook should be complete.');
  }
  return buildInsuranceAssumptions(data, historical, true);
}
