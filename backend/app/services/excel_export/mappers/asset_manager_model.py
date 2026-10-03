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
_PRICE_FORMAT = '$#,##0.00;[Red]($#,##0.00);-'
_PERCENT_FORMAT = '0.0%;[Red](0.0%);0.0%'
_SHARES_FORMAT = '#,##0.0,,;[Red](#,##0.0,,);-'


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _finite(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ValueError(f"Asset-manager workbook requires a finite value for {name}.")
    return float(value)


def _line_value(line: Any, name: str, year: int, *, allow_not_applicable: bool = False) -> float | None:
    record = _record(line)
    source = record.get("source")
    if source == "not_applicable" and allow_not_applicable:
        sources = record.get("sources")
        if not record.get("method") or not isinstance(sources, list) or not sources:
            raise ValueError(f"FY{year} {name} is marked not applicable without source lineage.")
        if any(not _record(item).get("accession") or not _record(item).get("filed") for item in sources):
            raise ValueError(f"FY{year} {name} has incomplete not-applicable source lineage.")
        return 0.0
    if source == "missing":
        return None
    if source not in {"sec_native", "derived"}:
        raise ValueError(f"FY{year} asset-manager input {name} is missing or ambiguous.")
    value = _finite(record.get("value"), name)
    sources = record.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError(f"FY{year} asset-manager input {name} has no filing provenance.")
    for source_record in sources:
        source_record = _record(source_record)
        if not source_record.get("accession") or not source_record.get("filed"):
            raise ValueError(f"FY{year} asset-manager input {name} has incomplete filing provenance.")
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


def _section(sheet: Worksheet, row: int, title: str, last_column: int = 13) -> None:
    for column in range(1, last_column + 1):
        cell = sheet.cell(row=row, column=column)
        cell.fill = _SECTION_FILL
        cell.font = _SECTION_FONT
    sheet.cell(row=row, column=1, value=title)


def _source_record(line: dict[str, Any]) -> str:
    items = []
    for source in line.get("sources", []) if isinstance(line.get("sources"), list) else []:
        source = _record(source)
        unit = source.get("unit_scale") or source.get("unit") or "unit unavailable"
        items.append(
            f"{source.get('concept') or line.get('concept') or 'derived SEC line'}; "
            f"accession {source.get('accession') or 'unresolved'}; filed {source.get('filed') or 'unresolved'}; "
            f"{source.get('fiscal_period') or 'period unresolved'}; {unit}"
        )
    return "; ".join(items)


def _short_assumption_source(source: Any) -> str:
    text = str(source or "Filed source; see Data Review.").strip()
    if text.lower().startswith("analyst input"):
        return "Analyst input; editable. See Data Review."
    if text.startswith("Three-year") or text.startswith("Median of"):
        return "Derived from the latest three filed years; see Data Review."
    if text.startswith("CAPM cost") or text.startswith("FY") or text.startswith("No interest-bearing"):
        return "Filed / live source and method shown in Data Review."
    return text if len(text) <= 78 else "Source and calculation basis shown in Data Review."


def _history_rows(asset_manager_model: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
    history = _record(asset_manager_model.get("history"))
    annual = history.get("annual")
    years = history.get("years")
    if not isinstance(annual, list) or len(annual) != 3 or not isinstance(years, list) or len(years) != 3:
        raise ValueError("Asset-manager workbook requires exactly three filed annual periods.")
    rows = [_record(item) for item in annual]
    if [row.get("year") for row in rows] != years:
        raise ValueError("Asset-manager history fiscal years do not align.")
    for index, year in enumerate(years):
        if isinstance(year, bool) or not isinstance(year, int) or (index > 0 and year != years[index - 1] + 1):
            raise ValueError("Asset-manager workbook requires three consecutive fiscal years.")
    return rows, years[-1]


def _validate_assumptions(assumptions: dict[str, Any]) -> None:
    if _finite(assumptions.get("forecastYears"), "forecastYears") != 5:
        raise ValueError("Asset-manager workbook requires a five-year forecast.")
    sources = _record(assumptions.get("assumptionSources"))
    if not sources or any(not isinstance(source, str) or not source.strip() for source in sources.values()):
        raise ValueError("Asset-manager workbook requires a source or explicit analyst-input disclosure for every assumption.")
    wacc = _finite(assumptions.get("wacc"), "wacc")
    growth = _finite(assumptions.get("terminalGrowthRate"), "terminalGrowthRate")
    if wacc <= 0 or growth < 0 or growth >= wacc:
        raise ValueError("Asset-manager workbook requires terminal growth below WACC.")
    if not isinstance(assumptions.get("asOfDate"), str) or len(assumptions["asOfDate"]) != 10:
        raise ValueError("Asset-manager workbook requires a dated market context.")


def _sheet_layout(sheet: Worksheet) -> None:
    sheet.sheet_view.showGridLines = False
    sheet.freeze_panes = "E5"
    sheet.column_dimensions["A"].width = 51
    for column in "BCDEFGHI":
        sheet.column_dimensions[column].width = 15
    sheet.column_dimensions["J"].width = 3
    sheet.column_dimensions["K"].width = 36
    sheet.column_dimensions["L"].width = 16
    sheet.column_dimensions["M"].width = 65
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.page_setup.orientation = "landscape"


def _map_model_sheet(workbook: Workbook, payload: dict[str, Any], model: dict[str, Any]) -> None:
    for existing in list(workbook.worksheets):
        workbook.remove(existing)
    sheet = workbook.create_sheet("Asset Manager Model")
    _sheet_layout(sheet)

    company = _record(payload.get("company"))
    ticker = str(company.get("ticker") or "").strip().upper()
    name = str(company.get("name") or ticker or "Company").strip()
    currency = str(company.get("currency") or "USD")
    annual, base_year = _history_rows(model)
    assumptions = _record(model.get("assumptions"))
    _validate_assumptions(assumptions)
    manager_lines = ("beginning_aum", "net_flows", "realizations", "acquisitions", "market_change", "fx_change", "scope_change")

    sheet.merge_cells("A1:M1")
    sheet["A1"] = f"{name} ({ticker}) — AUM and Fee-Driven FCFF Valuation"
    sheet["A1"].font = Font(name="Arial", size=16, bold=True, color="FFFFFF")
    sheet["A1"].fill = _TITLE_FILL
    sheet["A1"].alignment = Alignment(vertical="center")
    sheet.row_dimensions[1].height = 28
    sheet.merge_cells("A2:M2")
    sheet["A2"] = (
        f"Amounts are {currency} actuals, displayed in millions except per-share data, percentages, and shares. "
        "Blue cells are editable live-market inputs or analyst assumptions; historical filing facts are black; formulas are green."
    )
    sheet["A2"].font = _SMALL_FONT
    sheet["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    sheet.row_dimensions[2].height = 30

    _section(sheet, 3, "AUM roll-forward — filed actuals and formula-driven forecast", 9)
    headers = ["Schedule / fiscal year", *(f"FY{row['year']}A" for row in annual), *(f"FY{base_year + index}E" for index in range(1, 6))]
    for column, header in enumerate(headers, start=1):
        cell = sheet.cell(row=4, column=column, value=header)
        cell.font = _HEADER_FONT
        cell.fill = _HEADER_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    aum_labels = {
        5: "Beginning AUM",
        6: "Market change",
        7: "Net flows",
        8: "Realizations / distributions",
        9: "Acquisitions",
        10: "Foreign-exchange change",
        11: "Other / scope change",
        12: "Ending AUM",
        13: "Average AUM",
        14: "AUM roll-forward check (must equal zero)",
    }
    for row, label in aum_labels.items():
        sheet.cell(row=row, column=1, value=label).font = Font(name="Arial", size=10, bold=row in (12, 14))

    for column_index, item in enumerate(annual, start=2):
        column = chr(64 + column_index)
        year = int(item["year"])
        manager = _record(item.get("assetManager", item.get("asset_manager")))
        _write(sheet, f"{column}5", _line_value(manager.get("beginning_aum"), "beginning AUM", year), number_format=_MONEY_FORMAT)
        for row, field, name_label in (
            (6, "market_change", "market change"),
            (7, "net_flows", "net flows"),
            (8, "realizations", "realizations"),
            (9, "acquisitions", "acquisitions"),
            (10, "fx_change", "FX change"),
        ):
            value = _line_value(manager.get(field), name_label, year)
            if value is not None:
                _write(sheet, f"{column}{row}", value, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}12", _line_value(manager.get("aum"), "ending AUM", year), number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}11", f"={column}12-SUM({column}5:{column}10)", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}13", f"=AVERAGE({column}5,{column}12)", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}14", f"={column}12-SUM({column}5:{column}11)", formula=True, number_format=_MONEY_FORMAT)

    driver_input_rows = {
        "marketReturnRate": 5,
        "netFlowRate": 6,
        "realizationsRate": 7,
        "acquisitionRate": 8,
        "fxChangeRate": 9,
        "scopeChangeRate": 10,
    }
    for forecast_index, column in enumerate("EFGHI", start=1):
        previous = chr(ord(column) - 1)
        _write(sheet, f"{column}5", f"={previous}12", formula=True, number_format=_MONEY_FORMAT)
        for row, assumption_name in ((6, "marketReturnRate"), (7, "netFlowRate"), (8, "realizationsRate"), (9, "acquisitionRate"), (10, "fxChangeRate"), (11, "scopeChangeRate")):
            input_row = driver_input_rows[assumption_name]
            _write(sheet, f"{column}{row}", f"={column}5*$L${input_row}", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}12", f"=SUM({column}5:{column}11)", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}13", f"=AVERAGE({column}5,{column}12)", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}14", f"={column}12-SUM({column}5:{column}11)", formula=True, number_format=_MONEY_FORMAT)

    _section(sheet, 16, "Revenue build — fee lines remain separate and reconcile to filed revenue", 9)
    revenue_labels = {
        17: "Base advisory fee yield / average AUM",
        18: "Base advisory fees",
        19: "Performance fee yield / average AUM",
        20: "Performance fees",
        21: "Capital allocation-based income",
        22: "Securities lending revenue",
        23: "Technology and subscription revenue",
        24: "Distribution and servicing fees",
        25: "Administrative and other fees",
        26: "Other advisory revenue",
        27: "Unmapped consolidated revenue",
        28: "Consolidated revenue",
        29: "Calculated fee and other revenue build",
        30: "Revenue reconciliation check (must equal zero)",
    }
    for row, label in revenue_labels.items():
        sheet.cell(row=row, column=1, value=label).font = Font(name="Arial", size=10, bold=row in (28, 29, 30))

    revenue_actual_fields = {
        18: "base_fees",
        20: "performance_fees",
        21: "capital_allocation_income",
        22: "securities_lending_revenue",
        23: "technology_revenue",
        24: "distribution_revenue",
        25: "administrative_other_revenue",
        26: "other_revenue",
    }
    for column_index, item in enumerate(annual, start=2):
        column = chr(64 + column_index)
        year = int(item["year"])
        manager = _record(item.get("assetManager", item.get("asset_manager")))
        for row, field in revenue_actual_fields.items():
            value = _line_value(manager.get(field), field, year)
            if value is not None:
                _write(sheet, f"{column}{row}", value, number_format=_MONEY_FORMAT)
        base_fee_yield = _record(manager.get("base_fee_yield"))
        base_fee_sources = base_fee_yield.get("sources")
        has_filed_base_fee_yield = (
            base_fee_yield.get("source") in {"sec_native", "derived"}
            and isinstance(base_fee_yield.get("value"), (int, float))
            and not isinstance(base_fee_yield.get("value"), bool)
            and math.isfinite(float(base_fee_yield.get("value")))
            and isinstance(base_fee_sources, list) and bool(base_fee_sources)
            and all(_record(source).get("accession") and _record(source).get("filed") for source in base_fee_sources)
        )
        missing_base_fee_yield = payload.get("buildStatus") == "input_required" and not has_filed_base_fee_yield
        if not missing_base_fee_yield:
            _write(sheet, f"{column}17", f'=IFERROR({column}18/{column}13,"")', formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f"{column}19", f'=IFERROR({column}20/{column}13,"")', formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f"{column}28", _line_value(item.get("revenue"), "consolidated revenue", year), number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}27", f"={column}28-SUM({column}18,{column}20:{column}26)", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}29", f"=SUM({column}18,{column}20:{column}27)", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}30", f"={column}29-{column}28", formula=True, number_format=_MONEY_FORMAT)

    fee_amount_rows = {
        18: (17, 11),
        20: (19, 12),
        21: (None, 13),
        22: (None, 14),
        24: (None, 17),
    }
    growth_rows = {25: 18, 26: 19, 27: 20}
    for column in "EFGHI":
        previous = chr(ord(column) - 1)
        _write(sheet, f"{column}17", "=$L$11", formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f"{column}18", f"={column}13*{column}17", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}19", "=$L$12", formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f"{column}20", f"={column}13*{column}19", formula=True, number_format=_MONEY_FORMAT)
        for row, (_yield_row, assumption_row) in fee_amount_rows.items():
            if row in {18, 20}:
                continue
            _write(sheet, f"{column}{row}", f'=IF($L${assumption_row}=0,"",{column}13*$L${assumption_row})', formula=True, number_format=_MONEY_FORMAT)
        technology_base = "=$L$16" if column == "E" else f"={previous}23"
        _write(sheet, f"{column}23", f"={technology_base[1:]}*(1+$L$15)", formula=True, number_format=_MONEY_FORMAT)
        for row, assumption_row in growth_rows.items():
            _write(sheet, f"{column}{row}", f'=IF({previous}{row}="","",{previous}{row}*(1+$L${assumption_row}))', formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}28", f"={column}29", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}29", f"=SUM({column}18,{column}20:{column}27)", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}30", f"={column}29-{column}28", formula=True, number_format=_MONEY_FORMAT)

    _section(sheet, 32, "Operating forecast and unlevered free cash flow", 9)
    operating_labels = {
        33: "Consolidated revenue",
        34: "Operating margin",
        35: "EBIT",
        36: "Cash tax rate",
        37: "Taxes on EBIT",
        38: "NOPAT",
        39: "Depreciation and amortization",
        40: "Acquisition-related amortization",
        41: "Total non-cash D&A add-back",
        42: "Capital expenditures",
        43: "Change in operating working capital / other operating assets and liabilities",
        44: "Unlevered free cash flow",
        45: "Discount factor",
        46: "Present value of FCFF",
        47: "FCFF identity check (must equal zero)",
    }
    for row, label in operating_labels.items():
        sheet.cell(row=row, column=1, value=label).font = Font(name="Arial", size=10, bold=row in (35, 38, 44, 46, 47))

    for column_index, item in enumerate(annual, start=2):
        column = chr(64 + column_index)
        year = int(item["year"])
        manager = _record(item.get("assetManager", item.get("asset_manager")))
        ebit_value = _line_value(item.get("ebit"), "EBIT", year)
        tax_value = _line_value(item.get("taxRate"), "tax rate", year)
        d_and_a = _line_value(manager.get("depreciation"), "depreciation and amortization", year)
        acquisition_amortization = _line_value(manager.get("acquisition_amortization"), "acquisition amortization", year)
        capex = _line_value(item.get("capex"), "CapEx", year)
        working_capital_change = _line_value(manager.get("working_capital_change"), "working-capital change", year)
        _write(sheet, f"{column}33", f"={column}28", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}34", f'=IFERROR({column}35/{column}33,"")', formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f"{column}35", ebit_value, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}36", tax_value, number_format=_PERCENT_FORMAT)
        _write(sheet, f"{column}37", f"={column}35*{column}36", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}38", f"={column}35-{column}37", formula=True, number_format=_MONEY_FORMAT)
        if d_and_a is not None:
            _write(sheet, f"{column}39", d_and_a, number_format=_MONEY_FORMAT)
        if acquisition_amortization is not None:
            _write(sheet, f"{column}40", acquisition_amortization, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}41", f"=SUM({column}39:{column}40)", formula=True, number_format=_MONEY_FORMAT)
        if capex is not None:
            _write(sheet, f"{column}42", abs(capex), number_format=_MONEY_FORMAT)
        if working_capital_change is not None:
            _write(sheet, f"{column}43", working_capital_change, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}44", f"={column}38+{column}41-{column}42-{column}43", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}47", f"={column}44-({column}38+{column}41-{column}42-{column}43)", formula=True, number_format=_MONEY_FORMAT)

    for column in "EFGHI":
        forecast_period = ord(column) - ord("E") + 1
        previous = chr(ord(column) - 1)
        _write(sheet, f"{column}33", f"={column}28", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}34", "=$L$21", formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f"{column}35", f"={column}33*{column}34", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}36", "=$L$22", formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f"{column}37", f"={column}35*{column}36", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}38", f"={column}35-{column}37", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}39", f"={column}33*$L$23", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}40", f"={column}33*$L$24", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}41", f"=SUM({column}39:{column}40)", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}42", f"={column}33*$L$25", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}43", f"={column}33*$L$26", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}44", f"={column}38+{column}41-{column}42-{column}43", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}45", f"=1/(1+$L$34)^{forecast_period}", formula=True, number_format="0.000x")
        _write(sheet, f"{column}46", f"={column}44*{column}45", formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f"{column}47", f"={column}44-({column}38+{column}41-{column}42-{column}43)", formula=True, number_format=_MONEY_FORMAT)

    _section(sheet, 49, "Unlevered DCF and common-equity bridge", 3)
    valuation_rows = (
        (50, "Discount rate / WACC", "=$L$34", _PERCENT_FORMAT),
        (51, "Terminal FCFF", "=I44", _MONEY_FORMAT),
        (52, "Terminal growth", "=$L$35", _PERCENT_FORMAT),
        (53, "Terminal value (Gordon growth)", "=B51*(1+B52)/(B50-B52)", _MONEY_FORMAT),
        (54, "Present value of terminal value", "=B53*I45", _MONEY_FORMAT),
        (55, "Present value of forecast FCFF", "=SUM(E46:I46)", _MONEY_FORMAT),
        (56, "Enterprise value", "=SUM(B54:B55)", _MONEY_FORMAT),
        (57, "Add cash and cash equivalents", "=$L$39", _MONEY_FORMAT),
        (58, "Add separately reported marketable securities", "=$L$40", _MONEY_FORMAT),
        (59, "Less interest-bearing debt", "=-$L$41", _MONEY_FORMAT),
        (60, "Less noncontrolling interest", "=-$L$42", _MONEY_FORMAT),
        (61, "Less preferred equity", "=-$L$43", _MONEY_FORMAT),
        (62, "Common-equity value", "=SUM(B56:B61)", _MONEY_FORMAT),
        (63, "Implied value per diluted share", "=IFERROR(B62/$L$37,0)", _PRICE_FORMAT),
        (64, "Current share price", "=$L$36", _PRICE_FORMAT),
        (65, "Implied upside / (downside)", "=IFERROR(B63/B64-1,0)", _PERCENT_FORMAT),
    )
    for row, label, formula, number_format in valuation_rows:
        sheet.cell(row=row, column=1, value=label).font = Font(name="Arial", size=10, bold=row in (56, 62, 63, 65))
        _write(sheet, f"B{row}", formula, formula=True, number_format=number_format)
    sheet.merge_cells("A67:M67")
    sheet["A67"] = "Lease treatment: filed operating lease expense remains in EBIT and projected operating expenses; operating lease liabilities are excluded from the bridge to avoid double counting."
    sheet["A67"].font = _SMALL_FONT
    sheet["A67"].alignment = Alignment(wrap_text=True, vertical="top")
    sheet.row_dimensions[67].height = 26

    _section(sheet, 69, "Per-share sensitivity — WACC and terminal growth", 7)
    sheet["B70"] = "WACC / terminal growth"
    for column, offset in zip("CDEFG", (-0.02, -0.01, 0, 0.01, 0.02)):
        _write(sheet, f"{column}70", f"=$L$35{offset:+.1%}", formula=True, number_format=_PERCENT_FORMAT)
        sheet[f"{column}70"].font = _HEADER_FONT
        sheet[f"{column}70"].fill = _HEADER_FILL
    for row, offset in zip(range(71, 76), (-0.02, -0.01, 0, 0.01, 0.02)):
        _write(sheet, f"B{row}", f"=$L$34{offset:+.1%}", formula=True, number_format=_PERCENT_FORMAT)
        for column in "CDEFG":
            pv_forecast = "+".join(
                f"{forecast_column}44/(1+$B{row})^{period}"
                for period, forecast_column in enumerate("EFGHI", start=1)
            )
            formula = (
                f'=IF(OR($B{row}<={column}$70,$B{row}<=0),"",'
                f'({pv_forecast}+($I$44*(1+{column}$70)/($B{row}-{column}$70))/(1+$B{row})^5'
                f'+$L$39+$L$40-$L$41-$L$42-$L$43)/$L$37)'
            )
            _write(sheet, f"{column}{row}", formula, formula=True, number_format=_PRICE_FORMAT)
    sheet.merge_cells("A77:G77")
    sheet["A77"] = "Sensitivity recalculates explicit FCFF and terminal value at each WACC / terminal-growth pair; it is not a probability-weighted case."
    sheet["A77"].font = _SMALL_FONT
    sheet["A77"].alignment = Alignment(wrap_text=True, vertical="top")

    for column in range(11, 14):
        cell = sheet.cell(row=3, column=column)
        cell.fill = _SECTION_FILL
        cell.font = _SECTION_FONT
    sheet["K3"] = "Editable assumptions and current market / bridge inputs"
    for column, header in ((11, "Assumption / sourced input"), (12, "Value"), (13, "Source / treatment")):
        cell = sheet.cell(row=4, column=column, value=header)
        cell.font = _HEADER_FONT
        cell.fill = _HEADER_FILL
        cell.alignment = Alignment(wrap_text=True, vertical="center")

    assumption_rows = (
        (5, "marketReturnRate", "AUM market return", _PERCENT_FORMAT, True),
        (6, "netFlowRate", "Net-flow rate / beginning AUM", _PERCENT_FORMAT, True),
        (7, "realizationsRate", "Realizations / beginning AUM", _PERCENT_FORMAT, True),
        (8, "acquisitionRate", "Acquisitions / beginning AUM", _PERCENT_FORMAT, True),
        (9, "fxChangeRate", "FX change / beginning AUM", _PERCENT_FORMAT, True),
        (10, "scopeChangeRate", "Other scope change / beginning AUM", _PERCENT_FORMAT, True),
        (11, "baseFeeYield", "Base advisory-fee yield / average AUM", _PERCENT_FORMAT, True),
        (12, "performanceFeeYield", "Performance-fee yield / average AUM", _PERCENT_FORMAT, True),
        (13, "capitalAllocationYield", "Capital allocation-income yield / AUM", _PERCENT_FORMAT, True),
        (14, "securitiesLendingYield", "Securities-lending yield / AUM", _PERCENT_FORMAT, True),
        (15, "technologyRevenueGrowth", "Technology / subscription revenue growth", _PERCENT_FORMAT, True),
        (16, "technologyRevenueBase", "Technology revenue base", _MONEY_FORMAT, True),
        (17, "distributionFeeYield", "Distribution fee yield / average AUM", _PERCENT_FORMAT, True),
        (18, "administrativeOtherRevenueGrowth", "Administrative and other revenue growth", _PERCENT_FORMAT, True),
        (19, "otherRevenueGrowth", "Other advisory revenue growth", _PERCENT_FORMAT, True),
        (20, "unmappedRevenueGrowth", "Unmapped revenue growth", _PERCENT_FORMAT, True),
        (21, "operatingMargin", "Operating margin", _PERCENT_FORMAT, True),
        (22, "taxRate", "Cash tax rate", _PERCENT_FORMAT, True),
        (23, "depreciationPctRevenue", "Depreciation / revenue", _PERCENT_FORMAT, True),
        (24, "acquisitionAmortizationPctRevenue", "Acquisition amortization / revenue", _PERCENT_FORMAT, True),
        (25, "capexPctRevenue", "CapEx / revenue", _PERCENT_FORMAT, True),
        (26, "workingCapitalChangePctRevenue", "Working capital change / revenue", _PERCENT_FORMAT, True),
        (27, "riskFreeRate", "Risk-free rate", _PERCENT_FORMAT, False),
        (28, "equityRiskPremium", "Equity risk premium", _PERCENT_FORMAT, False),
        (29, "beta", "Beta", "0.000x", False),
        (30, "costOfDebt", "Cost of debt", _PERCENT_FORMAT, False),
    )
    assumption_sources = _record(assumptions.get("assumptionSources"))
    for row, field, label, number_format, analyst_editable in assumption_rows:
        sheet.cell(row=row, column=11, value=label).font = _BODY_FONT
        missing_base_fee_yield = (
            payload.get("buildStatus") == "input_required"
            and field == "baseFeeYield"
            and assumptions.get(field) is None
        )
        if missing_base_fee_yield:
            _write(sheet, "L11", '=IF(\'Input Required\'!$B$3<>"READY","",AVERAGE(B17:D17))', formula=True, number_format=number_format)
        else:
            _write(sheet, f"L{row}", _finite(assumptions.get(field), field), input_cell=analyst_editable, number_format=number_format)
        _write(sheet, f"M{row}", _short_assumption_source(assumption_sources.get(field)), wrap=True)
        sheet.cell(row=row, column=13).font = _SMALL_FONT
        sheet.cell(row=row, column=13).alignment = Alignment(wrap_text=True, vertical="top")

    formula_inputs = (
        (31, "Cost of equity (CAPM)", "=L27+L29*L28", _PERCENT_FORMAT),
        (32, "Equity weight", "=IFERROR(L38/(L38+L41),1)", _PERCENT_FORMAT),
        (33, "Debt weight", "=IFERROR(L41/(L38+L41),0)", _PERCENT_FORMAT),
        (34, "Weighted average cost of capital", "=L31*L32+L30*(1-L22)*L33", _PERCENT_FORMAT),
    )
    for row, label, formula, number_format in formula_inputs:
        sheet.cell(row=row, column=11, value=label).font = Font(name="Arial", size=10, bold=row in (34,))
        _write(sheet, f"L{row}", formula, formula=True, number_format=number_format)
        _write(sheet, f"M{row}", "Formula from live market inputs and filed/current capital values.", wrap=True)
        sheet.cell(row=row, column=13).font = _SMALL_FONT
        sheet.cell(row=row, column=13).alignment = Alignment(wrap_text=True, vertical="top")

    input_rows = (
        (35, "terminalGrowthRate", "Perpetual FCFF growth", _PERCENT_FORMAT, True),
        (36, "currentPrice", "Current share price", _PRICE_FORMAT, False),
        (37, "dilutedShares", "Filed weighted-average diluted shares", _SHARES_FORMAT, False),
        (38, "marketCapitalization", "Current market capitalization", _MONEY_FORMAT, False),
        (39, "cash", "Filed cash and equivalents", _MONEY_FORMAT, False),
        (40, "marketableSecurities", "Filed marketable securities", _MONEY_FORMAT, False),
        (41, "debt", "Filed interest-bearing debt", _MONEY_FORMAT, False),
        (42, "nonControllingInterest", "Filed noncontrolling interest", _MONEY_FORMAT, False),
        (43, "preferredEquity", "Filed preferred equity", _MONEY_FORMAT, False),
    )
    for row, field, label, number_format, analyst_editable in input_rows:
        sheet.cell(row=row, column=11, value=label).font = _BODY_FONT
        _write(sheet, f"L{row}", _finite(assumptions.get(field), field), input_cell=analyst_editable, number_format=number_format)
        source = assumption_sources.get(field)
        if not source:
            if field == "terminalGrowthRate":
                source = assumption_sources.get("terminalGrowthRate")
            else:
                source = f"Current market or latest FY{base_year} filed source; see Data Review source register."
        _write(sheet, f"M{row}", _short_assumption_source(source), wrap=True)
        sheet.cell(row=row, column=13).font = _SMALL_FONT
        sheet.cell(row=row, column=13).alignment = Alignment(wrap_text=True, vertical="top")

    _map_review_sheet(workbook, payload, model)
    workbook.calculation.fullCalcOnLoad = True
    workbook.calculation.forceFullCalc = True
    workbook.calculation.calcMode = "auto"


