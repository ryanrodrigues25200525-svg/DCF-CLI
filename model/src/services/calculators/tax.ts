/**
 * Tax & NOPAT Calculator - Shared Domain Logic
 * Handles Net Operating Loss (NOL) and Cash Taxes
 */

export interface TaxParams {
    preTaxIncome: number;
    statutoryTaxRate: number;
    openingNolBalance?: number;
}

export interface TaxResult {
    taxExpense: number;
    effectiveTaxRate: number;
    closingNolBalance: number;
    taxShieldUsed: number;
}

/**
 * Calculate tax expense considering NOL carryforwards
 */
export function calculateTaxExpense(params: TaxParams): TaxResult {
    const { preTaxIncome, statutoryTaxRate, openingNolBalance = 0 } = params;

    if (preTaxIncome <= 0) {
        // No tax on losses, losses added to NOL balance
        return {
            taxExpense: 0,
            effectiveTaxRate: 0,
            closingNolBalance: openingNolBalance + Math.abs(preTaxIncome),
            taxShieldUsed: 0
        };
    }

    // Taxable income before NOL
    let taxableIncome = preTaxIncome;
    let taxShieldUsed = 0;

    if (openingNolBalance > 0) {
        // Use NOL to offset taxable income
        taxShieldUsed = Math.min(taxableIncome, openingNolBalance);
        taxableIncome -= taxShieldUsed;
    }

    const taxExpense = taxableIncome * statutoryTaxRate;
    const effectiveTaxRate = preTaxIncome > 0 ? taxExpense / preTaxIncome : 0;

    return {
        taxExpense,
        effectiveTaxRate,
        closingNolBalance: openingNolBalance - taxShieldUsed,
        taxShieldUsed
    };
}

/**
 * Calculate Net Operating Profit After Tax (NOPAT)
 */
export function calculateNOPAT(ebit: number, taxRate: number): number {
    // Standard valuation formula: EBIT * (1 - t)
    // Note: In reality, cash taxes may differ, but for DCF NOPAT usually uses marginal rate
    return ebit * (1 - taxRate);
}
