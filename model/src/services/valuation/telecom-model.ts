import type {DCFResults, TelecomHistoricalData, TelecomHistoricalYear} from '@/core/types';
import type {CanonicalFinancialLine, TelecomCanonicalFinancials} from '@/core/types/native';

export interface TelecomModelAssumptionSources {
  postpaidGrossAddRate: string;
  postpaidPhoneMonthlyChurn: string;
  otherWirelessSubscriberGrowth: string;
  serviceRevenuePerSubscriberGrowth: string;
  equipmentRevenuePerSubscriberGrowth: string;
  broadbandNetAdditionsRate: string;
  broadbandRevenuePerConnectionGrowth: string;
  consumerNonBroadbandRevenueGrowth: string;
  businessWirelineRevenueGrowth: string;
  latinAmericaRevenueGrowth: string;
  otherRevenueGrowth: string;
  mobilityOperatingMargin: string;
  businessWirelineOperatingMargin: string;
  consumerWirelineOperatingMargin: string;
  latinAmericaOperatingMargin: string;
  unallocatedOperatingIncomeMargin: string;
  taxRate: string;
  depreciationPctRevenue: string;
  capexPctRevenue: string;
  workingCapitalChangePctRevenue: string;
  costOfDebt: string;
  wacc: string;
  terminalGrowthRate: string;
}

export interface TelecomModelAssumptions {
  forecastYears: number;
  baseYear: number;
  asOfDate: string;
  postpaidGrossAddRate: number;
  postpaidPhoneMonthlyChurn: number;
  otherWirelessSubscriberGrowth: number;
  serviceRevenuePerSubscriberGrowth: number;
  equipmentRevenuePerSubscriberGrowth: number;
  broadbandNetAdditionsRate: number;
  broadbandRevenuePerConnectionGrowth: number;
  consumerNonBroadbandRevenueGrowth: number;
  businessWirelineRevenueGrowth: number;
  latinAmericaRevenueGrowth: number;
  otherRevenueGrowth: number;
  mobilityOperatingMargin: number;
  businessWirelineOperatingMargin: number;
  consumerWirelineOperatingMargin: number;
  latinAmericaOperatingMargin: number;
  unallocatedOperatingIncomeMargin: number;
  taxRate: number;
  depreciationPctRevenue: number;
  capexPctRevenue: number;
  workingCapitalChangePctRevenue: number;
  riskFreeRate: number;
  equityRiskPremium: number;
  beta: number;
  costOfDebt: number;
  debtWeight: number;
  equityWeight: number;
  wacc: number;
  terminalGrowthRate: number;
  currentPrice: number;
  marketCapitalization: number;
  dilutedShares: number;
  cash: number;
  marketableSecurities: number;
  debt: number;
  nonControllingInterest: number;
  preferredEquity: number;
  assumptionSources: TelecomModelAssumptionSources;
}

export type IncompleteTelecomModelAssumptions = Omit<TelecomModelAssumptions, 'postpaidGrossAddRate' | 'postpaidPhoneMonthlyChurn'> & {
  postpaidGrossAddRate: null;
  postpaidPhoneMonthlyChurn: null;
};

