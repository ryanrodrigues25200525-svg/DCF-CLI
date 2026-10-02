
import {
    HistoricalData, Assumptions, DCFResults, ForecastYear
} from '@/core/types';
import { calculateGordonGrowth, calculateExitMultiple } from '@/services/calculators/valuation';

function getSafeCurrentPrice(price: number | null | undefined): number {
    const value = price ?? 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function resolveShareCount(historicals: HistoricalData, assumptions: Assumptions): number {
    const dilutedShares = assumptions?.dilutedSharesOutstanding ?? 0;
    if (Number.isFinite(dilutedShares) && dilutedShares > 0) {
        return dilutedShares;
    }
    const historicalShares = historicals?.sharesOutstanding ?? 0;
    if (Number.isFinite(historicalShares) && historicalShares > 0) {
        return historicalShares;
    }
    return 0;
}

/**
 * Calculates the final DCF aggregate metrics, terminal value, and enterprise value.
 */
export function calculateTerminalValuation(
    forecasts: ForecastYear[],
    historicals: HistoricalData,
    assumptions: Assumptions,
    totalHorizon: number
): DCFResults {
    const avgROIC = forecasts.reduce((sum, f) => sum + f.roic, 0) / forecasts.length;
    const modelType = assumptions.modelType || 'unlevered';

    // Recalculate rates
    const costOfEquity =
        (assumptions.riskFreeRate || 0.046) +
        (assumptions.beta || 1.0) * (assumptions.equityRiskPremium || 0.052);

    const safeWACC = Math.max(assumptions.wacc, 0.001);
    const discountRate = modelType === 'unlevered' ? safeWACC : costOfEquity;

    const lastF = forecasts[forecasts.length - 1];
    const tvDiscountFactor = 1 / Math.pow(1 + discountRate, totalHorizon);

    // Terminal Growth Logic
    let terminalGrowthWarning: string | undefined;
    let effectiveTerminalGrowth = assumptions.terminalGrowthRate;

    if (assumptions.valuationMethod === 'growth') {
        const rateCap = discountRate;
        if (assumptions.terminalGrowthRate >= rateCap) {
            terminalGrowthWarning = `Terminal growth (${(assumptions.terminalGrowthRate * 100).toFixed(1)}%) must be less than Discount Rate. Capped at Rate - 0.5%.`;
            effectiveTerminalGrowth = Math.max(0, rateCap - 0.005);
        }
    }

    const terminalMetric = modelType === 'unlevered' ? lastF.fcff :
        modelType === 'levered' ? lastF.fcfe :
            lastF.dividends;

    // Gordon helper already applies (1 + g), so pass the terminal-year metric directly.
    const terminalValueGordon = calculateGordonGrowth(terminalMetric, discountRate, effectiveTerminalGrowth);

    let terminalValueExitMultiple = calculateExitMultiple(
        lastF.ebitda > 0 ? lastF.ebitda : lastF.revenue * 0.2,
        assumptions.terminalExitMultiple
    );

    if (modelType === 'ddm' || modelType === 'levered') {
        terminalValueExitMultiple = lastF.netIncome * (assumptions.terminalExitMultiple || 15.0);
    }

    const terminalValue = assumptions.valuationMethod === 'growth' ? terminalValueGordon : terminalValueExitMultiple;
    const pvTerminalValue = terminalValue * tvDiscountFactor;
    const sumPvFcff = forecasts.reduce((sum, f) => sum + f.pvFcff, 0);

    let enterpriseValue = sumPvFcff + pvTerminalValue;

    // Adjustments for Equity Value
    // We use LATEST ACTUAL historical cash/debt for the "Intrinsic Value" bridge
    const lastHistIdx = historicals.years.length - 1;
    const currentCash = historicals.cash[lastHistIdx] || 0;
    const currentDebt = historicals.totalDebt[lastHistIdx] || 0;
    const currentMarketableSecurities = historicals.marketableSecurities?.[lastHistIdx] || 0;
    const currentMinorityInterest = historicals.nonControllingInterest?.[lastHistIdx] || 0;
    const currentPreferredEquity = historicals.preferredEquity?.[lastHistIdx] || 0;

    let equityValue: number;
    if (modelType === 'unlevered') {
        equityValue = enterpriseValue + currentCash + currentMarketableSecurities
            - currentDebt - currentMinorityInterest - currentPreferredEquity;
    } else {
        // For Levered/DDM, the sum of PV is already Equity Value
        equityValue = sumPvFcff + (terminalValue * tvDiscountFactor);
        enterpriseValue = equityValue + currentDebt - currentCash;
    }

    const shares = resolveShareCount(historicals, assumptions);
    const impliedSharePrice = Math.max(0, equityValue / Math.max(shares, 1));
    const currentPrice = getSafeCurrentPrice(historicals.price);
    const upside = currentPrice > 0 ? (impliedSharePrice - currentPrice) / currentPrice : 0;

    return {
        forecasts,
        terminalValue,
        pvTerminalValue,
        enterpriseValue,
        equityValue,
        impliedSharePrice,
        shareCount: shares,
        currentPrice,
        upside,
        terminalValueGordon,
        terminalValueExitMultiple,
        tvDivergenceFlag: Math.abs(terminalValueGordon / terminalValueExitMultiple - 1) > 0.4,
        avgROIC,
        valueCreationFlag: avgROIC > assumptions.wacc,
        confidenceScore: 0.8, // Simplified
        confidenceRank: 'High',
        terminalGrowthWarning,
    };
}
