from __future__ import annotations

import math
from typing import Any

from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.workbook import Workbook
from openpyxl.worksheet.worksheet import Worksheet

_INPUT_FONT = Font(name="Arial", size=10, color="0000FF")
_FORMULA_FONT = Font(name="Arial", size=10, color="000000")
_BODY_FONT = Font(name="Arial", size=10, color="000000")
_SMALL_FONT = Font(name="Arial", size=9, color="404040")
_HEADER_FONT = Font(name="Arial", size=9, bold=True, color="FFFFFF")
_SECTION_FONT = Font(name="Arial", size=10, bold=True, color="17365D")
_TITLE_FILL = PatternFill("solid", fgColor="17365D")
_SECTION_FILL = PatternFill("solid", fgColor="D9EAF7")
_INPUT_FILL = PatternFill("solid", fgColor="FFF2CC")
_FORMULA_FILL = PatternFill("solid", fgColor="E2F0D9")
_HEADER_FILL = PatternFill("solid", fgColor="365F91")
_MONEY_FORMAT = '#,##0.0,,;[Red](#,##0.0,,);-'
_PERCENT_FORMAT = '0.0%;[Red](0.0%);0.0%'
_SUBSCRIBER_FORMAT = '#,##0.0,,;[Red](#,##0.0,,);-'
_ARPU_FORMAT = '$0.00;[Red]($0.00);-'
_PRICE_FORMAT = '$#,##0.00;[Red]($#,##0.00);-'
_SHARES_FORMAT = '#,##0.0,,;[Red](#,##0.0,,);-'


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _finite(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ValueError(f"Telecom workbook requires a finite value for {name}.")
    return float(value)


def _line_value(line: Any, name: str, year: int, *, allow_not_applicable: bool = False) -> float | None:
    record = _record(line)
    source = record.get("source")
    if source == "not_applicable" and allow_not_applicable:
        sources = record.get("sources")
        if not record.get("method") or not isinstance(sources, list) or not sources:
            raise ValueError(f"FY{year} {name} is marked not applicable without filing lineage.")
        if any(not _record(item).get("accession") or not _record(item).get("filed") for item in sources):
            raise ValueError(f"FY{year} {name} has incomplete not-applicable lineage.")
        return 0.0
    if source == "missing":
        return None
    if source not in {"sec_native", "derived"}:
        raise ValueError(f"FY{year} telecom input {name} is missing or ambiguous.")
    value = _finite(record.get("value"), name)
    sources = record.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError(f"FY{year} telecom input {name} has no SEC source record.")
    if any(not _record(item).get("accession") or not _record(item).get("filed") for item in sources):
        raise ValueError(f"FY{year} telecom input {name} has incomplete SEC provenance.")
    return value


def _write(
    sheet: Worksheet,
    coordinate: str,
    value: Any,
    *,
    formula: bool = False,
    input_cell: bool = False,
    number_format: str | None = None,
    wrap: bool = False,
) -> None:
    cell = sheet[coordinate]
    cell.value = value
    cell.font = _INPUT_FONT if input_cell else _FORMULA_FONT if formula else _BODY_FONT
    cell.fill = _INPUT_FILL if input_cell else _FORMULA_FILL if formula else PatternFill(fill_type=None)
    cell.alignment = Alignment(vertical="center", wrap_text=wrap)
    if number_format:
        cell.number_format = number_format


def _section(sheet: Worksheet, row: int, title: str, last_column: int = 10) -> None:
    for column in range(1, last_column + 1):
        cell = sheet.cell(row=row, column=column)
        cell.fill = _SECTION_FILL
        cell.font = _SECTION_FONT
    sheet.cell(row=row, column=1, value=title)


def _history(model: dict[str, Any]) -> tuple[list[dict[str, Any]], list[int]]:
    history = _record(model.get("history"))
    annual = history.get("annual")
    years = history.get("years")
    if not isinstance(annual, list) or len(annual) != 4 or not isinstance(years, list) or len(years) != 4:
        raise ValueError("Telecom workbook requires four aligned annual periods, including an opening customer balance.")
    rows = [_record(item) for item in annual]
    if [row.get("year") for row in rows] != years:
        raise ValueError("Telecom workbook fiscal years do not align.")
    for index, year in enumerate(years):
        if isinstance(year, bool) or not isinstance(year, int) or (index > 0 and year != years[index - 1] + 1):
            raise ValueError("Telecom workbook requires four consecutive fiscal years.")
    return rows, years


def _validate_assumptions(assumptions: dict[str, Any], base_year: int) -> None:
    if _finite(assumptions.get("forecastYears"), "forecastYears") != 5:
        raise ValueError("Telecom workbook requires a five-year forecast.")
    if _finite(assumptions.get("baseYear"), "baseYear") != base_year:
        raise ValueError("Telecom workbook base year must match the latest filed period.")
    sources = _record(assumptions.get("assumptionSources"))
    if not sources or any(not isinstance(source, str) or not source.strip() for source in sources.values()):
        raise ValueError("Telecom workbook requires a source or explicit analyst-input disclosure for each assumption.")
    wacc = _finite(assumptions.get("wacc"), "wacc")
    growth = _finite(assumptions.get("terminalGrowthRate"), "terminalGrowthRate")
    if wacc <= 0 or growth < 0 or growth >= wacc:
        raise ValueError("Telecom terminal growth must remain below WACC.")
    if not isinstance(assumptions.get("asOfDate"), str) or len(assumptions["asOfDate"]) != 10:
        raise ValueError("Telecom workbook requires dated current market inputs.")


def _source_records(line: dict[str, Any]) -> list[dict[str, Any]]:
    sources = line.get("sources")
    return [_record(item) for item in sources] if isinstance(sources, list) else []


def _set_actual(sheet: Worksheet, coordinate: str, line: Any, label: str, year: int, number_format: str | None = None) -> float:
    value = _line_value(line, label, year)
    if value is None:
        raise ValueError(f"FY{year} telecom workbook input {label} is missing.")
    _write(sheet, coordinate, value, number_format=number_format)
    return value


def _map_model_sheet(workbook: Workbook, payload: dict[str, Any], model: dict[str, Any]) -> None:
    for existing in list(workbook.worksheets):
        workbook.remove(existing)
    sheet = workbook.create_sheet("Telecom Model")
    sheet.sheet_view.showGridLines = False
    sheet.freeze_panes = "F5"
    sheet.column_dimensions["A"].width = 58
    for column in "BCDEFGHIJ":
        sheet.column_dimensions[column].width = 15
    sheet.column_dimensions["K"].width = 42
    sheet.column_dimensions["L"].width = 17
    sheet.column_dimensions["M"].width = 72
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.page_setup.orientation = "landscape"

    company = _record(payload.get("company"))
    ticker = str(company.get("ticker") or "").upper()
    name = str(company.get("name") or ticker or "Company")
    model = _record(model)
    annual, years = _history(model)
    assumptions = _record(model.get("assumptions"))
    _validate_assumptions(assumptions, years[-1])

    sheet.merge_cells("A1:N1")
    sheet["A1"] = f"{name} ({ticker}) — Subscriber and Segment DCF"
    sheet["A1"].font = Font(name="Arial", size=16, bold=True, color="FFFFFF")
    sheet["A1"].fill = _TITLE_FILL
    sheet["A1"].alignment = Alignment(vertical="center")
    sheet.row_dimensions[1].height = 28
    sheet.merge_cells("A2:N2")
    sheet["A2"] = (
        "USD actuals display in millions; customer balances display in millions; ARPU is USD per month. "
        "Filed history is black, formulas are green, and blue cells are editable analyst assumptions or live market inputs."
    )
    sheet["A2"].font = _SMALL_FONT
    sheet["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    sheet.row_dimensions[2].height = 30

    _section(sheet, 3, "Subscriber schedules — filed history and formula-driven forecast", 10)
    headers = ["Operating schedule / fiscal year", *(f"FY{year}A" for year in years), *(f"FY{years[-1] + i}E" for i in range(1, 6))]
    for column, header in enumerate(headers, start=1):
        cell = sheet.cell(row=4, column=column, value=header)
        cell.font = _HEADER_FONT
        cell.fill = _HEADER_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    labels = {
        5: "Beginning postpaid phone subscribers",
        6: "Gross postpaid phone additions",
        7: "Postpaid phone monthly churn",
        8: "Postpaid phone disconnections",
        9: "Net postpaid phone additions",
        10: "Ending postpaid phone subscribers",
        11: "Average postpaid phone subscribers",
        12: "Beginning other wireless subscribers",
        13: "Other wireless subscriber growth",
        14: "Ending other wireless subscribers",
        15: "Beginning total wireless subscribers",
        16: "Ending total wireless subscribers",
        17: "Average total wireless subscribers",
        18: "Reported total subscriber roll-forward residual",
        21: "Monthly service revenue per average wireless subscriber",
        22: "Mobility service revenue",
        23: "Annual equipment revenue per average wireless subscriber",
        24: "Mobility equipment revenue",
        25: "Total Mobility segment revenue",
        26: "Mobility revenue build check",
        29: "Beginning broadband connections",
        30: "Broadband net additions",
        31: "Broadband net additions / beginning connections",
        32: "Ending broadband connections",
        33: "Average broadband connections",
        34: "Monthly broadband revenue per average connection",
        35: "Consumer broadband revenue",
        36: "Consumer Wireline non-broadband revenue",
        37: "Total Consumer Wireline revenue",
        38: "Business Wireline revenue",
        39: "Latin America segment revenue",
        40: "Other and consolidation revenue",
        41: "Consolidated revenue",
        42: "Consolidated revenue reconciliation check",
        45: "Mobility operating margin",
        46: "Mobility operating income",
        47: "Business Wireline operating margin",
        48: "Business Wireline operating income",
        49: "Consumer Wireline operating margin",
        50: "Consumer Wireline operating income",
        51: "Latin America operating margin",
        52: "Latin America operating income",
        53: "Unallocated / corporate operating income margin",
        54: "Unallocated / corporate operating income",
        55: "Consolidated EBIT",
        56: "Consolidated EBIT reconciliation check",
        59: "Cash tax rate",
        60: "Cash taxes on EBIT",
        61: "NOPAT",
        62: "Depreciation and amortization",
        63: "Network and other capital expenditures",
        64: "Change in operating working capital / investment",
        65: "Unlevered free cash flow",
        66: "Discount factor",
        67: "Present value of free cash flow",
        68: "Free cash flow identity check",
    }
    for row, label in labels.items():
        sheet.cell(row=row, column=1, value=label).font = Font(name="Arial", size=10, bold=row in (10, 16, 25, 37, 41, 55, 61, 65, 67, 68))

    for row, title in (
        (20, "Mobility service and equipment revenue build"),
        (28, "Broadband and segment revenue build"),
        (44, "Segment operating income and consolidated EBIT"),
        (58, "Unlevered cash flow forecast"),
    ):
        _section(sheet, row, title, 10)

    for index, item in enumerate(annual, start=0):
        column = chr(ord("B") + index)
        previous = chr(ord(column) - 1)
        year = int(item["year"])
        telecom = _record(item.get("telecom"))
        prior = _record(annual[index - 1].get("telecom")) if index > 0 else {}
        _set_actual(sheet, f"{column}10", telecom.get("postpaid_phone_subscribers"), "postpaid phone subscribers", year, _SUBSCRIBER_FORMAT)
        _set_actual(sheet, f"{column}16", telecom.get("wireless_subscribers"), "wireless subscribers", year, _SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}14", f"={column}16-{column}10", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _set_actual(sheet, f"{column}22", telecom.get("mobility_service_revenue"), "Mobility service revenue", year, _MONEY_FORMAT)
        _set_actual(sheet, f"{column}24", telecom.get("mobility_equipment_revenue"), "Mobility equipment revenue", year, _MONEY_FORMAT)
        _set_actual(sheet, f"{column}25", telecom.get("mobility_revenue"), "Mobility segment revenue", year, _MONEY_FORMAT)
        _write(sheet, f"{column}26", f"={column}25-SUM({column}22,{column}24)", formula=True, number_format=_MONEY_FORMAT)
        broadband_connections = _line_value(telecom.get("broadband_connections"), "broadband connections", year)
        if broadband_connections is not None:
            _write(sheet, f"{column}32", broadband_connections, number_format=_SUBSCRIBER_FORMAT)
        elif index > 0:
            raise ValueError(f"FY{year} telecom broadband connection count is missing.")
        _set_actual(sheet, f"{column}35", telecom.get("consumer_broadband_revenue"), "Consumer broadband revenue", year, _MONEY_FORMAT)
        _set_actual(sheet, f"{column}37", telecom.get("consumer_wireline_revenue"), "Consumer Wireline revenue", year, _MONEY_FORMAT)
        _write(sheet, f"{column}36", f"={column}37-{column}35", formula=True, number_format=_MONEY_FORMAT)
        _set_actual(sheet, f"{column}38", telecom.get("business_wireline_revenue"), "Business Wireline revenue", year, _MONEY_FORMAT)
        _set_actual(sheet, f"{column}39", telecom.get("latin_america_revenue"), "Latin America revenue", year, _MONEY_FORMAT)
        _set_actual(sheet, f"{column}41", item.get("revenue"), "consolidated revenue", year, _MONEY_FORMAT)
        _write(sheet, f"{column}40", f"={column}41-SUM({column}25,{column}37:{column}39)", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}42", f"={column}41-SUM({column}25,{column}37:{column}40)", formula=True, number_format=_MONEY_FORMAT)

        for row, field, denom_row, label in (
            (46, "mobility_operating_income", 25, "Mobility operating income"),
            (48, "business_wireline_operating_income", 38, "Business Wireline operating income"),
            (50, "consumer_wireline_operating_income", 37, "Consumer Wireline operating income"),
            (52, "latin_america_operating_income", 39, "Latin America operating income"),
        ):
            _set_actual(sheet, f"{column}{row}", telecom.get(field), label, year, _MONEY_FORMAT)
            _write(sheet, f"{column}{row - 1}", f'=IFERROR({column}{row}/{column}{denom_row},0)', formula=True, number_format=_PERCENT_FORMAT)
        _set_actual(sheet, f"{column}55", item.get("ebit"), "consolidated EBIT", year, _MONEY_FORMAT)
        _write(sheet, f"{column}54", f"={column}55-SUM({column}46,{column}48,{column}50,{column}52)", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}53", f'=IFERROR({column}54/{column}41,0)', formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f"{column}56", f"={column}55-SUM({column}46,{column}48,{column}50,{column}52,{column}54)", formula=True, number_format=_MONEY_FORMAT)

        _set_actual(sheet, f"{column}59", item.get("taxRate"), "effective tax rate", year, _PERCENT_FORMAT)
        _write(sheet, f"{column}60", f"={column}55*{column}59", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}61", f"={column}55-{column}60", formula=True, number_format=_MONEY_FORMAT)
        _set_actual(sheet, f"{column}62", item.get("depreciation"), "depreciation", year, _MONEY_FORMAT)
        _set_actual(sheet, f"{column}63", item.get("capex"), "CapEx", year, _MONEY_FORMAT)
        nwc_change = _line_value(item.get("nwcChange"), "working capital change", year)
        if nwc_change is not None:
            _write(sheet, f"{column}64", nwc_change, number_format=_MONEY_FORMAT)
            _write(sheet, f"{column}65", f"={column}61+{column}62-{column}63-{column}64", formula=True, number_format=_MONEY_FORMAT)
            _write(sheet, f"{column}68", f"={column}65-({column}61+{column}62-{column}63-{column}64)", formula=True, number_format=_MONEY_FORMAT)
        elif index > 0:
            raise ValueError(f"FY{year} telecom working capital investment is missing.")

        if index == 0:
            # FY2022 is the filed opening customer base used to calculate average FY2023 customers.
            continue
        _write(sheet, f"{column}5", f"={previous}10", formula=True, number_format=_SUBSCRIBER_FORMAT)
        churn_line = _record(telecom.get("postpaid_phone_churn"))
        churn_sources = churn_line.get("sources")
        has_filed_churn = (
            churn_line.get("source") in {"sec_native", "derived"}
            and isinstance(churn_line.get("value"), (int, float))
            and not isinstance(churn_line.get("value"), bool)
            and math.isfinite(float(churn_line.get("value")))
            and isinstance(churn_sources, list) and bool(churn_sources)
            and all(_record(source).get("accession") and _record(source).get("filed") for source in churn_sources)
        )
        missing_churn = payload.get("buildStatus") == "input_required" and not has_filed_churn
        if not missing_churn:
            _set_actual(sheet, f"{column}7", telecom.get("postpaid_phone_churn"), "postpaid phone monthly churn", year, _PERCENT_FORMAT)
        _set_actual(sheet, f"{column}9", telecom.get("postpaid_phone_net_additions"), "postpaid phone net additions", year, _SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}11", f"=AVERAGE({column}5,{column}10)", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}8", f"={column}11*{column}7*12", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}6", f"={column}8+{column}9", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}12", f"={previous}16-{previous}10", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}13", f'=IFERROR(({column}16-{column}10)/{column}12-1,0)', formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f"{column}15", f"={previous}16", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}17", f"=AVERAGE({column}15,{column}16)", formula=True, number_format=_SUBSCRIBER_FORMAT)
        filed_additions = _line_value(telecom.get("wireless_net_additions"), "wireless net additions", year)
        if filed_additions is None:
            raise ValueError(f"FY{year} total wireless net additions are missing.")
        _write(sheet, f"{column}18", f"={column}16-({column}15+{filed_additions})", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}21", f'=IFERROR({column}22/({column}17*12),0)', formula=True, number_format=_ARPU_FORMAT)
        _write(sheet, f"{column}23", f'=IFERROR({column}24/{column}17,0)', formula=True, number_format=_ARPU_FORMAT)
        _set_actual(sheet, f"{column}30", telecom.get("broadband_net_additions"), "broadband net additions", year, _SUBSCRIBER_FORMAT)
        prior_broadband = _line_value(prior.get("broadband_connections"), "broadband connections", int(annual[index - 1]["year"]))
        if prior_broadband is not None:
            _write(sheet, f"{column}29", f"={previous}32", formula=True, number_format=_SUBSCRIBER_FORMAT)
            _write(sheet, f"{column}31", f'=IFERROR({column}30/{column}29,0)', formula=True, number_format=_PERCENT_FORMAT)
            _write(sheet, f"{column}33", f"=AVERAGE({column}29,{column}32)", formula=True, number_format=_SUBSCRIBER_FORMAT)
            _write(sheet, f"{column}34", f'=IFERROR({column}35/({column}33*12),"")', formula=True, number_format=_ARPU_FORMAT)

    for column in "FGHIJ":
        previous = chr(ord(column) - 1)
        period = ord(column) - ord("E")
        # Postpaid phone customers: solve the average-customer churn equation without circular references.
        _write(sheet, f"{column}5", f"={previous}10", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}6", f"={column}5*$L$5", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}7", "=$L$6", formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f"{column}10", f"=({column}5+{column}6-6*{column}7*{column}5)/(1+6*{column}7)", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}11", f"=AVERAGE({column}5,{column}10)", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}8", f"={column}11*{column}7*12", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}9", f"={column}6-{column}8", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}12", f"={previous}14", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}13", "=$L$7", formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f"{column}14", f"={column}12*(1+{column}13)", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}15", f"={previous}16", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}16", f"={column}10+{column}14", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}17", f"=AVERAGE({column}15,{column}16)", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}18", f"={column}16-({column}10+{column}14)", formula=True, number_format=_SUBSCRIBER_FORMAT)

        _write(sheet, f"{column}21", f"={previous}21*(1+$L$8)", formula=True, number_format=_ARPU_FORMAT)
        _write(sheet, f"{column}22", f"={column}17*{column}21*12", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}23", f"={previous}23*(1+$L$9)", formula=True, number_format=_ARPU_FORMAT)
        _write(sheet, f"{column}24", f"={column}17*{column}23", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}25", f"=SUM({column}22,{column}24)", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}26", f"={column}25-SUM({column}22,{column}24)", formula=True, number_format=_MONEY_FORMAT)

        _write(sheet, f"{column}29", f"={previous}32", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}30", f"={column}29*$L$10", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}31", "=$L$10", formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f"{column}32", f"={column}29+{column}30", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}33", f"=AVERAGE({column}29,{column}32)", formula=True, number_format=_SUBSCRIBER_FORMAT)
        _write(sheet, f"{column}34", f"={previous}34*(1+$L$11)", formula=True, number_format=_ARPU_FORMAT)
        _write(sheet, f"{column}35", f"={column}33*{column}34*12", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}36", f"={previous}36*(1+$L$12)", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}37", f"=SUM({column}35:{column}36)", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}38", f"={previous}38*(1+$L$13)", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}39", f"={previous}39*(1+$L$14)", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}40", f"={previous}40*(1+$L$15)", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}41", f"=SUM({column}25,{column}37:{column}40)", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}42", f"={column}41-SUM({column}25,{column}37:{column}40)", formula=True, number_format=_MONEY_FORMAT)

        for margin_row, income_row, revenue_row, assumption_row in (
            (45, 46, 25, 16), (47, 48, 38, 17), (49, 50, 37, 18), (51, 52, 39, 19),
        ):
            _write(sheet, f"{column}{margin_row}", f"=$L${assumption_row}", formula=True, number_format=_PERCENT_FORMAT)
            _write(sheet, f"{column}{income_row}", f"={column}{revenue_row}*{column}{margin_row}", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}53", "=$L$20", formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f"{column}54", f"={column}41*{column}53", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}55", f"=SUM({column}46,{column}48,{column}50,{column}52,{column}54)", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}56", f"={column}55-SUM({column}46,{column}48,{column}50,{column}52,{column}54)", formula=True, number_format=_MONEY_FORMAT)

        _write(sheet, f"{column}59", "=$L$21", formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f"{column}60", f"={column}55*{column}59", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}61", f"={column}55-{column}60", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}62", f"={column}41*$L$22", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}63", f"={column}41*$L$23", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}64", f"={column}41*$L$24", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}65", f"={column}61+{column}62-{column}63-{column}64", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}66", f"=1/(1+$L$40)^{period}", formula=True, number_format="0.000x")
        _write(sheet, f"{column}67", f"={column}65*{column}66", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}68", f"={column}65-({column}61+{column}62-{column}63-{column}64)", formula=True, number_format=_MONEY_FORMAT)

    _section(sheet, 70, "Unlevered DCF and common-equity bridge", 3)
    valuation_rows = (
        (71, "Discount rate / WACC", "=$L$40", _PERCENT_FORMAT),
        (72, "Terminal free cash flow", "=J65", _MONEY_FORMAT),
        (73, "Terminal growth", "=$L$30", _PERCENT_FORMAT),
        (74, "Terminal value (Gordon growth)", "=B72*(1+B73)/(B71-B73)", _MONEY_FORMAT),
        (75, "Present value of terminal value", "=B74*J66", _MONEY_FORMAT),
        (76, "Present value of forecast free cash flow", "=SUM(F67:J67)", _MONEY_FORMAT),
        (77, "Enterprise value", "=SUM(B75:B76)", _MONEY_FORMAT),
        (78, "Add cash and cash equivalents", "=$L$34", _MONEY_FORMAT),
        (79, "Add marketable securities", "=$L$35", _MONEY_FORMAT),
        (80, "Less interest-bearing debt", "=-$L$36", _MONEY_FORMAT),
        (81, "Less noncontrolling interest", "=-$L$37", _MONEY_FORMAT),
        (82, "Less preferred equity", "=-$L$38", _MONEY_FORMAT),
        (83, "Common-equity value", "=SUM(B77:B82)", _MONEY_FORMAT),
        (84, "Diluted shares", "=$L$32", _SHARES_FORMAT),
        (85, "Implied value per diluted share", "=IFERROR(B83/B84,0)", _PRICE_FORMAT),
        (86, "Current share price", "=$L$31", _PRICE_FORMAT),
        (87, "Implied upside / (downside)", "=IFERROR(B85/B86-1,0)", _PERCENT_FORMAT),
    )
    for row, label, formula, number_format in valuation_rows:
        sheet.cell(row=row, column=1, value=label).font = Font(name="Arial", size=10, bold=row in (77, 83, 85, 87))
        _write(sheet, f"B{row}", formula, formula=True, number_format=number_format)

    _section(sheet, 89, "Per-share sensitivity — WACC and terminal growth", 7)
    sheet["B90"] = "WACC / terminal growth"
    for column, offset in zip("CDEFG", (-0.02, -0.01, 0, 0.01, 0.02)):
        _write(sheet, f"{column}90", f"=$L$30{offset:+.1%}", formula=True, number_format=_PERCENT_FORMAT)
        sheet[f"{column}90"].font = _HEADER_FONT
        sheet[f"{column}90"].fill = _HEADER_FILL
    # Keep the lowest WACC case above the highest terminal-growth case.
    for row, offset in zip(range(91, 96), (-0.01, 0, 0.01, 0.02, 0.03)):
        _write(sheet, f"B{row}", f"=$L$40{offset:+.1%}", formula=True, number_format=_PERCENT_FORMAT)
        for column in "CDEFG":
            pv_forecast = "+".join(f"{forecast_column}65/(1+$B{row})^{period}"
                                    for period, forecast_column in enumerate("FGHIJ", start=1))
            formula = (
                f'=IF(OR($B{row}<={column}$90,$B{row}<=0),"",'
                f'({pv_forecast}+($J$65*(1+{column}$90)/($B{row}-{column}$90))/(1+$B{row})^5'
                f'+$L$34+$L$35-$L$36-$L$37-$L$38)/$L$32)'
            )
            _write(sheet, f"{column}{row}", formula, formula=True, number_format=_PRICE_FORMAT)
    sheet.merge_cells("A97:G97")
    sheet["A97"] = "Sensitivity recomputes explicit cash flows and terminal value for each WACC / terminal-growth pair."
    sheet["A97"].font = _SMALL_FONT
    sheet["A97"].alignment = Alignment(wrap_text=True, vertical="top")

    for column in range(11, 14):
        sheet.cell(row=3, column=column).fill = _SECTION_FILL
        sheet.cell(row=3, column=column).font = _SECTION_FONT
    sheet["K3"] = "Editable assumptions and current market inputs"
    for column, header in ((11, "Assumption / sourced input"), (12, "Value"), (13, "Source / treatment")):
        cell = sheet.cell(row=4, column=column, value=header)
        cell.font = _HEADER_FONT
        cell.fill = _HEADER_FILL
        cell.alignment = Alignment(wrap_text=True, vertical="center")
    assumption_rows = (
        (5, "postpaidGrossAddRate", "Gross postpaid phone additions / beginning customers", _PERCENT_FORMAT, True),
        (6, "postpaidPhoneMonthlyChurn", "Monthly postpaid phone churn", _PERCENT_FORMAT, True),
        (7, "otherWirelessSubscriberGrowth", "Other wireless subscriber growth", _PERCENT_FORMAT, True),
        (8, "serviceRevenuePerSubscriberGrowth", "Monthly service revenue per average wireless subscriber growth", _PERCENT_FORMAT, True),
        (9, "equipmentRevenuePerSubscriberGrowth", "Annual equipment revenue per subscriber growth", _PERCENT_FORMAT, True),
        (10, "broadbandNetAdditionsRate", "Broadband net additions / beginning connections", _PERCENT_FORMAT, True),
        (11, "broadbandRevenuePerConnectionGrowth", "Monthly broadband revenue per connection growth", _PERCENT_FORMAT, True),
        (12, "consumerNonBroadbandRevenueGrowth", "Consumer Wireline non-broadband revenue growth", _PERCENT_FORMAT, True),
        (13, "businessWirelineRevenueGrowth", "Business Wireline revenue growth", _PERCENT_FORMAT, True),
        (14, "latinAmericaRevenueGrowth", "Latin America revenue growth", _PERCENT_FORMAT, True),
        (15, "otherRevenueGrowth", "Other and consolidation revenue growth", _PERCENT_FORMAT, True),
        (16, "mobilityOperatingMargin", "Mobility operating margin", _PERCENT_FORMAT, True),
        (17, "businessWirelineOperatingMargin", "Business Wireline operating margin", _PERCENT_FORMAT, True),
        (18, "consumerWirelineOperatingMargin", "Consumer Wireline operating margin", _PERCENT_FORMAT, True),
        (19, "latinAmericaOperatingMargin", "Latin America operating margin", _PERCENT_FORMAT, True),
        (20, "unallocatedOperatingIncomeMargin", "Unallocated / corporate EBIT margin", _PERCENT_FORMAT, True),
        (21, "taxRate", "Cash tax rate", _PERCENT_FORMAT, True),
        (22, "depreciationPctRevenue", "Depreciation and amortization / revenue", _PERCENT_FORMAT, True),
        (23, "capexPctRevenue", "Capital expenditures / revenue", _PERCENT_FORMAT, True),
        (24, "workingCapitalChangePctRevenue", "Working capital investment / revenue", _PERCENT_FORMAT, True),
        (25, "riskFreeRate", "Risk-free rate", _PERCENT_FORMAT, False),
        (26, "equityRiskPremium", "Equity risk premium", _PERCENT_FORMAT, False),
        (27, "beta", "Beta", "0.000x", False),
        (28, "costOfDebt", "Filed weighted-average cost of debt", _PERCENT_FORMAT, False),
    )
    sources = _record(assumptions.get("assumptionSources"))
    for row, field, label, number_format, analyst_editable in assumption_rows:
        sheet.cell(row=row, column=11, value=label).font = _BODY_FONT
        missing_churn_assumption = (
            payload.get("buildStatus") == "input_required"
            and field in {"postpaidGrossAddRate", "postpaidPhoneMonthlyChurn"}
            and assumptions.get(field) is None
        )
        if missing_churn_assumption:
            formula = (
                '=IF(\'Input Required\'!$B$3<>"READY","",MEDIAN(C6/C5,D6/D5,E6/E5))'
                if field == "postpaidGrossAddRate"
                else '=IF(\'Input Required\'!$B$3<>"READY","",MEDIAN(C7:E7))'
            )
            _write(sheet, f"L{row}", formula, formula=True, number_format=number_format)
        else:
            _write(sheet, f"L{row}", _finite(assumptions.get(field), field), input_cell=analyst_editable, number_format=number_format)
        _write(sheet, f"M{row}", _short_source(sources.get(field)), wrap=True)
        sheet[f"M{row}"].font = _SMALL_FONT
        sheet[f"M{row}"].alignment = Alignment(wrap_text=True, vertical="top")

    formula_inputs = (
        (29, "Equity weight", "=IFERROR(L33/(L33+L36),1)", _PERCENT_FORMAT),
        (39, "Debt weight", "=IFERROR(L36/(L33+L36),0)", _PERCENT_FORMAT),
        (40, "Weighted average cost of capital", "=(L25+L27*L26)*L29+L28*(1-L21)*L39", _PERCENT_FORMAT),
    )
    for row, label, formula, number_format in formula_inputs:
        sheet.cell(row=row, column=11, value=label).font = Font(name="Arial", size=10, bold=row == 40)
        _write(sheet, f"L{row}", formula, formula=True, number_format=number_format)
        _write(sheet, f"M{row}", "Formula from current market inputs and filed debt/capital values.", wrap=True)
        sheet[f"M{row}"].font = _SMALL_FONT
        sheet[f"M{row}"].alignment = Alignment(wrap_text=True, vertical="top")

    input_rows = (
        (30, "terminalGrowthRate", "Perpetual FCFF growth", _PERCENT_FORMAT, True),
        (31, "currentPrice", "Current share price", _PRICE_FORMAT, False),
        (32, "dilutedShares", "Filed weighted-average diluted shares", _SHARES_FORMAT, False),
        (33, "marketCapitalization", "Current market capitalization", _MONEY_FORMAT, False),
        (34, "cash", "Filed cash and cash equivalents", _MONEY_FORMAT, False),
        (35, "marketableSecurities", "Separately filed marketable securities", _MONEY_FORMAT, False),
        (36, "debt", "Filed total interest-bearing debt", _MONEY_FORMAT, False),
        (37, "nonControllingInterest", "Filed noncontrolling interest", _MONEY_FORMAT, False),
        (38, "preferredEquity", "Filed preferred equity", _MONEY_FORMAT, False),
    )
    assumption_sources = _record(assumptions.get("assumptionSources"))
    for row, field, label, number_format, analyst_editable in input_rows:
        sheet.cell(row=row, column=11, value=label).font = _BODY_FONT
        _write(sheet, f"L{row}", _finite(assumptions.get(field), field), input_cell=analyst_editable, number_format=number_format)
        _write(sheet, f"M{row}", _short_source(assumption_sources.get(field)), wrap=True)
        sheet[f"M{row}"].font = _SMALL_FONT
        sheet[f"M{row}"].alignment = Alignment(wrap_text=True, vertical="top")

    _map_review_sheet(workbook, payload, model)
    workbook.calculation.fullCalcOnLoad = True
    workbook.calculation.forceFullCalc = True
    workbook.calculation.calcMode = "auto"


