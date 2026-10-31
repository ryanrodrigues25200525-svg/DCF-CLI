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
});
