import { describe, expect, it } from 'vitest';
import type { Assumptions, HistoricalData } from '@/core/types';
import type { ModelEligibility } from '@/core/types/native';
import type { BiotechRnpvAssumptions } from '@/services/valuation/biotech-rnpv-model';
import type { LifeInsuranceDcfAssumptions } from '@/services/valuation/life-insurance-model';
import type { UtilityModelAssumptions } from '@/services/valuation/utility-model';
import { calculateRoutedValuation } from '@/services/valuation/router.js';

const historicals = { price: 10, sharesOutstanding: 100 } as unknown as HistoricalData;
const assumptions = { dilutedSharesOutstanding: 100 } as unknown as Assumptions;

function eligibilityFor(model: ModelEligibility['preferred_model']): ModelEligibility {
  return {
    company_type: 'operating',
    preferred_model: model,
    allowed_models: [model],
    blocked_models: [],
    supported_by_current_engine: true,
    status: 'ready',
    model_route_available: true,
    missing_input_gaps: [],
  };
}

function utilityInput(): UtilityModelAssumptions {
  return {
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
  };
}

function biotechInput(): BiotechRnpvAssumptions {
  return {
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
}

function lifeInput(): LifeInsuranceDcfAssumptions {
  return {
    ticker: 'TST',
    baseYear: 2025,
    forecastYears: 5,
    earningsBasis: 'after_tax_adjusted_earnings_available_to_common',
    segments: [{ segment: 'Annuities', baseEarnings: 100_000_000, annualGrowth: [0.03, 0.03, 0.03, 0.03, 0.03] }],
    capitalSchedule: {
      netCapitalAdditions: [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000],
      permittedUpstreamDividends: [50_000_000, 50_000_000, 50_000_000, 50_000_000, 50_000_000],
    },
    riskFreeRate: 0.04,
    equityRiskPremium: 0.05,
    beta: 1.0,
    terminalGrowthRate: 0.02,
    marketDataAsOfDate: '2026-02-01',
    currentPrice: 20,
    dilutedSharesOutstanding: 50_000_000,
    parentCash: 100_000_000,
    parentCashReserve: 20_000_000,
    parentDebt: 10_000_000,
    preferredEquity: 0,
    nonControllingInterest: 0,
  };
}

describe('router specialist ready path (#43, #45, #58, #59)', () => {
  it('utility supported valuation keeps non-empty forecasts', () => {
    const result = calculateRoutedValuation(
      historicals, assumptions, {}, eligibilityFor('utility_dcf'),
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, utilityInput(), undefined,
    );
    expect(result.isValuationSupported).toBe(true);
    expect(result.forecasts.length).toBeGreaterThan(0);
    expect(result.forecasts[0]?.fcff).toBeGreaterThan(0);
  });

  it('biotech supported valuation keeps non-empty forecasts', () => {
    const result = calculateRoutedValuation(
      historicals, assumptions, {}, eligibilityFor('biotech_pipeline_rnpv'),
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, biotechInput(),
    );
    expect(result.isValuationSupported).toBe(true);
    expect(result.forecasts.length).toBeGreaterThan(0);
  });

  it('life insurer route returns supported with forecasts (not default unsupported)', () => {
    const result = calculateRoutedValuation(
      historicals, assumptions, {}, eligibilityFor('life_insurer_distributable_earnings_dcf'),
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      { assumptions: lifeInput() },
    );
    expect(result.isValuationSupported).toBe(true);
    expect(result.preferredModel).toBe('life_insurer_distributable_earnings_dcf');
    expect(result.forecasts.length).toBeGreaterThan(0);
  });

  it('missing specialist input stays unsupported', () => {
    const result = calculateRoutedValuation(
      historicals, assumptions, {}, eligibilityFor('utility_dcf'),
    );
    expect(result.isValuationSupported).toBeFalsy();
  });
});
