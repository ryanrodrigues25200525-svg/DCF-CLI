import type { CanonicalFinancialLine } from './native';
import type { OperatingArchetype } from './native';

export interface CompanyProfile {
    cik: string;
    ticker: string;
    name: string;
    exchange: string;
    fiscalYearEnd: string;
    currency: string | null;
    sic?: string;
    sicDescription?: string;
    sector?: string;
    industry?: string;
    operatingArchetype?: OperatingArchetype;

    // Market Data (Hybrid)
    currentPrice?: number | null;
    marketCap?: number | null;
    beta?: number | null;
}

export type HistoricalSeries = Array<number | null>;

export interface HistoricalData {
    symbol: string;
    years: number[];
    revenue: HistoricalSeries;
    costOfRevenue: HistoricalSeries;
    grossProfit: HistoricalSeries;
    purchases?: HistoricalSeries;
    ebitda: HistoricalSeries;
    ebit: HistoricalSeries;
    interestExpense: HistoricalSeries;
    incomeTaxExpense: HistoricalSeries;
    netIncome: HistoricalSeries;
    depreciation: HistoricalSeries;
    capex: HistoricalSeries;
    nwcChange: HistoricalSeries;
    operatingNetWorkingCapital?: HistoricalSeries;
    stockBasedComp?: HistoricalSeries;
    taxRate: HistoricalSeries;
    dividendsPaid?: HistoricalSeries;
    marketableSecurities?: HistoricalSeries;
    preferredEquity?: HistoricalSeries;
    cfo?: HistoricalSeries;
    fcff?: HistoricalSeries;

    accountsReceivable: HistoricalSeries;
    inventory: HistoricalSeries;
    accountsPayable: HistoricalSeries;

    marketing?: HistoricalSeries;
    generalAndAdministrative?: HistoricalSeries;
    researchAndDevelopment?: HistoricalSeries;
    rent?: HistoricalSeries;
    badDebt?: HistoricalSeries;
    otherOperatingExpenses?: HistoricalSeries;

    deferredTax?: HistoricalSeries;
    otherNonCash?: HistoricalSeries;

    cash: HistoricalSeries;
    totalCurrentAssets: HistoricalSeries;
    otherCurrentAssets: HistoricalSeries;

    totalAssets: HistoricalSeries;
    totalDebt: HistoricalSeries;
    currentDebt: HistoricalSeries;
    longTermDebt?: HistoricalSeries;
    shareholdersEquity: HistoricalSeries;
    nonControllingInterest?: HistoricalSeries;
    balanceSheetCheck?: HistoricalSeries;
    operatingLeaseLiabilities?: HistoricalSeries;

    ppeNet: HistoricalSeries;
    otherAssets: HistoricalSeries;
    otherLiabilities: HistoricalSeries;
    totalLiabilities: HistoricalSeries;
    totalCurrentLiabilities: HistoricalSeries;
    otherCurrentLiabilities: HistoricalSeries;
    deferredRevenue: HistoricalSeries;
    retainedEarnings: HistoricalSeries;

    sharesOutstanding: number | null;
    price: number | null;
    beta: number | null;
    currency: string | null;
    sector?: string;
    industry?: string;
    tradingCurrency?: string | null;
    exchangeRate?: number;
    lastUpdated?: number;
    normalizationWarnings?: string[];
    sourceData?: Record<string, CanonicalFinancialLine[]>;
}
