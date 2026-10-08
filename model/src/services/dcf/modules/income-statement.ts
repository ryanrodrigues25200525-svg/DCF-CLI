
import { Assumptions } from '@/core/types';

export interface IncomeStatementResult {
    revenue: number;
    growthRate: number;
    grossProfit: number;
    grossMargin: number;
    costOfRevenue: number;
    ebit: number;
    ebitMargin: number;
    rdExpense: number;
    sgaExpense: number;
}

/**
 * Projects the income statement based on assumptions and historical trends.
 */
export function projectIncomeStatement(
    index: number,
    previousRevenue: number,
    previousGrossMargin: number,
    assumptions: Assumptions,
    ov: {
        revenueGrowth?: number;
        revenue?: number;
        grossMargin?: number;
        ebitMargin?: number;
    }
): IncomeStatementResult {
    // 1. Revenue Growth with Stage Logic
    let growthRate = assumptions.revenueGrowth;
    if (assumptions.advancedMode) {
        const stage1Years = Math.max(1, Math.floor(assumptions.revenueGrowthStage1Years ?? 3));
        const growthFadeYears = Math.max(1, Math.floor(assumptions.revenueGrowthFadeYears ?? 4));
        const stage2EndYear = stage1Years + growthFadeYears;
        if (index <= stage1Years) {
            growthRate = assumptions.revenueGrowthStage1;
        } else if (index <= stage2EndYear) {
            const fadeProgress = (index - stage1Years) / growthFadeYears;
            growthRate = assumptions.revenueGrowthStage1 -
                (assumptions.revenueGrowthStage1 - assumptions.revenueGrowthStage2) * fadeProgress;
        } else {
            const fadeProgress = Math.min(1, (index - stage2EndYear) / 3);
            growthRate = assumptions.revenueGrowthStage2 -
                (assumptions.revenueGrowthStage2 - assumptions.revenueGrowthStage3) * fadeProgress;
        }
    }
    if (ov.revenueGrowth !== undefined) growthRate = ov.revenueGrowth;

    const revenue = ov.revenue || (previousRevenue * (1 + growthRate));

    // 2. Gross Profit & Margins
    // A filer that presents no gross-profit line yields NaN, which exports as a
    // blank cell rather than a fabricated default. EBIT below is forecast from
    // ebitMargin independently, so the valuation is unaffected.
    let grossMargin = ov.grossMargin ?? assumptions.grossMargin;
    if (assumptions.advancedMode && index > 3 && Number.isFinite(previousGrossMargin) && Number.isFinite(grossMargin)) {
        const convergenceProgress = Math.min(1, (index - 3) / 5);
        grossMargin = previousGrossMargin + (grossMargin - previousGrossMargin) * convergenceProgress;
    }
    const hasGrossMargin = Number.isFinite(grossMargin);
    const grossProfit = hasGrossMargin ? revenue * grossMargin : NaN;
    const costOfRevenue = hasGrossMargin ? revenue - grossProfit : NaN;

    // 3. OpEx
    const rdExpense = revenue * (assumptions.rdMargin || 0);
    const sgaExpense = revenue * (assumptions.sgaMargin || 0.15);

    // 4. EBIT
    const baseEbitMargin = Number.isFinite(assumptions.ebitMargin) ? assumptions.ebitMargin : 0;
    const steadyStateEbitMargin =
        Number.isFinite(assumptions.ebitMarginSteadyState) && assumptions.ebitMarginSteadyState > 0
            ? assumptions.ebitMarginSteadyState
            : baseEbitMargin;
    let ebitMargin = ov.ebitMargin ?? baseEbitMargin;
    if (assumptions.advancedMode) {
        const convergenceYears = Math.max(1, Math.floor(assumptions.ebitMarginConvergenceYears || 5));
        const convergenceProgress = Math.min(index / convergenceYears, 1);
        ebitMargin = baseEbitMargin + (steadyStateEbitMargin - baseEbitMargin) * convergenceProgress;
    }

    const ebit = revenue * ebitMargin;

    return {
        revenue,
        growthRate,
        grossProfit,
        grossMargin,
        costOfRevenue,
        ebit,
        ebitMargin,
        rdExpense,
        sgaExpense
    };
}
