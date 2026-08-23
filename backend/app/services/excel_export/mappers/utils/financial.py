from __future__ import annotations

from typing import Any

from openpyxl.worksheet.worksheet import Worksheet

from .constants import MAX_TERMINAL_GROWTH_RATE, MIN_TERMINAL_WACC_SPREAD
from .core import (
    _first_float,
    _forecast_by_year,
    _historical_index_by_year,
    _series,
    _to_float,
)


def _sanitize_wacc_rate(value: Any) -> float | None:
    parsed = _to_float(value)
    if parsed is None:
        return None
    return max(0.01, min(0.30, parsed))

def _sanitize_terminal_growth_rate(value: Any, *, reference_wacc: float | None = None) -> float | None:
    parsed = _to_float(value)
    if parsed is None:
        return None
    clamped = max(0.0, min(MAX_TERMINAL_GROWTH_RATE, parsed))
    if reference_wacc is not None:
        max_allowed = max(0.0, reference_wacc - MIN_TERMINAL_WACC_SPREAD)
        clamped = min(clamped, max_allowed)
    return clamped

def _scenario_assumption_value(payload: dict[str, Any], scenario_name: str, key: str) -> Any:
    scenarios = payload.get("scenarios")
    if not isinstance(scenarios, dict):
        return None
    scenario = scenarios.get(scenario_name)
    if not isinstance(scenario, dict):
        return None
    assumptions = scenario.get("assumptions")
    if not isinstance(assumptions, dict):
        return None
    return assumptions.get(key)

def _last_known_ratio(numerator_series: list[float], denominator_series: list[float], *, default_ratio: float) -> float:
    size = min(len(numerator_series), len(denominator_series))
    for idx in range(size - 1, -1, -1):
        denominator = denominator_series[idx]
        numerator = numerator_series[idx]
        if denominator and numerator:
            return max(0.0, min(1.0, numerator / denominator))
    return max(0.0, min(1.0, default_ratio))

def _last_known_opex_mix(
    rnd_series: list[float],
    sga_series: list[float],
    da_series: list[float],
    other_series: list[float],
) -> dict[str, float] | None:
    size = min(len(rnd_series), len(sga_series), len(da_series), len(other_series))
    for idx in range(size - 1, -1, -1):
        rnd = abs(rnd_series[idx])
        sga = abs(sga_series[idx])
        da = abs(da_series[idx])
        other = abs(other_series[idx])
        total = rnd + sga + da + other
        if total > 0:
            return {
                "rnd": rnd / total,
                "sga": sga / total,
                "da": da / total,
                "other": other / total,
            }
    return None

def _template_opex_mix(template_sheet: Worksheet) -> dict[str, float]:
    totals = {
        "rnd": abs(_to_float(template_sheet["X24"].value) or 0.0),
        "sga": abs(_to_float(template_sheet["X25"].value) or 0.0),
        "da": abs(_to_float(template_sheet["X26"].value) or 0.0),
        "other": abs(_to_float(template_sheet["X27"].value) or 0.0),
    }
    total = sum(totals.values())
    if total <= 0:
        return {"rnd": 0.25, "sga": 0.50, "da": 0.25, "other": 0.0}
    return {
        "rnd": totals["rnd"] / total,
        "sga": totals["sga"] / total,
        "da": totals["da"] / total,
        "other": totals["other"] / total,
    }

def _historical_value_for_year(
    payload: dict[str, Any],
    year: int,
    *,
    statement: str,
    keys: list[str],
) -> float | None:
    historicals = payload.get("historicals", {})
    if not isinstance(historicals, dict):
        return None
    section = historicals.get(statement)
    if not isinstance(section, dict):
        return None
    values = _series(section, keys)
    index = _historical_index_by_year(payload).get(year)
    if index is None or index >= len(values):
        return None
    value = _to_float(values[index])
    return abs(value) if value is not None else None

def _numeric_list(raw: Any) -> list[float]:
    if not isinstance(raw, list):
        return []
    out: list[float] = []
    for item in raw:
        parsed = _to_float(item)
        if parsed is not None:
            out.append(parsed)
    return out

def _matrix_values(raw: Any) -> list[list[float]] | None:
    if not isinstance(raw, list) or len(raw) != 5:
        return None
    out: list[list[float]] = []
    for row in raw:
        numeric_row = _numeric_list(row)
        if len(numeric_row) != 5:
            return None
        out.append(numeric_row)
    return out

