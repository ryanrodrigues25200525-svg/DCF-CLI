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
