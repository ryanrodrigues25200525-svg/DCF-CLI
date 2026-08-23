from __future__ import annotations

from copy import copy
from typing import Any

from openpyxl.worksheet.worksheet import Worksheet

from .utils import (
    DCF_HELPER_DEBT_CELL,
    SCENARIO_BEAR,
    SCENARIO_BULL,
    WACC_LOOP_MODE_ITERATIVE,
    _force_set,
    _safe_set,
    _scenario_assumption_value,
    _to_float,
    resolve_wacc_loop_mode,
)


def _map_wacc_inputs(wacc: Worksheet, payload: dict[str, Any]) -> None:
    assumptions = payload.get("assumptions", {})
    assumptions = assumptions if isinstance(assumptions, dict) else {}
    wacc_assumptions = assumptions.get("wacc", {})
    wacc_assumptions = wacc_assumptions if isinstance(wacc_assumptions, dict) else {}

    rf = _to_float(wacc_assumptions.get("rf"))
    if rf is None:
        rf = _to_float(assumptions.get("riskFreeRate"))
    if rf is None:
        rf = 0.044

    erp = _to_float(wacc_assumptions.get("erp"))
    if erp is None:
        erp = _to_float(assumptions.get("equityRiskPremium"))
    if erp is None:
        erp = 0.055

    illiquidity_discount = (
        _to_float(wacc_assumptions.get("illiquidityDiscount"))
        or _to_float(wacc_assumptions.get("liquidityDiscount"))
        or _to_float(assumptions.get("illiquidityDiscount"))
        or _to_float(assumptions.get("liquidityDiscount"))
    )

    size_premium = _to_float(wacc_assumptions.get("sizePremium"))
    if size_premium is None:
        size_premium = _to_float(assumptions.get("sizePremium"))
    if size_premium is None:
        size_premium = 0.0

    cost_of_debt = _to_float(wacc_assumptions.get("costOfDebt"))
    if cost_of_debt is None:
        cost_of_debt = _to_float(wacc_assumptions.get("currentDebtYield"))
    if cost_of_debt is None:
        cost_of_debt = _to_float(wacc_assumptions.get("debtYield"))
    if cost_of_debt is None:
        cost_of_debt = _to_float(assumptions.get("currentDebtYield"))
    if cost_of_debt is None:
        cost_of_debt = _to_float(assumptions.get("debtYield"))
    if cost_of_debt is None:
        credit_spread = _to_float(wacc_assumptions.get("creditSpread"))
        if credit_spread is None:
            credit_spread = _to_float(assumptions.get("creditSpread"))
        if credit_spread is not None:
            cost_of_debt = rf + credit_spread
    if cost_of_debt is None:
        cost_of_debt = _to_float(assumptions.get("costOfDebt"))
    if cost_of_debt is None:
        cost_of_debt = 0.051

    _safe_set(wacc, "D9", rf)
    _safe_set(wacc, "D10", erp)
    _safe_set(wacc, "D14", illiquidity_discount if illiquidity_discount is not None else 0.0)
    _safe_set(wacc, "D15", size_premium)
    _safe_set(wacc, "D19", cost_of_debt)
    _safe_set(wacc, "I7", "Debt ($B)")



