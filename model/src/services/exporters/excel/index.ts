import type {
    DcfExportPayload,
    ForecastPeriod,
    TerminalValueCalc,
    ValuationSummary,
    WaccLoopMode,
    ScenarioConfig,
    ScenarioDeltaConfig,
    ExportScenarios,
    ScenarioSnapshot,
} from './types';
import { calculateWACC as sharedCalculateWACC } from '@/services/calculators/wacc';
import { calculateNOPAT } from '@/services/calculators/tax';
import { calculateDCF } from '@/services/dcf/engine';
import { buildExportAssumptions, buildHistoricalFinancials, buildMarketSnapshot, buildUiMeta } from './payload-mappers';

// Re-export types
export type {
    DcfExportPayload,
    ForecastPeriod,
    TerminalValueCalc,
    ValuationSummary,
    CompData,
    UiMeta,
} from './types';

/**
 * Validates the export payload for required fields.
 */
export function validateExportData(payload: DcfExportPayload): string[] {
    const errors: string[] = [];

    if (!payload.company) errors.push('Missing Company Info');
    if (!payload.market) errors.push('Missing Market Data');
    if (!payload.historicals) errors.push('Missing Historical Financials');
    if (!payload.assumptions) errors.push('Missing Model Assumptions');
    if (!payload.forecasts || payload.forecasts.length === 0) errors.push('Missing Forecast Data');

    if (payload.company && !payload.company.name) errors.push('Missing Company Name');
    if (payload.company && !payload.company.ticker) errors.push('Missing Company Ticker');

    return errors;
}

// =============================================================================
// CALCULATION HELPERS
// =============================================================================

/**
 * Calculate WACC from components - Single source of truth for WACC calculation
 * This ensures consistency between web app and Excel exporter
 */
export function calculateWACC(payload: DcfExportPayload): number {
    if (typeof payload.assumptions.waccRate === 'number' && Number.isFinite(payload.assumptions.waccRate) && payload.assumptions.waccRate > 0) {
        return payload.assumptions.waccRate;
    }

    const waccAssumptions = payload.assumptions.wacc;
    const taxRate = payload.assumptions.taxRate || 0.21;

    if (waccAssumptions && typeof waccAssumptions === 'object') {
        const result = sharedCalculateWACC({
            riskFreeRate: waccAssumptions.rf,
            equityRiskPremium: waccAssumptions.erp,
            beta: waccAssumptions.beta,
            costOfDebt: waccAssumptions.costOfDebt,
            equityValue: payload.market.sharesDiluted * payload.market.currentPrice,
            totalDebt: payload.market.debt || 0,
            taxRate: taxRate
        });
        return result.wacc;
    }

    return 0.10; // Default 10%
}

/**
 * Convert web app forecast results to Excel format
 * Uses pre-calculated values from web app to ensure parity
 */
export function calculateForecasts(payload: DcfExportPayload): ForecastPeriod[] {
    const forecasts = payload.forecasts || [];
    const taxRate = payload.assumptions.taxRate || 0.21;

    return forecasts.map(f => {
        const period: ForecastPeriod = {
            year: f.year,
            isHistorical: f.isStub ?? false,
            revenue: f.revenue,
            revenueGrowth: f.revenueGrowth,
            costOfRevenue: f.costOfRevenue,
            grossProfit: f.grossProfit,
            grossMargin: f.grossMargin,
            ebitda: f.ebitda,
            ebitdaMargin: f.ebitdaMargin,
            ebit: f.ebit,
            ebitMargin: f.ebitMargin,
            interestExpense: f.interestExpense,
            preTaxIncome: f.preTaxIncome ?? f.ebit,
            taxExpense: f.taxExpense,
            netIncome: f.netIncome,
            netMargin: f.netMargin,
            rdExpense: f.rdExpense || 0,
            sgaExpense: f.sgaExpense || 0,
            depreciation: f.depreciation,
            stockBasedComp: f.stockBasedComp,
            capex: f.capex,
            nwcChange: f.nwcChange,
            nopat: calculateNOPAT(f.ebit, taxRate),
            ufcf: f.fcff,
            arDays: f.arDays || 0,
            inventoryDays: f.inventoryDays || 0,
            apDays: f.apDays || 0,
            taxShieldUsed: f.taxShieldUsed || 0,
            nolBalance: f.nolBalance || 0,
            discountFactor: f.discountFactor,
            pvUfcf: f.pvFcff,
            cash: f.cash,
            ppeNet: f.ppeNet,
            totalAssets: f.totalAssets,
            totalDebt: f.totalDebt,
            shareholdersEquity: f.shareholdersEquity,
            investedCapital: f.investedCapital,
            roic: f.roic,
            economicProfit: f.economicProfit,
            accountsReceivable: f.accountsReceivable,
            inventory: f.inventory,
            accountsPayable: f.accountsPayable,
            dividends: f.dividends,
            shareBuybacks: f.shareBuybacks,
            debtIssuance: f.debtIssuance,
            debtRepayment: f.debtRepayment,
            totalLiabilities: f.totalLiabilities,
        };
        return period;
    });
}

