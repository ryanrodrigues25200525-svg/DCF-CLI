import type { CanonicalFinancialLine, NativeUnifiedPayload, ReitHistoricalData } from '@/core/types';
import type { IncompleteReitModelAssumptions, ReitModelAssumptions } from './reit-model';

function filedValue(line: CanonicalFinancialLine | undefined, name: string, year: number): number {
  if (!line || !['sec_native', 'derived'].includes(line.source)) {
    throw new Error(`FY${year} REIT assumption input ${name} is missing or ambiguous.`);
  }
  if (typeof line.value !== 'number' || !Number.isFinite(line.value)) {
    throw new Error(`FY${year} REIT assumption input ${name} has no numeric value.`);
  }
  if (line.sources.length === 0 || line.sources.some((source) => !source.accession || !source.filed)) {
    throw new Error(`FY${year} REIT assumption input ${name} has incomplete SEC provenance.`);
  }
  return line.value;
}

function lineSource(line: CanonicalFinancialLine, year: number): string {
  return `FY${year} ${line.method}: ${line.sources.map((source) =>
    `${source.concept || line.concept || 'derived input'} accession ${source.accession} filed ${source.filed} ${source.fiscal_period || ''}`.trim(),
  ).join('; ')}`;
}

function currentSource(value: string | null | undefined, name: string): string {
  if (!value?.trim() || /\b(default|stale|unavailable)\b/i.test(value)) {
    throw new Error(`A current source for ${name} is required for the REIT valuation.`);
  }
  return value.trim();
}

function freshTimestamp(value: number | null | undefined, name: string): void {
  const maxAgeMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > now || now - value > maxAgeMs) {
    throw new Error(`A market ${name} timestamp within 24 hours is required for the REIT valuation.`);
  }
}

function positiveMarketValue(value: number | null | undefined, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`REIT valuation requires a positive current ${name}.`);
  }
  return value;
}

export function buildSourcedReitModelAssumptions(
  data: NativeUnifiedPayload,
  historical: ReitHistoricalData,
): ReitModelAssumptions {
  const assumptions = buildReitAssumptionValues(data, historical, false);
  if (assumptions.sameStoreNoiGrowth === null) throw new Error('Filed same-store NOI growth is required for a ready REIT model.');
  return {...assumptions, sameStoreNoiGrowth: assumptions.sameStoreNoiGrowth};
}

type ReitAssumptionValues = Omit<ReitModelAssumptions, 'sameStoreNoiGrowth'> & {sameStoreNoiGrowth: number | null};

