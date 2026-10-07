import { describe, expect, it } from 'vitest';
import type { CanonicalFinancialLine, NativeUnifiedPayload } from '@/core/types/native';
import type { EnergyHistoricalData, EnergyHistoricalYear } from '@/core/types/model';
import type { CompanyProfile } from '@/core/types/company';
import { buildSourcedIntegratedEnergyModelAssumptions } from '@/services/valuation/integrated-energy-assumption-policy.js';
import { buildIntegratedEnergyModelExportPayload } from '@/services/exporters/excel/integrated-energy-payload.js';

function filed(value: number): CanonicalFinancialLine {
  return {
    value,
    source: 'sec_native',
    confidence: 1,
    method: 'filed test double',
    concept: 'test',
    sources: [{
      concept: 'test', label: null, statement: null, row_id: null,
      fiscal_period: 'FY', reported_value: value, accession: '0000000000-25-000001',
      filed: '2026-02-20', form: '10-K', report_date: '2025-12-31',
      currency: 'USD', unit: 'USD', unit_scale: 'thousands', source_fiscal_year: null,
    }],
  };
}

function energyYear(year: number, scale: number): EnergyHistoricalYear {
  const energy = {
    weighted_average_diluted_shares: filed(4_000_000_000),
    current_debt: filed(5_000_000_000),
    long_term_debt: filed(20_000_000_000),
    interest_bearing_debt: filed(25_000_000_000),
    crude_oil_production: filed(2000 * scale),
    ngl_production: filed(500 * scale),
    bitumen_production: filed(200 * scale),
    synthetic_oil_production: filed(100 * scale),
    liquids_production: filed(2800 * scale),
    natural_gas_production_available_for_sale: filed(7_000_000 * scale),
    oil_equivalent_production: filed(4000 * scale),
    average_crude_price: filed(80),
    average_ngl_price: filed(40),
    average_bitumen_price: filed(50),
    average_synthetic_oil_price: filed(70),
    average_natural_gas_price: filed(3),
    average_production_cost_per_oil_equivalent_barrel: filed(10),
    proved_oil_equivalent_reserves: filed(10_000_000),
    proved_developed_oil_equivalent_reserves: filed(6_000_000),
    proved_undeveloped_oil_equivalent_reserves: filed(4_000_000),
    upstream_earnings_gaap: filed(20_000_000_000),
    energy_products_earnings_gaap: filed(5_000_000_000),
    chemical_products_earnings_gaap: filed(3_000_000_000),
    specialty_products_earnings_gaap: filed(2_000_000_000),
    corporate_financing_earnings_gaap: filed(-1_000_000_000),
    upstream_depreciation_and_depletion: filed(5_000_000_000),
    energy_products_depreciation_and_depletion: filed(1_000_000_000),
    chemical_products_depreciation_and_depletion: filed(500_000_000),
    specialty_products_depreciation_and_depletion: filed(300_000_000),
    upstream_ppe_additions_including_noncash: filed(6_000_000_000),
    energy_products_ppe_additions_including_noncash: filed(1_000_000_000),
    chemical_products_ppe_additions_including_noncash: filed(500_000_000),
    specialty_products_ppe_additions_including_noncash: filed(300_000_000),
    cash_capex: filed(20_000_000_000),
    operating_working_capital_investment: filed(2_000_000_000),
    corporate_interest_revenue: filed(500_000_000),
    brent_2026_earnings_sensitivity: filed(1_000_000_000),
    henry_hub_2026_earnings_sensitivity: filed(200_000_000),
    ttf_2026_earnings_sensitivity: filed(200_000_000),
  };
  return {
    year,
    energy,
    revenue: filed(400_000_000_000 * scale),
    netIncome: filed(25_000_000_000),
    interestExpense: filed(1_000_000_000),
    taxRate: filed(0.2),
    depreciation: filed(15_000_000_000),
    cashFlowFromOperations: filed(40_000_000_000),
    cash: filed(10_000_000_000),
    currentDebt: filed(5_000_000_000),
    longTermDebt: filed(20_000_000_000),
    debt: filed(25_000_000_000),
    marketableSecurities: filed(0),
    preferredEquity: { ...filed(0), source: 'not_applicable' as const },
    nonControllingInterest: { ...filed(0), source: 'not_applicable' as const },
    dilutedShares: filed(4_000_000_000),
  };
}

function syntheticData(): NativeUnifiedPayload {
  const now = Date.now();
  return {
    profile: { cik: '0000000000', ticker: 'CVX', name: 'Synthetic Energy Corp' },
    financials_native: {},
    canonical_financials: { currency: 'USD' },
    model_eligibility: {},
    market: {
      ticker: 'CVX', current_price: 100, market_cap: 400_000_000_000,
      shares_outstanding: 4_000_000_000, beta: 0.5, fallback_used: false, fetched_at_ms: now,
    },
    market_context: {},
    valuation_context: {
      risk_free_rate: 0.04, equity_risk_premium: 0.05,
      fetched_at_ms: now, as_of_date: '2026-02-20',
    },
    peers: [],
    insider_trades: [],
    source_metadata: {},
    data_quality: {
      market: { status: 'live', source: 'test', fetched_at_ms: now, fallback_used: false },
      valuation_context: { status: 'live', source: 'test', fetched_at_ms: now, fallback_used: false },
    },
    completeness: {},
  } as unknown as NativeUnifiedPayload;
}

describe('integrated-energy ticker gate (filing-shape)', () => {
  it('builds assumptions and export payload for a synthetic non-XOM energy filer', () => {
    const history: EnergyHistoricalData = {
      years: [2023, 2024, 2025],
      annual: [energyYear(2023, 0.95), energyYear(2024, 1), energyYear(2025, 1.05)],
    };
    const data = syntheticData();
    const assumptions = buildSourcedIntegratedEnergyModelAssumptions(data, history);
    expect(assumptions.baseYear).toBe(2025);

    const company: CompanyProfile = {
      cik: '0000000000', ticker: 'CVX', name: 'Synthetic Energy Corp',
      exchange: 'NYSE', fiscalYearEnd: '12-31', currency: 'USD',
    };
    const payload = buildIntegratedEnergyModelExportPayload(company, history, assumptions);
    expect(payload.valuationModel).toBe('integrated_energy_dcf');
  });
});