def _short_source(value: Any) -> str:
    source = str(value or "Filed or live source; see Data Review.").strip()
    if source.lower().startswith("analyst input"):
        return "Analyst input; editable. See Data Review."
    return "Source and calculation basis shown in Data Review." if len(source) > 75 else source


def _map_review_sheet(workbook: Workbook, payload: dict[str, Any], model: dict[str, Any]) -> None:
    review = workbook.create_sheet("Data Review")
    review.sheet_view.showGridLines = False
    review.freeze_panes = "E6"
    for column, width in {"A": 14, "B": 13, "C": 39, "D": 23, "E": 43, "F": 25, "G": 14, "H": 24, "I": 82}.items():
        review.column_dimensions[column].width = width
    company = _record(payload.get("company"))
    ticker = str(company.get("ticker") or "").upper()
    name = str(company.get("name") or ticker)
    history = _record(model.get("history"))
    annual = history.get("annual") if isinstance(history.get("annual"), list) else []
    years = history.get("years") if isinstance(history.get("years"), list) else []
    assumptions = _record(model.get("assumptions"))
    review.merge_cells("A1:I1")
    review["A1"] = f"Data Review — {name} ({ticker})"
    review["A1"].font = Font(name="Arial", size=16, bold=True, color="FFFFFF")
    review["A1"].fill = _TITLE_FILL
    review.merge_cells("A2:I2")
    review["A2"] = "Filed telecom operating facts and derived measures are listed by fiscal year. Analyst assumptions remain separate and editable in blue on Telecom Model."
    review["A2"].font = _SMALL_FONT
    review["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    review.row_dimensions[2].height = 30
    headers = ("Status", "FY", "Model input", "Value (USD mm / customer mm / ratio)", "Source concept / label", "SEC accession", "Filed", "Unit / scale", "Method / source statement")
    for column, header in enumerate(headers, start=1):
        cell = review.cell(row=5, column=column, value=header)
        cell.font = _HEADER_FONT
        cell.fill = _HEADER_FILL
        cell.alignment = Alignment(wrap_text=True, vertical="center")

    row = 6
    for raw_item in annual:
        item = _record(raw_item)
        year = int(item.get("year") or 0)
        telecom = _record(item.get("telecom"))
        lines: list[tuple[str, Any]] = [(f"telecom.{field}", line) for field, line in telecom.items()]
        lines.extend((
            ("consolidated.revenue", item.get("revenue")),
            ("consolidated.EBIT", item.get("ebit")),
            ("consolidated.tax_rate", item.get("taxRate", item.get("tax_rate"))),
            ("consolidated.D&A", item.get("depreciation")),
            ("consolidated.CapEx", item.get("capex")),
            ("consolidated.working_capital_change", item.get("nwcChange", item.get("nwc_change"))),
            ("consolidated.cash", item.get("cash")),
            ("consolidated.marketable_securities", item.get("marketableSecurities", item.get("marketable_securities"))),
            ("consolidated.interest_bearing_debt", item.get("debt")),
            ("consolidated.noncontrolling_interest", item.get("nonControllingInterest", item.get("non_controlling_interest"))),
            ("consolidated.preferred_equity", item.get("preferredEquity", item.get("preferred_equity"))),
            ("consolidated.diluted_shares", item.get("dilutedShares", item.get("diluted_shares"))),
        ))
        for field, raw_line in lines:
            line = _record(raw_line)
            status = str(line.get("source") or "missing")
            source_records = _source_records(line)
            if source_records:
                for source in source_records:
                    is_component = bool(line.get("concept") and source.get("concept") and source.get("concept") != line.get("concept"))
                    review.cell(row=row, column=1, value=status.upper())
                    review.cell(row=row, column=2, value=year)
                    review.cell(row=row, column=3, value=f"{field} / source component" if is_component else field)
                    review.cell(row=row, column=4, value=source.get("reported_value") if is_component else line.get("value"))
                    review.cell(row=row, column=5, value=source.get("concept") or source.get("label") or line.get("concept"))
                    review.cell(row=row, column=6, value=source.get("accession"))
                    review.cell(row=row, column=7, value=source.get("filed"))
                    review.cell(row=row, column=8, value=" ".join(str(value) for value in (source.get("unit"), source.get("unit_scale")) if value))
                    review.cell(row=row, column=9, value=source.get("statement") or line.get("method"))
                    if str(source.get("unit") or "").lower() == "usd":
                        scale = str(source.get("unit_scale") or "").lower()
                        review.cell(row=row, column=4).number_format = (
                            '#,##0.0;[Red](#,##0.0);-' if is_component and scale in {"thousands", "millions", "billions"}
                            else _MONEY_FORMAT
                        )
                    elif str(source.get("unit") or "").lower() == "subscribers":
                        review.cell(row=row, column=4).number_format = _SUBSCRIBER_FORMAT
                    elif str(source.get("unit") or "").lower() == "percent":
                        review.cell(row=row, column=4).number_format = _PERCENT_FORMAT
                    review.row_dimensions[row].height = 30
                    row += 1
            else:
                review.cell(row=row, column=1, value=status.upper())
                review.cell(row=row, column=2, value=year)
                review.cell(row=row, column=3, value=field)
                review.cell(row=row, column=4, value=line.get("value"))
                review.cell(row=row, column=5, value=line.get("concept"))
                review.cell(row=row, column=9, value=line.get("method"))
                review.row_dimensions[row].height = 18
                row += 1

    row += 1
    review.merge_cells(start_row=row, start_column=1, end_row=row, end_column=9)
    review.cell(row=row, column=1, value="Analyst and live-market assumptions").font = _SECTION_FONT
    review.cell(row=row, column=1).fill = _SECTION_FILL
    assumption_sources = _record(assumptions.get("assumptionSources"))
    percentage_fields = {
        "postpaidGrossAddRate", "postpaidPhoneMonthlyChurn", "otherWirelessSubscriberGrowth",
        "serviceRevenuePerSubscriberGrowth", "equipmentRevenuePerSubscriberGrowth", "broadbandNetAdditionsRate",
        "broadbandRevenuePerConnectionGrowth", "consumerNonBroadbandRevenueGrowth", "businessWirelineRevenueGrowth",
        "latinAmericaRevenueGrowth", "otherRevenueGrowth", "mobilityOperatingMargin", "businessWirelineOperatingMargin",
        "consumerWirelineOperatingMargin", "latinAmericaOperatingMargin", "unallocatedOperatingIncomeMargin", "taxRate",
        "depreciationPctRevenue", "capexPctRevenue", "workingCapitalChangePctRevenue", "riskFreeRate", "equityRiskPremium",
        "costOfDebt", "debtWeight", "equityWeight", "wacc", "terminalGrowthRate",
    }
    for name, source in assumption_sources.items():
        row += 1
        review.cell(row=row, column=1, value="ASSUMPTION")
        review.cell(row=row, column=3, value=name)
        review.cell(row=row, column=4, value=assumptions.get(name))
        if name in percentage_fields:
            review.cell(row=row, column=4).number_format = _PERCENT_FORMAT
        elif name == "beta":
            review.cell(row=row, column=4).number_format = "0.000x"
        elif "share" in name.lower():
            review.cell(row=row, column=4).number_format = _SHARES_FORMAT
        elif name not in {"asOfDate", "baseYear", "forecastYears"}:
            review.cell(row=row, column=4).number_format = _MONEY_FORMAT
        review.cell(row=row, column=9, value=source)
        review.row_dimensions[row].height = min(64, max(18, 18 * math.ceil(len(str(source)) / 110)))

    row += 1
    review.merge_cells(start_row=row, start_column=1, end_row=row, end_column=9)
    review.cell(row=row, column=1, value="Model conventions and limits").font = _SECTION_FONT
    review.cell(row=row, column=1).fill = _SECTION_FILL
    notes = [
        f"The model uses FY{years[-1]} filed annual segment results as its forecast base and includes an opening-year customer observation for average-customer calculations.",
        "Reported Mobility service revenue is divided by average total wireless subscribers and twelve months to derive a service-revenue-per-subscriber measure; it is not presented as AT&T-reported ARPU.",
        "Postpaid phone churn is from the issuer's filed monthly measure. Gross additions are derived from filed net additions and average postpaid phone connections times twelve monthly churn periods.",
        "The historical customer roll-forward residual is shown because reported subscriber definitions exclude promotional lines and can include timing adjustments.",
        "Working-capital investment is derived from filed cash impacts for receivables, equipment installment receivables, contract assets, other current assets, and accounts payable/accrued liabilities.",
        "The model does not include FY2026 quarterly results or post-year-end acquired operations and spectrum transactions; update the driver schedule for a pro forma transaction case.",
    ]
    ui_meta = _record(payload.get("uiMeta"))
    warnings = ui_meta.get("warnings") if isinstance(ui_meta.get("warnings"), list) else []
    notes.extend(str(note) for note in warnings if isinstance(note, str))
    for note in notes:
        row += 1
        review.cell(row=row, column=1, value="INFO")
        review.merge_cells(start_row=row, start_column=3, end_row=row, end_column=9)
        review.cell(row=row, column=3, value=note)
        review.cell(row=row, column=3).alignment = Alignment(wrap_text=True, vertical="top")
        review.row_dimensions[row].height = 30
    for row_cells in review.iter_rows(min_row=6, max_row=row, min_col=1, max_col=9):
        for cell in row_cells:
            if cell.value is not None and cell.font == Font():
                cell.font = _BODY_FONT
            cell.alignment = Alignment(wrap_text=True, vertical="top")
    review.auto_filter.ref = f"A5:I{row}"


def apply_telecom_model(workbook: Workbook, payload: dict[str, Any]) -> None:
    if payload.get("valuationModel", payload.get("valuation_model")) != "telecom_subscriber_dcf":
        raise ValueError("Telecom workbook requires valuationModel=telecom_subscriber_dcf.")
    model = _record(payload.get("telecomModel", payload.get("telecom_model")))
    if not model:
        raise ValueError("Telecom workbook requires dedicated history and assumptions.")
    _map_model_sheet(workbook, payload, model)


def apply_incomplete_telecom_model(
    workbook: Workbook,
    payload: dict[str, Any],
    input_cells: dict[str, dict[str, str]],
) -> None:
    """Link annual churn inputs and withhold dependent telecom forecasts and values."""
    sheet = workbook["Telecom Model"]
    model = _record(payload.get("telecomModel"))
    history = _record(model.get("history"))
    years = history.get("years") if isinstance(history.get("years"), list) else []
    if not years:
        raise ValueError("Incomplete telecom workbook requires aligned annual history.")
    requirements = payload.get("requiredInputs")
    requirements = requirements if isinstance(requirements, list) else []
    status_ref = "'Input Required'!$B$3"
    input_years = []
    for requirement in requirements:
        if not isinstance(requirement, dict) or requirement.get("key") != "postpaid_phone_churn":
            continue
        fiscal_year = requirement.get("fiscalYear")
        if not isinstance(fiscal_year, int) or fiscal_year not in years:
            raise ValueError("Telecom postpaid-phone churn inputs must identify a history fiscal year.")
        identity = f"postpaid_phone_churn:{fiscal_year}"
        destination = input_cells.get(identity)
        if not destination or destination.get("sheet") != "Input Required":
            raise ValueError(f"Incomplete telecom workbook has no editable churn input for FY{fiscal_year}.")
        column = chr(ord("B") + years.index(fiscal_year))
        value_ref = f"'Input Required'!{destination['cell']}"
        sheet[f"{column}7"] = f'=IF(AND({status_ref}="READY",ISNUMBER({value_ref}),{value_ref}>0,{value_ref}<0.1),{value_ref},"")'
        sheet[f"{column}7"].font = _FORMULA_FONT
        sheet[f"{column}7"].fill = _FORMULA_FILL
        sheet[f"{column}7"].number_format = _PERCENT_FORMAT
        sheet[f"{column}8"] = f'=IF({status_ref}<>"READY","",{column}11*{column}7*12)'
        sheet[f"{column}8"].font = _FORMULA_FONT
        sheet[f"{column}8"].fill = _FORMULA_FILL
        sheet[f"{column}8"].number_format = _SUBSCRIBER_FORMAT
        sheet[f"{column}6"] = f'=IF({status_ref}<>"READY","",{column}8+{column}9)'
        sheet[f"{column}6"].font = _FORMULA_FONT
        sheet[f"{column}6"].fill = _FORMULA_FILL
        sheet[f"{column}6"].number_format = _SUBSCRIBER_FORMAT
        input_years.append(fiscal_year)
    if not input_years:
        raise ValueError("Incomplete telecom workbook requires at least one postpaid_phone_churn input.")

    formula_cells = [
        f"{column}{row}"
        for column in "FGHIJ"
        for row in range(5, 69)
    ]
    formula_cells.extend(f"B{row}" for row in (*range(72, 86), 87))
    formula_cells.extend(f"{column}{row}" for row in range(91, 96) for column in "CDEFG")
    for cell_ref in formula_cells:
        cell = sheet[cell_ref]
        if isinstance(cell.value, str) and cell.value.startswith("="):
            cell.value = f'=IF({status_ref}<>"READY","",{cell.value[1:]})'
