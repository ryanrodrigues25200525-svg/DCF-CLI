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