export interface TelecomForecastYear {
  year: number;
  beginningPostpaidPhoneSubscribers: number;
  grossPostpaidPhoneAdditions: number;
  postpaidGrossAddRate: number;
  postpaidPhoneMonthlyChurn: number;
  postpaidPhoneDisconnects: number;
  netPostpaidPhoneAdditions: number;
  endingPostpaidPhoneSubscribers: number;
  averagePostpaidPhoneSubscribers: number;
  beginningOtherWirelessSubscribers: number;
  otherWirelessSubscriberGrowth: number;
  endingOtherWirelessSubscribers: number;
  beginningWirelessSubscribers: number;
  endingWirelessSubscribers: number;
  averageWirelessSubscribers: number;
  monthlyServiceRevenuePerSubscriber: number;
  mobilityServiceRevenue: number;
  annualEquipmentRevenuePerSubscriber: number;
  mobilityEquipmentRevenue: number;
  mobilityRevenue: number;
  beginningBroadbandConnections: number;
  broadbandNetAdditions: number;
  broadbandNetAdditionsRate: number;
  endingBroadbandConnections: number;
  averageBroadbandConnections: number;
  monthlyBroadbandRevenuePerConnection: number;
  broadbandRevenue: number;
  consumerNonBroadbandRevenue: number;
  consumerWirelineRevenue: number;
  businessWirelineRevenue: number;
  latinAmericaRevenue: number;
  otherRevenue: number;
  totalRevenue: number;
  mobilityOperatingIncome: number;
  businessWirelineOperatingIncome: number;
  consumerWirelineOperatingIncome: number;
  latinAmericaOperatingIncome: number;
  unallocatedOperatingIncome: number;
  ebit: number;
  taxRate: number;
  cashTaxes: number;
  nopat: number;
  depreciation: number;
  capex: number;
  workingCapitalChange: number;
  freeCashFlow: number;
  discountFactor: number;
  presentValueFreeCashFlow: number;
  revenueReconciliationCheck: number;
  ebitReconciliationCheck: number;
  subscriberRollforwardCheck: number;
  broadbandRollforwardCheck: number;
}

export interface TelecomModelResult extends DCFResults {
  valuationBasis: 'enterprise';
  wacc: number;
  terminalGrowthUsed: number;
  terminalFreeCashFlow: number;
  telecomForecasts: TelecomForecastYear[];
}

interface ValidatedHistory {
  recent: TelecomHistoricalYear[];
  latest: TelecomHistoricalYear;
  serviceArpu: number[];
  equipmentRevenuePerSubscriber: number[];
  broadbandArpu: number[];
  consumerNonBroadbandRevenue: number[];
  otherRevenue: number[];
  unallocatedOperatingIncomeMargin: number[];
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`Telecom model assumption ${name} must be finite.`);
  return value;
}

function filedValue(line: CanonicalFinancialLine | undefined, name: string, year: number): number {
  if (!line || !['sec_native', 'derived'].includes(line.source)) {
    throw new Error(`FY${year} telecom input ${name} is missing or ambiguous.`);
  }
  if (typeof line.value !== 'number' || !Number.isFinite(line.value)) {
    throw new Error(`FY${year} telecom input ${name} has no finite filed or derived value.`);
  }
  if (!line.sources.length || line.sources.some((source) => !source.accession || !source.filed)) {
    throw new Error(`FY${year} telecom input ${name} has incomplete filing provenance.`);
  }
  return line.value;
}

function requiredTelecomLine(
  telecom: TelecomCanonicalFinancials | null,
  field: keyof TelecomCanonicalFinancials,
  year: number,
): number {
  if (!telecom) throw new Error(`FY${year} telecom source table is unavailable.`);
  return filedValue(telecom[field], field, year);
}

