import type { CompanyProfile, InsuranceHistoricalData } from '@/core/types';
import type { CanonicalFinancialLine } from '@/core/types/native';
import type { InsuranceModelAssumptions } from '@/services/valuation/insurance-model';
import type { DcfExportPayload, IncompleteInsuranceModelExportData } from './types';

function sourceNote(
  field: string,
  year: number,
  line: CanonicalFinancialLine,
): string {
  const sourceText = line.sources.map((source) => {
    const unit = source.unit_scale ? `${source.unit} ${source.unit_scale}` : source.unit || 'unit unavailable';
    return `${source.concept || line.concept || 'derived input'}, accession ${source.accession || 'unresolved'}, filed ${source.filed || 'unresolved'}, ${source.fiscal_period || 'period unresolved'}, ${unit}`;
  }).join('; ');
  return `FY${year} ${field}: ${line.method}; ${sourceText}`;
}

export function buildIncompleteInsuranceModelExportData(
  history: InsuranceHistoricalData,
  assumptions: InsuranceModelAssumptions,
): IncompleteInsuranceModelExportData {
  const annual = history.annual.slice(-3);
  if (annual.length < 3 || annual.some((item) => !item.insurance)) {
    throw new Error('Incomplete P&C workbook requires three filed annual periods.');
  }
  const latest = annual.at(-1);
  const reserveLine = latest?.insurance?.unpaid_loss_reserves;
  const hasFiledReserve = reserveLine
    && (reserveLine.source === 'sec_native' || reserveLine.source === 'derived')
    && typeof reserveLine.value === 'number' && Number.isFinite(reserveLine.value)
    && reserveLine.sources.length > 0
    && reserveLine.sources.every((source) => source.accession && source.filed && source.fiscal_period === `FY ${latest.year}`);
  if (!latest?.insurance || hasFiledReserve) {
    throw new Error('Incomplete P&C workbook requires a missing latest net loss reserve input.');
  }
  return {
    history: {years: annual.map((item) => item.year), annual},
    assumptions,
  };
}

export function buildInsuranceModelExportPayload(
  company: CompanyProfile,
  history: InsuranceHistoricalData,
  assumptions: InsuranceModelAssumptions,
): DcfExportPayload {
  const annual = history.annual.slice(-3);
  if (annual.length < 3 || annual.some((item) => !item.insurance)) {
    throw new Error('P&C workbook requires three years of source-backed insurance history.');
  }
  const latest = annual[annual.length - 1];
  if (latest.year !== history.years[history.years.length - 1]) {
    throw new Error('Insurance history year labels do not match the canonical fiscal years.');
  }

  const sourceNotes = annual.flatMap((item) => Object.entries(item.insurance ?? {}).map(([field, line]) =>
    sourceNote(field, item.year, line),
  ));
  sourceNotes.push(
    `Risk-free rate ${assumptions.riskFreeRate.toFixed(4)} from ${assumptions.riskFreeRateSource}; equity risk premium ${assumptions.equityRiskPremium.toFixed(4)} from ${assumptions.equityRiskPremiumSource}; beta ${assumptions.beta.toFixed(2)} from ${assumptions.betaSource}; market context as of ${assumptions.marketDataAsOfDate}.`,
    `Minimum statutory capital-to-premium ratio ${assumptions.minimumStatutoryCapitalToPremiumRatio.toFixed(4)}; source: ${assumptions.minimumStatutoryCapitalSource}.`,
    'Equity valuation uses common-equity residual income; enterprise value is not applicable to this insurance model.',
  );
  for (const [assumption, source] of Object.entries(assumptions.assumptionSources)) {
    sourceNotes.push(`${assumption} assumption source: ${source}.`);
  }

  const confidence = Object.values(latest.insurance ?? {}).map((line) => line.confidence);
  const confidenceScore = confidence.reduce((sum, value) => sum + value, 0) / confidence.length;
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
    valuationModel: 'insurance_pnc_residual_income',
    insuranceModel: {
      history: {years: annual.map((item) => item.year), annual},
      assumptions,
    },
    market: {
      currentPrice: assumptions.currentPrice,
      sharesDiluted: assumptions.dilutedSharesOutstanding,
    },
    historicals: {
      years: annual.map((item) => item.year),
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
        'The P&C underwriting schedule uses the reported General Insurance business; group common equity and other pretax operations remain in the residual-income valuation.',
        'The statutory capital-to-premium test is an issuer-reported proxy; it does not forecast entity-level capital, regulatory buffers, or legal-entity dividend restrictions.',
        'Reserve other changes, Other Operations growth, and other pretax adjustments are explicit editable assumptions; actual foreign exchange, acquisitions, and reinsurance movements may not recur.',
      ],
      sourceNotes,
    },
  };
}
