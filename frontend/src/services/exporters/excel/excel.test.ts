import { describe, expect, test } from 'vitest';
import { buildExportPayload, validateExportData } from './index';
import type { CompanyProfile, HistoricalData, Assumptions, DCFResults, Overrides } from '@/core/types';
import type { ScenarioConfig } from './types';

describe('Excel Export Service', () => {
    // Mock Data
    const mockCompany: CompanyProfile = {
        name: 'Test Corp',
        ticker: 'TST',
        exchange: 'NASDAQ',
        cik: '0001234567',
        sector: 'Technology',
        industry: 'Software',
        fiscalYearEnd: 'December 31',
        currency: 'USD',
    };

    const mockHistoricals: HistoricalData = {
        symbol: 'TST',
        years: [2020, 2021, 2022],
        revenue: [100, 110, 120],
        costOfRevenue: [40, 44, 48],
        grossProfit: [60, 66, 72],
        ebitda: [30, 33, 36],
        ebit: [20, 22, 24],
        netIncome: [15, 16.5, 18],
        cash: [10, 12, 14],
        totalDebt: [5, 5, 5],
        sharesOutstanding: 10,
        price: 50,
        beta: 1.2,
        currency: 'USD',
        interestExpense: [1, 1, 1],
        incomeTaxExpense: [4, 4.5, 5],
        depreciation: [5, 6, 7],
        capex: [-2, -3, -4],
        nwcChange: [1, 1, 1],
        taxRate: [0.21, 0.21, 0.21],
        totalAssets: [100, 110, 120],
        shareholdersEquity: [50, 60, 70],
        accountsReceivable: [5, 6, 7],
        inventory: [3, 4, 5],
        accountsPayable: [4, 5, 6],
        totalCurrentAssets: [30, 34, 38],
        otherCurrentAssets: [8, 9, 10],
        ppeNet: [20, 22, 24],
        otherAssets: [5, 5, 5],
        currentDebt: [2, 2, 2],
        otherLiabilities: [5, 5, 5],
        totalLiabilities: [45, 50, 55],
        totalCurrentLiabilities: [18, 20, 22],
        otherCurrentLiabilities: [9, 10, 11],
        deferredRevenue: [2, 2, 3],
        retainedEarnings: [30, 35, 40],
    };

    const mockAssumptions: Assumptions = {
        forecastYears: 5,
        revenueGrowth: 0.05,
        taxRate: 0.21,
        wacc: 0.1,
        grossMargin: 0.4,
        ebitMargin: 0.2,
        rdMargin: 0.1,
        sgaMargin: 0.1,
        revenueGrowthStage1: 0.05,
        revenueGrowthStage2: 0.04,
        revenueGrowthStage3: 0.03,
        terminalGrowthRate: 0.02,
        terminalExitMultiple: 12,
        valuationMethod: 'growth',
        salesToCapitalRatio: 1,
        accountsReceivableDays: 30,
        inventoryDays: 30,
        accountsPayableDays: 30,
        deaRatio: 0.03,
        capexRatio: 0.03,
        nwcChangeRatio: 0.01,
        ebitMarginSteadyState: 0.2,
        ebitMarginConvergenceYears: 5,
        advancedMode: false,
    };

    const mockResults: DCFResults = {
        enterpriseValue: 1000,
        equityValue: 900,
        impliedSharePrice: 90,
        shareCount: 10,
        currentPrice: 50,
        upside: 0.8,
        terminalValue: 800,
        pvTerminalValue: 500,
        forecasts: [],
        confidenceScore: 0.85,
        confidenceRank: 'High',
        terminalValueGordon: 800,
        terminalValueExitMultiple: 850,
        tvDivergenceFlag: false,
        valueCreationFlag: true,
        avgROIC: 0.15,
    };

    // Add logic to populate forecasts minimally
    for (let i = 1; i <= 5; i++) {
        mockResults.forecasts.push({
            year: 2022 + i,
            revenue: 100 * (1.05 ** i),
            ebitda: 20,
            ebit: 15,
            fcff: 10,
            fcfe: 0,
            pvFcff: 8,
            pv: 8,
            discountFactor: 0.9,
            revenueGrowth: 0.05,
            costOfRevenue: 0,
            grossProfit: 0,
            grossMargin: 0,
            ebitdaMargin: 0,
            ebitMargin: 0,
            interestExpense: 0,
            preTaxIncome: 0,
            taxExpense: 0,
            effectiveTaxRate: 0.21,
            netIncome: 0,
            netMargin: 0,
            rdExpense: 0,
            sgaExpense: 0,
            depreciation: 0,
            stockBasedComp: 0,
            capex: 0,
            nwcChange: 0,
            cfo: 0,
            reinvestment: 0,
            arDays: 0,
            inventoryDays: 0,
            apDays: 0,
            cash: 0,
            totalCurrentAssets: 0,
            otherCurrentAssets: 0,
            ppeNet: 0,
            otherAssets: 0,
            totalAssets: 0,
            totalDebt: 0,
            currentDebt: 0,
            shortTermDebt: 0,
            longTermDebt: 0,
            otherLiabilities: 0,
            deferredRevenue: 0,
            otherCurrentLiabilities: 0,
            totalCurrentLiabilities: 0,
            nonCurrentLiabilities: 0,
            commonStock: 0,
            retainedEarnings: 0,
            shareholdersEquity: 0,
            investedCapital: 0,
            roic: 0,
            economicProfit: 0,
            accountsReceivable: 0,
            inventory: 0,
            accountsPayable: 0,
            nwc: 0,
            dividends: 0,
            shareBuybacks: 0,
            debtIssuance: 0,
            debtRepayment: 0,
            totalLiabilities: 0,
            taxShieldUsed: 0,
            nolBalance: 0,
            isStub: false,
        });
    }

    test('buildExportPayload creates correct structure', () => {
        const payload = buildExportPayload(
            mockCompany,
            mockHistoricals,
            mockAssumptions,
            mockResults
        );

        expect(payload).toBeDefined();
        expect(payload.company.ticker).toBe('TST');
        expect(payload.market.sharesDiluted).toBe(10);
        expect(payload.assumptions.wacc.beta).toBe(1.2);
        expect(payload.historicals.income['Total Revenue']).toEqual(mockHistoricals.revenue);
        expect(payload.historicals.income['Cost of Revenue']).toEqual(mockHistoricals.costOfRevenue);
        expect(payload.historicals.income['Operating Income (EBIT)']).toEqual(mockHistoricals.ebit);
        expect(payload.historicals.income['Income Taxes']).toEqual(mockHistoricals.incomeTaxExpense);

        // Validation check
        const errors = validateExportData(payload);
        expect(errors).toHaveLength(0);
    });

    test('validateExportData catches missing fields', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const badPayload: any = {
            company: { name: 'Bad' }
        };
        const errors = validateExportData(badPayload);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors).toContain('Missing Market Data');
    });

    test('Payload handles missing optional data', () => {
        const payload = buildExportPayload(
            mockCompany,
            mockHistoricals,
            mockAssumptions,
            mockResults,
            undefined, // No comps
            undefined  // No precedents
        );

        expect(payload.comps).toBeUndefined();
        expect(payload.assumptions).toBeDefined();
        expect(validateExportData(payload)).toHaveLength(0);
    });

    test('payload includes sensitivity matrices with center parity', () => {
        const overrides: Overrides = {};
        const payload = buildExportPayload(
            mockCompany,
            mockHistoricals,
            mockAssumptions,
            mockResults,
            undefined,
            undefined,
            undefined,
            overrides
        );

        const sensitivities = payload.sensitivities;
        expect(sensitivities?.waccAxis).toHaveLength(5);
        expect(sensitivities?.terminalGrowthAxis).toHaveLength(5);
        expect(sensitivities?.waccTerminalEvMatrix).toHaveLength(5);
        expect(sensitivities?.waccTerminalEvMatrix?.every((row) => row.length === 5)).toBe(true);
        expect(sensitivities?.waccTerminalEvMatrix?.[2][2]).toBeCloseTo(mockResults.enterpriseValue, 6);
    });

    test('revenue/ebit sensitivity matrix is monotonic under normal conditions', () => {
        const payload = buildExportPayload(
            mockCompany,
            mockHistoricals,
            mockAssumptions,
            mockResults
        );

        const matrix = payload.sensitivities?.revenueEbitEvMatrix ?? [];
        expect(matrix).toHaveLength(5);
        expect(matrix.every((row) => row.length === 5)).toBe(true);

        for (let r = 0; r < matrix.length; r++) {
            for (let c = 1; c < matrix[r].length; c++) {
                expect(matrix[r][c]).toBeGreaterThanOrEqual(matrix[r][c - 1]);
            }
        }
        for (let r = 1; r < matrix.length; r++) {
            for (let c = 0; c < matrix[r].length; c++) {
                expect(matrix[r][c]).toBeGreaterThanOrEqual(matrix[r - 1][c]);
            }
        }
    });

    test('payload includes ui meta key metrics for parity downstream', () => {
        const payload = buildExportPayload(
            mockCompany,
            mockHistoricals,
            mockAssumptions,
            mockResults
        );

        expect(payload.uiMeta?.keyMetrics?.equityValue).toBe(900);
        expect(payload.uiMeta?.keyMetrics?.impliedUpside).toBe(0.8);
        expect(payload.uiMeta?.keyMetrics?.terminalValue).toBe(800);
    });

    test('buildExportPayload includes explicit scenario snapshots when scenarioConfig is provided', () => {
        const scenarioConfig: ScenarioConfig = {
            bull: {
                revenueGrowthBps: 120,
                ebitMarginBps: 80,
                waccBps: -40,
                terminalGrowthBps: 40,
                exitMultipleDelta: 1.2,
            },
            bear: {
                revenueGrowthBps: -120,
                ebitMarginBps: -80,
                waccBps: 40,
                terminalGrowthBps: -40,
                exitMultipleDelta: -1.2,
            },
        };
        const assumptionsWithScenario = {
            ...mockAssumptions,
            scenarioConfig,
        } as Assumptions & { scenarioConfig?: ScenarioConfig };

        const payload = buildExportPayload(
            mockCompany,
            mockHistoricals,
            assumptionsWithScenario,
            mockResults
        );

        expect(payload.scenarios).toBeDefined();
        expect(payload.scenarios?.base).toBeDefined();
        expect(payload.scenarios?.bull).toBeDefined();
        expect(payload.scenarios?.bear).toBeDefined();
        expect(payload.scenarios?.bull.summary.impliedSharePrice).not.toBe(payload.scenarios?.base.summary.impliedSharePrice);
        expect(payload.scenarios?.bear.summary.impliedSharePrice).not.toBe(payload.scenarios?.base.summary.impliedSharePrice);
    });

    test('buildExportPayload applies default scenario deltas when scenarioConfig is omitted', () => {
        const payload = buildExportPayload(
            mockCompany,
            mockHistoricals,
            mockAssumptions,
            mockResults
        );

        expect(payload.scenarios).toBeDefined();
        expect(payload.scenarios?.bull.summary.enterpriseValue).not.toBe(payload.scenarios?.base.summary.enterpriseValue);
        expect(payload.scenarios?.bear.summary.enterpriseValue).not.toBe(payload.scenarios?.base.summary.enterpriseValue);
        expect(payload.scenarios?.bull.assumptions.waccRate).toBeLessThan(payload.scenarios?.base.assumptions.waccRate || Number.POSITIVE_INFINITY);
        expect(payload.scenarios?.bear.assumptions.waccRate).toBeGreaterThan(payload.scenarios?.base.assumptions.waccRate || Number.NEGATIVE_INFINITY);
    });
});
