from __future__ import annotations

from datetime import date, datetime
from typing import Any

from openpyxl.worksheet.worksheet import Worksheet

from .utils import (
    DCF_TIMELINE_COLUMNS,
    RECALC_COLUMNS,
    TEN_YEAR_COLUMNS,
    _fiscal_year_end_date,
    _force_set,
    _metric_series,
    _opex_component_series,
    _safe_date,
    _safe_set,
    _safe_set_or_clear,
    _safe_year_end_date,
    _sanitize_terminal_growth_rate,
    _sanitize_wacc_rate,
    _scale,
    _split_cost_of_revenue_components,
    _to_float,
)


def _map_data_sheets(
    data_original: Worksheet,
    data_recalc: Worksheet,
    payload: dict[str, Any],
    divisor: float,
    timeline_years: list[int],
) -> None:
    revenue_series = _metric_series(payload, timeline_years, "revenue")
    cost_of_revenue_series = _metric_series(payload, timeline_years, "cost_of_revenue", revenue_series)
    sales_commission_series = _metric_series(payload, timeline_years, "sales_commission", revenue_series)
    purchases_series, sales_commission_series = _split_cost_of_revenue_components(
        cost_of_revenue_series,
        sales_commission_series,
    )
    opex_components = _opex_component_series(
        data_original,
        payload,
        timeline_years,
        revenue_series,
        purchases_series,
        sales_commission_series,
    )

    for idx, column in enumerate(TEN_YEAR_COLUMNS):
        _force_set(data_original, f"{column}12", _scale(revenue_series[idx], divisor))
        _force_set(data_original, f"{column}16", _scale(purchases_series[idx], divisor))
        _force_set(data_original, f"{column}17", _scale(sales_commission_series[idx], divisor))
        _force_set(data_original, f"{column}24", _scale(opex_components["rnd"][idx], divisor))
        _force_set(data_original, f"{column}25", _scale(opex_components["sga"][idx], divisor))
        _force_set(data_original, f"{column}26", _scale(opex_components["da"][idx], divisor))
        _force_set(data_original, f"{column}27", _scale(opex_components["other"][idx], divisor))

    for idx, column in enumerate(RECALC_COLUMNS):
        _force_set(data_recalc, f"{column}12", _scale(revenue_series[idx], divisor))
        _force_set(data_recalc, f"{column}16", _scale(purchases_series[idx], divisor))
        _force_set(data_recalc, f"{column}17", _scale(sales_commission_series[idx], divisor))
        _force_set(data_recalc, f"{column}24", _scale(opex_components["rnd"][idx], divisor))
        _force_set(data_recalc, f"{column}25", _scale(opex_components["sga"][idx], divisor))
        _force_set(data_recalc, f"{column}26", _scale(opex_components["da"][idx], divisor))
        _force_set(data_recalc, f"{column}27", _scale(opex_components["other"][idx], divisor))

    # Remove legacy M&A assumption block from both data tabs.
    for sheet in (data_original, data_recalc):
        for row in range(34, 42):
            for col in ("B", "C"):
                _safe_set_or_clear(sheet, f"{col}{row}", None)
    _safe_set_or_clear(data_recalc, "R30", None)



def _build_timeline(payload: dict[str, Any]) -> tuple[list[int], set[int]]:
    historical_years = sorted({int(y) for y in (payload.get("historicals", {}).get("years", []) or []) if _to_float(y) is not None})
    forecast_years = sorted(
        {
            int(year)
            for year in [
                (_to_float(f.get("year")) if isinstance(f, dict) else None)
                for f in (payload.get("forecasts", []) or [])
            ]
            if year is not None
        }
    )

    combined = sorted({*historical_years, *forecast_years})
    if not combined:
        current_year = datetime.now().year
        combined = [current_year - 4 + i for i in range(10)]

    if len(combined) > 10:
        timeline = combined[-10:]
    else:
        timeline = combined[:]

    while len(timeline) < 10:
        timeline.append(timeline[-1] + 1)

    return timeline, set(historical_years)



def _map_year_headers(
    outputs: Worksheet,
    dcf_base: Worksheet,
    dcf_bull: Worksheet,
    dcf_bear: Worksheet,
    data_original: Worksheet,
    data_recalc: Worksheet,
    timeline_years: list[int],
    historical_years: set[int],
    payload: dict[str, Any],
) -> None:
    company = payload.get("company", {})
    as_of = _safe_date(company.get("asOfDate"))
    fallback_year = as_of.year if as_of is not None else datetime.now().year
    fiscal_end = _fiscal_year_end_date(company.get("fiscalYearEnd"), fallback_year) or date(fallback_year, 12, 31)
    fiscal_month = fiscal_end.month
    fiscal_day = fiscal_end.day

    # Force explicit FY labels so Actual/Forecast split is payload-driven.
    for idx, col in enumerate(DCF_TIMELINE_COLUMNS):
        year = timeline_years[idx]
        label = f"FY{year}{'A' if year in historical_years else 'E'}"
        _force_set(outputs, f"{col}6", label)
        _force_set(dcf_base, f"{col}18", label)
        _force_set(dcf_bull, f"{col}18", label)
        _force_set(dcf_bear, f"{col}18", label)
        _force_set(dcf_base, f"{col}63", label)
        _force_set(dcf_bull, f"{col}63", label)
        _force_set(dcf_bear, f"{col}63", label)
        _force_set(dcf_base, f"{col}72", label)
        _force_set(dcf_bull, f"{col}72", label)
        _force_set(dcf_bear, f"{col}72", label)

    assumptions = payload.get("assumptions", {})
    assumptions = assumptions if isinstance(assumptions, dict) else {}
    terminal_assumptions = assumptions.get("terminal")
    terminal_assumptions = terminal_assumptions if isinstance(terminal_assumptions, dict) else {}
    wacc_assumptions = assumptions.get("wacc")
    wacc_assumptions = wacc_assumptions if isinstance(wacc_assumptions, dict) else {}
    base_wacc = _sanitize_wacc_rate(assumptions.get("waccRate") or wacc_assumptions.get("waccRate"))
    _safe_set(outputs, "H28", _sanitize_terminal_growth_rate(terminal_assumptions.get("g"), reference_wacc=base_wacc))

    for idx, col in enumerate(TEN_YEAR_COLUMNS):
        year = timeline_years[idx]
        _safe_set(data_original, f"{col}3", "Actual" if year in historical_years else "Projections")
        _safe_set(data_original, f"{col}5", _safe_year_end_date(year, fiscal_month, fiscal_day))
        year = timeline_years[idx]
        _force_set(data_original, f"{col}6", f"FY{year}{'A' if year in historical_years else 'E'}")

    for idx, col in enumerate(RECALC_COLUMNS):
        year = timeline_years[idx]
        _safe_set(data_recalc, f"{col}3", "Actual" if year in historical_years else "Projections")
        _safe_set(data_recalc, f"{col}5", _safe_year_end_date(year, fiscal_month, fiscal_day))
        year = timeline_years[idx]
        _force_set(data_recalc, f"{col}6", f"FY{year}{'A' if year in historical_years else 'E'}")



