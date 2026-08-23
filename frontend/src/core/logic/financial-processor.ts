import { HistoricalData, DCFResults, ForecastYear } from '@/core/types';

/**
 * Robust Accessor for Historical Arrays
 * Safely retrieves value at index, handles missing arrays, returns null if invalid.
 */
const getHistVal = (arr: number[] | undefined, idx: number): number | null => {
    if (!arr || idx < 0 || idx >= arr.length) return null;
    const v = arr[idx];
    return (v === undefined || Number.isNaN(v)) ? null : v;
};

// --- Registry-based Calculation Engine ---

type CalculatorFn = (
    year: number,
    hIdx: number,
    historicals: HistoricalData,
    results: DCFResults,
    f?: ForecastYear
) => number;

const historicalCalculators: Record<string, CalculatorFn> = {
    // Income Statement
    revenue: (_, hIdx, h) => getHistVal(h.revenue, hIdx) ?? 0,
    revenueGrowth: (_, hIdx, h) => {
        if (hIdx === 0) return 0;
        const curr = getHistVal(h.revenue, hIdx) ?? 0;
        const prev = getHistVal(h.revenue, hIdx - 1) ?? 0;
        return prev !== 0 ? (curr - prev) / prev : 0;
    },
    cogs: (_, hIdx, h) => getHistVal(h.costOfRevenue, hIdx) ?? 0,
    costOfRevenue: (_, hIdx, h) => getHistVal(h.costOfRevenue, hIdx) ?? 0,
    gp: (year, hIdx, h, r) => {
        const actual = getHistVal(h.grossProfit, hIdx);
        if (actual !== null) return actual;
        return calculateFinancialValue('revenue', year, h, r) - calculateFinancialValue('cogs', year, h, r);
    },
    grossProfit: (year, hIdx, h, r) => {
        const actual = getHistVal(h.grossProfit, hIdx);
        if (actual !== null) return actual;
        return calculateFinancialValue('revenue', year, h, r) - calculateFinancialValue('cogs', year, h, r);
    },
    gm: (year, hIdx, h, r) => {
        const rev = calculateFinancialValue('revenue', year, h, r);
        return rev === 0 ? 0 : calculateFinancialValue('gp', year, h, r) / rev;
    },
    grossMargin: (year, hIdx, h, r) => {
        const rev = calculateFinancialValue('revenue', year, h, r);
        return rev === 0 ? 0 : calculateFinancialValue('grossProfit', year, h, r) / rev;
    },
    rnd: (_, hIdx, h) => getHistVal(h.researchAndDevelopment, hIdx) ?? 0,
    sga: (_, hIdx, h) => getHistVal(h.generalAndAdministrative, hIdx) ?? 0,
    // D&A
    depreciation: (_, hIdx, h) => {
        const depr = getHistVal(h.depreciation, hIdx);
        if (depr !== null && depr > 0) return depr;
        const capex = getHistVal(h.capex, hIdx) ?? 0;
        return capex * 0.7;
    },
    daInOp: (_, hIdx, h) => {
        const depr = getHistVal(h.depreciation, hIdx);
        if (depr !== null && depr > 0) return depr;
        const capex = getHistVal(h.capex, hIdx) ?? 0;
        return capex * 0.7;
    },
    // EBITDA - calculate from EBIT + Depreciation if not directly available
    ebitda: (_year, hIdx, h, _r) => {
        const ebitdaVal = getHistVal(h.ebitda, hIdx);
        if (ebitdaVal !== null && ebitdaVal > 0) return ebitdaVal;
        // Calculate as EBIT + Depreciation
        const ebit = getHistVal(h.ebit, hIdx) ?? 0;
        const depr = getHistVal(h.depreciation, hIdx);
        const deprVal = depr !== null ? depr : (getHistVal(h.capex, hIdx) ?? 0) * 0.7;
        return ebit + deprVal;
    },
    ebitdaMargin: (year, hIdx, h, r) => {
        const rev = calculateFinancialValue('revenue', year, h, r);
        const ebitdaVal = calculateFinancialValue('ebitda', year, h, r);
        return rev ? ebitdaVal / rev : 0;
    },
    ebit: (_, hIdx, h) => getHistVal(h.ebit, hIdx) ?? 0,
    ebitMargin: (year, hIdx, h, r) => {
        const rev = calculateFinancialValue('revenue', year, h, r);
        return rev ? calculateFinancialValue('ebit', year, h, r) / rev : 0;
    },
    // Interest and Taxes
    interestExpense: (_, hIdx, h) => {
        const intExp = getHistVal(h.interestExpense, hIdx);
        if (intExp !== null && intExp !== 0) return Math.abs(intExp);
        // Fallback: Estimate interest expense from debt (assume 5% interest rate)
        const totalDebt = getHistVal(h.totalDebt, hIdx) ?? 0;
        return Math.abs(totalDebt * 0.05);
    },
    preTaxIncome: (_, hIdx, h) => {
        const ni = getHistVal(h.netIncome, hIdx) ?? 0;
        const tax = getHistVal(h.incomeTaxExpense, hIdx) ?? 0;
        return ni + tax;
    },
    taxExpense: (_, hIdx, h) => Math.abs(getHistVal(h.incomeTaxExpense, hIdx) ?? 0),
    effectiveTaxRate: (_, hIdx, h) => getHistVal(h.taxRate, hIdx) ?? 0.21,
    netIncome: (_, hIdx, h) => getHistVal(h.netIncome, hIdx) ?? 0,
    netMargin: (year, hIdx, h, r) => {
        const rev = calculateFinancialValue('revenue', year, h, r);
        const ni = calculateFinancialValue('netIncome', year, h, r);
        return rev ? ni / rev : 0;
    },

    // Balance Sheet - Assets
    cash: (_, hIdx, h) => getHistVal(h.cash, hIdx) ?? 0,
    marketableSecurities: (_, hIdx, h) => getHistVal(h.marketableSecurities, hIdx) ?? 0,
    totalCurrentAssets: (_, hIdx, h) => getHistVal(h.totalCurrentAssets, hIdx) ?? 0,
    otherCurrentAssets: (_, hIdx, h) => getHistVal(h.otherCurrentAssets, hIdx) ?? 0,
    accountsReceivable: (_, hIdx, h) => getHistVal(h.accountsReceivable, hIdx) ?? 0,
    inventory: (_, hIdx, h) => getHistVal(h.inventory, hIdx) ?? 0,
    nonCurrentAssets: (_year, _hIdx, h) => {
        const totalAssets = getHistVal(h.totalAssets, _hIdx) ?? 0;
        const currentAssets = getHistVal(h.totalCurrentAssets, _hIdx) ?? 0;
        return totalAssets - currentAssets;
    },
    ppeNet: (_, hIdx, h) => getHistVal(h.ppeNet, hIdx) ?? 0,
    otherAssets: (_, hIdx, h) => getHistVal(h.otherAssets, hIdx) ?? 0,
    totalAssets: (_, hIdx, h) => getHistVal(h.totalAssets, hIdx) ?? 0,

    // Balance Sheet - Debt
    totalDebt: (_, hIdx, h) => getHistVal(h.totalDebt, hIdx) ?? 0,
    currentDebt: (_, hIdx, h) => getHistVal(h.currentDebt, hIdx) ?? 0,
    shortTermDebt: (_, hIdx, h) => getHistVal(h.currentDebt, hIdx) ?? 0,
    longTermDebt: (_, hIdx, h) => {
        const ltDebt = getHistVal(h.longTermDebt, hIdx);
        if (ltDebt !== null) return ltDebt;
        const totalDebt = getHistVal(h.totalDebt, hIdx) ?? 0;
        const currDebt = getHistVal(h.currentDebt, hIdx) ?? 0;
        return totalDebt - currDebt;
    },
    netDebt: (_year, _hIdx, h) => {
        const totalDebt = getHistVal(h.totalDebt, _hIdx) ?? 0;
        const cash = getHistVal(h.cash, _hIdx) ?? 0;
        const marketableSecurities = getHistVal(h.marketableSecurities, _hIdx) ?? 0;
        return totalDebt - cash - marketableSecurities;
    },

    // Balance Sheet - Liabilities
    totalCurrentLiabilities: (_, hIdx, h) => getHistVal(h.totalCurrentLiabilities, hIdx) ?? 0,
    accountsPayable: (_, hIdx, h) => getHistVal(h.accountsPayable, hIdx) ?? 0,
    deferredRevenue: (_, hIdx, h) => getHistVal(h.deferredRevenue, hIdx) ?? 0,
    otherCurrentLiabilities: (_, hIdx, h) => getHistVal(h.otherCurrentLiabilities, hIdx) ?? 0,
    nonCurrentLiabilities: (_year, _hIdx, h) => {
        const totalLiabilities = getHistVal(h.totalLiabilities, _hIdx) ?? 0;
        const currentLiabilities = getHistVal(h.totalCurrentLiabilities, _hIdx) ?? 0;
        return totalLiabilities - currentLiabilities;
    },
    otherLiabilities: (_, hIdx, h) => getHistVal(h.otherLiabilities, hIdx) ?? 0,
    totalLiabilities: (_, hIdx, h) => getHistVal(h.totalLiabilities, hIdx) ?? 0,

    // Balance Sheet - Equity
    commonStock: (_, hIdx, h) => {
        const equity = getHistVal(h.shareholdersEquity, hIdx) ?? 0;
        const retained = getHistVal(h.retainedEarnings, hIdx) ?? 0;
        return Math.max(0, equity - retained);
    },
    retainedEarnings: (_, hIdx, h) => getHistVal(h.retainedEarnings, hIdx) ?? 0,
    shareholdersEquity: (_, hIdx, h) => getHistVal(h.shareholdersEquity, hIdx) ?? 0,
    liabilitiesAndEquity: (year, hIdx, h, r) => calculateFinancialValue('totalLiabilities', year, h, r) + calculateFinancialValue('shareholdersEquity', year, h, r),

    // Working Capital
    // Working Capital
    nwcChange: (_, hIdx, h) => getHistVal(h.nwcChange, hIdx) ?? 0,

    // Cash Flow Metrics
    stockBasedComp: (_, hIdx, h) => getHistVal(h.stockBasedComp, hIdx) ?? 0,
    cfo: (year, hIdx, h) => {
        const val = getHistVal(h.cfo, hIdx);
        if (val !== null && val !== 0) return val;
        // Calculation fallback: NI + DA + SBC + ChgNWC (note: nwcChange is OCF-signed here)
        return (getHistVal(h.netIncome, hIdx) ?? 0) +
            (getHistVal(h.depreciation, hIdx) ?? 0) +
            (getHistVal(h.stockBasedComp, hIdx) ?? 0) +
            (getHistVal(h.nwcChange, hIdx) ?? 0);
    },
    fcff: (year, hIdx, h, results) => {
        const val = getHistVal(h.fcff, hIdx);
        if (val !== null && val !== 0) return val;
        // Calculation fallback: CFO - Capex
        const cfo = historicalCalculators.cfo(year, hIdx, h, results);
        const capex = getHistVal(h.capex, hIdx) ?? 0;
        return cfo - Math.abs(capex);
    }
};

