
"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    CompanyProfile,
    ComparableCompany,
    HistoricalData,
    NativeFinancialsPayload,
    NativeValuationContextPayload,
    NativeUnifiedPayload,
    UnifiedCompleteness,
    UnifiedDataQualityEntry,
} from "@/core/types";
import {
    hasUsableNativeFinancials,
    mapNativeFinancialsToHistoricals,
    mapNativeProfile,
} from "@/services/integration/sec/native-normalizer";
import {
    cacheCompanyResponse,
    getCachedCompanyResponse,
    enqueueOfflineTicker,
} from "@/hooks/useOfflineSync";
import { Logger } from "@/core/logger";

export interface UnifiedResponse {
    rawNative: NativeUnifiedPayload;
    profile: CompanyProfile;
    financialsNative: NativeFinancialsPayload;
    canonicalFinancials?: Record<string, unknown>;
    modelEligibility?: NativeUnifiedPayload["model_eligibility"];
    financials: HistoricalData;
    peers: ComparableCompany[];
    marketContext?: {
        riskFreeRate: number;
        equityRiskPremium: number;
        lastUpdated: number;
        source?: string;
    };
    valuationContext?: NativeValuationContextPayload;
    dataQuality?: Record<string, UnifiedDataQualityEntry>;
    completeness?: UnifiedCompleteness;
    degradedReason?: string | null;
    marketData?: {
        rf: number;
        mrp: number;
    };
    insider_trades?: unknown[];
    source_metadata?: Record<string, string>;
}

export interface CompanyLoadTiming {
    ticker: string;
    startedAt: number;
    endedAt: number;
    durationMs: number;
    upstreamTimeMs: number;
    cacheHit: boolean;
    dataSource: string;
}

const MIN_USABLE_HISTORY_YEARS = 1;

const toFiniteNumber = (value: unknown, fallback = 0): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const normalizePeers = (rawPeers: unknown): ComparableCompany[] => {
    if (!Array.isArray(rawPeers)) return [];

    const toNum = (value: unknown, fallback = 0): number => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    return rawPeers
        .map((item) => asRecord(item))
        .map((peer) => {
            const ticker = String(peer.ticker || peer.symbol || "").trim().toUpperCase();
            if (!ticker) return null;

            return {
                ticker,
                name: String(peer.name || ticker),
                sector: String(peer.sector || ""),
                industry: String(peer.industry || ""),
                marketCap: toNum(peer.marketCap ?? peer.market_cap),
                enterpriseValue: toNum(peer.enterpriseValue ?? peer.enterprise_value),
                evRevenue: toNum(peer.evRevenue ?? peer.ev_revenue),
                evEbitda: toNum(peer.evEbitda ?? peer.ev_ebitda),
                peRatio: toNum(peer.peRatio ?? peer.pe_ratio),
                pbRatio: toNum(peer.pbRatio ?? peer.pb_ratio),
                revenue: toNum(peer.revenue),
                ebitda: toNum(peer.ebitda),
                revenueGrowth: toNum(peer.revenueGrowth ?? peer.revenue_growth),
                ebitdaMargin: toNum(peer.ebitdaMargin ?? peer.margin),
                currency: peer.currency ? String(peer.currency) : undefined,
                beta: toNum(peer.beta),
                totalDebt: toNum(peer.totalDebt ?? peer.total_debt),
                cash: toNum(peer.cash),
                taxRate: toNum(peer.taxRate ?? peer.tax_rate),
                price: toNum(peer.price),
                sharesOutstanding: toNum(peer.sharesOutstanding ?? peer.shares_outstanding),
                isSelected: Boolean(peer.isSelected ?? true),
            } as ComparableCompany;
        })
        .filter((peer): peer is ComparableCompany => Boolean(peer));
};

function mapNativeUnifiedToCompanyData(rawPayload: unknown): UnifiedResponse {
    const payloadRecord = asRecord(rawPayload);
    if (!payloadRecord.profile || !payloadRecord.financials_native) {
        throw new Error("Invalid native payload: missing profile or financials_native");
    }
    const payload = payloadRecord as unknown as NativeUnifiedPayload;
    const nativeFinancials = payload.financials_native as NativeFinancialsPayload;
    const market = asRecord(payload.market);
    const rawProfile = asRecord(payload.profile);

    const profile = mapNativeProfile(rawProfile, nativeFinancials, market);
    const financials = mapNativeFinancialsToHistoricals(nativeFinancials, market, profile);
    const valuationContextRaw = asRecord(payload.valuation_context);
    const marketContextRaw = Object.keys(valuationContextRaw).length > 0
        ? valuationContextRaw
        : asRecord(payload.market_context);
    const dataQuality = payload.data_quality || {};
    const completeness = payload.completeness;
    const valuationContext = {
        risk_free_rate: toFiniteNumber(marketContextRaw.risk_free_rate ?? marketContextRaw.riskFreeRate, 0),
        equity_risk_premium: toFiniteNumber(
            marketContextRaw.equity_risk_premium ?? marketContextRaw.equityRiskPremium,
            0
        ),
        fetched_at_ms: toFiniteNumber(
            marketContextRaw.fetched_at_ms ?? marketContextRaw.lastUpdated ?? marketContextRaw.last_updated,
            Date.now()
        ),
        treasury_rate_source: String(
            marketContextRaw.treasury_rate_source ?? marketContextRaw.treasuryRateSource ?? ""
        ) || undefined,
        erp_source: String(marketContextRaw.erp_source ?? marketContextRaw.erpSource ?? "") || undefined,
        as_of_date: String(marketContextRaw.as_of_date ?? "") || undefined,
    } as NativeValuationContextPayload;
    const degradationLevel = completeness?.degradation_level;
    const degradedReason =
        degradationLevel && degradationLevel !== "none"
            ? (
                dataQuality.financials?.status === "unavailable"
                    ? dataQuality.financials?.notes
                    : dataQuality.market?.status === "unavailable"
                        ? dataQuality.market?.notes
                        : ["default", "stale", "unavailable"].includes(
                            String(dataQuality.valuation_context?.status || "")
                        )
                            ? dataQuality.valuation_context?.notes
                            : dataQuality.peers?.status === "unavailable"
                                ? dataQuality.peers?.notes
                                : "Some valuation inputs were served from fallback or unavailable sources."
            )
            : null;

    return {
        rawNative: payload,
        profile,
        financialsNative: nativeFinancials,
        canonicalFinancials: payload.canonical_financials,
        modelEligibility: payload.model_eligibility,
        financials,
        peers: normalizePeers(payload.peers),
        marketContext: {
            riskFreeRate: valuationContext.risk_free_rate,
            equityRiskPremium: valuationContext.equity_risk_premium,
            lastUpdated: valuationContext.fetched_at_ms,
            source: valuationContext.treasury_rate_source ?? valuationContext.erp_source,
        },
        valuationContext,
        marketData: {
            rf: valuationContext.risk_free_rate,
            mrp: valuationContext.equity_risk_premium,
        },
        dataQuality,
        completeness,
        degradedReason,
        insider_trades: Array.isArray(payload.insider_trades) ? payload.insider_trades : [],
        source_metadata: (payload.source_metadata || {}) as Record<string, string>,
    };
}