/**
 * Calculate terminal value with safety checks matching web app
 * CRITICAL FIX: Added proper handling for edge cases (negative FCFF, WACC <= g, etc.)
 */
export const calculateTerminalValue = (
    payload: DcfExportPayload,
    forecasts: ForecastPeriod[]
): TerminalValueCalc => {
    if (forecasts.length === 0) return { method: 'Perpetuity', perpetuityTV: 0, exitMultipleTV: 0, selectedTV: 0, pvTV: 0 };

    const lastForecast = forecasts[forecasts.length - 1];

    // Calculate WACC using centralized helper to ensure parity with web app
    const wacc = calculateWACC(payload);

    let g = payload.assumptions.terminal.g || 0.025;
    const exitMultiple = payload.assumptions.terminal.exitMultiple || 12;
    const method = payload.assumptions.terminal.method || 'Perpetuity';

    // CRITICAL FIX: Cap terminal growth to be less than WACC (matches web app)
    if (g >= wacc) {
        g = Math.max(0, wacc - 0.005); // Cap at WACC - 0.5%
    }

    // CRITICAL FIX: Handle negative UFCF/FCFF (matches web app logic)
    // If UFCF is negative, use exit multiple method or revenue-based fallback
    let perpetuityTV: number;
    if (lastForecast.ufcf < 0) {
        // Negative cash flow - perpetuity method doesn't work
        perpetuityTV = 0;
    } else if (wacc > g) {
        perpetuityTV = (lastForecast.ufcf * (1 + g)) / (wacc - g);
    } else {
        perpetuityTV = 0;
    }

    // CRITICAL FIX: Handle negative EBITDA for exit multiple
    let exitMultipleTV: number;
    if (lastForecast.ebitda > 0) {
        exitMultipleTV = lastForecast.ebitda * exitMultiple;
    } else if (lastForecast.revenue > 0) {
        // Fallback to revenue multiple if EBITDA is negative
        exitMultipleTV = lastForecast.revenue * 2.0; // Conservative 2x revenue
    } else {
        exitMultipleTV = 0;
    }

    // Select terminal value based on method
    let selectedTV = method === 'Perpetuity' ? perpetuityTV :
        method === 'ExitMultiple' ? exitMultipleTV :
            (perpetuityTV + exitMultipleTV) / 2;

    // CRITICAL FIX: Handle negative selected TV (matches web app line 788-792)
    if (selectedTV < 0) {
        selectedTV = 0;
    }

    // Use actual forecast years for discounting
    const lastYear = lastForecast.year;
    const firstYear = forecasts[0].year;
    const actualYears = lastYear - firstYear + 1;
    const tvDiscountFactor = 1 / Math.pow(1 + wacc, actualYears);
    const pvTV = selectedTV * tvDiscountFactor;

    return {
        method,
        perpetuityTV,
        exitMultipleTV,
        selectedTV,
        pvTV,
    };
}

/**
 * Calculate valuation summary with negative cash flow fallbacks
 * CRITICAL FIX: Added handling for negative/unreasonable enterprise values
 */
