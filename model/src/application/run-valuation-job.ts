import type { Assumptions, AssetManagerHistoricalData, ComparableCompany, CompanyProfile, DCFResults, EnergyHistoricalData, HistoricalData, MortgageReitHistoricalData, PharmaHistoricalData, TelecomHistoricalData } from '@/core/types';
import type { CanonicalFinancialLine, ModelEligibility, NativeUnifiedPayload } from '@/core/types/native';
import {isProductionModelRoute, type ProductionValuationModel} from '@/core/types/native';
import type { BackendPort } from '@/api/backend-client';
import { getPrecedentTransactionsBySector } from '@/core/data/precedent-transactions';
import { buildBaseAssumptions, normalizeAssumptions } from '@/services/dcf/assumption-policy';
import { buildExportPayload } from '@/services/exporters/excel';
import { buildExportAssumptions, buildHistoricalFinancials } from '@/services/exporters/excel/payload-mappers';
import type {
  DcfExportPayload,
  DcfWorkbookPayload,
  IncompleteBankModelExportData,
  IncompleteAssetManagerModelExportData,
  IncompleteComparableModelExportData,
  IncompleteInsuranceModelExportData,
  IncompleteMortgageReitModelExportData,
  IncompleteReitModelExportData,
  IncompleteTelecomModelExportData,
  IncompleteIntegratedEnergyModelExportData,
  IncompleteMaturePharmaModelExportData,
  IncompleteUtilityModelExportData,
  IncompleteBiotechModelExportData,
  IncompleteLifeInsuranceModelExportData,
  IncompleteDcfExportPayload,
  ModelAssumptions,
  WorkbookInputRequirement,
} from '@/services/exporters/excel/types';
import {
  mapCanonicalBankFinancialsToHistoricals,
  mapCanonicalFinancialsToHistoricals,
  mapCanonicalInsuranceFinancialsToHistoricals,
  mapCanonicalReitFinancialsToHistoricals,
  mapCanonicalAssetManagerFinancialsToHistoricals,
  mapCanonicalTelecomFinancialsToHistoricals,
  mapCanonicalMortgageReitFinancialsToHistoricals,
  mapCanonicalEnergyFinancialsToHistoricals,
  mapCanonicalPharmaFinancialsToHistoricals,
  mapNativeProfile,
} from '@/services/integration/sec/native-normalizer';
import { formatCliInputRequiredSuccess, formatCliSuccess, getAnnualHistoryDisclosure, getRevenueHistoryError } from '@/services/cli-preflight';
import { calculateRoutedValuation } from '@/services/valuation/router';
import {resolveLifeSourceContract} from '@/services/valuation/life-source-contract.js';
import { buildOperatingModelProfile } from '@/services/valuation/operating-model';
import type { ComparableValuationInput } from '@/services/valuation/multiple-model';
import { isComparableValuationMethod } from '@/services/valuation/multiple-model';
import { buildSourcedBankModelAssumptions, buildSourcedIncompleteBankModelAssumptions } from '@/services/valuation/bank-assumption-policy';
import { buildBankModelExportPayload } from '@/services/exporters/excel/bank-payload';
import { buildSourcedInsuranceModelAssumptions, buildSourcedIncompleteInsuranceModelAssumptions } from '@/services/valuation/insurance-assumption-policy';
import { buildInsuranceModelExportPayload, buildIncompleteInsuranceModelExportData } from '@/services/exporters/excel/insurance-payload';
import { buildSourcedIncompleteReitModelAssumptions, buildSourcedReitModelAssumptions } from '@/services/valuation/reit-assumption-policy';
import { buildIncompleteReitModelExportData, buildReitModelExportPayload } from '@/services/exporters/excel/reit-payload';
import { buildSourcedAssetManagerModelAssumptions, buildSourcedIncompleteAssetManagerModelAssumptions } from '@/services/valuation/asset-manager-assumption-policy';
import type { AssetManagerModelAssumptions } from '@/services/valuation/asset-manager-model';
import { buildAssetManagerModelExportPayload, buildIncompleteAssetManagerModelExportData } from '@/services/exporters/excel/asset-manager-payload';
import { buildSourcedIncompleteTelecomModelAssumptions, buildSourcedTelecomModelAssumptions } from '@/services/valuation/telecom-assumption-policy';
import type { TelecomModelAssumptions } from '@/services/valuation/telecom-model';
import { buildIncompleteTelecomModelExportData, buildTelecomModelExportPayload } from '@/services/exporters/excel/telecom-payload';
import { buildSourcedMortgageReitModelAssumptions } from '@/services/valuation/mortgage-reit-assumption-policy';
import type { MortgageReitModelAssumptions } from '@/services/valuation/mortgage-reit-model';
import { buildIncompleteMortgageReitModelExportData, buildMortgageReitModelExportPayload } from '@/services/exporters/excel/mortgage-reit-payload';
import { buildSourcedIncompleteIntegratedEnergyAssumptions, buildSourcedIntegratedEnergyModelAssumptions } from '@/services/valuation/integrated-energy-assumption-policy';
import type { IntegratedEnergyAssumptions } from '@/services/valuation/integrated-energy-model';
import { buildIncompleteIntegratedEnergyModelExportData, buildIntegratedEnergyModelExportPayload } from '@/services/exporters/excel/integrated-energy-payload';
import { buildSourcedIncompleteMaturePharmaModelAssumptions, buildSourcedMaturePharmaModelAssumptions } from '@/services/valuation/mature-pharma-assumption-policy';
import type { MaturePharmaModelAssumptions } from '@/services/valuation/mature-pharma-model';
import { buildIncompleteMaturePharmaModelExportData, buildMaturePharmaModelExportPayload } from '@/services/exporters/excel/mature-pharma-payload';
import { selectBiotechAssetsForRnpv, selectOtherBiotechAssetsForRnpv } from '@/services/valuation/biotech-rnpv-model';
import type { BiotechRnpvAssumptions } from '@/services/valuation/biotech-rnpv-model';
import type { LifeInsuranceDcfAssumptions } from '@/services/valuation/life-insurance-model';
import type { UtilityModelAssumptions } from '@/services/valuation/utility-model';
import {
  buildSourcedBiotechRnpvAssumptions,
  buildSourcedLifeInsuranceAssumptions,
  buildSourcedUtilityModelAssumptions,
} from '@/services/valuation/specialist-ready-assumptions.js';
import { buildBiotechModelExportPayload } from '@/services/exporters/excel/biotech-payload';
import { buildUtilityModelExportPayload } from '@/services/exporters/excel/utility-payload';
import { buildIncompleteLifeInsuranceModelExportData } from '@/services/exporters/excel/life-insurance-payload';
import { median } from '@/services/valuation/source-guards';

interface ValuationJobResultBase {
  profile: CompanyProfile;
  exportPayload: DcfWorkbookPayload;
  workbookBytes: Uint8Array;
  warnings: string[];
}

export interface ReadyValuationJobResult extends ValuationJobResultBase {
  status: 'ready';
  results: DCFResults;
  exportPayload: DcfExportPayload;
}

export interface IncompleteValuationJobResult extends ValuationJobResultBase {
  status: 'input_required';
  results: null;
  missingInputs: WorkbookInputRequirement[];
  exportPayload: IncompleteDcfExportPayload;
}

export type ValuationJobResult = ReadyValuationJobResult | IncompleteValuationJobResult;

/** Fail closed instead of wall-clock-dating sources when the backend omits its valuation date (#55). */
export function requireValuationAsOfDate(data: Pick<NativeUnifiedPayload, 'valuation_context'>): string {
  const asOfDate = data.valuation_context.as_of_date;
  if (!asOfDate || !/^20\d{2}-\d{2}-\d{2}$/.test(asOfDate)) {
    throw new Error('Export requires a dated valuation context; refusing to wall-clock-date sources.');
  }
  return asOfDate;
}

/** Ready-path specialist workbook warnings exist for every specialist model, not just asset managers (#47). */
export function specialistModelWarnings(exportPayload: DcfExportPayload, hasSpecialistModel: boolean): string[] {
  if (!hasSpecialistModel) return [];
  return exportPayload.uiMeta?.warnings ?? [];
}

const OPERATING_DIAGNOSTIC_MODELS: ReadonlySet<string> = new Set(['unlevered_dcf', 'ev_ebitda', 'revenue_multiple']);

/** Model-aware ready-path failure diagnostic: operating internals only for operating routes (#56). */
export function valuationFailureMessage(
  ticker: string,
  eligibility: ModelEligibility,
  results: DCFResults,
  assumptions: Assumptions,
): string {
  const reason = eligibility.blocked_models.find((item) => item.reason)?.reason
    ?? results.modelWarning
    ?? results.sectorWarning;
  if (reason) return reason;
  if (OPERATING_DIAGNOSTIC_MODELS.has(eligibility.preferred_model)) {
    return `The DCF engine could not produce a valid valuation for ${ticker} (supported=${results.isValuationSupported}; EV=${results.enterpriseValue}; common equity=${results.equityValue}; shares=${results.shareCount}; implied share price=${results.impliedSharePrice}; WACC=${assumptions.wacc}; tax=${assumptions.taxRate}; EBIT margin=${assumptions.ebitMargin}; CapEx ratio=${assumptions.capexRatio}; NWC residual=${assumptions.nwcChangeRatio}; first FCFF=${results.forecasts[0]?.fcff}; final FCFF=${results.forecasts.at(-1)?.fcff}; terminal value=${results.terminalValue}; terminal growth value=${results.terminalValueGordon}).`;
  }
  return `The ${eligibility.preferred_model} engine could not produce a valid valuation for ${ticker} (supported=${results.isValuationSupported}; EV=${results.enterpriseValue}; common equity=${results.equityValue}; shares=${results.shareCount}; implied share price=${results.impliedSharePrice}; forecasts=${results.forecasts.length}; terminal value=${results.terminalValue}).`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function readNumber(record: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

function normalizePeers(rawPeers: unknown): ComparableCompany[] {
  if (!Array.isArray(rawPeers)) return [];
  return rawPeers.flatMap((item) => {
    const peer = asRecord(item);
    const ticker = readString(peer, 'ticker', 'symbol').toUpperCase();
    if (!ticker) return [];
    return [{
      ticker,
      name: readString(peer, 'name', 'company') || ticker,
      sector: readString(peer, 'sector'),
      industry: readString(peer, 'industry'),
      marketCap: readNumber(peer, 'marketCap', 'market_cap'),
      enterpriseValue: readNumber(peer, 'enterpriseValue', 'enterprise_value'),
      evRevenue: readNumber(peer, 'evRevenue', 'ev_revenue'),
      evEbitda: readNumber(peer, 'evEbitda', 'ev_ebitda'),
      peRatio: readNumber(peer, 'peRatio', 'pe_ratio'),
      pbRatio: readNumber(peer, 'pbRatio', 'pb_ratio'),
      revenue: readNumber(peer, 'revenue'),
      ebitda: readNumber(peer, 'ebitda'),
      revenueGrowth: readNumber(peer, 'revenueGrowth', 'revenue_growth'),
      ebitdaMargin: readNumber(peer, 'ebitdaMargin', 'margin'),
      currency: readString(peer, 'currency') || undefined,
      beta: readNumber(peer, 'beta'),
      totalDebt: readNumber(peer, 'totalDebt', 'total_debt'),
      cash: readNumber(peer, 'cash'),
      taxRate: readNumber(peer, 'taxRate', 'tax_rate'),
      price: readNumber(peer, 'price'),
      sharesOutstanding: readNumber(peer, 'sharesOutstanding', 'shares_outstanding'),
      isSelected: peer.isSelected === undefined ? true : Boolean(peer.isSelected),
    } satisfies ComparableCompany];
  });
}

function currentSource(value: string | null | undefined, name: string): string {
  if (!value?.trim() || /\b(default|stale|unavailable)\b/i.test(value)) {
    throw new Error(`A current source for ${name} is required for the operating DCF.`);
  }
  return value.trim();
}

function freshTimestamp(value: number | null | undefined, name: string): void {
  const maxAgeMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > now || now - value > maxAgeMs) {
    throw new Error(`A current ${name} timestamp within 24 hours is required for the operating DCF.`);
  }
}

function requireCurrentMarketData(data: NativeUnifiedPayload): {
  riskFreeRate: number;
  equityRiskPremium: number;
  beta: number;
  marketCap: number;
  currentPrice: number;
  asOfDate: string;
  marketSource: string;
  riskFreeRateSource: string;
  erpSource: string;
} {
  if (!['live', 'cached'].includes(data.data_quality.market.status) || data.market.fallback_used === true) {
    throw new Error('Operating DCF requires a current, non-fallback market snapshot.');
  }
  if (!['live', 'cached'].includes(data.data_quality.valuation_context.status)) {
    throw new Error('Operating DCF requires current risk-free and equity-risk-premium inputs.');
  }
  freshTimestamp(data.market.fetched_at_ms, 'market');
  freshTimestamp(data.valuation_context.fetched_at_ms, 'valuation-context');
  const positive = (value: number | null | undefined, label: string): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`Operating DCF requires a positive current ${label}.`);
    }
    return value;
  };
  const riskFreeRate = positive(data.valuation_context.risk_free_rate, 'risk-free rate');
  const equityRiskPremium = positive(data.valuation_context.equity_risk_premium, 'equity risk premium');
  const beta = positive(data.market.beta, 'beta');
  const marketCap = positive(data.market.market_cap, 'market capitalization');
  const currentPrice = positive(data.market.current_price, 'share price');
  if (riskFreeRate > 0.15 || equityRiskPremium < 0.02 || equityRiskPremium > 0.15 || beta < 0.2 || beta > 3) {
    throw new Error('Current risk-free rate, ERP, or beta is outside the supported CAPM input range.');
  }
  const asOfDate = data.valuation_context.as_of_date;
  if (!asOfDate || !/^20\d{2}-\d{2}-\d{2}$/.test(asOfDate)) {
    throw new Error('Operating DCF requires a dated market and rate context.');
  }
  return {
    riskFreeRate,
    equityRiskPremium,
    beta,
    marketCap,
    currentPrice,
    asOfDate,
    marketSource: currentSource(data.market.source, 'market quote and beta'),
    riskFreeRateSource: currentSource(data.valuation_context.treasury_rate_source, 'risk-free rate'),
    erpSource: currentSource(data.valuation_context.erp_source, 'equity risk premium'),
  };
}

function sourcedHistoricalLine(historicals: HistoricalData, field: string, index: number): CanonicalFinancialLine {
  const line = historicals.sourceData?.[field]?.[index];
  if (!line || !['sec_native', 'derived'].includes(line.source)
    || typeof line.value !== 'number' || !Number.isFinite(line.value)
    || line.sources.length === 0
    || line.sources.some((source) => !source.accession || !source.filed)) {
    throw new Error(`FY${historicals.years[index]} operating DCF input ${field} must have a filed SEC value and provenance.`);
  }
  return line;
}