def _map_review_sheet(workbook: Workbook, payload: dict[str, Any], model: dict[str, Any]) -> None:
    review = workbook.create_sheet("Data Review")
    review.sheet_view.showGridLines = False
    review.freeze_panes = "A6"
    review.column_dimensions["A"].width = 14
    review.column_dimensions["B"].width = 13
    review.column_dimensions["C"].width = 34
    review.column_dimensions["D"].width = 22
    review.column_dimensions["E"].width = 43
    review.column_dimensions["F"].width = 25
    review.column_dimensions["G"].width = 14
    review.column_dimensions["H"].width = 22
    review.column_dimensions["I"].width = 64

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
    review["A2"] = (
        "SEC actuals and derived source mappings are listed by fiscal year. Analyst assumptions are separate below. "
        "Blank source lines remain blank in history; assumptions are editable in blue on the Asset Manager Model sheet."
    )
    review["A2"].font = _SMALL_FONT
    review["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    review.row_dimensions[2].height = 30
    for column, header in enumerate(("Status", "FY", "Model input", "Value (USD actual / ratio)", "Source concept / label", "SEC accession", "Filed", "Unit / scale", "Mapping method / source statement"), start=1):
        cell = review.cell(row=5, column=column, value=header)
        cell.font = _HEADER_FONT
        cell.fill = _HEADER_FILL
        cell.alignment = Alignment(wrap_text=True, vertical="center")

    row = 6
    for item in annual:
        item = _record(item)
        year = int(item.get("year") or 0)
        manager = _record(item.get("assetManager", item.get("asset_manager")))
        lines = [(f"asset_manager.{field}", line) for field, line in manager.items()]
        lines.extend((
            ("revenue", item.get("revenue")),
            ("EBIT", item.get("ebit")),
            ("interest_expense", item.get("interestExpense", item.get("interest_expense"))),
            ("tax_rate", item.get("taxRate", item.get("tax_rate"))),
            ("CapEx", item.get("capex")),
            ("cash", item.get("cash")),
            ("marketable_securities", item.get("marketableSecurities", item.get("marketable_securities"))),
            ("debt", item.get("debt")),
            ("working_capital cash movement", manager.get("working_capital_change")),
            ("depreciation and amortization", manager.get("depreciation")),
            ("acquisition amortization", manager.get("acquisition_amortization")),
            ("noncontrolling interest", item.get("nonControllingInterest", item.get("non_controlling_interest"))),
            ("preferred equity", item.get("preferredEquity", item.get("preferred_equity"))),
            ("diluted shares", item.get("dilutedShares", item.get("diluted_shares"))),
        ))
        for field, raw_line in lines:
            line = _record(raw_line)
            source_status = str(line.get("source") or "missing")
            sources = line.get("sources") if isinstance(line.get("sources"), list) else []
            if sources:
                for source_record in sources:
                    source_record = _record(source_record)
                    review.cell(row=row, column=1, value=source_status.upper())
                    review.cell(row=row, column=2, value=year)
                    review.cell(row=row, column=3, value=field)
                    review.cell(row=row, column=4, value=line.get("value"))
                    review.cell(row=row, column=5, value=source_record.get("concept") or source_record.get("label") or line.get("concept"))
                    review.cell(row=row, column=6, value=source_record.get("accession"))
                    review.cell(row=row, column=7, value=source_record.get("filed"))
                    review.cell(row=row, column=8, value=" ".join(str(value) for value in (source_record.get("unit"), source_record.get("unit_scale")) if value))
                    review.cell(row=row, column=9, value=source_record.get("statement") or line.get("method"))
                    max_length = max(len(str(review.cell(row=row, column=column).value or "")) for column in (3, 5, 9))
                    review.row_dimensions[row].height = min(48, max(16, 16 * math.ceil(max_length / 110)))
                    row += 1
            else:
                review.cell(row=row, column=1, value=source_status.upper())
                review.cell(row=row, column=2, value=year)
                review.cell(row=row, column=3, value=field)
                review.cell(row=row, column=4, value=line.get("value"))
                review.cell(row=row, column=5, value=line.get("concept"))
                review.cell(row=row, column=9, value=line.get("method"))
                max_length = max(len(str(review.cell(row=row, column=column).value or "")) for column in (3, 5, 9))
                review.row_dimensions[row].height = min(48, max(16, 16 * math.ceil(max_length / 110)))
                row += 1

    row += 1
    review.merge_cells(start_row=row, start_column=1, end_row=row, end_column=9)
    review.cell(row=row, column=1, value="Analyst and live-market assumptions").font = _SECTION_FONT
    review.cell(row=row, column=1).fill = _SECTION_FILL
    assumption_sources = _record(assumptions.get("assumptionSources"))
    for name, source in assumption_sources.items():
        row += 1
        review.cell(row=row, column=1, value="ASSUMPTION")
        review.cell(row=row, column=3, value=name)
        review.cell(row=row, column=4, value=assumptions.get(name))
        review.cell(row=row, column=9, value=source)
        review.row_dimensions[row].height = min(72, max(18, 18 * math.ceil(len(str(source)) / 105)))

    row += 1
    review.merge_cells(start_row=row, start_column=1, end_row=row, end_column=9)
    review.cell(row=row, column=1, value="Model conventions and limits").font = _SECTION_FONT
    review.cell(row=row, column=1).fill = _SECTION_FILL
    model_notes = [
        f"The explicit forecast starts from FY{years[-1]} filed annual operating results and year-end AUM.",
        "Filed 2026 quarterly AUM and fee changes are not incorporated in this annual-history route.",
        "Market appreciation, net flows, realizations, acquisitions, FX, and scope changes are separate AUM drivers; any undissected history is a sourced rollforward residual.",
        "Revenue components are separate when reported. Unmapped revenue is calculated as consolidated revenue less separately mapped filed fee components.",
        "Operating lease expense remains in EBIT and operating expenses; lease liabilities are excluded from the debt bridge to avoid double counting.",
        "The terminal method is Gordon growth; the editable terminal-growth assumption must remain below WACC.",
    ]
    ui_meta = _record(payload.get("uiMeta"))
    warnings = ui_meta.get("warnings") if isinstance(ui_meta.get("warnings"), list) else []
    model_notes.extend(str(note) for note in warnings if isinstance(note, str))
    for note in model_notes:
        row += 1
        review.cell(row=row, column=1, value="INFO")
        review.merge_cells(start_row=row, start_column=3, end_row=row, end_column=9)
        review.cell(row=row, column=3, value=note)
        review.cell(row=row, column=3).alignment = Alignment(wrap_text=True, vertical="top")
        review.row_dimensions[row].height = 28

    for row_cells in review.iter_rows(min_row=6, max_row=row, min_col=1, max_col=9):
        for cell in row_cells:
            if cell.value is not None and cell.font == Font():
                cell.font = _BODY_FONT
            if cell.column == 4 and isinstance(cell.value, (int, float)) and not isinstance(cell.value, bool):
                if cell.value == 0 or abs(cell.value) >= 0.005:
                    cell.number_format = "#,##0.00"
            cell.alignment = Alignment(wrap_text=True, vertical="top")
    review.auto_filter.ref = f"A5:I{row}"


def apply_asset_manager_model(workbook: Workbook, payload: dict[str, Any]) -> None:
    if payload.get("valuationModel", payload.get("valuation_model")) != "asset_manager_aum_dcf":
        raise ValueError("Asset-manager workbook requires valuationModel=asset_manager_aum_dcf.")
    model = _record(payload.get("assetManagerModel", payload.get("asset_manager_model")))
    if not model:
        raise ValueError("Asset-manager workbook requires dedicated history and assumptions.")
    _map_model_sheet(workbook, payload, model)


def apply_incomplete_asset_manager_model(
    workbook: Workbook,
    payload: dict[str, Any],
    input_cells: dict[str, dict[str, str]],
) -> None:
    """Link missing annual fee yields into the historical schedule and gate dependent outputs."""
    sheet = workbook["Asset Manager Model"]
    requirements = payload.get("requiredInputs")
    requirements = requirements if isinstance(requirements, list) else []
    model = _record(payload.get("assetManagerModel"))
    history = _record(model.get("history"))
    years = history.get("years") if isinstance(history.get("years"), list) else []
    if not years:
        raise ValueError("Incomplete asset-manager workbook requires aligned annual periods.")
    status_ref = "'Input Required'!$B$3"
    for requirement in requirements:
        if not isinstance(requirement, dict) or requirement.get("key") != "base_fee_yield":
            continue
        fiscal_year = requirement.get("fiscalYear")
        if not isinstance(fiscal_year, int) or fiscal_year not in years:
            raise ValueError("Asset-manager base_fee_yield input must identify one history fiscal year.")
        identity = f"base_fee_yield:{fiscal_year}"
        destination = input_cells.get(identity)
        if not destination or destination.get("sheet") != "Input Required":
            raise ValueError(f"Incomplete asset-manager workbook has no editable base fee yield for FY{fiscal_year}.")
        column = chr(ord("B") + years.index(fiscal_year))
        value_ref = f"'Input Required'!{destination['cell']}"
        sheet[f"{column}17"] = f'=IF(AND({status_ref}="READY",ISNUMBER({value_ref}),{value_ref}>0,{value_ref}<1),{value_ref},"")'
        sheet[f"{column}17"].font = _FORMULA_FONT
        sheet[f"{column}17"].fill = _FORMULA_FILL
        sheet[f"{column}17"].number_format = _PERCENT_FORMAT

    if not any(isinstance(item, dict) and item.get("key") == "base_fee_yield" for item in requirements):
        raise ValueError("Incomplete asset-manager workbook requires at least one base_fee_yield input.")
    sheet["L11"] = f'=IF({status_ref}<>"READY","",AVERAGE(B17:D17))'
    sheet["L11"].font = _FORMULA_FONT
    sheet["L11"].fill = _FORMULA_FILL
    sheet["L11"].number_format = _PERCENT_FORMAT
    sheet["M11"] = "Three-year average of the filed annual base-fee yields; missing year is linked from Input Required."
    sheet["M11"].font = _SMALL_FONT
    sheet["M11"].alignment = Alignment(wrap_text=True, vertical="top")

    formula_cells = []
    for column in "EFGHI":
        formula_cells.extend(f"{column}{row}" for row in (*range(5, 15), *range(17, 31), *range(33, 48)))
    formula_cells.extend(f"B{row}" for row in (51, *range(53, 64), 65))
    formula_cells.extend(f"{column}{row}" for row in range(71, 76) for column in "CDEFG")
    for cell_ref in formula_cells:
        cell = sheet[cell_ref]
        if isinstance(cell.value, str) and cell.value.startswith("="):
            cell.value = f'=IF({status_ref}<>"READY","",{cell.value[1:]})'
