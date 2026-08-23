import { describe, expect, it } from 'vitest';
import type { Assumptions, CompanyProfile, HistoricalData, Overrides } from '@/core/types';
import { calculateRoutedValuation } from './router';

const historicals: HistoricalData = {
  symbol: 'TEST',
  years: [2024, 2025],
  revenue: [1000, 1200],
  costOfRevenue: [500, 600],
  grossProfit: [500, 600],
  ebitda: [200, 260],
  ebit: [150, 220],
  interestExpense: [10, 10],
  incomeTaxExpense: [25, 35],
  netIncome: [100, 150],
  depreciation: [40, 40],
  capex: [50, 55],
  nwcChange: [10, 10],
  taxRate: [0.21, 0.21],
  cash: [100, 120],
  totalCurrentAssets: [300, 330],
  otherCurrentAssets: [0, 0],
  accountsReceivable: [100, 120],
  inventory: [80, 90],
  accountsPayable: [60, 70],
  totalAssets: [1000, 1100],
  totalDebt: [200, 220],
  currentDebt: [50, 55],
  longTermDebt: [150, 165],
  shareholdersEquity: [500, 560],
  ppeNet: [300, 320],
  otherAssets: [100, 100],
  otherLiabilities: [80, 90],
  totalLiabilities: [500, 540],
  totalCurrentLiabilities: [150, 160],
  otherCurrentLiabilities: [20, 20],
  deferredRevenue: [0, 0],
  retainedEarnings: [200, 250],
  sharesOutstanding: 100,
  price: 20,
  beta: 1,
  currency: 'USD',
};

const assumptions: Assumptions = {
  forecastYears: 5,
  revenueGrowth: 0.05,
  ebitMargin: 0.2,
  grossMargin: 0.5,
  taxRate: 0.21,
  deaRatio: 0.03,
  capexRatio: 0.04,
  nwcChangeRatio: 0.01,
  rdMargin: 0,
  sgaMargin: 0.15,
  accountsReceivableDays: 35,
  inventoryDays: 45,
  accountsPayableDays: 30,
  wacc: 0.1,
  terminalGrowthRate: 0.025,
  terminalExitMultiple: 10,
  valuationMethod: 'growth',
  advancedMode: false,
  revenueGrowthStage1: 0.05,
  revenueGrowthStage2: 0.03,
  revenueGrowthStage3: 0.02,
  ebitMarginSteadyState: 0.2,
  ebitMarginConvergenceYears: 5,
  salesToCapitalRatio: 1.5,
  leverageTarget: 0.2,
  dilutedSharesOutstanding: 100,
};

const overrides: Overrides = {};

function profile(patch: Partial<CompanyProfile>): CompanyProfile {
  return {
    cik: '0000000000',
    ticker: 'TEST',
    name: 'Test Co',
    exchange: 'NYSE',
    fiscalYearEnd: '1231',
    currency: 'USD',
    ...patch,
  };
}

describe('valuation router', () => {
  it('runs existing DCF for operating companies', () => {
    const result = calculateRoutedValuation(
      historicals,
      assumptions,
      overrides,
      profile({ industry: 'Semiconductors & Related Devices' }),
    );

    expect(result.isValuationSupported).toBe(true);
    expect(result.companyType).toBe('operating');
    expect(result.impliedSharePrice).toBeGreaterThan(0);
    expect(result.forecasts.length).toBe(5);
  });

  it('routes bank valuation to residual income with an explicit model warning', () => {
    const result = calculateRoutedValuation(
      historicals,
      assumptions,
      overrides,
      profile({ industry: 'National Commercial Banks' }),
    );

    expect(result.isValuationSupported).toBe(true);
    expect(result.isSensitivitySupported).toBe(false);
    expect(result.companyType).toBe('bank');
    expect(result.preferredModel).toBe('residual_income');
    expect(result.impliedSharePrice).toBeGreaterThan(0);
    expect(result.modelWarning).toContain('Bank detected');
  });

  it('routes REIT valuation to an AFFO multiple estimate', () => {
    const result = calculateRoutedValuation(
      historicals,
      assumptions,
      overrides,
      profile({ industry: 'Real Estate Investment Trusts' }),
    );

    expect(result.isValuationSupported).toBe(true);
    expect(result.isSensitivitySupported).toBe(false);
    expect(result.companyType).toBe('reit');
    expect(result.preferredModel).toBe('reit_affo');
    expect(result.impliedSharePrice).toBeGreaterThan(0);
  });
});