function deriveOperatingWorkingCapitalDays(historicals: HistoricalData): {
  accountsReceivableDays: number;
  inventoryDays: number;
  accountsPayableDays: number;
  nwcChangeRatio: number;
  sourceNotes: string[];
} {
  const index = historicals.years.length - 1;
  if (index < 0) throw new Error('Operating DCF requires filed working-capital history.');

  const filedBalance = (field: 'accounts_receivable' | 'inventory' | 'accounts_payable'): number => {
    const line = historicals.sourceData?.[field]?.[index];
    if (line?.source === 'not_applicable') {
      if (!line.method.trim() || !line.sources.some((source) => source.accession && source.filed)) {
        throw new Error(`FY${historicals.years[index]} ${field} is marked not applicable without filed provenance.`);
      }
      return 0;
    }
    return sourcedHistoricalLine(historicals, field, index).value!;
  };

  const revenue = sourcedHistoricalLine(historicals, 'revenue', index).value!;
  const costOfRevenue = Math.abs(sourcedHistoricalLine(historicals, 'cost_of_revenue', index).value!);
  const receivables = filedBalance('accounts_receivable');
  const inventory = filedBalance('inventory');
  const payables = filedBalance('accounts_payable');
  if (revenue <= 0 || costOfRevenue <= 0 || receivables < 0 || inventory < 0 || payables < 0) {
    throw new Error(`FY${historicals.years[index]} filed revenue, cost of revenue, receivables, inventory, or payables are not usable for a days-based working-capital schedule.`);
  }

  const accountsReceivableDays = receivables / revenue * 365;
  const inventoryDays = inventory / costOfRevenue * 365;
  const accountsPayableDays = payables / costOfRevenue * 365;
  const days = [accountsReceivableDays, inventoryDays, accountsPayableDays];
  if (days.some((value) => !Number.isFinite(value) || value < 0 || value > 3650)) {
    throw new Error(`FY${historicals.years[index]} filed working-capital balances imply unsupported operating days.`);
  }

  const sources = ['accounts_receivable', 'inventory', 'accounts_payable', 'revenue', 'cost_of_revenue']
    .map((field) => {
      const line = historicals.sourceData?.[field]?.[index] ?? sourcedHistoricalLine(historicals, field, index);
      const source = line.sources[0];
      return `${field} ${line.source === 'not_applicable' ? 'not applicable' : line.value}; ${line.concept ?? 'derived SEC line'}; accession ${source.accession}; filed ${source.filed}; ${line.method}`;
    });
  return {
    accountsReceivableDays,
    inventoryDays,
    accountsPayableDays,
    nwcChangeRatio: 0,
    sourceNotes: [
      `FY${historicals.years[index]} working-capital days are initialized from filed balances: DSO ${accountsReceivableDays.toFixed(1)} = receivables / revenue x 365; DIO ${inventoryDays.toFixed(1)} = inventory / cost of revenue x 365; DPO ${accountsPayableDays.toFixed(1)} = payables / cost of revenue x 365. ${sources.join('; ')}.`,
    ],
  };
}

function deriveSubscriptionSoftwareWorkingCapital(historicals: HistoricalData): {
  accountsReceivableDays: number;
  inventoryDays: number;
  accountsPayableDays: number;
  nwcChangeRatio: number;
  sourceNotes: string[];
} {
  const index = historicals.years.length - 1;
  if (index < 0) throw new Error('Subscription software DCF requires filed working-capital history.');
  const year = historicals.years[index];
  const revenue = sourcedHistoricalLine(historicals, 'revenue', index).value!;
  const costOfRevenue = Math.abs(sourcedHistoricalLine(historicals, 'cost_of_revenue', index).value!);
  const aggregate = sourcedHistoricalLine(historicals, 'operating_net_working_capital', index);
  if (revenue <= 0 || costOfRevenue <= 0) {
    throw new Error(`FY${year} filed revenue and cost of revenue are not usable for the software working-capital schedule.`);
  }

  const latestFiledBalance = (field: 'accounts_receivable' | 'inventory' | 'accounts_payable'): number => {
    const line = historicals.sourceData?.[field]?.[index];
    if (line?.source === 'not_applicable') {
      if (!line.method.trim() || !line.sources.some((source) => source.accession && source.filed)) {
        throw new Error(`FY${year} ${field} is marked not applicable without filed provenance.`);
      }
      return 0;
    }
    if (line?.source === 'missing') return 0;
    const filed = sourcedHistoricalLine(historicals, field, index).value!;
    if (filed < 0) throw new Error(`FY${year} ${field} cannot be negative for the software working-capital schedule.`);
    return filed;
  };

  const receivables = latestFiledBalance('accounts_receivable');
  const inventory = latestFiledBalance('inventory');
  const payables = latestFiledBalance('accounts_payable');
  const accountsReceivableDays = receivables / revenue * 365;
  const inventoryDays = inventory / costOfRevenue * 365;
  const accountsPayableDays = payables / costOfRevenue * 365;
  const days = [accountsReceivableDays, inventoryDays, accountsPayableDays];
  if (days.some((value) => !Number.isFinite(value) || value < 0 || value > 3650)) {
    throw new Error(`FY${year} filed software working-capital balances imply unsupported operating days.`);
  }
  const scheduleWorkingCapital = receivables + inventory - payables;
  const nwcChangeRatio = (aggregate.value! - scheduleWorkingCapital) / revenue;
  if (!Number.isFinite(nwcChangeRatio) || Math.abs(nwcChangeRatio) > 5) {
    throw new Error(`FY${year} filed aggregate operating working capital implies an unsupported residual intensity.`);
  }
  const aggregateSource = aggregate.sources[0];
  return {
    accountsReceivableDays,
    inventoryDays,
    accountsPayableDays,
    nwcChangeRatio,
    sourceNotes: [
      `FY${year} subscription-software working capital reconciles filed operating net working capital of ${aggregate.value}; calculated as noncash current assets less current liabilities plus current debt (${aggregate.concept}; accession ${aggregateSource?.accession}; filed ${aggregateSource?.filed}). Separately filed receivables, inventory, and payables use editable day drivers where available; the remaining balance is an editable aggregate working-capital residual of ${(nwcChangeRatio * 100).toFixed(2)}% of revenue. Missing individual components remain flagged in Data Review.`,
    ],
  };
}

function buildOperatingTaxRate(historicals: HistoricalData): {rate: number; sourceNote: string} {
  const recentIndices = historicals.years
    .map((_year, index) => index)
    .slice(-3);
  const valid = recentIndices.flatMap((index) => {
    const line = historicals.sourceData?.tax_rate?.[index];
    if (!line || !['sec_native', 'derived'].includes(line.source)
      || typeof line.value !== 'number' || !Number.isFinite(line.value)
      || line.value < 0 || line.value > 0.5
      || line.sources.length === 0
      || line.sources.some((source) => !source.accession || !source.filed)) {
      return [];
    }
    const source = line.sources[0];
    return [{index, rate: line.value, concept: line.concept ?? 'derived SEC tax line', accession: source.accession!, filed: source.filed!}];
  });

  const latestIndex = historicals.years.length - 1;
  const latest = valid.find((item) => item.index === latestIndex);
  if (latest) {
    return {
      rate: latest.rate,
      sourceNote: `Tax assumption starts from FY${historicals.years[latest.index]} filed income-tax expense divided by filed pretax income (${latest.concept}; accession ${latest.accession}; filed ${latest.filed}); the rate remains editable.`,
    };
  }
  if (valid.length < 2) {
    throw new Error('Operating DCF requires a current filed tax rate or at least two source-ready effective tax rates in the latest three fiscal years.');
  }
  const rate = valid.reduce((sum, item) => sum + item.rate, 0) / valid.length;
  if (!Number.isFinite(rate) || rate < 0 || rate > 0.5) {
    throw new Error('The normalized filed historical tax rate is outside the supported 0%–50% range.');
  }
  const normalizedSources = valid.map((item) =>
    `FY${historicals.years[item.index]} ${(item.rate * 100).toFixed(2)}% (${item.concept}; accession ${item.accession}; filed ${item.filed})`,
  );
  const latestLine = historicals.sourceData?.tax_rate?.[latestIndex];
  const excludedNote = latestLine && typeof latestLine.value === 'number'
    ? ` FY${historicals.years[latestIndex]} ${(latestLine.value * 100).toFixed(2)}% was excluded because it is outside the 0%–50% supported range.`
    : '';
  return {
    rate,
    sourceNote: `Tax assumption is the arithmetic average of the source-ready filed rates ${normalizedSources.join('; ')}.${excludedNote} This normalization is an editable analyst assumption, not a reported rate.`,
  };
}

function operatingCapitalInputs(data: NativeUnifiedPayload, historicals: HistoricalData, marketCap: number): {
  taxRate: number;
  debt: number;
  costOfDebt: number;
  leverageTarget: number;
  sourceNotes: string[];
} {
  const last = historicals.years.length - 1;
  const prior = last - 1;
  if (last < 1) throw new Error('Operating DCF requires two filed years for debt and interest analysis.');
  const debtLine = sourcedHistoricalLine(historicals, 'debt', last);
  const priorDebtLine = sourcedHistoricalLine(historicals, 'debt', prior);
  const debt = debtLine.value!;
  const tax = buildOperatingTaxRate(historicals);
  const taxRate = tax.rate;
  if (debt < 0 || taxRate < 0 || taxRate > 0.5) {
    throw new Error('Filed debt or effective tax rate is outside the supported operating DCF range.');
  }
  let costOfDebt = 0;
  let costOfDebtSource = '';
  if (debt > 0) {
    const interestLine = historicals.sourceData?.interest_expense?.[last];
    if (interestLine?.source === 'ambiguous') {
      throw new Error(`FY${historicals.years[last]} interest-expense candidates are ambiguous; the operating DCF cannot select a debt cost.`);
    }
    if (interestLine?.source === 'sec_native' || interestLine?.source === 'derived') {
      const filedInterest = sourcedHistoricalLine(historicals, 'interest_expense', last);
      const averageDebt = (priorDebtLine.value! + debt) / 2;
      if (averageDebt <= 0) throw new Error('Operating DCF requires positive average debt to derive cost of debt.');
      costOfDebt = Math.abs(filedInterest.value!) / averageDebt;
      costOfDebtSource = `Filed interest expense divided by average FY${historicals.years[prior]}–FY${historicals.years[last]} debt; source concept ${filedInterest.concept ?? 'derived SEC line'}, accession ${filedInterest.sources[0]?.accession}, filed ${filedInterest.sources[0]?.filed}.`;
    } else {
      const debtCostFact = data.financials_native.issuer_debt_cost_facts?.find((fact) =>
        fact.concept === 'IssuerRecentDebtIssueEffectiveRateRangeMidpoint'
        && fact.fiscal_year === historicals.years[last]
        && fact.unit === 'percent'
        && fact.unit_scale === 'percent'
        && typeof fact.value === 'number'
        && fact.value > 0
        && fact.value < 20
        && Boolean(fact.accession_number && fact.filing_date),
      );
      if (!debtCostFact || typeof debtCostFact.value !== 'number') {
        throw new Error(`FY${historicals.years[last]} interest expense is missing and the latest 10-K does not provide a usable new-issuance debt-rate range.`);
      }
      costOfDebt = debtCostFact.value / 100;
      costOfDebtSource = `Explicit analyst proxy: midpoint of issuer FY${debtCostFact.fiscal_year} new-issuance effective-rate range (${debtCostFact.value}%), from SEC accession ${debtCostFact.accession_number}, filed ${debtCostFact.filing_date}; not a weighted-average yield for all outstanding debt.`;
    }
    if (!Number.isFinite(costOfDebt) || costOfDebt < 0.01 || costOfDebt > 0.2) {
      throw new Error('Operating DCF cost of debt is outside the supported 1%–20% range.');
    }
  }
  const leverageTarget = debt / (debt + marketCap);
  if (!Number.isFinite(leverageTarget) || leverageTarget < 0 || leverageTarget > 0.7) {
    throw new Error('Filed debt and current market capitalization imply leverage above the supported 70% limit.');
  }
  const sourceNotes = [
    tax.sourceNote,
    `Capital weights use the current market capitalization from ${data.market.source} as of ${data.valuation_context.as_of_date} and FY${historicals.years[last]} filed debt.`,
  ];
  if (debt > 0) {
    sourceNotes.push(`Cost of debt ${costOfDebt.toFixed(4)}; ${costOfDebtSource}`);
  } else {
    sourceNotes.push('No filed interest-bearing debt is reported; cost of debt is zero-weighted and excluded from WACC.');
  }
  return {taxRate, debt, costOfDebt, leverageTarget, sourceNotes};
}

function sourcedTerminalMultiple(
  data: NativeUnifiedPayload,
  peers: ComparableCompany[],
): {multiple: number; sourceNote: string} {
  const peerQuality = data.data_quality.peers;
  if (
    !peerQuality
    || !['live', 'cached'].includes(peerQuality.status)
    || peerQuality.fallback_used
    || !currentSource(peerQuality.source, 'comparable-company data')
  ) {
    throw new Error('Operating DCF requires a current curated peer set for its terminal EV/EBITDA multiple.');
  }
  freshTimestamp(peerQuality.fetched_at_ms ?? undefined, 'comparable-company data');
  const peerValues = peers.filter((peer) => {
    if (peer.enterpriseValue <= 0 || peer.ebitda <= 0 || peer.evEbitda <= 0) return false;
    const calculatedMultiple = peer.enterpriseValue / peer.ebitda;
    return Number.isFinite(calculatedMultiple)
      && calculatedMultiple > 0
      && calculatedMultiple < 100
      && Math.abs(calculatedMultiple - peer.evEbitda) <= Math.max(0.25, calculatedMultiple * 0.05);
  });
  if (peerValues.length < 3) {
    throw new Error('Operating DCF requires at least three current source-ready EV/EBITDA peers.');
  }
  const multiple = median(peerValues.map((peer) => peer.enterpriseValue / peer.ebitda));
  if (!Number.isFinite(multiple) || multiple < 2 || multiple > 30) {
    throw new Error('The current peer median EV/EBITDA multiple is outside the supported 2x–30x range.');
  }
  return {
    multiple,
    sourceNote: `Terminal exit multiple is the median current EV/EBITDA of ${peerValues.length} source-ready peers (${peerValues.map((peer) => peer.ticker).join(', ')}); peer source ${peerQuality.source}.`,
  };
}

