import { describe, expect, it } from 'vitest';
import type { CompanyProfile, HistoricalData } from '@/core/types';
import { classifyCompany } from './company-classifier';

const baseHistoricals: HistoricalData = {
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

describe('company classifier', () => {
  it('keeps normal operating companies on unlevered DCF', () => {
    const result = classifyCompany(profile({ industry: 'Semiconductors & Related Devices' }), baseHistoricals);
    expect(result.companyType).toBe('operating');
    expect(result.preferredModel).toBe('unlevered_dcf');
    expect(result.supportedByCurrentEngine).toBe(true);
  });

  it('routes banks to residual income', () => {
    const result = classifyCompany(profile({ industry: 'National Commercial Banks' }), baseHistoricals);
    expect(result.companyType).toBe('bank');
    expect(result.preferredModel).toBe('residual_income');
    expect(result.supportedByCurrentEngine).toBe(false);
  });

  it('routes insurance companies to residual income', () => {
    const result = classifyCompany(profile({ ticker: 'BRK-B', industry: 'Fire, Marine & Casualty Insurance' }), baseHistoricals);
    expect(result.companyType).toBe('insurance');
    expect(result.supportedByCurrentEngine).toBe(false);
  });

  it('routes REITs to AFFO valuation', () => {
    const result = classifyCompany(profile({ industry: 'Real Estate Investment Trusts' }), baseHistoricals);
    expect(result.companyType).toBe('reit');
    expect(result.preferredModel).toBe('reit_affo');
  });

  it('routes utilities to utility DCF', () => {
    const result = classifyCompany(profile({ industry: 'Electric Services' }), baseHistoricals);
    expect(result.companyType).toBe('utility');
    expect(result.preferredModel).toBe('utility_dcf');
  });

  it('flags negative EBIT companies as high-growth or distressed', () => {
    const result = classifyCompany(
      profile({ industry: 'Services-Prepackaged Software' }),
      { ...baseHistoricals, ebit: [10, -20] },
    );
    expect(result.companyType).toBe('high_growth');
    expect(result.supportedByCurrentEngine).toBe(true);
  });
});
