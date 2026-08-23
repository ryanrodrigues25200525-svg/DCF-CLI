"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Assumptions, HistoricalData, Overrides } from "@/core/types";
import { calculateDCF } from "@/services/dcf/engine";
import { AlertTriangle, BarChart3, ChevronDown, Grid3X3, Target } from "lucide-react";
import { GlassCard } from "@/components/ui/primitives/GlassCard";
import { cn } from "@/core/utils/cn";

interface Props {
  historicals: HistoricalData;
  assumptions: Assumptions;
  overrides: Overrides;
  disabledReason?: string;
}

type AxisKey =
  | "revenueGrowth"
  | "terminalGrowthRate"
  | "terminalExitMultiple"
  | "ebitMargin"
  | "taxRate"
  | "capexRatio"
  | "nwcChangeRatio"
  | "beta"
  | "equityRiskPremium"
  | "wacc"
  | "costOfDebt"
  | "leverageTarget"
  | "forecastYears";

type MatrixPreset = {
  id: string;
  label: string;
  group: "Valuation Drivers" | "Exit Scenarios" | "Growth & Profitability" | "Capital Structure";
  x: AxisKey;
  y: AxisKey;
  forceValuationMethod?: "growth" | "multiple";
};

type SidebarMatrixItem = {
  label: string;
  presetId?: string;
  featured?: boolean;
  disabled?: boolean;
};

type OutputMetric = "equityValue" | "enterpriseValue" | "impliedSharePrice" | "irr" | "moic";

type CustomMatrixConfig = {
  x: AxisKey;
  xMin: number;
  xMax: number;
  xSteps: number;
  y: AxisKey;
  yMin: number;
  yMax: number;
  ySteps: number;
  outputMetric: OutputMetric;
};

type AxisDef = {
  label: string;
  short: string;
  step: number;
  min: number;
  max: number;
  kind: "percent" | "multiple" | "years" | "number";
  read: (a: Assumptions) => number;
  write: (a: Assumptions, v: number) => Assumptions;
};

const axisDefs: Record<AxisKey, AxisDef> = {
  revenueGrowth: {
    label: "Revenue Growth",
    short: "Rev CAGR",
    step: 0.01,
    min: -0.1,
    max: 0.5,
    kind: "percent",
    read: (a) => a.revenueGrowth,
    write: (a, v) => ({ ...a, revenueGrowth: v, revenueGrowthStage1: v }),
  },
  terminalGrowthRate: {
    label: "Terminal Growth",
    short: "TGR",
    step: 0.005,
    min: 0,
    max: 0.08,
    kind: "percent",
    read: (a) => a.terminalGrowthRate,
    write: (a, v) => ({ ...a, terminalGrowthRate: v }),
  },
  terminalExitMultiple: {
    label: "Exit Multiple",
    short: "Exit EV/EBITDA",
    step: 1,
    min: 4,
    max: 30,
    kind: "multiple",
    read: (a) => a.terminalExitMultiple,
    write: (a, v) => ({ ...a, terminalExitMultiple: v }),
  },
  ebitMargin: {
    label: "EBIT Margin",
    short: "EBIT Margin",
    step: 0.01,
    min: 0.05,
    max: 0.6,
    kind: "percent",
    read: (a) => a.ebitMargin,
    write: (a, v) => ({ ...a, ebitMargin: v, ebitMarginSteadyState: v }),
  },
  taxRate: {
    label: "Tax Rate",
    short: "Tax Rate",
    step: 0.01,
    min: 0,
    max: 0.4,
    kind: "percent",
    read: (a) => a.taxRate,
    write: (a, v) => ({ ...a, taxRate: v }),
  },
  capexRatio: {
    label: "CAPEX % Revenue",
    short: "CAPEX %",
    step: 0.005,
    min: 0,
    max: 0.25,
    kind: "percent",
    read: (a) => a.capexRatio,
    write: (a, v) => ({ ...a, capexRatio: v }),
  },
  nwcChangeRatio: {
    label: "NWC % Revenue",
    short: "NWC %",
    step: 0.005,
    min: -0.1,
    max: 0.2,
    kind: "percent",
    read: (a) => a.nwcChangeRatio,
    write: (a, v) => ({ ...a, nwcChangeRatio: v }),
  },
  beta: {
    label: "Beta",
    short: "Beta",
    step: 0.1,
    min: 0.4,
    max: 2.5,
    kind: "number",
    read: (a) => a.beta || 1,
    write: (a, v) => ({ ...a, beta: v }),
  },
  equityRiskPremium: {
    label: "Market Risk Premium",
    short: "MRP",
    step: 0.005,
    min: 0.03,
    max: 0.1,
    kind: "percent",
    read: (a) => a.equityRiskPremium || 0.05,
    write: (a, v) => ({ ...a, equityRiskPremium: v }),
  },
  wacc: {
    label: "WACC",
    short: "WACC",
    step: 0.005,
    min: 0.05,
    max: 0.18,
    kind: "percent",
    read: (a) => a.wacc,
    write: (a, v) => ({ ...a, wacc: v }),
  },
  costOfDebt: {
    label: "Interest Rate",
    short: "Cost of Debt",
    step: 0.005,
    min: 0.01,
    max: 0.15,
    kind: "percent",
    read: (a) => a.costOfDebt || 0.05,
    write: (a, v) => ({ ...a, costOfDebt: v }),
  },
  leverageTarget: {
    label: "Debt/Equity Target",
    short: "D/E Target",
    step: 0.1,
    min: 0,
    max: 2,
    kind: "number",
    read: (a) => {
      const debtWeight = clamp(a.leverageTarget || 0.2, 0, 0.95);
      return debtWeight / Math.max(1 - debtWeight, 0.05);
    },
    write: (a, v) => {
      const debtToEquity = Math.max(0, v);
      const debtWeight = debtToEquity / (1 + debtToEquity);
      return { ...a, leverageTarget: clamp(debtWeight, 0, 0.95) };
    },
  },
  forecastYears: {
    label: "Hold Period",
    short: "Years to Exit",
    step: 1,
    min: 5,
    max: 15,
    kind: "years",
    read: (a) => a.forecastYears,
    write: (a, v) => ({ ...a, forecastYears: Math.max(5, Math.min(15, Math.round(v))) }),
  },
};

