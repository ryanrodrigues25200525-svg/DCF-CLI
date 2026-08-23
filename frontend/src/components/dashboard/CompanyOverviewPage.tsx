"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2, TrendingUp, Globe, Users, Activity,
  BarChart3, Landmark, ArrowUpRight, ArrowDownRight,
  PieChart, FileSpreadsheet, FileText
} from "lucide-react";
import { cn } from "@/core/utils/cn";
import { CompanyProfile, HistoricalData, DCFResults } from "@/core/types";
import { formatPercent } from "@/core/utils";
import { GlassCard } from "@/components/ui/primitives/GlassCard";
import {
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Area
} from "recharts";

interface CompanyOverviewPageProps {
  company: CompanyProfile;
  historicals: HistoricalData;
  results: DCFResults | null;
  onExcelExport?: () => void;
  onMarkdownExport?: () => void;
  isExporting?: boolean;
}

function MeasuredChartContainer({
  className,
  minHeight,
  children,
  fallback,
}: {
  className?: string;
  minHeight: number;
  children: (size: { width: number; height: number }) => ReactNode;
  fallback?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    let raf = 0;
    const updateSize = () => {
      const nextWidth = Math.max(node.clientWidth, 0);
      const nextHeight = Math.max(node.clientHeight, minHeight);
      setSize((prev) =>
        prev.width === nextWidth && prev.height === nextHeight
          ? prev
          : { width: nextWidth, height: nextHeight }
      );
    };

    const scheduleUpdate = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        updateSize();
      });
    };

    // Initial measure (sync, so first paint is correct)
    updateSize();

    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(node);
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [minHeight]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ minHeight }}
    >
      {size.width > 0 && size.height > 0 ? children(size) : fallback ?? null}
    </div>
  );
}

/**
 * Format large numbers with appropriate suffixes (T, B, M)
 */
function formatLargeNumber(value: number, isCurrency = false) {
  const absValue = Math.abs(value);
  let suffix = "";
  let denominator = 1;

  if (absValue >= 1e12) {
    suffix = "T";
    denominator = 1e12;
  } else if (absValue >= 1e9) {
    suffix = "B";
    denominator = 1e9;
  } else if (absValue >= 1e6) {
    suffix = "M";
    denominator = 1e6;
  } else if (absValue >= 1e3) {
    suffix = "K";
    denominator = 1e3;
  }

  const formattedValue = (value / denominator).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: suffix === "T" ? 2 : 1
  });

  return `${isCurrency ? "$" : ""}${formattedValue}${suffix}`;
}

function generateMarkdownExport(company: CompanyProfile, historicals: HistoricalData, results: DCFResults | null): string {
  const lines: string[] = [];
  
  // Header
  lines.push(`# ${company.name} (${company.ticker})`);
  lines.push('');
  lines.push(`**Exchange:** ${company.exchange || 'N/A'}`);
  lines.push(`**Sector:** ${company.sector || 'N/A'}`);
  lines.push(`**Industry:** ${company.industry || 'N/A'}`);
  lines.push(`**CIK:** ${company.cik}`);
  lines.push('');
  lines.push(`---`);
  lines.push('');
  
  // Market Data
  lines.push('## Market Data');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Current Price | $${(historicals.price || 0).toFixed(2)} |`);
  lines.push(`| Market Cap | ${formatLargeNumber((historicals.price || 0) * (historicals.sharesOutstanding || 0), true)} |`);
  lines.push(`| Shares Outstanding | ${(historicals.sharesOutstanding || 0).toLocaleString()} |`);
  lines.push(`| Beta | ${(historicals.beta || 1).toFixed(2)} |`);
  lines.push('');
  
  // Historical Financials
  if (historicals.years && historicals.years.length > 0) {
    lines.push('## Historical Financials');
    lines.push('');
    lines.push('| Year | Revenue | Gross Profit | EBITDA | EBIT | Net Income |');
    lines.push('|------|---------|--------------|--------|------|------------|');
    
    for (let i = 0; i < historicals.years.length; i++) {
      const year = historicals.years[i];
      const revenue = historicals.revenue?.[i] || 0;
      const grossProfit = historicals.grossProfit?.[i] || 0;
      const ebitda = historicals.ebitda?.[i] || 0;
      const ebit = historicals.ebit?.[i] || 0;
      const netIncome = historicals.netIncome?.[i] || 0;
      
      lines.push(`| ${year} | ${formatLargeNumber(revenue, true)} | ${formatLargeNumber(grossProfit, true)} | ${formatLargeNumber(ebitda, true)} | ${formatLargeNumber(ebit, true)} | ${formatLargeNumber(netIncome, true)} |`);
    }
    lines.push('');
  }
  
  // Key Metrics
  if (results) {
    lines.push('## DCF Valuation Results');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Enterprise Value | ${formatLargeNumber(results.enterpriseValue, true)} |`);
    lines.push(`| Equity Value | ${formatLargeNumber(results.equityValue, true)} |`);
    lines.push(`| Implied Share Price | $${(results.impliedSharePrice || 0).toFixed(2)} |`);
    lines.push(`| Current Price | $${(results.currentPrice || 0).toFixed(2)} |`);
    lines.push(`| Upside/Downside | ${(results.upside * 100).toFixed(1)}% |`);
    lines.push('');
    
    // Forecasts
    if (results.forecasts && results.forecasts.length > 0) {
      lines.push('## Forecast Period');
      lines.push('');
      lines.push('| Year | Revenue | EBITDA | EBIT | Net Income | FCF |');
      lines.push('|------|---------|--------|------|------------|-----|');
      
      for (const forecast of results.forecasts) {
        lines.push(`| ${forecast.year} | ${formatLargeNumber(forecast.revenue, true)} | ${formatLargeNumber(forecast.ebitda, true)} | ${formatLargeNumber(forecast.ebit, true)} | ${formatLargeNumber(forecast.netIncome, true)} | ${formatLargeNumber(forecast.fcff, true)} |`);
      }
      lines.push('');
    }
  }
  
  // Footer
  lines.push('---');
  lines.push('');
  lines.push('*Generated by DCF Builder*');
  
  return lines.join('\n');
}

