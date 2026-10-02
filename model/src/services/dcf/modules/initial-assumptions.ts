
import { HistoricalData, Assumptions } from '@/core/types';
import { safeDiv, safeGet } from '@/core/utils/math';
import { calculateWACC } from '@/services/calculators/wacc';

export interface WACCOptions {
    riskFreeRate?: number;
    equityRiskPremium?: number;
    costOfDebt?: number;
}

export interface PeerMetrics {
    medianEvEbitda?: number;
    medianEvRevenue?: number;
}

/**
 * Calculates initial assumptions based on historical data.
 */
export function calculateInitialAssumptions(
    data: HistoricalData,
    waccOptions?: WACCOptions,
    peerMetrics?: PeerMetrics
): Assumptions {
    if (!data || !data.revenue || data.revenue.length === 0) {
        return {
            forecastYears: 5, revenueGrowth: 0.05, ebitMargin: 0.15, grossMargin: 0.40, taxRate: 0.21,
            deaRatio: 0.03, capexRatio: 0.03, nwcChangeRatio: 0.01,
            accountsReceivableDays: 45, inventoryDays: 60, accountsPayableDays: 45,
            wacc: 0.10, terminalGrowthRate: 0.025, terminalExitMultiple: 12.0, valuationMethod: 'growth',
            rdMargin: 0, sgaMargin: 0.15,
            advancedMode: false, revenueGrowthStage1: 0.05, revenueGrowthStage2: 0.03, revenueGrowthStage3: 0.03,
            ebitMarginSteadyState: 0.15, ebitMarginConvergenceYears: 5,
            startingInvestedCapital: 0, leverageTarget: 0.20,
            riskFreeRate: waccOptions?.riskFreeRate ?? 0.042, equityRiskPremium: waccOptions?.equityRiskPremium ?? 0.045,
            beta: 1.0, costOfDebt: 0.055, costOfEquity: 0.087, weightDebt: 0, weightEquity: 1
        };
    }

    const len = data.revenue.length;
    const lastRevValue = data.revenue[len - 1];
    const lastRev = lastRevValue ?? 0;
    const lastEbit = safeGet(data.ebit, data.ebit.length - 1);
    const computedEbitMargin = safeDiv(lastEbit, lastRev, 0.12);

    // Growth Cap Logic
    const getGrowthCap = (revenue: number): number => {
        if (revenue > 50000) return 0.30;
        if (revenue > 10000) return 0.35;
        if (revenue > 1000) return 0.40;
        if (revenue > 100) return 0.50;
        return 0.60;
    };

    const growthCap = getGrowthCap(lastRev);
    const growthFloor = -0.50;
    let revenueGrowth = 0.05;

    if (len > 1) {
        const firstPositiveIndex = data.revenue.findIndex((value) => value !== null && value > 0);
        const yearsOfGrowth = len - 1 - firstPositiveIndex;
        const firstPositiveRevenue = firstPositiveIndex >= 0 ? data.revenue[firstPositiveIndex] : null;
        if (yearsOfGrowth > 0 && firstPositiveRevenue !== null && firstPositiveRevenue > 0 && lastRev > 0) {
            const rawCAGR = Math.pow(lastRev / firstPositiveRevenue, 1 / yearsOfGrowth) - 1;
            revenueGrowth = Math.min(Math.max(rawCAGR, growthFloor), growthCap);
        }
    }

    const equityValue = (data.price ?? 0) * (data.sharesOutstanding ?? 0);
    const lastDebt = safeGet(data.totalDebt, data.totalDebt.length - 1);
    const lastNetIncome = safeGet(data.netIncome, data.netIncome.length - 1, 0);
    const lastDividends = safeGet(data.dividendsPaid || [], (data.dividendsPaid?.length || 0) - 1, 0);
    const payoutRatio = lastNetIncome > 0 ? Math.min(1, Math.max(0, safeDiv(lastDividends, lastNetIncome, 0.3))) : 0.3;
    const sharesOutstanding = data.sharesOutstanding ?? 0;
    const dividendPerShare = sharesOutstanding > 0 ? safeDiv(lastDividends, sharesOutstanding, 0.0) : 0.0;

    const waccResult = calculateWACC({
        riskFreeRate: waccOptions?.riskFreeRate ?? 0.040,
        equityRiskPremium: waccOptions?.equityRiskPremium ?? 0.042,
        beta: (data.beta ?? 1.0),
        costOfDebt: waccOptions?.costOfDebt,
        icr: lastEbit / (safeGet(data.interestExpense, data.interestExpense.length - 1, 1) || 1),
        equityValue,
        totalDebt: lastDebt,
        taxRate: 0.21
    });

    return {
        forecastYears: 5,
        revenueGrowth: Number(revenueGrowth.toFixed(4)),
        ebitMargin: Number(computedEbitMargin.toFixed(4)),
        grossMargin: safeDiv(safeGet(data.grossProfit, data.grossProfit.length - 1), lastRev, 0.4),
        rdMargin: safeDiv(safeGet(data.researchAndDevelopment || [], (data.researchAndDevelopment?.length || 0) - 1), lastRev, 0),
        sgaMargin: safeDiv(safeGet(data.generalAndAdministrative || [], (data.generalAndAdministrative?.length || 0) - 1), lastRev, 0.15),
        taxRate: 0.21,
        // Estimate D&A ratio from CapEx if depreciation is missing (common for tech companies)
        deaRatio: safeDiv(safeGet(data.depreciation, data.depreciation.length - 1), lastRev,
            Math.max(0.02, safeDiv(safeGet(data.capex, data.capex.length - 1) * 0.7, lastRev, 0.03))),
        capexRatio: safeDiv(safeGet(data.capex, data.capex.length - 1), lastRev, 0.03),
        nwcChangeRatio: 0.01,
        accountsReceivableDays: Math.round(safeDiv(safeGet(data.accountsReceivable, data.accountsReceivable.length - 1), lastRev) * 365) || 45,
        inventoryDays: Math.round(safeDiv(safeGet(data.inventory, data.inventory.length - 1), safeGet(data.costOfRevenue, data.costOfRevenue.length - 1, lastRev * 0.6)) * 365) || 60,
        accountsPayableDays: Math.round(safeDiv(safeGet(data.accountsPayable, data.accountsPayable.length - 1), safeGet(data.costOfRevenue, data.costOfRevenue.length - 1, lastRev * 0.6)) * 365) || 45,
        wacc: Number(waccResult.wacc.toFixed(4)),
        terminalGrowthRate: 0.025,
        terminalExitMultiple: peerMetrics?.medianEvEbitda || 12.0,
        valuationMethod: 'growth',
        advancedMode: computedEbitMargin < 0.05,
        revenueGrowthStage1: Number(revenueGrowth.toFixed(4)),
        revenueGrowthStage2: Number((revenueGrowth * 0.6).toFixed(4)),
        revenueGrowthStage3: 0.03,
        ebitMarginSteadyState: Number(computedEbitMargin.toFixed(4)),
        ebitMarginConvergenceYears: 5,
        startingInvestedCapital: (equityValue + lastDebt) > 0 ? (equityValue + lastDebt) : (lastRev * 0.8),
        leverageTarget: waccResult.debtWeight,
        riskFreeRate: waccOptions?.riskFreeRate ?? 0.040,
        equityRiskPremium: waccOptions?.equityRiskPremium ?? 0.042,
        beta: waccResult.leveredBeta,
        unleveredBeta: waccResult.unleveredBeta,
        costOfDebt: waccResult.costOfDebt,
        costOfEquity: waccResult.costOfEquity,
        weightEquity: waccResult.equityWeight,
        currentDebt: lastDebt,
        annualDebtRepayment: lastDebt * 0.05,
        modelType: 'unlevered',
        dilutedSharesOutstanding: data.sharesOutstanding || 0,
        currentDividendPerShare: Number(dividendPerShare.toFixed(4)),
        dividendPayoutRatio: Number(payoutRatio.toFixed(4)),
        dividendGrowthRateStage1: Math.max(-0.2, Math.min(0.2, Number(revenueGrowth.toFixed(4)))),
        dividendGrowthRateStage2: 0.03,
        stage1Duration: 5,
        stage2Duration: 5
    };
}