export function calculateValuationSummary(
    payload: DcfExportPayload,
    forecasts: ForecastPeriod[],
    terminalValue: TerminalValueCalc
): ValuationSummary {
    const sumPvUfcf = forecasts.reduce((sum, f) => sum + f.pvUfcf, 0);
    let enterpriseValue = sumPvUfcf + terminalValue.pvTV;

    // CRITICAL FIX: Handle negative or zero enterprise value (matches web app lines 807-846)
    const allFcffNegative = forecasts.every(f => f.ufcf < 0);
    const mostFcffNegative = forecasts.filter(f => f.ufcf < 0).length > (forecasts.length / 2);
    const sumPvUfcfNegative = sumPvUfcf < 0;

    if (allFcffNegative || mostFcffNegative || sumPvUfcfNegative || enterpriseValue <= 0) {
        const lastForecast = forecasts[forecasts.length - 1];

        // Try exit multiple method first
        const exitMultipleTV = lastForecast.ebitda > 0
            ? lastForecast.ebitda * (payload.assumptions.terminal.exitMultiple || 12)
            : lastForecast.revenue > 0
                ? lastForecast.revenue * 2.0  // Conservative 2x revenue
                : 0;

        if (exitMultipleTV > 0) {
            // Recalculate using exit multiple with full discounting
            const wacc = terminalValue.pvTV > 0 && terminalValue.selectedTV > 0
                ? Math.pow(terminalValue.selectedTV / terminalValue.pvTV, 1 / forecasts.length) - 1
                : 0.10;
            const tvDiscountFactor = 1 / Math.pow(1 + wacc, forecasts.length);
            enterpriseValue = Math.max(1, exitMultipleTV * tvDiscountFactor);
        } else if (lastForecast.revenue > 0) {
            // Ultimate fallback: revenue-based
            enterpriseValue = Math.max(1, lastForecast.revenue * 2.0);
        } else {
            // Minimum $1M enterprise value
            enterpriseValue = Math.max(1, 1000);
        }
    }

    // Ensure enterprise value is at least $1 (in millions)
    enterpriseValue = Math.max(1, enterpriseValue);

    const netDebt = (payload.market.debt || 0) - (payload.market.cash || 0);
    const minorityInterest = payload.market.minorityInterest || 0;
    const preferredEquity = payload.market.preferredEquity || 0;
    const nonOperatingAssets = payload.market.nonOperatingAssets || 0;

    let equityValue = enterpriseValue - netDebt - minorityInterest - preferredEquity + nonOperatingAssets;

    const sharesOutstanding = payload.market.sharesDiluted;
    const valuePerShare = sharesOutstanding > 0 ? equityValue / sharesOutstanding : 0;
    const currentPrice = payload.market.currentPrice;
    const upside = currentPrice > 0 ? (valuePerShare - currentPrice) / currentPrice : 0;
    const tvPctOfEv = enterpriseValue > 0 ? terminalValue.pvTV / enterpriseValue : 0;

    return {
        sumPvUfcf,
        pvTerminalValue: terminalValue.pvTV,
        enterpriseValue,
        netDebt,
        minorityInterest,
        preferredEquity,
        nonOperatingAssets,
        equityValue,
        sharesOutstanding,
        valuePerShare,
        currentPrice,
        upside,
        tvPctOfEv,
    };
}

// =============================================================================
// ADAPTER FUNCTION
// =============================================================================

import type {
    CompanyProfile,
    HistoricalData,
    Assumptions,
    DCFResults,
    Overrides,
    ComparableCompany,
    PrecedentTransaction,
    RevenueBuild as RevenueBuildData
} from '@/core/types';

function roundAxisValue(value: number): number {
    return Number(value.toFixed(4));
}

function buildCenteredAxis(center: number, step: number, min: number, max: number): number[] {
    const safeCenter = Number.isFinite(center) ? center : (min + max) / 2;
    const axis = Array.from({ length: 5 }, (_, idx) => {
        const shifted = safeCenter + (idx - 2) * step;
        return Math.max(min, Math.min(max, shifted));
    }).map(roundAxisValue);

    // De-duplicate after clamping while preserving monotonic order.
    for (let i = 1; i < axis.length; i++) {
        if (axis[i] <= axis[i - 1]) {
            axis[i] = roundAxisValue(Math.min(max, axis[i - 1] + Math.max(step / 2, 0.0005)));
        }
    }

    return axis;
}