type GicsSector =
  | "Communication Services"
  | "Consumer Discretionary"
  | "Consumer Staples"
  | "Energy"
  | "Financials"
  | "Health Care"
  | "Industrials"
  | "Information Technology"
  | "Materials"
  | "Real Estate"
  | "Utilities";

function normalizeToGicsSector(sectorRaw?: string | null, industryRaw?: string | null): GicsSector | null {
  const combined = `${sectorRaw || ""} ${industryRaw || ""}`.toLowerCase().trim();
  if (!combined || combined === "unknown") return null;

  const direct: Record<string, GicsSector> = {
    "communication services": "Communication Services",
    "consumer cyclical": "Consumer Discretionary",
    "consumer discretionary": "Consumer Discretionary",
    "consumer defensive": "Consumer Staples",
    "consumer staples": "Consumer Staples",
    "energy": "Energy",
    "financial services": "Financials",
    "financial": "Financials",
    "financials": "Financials",
    "healthcare": "Health Care",
    "health care": "Health Care",
    "industrials": "Industrials",
    "industrial": "Industrials",
    "technology": "Information Technology",
    "information technology": "Information Technology",
    "basic materials": "Materials",
    "materials": "Materials",
    "real estate": "Real Estate",
    "utilities": "Utilities",
  };

  for (const [key, value] of Object.entries(direct)) {
    if (combined.includes(key)) return value;
  }

  const keywordMap: Array<{ words: string[]; sector: GicsSector }> = [
    { words: ["software", "semiconductor", "electronics", "computer", "it services", "data processing", "internet software"], sector: "Information Technology" },
    { words: ["media", "telecom", "entertainment", "publishing", "broadcast", "interactive media"], sector: "Communication Services" },
    { words: ["retail", "auto", "automobile", "apparel", "travel", "restaurant", "leisure", "consumer services"], sector: "Consumer Discretionary" },
    { words: ["beverage", "food", "household", "packaged", "personal products", "tobacco", "grocery"], sector: "Consumer Staples" },
    { words: ["bank", "insurance", "asset management", "capital markets", "credit", "financial"], sector: "Financials" },
    { words: ["pharma", "biotech", "medical", "health", "life sciences", "hospital"], sector: "Health Care" },
    { words: ["aerospace", "defense", "machinery", "transportation", "construction", "industrial"], sector: "Industrials" },
    { words: ["oil", "gas", "exploration", "drilling", "refining", "pipeline"], sector: "Energy" },
    { words: ["chemical", "mining", "steel", "metals", "paper", "forest products"], sector: "Materials" },
    { words: ["reit", "property", "real estate"], sector: "Real Estate" },
    { words: ["electric", "water utility", "gas utility", "independent power", "renewable utility"], sector: "Utilities" },
  ];

  for (const item of keywordMap) {
    if (item.words.some((word) => combined.includes(word))) return item.sector;
  }

  return null;
}

function getSectorEmoji(sector: string): string {
  const key = sector.toLowerCase();
  if (key.includes("information technology")) return "💻";
  if (key.includes("consumer discretionary")) return "🛍️";
  if (key.includes("consumer staples")) return "🥫";
  if (key.includes("financial")) return "💰";
  if (key.includes("health")) return "💊";
  if (key.includes("industrial")) return "🏭";
  if (key.includes("energy")) return "⚡";
  if (key.includes("real estate")) return "🏢";
  if (key.includes("communication")) return "📡";
  if (key.includes("materials")) return "🧱";
  if (key.includes("utilities")) return "⚡";
  return "🔍";
}

