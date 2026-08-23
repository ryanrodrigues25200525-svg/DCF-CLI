"use client";

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/core/utils/cn';
import { TopNav } from '@/components/layout/TopNav';
import { SideNav } from '@/components/layout/SideNav';
import { DealDashboard } from '@/components/layout/DealDashboard';
import { HeroCover } from '@/components/layout/HeroCover';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
// Components are lazy loaded below for performance
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import {
  buildRevenuePoints,
  calculateHealthScore,
  getCurrentRevenue,
  getLastValidBookDebt,
  resolveInitialValuationView,
} from '@/components/features/valuation/valuation-dashboard.utils';
import {
  DCFResults,
  CompanyProfile,
  HistoricalData,
  Assumptions,
  Overrides,
  ModelDiagnostic,
  ComparableCompany,
  PrecedentTransaction,
  RevenueBuild as RevenueBuildData,
  NativeFinancialsPayload,
  NativeValuationContextPayload,
  UnifiedCompleteness,
  UnifiedDataQualityEntry,
} from '@/core/types';

import { useState, useMemo, lazy, Suspense, useEffect, useRef } from 'react';

// Lazy load page components for better initial performance
const loadCompanyOverviewPage = () => import('@/components/dashboard/CompanyOverviewPage');
const loadCompsTableInstitutional = () => import('@/components/features/valuation/CompsTableInstitutional');
const loadPrecedentTransactions = () => import('@/components/features/valuation/PrecedentTransactions');
const loadSensitivityAnalysis = () => import('@/components/features/analysis/SensitivityAnalysis');
const loadRevenueBuild = () => import('@/components/features/analysis/RevenueBuild');
const loadWACCBuild = () => import('@/components/features/analysis/WACCBuild');
const loadReverseDCF = () => import('@/components/features/analysis/ReverseDCF');
const loadFinancialStatements = () => import('@/components/features/statements/FinancialStatements');

const CompanyOverviewPage = lazy(() => loadCompanyOverviewPage().then(m => ({ default: m.CompanyOverviewPage })));
const CompsTableInstitutional = lazy(() => loadCompsTableInstitutional().then(m => ({ default: m.CompsTableInstitutional })));
const PrecedentTransactions = lazy(() => loadPrecedentTransactions().then(m => ({ default: m.PrecedentTransactions })));
const SensitivityAnalysis = lazy(() => loadSensitivityAnalysis().then(m => ({ default: m.SensitivityAnalysis })));
const RevenueBuild = lazy(() => loadRevenueBuild().then(m => ({ default: m.RevenueBuild })));
const WACCBuild = lazy(() => loadWACCBuild().then(m => ({ default: m.WACCBuild })));
const ReverseDCF = lazy(() => loadReverseDCF().then(m => ({ default: m.ReverseDCF })));
const FinancialStatements = lazy(() => loadFinancialStatements().then(m => ({ default: m.FinancialStatements })));

interface ValuationDashboardProps {
  state: {
    company: CompanyProfile | null;
    historicals: HistoricalData | null;
    financialsNative?: NativeFinancialsPayload | null;
    valuationContext?: NativeValuationContextPayload | null;
    dataQuality?: Record<string, UnifiedDataQualityEntry> | null;
    completeness?: UnifiedCompleteness | null;
    degradedReason?: string | null;
    assumptions: Assumptions | null;
    results: DCFResults | null;
    overrides: Overrides;
    loading: boolean;
    isRefreshingCompany?: boolean;
    companyLoadTiming?: {
      durationMs: number;
      upstreamTimeMs: number;
      cacheHit: boolean;
      dataSource: string;
    } | null;
    diagnostics: ModelDiagnostic[];
    revenueBuildData?: RevenueBuildData;
    comparableCompanies: ComparableCompany[];
    precedentTransactions: PrecedentTransaction[];
    activeScenario: 'base' | 'conservative' | 'aggressive';
  };
  actions: {
    loadCompany: (ticker: string) => void;
    updateAssumption: (key: keyof Assumptions, value: number | string | boolean) => void;
    updateAssumptions: (patch: Partial<Assumptions>) => void;
    applyScenario: (type: 'base' | 'conservative' | 'aggressive') => void;
    resetToDefaults: () => void;
    clearCompany: () => void;
    setRevenueBuildData: (data: RevenueBuildData) => void;
    setComparableCompanies: (comps: ComparableCompany[]) => void;
    setPrecedentTransactions: (txns: PrecedentTransaction[]) => void;
  };
  ui: {
    isDarkMode: boolean;
    toggleDarkMode: () => void;
    showDiagnostics: boolean;
    setShowDiagnostics: (show: boolean) => void;
    showFlow: boolean;
    setShowFlow: (show: boolean) => void;
    toast: { msg: string; type: 'error' | 'success' } | null;
  };
   onSearch: (ticker: string) => void;
   onExcelExport?: () => void;
   onMarkdownExport?: () => void;
   isExporting?: boolean;
   initialView?: string;
   onViewChange?: (view: string) => void;
}



