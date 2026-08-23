export interface Assumptions {
    forecastYears: number;
    revenueGrowth: number;
    ebitMargin: number;
    grossMargin: number;
    taxRate: number;
    deaRatio: number;
    capexRatio: number;
    nwcChangeRatio: number;
    rdMargin: number;
    sgaMargin: number;

    accountsReceivableDays: number;
    inventoryDays: number;
    accountsPayableDays: number;
    wacc: number;

    riskFreeRate?: number;
    equityRiskPremium?: number;
    beta?: number;
    unleveredBeta?: number;
    costOfDebt?: number;
    costOfEquity?: number;
    weightDebt?: number;
    weightEquity?: number;

    terminalGrowthRate: number;
    terminalExitMultiple: number;
    valuationMethod: 'growth' | 'multiple';

    advancedMode: boolean;
    revenueGrowthStage1: number;
    revenueGrowthStage2: number;
    revenueGrowthStage3: number;
    ebitMarginSteadyState: number;
    ebitMarginConvergenceYears: number;
    salesToCapitalRatio: number;
    startingInvestedCapital?: number;
    leverageTarget?: number;

    // Levered DCF specific
    currentDebt?: number;
    annualDebtRepayment?: number;
    modelType?: 'unlevered' | 'levered' | 'ddm';
    discountRateMode?: 'derived' | 'manual';

    // DDM specific
    currentDividendPerShare?: number;
    dividendPayoutRatio?: number;
    dividendGrowthRateStage1?: number;
    dividendGrowthRateStage2?: number;
    stage1Duration?: number;
    stage2Duration?: number;

    // Common
    dilutedSharesOutstanding?: number;
}

export interface Overrides {
    [year: number]: {
        revenue?: number;
        revenueGrowth?: number;
        ebitMargin?: number;
        grossMargin?: number;
        dea?: number;
        capex?: number;
        nwcChange?: number;
    };
}

export interface ForecastYear {
    year: number;
    isStub?: boolean;
    revenue: number;
    revenueGrowth: number;
    costOfRevenue: number;
    grossProfit: number;
    grossMargin: number;
    ebitda: number;
    ebitdaMargin: number;
    ebit: number;
    ebitMargin: number;
    interestExpense: number;
    preTaxIncome: number;
    taxExpense: number;
    effectiveTaxRate: number;
    netIncome: number;
    netMargin: number;
    taxShieldUsed: number;
    nolBalance: number;
    rdExpense: number;
    sgaExpense: number;
    depreciation: number;
    stockBasedComp: number;
    nwcChange: number;
    cfo: number;
    capex: number;
    reinvestment: number;
    fcff: number;
    fcfe: number;
    cash: number;
    totalCurrentAssets: number;
    otherCurrentAssets: number;

    ppeNet: number;
    otherAssets: number;
    totalAssets: number;
    totalDebt: number;
    currentDebt: number;
    shortTermDebt: number;
    longTermDebt: number;

    otherLiabilities: number;
    deferredRevenue: number;
    otherCurrentLiabilities: number;
    totalCurrentLiabilities: number;
    nonCurrentLiabilities: number;

    commonStock: number;
    retainedEarnings: number;
    arDays: number;
    inventoryDays: number;
    apDays: number;
    shareholdersEquity: number;
    investedCapital: number;
    dividends: number;
    shareBuybacks: number;
    debtIssuance: number;
    debtRepayment: number;
    totalLiabilities: number;
    accountsReceivable: number;
    inventory: number;
    accountsPayable: number;
    nwc: number;
    roic: number;
    economicProfit: number;
    discountFactor: number;
    pvFcff: number;
    pv: number;
    [key: string]: number | boolean | undefined;
}

export interface DCFResults {
    forecasts: ForecastYear[];
    terminalValue: number;
    pvTerminalValue: number;
    enterpriseValue: number;
    equityValue: number;
    impliedSharePrice: number;
    shareCount: number;
    currentPrice: number;
    upside: number;
    terminalValueGordon: number;
    terminalValueExitMultiple: number;
    tvDivergenceFlag: boolean;
    avgROIC: number;
    valueCreationFlag: boolean;
    confidenceScore: number;
    confidenceRank: 'High' | 'Medium' | 'Low';
    sectorWarning?: string;
    terminalGrowthWarning?: string;
    bsImbalanceWarning?: string;
    negativeCashFlowWarning?: string;
    companyType?: 'operating' | 'bank' | 'insurance' | 'reit' | 'utility' | 'high_growth' | 'distressed';
    preferredModel?: 'unlevered_dcf' | 'levered_dcf' | 'ddm' | 'residual_income' | 'reit_affo' | 'utility_dcf' | 'revenue_multiple' | 'ev_ebitda';
    isValuationSupported?: boolean;
    isSensitivitySupported?: boolean;
    modelWarning?: string;
}

export interface ModelDiagnostic {
    status: 'pass' | 'warning' | 'fail';
    msg: string;
}
