import { describe, expect, it } from 'vitest';

import { mapNativeFinancialsToHistoricals } from './native-normalizer';

describe('native-normalizer', () => {
  it('includes marketable securities in fallback current-asset and total-asset totals', () => {
    const historicals = mapNativeFinancialsToHistoricals(
      {
        ticker: 'TEST',
        cik: '0000000001',
        name: 'Test Co',
        source: 'edgartools_native',
        periods_requested: 1,
        fetched_at_ms: Date.now(),
        key_metrics: {},
        statements: {
          income_statement: [],
          balance_sheet: [
            {
              concept: 'CashAndCashEquivalentsAtCarryingValue',
              standard_concept: 'CashAndCashEquivalents',
              fy2025: 100,
            },
            {
              concept: 'AvailableForSaleSecuritiesCurrent',
              standard_concept: 'MarketableSecurities',
              fy2025: 40,
            },
            {
              concept: 'AccountsReceivableNetCurrent',
              standard_concept: 'AccountsReceivable',
              fy2025: 20,
            },
            {
              concept: 'InventoryNet',
              standard_concept: 'Inventory',
              fy2025: 30,
            },
            {
              concept: 'OtherAssetsCurrent',
              standard_concept: 'OtherCurrentAssets',
              fy2025: 10,
            },
            {
              concept: 'PropertyPlantAndEquipmentNet',
              standard_concept: 'PlantPropertyEquipmentNet',
              fy2025: 50,
            },
            {
              concept: 'OtherAssetsNoncurrent',
              standard_concept: 'OtherAssets',
              fy2025: 5,
            },
            {
              concept: 'AccountsPayableCurrent',
              standard_concept: 'AccountsPayable',
              fy2025: 25,
            },
            {
              concept: 'LongTermDebtNoncurrent',
              standard_concept: 'LongTermDebt',
              fy2025: 60,
            },
          ],
          cashflow_statement: [],
        },
      },
      { current_price: 10, currency: 'USD', beta: 1.1 },
      { ticker: 'TEST', currency: 'USD' },
    );

    expect(historicals.marketableSecurities?.[0]).toBe(40);
    expect(historicals.totalCurrentAssets[0]).toBe(200);
    expect(historicals.totalAssets[0]).toBe(255);
  });

  it('derives shares outstanding from market cap and price when native shares are missing', () => {
    const historicals = mapNativeFinancialsToHistoricals(
      {
        ticker: 'TEST',
        cik: '0000000001',
        name: 'Test Co',
        source: 'edgartools_native',
        periods_requested: 1,
        fetched_at_ms: Date.now(),
        key_metrics: {},
        statements: {
          income_statement: [
            {
              concept: 'RevenueFromContractWithCustomerExcludingAssessedTax',
              standard_concept: 'Revenue',
              fy2025: 1000,
            },
          ],
          balance_sheet: [],
          cashflow_statement: [],
        },
      },
      { current_price: 25, market_cap: 50_000, currency: 'USD', beta: 1.1 },
      { ticker: 'TEST', currency: 'USD' },
    );

    expect(historicals.sharesOutstanding).toBe(2000);
  });

  it('does not treat non-operating income as EBIT and derives EBIT from pretax plus interest', () => {
    const historicals = mapNativeFinancialsToHistoricals(
      {
        ticker: 'TEST',
        cik: '0000000001',
        name: 'Test Co',
        source: 'edgartools_native',
        periods_requested: 1,
        fetched_at_ms: Date.now(),
        key_metrics: {},
        statements: {
          income_statement: [
            {
              concept: 'Revenues',
              standard_concept: 'Revenue',
              'FY 2025': 1000,
            },
            {
              concept: 'OtherNonoperatingIncomeExpense',
              label: 'Other Nonoperating Income (Expense)',
              standard_concept: 'Non-Operating Income (Expense)',
              'FY 2025': -50,
            },
            {
              concept: 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
              standard_concept: 'Income Before Tax',
              'FY 2025': 300,
            },
            {
              concept: 'IncomeTaxExpenseBenefit',
              standard_concept: 'Income Tax Expense',
              'FY 2025': 60,
            },
            {
              concept: 'NetIncomeLoss',
              standard_concept: 'Net Income',
              'FY 2025': 240,
            },
            {
              concept: 'InterestExpenseNonoperating',
              standard_concept: 'Interest Expense',
              'FY 2025': 20,
            },
          ],
          balance_sheet: [],
          cashflow_statement: [],
        },
      },
      { current_price: 10, market_cap: 10_000, currency: 'USD', beta: 1.1 },
      { ticker: 'TEST', currency: 'USD' },
    );

    expect(historicals.ebit[0]).toBe(320);
  });
});