function buildComparableValuationInput(
  data: NativeUnifiedPayload,
  ticker: string,
  peers: ComparableCompany[],
  historicals: HistoricalData,
  method: ComparableValuationInput['method'],
): {input: ComparableValuationInput; peerTickers: string[]; sourceNotes: string[]} {
  const peerQuality = data.data_quality.peers;
  if (
    !peerQuality
    || !['live', 'cached'].includes(peerQuality.status)
    || peerQuality.fallback_used
    || !currentSource(peerQuality.source, 'comparable-company data')
  ) {
    throw new Error('A current curated comparable-company set is required for the trading-multiple valuation.');
  }
  freshTimestamp(peerQuality.fetched_at_ms ?? undefined, 'comparable-company data');
  if (!['live', 'cached'].includes(data.data_quality.market.status) || data.market.fallback_used === true) {
    throw new Error('A current, non-fallback share-price source is required for the common-equity bridge.');
  }
  freshTimestamp(data.market.fetched_at_ms ?? undefined, 'market');
  const currentPrice = typeof data.market.current_price === 'number' ? data.market.current_price : Number.NaN;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new Error('A positive current share price is required for the common-equity bridge.');
  }

  const last = historicals.years.length - 1;
  const metricField = method === 'ev_ebitda' ? 'ebitda' : 'revenue';
  const targetMetric = sourcedHistoricalLine(historicals, metricField, last).value!;
  if (targetMetric <= 0) throw new Error('FY' + historicals.years[last] + ' ' + metricField + ' must be positive for the selected multiple.');

  const uniquePeers = new Map<string, {multiple: number; name: string}>();
  for (const peer of peers) {
    if (!peer.ticker || peer.ticker === ticker || uniquePeers.has(peer.ticker)) continue;
    const denominator = method === 'ev_ebitda' ? peer.ebitda : peer.revenue;
    const reportedMultiple = method === 'ev_ebitda' ? peer.evEbitda : peer.evRevenue;
    if (!Number.isFinite(peer.enterpriseValue) || peer.enterpriseValue <= 0
      || !Number.isFinite(denominator) || denominator <= 0
      || !Number.isFinite(reportedMultiple) || reportedMultiple <= 0) continue;
    const multiple = peer.enterpriseValue / denominator;
    if (!Number.isFinite(multiple) || multiple <= 0 || multiple >= 100) continue;
    if (Math.abs(multiple - reportedMultiple) > Math.max(0.25, multiple * 0.05)) continue;
    uniquePeers.set(peer.ticker, {multiple, name: peer.name});
  }
  if (uniquePeers.size < 3) {
    throw new Error('The selected ' + method + ' route requires at least three current source-ready peers.');
  }
  const peerMultiples = [...uniquePeers.values()].map((item) => item.multiple);
  const selectedMultiple = median(peerMultiples);
  const maximumMultiple = method === 'ev_ebitda' ? 100 : 50;
  if (!Number.isFinite(selectedMultiple) || selectedMultiple <= 0 || selectedMultiple >= maximumMultiple) {
    throw new Error('The current peer median ' + method + ' multiple is outside the supported range.');
  }

  const filedOrExplicitZero = (field: string): number => {
    const line = historicals.sourceData?.[field]?.[last];
    if (
      line?.source === 'not_applicable'
      && line.sources.length > 0
      && line.sources.every((source) => source.accession && source.filed)
    ) return 0;
    return sourcedHistoricalLine(historicals, field, last).value!;
  };
  const dilutedShares = sourcedHistoricalLine(historicals, 'shares', last).value!;
  if (dilutedShares <= 0) throw new Error('FY' + historicals.years[last] + ' diluted shares must be positive.');
  const multipleLabel = method === 'ev_ebitda' ? 'EV/EBITDA' : 'EV/Revenue';
  const peerList = [...uniquePeers.entries()]
    .map(([peerTicker, item]) => peerTicker + ' ' + item.multiple.toFixed(2) + 'x')
    .join(', ');
  const targetLine = sourcedHistoricalLine(historicals, metricField, last);
  return {
    input: {
      method,
      targetMetric,
      selectedMultiple,
      cash: filedOrExplicitZero('cash'),
      marketableSecurities: filedOrExplicitZero('marketable_securities'),
      debt: filedOrExplicitZero('debt'),
      nonControllingInterest: filedOrExplicitZero('non_controlling_interest'),
      preferredEquity: filedOrExplicitZero('preferred_equity'),
      dilutedShares,
      currentPrice,
    },
    // The exact peer set that produced selectedMultiple. The workbook mapper
    // recomputes the peer median from the exported comps, so only these peers
    // may travel in comps; any other peer would change the median and trip
    // the reconciliation guard.
    peerTickers: [...uniquePeers.keys()],
    sourceNotes: [
      multipleLabel + ' valuation applies the median of ' + uniquePeers.size + ' current source-ready peer multiples (' + peerList + '); peer set source ' + peerQuality.source + ', fetched ' + new Date(peerQuality.fetched_at_ms!).toISOString() + '.',
      'Target ' + metricField + ' is FY' + historicals.years[last] + ' filed ' + (targetLine.concept ?? metricField) + ' (' + targetLine.sources[0]?.accession + '; filed ' + targetLine.sources[0]?.filed + '); the peer median is an editable formula in the workbook.',
      'The common-equity bridge uses filed cash, marketable securities, debt, noncontrolling interest, preferred equity, and diluted shares. No forecast cash-flow discounting is applied.',
    ],
  };
}

function qualityWarnings(data: NativeUnifiedPayload): string[] {
  const warnings: string[] = [];
  for (const [name, entry] of Object.entries(data.data_quality)) {
    if (entry.status !== 'live') {
      warnings.push(`${name}: ${entry.notes || `data status is ${entry.status}`}`);
    }
  }
  return warnings;
}

function enrichSourceNotes(payload: DcfExportPayload, data: NativeUnifiedPayload, historicals: HistoricalData, extraSourceNotes: string[] = []): void {
  const uiMeta = payload.uiMeta ?? {printDate: new Date().toISOString().slice(0, 10)};
  uiMeta.warnings = [...(uiMeta.warnings ?? []), ...qualityWarnings(data)];
  const sourceNotes = [...(uiMeta.sourceNotes ?? [])];
  sourceNotes.push(...extraSourceNotes);
  const annualHistoryDisclosure = getAnnualHistoryDisclosure(historicals.years);
  if (annualHistoryDisclosure) sourceNotes.push(annualHistoryDisclosure);
  const contextDate = data.valuation_context.as_of_date ?? '';
  if (contextDate) sourceNotes.push(`Market context as of ${contextDate}`);
  for (const [name, source] of Object.entries(data.source_metadata)) {
    if (source.trim()) sourceNotes.push(`${name}: ${source.trim()}`);
  }
  uiMeta.sourceNotes = sourceNotes;
  payload.uiMeta = uiMeta;
}

function buildModelInputs(data: NativeUnifiedPayload, ticker: string, options: {
  requirePositiveRevenue?: boolean;
  allowCurrentMarketShareCount?: boolean;
} = {}): {
  profile: CompanyProfile;
  historicals: HistoricalData;
  peers: ComparableCompany[];
} {
  const profile = mapNativeProfile(data.profile, data.financials_native, data.market);
  if (!profile.ticker) throw new Error(`The backend returned no usable profile for ${ticker}.`);
  profile.operatingArchetype = data.model_eligibility.operating_archetype ?? undefined;
  const historicals = mapCanonicalFinancialsToHistoricals(data.canonical_financials, data.market, profile);
  if (options.requirePositiveRevenue !== false) {
    const revenueHistoryError = getRevenueHistoryError(ticker, historicals.years, historicals.revenue);
    if (revenueHistoryError) throw new Error(revenueHistoryError);
  }
  if (historicals.price === null || historicals.price <= 0) {
    throw new Error(`A current share price is missing for ${ticker}.`);
  }
  if (historicals.sharesOutstanding === null || historicals.sharesOutstanding <= 0) {
    if (!options.allowCurrentMarketShareCount || typeof data.market.shares_outstanding !== 'number' || data.market.shares_outstanding <= 0) {
      throw new Error(`Market price or diluted share count is missing for ${ticker}.`);
    }
    historicals.sharesOutstanding = data.market.shares_outstanding;
  }
  if (historicals.sharesOutstanding === null || historicals.sharesOutstanding <= 0) {
    throw new Error(`Market price or diluted share count is missing for ${ticker}.`);
  }
  return {profile, historicals, peers: normalizePeers(data.peers)};
}

function requirementSourceStatus(source: unknown, method: unknown): WorkbookInputRequirement['sourceStatus'] {
  if (source === 'ambiguous') return 'ambiguous';
  if (typeof method === 'string' && /not.?disclosed|not.?reported/i.test(method)) return 'not_disclosed';
  return 'missing';
}