const matrixPresets: MatrixPreset[] = [
  { id: "tgr-wacc", label: "Terminal Growth × WACC", group: "Valuation Drivers", x: "wacc", y: "terminalGrowthRate", forceValuationMethod: "growth" },
  { id: "rev-ebit", label: "Revenue Growth × EBIT Margin", group: "Valuation Drivers", x: "revenueGrowth", y: "ebitMargin" },
  { id: "beta-mrp", label: "Beta × Market Risk Premium", group: "Valuation Drivers", x: "beta", y: "equityRiskPremium" },
  { id: "rev-tgr", label: "Revenue Growth × Terminal Growth", group: "Growth & Profitability", x: "revenueGrowth", y: "terminalGrowthRate", forceValuationMethod: "growth" },
  { id: "ebit-tax", label: "EBIT Margin × Tax Rate", group: "Growth & Profitability", x: "ebitMargin", y: "taxRate" },
  { id: "rev-capex", label: "Revenue Growth × CAPEX %", group: "Growth & Profitability", x: "revenueGrowth", y: "capexRatio" },
  { id: "nwc-rev", label: "NWC % × Revenue Growth", group: "Growth & Profitability", x: "nwcChangeRatio", y: "revenueGrowth" },
  { id: "debt-interest", label: "Debt/Equity × Interest Rate", group: "Capital Structure", x: "leverageTarget", y: "costOfDebt" },
  { id: "leverage-wacc", label: "Leverage × WACC", group: "Capital Structure", x: "leverageTarget", y: "wacc" },
  { id: "wacc-exit", label: "WACC × Exit Multiple", group: "Exit Scenarios", x: "wacc", y: "terminalExitMultiple", forceValuationMethod: "multiple" },
  { id: "hold-exit", label: "Exit Multiple × Hold Period", group: "Exit Scenarios", x: "terminalExitMultiple", y: "forecastYears", forceValuationMethod: "multiple" },
  { id: "rev-exit", label: "Revenue Growth × Exit Multiple", group: "Exit Scenarios", x: "revenueGrowth", y: "terminalExitMultiple", forceValuationMethod: "multiple" },
  { id: "margin-exit", label: "EBIT Margin × Exit Multiple", group: "Exit Scenarios", x: "ebitMargin", y: "terminalExitMultiple", forceValuationMethod: "multiple" },
];

const sidebarSections: Array<{ title: string; emoji: string; items: SidebarMatrixItem[] }> = [
  {
    title: "Valuation Drivers",
    emoji: "📊",
    items: [
      { label: "Terminal Growth × WACC", presetId: "tgr-wacc", featured: true },
      { label: "Revenue Growth × EBIT Margin", presetId: "rev-ebit", featured: true },
      { label: "Beta × Market Risk Premium", presetId: "beta-mrp" },
    ],
  },
  {
    title: "Exit Scenarios",
    emoji: "💰",
    items: [
      { label: "Exit Multiple × Hold Period", presetId: "hold-exit", featured: true },
      { label: "WACC × Exit Multiple", presetId: "wacc-exit", featured: true },
      { label: "Revenue Growth × Exit Multiple", presetId: "rev-exit" },
    ],
  },
  {
    title: "Growth & Profitability",
    emoji: "📈",
    items: [
      { label: "Revenue × Terminal Growth", presetId: "rev-tgr" },
      { label: "EBIT Margin × Tax Rate", presetId: "ebit-tax" },
      { label: "Revenue Growth × CAPEX %", presetId: "rev-capex" },
    ],
  },
  {
    title: "Capital Structure",
    emoji: "🏦",
    items: [
      { label: "Debt/Equity × Interest Rate", presetId: "debt-interest" },
      { label: "Leverage × WACC", presetId: "leverage-wacc" },
    ],
  },
];

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function normalizeSensitivityAssumptions(input: Assumptions, opts?: { recomputeWacc?: boolean }): Assumptions {
  const riskFreeRate = input.riskFreeRate ?? 0.046;
  const equityRiskPremium = input.equityRiskPremium ?? 0.052;
  const beta = input.beta ?? 1;
  const taxRate = clamp(input.taxRate, 0, 0.6);
  const costOfDebt = input.costOfDebt ?? 0.05;

  const leverageTargetFromWeights =
    input.weightDebt !== undefined
      ? input.weightDebt
      : 0;
  const leverageTarget = clamp(input.leverageTarget ?? leverageTargetFromWeights, 0, 0.95);

  const weightDebt = leverageTarget;
  const weightEquity = 1 - weightDebt;
  const costOfEquity = riskFreeRate + beta * equityRiskPremium;
  const computedWacc = Math.max(0.001, weightEquity * costOfEquity + weightDebt * costOfDebt * (1 - taxRate));
  const wacc = opts?.recomputeWacc ? computedWacc : Math.max(0.001, input.wacc ?? computedWacc);

  return {
    ...input,
    riskFreeRate,
    equityRiskPremium,
    beta,
    leverageTarget,
    costOfDebt,
    costOfEquity,
    weightDebt,
    weightEquity,
    wacc,
  };
}

