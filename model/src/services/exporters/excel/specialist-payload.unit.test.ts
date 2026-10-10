import { describe, expect, it } from 'vitest';
import type { CompanyProfile } from '@/core/types';
import type { BiotechRnpvAssumptions } from '@/services/valuation/biotech-rnpv-model';
import type { UtilityModelAssumptions } from '@/services/valuation/utility-model';
import { calculateBiotechRnpv } from '@/services/valuation/biotech-rnpv-model.js';
import { calculateUtilityValuation } from '@/services/valuation/utility-model.js';
import { mapBiotechForecasts, mapUtilityForecasts } from '@/services/valuation/specialist-forecasts.js';
import { buildBiotechModelExportPayload } from '@/services/exporters/excel/biotech-payload.js';
import { buildUtilityModelExportPayload } from '@/services/exporters/excel/utility-payload.js';

const company: CompanyProfile = {
  cik: '0000000000',
  ticker: 'TST',
  name: 'Test Specialist',
  exchange: 'XNYS',
  fiscalYearEnd: '12-31',
  currency: 'USD',
  sector: 'Utilities',
  industry: 'Regulated Electric',
  currentPrice: 50,
  marketCap: 5_000_000_000,
  beta: 0.8,
} as CompanyProfile;

const utilityAssumptions: UtilityModelAssumptions & { asOfDate: string; assumptionSources: Record<string, string> } = {
  baseYear: 2025,
  baseRateBase: 1_000_000_000,
  authorizedEquityRatio: 0.5,
  allowedRoe: 0.1,
  rateBaseAdditions: [100_000_000, 100_000_000, 100_000_000, 100_000_000, 100_000_000],
  rateBaseDepreciation: [50_000_000, 50_000_000, 50_000_000, 50_000_000, 50_000_000],
  dividendPayoutRatio: 0.6,
  riskFreeRate: 0.04,
  equityRiskPremium: 0.05,
  beta: 0.8,
  terminalGrowthRate: 0.02,
  currentPrice: 50,
  dilutedShares: 100_000_000,
  asOfDate: '2026-02-01',
  assumptionSources: { baseRateBase: 'filed test double' },
};

const biotechAssumptions: BiotechRnpvAssumptions = {
  baseYear: 2025,
  commercialRevenueBase: 100_000_000,
  commercialRevenueGrowth: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
  commercialFcfMargin: 0.2,
  otherPipelineRnpv: 0,
  terminalGrowthRate: 0.02,
  riskFreeRate: 0.04,
  equityRiskPremium: 0.05,
  beta: 1.2,
  costOfDebt: 0.05,
  normalizedTaxRate: 0.21,
  marketCapitalization: 1_000_000_000,
  dilutedShares: 100_000_000,
  currentPrice: 10,
  cash: 500_000_000,
  marketableSecurities: 0,
  debt: 0,
  preferredEquity: 0,
  nonControllingInterest: 0,
  assets: [{
    assetId: 'A1',
    include: 1,
    launchYear: 2026,
    peakSales: 500_000_000,
    yearsToPeak: 5,
    exclusivityYear: 2035,
    postLoeErosion: 0.5,
    probabilityOfSuccess: 0.3,
    retainedShare: 1,
    contributionMargin: 0.5,
    developmentCostPv: 10_000_000,
  }],
};

describe('specialist ready export payloads (#54)', () => {
  it('utility payload carries the dividend DCF section, not the operating model', () => {
    const results = calculateUtilityValuation(utilityAssumptions);
    const payload = buildUtilityModelExportPayload(company, utilityAssumptions, mapUtilityForecasts(results.forecasts));
    expect(payload.valuationModel).toBe('utility_dcf');
    expect(payload.utilityModel?.assumptions.baseRateBase).toBe(1_000_000_000);
    expect(payload.forecasts.length).toBeGreaterThan(0);
  });

  it('biotech payload carries pipeline assets and rNPV assumptions', () => {
    const results = calculateBiotechRnpv(biotechAssumptions);
    const payload = buildBiotechModelExportPayload(company, biotechAssumptions, [], mapBiotechForecasts(results.forecasts), '2026-02-01');
    expect(payload.valuationModel).toBe('biotech_pipeline_rnpv');
    expect(payload.company.asOfDate).toBe('2026-02-01');
    expect(payload.valuationModel).toBe('biotech_pipeline_rnpv');
    expect(payload.biotechModel?.assumptions.assets).toHaveLength(1);
    expect(payload.forecasts.length).toBeGreaterThan(0);
  });
});
