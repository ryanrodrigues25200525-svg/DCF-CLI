
import { Assumptions } from '@/core/types';
import { calculateTaxExpense } from '@/services/calculators/tax';

export interface FinancingResult {
    netIncome: number;
    interestExpense: number;
    taxExpense: number;
    preTaxIncome: number;
    taxShieldUsed: number;
    closingNolBalance: number;
    cfo: number;
    debtIssuance: number;
    debtRepayment: number;
    dividends: number;
    shareBuybacks: number;
    finalCash: number;
    totalDebt: number;
    currentDebt: number;
    longTermDebt: number;
    retainedEarnings: number;
    cumulativeBuybacks: number;
    cumulativeSbc: number;
    totalEquity: number;
    totalCurrentLiabilities: number;
    totalLiabilities: number;
}

export interface FinancingParams {
    ebit: number;
    depreciation: number;
    stockBasedComp: number;
    nwcChange: number;
    cfi: number;
    beginningDebt: number;
    beginningCash: number;
    beginningRetainedEarnings: number;
    beginningCumulativeBuybacks: number;
    beginningCumulativeSbc: number;
    paidInCapital: number;
    nolBalance: number;
    otherAssets: number;
    otherLiabilities: number;
    otherCurrentAssets: number;
    otherCurrentLiabilities: number;
    deferredRevenue: number;
    yearIndex: number;
    previousDividend: number;
    assumptions: Assumptions;
}

/**
 * Handles the financing logic, interest circularity, and iterative balancing.
 */