function buildIncompleteInputRequirements(
  data: NativeUnifiedPayload,
  model: ProductionValuationModel,
): WorkbookInputRequirement[] {
  const annual = data.canonical_financials.annual;
  const gaps = data.model_eligibility.missing_input_gaps;
  const requirements: WorkbookInputRequirement[] = [];
  const annualFieldsByGap: Record<string, string[]> = {
    filed_capex: ['capex'],
    three_year_operating_driver_history: ['revenue', 'ebit', 'gross_profit', 'capex', 'depreciation'],
  };

  for (const gap of gaps) {
    const comparablePeerMetric = model === 'ev_ebitda' ? 'ebitda' : model === 'revenue_multiple' ? 'revenue' : undefined;
    const matchingPeerGap = model === 'ev_ebitda'
      ? gap.key === 'multiple_three_current_ev_ebitda_peers'
      : model === 'revenue_multiple' && gap.key === 'multiple_three_current_ev_revenue_peers';
    if (comparablePeerMetric && matchingPeerGap) {
      const peerQuality = data.data_quality.peers;
      const peerAsOf = typeof peerQuality?.fetched_at_ms === 'number'
        ? new Date(peerQuality.fetched_at_ms).toISOString().slice(0, 10)
        : undefined;
      const currentPeerSet = peerQuality && ['live', 'cached'].includes(peerQuality.status)
        && peerQuality.fallback_used !== true
        && currentSource(peerQuality.source, 'comparable-company data');
      const peerRecords = Array.isArray(data.peers) ? data.peers : [];
      const missingPeerInputs: WorkbookInputRequirement[] = [];
      // Confirmations need a buildable bridge: without source-ready bridge
      // facts the workbook mapper cannot stage a schedule at all, so peer
      // confirmations would be unactionable rows on a dead shell.
      const bridgeGaps = gaps.some((item) => item.key === 'multiple_source_ready_equity_bridge'
        || item.key === 'multiple_live_price_and_filed_shares');
      if (currentPeerSet) {
        const seen = new Set<string>();
        for (const rawPeer of peerRecords) {
          const peer = asRecord(rawPeer);
          const rawPeerTicker = peer.ticker ?? peer.symbol;
          const peerTicker = typeof rawPeerTicker === 'string' ? rawPeerTicker.trim().toUpperCase() : '';
          const ev = typeof (peer.enterprise_value ?? peer.enterpriseValue) === 'number'
            ? Number(peer.enterprise_value ?? peer.enterpriseValue)
            : null;
          const denominator = typeof peer[comparablePeerMetric] === 'number' ? Number(peer[comparablePeerMetric]) : null;
          if (!peerTicker || peerTicker === data.profile.ticker?.toUpperCase() || seen.has(peerTicker) || ev === null || ev <= 0) continue;
          seen.add(peerTicker);
          if (denominator !== null && Number.isFinite(denominator) && denominator > 0) continue;
          missingPeerInputs.push({
            key: `peer_${comparablePeerMetric}:${peerTicker}`,
            label: `${peerTicker} latest filed ${comparablePeerMetric.toUpperCase()}`,
            inputType: 'market_data',
            sourceStatus: 'missing',
            reason: `${gap.reason} Enter the source-backed peer ${comparablePeerMetric.toUpperCase()} for ${peerTicker}.`,
            ...(peerAsOf ? {asOfDate: peerAsOf} : {}),
            unit: `${data.canonical_financials.currency || 'USD'} actual`,
            minimumValue: 1,
            sourceReferenceRequired: true,
          });
        }
      } else if (!bridgeGaps) {
        // Fallback peer universe: every usable peer needs analyst confirmation
        // of its market data before it can enter the median. Peers without a
        // usable EV/denominator (or the target itself) are skipped; with none
        // usable the single qualified_peer_set requirement below applies, so a
        // data-free universe still fails closed. Mirrors the workbook mapper's
        // row-skipping rules so no requirement ever dangles without a row.
        // Skipped entirely when bridge facts are missing: peer confirmations
        // would be unactionable rows since the mapper cannot stage a schedule
        // without the bridge.
        const seenFallback = new Set<string>();
        for (const rawPeer of peerRecords) {
          const peer = asRecord(rawPeer);
          const rawPeerTicker = peer.ticker ?? peer.symbol;
          const peerTicker = typeof rawPeerTicker === 'string' ? rawPeerTicker.trim().toUpperCase() : '';
          const ev = typeof (peer.enterprise_value ?? peer.enterpriseValue) === 'number'
            ? Number(peer.enterprise_value ?? peer.enterpriseValue)
            : null;
          if (!peerTicker || peerTicker === data.profile.ticker?.toUpperCase() || seenFallback.has(peerTicker) || ev === null || ev <= 0) continue;
          seenFallback.add(peerTicker);
          if (comparablePeerMetric === 'ebitda') {
            const revenue = typeof peer.revenue === 'number' ? Number(peer.revenue) : null;
            if (revenue === null || !Number.isFinite(revenue) || revenue <= 0) continue;
          } else {
            const ebitda = typeof peer.ebitda === 'number' ? Number(peer.ebitda) : null;
            if (ebitda === null || !Number.isFinite(ebitda) || ebitda <= 0) continue;
          }
          missingPeerInputs.push({
            key: `peer_${comparablePeerMetric}:${peerTicker}`,
            label: `${peerTicker} latest filed ${comparablePeerMetric.toUpperCase()} (confirm fallback peer data)`,
            inputType: 'market_data',
            sourceStatus: 'missing',
            reason: `${gap.reason} Confirm ${peerTicker}'s enterprise value and ${comparablePeerMetric.toUpperCase()} with a source reference; unconfirmed peers stay out of the median.`,
            ...(peerAsOf ? {asOfDate: peerAsOf} : {}),
            unit: `${data.canonical_financials.currency || 'USD'} actual`,
            minimumValue: 1,
            sourceReferenceRequired: true,
          });
        }
      }
      if (missingPeerInputs.length > 0) {
        requirements.push(...missingPeerInputs);
      } else if (currentPeerSet || !bridgeGaps) {
        requirements.push({
          key: 'qualified_peer_set',
          label: `Three current source-ready ${model === 'ev_ebitda' ? 'EV/EBITDA' : 'EV/Revenue'} peers`,
          inputType: 'market_data',
          sourceStatus: 'missing',
          reason: gap.reason,
          ...(peerAsOf ? {asOfDate: peerAsOf} : {}),
          unit: 'peer set',
          sourceReferenceRequired: true,
        });
      }
      continue;
    }
    if (isComparableValuationMethod(model)
      && ['three_current_source_ready_peers', 'ev_ebitda_route', 'revenue_multiple_route',
        'multiple_three_current_ev_ebitda_peers', 'multiple_three_current_ev_revenue_peers'].includes(gap.key)) continue;
    // The opposite route's target-metric gate must not leak into this route:
    // a revenue-multiple model never needs filed EBITDA (and vice versa).
    if (model === 'revenue_multiple' && gap.key === 'multiple_positive_filed_ebitda') continue;
    if (model === 'ev_ebitda' && gap.key === 'multiple_positive_filed_revenue') continue;
    // Multiple math uses peer multiples plus filed bridge facts only: operating
    // model readiness keys (tax rate, working capital lines, driver history,
    // filed operating lines) must never become analyst requirements for a
    // comparable route. Bridge gaps still surface through multiple_* keys and
    // the workbook mapper fails closed when bridge facts are truly absent.
    if (comparablePeerMetric && !gap.key.startsWith('multiple_')) continue;
    if (model === 'bank_residual_income' && gap.key === 'minimum_cet1_ratio') {
      const latest = annual.at(-1);
      const latestRecord = asRecord(latest);
      const latestBank = asRecord(latestRecord.bank);
      const line = asRecord(latestBank.minimum_cet1_ratio);
      requirements.push({
        key: 'minimum_cet1_ratio',
        label: gap.label,
        inputType: 'reported_fact',
        sourceStatus: requirementSourceStatus(line.source, line.method),
        reason: `${gap.reason}${typeof latestRecord.year === 'number' ? ` Fiscal year ${latestRecord.year}.` : ''}`,
        ...(typeof latestRecord.year === 'number' ? {fiscalYear: latestRecord.year} : {}),
        unit: 'ratio',
        minimumValue: 0.01,
        maximumValue: 0.99,
        sourceReferenceRequired: true,
      });
      continue;
    }
    if (model === 'insurance_pnc_residual_income' && gap.key === 'unpaid_loss_reserves') {
      const latest = annual.at(-1);
      const latestRecord = asRecord(latest);
      const latestInsurance = asRecord(latestRecord.insurance);
      const line = asRecord(latestInsurance.unpaid_loss_reserves);
      const currency = data.canonical_financials.currency || 'USD';
      requirements.push({
        key: 'unpaid_loss_reserves',
        label: gap.label,
        inputType: 'reported_fact',
        sourceStatus: requirementSourceStatus(line.source, line.method),
        reason: `${gap.reason}${typeof latestRecord.year === 'number' ? ` Fiscal year ${latestRecord.year}.` : ''}`,
        ...(typeof latestRecord.year === 'number' ? {fiscalYear: latestRecord.year} : {}),
        unit: `${currency} actual`,
        minimumValue: 1,
        sourceReferenceRequired: true,
      });
      continue;
    }
    if (model === 'reit_affo' && gap.key === 'same_store_noi_growth') {
      const latest = annual.at(-1);
      const latestRecord = asRecord(latest);
      const latestReit = asRecord(latestRecord.reit);
      const line = asRecord(latestReit.same_store_noi_growth);
      requirements.push({
        key: 'same_store_noi_growth',
        label: gap.label,
        inputType: 'reported_fact',
        sourceStatus: requirementSourceStatus(line.source, line.method),
        reason: `${gap.reason}${typeof latestRecord.year === 'number' ? ` Fiscal year ${latestRecord.year}.` : ''}`,
        ...(typeof latestRecord.year === 'number' ? {fiscalYear: latestRecord.year} : {}),
        unit: 'ratio',
        minimumValue: -0.99,
        sourceReferenceRequired: true,
      });
      continue;
    }
    if (model === 'mortgage_reit_residual_income' && gap.key === 'average_repo_borrowings') {
      const latest = annual.at(-1);
      const latestRecord = asRecord(latest);
      const latestMortgageReit = asRecord(latestRecord.mortgage_reit);
      const line = asRecord(latestMortgageReit.average_repo_borrowings);
      const currency = data.canonical_financials.currency || 'USD';
      requirements.push({
        key: 'average_repo_borrowings',
        label: gap.label,
        inputType: 'reported_fact',
        sourceStatus: requirementSourceStatus(line.source, line.method),
        reason: `${gap.reason}${typeof latestRecord.year === 'number' ? ` Fiscal year ${latestRecord.year}.` : ''}`,
        ...(typeof latestRecord.year === 'number' ? {fiscalYear: latestRecord.year} : {}),
        unit: `${currency} actual`,
        minimumValue: 1,
        sourceReferenceRequired: true,
      });
      continue;
    }
    if (model === 'utility_dcf') {
      const latest = annual.at(-1);
      const latestRecord = asRecord(latest);
      const baseYear = typeof latestRecord.year === 'number' ? latestRecord.year : new Date().getUTCFullYear() - 1;
      const reason = `${gap.reason}${gap.key === 'approved_rate_base_additions' || gap.key === 'rate_base_depreciation'
        ? ' Enter each forecast-year value and its source or forecast basis.'
        : ''}`;
      if (gap.key === 'jurisdictional_rate_base') {
        requirements.push({
          key: 'jurisdictional_rate_base',
          label: 'Latest regulated jurisdictional rate base',
          inputType: 'reported_fact',
          sourceStatus: 'missing',
          reason: `${reason} Fiscal year ${baseYear}. Use the regulated operating-company scope stated in the source reference.`,
          fiscalYear: baseYear,
          unit: `${data.canonical_financials.currency || 'USD'} actual`,
          minimumValue: 1,
          sourceReferenceRequired: true,
        });
      } else if (gap.key === 'authorized_return_on_equity') {
        requirements.push({
          key: 'allowed_roe',
          label: 'Current authorized return on common equity',
          inputType: 'reported_fact',
          sourceStatus: 'missing',
          reason,
          fiscalYear: baseYear,
          unit: 'ratio',
          minimumValue: 0.001,
          maximumValue: 0.5,
          sourceReferenceRequired: true,
        });
      } else if (gap.key === 'authorized_equity_ratio') {
        requirements.push({
          key: 'authorized_equity_ratio',
          label: 'Authorized common-equity share of capital structure',
          inputType: 'reported_fact',
          sourceStatus: 'missing',
          reason,
          fiscalYear: baseYear,
          unit: 'ratio',
          minimumValue: 0.01,
          maximumValue: 0.99,
          sourceReferenceRequired: true,
        });
      } else if (gap.key === 'approved_rate_base_additions') {
        for (let year = baseYear + 1; year <= baseYear + 5; year += 1) {
          requirements.push({
            key: 'rate_base_additions',
            label: 'Approved additions entering rate base',
            inputType: 'reported_fact',
            sourceStatus: 'missing',
            reason: `${reason} Fiscal year ${year}.`,
            fiscalYear: year,
            unit: `${data.canonical_financials.currency || 'USD'} actual`,
            minimumValue: 0,
            sourceReferenceRequired: true,
          });
        }
      } else if (gap.key === 'rate_base_depreciation') {
        for (let year = baseYear + 1; year <= baseYear + 5; year += 1) {
          requirements.push({
            key: 'rate_base_depreciation',
            label: 'Rate-base depreciation and retirements',
            inputType: 'analyst_assumption',
            sourceStatus: 'missing',
            reason: `${reason} Fiscal year ${year}; label the forecast basis in the workbook.`,
            fiscalYear: year,
            unit: `${data.canonical_financials.currency || 'USD'} actual`,
            minimumValue: 0,
            sourceReferenceRequired: false,
          });
        }
      } else if (gap.key === 'dividend_payout_ratio') {
        requirements.push({
          key: 'dividend_payout_ratio',
          label: 'Forecast common-dividend payout ratio',
          inputType: 'analyst_assumption',
          sourceStatus: 'missing',
          reason: `${reason} State the intended payout policy or attach the source basis.`,
          fiscalYear: baseYear,
          unit: 'ratio',
          minimumValue: 0,
          maximumValue: 1,
          sourceReferenceRequired: false,
        });
      } else if (gap.key === 'terminal_growth_rate') {
        const riskFree = data.valuation_context.risk_free_rate;
        const erp = data.valuation_context.equity_risk_premium;
        const beta = data.market.beta;
        const costOfEquity = typeof riskFree === 'number' && typeof erp === 'number' && typeof beta === 'number'
          ? riskFree + erp * beta
          : 0.05;
        requirements.push({
          key: 'terminal_growth_rate',
          label: 'Long-run regulated dividend growth',
          inputType: 'analyst_assumption',
          sourceStatus: 'missing',
          reason: `${reason} Keep terminal growth below cost of equity (${(costOfEquity * 100).toFixed(2)}%).`,
          unit: 'ratio',
          minimumValue: 0,
          maximumValue: Math.max(0, costOfEquity - 0.005),
          sourceReferenceRequired: false,
        });
      } else if (gap.key === 'current_share_price') {
        requirements.push({
          key: 'current_share_price',
          label: 'Current common share price',
          inputType: 'market_data',
          sourceStatus: 'missing',
          reason,
          asOfDate: data.valuation_context.as_of_date ?? undefined,
          unit: `${data.canonical_financials.currency || 'USD'} per share`,
          minimumValue: 0.01,
          sourceReferenceRequired: true,
        });
      } else if (gap.key === 'filed_diluted_shares') {
        const latestShares = asRecord(latestRecord.shares);
        requirements.push({
          key: 'diluted_shares',
          label: 'Latest filed diluted common shares',
          inputType: 'reported_fact',
          sourceStatus: requirementSourceStatus(latestShares.source, latestShares.method),
          reason: `${reason} Fiscal year ${baseYear}.`,
          fiscalYear: baseYear,
          unit: 'shares actual',
          minimumValue: 1,
          sourceReferenceRequired: true,
        });
      } else if (['current_risk_free_rate', 'current_equity_risk_premium', 'current_beta'].includes(gap.key)) {
        const isBeta = gap.key === 'current_beta';
        const field = isBeta ? 'beta' : gap.key === 'current_risk_free_rate' ? 'risk_free_rate' : 'equity_risk_premium';
        requirements.push({
          key: field,
          label: isBeta ? 'Current utility beta' : gap.key === 'current_risk_free_rate' ? 'Current risk-free rate' : 'Current equity-risk premium',
          inputType: 'market_data',
          sourceStatus: 'missing',
          reason,
          asOfDate: data.valuation_context.as_of_date ?? undefined,
          unit: isBeta ? 'multiple' : 'ratio',
          minimumValue: 0.001,
          maximumValue: isBeta ? 5 : 0.3,
          sourceReferenceRequired: true,
        });
      }
      continue;
    }
    if (model === 'biotech_pipeline_rnpv') {
      const annualBase = annual.at(-1);
      const baseYear = typeof annualBase?.year === 'number' ? annualBase.year : new Date().getUTCFullYear() - 1;
      const pipelineAssets = Array.isArray(data.financials_native.pipeline_assets) ? data.financials_native.pipeline_assets : [];
      const includedAssets = selectBiotechAssetsForRnpv(pipelineAssets);
      const otherAssets = selectOtherBiotechAssetsForRnpv(pipelineAssets);
      const sourceReason = `${gap.reason} Enter a source or valuation rationale for each input.`;
      if (gap.key === 'commercial_franchise_forecast_inputs') {
        for (let year = baseYear + 1; year <= baseYear + 10; year += 1) {
          requirements.push({
            key: 'commercial_revenue_growth',
            label: 'Commercial franchise revenue growth',
            inputType: 'analyst_assumption',
            sourceStatus: 'missing',
            reason: `${sourceReason} Forecast FY${year}; the filed revenue base includes product and collaboration revenue.`,
            fiscalYear: year,
            unit: 'ratio',
            minimumValue: -0.95,
            maximumValue: 2,
            sourceReferenceRequired: true,
          });
        }
        requirements.push({
          key: 'commercial_fcf_margin',
          label: 'Existing commercial portfolio post-tax cash margin',
          inputType: 'analyst_assumption',
          sourceStatus: 'missing',
          reason: `${sourceReason} This margin excludes the separately modeled pipeline development costs.`,
          unit: 'ratio',
          minimumValue: -1,
          maximumValue: 1,
          sourceReferenceRequired: true,
        });
      } else if (gap.key === 'pipeline_asset_economics') {
        for (const asset of includedAssets) {
          const assetId = asset.asset_id;
          const fields = [
            {suffix: 'include', label: `${assetId} include in rNPV`, unit: '0 or 1', minimum: 0, maximum: 1, allowedValues: [0, 1]},
            {suffix: 'launch_year', label: `${assetId} expected launch year`, unit: 'calendar year', minimum: baseYear + 1, maximum: baseYear + 10},
            {suffix: 'peak_sales', label: `${assetId} peak annual sales`, unit: `${data.canonical_financials.currency || 'USD'} actual`, minimum: 0},
            {suffix: 'years_to_peak', label: `${assetId} years from launch to peak sales`, unit: 'years', minimum: 1, maximum: 10},
            {suffix: 'exclusivity_year', label: `${assetId} expected loss-of-exclusivity year`, unit: 'calendar year', minimum: baseYear + 1, maximum: baseYear + 25},
            {suffix: 'post_loe_erosion', label: `${assetId} post-LOE annual sales erosion`, unit: 'ratio', minimum: 0, maximum: 0.99},
            {suffix: 'probability_of_success', label: `${assetId} probability of success`, unit: 'ratio', minimum: 0, maximum: 1},
            {suffix: 'retained_share', label: `${assetId} retained economics after partner share`, unit: 'ratio', minimum: 0, maximum: 1},
            {suffix: 'contribution_margin', label: `${assetId} post-tax cash contribution margin`, unit: 'ratio', minimum: -1, maximum: 1},
            {suffix: 'development_cost_pv', label: `${assetId} remaining development-cost PV`, unit: `${data.canonical_financials.currency || 'USD'} actual`, minimum: 0},
          ];
          for (const field of fields) {
            requirements.push({
              key: `asset_${field.suffix}:${assetId}`,
              label: field.label,
              inputType: 'analyst_assumption',
              sourceStatus: 'missing',
              reason: `${sourceReason} SEC filing lists ${asset.asset_name}${asset.stage ? ` at ${asset.stage}` : ''}${asset.partner ? ` with ${asset.partner}` : ''}.`,
              unit: field.unit,
              ...(field.minimum !== undefined ? {minimumValue: field.minimum} : {}),
              ...(field.maximum !== undefined ? {maximumValue: field.maximum} : {}),
              ...('allowedValues' in field ? {allowedValues: field.allowedValues} : {}),
              sourceReferenceRequired: true,
            });
          }
        }
        for (const asset of otherAssets) {
          for (const field of [
            {suffix: 'scope_include', label: `${asset.asset_id} include in other-pipeline value`, unit: '0 or 1', minimum: 0, maximum: 1, allowedValues: [0, 1]},
            {suffix: 'scope_rnpv', label: `${asset.asset_id} analyst-entered other-pipeline rNPV`, unit: `${data.canonical_financials.currency || 'USD'} actual`, minimum: -1e12, maximum: 1e12},
          ]) {
            requirements.push({
              key: `asset_${field.suffix}:${asset.asset_id}`,
              label: field.label,
              inputType: 'analyst_assumption',
              sourceStatus: 'missing',
              reason: `${sourceReason} This source-listed program is not in the individually forecast late-stage schedule${asset.stage ? ` (reported stage: ${asset.stage})` : ''}${asset.development_status === 'explicitly_paused' ? ' and the filing says development is paused' : ''}${asset.partner ? `; disclosed partner: ${asset.partner}` : ''}. Decide inclusion and document the analyst-entered present value.`,
              unit: field.unit,
              minimumValue: field.minimum,
              ...(field.maximum !== undefined ? {maximumValue: field.maximum} : {}),
              ...('allowedValues' in field ? {allowedValues: field.allowedValues} : {}),
              sourceReferenceRequired: true,
            });
          }
        }
      } else if (gap.key === 'terminal_growth_rate') {
        const riskFree = data.valuation_context.risk_free_rate;
        const erp = data.valuation_context.equity_risk_premium;
        const beta = data.market.beta;
        const costOfEquity = typeof riskFree === 'number' && typeof erp === 'number' && typeof beta === 'number'
          ? riskFree + erp * beta
          : 0.05;
        requirements.push({
          key: 'terminal_growth_rate',
          label: 'Commercial franchise terminal growth',
          inputType: 'analyst_assumption',
          sourceStatus: 'missing',
          reason: `${sourceReason} Keep terminal growth below cost of equity (${(costOfEquity * 100).toFixed(2)}%).`,
          unit: 'ratio',
          minimumValue: 0,
          maximumValue: Math.max(0, costOfEquity - 0.005),
          sourceReferenceRequired: true,
        });
      } else if (gap.key === 'other_pipeline_scope_value') {
        requirements.push({
          key: 'unmapped_pipeline_rnpv',
          label: 'Pipeline rNPV outside the SEC-mapped asset inventory',
          inputType: 'analyst_assumption',
          sourceStatus: 'missing',
          reason: `${sourceReason} Use only for programs not identified in the workbook's SEC-sourced pipeline inventory.`,
          unit: `${data.canonical_financials.currency || 'USD'} actual`,
          minimumValue: -1e12,
          maximumValue: 1e12,
          sourceReferenceRequired: true,
        });
      } else if (gap.key === 'company_discount_rate_inputs') {
        requirements.push({
          key: 'biotech_cost_of_debt',
          label: 'Normalized cost of debt for WACC',
          inputType: 'analyst_assumption',
          sourceStatus: 'missing',
          reason: `${sourceReason} Use the filed debt rate or clearly document an analyst estimate.`,
          unit: 'ratio',
          minimumValue: 0,
          maximumValue: 0.3,
          sourceReferenceRequired: true,
        });
        requirements.push({
          key: 'biotech_normalized_tax_rate',
          label: 'Normalized marginal tax rate for WACC',
          inputType: 'analyst_assumption',
          sourceStatus: 'missing',
          reason: `${sourceReason} Label the normalized rate; do not use a loss-year effective tax rate without review.`,
          unit: 'ratio',
          minimumValue: 0,
          maximumValue: 0.6,
          sourceReferenceRequired: true,
        });
      }
      continue;
    }
    if (model === 'life_insurer_distributable_earnings_dcf') {
      const annualBase = annual.at(-1);
      const baseYear = typeof annualBase?.year === 'number' ? annualBase.year : new Date().getUTCFullYear() - 1;
      const ticker = data.profile.ticker.toUpperCase();
      const lifeFacts = Array.isArray(data.financials_native.life_insurance_filing_facts)
        ? data.financials_native.life_insurance_filing_facts : [];
      const contract = resolveLifeSourceContract(lifeFacts);
      const earningsMetric = contract?.earningsMetric ?? 'adjusted_earnings_available_to_common';
      const earningsBasisLabel = contract?.earningsBasis === 'pre_tax_adjusted_operating_income'
        ? 'pre-tax adjusted operating income' : 'after-tax adjusted earnings available to common';
      const segmentNames = contract?.segmentNames ?? [...new Set(lifeFacts
        .filter((fact) => fact.metric === earningsMetric && fact.fiscal_year === baseYear)
        .map((fact) => fact.segment)
        .filter((segment): segment is string => Boolean(segment)))].sort();
      const sourceReason = `${gap.reason} Enter a source or valuation rationale for each input.`;
      const currency = data.canonical_financials.currency || 'USD';
      if (gap.key === 'life_insurance_earnings_forecast') {
        for (const segment of segmentNames) {
          for (let year = baseYear + 1; year <= baseYear + 5; year += 1) {
            requirements.push({
              key: `life_segment_earnings_growth:${segment}`,
              label: `${segment} adjusted-earnings growth`,
              inputType: 'analyst_assumption',
              sourceStatus: 'missing',
              reason: `${sourceReason} Forecast FY${year}; the source basis remains ${earningsBasisLabel}.`,
              fiscalYear: year,
              unit: 'ratio',
              minimumValue: -0.95,
              maximumValue: 2,
              sourceReferenceRequired: true,
            });
          }
        }
      } else if (gap.key === 'life_insurance_capital_schedule') {
        for (let year = baseYear + 1; year <= baseYear + 5; year += 1) {
          requirements.push({
            key: 'life_net_capital_addition',
            label: 'Net statutory capital addition / (release)',
            inputType: 'analyst_assumption',
            sourceStatus: 'missing',
            reason: `${sourceReason} Aggregate the material insurer legal entities and jurisdictions. Positive values are retained capital; negative values are capital releases.`,
            fiscalYear: year,
            unit: `${currency} actual`,
            minimumValue: -1e12,
            maximumValue: 1e12,
            sourceReferenceRequired: true,
          });
        }
      } else if (gap.key === 'life_insurance_upstream_distribution') {
        for (let year = baseYear + 1; year <= baseYear + 5; year += 1) {
          requirements.push({
            key: 'life_permitted_upstream_dividends',
            label: 'Maximum upstream dividend capacity',
            inputType: 'analyst_assumption',
            sourceStatus: 'missing',
            reason: `${sourceReason} Sum only source-supported distributions available to the parent from material statutory entities; preserve jurisdiction-specific approval limits.`,
            fiscalYear: year,
            unit: `${currency} actual`,
            minimumValue: 0,
            maximumValue: 1e12,
            sourceReferenceRequired: true,
          });
        }
      } else if (gap.key === 'life_insurance_parent_cash_bridge') {
        for (const [key, label, reason] of [
          ['life_parent_cash', 'Holding-company cash and liquid assets', 'Use parent-company cash, not consolidated insurance-company investment assets.'],
          ['life_parent_cash_reserve', 'Required holding-company cash reserve', 'Use the disclosed company target when available or a clearly documented analyst policy.'],
          ['life_parent_debt', 'Holding-company debt and financing claims', 'Use parent-company debt; exclude insurer operating liabilities.'],
          ['life_preferred_equity', 'Preferred equity claims', 'Enter source-backed preferred equity or zero with a source reference if none is outstanding.'],
          ['life_non_controlling_interest', 'Noncontrolling interest claim', 'Enter the parent-level claim or zero with a source reference if not applicable.'],
        ] as const) {
          requirements.push({
            key,
            label,
            inputType: 'reported_fact',
            sourceStatus: 'missing',
            reason: `${sourceReason} ${reason}`,
            unit: `${currency} actual`,
            minimumValue: 0,
            maximumValue: 1e12,
            sourceReferenceRequired: true,
          });
        }
      } else if (gap.key === 'life_insurance_tax_conversion') {
        requirements.push({
          key: 'life_normalized_tax_rate',
          label: 'Normalized tax rate on pre-tax adjusted operating income',
          inputType: 'analyst_assumption',
          sourceStatus: 'missing',
          reason: `${sourceReason} The source earnings measure is pre-tax; never tax after-tax adjusted earnings a second time.`,
          unit: 'ratio',
          minimumValue: 0,
          maximumValue: 0.6,
          sourceReferenceRequired: true,
        });
      } else if (gap.key === 'terminal_growth_rate') {
        const riskFreeRate = data.valuation_context.risk_free_rate;
        const equityRiskPremium = data.valuation_context.equity_risk_premium;
        const beta = data.market.beta;
        const costOfEquity = typeof riskFreeRate === 'number' && typeof equityRiskPremium === 'number' && typeof beta === 'number'
          ? riskFreeRate + beta * equityRiskPremium
          : 0.1;
        requirements.push({
          key: 'terminal_growth_rate',
          label: 'Terminal distributable-earnings growth',
          inputType: 'analyst_assumption',
          sourceStatus: 'missing',
          reason: `${sourceReason} Keep terminal growth at least 0.5% below cost of equity and no greater than 10%.`,
          unit: 'ratio',
          minimumValue: 0,
          maximumValue: Math.max(0, Math.min(0.1, costOfEquity - 0.005)),
          sourceReferenceRequired: true,
        });
      } else if (gap.key === 'company_discount_rate_inputs') {
        for (const [key, label, value, minimum, maximum] of [
          ['life_risk_free_rate', 'Current risk-free rate', data.valuation_context.risk_free_rate, 0.001, 0.3],
          ['life_equity_risk_premium', 'Current equity-risk premium', data.valuation_context.equity_risk_premium, 0.001, 0.3],
          ['life_beta', 'Current beta', data.market.beta, 0.01, 5],
        ] as const) {
          if (typeof value === 'number' && Number.isFinite(value) && value > 0) continue;
          requirements.push({
            key,
            label,
            inputType: 'market_data',
            sourceStatus: 'missing',
            reason: `${sourceReason} Enter a dated source and preserve the observation date.`,
            unit: key.endsWith('beta') ? 'multiple' : 'ratio',
            minimumValue: minimum,
            maximumValue: maximum,
            sourceReferenceRequired: true,
          });
        }
      } else if (gap.key === 'live_current_share_price') {
        requirements.push({
          key: 'life_current_share_price',
          label: 'Current common share price',
          inputType: 'market_data',
          sourceStatus: 'missing',
          reason: `${sourceReason} Enter a dated market observation.`,
          unit: `${currency} per share`,
          minimumValue: 0.01,
          maximumValue: 1e6,
          sourceReferenceRequired: true,
        });
      } else if (gap.key === 'life_diluted_shares') {
        requirements.push({
          key: 'life_diluted_shares',
          label: 'Latest filed diluted share count',
          inputType: 'reported_fact',
          sourceStatus: 'missing',
          reason: `${sourceReason} Use the latest filed weighted-average diluted common shares.`,
          fiscalYear: baseYear,
          unit: 'shares actual',
          minimumValue: 1,
          sourceReferenceRequired: true,
        });
      }
      continue;
    }
    if (model === 'asset_manager_aum_dcf' && gap.key === 'three_consecutive_average_aum_base_fee_yields') {
      for (const year of annual) {
        const yearRecord = asRecord(year);
        const manager = asRecord(yearRecord.asset_manager ?? yearRecord.assetManager);
        const line = asRecord(manager.base_fee_yield);
        const sources = Array.isArray(line.sources) ? line.sources : [];
        const hasFiledYield = (line.source === 'sec_native' || line.source === 'derived')
          && typeof line.value === 'number' && Number.isFinite(line.value)
          && sources.length > 0
          && sources.every((source) => {
            const record = asRecord(source);
            return Boolean(record.accession && record.filed);
          });
        if (hasFiledYield) continue;
        requirements.push({
          key: 'base_fee_yield',
          label: 'Filed base advisory-fee yield',
          inputType: 'reported_fact',
          sourceStatus: requirementSourceStatus(line.source, line.method),
          reason: `${gap.reason} Fiscal year ${typeof yearRecord.year === 'number' ? yearRecord.year : 'unavailable'}.`,
          ...(typeof yearRecord.year === 'number' ? {fiscalYear: yearRecord.year} : {}),
          unit: 'ratio',
          minimumValue: 0.000001,
          maximumValue: 0.999999,
          sourceReferenceRequired: true,
        });
      }
      continue;
    }
    const singleGapTelecomChurn = model === 'telecom_subscriber_dcf'
      && gaps.length === 1 && gap.key === 'three_year_postpaid_phone_churn';
    if (singleGapTelecomChurn) {
      for (const year of annual.slice(-3)) {
        const yearRecord = asRecord(year);
        const telecom = asRecord(yearRecord.telecom);
        const line = asRecord(telecom.postpaid_phone_churn);
        const sources = Array.isArray(line.sources) ? line.sources : [];
        const hasFiledChurn = (line.source === 'sec_native' || line.source === 'derived')
          && typeof line.value === 'number' && Number.isFinite(line.value)
          && sources.length > 0
          && sources.every((source) => {
            const record = asRecord(source);
            return Boolean(record.accession && record.filed);
          });
        if (hasFiledChurn) continue;
        requirements.push({
          key: 'postpaid_phone_churn',
          label: 'Monthly postpaid phone churn',
          inputType: 'reported_fact',
          sourceStatus: requirementSourceStatus(line.source, line.method),
          reason: `${gap.reason} Fiscal year ${typeof yearRecord.year === 'number' ? yearRecord.year : 'unavailable'}.`,
          ...(typeof yearRecord.year === 'number' ? {fiscalYear: yearRecord.year} : {}),
          unit: 'ratio',
          minimumValue: 0.000001,
          maximumValue: 0.099999,
          sourceReferenceRequired: true,
        });
      }
      continue;
    }
    if (model === 'integrated_energy_dcf' && gap.key === 'three_year_crude_oil_production') {
      for (const year of annual.slice(-3)) {
        const yearRecord = asRecord(year);
        const energy = asRecord(yearRecord.energy);
        const line = asRecord(energy.crude_oil_production);
        const sources = Array.isArray(line.sources) ? line.sources : [];
        const hasFiledProduction = (line.source === 'sec_native' || line.source === 'derived')
          && typeof line.value === 'number' && Number.isFinite(line.value)
          && sources.length > 0
          && sources.every((source) => {
            const record = asRecord(source);
            return Boolean(record.accession && record.filed);
          });
        if (hasFiledProduction) continue;
        requirements.push({
          key: 'crude_oil_production',
          label: 'Filed crude oil production',
          inputType: 'reported_fact',
          sourceStatus: requirementSourceStatus(line.source, line.method),
          reason: `${gap.reason} Fiscal year ${typeof yearRecord.year === 'number' ? yearRecord.year : 'unavailable'}.`,
          ...(typeof yearRecord.year === 'number' ? {fiscalYear: yearRecord.year} : {}),
          unit: 'barrels per day actual',
          minimumValue: 1,
          sourceReferenceRequired: true,
        });
      }
      continue;
    }
    if (model === 'mature_pharma_product_dcf' && gap.key === 'three_year_filed_product_sales') {
      for (const year of annual.slice(-3)) {
        const yearRecord = asRecord(year);
        const pharma = asRecord(yearRecord.pharma);
        const products = Array.isArray(pharma.products) ? pharma.products : [];
        for (const item of products) {
          const product = asRecord(item);
          const productName = typeof product.product_name === 'string' ? product.product_name.trim() : '';
          if (!productName) throw new Error(`FY${yearRecord.year ?? 'unknown'} product row has no name.`);
          const line = asRecord(product.revenue);
          const sources = Array.isArray(line.sources) ? line.sources : [];
          const hasFiledProductRevenue = (line.source === 'sec_native' || line.source === 'derived')
            && typeof line.value === 'number' && Number.isFinite(line.value)
            && sources.length > 0
            && sources.every((source) => {
              const record = asRecord(source);
              return Boolean(record.accession && record.filed);
            });
          if (hasFiledProductRevenue) continue;
          const productKey = productName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
          requirements.push({
            key: `product_revenue:${productKey}`,
            label: `Product revenue — ${productName}`,
            inputType: 'reported_fact',
            sourceStatus: requirementSourceStatus(line.source, line.method),
            reason: `${gap.reason} ${productName}; fiscal year ${typeof yearRecord.year === 'number' ? yearRecord.year : 'unavailable'}.`,
            ...(typeof yearRecord.year === 'number' ? {fiscalYear: yearRecord.year} : {}),
            unit: `${data.canonical_financials.currency || 'USD'} actual`,
            minimumValue: 0,
            sourceReferenceRequired: true,
          });
        }
      }
      continue;
    }
    const annualFields = model === 'unlevered_dcf' ? annualFieldsByGap[gap.key] : undefined;
    if (!annualFields) {
      requirements.push({
        key: gap.key,
        label: gap.label,
        inputType: gap.key.startsWith('live_') ? 'market_data' : 'reported_fact',
        sourceStatus: 'missing',
        reason: gap.reason,
        sourceReferenceRequired: true,
      });
      continue;
    }

    const years = gap.key === 'three_year_operating_driver_history' ? annual.slice(-3) : annual;
    for (const annualField of annualFields) {
      for (const year of years) {
        const candidate = (year as unknown as Record<string, unknown>)[annualField];
        const line = asRecord(candidate);
        const value = line.value;
        const source = line.source;
        if ((source === 'sec_native' || source === 'derived')
          && typeof value === 'number' && Number.isFinite(value)) continue;
        requirements.push({
          key: annualField,
          label: gap.label,
          inputType: 'reported_fact',
          sourceStatus: requirementSourceStatus(source, line.method),
          reason: `${gap.reason} Fiscal year ${year.year}.`,
          fiscalYear: year.year,
          unit: `${data.canonical_financials.currency || 'USD'} millions`,
          ...(annualField === 'capex' ? {minimumValue: 0} : {}),
          sourceReferenceRequired: true,
        });
      }
    }
  }

  const unique = new Map<string, WorkbookInputRequirement>();
  for (const requirement of requirements) {
    const identity = `${requirement.key}:${requirement.fiscalYear ?? requirement.asOfDate ?? ''}`;
    if (!unique.has(identity)) unique.set(identity, requirement);
  }
  return [...unique.values()];
}

