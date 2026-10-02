from __future__ import annotations

import math
from typing import Any

from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.workbook import Workbook
from openpyxl.worksheet.worksheet import Worksheet

_INPUT_FONT = Font(name="Arial", size=10, color="0000FF")
_FORMULA_FONT = Font(name="Arial", size=10, color="000000")
_BODY_FONT = Font(name="Arial", size=10, color="000000")
_HEADER_FONT = Font(name="Arial", size=10, bold=True, color="FFFFFF")
_SECTION_FONT = Font(name="Arial", size=10, bold=True, color="17365D")
_TITLE_FILL = PatternFill("solid", fgColor="17365D")
_SECTION_FILL = PatternFill("solid", fgColor="D9EAF7")
_INPUT_FILL = PatternFill("solid", fgColor="FFF2CC")
_FORMULA_FILL = PatternFill("solid", fgColor="E2F0D9")
_HEADER_FILL = PatternFill("solid", fgColor="365F91")
_MONEY_FORMAT = '#,##0.0,,;[Red](#,##0.0,,);-'
_PRICE_FORMAT = '$#,##0.00;[Red]($#,##0.00);-'
_PERCENT_FORMAT = '0.0%;[Red](0.0%);-'
_RATIO_FORMAT = '0.00x'

_HISTORICAL_LINES = (
    ("interest_income", 5, "Interest income"),
    ("interest_expense", 6, "Interest expense"),
    ("net_interest_income", 7, "Net interest income"),
    ("noninterest_income", 8, "Noninterest income"),
    ("noninterest_expense", 9, "Noninterest expense"),
    ("provision_for_credit_losses", 10, "Provision for credit losses"),
    ("loans_and_leases", 11, "Loans and leases"),
    ("deposits", 12, "Deposits"),
    ("interest_bearing_liabilities", 13, "Average interest-bearing liabilities"),
    ("interest_earning_assets", 14, "Average interest-earning assets"),
    ("risk_weighted_assets", 15, "Risk-weighted assets"),
    ("cet1_capital", 16, "CET1 capital"),
    ("common_equity", 17, "Common equity"),
    ("common_equity_distributions", 18, "Common equity distributions"),
    ("diluted_shares", 19, "Weighted-average diluted shares"),
)

_ASSUMPTIONS = (
    ("earningAssetGrowth", 23, "Earning-asset growth", _PERCENT_FORMAT),
    ("loanGrowth", 24, "Loan growth", _PERCENT_FORMAT),
    ("depositGrowth", 25, "Deposit growth", _PERCENT_FORMAT),
    ("earningAssetYield", 26, "Earning-asset yield", _PERCENT_FORMAT),
    ("fundingCost", 27, "Funding cost", _PERCENT_FORMAT),
    ("noninterestIncomeGrowth", 28, "Noninterest-income growth", _PERCENT_FORMAT),
    ("efficiencyRatio", 29, "Efficiency ratio", _PERCENT_FORMAT),
    ("provisionRate", 30, "Provision rate on average loans", _PERCENT_FORMAT),
    ("taxRate", 31, "Tax rate", _PERCENT_FORMAT),
    ("payoutRatio", 32, "Target common payout ratio", _PERCENT_FORMAT),
    ("minimumCet1Ratio", 33, "Minimum CET1 ratio", _PERCENT_FORMAT),
    ("riskFreeRate", 34, "Risk-free rate", _PERCENT_FORMAT),
    ("equityRiskPremium", 35, "Equity risk premium", _PERCENT_FORMAT),
    ("beta", 36, "Beta", '0.00'),
    ("terminalGrowthRate", 38, "Terminal residual-income growth", _PERCENT_FORMAT),
)


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _finite_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ValueError(f"Bank model export requires a finite sourced value for {label}.")
    return float(value)


