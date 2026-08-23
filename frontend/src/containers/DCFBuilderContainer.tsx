"use client";

import { useEffect, useState, useRef, useCallback } from 'react';
import { useDCFModel } from '@/hooks/useDCFModel';
import { ValuationDashboard } from '@/components/features/valuation/ValuationDashboard';
import { OfflineBadge } from '@/components/ui/OfflineBadge';
import { buildExportPayload } from '@/services/exporters/excel';

/** Scenario cycle order for keyboard shortcut toggling */
const SCENARIO_CYCLE: Array<'base' | 'conservative' | 'aggressive'> = ['base', 'conservative', 'aggressive'];

/** Returns true when the user is actively typing in an input field */
function isTypingElement(e: Event): boolean {
    const target = e.target as HTMLElement;
    if (!target) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if (target.isContentEditable) return true;
    return false;
}

function readRouteParams() {
    if (typeof window === 'undefined') {
        return { ticker: undefined, view: undefined };
    }

    const params = new URLSearchParams(window.location.search);
    const ticker = params.get('ticker')?.trim().toUpperCase() || undefined;
    const view = params.get('view') || undefined;
    return { ticker, view };
}

export function DCFBuilderContainer() {
    const { state, actions } = useDCFModel();
    const [routeParams, setRouteParams] = useState<{ ticker?: string; view?: string }>({});

    // High-Value UI State (Keep UI state local)
    const [showDiagnostics, setShowDiagnostics] = useState(false);
    const [showFlow, setShowFlow] = useState(false);

    // Toast state
    const [toast, setToast] = useState<{ msg: string; type: 'error' | 'success' } | null>(null);
    const prevErrorRef = useRef<string | null>(null);
    const themeAnimationTimeoutRef = useRef<number | null>(null);

    // Sync hook error to toast
    useEffect(() => {
        if (state.error && state.error !== prevErrorRef.current) {
            prevErrorRef.current = state.error;
            setToast({ msg: state.error, type: 'error' });
        } else if (!state.error && prevErrorRef.current) {
            prevErrorRef.current = null;
        }
    }, [state.error]);

    // Auto-clear toast
    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    // Dark mode state
    const [isDarkMode, setIsDarkMode] = useState(true);
    const [mounted, setMounted] = useState(false);

    // Load dark mode preference from localStorage
    useEffect(() => {
        setMounted(true);
        const saved = localStorage.getItem('dcf-dark-mode');
        if (saved) {
            setIsDarkMode(saved === 'true');
        } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            setIsDarkMode(true);
        }
    }, []);

    // Apply dark/light mode class to document
    useEffect(() => {
        if (!mounted) return;
        document.documentElement.classList.toggle('dark', isDarkMode);
        document.documentElement.classList.toggle('light', !isDarkMode);
        localStorage.setItem('dcf-dark-mode', String(isDarkMode));
    }, [isDarkMode, mounted]);

    // Toggle dark mode
    const toggleDarkMode = useCallback(() => {
        document.documentElement.classList.add('theme-animating');
        if (themeAnimationTimeoutRef.current !== null) {
            window.clearTimeout(themeAnimationTimeoutRef.current);
        }
        themeAnimationTimeoutRef.current = window.setTimeout(() => {
            document.documentElement.classList.remove('theme-animating');
            themeAnimationTimeoutRef.current = null;
        }, 140);
        setIsDarkMode(prev => !prev);
    }, []);

    useEffect(() => {
        return () => {
            if (themeAnimationTimeoutRef.current !== null) {
                window.clearTimeout(themeAnimationTimeoutRef.current);
            }
            document.documentElement.classList.remove('theme-animating');
        };
    }, []);

    const { company, historicals, assumptions, results, overrides, comparableCompanies, precedentTransactions, revenueBuildData } = state;
    const initialView = routeParams.view;

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const syncRouteParams = () => setRouteParams(readRouteParams());
        syncRouteParams();
        window.addEventListener('popstate', syncRouteParams);
        return () => window.removeEventListener('popstate', syncRouteParams);
    }, []);

    useEffect(() => {
        const tickerParam = routeParams.ticker;
        if (!tickerParam) return;
        if (company?.ticker?.trim().toUpperCase() === tickerParam) return;
        actions.loadCompany(tickerParam);
    }, [routeParams.ticker, company?.ticker, actions]);

    // Handle Excel export
    const handleExcelExport = useCallback(async () => {
        if (!company || !historicals || !assumptions || !results) {
            setToast({ msg: 'Please load a company first', type: 'error' });
            return;
        }

        try {
            // Build the export payload
            const payload = buildExportPayload(
                company,
                historicals,
                assumptions,
                results,
                comparableCompanies.length > 0 ? comparableCompanies : undefined,
                precedentTransactions.length > 0 ? precedentTransactions : undefined,
                revenueBuildData,
                overrides
            );

            // Call the API endpoint
            const response = await fetch('/api/dcf/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Export failed');
            }

            // Get the blob and download
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const contentDisposition = response.headers.get('content-disposition') || '';
            const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
            const fallbackTicker = company.ticker?.trim().toLowerCase() || 'ticker';
            const fallbackName = `${fallbackTicker}_dcf.xlsx`;
            a.download = filenameMatch?.[1] || fallbackName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            setToast({ msg: 'Excel exported successfully!', type: 'success' });
        } catch (error) {
            console.error('Export error:', error);
            setToast({ msg: error instanceof Error ? error.message : 'Failed to export Excel', type: 'error' });
        }
    }, [company, historicals, assumptions, results, overrides, comparableCompanies, precedentTransactions, revenueBuildData]);

    // Handle markdown export
    const handleMarkdownExport = useCallback(() => {
        if (!company || !historicals || !assumptions || !results) {
            setToast({ msg: 'Please load a company first', type: 'error' });
            return;
        }
        // The markdown export is handled directly in the CompanyOverviewPage component
    }, [company, historicals, assumptions, results]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const isCmdOrCtrl = e.metaKey || e.ctrlKey;

            // Cmd/Ctrl + K → Focus Search Bar
            if (isCmdOrCtrl && e.key === 'k' && !e.shiftKey) {
                e.preventDefault();
                const searchInput = document.getElementById('dcf-search-input');
                if (searchInput) {
                    searchInput.focus();
                    (searchInput as HTMLInputElement).select();
                }
                return;
            }

            // Cmd/Ctrl + E → Export Excel
            if (isCmdOrCtrl && e.key === 'e' && !e.shiftKey) {
                e.preventDefault();
                handleExcelExport();
                return;
            }

            // Cmd/Ctrl + R → Reset assumptions
            if (isCmdOrCtrl && e.key === 'r' && !e.shiftKey) {
                e.preventDefault();
                actions.resetToDefaults();
                setToast({ msg: 'Assumptions reset to defaults', type: 'success' });
                return;
            }

            // Cmd/Ctrl + D → Toggle Dark Mode
            if (isCmdOrCtrl && e.key === 'd' && !e.shiftKey) {
                e.preventDefault();
                toggleDarkMode();
                return;
            }

            // Skip single-key shortcuts when typing in a text field
            if (isTypingElement(e)) return;

            // / → Cycle scenario: base → conservative → aggressive → base
            if (e.key === '/') {
                e.preventDefault();
                const currentIdx = SCENARIO_CYCLE.indexOf(state.activeScenario);
                const nextIdx = (currentIdx + 1) % SCENARIO_CYCLE.length;
                const nextScenario = SCENARIO_CYCLE[nextIdx];
                actions.applyScenario(nextScenario);
                setToast({ msg: `Scenario: ${nextScenario}`, type: 'success' });
                return;
            }

            // E → Trigger Excel Export
            if (e.key === 'e' && !e.shiftKey) {
                e.preventDefault();
                handleExcelExport();
                return;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleExcelExport, actions, toggleDarkMode, state.activeScenario]);

    // Handle search submission
    const handleSearch = useCallback((ticker: string) => {
        const normalizedTicker = ticker.trim().toUpperCase();
        if (!normalizedTicker) return;

        actions.loadCompany(normalizedTicker);
        setRouteParams((prev) => ({ ...prev, ticker: normalizedTicker }));

        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            params.set('ticker', normalizedTicker);
            const currentView = routeParams.view;
            if (currentView && currentView !== 'Overview') {
                params.set('view', currentView);
            } else {
                params.delete('view');
            }
            window.history.replaceState({}, '', `/?${params.toString()}`);
        }
    }, [actions, routeParams.view]);

    const handleViewChange = useCallback((view: string) => {
        const normalizedView = view === 'Overview' ? undefined : view;
        setRouteParams((prev) => ({ ...prev, view: normalizedView }));

        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            const currentTicker = company?.ticker?.trim().toUpperCase() || routeParams.ticker;
            if (currentTicker) {
                params.set('ticker', currentTicker);
            }
            if (normalizedView) {
                params.set('view', normalizedView);
            } else {
                params.delete('view');
            }
            const query = params.toString();
            window.history.replaceState({}, '', query ? `/?${query}` : '/');
        }
    }, [company?.ticker, routeParams.ticker]);

    const handleGoHome = useCallback(() => {
        actions.clearCompany();
        setRouteParams({});
        if (typeof window !== 'undefined') {
            window.history.replaceState({}, '', '/');
        }
    }, [actions]);

    const dashboardActions = {
        ...actions,
        clearCompany: handleGoHome,
    };

    return (
        <>
        <ValuationDashboard
            state={state}
            actions={dashboardActions}
            ui={{
                isDarkMode,
                toggleDarkMode,
                showDiagnostics,
                setShowDiagnostics,
                showFlow,
                setShowFlow,
                toast
            }}
             onSearch={handleSearch}
             onExcelExport={handleExcelExport}
             onMarkdownExport={handleMarkdownExport}
             isExporting={state.loading}
             initialView={initialView}
             onViewChange={handleViewChange}
        />
        <OfflineBadge />
        </>
    );
}
