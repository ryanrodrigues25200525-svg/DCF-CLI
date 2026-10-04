import type {NativeUnifiedPayload} from '@/core/types/native';
import type {CanonicalFinancialLine} from '@/core/types/native';
import type {TelecomHistoricalData, TelecomHistoricalYear} from '@/core/types';
import type {IncompleteTelecomModelAssumptions, TelecomModelAssumptions, TelecomModelAssumptionSources} from './telecom-model';
import { median as medianOf, requireFiledValue } from '@/services/valuation/source-guards';

function filedValue(line: {value: number | null; source: string; sources: Array<{accession: string | null; filed: string | null}>}, name: string, year: number): number {
  return requireFiledValue(line, name, year, 'telecom assumption');
}
function filedOrNotApplicableValue(
  line: {value: number | null; source: string; method: string; sources: Array<{accession: string | null; filed: string | null}>},
  name: string,
  year: number,
): number {
  if (line.source === 'not_applicable') {
    if (!line.method.trim() || !line.sources.length || line.sources.some((source) => !source.accession || !source.filed)) {
      throw new Error(`FY${year} telecom assumption ${name} has an unproven not-applicable state.`);
    }
    return 0;
  }
  return filedValue(line, name, year);
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

function freshTimestamp(value: number | null | undefined, name: string): void {
  const now = Date.now();
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > now || now - value > 24 * 60 * 60 * 1000) {
    throw new Error(`A current ${name} timestamp within 24 hours is required for the telecom DCF.`);
  }
}

function median(values: number[], name: string): number {
  return medianOf(values, {label: 'Telecom', name});
}
function medianGrowth(values: number[], name: string, fallback = 0): number {
  const rates: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const prior = values[index - 1]!;
    const current = values[index]!;
    if (prior <= 0 || current < 0) continue;
    rates.push(current / prior - 1);
  }
  if (!rates.length || rates.some((value) => !Number.isFinite(value) || value <= -1 || value > 2)) return fallback;
  return median(rates, name);
}

function positive(value: number | null | undefined, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`Telecom DCF requires a positive ${name}.`);
  return value;
}

function recentRevenue(field: 'revenue' | 'ebit', year: TelecomHistoricalYear): number {
  return filedValue(year[field], field, year.year);
}

export function buildSourcedTelecomModelAssumptions(
  data: NativeUnifiedPayload,
  history: TelecomHistoricalData,
): TelecomModelAssumptions {
  const assumptions = buildTelecomAssumptionValues(data, history, false);
  if (assumptions.postpaidGrossAddRate === null || assumptions.postpaidPhoneMonthlyChurn === null) {
    throw new Error('Filed postpaid phone churn is required for a ready telecom model.');
  }
  return {
    ...assumptions,
    postpaidGrossAddRate: assumptions.postpaidGrossAddRate,
    postpaidPhoneMonthlyChurn: assumptions.postpaidPhoneMonthlyChurn,
  };
}

type TelecomAssumptionValues = Omit<TelecomModelAssumptions, 'postpaidGrossAddRate' | 'postpaidPhoneMonthlyChurn'> & {
  postpaidGrossAddRate: number | null;
  postpaidPhoneMonthlyChurn: number | null;
};

function hasFiledChurn(line: CanonicalFinancialLine): boolean {
  return (line.source === 'sec_native' || line.source === 'derived')
    && typeof line.value === 'number' && Number.isFinite(line.value)
    && line.sources.length > 0 && line.sources.every((source) => source.accession && source.filed);
}

