/**
 * WACC Calculator - Shared Domain Logic
 * Jan 2025 Market Standards
 */

export interface WaccParams {
    riskFreeRate: number;
    equityRiskPremium: number;
    beta?: number; // Levered Beta
    unleveredBeta?: number;
    costOfDebt?: number;
    icr?: number; // Interest Coverage Ratio for synthetic rating
    equityValue: number;
    totalDebt: number;
    taxRate: number;
}

export interface WaccResult {
    wacc: number;
    costOfEquity: number;
    costOfDebt: number;
    syntheticSpread: number;
    equityWeight: number;
    debtWeight: number;
    leveredBeta: number;
    unleveredBeta: number;
}

/**
 * Damodaran-style mapping for Large Cap (> $5B) spreads
 * Updated January 2025: Credit spreads tightened from 2022-2023 highs
 */
export const CREDIT_SPREADS = [
    { threshold: 8.5, spread: 0.0050, rating: 'AAA' },
    { threshold: 6.5, spread: 0.0060, rating: 'AA' },
    { threshold: 5.5, spread: 0.0070, rating: 'A+' },
    { threshold: 4.25, spread: 0.0085, rating: 'A' },
    { threshold: 3.0, spread: 0.0115, rating: 'A-' },
    { threshold: 2.5, spread: 0.0155, rating: 'BBB' },
    { threshold: 2.0, spread: 0.0200, rating: 'BB+' },
    { threshold: 1.75, spread: 0.0275, rating: 'BB' },
    { threshold: 1.5, spread: 0.0400, rating: 'B+' },
    { threshold: 1.25, spread: 0.0500, rating: 'B' },
    { threshold: 0.8, spread: 0.0750, rating: 'CCC' },
    { threshold: -Infinity, spread: 0.1100, rating: 'CC/D' }
];

/**
 * Calculate cost of debt based on synthetic credit rating
 */
export function calculateSyntheticSpread(icr: number): { spread: number; rating: string } {
    const match = CREDIT_SPREADS.find(s => icr > s.threshold) || CREDIT_SPREADS[CREDIT_SPREADS.length - 1];
    return { spread: match.spread, rating: match.rating };
}

/**
 * Unlever Beta: βu = βl / (1 + (1 - t) * (D/E))
 */
export function unleverBeta(leveredBeta: number, debt: number, equity: number, taxRate: number): number {
    if (equity <= 0) return leveredBeta;
    return leveredBeta / (1 + (1 - taxRate) * (debt / equity));
}

/**
 * Lever Beta: βl = βu * (1 + (1 - t) * (D/E))
 */
export function leverBeta(unleveredBeta: number, debt: number, equity: number, taxRate: number): number {
    if (equity <= 0) return unleveredBeta;
    return unleveredBeta * (1 + (1 - taxRate) * (debt / equity));
}

/**
 * Main WACC calculation logic
 */
export function calculateWACC(params: WaccParams): WaccResult {
    const {
        riskFreeRate,
        equityRiskPremium,
        beta,
        unleveredBeta: providedUnleveredBeta,
        costOfDebt: overrideCostOfDebt,
        icr,
        equityValue,
        totalDebt,
        taxRate
    } = params;

    // Validation Checks
    if (riskFreeRate < 0 || riskFreeRate > 0.15) {
        console.warn(`[WACC] Unusual risk-free rate: ${(riskFreeRate * 100).toFixed(2)}%`);
    }
    if (equityRiskPremium < 0.02 || equityRiskPremium > 0.10) {
        console.warn(`[WACC] Unusual ERP: ${(equityRiskPremium * 100).toFixed(2)}%`);
    }

    let finalLeveredBeta = beta ?? 1.0;
    let finalUnleveredBeta = providedUnleveredBeta ?? 0.8;

    if (finalLeveredBeta < 0 || finalLeveredBeta > 4.0) {
        console.warn(`[WACC] Unusual beta: ${finalLeveredBeta.toFixed(2)}`);
    }

    if (providedUnleveredBeta !== undefined) {
        finalLeveredBeta = leverBeta(providedUnleveredBeta, totalDebt, equityValue, taxRate);
    } else if (beta !== undefined) {
        finalUnleveredBeta = unleverBeta(beta, totalDebt, equityValue, taxRate);
    }

    const costOfEquity = riskFreeRate + finalLeveredBeta * equityRiskPremium;

    let syntheticSpread = 0.0115; // Default A-
    if (icr !== undefined) {
        syntheticSpread = calculateSyntheticSpread(icr).spread;
    }

    const costOfDebt = overrideCostOfDebt ?? (riskFreeRate + syntheticSpread);

    const totalCapital = equityValue + totalDebt;

    if (totalCapital <= 0) {
        return {
            wacc: 0.15, // Distressed fallback
            costOfEquity,
            costOfDebt,
            syntheticSpread,
            equityWeight: 0,
            debtWeight: 0,
            leveredBeta: finalLeveredBeta,
            unleveredBeta: finalUnleveredBeta
        };
    }

    const equityWeight = equityValue / totalCapital;
    const debtWeight = totalDebt / totalCapital;

    // Sanity check weights
    if (Math.abs((equityWeight + debtWeight) - 1.0) > 0.001) {
        console.warn(`[WACC] Weights do not sum to 1: ${(equityWeight + debtWeight).toFixed(4)}`);
    }

    const wacc = (equityWeight * costOfEquity) + (debtWeight * costOfDebt * (1 - taxRate));

    // Warn on unusual WACC
    if (wacc < 0.02 || wacc > 0.30) {
        console.warn(`[WACC] Unusual resulting WACC: ${(wacc * 100).toFixed(2)}%`);
    }

    return {
        wacc,
        costOfEquity,
        costOfDebt,
        syntheticSpread,
        equityWeight,
        debtWeight,
        leveredBeta: finalLeveredBeta,
        unleveredBeta: finalUnleveredBeta
    };
}
