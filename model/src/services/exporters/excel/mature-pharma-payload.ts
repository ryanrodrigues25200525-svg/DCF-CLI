import type {CompanyProfile, PharmaHistoricalData} from '@/core/types';
import type {DcfExportPayload, IncompleteMaturePharmaModelExportData, MaturePharmaModelExportData} from './types';
import type {IncompleteMaturePharmaModelAssumptions, MaturePharmaAssumptionSources, MaturePharmaModelAssumptions} from '@/services/valuation/mature-pharma-model';

function describeLine(
  line: {value: number | null; method: string; concept: string | null; sources: Array<{
    concept?: string | null;
    accession: string | null;
    filed: string | null;
    fiscal_period?: string | null;
    unit?: string | null;
    unit_scale?: string | null;
  }>},
  label: string,
  year: number,
): string {
  const provenance = line.sources.map((source) =>
    `${source.concept ?? line.concept ?? 'SEC filing row'}; accession ${source.accession ?? 'unresolved'}; filed ${source.filed ?? 'unresolved'}; ${source.fiscal_period ?? 'period unavailable'}; ${source.unit ?? 'unit unavailable'} ${source.unit_scale ?? ''}`,
  ).join('; ');
  return `FY${year} ${label}: ${line.method}; value ${line.value ?? 'missing'}; ${provenance || 'no SEC source record'}`;
}

export function buildIncompleteMaturePharmaModelExportData(
  history: PharmaHistoricalData,
  assumptions: IncompleteMaturePharmaModelAssumptions,
): IncompleteMaturePharmaModelExportData {
  if (history.years.length !== 3 || history.annual.length !== 3
    || history.annual.some((item, index) => item.year !== history.years[index])) {
    throw new Error('Incomplete PFE workbook requires three aligned annual periods.');
  }
  const hasMissingProductRevenue = history.annual.some((year) =>
    year.pharma.products.some((product) => (product.revenue.source !== 'sec_native' && product.revenue.source !== 'derived')
      || typeof product.revenue.value !== 'number'
      || product.revenue.sources.length === 0
      || product.revenue.sources.some((source) => !source.accession || !source.filed)));
  if (!hasMissingProductRevenue) throw new Error('Incomplete PFE workbook requires a missing filed product revenue line.');
  return {history, assumptions};
}

export function buildMaturePharmaModelExportPayload(
  company: CompanyProfile,
  history: PharmaHistoricalData,
  assumptions: MaturePharmaModelAssumptions,
): DcfExportPayload {
  if (company.ticker.toUpperCase() !== 'PFE') throw new Error('The first mature-pharma workbook is issuer-specific to Pfizer.');
  if (history.years.length !== 3 || history.annual.length !== 3
    || history.annual.some((item, index) => item.year !== history.years[index])) {
    throw new Error('Mature-pharma workbook requires three aligned annual years.');
  }
  const latest = history.annual.at(-1);
  if (!latest || latest.year !== assumptions.baseYear || latest.year !== history.years.at(-1)) {
    throw new Error('PFE product history and model base year do not align.');
  }
  const sourceNotes: string[] = [];
  for (const year of history.annual) {
    sourceNotes.push(describeLine(year.pharma.reported_total_revenue, 'Note 17 total revenue', year.year));
    for (const product of year.pharma.products) {
      sourceNotes.push(describeLine(product.revenue, `product revenue — ${product.product_name}`, year.year));
    }
    for (const [name, line] of Object.entries({
      revenue: year.revenue, ebit: year.ebit, interest_expense: year.interestExpense, tax_rate: year.taxRate,
      depreciation: year.depreciation, capex: year.capex, working_capital: year.nwcChange,
      cash: year.cash, marketable_securities: year.marketableSecurities, debt: year.debt,
      non_controlling_interest: year.nonControllingInterest, preferred_equity: year.preferredEquity,
      diluted_shares: year.dilutedShares,
    })) sourceNotes.push(describeLine(line, name, year.year));
  }
  for (const patent of latest.pharma.patents) {
    sourceNotes.push(describeLine(patent.year, `${patent.product_name} ${patent.region} ${patent.metric}: ${patent.reported_text}`, latest.year));
  }
  const sources = assumptions.assumptionSources satisfies MaturePharmaAssumptionSources;
  for (const [name, source] of Object.entries(sources)) sourceNotes.push(`${name} assumption: ${source}`);
  for (const product of assumptions.products) sourceNotes.push(`${product.productName} modeled LOE assumption: ${product.sourceNote}`);
  sourceNotes.push(
    `FY${latest.year} is the latest annual operating base. The valuation excludes unlaunched pipeline assets and does not add patent-option NAV to enterprise value.`,
    'Reported regional basic patent dates are separate from the editable modeled global LOE year; patent expiry is not a generic-entry date.',
    'The PFE product table groups some families and the source does not disclose revenue by territory; assumptions retain this uncertainty for analyst review.',
    'Unallocated alliance, royalty, and other revenue is the reconciled residual of total revenue less individually disclosed product lines.',
    'Long-term equity-method and private investments are not added to the cash-like short-term investment bridge.',
  );
  const maturePharmaModel: MaturePharmaModelExportData = {history, assumptions};
  return {
    company: {
      name: company.name, ticker: company.ticker, exchange: company.exchange, cik: company.cik,
      currency: company.currency || 'USD', unitsScale: 'units', asOfDate: assumptions.asOfDate,
      fiscalYearEnd: company.fiscalYearEnd, sector: company.sector, industry: company.industry,
      operatingArchetype: 'mature_pharma',
    },
    valuationModel: 'mature_pharma_product_dcf',
    maturePharmaModel,
    market: {
      currentPrice: assumptions.currentPrice, sharesDiluted: assumptions.commonSharesOutstanding,
      marketCap: assumptions.marketCapitalization, cash: assumptions.cash, debt: assumptions.debt,
      minorityInterest: assumptions.nonControllingInterest, preferredEquity: assumptions.preferredEquity,
      nonOperatingAssets: assumptions.marketableSecurities,
    },
    historicals: {years: history.years, income: {}, balance: {}, cashflow: {}},
    assumptions: {
      scenarioMode: 'Base', horizonYears: assumptions.forecastYears, revenueMethod: 'BottomUp',
      taxRate: assumptions.taxRate, capexMethod: '%Revenue', capexPctRevenue: assumptions.capexPctRevenue,
      daMethod: '%Revenue', daPctRevenue: assumptions.depreciationPctRevenue,
      wcMethod: 'NWC_%Revenue', nwcPctRevenue: assumptions.workingCapitalInvestmentPctRevenue,
      wacc: {
        rf: assumptions.riskFreeRate, erp: assumptions.equityRiskPremium, beta: assumptions.beta,
        betaSource: assumptions.assumptionSources.wacc, costOfDebt: assumptions.costOfDebt,
        debtWeight: assumptions.debtWeight, equityWeight: assumptions.equityWeight,
      },
      waccRate: assumptions.wacc,
      terminal: {method: 'Perpetuity', g: assumptions.terminalGrowthRate},
    },
    forecasts: [],
    uiMeta: {
      printDate: new Date().toISOString().slice(0, 10), companyName: company.name,
      currency: company.currency || 'USD', confidenceLabel: 'Medium', confidenceScore: 0.58,
      warnings: [
        `This PFE model starts from FY${latest.year} annual actuals; later quarterly product revenue is not included.`,
        'Other pharma issuers remain blocked until their product-sales and patent source contracts pass live acceptance.',
      ],
      sourceNotes,
    },
  };
}
