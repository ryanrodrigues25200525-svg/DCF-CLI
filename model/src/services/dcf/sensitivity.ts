
import { Assumptions, HistoricalData, Overrides } from "@/core/types";
import { calculateDCF } from "./engine";

export interface SensitivityCell {
    wacc: number;
    growthRate: number;
    impliedSharePrice: number;
    percentageChange: number;
}

export interface SensitivityTable {
    rows: number[]; // Growth rates
    cols: number[]; // WACC values
    data: SensitivityCell[][]; // Matrix [row][col]
}

/**
 * Generates a sensitivity table for WACC vs. Terminal Growth Rate
 */
export function calculateSensitivityAnalysis(
    historicals: HistoricalData,
    baseAssumptions: Assumptions,
    overrides: Overrides,
    waccRange: number[] = [-0.01, -0.005, 0, 0.005, 0.01],
    growthRange: number[] = [-0.01, -0.005, 0, 0.005, 0.01]
): SensitivityTable {
    const baseWacc = baseAssumptions.wacc;
    const baseGrowth = baseAssumptions.terminalGrowthRate;

    // Generate steps
    const waccSteps = waccRange.map(delta => Number((baseWacc + delta).toFixed(4)));
    const growthSteps = growthRange.map(delta => Number((baseGrowth + delta).toFixed(4)));

    // Sort logic to ensure logical display (Low->High or High->Low)
    // Typically: Growth (rows) increasing top-down? Or Growth (rows) increasing?
    // WACC (cols) increasing left-right?

    // Let's standard: Growth increasing (rows), WACC increasing (cols)
    waccSteps.sort((a, b) => a - b);
    growthSteps.sort((a, b) => a - b);

    const matrix: SensitivityCell[][] = [];

    for (const g of growthSteps) {
        const row: SensitivityCell[] = [];
        for (const w of waccSteps) {
            // Create modified assumptions
            const modAssumptions = {
                ...baseAssumptions,
                wacc: w,
                terminalGrowthRate: g
            };

            // Recalculate DCF
            // Note: This reruns the entire projection. 
            // Efficiency: Could be optimized, but for 5x5 it's 25 runs, which is fast.
            const result = calculateDCF(historicals, modAssumptions, overrides);

            const basePrice = result.currentPrice || 1;

            row.push({
                wacc: w,
                growthRate: g,
                impliedSharePrice: result.impliedSharePrice,
                percentageChange: (result.impliedSharePrice - basePrice) / basePrice
            });
        }
        matrix.push(row);
    }

    return {
        rows: growthSteps,
        cols: waccSteps,
        data: matrix
    };
}
