
import {
    HistoricalData, Assumptions, Overrides, DCFResults, ForecastYear
} from '@/core/types';
import { safeGet } from '@/core/utils/math';

// Import new modules
import { calculateInitialAssumptions as calcInitialAssumptions, WACCOptions, PeerMetrics } from './modules/initial-assumptions';
import { projectIncomeStatement } from './modules/income-statement';
import { projectWorkingCapital } from './modules/working-capital';
import { projectFixedAssets } from './modules/fixed-assets';
import { calculateFinancing } from './modules/financing';
import { calculateTerminalValuation } from './modules/terminal-valuation';

export type { WACCOptions, PeerMetrics };

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
 * Calculates initial assumptions based on historical data.
 */
export function calculateInitialAssumptions(
    data: HistoricalData,
    waccOptions?: WACCOptions,
    peerMetrics?: PeerMetrics
): Assumptions {
    return calcInitialAssumptions(data, waccOptions, peerMetrics);
}

/**
 * Coordinate the DCF calculation using modularized projection logic.
 */
export function calculateDCF(
    historicals: HistoricalData,
    assumptions: Assumptions,
    overrides: Overrides
): DCFResults {
    // 1. Safety and Fallback Logic
    const hasValidRevenue = historicals?.revenue?.some(r => r !== null && r > 0);
    const effectiveShares = resolveShareCount(historicals, assumptions);
    const hasValidShares = effectiveShares > 0;

    if (!historicals || !historicals.years || historicals.years.length === 0 || !hasValidRevenue || !hasValidShares) {
        return createFallbackResults(historicals);
    }

    // 2. Initialize Starting State
    const lastIdx = historicals.years.length - 1;
    const startYear = historicals.years[lastIdx];

    const initialDebt = assumptions.currentDebt ?? safeGet(historicals.totalDebt, lastIdx, 0);

    let state = {
        cash: safeGet(historicals.cash, lastIdx, 0),
        debt: initialDebt,
        nwc: (safeGet(historicals.accountsReceivable, lastIdx, 0) + safeGet(historicals.inventory, lastIdx, 0))
            - safeGet(historicals.accountsPayable, lastIdx, 0)
            + (assumptions.nwcChangeRatio ?? 0) * safeGet(historicals.revenue, lastIdx, 0),
        ppeNet: safeGet(historicals.ppeNet, lastIdx, 0),
        retainedEarnings: safeGet(historicals.retainedEarnings, lastIdx, 0),
        cumulativeBuybacks: 0,
        cumulativeSbc: 0,
        nolBalance: 0,
        prevRevenue: safeGet(historicals.revenue, lastIdx, 1000),
        prevGrossMargin: safeGet(historicals.grossProfit, lastIdx, 0) / safeGet(historicals.revenue, lastIdx, 1),
        prevInvestedCapital: (safeGet(historicals.ppeNet, lastIdx, 0) + ((safeGet(historicals.accountsReceivable, lastIdx, 0) + safeGet(historicals.inventory, lastIdx, 0)) - safeGet(historicals.accountsPayable, lastIdx, 0))) + safeGet(historicals.otherAssets, lastIdx, 0) - safeGet(historicals.otherLiabilities, lastIdx, 0)
    };

    // Get beginning equity directly from historicals to ensure balance sheet balances
    const beginningEquity = safeGet(historicals.shareholdersEquity, lastIdx, 0);
    const beginningRetainedEarnings = safeGet(historicals.retainedEarnings, lastIdx, 0);
    const paidInCapital = beginningEquity - beginningRetainedEarnings;
    const lastMarketableSecurities = safeGet(historicals.marketableSecurities, lastIdx, 0);
    const marketableSecuritiesRatio = safeGet(historicals.revenue, lastIdx, 1) > 0
        ? Math.max(0, Math.min(0.6, lastMarketableSecurities / safeGet(historicals.revenue, lastIdx, 1)))
        : 0;

    const baseHorizon = assumptions.advancedMode ? Math.min(Math.max(assumptions.forecastYears, 5), 15) : assumptions.forecastYears;
    const dividendStageHorizon = (assumptions.stage1Duration || 0) + (assumptions.stage2Duration || 0);
    const horizon = assumptions.modelType === 'ddm'
        ? Math.max(baseHorizon, dividendStageHorizon)
        : baseHorizon;
    const currentYear = new Date().getFullYear();
    const stubYears = Math.max(0, currentYear - (startYear + 1));
    const totalHorizon = horizon + stubYears;

    const forecasts: ForecastYear[] = [];

    // 3. Projection Loop
    for (let i = 1; i <= totalHorizon; i++) {
        const year = startYear + i;
        const isStub = year < currentYear;
        const ov = overrides[year] || {};

        // Module 1: Income Statement
        const is = projectIncomeStatement(i, state.prevRevenue, state.prevGrossMargin, assumptions, ov);

        // Module 2: Fixed Assets
        const fa = projectFixedAssets(is.revenue, state.ppeNet, assumptions, ov);

        // Module 3: Working Capital
        const wc = projectWorkingCapital(is.revenue, is.costOfRevenue, assumptions, state.nwc);

        // SBC Logic (Shared for now)
        const sbcPct = safeGet(historicals.stockBasedComp, lastIdx, 0) / safeGet(historicals.revenue, lastIdx, 1);
        const sbc = is.revenue * (sbcPct || 0.02);

        // Module 4: Financing & Tax
        const finance = calculateFinancing({
            ebit: is.ebit,
            depreciation: fa.depreciation,
            stockBasedComp: sbc,
            nwcChange: wc.nwcChange,
            cfi: -fa.capex,
            beginningDebt: state.debt,
            beginningCash: state.cash,
            beginningRetainedEarnings: state.retainedEarnings,
            beginningCumulativeBuybacks: state.cumulativeBuybacks,
            beginningCumulativeSbc: state.cumulativeSbc,
            paidInCapital,
            nolBalance: state.nolBalance,
            otherAssets: safeGet(historicals.otherAssets, lastIdx, 0),
            otherLiabilities: safeGet(historicals.otherLiabilities, lastIdx, 0),
            otherCurrentAssets: safeGet(historicals.otherCurrentAssets, lastIdx, 0),
            otherCurrentLiabilities: safeGet(historicals.otherCurrentLiabilities, lastIdx, 0),
            deferredRevenue: safeGet(historicals.deferredRevenue, lastIdx, 0),
            yearIndex: i,
            previousDividend: i === 1 ? safeGet(historicals.dividendsPaid, lastIdx, 0) : (forecasts[i - 2]?.dividends || 0),
            assumptions
        });

        // Valuation discounting
        const modelType = assumptions.modelType || 'unlevered';
        const costOfEquity =
            (assumptions.riskFreeRate || 0.046) +
            (assumptions.beta || 1.0) * (assumptions.equityRiskPremium || 0.052);
        const discountRate = modelType === 'unlevered' ? Math.max(assumptions.wacc, 0.001) : Math.max(costOfEquity, 0.001);
        const fcfValuation = is.ebit * (1 - assumptions.taxRate) + fa.depreciation - fa.capex - wc.nwcChange;

        const metricToDiscount = modelType === 'unlevered' ? fcfValuation : (modelType === 'levered' ? finance.cfo - fa.capex + (finance.debtIssuance - finance.debtRepayment) : finance.dividends);
        const discountFactor = isStub ? 0 : 1 / Math.pow(1 + discountRate, i - 0.5 - stubYears);

        // === BALANCE SHEET CALCULATIONS ===
        // Calculate components first
        const cashComponent = finance.finalCash;
        const marketableSecuritiesComponent = is.revenue * marketableSecuritiesRatio;
        const accountsReceivableComponent = wc.accountsReceivable;
        const inventoryComponent = wc.inventory;
        const otherCurrentAssetsComponent = safeGet(historicals.otherCurrentAssets, lastIdx, 0);
        const ppeNetComponent = fa.endingPpeNet;
        const otherAssetsComponent = safeGet(historicals.otherAssets, lastIdx, 0);

        const shortTermDebtComponent = finance.currentDebt;
        const accountsPayableComponent = wc.accountsPayable;
        const deferredRevenueComponent = safeGet(historicals.deferredRevenue, lastIdx, 0);
        const otherCurrentLiabilitiesComponent = safeGet(historicals.otherCurrentLiabilities, lastIdx, 0);
        const longTermDebtComponent = finance.longTermDebt;
        const otherLiabilitiesComponent = safeGet(historicals.otherLiabilities, lastIdx, 0);

        // Current Assets = Cash + AR + Inventory + Other Current
        const totalCurrentAssetsComponent = cashComponent + marketableSecuritiesComponent + accountsReceivableComponent + inventoryComponent + otherCurrentAssetsComponent;
        // Non-Current Assets = PPE + Other Non-Current
        const nonCurrentAssetsComponent = ppeNetComponent + otherAssetsComponent;
        // Total Assets
        const totalAssetsComponent = totalCurrentAssetsComponent + nonCurrentAssetsComponent;

        // Current Liabilities = AP + Deferred Revenue + Other Current
        const currentLiabilitiesComponent = accountsPayableComponent + deferredRevenueComponent + otherCurrentLiabilitiesComponent;
        // Non-Current Liabilities = LT Debt + Other Non-Current
        const nonCurrentLiabilitiesComponent = longTermDebtComponent + otherLiabilitiesComponent;
        // Total Liabilities = Current + Non-Current
        const totalLiabilitiesComponent = currentLiabilitiesComponent + nonCurrentLiabilitiesComponent;

        // Roll common equity forward from contributed capital, SBC, buybacks, and retained earnings.
        const totalEquityComponent = finance.totalEquity;
        const nonControllingInterestComponent = safeGet(historicals.nonControllingInterest, lastIdx, 0);
        const balanceSheetCheck = totalAssetsComponent
            - totalLiabilitiesComponent
            - totalEquityComponent
            - nonControllingInterestComponent;

        // Contributed capital includes SBC and repurchase activity from the financing schedule.
        const commonStockComponent = totalEquityComponent - finance.retainedEarnings;
        // Retained Earnings from financing module
        const retainedEarningsComponent = finance.retainedEarnings;

        // Calculate effective tax rate (handle division by zero)
        const effectiveTaxRate = finance.preTaxIncome !== 0 ? finance.taxExpense / finance.preTaxIncome : assumptions.taxRate;

        // === BUILD FORECAST ITEM ===
        const forecastItem: ForecastYear = {
            year, isStub,
            // Income Statement
            revenue: is.revenue,
            revenueGrowth: is.growthRate,
            costOfRevenue: is.costOfRevenue,
            grossProfit: is.grossProfit,
            grossMargin: is.grossMargin,
            // EBITDA = EBIT + D&A (proper calculation)
            ebitda: is.ebit + fa.depreciation,
            ebitdaMargin: is.revenue > 0 ? (is.ebit + fa.depreciation) / is.revenue : 0,
            ebit: is.ebit,
            ebitMargin: is.ebitMargin,
            // Interest and Taxes
            interestExpense: finance.interestExpense,
            preTaxIncome: finance.preTaxIncome,
            taxExpense: finance.taxExpense,
            effectiveTaxRate: effectiveTaxRate,
            netIncome: finance.netIncome,
            netMargin: is.revenue > 0 ? finance.netIncome / is.revenue : 0,
            // Other Operating Items
            taxShieldUsed: finance.taxShieldUsed,
            nolBalance: finance.closingNolBalance,
            rdExpense: is.rdExpense,
            sgaExpense: is.sgaExpense,
            depreciation: fa.depreciation,
            stockBasedComp: sbc,
            nwcChange: wc.nwcChange,
            // Cash Flow
            cfo: finance.cfo,
            capex: fa.capex,
            reinvestment: fa.capex - fa.depreciation + wc.nwcChange,
            fcff: fcfValuation,
            fcfe: finance.cfo - fa.capex + (finance.debtIssuance - finance.debtRepayment),
            // Balance Sheet - Assets
            cash: cashComponent,
            marketableSecurities: marketableSecuritiesComponent,
            totalCurrentAssets: totalCurrentAssetsComponent,
            otherCurrentAssets: otherCurrentAssetsComponent,
            ppeNet: ppeNetComponent,
            otherAssets: otherAssetsComponent,
            totalAssets: totalAssetsComponent,
            nonCurrentAssets: nonCurrentAssetsComponent,
            // Balance Sheet - Debt
            totalDebt: finance.totalDebt,
            currentDebt: shortTermDebtComponent,
            shortTermDebt: shortTermDebtComponent,
            longTermDebt: longTermDebtComponent,
            // Balance Sheet - Liabilities
            totalCurrentLiabilities: currentLiabilitiesComponent,
            deferredRevenue: deferredRevenueComponent,
            otherCurrentLiabilities: otherCurrentLiabilitiesComponent,
            otherLiabilities: otherLiabilitiesComponent,
            nonCurrentLiabilities: nonCurrentLiabilitiesComponent,
            // Balance Sheet - Equity
            commonStock: commonStockComponent,
            retainedEarnings: retainedEarningsComponent,
            shareholdersEquity: totalEquityComponent,
            nonControllingInterest: nonControllingInterestComponent,
            balanceSheetCheck,
            // Working Capital Components
            accountsReceivable: accountsReceivableComponent,
            inventory: inventoryComponent,
            accountsPayable: accountsPayableComponent,
            nwc: wc.nwc,
            arDays: assumptions.accountsReceivableDays,
            inventoryDays: assumptions.inventoryDays,
            apDays: assumptions.accountsPayableDays,
            // Capital Returns
            dividends: finance.dividends,
            shareBuybacks: finance.shareBuybacks,
            debtIssuance: finance.debtIssuance,
            debtRepayment: finance.debtRepayment,
            // Totals
            totalLiabilities: totalLiabilitiesComponent,
            investedCapital: state.prevInvestedCapital,
            // Valuation Metrics
            roic: state.prevInvestedCapital > 0 ? (is.ebit * (1 - assumptions.taxRate)) / state.prevInvestedCapital : 0,
            economicProfit: (is.ebit * (1 - assumptions.taxRate)) - (state.prevInvestedCapital * assumptions.wacc),
            discountFactor,
            // pvFcff is consumed downstream as "PV of valuation metric" across methods.
            // For unlevered this is FCFF PV, for levered FCFE PV, for DDM dividend PV.
            pvFcff: metricToDiscount * discountFactor,
            pv: metricToDiscount * discountFactor
        };

        forecasts.push(forecastItem);

        // Update state
        state = {
            cash: finance.finalCash,
            debt: finance.totalDebt,
            nwc: wc.nwc,
            ppeNet: fa.endingPpeNet,
            retainedEarnings: finance.retainedEarnings,
            cumulativeBuybacks: finance.cumulativeBuybacks,
            cumulativeSbc: finance.cumulativeSbc,
            nolBalance: finance.closingNolBalance,
            prevRevenue: is.revenue,
            prevGrossMargin: is.grossMargin,
            prevInvestedCapital: (fa.endingPpeNet + wc.nwc) + safeGet(historicals.otherAssets, lastIdx, 0) - safeGet(historicals.otherLiabilities, lastIdx, 0)
        };
    }

    // 4. Terminal Valuation
    const result = calculateTerminalValuation(forecasts, historicals, assumptions, totalHorizon);

    const balanceSheetFailures = forecasts
        .map((forecast) => ({
            year: forecast.year,
            difference: forecast.balanceSheetCheck ?? 0,
            tolerance: Math.max(1, Math.abs(forecast.totalAssets) * 0.001),
        }))
        .filter((check) => Math.abs(check.difference) > check.tolerance);
    if (balanceSheetFailures.length > 0) {
        const worst = balanceSheetFailures.reduce((largest, current) =>
            Math.abs(current.difference) > Math.abs(largest.difference) ? current : largest,
        );
        result.bsImbalanceWarning = `Projected balance sheet check fails by ${worst.difference} in FY${worst.year}; tolerance is ${worst.tolerance}. Review the forecast balance sheet and equity roll-forward.`;
    }

    // Adjustments for Equity Value Bridge (ensure we use Cash + Marketable Securities)
    const lastHistIdx = historicals.years.length - 1;
    const currentCash = historicals.cash[lastHistIdx] || 0;
    const currentMarketableSecurities = safeGet(historicals.marketableSecurities, lastHistIdx, 0);
    const currentDebt = historicals.totalDebt[lastHistIdx] || 0;
    const currentMinorityInterest = safeGet(historicals.nonControllingInterest, lastHistIdx, 0);
    const currentPreferredEquity = safeGet(historicals.preferredEquity, lastHistIdx, 0);

    const modelType = assumptions.modelType || 'unlevered';
    if (modelType === 'unlevered') {
        if (result.enterpriseValue === null) {
            throw new Error('Unlevered DCF result is missing enterprise value.');
        }
        result.equityValue = result.enterpriseValue + currentCash + currentMarketableSecurities
            - currentDebt - currentMinorityInterest - currentPreferredEquity;
    } else {
        // For Levered/DDM, result is already Equity Value, so back out the EV correctly
        result.enterpriseValue = result.equityValue + currentDebt + currentMinorityInterest + currentPreferredEquity
            - (currentCash + currentMarketableSecurities);
    }

    const currentPrice = getSafeCurrentPrice(historicals.price);
    result.shareCount = effectiveShares;
    result.impliedSharePrice = Math.max(0, result.equityValue / Math.max(effectiveShares, 1));
    result.currentPrice = currentPrice;
    result.upside = result.currentPrice > 0
        ? (result.impliedSharePrice - result.currentPrice) / result.currentPrice
        : 0;

    return result;
}

function createFallbackResults(historicals: HistoricalData): DCFResults {
    const currentPrice = getSafeCurrentPrice(historicals?.price);
    return {
        forecasts: [],
        terminalValue: 0,
        pvTerminalValue: 0,
        enterpriseValue: null,
        equityValue: 0,
        impliedSharePrice: 0,
        shareCount: 0,
        currentPrice,
        upside: 0,
        terminalValueGordon: 0,
        terminalValueExitMultiple: 0,
        tvDivergenceFlag: false,
        avgROIC: 0,
        valueCreationFlag: false,
        confidenceScore: 0,
        confidenceRank: 'Low',
        sectorWarning: 'Insufficient financial data to run model; valuation withheld.',
        modelWarning: 'Insufficient financial data to run model; valuation withheld.',
        isValuationSupported: false,
        isSensitivitySupported: false,
    };
}
