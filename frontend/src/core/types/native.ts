export type NativeScalar = string | number | null;

export interface NativeStatementRow {
    concept?: string | null;
    label?: string | null;
    standard_concept?: string | null;
    level?: number | null;
    decimals?: number | null;
    [key: string]: NativeScalar | undefined;
}

export interface NativeStatements {
    income_statement: NativeStatementRow[];
    balance_sheet: NativeStatementRow[];
    cashflow_statement: NativeStatementRow[];
}

export interface NativeKeyMetrics {
    revenue?: number | null;
    net_income?: number | null;
    operating_income?: number | null;
    total_assets?: number | null;
    total_liabilities?: number | null;
    stockholders_equity?: number | null;
    operating_cash_flow?: number | null;
    capital_expenditures?: number | null;
    free_cash_flow?: number | null;
    shares_outstanding_basic?: number | null;
    shares_outstanding_diluted?: number | null;
    [key: string]: number | string | null | undefined;
}

export interface NativeFinancialsPayload {
    ticker: string;
    cik: string;
    name: string;
    source: string;
    periods_requested: number;
    statements: NativeStatements;
    key_metrics: NativeKeyMetrics;
    shares_outstanding?: number | null;
    public_float?: number | null;
    is_financial_institution?: boolean | null;
    fiscal_year_end?: string | null;
    fetched_at_ms: number;
}

export interface NativeProfilePayload {
    cik: string;
    ticker: string;
    name: string;
    exchange?: string | null;
    sector?: string | null;
    industry?: string | null;
    fiscal_year_end?: string | null;
    current_price?: number | null;
    market_cap?: number | null;
    currency?: string | null;
    beta?: number | null;
}

export interface NativeMarketContextPayload {
    riskFreeRate?: number;
    equityRiskPremium?: number;
    lastUpdated?: number;
    risk_free_rate?: number;
    equity_risk_premium?: number;
    last_updated?: number;
    fetched_at_ms?: number;
    treasuryRateSource?: string;
    treasury_rate_source?: string;
    erpSource?: string;
    erp_source?: string;
    as_of_date?: string;
}

export interface UnifiedDataQualityEntry {
    status: "live" | "cached" | "stale" | "default" | "unavailable";
    source: string;
    fetched_at_ms: number | null;
    fallback_used: boolean;
    notes?: string;
}

export interface UnifiedCompleteness {
    has_financials: boolean;
    has_market: boolean;
    has_valuation_context: boolean;
    has_peers: boolean;
    has_insider_trades: boolean;
    degradation_level: "none" | "low" | "moderate" | "high";
}

export interface NativeValuationContextPayload {
    risk_free_rate: number;
    equity_risk_premium: number;
    fetched_at_ms: number;
    treasury_rate_source?: string;
    erp_source?: string;
    as_of_date?: string;
}

export interface NativeUnifiedPayload {
    profile: NativeProfilePayload;
    financials_native: NativeFinancialsPayload;
    canonical_financials?: Record<string, unknown>;
    model_eligibility?: {
        company_type?: string;
        preferred_model?: string;
        allowed_models?: string[];
        blocked_models?: Array<{ model?: string; reason?: string }>;
        supported_by_current_engine?: boolean;
    };
    market?: Record<string, unknown>;
    market_context?: NativeMarketContextPayload;
    valuation_context?: NativeValuationContextPayload;
    peers?: unknown[];
    insider_trades?: unknown[];
    source_metadata?: Record<string, string>;
    data_quality?: Record<string, UnifiedDataQualityEntry>;
    completeness?: UnifiedCompleteness;
}
