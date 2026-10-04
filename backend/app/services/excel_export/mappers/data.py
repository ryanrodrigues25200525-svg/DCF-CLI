from __future__ import annotations

from datetime import date, datetime
from typing import Any

from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.worksheet import Worksheet

from .utils import (
    DCF_TIMELINE_COLUMNS,
    RECALC_COLUMNS,
    SHEET_DCF_BASE,
    TEN_YEAR_COLUMNS,
    _fiscal_year_end_date,
    _force_set,
    _historical_value_for_year,
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
    timeline_years: list[int | None],
) -> None:
    company = payload.get("company")
    company = company if isinstance(company, dict) else {}
    ticker = str(company.get("ticker") or "").strip().upper()
    if ticker:
        _safe_set(data_recalc, "B1", ticker)
    historicals = payload.get("historicals", {})
    historicals = historicals if isinstance(historicals, dict) else {}
    historical_years = {
        int(year)
        for year in (historicals.get("years", []) or [])
        if _to_float(year) is not None
    }

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

    _map_cashflow_working_capital_schedule(data_recalc, payload, timeline_years, divisor)

    for idx, column in enumerate(RECALC_COLUMNS):
        prior_column = RECALC_COLUMNS[idx - 1] if idx > 0 else None
        _force_set(
            data_recalc,
            f"{column}13",
            '=""' if prior_column is None else f"=IFERROR({column}12/{prior_column}12-1,\"\")",
        )
        _force_set(data_recalc, f"{column}18", f"={column}16+{column}17")
        _force_set(data_recalc, f"{column}20", f"={column}12-{column}18")
        _force_set(data_recalc, f"{column}21", f"=IFERROR({column}20/{column}12,0)")
        _force_set(data_recalc, f"{column}28", f"={column}24+{column}25+{column}27")
        _force_set(data_recalc, f"{column}30", f"={column}20-{column}28")
        _force_set(data_recalc, f"{column}31", f"=IFERROR({column}30/{column}12,0)")

    for idx, recalc_col in enumerate(RECALC_COLUMNS):
        year = timeline_years[idx] if idx < len(timeline_years) else None
        if year is None or year in historical_years:
            continue
        dcf_col = DCF_TIMELINE_COLUMNS[idx]
        dcf_ref = f"'{SHEET_DCF_BASE}'!"
        for recalc_row, dcf_row in (
            (12, 20), (16, 24), (17, 27), (24, 36), (25, 39), (26, 68), (27, 45),
        ):
            _force_set(data_recalc, f"{recalc_col}{recalc_row}", f"={dcf_ref}{dcf_col}{dcf_row}")
        _force_set(data_recalc, f"{recalc_col}35", f"=-{dcf_ref}{dcf_col}65")
        _force_set(data_recalc, f"{recalc_col}36", f"={dcf_ref}{dcf_col}68")

    for idx, year in enumerate(timeline_years):
        if year is not None:
            continue
        for sheet, column in ((data_original, TEN_YEAR_COLUMNS[idx]), (data_recalc, RECALC_COLUMNS[idx])):
            for row in range(3, 42):
                _safe_set_or_clear(sheet, f"{column}{row}", None)


