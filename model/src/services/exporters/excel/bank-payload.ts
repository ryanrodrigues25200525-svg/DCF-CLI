import type { CompanyProfile } from '@/core/types';
import type { BankHistoricalData } from '@/core/types';
import type { BankModelAssumptions } from '@/services/valuation/bank-model';
import type { DcfExportPayload } from './types';

function sourceNote(field: string, line: BankHistoricalData['annual'][number]['bank'][keyof BankHistoricalData['annual'][number]['bank']]): string {
  const sourceText = line.sources.map((source) => {
    const unit = source.unit_scale ? `${source.unit} ${source.unit_scale}` : source.unit || 'unit unavailable';
    return `${source.concept || line.concept || 'derived input'}, accession ${source.accession || 'unresolved'}, filed ${source.filed || 'unresolved'}, ${source.fiscal_period || 'period unresolved'}, ${unit}`;
  }).join('; ');
  return `FY${line.sources[0]?.fiscal_period?.replace('FY ', '') || 'latest'} ${field}: ${line.method}; ${sourceText}`;
}

export function buildBankModelExportPayload(
  company: CompanyProfile,
  history: BankHistoricalData,
  assumptions: BankModelAssumptions,
): DcfExportPayload {
  if (history.annual.length === 0) throw new Error('Bank model export requires filed annual history.');
  const latest = history.annual[history.annual.length - 1];
  if (latest.year !== history.years[history.years.length - 1]) {
    throw new Error('Bank history year labels do not match the canonical fiscal years.');
  }
  const sourceNotes = Object.entries(latest.bank).map(([field, line]) => sourceNote(field, line));
  const confidenceValues = Object.values(latest.bank).map((line) => line.confidence);
  const confidenceScore = confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length;
  const confidenceLabel = confidenceScore >= 0.9 ? 'High' : confidenceScore >= 0.75 ? 'Medium' : 'Low';
  sourceNotes.push(
    `Risk-free rate ${assumptions.riskFreeRate.toFixed(4)} from ${assumptions.riskFreeRateSource}; equity risk premium ${assumptions.equityRiskPremium.toFixed(4)} from ${assumptions.equityRiskPremiumSource}; beta ${assumptions.beta.toFixed(2)} from ${assumptions.betaSource}; market context as of ${assumptions.marketDataAsOfDate}.`,
    `Minimum CET1 ratio ${assumptions.minimumCet1Ratio.toFixed(4)}; source: ${assumptions.minimumCet1RatioSource}.`,
    'Bank model is equity value based; enterprise value is not applicable.',
    'CET1 forecast roll-forward uses net income less common distributions as an explicit proxy; regulatory deductions, AOCI, and supervisory adjustments are not forecast separately.',
  );
  for (const [assumption, source] of Object.entries(assumptions.assumptionSources)) {
    sourceNotes.push(`${assumption} assumption source: ${source}.`);
  }

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
    valuationModel: 'bank_residual_income',
    bankModel: {history, assumptions},
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
      taxRate: assumptions.taxRate,
      capexMethod: '%Revenue',
      daMethod: '%Revenue',
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
        'The filed minimum CET1 ratio is editable; confirm how current supervisory buffers apply to the institution.',
        'CET1 retained earnings are forecast with an explicit net-income-less-distributions proxy.',
      ],
      sourceNotes,
    },
  };
}
