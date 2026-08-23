"use client";

import { useMemo, useState, memo, useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { SlidersHorizontal, StretchHorizontal } from 'lucide-react';
import { FileX2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { ParametersSidebar } from '@/components/layout/ParametersSidebar';
import { cn } from '@/core/utils/cn';
import type { Assumptions, DCFResults, HistoricalData, NativeFinancialsPayload } from '@/core/types';
import { StatementRow as StatementRowConfig, INCOME_STATEMENT_ROWS, BALANCE_SHEET_ROWS, CASH_FLOW_ROWS } from '@/core/config/financial-statements';
import { calculateFinancialValue } from '@/core/logic/financial-processor';
import { FinancialStatementsToolbar } from './FinancialStatementsToolbar';
import { DcfBridgeTable } from './DcfBridgeTable';
import { StatementRow } from './StatementRow';
import { NativeStatementTable } from './NativeStatementTable';
import { BankStatementView } from './BankStatementView';
import { EmptyState } from './EmptyState';

interface Props {
    historicals: HistoricalData;
    financialsNative?: NativeFinancialsPayload | null;
    results: DCFResults;
    assumptions: Assumptions | null;
    onUpdateAssumption: (key: keyof Assumptions, value: number | string | boolean) => void;
    onApplyScenario: (type: 'base' | 'conservative' | 'aggressive') => void;
    activeScenario: 'base' | 'conservative' | 'aggressive';
    onResetToDefaults: () => void;
    companyName?: string;
    isDarkMode: boolean;
    isFullscreen: boolean;
    onToggleFullscreen: (isFullscreen: boolean) => void;
}

type StatementType = 'IS' | 'BS' | 'CFS' | 'DCF';
type TableDensity = 'compact' | 'detailed';
type ValueScale = 'billions' | 'millions' | 'perShare';

export const FinancialStatements = memo(function FinancialStatements({
    historicals,
    financialsNative,
    results,
    assumptions,
    onUpdateAssumption,
    onApplyScenario,
    activeScenario,
    onResetToDefaults,
    companyName,
    isDarkMode,
    isFullscreen,
    onToggleFullscreen,
}: Props) {
    const [activeTab, setActiveTab] = useState<StatementType>('IS');
    const [tableDensity] = useState<TableDensity>('detailed');
    const [valueScale] = useState<ValueScale>('billions');
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isCompactWorkspace, setIsCompactWorkspace] = useState(false);
    const [tableViewportWidth, setTableViewportWidth] = useState(0);
    const tableViewportRef = useRef<HTMLDivElement | null>(null);
    const displayMode = tableDensity === 'compact' ? 'summary' : 'full';

    const tabs = useMemo(() => [
        { label: 'Income Statement', value: 'IS', activeColor: '#0A84FF' },
        { label: 'Balance Sheet', value: 'BS', activeColor: '#AF52DE' },
        { label: 'Cash Flow', value: 'CFS', activeColor: '#30D158' },
        { label: 'DCF Bridge', value: 'DCF', activeColor: '#FF9F0A' },
    ], []);

    const forecasts = results.forecasts;
    const foreYears = forecasts.map((f) => f.year);
    const allYears = useMemo(() => Array.from(new Set([...historicals.years, ...foreYears])).sort((a, b) => a - b), [historicals.years, foreYears]);
    const lastHistoricalYear = useMemo(
        () => historicals.years.length > 0 ? Math.max(...historicals.years) : null,
        [historicals.years],
    );
    const nativeStatements = financialsNative?.statements;
    const incomeRows = useMemo(() => nativeStatements?.income_statement || [], [nativeStatements]);
    const balanceRows = useMemo(() => nativeStatements?.balance_sheet || [], [nativeStatements]);
    const cashflowRows = useMemo(() => nativeStatements?.cashflow_statement || [], [nativeStatements]);

    const isFinancialInstitution = useMemo(() => {
        if (financialsNative?.is_financial_institution === true) return true;
        const industry = (historicals.industry || '').toLowerCase();
        const sector = (historicals.sector || '').toLowerCase();
        const bankKeywords = ['bank', 'depository', 'savings institution', 'credit services', 'commercial bank', 'thrift', 'credit union'];
        const insuranceKeywords = ['insurance', 'life insurance', 'property & casualty', 'reinsurance', 'health insurance'];
        if (bankKeywords.some((k) => industry.includes(k) || sector.includes(k))) return true;
        if (insuranceKeywords.some((k) => industry.includes(k) || sector.includes(k))) return true;
        return false;
    }, [financialsNative?.is_financial_institution, historicals.industry, historicals.sector]);

    const hasNativeStatements = useMemo(
        () => (incomeRows.length > 0 || balanceRows.length > 0 || cashflowRows.length > 0),
        [incomeRows.length, balanceRows.length, cashflowRows.length],
    );

    const actualYears = useMemo(() => allYears.filter((year) => !foreYears.includes(year)), [allYears, foreYears]);
    const statementLabel = useMemo(() => tabs.find((tab) => tab.value === activeTab)?.label || 'Income Statement', [activeTab, tabs]);
    const valuationMethodLabel = assumptions?.valuationMethod === 'multiple' ? 'Exit Multiple' : 'Gordon Growth';
    const scaleDescription = valueScale === 'billions' ? 'USD billions' : valueScale === 'millions' ? 'USD millions' : 'Per-share view';
    const actualRangeLabel = actualYears.length > 0 ? `FY${actualYears[0]}-${actualYears[actualYears.length - 1]}` : 'Historical';
    const forecastRangeLabel = foreYears.length > 0 ? `FY${foreYears[0]}-${foreYears[foreYears.length - 1]}` : 'Forecast';

    const displayedYears = allYears;
    const labelColumnWidth = tableDensity === 'compact' ? 300 : 340;
    const minYearColumnWidth = tableDensity === 'compact' ? 124 : 148;
    const tableMinWidth = labelColumnWidth + displayedYears.length * minYearColumnWidth;
    const effectiveYearColumnWidth = displayedYears.length > 0
        ? Math.max(
            minYearColumnWidth,
            Math.floor(Math.max(tableViewportWidth - labelColumnWidth, displayedYears.length * minYearColumnWidth) / displayedYears.length),
        )
        : minYearColumnWidth;
    const tableWidth = labelColumnWidth + displayedYears.length * effectiveYearColumnWidth;
    const lightThemeVars = !isDarkMode ? {
        '--financials-border': 'rgba(15, 23, 42, 0.08)',
        '--financials-header-bg': 'rgba(248, 250, 252, 0.98)',
        '--financials-header-muted': 'rgba(15, 23, 42, 0.72)',
        '--financials-header-icon': 'rgba(15, 23, 42, 0.42)',
        '--financials-section-header-bg': 'rgba(248, 250, 252, 0.96)',
        '--financials-section-header-text': 'rgba(15, 23, 42, 0.58)',
        '--financials-section-bg': 'rgba(255, 255, 255, 0.98)',
        '--financials-sticky-bg': 'rgba(255, 255, 255, 0.98)',
        '--financials-sticky-strong-bg': 'rgba(255, 255, 255, 0.99)',
        '--financials-row-bg': 'rgba(255, 255, 255, 0.98)',
        '--financials-row-alt-bg': 'rgba(248, 250, 252, 0.94)',
        '--financials-row-strong-bg': 'rgba(241, 245, 249, 0.94)',
        '--financials-row-hover-bg': 'rgba(248, 250, 252, 0.96)',
        '--financials-value-text': '#0f172a',
        '--financials-value-strong': '#0f172a',
        '--financials-value-muted': 'rgba(15, 23, 42, 0.52)',
        '--financials-label-text': 'rgba(15, 23, 42, 0.82)',
        '--financials-label-muted': 'rgba(15, 23, 42, 0.46)',
        '--financials-forecast-header-bg': 'rgba(239, 246, 255, 0.98)',
        '--financials-forecast-cell-bg': 'rgba(219, 234, 254, 0.32)',
        '--financials-forecast-divider': 'rgba(59, 130, 246, 0.18)',
        '--financials-forecast-pill-bg': 'rgba(191, 219, 254, 0.45)',
        '--financials-forecast-pill-text': '#92400e',
        '--financials-forecast-value-text': '#b45309',
        '--financials-pill-bg': 'rgba(15, 23, 42, 0.06)',
        '--financials-pill-text': 'rgba(15, 23, 42, 0.55)',
        '--financials-integrity-bg': 'rgba(255, 247, 237, 0.96)',
        '--financials-integrity-text': '#b45309',
        '--financials-shadow-edge': 'rgba(15, 23, 42, 0.04)',
    } as CSSProperties : undefined;

    useEffect(() => {
        const updateCompactWorkspace = () => {
            const compact = window.innerWidth < 1280;
            setIsCompactWorkspace(compact);
            setIsSidebarOpen((prev) => (compact ? false : prev));
        };

        updateCompactWorkspace();
        window.addEventListener('resize', updateCompactWorkspace);
        return () => window.removeEventListener('resize', updateCompactWorkspace);
    }, []);

    useEffect(() => {
        const node = tableViewportRef.current;
        if (!node) return;

        const updateWidth = () => {
            setTableViewportWidth(node.clientWidth);
        };

        updateWidth();

        const observer = new ResizeObserver(() => updateWidth());
        observer.observe(node);
        window.addEventListener('resize', updateWidth);

        return () => {
            observer.disconnect();
            window.removeEventListener('resize', updateWidth);
        };
    }, []);

    const getValueForDisplay = useCallback((year: number, row: StatementRowConfig) => {
        const isForecast = foreYears.includes(year);
        const notAvailableInForecast = [
            'source_debt', 'source_equity', 'source_cash_draw',
            'use_cfo_loss', 'use_debt_repay', 'use_buybacks',
        ];

        if (isForecast && notAvailableInForecast.includes(row.id)) {
            return { text: '—', val: 0, isPercent: false, isNA: true };
        }

        if (!isForecast && (row.id === 'df' || row.id === 'pv' || row.id === 'pvFcff')) {
            return { text: '—', val: 0, isPercent: false, isNA: true };
        }

        const rawVal = calculateFinancialValue(row.id, year, historicals, results);

        let isNA = false;
        if (row.id === 'revenue' && rawVal === 0) isNA = true;
        const balanceSheetDetailItems = [
            'otherCurrentAssets', 'otherAssets', 'otherLiabilities', 'otherCurrentLiabilities',
            'commonStock', 'retainedEarnings', 'deferredRevenue',
            'accountsReceivable', 'inventory', 'accountsPayable',
        ];
        if (balanceSheetDetailItems.includes(row.id) && rawVal === 0 && !isForecast) isNA = true;

        if (isNA) return { text: '—', val: 0, isPercent: false, isNA: true };

        if (row.format === 'percent') {
            return { text: `${(rawVal * 100).toFixed(1)}%`, val: rawVal, isPercent: true, isNA: false };
        }

        if (row.format === 'number') {
            return { text: rawVal.toFixed(2), val: rawVal, isPercent: false, isNA: false };
        }

        const num = rawVal / 1_000_000;
        const formatted = Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        const text = num < 0 ? `(${formatted})` : formatted;
        return { text, val: num, isPercent: false, isNA: false };
    }, [foreYears, historicals, results]);

    const renderConfigRows = useCallback((rows: StatementRowConfig[], headerTitle: string, headerColor: string) => (
        <>
            <tr>
                <td
                    className="sticky left-0 z-30 bg-[var(--bg-app)]/95 border-r border-(--border-subtle) px-6 py-3 text-[10px] font-black uppercase tracking-[0.2em]"
                    style={{ color: headerColor }}
                >
                    {headerTitle}
                </td>
                <td colSpan={displayedYears.length} className="bg-[var(--bg-app)]/50" />
            </tr>
            {rows.map((row) => (
                <StatementRow
                    key={row.id}
                    row={row}
                    years={displayedYears}
                    foreYears={foreYears}
                    getValueForDisplay={getValueForDisplay}
                    headerColor={headerColor}
                />
            ))}
        </>
    ), [displayedYears, foreYears, getValueForDisplay]);

    const mapNativeRowToFinancialId = useCallback((row: { standard_concept?: string | null; concept?: string | null; label?: string | null }) => {
        const normalize = (value?: string | null) => String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');

        const normalizedStandardConcept = normalize(row.standard_concept);
        const normalizedConcept = normalize(row.concept);
        const normalizedLabel = normalize(row.label);
        const normalizedFields = [normalizedStandardConcept, normalizedConcept, normalizedLabel].filter(Boolean);
        const normalizedSearch = normalizedFields.join(' ');

        const mappings: Array<[string[], string]> = [
            [['revenue', 'salesrevenue', 'contractrevenue', 'totalrevenue'], 'revenue'],
            [['costofrevenue', 'costofsales', 'costofgoodssold'], 'cogs'],
            [['grossprofit'], 'grossProfit'],
            [['researchanddevelopment'], 'rnd'],
            [['sellinggeneralandadministrative', 'generalandadministrativeexpense', 'sellingexpense'], 'sga'],
            [['depreciationandamortization', 'depreciation', 'amortization'], 'depreciation'],
            [['operatingincome', 'operatingincomeloss', 'ebit'], 'ebit'],
            [['interestexpense'], 'interestExpense'],
            [['pretaxincome', 'incomebeforetax', 'incomefromcontinuingoperationsbeforeincometaxes'], 'preTaxIncome'],
            [['incometaxexpense', 'taxexpense', 'incometaxexpensebenefit'], 'taxExpense'],
            [['effectiveincometaxrate', 'taxrate'], 'effectiveTaxRate'],
            [['netincome', 'profitloss', 'netincomeloss', 'netincomeattributabletoparent'], 'netIncome'],
            [['earningspersharebasic', 'weightedaveragebasicshares'], 'sharesOutstanding'],
            [['cashandcashequivalents', 'cashandcashequivalentsatcarryingvalue'], 'cash'],
            [['marketablesecurities', 'shortterminvestments'], 'marketableSecurities'],
            [['accountsreceivable'], 'accountsReceivable'],
            [['inventory'], 'inventory'],
            [['othercurrentassets'], 'otherCurrentAssets'],
            [['totalcurrentassets', 'assetscurrent'], 'totalCurrentAssets'],
            [['propertyplantandequipment', 'propertyplantequipmentnet'], 'ppeNet'],
            [['otherassets'], 'otherAssets'],
            [['totalassets', 'assets'], 'totalAssets'],
            [['accountspayable'], 'accountsPayable'],
            [['othercurrentliabilities', 'accruedliabilities'], 'otherCurrentLiabilities'],
            [['shorttermdebt', 'debtcurrent', 'currentportionoflongtermdebt'], 'shortTermDebt'],
            [['totalcurrentliabilities', 'liabilitiescurrent'], 'totalCurrentLiabilities'],
            [['longtermdebt'], 'longTermDebt'],
            [['otherliabilities'], 'otherLiabilities'],
            [['totalliabilities', 'liabilities'], 'totalLiabilities'],
            [['stockholdersequity', 'shareholdersequity', 'totalstockholdersequity'], 'shareholdersEquity'],
            [['retainedearnings'], 'retainedEarnings'],
            [['liabilitiesandequity', 'liabilitiesandstockholdersequity'], 'liabilitiesAndEquity'],
            [['netcashfromoperatingactivities', 'cashflowfromoperations'], 'cfo'],
            [['capitalexpenditures', 'purchaseofpropertyplantandequipment'], 'capex'],
            [['sharebasedcompensation', 'stockbasedcompensation'], 'stockBasedComp'],
            [['changeinworkingcapital', 'workingcapital'], 'nwcChange'],
            [['freecashflow', 'freecashflowfcff'], 'fcff'],
        ];

        for (const [needles, value] of mappings) {
            if (needles.some((needle) => normalizedFields.includes(needle))) {
                return value;
            }
        }

        for (const [needles, value] of mappings) {
            const sortedNeedles = [...needles].sort((a, b) => b.length - a.length);
            if (sortedNeedles.some((needle) => normalizedSearch.includes(needle))) {
                return value;
            }
        }
        return null;
    }, []);

    const getForecastValueForNativeRow = useCallback((row: { standard_concept?: string | null; concept?: string | null; label?: string | null }, year: number) => {
        if (!foreYears.includes(year)) return null;
        const mappedId = mapNativeRowToFinancialId(row);
        if (!mappedId) return null;
        const value = calculateFinancialValue(mappedId, year, historicals, results);
        return Number.isFinite(value) ? value : null;
    }, [foreYears, historicals, mapNativeRowToFinancialId, results]);

    return (
        <div className="financials-theme-scope relative flex h-full overflow-hidden bg-[var(--bg-app)]" style={lightThemeVars}>
            <div
                className={cn(
                    "pointer-events-none absolute inset-0",
                    isDarkMode
                        ? "bg-[radial-gradient(circle_at_top,rgba(118,16,16,0.18),transparent_34%),radial-gradient(circle_at_20%_30%,rgba(88,16,12,0.12),transparent_30%),linear-gradient(180deg,rgba(18,4,4,0.9),rgba(6,7,12,0.96)_28%,rgba(4,6,10,1)_100%)]"
                        : "bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(245,247,251,0.98)_18%,rgba(241,245,249,1)_100%)]"
                )}
            />

            {!isFullscreen && isSidebarOpen && !isCompactWorkspace && (
                <div className="relative z-30 h-full shrink-0 overflow-hidden border-r border-(--border-subtle) bg-[var(--bg-app)]">
                    <div className="app-panel-width h-full">
                        <ParametersSidebar
                            assumptions={assumptions}
                            results={results}
                            isDarkMode={isDarkMode}
                            activeScenario={activeScenario}
                            onApplyScenario={onApplyScenario}
                            onUpdateAssumption={onUpdateAssumption}
                            onResetToDefaults={onResetToDefaults}
                            companyName={companyName}
                            companyTicker={historicals.symbol}
                            companySector={historicals.sector}
                            companyIndustry={historicals.industry}
                        />
                    </div>
                </div>
            )}

            <AnimatePresence initial={false}>
                {!isFullscreen && isSidebarOpen && isCompactWorkspace && (
                    <>
                        <motion.button
                            type="button"
                            aria-label="Close assumptions panel"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsSidebarOpen(false)}
                            className="absolute inset-0 z-30 bg-black/35 backdrop-blur-[2px]"
                        />
                        <motion.div
                            initial={{ x: -32, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: -32, opacity: 0 }}
                            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                            className="absolute inset-y-0 left-0 z-40 w-[min(420px,92vw)] border-r border-(--border-subtle) bg-[var(--bg-app)] shadow-[0_20px_70px_rgba(0,0,0,0.35)]"
                        >
                            <ParametersSidebar
                                assumptions={assumptions}
                                results={results}
                                isDarkMode={isDarkMode}
                                activeScenario={activeScenario}
                                onApplyScenario={onApplyScenario}
                                onUpdateAssumption={onUpdateAssumption}
                                onResetToDefaults={onResetToDefaults}
                                companyName={companyName}
                                companyTicker={historicals.symbol}
                                companySector={historicals.sector}
                                companyIndustry={historicals.industry}
                            />
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            <div className="relative z-20 flex min-w-0 flex-1 flex-col bg-transparent">
                <FinancialStatementsToolbar
                    tabs={tabs}
                    activeTab={activeTab}
                    onChange={(value) => setActiveTab(value as StatementType)}
                    isDarkMode={isDarkMode}
                    isFullscreen={isFullscreen}
                    onToggleFullscreen={onToggleFullscreen}
                />

                <div className="relative flex-1 overflow-auto custom-scrollbar px-4 pb-4 lg:px-8">
                    <div
                        className={cn(
                            "financials-table-shell mx-auto mt-1 w-full overflow-hidden rounded-[28px] border backdrop-blur-[10px]",
                            isDarkMode
                                ? "border-white/8 bg-[rgba(7,8,12,0.78)] shadow-[0_22px_80px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.03)]"
                                : "border-[rgba(15,23,42,0.12)] bg-[rgba(255,255,255,0.9)] shadow-[0_24px_60px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.75)]"
                        )}
                    >
                    <div className={cn(
                        "flex flex-col gap-3 border-b px-4 py-4 lg:flex-row lg:items-center lg:justify-between",
                        isDarkMode ? "border-white/8 bg-white/2" : "border-[rgba(15,23,42,0.08)] bg-[rgba(248,250,252,0.8)]"
                    )}>
                        <div>
                            <p className={cn("text-[11px] font-black uppercase tracking-[0.16em]", isDarkMode ? "text-white/45" : "text-[rgba(15,23,42,0.45)]")}>Table context</p>
                            <p className={cn("mt-1 text-[14px] font-bold", isDarkMode ? "text-white" : "text-(--text-primary)")}>
                                {statementLabel} with {actualRangeLabel} actuals and {forecastRangeLabel} forecast years
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className={cn(
                                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em]",
                                isDarkMode ? "bg-white/5 text-white/68" : "bg-[rgba(15,23,42,0.05)] text-[rgba(15,23,42,0.58)]"
                            )}>
                                <StretchHorizontal size={13} />
                                Sticky labels enabled
                            </span>
                            <span className={cn(
                                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em]",
                                isDarkMode ? "bg-[#0A84FF]/12 text-[#9ac7ff]" : "bg-[#0A84FF]/10 text-[#0A84FF]"
                            )}>
                                {scaleDescription}
                            </span>
                            <span className={cn(
                                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em]",
                                isDarkMode ? "bg-amber-500/12 text-amber-200" : "bg-amber-500/10 text-amber-700"
                            )}>
                                {valuationMethodLabel}
                            </span>
                        </div>
                    </div>
                    <div ref={tableViewportRef} className="overflow-x-auto overflow-y-hidden custom-scrollbar">
                    <table
                        className="table-fixed border-separate border-spacing-0"
                        style={{ minWidth: `${tableMinWidth}px`, width: `${tableWidth}px` }}
                    >
                        <colgroup>
                            <col style={{ width: `${labelColumnWidth}px` }} />
                            {displayedYears.map((year) => (
                                <col key={`col-${year}`} style={{ width: `${effectiveYearColumnWidth}px` }} />
                            ))}
                        </colgroup>
                        <thead className={cn(
                            "sticky top-0 z-40",
                            isDarkMode
                                ? "shadow-[0_16px_36px_rgba(0,0,0,0.24)]"
                                : "shadow-[0_14px_34px_rgba(15,23,42,0.08)]"
                        )}>
                            <tr>
                                <th className="app-table-label-cell sticky left-0 z-50 border-b border-r border-[var(--financials-border)] bg-[var(--financials-header-bg)] px-6 py-4 text-left shadow-[4px_0_24px_var(--financials-shadow-edge)]">
                                    <div className="flex items-center gap-2 text-[var(--financials-header-muted)]">
                                        <SlidersHorizontal size={13} className="text-[var(--financials-header-icon)]" />
                                        <span className="text-[11px] font-semibold uppercase">Line Item</span>
                                    </div>
                                </th>
                                {displayedYears.map((year) => {
                                    const isForecast = lastHistoricalYear !== null ? year > lastHistoricalYear : foreYears.includes(year);
                                    const isFirstForecast = isForecast && (lastHistoricalYear === null ? year === Math.min(...foreYears) : year === lastHistoricalYear + 1);
                                    return (
                                        <th key={year} className={cn(
                                            'app-table-cell border-b border-[var(--financials-border)] bg-[var(--financials-header-bg)] px-6 py-3.5 text-right',
                                            isForecast && 'bg-[var(--financials-forecast-header-bg)]',
                                            isFirstForecast && 'border-l border-l-[var(--financials-forecast-divider)]',
                                        )}>
                                            <div className="flex flex-col items-end gap-1.5">
                                                <span className="font-display text-[15px] font-black tracking-tight text-(--text-primary)">
                                                    FY{year}
                                                </span>
                                                <div className={cn(
                                                    'flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase',
                                                    isForecast ? 'bg-[var(--financials-forecast-pill-bg)] text-[var(--financials-forecast-pill-text)]' : 'bg-[var(--financials-pill-bg)] text-[var(--financials-pill-text)]',
                                                )}>
                                                    {isForecast ? 'Forecast' : 'Actual'}
                                                </div>
                                            </div>
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-subtle)]/50">
                            {activeTab === 'IS' && (
                                isFinancialInstitution && incomeRows.length > 0
                                    ? <BankStatementView rows={incomeRows} years={displayedYears} foreYears={foreYears} isDarkMode={isDarkMode} />
                                    : incomeRows.length > 0
                                        ? <NativeStatementTable rows={incomeRows} years={displayedYears} foreYears={foreYears} headerTitle="Income Statement" headerColor="#0A84FF" statementKind="income" displayMode={displayMode} valueScale={valueScale} getForecastValueForRow={getForecastValueForNativeRow} />
                                        : !hasNativeStatements
                                            ? (
                                                <tr>
                                                    <td colSpan={displayedYears.length + 1}>
                                                        <EmptyState
                                                            title="No financials available"
                                                            message={`No income statement data could be loaded for ${historicals.symbol}. This may be due to a data provider limitation or filing delay.`}
                                                            icon={<FileX2 size={28} strokeWidth={1.5} />}
                                                            ctaLabel="Try another ticker"
                                                            onCtaClick={() => window.location.reload()}
                                                            isDarkMode={isDarkMode}
                                                            secondaryMessage="Click above to switch tabs, or try a different company."
                                                        />
                                                    </td>
                                                </tr>
                                            )
                                            : renderConfigRows(INCOME_STATEMENT_ROWS, 'Performance Matrix', '#0A84FF')
                            )}
                            {activeTab === 'BS' && (
                                balanceRows.length > 0 ? (
                                    <>
                                    <NativeStatementTable rows={balanceRows} years={displayedYears} foreYears={foreYears} headerTitle="Balance Sheet" headerColor="#AF52DE" statementKind="balance" displayMode={displayMode} valueScale={valueScale} getForecastValueForRow={getForecastValueForNativeRow} />
                                        <tr className="bg-(--bg-glass)">
                                            <td className="p-5 sticky left-0 z-30 bg-(--bg-card) border-r border-(--border-subtle) border-t border-(--border-subtle) whitespace-nowrap">
                                                <span className="text-[13px] font-bold text-(--text-secondary) uppercase tracking-wider">Balance Check</span>
                                            </td>
                                            {displayedYears.map((year) => {
                                                const assets = calculateFinancialValue('totalAssets', year, historicals, results);
                                                const liabilities = calculateFinancialValue('totalLiabilities', year, historicals, results);
                                                const equity = calculateFinancialValue('shareholdersEquity', year, historicals, results);
                                                const diff = Math.abs(assets - (liabilities + equity));
                                                const isBalanced = diff < 0.1;

                                                return (
                                                    <td key={year} className="p-5 text-right border-t border-(--border-subtle)">
                                                        <span className={cn(
                                                            'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] font-bold font-mono uppercase tracking-wider',
                                                            isBalanced ? 'bg-[var(--color-green)]/10 text-[var(--color-green)]' : 'bg-[var(--color-red)]/10 text-[var(--color-red)]',
                                                        )}>
                                                            {isBalanced ? 'Balanced' : `Δ ${(diff / 1_000_000).toFixed(1)}`}
                                                        </span>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    </>
                                ) : !hasNativeStatements ? (
                                    <tr>
                                        <td colSpan={displayedYears.length + 1}>
                                            <EmptyState
                                                title="No financials available"
                                                message={`No balance sheet data could be loaded for ${historicals.symbol}.`}
                                                icon={<FileX2 size={28} strokeWidth={1.5} />}
                                                ctaLabel="Try another ticker"
                                                onCtaClick={() => window.location.reload()}
                                                isDarkMode={isDarkMode}
                                            />
                                        </td>
                                    </tr>
                                ) : (
                                    <>
                                        {renderConfigRows(BALANCE_SHEET_ROWS, 'Asset Repository', '#AF52DE')}
                                        <tr className="bg-(--bg-glass)">
                                            <td className="p-5 sticky left-0 z-30 bg-(--bg-card) border-r border-(--border-subtle) border-t border-(--border-subtle) whitespace-nowrap">
                                                <span className="text-[13px] font-bold text-(--text-secondary) uppercase tracking-wider">Balance Check</span>
                                            </td>
                                            {displayedYears.map((year) => {
                                                const assets = calculateFinancialValue('totalAssets', year, historicals, results);
                                                const liabilities = calculateFinancialValue('totalLiabilities', year, historicals, results);
                                                const equity = calculateFinancialValue('shareholdersEquity', year, historicals, results);
                                                const diff = Math.abs(assets - (liabilities + equity));
                                                const isBalanced = diff < 0.1;

                                                return (
                                                    <td key={year} className="p-5 text-right border-t border-(--border-subtle)">
                                                        <span className={cn(
                                                            'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] font-bold font-mono uppercase tracking-wider',
                                                            isBalanced ? 'bg-[var(--color-green)]/10 text-[var(--color-green)]' : 'bg-[var(--color-red)]/10 text-[var(--color-red)]',
                                                        )}>
                                                            {isBalanced ? 'Balanced' : `Δ ${(diff / 1_000_000).toFixed(1)}`}
                                                        </span>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    </>
                                )
                            )}
                            {activeTab === 'CFS' && (
                                cashflowRows.length > 0
                                    ? <NativeStatementTable rows={cashflowRows} years={displayedYears} foreYears={foreYears} headerTitle="Cash Flow Statement" headerColor="#30D158" statementKind="cashflow" displayMode={displayMode} valueScale={valueScale} getForecastValueForRow={getForecastValueForNativeRow} />
                                    : !hasNativeStatements
                                        ? (
                                            <tr>
                                                <td colSpan={displayedYears.length + 1}>
                                                    <EmptyState
                                                        title="No financials available"
                                                        message={`No cash flow data could be loaded for ${historicals.symbol}.`}
                                                        icon={<FileX2 size={28} strokeWidth={1.5} />}
                                                        ctaLabel="Try another ticker"
                                                        onCtaClick={() => window.location.reload()}
                                                        isDarkMode={isDarkMode}
                                                    />
                                                </td>
                                            </tr>
                                        )
                                        : renderConfigRows(CASH_FLOW_ROWS, 'Capital Velocity', '#30D158')
                            )}
                            {activeTab === 'DCF' && (
                                <DcfBridgeTable
                                    displayedYears={displayedYears}
                                    foreYears={foreYears}
                                    historicals={historicals}
                                    results={results}
                                    assumptions={assumptions}
                                />
                            )}
                        </tbody>
                    </table>
                    </div>
                    </div>
                </div>
            </div>
        </div>
    );
});
