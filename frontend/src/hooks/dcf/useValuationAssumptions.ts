import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
    Assumptions,
    ComparableCompany,
    NativeFinancialsPayload,
    Overrides,
    PrecedentTransaction,
    RevenueBuild as RevenueBuildData,
} from '@/core/types';
import type { UnifiedResponse } from '@/hooks/useCompanyData';
import { buildBaseAssumptions, normalizeAssumptions, shouldSwitchToDerivedDiscountRate } from '@/services/dcf/assumption-policy';
import { getPrecedentTransactionsBySector } from '@/core/data/precedent-transactions';


interface MarketDataLike {
    rf?: number;
    mrp?: number;
}

function calculatePeerMedian(peers: ComparableCompany[], upperBound: number): number {
    const validPeers = peers.filter((p) => p.evEbitda > 0 && p.evEbitda < upperBound);
    if (validPeers.length === 0) return 12.0;
    const sorted = validPeers.map((p) => p.evEbitda).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function useValuationAssumptions(companyData: UnifiedResponse | null, currentTicker: string | null, marketData: MarketDataLike | null) {
    const initializedTickerRef = useRef<string | null>(null);
    const hasProcessedInitialCompsRef = useRef(false);

    const [assumptions, setAssumptions] = useState<Assumptions | null>(null);
    const [overrides, setOverrides] = useState<Overrides>({});
    const [comparableCompanies, setComparableCompanies] = useState<ComparableCompany[]>([]);
    const [precedentTransactions, setPrecedentTransactions] = useState<PrecedentTransaction[]>([]);
    const [revenueBuildData, setRevenueBuildData] = useState<RevenueBuildData | undefined>(undefined);

    const historicals = companyData?.financials || null;
    const financialsNative: NativeFinancialsPayload | null = companyData?.financialsNative || null;
    const company = companyData?.profile || null;

    const initialPeerMedian = useMemo(() => calculatePeerMedian(companyData?.peers || [], 100), [companyData?.peers]);

    useEffect(() => {
        if (!companyData || !currentTicker) {
            initializedTickerRef.current = null;
            return;
        }

        const loadedTicker = companyData.profile?.ticker?.trim().toUpperCase() || null;
        if (!loadedTicker || loadedTicker !== currentTicker) {
            initializedTickerRef.current = null;
            return;
        }
        if (initializedTickerRef.current === loadedTicker) return;

        initializedTickerRef.current = loadedTicker;

        const baseAssumptions = buildBaseAssumptions(
            companyData.financials,
            { rf: marketData?.rf, mrp: marketData?.mrp },
            initialPeerMedian,
            companyData.profile,
        );

        let isCancelled = false;
        Promise.resolve().then(() => {
            if (isCancelled) return;
            if (initializedTickerRef.current !== loadedTicker) return;
            setAssumptions(normalizeAssumptions(baseAssumptions, companyData.financials.sharesOutstanding || 0, companyData.financials));
            setComparableCompanies(companyData.peers || []);
            setPrecedentTransactions(getPrecedentTransactionsBySector(companyData.profile?.sector || 'Technology'));
            setOverrides({});
        });

        return () => {
            isCancelled = true;
        };
    }, [companyData, currentTicker, marketData?.rf, marketData?.mrp, initialPeerMedian]);

    useEffect(() => {
        if (!comparableCompanies || comparableCompanies.length === 0) {
            hasProcessedInitialCompsRef.current = false;
            return;
        }

        if (!hasProcessedInitialCompsRef.current) {
            hasProcessedInitialCompsRef.current = true;
            return;
        }

        const peerMedian = calculatePeerMedian(comparableCompanies, 50);
        Promise.resolve().then(() => {
            setAssumptions((prev) => {
                if (!prev) return null;
                if (Math.abs(prev.terminalExitMultiple - peerMedian) < 0.1) return prev;
                return { ...prev, terminalExitMultiple: peerMedian };
            });
        });
    }, [comparableCompanies]);

    useEffect(() => {
        if (!companyData || !currentTicker) return;
        const loadedTicker = companyData.profile?.ticker?.trim().toUpperCase() || null;
        if (!loadedTicker || loadedTicker !== currentTicker) return;

        const incomingPeers = companyData.peers || [];
        Promise.resolve().then(() => {
            setComparableCompanies((prev) => {
                if (incomingPeers.length === 0 && prev.length > 0) {
                    return prev;
                }

                const prevSelection = new Map(prev.map((p) => [p.ticker, p.isSelected]));
                const merged = incomingPeers.map((peer) => ({
                    ...peer,
                    isSelected: prevSelection.get(peer.ticker) ?? peer.isSelected ?? true,
                }));

                const prevSig = prev.map((p) => `${p.ticker}:${p.evEbitda}:${p.evRevenue}:${p.isSelected}`).join('|');
                const nextSig = merged.map((p) => `${p.ticker}:${p.evEbitda}:${p.evRevenue}:${p.isSelected}`).join('|');
                return prevSig === nextSig ? prev : merged;
            });
        });
    }, [companyData, currentTicker]);

    const updateAssumption = useCallback((key: keyof Assumptions, val: number | string | boolean) => {
        if (key === 'revenueGrowth' && typeof val === 'number') {
            setAssumptions((prev) => {
                if (!prev) return null;
                return normalizeAssumptions({
                    ...prev,
                    [key]: val,
                    revenueGrowthStage1: val,
                }, historicals?.sharesOutstanding || 0, historicals);
            });
            return;
        }

        setAssumptions((prev) => {
            if (!prev) return null;
            const next = { ...prev, [key]: val } as Assumptions;
            if (key === 'wacc' && typeof val === 'number') {
                next.discountRateMode = 'manual';
            } else if (shouldSwitchToDerivedDiscountRate(key)) {
                next.discountRateMode = 'derived';
            }
            return normalizeAssumptions(next, historicals?.sharesOutstanding || 0, historicals);
        });
    }, [historicals]);

    const updateAssumptions = useCallback((patch: Partial<Assumptions>) => {
        setAssumptions((prev) => {
            if (!prev) return null;
            const next = { ...prev, ...patch } as Assumptions;
            if (Object.keys(patch).some((key) => shouldSwitchToDerivedDiscountRate(key as keyof Assumptions))) {
                next.discountRateMode = 'derived';
            }
            return normalizeAssumptions(next, historicals?.sharesOutstanding || 0, historicals);
        });
    }, [historicals]);

    const applyRevenueBuildData = useCallback((data: RevenueBuildData) => {
        setRevenueBuildData(data);

        const latestHistoricalYear = historicals?.years?.[historicals.years.length - 1];
        if (!latestHistoricalYear || !Array.isArray(data.projectedRevenue) || data.projectedRevenue.length === 0) {
            return;
        }

        setOverrides((prev) => {
            const next: Overrides = { ...prev };
            const projectionYears = data.projectedRevenue.map((_, idx) => latestHistoricalYear + idx + 1);

            // Clear prior revenue-build overrides while preserving other manual line-item overrides.
            for (let year = latestHistoricalYear + 1; year <= latestHistoricalYear + 15; year += 1) {
                const current = next[year];
                if (!current) continue;
                const rest = { ...current };
                delete rest.revenue;
                delete rest.revenueGrowth;
                if (Object.keys(rest).length === 0) {
                    delete next[year];
                } else {
                    next[year] = rest;
                }
            }

            projectionYears.forEach((year, idx) => {
                const projectedRevenue = data.projectedRevenue[idx];
                if (!Number.isFinite(projectedRevenue) || projectedRevenue <= 0) return;
                const previousRevenue = idx === 0
                    ? (historicals?.revenue?.[historicals.revenue.length - 1] || 0)
                    : (data.projectedRevenue[idx - 1] || 0);
                const impliedGrowth = previousRevenue > 0 ? (projectedRevenue - previousRevenue) / previousRevenue : 0;

                next[year] = {
                    ...next[year],
                    revenue: projectedRevenue,
                    revenueGrowth: impliedGrowth,
                };
            });

            return next;
        });

        const firstProjectedRevenue = data.projectedRevenue[0] || 0;
        const baseRevenue = historicals?.revenue?.[historicals.revenue.length - 1] || 0;
        const firstYearGrowth = baseRevenue > 0 && firstProjectedRevenue > 0
            ? (firstProjectedRevenue - baseRevenue) / baseRevenue
            : 0;

        updateAssumptions({
            revenueGrowth: firstYearGrowth,
            revenueGrowthStage1: firstYearGrowth,
        });
    }, [historicals, updateAssumptions]);

    const resetWorkspace = useCallback(() => {
        initializedTickerRef.current = null;
        hasProcessedInitialCompsRef.current = false;
        setAssumptions(null);
        setOverrides({});
        setComparableCompanies([]);
        setPrecedentTransactions([]);
        setRevenueBuildData(undefined);
    }, []);

    return {
        company,
        historicals,
        financialsNative,
        modelEligibility: companyData?.modelEligibility,
        assumptions,
        overrides,
        comparableCompanies,
        precedentTransactions,
        revenueBuildData,
        updateAssumption,
        updateAssumptions,
        setAssumptions,
        setOverrides,
        setComparableCompanies,
        setPrecedentTransactions,
        setRevenueBuildData: applyRevenueBuildData,
        resetWorkspace,
    };
}