export function useCompanyData(ticker: string | null) {
    const normalizedTicker = ticker?.trim().toUpperCase() || null;
    const [lastLoadTiming, setLastLoadTiming] = useState<CompanyLoadTiming | null>(null);
    const requestStartedAtRef = useRef<number | null>(null);
    const responseMetaRef = useRef<{ upstreamTimeMs: number; cacheHit: boolean; dataSource: string } | null>(null);

    const query = useQuery({
        queryKey: ["company-v2", normalizedTicker],
        queryFn: async ({ signal }) => {
            if (!normalizedTicker) return null;
            requestStartedAtRef.current = Date.now();
            try {
                const response = await fetch(`/api/sec/company?ticker=${normalizedTicker}`, {
                    cache: 'no-store',
                    headers: {
                        'Cache-Control': 'no-cache',
                        Pragma: 'no-cache'
                    },
                    signal,
                });
                // Capture X-Request-ID for correlation with backend logs
                const requestId = response.headers.get("X-Request-ID") || undefined;

                const upstreamTimeMs = Number(response.headers.get("X-Upstream-Time-Ms") || "0");
                const cacheHit = response.headers.get("X-Cache-Hit") === "true";
                const dataSource = response.headers.get("X-Data-Source") || "unknown";
                responseMetaRef.current = {
                    upstreamTimeMs: Number.isFinite(upstreamTimeMs) ? upstreamTimeMs : 0,
                    cacheHit,
                    dataSource
                };
                if (!response.ok) {
                    let message = "Failed to fetch company data";
                    try {
                        const data = await response.json();
                        message = data.error || message;
                    } catch {
                        message = `${response.status} ${response.statusText}`;
                    }
                    Logger.error(`Company data fetch failed for ${normalizedTicker}: ${message}`, undefined, {
                        "x-request-id": requestId || "",
                        ticker: normalizedTicker,
                        status: String(response.status),
                    });
                    throw new Error(message);
                }
                const nativePayload = await response.json();
                if (
                    !hasUsableNativeFinancials(nativePayload, MIN_USABLE_HISTORY_YEARS)
                ) {
                    throw new Error("Upstream payload did not include usable native financials");
                }
                const mapped = mapNativeUnifiedToCompanyData(nativePayload);
                // Cache successful response for offline fallback
                cacheCompanyResponse(normalizedTicker, mapped);
                return mapped;
            } catch (err) {
                // Network failure or server unreachable – try localStorage cache
                if (!navigator.onLine) {
                    const cached = getCachedCompanyResponse<UnifiedResponse>(normalizedTicker);
                    if (cached) {
                        Logger.info(`Offline cache hit for ${normalizedTicker}`);
                        enqueueOfflineTicker(normalizedTicker);
                        return cached;
                    }
                }
                enqueueOfflineTicker(normalizedTicker);
                throw err;
            }
        },
        enabled: !!normalizedTicker,
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: (failureCount, error) => {
            const msg = error instanceof Error ? error.message : "";
            if (/not found|404/i.test(msg)) return false;
            return failureCount < 1;
        },
    });

    useEffect(() => {
        if (!normalizedTicker || !query.dataUpdatedAt) return;
        const startedAt = requestStartedAtRef.current;
        if (!startedAt) return;

        const endedAt = Date.now();
        const durationMs = Math.max(0, endedAt - startedAt);
        const meta = responseMetaRef.current;
        setLastLoadTiming({
            ticker: normalizedTicker,
            startedAt,
            endedAt,
            durationMs,
            upstreamTimeMs: meta?.upstreamTimeMs ?? 0,
            cacheHit: meta?.cacheHit ?? false,
            dataSource: meta?.dataSource ?? "unknown"
        });

        requestStartedAtRef.current = null;
        responseMetaRef.current = null;
    }, [normalizedTicker, query.dataUpdatedAt]);

    return {
        ...query,
        isRefreshing: Boolean(normalizedTicker && query.isFetching && query.data),
        lastLoadTiming
    };
}