def _map_cashflow_working_capital_schedule(
    data_recalc: Worksheet,
    payload: dict[str, Any],
    timeline_years: list[int | None],
    divisor: float,
) -> None:
    company = payload.get("company")
    company = company if isinstance(company, dict) else {}
    subscription_software = str(company.get("operatingArchetype") or company.get("operating_archetype") or "") == "subscription_software"
    labels = {
        "B34": "Cash Flow and Working Capital Detail",
        "B35": "Capital Expenditures",
        "B36": "Depreciation and Amortization",
        "B37": "Accounts Receivable",
        "B38": "Inventory",
        "B39": "Accounts Payable",
        "B40": "Net Working Capital",
        "B41": "Change in Net Working Capital",
    }
    for cell_ref, value in labels.items():
        _safe_set(data_recalc, cell_ref, value)

    historicals = payload.get("historicals", {})
    historicals = historicals if isinstance(historicals, dict) else {}
    historical_years = {
        int(year)
        for year in (historicals.get("years", []) or [])
        if _to_float(year) is not None
    }
    source_rows = {
        35: ("cashflow", ["Capex", "Capital Expenditures", "Capital Expenditure"]),
        36: (
            "cashflow",
            [
                "Depreciation & Amortization",
                "Depreciation and Amortization",
                "Depreciation, Depletion and Amortization",
                "Depreciation",
                "D&A",
            ],
        ),
        37: ("balance", ["AccountsReceivable", "Accounts Receivable"]),
        38: ("balance", ["Inventory", "Inventories"]),
        39: ("balance", ["AccountsPayable", "Accounts Payable"]),
    }

    for row in range(35, 42):
        for column in RECALC_COLUMNS:
            _force_set(data_recalc, f"{column}{row}", None)

    for idx, column in enumerate(RECALC_COLUMNS):
        if idx >= len(timeline_years):
            continue
        year = timeline_years[idx]
        if year is None or year not in historical_years:
            continue

        available: dict[int, bool] = {}
        for row, (statement, keys) in source_rows.items():
            value = _historical_value_for_year(
                payload,
                year,
                statement=statement,
                keys=keys,
            )
            available[row] = value is not None
            if value is not None:
                _force_set(data_recalc, f"{column}{row}", _scale(value, divisor))

        if subscription_software:
            balance = historicals.get("balance", {})
            balance = balance if isinstance(balance, dict) else {}
            operating_nwc = balance.get("OperatingNetWorkingCapital")
            operating_nwc = operating_nwc if isinstance(operating_nwc, list) else []
            prior_column = RECALC_COLUMNS[idx - 1] if idx > 0 else None
            if idx < len(operating_nwc) and _to_float(operating_nwc[idx]) is not None:
                _force_set(data_recalc, f"{column}40", _scale(_to_float(operating_nwc[idx]), divisor))
                prior_year = timeline_years[idx - 1] if idx > 0 else None
                if (
                    prior_column is not None
                    and prior_year in historical_years
                    and year == prior_year + 1
                    and idx - 1 < len(operating_nwc)
                    and _to_float(operating_nwc[idx - 1]) is not None
                ):
                    _force_set(data_recalc, f"{column}41", f"={column}40-{prior_column}40")
        elif all(available.get(row, False) for row in (37, 38, 39)):
            _force_set(data_recalc, f"{column}40", f"={column}37+{column}38-{column}39")

        prior_column = RECALC_COLUMNS[idx - 1] if idx > 0 else None
        prior_year = timeline_years[idx - 1] if idx > 0 else None
        if (
            prior_column is not None
            and prior_year in historical_years
            and year == prior_year + 1
            and all(available.get(row, False) for row in (37, 38, 39))
            and isinstance(data_recalc[f"{prior_column}40"].value, str)
            and data_recalc[f"{prior_column}40"].value.startswith("=")
            and isinstance(data_recalc[f"{column}40"].value, str)
            and data_recalc[f"{column}40"].value.startswith("=")
        ):
            _force_set(data_recalc, f"{column}41", f"={column}40-{prior_column}40")

    assumptions = payload.get("assumptions", {})
    assumptions = assumptions if isinstance(assumptions, dict) else {}
    working_capital_inputs = (
        (50, "Days sales outstanding (DSO)", "dso", "accountsReceivableDays"),
        (51, "Days inventory outstanding (DIO)", "dio", "inventoryDays"),
        (52, "Days payables outstanding (DPO)", "dpo", "accountsPayableDays"),
    )
    _safe_set(data_recalc, "B49", "Editable Working-Capital Assumptions")
    data_recalc["B49"].font = Font(name="Arial", size=10, bold=True, color="17365D")
    for row, label, first_key, second_key in working_capital_inputs:
        value = _to_float(assumptions.get(first_key))
        if value is None:
            value = _to_float(assumptions.get(second_key))
        if value is None or value < 0:
            raise ValueError(f"The formula workbook requires a non-negative {label} input.")
        _safe_set(data_recalc, f"B{row}", label)
        _safe_set(data_recalc, f"C{row}", value)
        data_recalc[f"C{row}"].font = Font(name="Arial", size=10, color="0000FF")
        data_recalc[f"C{row}"].fill = PatternFill("solid", fgColor="FFF2CC")
        data_recalc[f"C{row}"].number_format = "0.0"
        data_recalc[f"C{row}"].alignment = Alignment(vertical="center")
        data_recalc[f"C{row}"].comment = Comment(
            "Editable starting driver initialized from the latest filed balance: DSO = accounts receivable / revenue x 365; DIO = inventory / cost of revenue x 365; DPO = accounts payable / cost of revenue x 365. Filed concepts and accessions are listed in Data Review.",
            "DCF Builder Pro",
        )
    _safe_set(
        data_recalc,
        "B53",
        "Aggregate operating NWC residual (% Revenue)" if subscription_software else "NWC intensity overlay (% Revenue)",
    )
    _force_set(data_recalc, "C53", f"='{SHEET_DCF_BASE}'!$F$10")
    data_recalc["C53"].number_format = "0.0%"

    for idx, column in enumerate(RECALC_COLUMNS):
        year = timeline_years[idx] if idx < len(timeline_years) else None
        if year is None or year in historical_years or idx == 0:
            continue
        dcf_column = DCF_TIMELINE_COLUMNS[idx]
        prior_recalc = RECALC_COLUMNS[idx - 1]
        dcf_ref = f"'{SHEET_DCF_BASE}'!"
        # Project the displayed base-case schedule from editable assumptions and prior-period ratios.
        _force_set(data_recalc, f"{column}12", f"={prior_recalc}12*(1+{dcf_ref}$F$14)")
        _force_set(data_recalc, f"{column}16", f"=IFERROR({column}12*{prior_recalc}16/{prior_recalc}12,0)")
        _force_set(data_recalc, f"{column}17", f"=IFERROR({column}12*{prior_recalc}17/{prior_recalc}12,0)")
        _force_set(data_recalc, f"{column}24", f"=IFERROR({column}12*{prior_recalc}24/{prior_recalc}12,0)")
        _force_set(data_recalc, f"{column}25", f"=IFERROR({column}12*{prior_recalc}25/{prior_recalc}12,0)")
        _force_set(data_recalc, f"{column}26", f"={column}12*{dcf_ref}$F$13")
        _force_set(data_recalc, f"{column}27", f"=IFERROR({column}12*{prior_recalc}27/{prior_recalc}12,0)")
        _force_set(data_recalc, f"{column}35", f"={column}12*{dcf_ref}$F$9")
        _force_set(data_recalc, f"{column}36", f"={column}12*{dcf_ref}$F$13")
        _force_set(data_recalc, f"{column}37", f"={dcf_ref}{dcf_column}20*$C$50/365")
        _force_set(data_recalc, f"{column}38", f"=({dcf_ref}{dcf_column}24+{dcf_ref}{dcf_column}27)*$C$51/365")
        _force_set(data_recalc, f"{column}39", f"=({dcf_ref}{dcf_column}24+{dcf_ref}{dcf_column}27)*$C$52/365")
        _force_set(data_recalc, f"{column}40", f"={column}37+{column}38-{column}39+{column}12*$C$53")
        _force_set(data_recalc, f"{column}41", f"={column}40-{prior_recalc}40")

    # Cash-flow detail reads as whole currency units; General format would show
    # raw decimals on the forecast links (e.g. -26608.517).
    for _row in range(35, 42):
        for _column in RECALC_COLUMNS:
            _cell = data_recalc[f"{_column}{_row}"]
            if isinstance(_cell.value, (int, float)) and not isinstance(_cell.value, bool):
                _cell.number_format = "#,##0"
            elif isinstance(_cell.value, str) and _cell.value.startswith("="):
                _cell.number_format = "#,##0"



