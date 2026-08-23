import { describe, it, expect } from 'vitest';
import { calculateDCF, calculateInitialAssumptions } from './engine';
import { calculateSensitivityAnalysis } from './sensitivity';
import { HistoricalData, Assumptions, Overrides } from '@/core/types';

// Mock Data
const mockHistoricals: HistoricalData = {
    symbol: 'TEST',
    years: [2023, 2024, 2025],
    revenue: [100, 110, 120],
    costOfRevenue: [60, 65, 70],
    grossProfit: [40, 45, 50],
    ebitda: [15, 20, 25],
    ebit: [10, 15, 20],
    interestExpense: [1, 1, 0.8],
    incomeTaxExpense: [2, 3, 4],
    netIncome: [7, 11, 15.2],
    depreciation: [5, 5, 5],
    capex: [4, 5, 6],
    nwcChange: [1, 2, 2],
    taxRate: [0.2, 0.2, 0.2],
    stockBasedComp: [1, 1, 1],

    // Balance Sheet
    cash: [10, 15, 20],
    accountsReceivable: [10, 11, 12],
    inventory: [15, 16, 18],
    otherCurrentAssets: [2, 2, 2],
    totalCurrentAssets: [27, 33, 40],
    accountsPayable: [8, 9, 10],
    deferredRevenue: [1, 1, 1],
    currentDebt: [5, 4, 3],
    otherCurrentLiabilities: [1, 1, 1],
    totalCurrentLiabilities: [15, 15, 15],
    ppeNet: [40, 42, 45],
    totalAssets: [100, 115, 130],
    totalDebt: [20, 18, 15],
    totalLiabilities: [30, 35, 40],
    shareholdersEquity: [50, 60, 71],
    otherAssets: [5, 5, 5],
    otherLiabilities: [2, 2, 2],
    retainedEarnings: [20, 30, 41],

    // Ratios & Market
    sharesOutstanding: 10,
    price: 15.0,
    beta: 1.0,
    currency: 'USD',
};

const mockAssumptions: Assumptions = {
    forecastYears: 5,
    revenueGrowth: 0.05,
    ebitMargin: 0.20,
    taxRate: 0.25,

    // Ratios
    grossMargin: 0.40,
    rdMargin: 0,
    sgaMargin: 0.20,
    deaRatio: 0.041,
    capexRatio: 0.05,
    nwcChangeRatio: 0.01,

    // WC Days
    accountsReceivableDays: 36.5,
    inventoryDays: 60,
    accountsPayableDays: 30,

    // WACC
    wacc: 0.10,
    terminalGrowthRate: 0.02,
    terminalExitMultiple: 10.0,
    valuationMethod: 'growth',

    // Advanced
    advancedMode: false,
    startingInvestedCapital: 100,
    revenueGrowthStage1: 0.05,
    revenueGrowthStage2: 0.03,
    revenueGrowthStage3: 0.02,
    ebitMarginSteadyState: 0.20,
    ebitMarginConvergenceYears: 5,
    salesToCapitalRatio: 1.5,
    leverageTarget: 0.20,
    riskFreeRate: 0.04,
    equityRiskPremium: 0.06,
    beta: 1.0,
    costOfDebt: 0.05,
    costOfEquity: 0.10,
    weightDebt: 0.2,
    weightEquity: 0.8
};

const overrides: Overrides = {};

describe('DCF Engine Validation', () => {
    it('should calculate basic DCF metrics correctly', () => {
        const result = calculateDCF(mockHistoricals, mockAssumptions, overrides);
        expect(result.forecasts.length).toBe(5);

        const y1Rev = result.forecasts[0].revenue;
        const expectedY1 = 120 * 1.05;
        expect(Math.abs(y1Rev - expectedY1)).toBeLessThan(0.1);

        const f1 = result.forecasts[0];
        const calcFcf = f1.ebit * (1 - 0.25) + f1.depreciation + f1.stockBasedComp - f1.capex - f1.nwcChange;
        expect(Math.abs(f1.fcff - calcFcf)).toBeLessThan(0.01);

        const lastFcf = result.forecasts[4].fcff;
        const wacc = mockAssumptions.wacc;
        const g = mockAssumptions.terminalGrowthRate;
        const expectedTV = (lastFcf * (1 + g)) / (wacc - g);
        expect(Math.abs(result.terminalValueGordon - expectedTV)).toBeLessThan(1.0);

        const discountFactor1 = 1 / Math.pow(1 + wacc, 0.5);
        const expectedPV1 = f1.fcff * discountFactor1;
        expect(Math.abs(result.forecasts[0].pvFcff - expectedPV1)).toBeLessThan(0.01);
    });

    it('should perform sensitivity analysis', () => {
        const sensitivity = calculateSensitivityAnalysis(mockHistoricals, mockAssumptions, overrides);
        expect(sensitivity.rows.length).toBe(5);
        expect(sensitivity.cols.length).toBe(5);
        expect(sensitivity.data.length).toBe(5);

        const centerRow = 2;
        const centerCol = 2;
        const centerVal = sensitivity.data[centerRow][centerCol].impliedSharePrice;

        const baseRes = calculateDCF(mockHistoricals, mockAssumptions, overrides);
        expect(Math.abs(centerVal - baseRes.impliedSharePrice)).toBeLessThan(0.01);
    });

    it('should handle WACC and growth constraints', () => {
        const lowWaccRes = calculateDCF(mockHistoricals, { ...mockAssumptions, wacc: 0.01 }, overrides);
        expect(lowWaccRes.impliedSharePrice).toBeGreaterThan(0);

        const highGrowthAssumptions = { ...mockAssumptions, wacc: 0.10, terminalGrowthRate: 0.12 };
        const resultGap = calculateDCF(mockHistoricals, highGrowthAssumptions, overrides);
        expect(resultGap.terminalValueGordon).toBeGreaterThan(0);
    });

    it('uses current EBIT margin when advanced steady-state margin is stale or invalid', () => {
        const staleAdvancedAssumptions: Assumptions = {
            ...mockAssumptions,
            advancedMode: true,
            ebitMargin: 0.2,
            ebitMarginSteadyState: -0.05,
            ebitMarginConvergenceYears: 5,
        };

        const result = calculateDCF(mockHistoricals, staleAdvancedAssumptions, overrides);

        expect(result.forecasts[0].ebitMargin).toBeGreaterThan(0);
        expect(result.impliedSharePrice).toBeGreaterThan(0);
    });

    it('should maintain balance sheet equilibrium', () => {
        const result = calculateDCF(mockHistoricals, mockAssumptions, overrides);
        const f1 = result.forecasts[0];
        const assets = f1.totalAssets;
        const liabEq = f1.totalLiabilities + f1.shareholdersEquity;
        const diff = Math.abs(assets - liabEq);
        expect(diff).toBeLessThan(assets * 0.001);
    });

    it('should default initial assumptions to a 5-year forecast horizon', () => {
        const initial = calculateInitialAssumptions(
            mockHistoricals,
            { riskFreeRate: 0.04, equityRiskPremium: 0.05 },
            { medianEvEbitda: 11.5 }
        );
        expect(initial.forecastYears).toBe(5);
    });

    it('should use diluted shares when provided for implied share price', () => {
        const assumptionsWithDilution: Assumptions = {
            ...mockAssumptions,
            dilutedSharesOutstanding: 20
        };
        const result = calculateDCF(mockHistoricals, assumptionsWithDilution, overrides);

        expect(result.shareCount).toBe(20);
        expect(Math.abs(result.impliedSharePrice - (result.equityValue / 20))).toBeLessThan(0.000001);
    });
});