const forecastCalculators: Record<string, CalculatorFn> = {
    // Core Income Statement
    revenue: (_, __, ___, ____, f) => f?.revenue ?? 0,
    revenueGrowth: (_, __, ___, ____, f) => f?.revenueGrowth ?? 0,
    costOfRevenue: (_, __, ___, ____, f) => (f?.revenue ?? 0) - (f?.grossProfit ?? 0),
    cogs: (_, __, ___, ____, f) => (f?.revenue ?? 0) - (f?.grossProfit ?? 0),
    grossProfit: (_, __, ___, ____, f) => f?.grossProfit ?? 0,
    gp: (_, __, ___, ____, f) => f?.grossProfit ?? 0,
    grossMargin: (_, __, ___, ____, f) => (f?.revenue ?? 0) ? (f?.grossProfit ?? 0) / (f?.revenue ?? 0) : 0,
    gm: (_, __, ___, ____, f) => (f?.revenue ?? 0) ? (f?.grossProfit ?? 0) / (f?.revenue ?? 0) : 0,

    // Operating Expenses
    rnd: (_, __, ___, ____, f) => f?.rdExpense ?? 0,
    sga: (_, __, ___, ____, f) => f?.sgaExpense ?? 0,

    // EBITDA
    depreciation: (_, __, ___, ____, f) => f?.depreciation ?? 0,
    daInOp: (_, __, ___, ____, f) => f?.depreciation ?? 0,
    // EBITDA - should be calculated as EBIT + Depreciation
    ebitda: (_, __, ___, ____, f) => {
        const ebitdaVal = f?.ebitda;
        if (ebitdaVal !== undefined && ebitdaVal > 0) return ebitdaVal;
        // Calculate from EBIT + Depreciation
        return (f?.ebit ?? 0) + (f?.depreciation ?? 0);
    },
    ebitdaMargin: (_, __, ___, ____, f) => {
        const ebitdaVal = f?.ebitda;
        const ebitda = (ebitdaVal !== undefined && ebitdaVal > 0) ? ebitdaVal : (f?.ebit ?? 0) + (f?.depreciation ?? 0);
        const revenue = f?.revenue ?? 0;
        return revenue ? ebitda / revenue : 0;
    },

    // EBIT
    ebit: (_, __, ___, ____, f) => f?.ebit ?? 0,
    ebitMargin: (_, __, ___, ____, f) => f?.ebitMargin ?? 0,

    // Interest and Taxes
    interestExpense: (_, __, ___, ____, f) => f?.interestExpense ?? 0,
    preTaxIncome: (_, __, ___, ____, f) => f?.preTaxIncome ?? 0,
    taxExpense: (_, __, ___, ____, f) => f?.taxExpense ?? 0,
    effectiveTaxRate: (_, __, ___, ____, f) => f?.effectiveTaxRate ?? 0,

    // Net Income
    netIncome: (_, __, ___, ____, f) => f?.netIncome ?? 0,
    netMargin: (_, __, ___, ____, f) => f?.netMargin ?? 0,

    // Working Capital
    capex: (_, __, ___, ____, f) => -(f?.capex ?? 0),
    nwcChange: (_, __, ___, ____, f) => f?.nwcChange ?? 0,
    nwc: (_, __, ___, ____, f) => f?.nwcChange ?? 0,

    // Cash Flow
    stockBasedComp: (_, __, ___, ____, f) => f?.stockBasedComp ?? 0,
    cfo: (_, __, ___, ____, f) => f?.cfo ?? 0,
    fcff: (_, __, ___, ____, f) => f?.fcff ?? 0,
    fcfe: (_, __, ___, ____, f) => f?.fcfe ?? 0,
    reinvestment: (_, __, ___, ____, f) => f?.reinvestment ?? 0,

    // Balance Sheet - Assets
    cash: (_, __, ___, ____, f) => f?.cash ?? 0,
    totalCurrentAssets: (_, __, ___, ____, f) => f?.totalCurrentAssets ?? 0,
    otherCurrentAssets: (_, __, ___, ____, f) => f?.otherCurrentAssets ?? 0,
    accountsReceivable: (_, __, ___, ____, f) => f?.accountsReceivable ?? 0,
    inventory: (_, __, ___, ____, f) => f?.inventory ?? 0,
    nonCurrentAssets: (_, __, ___, ____, f) => (f?.totalAssets ?? 0) - (f?.totalCurrentAssets ?? 0),
    ppeNet: (_, __, ___, ____, f) => f?.ppeNet ?? 0,
    otherAssets: (_, __, ___, ____, f) => f?.otherAssets ?? 0,
    totalAssets: (_, __, ___, ____, f) => f?.totalAssets ?? 0,

    // Balance Sheet - Debt
    totalDebt: (_, __, ___, ____, f) => f?.totalDebt ?? 0,
    currentDebt: (_, __, ___, ____, f) => f?.currentDebt ?? 0,
    shortTermDebt: (_, __, ___, ____, f) => f?.shortTermDebt ?? f?.currentDebt ?? 0,
    longTermDebt: (_, __, ___, ____, f) => f?.longTermDebt ?? (f?.totalDebt ?? 0) - (f?.currentDebt ?? 0),
    netDebt: (_, __, ___, ____, f) => (f?.totalDebt ?? 0) - (f?.cash ?? 0) - ((f?.marketableSecurities as number) ?? 0),
    marketableSecurities: (_, __, ___, ____, f) => (f?.marketableSecurities as number) ?? 0,

    // Balance Sheet - Liabilities
    totalCurrentLiabilities: (_, __, ___, ____, f) => f?.totalCurrentLiabilities ?? 0,
    accountsPayable: (_, __, ___, ____, f) => f?.accountsPayable ?? 0,
    deferredRevenue: (_, __, ___, ____, f) => f?.deferredRevenue ?? 0,
    otherCurrentLiabilities: (_, __, ___, ____, f) => f?.otherCurrentLiabilities ?? 0,
    nonCurrentLiabilities: (_, __, ___, ____, f) => f?.nonCurrentLiabilities ?? (f?.totalLiabilities ?? 0) - (f?.totalCurrentLiabilities ?? 0),
    otherLiabilities: (_, __, ___, ____, f) => f?.otherLiabilities ?? 0,
    totalLiabilities: (_, __, ___, ____, f) => f?.totalLiabilities ?? 0,

    // Balance Sheet - Equity
    commonStock: (_, __, ___, ____, f) => f?.commonStock ?? 0,
    retainedEarnings: (_, __, ___, ____, f) => f?.retainedEarnings ?? 0,
    shareholdersEquity: (_, __, ___, ____, f) => f?.shareholdersEquity ?? 0,
    liabilitiesAndEquity: (_, __, ___, ____, f) => (f?.totalLiabilities ?? 0) + (f?.shareholdersEquity ?? 0),

    // Spacers
    spacer1: () => 0,
    spacer2: () => 0,

    // DCF Bridge
    df: (_, __, ___, ____, f) => f?.discountFactor ?? 0,
    pv: (_, __, ___, ____, f) => f?.pv ?? 0,
    pvFcff: (_, __, ___, ____, f) => f?.pvFcff ?? 0,
};