export function ValuationDashboard({ state, actions, ui, onSearch, onExcelExport, onMarkdownExport, isExporting, initialView, onViewChange }: ValuationDashboardProps) {
  const {
    company,
    historicals,
    financialsNative,
    completeness,
    degradedReason,
    assumptions,
    results,
    overrides,
    loading,
    isRefreshingCompany,
    diagnostics,
    comparableCompanies,
    precedentTransactions,
    activeScenario
  } = state;
  const { isDarkMode, toggleDarkMode, toast } = ui;

  const [isHealthOpen, setIsHealthOpen] = useState(false);
  const [valuationChange, setValuationChange] = useState<{ from: number; to: number; deltaPct: number } | null>(null);
  const previousImpliedSharePriceRef = useRef<number | null>(null);

  const initialResolvedView = useMemo(() => {
    return resolveInitialValuationView(initialView);
  }, [initialView]);

  const [activeView, setActiveView] = useState(initialResolvedView);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    onViewChange?.(activeView);
  }, [activeView, onViewChange]);

  useEffect(() => {
    if (!company || typeof window === 'undefined') return;

    const preloadViews = () => {
      void loadCompanyOverviewPage();
      void loadFinancialStatements();
      void loadRevenueBuild();
      void loadWACCBuild();
      void loadReverseDCF();
      void loadSensitivityAnalysis();
      void loadCompsTableInstitutional();
      void loadPrecedentTransactions();
    };

    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(preloadViews, { timeout: 1500 });
      return () => window.cancelIdleCallback(idleId);
    }

    const timeoutId = window.setTimeout(preloadViews, 300);
    return () => window.clearTimeout(timeoutId);
  }, [company]);

  useEffect(() => {
    if (!company) {
      previousImpliedSharePriceRef.current = null;
      return;
    }
    const nextPrice = results?.impliedSharePrice;
    if (results?.isValuationSupported === false) return;
    if (!Number.isFinite(nextPrice ?? NaN) || !nextPrice) return;

    const previousPrice = previousImpliedSharePriceRef.current;
    if (previousPrice === null) {
      previousImpliedSharePriceRef.current = nextPrice;
      return;
    }

    if (Math.abs(previousPrice - nextPrice) < 0.01) return;

    const deltaPct = previousPrice !== 0 ? ((nextPrice - previousPrice) / previousPrice) * 100 : 0;
    setValuationChange({ from: previousPrice, to: nextPrice, deltaPct });
    previousImpliedSharePriceRef.current = nextPrice;
  }, [company, results?.impliedSharePrice, results?.isValuationSupported]);

  const revenuePoints = useMemo(() => {
    return buildRevenuePoints(historicals);
  }, [historicals]);

  const currentRevenue = useMemo(() => {
    return getCurrentRevenue(historicals);
  }, [historicals]);

  const marketCapForWacc = useMemo(() => {
    if (company?.marketCap && company.marketCap > 0) return company.marketCap;
    const price = company?.currentPrice || historicals?.price || 0;
    const shares = historicals?.sharesOutstanding || 0;
    return price > 0 && shares > 0 ? price * shares : 0;
  }, [company, historicals]);

  const totalDebtForWacc = useMemo(() => {
    return getLastValidBookDebt(historicals);
  }, [historicals]);

  // Calculate real Health Score based on passing diagnostics
  const healthScore = useMemo(() => {
    return calculateHealthScore(diagnostics);
  }, [diagnostics]);

  const degradationTone = completeness?.degradation_level ?? 'none';
  const showDegradedBanner = Boolean(
    company &&
    degradedReason &&
    ['moderate', 'high'].includes(degradationTone)
  );

  return (
    <div className="app-viewport bg-[var(--bg-base)] text-(--text-primary) font-sans overflow-hidden flex">
      {company && !isFullscreen && (
        <div className="app-hide-on-mobile">
          <SideNav
            activeSection={activeView}
            companyName={company.name}
            ticker={company.ticker}
            isDarkMode={isDarkMode}
            results={results}
            onNavigate={(section) => {
              if (section === 'Model Inputs') {
                // Scroll to financials or handle differently since panel is integrated
                setActiveView('Financials');
              } else {
                setActiveView(section);
              }
            }}
            onGoHome={actions.clearCompany}
          />
        </div>
      )}
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {company && !isFullscreen && (
          <TopNav
            onSearch={onSearch}
            isLoading={loading}
            isRefreshingCompany={Boolean(isRefreshingCompany)}
            onToggleDarkMode={toggleDarkMode}
            isDarkMode={isDarkMode}
            hasCompany={!!company}
            healthScore={healthScore}
            onOpenHealth={() => setIsHealthOpen(true)}
          />
        )}

        {showDegradedBanner && (
          <div className="mx-6 mt-4 rounded-[14px] border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-[13px] text-amber-100">
            <div className="flex items-center gap-2 font-medium text-amber-200">
              <AlertTriangle size={14} />
              <span>Degraded inputs: {degradationTone}</span>
            </div>
            <p className="mt-1 text-[12px] text-amber-100/85">
              {degradedReason || 'Some valuation inputs were served from cached, fallback, or unavailable sources.'}
            </p>
          </div>
        )}

        {company && results && (
          <div className="sticky top-0 z-30 px-4 pt-3 pb-3 sm:px-6">
            <div className={cn(
              "overflow-hidden rounded-[30px] px-5 py-5 shadow-[0_10px_24px_rgba(23,72,181,0.18)] backdrop-blur-xl sm:px-6",
              "border border-[#4c8cff]/35 bg-[linear-gradient(135deg,#1f6fff_0%,#1a59d1_48%,#1748b5_100%)]"
            )}>
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 xl:max-w-[760px]">
                  <div className="min-w-0">
                    <p className={cn(
                      "text-[10px] font-black uppercase tracking-[0.18em]",
                      "text-white/65"
                    )}>Intrinsic Value</p>
                    <p className={cn(
                      "mt-1 text-[22px] leading-none font-black tabular-nums sm:text-[23px]",
                      "text-white"
                    )}>
                      {results.isValuationSupported === false ? 'N/A' : `$${results.impliedSharePrice.toFixed(2)}`}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className={cn(
                      "text-[10px] font-black uppercase tracking-[0.18em]",
                      "text-white/65"
                    )}>Current Price</p>
                    <p className={cn(
                      "mt-1 text-[22px] leading-none font-black tabular-nums sm:text-[23px]",
                      "text-white"
                    )}>
                      ${results.currentPrice.toFixed(2)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className={cn(
                      "text-[10px] font-black uppercase tracking-[0.18em]",
                      "text-white/65"
                    )}>Implied Potential</p>
                    <p className={cn(
                      "mt-1 text-[22px] leading-none font-black tabular-nums sm:text-[23px]",
                      results.isValuationSupported === false ? "text-amber-300" : results.upside >= 0 ? "text-emerald-500" : "text-rose-500"
                    )}>
                      {results.isValuationSupported === false ? 'N/A' : `${results.upside >= 0 ? '+' : ''}${(results.upside * 100).toFixed(1)}%`}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className={cn(
                      "text-[10px] font-black uppercase tracking-[0.18em]",
                      "text-white/65"
                    )}>Model</p>
                    <p className={cn(
                      "mt-1 text-[16px] leading-none font-black uppercase tracking-widest sm:text-[17px]",
                      "text-white"
                    )}>
                      {results.preferredModel ? results.preferredModel.replace(/_/g, ' ') : assumptions?.modelType === 'ddm' ? 'DDM' : assumptions?.modelType === 'levered' ? 'Levered DCF' : 'Unlevered DCF'}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-2 xl:items-end">
                  <div className="flex flex-wrap gap-2 rounded-full bg-[#0b3b91] px-3 py-2 shadow-[0_14px_32px_rgba(11,59,145,0.24)] xl:justify-end">
                    <span className={cn(
                      "inline-flex items-center rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em]",
                      results.isValuationSupported === false
                        ? "bg-amber-500 text-white shadow-[0_10px_24px_rgba(245,158,11,0.3)]"
                        : results.upside >= 0
                        ? "bg-emerald-500 text-white shadow-[0_10px_24px_rgba(16,185,129,0.3)]"
                        : "bg-rose-500 text-white shadow-[0_10px_24px_rgba(244,63,94,0.28)]"
                    )}>
                      {results.isValuationSupported === false ? 'Model Required' : results.upside >= 0 ? 'Undervalued' : 'Overvalued'}
                    </span>
                    <span className={cn(
                      "inline-flex items-center rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em]",
                      "bg-[#0b3b91] text-white shadow-[0_10px_24px_rgba(11,59,145,0.24)]"
                    )}>
                      {assumptions?.valuationMethod === 'multiple' ? 'Exit Multiple' : 'Gordon Growth'}
                    </span>
                    <span className={cn(
                      "inline-flex items-center rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em]",
                      "bg-[#0b3b91] text-white shadow-[0_10px_24px_rgba(11,59,145,0.24)]"
                    )}>
                      {activeScenario} case
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <AnimatePresence>
          {valuationChange && (
            <motion.div
              initial={{ opacity: 0, y: -16, x: 16 }}
              animate={{ opacity: 1, y: 0, x: 0 }}
              exit={{ opacity: 0, y: -16, x: 16 }}
              className={cn(
                "fixed top-20 right-6 z-[61] w-[min(360px,calc(100vw-2rem))] rounded-xl border px-4 py-3 shadow-[0_20px_50px_rgba(0,0,0,0.28)] backdrop-blur-xl",
                isDarkMode
                  ? "border-emerald-300/20 bg-emerald-400/12 text-emerald-100"
                  : "border-emerald-200 bg-emerald-50 text-emerald-900"
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <span className="text-[11px] font-black uppercase tracking-[0.16em]">Valuation Updated</span>
                  <p className="mt-2 text-[13px] font-semibold leading-5">
                    Implied value moved from ${valuationChange.from.toFixed(2)} to ${valuationChange.to.toFixed(2)}
                    ({valuationChange.deltaPct >= 0 ? '+' : ''}{valuationChange.deltaPct.toFixed(1)}%).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setValuationChange(null)}
                  className={cn(
                    "shrink-0 text-[11px] font-black uppercase tracking-[0.12em]",
                    isDarkMode ? "text-emerald-100/80" : "text-emerald-700"
                  )}
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          )}

          {toast && (
            <motion.div
              initial={{ opacity: 0, y: -16, x: 16 }}
              animate={{ opacity: 1, y: 0, x: 0 }}
              exit={{ opacity: 0, y: -16, x: 16 }}
              className={`fixed top-20 right-6 z-[60] px-4 py-3 rounded-lg flex items-center gap-3 text-[13px] font-medium shadow-lg backdrop-blur-md ${toast.type === 'error'
                ? 'bg-red-500/10 border border-red-500/20 text-red-500'
                : 'bg-green-500/10 border border-green-500/20 text-green-500'
                }`}
            >
              {toast.type === 'error' ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
              <span>{toast.msg}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <ErrorBoundary>
          <AnimatePresence mode="wait">
            {loading && !company ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex flex-col items-center justify-center bg-[var(--bg-base)]"
              >
                <div className="w-8 h-8 border-2 border-[var(--system-blue)]/30 border-t-[var(--system-blue)] rounded-full animate-spin" />
                <p className="text-xs text-(--text-tertiary) uppercase tracking-wider mt-4">Analyzing financial data...</p>
              </motion.div>
            ) : !company ? (
              <HeroCover
                key="hero"
                onSearch={onSearch}
                isLoading={loading}
                isDarkMode={isDarkMode}
                onToggleDarkMode={toggleDarkMode}
              />
            ) : (
              <div className="flex-1 flex overflow-hidden relative">


                {/* Main Scrollable Content */}
                <main
                  className={cn(
                    "flex-1 relative flex flex-col",
                    activeView === 'Financials' || activeView === 'Sensitivity'
                      ? cn(
                        "overflow-hidden p-0",
                        isDarkMode ? "bg-[#000000]" : "bg-[var(--bg-base)]"
                      )
                      : "overflow-auto bg-[var(--bg-base)] custom-scrollbar p-6 app-main-pad"
                  )}
                  role="main"
                  aria-label="Valuation Analysis Content"
                >
                  <div className={cn(
                    "h-full",
                    activeView !== 'Financials' &&
                    activeView !== 'Reverse DCF' &&
                    activeView !== 'Sensitivity' &&
                    activeView !== 'Comparables' &&
                    activeView !== 'Transactions' &&
                    "app-content-max space-y-8 pb-32",
                    (activeView === 'Comparables' || activeView === 'Transactions') && "w-full px-0 pb-16"
                  )}>
                    <Suspense fallback={<LoadingSkeleton />}>
                      <ErrorBoundary>
                        {/* View Switcher */}
                        {activeView === 'Overview' && company && historicals && (
                         <CompanyOverviewPage
                             company={company}
                             historicals={historicals}
                             results={results}
                             onExcelExport={onExcelExport}
                             onMarkdownExport={onMarkdownExport}
                             isExporting={isExporting}
                           />
                        )}

                        {activeView === 'Financials' && historicals && results && (
                          <FinancialStatements
                            historicals={historicals}
                            financialsNative={financialsNative}
                            results={results}
                            assumptions={assumptions}
                            isDarkMode={isDarkMode}
                            onUpdateAssumption={actions.updateAssumption}
                            onResetToDefaults={actions.resetToDefaults}
                            activeScenario={activeScenario}
                            onApplyScenario={actions.applyScenario}
                            isFullscreen={isFullscreen}
                            onToggleFullscreen={setIsFullscreen}
                          />
                        )}

                        {activeView === 'Revenue Build' && historicals && (
                          <RevenueBuild
                            key={`${company?.ticker || 'company'}-revenue-build`}
                            currentRevenue={currentRevenue}
                            historicalRevenuePoints={revenuePoints}
                            initialGrowthRate={assumptions?.revenueGrowth}
                            onDataChange={actions.setRevenueBuildData}
                            isDarkMode={isDarkMode}
                          />
                        )}

                        {activeView === 'WACC Build' && historicals && assumptions && (
                          <WACCBuild
                            key={`${company?.ticker || 'company'}-wacc-build`}
                            marketCap={marketCapForWacc}
                            totalDebt={totalDebtForWacc}
                            rawBeta={assumptions.beta || historicals.beta || company?.beta || 1}
                            riskFreeRate={assumptions.riskFreeRate}
                            equityRiskPremium={assumptions.equityRiskPremium}
                            preTaxCostOfDebt={assumptions.costOfDebt}
                            taxRate={assumptions.taxRate}
                            leverageTarget={assumptions.leverageTarget}
                            onInputsChange={(patch) => actions.updateAssumptions(patch)}
                            isDarkMode={isDarkMode}
                          />
                        )}

                        {activeView === 'Reverse DCF' && historicals && assumptions && (
                          <ReverseDCF
                            historicals={historicals}
                            assumptions={assumptions}
                            overrides={overrides}
                            isDarkMode={isDarkMode}
                          />
                        )}

                        {activeView === 'Sensitivity' && historicals && assumptions && (
                          <div className="h-full">
                            <SensitivityAnalysis
                              historicals={historicals}
                              assumptions={assumptions}
                              overrides={overrides}
                              disabledReason={results?.isSensitivitySupported === false ? results.modelWarning || results.sectorWarning : undefined}
                            />
                          </div>
                        )}

                        {activeView === 'Comparables' && company && historicals && (
                          <CompsTableInstitutional
                            isDarkMode={isDarkMode}
                            targetTicker={company.ticker}
                            targetRevenue={historicals.revenue[historicals.revenue.length - 1]}
                            targetEbitda={historicals.ebitda[historicals.ebitda.length - 1]}
                            peers={comparableCompanies}
                            onDataChange={actions.setComparableCompanies}
                            modelExitMultiple={assumptions?.terminalExitMultiple}
                            impliedSharePrice={results?.impliedSharePrice}
                            currentSharePrice={results?.currentPrice}
                          />
                        )}

                        {activeView === 'Transactions' && company && historicals && (
                          <PrecedentTransactions
                            isDarkMode={isDarkMode}
                            targetTicker={company.ticker}
                            targetSector={company.sector || 'Technology'}
                            targetRevenue={historicals.revenue[historicals.revenue.length - 1]}
                            targetEbitda={historicals.ebitda[historicals.ebitda.length - 1]}
                            transactions={precedentTransactions.length > 0 ? precedentTransactions : undefined}
                            onDataChange={actions.setPrecedentTransactions}
                          />
                        )}
                      </ErrorBoundary>
                    </Suspense>
                  </div>
                </main>

                {/* Health Dashboard Modal/Overlay */}
                <AnimatePresence>
                  {isHealthOpen && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-end"
                      onClick={() => setIsHealthOpen(false)}
                    >
                      <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                        className="app-health-panel-width h-full bg-(--bg-card) border-l border-(--border-default) shadow-2xl overflow-y-auto custom-scrollbar"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="p-4 border-b border-(--border-default) flex items-center justify-between">
                          <h3 className="text-[13px] font-bold text-(--text-primary) uppercase tracking-wider">Model Health</h3>
                          <button
                            onClick={() => setIsHealthOpen(false)}
                            className="text-(--text-tertiary) hover:text-(--text-primary) transition-colors"
                          >
                            Close
                          </button>
                        </div>
                        <DealDashboard
                          diagnostics={diagnostics}
                          results={results}
                          assumptions={assumptions}
                        />
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
            }
          </AnimatePresence>
        </ErrorBoundary>
      </div>
    </div>
  );
}