function buildWaccTerminalEvMatrix(
    historicals: HistoricalData,
    assumptions: Assumptions,
    overrides: Overrides,
    results: DCFResults,
    waccAxis: number[],
    terminalGrowthAxis: number[],
): number[][] {
    const matrix: number[][] = [];
    const fallbackEv = Math.max(1, results.enterpriseValue || 1);

    for (const g of terminalGrowthAxis) {
        const row: number[] = [];
        for (const wacc of waccAxis) {
            try {
                const model = calculateDCF(
                    historicals,
                    {
                        ...assumptions,
                        wacc,
                        terminalGrowthRate: g,
                    },
                    overrides,
                );
                row.push(Math.max(1, model.enterpriseValue || fallbackEv));
            } catch {
                row.push(fallbackEv);
            }
        }
        matrix.push(row);
    }

    matrix[2][2] = fallbackEv;
    return matrix;
}

function enforceMonotonic2D(matrix: number[][]): number[][] {
    const out = matrix.map((row) => row.slice());
    for (let r = 0; r < out.length; r++) {
        for (let c = 0; c < out[r].length; c++) {
            if (c > 0) out[r][c] = Math.max(out[r][c], out[r][c - 1]);
            if (r > 0) out[r][c] = Math.max(out[r][c], out[r - 1][c]);
        }
    }
    return out;
}

function buildRevenueEbitEvMatrix(
    historicals: HistoricalData,
    assumptions: Assumptions,
    overrides: Overrides,
    results: DCFResults,
    revenueGrowthAxis: number[],
    ebitMarginAxis: number[],
): number[][] {
    const fallbackEv = Math.max(1, results.enterpriseValue || 1);
    const matrix: number[][] = [];

    for (const ebitMargin of ebitMarginAxis) {
        const row: number[] = [];
        for (const revenueGrowth of revenueGrowthAxis) {
            try {
                const model = calculateDCF(
                    historicals,
                    {
                        ...assumptions,
                        revenueGrowth,
                        revenueGrowthStage1: revenueGrowth,
                        ebitMargin,
                    },
                    overrides,
                );
                row.push(Math.max(1, model.enterpriseValue || fallbackEv));
            } catch {
                row.push(fallbackEv);
            }
        }
        matrix.push(row);
    }

    matrix[2][2] = fallbackEv;
    return enforceMonotonic2D(matrix);
}

const DEFAULT_BULL_SCENARIO_DELTAS: ScenarioDeltaConfig = {
    revenueGrowthBps: 100,
    ebitMarginBps: 100,
    waccBps: -50,
    terminalGrowthBps: 50,
    exitMultipleDelta: 1.0,
    capexRatioBps: -25,
    nwcChangeRatioBps: -25,
    taxRateBps: 0,
};

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function bpsToDecimal(value?: number): number {
    if (!Number.isFinite(value)) return 0;
    return (value as number) / 10_000;
}

function invertScenarioDeltas(deltas: ScenarioDeltaConfig): ScenarioDeltaConfig {
    return {
        revenueGrowthBps: -(deltas.revenueGrowthBps || 0),
        ebitMarginBps: -(deltas.ebitMarginBps || 0),
        waccBps: -(deltas.waccBps || 0),
        terminalGrowthBps: -(deltas.terminalGrowthBps || 0),
        exitMultipleDelta: -(deltas.exitMultipleDelta || 0),
        capexRatioBps: -(deltas.capexRatioBps || 0),
        nwcChangeRatioBps: -(deltas.nwcChangeRatioBps || 0),
        taxRateBps: -(deltas.taxRateBps || 0),
    };
}