const RatioCard = ({
  label,
  value,
  subtitle,
  trend
}: {
  label: string;
  value: string;
  subtitle: string;
  trend: 'up' | 'down' | 'neutral';
}) => {
  return (
    <div className="overview-light-card glass-card p-5 rounded-2xl border border-white/10 bg-white/[0.03] flex flex-col justify-between hover:bg-white/[0.06] transition-all group shadow-lg">
      <div className="flex justify-between items-start">
        <span className="text-[11px] font-black text-white/90 uppercase tracking-[0.2em] group-hover:text-white transition-colors">{label}</span>
        <div className={cn(
          "p-1.5 rounded-lg border",
          trend === 'up' ? "bg-[var(--color-green)]/10 border-[var(--color-green)]/20" :
            trend === 'down' ? "bg-[var(--color-red)]/10 border-[var(--color-red)]/20" :
              "bg-white/5 border-white/10"
        )}>
          {trend === 'up' && <ArrowUpRight size={14} className="text-[var(--color-green)]" />}
          {trend === 'down' && <ArrowDownRight size={14} className="text-[var(--color-red)]" />}
          {trend === 'neutral' && <div className="w-3.5 h-0.5 bg-white/60 mt-1.5" />}
        </div>
      </div>
      <div className="mt-4">
        <div className="text-[28px] font-black text-white tracking-tight font-display tabular-nums drop-shadow-sm">{value}</div>
        <div className="text-[12px] font-bold text-white/80 mt-1 uppercase tracking-widest leading-none">{subtitle}</div>
      </div>
    </div>
  );
};

import { memo } from 'react';