function buildIncompleteOperatingAssumptions(
  data: NativeUnifiedPayload,
  profile: CompanyProfile,
  historicals: HistoricalData,
): {assumptions: ModelAssumptions; sourceNotes: string[]} | undefined {
  const applicableGaps = data.model_eligibility.missing_input_gaps.filter((gap) =>
    !gap.key.startsWith('multiple_') && !['ev_ebitda_route', 'revenue_multiple_route'].includes(gap.key));
  if (applicableGaps.length === 0
    || applicableGaps.some((gap) => gap.key !== 'three_year_operating_driver_history')) return undefined;

  const requiredInputs = buildIncompleteInputRequirements(data, 'unlevered_dcf');
  if (requiredInputs.length === 0 || requiredInputs.some((input) => input.key !== 'capex')) return undefined;

  const market = requireCurrentMarketData(data);
  const capitalInputs = operatingCapitalInputs(data, historicals, market.marketCap);
  const exitMultiple = sourcedTerminalMultiple(data, normalizePeers(data.peers));
  const workingCapital = data.model_eligibility.operating_archetype === 'subscription_software'
    ? deriveSubscriptionSoftwareWorkingCapital(historicals)
    : deriveOperatingWorkingCapitalDays(historicals);
  const initialAssumptions = buildBaseAssumptions(
    historicals,
    {rf: market.riskFreeRate, mrp: market.equityRiskPremium},
    exitMultiple.multiple,
    profile,
    {useIndustryTemplate: false},
  );
  const operatingProfile = buildOperatingModelProfile(
    data.model_eligibility.operating_archetype,
    historicals,
    initialAssumptions,
    {allowMissingCapex: true},
  );
  const terminalGrowthRate = initialAssumptions.terminalGrowthRate;
  const assumptions = normalizeAssumptions({
    ...initialAssumptions,
    riskFreeRate: market.riskFreeRate,
    equityRiskPremium: market.equityRiskPremium,
    beta: market.beta,
    ...operatingProfile.assumptionOverrides,
    accountsReceivableDays: workingCapital.accountsReceivableDays,
    inventoryDays: workingCapital.inventoryDays,
    accountsPayableDays: workingCapital.accountsPayableDays,
    nwcChangeRatio: workingCapital.nwcChangeRatio,
    taxRate: capitalInputs.taxRate,
    currentDebt: capitalInputs.debt,
    costOfDebt: capitalInputs.costOfDebt,
    leverageTarget: capitalInputs.leverageTarget,
    terminalExitMultiple: exitMultiple.multiple,
    modelType: 'unlevered',
    discountRateMode: 'derived',
  }, historicals.sharesOutstanding ?? 0, historicals, market.marketCap);
  if (!Number.isFinite(assumptions.wacc) || assumptions.wacc < 0.02 || assumptions.wacc > 0.3
    || terminalGrowthRate >= assumptions.wacc) {
    throw new Error('Incomplete operating DCF requires a supported sourced WACC above terminal growth.');
  }

  const exportAssumptions = buildExportAssumptions(assumptions, historicals);
  if (data.model_eligibility.operating_archetype !== 'subscription_software') {
    exportAssumptions.wcMethod = 'Days';
    exportAssumptions.nwcPctRevenue = 0;
  }
  return {
    assumptions: exportAssumptions,
    sourceNotes: [
      `Risk-free rate ${market.riskFreeRate.toFixed(4)} from ${market.riskFreeRateSource}; equity risk premium ${market.equityRiskPremium.toFixed(4)} from ${market.erpSource}; beta ${market.beta.toFixed(2)} from ${market.marketSource}; market context as of ${market.asOfDate}.`,
      ...operatingProfile.sourceNotes,
      ...workingCapital.sourceNotes,
      ...capitalInputs.sourceNotes,
      exitMultiple.sourceNote,
      `Terminal growth ${terminalGrowthRate.toFixed(4)} is an editable analyst assumption; no issuer guidance or consensus long-term growth estimate is presented as a fact.`,
    ],
  };
}