def _fallback_wacc_terminal_matrix(
    *,
    base_ev: float,
    base_wacc: float,
    base_growth: float,
    wacc_axis: list[float],
    growth_axis: list[float],
    tv_weight: float,
) -> list[list[float]]:
    explicit_component = base_ev * (1.0 - tv_weight)
    terminal_component = base_ev * tv_weight
    base_spread = max(0.005, base_wacc - base_growth)

    matrix: list[list[float]] = []
    for growth in growth_axis:
        row: list[float] = []
        for wacc in wacc_axis:
            spread = max(0.005, wacc - growth)
            spread_factor = base_spread / spread
            explicit_factor = max(0.5, min(1.5, 1.0 - 1.5 * (wacc - base_wacc)))
            value = (explicit_component * explicit_factor) + (terminal_component * spread_factor)
            row.append(max(1.0, value))
        matrix.append(row)
    matrix[2][2] = base_ev
    return matrix

def _fallback_revenue_ebit_matrix(
    *,
    base_ev: float,
    base_revenue_growth: float,
    base_ebit_margin: float,
    revenue_growth_axis: list[float],
    ebit_margin_axis: list[float],
) -> list[list[float]]:
    matrix: list[list[float]] = []
    for margin in ebit_margin_axis:
        row: list[float] = []
        for growth in revenue_growth_axis:
            growth_factor = max(0.3, 1.0 + 4.0 * (growth - base_revenue_growth))
            margin_factor = max(0.3, 1.0 + 6.0 * (margin - base_ebit_margin))
            row.append(max(1.0, base_ev * growth_factor * margin_factor))
        matrix.append(row)

    matrix[2][2] = base_ev
    for row_idx in range(5):
        for col_idx in range(5):
            if col_idx > 0:
                matrix[row_idx][col_idx] = max(matrix[row_idx][col_idx], matrix[row_idx][col_idx - 1])
            if row_idx > 0:
                matrix[row_idx][col_idx] = max(matrix[row_idx][col_idx], matrix[row_idx - 1][col_idx])
    return matrix

def _scenario_snapshot(payload: dict[str, Any], scenario_name: str) -> dict[str, Any] | None:
    scenarios = payload.get("scenarios")
    if not isinstance(scenarios, dict):
        return None
    snapshot = scenarios.get(scenario_name)
    return snapshot if isinstance(snapshot, dict) else None

def _forecast_map(snapshot: dict[str, Any]) -> dict[int, dict[str, Any]]:
    forecasts = snapshot.get("forecasts")
    if not isinstance(forecasts, list):
        return {}

    out: dict[int, dict[str, Any]] = {}
    for forecast in forecasts:
        if not isinstance(forecast, dict):
            continue
        year = _to_float(forecast.get("year"))
        if year is None:
            continue
        out[int(year)] = forecast
    return out

def _scenario_assumptions(snapshot: dict[str, Any]) -> dict[str, Any]:
    assumptions = snapshot.get("assumptions")
    return assumptions if isinstance(assumptions, dict) else {}

def _scenario_summary(snapshot: dict[str, Any]) -> dict[str, Any]:
    summary = snapshot.get("summary")
    return summary if isinstance(summary, dict) else {}

def _scenario_first_projection_forecast(
    forecast_by_year: dict[int, dict[str, Any]],
    timeline_years: list[int],
) -> dict[str, Any] | None:
    projection_years = timeline_years[2:] if len(timeline_years) >= 3 else []
    for year in projection_years:
        forecast = forecast_by_year.get(year)
        if forecast is not None:
            return forecast
    if not forecast_by_year:
        return None
    first_year = sorted(forecast_by_year.keys())[0]
    return forecast_by_year[first_year]

def _infer_revenue_growth_rate(forecasts: list[Any]) -> float | None:
    prev_revenue: float | None = None
    for item in forecasts:
        if not isinstance(item, dict):
            continue
        revenue = _to_float(item.get("revenue"))
        if revenue is None or revenue <= 0:
            continue
        if prev_revenue is not None and prev_revenue > 0:
            growth = (revenue / prev_revenue) - 1.0
            return max(-0.5, min(0.5, growth))
        prev_revenue = revenue
    return None

