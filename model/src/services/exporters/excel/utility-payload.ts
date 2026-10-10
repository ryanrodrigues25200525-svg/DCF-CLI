import type { CompanyProfile, ForecastYear } from '@/core/types';
import type { DcfExportPayload, UtilityModelExportData } from './types';
import type { UtilityModelAssumptions } from '@/services/valuation/utility-model';

type UtilityReadyAssumptions = UtilityModelAssumptions & {
  asOfDate: string;
  assumptionSources: Record<string, string>;
};

export function buildUtilityModelExportPayload(
  company: CompanyProfile,
  assumptions: UtilityReadyAssumptions,
  forecasts: ForecastYear[],
): DcfExportPayload {
  const costOfEquity = assumptions.riskFreeRate + assumptions.beta * assumptions.equityRiskPremium;
  const utilityModel: UtilityModelExportData = { assumptions };
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
    valuationModel: 'utility_dcf',
    utilityModel,
    market: {
      currentPrice: assumptions.currentPrice,
      sharesDiluted: assumptions.dilutedShares,
      marketCap: assumptions.currentPrice * assumptions.dilutedShares,
      cash: 0,
      debt: 0,
      minorityInterest: 0,
      preferredEquity: 0,
      nonOperatingAssets: 0,
    },
    historicals: { years: [assumptions.baseYear], income: {}, balance: {}, cashflow: {} },
    assumptions: {
      scenarioMode: 'Base',
      horizonYears: 5,
      revenueMethod: 'BottomUp',
      taxRate: 0.21,
      capexMethod: 'Absolute',
      daMethod: 'HistoricalRatio',
      wcMethod: 'Days',
      wacc: {
        rf: assumptions.riskFreeRate,
        erp: assumptions.equityRiskPremium,
        beta: assumptions.beta,
      },
      waccRate: costOfEquity,
      terminal: { method: 'Perpetuity', g: assumptions.terminalGrowthRate },
    },
    forecasts,
    uiMeta: {
      printDate: new Date().toISOString().slice(0, 10),
      companyName: company.name,
      currency: company.currency || 'USD',
      confidenceLabel: 'Low',
      confidenceScore: 0.5,
      warnings: [
        'Direct common-equity dividend DCF based on regulated rate base and allowed returns; '
        + 'the model does not calculate enterprise value or corporate FCFF.',
      ],
      sourceNotes: Object.entries(assumptions.assumptionSources).map(([name, source]) => `${name} assumption: ${source}.`),
    },
  };
}
