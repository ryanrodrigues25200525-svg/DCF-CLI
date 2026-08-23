import { Assumptions, HistoricalData, Overrides } from "@/core/types";
import { calculateDCF } from "@/services/dcf/engine";

export type ReverseDCFKey =
  | "revenueGrowth"
  | "ebitMargin"
  | "terminalGrowthRate"
  | "wacc"
  | "terminalExitMultiple";

export type ReverseDCFStatus = "solved" | "no_solution" | "invalid_target";

export interface ReverseDCFResult {
  key: ReverseDCFKey;
  label: string;
  baseValue: number;
  impliedValue: number | null;
  impliedPrice: number | null;
  currentPrice: number;
  status: ReverseDCFStatus;
}

type ReverseAxisDef = {
  label: string;
  min: number;
  max: number;
  read: (assumptions: Assumptions) => number;
  write: (assumptions: Assumptions, value: number) => Assumptions;
};

const reverseAxisDefs: Record<ReverseDCFKey, ReverseAxisDef> = {
  revenueGrowth: {
    label: "Revenue Growth",
    min: -0.5,
    max: 5.0, // Increased to 500% for hyper-growth stocks
    read: (a) => a.revenueGrowth,
    write: (a, v) => ({
      ...a,
      revenueGrowth: v,
      revenueGrowthStage1: v,
      revenueGrowthStage2: v,
      revenueGrowthStage3: v,
    }),
  },
  ebitMargin: {
    label: "EBIT Margin",
    min: -1.0, // Support up to -100% margin
    max: 1.0,  // Support up to 100% margin
    read: (a) => a.ebitMargin,
    write: (a, v) => ({
      ...a,
      ebitMargin: v,
      ebitMarginSteadyState: v,
    }),
  },
  terminalGrowthRate: {
    label: "Terminal Growth",
    min: -0.1,
    max: 0.2, // Up to 20% terminal growth (aggressive)
    read: (a) => a.terminalGrowthRate,
    write: (a, v) => ({ ...a, terminalGrowthRate: v }),
  },
  wacc: {
    label: "WACC",
    min: 0.01, // Down to 1% WACC
    max: 0.5,  // Up to 50% WACC
    read: (a) => a.wacc,
    write: (a, v) => ({ ...a, wacc: v }),
  },
  terminalExitMultiple: {
    label: "Exit Multiple",
    min: 1,
    max: 250, // Up to 250x multiple
    read: (a) => a.terminalExitMultiple,
    write: (a, v) => ({ ...a, terminalExitMultiple: v }),
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAssumptionsForReverse(input: Assumptions): Assumptions {
  const riskFreeRate = input.riskFreeRate ?? 0.046;
  const equityRiskPremium = input.equityRiskPremium ?? 0.052;
  const beta = input.beta ?? 1;
  const taxRate = clamp(input.taxRate, 0, 0.6);
  const costOfDebt = input.costOfDebt ?? 0.05;
  const leverageTargetFromWeights = input.weightDebt !== undefined ? input.weightDebt : 0;
  const leverageTarget = clamp(input.leverageTarget ?? leverageTargetFromWeights, 0, 0.95);
  const weightDebt = leverageTarget;
  const weightEquity = 1 - weightDebt;
  const costOfEquity = riskFreeRate + beta * equityRiskPremium;
  const wacc = Math.max(0.001, input.wacc ?? (weightEquity * costOfEquity + weightDebt * costOfDebt * (1 - taxRate)));
  const terminalGrowthRate = Math.min(input.terminalGrowthRate, wacc - 0.001);

  return {
    ...input,
    riskFreeRate,
    equityRiskPremium,
    beta,
    taxRate,
    costOfDebt,
    costOfEquity,
    leverageTarget,
    weightDebt,
    weightEquity,
    wacc,
    terminalGrowthRate,
  };
}

export function applyReverseDCFValue(
  assumptions: Assumptions,
  key: ReverseDCFKey,
  value: number,
) {
  const axisDef = reverseAxisDefs[key];
  const candidate = axisDef.write(assumptions, value);
  return normalizeAssumptionsForReverse(candidate);
}

function priceForCandidate(
  historicals: HistoricalData,
  assumptions: Assumptions,
  overrides: Overrides,
  key: ReverseDCFKey,
  value: number,
) {
  const candidate = applyReverseDCFValue(assumptions, key, value);
  if (candidate.valuationMethod === "growth" && candidate.terminalGrowthRate >= candidate.wacc) {
    return Number.NaN;
  }
  return calculateDCF(historicals, candidate, overrides).impliedSharePrice;
}

export function solveReverseDCF(
  historicals: HistoricalData,
  assumptions: Assumptions,
  overrides: Overrides,
  targetPrice: number,
  key: ReverseDCFKey,
): ReverseDCFResult {
  const currentPrice = targetPrice > 0 ? targetPrice : historicals.price || 0;
  const axisDef = reverseAxisDefs[key];
  const normalized = normalizeAssumptionsForReverse(assumptions);
  const baseValue = axisDef.read(normalized);

  if (!(currentPrice > 0)) {
    return {
      key,
      label: axisDef.label,
      baseValue,
      impliedValue: null,
      impliedPrice: null,
      currentPrice,
      status: "invalid_target",
    };
  }

  let lo = axisDef.min;
  let hi = axisDef.max;
  const priceAtLo = priceForCandidate(historicals, normalized, overrides, key, lo);
  const priceAtHi = priceForCandidate(historicals, normalized, overrides, key, hi);

  if (!Number.isFinite(priceAtLo) || !Number.isFinite(priceAtHi)) {
    return {
      key,
      label: axisDef.label,
      baseValue,
      impliedValue: null,
      impliedPrice: null,
      currentPrice,
      status: "no_solution",
    };
  }

  const ascending = priceAtHi >= priceAtLo;
  const targetInside = ascending
    ? currentPrice >= priceAtLo && currentPrice <= priceAtHi
    : currentPrice <= priceAtLo && currentPrice >= priceAtHi;

  if (!targetInside) {
    return {
      key,
      label: axisDef.label,
      baseValue,
      impliedValue: null,
      impliedPrice: null,
      currentPrice,
      status: "no_solution",
    };
  }

  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2;
    const priceAtMid = priceForCandidate(historicals, normalized, overrides, key, mid);
    if (!Number.isFinite(priceAtMid)) {
      hi = mid;
      continue;
    }

    if (ascending) {
      if (priceAtMid < currentPrice) lo = mid;
      else hi = mid;
    } else {
      if (priceAtMid > currentPrice) lo = mid;
      else hi = mid;
    }
  }

  const impliedValue = (lo + hi) / 2;
  const impliedPrice = priceForCandidate(historicals, normalized, overrides, key, impliedValue);

  return {
    key,
    label: axisDef.label,
    baseValue,
    impliedValue,
    impliedPrice: Number.isFinite(impliedPrice) ? impliedPrice : null,
    currentPrice,
    status: Number.isFinite(impliedPrice) ? "solved" : "no_solution",
  };
}

export function buildReverseDCFResults(
  historicals: HistoricalData,
  assumptions: Assumptions,
  overrides: Overrides,
  targetPrice: number,
  keys: ReverseDCFKey[] = ["revenueGrowth", "ebitMargin", "terminalGrowthRate", "wacc", "terminalExitMultiple"],
) {
  return keys.map((key) => solveReverseDCF(historicals, assumptions, overrides, targetPrice, key));
}