export function calculateFinancing(params: FinancingParams): FinancingResult {
    const {
        ebit, depreciation, stockBasedComp, nwcChange, cfi,
        beginningDebt, beginningCash, beginningRetainedEarnings,
        beginningCumulativeBuybacks, beginningCumulativeSbc,
        paidInCapital, nolBalance,
        yearIndex, previousDividend,
        // Note: otherAssets, otherLiabilities, otherCurrentAssets, otherCurrentLiabilities, deferredRevenue
        // are available in params for future use in liability calculations
        assumptions
    } = params;

    const targetPayoutRatio = assumptions.dividendPayoutRatio ?? 0.30;
    const minCashBalance = (ebit / 0.15) * 0.02; // Approximation if revenue not passed
    const maxCashBalance = (ebit / 0.15) * 0.15;
    const modelType = assumptions.modelType || 'unlevered';
    const leverageTarget = Math.max(0, Math.min(1, assumptions.leverageTarget ?? 0.2));

    let loopNetIncome = ebit * (1 - assumptions.taxRate);
    let loopInterest = beginningDebt * (assumptions.costOfDebt || 0.05);
    let loopDebt = beginningDebt;
    let loopCash = 0;

    let debtIssuance = 0;
    let debtRepayment = 0;
    let dividends = 0;
    let shareBuybacks = 0;
    let finalTaxExpense = 0;
    let finalTaxShieldUsed = 0;
    let finalClosingNol = nolBalance;

    // Iterative Balancing Loop
    for (let j = 0; j < 3; j++) {
        debtIssuance = 0;
        debtRepayment = 0;
        dividends = 0;
        shareBuybacks = 0;

        const loopPreTaxIncome = ebit - loopInterest;
        const taxResult = calculateTaxExpense({
            preTaxIncome: loopPreTaxIncome,
            statutoryTaxRate: assumptions.taxRate,
            openingNolBalance: nolBalance
        });

        loopNetIncome = loopPreTaxIncome - taxResult.taxExpense;
        finalTaxExpense = taxResult.taxExpense;
        finalTaxShieldUsed = taxResult.taxShieldUsed;
        finalClosingNol = taxResult.closingNolBalance;

        const cfo = loopNetIncome + depreciation + stockBasedComp - nwcChange;
        loopCash = beginningCash + cfo + cfi;
        loopDebt = beginningDebt;

        // Optional scheduled amortization for levered-style debt paths.
        if ((assumptions.annualDebtRepayment || 0) > 0 && loopDebt > 0) {
            const scheduledRepayment = Math.min(assumptions.annualDebtRepayment || 0, loopDebt, Math.max(0, loopCash - minCashBalance));
            if (scheduledRepayment > 0) {
                debtRepayment += scheduledRepayment;
                loopDebt -= scheduledRepayment;
                loopCash -= scheduledRepayment;
            }
        }

        // Debt Policy
        if (loopCash < minCashBalance) {
            const shortfall = minCashBalance - loopCash;
            debtIssuance = shortfall;
            loopDebt += shortfall;
            loopCash += shortfall;
        } else if (loopCash > maxCashBalance && loopDebt > 0) {
            const excess = loopCash - maxCashBalance;
            const repayment = Math.min(excess, loopDebt);
            debtRepayment = repayment;
            loopDebt -= repayment;
            loopCash -= repayment;
        }

        // Re-center toward target leverage so debt doesn't mechanically drift to zero.
        const equityProxy = Math.max(1, paidInCapital + beginningRetainedEarnings + Math.max(loopNetIncome, 0));
        const targetDebt = leverageTarget * (equityProxy + beginningDebt);
        const leverageAdjustment = (targetDebt - loopDebt) * 0.35;
        if (leverageAdjustment > 0) {
            debtIssuance += leverageAdjustment;
            loopDebt += leverageAdjustment;
            loopCash += leverageAdjustment;
        } else if (leverageAdjustment < 0 && loopDebt > 0) {
            const repay = Math.min(-leverageAdjustment, loopDebt, Math.max(0, loopCash - minCashBalance));
            if (repay > 0) {
                debtRepayment += repay;
                loopDebt -= repay;
                loopCash -= repay;
            }
        }

        // Equity Policy
        if (modelType === 'ddm') {
            const shares = assumptions.dilutedSharesOutstanding || 0;
            if (yearIndex === 1 && (assumptions.currentDividendPerShare || 0) > 0 && shares > 0) {
                dividends = (assumptions.currentDividendPerShare || 0) * shares;
            } else if (previousDividend > 0) {
                const s1 = assumptions.stage1Duration || 5;
                const s2 = assumptions.stage2Duration || 5;
                const g1 = assumptions.dividendGrowthRateStage1 ?? 0.05;
                const g2 = assumptions.dividendGrowthRateStage2 ?? 0.03;
                const g3 = assumptions.terminalGrowthRate ?? 0.025;
                const growth = yearIndex <= s1 ? g1 : yearIndex <= s1 + s2 ? g2 : g3;
                dividends = previousDividend * (1 + growth);
            } else {
                dividends = loopNetIncome > 0 ? loopNetIncome * targetPayoutRatio : 0;
            }

            shareBuybacks = 0;
            loopCash -= dividends;

            if (loopCash < minCashBalance) {
                const shortfall = minCashBalance - loopCash;
                debtIssuance += shortfall;
                loopDebt += shortfall;
                loopCash += shortfall;
            }
        } else if (loopCash > maxCashBalance) {
            const excess = loopCash - maxCashBalance;
            dividends = loopNetIncome > 0 ? loopNetIncome * targetPayoutRatio : 0;
            shareBuybacks = Math.min(Math.max(0, excess - dividends), Math.max(0, loopNetIncome * 0.2));
            if (modelType === 'levered') {
                shareBuybacks = 0;
            }
            loopCash -= (dividends + shareBuybacks);
        }

        const refinedInterest = ((beginningDebt + loopDebt) / 2) * (assumptions.costOfDebt || 0.05);
        if (Math.abs(refinedInterest - loopInterest) < 0.01) break;
        loopInterest = refinedInterest;
    }

    const finalCfo = loopNetIncome + depreciation + stockBasedComp - nwcChange;
    const finalPreTaxIncome = ebit - loopInterest;

    return {
        netIncome: loopNetIncome,
        interestExpense: loopInterest,
        preTaxIncome: finalPreTaxIncome,
        taxExpense: finalTaxExpense,
        taxShieldUsed: finalTaxShieldUsed,
        closingNolBalance: finalClosingNol,
        cfo: finalCfo,
        debtIssuance,
        debtRepayment,
        dividends,
        shareBuybacks,
        finalCash: loopCash,
        totalDebt: loopDebt,
        currentDebt: loopDebt * 0.2,
        longTermDebt: loopDebt * 0.8,
        retainedEarnings: beginningRetainedEarnings + loopNetIncome - dividends,
        cumulativeBuybacks: beginningCumulativeBuybacks + shareBuybacks,
        cumulativeSbc: beginningCumulativeSbc + stockBasedComp,
        totalEquity: paidInCapital + (beginningRetainedEarnings + loopNetIncome - dividends) + (beginningCumulativeSbc + stockBasedComp) - (beginningCumulativeBuybacks + shareBuybacks),
        totalCurrentLiabilities: 0,
        totalLiabilities: 0
    };
}
