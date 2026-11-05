import { describe, expect, it } from 'vitest';
import type { Assumptions, HistoricalData } from '@/core/types';
import { calculateDCF } from './engine';

describe('forecast balance sheet', () => {
  it('includes current debt in current and total liabilities', () => {
    const historicals = {
      years: [new Date().getFullYear() - 1], revenue: [1000], grossProfit: [400],
      sharesOutstanding: 100, totalDebt: [100], cash: [50], ppeNet: [200],
      shareholdersEquity: [200], retainedEarnings: [100],
    } as HistoricalData;
    const assumptions = {
      forecastYears: 5, revenueGrowth: 0, grossMargin: 0.4, ebitMargin: 0.2,
      taxRate: 0.2, wacc: 0.1, costOfDebt: 0.05, currentDebt: 100,
      dilutedSharesOutstanding: 100, terminalGrowthRate: 0.02, accountsReceivableDays: 30,
      inventoryDays: 30, accountsPayableDays: 30, capexRatio: 0.05,
      deaRatio: 0.05, nwcChangeRatio: 0, leverageTarget: 0.5,
    } as unknown as Assumptions;
    const forecast = calculateDCF(historicals, assumptions, {}).forecasts[0];
    expect(forecast.currentDebt).toBeGreaterThan(0);
    expect(forecast.totalCurrentLiabilities).toBeCloseTo(
      forecast.currentDebt + forecast.accountsPayable + forecast.deferredRevenue + forecast.otherCurrentLiabilities,
    );
    expect(forecast.totalLiabilities).toBeCloseTo(forecast.totalCurrentLiabilities + forecast.nonCurrentLiabilities);
  });

  it('balances Assets = Liabilities + Equity when unmodeled filed lines exist', () => {
    // Filed totals carry lines the engine never rolls (intangibles, ROU
    // assets, operating-lease liabilities, memo overlaps). The forecast must
    // still balance every year, with revenue-scaled securities and the NWC
    // overlay funded through cash flow rather than left phantom.
    const historicals = {
      years: [new Date().getFullYear() - 1], revenue: [1000], grossProfit: [400],
      sharesOutstanding: 100, totalDebt: [60], totalAssets: [1000], totalLiabilities: [700],
      cash: [50], marketableSecurities: [100], accountsReceivable: [80], inventory: [40],
      otherCurrentAssets: [10], ppeNet: [200], otherAssets: [120],
      accountsPayable: [90], deferredRevenue: [20], otherCurrentLiabilities: [30],
      otherLiabilities: [60], shareholdersEquity: [300], retainedEarnings: [100],
      depreciation: [50], capex: [50], stockBasedComp: [5], ebit: [200],
      interestExpense: [3], taxExpense: [30], netIncome: [167],
    } as unknown as HistoricalData;
    const assumptions = {
      forecastYears: 5, revenueGrowth: 0.05, grossMargin: 0.4, ebitMargin: 0.2,
      taxRate: 0.2, wacc: 0.1, costOfDebt: 0.05, currentDebt: 60,
      dilutedSharesOutstanding: 100, terminalGrowthRate: 0.02, accountsReceivableDays: 30,
      inventoryDays: 30, accountsPayableDays: 30, capexRatio: 0.05,
      deaRatio: 0.05, nwcChangeRatio: 0.01, leverageTarget: 0.2,
    } as unknown as Assumptions;
    const result = calculateDCF(historicals, assumptions, {});
    expect(result.forecasts.length).toBeGreaterThan(0);
    for (const f of result.forecasts) {
      expect(f.balanceSheetCheck).toBeCloseTo(0, -2);
    }
    expect(result.bsImbalanceWarning).toBeUndefined();
  });
});