export const CompanyOverviewPage = memo(function CompanyOverviewPage({
  company,
  historicals,
  results,
  onExcelExport,
  onMarkdownExport,
  isExporting
}: CompanyOverviewPageProps) {
  const safeNumber = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const handleMarkdownExport = () => {
    if (onMarkdownExport) {
      onMarkdownExport();
      return;
    }

    if (!company || !historicals) return;
    
    const markdown = generateMarkdownExport(company, historicals, results);
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ticker = company.ticker?.trim().toLowerCase() || 'ticker';
    a.download = `${ticker}_dcf_report.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const resolveDebtAt = (idx: number) => {
    const totalDebt = safeNumber(historicals.totalDebt?.[idx]);
    const currentDebt = safeNumber(historicals.currentDebt?.[idx]);
    const longTermDebt = safeNumber(historicals.longTermDebt?.[idx]);
    const combinedDebt = currentDebt + longTermDebt;

    if (totalDebt > 0) return totalDebt;
    if (combinedDebt > 0) return combinedDebt;
    return Math.max(totalDebt, 0);
  };

  const latestResolvedDebt = (startIdx: number) => {
    for (let i = Math.max(0, startIdx); i >= 0; i -= 1) {
      const debt = resolveDebtAt(i);
      if (debt > 0) return debt;
    }
    return resolveDebtAt(Math.max(0, startIdx));
  };

  const latestPositive = (series: number[] | undefined, startIdx: number) => {
    if (!series || series.length === 0) return 0;
    for (let i = Math.min(startIdx, series.length - 1); i >= 0; i -= 1) {
      const value = safeNumber(series[i]);
      if (value > 0) return value;
    }
    return 0;
  };

  const latestMetricIndex = useMemo(() => {
    const totalPoints = Math.max(
      historicals.years?.length || 0,
      historicals.revenue?.length || 0,
      historicals.netIncome?.length || 0
    );
    for (let i = totalPoints - 1; i >= 0; i--) {
      const rev = safeNumber(historicals.revenue?.[i]);
      const net = safeNumber(historicals.netIncome?.[i]);
      const ebit = safeNumber(historicals.ebit?.[i]);
      if (rev !== 0 || net !== 0 || ebit !== 0) return i;
    }
    return 0;
  }, [historicals]);

  // 1. Calculations & Data Prep
  const lastIdx = latestMetricIndex;
  const profilePrice = safeNumber(company.currentPrice);
  const historicalPrice = safeNumber(historicals.price);
  const impliedMarketEquity =
    safeNumber(company.marketCap) ||
    ((historicalPrice || profilePrice) * safeNumber(historicals.sharesOutstanding));
  const resolveEquityAt = (idx: number) => {
    if (idx < 0) return impliedMarketEquity;
    const equityRaw = safeNumber(historicals.shareholdersEquity?.[idx]);
    if (equityRaw > 0) return equityRaw;
    const assets = safeNumber(historicals.totalAssets?.[idx]);
    const liabilities = safeNumber(historicals.totalLiabilities?.[idx]);
    const derived = (assets > 0 && liabilities > 0) ? Math.max(assets - liabilities, 0) : 0;
    if (derived > 0) return derived;
    return latestPositive(historicals.shareholdersEquity, idx) || impliedMarketEquity;
  };

  const lastRevenue = safeNumber(historicals.revenue?.[lastIdx]);
  const lastEbitda = safeNumber(historicals.ebitda?.[lastIdx]);
  const lastEbit = safeNumber(historicals.ebit?.[lastIdx]);
  const lastNetIncome = safeNumber(historicals.netIncome?.[lastIdx]);
  const lastEquity = resolveEquityAt(lastIdx);
  const lastDebt = latestResolvedDebt(lastIdx);
  const lastCash = safeNumber(historicals.cash?.[lastIdx]);
  const lastMarketableSecurities = safeNumber(historicals.marketableSecurities?.[lastIdx]);
  // const lastAssets = historicals.totalAssets?.[lastIdx] || 0;

  // Heuristic: If EBITDA is zero but EBIT exists, use EBIT + Depreciation
  let effectiveEbitda = lastEbitda;
  if (effectiveEbitda === 0 && lastEbit !== 0) {
    const lastDep = historicals.depreciation?.[lastIdx] || 0;
    effectiveEbitda = lastEbit + lastDep;
  }

  const ebitdaMargin = (lastRevenue > 0 && effectiveEbitda !== 0) ? (effectiveEbitda / lastRevenue) : 0;

  // FCF Calculation
  const lastFCF = (historicals.netIncome?.[lastIdx] || 0) +
    (historicals.depreciation?.[lastIdx] || 0) -
    (historicals.nwcChange?.[lastIdx] || 0) -
    (historicals.capex?.[lastIdx] || 0);

  const rawCurrentPrice = safeNumber(results?.currentPrice) || historicalPrice || profilePrice;
  const displayCurrentPrice = rawCurrentPrice > 0 ? rawCurrentPrice : 0;

  // Market Cap
  const marketCap = impliedMarketEquity;

  // Prepare Chart Data
  const chartData = useMemo(() => {
    if (!historicals.years || historicals.years.length === 0) return [];

    return historicals.years.map((year, i) => {
      const rev = safeNumber(historicals.revenue?.[i]);
      const ebitdaRaw = safeNumber(historicals.ebitda?.[i]);
      const ebit = safeNumber(historicals.ebit?.[i]);
      const dep = safeNumber(historicals.depreciation?.[i]);
      const net = safeNumber(historicals.netIncome?.[i]);
      const resolvedEbitda = ebitdaRaw !== 0 ? ebitdaRaw : ebit + dep;

      return {
        year,
        revenue: rev,
        ebitda: resolvedEbitda,
        netIncome: net,
        grossMargin: rev > 0 ? (safeNumber(historicals.grossProfit?.[i]) / rev) * 100 : 0,
        netMargin: rev > 0 ? (net / rev) * 100 : 0,
        ebitdaMargin: rev > 0 ? (resolvedEbitda / rev) * 100 : 0,
      };
    }).filter((point) => point.revenue !== 0 || point.ebitda !== 0 || point.netIncome !== 0);
  }, [historicals]);

  const hasChartData = chartData.length > 0 && chartData.some(d => d.revenue > 0 || d.ebitda !== 0);

  // Ratios
  const roe = lastEquity > 0 ? lastNetIncome / lastEquity : 0;
  const debtToEquity = lastEquity > 0 ? lastDebt / lastEquity : 0;
  const netMarginVal = lastRevenue > 0 ? lastNetIncome / lastRevenue : 0;
  const prevIdx = lastIdx - 1;
  const fcfMargin = lastRevenue !== 0 ? lastFCF / lastRevenue : 0;
  const netCash = (lastCash + lastMarketableSecurities) - lastDebt;
  const prevRevenue = prevIdx >= 0 ? historicals.revenue?.[prevIdx] || 0 : 0;
  const revenueGrowth = prevRevenue > 0 && lastRevenue > 0
    ? (lastRevenue / prevRevenue) - 1
    : 0;

  const isKnown = (value?: string | null) => Boolean(value && value.trim() && value !== "Unknown");
  const rawSector = isKnown(company.sector) ? company.sector! : (isKnown(historicals.sector) ? historicals.sector! : "");
  const industryLabel = isKnown(company.industry) ? company.industry! : (isKnown(historicals.industry) ? historicals.industry! : "Unclassified");
  const sectorLabel = normalizeToGicsSector(rawSector, industryLabel) || "Information Technology";
  const sectorEmoji = getSectorEmoji(sectorLabel);
  const exchangeLabel = isKnown(company.exchange) ? company.exchange : "Primary Listing";
  const fiscalYearEndLabel = isKnown(company.fiscalYearEnd) ? company.fiscalYearEnd : "N/A";
  const latestYearLabel = historicals.years?.[lastIdx] ? `FY${historicals.years[lastIdx]}` : "latest fiscal year";

  // Trend Logic (Compare LTM to Year-1)
  const getTrend = (current: number, previous: number, lowerIsBetter = false) => {
    if (current === 0 || previous === 0) return 'neutral';
    if (lowerIsBetter) {
      return current < previous ? 'up' : (current > previous ? 'down' : 'neutral');
    }
    return current > previous ? 'up' : (current < previous ? 'down' : 'neutral');
  };

  const prevNetMargin = prevIdx >= 0 && (historicals.revenue?.[prevIdx] || 0) > 0
    ? (historicals.netIncome?.[prevIdx] || 0) / (historicals.revenue?.[prevIdx] || 1) : 0;

  const prevEquity = resolveEquityAt(prevIdx);
  const prevDebt = prevIdx >= 0 ? latestResolvedDebt(prevIdx) : 0;

  const prevROE = prevEquity > 0
    ? (historicals.netIncome?.[prevIdx] || 0) / prevEquity : 0;

  const prevDebtEq = prevEquity > 0
    ? prevDebt / prevEquity : 0;

  const hasDebtDataSignal =
    historicals.totalDebt?.some((v) => safeNumber(v) > 0) ||
    historicals.currentDebt?.some((v) => safeNumber(v) > 0) ||
    historicals.longTermDebt?.some((v) => safeNumber(v) > 0) ||
    false;

  // 2. Metric cards data - FILLED BUBBLES
  const marketDate = historicals.lastUpdated
    ? new Date(historicals.lastUpdated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "Latest";

  const financialDate = historicals.years?.[lastIdx] ? `FY ${historicals.years[lastIdx]}` : "LTM";

  const metrics = [
    {
      label: "Market Cap",
      value: marketCap > 0 ? formatLargeNumber(marketCap, true) : "—",
      subtext: "Total Value",
      date: marketDate,
      icon: Landmark,
      color: "#0066FF",
      shadow: "var(--shadow-glow-blue)"
    },
    {
      label: "Stock Price",
      value: displayCurrentPrice > 0 ? `$${displayCurrentPrice.toFixed(2)}` : "—",
      subtext: "Last Close",
      date: marketDate,
      icon: TrendingUp,
      color: "#30D158",
      shadow: "var(--shadow-glow-green)"
    },
    {
      label: "Revenue (LTM)",
      value: lastRevenue > 0 ? formatLargeNumber(lastRevenue, true) : "—",
      subtext: "Top Line",
      date: financialDate,
      icon: BarChart3,
      color: "#FF9500",
      shadow: "0 0 40px rgba(255, 149, 0, 0.25)"
    },
    {
      label: "EBITDA Margin",
      value: lastRevenue > 0 ? formatPercent(ebitdaMargin) : "—",
      subtext: "Profitability",
      date: financialDate,
      icon: Activity,
      color: "#2DD4BF",
      shadow: "0 0 40px rgba(45, 212, 191, 0.25)"
    },
    {
      label: "Free Cash Flow",
      value: lastRevenue > 0 ? formatLargeNumber(lastFCF, true) : "—",
      subtext: "Cash Gen",
      date: financialDate,
      icon: Globe,
      color: lastFCF >= 0 ? "#0066FF" : "#FF453A",
      shadow: lastFCF >= 0 ? "var(--shadow-glow-blue)" : "0 0 40px rgba(255, 69, 58, 0.25)"
    },
    {
      label: "Risk Beta",
      value: (historicals.beta || 1.0).toFixed(2),
      subtext: "Volatility",
      date: "5Y Monthly",
      icon: Users,
      color: "#BF5AF2",
      shadow: "0 0 40px rgba(191, 90, 242, 0.25)"
    },
  ];

  return (
    <div className="overview-theme-scope w-full max-w-7xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 py-6 pb-20">

      {/* 1. Entity Hero Section */}
      <GlassCard variant="regular" className="overview-light-card p-8 bg-[var(--bg-glass)] border-[var(--border-default)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 rounded-3xl bg-[var(--color-blue)]/10 border border-[var(--color-blue)]/20 flex items-center justify-center relative group">
              <span className="text-[36px] leading-none transition-transform group-hover:scale-110 duration-500" aria-hidden="true">{sectorEmoji}</span>
            </div>
            <div className="space-y-1">
              <div className="flex items-baseline gap-4">
                <h1 className="text-6xl font-black text-[var(--text-primary)] tracking-tighter leading-none font-display">
                  {company.ticker}
                </h1>
                <h2 className="text-2xl text-[var(--text-tertiary)] font-bold tracking-tight">
                  {company.name}
                </h2>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[10px] font-black text-[var(--text-tertiary)] uppercase tracking-[0.2em] px-2.5 py-1 bg-white/[0.03] rounded-lg border border-white/10">
                  CIK: {company.cik}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-6">
            <div className="flex items-center gap-3">
              <button
                onClick={onExcelExport}
                disabled={isExporting}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[var(--color-green)] text-white transition-all disabled:opacity-50 font-bold text-[11px] uppercase tracking-widest shadow-[var(--shadow-glow-green)]/20 hover:opacity-90 active:scale-95"
              >
                <FileSpreadsheet size={14} />
                <span>Export Excel</span>
              </button>
              <button
                onClick={handleMarkdownExport}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[var(--color-blue)] text-white transition-all font-bold text-[11px] uppercase tracking-widest shadow-[var(--shadow-glow-blue)]/20 hover:opacity-90 active:scale-95"
              >
                <FileText size={14} />
                <span>Export Markdown</span>
              </button>
            </div>

            <div className="flex items-center gap-10">
              <div className="text-right">
                <div className="text-[11px] text-white/50 font-black uppercase tracking-[0.2em] mb-1">Market Sector</div>
                <div className="text-[15px] font-bold text-white uppercase tracking-tight">
                  {sectorLabel}
                </div>
              </div>

              <div className="pl-8 border-l border-white/10 text-right">
                <div className="text-[11px] text-white/50 font-black uppercase tracking-[0.2em] mb-1">Reporting Period</div>
                <div className="text-[15px] font-black text-[var(--color-green)] uppercase tracking-widest">{fiscalYearEndLabel}</div>
              </div>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* 2. Top Metrics Grid - COLORED CARDS */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="overview-force-white group relative overflow-hidden p-5 rounded-[22px] transform-gpu will-change-transform transition-[transform,box-shadow,opacity] duration-200 ease-out hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:transition-none shadow-2xl cursor-default"
            style={{
              background: `linear-gradient(135deg, ${metric.color} 0%, ${metric.color} 100%)`,
              boxShadow: `0 15px 35px -10px ${metric.color}66`,
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-transparent opacity-50 pointer-events-none" />

            <div className="flex justify-between items-start mb-4 relative z-10">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center relative overflow-hidden group-hover:rotate-3 transition-transform duration-200 ease-out motion-reduce:transform-none bg-white/20 border border-white/30 shadow-lg backdrop-blur-md"
              >
                <metric.icon size={18} className="text-white drop-shadow-md relative z-10" />
              </div>
              <div className="px-2.5 py-1 rounded-lg bg-black/20 border border-white/10 backdrop-blur-md">
                <span className="text-[10px] font-bold text-white uppercase tracking-wider leading-none whitespace-nowrap">
                  {metric.date}
                </span>
              </div>
            </div>

            <div className="relative z-10">
              <div className="text-[24px] font-black text-white tracking-tighter mb-1 font-display tabular-nums drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]">
                {metric.value}
              </div>
              <div className="flex flex-col text-white">
                <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white">
                  {metric.label}
                </span>
                <span className="text-[12px] font-bold mt-1 text-white/90">
                  {metric.subtext}
                </span>
              </div>
            </div>

            {/* Decorative white glow */}
            <div
              className="absolute -right-12 -bottom-12 w-32 h-32 blur-[40px] bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 rounded-full"
            />
          </div>
        ))}
      </div>

      <GlassCard variant="regular" className="overview-light-card p-8 bg-[var(--bg-glass)] border border-[var(--border-subtle)] shadow-xl relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--color-blue)]/5 blur-[40px] -mr-16 -mt-16 pointer-events-none" />

        <h3 className="text-[16px] font-black text-white uppercase tracking-[0.3em] flex items-center gap-3 mb-8 relative z-10">
          <Building2 size={18} className="text-[var(--color-blue)]" />
          Executive Strategic Overview
        </h3>
        <p className="text-[16px] leading-relaxed text-white font-medium relative z-10 opacity-90">
          <span className="font-black text-white">{company.name} ({company.ticker})</span> operates in <span className="font-black text-white">{industryLabel}</span> within the <span className="font-black text-white">{sectorLabel}</span> sector, listed on <span className="font-black text-white">{exchangeLabel}</span>.{" "}
          {lastRevenue > 0 ? (
            <>
              <span className="font-black text-white">{latestYearLabel}</span> revenue was <span className="font-black text-[var(--color-green)]">{formatLargeNumber(lastRevenue, true)}</span> and net income was <span className="font-black text-[var(--color-green)]">{formatLargeNumber(lastNetIncome, true)}</span>.{" "}
            </>
          ) : (
            <>
              Recent revenue and net income disclosures are limited, so the model is relying on available filed data.{" "}
            </>
          )}
          {prevRevenue > 0 && lastRevenue > 0 && (
            <>
              Year-over-year revenue growth was <span className="font-black text-[var(--color-blue)]">{formatPercent(revenueGrowth)}</span>.{" "}
            </>
          )}
          {lastRevenue > 0 && (
            <>
              Net margin is <span className="font-black text-[var(--color-purple)]">{formatPercent(netMarginVal)}</span>, EBITDA margin is <span className="font-black text-[var(--color-purple)]">{formatPercent(ebitdaMargin)}</span>, and free cash flow margin is <span className="font-black text-[var(--color-purple)]">{formatPercent(fcfMargin)}</span>.{" "}
            </>
          )}
          {(lastDebt > 0 || lastCash > 0 || lastMarketableSecurities > 0) && (
            <>
              {company.ticker} currently runs a <span className="font-black text-white">{netCash >= 0 ? "net cash" : "net debt"}</span> position of <span className="font-black text-[var(--color-green)]">{formatLargeNumber(netCash, true)}</span>.{" "}
            </>
          )}
          {results && (
            <>
              Current model output implies <span className="font-black text-white">{results.upside >= 0 ? "upside" : "downside"}</span> of <span className={cn("font-black", results.upside >= 0 ? "text-[var(--color-green)]" : "text-[var(--color-red)]")}>{(Math.abs(results.upside) * 100).toFixed(1)}%</span> versus market price.
            </>
          )}
        </p>
      </GlassCard>

      <div className="flex flex-wrap gap-6">

        {/* 3. Main Chart: Revenue & Profitability */}
        <div className="overview-light-card flex-[2_1_500px] p-8 rounded-[32px] bg-[var(--bg-glass)] border border-[var(--border-subtle)] shadow-2xl min-h-[440px] flex flex-col relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-[var(--color-blue)]/5 blur-[100px] -mr-48 -mt-48 pointer-events-none" />

          <div className="flex items-center justify-between mb-10 relative z-10">
            <h3 className="overview-graph-title text-[14px] font-black text-white uppercase tracking-[0.25em] flex items-center gap-2.5">
              <Activity size={18} className="text-[var(--color-blue)]" />
              Growth Trajectory & Profitability
            </h3>
            {hasChartData && (
              <div className="flex gap-3">
                <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[var(--color-blue)]/10 border border-[var(--color-blue)]/20 shadow-[var(--shadow-glow-blue)]/10">
                  <div className="w-2 h-2 rounded-full relative" style={{ backgroundColor: "var(--color-blue)", boxShadow: "0 0 8px var(--color-blue)" }}>
                    <div className="absolute inset-0 rounded-full animate-ping opacity-10" style={{ backgroundColor: "var(--color-blue)" }} />
                  </div>
                  <span className="text-[10px] font-black text-[var(--color-blue)] uppercase tracking-widest">Revenue</span>
                </div>
                <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[var(--color-green)]/10 border border-[var(--color-green)]/20 shadow-[var(--shadow-glow-green)]/10">
                  <div className="w-2 h-2 rounded-full relative" style={{ backgroundColor: "var(--color-green)", boxShadow: "0 0 8px var(--color-green)" }}>
                    <div className="absolute inset-0 rounded-full animate-ping opacity-10" style={{ backgroundColor: "var(--color-green)" }} />
                  </div>
                  <span className="text-[10px] font-black text-[var(--color-green)] uppercase tracking-widest">EBITDA</span>
                </div>
              </div>
            )}
          </div>

          <MeasuredChartContainer
            className="flex-1 w-full min-h-[300px] relative z-10"
            minHeight={300}
            fallback={<div className="h-full w-full" />}
          >
            {({ width, height }) => hasChartData ? (
                <ComposedChart width={width} height={height} className="overview-chart-axis" data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-blue)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="var(--color-blue)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorEbitda" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-green)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--color-green)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                  <XAxis
                    dataKey="year"
                    stroke="rgba(255,255,255,0.85)"
                    fontSize={12}
                    fontWeight={800}
                    tickLine={false}
                    axisLine={false}
                    dy={10}
                  />
                  <YAxis
                    stroke="rgba(255,255,255,0.85)"
                    fontSize={12}
                    fontWeight={800}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => formatLargeNumber(val)}
                    dx={-10}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border-default)',
                      borderRadius: '16px',
                      boxShadow: '0 10px 40px rgba(0,0,0,0.25)'
                    }}
                    itemStyle={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 800 }}
                    labelStyle={{ color: 'var(--text-secondary)', fontSize: '10px', fontWeight: 900, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '2px' }}
                                formatter={(value) => formatLargeNumber(Number(value) || 0, true)}
                    cursor={{ stroke: 'var(--color-blue)', strokeWidth: 1, strokeDasharray: '4 4' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke="var(--color-blue)"
                    strokeWidth={4}
                    fillOpacity={1}
                    fill="url(#colorRevenue)"
                    animationDuration={1500}
                  />
                  <Area
                    type="monotone"
                    dataKey="ebitda"
                    name="EBITDA"
                    stroke="var(--color-green)"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorEbitda)"
                    animationDuration={1500}
                  />
                </ComposedChart>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-[var(--text-tertiary)] gap-4">
                <BarChart3 size={48} className="opacity-20" />
                <p className="text-sm font-bold opacity-60">Historical data not available for this company</p>
              </div>
            )}
          </MeasuredChartContainer>
        </div>

        {/* 4. Secondary: Margins & Ratios */}
        <div className="flex-[1_1_300px] space-y-6">

          {/* Margins Chart */}
          <GlassCard variant="regular" className="overview-light-card p-8 bg-[var(--bg-glass)] border border-[var(--border-subtle)] shadow-2xl h-[370px] flex flex-col overflow-hidden relative">
            <div className="absolute top-0 right-0 w-48 h-48 bg-[var(--color-purple)]/5 blur-[60px] -mr-24 -mt-24 pointer-events-none" />

            <h3 className="overview-graph-title text-[14px] font-black text-white uppercase tracking-[0.25em] flex items-center gap-2.5 mb-8 relative z-10">
              <PieChart size={18} className="text-[var(--color-purple)]" />
              Efficiency Dynamics
            </h3>
            <MeasuredChartContainer
              className="w-full h-[265px] md:h-[280px] relative z-10"
              minHeight={265}
              fallback={<div className="h-full w-full" />}
            >
              {({ width, height }) => (
                <ComposedChart width={width} height={height} className="overview-chart-axis" data={chartData} margin={{ top: 12, right: 8, bottom: 16, left: 12 }}>
                  <defs>
                    <linearGradient id="colorMargin" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-purple)" stopOpacity={0.6} />
                      <stop offset="95%" stopColor="var(--color-purple)" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis
                    dataKey="year"
                    stroke="rgba(255,255,255,0.75)"
                    fontSize={10}
                    fontWeight={800}
                    tickLine={false}
                    axisLine={false}
                    dy={6}
                    height={28}
                  />
                  <YAxis
                    stroke="rgba(255,255,255,0.65)"
                    fontSize={10}
                    fontWeight={900}
                    tickLine={false}
                    axisLine={false}
                    width={42}
                    tick={{ fill: 'rgba(255,255,255,0.8)' }}
                    tickFormatter={(val) => `${val}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border-default)',
                      borderRadius: '12px',
                      padding: '8px 12px',
                      boxShadow: '0 10px 30px rgba(0,0,0,0.25)'
                    }}
                    itemStyle={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 900 }}
                    labelStyle={{ color: 'var(--text-secondary)', fontSize: '10px', fontWeight: 900, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '1px' }}
                    formatter={(val) => `${(Number(val) || 0).toFixed(1)}%`}
                    cursor={{ stroke: 'var(--color-purple)', strokeOpacity: 0.4 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="netMargin"
                    stroke="var(--color-purple)"
                    strokeWidth={3}
                    strokeLinecap="round"
                    fill="url(#colorMargin)"
                    name="Net Margin"
                    animationDuration={1500}
                  />
                </ComposedChart>
              )}
            </MeasuredChartContainer>
          </GlassCard>

          {/* Key Ratios Grid - GLASS CARDS */}
          <div className="grid grid-cols-2 gap-4">
            <RatioCard
              label="ROE"
              value={lastEquity > 0 ? formatPercent(roe) : "—"}
              subtitle="Return on Equity"
              trend={getTrend(roe, prevROE)}
            />
            <RatioCard
              label="Net Margin"
              value={lastRevenue > 0 ? formatPercent(netMarginVal) : "—"}
              subtitle="Profitability"
              trend={getTrend(netMarginVal, prevNetMargin)}
            />
            <RatioCard
              label="Debt / Eq"
              value={(hasDebtDataSignal && lastEquity > 0) ? debtToEquity.toFixed(2) + "x" : "—"}
              subtitle="Leverage"
              trend={hasDebtDataSignal ? getTrend(debtToEquity, prevDebtEq, true) : "neutral"}
            />
            <RatioCard
              label="Tax Rate"
              value={formatPercent(historicals.taxRate?.[lastIdx] || 0.21)}
              subtitle="Effective Rate"
              trend="neutral"
            />
          </div>

        </div>
      </div>

    </div>
  );
});

export default CompanyOverviewPage;