function validateHistory(history: TelecomHistoricalData): ValidatedHistory {
  if (history.annual.length < 4 || history.annual.length !== history.years.length) {
    throw new Error('Telecom subscriber DCF requires an opening customer balance and three forecast-base years.');
  }
  const recent = history.annual.slice(-4);
  for (let index = 0; index < recent.length; index += 1) {
    const item = recent[index]!;
    if (history.years.at(-4 + index) !== item.year || (index > 0 && item.year !== recent[index - 1]!.year + 1)) {
      throw new Error('Telecom annual source periods must be four consecutive, aligned fiscal years.');
    }
    const manager = item.telecom;
    const customerInputs = [
      ['wireless subscribers', manager?.wireless_subscribers],
      ['postpaid phone subscribers', manager?.postpaid_phone_subscribers],
    ] as const;
    const customerValues = Object.fromEntries(customerInputs.map(([name, line]) => [name, filedValue(line, name, item.year)]));
    if (customerValues['wireless subscribers'] <= 0 || customerValues['postpaid phone subscribers'] <= 0) {
      throw new Error(`FY${item.year} opening telecom customer balances must be positive.`);
    }
    if (index === 0) continue;
    const required = [
      ['wireless subscribers', manager?.wireless_subscribers],
      ['postpaid phone subscribers', manager?.postpaid_phone_subscribers],
      ['postpaid phone net additions', manager?.postpaid_phone_net_additions],
      ['postpaid phone churn', manager?.postpaid_phone_churn],
      ['mobility service revenue', manager?.mobility_service_revenue],
      ['mobility equipment revenue', manager?.mobility_equipment_revenue],
      ['mobility segment revenue', manager?.mobility_revenue],
      ['mobility operating income', manager?.mobility_operating_income],
      ['business wireline revenue', manager?.business_wireline_revenue],
      ['business wireline operating income', manager?.business_wireline_operating_income],
      ['consumer wireline revenue', manager?.consumer_wireline_revenue],
      ['consumer broadband revenue', manager?.consumer_broadband_revenue],
      ['consumer wireline operating income', manager?.consumer_wireline_operating_income],
      ['broadband connections', manager?.broadband_connections],
      ['broadband net additions', manager?.broadband_net_additions],
      ['Latin America revenue', manager?.latin_america_revenue],
      ['Latin America operating income', manager?.latin_america_operating_income],
      ['communications revenue', manager?.communications_revenue],
      ['communications operating income', manager?.communications_operating_income],
      ['revenue', item.revenue],
      ['EBIT', item.ebit],
      ['tax rate', item.taxRate],
      ['depreciation', item.depreciation],
      ['CapEx', item.capex],
      ['working-capital change', item.nwcChange],
    ] as const;
    const values = Object.fromEntries(required.map(([name, line]) => [name, filedValue(line, name, item.year)]));
    if (
      values['wireless subscribers'] <= 0 || values['postpaid phone subscribers'] <= 0
      || values['postpaid phone churn'] < 0 || values['postpaid phone churn'] >= 0.1
      || values['mobility service revenue'] <= 0 || values['mobility equipment revenue'] < 0
      || values['mobility segment revenue'] <= 0 || values['broadband connections'] <= 0
      || values['broadband net additions'] < -values['broadband connections']
      || values['consumer broadband revenue'] <= 0 || values['revenue'] <= 0
      || values['tax rate'] < 0 || values['tax rate'] > 0.5
      || values.depreciation < 0 || values.CapEx < 0 || Math.abs(values['working-capital change']) > values.revenue
    ) {
      throw new Error(`FY${item.year} telecom subscriber, rate, revenue, or reinvestment inputs are outside the supported range.`);
    }
    if (Math.abs(values['mobility segment revenue'] - values['mobility service revenue'] - values['mobility equipment revenue'])
      > Math.max(1, values['mobility segment revenue'] * 1e-7)) {
      throw new Error(`FY${item.year} filed Mobility revenue components do not reconcile.`);
    }
    const communicationsRevenue = requiredTelecomLine(manager, 'communications_revenue', item.year);
    const filedSegmentRevenue = requiredTelecomLine(manager, 'mobility_revenue', item.year)
      + requiredTelecomLine(manager, 'business_wireline_revenue', item.year)
      + requiredTelecomLine(manager, 'consumer_wireline_revenue', item.year);
    if (Math.abs(communicationsRevenue - filedSegmentRevenue) > Math.max(1, communicationsRevenue * 1e-7)) {
      throw new Error(`FY${item.year} filed Communications segment revenues do not reconcile.`);
    }
    const communicationsOperatingIncome = requiredTelecomLine(manager, 'communications_operating_income', item.year);
    const segmentOperatingIncome = requiredTelecomLine(manager, 'mobility_operating_income', item.year)
      + requiredTelecomLine(manager, 'business_wireline_operating_income', item.year)
      + requiredTelecomLine(manager, 'consumer_wireline_operating_income', item.year);
    if (Math.abs(communicationsOperatingIncome - segmentOperatingIncome) > Math.max(1, Math.abs(communicationsOperatingIncome) * 1e-7)) {
      throw new Error(`FY${item.year} filed Communications segment operating income does not reconcile: total ${communicationsOperatingIncome}, segment sum ${segmentOperatingIncome}.`);
    }
  }

  const serviceArpu: number[] = [];
  const equipmentRevenuePerSubscriber: number[] = [];
  const broadbandArpu: number[] = [];
  const consumerNonBroadbandRevenue: number[] = [];
  const otherRevenue: number[] = [];
  const unallocatedOperatingIncomeMargin: number[] = [];
  for (let index = 1; index < recent.length; index += 1) {
    const prior = recent[index - 1]!;
    const current = recent[index]!;
    const currentTelecom = current.telecom;
    const priorTelecom = prior.telecom;
    const averageWireless = (
      requiredTelecomLine(priorTelecom, 'wireless_subscribers', prior.year)
      + requiredTelecomLine(currentTelecom, 'wireless_subscribers', current.year)
    ) / 2;
    if (averageWireless <= 0) throw new Error(`FY${current.year} average wireless subscribers must be positive.`);
    serviceArpu.push(requiredTelecomLine(currentTelecom, 'mobility_service_revenue', current.year) / averageWireless / 12);
    equipmentRevenuePerSubscriber.push(requiredTelecomLine(currentTelecom, 'mobility_equipment_revenue', current.year) / averageWireless);
    if (priorTelecom?.broadband_connections.source !== 'missing') {
      const averageBroadband = (
        requiredTelecomLine(priorTelecom, 'broadband_connections', prior.year)
        + requiredTelecomLine(currentTelecom, 'broadband_connections', current.year)
      ) / 2;
      if (averageBroadband <= 0) throw new Error(`FY${current.year} average broadband connections must be positive.`);
      broadbandArpu.push(requiredTelecomLine(currentTelecom, 'consumer_broadband_revenue', current.year) / averageBroadband / 12);
    }
    consumerNonBroadbandRevenue.push(
      requiredTelecomLine(currentTelecom, 'consumer_wireline_revenue', current.year)
        - requiredTelecomLine(currentTelecom, 'consumer_broadband_revenue', current.year),
    );
    const segmentRevenue = requiredTelecomLine(currentTelecom, 'mobility_revenue', current.year)
      + requiredTelecomLine(currentTelecom, 'business_wireline_revenue', current.year)
      + requiredTelecomLine(currentTelecom, 'consumer_wireline_revenue', current.year)
      + requiredTelecomLine(currentTelecom, 'latin_america_revenue', current.year);
    otherRevenue.push(filedValue(current.revenue, 'consolidated revenue', current.year) - segmentRevenue);
    const segmentOperatingIncome = requiredTelecomLine(currentTelecom, 'mobility_operating_income', current.year)
      + requiredTelecomLine(currentTelecom, 'business_wireline_operating_income', current.year)
      + requiredTelecomLine(currentTelecom, 'consumer_wireline_operating_income', current.year)
      + requiredTelecomLine(currentTelecom, 'latin_america_operating_income', current.year);
    unallocatedOperatingIncomeMargin.push((filedValue(current.ebit, 'EBIT', current.year) - segmentOperatingIncome)
      / filedValue(current.revenue, 'revenue', current.year));
    if (consumerNonBroadbandRevenue.at(-1)! < 0 || otherRevenue.at(-1)! < 0) {
      throw new Error(`FY${current.year} telecom segment revenue residual is negative or unreconciled.`);
    }
  }

  const latest = recent.at(-1);
  if (!latest) throw new Error('Telecom annual history is empty.');
  return {recent, latest, serviceArpu, equipmentRevenuePerSubscriber, broadbandArpu, consumerNonBroadbandRevenue, otherRevenue, unallocatedOperatingIncomeMargin};
}