function buildReitAssumptionValues(
  data: NativeUnifiedPayload,
  historical: ReitHistoricalData,
  allowMissingSameStoreNoiGrowth: boolean,
): ReitAssumptionValues {
  if (!['live', 'cached'].includes(data.data_quality.market.status)
    || data.market.fallback_used === true) {
    throw new Error('REIT valuation requires a current, non-fallback market snapshot.');
  }
  if (!['live', 'cached'].includes(data.data_quality.valuation_context.status)) {
    throw new Error('REIT valuation requires current risk-free and equity-risk-premium inputs.');
  }
  freshTimestamp(data.market.fetched_at_ms, 'snapshot');
  freshTimestamp(data.valuation_context.fetched_at_ms, 'valuation context');
  if (historical.annual.length !== 3) throw new Error('REIT valuation requires three filed annual periods.');
  const latest = historical.annual.at(-1);
  if (!latest) throw new Error('REIT history is empty.');
  const year = latest.year;
  const coreFfo = filedValue(latest.reit.core_ffo, 'core_ffo', year);
  const recurringCapex = filedValue(latest.reit.recurring_capex, 'recurring_capex', year);
  const analystAffo = filedValue(latest.reit.analyst_affo, 'analyst_affo', year);
  const sameStoreNoiGrowth = allowMissingSameStoreNoiGrowth
    ? null
    : filedValue(latest.reit.same_store_noi_growth, 'same_store_noi_growth', year);
  const sameStoreNoi = filedValue(latest.reit.same_store_noi_net_effective, 'same_store_noi_net_effective', year);
  const realEstateNoi = filedValue(latest.reit.real_estate_segment_noi, 'real_estate_segment_noi', year);
  const targetOccupancy = filedValue(latest.reit.occupancy, 'occupancy', year);
  const cash = filedValue(latest.cash, 'cash', year);
  const debt = filedValue(latest.longTermDebt, 'long_term_debt', year);
  const preferred = filedValue(latest.preferredEquity, 'preferred_equity', year);
  const nonControllingInterest = filedValue(latest.nonControllingInterest, 'non_controlling_interest', year);
  const distributions = filedValue(latest.reit.common_distributions, 'common_distributions', year);
  const shares = filedValue(latest.dilutedShares, 'diluted_shares', year);
  if (coreFfo <= 0 || analystAffo <= 0 || sameStoreNoi <= 0 || realEstateNoi <= 0 || recurringCapex < 0
    || cash < 0 || debt < 0 || preferred < 0 || nonControllingInterest < 0 || distributions < 0 || shares <= 0
    || targetOccupancy <= 0 || targetOccupancy >= 1) {
    throw new Error(`FY${year} REIT FFO, property, capital, and share inputs are outside supported ranges.`);
  }

  const marketCap = positiveMarketValue(data.market.market_cap, 'market capitalization');
  const currentPrice = positiveMarketValue(data.market.current_price, 'share price');
  const beta = positiveMarketValue(data.market.beta, 'beta');
  const riskFreeRate = positiveMarketValue(data.valuation_context.risk_free_rate, 'risk-free rate');
  const equityRiskPremium = positiveMarketValue(data.valuation_context.equity_risk_premium, 'equity risk premium');
  const marketEnterpriseValue = marketCap + debt + preferred + nonControllingInterest - cash;
  if (!Number.isFinite(marketEnterpriseValue) || marketEnterpriseValue <= 0) {
    throw new Error('REIT current market enterprise value is not positive after reported claims and cash.');
  }
  const navCapRate = realEstateNoi / marketEnterpriseValue;
  if (!Number.isFinite(navCapRate) || navCapRate <= 0 || navCapRate >= 0.2) {
    throw new Error('REIT market-implied NAV capitalization rate is outside the supported range.');
  }
  const recurringCapexRatio = recurringCapex / coreFfo;
  if (recurringCapexRatio < 0 || recurringCapexRatio >= 1) {
    throw new Error(`FY${year} recurring property costs must be less than Core FFO to calculate analyst AFFO.`);
  }
  const payoutRatio = distributions / analystAffo;
  const marketDataAsOfDate = data.valuation_context.as_of_date;
  if (!marketDataAsOfDate || !/^20\d{2}-\d{2}-\d{2}$/.test(marketDataAsOfDate)) {
    throw new Error('REIT valuation requires a dated market context.');
  }

  return {
    forecastYears: 5,
    sameStoreNoiGrowth,
    targetOccupancy,
    recurringCapexRatio,
    payoutRatio,
    terminalGrowthRate: 0.025,
    navCapRate,
    riskFreeRate,
    riskFreeRateSource: currentSource(data.valuation_context.treasury_rate_source, 'risk-free rate'),
    equityRiskPremium,
    equityRiskPremiumSource: currentSource(data.valuation_context.erp_source, 'equity risk premium'),
    beta,
    betaSource: currentSource(data.market.source, 'beta'),
    marketCapitalization: marketCap,
    marketDataAsOfDate,
    currentPrice,
    dilutedSharesOutstanding: shares,
    assumptionSources: {
      sameStoreNoiGrowth: sameStoreNoiGrowth === null
        ? 'Missing filed same-store NOI growth; enter the reported ratio and filing reference on Input Required.'
        : lineSource(latest.reit.same_store_noi_growth, year) + ' Used as a forecast proxy for portfolio NOI and Core FFO/AFFO growth.',
      targetOccupancy: `${lineSource(latest.reit.occupancy, year)} Held constant in the base case; changing it creates a one-time occupancy level sensitivity.` ,
      recurringCapexRatio: `FY${year} filed tenant improvements, lease commissions, and property improvements divided by Core FFO; all property-improvement spending is treated as recurring in this analyst AFFO definition.`,
      payoutRatio: `FY${year} filed common-and-preferred cash distributions divided by analyst-defined AFFO; the filing does not separately isolate preferred cash dividends in this cash-flow line.`,
      terminalGrowthRate: 'Analyst input: 2.5% perpetual AFFO growth, editable in the workbook.',
      navCapRate: `Market-implied capitalization rate: FY${year} reported real-estate segment NOI divided by current market capitalization plus long-term debt, preferred equity, and noncontrolling interest, less cash. This is a circular NAV cross-check, not an independent cap-rate estimate.`,
    },
  };
}

export function buildSourcedIncompleteReitModelAssumptions(
  data: NativeUnifiedPayload,
  historical: ReitHistoricalData,
): IncompleteReitModelAssumptions {
  const latest = historical.annual.at(-1);
  if (!latest) throw new Error('Incomplete REIT workbook requires filed annual history.');
  const line = latest.reit.same_store_noi_growth;
  if ((line.source === 'sec_native' || line.source === 'derived')
    && typeof line.value === 'number' && Number.isFinite(line.value)
    && line.sources.length > 0 && line.sources.every((source) => source.accession && source.filed)) {
    throw new Error('The latest filed same-store NOI growth is available; the REIT workbook should be complete.');
  }
  const assumptions = buildReitAssumptionValues(data, historical, true);
  return {...assumptions, sameStoreNoiGrowth: null};
}
