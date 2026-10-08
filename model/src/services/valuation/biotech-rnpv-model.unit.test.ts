import { describe, expect, it } from 'vitest';
import type { BiotechRnpvAssumptions } from '@/services/valuation/biotech-rnpv-model';
import { calculateBiotechRnpv } from '@/services/valuation/biotech-rnpv-model.js';

function assumptions(base: number): BiotechRnpvAssumptions {
  return {
    baseYear: 2025,
    commercialRevenueBase: base,
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
}

describe('biotech rNPV commercial base (#57)', () => {
  it('values a pre-revenue pipeline on pipeline rNPV with a zero commercial base', () => {
    const result = calculateBiotechRnpv(assumptions(0));
    expect(result.isValuationSupported).toBe(true);
    expect(result.forecasts).toHaveLength(10);
    expect(result.forecasts.every((year) => year.commercialFcf === 0)).toBe(true);
    expect(result.equityValue).toBeGreaterThan(0);
  });

  it('still rejects a negative commercial base', () => {
    expect(() => calculateBiotechRnpv(assumptions(-5))).toThrow(/commercial-revenue base/i);
  });
});