function axisValues(base: number, def: AxisDef): number[] {
  return [
    clamp(base - 2 * def.step, def.min, def.max),
    clamp(base - def.step, def.min, def.max),
    clamp(base, def.min, def.max),
    clamp(base + def.step, def.min, def.max),
    clamp(base + 2 * def.step, def.min, def.max),
  ];
}

function axisValuesFromRange(min: number, max: number, steps: number, def: AxisDef): number[] {
  const safeSteps = Math.max(3, Math.min(9, Math.round(steps)));
  const lo = clamp(Math.min(min, max), def.min, def.max);
  const hi = clamp(Math.max(min, max), def.min, def.max);
  if (safeSteps === 1 || lo === hi) return [lo];
  const step = (hi - lo) / (safeSteps - 1);
  return Array.from({ length: safeSteps }, (_, i) => clamp(lo + i * step, def.min, def.max));
}

function fmtAxis(v: number, def: AxisDef) {
  if (def.kind === "percent") return `${(v * 100).toFixed(1)}%`;
  if (def.kind === "multiple") return `${v.toFixed(1)}x`;
  if (def.kind === "years") return `${Math.round(v)}Y`;
  return v.toFixed(2);
}

function closestStepIndex(values: number[], target: number) {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  values.forEach((v, idx) => {
    const dist = Math.abs(v - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = idx;
    }
  });
  return best;
}

function getMetricValue(result: ReturnType<typeof calculateDCF>, metric: OutputMetric, currentPrice: number, holdYears: number) {
  if (metric === "equityValue") return result.equityValue;
  if (metric === "enterpriseValue") return result.enterpriseValue;
  if (metric === "moic") return currentPrice > 0 ? result.impliedSharePrice / currentPrice : 0;
  if (metric === "irr") {
    if (currentPrice <= 0 || holdYears <= 0) return 0;
    const gross = result.impliedSharePrice / currentPrice;
    return gross > 0 ? Math.pow(gross, 1 / holdYears) - 1 : -1;
  }
  return result.impliedSharePrice;
}

function formatMetricValue(value: number, metric: OutputMetric) {
  if (metric === "equityValue" || metric === "enterpriseValue") return `$${value.toFixed(1)}`;
  if (metric === "irr") return `${(value * 100).toFixed(1)}%`;
  if (metric === "moic") return `${value.toFixed(2)}x`;
  return value.toFixed(1);
}

function isWaccDerivedDriver(key: AxisKey) {
  return key === "beta" || key === "equityRiskPremium" || key === "costOfDebt" || key === "leverageTarget";
}