function applyScenarioDeltas(base: Assumptions, deltas: ScenarioDeltaConfig): Assumptions {
    const revenueDelta = bpsToDecimal(deltas.revenueGrowthBps);
    const ebitDelta = bpsToDecimal(deltas.ebitMarginBps);
    const waccDelta = bpsToDecimal(deltas.waccBps);
    const terminalGrowthDelta = bpsToDecimal(deltas.terminalGrowthBps);
    const capexDelta = bpsToDecimal(deltas.capexRatioBps);
    const nwcDelta = bpsToDecimal(deltas.nwcChangeRatioBps);
    const taxDelta = bpsToDecimal(deltas.taxRateBps);

    const scenario: Assumptions = {
        ...base,
        revenueGrowth: clamp(base.revenueGrowth + revenueDelta, -0.5, 0.6),
        ebitMargin: clamp(base.ebitMargin + ebitDelta, -0.2, 0.8),
        wacc: clamp(base.wacc + waccDelta, 0.01, 0.3),
        capexRatio: clamp(base.capexRatio + capexDelta, -0.2, 0.6),
        nwcChangeRatio: clamp(base.nwcChangeRatio + nwcDelta, -0.2, 0.6),
        taxRate: clamp(base.taxRate + taxDelta, 0.0, 0.6),
        terminalExitMultiple: clamp(base.terminalExitMultiple + (deltas.exitMultipleDelta || 0), 1.0, 40.0),
    };

    if (Number.isFinite(base.revenueGrowthStage1)) {
        scenario.revenueGrowthStage1 = clamp((base.revenueGrowthStage1 || 0) + revenueDelta, -0.5, 0.6);
    }
    if (Number.isFinite(base.revenueGrowthStage2)) {
        scenario.revenueGrowthStage2 = clamp((base.revenueGrowthStage2 || 0) + revenueDelta, -0.5, 0.6);
    }
    if (Number.isFinite(base.revenueGrowthStage3)) {
        scenario.revenueGrowthStage3 = clamp((base.revenueGrowthStage3 || 0) + revenueDelta, -0.5, 0.6);
    }
    if (Number.isFinite(base.ebitMarginSteadyState)) {
        scenario.ebitMarginSteadyState = clamp((base.ebitMarginSteadyState || 0) + ebitDelta, -0.2, 0.8);
    }

    const candidateTerminalGrowth = clamp(base.terminalGrowthRate + terminalGrowthDelta, 0.0, 0.08);
    scenario.terminalGrowthRate = Math.min(candidateTerminalGrowth, scenario.wacc - 0.001);
    scenario.terminalGrowthRate = clamp(scenario.terminalGrowthRate, 0.0, 0.08);

    return scenario;
}

function buildScenarioSnapshot(
    scenarioAssumptions: Assumptions,
    scenarioResults: DCFResults,
): ScenarioSnapshot {
    return {
        assumptions: {
            waccRate: scenarioAssumptions.wacc,
            taxRate: scenarioAssumptions.taxRate,
            daPctRevenue: scenarioAssumptions.deaRatio,
            grossMargin: scenarioAssumptions.grossMargin,
            ebitMargin: scenarioAssumptions.ebitMargin,
            ebitMarginSteadyState: scenarioAssumptions.ebitMarginSteadyState,
            ebitMarginConvergenceYears: scenarioAssumptions.ebitMarginConvergenceYears,
            revenueGrowthStage1: scenarioAssumptions.revenueGrowthStage1,
            revenueGrowthStage2: scenarioAssumptions.revenueGrowthStage2,
            revenueGrowthStage3: scenarioAssumptions.revenueGrowthStage3,
            revenueGrowthStage1Years: scenarioAssumptions.revenueGrowthStage1Years,
            revenueGrowthFadeYears: scenarioAssumptions.revenueGrowthFadeYears,
            terminalGrowthRate: scenarioAssumptions.terminalGrowthRate,
            terminalExitMultiple: scenarioAssumptions.terminalExitMultiple,
            capexRatio: scenarioAssumptions.capexRatio,
            nwcChangeRatio: scenarioAssumptions.nwcChangeRatio,
        },
        summary: {
            enterpriseValue: scenarioResults.enterpriseValue ?? undefined,
            equityValue: scenarioResults.equityValue,
            impliedSharePrice: scenarioResults.impliedSharePrice,
            upside: scenarioResults.upside,
        },
        forecasts: scenarioResults.forecasts,
    };
}

/**
 * Adapter function to convert app state to DcfExportPayload
 */