def _apply_required_wacc_formulas(wacc: Worksheet, payload: dict[str, Any]) -> None:
    wacc_loop_mode = resolve_wacc_loop_mode(payload)
    assumptions = payload.get("assumptions", {})
    assumptions = assumptions if isinstance(assumptions, dict) else {}
    wacc_assumptions = assumptions.get("wacc")
    wacc_assumptions = wacc_assumptions if isinstance(wacc_assumptions, dict) else {}

    # Required fix: use beta from D11 directly.
    _force_set(wacc, "D11", "=H23")
    if wacc_loop_mode == WACC_LOOP_MODE_ITERATIVE:
        _force_set(wacc, "D23", "='DCF Model - Base (1)'!C12")
    else:
        _force_set(wacc, "D23", "='DCF Model - Base (1)'!C11")
    # Use market value of debt from helper cell, not net debt, for capital structure weights.
    _force_set(wacc, "D24", f"='DCF Model - Base (1)'!{DCF_HELPER_DEBT_CELL}")
    _force_set(wacc, "D27", "=IFERROR(D23/(D23+D24),0.85)")
    _force_set(wacc, "D28", "=IFERROR(D24/(D23+D24),0.15)")
    _force_set(wacc, "K23", "=IFERROR(IF(K17>0,K17,IF(D23>0,D24/D23,0.15)),0.15)")
    _force_set(wacc, "J23", "=IFERROR((D23+D24)/(1+K23),D23)")
    _force_set(wacc, "I23", "=IFERROR(D23+D24-J23,D24)")
    _force_set(wacc, "H23", "=M23*(1+(1-L23)*K23)")
    _force_set(wacc, "D16", "=D9+D11*(D10)+D14+D15")
    _force_set(wacc, "D20", "=IFERROR('DCF Model - Base (1)'!$F$11,0.21)")
    _force_set(wacc, "D21", "=IFERROR(D19*(1-D20),D19*0.79)")
    _force_set(wacc, "D31", "=IFERROR(J23/(I23+J23),0.85)")
    _force_set(wacc, "D32", "=IFERROR(I23/(I23+J23),0.15)")
    # Use current capital structure weights to avoid circular dependencies in optimization paths.
    _force_set(wacc, "D34", "=(D27*D16)+(D28*D21)")

    scenario_bull_beta = _to_float(_scenario_assumption_value(payload, SCENARIO_BULL, "beta"))
    scenario_bear_beta = _to_float(_scenario_assumption_value(payload, SCENARIO_BEAR, "beta"))
    base_beta = _to_float(wacc_assumptions.get("beta"))
    if base_beta is None:
        base_beta = _to_float(assumptions.get("beta"))

    _safe_set(wacc, "B34", "Base WACC")
    _safe_set(wacc, "B35", "Bull WACC")
    _safe_set(wacc, "B36", "Bear WACC")
    # Keep Base/Bull/Bear WACC rows visually consistent (fill, borders, font).
    for row in (35, 36):
        wacc[f"B{row}"]._style = copy(wacc["B34"]._style)
        wacc[f"C{row}"]._style = copy(wacc["C34"]._style)
        wacc[f"D{row}"]._style = copy(wacc["D34"]._style)
    _safe_set(wacc, "B37", "Bull Beta")
    _safe_set(wacc, "B38", "Bear Beta")
    _safe_set(wacc, "B39", "Bull Cost of Equity")
    _safe_set(wacc, "B40", "Bear Cost of Equity")
    _force_set(wacc, "C40", "")

    if scenario_bull_beta is not None:
        _force_set(wacc, "D37", max(0.10, scenario_bull_beta))
    elif base_beta is not None:
        _force_set(wacc, "D37", max(0.10, base_beta - 0.10))
    else:
        _force_set(wacc, "D37", "=MAX(0.10,D11-0.10)")

    if scenario_bear_beta is not None:
        _force_set(wacc, "D38", max(0.10, scenario_bear_beta))
    elif base_beta is not None:
        _force_set(wacc, "D38", max(0.10, base_beta + 0.10))
    else:
        _force_set(wacc, "D38", "=D11+0.10")

    _force_set(wacc, "D39", "=D9+D37*(D10)+D14+D15")
    _force_set(wacc, "D40", "=D9+D38*(D10)+D14+D15")
    _force_set(wacc, "D35", "=(D27*D39)+(D28*D21)")
    _force_set(wacc, "D36", "=(D27*D40)+(D28*D21)")

    # Harden peer beta table against partial/missing comp rows so D/E and
    # unlevered beta sections do not surface #DIV/0! in exported workbooks.
    for row in range(8, 14):
        # Debt units in the template are in billions while equity values are in millions.
        # Scale debt by 1,000 so D/E is computed on consistent units.
        _force_set(wacc, f"K{row}", f'=IFERROR(IF(J{row}>0,(I{row}*1000)/J{row},""),"")')
        _force_set(wacc, f"M{row}", f'=IFERROR(H{row}/(1+(1-L{row})*K{row}),"")')



def _harden_wacc_peer_aggregate_formulas(wacc: Worksheet) -> None:
    # Guard peer aggregates to avoid #DIV/0! when comparable set is partially empty.
    _force_set(wacc, "H16", "=IFERROR(AVERAGE(H8:H13),1)")
    _force_set(wacc, "I16", "=IFERROR(AVERAGE(I8:I13),0)")
    _force_set(wacc, "J16", "=IFERROR(AVERAGE(J8:J13),0)")
    _force_set(wacc, "K16", "=IFERROR(AVERAGE(K8:K13),0)")
    _force_set(wacc, "L16", "=IFERROR(AVERAGE(L8:L13),0.25)")
    _force_set(wacc, "M16", "=IFERROR(AVERAGE(M8:M13),1)")
    _force_set(wacc, "N16", "=IFERROR(AVERAGE(N8:N13),1)")
    _force_set(wacc, "H17", "=IFERROR(MEDIAN(H8:H13),1)")
    _force_set(wacc, "I17", "=IFERROR(MEDIAN(I8:I13),0)")
    _force_set(wacc, "J17", "=IFERROR(MEDIAN(J8:J13),0)")
    _force_set(wacc, "K17", "=IFERROR(MEDIAN(K8:K13),0)")
    _force_set(wacc, "L17", "=IFERROR(MEDIAN(L8:L13),0.25)")
    _force_set(wacc, "M17", "=IFERROR(MEDIAN(M8:M13),1)")
    _force_set(wacc, "N17", "=IFERROR(MEDIAN(N8:N13),1)")