export const SensitivityAnalysis = memo(function SensitivityAnalysis({ historicals, assumptions, overrides, disabledReason }: Props) {
  const sensitivityPalette = {
    red: { r: 255, g: 59, b: 48 },
    yellow: { r: 255, g: 214, b: 10 },
    green: { r: 50, g: 215, b: 75 },
  } as const;

  const chartCellColor = (delta: number, maxDelta: number) => {
    const safeMax = Math.max(maxDelta, 1);
    const intensity = Math.min(1, Math.abs(delta) / safeMax);
    const mix = Math.min(1, intensity * 1.2);
    const { red, yellow, green } = sensitivityPalette;
    const from = delta >= 0 ? yellow : red;
    const to = delta >= 0 ? green : yellow;
    const r = Math.round(from.r + (to.r - from.r) * mix);
    const g = Math.round(from.g + (to.g - from.g) * mix);
    const b = Math.round(from.b + (to.b - from.b) * mix);
    const alpha = 0.28 + intensity * 0.54;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const [hoverPos, setHoverPos] = useState<{ r: number; c: number } | null>(null);
  const [presetId, setPresetId] = useState("tgr-wacc");
  const [customBtnPulse, setCustomBtnPulse] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<"x" | "y" | "output" | null>(null);
  const dropdownRootRef = useRef<HTMLDivElement | null>(null);
  const [customConfig, setCustomConfig] = useState<CustomMatrixConfig>({
    x: "revenueGrowth",
    xMin: 0.04,
    xMax: 0.12,
    xSteps: 5,
    y: "ebitMargin",
    yMin: 0.25,
    yMax: 0.4,
    ySteps: 5,
    outputMetric: "impliedSharePrice",
  });
  const axisOptions = useMemo(
    () => (Object.keys(axisDefs) as AxisKey[]).map((key) => ({ value: key, label: axisDefs[key].label })),
    []
  );
  const outputMetricOptions: Array<{ value: OutputMetric; label: string }> = useMemo(
    () => [
      { value: "equityValue", label: "Equity Value" },
      { value: "enterpriseValue", label: "Enterprise Value" },
      { value: "impliedSharePrice", label: "Implied Share Price" },
      { value: "irr", label: "IRR" },
      { value: "moic", label: "Multiple of Invested Capital" },
    ],
    []
  );

  useEffect(() => {
    const handleDocClick = (event: MouseEvent) => {
      if (!dropdownRootRef.current) return;
      if (!dropdownRootRef.current.contains(event.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleDocClick);
    return () => document.removeEventListener("mousedown", handleDocClick);
  }, []);

  const selectedPreset = useMemo(
    () => matrixPresets.find((p) => p.id === presetId),
    [presetId]
  );

  const baseAssumptions = useMemo(() => {
    const seeded = selectedPreset?.forceValuationMethod
      ? { ...assumptions, valuationMethod: selectedPreset.forceValuationMethod }
      : assumptions;
    return normalizeSensitivityAssumptions(seeded);
  }, [assumptions, selectedPreset]);

  const isCustom = presetId === "custom";
  const xKey = isCustom ? customConfig.x : selectedPreset?.x || matrixPresets[0].x;
  const yKey = isCustom ? customConfig.y : selectedPreset?.y || matrixPresets[0].y;
  const matrixTouchesWacc = xKey === "wacc" || yKey === "wacc";
  const matrixTouchesCapitalStructure =
    xKey === "beta" || xKey === "equityRiskPremium" || xKey === "costOfDebt" || xKey === "leverageTarget" ||
    yKey === "beta" || yKey === "equityRiskPremium" || yKey === "costOfDebt" || yKey === "leverageTarget";
  const shouldRecomputeWacc = !matrixTouchesWacc && matrixTouchesCapitalStructure;
  const xDef = axisDefs[xKey];
  const yDef = axisDefs[yKey];
  const effectiveBaseAssumptions = useMemo(
    () => normalizeSensitivityAssumptions(baseAssumptions, { recomputeWacc: shouldRecomputeWacc }),
    [baseAssumptions, shouldRecomputeWacc]
  );

  const xBase = xDef.read(effectiveBaseAssumptions);
  const yBase = yDef.read(effectiveBaseAssumptions);
  const xSteps = useMemo(
    () => (isCustom ? axisValuesFromRange(customConfig.xMin, customConfig.xMax, customConfig.xSteps, xDef) : axisValues(xBase, xDef)),
    [isCustom, customConfig.xMin, customConfig.xMax, customConfig.xSteps, xBase, xDef]
  );
  const ySteps = useMemo(
    () => (isCustom ? axisValuesFromRange(customConfig.yMin, customConfig.yMax, customConfig.ySteps, yDef) : axisValues(yBase, yDef)),
    [isCustom, customConfig.yMin, customConfig.yMax, customConfig.ySteps, yBase, yDef]
  );
  const xBaseIdx = useMemo(() => closestStepIndex(xSteps, xBase), [xSteps, xBase]);
  const yBaseIdx = useMemo(() => closestStepIndex(ySteps, yBase), [ySteps, yBase]);
  const selectedMetric: OutputMetric = isCustom ? customConfig.outputMetric : "impliedSharePrice";

  const baseResults = useMemo(
    () => calculateDCF(historicals, effectiveBaseAssumptions, overrides),
    [historicals, effectiveBaseAssumptions, overrides]
  );
  const basePrice = baseResults.impliedSharePrice;
  const currentPrice = historicals.price || 0;
  const holdYears = Math.max(1, Math.round(effectiveBaseAssumptions.forecastYears || 5));
  const baseMetricValue = getMetricValue(baseResults, selectedMetric, currentPrice, holdYears);

  const matrix = useMemo(() => {
    const grid: Array<Array<{ value: number; invalid: boolean }>> = [];
    let minVal = Number.POSITIVE_INFINITY;
    let maxVal = Number.NEGATIVE_INFINITY;
    let invalidCount = 0;

    for (let r = 0; r < ySteps.length; r++) {
      const row: Array<{ value: number; invalid: boolean }> = [];
      for (let c = 0; c < xSteps.length; c++) {
        let cellAssumptions = xDef.write(effectiveBaseAssumptions, xSteps[c]);
        cellAssumptions = yDef.write(cellAssumptions, ySteps[r]);
        cellAssumptions = normalizeSensitivityAssumptions(cellAssumptions, { recomputeWacc: shouldRecomputeWacc });

        const invalid =
          cellAssumptions.valuationMethod === "growth" &&
          cellAssumptions.terminalGrowthRate >= cellAssumptions.wacc;

        if (invalid) {
          invalidCount += 1;
          row.push({ value: 0, invalid: true });
          continue;
        }

        const dcfResult = calculateDCF(historicals, cellAssumptions, overrides);
        const value = getMetricValue(dcfResult, selectedMetric, currentPrice, holdYears);
        minVal = Math.min(minVal, value);
        maxVal = Math.max(maxVal, value);
        row.push({ value, invalid: false });
      }
      grid.push(row);
    }

    if (!Number.isFinite(minVal)) minVal = 0;
    if (!Number.isFinite(maxVal)) maxVal = 1;
    return { grid, minVal, maxVal, invalidCount };
  }, [historicals, overrides, effectiveBaseAssumptions, xDef, yDef, xSteps, ySteps, shouldRecomputeWacc, selectedMetric, currentPrice, holdYears]);

  const matrixMeta = useMemo(() => {
    const range = matrix.maxVal - matrix.minVal;
    const baseAbs = Math.abs(baseMetricValue);
    const rangePct = baseAbs > 0 ? (range / baseAbs) * 100 : 0;
    const sensitivity = rangePct > 80 ? "HIGH" : rangePct > 35 ? "MEDIUM" : "LOW";
    const tvWeight = baseResults.enterpriseValue > 0 ? baseResults.pvTerminalValue / baseResults.enterpriseValue : 0;
    return { range, rangePct, sensitivity, tvWeight };
  }, [matrix, baseMetricValue, baseResults]);

  const tornado = useMemo(() => {
    const drivers: AxisKey[] = [
      "terminalGrowthRate",
      "wacc",
      "revenueGrowth",
      "ebitMargin",
      "terminalExitMultiple",
      "capexRatio",
      "taxRate",
      "beta",
    ];

    const rows = drivers.map((k) => {
      const def = axisDefs[k];
      const base = def.read(effectiveBaseAssumptions);
      const low = def.write(effectiveBaseAssumptions, clamp(base - def.step * 2, def.min, def.max));
      const high = def.write(effectiveBaseAssumptions, clamp(base + def.step * 2, def.min, def.max));
      const recomputeForDriver = isWaccDerivedDriver(k);
      const lowPrice = calculateDCF(historicals, normalizeSensitivityAssumptions(low, { recomputeWacc: recomputeForDriver }), overrides).impliedSharePrice;
      const highPrice = calculateDCF(historicals, normalizeSensitivityAssumptions(high, { recomputeWacc: recomputeForDriver }), overrides).impliedSharePrice;
      const down = lowPrice - basePrice;
      const up = highPrice - basePrice;
      return { key: k, label: def.label, down, up, impact: Math.max(Math.abs(down), Math.abs(up)) };
    });

    rows.sort((a, b) => b.impact - a.impact);
    const maxImpact = rows.length ? rows[0].impact : 1;
    return { rows, maxImpact };
  }, [historicals, overrides, effectiveBaseAssumptions, basePrice]);

  const breakEven = useMemo(() => {
    const target = currentPrice;
    if (target <= 0) return [];

    const solve = (k: AxisKey) => {
      const def = axisDefs[k];
      let lo = def.min;
      let hi = def.max;

      const recomputeForDriver = isWaccDerivedDriver(k);
      const priceAt = (v: number) =>
        calculateDCF(historicals, normalizeSensitivityAssumptions(def.write(effectiveBaseAssumptions, v), { recomputeWacc: recomputeForDriver }), overrides).impliedSharePrice;
      const pLo = priceAt(lo);
      const pHi = priceAt(hi);
      const ascending = pHi >= pLo;
      const targetInside = ascending ? target >= pLo && target <= pHi : target <= pLo && target >= pHi;
      if (!targetInside) return null;

      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        const pMid = priceAt(mid);
        if (ascending) {
          if (pMid < target) lo = mid;
          else hi = mid;
        } else {
          if (pMid > target) lo = mid;
          else hi = mid;
        }
      }
      return (lo + hi) / 2;
    };

    const keys: AxisKey[] = ["revenueGrowth", "ebitMargin", "terminalGrowthRate", "wacc"];
    return keys
      .map((k) => ({ key: k, value: solve(k) }))
      .filter((x): x is { key: AxisKey; value: number } => x.value !== null);
  }, [historicals, overrides, effectiveBaseAssumptions, currentPrice]);

  if (disabledReason) {
    return (
      <div className="sensitivity-theme-scope flex h-full items-center justify-center rounded-2xl border border-(--border-default) bg-[var(--bg-app)] p-8">
        <div className="max-w-xl rounded-2xl border border-amber-500/25 bg-amber-500/10 p-6 text-center">
          <AlertTriangle size={28} className="mx-auto text-amber-300" />
          <h3 className="mt-3 text-[20px] font-black uppercase tracking-[0.12em] text-(--text-primary)">Sensitivity Unavailable</h3>
          <p className="mt-3 text-[15px] leading-6 text-(--text-secondary)">{disabledReason}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sensitivity-theme-scope flex h-full bg-[var(--bg-app)] relative overflow-hidden rounded-2xl border border-(--border-default)">
      <aside className="app-panel-width h-full flex flex-col bg-[var(--bg-sidebar)] relative z-30 border-r border-(--border-default)">
        <div className="flex flex-col px-6 pb-6 border-b border-(--border-default) shrink-0 gap-5 bg-[var(--bg-sidebar)] backdrop-blur-xl z-20 pt-4">
          <div className="flex items-center gap-2">
            <Grid3X3 size={16} className="text-[var(--system-indigo)]" />
            <h4 className="text-[15px] font-black text-(--text-primary) uppercase tracking-[0.2em] opacity-90">Sensitivity Analysis</h4>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-(--text-tertiary) uppercase tracking-[0.12em] mb-2">Current</p>
            <div className="w-full p-3.5 bg-(--bg-card) rounded-xl border border-(--border-default) text-[16px] font-semibold leading-tight text-(--text-primary)">
              {isCustom ? "Custom Matrix" : (selectedPreset?.label || "Preset Matrix")}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar overflow-x-hidden pt-5 pb-12 [scrollbar-gutter:stable]">
          <div className="px-6 space-y-4">
            {sidebarSections.map((group) => (
              <div key={group.title} className="pb-3 border-b border-(--border-default) last:border-0">
                <p className="text-[14px] font-bold text-(--text-secondary) uppercase tracking-widest mb-2">{group.emoji} {group.title}</p>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    item.presetId ? (
                      <button
                        key={item.label}
                        onClick={() => setPresetId(item.presetId as string)}
                        className={cn(
                          "w-full rounded-lg px-3 py-2.5 text-left text-[16px] font-semibold transition-colors flex items-center justify-between",
                          presetId === item.presetId ? "bg-[var(--system-blue)]/15 text-(--text-primary)" : "text-(--text-secondary) hover:bg-(--bg-glass)"
                        )}
                      >
                        <span>{item.label}</span>
                      </button>
                    ) : (
                      <div
                        key={item.label}
                        className="w-full rounded-lg px-3 py-2.5 text-left text-[16px] font-semibold text-[var(--text-muted)] flex items-center justify-between"
                      >
                        <span>{item.label}</span>
                        <span className="text-[11px] uppercase">Soon</span>
                      </div>
                    )
                  ))}
                </div>
              </div>
            ))}

            <button
              onClick={() => {
                setPresetId("custom");
                setCustomBtnPulse(true);
                window.setTimeout(() => setCustomBtnPulse(false), 320);
              }}
              className={cn(
                "w-full rounded-xl border p-3.5 text-left text-[18px] font-bold transition-all duration-300",
                isCustom
                  ? "sensitivity-force-white sensitivity-custom-active border-[#2ea8ff]/70 bg-gradient-to-r from-[#0b2339] to-[#102f4c] text-white shadow-[0_0_0_1px_rgba(46,168,255,0.35),0_12px_28px_rgba(46,168,255,0.2)]"
                  : "border-(--border-default) bg-(--bg-card) text-(--text-primary) hover:border-[var(--border-hover)] hover:bg-[var(--bg-glass-hover)]",
                customBtnPulse && "scale-[1.02] shadow-[0_0_0_1px_rgba(46,168,255,0.45),0_16px_36px_rgba(46,168,255,0.28)]"
              )}
            >
              + Create Custom Matrix
            </button>

            {isCustom && (
              <div ref={dropdownRootRef} className="space-y-5 rounded-xl border border-(--border-default) bg-(--bg-card) p-4">
                <p className="text-[12px] font-black text-(--text-tertiary) uppercase tracking-[0.14em]">Create Custom Sensitivity Matrix</p>
                <label className="block text-[15px] font-semibold text-(--text-primary)">
                  X-Axis Variable
                  <div className="relative mt-1.5">
                    <button
                      type="button"
                      onClick={() => setOpenDropdown((prev) => (prev === "x" ? null : "x"))}
                      className="sensitivity-sidebar-input h-12 w-full rounded-xl border border-(--border-default) bg-[var(--bg-app)] px-4 pr-10 text-left text-[16px] font-semibold text-(--text-primary) outline-none transition-colors hover:border-[var(--border-hover)]"
                    >
                      {axisDefs[customConfig.x].label}
                    </button>
                    <ChevronDown size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-(--text-tertiary)" />
                    {openDropdown === "x" && (
                      <div className="absolute z-50 mt-2 max-h-56 w-full overflow-auto rounded-xl border border-(--border-default) bg-(--bg-card) p-1 shadow-[0_14px_40px_rgba(0,0,0,0.25)]">
                        {axisOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              setCustomConfig((prev) => ({ ...prev, x: option.value as AxisKey }));
                              setOpenDropdown(null);
                            }}
                            className={cn(
                              "w-full rounded-lg px-3 py-2.5 text-left text-[14px] font-medium",
                              customConfig.x === option.value ? "bg-[var(--system-blue)]/20 text-(--text-primary)" : "text-(--text-secondary) hover:bg-(--bg-glass)"
                            )}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <input type="number" value={customConfig.xMin} onChange={(e) => setCustomConfig((prev) => ({ ...prev, xMin: Number(e.target.value) }))} className="sensitivity-sidebar-input h-11 rounded-lg border border-(--border-default) bg-[var(--bg-app)] px-3 text-[15px] text-(--text-primary) outline-none transition-colors focus:border-[var(--system-blue)]/60 focus:ring-2 focus:ring-[var(--system-blue)]/20" />
                  <input type="number" value={customConfig.xMax} onChange={(e) => setCustomConfig((prev) => ({ ...prev, xMax: Number(e.target.value) }))} className="sensitivity-sidebar-input h-11 rounded-lg border border-(--border-default) bg-[var(--bg-app)] px-3 text-[15px] text-(--text-primary) outline-none transition-colors focus:border-[var(--system-blue)]/60 focus:ring-2 focus:ring-[var(--system-blue)]/20" />
                  <input type="number" min={3} max={9} value={customConfig.xSteps} onChange={(e) => setCustomConfig((prev) => ({ ...prev, xSteps: Number(e.target.value) }))} className="sensitivity-sidebar-input h-11 rounded-lg border border-(--border-default) bg-[var(--bg-app)] px-3 text-[15px] text-(--text-primary) outline-none transition-colors focus:border-[var(--system-blue)]/60 focus:ring-2 focus:ring-[var(--system-blue)]/20" />
                </div>

                <label className="block text-[15px] font-semibold text-(--text-primary)">
                  Y-Axis Variable
                  <div className="relative mt-1.5">
                    <button
                      type="button"
                      onClick={() => setOpenDropdown((prev) => (prev === "y" ? null : "y"))}
                      className="sensitivity-sidebar-input h-12 w-full rounded-xl border border-(--border-default) bg-[var(--bg-app)] px-4 pr-10 text-left text-[16px] font-semibold text-(--text-primary) outline-none transition-colors hover:border-[var(--border-hover)]"
                    >
                      {axisDefs[customConfig.y].label}
                    </button>
                    <ChevronDown size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-(--text-tertiary)" />
                    {openDropdown === "y" && (
                      <div className="absolute z-50 mt-2 max-h-56 w-full overflow-auto rounded-xl border border-(--border-default) bg-(--bg-card) p-1 shadow-[0_14px_40px_rgba(0,0,0,0.25)]">
                        {axisOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              setCustomConfig((prev) => ({ ...prev, y: option.value as AxisKey }));
                              setOpenDropdown(null);
                            }}
                            className={cn(
                              "w-full rounded-lg px-3 py-2.5 text-left text-[14px] font-medium",
                              customConfig.y === option.value ? "bg-[var(--system-blue)]/20 text-(--text-primary)" : "text-(--text-secondary) hover:bg-(--bg-glass)"
                            )}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <input type="number" value={customConfig.yMin} onChange={(e) => setCustomConfig((prev) => ({ ...prev, yMin: Number(e.target.value) }))} className="sensitivity-sidebar-input h-11 rounded-lg border border-(--border-default) bg-[var(--bg-app)] px-3 text-[15px] text-(--text-primary) outline-none transition-colors focus:border-[var(--system-blue)]/60 focus:ring-2 focus:ring-[var(--system-blue)]/20" />
                  <input type="number" value={customConfig.yMax} onChange={(e) => setCustomConfig((prev) => ({ ...prev, yMax: Number(e.target.value) }))} className="sensitivity-sidebar-input h-11 rounded-lg border border-(--border-default) bg-[var(--bg-app)] px-3 text-[15px] text-(--text-primary) outline-none transition-colors focus:border-[var(--system-blue)]/60 focus:ring-2 focus:ring-[var(--system-blue)]/20" />
                  <input type="number" min={3} max={9} value={customConfig.ySteps} onChange={(e) => setCustomConfig((prev) => ({ ...prev, ySteps: Number(e.target.value) }))} className="sensitivity-sidebar-input h-11 rounded-lg border border-(--border-default) bg-[var(--bg-app)] px-3 text-[15px] text-(--text-primary) outline-none transition-colors focus:border-[var(--system-blue)]/60 focus:ring-2 focus:ring-[var(--system-blue)]/20" />
                </div>

                <label className="block text-[15px] font-semibold text-(--text-primary)">
                  Output Metric
                  <div className="relative mt-1.5">
                    <button
                      type="button"
                      onClick={() => setOpenDropdown((prev) => (prev === "output" ? null : "output"))}
                      className="sensitivity-sidebar-input h-12 w-full rounded-xl border border-(--border-default) bg-[var(--bg-app)] px-4 pr-10 text-left text-[16px] font-semibold text-(--text-primary) outline-none transition-colors hover:border-[var(--border-hover)]"
                    >
                      {outputMetricOptions.find((x) => x.value === customConfig.outputMetric)?.label || "Implied Share Price"}
                    </button>
                    <ChevronDown size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-(--text-tertiary)" />
                    {openDropdown === "output" && (
                      <div className="absolute z-50 mt-2 max-h-56 w-full overflow-auto rounded-xl border border-(--border-default) bg-(--bg-card) p-1 shadow-[0_14px_40px_rgba(0,0,0,0.25)]">
                        {outputMetricOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              setCustomConfig((prev) => ({ ...prev, outputMetric: option.value }));
                              setOpenDropdown(null);
                            }}
                            className={cn(
                              "w-full rounded-lg px-3 py-2.5 text-left text-[14px] font-medium",
                              customConfig.outputMetric === option.value ? "bg-[var(--system-blue)]/20 text-(--text-primary)" : "text-(--text-secondary) hover:bg-(--bg-glass)"
                            )}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </label>

              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="flex-1 overflow-auto custom-scrollbar p-4 lg:p-6 bg-[var(--bg-base)]">
      <div className="space-y-8 app-content-max">
      <GlassCard variant="regular" className="sensitivity-panel p-6 bg-(--bg-card) border border-(--border-default)">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
          <div className="p-4 rounded-xl bg-(--bg-glass) border border-(--border-default)">
            <p className="text-[11px] font-black text-white/65 uppercase tracking-[0.12em]">{yDef.short} × {xDef.short}</p>
            <p className="text-[16px] font-bold text-white mt-1">Sensitivity: {matrixMeta.sensitivity} ({isCustom ? "Custom" : selectedPreset?.label || "Preset"})</p>
          </div>
          <div className="p-4 rounded-xl bg-(--bg-glass) border border-(--border-default)">
            <p className="text-[11px] font-black text-white/65 uppercase tracking-[0.12em]">Impact Range</p>
            <p className="text-[16px] font-bold text-white mt-1">{formatMetricValue(matrix.minVal, selectedMetric)} to {formatMetricValue(matrix.maxVal, selectedMetric)} ({matrixMeta.rangePct.toFixed(0)}% swing)</p>
          </div>
          <div className="p-4 rounded-xl bg-(--bg-glass) border border-(--border-default)">
            <p className="text-[11px] font-black text-white/65 uppercase tracking-[0.12em]">Terminal Value Weight</p>
            <p className="text-[16px] font-bold text-white mt-1">{(matrixMeta.tvWeight * 100).toFixed(1)}% of EV</p>
          </div>
        </div>

        {matrix.invalidCount > 0 && (
          <div className="mb-5 p-4 rounded-xl bg-[var(--color-red)]/10 border border-[var(--color-red)]/20 flex items-start gap-3">
            <AlertTriangle size={18} className="text-[var(--color-red)] mt-0.5" />
            <p className="text-[12px] text-white/80">Some combinations are invalid because terminal growth is greater than or equal to WACC.</p>
          </div>
        )}

        <table className="w-full text-center border-separate [border-spacing:8px_12px]">
          <thead>
            <tr>
              <th className="pr-2 min-w-[102px]" />
              {xSteps.map((x, cIdx) => (
                <th key={cIdx} className={cn("px-2 py-4 text-[15px] md:text-[18px] font-black", cIdx === xBaseIdx ? "text-white" : "text-white/70")}>
                  {fmtAxis(x, xDef)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody onMouseLeave={() => setHoverPos(null)}>
            {matrix.grid.map((row, rIdx) => (
              <tr key={rIdx}>
                <td className={cn("pr-2 text-left text-[15px] md:text-[18px] font-black whitespace-nowrap", rIdx === yBaseIdx ? "text-white" : "text-white/75")}>
                  {fmtAxis(ySteps[rIdx], yDef)}
                </td>
                {row.map((cell, cIdx) => {
                  const isBase = rIdx === yBaseIdx && cIdx === xBaseIdx;
                  const isDim = hoverPos && hoverPos.r !== rIdx && hoverPos.c !== cIdx;
                  const delta = cell.value - baseMetricValue;
                  const maxDelta = Math.max(Math.abs(matrix.maxVal - baseMetricValue), Math.abs(matrix.minVal - baseMetricValue), 1);
                  const bg = cell.invalid
                    ? "rgba(255,255,255,0.04)"
                    : chartCellColor(delta, maxDelta);
                  return (
                    <td
                      key={cIdx}
                      onMouseEnter={() => setHoverPos({ r: rIdx, c: cIdx })}
                      style={{ backgroundColor: bg }}
                      className={cn(
                        "rounded-2xl p-5 border border-transparent transform-gpu transition-[background-color,opacity] duration-200 ease-out",
                        isBase && "ring-2 ring-[var(--system-blue)]",
                        isDim ? "opacity-70" : "opacity-100"
                      )}
                    >
                      <div className="text-[22px] font-black text-white tabular-nums leading-none">
                        {cell.invalid ? "N/A" : formatMetricValue(cell.value, selectedMetric)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </GlassCard>

      <div className="space-y-6">
        <GlassCard variant="regular" className="sensitivity-panel p-6 bg-(--bg-card) border border-(--border-default)">
          <div className="flex items-center gap-3 mb-5">
            <BarChart3 size={18} className="text-[var(--color-orange)]" />
            <h4 className="text-[18px] md:text-[24px] font-black text-white uppercase tracking-[0.08em]">Tornado Chart: Top Value Drivers</h4>
          </div>
          <div className="space-y-5">
            {tornado.rows.slice(0, 8).map((row) => {
              const width = (row.impact / (tornado.maxImpact || 1)) * 100;
              return (
                <div key={row.key}>
                  <div className="flex items-center justify-between text-[15px] md:text-[18px] font-bold text-white mb-2.5">
                    <span className="leading-tight">{row.label}</span>
                    <span className="text-[20px] md:text-[24px] font-black text-white tabular-nums">${row.down.toFixed(1)} to ${row.up.toFixed(1)}</span>
                  </div>
                  <div className="h-4 rounded-full bg-(--bg-glass) overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#ff3b30] via-[#ffd60a] to-[#32d74b]" style={{ width: `${width}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[18px] md:text-[20px] text-white/85 font-bold mt-6">Base Case: ${basePrice.toFixed(1)}</p>
        </GlassCard>

        <GlassCard variant="regular" className="sensitivity-panel p-6 bg-(--bg-card) border border-(--border-default)">
          <div className="flex items-center gap-3 mb-4">
            <Target size={18} className="text-[var(--color-blue)]" />
            <h4 className="text-[18px] md:text-[22px] font-black text-white uppercase tracking-[0.08em]">Break-even Scenarios</h4>
          </div>
          <p className="text-[14px] md:text-[16px] text-white/78 mb-5">
            To justify current price of ${currentPrice.toFixed(2)}, one-variable break-even points are:
          </p>
          <div className="space-y-3">
            {breakEven.length === 0 && <p className="text-[14px] md:text-[16px] text-white/60">No single-variable break-even found in model bounds.</p>}
            {breakEven.map((item) => {
              const def = axisDefs[item.key];
              return (
                <div key={item.key} className="flex items-center justify-between px-4 py-4 rounded-xl bg-(--bg-glass) border border-(--border-default)">
                  <span className="text-[16px] md:text-[20px] font-semibold text-white">{def.label}</span>
                  <span className="text-[20px] md:text-[24px] font-black text-[var(--color-blue)] tabular-nums">{fmtAxis(item.value, def)}</span>
                </div>
              );
            })}
          </div>
        </GlassCard>
      </div>
      </div>
      </div>
    </div>
  );
});