export function buildIncompleteExportPayload(
  data: NativeUnifiedPayload,
  profile: CompanyProfile,
  historicals: HistoricalData,
  model: ProductionValuationModel,
  assumptions?: ModelAssumptions,
  modelSourceNotes: string[] = [],
  bankModel?: IncompleteBankModelExportData,
  insuranceModel?: IncompleteInsuranceModelExportData,
  reitModel?: IncompleteReitModelExportData,
  mortgageReitModel?: IncompleteMortgageReitModelExportData,
  assetManagerModel?: IncompleteAssetManagerModelExportData,
  telecomModel?: IncompleteTelecomModelExportData,
  integratedEnergyModel?: IncompleteIntegratedEnergyModelExportData,
  maturePharmaModel?: IncompleteMaturePharmaModelExportData,
  utilityModel?: IncompleteUtilityModelExportData,
  biotechModel?: IncompleteBiotechModelExportData,
  lifeInsuranceModel?: IncompleteLifeInsuranceModelExportData,
): IncompleteDcfExportPayload {
  const latest = data.canonical_financials.latest;
  const readLine = (field: string): number | null => {
    const latestRecord = latest as unknown as Record<string, unknown> | null | undefined;
    const line = asRecord(latestRecord?.[field]);
    if (typeof line.value === 'number' && Number.isFinite(line.value)) return line.value;
    const sources = Array.isArray(line.sources) ? line.sources : [];
    const hasFiledProvenance = sources.length > 0 && sources.every((source) => {
      const record = asRecord(source);
      return typeof record.accession === 'string' && record.accession.trim() !== ''
        && typeof record.filed === 'string' && record.filed.trim() !== '';
    });
    return line.source === 'not_applicable' && typeof line.method === 'string'
      && line.method.trim() !== '' && hasFiledProvenance
      ? 0
      : null;
  };
  const market: NonNullable<IncompleteDcfExportPayload['market']> = {
    currentPrice: model !== 'utility_dcf' || data.model_eligibility.required_input_readiness?.current_share_price !== false
      ? data.market.current_price : null,
    sharesDiluted: model !== 'utility_dcf' || data.model_eligibility.required_input_readiness?.filed_diluted_shares !== false
      ? historicals.sharesOutstanding ?? data.market.shares_outstanding : null,
    marketCap: data.market.market_cap,
    netDebt: data.market.net_debt,
    cash: data.market.cash ?? readLine('cash'),
    debt: data.market.debt ?? readLine('debt'),
    minorityInterest: readLine('non_controlling_interest'),
    preferredEquity: readLine('preferred_equity'),
    nonOperatingAssets: readLine('marketable_securities'),
  };
  const sourceNotes = Object.entries(data.source_metadata)
    .flatMap(([name, value]) => value.trim() ? [`${name}: ${value.trim()}`] : []);
  if (data.valuation_context.as_of_date) sourceNotes.push(`Market context as of ${data.valuation_context.as_of_date}`);
  sourceNotes.push(...modelSourceNotes);
  const requiredInputs = buildIncompleteInputRequirements(data, model);
  if (requiredInputs.length === 0) {
    throw new Error(`The ${model} route is input-required but returned no workbook input requirements.`);
  }
  const latestYear = historicals.years.at(-1);
  const forecastPeriods = model === 'unlevered_dcf' && assumptions && latestYear !== undefined
    ? Array.from({length: assumptions.horizonYears}, (_, index) => ({year: latestYear + index + 1}))
    : undefined;
  const peerQuality = data.data_quality.peers;
  const peerFetchedAtMs = peerQuality?.fetched_at_ms;
  const peerSetIsCurrent = Boolean(
    peerQuality
    && ['live', 'cached'].includes(peerQuality.status)
    && peerQuality.fallback_used !== true
    && typeof peerQuality.source === 'string' && peerQuality.source.trim()
    && !/\b(default|stale|unavailable)\b/i.test(peerQuality.source)
    && typeof peerFetchedAtMs === 'number' && Number.isFinite(peerFetchedAtMs)
    && peerFetchedAtMs > 0 && peerFetchedAtMs <= Date.now()
    && Date.now() - peerFetchedAtMs <= 24 * 60 * 60 * 1000,
  );
  const comparableMethod = isComparableValuationMethod(model) ? model : undefined;
  const comparableTarget = comparableMethod === 'ev_ebitda'
    ? historicals.ebitda.at(-1)
    : comparableMethod === 'revenue_multiple' ? historicals.revenue.at(-1) : undefined;
  const comparableRequiredInputs = requiredInputs.length > 0
    && requiredInputs.every((input) => input.key.startsWith('peer_ebitda:') || input.key.startsWith('peer_revenue:'));
  // Fallback peer universe with usable, freshly fetched market data can still
  // produce a confirmation schedule: every usable peer carries an analyst
  // confirmation requirement (generated above), so nothing unconfirmed enters
  // the median. A data-free universe (no confirmations) still fails closed.
  const fallbackPeerRecordUsable = Boolean(
    peerQuality
    && ['live', 'cached'].includes(peerQuality.status)
    && typeof peerQuality.source === 'string' && peerQuality.source.trim()
    && !/\b(default|stale|unavailable)\b/i.test(peerQuality.source)
    && typeof peerFetchedAtMs === 'number' && Number.isFinite(peerFetchedAtMs)
    && peerFetchedAtMs > 0 && peerFetchedAtMs <= Date.now()
    && Date.now() - peerFetchedAtMs <= 24 * 60 * 60 * 1000,
  );
  const incompleteComparableModel: IncompleteComparableModelExportData | undefined = (
    comparableMethod && typeof comparableTarget === 'number'
    && Number.isFinite(comparableTarget) && comparableTarget > 0 && comparableRequiredInputs
    && (peerSetIsCurrent || fallbackPeerRecordUsable)
  ) ? {
    method: comparableMethod,
    targetMetric: comparableTarget,
    peerStatus: peerQuality!.status as 'live' | 'cached',
    peerSource: peerQuality!.source,
    peerFallbackUsed: !peerSetIsCurrent,
    peerFetchedAtMs: peerFetchedAtMs!,
  } : undefined;
  // Fallback peers travel in comps only with analyst confirmation requirements
  // (generated above); the workbook mapper skips every unconfirmed fallback
  // peer, so a data-free universe still yields an empty peer schedule.
  const fallbackPeerConfirmations = !peerSetIsCurrent && comparableMethod !== undefined
    && requiredInputs.some((input) => input.key.startsWith(
      `peer_${comparableMethod === 'ev_ebitda' ? 'ebitda' : 'revenue'}:`));
  const currentPeers = peerSetIsCurrent || fallbackPeerConfirmations ? normalizePeers(data.peers) : [];

  return {
    buildStatus: 'input_required',
    requiredInputs,
    company: {
      name: profile.name,
      ticker: profile.ticker,
      exchange: profile.exchange,
      cik: profile.cik,
      currency: historicals.currency || 'USD',
      unitsScale: 'millions',
      asOfDate: requireValuationAsOfDate(data),
      fiscalYearEnd: profile.fiscalYearEnd,
      sector: profile.sector,
      industry: profile.industry,
      operatingArchetype: profile.operatingArchetype,
    },
    valuationModel: model,
    market,
    historicals: buildHistoricalFinancials(historicals),
    canonicalFinancials: data.canonical_financials,
    ...(bankModel ? {bankModel} : {}),
    ...(insuranceModel ? {insuranceModel} : {}),
    ...(reitModel ? {reitModel} : {}),
    ...(mortgageReitModel ? {mortgageReitModel} : {}),
    ...(assetManagerModel ? {assetManagerModel} : {}),
    ...(telecomModel ? {telecomModel} : {}),
    ...(integratedEnergyModel ? {integratedEnergyModel} : {}),
    ...(maturePharmaModel ? {maturePharmaModel} : {}),
    ...(utilityModel ? {utilityModel} : {}),
    ...(biotechModel ? {biotechModel} : {}),
    ...(lifeInsuranceModel ? {lifeInsuranceModel} : {}),
    ...(incompleteComparableModel ? {comparableModel: incompleteComparableModel} : {}),
    ...(assumptions ? {assumptions} : {}),
    ...(forecastPeriods ? {forecasts: forecastPeriods} : {}),
    comps: currentPeers.map((peer) => ({
      company: peer.name,
      ticker: peer.ticker,
      marketCap: peer.marketCap,
      ev: peer.enterpriseValue,
      revenue: peer.revenue,
      ebitda: peer.ebitda,
      evRev: peer.evRevenue,
      evEbitda: peer.evEbitda,
      growth: peer.revenueGrowth,
      margin: peer.ebitdaMargin,
      beta: peer.beta,
      totalDebt: peer.totalDebt,
      taxRate: peer.taxRate,
      price: peer.price,
      sharesOutstanding: peer.sharesOutstanding,
      depreciation: peer.depreciation,
    })),
    uiMeta: {
      printDate: new Date().toISOString().slice(0, 10),
      warnings: requiredInputs.map((requirement) => requirement.reason),
      sourceNotes,
    },
  };
}