def _build_timeline(payload: dict[str, Any]) -> tuple[list[int | None], set[int]]:
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
        timeline = [None] * (10 - len(combined)) + combined

    return timeline, set(historical_years)



def _map_year_headers(
    outputs: Worksheet,
    dcf_base: Worksheet,
    dcf_bull: Worksheet,
    dcf_bear: Worksheet,
    data_original: Worksheet,
    data_recalc: Worksheet,
    timeline_years: list[int | None],
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
        if year is None:
            _safe_set_or_clear(outputs, f"{col}6", None)
            for sheet in (dcf_base, dcf_bull, dcf_bear):
                for row in (18, 63, 72, 89):
                    _safe_set_or_clear(sheet, f"{col}{row}", None)
            for sheet, period_col in ((data_original, TEN_YEAR_COLUMNS[idx]), (data_recalc, RECALC_COLUMNS[idx])):
                for row in (3, 5, 6):
                    _safe_set_or_clear(sheet, f"{period_col}{row}", None)
            continue
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
        if year is None:
            continue
        _safe_set(data_original, f"{col}3", "Actual" if year in historical_years else "Projections")
        _safe_set(data_original, f"{col}5", _safe_year_end_date(year, fiscal_month, fiscal_day))
        year = timeline_years[idx]
        _force_set(data_original, f"{col}6", f"FY{year}{'A' if year in historical_years else 'E'}")

    for idx, col in enumerate(RECALC_COLUMNS):
        year = timeline_years[idx]
        if year is None:
            continue
        _safe_set(data_recalc, f"{col}3", "Actual" if year in historical_years else "Projections")
        _safe_set(data_recalc, f"{col}5", _safe_year_end_date(year, fiscal_month, fiscal_day))
        year = timeline_years[idx]
        _force_set(data_recalc, f"{col}6", f"FY{year}{'A' if year in historical_years else 'E'}")