def _latest_history(bank_model: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    history = _record(bank_model.get("history"))
    annual = history.get("annual")
    if not isinstance(annual, list) or not annual:
        raise ValueError("Bank model export requires filed annual history.")
    latest_record = annual[-1]
    latest_record = _record(latest_record)
    year = latest_record.get("year")
    if isinstance(year, bool) or not isinstance(year, int):
        raise ValueError("Bank model export requires an integer latest fiscal year.")
    bank = _record(latest_record.get("bank"))
    return year, bank


def _source_line(bank: dict[str, Any], field: str, year: int) -> tuple[float, dict[str, Any]]:
    line = _record(bank.get(field))
    value = _finite_number(line.get("value"), field)
    if line.get("source") not in {"sec_native", "derived"}:
        raise ValueError(f"FY{year} bank model input {field} is missing or ambiguous.")
    sources = line.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError(f"FY{year} bank model input {field} has no filing provenance.")
    for source in sources:
        source = _record(source)
        if not source.get("accession") or not source.get("filed") or source.get("fiscal_period") != f"FY {year}":
            raise ValueError(f"FY{year} bank model input {field} has incomplete filing provenance.")
    return value, line


def _write_value(
    sheet: Worksheet,
    cell_ref: str,
    value: Any,
    *,
    formula: bool = False,
    number_format: str | None = None,
    input_cell: bool = False,
) -> None:
    cell = sheet[cell_ref]
    cell.value = value
    cell.font = _INPUT_FONT if input_cell else _FORMULA_FONT if formula else _BODY_FONT
    cell.fill = _INPUT_FILL if input_cell else _FORMULA_FILL if formula else PatternFill(fill_type=None)
    cell.alignment = Alignment(vertical="center", wrap_text=False)
    if number_format:
        cell.number_format = number_format


def _section(sheet: Worksheet, row: int, label: str, end_column: int = 7) -> None:
    for column in range(1, end_column + 1):
        cell = sheet.cell(row=row, column=column)
        cell.fill = _SECTION_FILL
        cell.font = _SECTION_FONT
    sheet.cell(row=row, column=1, value=label)


def _source_metadata(line: dict[str, Any]) -> tuple[str, str, str, str, str]:
    sources = [_record(source) for source in line.get("sources", [])]
    concepts = "; ".join(dict.fromkeys(str(source.get("concept") or line.get("concept") or "derived") for source in sources))
    accessions = "; ".join(dict.fromkeys(str(source.get("accession") or "") for source in sources if source.get("accession")))
    filed_dates = "; ".join(dict.fromkeys(str(source.get("filed") or "") for source in sources if source.get("filed")))
    periods = "; ".join(dict.fromkeys(str(source.get("fiscal_period") or "") for source in sources if source.get("fiscal_period")))
    units = "; ".join(dict.fromkeys(
        f"{source.get('unit') or 'unit unknown'} {source.get('unit_scale') or ''}".strip()
        for source in sources
    ))
    return concepts, accessions, filed_dates, periods, units


def _map_model_sheet(workbook: Workbook, payload: dict[str, Any], bank_model: dict[str, Any]) -> None:
    for existing in list(workbook.worksheets):
        workbook.remove(existing)
    sheet = workbook.create_sheet("Bank Model")
    sheet.sheet_view.showGridLines = False
    sheet.freeze_panes = "C44"
    sheet.column_dimensions["A"].width = 39
    sheet.column_dimensions["B"].width = 17
    for column in "CDEFG":
        sheet.column_dimensions[column].width = 17
    for column, width in (("H", 28), ("I", 24), ("J", 14), ("K", 14), ("L", 24)):
        sheet.column_dimensions[column].width = width
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.page_setup.orientation = "landscape"

    company = _record(payload.get("company"))
    ticker = str(company.get("ticker") or "").strip().upper()
    name = str(company.get("name") or ticker or "Company").strip()
    currency = str(company.get("currency") or "USD")
    year, bank = _latest_history(bank_model)
    assumptions = _record(bank_model.get("assumptions"))

    sheet.merge_cells("A1:L1")
    sheet["A1"] = f"{name} ({ticker}) — Bank Residual Income Model"
    sheet["A1"].font = Font(name="Arial", size=16, bold=True, color="FFFFFF")
    sheet["A1"].fill = _TITLE_FILL
    sheet["A1"].alignment = Alignment(vertical="center")
    sheet.row_dimensions[1].height = 28
    sheet.merge_cells("A2:L2")
    sheet["A2"] = f"Equity value model. Amounts are {currency} actual values displayed in millions, except per share, ratios, and shares. Blue cells are editable assumptions; forecast and valuation cells contain formulas."
    sheet["A2"].font = Font(name="Arial", size=10, italic=True, color="404040")
    sheet["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    sheet.row_dimensions[2].height = 30

    _section(sheet, 3, f"Filed FY{year} bank inputs and sources", 7)
    source_rows: dict[str, int] = {}
    for column, header in enumerate(("Input", f"FY{year} value", "SEC concept(s)", "Accession(s)", "Filed date(s)", "Fiscal period(s)", "Source unit(s)"), start=1):
        cell = sheet.cell(row=4, column=column, value=header)
        cell.font = _HEADER_FONT
        cell.fill = _HEADER_FILL
        cell.alignment = Alignment(wrap_text=True, vertical="center")
    for field, row, label in _HISTORICAL_LINES:
        value, line = _source_line(bank, field, year)
        source_rows[field] = row
        sheet.cell(row=row, column=1, value=label).font = _BODY_FONT
        _write_value(sheet, f"B{row}", value, number_format=_MONEY_FORMAT)
        metadata = _source_metadata(line)
        for column, item in enumerate(metadata, start=3):
            sheet.cell(row=row, column=column, value=item).font = Font(name="Arial", size=9, color="404040")
            sheet.cell(row=row, column=column).alignment = Alignment(wrap_text=True, vertical="top")
        sources = [_record(source) for source in line.get("sources", [])]
        sheet[f"B{row}"].comment = Comment(
            f"Canonical method: {line.get('method')}. Source filing(s): "
            + "; ".join(str(source.get("accession")) for source in sources),
            "DCF Builder Pro",
        )
        sheet.row_dimensions[row].height = 30

    _section(sheet, 21, "Editable forecast and valuation assumptions", 2)
    for field, row, label, number_format in _ASSUMPTIONS:
        sheet.cell(row=row, column=1, value=label).font = _BODY_FONT
        missing_cet1_ratio = (
            payload.get("buildStatus") == "input_required"
            and field == "minimumCet1Ratio"
            and assumptions.get(field) is None
        )
        _write_value(
            sheet,
            f"B{row}",
            None if missing_cet1_ratio else _finite_number(assumptions.get(field), field),
            input_cell=not missing_cet1_ratio,
            number_format=number_format,
        )
        source_field = {
            "minimumCet1Ratio": "minimumCet1RatioSource",
            "riskFreeRate": "riskFreeRateSource",
            "equityRiskPremium": "equityRiskPremiumSource",
            "beta": "betaSource",
        }.get(field)
        if source_field:
            note = "Enter the filed requirement and source on Input Required." if missing_cet1_ratio else str(assumptions.get(source_field) or "Source not provided.")
            sheet[f"B{row}"].comment = Comment(note, "DCF Builder Pro")
        else:
            sources = _record(assumptions.get("assumptionSources"))
            sheet[f"B{row}"].comment = Comment(str(sources.get(field) or "Source not provided."), "DCF Builder Pro")

    _write_value(sheet, "B37", "=B34+B35*B36", formula=True, number_format=_PERCENT_FORMAT)
    sheet["A37"] = "Cost of equity (CAPM)"
    sheet["A37"].font = _BODY_FONT
    sheet["A39"] = "Current share price"
    sheet["A39"].font = _BODY_FONT
    _write_value(sheet, "B39", _finite_number(assumptions.get("currentPrice"), "currentPrice"), input_cell=True, number_format=_PRICE_FORMAT)
    sheet["B39"].comment = Comment(f"Market source as of {assumptions.get('marketDataAsOfDate')}.", "DCF Builder Pro")
    sheet["A40"] = "Diluted shares for valuation"
    sheet["A40"].font = _BODY_FONT
    _write_value(sheet, "B40", _finite_number(assumptions.get("dilutedSharesOutstanding"), "dilutedSharesOutstanding"), input_cell=True, number_format=_MONEY_FORMAT)
    sheet["B40"].comment = Comment(f"Uses the latest filed weighted-average diluted shares from FY{year}; the exact concept and filing are shown in the sourced input table.", "DCF Builder Pro")

    _section(sheet, 42, "Five-year operating, capital, and residual-income forecast", 7)
    sheet.cell(row=43, column=1, value="Forecast schedule").font = _BODY_FONT
    for index, column in enumerate("CDEFG", start=1):
        sheet[f"{column}43"] = f"FY{year + index}E"
        sheet[f"{column}43"].font = _HEADER_FONT
        sheet[f"{column}43"].fill = _HEADER_FILL
        sheet[f"{column}43"].alignment = Alignment(horizontal="center")
    forecast_labels = {
        44: "Average interest-earning assets",
        45: "Interest-bearing liabilities",
        46: "Loans and leases",
        47: "Deposits",
        48: "Interest income",
        49: "Interest expense",
        50: "Net interest income",
        51: "Noninterest income",
        52: "Total revenue",
        53: "Noninterest expense",
        54: "Average loans and leases",
        55: "Provision for credit losses",
        56: "Pretax income",
        57: "Tax expense",
        58: "Net income available to common",
        59: "Opening common equity",
        60: "Target common distributions",
        61: "Opening CET1 capital",
        62: "Ending risk-weighted assets",
        63: "Required CET1 capital",
        64: "CET1 capital before distributions",
        65: "Available distribution capacity",
        66: "Allowed common distributions",
        67: "Ending CET1 capital",
        68: "Ending CET1 ratio",
        69: "Ending common equity",
        70: "Equity charge",
        71: "Residual income",
        72: "Present value of residual income",
    }
    for row, label in forecast_labels.items():
        sheet.cell(row=row, column=1, value=label).font = _BODY_FONT
    for index, column in enumerate("CDEFG", start=1):
        prior_column = chr(ord(column) - 1) if index > 1 else None
        prior = lambda row, historical_row: f"{prior_column}{row}" if prior_column else f"$B${historical_row}"
        formulas = {
            44: f"={prior(44, 14)}*(1+$B$23)",
            45: f"={prior(45, 13)}*(1+$B$25)",
            46: f"={prior(46, 11)}*(1+$B$24)",
            47: f"={prior(47, 12)}*(1+$B$25)",
            48: f"={column}44*$B$26",
            49: f"={column}45*$B$27",
            50: f"={column}48-{column}49",
            51: f"={prior(51, 8)}*(1+$B$28)",
            52: f"={column}50+{column}51",
            53: f"={column}52*$B$29",
            54: f"=AVERAGE({prior(46, 11)},{column}46)",
            55: f"={column}54*$B$30",
            56: f"={column}52-{column}53-{column}55",
            57: f"=MAX(0,{column}56*$B$31)",
            58: f"={column}56-{column}57",
            59: f"={prior(69, 17)}",
            60: f"=MAX(0,{column}58*$B$32)",
            61: f"={prior(67, 16)}",
            62: f"={prior(62, 15)}*(1+$B$23)",
            63: f"={column}62*$B$33",
            64: f"={column}61+{column}58",
            65: f"=MAX(0,{column}64-{column}63)",
            66: f"=MIN({column}60,{column}65)",
            67: f"={column}64-{column}66",
            68: f"=IFERROR({column}67/{column}62,0)",
            69: f"={column}59+{column}58-{column}66",
            70: f"={column}59*$B$37",
            71: f"={column}58-{column}70",
            72: f"={column}71/(1+$B$37)^{index}",
        }
        for row, formula in formulas.items():
            number_format = _PERCENT_FORMAT if row == 68 else _MONEY_FORMAT
            _write_value(sheet, f"{column}{row}", formula, formula=True, number_format=number_format)

    _section(sheet, 73, "Residual-income equity valuation", 2)
    valuation_rows = (
        (74, "PV of forecast residual income", "=SUM(C72:G72)", _MONEY_FORMAT),
        (75, "Terminal residual income", '=IF($B$37<=$B$38,"",G71*(1+$B$38)/($B$37-$B$38))', _MONEY_FORMAT),
        (76, "PV of terminal residual income", '=IF(B75="","",B75/(1+$B$37)^5)', _MONEY_FORMAT),
        (77, "Common equity value", '=IF($B$75="","",MAX(0,$B$17+$B$74+$B$76))', _MONEY_FORMAT),
        (78, "Implied share price", "=IFERROR(B77/$B$40,0)", _PRICE_FORMAT),
        (79, "Current share price", "=B39", _PRICE_FORMAT),
        (80, "Implied return", "=IFERROR(B78/$B$79-1,0)", _PERCENT_FORMAT),
    )
    for row, label, formula, number_format in valuation_rows:
        sheet.cell(row=row, column=1, value=label).font = Font(name="Arial", size=10, bold=row in (78, 79, 81))
        _write_value(sheet, f"B{row}", formula, formula=True, number_format=number_format)
    sheet["A81"] = "Enterprise value"
    sheet["B81"] = "Not applicable — bank equity model"
    sheet["A81"].font = _BODY_FONT
    sheet["B81"].font = _BODY_FONT
    sheet["A82"] = "Historical interest reconciliation"
    sheet["B82"] = "=B5-B6-B7"
    sheet["B82"].number_format = _MONEY_FORMAT
    sheet["B82"].font = _FORMULA_FONT
    sheet["A83"] = "Latest filed CET1 ratio"
    sheet["B83"] = "=B16/B15"
    sheet["B83"].number_format = _PERCENT_FORMAT
    sheet["B83"].font = _FORMULA_FONT
    sheet.auto_filter.ref = "A5:G19"

    _section(sheet, 85, "Equity value sensitivity — cost of equity and terminal growth", 9)
    sheet["B86"] = "Cost of equity / terminal growth"
    sheet["B86"].font = _HEADER_FONT
    sheet["B86"].fill = _HEADER_FILL
    for column, formula in zip("CDEFG", ("=$B$38-1%", "=$B$38-0.5%", "=$B$38", "=$B$38+0.5%", "=$B$38+1%")):
        _write_value(sheet, f"{column}86", formula, formula=True, number_format=_PERCENT_FORMAT)
        sheet[f"{column}86"].fill = _HEADER_FILL
        sheet[f"{column}86"].font = _HEADER_FONT
    sheet["H86"] = "PV forecast residual income"
    sheet["I86"] = "Year 5 residual income"
    for ref in ("H86", "I86"):
        sheet[ref].fill = _HEADER_FILL
        sheet[ref].font = _HEADER_FONT
        sheet[ref].alignment = Alignment(wrap_text=True, vertical="center")
    for row, offset in zip(range(87, 92), ("-2%", "-1%", "", "+1%", "+2%")):
        formula = f"=$B$37{offset}" if offset else "=$B$37"
        _write_value(sheet, f"B{row}", formula, formula=True, number_format=_PERCENT_FORMAT)
        periods = [
            f"({column}58-$B{row}*{column}59)/(1+$B{row})^{year_index}"
            for year_index, column in enumerate("CDEFG", start=1)
        ]
        _write_value(sheet, f"H{row}", "=" + "+".join(periods), formula=True, number_format=_MONEY_FORMAT)
        _write_value(sheet, f"I{row}", f"=G58-$B{row}*G59", formula=True, number_format=_MONEY_FORMAT)
        for column in "CDEFG":
            formula = (
                f'=IF(OR($B{row}<={column}$86,$B{row}<=0),"",'
                f'MAX(0,$B$17+$H{row}+($I{row}*(1+{column}$86)/($B{row}-{column}$86))/(1+$B{row})^5))'
            )
            _write_value(sheet, f"{column}{row}", formula, formula=True, number_format=_MONEY_FORMAT)
    sheet["A93"] = "Sensitivity basis"
    sheet["B93"] = "Opening common equity plus discounted forecast and terminal residual income; cells blank when terminal growth is not below cost of equity."
    sheet.merge_cells("B93:I93")
    sheet["A93"].font = _BODY_FONT
    sheet["B93"].font = Font(name="Arial", size=9, italic=True, color="404040")
    sheet["B93"].alignment = Alignment(wrap_text=True, vertical="top")
    sheet.row_dimensions[93].height = 28


def _map_review_sheet(workbook: Workbook, payload: dict[str, Any], bank_model: dict[str, Any]) -> None:
    review = workbook.create_sheet("Data Review")
    review.sheet_view.showGridLines = False
    company = _record(payload.get("company"))
    ticker = str(company.get("ticker") or "").upper()
    name = str(company.get("name") or ticker)
    review.merge_cells("A1:C1")
    review["A1"] = f"Data Review — {name} ({ticker})"
    review["A1"].font = Font(name="Arial", size=16, bold=True, color="FFFFFF")
    review["A1"].fill = _TITLE_FILL
    review.merge_cells("A2:C2")
    review["A2"] = "The model values common equity from residual income. Enterprise value is not applicable to a bank."
    review["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    review["A2"].font = Font(name="Arial", size=10, italic=True)
    for column, label in enumerate(("Status", "Area", "Review note"), start=1):
        cell = review.cell(row=5, column=column, value=label)
        cell.font = _HEADER_FONT
        cell.fill = _HEADER_FILL
    ui_meta = _record(payload.get("uiMeta"))
    warnings = ui_meta.get("warnings") if isinstance(ui_meta.get("warnings"), list) else []
    notes = ui_meta.get("sourceNotes") if isinstance(ui_meta.get("sourceNotes"), list) else []
    items = [("REVIEW", "Assumption", note) for note in warnings if isinstance(note, str)]
    items.extend(("INFO", "Source", note) for note in notes if isinstance(note, str))
    items.append(("INFO", "Sensitivity", "Equity value sensitivity varies cost of equity and terminal residual-income growth; both axes are linked to the editable base assumptions."))
    if not items:
        raise ValueError("Bank model export requires source notes and assumption disclosures on Data Review.")
    for row, (status, area, note) in enumerate(items, start=6):
        status_cell = review.cell(row=row, column=1, value=status)
        status_cell.font = Font(name="Arial", size=10, bold=True)
        status_cell.fill = PatternFill("solid", fgColor="FCE4D6" if status == "REVIEW" else "DDEBF7")
        review.cell(row=row, column=2, value=area)
        review.cell(row=row, column=3, value=note)
        for column in range(1, 4):
            review.cell(row=row, column=column).alignment = Alignment(wrap_text=True, vertical="top")
        review.row_dimensions[row].height = 34
    review.column_dimensions["A"].width = 14
    review.column_dimensions["B"].width = 22
    review.column_dimensions["C"].width = 112
    review.freeze_panes = "A6"
    review.auto_filter.ref = f"A5:C{5 + len(items)}"


def apply_bank_model(workbook: Workbook, payload: dict[str, Any]) -> None:
    if payload.get("valuationModel") != "bank_residual_income":
        raise ValueError("Bank workbook requires valuationModel=bank_residual_income.")
    bank_model = _record(payload.get("bankModel"))
    if not bank_model:
        raise ValueError("Bank workbook requires dedicated bank history and assumptions.")
    assumptions = _record(bank_model.get("assumptions"))
    if assumptions.get("forecastYears") != 5:
        raise ValueError("Bank workbook requires a five-year forecast horizon.")
    _map_model_sheet(workbook, payload, bank_model)
    _map_review_sheet(workbook, payload, bank_model)


def apply_incomplete_bank_model(
    workbook: Workbook,
    payload: dict[str, Any],
    input_cells: dict[str, dict[str, str]],
) -> None:
    """Link the missing CET1 floor to the bank model and withhold dependent outputs."""
    sheet = workbook["Bank Model"]
    requirements = payload.get("requiredInputs")
    requirements = requirements if isinstance(requirements, list) else []
    requirement = next((item for item in requirements if isinstance(item, dict) and item.get("key") == "minimum_cet1_ratio"), None)
    if requirement is None:
        raise ValueError("Incomplete bank workbook requires a minimum_cet1_ratio input.")
    identity = f"minimum_cet1_ratio:{requirement.get('fiscalYear') or requirement.get('asOfDate') or ''}"
    destination = input_cells.get(identity)
    if not destination or destination.get("sheet") != "Input Required":
        raise ValueError("Incomplete bank workbook has no editable minimum CET1 input cell.")
    value_ref = f"'Input Required'!{destination['cell']}"
    status_ref = "'Input Required'!$B$3"
    sheet["B33"] = f'=IF(AND(ISNUMBER({value_ref}),{value_ref}>0,{value_ref}<1),{value_ref},"")'
    sheet["B33"].font = Font(name="Arial", size=10, color="008000")
    sheet["B33"].fill = _FORMULA_FILL
    sheet["B33"].number_format = _PERCENT_FORMAT
    sheet["B33"].comment = Comment(
        f"Linked to Input Required!{destination['cell']}; enter the filed minimum CET1 ratio and a source reference there.",
        "DCF Builder Pro",
    )

    formula_cells = [
        f"{column}{row}"
        for column in "CDEFG"
        for row in range(44, 73)
    ]
    formula_cells.extend(f"B{row}" for row in (*range(74, 79), 80))
    formula_cells.extend(f"{column}{row}" for row in range(87, 92) for column in "CDEFGHI")
    for cell_ref in formula_cells:
        cell = sheet[cell_ref]
        if isinstance(cell.value, str) and cell.value.startswith("="):
            cell.value = f'=IF({status_ref}<>"READY","",{cell.value[1:]})'