function buildTelecomAssumptionValues(
  data: NativeUnifiedPayload,
  history: TelecomHistoricalData,
  allowMissingChurn: boolean,
): TelecomAssumptionValues {
  if (data.canonical_financials.currency?.toUpperCase() !== 'USD') throw new Error('Telecom subscriber DCF requires USD-denominated canonical financials.');
  if (history.annual.length < 4 || history.years.length !== history.annual.length) {
    throw new Error('Telecom subscriber DCF requires an opening customer balance and three aligned annual periods.');
  }
  if (history.annual.some((item, index) => index > 0 && item.year !== history.annual[index - 1]!.year + 1)) {
    throw new Error('Telecom subscriber DCF requires consecutive annual history.');
  }
  if (!['live', 'cached'].includes(data.data_quality.market.status) || data.market.fallback_used === true) {
    throw new Error('Telecom subscriber DCF requires a current, non-fallback market snapshot.');
  }
  if (!['live', 'cached'].includes(data.data_quality.valuation_context.status)) {
    throw new Error('Telecom subscriber DCF requires current risk-free and equity-risk-premium inputs.');
  }
  freshTimestamp(data.market.fetched_at_ms, 'market');
  freshTimestamp(data.valuation_context.fetched_at_ms, 'valuation context');

  const latest = history.annual.at(-1);
  const prior = history.annual.at(-2);
  if (!latest || !prior || !latest.telecom || !prior.telecom) throw new Error('Telecom subscriber history is incomplete.');
  const actuals = history.annual.slice(-4);
  const arpu: number[] = [];
  const equipmentPerSubscriber: number[] = [];
  const broadbandArpu: number[] = [];
  const grossAddRates: number[] = [];
  const otherWirelessGrowthRates: number[] = [];
  const broadbandNetAddRates: number[] = [];
  const postpaidChurnRates: number[] = [];
  const consumerOther: number[] = [];
  const residualRevenue: number[] = [];
  const margins = {
    mobility: [] as number[],
    business: [] as number[],
    consumer: [] as number[],
    latinAmerica: [] as number[],
    unallocated: [] as number[],
  };
  const yearsUsed = actuals.slice(-3);

  for (let index = 1; index < actuals.length; index += 1) {
    const beginning = actuals[index - 1]!;
    const current = actuals[index]!;
    const b = beginning.telecom;
    const t = current.telecom;
    if (!b || !t) throw new Error(`FY${current.year} telecom operating inputs are unavailable.`);
    const beginningWireless = filedValue(b.wireless_subscribers, 'wireless subscribers', beginning.year);
    const currentWireless = filedValue(t.wireless_subscribers, 'wireless subscribers', current.year);
    const averageWireless = (beginningWireless + currentWireless) / 2;
    const beginningPostpaidPhones = filedValue(b.postpaid_phone_subscribers, 'postpaid phone subscribers', beginning.year);
    const currentPostpaidPhones = filedValue(t.postpaid_phone_subscribers, 'postpaid phone subscribers', current.year);
    const averagePostpaidPhones = (beginningPostpaidPhones + currentPostpaidPhones) / 2;
    const churnIsFiled = hasFiledChurn(t.postpaid_phone_churn);
    const monthlyChurn = allowMissingChurn && !churnIsFiled
      ? null
      : filedValue(t.postpaid_phone_churn, 'postpaid phone churn', current.year);
    const netPostpaidPhoneAdds = filedValue(t.postpaid_phone_net_additions, 'postpaid phone net additions', current.year);
    if (monthlyChurn !== null) {
      const grossAdds = netPostpaidPhoneAdds + averagePostpaidPhones * monthlyChurn * 12;
      grossAddRates.push(grossAdds / beginningPostpaidPhones);
      postpaidChurnRates.push(monthlyChurn);
    }
    const beginningOther = beginningWireless - beginningPostpaidPhones;
    const currentOther = currentWireless - currentPostpaidPhones;
    if (beginningOther <= 0 || currentOther <= 0) throw new Error(`FY${current.year} non-postpaid wireless subscriber count is not positive.`);
    otherWirelessGrowthRates.push(currentOther / beginningOther - 1);
    const serviceRevenue = filedValue(t.mobility_service_revenue, 'Mobility service revenue', current.year);
    const equipmentRevenue = filedValue(t.mobility_equipment_revenue, 'Mobility equipment revenue', current.year);
    arpu.push(serviceRevenue / averageWireless / 12);
    equipmentPerSubscriber.push(equipmentRevenue / averageWireless);
    const currentBroadband = filedValue(t.broadband_connections, 'broadband connections', current.year);
    const broadbandRevenue = filedValue(t.consumer_broadband_revenue, 'Consumer broadband revenue', current.year);
    const beginningBroadbandLine = b.broadband_connections;
    if (beginningBroadbandLine.source !== 'missing') {
      const beginningBroadband = filedValue(beginningBroadbandLine, 'broadband connections', beginning.year);
      const averageBroadband = (beginningBroadband + currentBroadband) / 2;
      broadbandArpu.push(broadbandRevenue / averageBroadband / 12);
      broadbandNetAddRates.push(filedValue(t.broadband_net_additions, 'broadband net additions', current.year) / beginningBroadband);
    }
    consumerOther.push(filedValue(t.consumer_wireline_revenue, 'Consumer Wireline revenue', current.year) - broadbandRevenue);

    const segmentRevenue = filedValue(t.mobility_revenue, 'Mobility revenue', current.year)
      + filedValue(t.business_wireline_revenue, 'Business Wireline revenue', current.year)
      + filedValue(t.consumer_wireline_revenue, 'Consumer Wireline revenue', current.year)
      + filedValue(t.latin_america_revenue, 'Latin America revenue', current.year);
    const totalRevenue = recentRevenue('revenue', current);
    residualRevenue.push(totalRevenue - segmentRevenue);
    const segmentIncome = filedValue(t.mobility_operating_income, 'Mobility operating income', current.year)
      + filedValue(t.business_wireline_operating_income, 'Business Wireline operating income', current.year)
      + filedValue(t.consumer_wireline_operating_income, 'Consumer Wireline operating income', current.year)
      + filedValue(t.latin_america_operating_income, 'Latin America operating income', current.year);
    margins.unallocated.push((recentRevenue('ebit', current) - segmentIncome) / totalRevenue);
    if (index >= 1) {
      margins.mobility.push(filedValue(t.mobility_operating_income, 'Mobility operating income', current.year)
        / filedValue(t.mobility_revenue, 'Mobility revenue', current.year));
      margins.business.push(filedValue(t.business_wireline_operating_income, 'Business Wireline operating income', current.year)
        / filedValue(t.business_wireline_revenue, 'Business Wireline revenue', current.year));
      margins.consumer.push(filedValue(t.consumer_wireline_operating_income, 'Consumer Wireline operating income', current.year)
        / filedValue(t.consumer_wireline_revenue, 'Consumer Wireline revenue', current.year));
      margins.latinAmerica.push(filedValue(t.latin_america_operating_income, 'Latin America operating income', current.year)
        / filedValue(t.latin_america_revenue, 'Latin America revenue', current.year));
    }
  }

  if ([...residualRevenue, ...consumerOther].some((value) => value < 0)) throw new Error('Filed telecom segment/revenue reconciliation produces a negative residual.');
  const latestYear = latest.year;
  const missingChurn = actuals.slice(-3).some((item) => !hasFiledChurn(item.telecom!.postpaid_phone_churn));
  const taxRates = yearsUsed.map((item) => filedValue(item.taxRate, 'tax rate', item.year));
  const riskFreeRate = positive(data.valuation_context.risk_free_rate, 'risk-free rate');
  const equityRiskPremium = positive(data.valuation_context.equity_risk_premium, 'equity risk premium');
  const beta = positive(data.market.beta, 'market beta');
  const currentPrice = positive(data.market.current_price, 'share price');
  const marketCapitalization = positive(data.market.market_cap, 'market capitalization');
  const latestTelecom = latest.telecom;
  const priorTelecom = prior.telecom;
  if (!latestTelecom || !priorTelecom) throw new Error('Telecom debt and cost-of-debt disclosures are unavailable.');
  const currentDebt = filedValue(latestTelecom.interest_bearing_debt, 'interest-bearing debt', latestYear);
  const priorDebt = filedValue(priorTelecom.interest_bearing_debt, 'interest-bearing debt', prior.year);
  const costOfDebt = filedValue(latestTelecom.cost_of_debt, 'filed weighted-average cost of debt', latestYear);
  if (currentDebt < 0 || priorDebt < 0) throw new Error('Telecom interest-bearing debt cannot be negative.');
  if (!Number.isFinite(costOfDebt) || costOfDebt < 0 || costOfDebt > 0.2) throw new Error('Telecom filed cost of debt is outside the supported range.');
  const currentTaxRate = median(taxRates, 'tax rate');
  const totalCapital = marketCapitalization + currentDebt;
  if (totalCapital <= 0) throw new Error('Telecom market equity and debt do not form a valid capital structure.');
  const equityWeight = marketCapitalization / totalCapital;
  const debtWeight = currentDebt / totalCapital;
  const costOfEquity = riskFreeRate + beta * equityRiskPremium;
  const wacc = costOfEquity * equityWeight + costOfDebt * (1 - currentTaxRate) * debtWeight;
  const terminalGrowthRate = 0.025;
  if (!Number.isFinite(wacc) || wacc < 0.02 || wacc > 0.4 || terminalGrowthRate >= wacc) {
    throw new Error('Telecom cost of capital and terminal-growth assumptions are outside supported ranges.');
  }

  const sources: TelecomModelAssumptionSources = {
    postpaidGrossAddRate: missingChurn
      ? 'Missing one or more filed annual churn inputs; derived from annual postpaid additions and average subscribers after each missing source is entered.'
      : 'Median of FY2023–FY2025 derived gross postpaid phone additions divided by beginning subscribers; gross additions equal filed net additions plus average subscribers multiplied by monthly churn and twelve months. See the live subscriber and churn lines in Data Review.',
    postpaidPhoneMonthlyChurn: missingChurn
      ? 'Missing one or more filed annual monthly churn inputs; enter the missing annual value and source on Input Required.'
      : 'Median of FY2023–FY2025 filed monthly postpaid phone churn. See source register in Data Review.',
    otherWirelessSubscriberGrowth: 'Median growth in filed total wireless subscribers less filed postpaid phone subscribers. See source register in Data Review.',
    serviceRevenuePerSubscriberGrowth: 'Median growth in filed Mobility service revenue per average total wireless subscriber per month; this derived measure is not issuer-reported ARPU.',
    equipmentRevenuePerSubscriberGrowth: 'Median growth in filed Mobility equipment revenue per average total wireless subscriber.',
    broadbandNetAdditionsRate: 'Median of FY2024 and FY2025 filed broadband net additions divided by beginning connections. FY2023 is excluded because the filing does not present a comparable FY2022 connection population.',
    broadbandRevenuePerConnectionGrowth: 'Growth in derived monthly broadband revenue per average connection from FY2024–FY2025; FY2023 is excluded because the filing does not present a comparable FY2022 connection population.',
    consumerNonBroadbandRevenueGrowth: 'Median growth in filed Consumer Wireline revenue less separately filed broadband revenue.',
    businessWirelineRevenueGrowth: 'Median change in filed Business Wireline segment revenue. See source register in Data Review.',
    latinAmericaRevenueGrowth: 'Median change in filed Latin America segment revenue. See source register in Data Review.',
    otherRevenueGrowth: 'Median year-over-year change in consolidated revenue less filed segment revenues; the residual remains visible as a separate line.',
    mobilityOperatingMargin: 'Median filed Mobility segment operating income divided by Mobility segment revenue. See source register in Data Review.',
    businessWirelineOperatingMargin: 'Median filed Business Wireline segment operating income divided by segment revenue. See source register in Data Review.',
    consumerWirelineOperatingMargin: 'Median filed Consumer Wireline segment operating income divided by segment revenue. See source register in Data Review.',
    latinAmericaOperatingMargin: 'Median filed Latin America segment operating income divided by segment revenue. See source register in Data Review.',
    unallocatedOperatingIncomeMargin: 'Median consolidated EBIT less reported segment operating income divided by consolidated revenue; this explicit residual preserves corporate and reconciliation items.',
    taxRate: 'Median FY2023–FY2025 filed effective tax rates. See source register in Data Review.',
    depreciationPctRevenue: 'Median FY2023–FY2025 filed depreciation and amortization divided by consolidated revenue. See source register in Data Review.',
    capexPctRevenue: 'Median FY2023–FY2025 filed capital expenditures divided by consolidated revenue. See source register in Data Review.',
    workingCapitalChangePctRevenue: 'Median FY2023–FY2025 operating working-capital investment divided by consolidated revenue; based on filed cash impacts for operating assets and liabilities.',
    costOfDebt: `FY${latestYear} filed weighted-average debt interest rate including derivatives. ${lineSource(latestTelecom.cost_of_debt, latestYear)}.`,
    wacc: `CAPM cost of equity uses risk-free rate ${riskFreeRate.toFixed(4)} from ${data.valuation_context.treasury_rate_source}, beta ${beta.toFixed(3)} from ${data.market.source}, and ERP ${equityRiskPremium.toFixed(4)} from ${data.valuation_context.erp_source}; weights use current market capitalization and FY${latestYear} filed debt as of ${data.valuation_context.as_of_date}.`,
    terminalGrowthRate: 'Analyst input: 2.5% perpetual FCFF growth; editable and required to remain below WACC.',
  };

  const sourceLine = (line: CanonicalFinancialLine, name: string, year: number): number => filedValue(line, name, year);
  const ratios = {
    depreciationPctRevenue: median(yearsUsed.map((item) => sourceLine(item.depreciation, 'D&A', item.year) / sourceLine(item.revenue, 'revenue', item.year)), 'D&A intensity'),
    capexPctRevenue: median(yearsUsed.map((item) => sourceLine(item.capex, 'CapEx', item.year) / sourceLine(item.revenue, 'revenue', item.year)), 'CapEx intensity'),
    workingCapitalChangePctRevenue: median(yearsUsed.map((item) => sourceLine(item.nwcChange, 'working-capital change', item.year) / sourceLine(item.revenue, 'revenue', item.year)), 'working-capital intensity'),
  };
  const marketableSecurities = filedOrNotApplicableValue(latest.marketableSecurities, 'marketable securities', latestYear);
  const cash = filedValue(latest.cash, 'cash', latestYear);
  const nonControllingInterest = filedOrNotApplicableValue(latest.nonControllingInterest, 'noncontrolling interest', latestYear);
  const preferredEquity = filedOrNotApplicableValue(latest.preferredEquity, 'preferred equity', latestYear);
  const dilutedShares = positive(filedValue(latest.dilutedShares, 'diluted shares', latestYear), 'diluted share count');
  const historyMargins = (field: 'mobility' | 'business' | 'consumer' | 'latinAmerica'): number => median(margins[field], `${field} operating margin`);
  const otherGrowth = medianGrowth(residualRevenue, 'other/reconciliation revenue growth', 0);
  const otherWirelessGrowth = median(otherWirelessGrowthRates, 'other wireless subscriber growth');

  return {
    forecastYears: 5,
    baseYear: latestYear,
    asOfDate: String(data.valuation_context.as_of_date),
    postpaidGrossAddRate: missingChurn ? null : median(grossAddRates, 'gross postpaid phone additions rate'),
    postpaidPhoneMonthlyChurn: missingChurn ? null : median(postpaidChurnRates, 'postpaid phone monthly churn'),
    otherWirelessSubscriberGrowth: otherWirelessGrowth,
    serviceRevenuePerSubscriberGrowth: medianGrowth(arpu, 'service revenue per subscriber growth'),
    equipmentRevenuePerSubscriberGrowth: medianGrowth(equipmentPerSubscriber, 'equipment revenue per subscriber growth'),
    broadbandNetAdditionsRate: median(broadbandNetAddRates, 'broadband net additions rate'),
    broadbandRevenuePerConnectionGrowth: medianGrowth(broadbandArpu, 'broadband revenue per connection growth'),
    consumerNonBroadbandRevenueGrowth: medianGrowth(consumerOther, 'consumer non-broadband revenue growth'),
    businessWirelineRevenueGrowth: medianGrowth(actuals.slice(-3).map((item) => filedValue(item.telecom!.business_wireline_revenue, 'Business Wireline revenue', item.year)), 'Business Wireline revenue growth'),
    latinAmericaRevenueGrowth: medianGrowth(actuals.slice(-3).map((item) => filedValue(item.telecom!.latin_america_revenue, 'Latin America revenue', item.year)), 'Latin America revenue growth'),
    otherRevenueGrowth: otherGrowth,
    mobilityOperatingMargin: historyMargins('mobility'),
    businessWirelineOperatingMargin: historyMargins('business'),
    consumerWirelineOperatingMargin: historyMargins('consumer'),
    latinAmericaOperatingMargin: historyMargins('latinAmerica'),
    unallocatedOperatingIncomeMargin: median(margins.unallocated.slice(-3), 'unallocated operating income margin'),
    taxRate: currentTaxRate,
    depreciationPctRevenue: ratios.depreciationPctRevenue,
    capexPctRevenue: ratios.capexPctRevenue,
    workingCapitalChangePctRevenue: ratios.workingCapitalChangePctRevenue,
    riskFreeRate,
    equityRiskPremium,
    beta,
    costOfDebt,
    debtWeight,
    equityWeight,
    wacc,
    terminalGrowthRate,
    currentPrice,
    marketCapitalization,
    dilutedShares,
    cash,
    marketableSecurities,
    debt: currentDebt,
    nonControllingInterest,
    preferredEquity,
    assumptionSources: {
      ...sources,
      serviceRevenuePerSubscriberGrowth: `${sources.serviceRevenuePerSubscriberGrowth} FY2023–FY2025 observed monthly rates: ${arpu.slice(-3).map((value) => value.toFixed(4)).join(', ')}.`,
      equipmentRevenuePerSubscriberGrowth: `${sources.equipmentRevenuePerSubscriberGrowth} FY2023–FY2025 observed annual revenue per subscriber: ${equipmentPerSubscriber.slice(-3).map((value) => value.toFixed(4)).join(', ')}.`,
      broadbandRevenuePerConnectionGrowth: `${sources.broadbandRevenuePerConnectionGrowth} FY2023–FY2025 observed monthly rates: ${broadbandArpu.slice(-3).map((value) => value.toFixed(4)).join(', ')}.`,
      otherRevenueGrowth: `${sources.otherRevenueGrowth} Derived FY2023–FY2025 reconciliation revenue: ${residualRevenue.slice(-3).map((value) => value.toFixed(1)).join(', ')} USD actual.`,
      unallocatedOperatingIncomeMargin: `${sources.unallocatedOperatingIncomeMargin} Source-based FY2023–FY2025 margins: ${margins.unallocated.slice(-3).map((value) => value.toFixed(4)).join(', ')}.`,
    },
  };
}

export function buildSourcedIncompleteTelecomModelAssumptions(
  data: NativeUnifiedPayload,
  history: TelecomHistoricalData,
): IncompleteTelecomModelAssumptions {
  const recent = history.annual.slice(-3);
  if (!recent.some((item) => !hasFiledChurn(item.telecom!.postpaid_phone_churn))) {
    throw new Error('The latest three annual postpaid phone churn values are filed; the telecom workbook should be complete.');
  }
  const assumptions = buildTelecomAssumptionValues(data, history, true);
  return {...assumptions, postpaidGrossAddRate: null, postpaidPhoneMonthlyChurn: null};
}