export async function runValuationJob(ticker: string, backend: BackendPort): Promise<ValuationJobResult> {
  const data = await backend.getUnifiedCompany(ticker, 5);
  const eligibility = data.model_eligibility;
  if (eligibility.status === 'unsupported') {
    const reason = eligibility.blocked_models.find((item) => item.reason)?.reason;
    throw new Error(reason || `${eligibility.company_type} companies are not supported by the current DCF model.`);
  }

  if (eligibility.status === 'input_required') {
    if (!eligibility.model_route_available || !isProductionModelRoute(eligibility.preferred_model)) {
      throw new Error(`${eligibility.company_type} companies are not supported by the current DCF model.`);
    }
    const profile = mapNativeProfile(data.profile, data.financials_native, data.market);
    if (!profile.ticker) throw new Error(`The backend returned no usable profile for ${ticker}.`);
    const historicals = mapCanonicalFinancialsToHistoricals(data.canonical_financials, data.market, profile);
    const operatingAssumptions = eligibility.preferred_model === 'unlevered_dcf'
      ? buildIncompleteOperatingAssumptions(data, profile, historicals)
      : undefined;
    const incompleteBankHistory = eligibility.preferred_model === 'bank_residual_income'
      && eligibility.missing_input_gaps.length === 1
      && eligibility.missing_input_gaps[0]?.key === 'minimum_cet1_ratio'
      ? mapCanonicalBankFinancialsToHistoricals(data.canonical_financials)
      : undefined;
    const incompleteBankModel: IncompleteBankModelExportData | undefined = incompleteBankHistory
      ? {
          history: incompleteBankHistory,
          assumptions: buildSourcedIncompleteBankModelAssumptions(data, incompleteBankHistory),
        }
      : undefined;
    const incompleteInsuranceHistory = eligibility.preferred_model === 'insurance_pnc_residual_income'
      && eligibility.missing_input_gaps.length === 1
      && eligibility.missing_input_gaps[0]?.key === 'unpaid_loss_reserves'
      ? mapCanonicalInsuranceFinancialsToHistoricals(data.canonical_financials)
      : undefined;
    const incompleteInsuranceModel: IncompleteInsuranceModelExportData | undefined = incompleteInsuranceHistory
      ? buildIncompleteInsuranceModelExportData(
          incompleteInsuranceHistory,
          buildSourcedIncompleteInsuranceModelAssumptions(data, incompleteInsuranceHistory),
        )
      : undefined;
    const incompleteReitHistory = eligibility.preferred_model === 'reit_affo'
      && eligibility.missing_input_gaps.length === 1
      && eligibility.missing_input_gaps[0]?.key === 'same_store_noi_growth'
      ? mapCanonicalReitFinancialsToHistoricals(data.canonical_financials)
      : undefined;
    const incompleteReitModel: IncompleteReitModelExportData | undefined = incompleteReitHistory
      ? buildIncompleteReitModelExportData(
          incompleteReitHistory,
          buildSourcedIncompleteReitModelAssumptions(data, incompleteReitHistory),
        )
      : undefined;
    const incompleteMortgageReitHistory = eligibility.preferred_model === 'mortgage_reit_residual_income'
      && eligibility.missing_input_gaps.length === 1
      && eligibility.missing_input_gaps[0]?.key === 'average_repo_borrowings'
      ? mapCanonicalMortgageReitFinancialsToHistoricals(data.canonical_financials)
      : undefined;
    const incompleteMortgageReitModel: IncompleteMortgageReitModelExportData | undefined = incompleteMortgageReitHistory
      ? buildIncompleteMortgageReitModelExportData(
          incompleteMortgageReitHistory,
          buildSourcedMortgageReitModelAssumptions(data, incompleteMortgageReitHistory),
        )
      : undefined;
    const incompleteAssetManagerHistory = eligibility.preferred_model === 'asset_manager_aum_dcf'
      && eligibility.missing_input_gaps.length === 1
      && eligibility.missing_input_gaps[0]?.key === 'three_consecutive_average_aum_base_fee_yields'
      ? mapCanonicalAssetManagerFinancialsToHistoricals(data.canonical_financials)
      : undefined;
    const incompleteAssetManagerModel: IncompleteAssetManagerModelExportData | undefined = incompleteAssetManagerHistory
      ? buildIncompleteAssetManagerModelExportData(
          incompleteAssetManagerHistory,
          buildSourcedIncompleteAssetManagerModelAssumptions(data, incompleteAssetManagerHistory),
        )
      : undefined;
    const incompleteTelecomHistory = eligibility.preferred_model === 'telecom_subscriber_dcf'
      && eligibility.missing_input_gaps.length === 1
      && eligibility.missing_input_gaps[0]?.key === 'three_year_postpaid_phone_churn'
      ? mapCanonicalTelecomFinancialsToHistoricals(data.canonical_financials)
      : undefined;
    const incompleteTelecomModel: IncompleteTelecomModelExportData | undefined = incompleteTelecomHistory
      ? buildIncompleteTelecomModelExportData(
          incompleteTelecomHistory,
          buildSourcedIncompleteTelecomModelAssumptions(data, incompleteTelecomHistory),
        )
      : undefined;
    const incompleteIntegratedEnergyHistory = eligibility.preferred_model === 'integrated_energy_dcf'
      && eligibility.missing_input_gaps.length === 1
      && eligibility.missing_input_gaps[0]?.key === 'three_year_crude_oil_production'
      ? mapCanonicalEnergyFinancialsToHistoricals(data.canonical_financials)
      : undefined;
    const incompleteIntegratedEnergyModel: IncompleteIntegratedEnergyModelExportData | undefined = incompleteIntegratedEnergyHistory
      ? buildIncompleteIntegratedEnergyModelExportData(
          incompleteIntegratedEnergyHistory,
          buildSourcedIncompleteIntegratedEnergyAssumptions(data, incompleteIntegratedEnergyHistory),
        )
      : undefined;
    const incompleteMaturePharmaHistory = eligibility.preferred_model === 'mature_pharma_product_dcf'
      && eligibility.missing_input_gaps.length === 1
      && eligibility.missing_input_gaps[0]?.key === 'three_year_filed_product_sales'
      ? mapCanonicalPharmaFinancialsToHistoricals(data.canonical_financials)
      : undefined;
    const incompleteMaturePharmaModel: IncompleteMaturePharmaModelExportData | undefined = incompleteMaturePharmaHistory
      ? buildIncompleteMaturePharmaModelExportData(
          incompleteMaturePharmaHistory,
          buildSourcedIncompleteMaturePharmaModelAssumptions(data, incompleteMaturePharmaHistory),
        )
      : undefined;
    const latestAnnual = data.canonical_financials.annual.at(-1);
    const latestAnnualRecord = asRecord(latestAnnual);
    const filedShares = asRecord(latestAnnualRecord.shares);
    const filedShareSource = asRecord(Array.isArray(filedShares.sources) ? filedShares.sources[0] : undefined);
    const utilityAsOfDate = requireValuationAsOfDate(data);
    const utilityReadiness = eligibility.required_input_readiness ?? {};
    const incompleteUtilityModel: IncompleteUtilityModelExportData | undefined = eligibility.preferred_model === 'utility_dcf'
      ? {
          baseYear: typeof latestAnnualRecord.year === 'number' ? latestAnnualRecord.year : historicals.years.at(-1) ?? new Date().getUTCFullYear() - 1,
          forecastYears: 5,
          ...(utilityReadiness.current_risk_free_rate === true && typeof data.valuation_context.risk_free_rate === 'number'
            ? {riskFreeRate: data.valuation_context.risk_free_rate} : {}),
          ...(utilityReadiness.current_equity_risk_premium === true && typeof data.valuation_context.equity_risk_premium === 'number'
            ? {equityRiskPremium: data.valuation_context.equity_risk_premium} : {}),
          ...(utilityReadiness.current_beta === true && typeof data.market.beta === 'number' ? {beta: data.market.beta} : {}),
          ...(utilityReadiness.current_share_price === true && typeof data.market.current_price === 'number'
            ? {currentPrice: data.market.current_price} : {}),
          ...(utilityReadiness.filed_diluted_shares === true && typeof filedShares.value === 'number'
            ? {dilutedShares: filedShares.value} : {}),
          asOfDate: utilityAsOfDate,
          assumptionSources: {
            riskFreeRate: utilityReadiness.current_risk_free_rate === true && typeof data.valuation_context.treasury_rate_source === 'string'
              ? `${data.valuation_context.treasury_rate_source} as of ${utilityAsOfDate}`
              : 'Missing current Treasury observation; enter its dated source on Input Required.',
            equityRiskPremium: utilityReadiness.current_equity_risk_premium === true && typeof data.valuation_context.erp_source === 'string'
              ? `${data.valuation_context.erp_source} as of ${utilityAsOfDate}`
              : 'Missing current equity-risk-premium source; enter its dated source on Input Required.',
            beta: utilityReadiness.current_beta === true && typeof data.market.source === 'string'
              ? `${data.market.source} as of ${utilityAsOfDate}`
              : 'Missing current beta source; enter its dated source on Input Required.',
            currentPrice: utilityReadiness.current_share_price === true && typeof data.market.source === 'string'
              ? `${data.market.source} as of ${utilityAsOfDate}`
              : 'Missing current share-price source; enter its dated source on Input Required.',
            dilutedShares: utilityReadiness.filed_diluted_shares === true && typeof filedShareSource.accession === 'string'
              ? `SEC accession ${filedShareSource.accession}, filed ${String(filedShareSource.filed || 'date unavailable')}`
              : 'Missing diluted-share filing source; enter its reference on Input Required.',
          },
        }
      : undefined;
    const biotechPipelineAssets = Array.isArray(data.financials_native.pipeline_assets) ? data.financials_native.pipeline_assets : [];
    const biotechRevenueBase = historicals.revenue.at(-1);
    const incompleteBiotechModel: IncompleteBiotechModelExportData | undefined = eligibility.preferred_model === 'biotech_pipeline_rnpv'
      ? {
          baseYear: historicals.years.at(-1) ?? new Date().getUTCFullYear() - 1,
          forecastYears: 10,
          commercialRevenueBase: typeof biotechRevenueBase === 'number' && biotechRevenueBase > 0 ? biotechRevenueBase : 0,
          pipelineAssets: biotechPipelineAssets,
          riskFreeRate: typeof data.valuation_context.risk_free_rate === 'number' ? data.valuation_context.risk_free_rate : 0,
          equityRiskPremium: typeof data.valuation_context.equity_risk_premium === 'number' ? data.valuation_context.equity_risk_premium : 0,
          beta: typeof data.market.beta === 'number' ? data.market.beta : 0,
          asOfDate: utilityAsOfDate,
          assumptionSources: {
            riskFreeRate: `${data.valuation_context.treasury_rate_source || 'Missing'} as of ${utilityAsOfDate}`,
            equityRiskPremium: `${data.valuation_context.erp_source || 'Missing'} as of ${utilityAsOfDate}`,
            beta: `${data.market.source || 'Missing'} as of ${utilityAsOfDate}`,
            commercialRevenueBase: `Latest filed consolidated revenue, FY${historicals.years.at(-1) ?? 'unknown'}; source lineage is in Data Review.`,
            cashDebtBridge: `Latest filed balance-sheet bridge; source lineage is in Data Review.`,
          },
        }
      : undefined;
    const incompleteLifeInsuranceModel: IncompleteLifeInsuranceModelExportData | undefined = eligibility.preferred_model === 'life_insurer_distributable_earnings_dcf'
      ? buildIncompleteLifeInsuranceModelExportData(ticker, data)
      : undefined;
    const exportPayload = buildIncompleteExportPayload(
      data,
      profile,
      historicals,
      eligibility.preferred_model,
      operatingAssumptions?.assumptions,
      operatingAssumptions?.sourceNotes,
      incompleteBankModel,
      incompleteInsuranceModel,
      incompleteReitModel,
      incompleteMortgageReitModel,
      incompleteAssetManagerModel,
      incompleteTelecomModel,
      incompleteIntegratedEnergyModel,
      incompleteMaturePharmaModel,
      incompleteUtilityModel,
      incompleteBiotechModel,
      incompleteLifeInsuranceModel,
    );
    const workbookBytes = await backend.exportDcf(exportPayload);
    return {
      status: 'input_required',
      profile,
      results: null,
      missingInputs: exportPayload.requiredInputs,
      exportPayload,
      workbookBytes,
      warnings: qualityWarnings(data),
    };
  }

  const {profile, historicals, peers} = buildModelInputs(data, ticker, {
    requirePositiveRevenue: !['mortgage_reit_residual_income', 'integrated_energy_dcf', 'biotech_pipeline_rnpv', 'life_insurer_distributable_earnings_dcf'].includes(eligibility.preferred_model),
    allowCurrentMarketShareCount: eligibility.preferred_model === 'integrated_energy_dcf',
  });
  let assumptions: Assumptions;
  let operatingSourceNotes: string[] = [];
  let operatingBetaSource: string | undefined;
  let comparableValuationInput: ComparableValuationInput | undefined;
let comparablePeerTickers: string[] | undefined;
  if (isComparableValuationMethod(eligibility.preferred_model)) {
    const comparable = buildComparableValuationInput(
      data,
      ticker,
      peers,
      historicals,
      eligibility.preferred_model,
    );
    comparableValuationInput = comparable.input;
    comparablePeerTickers = comparable.peerTickers;
    const rf = data.valuation_context.risk_free_rate;
    const mrp = data.valuation_context.equity_risk_premium;
    assumptions = buildBaseAssumptions(
      historicals,
      {rf: typeof rf === 'number' && rf > 0 ? rf : undefined, mrp: typeof mrp === 'number' && mrp > 0 ? mrp : undefined},
      comparable.input.selectedMultiple,
      profile,
      {useIndustryTemplate: false},
    );
    assumptions = normalizeAssumptions({
      ...assumptions,
      terminalExitMultiple: comparable.input.selectedMultiple,
      modelType: 'unlevered',
    }, historicals.sharesOutstanding ?? 0, historicals);
    operatingSourceNotes = comparable.sourceNotes;
  } else if (eligibility.preferred_model === 'asset_manager_aum_dcf') {
    const rf = data.valuation_context.risk_free_rate;
    const mrp = data.valuation_context.equity_risk_premium;
    assumptions = buildBaseAssumptions(
      historicals,
      {rf: typeof rf === 'number' && rf > 0 ? rf : undefined, mrp: typeof mrp === 'number' && mrp > 0 ? mrp : undefined},
      12,
      profile,
      {useIndustryTemplate: false},
    );
  } else if (eligibility.preferred_model === 'telecom_subscriber_dcf') {
    const rf = data.valuation_context.risk_free_rate;
    const mrp = data.valuation_context.equity_risk_premium;
    assumptions = buildBaseAssumptions(
      historicals,
      {rf: typeof rf === 'number' && rf > 0 ? rf : undefined, mrp: typeof mrp === 'number' && mrp > 0 ? mrp : undefined},
      12,
      profile,
      {useIndustryTemplate: false},
    );
  } else if (eligibility.preferred_model === 'mortgage_reit_residual_income') {
    const rf = data.valuation_context.risk_free_rate;
    const mrp = data.valuation_context.equity_risk_premium;
    assumptions = buildBaseAssumptions(
      historicals,
      {rf: typeof rf === 'number' && rf > 0 ? rf : undefined, mrp: typeof mrp === 'number' && mrp > 0 ? mrp : undefined},
      12,
      profile,
      {useIndustryTemplate: false},
    );
  } else if (eligibility.preferred_model === 'integrated_energy_dcf') {
    const rf = data.valuation_context.risk_free_rate;
    const mrp = data.valuation_context.equity_risk_premium;
    assumptions = buildBaseAssumptions(
      historicals,
      {rf: typeof rf === 'number' && rf > 0 ? rf : undefined, mrp: typeof mrp === 'number' && mrp > 0 ? mrp : undefined},
      12,
      profile,
      {useIndustryTemplate: false},
    );
  } else if (eligibility.preferred_model === 'mature_pharma_product_dcf') {
    const rf = data.valuation_context.risk_free_rate;
    const mrp = data.valuation_context.equity_risk_premium;
    assumptions = buildBaseAssumptions(
      historicals,
      {rf: typeof rf === 'number' && rf > 0 ? rf : undefined, mrp: typeof mrp === 'number' && mrp > 0 ? mrp : undefined},
      12,
      profile,
      {useIndustryTemplate: false},
    );
  } else if (eligibility.preferred_model === 'unlevered_dcf') {
    const market = requireCurrentMarketData(data);
    operatingBetaSource = market.marketSource;
    const capitalInputs = operatingCapitalInputs(data, historicals, market.marketCap);
    const exitMultiple = sourcedTerminalMultiple(data, peers);
    const latestIndex = historicals.years.length - 1;
    const latestRevenue = sourcedHistoricalLine(historicals, 'revenue', latestIndex).value!;
    const latestEbit = sourcedHistoricalLine(historicals, 'ebit', latestIndex).value!;
    const latestGrossProfit = sourcedHistoricalLine(historicals, 'gross_profit', latestIndex).value!;
    const latestCostOfRevenue = Math.abs(sourcedHistoricalLine(historicals, 'cost_of_revenue', latestIndex).value!);
    const latestCapex = Math.abs(sourcedHistoricalLine(historicals, 'capex', latestIndex).value!);
    const latestDepreciation = Math.abs(sourcedHistoricalLine(historicals, 'depreciation', latestIndex).value!);
    const sourcedEbitMargin = latestRevenue > 0 ? latestEbit / latestRevenue : Number.NaN;
    const sourcedGrossMargin = latestRevenue > 0 ? latestGrossProfit / latestRevenue : Number.NaN;
    if (!Number.isFinite(sourcedEbitMargin) || sourcedEbitMargin <= 0 || sourcedEbitMargin > 1) {
      throw new Error(`FY${historicals.years[latestIndex]} filed revenue and EBIT do not support a sourced EBIT margin.`);
    }
    if (!Number.isFinite(sourcedGrossMargin) || sourcedGrossMargin <= 0 || sourcedGrossMargin > 1
      || latestCostOfRevenue <= 0 || latestCapex < 0 || latestDepreciation < 0) {
      throw new Error(`FY${historicals.years[latestIndex]} filed operating data do not support sourced gross-margin, CapEx, and D&A assumptions.`);
    }
    const workingCapital = eligibility.operating_archetype === 'subscription_software'
      ? deriveSubscriptionSoftwareWorkingCapital(historicals)
      : deriveOperatingWorkingCapitalDays(historicals);
    const initialAssumptions = buildBaseAssumptions(
      historicals,
      {rf: market.riskFreeRate, mrp: market.equityRiskPremium},
      exitMultiple.multiple,
      profile,
      {useIndustryTemplate: false},
    );
    const operatingProfile = buildOperatingModelProfile(
      eligibility.operating_archetype,
      historicals,
      initialAssumptions,
    );
    const terminalGrowthRate = initialAssumptions.terminalGrowthRate;
    if (!Number.isFinite(terminalGrowthRate) || terminalGrowthRate < 0 || terminalGrowthRate > 0.08) {
      throw new Error('Operating DCF terminal-growth assumption is outside the supported 0%–8% range.');
    }
    assumptions = normalizeAssumptions({
      ...initialAssumptions,
      riskFreeRate: market.riskFreeRate,
      equityRiskPremium: market.equityRiskPremium,
      beta: market.beta,
      ...operatingProfile.assumptionOverrides,
      accountsReceivableDays: workingCapital.accountsReceivableDays,
      inventoryDays: workingCapital.inventoryDays,
      accountsPayableDays: workingCapital.accountsPayableDays,
      nwcChangeRatio: workingCapital.nwcChangeRatio,
      taxRate: capitalInputs.taxRate,
      currentDebt: capitalInputs.debt,
      costOfDebt: capitalInputs.costOfDebt,
      leverageTarget: capitalInputs.leverageTarget,
      terminalExitMultiple: exitMultiple.multiple,
      modelType: 'unlevered',
      discountRateMode: 'derived',
    }, historicals.sharesOutstanding ?? 0, historicals, market.marketCap);
    if (!Number.isFinite(assumptions.wacc) || assumptions.wacc < 0.02 || assumptions.wacc > 0.3
      || terminalGrowthRate >= assumptions.wacc) {
      throw new Error('Operating DCF requires a supported WACC that exceeds the explicit terminal-growth assumption.');
    }
    operatingSourceNotes = [
      `Risk-free rate ${market.riskFreeRate.toFixed(4)} from ${market.riskFreeRateSource}; equity risk premium ${market.equityRiskPremium.toFixed(4)} from ${market.erpSource}; beta ${market.beta.toFixed(2)} from ${market.marketSource}; market context as of ${market.asOfDate}.`,
      ...operatingProfile.sourceNotes,
      ...workingCapital.sourceNotes,
      ...capitalInputs.sourceNotes,
      exitMultiple.sourceNote,
      `Terminal growth ${terminalGrowthRate.toFixed(4)} is an editable analyst assumption; no issuer guidance or consensus long-term growth estimate is presented as a fact.`,
    ];
  } else {
    const rf = data.valuation_context.risk_free_rate;
    const mrp = data.valuation_context.equity_risk_premium;
    assumptions = buildBaseAssumptions(
      historicals,
      {rf: typeof rf === 'number' && rf > 0 ? rf : undefined, mrp: typeof mrp === 'number' && mrp > 0 ? mrp : undefined},
      12,
      profile,
    );
  }
  const bankHistorical = eligibility.preferred_model === 'bank_residual_income'
    ? mapCanonicalBankFinancialsToHistoricals(data.canonical_financials)
    : undefined;
  const bankAssumptions = bankHistorical
    ? buildSourcedBankModelAssumptions(data, bankHistorical)
    : undefined;
  const insuranceHistorical = eligibility.preferred_model === 'insurance_pnc_residual_income'
    ? mapCanonicalInsuranceFinancialsToHistoricals(data.canonical_financials)
    : undefined;
  const insuranceAssumptions = insuranceHistorical
    ? buildSourcedInsuranceModelAssumptions(data, insuranceHistorical)
    : undefined;
  const reitHistorical = eligibility.preferred_model === 'reit_affo'
    ? mapCanonicalReitFinancialsToHistoricals(data.canonical_financials)
    : undefined;
  const reitAssumptions = reitHistorical
    ? buildSourcedReitModelAssumptions(data, reitHistorical)
    : undefined;
  const assetManagerHistorical: AssetManagerHistoricalData | undefined = eligibility.preferred_model === 'asset_manager_aum_dcf'
    ? mapCanonicalAssetManagerFinancialsToHistoricals(data.canonical_financials)
    : undefined;
  const assetManagerAssumptions: AssetManagerModelAssumptions | undefined = assetManagerHistorical
    ? buildSourcedAssetManagerModelAssumptions(data, assetManagerHistorical)
    : undefined;
  const telecomHistorical: TelecomHistoricalData | undefined = eligibility.preferred_model === 'telecom_subscriber_dcf'
    ? mapCanonicalTelecomFinancialsToHistoricals(data.canonical_financials)
    : undefined;
  const telecomAssumptions: TelecomModelAssumptions | undefined = telecomHistorical
    ? buildSourcedTelecomModelAssumptions(data, telecomHistorical)
    : undefined;
  const mortgageReitHistorical: MortgageReitHistoricalData | undefined = eligibility.preferred_model === 'mortgage_reit_residual_income'
    ? mapCanonicalMortgageReitFinancialsToHistoricals(data.canonical_financials)
    : undefined;
  const mortgageReitAssumptions: MortgageReitModelAssumptions | undefined = mortgageReitHistorical
    ? buildSourcedMortgageReitModelAssumptions(data, mortgageReitHistorical)
    : undefined;
  const energyHistorical: EnergyHistoricalData | undefined = eligibility.preferred_model === 'integrated_energy_dcf'
    ? mapCanonicalEnergyFinancialsToHistoricals(data.canonical_financials)
    : undefined;
  const energyAssumptions: IntegratedEnergyAssumptions | undefined = energyHistorical
    ? buildSourcedIntegratedEnergyModelAssumptions(data, energyHistorical)
    : undefined;
  const pharmaHistorical: PharmaHistoricalData | undefined = eligibility.preferred_model === 'mature_pharma_product_dcf'
    ? mapCanonicalPharmaFinancialsToHistoricals(data.canonical_financials)
    : undefined;
  const pharmaAssumptions: MaturePharmaModelAssumptions | undefined = pharmaHistorical
    ? buildSourcedMaturePharmaModelAssumptions(data, pharmaHistorical)
    : undefined;
  const utilityAssumptions: UtilityModelAssumptions | undefined = eligibility.preferred_model === 'utility_dcf'
    ? buildSourcedUtilityModelAssumptions(data)
    : undefined;
  const biotechAssumptions: BiotechRnpvAssumptions | undefined = eligibility.preferred_model === 'biotech_pipeline_rnpv'
    ? buildSourcedBiotechRnpvAssumptions(data)
    : undefined;
  const lifeAssumptions: LifeInsuranceDcfAssumptions | undefined = eligibility.preferred_model === 'life_insurer_distributable_earnings_dcf'
    ? buildSourcedLifeInsuranceAssumptions(data)
    : undefined;
  const results = calculateRoutedValuation(
    historicals,
    assumptions,
    {},
    eligibility,
    bankHistorical && bankAssumptions
      ? {historical: bankHistorical, assumptions: bankAssumptions}
      : undefined,
    insuranceHistorical && insuranceAssumptions
      ? {historical: insuranceHistorical, assumptions: insuranceAssumptions}
      : undefined,
    reitHistorical && reitAssumptions
      ? {historical: reitHistorical, assumptions: reitAssumptions}
      : undefined,
    comparableValuationInput,
    assetManagerHistorical && assetManagerAssumptions
      ? {historical: assetManagerHistorical, assumptions: assetManagerAssumptions}
      : undefined,
    telecomHistorical && telecomAssumptions
      ? {historical: telecomHistorical, assumptions: telecomAssumptions}
      : undefined,
    mortgageReitHistorical && mortgageReitAssumptions
      ? {historical: mortgageReitHistorical, assumptions: mortgageReitAssumptions}
      : undefined,
    energyHistorical && energyAssumptions
      ? {historical: energyHistorical, assumptions: energyAssumptions}
      : undefined,
    pharmaHistorical && pharmaAssumptions
      ? {historical: pharmaHistorical, assumptions: pharmaAssumptions}
      : undefined,
    utilityAssumptions,
    biotechAssumptions,
    lifeAssumptions ? {assumptions: lifeAssumptions} : undefined,
  );
  if (
    !results.isValuationSupported
    || !Number.isFinite(results.impliedSharePrice)
    || results.impliedSharePrice <= 0
  ) {
    throw new Error(valuationFailureMessage(ticker, eligibility, results, assumptions));
  }

  let exportPayload: DcfExportPayload;
  if (bankHistorical && bankAssumptions) {
    exportPayload = buildBankModelExportPayload(profile, bankHistorical, bankAssumptions);
  } else if (insuranceHistorical && insuranceAssumptions) {
    exportPayload = buildInsuranceModelExportPayload(profile, insuranceHistorical, insuranceAssumptions);
  } else if (reitHistorical && reitAssumptions) {
    exportPayload = buildReitModelExportPayload(profile, reitHistorical, reitAssumptions);
  } else if (assetManagerHistorical && assetManagerAssumptions) {
    exportPayload = buildAssetManagerModelExportPayload(profile, assetManagerHistorical, assetManagerAssumptions);
  } else if (telecomHistorical && telecomAssumptions) {
    exportPayload = buildTelecomModelExportPayload(profile, telecomHistorical, telecomAssumptions);
  } else if (mortgageReitHistorical && mortgageReitAssumptions) {
    exportPayload = buildMortgageReitModelExportPayload(profile, mortgageReitHistorical, mortgageReitAssumptions);
  } else if (energyHistorical && energyAssumptions) {
    exportPayload = buildIntegratedEnergyModelExportPayload(profile, energyHistorical, energyAssumptions);
  } else if (pharmaHistorical && pharmaAssumptions) {
    exportPayload = buildMaturePharmaModelExportPayload(profile, pharmaHistorical, pharmaAssumptions);
  } else if (utilityAssumptions) {
    exportPayload = buildUtilityModelExportPayload(profile, {
      ...utilityAssumptions,
      asOfDate: requireValuationAsOfDate(data),
      assumptionSources: {},
    }, results.forecasts);
  } else if (biotechAssumptions) {
    const pipelineAssets = Array.isArray(data.financials_native.pipeline_assets)
      ? data.financials_native.pipeline_assets
      : [];
    exportPayload = buildBiotechModelExportPayload(profile, biotechAssumptions, pipelineAssets, results.forecasts, requireValuationAsOfDate(data));
  } else if (lifeAssumptions) {
    throw new Error(
      'Life-insurer ready export requires an analyst-completed input-required workbook; '
      + 'the backend ships no complete life-insurance workbook mapper yet, so the ready life route '
      + 'stays behind the analyst-input acceptance workflow.',
    );
  } else {
    exportPayload = buildExportPayload(
      profile,
      historicals,
      assumptions,
      results,
      requireValuationAsOfDate(data),
      comparablePeerTickers && comparablePeerTickers.length > 0
        ? peers.filter((peer) => comparablePeerTickers!.includes(peer.ticker))
        : peers,
      getPrecedentTransactionsBySector(profile.sector || 'Technology'),
    );
    if (comparableValuationInput) {
      exportPayload.valuationModel = comparableValuationInput.method;
      exportPayload.forecasts = [];
      exportPayload.scenarios = undefined;
      exportPayload.sensitivities = undefined;
      exportPayload.revenueBuild = undefined;
      const peerQuality = data.data_quality.peers;
      if (!peerQuality
        || (peerQuality.status !== 'live' && peerQuality.status !== 'cached')
        || peerQuality.fallback_used
        || peerQuality.fetched_at_ms === null) {
        throw new Error('Comparable valuation export requires a current peer-source record.');
      }
      exportPayload.comparableModel = {
        method: comparableValuationInput.method,
        targetMetric: comparableValuationInput.targetMetric,
        selectedMultiple: comparableValuationInput.selectedMultiple,
        peersUsedForMedian: comparablePeerTickers ?? [],
        peerStatus: peerQuality.status,
        peerSource: peerQuality.source,
        peerFallbackUsed: peerQuality.fallback_used,
        peerFetchedAtMs: peerQuality.fetched_at_ms,
      };
    }
  }
  if (operatingBetaSource) exportPayload.assumptions.wacc.betaSource = operatingBetaSource;
  if (operatingBetaSource && eligibility.operating_archetype !== 'subscription_software') {
    exportPayload.assumptions.wcMethod = 'Days';
    exportPayload.assumptions.nwcPctRevenue = 0;
  }
  enrichSourceNotes(exportPayload, data, historicals, bankHistorical || insuranceHistorical || reitHistorical || assetManagerHistorical ? [] : operatingSourceNotes);
  exportPayload = {...exportPayload, buildStatus: 'ready', requiredInputs: []};
  const workbookBytes = await backend.exportDcf(exportPayload);
  const hasSpecialistModel = Boolean(
    bankHistorical || insuranceHistorical || reitHistorical || assetManagerHistorical
    || telecomHistorical || mortgageReitHistorical || energyHistorical || pharmaHistorical
    || utilityAssumptions || biotechAssumptions || lifeAssumptions,
  );
  const modelWarnings = specialistModelWarnings(exportPayload, hasSpecialistModel);
  const warnings = [...qualityWarnings(data), ...modelWarnings, results.sectorWarning]
    .filter((warning): warning is string => Boolean(warning));

  return {status: 'ready', profile, results, exportPayload, workbookBytes, warnings};
}

export function formatValuationJobSuccess(result: ValuationJobResult, outputPath: string): string {
  if (result.status === 'input_required') {
    return formatCliInputRequiredSuccess(
      result.profile.name,
      result.profile.ticker,
      outputPath,
      result.missingInputs,
    );
  }
  return formatCliSuccess(result.profile.name, result.profile.ticker, outputPath);
}
