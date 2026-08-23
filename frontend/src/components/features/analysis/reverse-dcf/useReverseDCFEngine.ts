import { useState, useMemo, useEffect } from "react";
import { Assumptions, HistoricalData, Overrides } from "@/core/types";
import { ReverseDCFKey, solveReverseDCF, applyReverseDCFValue } from "@/services/dcf/reverse-dcf";
import { calculateDCF } from "@/services/dcf/engine";
import { buildWorksheetRows, buildReverseBridge, formatEditableValue } from "./utils";

interface UseReverseDCFEngineProps {
  historicals: HistoricalData;
  assumptions: Assumptions;
  overrides: Overrides;
}

export function useReverseDCFEngine({ historicals, assumptions, overrides }: UseReverseDCFEngineProps) {
  const [selectedKey, setSelectedKey] = useState<ReverseDCFKey>("revenueGrowth");
  const [targetPriceInput, setTargetPriceInput] = useState((historicals.price || 0).toString());
  const [valuationMethod, setValuationMethod] = useState<"gordonGrowth" | "exitMultiple">("gordonGrowth");
  const [status, setStatus] = useState<"loading" | "idle" | "error">("idle");

  // Local overrides for goal-seek context
  const [localEbitMargin, setLocalEbitMargin] = useState(assumptions.ebitMargin * 100);
  const [localTaxRate, setLocalTaxRate] = useState(assumptions.taxRate * 100);
  const [localWacc, setLocalWacc] = useState(assumptions.wacc * 100);
  const [localTerminalGrowth, setLocalTerminalGrowth] = useState(assumptions.terminalGrowthRate * 100);
  const [localExitMultiple, setLocalExitMultiple] = useState(assumptions.terminalExitMultiple);
  const [localBaseRevenue, setLocalBaseRevenue] = useState(formatEditableValue(historicals.revenue[historicals.revenue.length - 1] || 0));

  const [reverseResults, setReverseResults] = useState<Partial<Record<ReverseDCFKey, number>>>({});

  // Sync inputs when historicals load
  useEffect(() => {
    if (historicals.price && (!targetPriceInput || targetPriceInput === "0")) {
      setTargetPriceInput(historicals.price.toString());
    }
    const lastRev = historicals.revenue[historicals.revenue.length - 1];
    if (lastRev) {
      setLocalBaseRevenue(formatEditableValue(lastRev));
    }
  }, [historicals.price, historicals.revenue, targetPriceInput]);

  const targetPrice = parseFloat(targetPriceInput) || 0;

  // Build the live assumptions object based on local state
  const currentAssumptions = useMemo((): Assumptions => ({
    ...assumptions,
    valuationMethod: valuationMethod === "gordonGrowth" ? "growth" : "multiple",
    ebitMargin: localEbitMargin / 100,
    ebitMarginSteadyState: localEbitMargin / 100,
    taxRate: localTaxRate / 100,
    wacc: localWacc / 100,
    terminalGrowthRate: localTerminalGrowth / 100,
    terminalExitMultiple: localExitMultiple,
    // Sync growth fields if advanced mode is on, using the base assumption
    ...(assumptions.advancedMode ? {
      revenueGrowthStage1: assumptions.revenueGrowth,
      revenueGrowthStage2: assumptions.revenueGrowth,
      revenueGrowthStage3: assumptions.revenueGrowth,
    } : {})
  }), [assumptions, localEbitMargin, localTaxRate, localWacc, localTerminalGrowth, localExitMultiple, valuationMethod]);

  const currentHistoricals = useMemo((): HistoricalData => ({
    ...historicals,
    revenue: [
      ...historicals.revenue.slice(0, -1),
      parseFloat(localBaseRevenue) || historicals.revenue[historicals.revenue.length - 1],
    ],
  }), [historicals, localBaseRevenue]);

  // Solve all variables whenever inputs change
  useEffect(() => {
    let active = true;
    const solveAll = async () => {
      setStatus("loading");
      try {
        const keys: ReverseDCFKey[] = ["revenueGrowth", "ebitMargin", "terminalGrowthRate", "wacc", "terminalExitMultiple"];
        const results: Partial<Record<ReverseDCFKey, number>> = {};

        for (const key of keys) {
          const solvedValue = await solveReverseDCF(
            currentHistoricals,
            currentAssumptions,
            overrides,
            targetPrice,
            key
          );
          results[key] = solvedValue.impliedValue ?? undefined;
        }

        if (active) {
          setReverseResults(results);
          setStatus("idle");
        }
      } catch (err) {
        console.error("Reverse DCF Solve Failed:", err);
        if (active) setStatus("error");
      }
    };

    solveAll();
    return () => { active = false; };
  }, [currentHistoricals, currentAssumptions, overrides, targetPrice, valuationMethod]);

  // Derived data for the UI
  const impliedAssumptions = useMemo(() => {
    const solvedValue = reverseResults[selectedKey];
    if (solvedValue === undefined) return null;
    return applyReverseDCFValue(currentAssumptions, selectedKey, solvedValue);
  }, [currentAssumptions, reverseResults, selectedKey]);

  const impliedResults = useMemo(() => {
    if (!impliedAssumptions) return null;
    return calculateDCF(
      currentHistoricals,
      impliedAssumptions,
      overrides
    );
  }, [currentHistoricals, impliedAssumptions, overrides]);

  const worksheetRows = useMemo(() => buildWorksheetRows(impliedResults, impliedAssumptions), [impliedResults, impliedAssumptions]);
  const stageOnePv = useMemo(() => worksheetRows.reduce((sum, r) => sum + r.pvFcff, 0), [worksheetRows]);
  const bridge = useMemo(() => buildReverseBridge(currentHistoricals, impliedResults, stageOnePv), [currentHistoricals, impliedResults, stageOnePv]);

  const handleReset = () => {
    setLocalEbitMargin(assumptions.ebitMargin * 100);
    setLocalTaxRate(assumptions.taxRate * 100);
    setLocalWacc(assumptions.wacc * 100);
    setLocalTerminalGrowth(assumptions.terminalGrowthRate * 100);
    setLocalExitMultiple(assumptions.terminalExitMultiple);
    setLocalBaseRevenue(formatEditableValue(historicals.revenue[historicals.revenue.length - 1] || 0));
    setTargetPriceInput((historicals.price || 0).toString());
  };

  return {
    selectedKey,
    setSelectedKey,
    targetPriceInput,
    setTargetPriceInput,
    valuationMethod,
    setValuationMethod,
    status,
    reverseResults,
    worksheetRows,
    stageOnePv,
    bridge,
    targetPrice,
    localBaseRevenue,
    localEbitMargin,
    localTaxRate,
    localWacc,
    localTerminalGrowth,
    localExitMultiple,
    setLocalBaseRevenue,
    setLocalEbitMargin,
    setLocalTaxRate,
    setLocalWacc,
    setLocalTerminalGrowth,
    setLocalExitMultiple,
    handleReset,
  };
}
