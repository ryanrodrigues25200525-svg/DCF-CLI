import type { CompanyProfile, ReitHistoricalData } from '@/core/types';
import type { CanonicalFinancialLine } from '@/core/types/native';
import type { ReitModelAssumptions } from '@/services/valuation/reit-model';
import type { DcfExportPayload, IncompleteReitModelExportData } from './types';

function sourceNote(field: string, year: number, line: CanonicalFinancialLine): string {
  const sources = line.sources.map((source) => {
    const unit = source.unit_scale ? `${source.unit} ${source.unit_scale}` : source.unit || 'unit unavailable';
    return `${source.concept || line.concept || 'derived input'}, accession ${source.accession || 'unresolved'}, filed ${source.filed || 'unresolved'}, ${source.fiscal_period || 'period unresolved'}, ${unit}`;
  }).join('; ');
  return `FY${year} ${field}: ${line.method}; ${sources}`;
}

export function buildIncompleteReitModelExportData(
  history: ReitHistoricalData,
  assumptions: IncompleteReitModelExportData['assumptions'],
): IncompleteReitModelExportData {
  if (history.annual.length !== 3 || history.annual.some((item) => !item.reit)) {
    throw new Error('Incomplete REIT workbook requires three aligned years of filed FFO and property history.');
  }
  const latest = history.annual.at(-1);
  const line = latest?.reit?.same_store_noi_growth;
  const hasFiledGrowth = latest && line
    && (line.source === 'sec_native' || line.source === 'derived')
    && typeof line.value === 'number' && Number.isFinite(line.value)
    && line.sources.length > 0
    && line.sources.every((source) => source.accession && source.filed);
  if (!latest || hasFiledGrowth) {
    throw new Error('Incomplete REIT workbook requires a missing latest filed same-store NOI growth ratio.');
  }
  return {history, assumptions};
}

export function buildReitModelExportPayload(
  company: CompanyProfile,
  history: ReitHistoricalData,
  assumptions: ReitModelAssumptions,
): DcfExportPayload {
  if (history.annual.length !== 3 || history.annual.some((item) => !item.reit)) {
    throw new Error('REIT workbook requires three aligned years of filed FFO, property NOI, and recurring-capex history.');
  }
  const latest = history.annual.at(-1);
  if (!latest || latest.year !== history.years.at(-1)) {
    throw new Error('REIT history year labels do not match the canonical fiscal periods.');
  }

  const sourceNotes = history.annual.flatMap((item) => [
    ...Object.entries(item.reit).map(([field, line]) => sourceNote(field, item.year, line)),
    sourceNote('net_income', item.year, item.netIncome),
    sourceNote('common_equity', item.year, item.commonEquity),
    sourceNote('cash', item.year, item.cash),
    sourceNote('long_term_debt', item.year, item.longTermDebt),
    sourceNote('preferred_equity', item.year, item.preferredEquity),
    sourceNote('non_controlling_interest', item.year, item.nonControllingInterest),
    sourceNote('diluted_shares', item.year, item.dilutedShares),
  ]);
  for (const [name, source] of Object.entries(assumptions.assumptionSources)) {
    sourceNotes.push(`${name} assumption source: ${source}.`);
  }
  sourceNotes.push(
    `Risk-free rate ${assumptions.riskFreeRate.toFixed(4)} from ${assumptions.riskFreeRateSource}; equity risk premium ${assumptions.equityRiskPremium.toFixed(4)} from ${assumptions.equityRiskPremiumSource}; beta ${assumptions.beta.toFixed(2)} from ${assumptions.betaSource}; market context as of ${assumptions.marketDataAsOfDate}.`,
    'Primary valuation discounts analyst-defined AFFO to common equity at cost of equity; enterprise value is not applicable.',
  );

  const confidenceValues = Object.values(latest.reit).map((line) => line.confidence);
  const confidenceScore = confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length;
  const confidenceLabel = confidenceScore >= 0.9 ? 'High' : confidenceScore >= 0.75 ? 'Medium' : 'Low';

  return {
    company: {
      name: company.name,
      ticker: company.ticker,
      exchange: company.exchange,
      cik: company.cik,
      currency: company.currency || 'USD',
      unitsScale: 'units',
      asOfDate: assumptions.marketDataAsOfDate,
      fiscalYearEnd: company.fiscalYearEnd,
      sector: company.sector,
      industry: company.industry,
    },
    valuationModel: 'reit_affo',
    reitModel: {history, assumptions},
    market: {
      currentPrice: assumptions.currentPrice,
      sharesDiluted: assumptions.dilutedSharesOutstanding,
    },
    historicals: {
      years: history.years,
      income: {},
      balance: {},
      cashflow: {},
    },
    assumptions: {
      scenarioMode: 'Base',
      horizonYears: assumptions.forecastYears,
      revenueMethod: 'TopDown',
      taxRate: 0,
      capexMethod: 'Absolute',
      daMethod: 'HistoricalRatio',
      wcMethod: 'NWC_%Revenue',
      wacc: {
        rf: assumptions.riskFreeRate,
        erp: assumptions.equityRiskPremium,
        beta: assumptions.beta,
      },
      terminal: {
        method: 'Perpetuity',
        g: assumptions.terminalGrowthRate,
      },
    },
    forecasts: [],
    uiMeta: {
      printDate: new Date().toISOString().slice(0, 10),
      companyName: company.name,
      currency: company.currency || 'USD',
      confidenceLabel,
      confidenceScore,
      warnings: [
        'Analyst AFFO is defined as Prologis Core FFO less tenant improvements, lease commissions, and property improvements; all reported property-improvement spending is treated as recurring.',
        'Filed same-store NOI growth is used as an editable proxy for future portfolio NOI and Core FFO/AFFO growth.',
        'Distributions use the filed common-and-preferred cash-dividend line because preferred cash dividends are not separately isolated in that cash-flow line.',
        'The NAV cap rate is current-market implied and therefore circular to the current share price; the cap-rate sensitivity is a cross-check, not an independent target valuation.',
        'The NAV bridge covers the Real Estate segment only and excludes Strategic Capital and other corporate or non-property assets and liabilities.',
      ],
      sourceNotes,
    },
  };
}
