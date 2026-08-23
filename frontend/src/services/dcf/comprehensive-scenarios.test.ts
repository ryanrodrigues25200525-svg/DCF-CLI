import { describe, expect, it } from 'vitest';

import type { Assumptions, CompanyProfile, HistoricalData, Overrides } from '@/core/types';
import { applyIndustryTemplateAssumptions, detectIndustryTemplate } from '@/core/data/industry-templates';
import { calculateGordonGrowth } from '@/services/calculators/valuation';
import { calculateWACC } from '@/services/calculators/wacc';
import { buildExportPayload } from '@/services/exporters/excel';

import { calculateDCF } from './engine';

const overrides: Overrides = {};

function createHistoricals(custom: Partial<HistoricalData> = {}): HistoricalData {
    const base: HistoricalData = {
        symbol: 'TEST',
        years: [2023, 2024, 2025],
        revenue: [100_000, 110_000, 120_000],
        costOfRevenue: [60_000, 66_000, 72_000],
        grossProfit: [40_000, 44_000, 48_000],
        ebitda: [18_000, 20_000, 22_000],
        ebit: [12_000, 13_500, 15_000],
        interestExpense: [900, 850, 800],
        incomeTaxExpense: [2_300, 2_500, 2_800],
        netIncome: [8_800, 10_150, 11_400],
        depreciation: [5_000, 5_200, 5_400],
        capex: [4_500, 4_700, 4_900],
        nwcChange: [600, 650, 700],
        taxRate: [0.21, 0.21, 0.21],
        stockBasedComp: [700, 740, 780],
        cash: [12_000, 13_000, 14_000],
        accountsReceivable: [10_000, 11_000, 12_000],
        inventory: [9_000, 9_500, 10_000],
        otherCurrentAssets: [3_000, 3_100, 3_200],
        totalCurrentAssets: [34_000, 36_600, 39_200],
        accountsPayable: [8_000, 8_500, 9_000],
        deferredRevenue: [1_200, 1_250, 1_300],
        currentDebt: [4_500, 4_200, 3_900],
        otherCurrentLiabilities: [2_500, 2_550, 2_600],
        totalCurrentLiabilities: [16_200, 16_500, 16_800],
        ppeNet: [45_000, 46_000, 47_000],
        totalAssets: [105_000, 112_000, 119_000],
        totalDebt: [20_000, 19_000, 18_000],
        totalLiabilities: [47_000, 49_500, 52_000],
        shareholdersEquity: [58_000, 62_500, 67_000],
        otherAssets: [6_000, 6_200, 6_400],
        otherLiabilities: [3_000, 3_100, 3_200],
        retainedEarnings: [24_000, 28_500, 33_000],
        sharesOutstanding: 10_000,
        price: 110,
        beta: 1.1,
        currency: 'USD',
    };

    return { ...base, ...custom };
}

function createAssumptions(custom: Partial<Assumptions> = {}): Assumptions {
    const base: Assumptions = {
        forecastYears: 5,
        revenueGrowth: 0.05,
        ebitMargin: 0.2,
        grossMargin: 0.4,
        taxRate: 0.21,
        deaRatio: 0.04,
        capexRatio: 0.05,
        nwcChangeRatio: 0.01,
        rdMargin: 0.03,
        sgaMargin: 0.12,
        accountsReceivableDays: 36,
        inventoryDays: 60,
        accountsPayableDays: 35,
        wacc: 0.1,
        riskFreeRate: 0.04,
        equityRiskPremium: 0.06,
        beta: 1.1,
        costOfDebt: 0.06,
        terminalGrowthRate: 0.025,
        terminalExitMultiple: 12,
        valuationMethod: 'growth',
        advancedMode: false,
        revenueGrowthStage1: 0.06,
        revenueGrowthStage2: 0.04,
        revenueGrowthStage3: 0.03,
        ebitMarginSteadyState: 0.2,
        ebitMarginConvergenceYears: 5,
        salesToCapitalRatio: 1.5,
        leverageTarget: 0.2,
        modelType: 'unlevered',
        dilutedSharesOutstanding: 10_000,
    };

    return { ...base, ...custom };
}

