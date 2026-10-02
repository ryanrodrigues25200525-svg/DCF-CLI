import type {TelecomHistoricalData, CompanyProfile} from '@/core/types';
import type {DcfExportPayload, IncompleteTelecomModelExportData, TelecomModelExportData} from './types';
import type {IncompleteTelecomModelAssumptions, TelecomModelAssumptions} from '@/services/valuation/telecom-model';

function sourceNote(
  field: string,
  year: number,
  line: {value: number | null; method: string; concept: string | null; sources: Array<{
    concept: string | null;
    accession: string | null;
    filed: string | null;
    fiscal_period?: string | null;
    unit?: string | null;
    unit_scale?: string | null;
  }>},
): string {
  const sources = line.sources.map((source) => {
    const unit = [source.unit, source.unit_scale].filter(Boolean).join(' ') || 'unit unavailable';
    return `${source.concept || line.concept || 'derived SEC line'}; accession ${source.accession || 'unresolved'}; filed ${source.filed || 'unresolved'}; ${source.fiscal_period || 'period unavailable'}; ${unit}`;
  }).join('; ');
  return `FY${year} ${field}: ${line.method}; value ${line.value ?? 'missing'}; ${sources || 'no source record'}`;
}

export function buildIncompleteTelecomModelExportData(
  history: TelecomHistoricalData,
  assumptions: IncompleteTelecomModelAssumptions,
): IncompleteTelecomModelExportData {
  if (history.annual.length !== 4 || history.annual.some((item, index) => item.year !== history.years[index])) {
    throw new Error('Incomplete telecom workbook requires four aligned years, including an opening subscriber balance.');
  }
  const hasMissingChurn = history.annual.slice(-3).some((item) => {
    if (!item.telecom) return true;
    const line = item.telecom.postpaid_phone_churn;
    return !(line.source === 'sec_native' || line.source === 'derived')
      || typeof line.value !== 'number' || !Number.isFinite(line.value)
      || line.sources.length === 0 || line.sources.some((source) => !source.accession || !source.filed);
  });
  if (!hasMissingChurn) throw new Error('Incomplete telecom workbook requires a missing recent annual postpaid phone churn input.');
  return {history, assumptions};
}

export function buildTelecomModelExportPayload(
  company: CompanyProfile,
  history: TelecomHistoricalData,
  assumptions: TelecomModelAssumptions,
): DcfExportPayload {
  if (history.annual.length !== 4 || history.annual.some((item, index) => item.year !== history.years[index])) {
    throw new Error('Telecom workbook requires four aligned source years, including the opening customer balance.');
  }
  const latest = history.annual.at(-1);
  if (!latest || latest.year !== assumptions.baseYear || latest.year !== history.years.at(-1)) {
    throw new Error('Telecom history, base year, and filed source periods do not align.');
  }
  const sourceNotes: string[] = [];
  for (const item of history.annual) {
    sourceNotes.push(...Object.entries(item.telecom ?? {}).map(([field, line]) => sourceNote(`telecom.${field}`, item.year, line)));
    for (const [field, line] of Object.entries({
      revenue: item.revenue,
      EBIT: item.ebit,
      interest_expense: item.interestExpense,
      tax_rate: item.taxRate,
      depreciation: item.depreciation,
      CapEx: item.capex,
      working_capital_change: item.nwcChange,
      cash: item.cash,
      marketable_securities: item.marketableSecurities,
      debt: item.debt,
      non_controlling_interest: item.nonControllingInterest,
      preferred_equity: item.preferredEquity,
      diluted_shares: item.dilutedShares,
    })) sourceNotes.push(sourceNote(field, item.year, line));
  }
  for (const [name, source] of Object.entries(assumptions.assumptionSources)) sourceNotes.push(`${name} assumption: ${source}.`);
  sourceNotes.push(
    `Risk-free rate ${assumptions.riskFreeRate.toFixed(4)}, ERP ${assumptions.equityRiskPremium.toFixed(4)}, beta ${assumptions.beta.toFixed(3)}, filed debt cost ${assumptions.costOfDebt.toFixed(4)}, and WACC ${assumptions.wacc.toFixed(4)} as of ${assumptions.asOfDate}.`,
    `Historical actuals start at FY${history.years[0]} for the opening subscriber balance; FY${latest.year} is the latest filed operating base.`,
    'The forecast does not incorporate 2026 quarterly results or post-year-end acquisitions and spectrum transactions unless an analyst updates the separate inputs.',
    'Wireless service revenue per customer is derived from filed Mobility service revenue divided by average filed wireless subscribers and twelve months; it is a model calculation, not issuer-reported ARPU.',
    'Consumer broadband revenue per connection is derived from filed Consumer Wireline broadband revenue divided by average filed broadband connections and twelve months.',
    'Working-capital investment is separately derived from cash-flow changes in receivables, installment receivables, contract assets, other current assets and accounts payable/accruals.',
    'The terminal method is Gordon growth; the editable terminal-growth input must remain below the live, dated WACC.',
  );

  const telecomModel: TelecomModelExportData = {history, assumptions};
  return {
    company: {
      name: company.name,
      ticker: company.ticker,
      exchange: company.exchange,
      cik: company.cik,
      currency: company.currency || 'USD',
      unitsScale: 'units',
      asOfDate: assumptions.asOfDate,
      fiscalYearEnd: company.fiscalYearEnd,
      sector: company.sector,
      industry: company.industry,
    },
    valuationModel: 'telecom_subscriber_dcf',
    telecomModel,
    market: {
      currentPrice: assumptions.currentPrice,
      sharesDiluted: assumptions.dilutedShares,
      marketCap: assumptions.marketCapitalization,
      cash: assumptions.cash,
      debt: assumptions.debt,
      minorityInterest: assumptions.nonControllingInterest,
      preferredEquity: assumptions.preferredEquity,
      nonOperatingAssets: assumptions.marketableSecurities,
    },
    historicals: {years: history.years, income: {}, balance: {}, cashflow: {}},
    assumptions: {
      scenarioMode: 'Base',
      horizonYears: assumptions.forecastYears,
      revenueMethod: 'BottomUp',
      taxRate: assumptions.taxRate,
      capexMethod: '%Revenue',
      capexPctRevenue: assumptions.capexPctRevenue,
      daMethod: '%Revenue',
      daPctRevenue: assumptions.depreciationPctRevenue,
      wcMethod: 'NWC_%Revenue',
      nwcPctRevenue: assumptions.workingCapitalChangePctRevenue,
      wacc: {
        rf: assumptions.riskFreeRate,
        erp: assumptions.equityRiskPremium,
        beta: assumptions.beta,
        betaSource: assumptions.assumptionSources.wacc,
        costOfDebt: assumptions.costOfDebt,
        debtWeight: assumptions.debtWeight,
        equityWeight: assumptions.equityWeight,
      },
      waccRate: assumptions.wacc,
      terminal: {method: 'Perpetuity', g: assumptions.terminalGrowthRate},
    },
    forecasts: [],
    uiMeta: {
      printDate: new Date().toISOString().slice(0, 10),
      companyName: company.name,
      currency: company.currency || 'USD',
      confidenceLabel: 'Medium',
      confidenceScore: 0.72,
      warnings: [
        `The latest telecom segment and subscriber actuals are FY${latest.year}; 2026 quarterly changes and subsequent acquisitions/spectrum transactions are not included.`,
      ],
      sourceNotes,
    },
  };
}
