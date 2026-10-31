import { describe, expect, it } from 'vitest';
import type { Assumptions } from '@/core/types';
import { calculateFinancing } from './modules/financing';

describe('financing debt roll-forward', () => {
  it('includes scheduled and excess-cash repayments in the reported debt movement', () => {
    const result = calculateFinancing({
      ebit: 100, depreciation: 0, stockBasedComp: 0, nwcChange: 0, cfi: 0,
      beginningDebt: 100, beginningCash: 100, beginningRetainedEarnings: 100,
      beginningCumulativeBuybacks: 0, beginningCumulativeSbc: 0, paidInCapital: 100,
      nolBalance: 0, otherAssets: 0, otherLiabilities: 0, otherCurrentAssets: 0,
      otherCurrentLiabilities: 0, deferredRevenue: 0, yearIndex: 1, previousDividend: 0,
      assumptions: { taxRate: 0.2, costOfDebt: 0.05, annualDebtRepayment: 10, leverageTarget: 0.2 } as Assumptions,
    });
    expect(result.debtRepayment).toBeGreaterThan(10);
    expect(result.totalDebt).toBeCloseTo(100 + result.debtIssuance - result.debtRepayment, 8);
  });
});