// --- Memoization Cache ---
let calculationCache: Record<string, number> = {};
let lastHistoricals: HistoricalData | null = null;
let lastResults: DCFResults | null = null;
let historicalYearIndexMap = new Map<number, number>();
let forecastByYearMap = new Map<number, ForecastYear>();

/**
 * Enhanced Financial Calculation Engine with Memoization
 */
export function calculateFinancialValue(
    key: string,
    year: number,
    historicals: HistoricalData,
    results: DCFResults
): number {
    // Clear cache if inputs have changed (shallow check)
    if (historicals !== lastHistoricals || results !== lastResults) {
        calculationCache = {};
        lastHistoricals = historicals;
        lastResults = results;
        historicalYearIndexMap = new Map(historicals.years.map((yr, idx) => [yr, idx]));
        forecastByYearMap = new Map(results.forecasts.map((forecast) => [forecast.year, forecast]));
    }

    const cacheKey = `${key}_${year}`;
    if (cacheKey in calculationCache) {
        return calculationCache[cacheKey];
    }

    const hIdx = historicalYearIndexMap.get(year) ?? -1;
    const isHistorical = hIdx >= 0;
    const f = forecastByYearMap.get(year);

    let result = 0;

    if (isHistorical) {
        const calc = historicalCalculators[key];
        if (calc) {
            result = calc(year, hIdx, historicals, results);
        } else {
            // Fallback for direct historical array access
            const arr = (historicals as unknown as Record<string, unknown>)[key];
            result = Array.isArray(arr) ? (getHistVal(arr as number[], hIdx) ?? 0) : 0;
        }
    } else {
        if (f) {
            const calc = forecastCalculators[key];
            if (calc) {
                result = calc(year, -1, historicals, results, f);
            } else {
                // Fallback for direct forecast object access
                const forecastObj = f as unknown as Record<string, unknown>;
                const val = forecastObj[key] ?? forecastObj[key.replace(/^use_/, '')];
                result = typeof val === 'number' ? val : 0;
            }
        }
    }

    calculationCache[cacheKey] = result;
    return result;
}
