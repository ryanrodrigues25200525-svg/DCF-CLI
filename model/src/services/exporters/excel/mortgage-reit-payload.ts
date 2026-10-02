import type {CompanyProfile, MortgageReitHistoricalData} from '@/core/types';
import type {DcfExportPayload, IncompleteMortgageReitModelExportData, MortgageReitModelExportData} from './types';
import type {MortgageReitAssumptionSources, MortgageReitModelAssumptions} from '@/services/valuation/mortgage-reit-model';

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

export function buildIncompleteMortgageReitModelExportData(
  history: MortgageReitHistoricalData,
  assumptions: MortgageReitModelAssumptions,
): IncompleteMortgageReitModelExportData {
  if (history.annual.length !== 4 || history.annual.some((item, index) => item.year !== history.years[index])) {
    throw new Error('Incomplete mortgage REIT workbook requires four aligned periods, including opening tangible book.');
  }
  const latest = history.annual.at(-1);
  const line = latest?.mortgageReit.average_repo_borrowings;
  const hasFiledRepoBorrowings = line
    && (line.source === 'sec_native' || line.source === 'derived')
    && typeof line.value === 'number' && Number.isFinite(line.value)
    && line.sources.length > 0
    && line.sources.every((source) => source.accession && source.filed);
  if (!latest || latest.year !== assumptions.baseYear || hasFiledRepoBorrowings) {
    throw new Error('Incomplete mortgage REIT workbook requires a missing latest average repo borrowings fact.');
  }
  return {history, assumptions};
}

export function buildMortgageReitModelExportPayload(
  company: CompanyProfile,
  history: MortgageReitHistoricalData,
  assumptions: MortgageReitModelAssumptions,
): DcfExportPayload {
  if (history.annual.length !== 4 || history.annual.some((item, index) => item.year !== history.years[index])) {
    throw new Error('Mortgage REIT workbook requires four aligned periods, including the opening tangible-book observation.');
  }
  const latest = history.annual.at(-1);
  if (!latest || latest.year !== assumptions.baseYear || latest.year !== history.years.at(-1)) {
    throw new Error('Mortgage REIT history, base year, and filed source periods do not align.');
  }
  const sourceNotes: string[] = [];
  for (const item of history.annual) {
    sourceNotes.push(...Object.entries(item.mortgageReit).map(([field, line]) => sourceNote(`mortgage_reit.${field}`, item.year, line)));
    for (const [field, line] of Object.entries({
      net_income: item.netIncome,
      tax_rate: item.taxRate,
      cash: item.cash,
      marketable_securities: item.marketableSecurities,
      non_controlling_interest: item.nonControllingInterest,
      diluted_shares: item.dilutedShares,
    })) sourceNotes.push(sourceNote(field, item.year, line));
  }
  for (const [name, source] of Object.entries(assumptions.assumptionSources satisfies MortgageReitAssumptionSources)) {
    sourceNotes.push(`${name} assumption: ${source}.`);
  }
  sourceNotes.push(
    `Cost of equity ${assumptions.costOfEquity.toFixed(4)} uses risk-free rate ${assumptions.riskFreeRate.toFixed(4)}, beta ${assumptions.beta.toFixed(3)}, and ERP ${assumptions.equityRiskPremium.toFixed(4)} as of ${assumptions.asOfDate}.`,
    `FY${history.years[0]} is the opening tangible-book observation; the latest filed operating base is FY${latest.year}.`,
    'The forecast uses the filed economic asset yield and aggregate cost of funds, which include reported TBA and swap economics; GAAP interest income and expenses remain displayed separately in historicals.',
    'Forecast average investment assets and mortgage borrowings equal beginning tangible common equity multiplied by the historical average-balance leverage assumptions.',
    'The editable market-value change is a per-common-share tangible-book movement; the base case is not a rate-shock valuation.',
    'Common dividends are capped at the lesser of forecast common EPS times the payout assumption and the prior-year dividend grown at the editable dividend-growth rate.',
    'The residual-income terminal value uses Gordon growth; terminal growth must remain below the dated cost of equity.',
    'No enterprise value or FCFF is calculated for this mortgage REIT equity model.',
  );

  const mortgageReitModel: MortgageReitModelExportData = {history, assumptions};
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
    valuationModel: 'mortgage_reit_residual_income',
    mortgageReitModel,
    market: {
      currentPrice: assumptions.currentPrice,
      sharesDiluted: assumptions.commonSharesOutstanding,
      marketCap: assumptions.currentPrice * assumptions.commonSharesOutstanding,
      cash: assumptions.cash,
      debt: assumptions.debt,
      preferredEquity: assumptions.preferredLiquidationPreference,
    },
    historicals: {years: history.years, income: {}, balance: {}, cashflow: {}},
    assumptions: {
      scenarioMode: 'Base',
      horizonYears: assumptions.forecastYears,
      revenueMethod: 'TopDown',
      taxRate: assumptions.taxRate,
      capexMethod: 'Absolute',
      daMethod: 'HistoricalRatio',
      wcMethod: 'Days',
      wacc: {
        rf: assumptions.riskFreeRate,
        erp: assumptions.equityRiskPremium,
        beta: assumptions.beta,
        betaSource: assumptions.assumptionSources.costOfEquity,
      },
      waccRate: assumptions.costOfEquity,
      terminal: {method: 'Perpetuity', g: assumptions.terminalGrowthRate},
    },
    forecasts: [],
    uiMeta: {
      printDate: new Date().toISOString().slice(0, 10),
      companyName: company.name,
      currency: company.currency || 'USD',
      confidenceLabel: 'Medium',
      confidenceScore: 0.68,
      warnings: [`Agency mortgage REIT residual-income valuation based on FY${latest.year} filing data and current dated market inputs.`],
      sourceNotes,
    },
  };
}
