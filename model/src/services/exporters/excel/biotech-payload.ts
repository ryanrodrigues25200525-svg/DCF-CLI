import type { CompanyProfile, ForecastYear } from '@/core/types';
import type { PipelineAssetNativeFact } from '@/core/types/native';
import type { BiotechModelExportData, DcfExportPayload } from './types';
import type { BiotechRnpvAssumptions } from '@/services/valuation/biotech-rnpv-model';

export function buildBiotechModelExportPayload(
  company: CompanyProfile,
  assumptions: BiotechRnpvAssumptions,
  pipelineAssets: PipelineAssetNativeFact[],
  forecasts: ForecastYear[],
): DcfExportPayload {
  const asOfDate = new Date().toISOString().slice(0, 10);
  const biotechModel: BiotechModelExportData = {
    baseYear: assumptions.baseYear,
    forecastYears: 10,
    commercialRevenueBase: assumptions.commercialRevenueBase,
    pipelineAssets,
    assumptions,
  };
  const wacc = assumptions.riskFreeRate + assumptions.beta * assumptions.equityRiskPremium;
  return {
    company: {
      name: company.name,
      ticker: company.ticker,
      exchange: company.exchange,
      cik: company.cik,
      currency: company.currency || 'USD',
      unitsScale: 'units',
      asOfDate,
      fiscalYearEnd: company.fiscalYearEnd,
      sector: company.sector,
      industry: company.industry,
    },
    valuationModel: 'biotech_pipeline_rnpv',
    biotechModel,
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
    historicals: { years: [assumptions.baseYear], income: {}, balance: {}, cashflow: {} },
    assumptions: {
      scenarioMode: 'Base',
      horizonYears: 10,
      revenueMethod: 'BottomUp',
      taxRate: assumptions.normalizedTaxRate,
      capexMethod: 'Absolute',
      daMethod: 'HistoricalRatio',
      wcMethod: 'Days',
      wacc: {
        rf: assumptions.riskFreeRate,
        erp: assumptions.equityRiskPremium,
        beta: assumptions.beta,
        costOfDebt: assumptions.costOfDebt,
      },
      waccRate: wacc,
      terminal: { method: 'Perpetuity', g: assumptions.terminalGrowthRate },
    },
    forecasts,
    uiMeta: {
      printDate: asOfDate,
      companyName: company.name,
      currency: company.currency || 'USD',
      confidenceLabel: 'Low',
      confidenceScore: 0.35,
      warnings: [
        'Risk-adjusted pipeline rNPV plus a consolidated-revenue commercial-franchise DCF. '
        + 'Analyst sales, launch, probability, partner, and cost inputs drive value; '
        + 'pipeline assumptions are not issuer guidance.',
      ],
      sourceNotes: [
        `Commercial revenue base ${assumptions.commercialRevenueBase} for FY${assumptions.baseYear}; `
        + `${pipelineAssets.length} filed pipeline assets in inventory.`,
      ],
    },
  };
}