function toSinglePointHistoricals(data: HistoricalData): HistoricalData {
    const idx = data.years.length - 1;
    const pick = (arr: number[]): number[] => [arr[idx]];

    return {
        ...data,
        years: [data.years[idx]],
        revenue: pick(data.revenue),
        costOfRevenue: pick(data.costOfRevenue),
        grossProfit: pick(data.grossProfit),
        ebitda: pick(data.ebitda),
        ebit: pick(data.ebit),
        interestExpense: pick(data.interestExpense),
        incomeTaxExpense: pick(data.incomeTaxExpense),
        netIncome: pick(data.netIncome),
        depreciation: pick(data.depreciation),
        capex: pick(data.capex),
        nwcChange: pick(data.nwcChange),
        stockBasedComp: data.stockBasedComp ? pick(data.stockBasedComp) : undefined,
        taxRate: pick(data.taxRate),
        accountsReceivable: pick(data.accountsReceivable),
        inventory: pick(data.inventory),
        accountsPayable: pick(data.accountsPayable),
        cash: pick(data.cash),
        totalCurrentAssets: pick(data.totalCurrentAssets),
        otherCurrentAssets: pick(data.otherCurrentAssets),
        totalAssets: pick(data.totalAssets),
        totalDebt: pick(data.totalDebt),
        currentDebt: pick(data.currentDebt),
        shareholdersEquity: pick(data.shareholdersEquity),
        ppeNet: pick(data.ppeNet),
        otherAssets: pick(data.otherAssets),
        otherLiabilities: pick(data.otherLiabilities),
        totalLiabilities: pick(data.totalLiabilities),
        totalCurrentLiabilities: pick(data.totalCurrentLiabilities),
        otherCurrentLiabilities: pick(data.otherCurrentLiabilities),
        deferredRevenue: pick(data.deferredRevenue),
        retainedEarnings: pick(data.retainedEarnings),
    };
}

