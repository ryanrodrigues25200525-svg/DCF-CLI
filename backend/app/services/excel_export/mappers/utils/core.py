from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from openpyxl.workbook import Workbook
from openpyxl.worksheet.worksheet import Worksheet

from .constants import (
    SHEET_OUTPUTS,
    SHEET_OUTPUTS_LEGACY,
    WACC_LOOP_MODE_CURRENT_EQUITY,
    WACC_LOOP_MODE_ITERATIVE,
)
from .compatibility import MockWorkbook, MockWorksheet


def _sheet(workbook: Workbook, name: str) -> Worksheet:
    if isinstance(workbook, MockWorkbook):
        if name in workbook._sheets:
            return workbook._sheets[name]
        if name == SHEET_OUTPUTS and SHEET_OUTPUTS_LEGACY in workbook._sheets:
            ws = workbook._sheets[SHEET_OUTPUTS_LEGACY]
            ws.title = SHEET_OUTPUTS
            return ws
        raise KeyError(f"Missing required sheet: {name}")

    if name in workbook.sheetnames:
        return workbook[name]
    if name == SHEET_OUTPUTS and SHEET_OUTPUTS_LEGACY in workbook.sheetnames:
        ws = workbook[SHEET_OUTPUTS_LEGACY]
        ws.title = SHEET_OUTPUTS
        return ws
    raise KeyError(f"Missing required sheet: {name}")

def _to_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if number == number and number not in (float("inf"), float("-inf")) else None
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            number = float(stripped)
            return number if number == number and number not in (float("inf"), float("-inf")) else None
        except ValueError:
            return None
    return None

def _safe_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
        except ValueError:
            return None
    return None

def _fiscal_year_end_date(raw: Any, fallback_year: int) -> date | None:
    parsed_date = _safe_date(raw)
    if parsed_date is not None:
        return parsed_date

    if not isinstance(raw, str):
        return None

    compact = raw.strip()
    numeric_match = re.match(r"^\s*(\d{1,2})[/-](\d{1,2})\s*$", compact)
    if numeric_match:
        month = int(numeric_match.group(1))
        day = int(numeric_match.group(2))
        try:
            return date(fallback_year, month, day)
        except ValueError:
            return None

    parts = compact.replace(",", " ").split()
    if len(parts) < 2:
        return None

    month_lookup = {
        "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
        "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
        "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9, "oct": 10,
        "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
    }

    month = month_lookup.get(parts[0].lower())
    day = _to_float(parts[1])
    if month is None or day is None:
        return None

    try:
        return date(fallback_year, month, int(day))
    except ValueError:
        return None

def _safe_year_end_date(year: int, month: int, day: int) -> date:
    while day > 0:
        try:
            return date(year, month, day)
        except ValueError:
            day -= 1
    return date(year, month, 1)

def _first_float(comp: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        parsed = _to_float(comp.get(key))
        if parsed is not None:
            return parsed
    return None

def _series(record: dict[str, Any], keys: list[str]) -> list[float]:
    for key in keys:
        values = record.get(key)
        if isinstance(values, list):
            out: list[float] = []
            for item in values:
                parsed = _to_float(item)
                out.append(parsed if parsed is not None else 0.0)
            return out
    return []

def _resolve_amount_scale_divisor(payload: dict[str, Any]) -> float:
    company = payload.get("company", {})
    market = payload.get("market", {})
    historicals = payload.get("historicals", {})
    income = historicals.get("income", {}) if isinstance(historicals, dict) else {}

    unit_scale = str(company.get("unitsScale", "units")).lower()
    historical_revenue = _series(income, ["Revenue", "Total Revenue", "Sales"])

    forecast_values = []
    for forecast in payload.get("forecasts", []) or []:
        if not isinstance(forecast, dict):
            continue
        parsed = _to_float(forecast.get("revenue"))
        if parsed is not None:
            forecast_values.append(abs(parsed))

    sample_magnitude = max(
        [
            0.0,
            *[abs(v) for v in historical_revenue],
            *forecast_values,
            abs(_to_float(market.get("netDebt")) or 0.0),
            abs(_to_float(market.get("debt")) or 0.0),
        ]
    )

    if unit_scale == "billions":
        return 1_000_000_000.0
    if unit_scale == "millions":
        return 1_000_000.0 if sample_magnitude >= 1_000_000 else 1.0
    if unit_scale == "thousands":
        return 1_000.0 if sample_magnitude >= 1_000 else 1.0
    return 1.0

def _scale(value: float | None, divisor: float) -> float | None:
    if value is None:
        return None
    if divisor in (0, 1):
        return value
    return value / divisor

def _payload_ticker(payload: dict[str, Any]) -> str:
    ticker = payload.get("company", {}).get("ticker")
    if isinstance(ticker, str) and ticker.strip():
        return ticker.strip().upper()
    return "TICKER"

def _payload_company_name(payload: dict[str, Any]) -> str | None:
    company = payload.get("company", {})
    if isinstance(company, dict):
        name = company.get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()
    ui_meta = payload.get("uiMeta", {})
    if isinstance(ui_meta, dict):
        name = ui_meta.get("companyName")
        if isinstance(name, str) and name.strip():
            return name.strip()
    return None

def _display_company_label(company_name: str | None, ticker: str) -> str:
    if company_name:
        return company_name
    return ticker

def resolve_wacc_loop_mode(payload: dict[str, Any]) -> str:
    assumptions = payload.get("assumptions", {})
    if not isinstance(assumptions, dict):
        return WACC_LOOP_MODE_CURRENT_EQUITY
    mode_raw = assumptions.get("waccLoopMode")
    if isinstance(mode_raw, str):
        mode = mode_raw.strip().lower()
        if mode in (WACC_LOOP_MODE_CURRENT_EQUITY, WACC_LOOP_MODE_ITERATIVE):
            return mode
    return WACC_LOOP_MODE_CURRENT_EQUITY

def _historical_index_by_year(payload: dict[str, Any]) -> dict[int, int]:
    years = payload.get("historicals", {}).get("years", []) or []
    return {int(year): idx for idx, year in enumerate(years) if _to_float(year) is not None}

def _forecast_by_year(payload: dict[str, Any]) -> dict[int, dict[str, Any]]:
    mapping: dict[int, dict[str, Any]] = {}
    for forecast in payload.get("forecasts", []) or []:
        if not isinstance(forecast, dict):
            continue
        year = _to_float(forecast.get("year"))
        if year is None:
            continue
        mapping[int(year)] = forecast
    return mapping

def _format_percent_axis_label(value: float) -> str:
    return f"{value * 100:.1f}%"