def _metric_series(payload: dict[str, Any], timeline: list[int], metric: str, revenue_series: list[float] | None = None) -> list[float]:
    historicals = payload.get("historicals", {})
    income = historicals.get("income", {}) if isinstance(historicals, dict) else {}

    mapping = {
        "revenue": ["Total Revenue", "Revenue", "Sales"],
        "cost_of_revenue": ["Cost of Revenue", "COGS", "Cost Of Revenue", "Cost of Sales", "Purchases"],
        "sales_commission": ["Sales Commission", "SalesCommission"],
    }
    source = _series(income, mapping[metric])

    idx_by_year = _historical_index_by_year(payload)
    forecast_by_year = _forecast_by_year(payload)

    series: list[float] = []
    fallback_ratio = 0.0
    if metric == "cost_of_revenue":
        fallback_ratio = _last_known_ratio(source, revenue_series or [], default_ratio=0.60)
    elif metric == "sales_commission":
        fallback_ratio = _last_known_ratio(source, revenue_series or [], default_ratio=0.0)

    for idx, year in enumerate(timeline):
        forecast = forecast_by_year.get(year)
        value = None
        if forecast:
            if metric == "revenue":
                value = _to_float(forecast.get("revenue"))
            elif metric == "cost_of_revenue":
                value = _first_float(
                    forecast,
                    "costOfRevenue",
                    "cogs",
                    "cost_of_revenue",
                    "costOfSales",
                    "cost_of_sales",
                )
                if (value is None or value <= 0) and revenue_series is not None and idx < len(revenue_series):
                    rev = revenue_series[idx]
                    if rev > 0:
                        value = rev * fallback_ratio
            else:
                value = _first_float(
                    forecast,
                    "salesCommission",
                    "sales_commission",
                    "marketingExpense",
                    "marketing",
                )
                rev = revenue_series[idx] if revenue_series is not None and idx < len(revenue_series) else _to_float(forecast.get("revenue"))
                if value is not None and value > 0:
                    pass
                elif rev is not None and rev > 0:
                    value = rev * fallback_ratio

        hist_idx = idx_by_year.get(year)
        is_projection = hist_idx is None
        if hist_idx is not None and hist_idx < len(source):
            hist_value = abs(source[hist_idx])
            if hist_value > 0:
                series.append(hist_value)
                continue

            if metric in {"cost_of_revenue", "sales_commission"} and is_projection:
                rev = revenue_series[idx] if revenue_series is not None and idx < len(revenue_series) else 0.0
                if rev > 0:
                    series.append(rev * fallback_ratio)
                    continue

        if value is not None:
            value_abs = abs(value)
            if metric in {"cost_of_revenue", "sales_commission"} and is_projection and value_abs <= 0:
                rev = revenue_series[idx] if revenue_series is not None and idx < len(revenue_series) else 0.0
                if rev > 0:
                    value_abs = rev * fallback_ratio
            series.append(value_abs)
            continue

        previous = series[-1] if series else 0.0
        series.append(previous)

    return series

def _split_cost_of_revenue_components(
    cost_of_revenue_series: list[float],
    sales_commission_series: list[float],
) -> tuple[list[float], list[float]]:
    purchases_series: list[float] = []
    normalized_sales_commission: list[float] = []
    total_periods = max(len(cost_of_revenue_series), len(sales_commission_series))
    for idx in range(total_periods):
        cogs = abs(cost_of_revenue_series[idx]) if idx < len(cost_of_revenue_series) else 0.0
        sales_commission = abs(sales_commission_series[idx]) if idx < len(sales_commission_series) else 0.0
        sales_commission = min(sales_commission, cogs)
        purchases_series.append(max(0.0, cogs - sales_commission))
        normalized_sales_commission.append(sales_commission)
    return purchases_series, normalized_sales_commission

