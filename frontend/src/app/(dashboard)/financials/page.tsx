'use client';

import { useEffect, useRef, useState, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDCFModel } from '@/hooks/useDCFModel';
import { FinancialStatements } from '@/components/features/statements/FinancialStatements';
import { SideNav } from '@/components/layout/SideNav';
import { TopNav } from '@/components/layout/TopNav';
import { Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/core/utils/cn';

function FinancialsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { state, actions } = useDCFModel();
    const { loadCompany } = actions;
    const [isDarkMode, setIsDarkMode] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const themeAnimationTimeoutRef = useRef<number | null>(null);
    const tickerParam = searchParams.get('ticker')?.trim().toUpperCase() || 'NVDA';

    // Initial load based on URL ticker
    useEffect(() => {
        loadCompany(tickerParam);
    }, [loadCompany, tickerParam]);

    useEffect(() => {
        const saved = localStorage.getItem('dcf-dark-mode');
        if (saved !== null) {
            setIsDarkMode(saved === 'true');
        } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            setIsDarkMode(true);
        } else {
            setIsDarkMode(false);
        }
    }, []);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', isDarkMode);
        document.documentElement.classList.toggle('light', !isDarkMode);
        localStorage.setItem('dcf-dark-mode', String(isDarkMode));
    }, [isDarkMode]);

    const handleToggleDarkMode = useCallback(() => {
        document.documentElement.classList.add('theme-animating');
        if (themeAnimationTimeoutRef.current !== null) {
            window.clearTimeout(themeAnimationTimeoutRef.current);
        }
        themeAnimationTimeoutRef.current = window.setTimeout(() => {
            document.documentElement.classList.remove('theme-animating');
            themeAnimationTimeoutRef.current = null;
        }, 140);
        setIsDarkMode((prev) => !prev);
    }, []);

    const handleSearch = useCallback((ticker: string) => {
        const normalizedTicker = ticker.trim().toUpperCase();
        if (!normalizedTicker) return;
        loadCompany(normalizedTicker);
        router.replace(`/financials?ticker=${encodeURIComponent(normalizedTicker)}`);
    }, [loadCompany, router]);

    useEffect(() => {
        return () => {
            if (themeAnimationTimeoutRef.current !== null) {
                window.clearTimeout(themeAnimationTimeoutRef.current);
            }
            document.documentElement.classList.remove('theme-animating');
        };
    }, []);

    return (
        <div className={cn(
            "financials-page-shell flex app-viewport overflow-hidden",
            "bg-[var(--bg-base)] text-[var(--text-primary)] selection:bg-[#0066FF]/30"
        )}>
            {/* 1. Global Navigation */}
            {!isFullscreen && (
                <div className="app-hide-on-mobile">
                    <SideNav
                        activeSection="Financials"
                        companyName={state.company?.name || "Loading..."}
                        ticker={state.company?.ticker || "..."}
                        onNavigate={(section) => {
                            if (section === 'Financials') return;
                            const ticker = (state.company?.ticker || tickerParam).trim().toUpperCase();
                            const params = new URLSearchParams({ ticker });
                            if (section !== 'Overview') {
                                params.set('view', section);
                            }
                            router.push(`/?${params.toString()}`);
                        }}
                    />
                </div>
            )}

            {/* 2. Main Content Area */}
            <div className="financials-page-workspace flex-1 flex flex-col min-w-0 transition-all duration-300 relative">

                {/* Top Navigation / Search */}
                {!isFullscreen && (
                    <TopNav
                        isLoading={state.loading}
                        onSearch={handleSearch}
                        isDarkMode={isDarkMode}
                        onToggleDarkMode={handleToggleDarkMode}
                        hasCompany={!!state.company}
                        healthScore={98} // Placeholder for now
                    />
                )}

                {/* Main Workspace */}
                <main className="financials-page-main flex-1 overflow-hidden relative">
                    {state.loading && !state.historicals ? (
                        // Loading State
                        <div className={cn(
                            "absolute inset-0 z-50 flex items-center justify-center backdrop-blur-sm",
                            isDarkMode ? "bg-black/50" : "bg-white/72"
                        )}>
                            <div className="flex flex-col items-center gap-3">
                                <Loader2 className="w-8 h-8 text-[#0066FF] animate-spin" />
                                <span className={cn(
                                    "text-[13px] font-medium",
                                    isDarkMode ? "text-white/50" : "text-black/50"
                                )}>Loading Financial Data...</span>
                            </div>
                        </div>
                    ) : state.error ? (
                        // Error State
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="flex flex-col items-center gap-4 text-center max-w-md px-6">
                                <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
                                    <AlertCircle className="w-6 h-6 text-[#FF453A]" />
                                </div>
                                <h3 className={cn(
                                    "text-[17px] font-semibold",
                                    isDarkMode ? "text-white" : "text-[var(--text-primary)]"
                                )}>Unable to load company data</h3>
                                <p className={cn(
                                    "text-[13px]",
                                    isDarkMode ? "text-white/50" : "text-[var(--text-secondary)]"
                                )}>{state.error}</p>
                                <button
                                    onClick={() => actions.loadCompany(state.company?.ticker || 'NVDA')}
                                    className={cn(
                                        "px-4 py-2 rounded-lg text-[13px] font-medium transition-colors",
                                        isDarkMode
                                            ? "bg-[#1C1C1E] border border-white/10 hover:bg-[#2C2C2E]"
                                            : "bg-white border border-[rgba(15,23,42,0.12)] text-[var(--text-primary)] hover:bg-[rgba(15,23,42,0.04)]"
                                    )}
                                >
                                    Try Again
                                </button>
                            </div>
                        </div>
                    ) : state.historicals && state.results ? (
                        // SUCCESS STATE: Render the Financial Statements Workspace
                        <FinancialStatements
                            historicals={state.historicals}
                            financialsNative={state.financialsNative}
                            results={state.results}
                            assumptions={state.assumptions}
                            activeScenario={state.activeScenario}
                            onUpdateAssumption={actions.updateAssumption}
                            onApplyScenario={actions.applyScenario}
                            onResetToDefaults={actions.resetToDefaults}
                            companyName={state.company?.name}
                            isDarkMode={isDarkMode}
                            isFullscreen={isFullscreen}
                            onToggleFullscreen={setIsFullscreen}
                        />
                    ) : (
                        // Empty State (Shouldn't happen often)
                        <div className={cn(
                            "flex-1 flex items-center justify-center text-[13px]",
                            isDarkMode ? "text-white/30" : "text-[var(--text-secondary)]"
                        )}>
                            Search for a company to begin analysis
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}

export default function FinancialsPage() {
    return (
        <Suspense fallback={
            <div className="financials-page-shell flex app-viewport overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
                <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-[#0066FF] animate-spin" />
                </div>
            </div>
        }>
            <FinancialsContent />
        </Suspense>
    );
}
