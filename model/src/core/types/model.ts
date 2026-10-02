import type {
    BankCanonicalFinancials,
    CanonicalFinancialLine,
    CompanyType,
    InsuranceCanonicalFinancials,
    ReitCanonicalFinancials,
    AssetManagerCanonicalFinancials,
    TelecomCanonicalFinancials,
    MortgageReitCanonicalFinancials,
    EnergyCanonicalFinancials,
    PharmaCanonicalFinancials,
    PreferredValuationModel,
} from './native';

export interface BankHistoricalYear {
    year: number;
    bank: BankCanonicalFinancials;
    totalRevenue: CanonicalFinancialLine;
    netIncome: CanonicalFinancialLine;
    taxRate: CanonicalFinancialLine;
}

export interface BankHistoricalData {
    years: number[];
    annual: BankHistoricalYear[];
}

export interface InsuranceHistoricalYear {
    year: number;
    insurance: InsuranceCanonicalFinancials | null;
    totalRevenue: CanonicalFinancialLine;
    netIncome: CanonicalFinancialLine;
    taxRate: CanonicalFinancialLine;
}

export interface InsuranceHistoricalData {
    years: number[];
    annual: InsuranceHistoricalYear[];
}

export interface ReitHistoricalYear {
    year: number;
    reit: ReitCanonicalFinancials;
    netIncome: CanonicalFinancialLine;
    commonEquity: CanonicalFinancialLine;
    cash: CanonicalFinancialLine;
    longTermDebt: CanonicalFinancialLine;
    preferredEquity: CanonicalFinancialLine;
    nonControllingInterest: CanonicalFinancialLine;
    dilutedShares: CanonicalFinancialLine;
}

export interface ReitHistoricalData {
    years: number[];
    annual: ReitHistoricalYear[];
}

export interface AssetManagerHistoricalYear {
    year: number;
    assetManager: AssetManagerCanonicalFinancials;
    revenue: CanonicalFinancialLine;
    ebit: CanonicalFinancialLine;
    interestExpense: CanonicalFinancialLine;
    incomeTaxExpense: CanonicalFinancialLine;
    taxRate: CanonicalFinancialLine;
    depreciation: CanonicalFinancialLine;
    capex: CanonicalFinancialLine;
    nwcChange: CanonicalFinancialLine;
    cash: CanonicalFinancialLine;
    marketableSecurities: CanonicalFinancialLine;
    debt: CanonicalFinancialLine;
    leaseLiabilities: CanonicalFinancialLine;
    nonControllingInterest: CanonicalFinancialLine;
    preferredEquity: CanonicalFinancialLine;
    dilutedShares: CanonicalFinancialLine;
}

export interface AssetManagerHistoricalData {
    years: number[];
    annual: AssetManagerHistoricalYear[];
}

export interface TelecomHistoricalYear {
    year: number;
    telecom: TelecomCanonicalFinancials | null;
    revenue: CanonicalFinancialLine;
    ebit: CanonicalFinancialLine;
    interestExpense: CanonicalFinancialLine;
    taxRate: CanonicalFinancialLine;
    depreciation: CanonicalFinancialLine;
    capex: CanonicalFinancialLine;
    nwcChange: CanonicalFinancialLine;
    cash: CanonicalFinancialLine;
    marketableSecurities: CanonicalFinancialLine;
    debt: CanonicalFinancialLine;
    nonControllingInterest: CanonicalFinancialLine;
    preferredEquity: CanonicalFinancialLine;
    dilutedShares: CanonicalFinancialLine;
}

export interface TelecomHistoricalData {
    years: number[];
    annual: TelecomHistoricalYear[];
}

export interface MortgageReitHistoricalYear {
    year: number;
    mortgageReit: MortgageReitCanonicalFinancials;
    netIncome: CanonicalFinancialLine;
    taxRate: CanonicalFinancialLine;
    cash: CanonicalFinancialLine;
    marketableSecurities: CanonicalFinancialLine;
    nonControllingInterest: CanonicalFinancialLine;
    dilutedShares: CanonicalFinancialLine;
}

export interface MortgageReitHistoricalData {
    years: number[];
    annual: MortgageReitHistoricalYear[];
}

export interface EnergyHistoricalYear {
    year: number;
    energy: EnergyCanonicalFinancials;
    revenue: CanonicalFinancialLine;
    netIncome: CanonicalFinancialLine;
    interestExpense: CanonicalFinancialLine;
    taxRate: CanonicalFinancialLine;
    depreciation: CanonicalFinancialLine;
    cashFlowFromOperations: CanonicalFinancialLine;
    cash: CanonicalFinancialLine;
    currentDebt: CanonicalFinancialLine;
    longTermDebt: CanonicalFinancialLine;
    debt: CanonicalFinancialLine;
    marketableSecurities: CanonicalFinancialLine;
    preferredEquity: CanonicalFinancialLine;
    nonControllingInterest: CanonicalFinancialLine;
    dilutedShares: CanonicalFinancialLine;
}

export interface EnergyHistoricalData {
    years: number[];
    annual: EnergyHistoricalYear[];
}

export interface PharmaHistoricalYear {
    year: number;
    pharma: PharmaCanonicalFinancials;
    revenue: CanonicalFinancialLine;
    ebit: CanonicalFinancialLine;
    interestExpense: CanonicalFinancialLine;
    taxRate: CanonicalFinancialLine;
    depreciation: CanonicalFinancialLine;
    capex: CanonicalFinancialLine;
    nwcChange: CanonicalFinancialLine;
    cash: CanonicalFinancialLine;
    marketableSecurities: CanonicalFinancialLine;
    debt: CanonicalFinancialLine;
    nonControllingInterest: CanonicalFinancialLine;
    preferredEquity: CanonicalFinancialLine;
    dilutedShares: CanonicalFinancialLine;
}

export interface PharmaHistoricalData {
    years: number[];
    annual: PharmaHistoricalYear[];
}

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
    revenueGrowthStage1Years?: number;
    revenueGrowthFadeYears?: number;
    ebitMarginSteadyState: number;
    ebitMarginConvergenceYears: number;
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
    nonControllingInterest?: number;
    balanceSheetCheck?: number;
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
    enterpriseValue: number | null;
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
    companyType?: CompanyType;
    preferredModel?: PreferredValuationModel;
    isValuationSupported?: boolean;
    isSensitivitySupported?: boolean;
    modelWarning?: string;
    valuationBasis?: 'enterprise' | 'equity';
}

export interface ModelDiagnostic {
    status: 'pass' | 'warning' | 'fail';
    msg: string;
}
