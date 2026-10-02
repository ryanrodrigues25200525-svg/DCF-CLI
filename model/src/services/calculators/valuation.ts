/**
 * Calculates Terminal Value using Gordon Growth Method (Perpetuity)
 */
export function calculateGordonGrowth(
    lastCashFlow: number,
    wacc: number,
    terminalGrowthRate: number
): number {
    // Safety: WACC must be greater than growth rate
    const denominator = Math.max(0.01, wacc - terminalGrowthRate);
    return (lastCashFlow * (1 + terminalGrowthRate)) / denominator;
}

/**
 * Calculates Terminal Value using Exit Multiple Method
 */
export function calculateExitMultiple(
    lastMetric: number,
    multiple: number
): number {
    return lastMetric * multiple;
}

/**
 * Common valuation result interface
 */
export interface ValuationBridge {
    enterpriseValue: number;
    cash: number;
    debt: number;
    minorityInterest: number;
    preferredStock: number;
    equityValue: number;
    sharesOutstanding: number;
    impliedPricePerShare: number;
}

/**
 * Bridges Enterprise Value to Equity Value and Price Per Share
 */
export function bridgeEnterpriseToEquity(
    enterpriseValue: number,
    cash: number,
    debt: number,
    shares: number,
    options: {
        minorityInterest?: number;
        preferredStock?: number;
    } = {}
): ValuationBridge {
    const minorityInterest = options.minorityInterest || 0;
    const preferredStock = options.preferredStock || 0;

    const equityValue = enterpriseValue + cash - debt - minorityInterest - preferredStock;
    const impliedPricePerShare = shares > 0 ? equityValue / shares : 0;

    return {
        enterpriseValue,
        cash,
        debt,
        minorityInterest,
        preferredStock,
        equityValue,
        sharesOutstanding: shares,
        impliedPricePerShare
    };
}
