import { Assumptions, HistoricalData } from "@/core/types";
import { ReverseDCFKey } from "@/services/dcf/reverse-dcf";
import { formatDisplayPercent } from "@/core/utils/financial-format";
import { ReverseWorksheetRow, ReverseBridge } from "./types";

interface DCFResults {
  forecasts: Array<{
    year: number;
    revenue: number;
    ebit: number;
    depreciation: number;
    capex: number;
    nwcChange: number;
    fcff: number;
    pvFcff: number;
  }>;
  pvTerminalValue: number;
  enterpriseValue: number;
  equityValue: number;
  shareCount: number;
  impliedSharePrice: number;
}

export const solveOptions: Array<{ key: ReverseDCFKey; label: string }> = [
  { key: "revenueGrowth", label: "5Y Revenue CAGR" },
  { key: "ebitMargin", label: "EBIT Margin" },
  { key: "terminalGrowthRate", label: "Terminal Growth" },
  { key: "wacc", label: "WACC" },
  { key: "terminalExitMultiple", label: "Exit Multiple" },
];

export const solveOptionColorMap: Record<
  ReverseDCFKey,
  {
    active: string;
    activeBorder: string;
    activeText: string;
    activeLabel: string;
    inactiveTint: string;
    inactiveBorder: string;
  }
> = {
  revenueGrowth: {
    active: "bg-[linear-gradient(135deg,#60a5fa,#2563eb)]",
    activeBorder: "border-[#2563eb]",
    activeText: "text-white",
    activeLabel: "text-white/72",
    inactiveTint: "bg-[linear-gradient(135deg,#93c5fd,#3b82f6)]",
    inactiveBorder: "border-[#60a5fa]",
  },
  ebitMargin: {
    active: "bg-[linear-gradient(135deg,#34d399,#16a34a)]",
    activeBorder: "border-[#16a34a]",
    activeText: "text-white",
    activeLabel: "text-white/72",
    inactiveTint: "bg-[linear-gradient(135deg,#6ee7b7,#22c55e)]",
    inactiveBorder: "border-[#4ade80]",
  },
  terminalGrowthRate: {
    active: "bg-[linear-gradient(135deg,#fb923c,#f59e0b)]",
    activeBorder: "border-[#f59e0b]",
    activeText: "text-white",
    activeLabel: "text-white/72",
    inactiveTint: "bg-[linear-gradient(135deg,#fdba74,#f97316)]",
    inactiveBorder: "border-[#fb923c]",
  },
  wacc: {
    active: "bg-[linear-gradient(135deg,#a78bfa,#7c3aed)]",
    activeBorder: "border-[#7c3aed]",
    activeText: "text-white",
    activeLabel: "text-white/72",
    inactiveTint: "bg-[linear-gradient(135deg,#c4b5fd,#8b5cf6)]",
    inactiveBorder: "border-[#a78bfa]",
  },
  terminalExitMultiple: {
    active: "bg-[linear-gradient(135deg,#f472b6,#db2777)]",
    activeBorder: "border-[#db2777]",
    activeText: "text-white",
    activeLabel: "text-white/72",
    inactiveTint: "bg-[linear-gradient(135deg,#f9a8d4,#ec4899)]",
    inactiveBorder: "border-[#f472b6]",
  },
};

export function formatSolveValue(key: ReverseDCFKey, value: number) {
  if (!Number.isFinite(value)) return "—";
  if (key === "terminalExitMultiple") return `${value.toFixed(1)}x`;
  return formatDisplayPercent(value);
}

export function formatEditableValue(value: number) {
  if (!Number.isFinite(value)) return "";
  return Number(value.toFixed(1)).toString();
}

export function getAssumptionNote(label: string, readOnly: boolean) {
  if (readOnly) {
    if (label === "Solving For") return "Current goal-seek target selected above.";
    return "Calculated by the reverse DCF engine.";
  }

  switch (label) {
    case "EBIT Margin":
      return "Operating profitability assumption used in stage 1.";
    case "Tax Rate":
      return "Effective tax rate applied to convert EBIT into NOPAT.";
    case "WACC":
      return "Discount rate used to present-value forecast cash flows.";
    case "Terminal Growth":
      return "Perpetual growth rate used in the Gordon Growth terminal value.";
    case "Exit Multiple":
      return "Terminal multiple applied when exit multiple mode is selected.";
    case "Base Revenue":
      return "Revenue anchor used to start the reverse DCF forecast.";
    default:
      return "Editable on this page only.";
  }
}

export function buildWorksheetRows(
  impliedResults: DCFResults | null,
  impliedAssumptions: Assumptions | null,
): ReverseWorksheetRow[] {
  if (!impliedResults || !impliedAssumptions) return [];
  return impliedResults.forecasts.slice(0, 5).map((forecast, index) => ({
    year: forecast.year,
    revenue: forecast.revenue,
    ebit: forecast.ebit,
    nopat: forecast.ebit * (1 - impliedAssumptions.taxRate),
    depreciation: forecast.depreciation,
    capex: forecast.capex,
    nwcChange: forecast.nwcChange,
    fcff: forecast.fcff,
    discountExponent: index + 0.5,
    pvFcff: forecast.pvFcff,
  }));
}

export function buildReverseBridge(
  historicals: HistoricalData,
  impliedResults: DCFResults | null,
  stageOnePv: number,
): ReverseBridge | null {
  if (!impliedResults) return null;
  const currentCash = historicals.cash[historicals.cash.length - 1] || 0;
  const currentMarketableSecurities = historicals.marketableSecurities?.[historicals.marketableSecurities.length - 1] || 0;
  const currentDebt = historicals.totalDebt[historicals.totalDebt.length - 1] || 0;
  return {
    stageOnePv,
    pvTerminalValue: impliedResults.pvTerminalValue,
    enterpriseValue: impliedResults.enterpriseValue,
    netDebt: currentDebt - currentCash - currentMarketableSecurities,
    equityValue: impliedResults.equityValue,
    shareCount: impliedResults.shareCount,
    impliedSharePrice: impliedResults.impliedSharePrice,
  };
}

export function getSelectedResultDescription(selectedKey: ReverseDCFKey) {
  switch (selectedKey) {
    case "revenueGrowth":
      return "Revenue growth required over the next five years to justify the current target price.";
    case "ebitMargin":
      return "EBIT margin the company would need to sustain for the market price to make sense.";
    case "terminalGrowthRate":
      return "Perpetual growth the terminal value must assume to support today’s price.";
    case "wacc":
      return "Discount rate the market is implicitly underwriting in this reverse DCF.";
    case "terminalExitMultiple":
      return "Exit multiple implied by the current price when using the terminal multiple method.";
    default:
      return "";
  }
}