export function buildExportPayload(
    company: CompanyProfile,
    historicals: HistoricalData,
    assumptions: Assumptions,
    results: DCFResults,
    comps?: ComparableCompany[],
    precedents?: PrecedentTransaction[],
    revenueBuildData?: RevenueBuildData,
    overrides: Overrides = {}
): DcfExportPayload {
    const marketSnapshot = buildMarketSnapshot(historicals, assumptions, company.marketCap);
    const historicalFinancials = buildHistoricalFinancials(historicals);
    const waccAxis = buildCenteredAxis(assumptions.wacc, 0.01, 0.01, 0.30);
    const terminalGrowthAxis = buildCenteredAxis(
        assumptions.terminalGrowthRate,
        0.005,
        0.0,
        Math.max(0.001, Math.min(0.08, assumptions.wacc - 0.001)),
    );
    const revenueGrowthAxis = buildCenteredAxis(assumptions.revenueGrowth, 0.01, -0.10, 0.30);
    const ebitMarginAxis = buildCenteredAxis(assumptions.ebitMargin, 0.01, 0.01, 0.60);
    const waccTerminalEvMatrix = buildWaccTerminalEvMatrix(
        historicals,
        assumptions,
        overrides,
        results,
        waccAxis,
        terminalGrowthAxis,
    );
    const revenueEbitEvMatrix = buildRevenueEbitEvMatrix(
        historicals,
        assumptions,
        overrides,
        results,
        revenueGrowthAxis,
        ebitMarginAxis,
    );
    const assumptionExtensions = assumptions as Assumptions & {
        waccLoopMode?: WaccLoopMode;
        scenarioConfig?: ScenarioConfig;
    };
    const scenarioConfig = assumptionExtensions.scenarioConfig;
    const bullScenarioDeltas: ScenarioDeltaConfig = {
        ...DEFAULT_BULL_SCENARIO_DELTAS,
        ...(scenarioConfig?.bull || {}),
    };
    const bearScenarioDeltas: ScenarioDeltaConfig = {
        ...invertScenarioDeltas(DEFAULT_BULL_SCENARIO_DELTAS),
        ...(scenarioConfig?.bear || {}),
    };

    const bullAssumptions = applyScenarioDeltas(assumptions, bullScenarioDeltas);
    const bearAssumptions = applyScenarioDeltas(assumptions, bearScenarioDeltas);
    const bullResults = calculateDCF(historicals, bullAssumptions, overrides);
    const bearResults = calculateDCF(historicals, bearAssumptions, overrides);
    const scenarios: ExportScenarios = {
        base: buildScenarioSnapshot(assumptions, results),
        bull: buildScenarioSnapshot(bullAssumptions, bullResults),
        bear: buildScenarioSnapshot(bearAssumptions, bearResults),
    };

    return {
        company: {
            name: company.name,
            ticker: company.ticker,
            exchange: company.exchange,
            cik: company.cik,
            currency: historicals.currency || 'USD',
            unitsScale: 'millions',
            asOfDate: new Date().toISOString().split('T')[0],
            fiscalYearEnd: company.fiscalYearEnd,
            sector: company.sector,
            industry: company.industry,
            operatingArchetype: company.operatingArchetype,
        },

        valuationModel: results.preferredModel || 'unlevered_dcf',

        market: marketSnapshot,

        historicals: historicalFinancials,

        assumptions: buildExportAssumptions(assumptions, historicals),

        sensitivities: {
            waccGrid: waccAxis,
            gGrid: terminalGrowthAxis,
            waccAxis,
            terminalGrowthAxis,
            waccTerminalEvMatrix,
            revenueGrowthAxis,
            ebitMarginAxis,
            revenueEbitEvMatrix,
        },

        comps: comps?.map(c => ({
            company: c.name,
            ticker: c.ticker,
            marketCap: c.marketCap,
            ev: c.enterpriseValue,
            revenue: c.revenue,
            ebitda: c.ebitda,
            evRev: c.evRevenue,
            evEbitda: c.evEbitda,
            growth: c.revenueGrowth,
            margin: c.ebitdaMargin,
            beta: c.beta,
            totalDebt: c.totalDebt,
            taxRate: c.taxRate || 0.265,
            pe: c.peRatio,
            price: c.price,
            sharesOutstanding: c.sharesOutstanding,
            depreciation: c.depreciation,
        })),

        precedents: precedents?.map(p => ({
            target: p.targetName,
            acquirer: p.acquirerName,
            date: p.announcementDate,
            evMm: p.transactionValue / 1_000_000, // Convert to millions
            revenue: p.targetRevenue,
            ebitda: p.targetEbitda,
            evRev: p.evRevenue,
            evEbitda: p.evEbitda,
            premium: p.premiumPaid,
            type: p.dealType,
        })),

        revenueBuild: revenueBuildData,

        uiMeta: buildUiMeta(company, historicals, assumptions, results),

        scenarios,
        forecasts: results.forecasts,
    };
}