def _opex_component_series(
    template_sheet: Worksheet,
    payload: dict[str, Any],
    timeline: list[int],
    revenue_series: list[float],
    purchases_series: list[float],
    sales_commission_series: list[float],
) -> dict[str, list[float]]:
    historicals = payload.get("historicals", {})
    income = historicals.get("income", {}) if isinstance(historicals, dict) else {}
    cashflow = historicals.get("cashflow", {}) if isinstance(historicals, dict) else {}

    rnd_series_hist = _series(income, ["Research & Development", "R&D", "Research and Development"])
    sga_series_hist = _series(
        income,
        ["SG&A", "SGA", "General and Administrative", "GeneralAndAdministrative", "G&A", "GA"],
    )
    da_series_hist = _series(
        income,
        ["D&A (included in Operating)", "D&A", "DA", "Depreciation & Amortization", "Depreciation"],
    )
    if not da_series_hist:
        da_series_hist = _series(cashflow, ["Depreciation"])
    other_series_hist = _series(income, ["Other Operating Expenses", "Other"])
    operating_exp_hist = _series(income, ["Operating Expenses", "Total Operating Expenses", "OperatingExpense", "OPEX"])
    ebit_hist = _series(income, ["Operating Income (EBIT)", "EBIT", "Operating Income"])
    gross_profit_hist = _series(income, ["Gross Profit", "GrossProfit"])
    revenue_hist = _series(income, ["Total Revenue", "Revenue", "Sales"])

    idx_by_year = _historical_index_by_year(payload)
    forecast_by_year = _forecast_by_year(payload)

    mix = _last_known_opex_mix(
        rnd_series_hist,
        sga_series_hist,
        da_series_hist,
        other_series_hist,
    ) or _template_opex_mix(template_sheet)

    out = {"rnd": [], "sga": [], "da": [], "other": []}
    for idx, year in enumerate(timeline):
        hist_idx = idx_by_year.get(year)
        forecast = forecast_by_year.get(year)
        revenue = _to_float(forecast.get("revenue")) if forecast else None
        ebit = _to_float(forecast.get("ebit")) if forecast else None
        gross_profit = _to_float(forecast.get("grossProfit")) if forecast else None

        if revenue is None and hist_idx is not None and hist_idx < len(revenue_hist):
            revenue = revenue_hist[hist_idx]
        if revenue is None and idx < len(revenue_series):
            revenue = revenue_series[idx]
        if ebit is None and hist_idx is not None and hist_idx < len(ebit_hist):
            ebit = ebit_hist[hist_idx]
        if gross_profit is None and hist_idx is not None and hist_idx < len(gross_profit_hist):
            gross_profit = gross_profit_hist[hist_idx]

        operating_total = None
        if hist_idx is not None and hist_idx < len(operating_exp_hist):
            operating_total = abs(operating_exp_hist[hist_idx])
        if operating_total is None and gross_profit is not None and ebit is not None:
            operating_total = max(0.0, gross_profit - ebit)
        if operating_total is None and revenue is not None and ebit is not None:
            operating_total = max(0.0, revenue - purchases_series[idx] - sales_commission_series[idx] - ebit)
        if operating_total is None:
            operating_total = (
                (out["rnd"][-1] if out["rnd"] else 0.0)
                + (out["sga"][-1] if out["sga"] else 0.0)
                + (out["da"][-1] if out["da"] else 0.0)
                + (out["other"][-1] if out["other"] else 0.0)
            )

        rnd = (
            abs(rnd_series_hist[hist_idx])
            if hist_idx is not None and hist_idx < len(rnd_series_hist) and abs(rnd_series_hist[hist_idx]) > 0
            else abs(_to_float(forecast.get("rdExpense")) or 0.0) if forecast else 0.0
        )
        sga = (
            abs(sga_series_hist[hist_idx])
            if hist_idx is not None and hist_idx < len(sga_series_hist) and abs(sga_series_hist[hist_idx]) > 0
            else abs(_to_float(forecast.get("sgaExpense")) or 0.0) if forecast else 0.0
        )
        da = (
            abs(da_series_hist[hist_idx])
            if hist_idx is not None and hist_idx < len(da_series_hist) and abs(da_series_hist[hist_idx]) > 0
            else abs(_to_float(forecast.get("depreciation")) or 0.0) if forecast else 0.0
        )
        other = abs(other_series_hist[hist_idx]) if hist_idx is not None and hist_idx < len(other_series_hist) else 0.0

        provided = {"rnd": rnd, "sga": sga, "da": da, "other": other}
        missing = [k for k, v in provided.items() if v <= 0]
        known_sum = sum(v for v in provided.values() if v > 0)
        remaining = max(0.0, operating_total - known_sum)

        if missing:
            missing_mix_total = sum(mix[key] for key in missing)
            for key in missing:
                weight = (mix[key] / missing_mix_total) if missing_mix_total > 0 else (1.0 / len(missing))
                provided[key] = remaining * weight
        elif operating_total > known_sum and known_sum > 0:
            provided["other"] = max(0.0, provided["other"] + (operating_total - known_sum))

        out["rnd"].append(provided["rnd"])
        out["sga"].append(provided["sga"])
        out["da"].append(provided["da"])
        out["other"].append(provided["other"])

    return out
