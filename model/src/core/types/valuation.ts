export interface WACCBreakdown {
    riskFreeRate: number;
    riskFreeSource: 'treasury_10y' | 'treasury_30y' | 'manual';
    equityRiskPremium: number;
    rawBeta: number;
    adjustedBeta: number;
    sizePremium: number;
    sizePremiumTier: 'Large-cap' | 'Mid-cap' | 'Small-cap' | 'Micro-cap';
    companySpecificRisk: number;
    costOfEquity: number;
    preTaxCostOfDebt: number;
    creditSpread: number;
    debtRating: string;
    taxRate: number;
    taxJurisdiction: 'US' | 'Canada' | 'Other';
    afterTaxCostOfDebt: number;
    marketValueEquity: number;
    marketValueDebt: number;
    totalCapital: number;
    weightEquity: number;
    weightDebt: number;
    wacc: number;
}

export interface ComparableCompany {
    ticker: string;
    name: string;
    sector: string;
    industry: string;
    marketCap: number;
    enterpriseValue: number;
    evRevenue: number;
    evEbitda: number;
    evEbit?: number;
    peRatio?: number;
    pbRatio?: number;
    revenue: number;
    ebitda: number;
    revenueGrowth: number;
    ebitdaMargin: number;
    currency?: string;
    financialCurrency?: string;
    exchangeRate?: number;
    ebit?: number;
    netIncome?: number;
    depreciation?: number;
    beta?: number;
    totalDebt?: number;
    cash?: number;
    taxRate?: number;
    price?: number;
    sharesOutstanding?: number;
    isSelected: boolean;
}

export interface CompsAnalysis {
    targetTicker: string;
    peers: ComparableCompany[];
    meanEvRevenue: number;
    medianEvRevenue: number;
    meanEvEbitda: number;
    medianEvEbitda: number;
    impliedEvFromRevenue: number;
    impliedEvFromEbitda: number;
    impliedSharePriceRevenue: number;
    impliedSharePriceEbitda: number;
}

export interface PrecedentTransaction {
    id: string;
    targetName: string;
    targetTicker?: string;
    acquirerName: string;
    announcementDate: string;
    closingDate?: string;
    transactionValue: number;
    equityValue: number;
    targetRevenue: number;
    targetEbitda: number;
    evRevenue: number;
    evEbitda: number;
    premiumPaid: number;
    sector: string;
    dealType: 'Strategic' | 'Financial' | 'Other' | 'Merger' | 'Takeover';
    paymentType: 'Cash' | 'Stock' | 'Mixed';
    isSelected: boolean;
}

export interface PrecedentAnalysis {
    transactions: PrecedentTransaction[];
    meanEvRevenue: number;
    medianEvRevenue: number;
    meanEvEbitda: number;
    medianEvEbitda: number;
    meanPremium: number;
    medianPremium: number;
    impliedEvFromRevenue: number;
    impliedEvFromEbitda: number;
}