function validateAssumptions(assumptions: TelecomModelAssumptions): void {
  if (assumptions.forecastYears !== 5) throw new Error('Telecom DCF requires a five-year forecast horizon.');
  for (const [name, value] of [
    ['postpaidGrossAddRate', assumptions.postpaidGrossAddRate],
    ['postpaidPhoneMonthlyChurn', assumptions.postpaidPhoneMonthlyChurn],
    ['otherWirelessSubscriberGrowth', assumptions.otherWirelessSubscriberGrowth],
    ['serviceRevenuePerSubscriberGrowth', assumptions.serviceRevenuePerSubscriberGrowth],
    ['equipmentRevenuePerSubscriberGrowth', assumptions.equipmentRevenuePerSubscriberGrowth],
    ['broadbandNetAdditionsRate', assumptions.broadbandNetAdditionsRate],
    ['broadbandRevenuePerConnectionGrowth', assumptions.broadbandRevenuePerConnectionGrowth],
    ['consumerNonBroadbandRevenueGrowth', assumptions.consumerNonBroadbandRevenueGrowth],
    ['businessWirelineRevenueGrowth', assumptions.businessWirelineRevenueGrowth],
    ['latinAmericaRevenueGrowth', assumptions.latinAmericaRevenueGrowth],
    ['otherRevenueGrowth', assumptions.otherRevenueGrowth],
  ] as const) {
    finite(value, name);
    if (value <= -1 || value > 2) throw new Error(`Telecom ${name} must be greater than -100% and no more than 200%.`);
  }
  if (assumptions.postpaidGrossAddRate < 0 || assumptions.postpaidPhoneMonthlyChurn < 0 || assumptions.postpaidPhoneMonthlyChurn >= 0.1) {
    throw new Error('Telecom postpaid gross additions and monthly churn are outside the supported range.');
  }
  for (const [name, value] of [
    ['mobilityOperatingMargin', assumptions.mobilityOperatingMargin],
    ['businessWirelineOperatingMargin', assumptions.businessWirelineOperatingMargin],
    ['consumerWirelineOperatingMargin', assumptions.consumerWirelineOperatingMargin],
    ['latinAmericaOperatingMargin', assumptions.latinAmericaOperatingMargin],
    ['unallocatedOperatingIncomeMargin', assumptions.unallocatedOperatingIncomeMargin],
  ] as const) {
    finite(value, name);
    if (value < -1 || value > 1) throw new Error(`Telecom ${name} must be between -100% and 100%.`);
  }
  finite(assumptions.taxRate, 'taxRate');
  if (assumptions.taxRate < 0 || assumptions.taxRate > 0.5) throw new Error('Telecom tax rate must be between 0% and 50%.');
  for (const [name, value] of [
    ['depreciationPctRevenue', assumptions.depreciationPctRevenue],
    ['capexPctRevenue', assumptions.capexPctRevenue],
  ] as const) {
    finite(value, name);
    if (value < 0 || value > 1) throw new Error(`Telecom ${name} must be between 0% and 100%.`);
  }
  finite(assumptions.workingCapitalChangePctRevenue, 'workingCapitalChangePctRevenue');
  if (Math.abs(assumptions.workingCapitalChangePctRevenue) > 1) throw new Error('Telecom working-capital change must be between -100% and 100% of revenue.');
  if (assumptions.wacc < 0.02 || assumptions.wacc > 0.4 || assumptions.terminalGrowthRate < 0
    || assumptions.terminalGrowthRate > 0.08 || assumptions.terminalGrowthRate >= assumptions.wacc) {
    throw new Error('Telecom valuation requires terminal growth between 0% and 8% and below a supported WACC.');
  }
  for (const [name, value] of [
    ['riskFreeRate', assumptions.riskFreeRate], ['equityRiskPremium', assumptions.equityRiskPremium],
    ['beta', assumptions.beta], ['costOfDebt', assumptions.costOfDebt], ['debtWeight', assumptions.debtWeight],
    ['equityWeight', assumptions.equityWeight], ['currentPrice', assumptions.currentPrice],
    ['marketCapitalization', assumptions.marketCapitalization], ['dilutedShares', assumptions.dilutedShares],
    ['cash', assumptions.cash], ['marketableSecurities', assumptions.marketableSecurities], ['debt', assumptions.debt],
    ['nonControllingInterest', assumptions.nonControllingInterest], ['preferredEquity', assumptions.preferredEquity],
  ] as const) finite(value, name);
  if (assumptions.riskFreeRate <= 0 || assumptions.equityRiskPremium <= 0 || assumptions.beta <= 0
    || assumptions.costOfDebt < 0 || assumptions.debtWeight < 0 || assumptions.equityWeight <= 0
    || assumptions.currentPrice <= 0 || assumptions.marketCapitalization <= 0 || assumptions.dilutedShares <= 0
    || assumptions.cash < 0 || assumptions.marketableSecurities < 0 || assumptions.debt < 0
    || assumptions.nonControllingInterest < 0 || assumptions.preferredEquity < 0) {
    throw new Error('Telecom DCF requires positive current market inputs and non-negative bridge claims.');
  }
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(assumptions.asOfDate)) throw new Error('Telecom DCF requires a dated market context.');
  if (Object.values(assumptions.assumptionSources).some((source) => !source.trim() || /\b(default|stale|unavailable)\b/i.test(source))) {
    throw new Error('Telecom assumptions require current sources or explicit analyst-input disclosures.');
  }
}

function nonnegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Telecom ${name} forecast cannot be negative or non-finite.`);
  return value;
}

export function calculateTelecomValuation(
  history: TelecomHistoricalData,
  assumptions: TelecomModelAssumptions,
): TelecomModelResult {
  const validated = validateHistory(history);
  validateAssumptions(assumptions);
  const latest = validated.latest;
  const latestTelecom = latest.telecom;
  if (!latestTelecom) throw new Error('Latest telecom source table is unavailable.');

  let beginningPostpaidPhoneSubscribers = filedValue(latestTelecom.postpaid_phone_subscribers, 'postpaid phone subscribers', latest.year);
  let beginningOtherWirelessSubscribers = filedValue(latestTelecom.wireless_subscribers, 'wireless subscribers', latest.year)
    - beginningPostpaidPhoneSubscribers;
  let monthlyServiceRevenuePerSubscriber = validated.serviceArpu.at(-1)!;
  let annualEquipmentRevenuePerSubscriber = validated.equipmentRevenuePerSubscriber.at(-1)!;
  let beginningBroadbandConnections = filedValue(latestTelecom.broadband_connections, 'broadband connections', latest.year);
  let monthlyBroadbandRevenuePerConnection = validated.broadbandArpu.at(-1)!;
  let consumerNonBroadbandRevenue = validated.consumerNonBroadbandRevenue.at(-1)!;
  let businessWirelineRevenue = filedValue(latestTelecom.business_wireline_revenue, 'Business Wireline revenue', latest.year);
  let latinAmericaRevenue = filedValue(latestTelecom.latin_america_revenue, 'Latin America revenue', latest.year);
  let otherRevenue = validated.otherRevenue.at(-1)!;
  const telecomForecasts: TelecomForecastYear[] = [];
  let presentValueForecastFreeCashFlow = 0;

  for (let index = 1; index <= assumptions.forecastYears; index += 1) {
    const year = latest.year + index;
    const annualChurnRate = assumptions.postpaidPhoneMonthlyChurn * 12;
    const grossPostpaidPhoneAdditions = beginningPostpaidPhoneSubscribers * assumptions.postpaidGrossAddRate;
    const endingPostpaidPhoneSubscribers = (
      beginningPostpaidPhoneSubscribers + grossPostpaidPhoneAdditions - 0.5 * annualChurnRate * beginningPostpaidPhoneSubscribers
    ) / (1 + 0.5 * annualChurnRate);
    const averagePostpaidPhoneSubscribers = (beginningPostpaidPhoneSubscribers + endingPostpaidPhoneSubscribers) / 2;
    const postpaidPhoneDisconnects = averagePostpaidPhoneSubscribers * annualChurnRate;
    const netPostpaidPhoneAdditions = grossPostpaidPhoneAdditions - postpaidPhoneDisconnects;
    const endingOtherWirelessSubscribers = beginningOtherWirelessSubscribers * (1 + assumptions.otherWirelessSubscriberGrowth);
    const beginningWirelessSubscribers = beginningPostpaidPhoneSubscribers + beginningOtherWirelessSubscribers;
    const endingWirelessSubscribers = endingPostpaidPhoneSubscribers + endingOtherWirelessSubscribers;
    const averageWirelessSubscribers = (beginningWirelessSubscribers + endingWirelessSubscribers) / 2;
    monthlyServiceRevenuePerSubscriber *= 1 + assumptions.serviceRevenuePerSubscriberGrowth;
    const mobilityServiceRevenue = averageWirelessSubscribers * monthlyServiceRevenuePerSubscriber * 12;
    annualEquipmentRevenuePerSubscriber *= 1 + assumptions.equipmentRevenuePerSubscriberGrowth;
    const mobilityEquipmentRevenue = averageWirelessSubscribers * annualEquipmentRevenuePerSubscriber;
    const mobilityRevenue = mobilityServiceRevenue + mobilityEquipmentRevenue;

    const broadbandNetAdditions = beginningBroadbandConnections * assumptions.broadbandNetAdditionsRate;
    const endingBroadbandConnections = beginningBroadbandConnections + broadbandNetAdditions;
    if (endingBroadbandConnections <= 0) throw new Error(`FY${year} forecast broadband connections are not positive.`);
    const averageBroadbandConnections = (beginningBroadbandConnections + endingBroadbandConnections) / 2;
    monthlyBroadbandRevenuePerConnection *= 1 + assumptions.broadbandRevenuePerConnectionGrowth;
    const broadbandRevenue = averageBroadbandConnections * monthlyBroadbandRevenuePerConnection * 12;
    consumerNonBroadbandRevenue = nonnegative(
      consumerNonBroadbandRevenue * (1 + assumptions.consumerNonBroadbandRevenueGrowth),
      'consumer legacy-wireline revenue',
    );
    const consumerWirelineRevenue = broadbandRevenue + consumerNonBroadbandRevenue;
    businessWirelineRevenue = nonnegative(businessWirelineRevenue * (1 + assumptions.businessWirelineRevenueGrowth), 'Business Wireline revenue');
    latinAmericaRevenue = nonnegative(latinAmericaRevenue * (1 + assumptions.latinAmericaRevenueGrowth), 'Latin America revenue');
    otherRevenue = nonnegative(otherRevenue * (1 + assumptions.otherRevenueGrowth), 'other revenue');
    const totalRevenue = mobilityRevenue + consumerWirelineRevenue + businessWirelineRevenue + latinAmericaRevenue + otherRevenue;

    const mobilityOperatingIncome = mobilityRevenue * assumptions.mobilityOperatingMargin;
    const businessWirelineOperatingIncome = businessWirelineRevenue * assumptions.businessWirelineOperatingMargin;
    const consumerWirelineOperatingIncome = consumerWirelineRevenue * assumptions.consumerWirelineOperatingMargin;
    const latinAmericaOperatingIncome = latinAmericaRevenue * assumptions.latinAmericaOperatingMargin;
    const unallocatedOperatingIncome = totalRevenue * assumptions.unallocatedOperatingIncomeMargin;
    const ebit = mobilityOperatingIncome + businessWirelineOperatingIncome + consumerWirelineOperatingIncome
      + latinAmericaOperatingIncome + unallocatedOperatingIncome;
    const cashTaxes = ebit * assumptions.taxRate;
    const nopat = ebit - cashTaxes;
    const depreciation = totalRevenue * assumptions.depreciationPctRevenue;
    const capex = totalRevenue * assumptions.capexPctRevenue;
    const workingCapitalChange = totalRevenue * assumptions.workingCapitalChangePctRevenue;
    const freeCashFlow = nopat + depreciation - capex - workingCapitalChange;
    const discountFactor = 1 / Math.pow(1 + assumptions.wacc, index);
    const presentValueFreeCashFlow = freeCashFlow * discountFactor;
    if (![endingPostpaidPhoneSubscribers, postpaidPhoneDisconnects, endingWirelessSubscribers, mobilityServiceRevenue,
      mobilityEquipmentRevenue, broadbandNetAdditions, endingBroadbandConnections, broadbandRevenue, totalRevenue, ebit,
      cashTaxes, nopat, depreciation, capex, workingCapitalChange, freeCashFlow, discountFactor, presentValueFreeCashFlow]
      .every(Number.isFinite)) {
      throw new Error(`FY${year} telecom forecast contains a non-finite result.`);
    }
    const forecast = {
      year,
      beginningPostpaidPhoneSubscribers,
      grossPostpaidPhoneAdditions,
      postpaidGrossAddRate: assumptions.postpaidGrossAddRate,
      postpaidPhoneMonthlyChurn: assumptions.postpaidPhoneMonthlyChurn,
      postpaidPhoneDisconnects,
      netPostpaidPhoneAdditions,
      endingPostpaidPhoneSubscribers,
      averagePostpaidPhoneSubscribers,
      beginningOtherWirelessSubscribers,
      otherWirelessSubscriberGrowth: assumptions.otherWirelessSubscriberGrowth,
      endingOtherWirelessSubscribers,
      beginningWirelessSubscribers,
      endingWirelessSubscribers,
      averageWirelessSubscribers,
      monthlyServiceRevenuePerSubscriber,
      mobilityServiceRevenue,
      annualEquipmentRevenuePerSubscriber,
      mobilityEquipmentRevenue,
      mobilityRevenue,
      beginningBroadbandConnections,
      broadbandNetAdditions,
      broadbandNetAdditionsRate: assumptions.broadbandNetAdditionsRate,
      endingBroadbandConnections,
      averageBroadbandConnections,
      monthlyBroadbandRevenuePerConnection,
      broadbandRevenue,
      consumerNonBroadbandRevenue,
      consumerWirelineRevenue,
      businessWirelineRevenue,
      latinAmericaRevenue,
      otherRevenue,
      totalRevenue,
      mobilityOperatingIncome,
      businessWirelineOperatingIncome,
      consumerWirelineOperatingIncome,
      latinAmericaOperatingIncome,
      unallocatedOperatingIncome,
      ebit,
      taxRate: assumptions.taxRate,
      cashTaxes,
      nopat,
      depreciation,
      capex,
      workingCapitalChange,
      freeCashFlow,
      discountFactor,
      presentValueFreeCashFlow,
      revenueReconciliationCheck: totalRevenue - (mobilityRevenue + consumerWirelineRevenue + businessWirelineRevenue + latinAmericaRevenue + otherRevenue),
      ebitReconciliationCheck: ebit - (mobilityOperatingIncome + businessWirelineOperatingIncome + consumerWirelineOperatingIncome + latinAmericaOperatingIncome + unallocatedOperatingIncome),
      subscriberRollforwardCheck: endingWirelessSubscribers - (endingPostpaidPhoneSubscribers + endingOtherWirelessSubscribers),
      broadbandRollforwardCheck: endingBroadbandConnections - (beginningBroadbandConnections + broadbandNetAdditions),
    } satisfies TelecomForecastYear;
    telecomForecasts.push(forecast);
    presentValueForecastFreeCashFlow += presentValueFreeCashFlow;
    beginningPostpaidPhoneSubscribers = endingPostpaidPhoneSubscribers;
    beginningOtherWirelessSubscribers = endingOtherWirelessSubscribers;
    beginningBroadbandConnections = endingBroadbandConnections;
  }

  const terminalFreeCashFlow = telecomForecasts.at(-1)!.freeCashFlow;
  const terminalValue = terminalFreeCashFlow * (1 + assumptions.terminalGrowthRate) / (assumptions.wacc - assumptions.terminalGrowthRate);
  const pvTerminalValue = terminalValue * telecomForecasts.at(-1)!.discountFactor;
  const enterpriseValue = presentValueForecastFreeCashFlow + pvTerminalValue;
  const equityValue = enterpriseValue + assumptions.cash + assumptions.marketableSecurities - assumptions.debt
    - assumptions.nonControllingInterest - assumptions.preferredEquity;
  const impliedSharePrice = equityValue / assumptions.dilutedShares;
  const upside = impliedSharePrice / assumptions.currentPrice - 1;
  if (![terminalFreeCashFlow, terminalValue, pvTerminalValue, enterpriseValue, equityValue, impliedSharePrice, upside].every(Number.isFinite)) {
    throw new Error('Telecom valuation contains a non-finite terminal or equity-bridge result.');
  }

  return {
    forecasts: [],
    terminalValue,
    pvTerminalValue,
    enterpriseValue,
    equityValue,
    impliedSharePrice,
    shareCount: assumptions.dilutedShares,
    currentPrice: assumptions.currentPrice,
    upside,
    terminalValueGordon: terminalValue,
    terminalValueExitMultiple: 0,
    tvDivergenceFlag: false,
    avgROIC: 0,
    valueCreationFlag: false,
    confidenceScore: 0.75,
    confidenceRank: 'Medium',
    valuationBasis: 'enterprise',
    wacc: assumptions.wacc,
    terminalGrowthUsed: assumptions.terminalGrowthRate,
    terminalFreeCashFlow,
    telecomForecasts,
  };
}