describe('DCF Builder - Comprehensive Scenarios', () => {
    describe('Capital Structure Variations', () => {
        it('handles zero debt as pure equity financing', () => {
            const result = calculateWACC({
                riskFreeRate: 0.03,
                equityRiskPremium: 0.08,
                beta: 1,
                equityValue: 2_500_000,
                totalDebt: 0,
                costOfDebt: 0.25,
                taxRate: 0.21,
            });

            expect(result.wacc).toBeCloseTo(0.11, 8);
            expect(result.equityWeight).toBeCloseTo(1, 8);
            expect(result.debtWeight).toBeCloseTo(0, 8);
        });

        it('handles very high leverage with debt-heavy WACC weighting', () => {
            const result = calculateWACC({
                riskFreeRate: 0.05,
                equityRiskPremium: 0.1,
                beta: 1,
                equityValue: 500_000,
                totalDebt: 4_500_000,
                costOfDebt: 0.06,
                taxRate: 0.21,
            });

            expect(result.equityWeight).toBeCloseTo(0.1, 8);
            expect(result.debtWeight).toBeCloseTo(0.9, 8);
            expect(result.wacc).toBeCloseTo(0.05766, 5);
        });

        it('keeps calculations finite for negative-equity stress inputs', () => {
            const result = calculateWACC({
                riskFreeRate: 0.05,
                equityRiskPremium: 0.1,
                beta: 1,
                equityValue: -200_000,
                totalDebt: 1_000_000,
                costOfDebt: 0.12,
                taxRate: 0,
            });

            expect(Number.isFinite(result.wacc)).toBe(true);
            expect(result.equityWeight).toBeLessThan(0);
            expect(result.debtWeight).toBeGreaterThan(1);
        });
    });

    describe('Growth Scenarios', () => {
        it('supports startup profiles with early negative cash flow and later profitability', () => {
            const historicals = createHistoricals({
                revenue: [5_000, 8_000, 15_000],
                costOfRevenue: [6_000, 8_400, 13_500],
                grossProfit: [-1_000, -400, 1_500],
                ebitda: [-1_800, -1_400, -1_000],
                ebit: [-2_200, -1_900, -3_000],
                interestExpense: [200, 200, 180],
                incomeTaxExpense: [0, 0, 0],
                netIncome: [-2_400, -2_100, -3_200],
                depreciation: [300, 320, 340],
                capex: [700, 800, 1_000],
                nwcChange: [120, 160, 220],
                taxRate: [0, 0, 0],
                cash: [4_000, 3_200, 2_500],
                totalDebt: [5_000, 5_500, 6_000],
                currentDebt: [1_200, 1_300, 1_400],
                ppeNet: [1_500, 1_700, 2_000],
                sharesOutstanding: 8_000,
                price: 12,
                beta: 1.6,
            });
            const assumptions = createAssumptions({
                forecastYears: 10,
                advancedMode: true,
                wacc: 0.14,
                terminalGrowthRate: 0.04,
                revenueGrowth: 0.35,
                revenueGrowthStage1: 0.6,
                revenueGrowthStage2: 0.3,
                revenueGrowthStage3: 0.15,
                ebitMargin: 0.1,
                ebitMarginSteadyState: 0.35,
                ebitMarginConvergenceYears: 6,
                grossMargin: 0.55,
                taxRate: 0.21,
                salesToCapitalRatio: 5,
                dilutedSharesOutstanding: 8_000,
            });

            const result = calculateDCF(historicals, assumptions, overrides);
            const terminalShare = result.enterpriseValue > 0 ? result.pvTerminalValue / result.enterpriseValue : 0;
            const firstForecast = result.forecasts[0];
            const lastForecast = result.forecasts[result.forecasts.length - 1];

            expect(historicals.ebit[historicals.ebit.length - 1]).toBeLessThan(0);
            expect(lastForecast.ebitMargin).toBeGreaterThan(firstForecast.ebitMargin);
            expect(lastForecast.ebitMargin).toBeGreaterThan(0);
            expect(Number.isFinite(result.enterpriseValue)).toBe(true);
            expect(result.pvTerminalValue).toBeGreaterThan(0);
            if (result.enterpriseValue > 0) {
                expect(terminalShare).toBeGreaterThan(0.5);
            }
        });

        it('supports declining companies and negative terminal growth assumptions', () => {
            const historicals = createHistoricals({
                revenue: [1_000_000, 950_000, 900_000],
                costOfRevenue: [820_000, 790_000, 760_000],
                grossProfit: [180_000, 160_000, 140_000],
                ebitda: [120_000, 105_000, 90_000],
                ebit: [90_000, 75_000, 60_000],
                netIncome: [62_000, 51_000, 41_000],
                taxRate: [0.21, 0.21, 0.21],
            });
            const assumptions = createAssumptions({
                revenueGrowth: -0.03,
                terminalGrowthRate: -0.01,
                wacc: 0.09,
                ebitMargin: 0.12,
            });

            const result = calculateDCF(historicals, assumptions, overrides);
            const firstForecastRevenue = result.forecasts[0].revenue;
            const secondForecastRevenue = result.forecasts[1].revenue;

            expect(secondForecastRevenue).toBeLessThan(firstForecastRevenue);
            expect(Number.isFinite(result.enterpriseValue)).toBe(true);
            expect(result.terminalValue).toBeGreaterThan(0);
        });

        it('caps terminal growth when it is greater than or equal to WACC', () => {
            const historicals = createHistoricals();
            const assumptions = createAssumptions({
                wacc: 0.1,
                terminalGrowthRate: 0.12,
                valuationMethod: 'growth',
            });

            const result = calculateDCF(historicals, assumptions, overrides);
            const lastForecast = result.forecasts[result.forecasts.length - 1];
            const expectedCappedTv = calculateGordonGrowth(lastForecast.fcff, assumptions.wacc, assumptions.wacc - 0.005);

            expect(result.terminalGrowthWarning).toContain('must be less than Discount Rate');
            expect(result.terminalValueGordon).toBeCloseTo(expectedCappedTv, 4);
        });
    });

    describe('Industry-Specific Scenarios', () => {
        it('detects financial institutions, REITs, pharma, and SaaS profiles', () => {
            expect(detectIndustryTemplate('BANK', 'Financial Services', 'Regional Bank')).toBe('financials');
            expect(detectIndustryTemplate('REIT', 'Real Estate', 'Net Lease REIT')).toBe('real-estate');
            expect(detectIndustryTemplate('PHRM', 'Healthcare', 'Biotech')).toBe('healthcare');
            expect(detectIndustryTemplate('CLOD', 'Technology', 'Cloud Software')).toBe('tech-saas');
        });

        it('applies template-specific assumptions for financials and real estate', () => {
            const base = createAssumptions();
            const financials = applyIndustryTemplateAssumptions(base, 'financials');
            const reit = applyIndustryTemplateAssumptions(base, 'real-estate');
            const healthcare = applyIndustryTemplateAssumptions(
                { ...base, advancedMode: true, ebitMarginSteadyState: -0.01 },
                'healthcare'
            );

            expect(financials.terminalGrowthRate).toBeCloseTo(0.02, 8);
            expect(financials.terminalExitMultiple).toBe(9);
            expect(reit.taxRate).toBe(0);
            expect(reit.terminalExitMultiple).toBe(14);
            expect(healthcare.ebitMargin).toBeCloseTo(0.25, 8);
            expect(healthcare.ebitMarginSteadyState).toBeCloseTo(0.25, 8);
        });
    });

    describe('Extreme Edge Cases', () => {
        it('falls back gracefully when core data is unusable', () => {
            const invalid = createHistoricals({
                revenue: [0, 0, 0],
                sharesOutstanding: 0,
            });
            const result = calculateDCF(invalid, createAssumptions(), overrides);

            expect(result.forecasts).toHaveLength(0);
            expect(result.sectorWarning).toContain('Insufficient financial data');
        });

        it('supports a single historical data point', () => {
            const singlePoint = toSinglePointHistoricals(createHistoricals());
            const result = calculateDCF(singlePoint, createAssumptions(), overrides);

            expect(result.forecasts.length).toBeGreaterThan(0);
            expect(Number.isFinite(result.enterpriseValue)).toBe(true);
            expect(Number.isFinite(result.impliedSharePrice)).toBe(true);
        });

        it('handles extreme valuation parameters without division-by-zero failures', () => {
            const lowSpreadTv = calculateGordonGrowth(10_000, 0, 0.05);
            const hugeScaleWacc = calculateWACC({
                riskFreeRate: 0.04,
                equityRiskPremium: 0.06,
                beta: 1.1,
                equityValue: 3_000_000_000_000,
                totalDebt: 600_000_000_000,
                taxRate: 0.21,
            });

            expect(Number.isFinite(lowSpreadTv)).toBe(true);
            expect(lowSpreadTv).toBeGreaterThan(0);
            expect(Number.isFinite(hugeScaleWacc.wacc)).toBe(true);
            expect(hugeScaleWacc.wacc).toBeGreaterThan(0);
        });
    });

    describe('Export Payload Integrity', () => {
        it('builds a valid excel export payload shape for downstream exporter', () => {
            const company: CompanyProfile = {
                name: 'Scenario Test Corp',
                ticker: 'SCEN',
                exchange: 'NASDAQ',
                cik: '0000000001',
                sector: 'Technology',
                industry: 'Software',
                fiscalYearEnd: 'December 31',
                currency: 'USD',
            };
            const historicals = createHistoricals();
            const assumptions = createAssumptions();
            const results = calculateDCF(historicals, assumptions, overrides);

            const payload = buildExportPayload(company, historicals, assumptions, results);

            expect(payload.company.ticker).toBe('SCEN');
            expect(payload.forecasts.length).toBeGreaterThan(0);
            expect(payload.assumptions.terminal.exitMultiple).toBeGreaterThan(0);
            expect(payload.uiMeta?.keyMetrics?.equityValue).toBeDefined();
        });
    });
});
