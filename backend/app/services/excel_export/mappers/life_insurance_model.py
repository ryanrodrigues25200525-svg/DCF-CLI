from __future__ import annotations

from typing import Any

from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.workbook import Workbook

from .utils import _resolve_amount_scale_divisor

_NAVY = "17365D"
_BLUE = "365F91"
_PALE_BLUE = "DDEBF7"
_WHITE = "FFFFFF"
_GREEN = "008000"
_BLACK = "000000"
_GRAY = "666666"
_THIN = Side(style="thin", color="B7C9D6")
_AMOUNT = "#,##0.0;(#,##0.0);-"
_PRICE = "$0.00;($0.00);-"
_PERCENT = "0.0%;(0.0%);-"


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


_FACT_SNAKE_CASE = {
    "capitalGroup": "capital_group",
    "fiscalYear": "fiscal_year",
    "earningsBasis": "earnings_basis",
    "unitScale": "unit_scale",
    "comparisonOperator": "comparison_operator",
    "accessionNumber": "accession_number",
    "filingDate": "filing_date",
    "reportDate": "report_date",
    "primaryDocument": "primary_document",
    "sourceStatement": "source_statement",
}


def _fact_value(fact: dict[str, Any], key: str) -> Any:
    return fact.get(key, fact.get(_FACT_SNAKE_CASE.get(key, key)))


def _safe_text(value: Any) -> Any:
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
        return f"'{value}"
    return value


def _destination(
    input_cells: dict[str, dict[str, str]],
    key: str,
    year: int | None = None,
) -> str:
    identity = f"{key}:{year if year is not None else ''}"
    destination = input_cells.get(identity)
    if not destination or destination.get("sheet") != "Input Required":
        raise ValueError(f"Life-insurance workbook has no editable input cell for {identity}.")
    return destination["cell"]


def _input_formula(
    input_cells: dict[str, dict[str, str]],
    key: str,
    year: int | None = None,
    divisor: float = 1.0,
) -> str:
    cell = _destination(input_cells, key, year)
    return f'=IF(\'Input Required\'!$B$3<>"READY","",\'Input Required\'!{cell}/{divisor:g})'


def _style_section(sheet, row: int, text: str, end_column: int = 9) -> None:
    sheet.cell(row, 1, text)
    sheet.merge_cells(start_row=row, start_column=1, end_row=row, end_column=end_column)
    cell = sheet.cell(row, 1)
    cell.font = Font(name="Arial", size=11, bold=True, color=_WHITE)
    cell.fill = PatternFill("solid", fgColor=_BLUE)


def _style_header(cell) -> None:
    cell.font = Font(name="Arial", size=9, bold=True, color=_WHITE)
    cell.fill = PatternFill("solid", fgColor=_BLUE)
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    cell.border = Border(bottom=_THIN)


def _source_fact_index(
    facts: list[dict[str, Any]],
    review_sheet,
) -> dict[tuple[str, str, int], int]:
    start = max(6, review_sheet.max_row + 3)
    _style_section(review_sheet, start, "SEC-filed life-insurance source facts", 14)
    headers = (
        "Metric", "Segment", "Capital group / jurisdiction", "Fiscal year", "Reported value",
        "Unit", "Unit scale", "Source earnings basis", "Comparison", "Accession", "Filed", "Report date", "Form", "Source statement / table scope",
    )
    header_row = start + 1
    for column, label in enumerate(headers, start=1):
        _style_header(review_sheet.cell(header_row, column, label))
    earning_rows: dict[tuple[str, str, int], int] = {}
    for offset, fact in enumerate(facts, start=2):
        row = start + offset
        fields = (
            _fact_value(fact, "metric"), _fact_value(fact, "segment"), _fact_value(fact, "capitalGroup"), _fact_value(fact, "fiscalYear"),
            _fact_value(fact, "value"), _fact_value(fact, "unit"), _fact_value(fact, "unitScale"),
            _fact_value(fact, "earningsBasis"), _fact_value(fact, "comparisonOperator"), _fact_value(fact, "accessionNumber"),
            _fact_value(fact, "filingDate"), _fact_value(fact, "reportDate"), _fact_value(fact, "form"), _fact_value(fact, "sourceStatement"),
        )
        for column, value in enumerate(fields, start=1):
            cell = review_sheet.cell(row, column, _safe_text(value))
            cell.font = Font(name="Arial", size=9, color=_BLACK)
            cell.alignment = Alignment(vertical="top", wrap_text=column in {3, 8, 14})
        value_cell = review_sheet.cell(row, 5)
        if isinstance(_fact_value(fact, "value"), (int, float)):
            value_cell.number_format = _PERCENT if _fact_value(fact, "unit") == "ratio" else _AMOUNT
        if _fact_value(fact, "metric") in {"adjusted_earnings_available_to_common", "adjusted_operating_income_pretax"}:
            segment = str(_fact_value(fact, "segment") or "")
            fiscal_year = _fact_value(fact, "fiscalYear")
            if isinstance(fiscal_year, int):
                identity = (str(fact["metric"]), segment, fiscal_year)
                if identity in earning_rows:
                    raise ValueError(f"Life-insurance source facts contain duplicate segment earnings for {identity}.")
                earning_rows[identity] = row
    for column, width in {
        "A": 38, "B": 25, "C": 52, "D": 13, "E": 18, "F": 12, "G": 14, "H": 44,
        "I": 18, "J": 23, "K": 13, "L": 13, "M": 12, "N": 110,
    }.items():
        review_sheet.column_dimensions[column].width = max(review_sheet.column_dimensions[column].width or 0, width)
    return earning_rows


def apply_incomplete_life_insurance_model(
    workbook: Workbook,
    payload: dict[str, Any],
    input_cells: dict[str, dict[str, str]],
) -> None:
    """Map a source-complete but assumption-incomplete MET/PRU equity DCF."""
    if payload.get("valuationModel") != "life_insurer_distributable_earnings_dcf" or payload.get("buildStatus") != "input_required":
        raise ValueError("Life-insurance workbook requires an input-required distributable-earnings DCF payload.")
    life = _record(payload.get("lifeInsuranceModel"))
    ticker = str(life.get("ticker") or "").upper()
    if ticker not in {"MET", "PRU"}:
        raise ValueError("The first life-insurance workbook supports only MET and PRU.")
    base_year = life.get("baseYear")
    if not isinstance(base_year, int) or life.get("forecastYears") != 5:
        raise ValueError("Life-insurance workbook requires a filed fiscal base year and five forecast years.")
    earnings_basis = life.get("earningsBasis")
    expected_basis = "after_tax_adjusted_earnings_available_to_common" if ticker == "MET" else "pre_tax_adjusted_operating_income"
    expected_metric = "adjusted_earnings_available_to_common" if ticker == "MET" else "adjusted_operating_income_pretax"
    if earnings_basis != expected_basis:
        raise ValueError(f"The {ticker} life-insurance source earnings basis is inconsistent with its filed measure.")
    facts = [fact for fact in life.get("filingFacts", []) if isinstance(fact, dict)]
    current_segments = sorted({
        str(_fact_value(fact, "segment")) for fact in facts
        if _fact_value(fact, "metric") == expected_metric and _fact_value(fact, "fiscalYear") == base_year and _fact_value(fact, "segment")
    })
    if not current_segments:
        raise ValueError(f"The {ticker} life-insurance source contract has no FY{base_year} segment earnings.")
    for year in range(base_year - 2, base_year + 1):
        segments = {
            str(_fact_value(fact, "segment")) for fact in facts
            if _fact_value(fact, "metric") == expected_metric and _fact_value(fact, "fiscalYear") == year and _fact_value(fact, "segment")
        }
        if segments != set(current_segments):
            raise ValueError(f"The {ticker} life-insurance FY{year} segment earnings do not reconcile to the base-year segment set.")

    divisor = _resolve_amount_scale_divisor(payload)
    if divisor <= 0:
        raise ValueError("Life-insurance workbook has an unsupported amount scale.")
    amount_unit = {1.0: "USD actual", 1_000.0: "USD thousands", 1_000_000.0: "USD millions", 1_000_000_000.0: "USD billions"}.get(divisor, "USD scaled")
    share_unit = {1.0: "actual", 1_000.0: "thousands", 1_000_000.0: "millions", 1_000_000_000.0: "billions"}.get(divisor, "scaled")
    forecast_years = list(range(base_year + 1, base_year + 6))
    historical_years = list(range(base_year - 2, base_year + 1))
    year_columns = {year: get_column_letter(index + 2) for index, year in enumerate(historical_years + forecast_years)}
    input_requirements = payload.get("requiredInputs") if isinstance(payload.get("requiredInputs"), list) else []
    requirement_keys = {(str(item.get("key")), item.get("fiscalYear")) for item in input_requirements if isinstance(item, dict)}
    for segment in current_segments:
        for year in forecast_years:
            if (f"life_segment_earnings_growth:{segment}", year) not in requirement_keys:
                raise ValueError(f"Life-insurance workbook is missing the {segment} earnings-growth input for FY{year}.")
    for key in ("life_net_capital_addition", "life_permitted_upstream_dividends"):
        for year in forecast_years:
            if (key, year) not in requirement_keys:
                raise ValueError(f"Life-insurance workbook is missing the {key} input for FY{year}.")

    for existing in list(workbook.worksheets):
        if existing.title not in {"Input Required", "Data Review"}:
            workbook.remove(existing)
    model = workbook.create_sheet("Life Insurance Model", 0)
    model.sheet_view.showGridLines = False
    company = _record(payload.get("company"))
    model["A1"] = f"Life-Insurance Distributable-Earnings DCF — {ticker}"
    model["A1"].font = Font(name="Arial", size=16, bold=True, color=_WHITE)
    model["A1"].fill = PatternFill("solid", fgColor=_NAVY)
    model.merge_cells("A1:L1")
    model["A2"] = str(company.get("name") or ticker)
    model["A2"].font = Font(name="Arial", size=11, bold=True, color=_NAVY)
    model["A3"] = (
        "Common-equity DCF: filed segment earnings less analyst-entered statutory-capital retention, capped by source-supported upstream capacity. "
        "No insurer enterprise value or operating liabilities as corporate debt."
    )
    model.merge_cells("A3:L3")
    model["A3"].alignment = Alignment(wrap_text=True, vertical="top")
    model.row_dimensions[3].height = 34
    model["A4"] = "Model status"
    model["A4"].font = Font(name="Arial", size=10, bold=True)
    model["B4"] = "Pending validation"
    model["B4"].font = Font(name="Arial", size=10, bold=True, color=_GREEN)
    model["A5"] = f"Amounts: {amount_unit}; diluted shares in {share_unit}; per-share value in {company.get('currency') or 'USD'}."
    model.merge_cells("A5:I5")
    model["A5"].font = Font(name="Arial", size=9, italic=True, color=_GRAY)

    review = workbook["Data Review"]
    earning_rows = _source_fact_index(facts, review)

    _style_section(model, 7, "Historical actuals and five-year segment forecast")
    model["A8"] = "USD millions unless shown otherwise"
    model["A8"].font = Font(name="Arial", size=9, italic=True, color=_GRAY)
    for year, column in year_columns.items():
        header = model[f"{column}9"]
        header.value = year
        header.number_format = '"FY"0'
        _style_header(header)
    model["A9"] = "Reported fiscal year"
    model["A9"].font = Font(name="Arial", size=9, bold=True, color=_WHITE)
    model["A9"].fill = PatternFill("solid", fgColor=_BLUE)
    model["A9"].alignment = Alignment(wrap_text=True)

    segment_earnings_rows: list[int] = []
    cursor = 10
    for segment in current_segments:
        earnings_row = cursor
        growth_row = cursor + 1
        segment_earnings_rows.append(earnings_row)
        model.cell(earnings_row, 1, f"{segment} — {'after-tax adjusted earnings' if ticker == 'MET' else 'pre-tax adjusted operating income'}")
        model.cell(growth_row, 1, f"{segment} growth assumption")
        model.cell(growth_row, 1).font = Font(name="Arial", size=9, italic=True, color=_GRAY)
        for year in historical_years:
            source_row = earning_rows.get((expected_metric, segment, year))
            if source_row is None:
                raise ValueError(f"The {ticker} FY{year} source fact for {segment} is missing from Data Review.")
            column = year_columns[year]
            cell = model[f"{column}{earnings_row}"]
            cell.value = f"='Data Review'!E{source_row}"
            cell.number_format = _AMOUNT
            cell.font = Font(name="Arial", size=9, color=_GREEN)
            cell.comment = None
        for year in forecast_years:
            column = year_columns[year]
            previous_column = year_columns[year - 1]
            model[f"{column}{growth_row}"] = _input_formula(input_cells, f"life_segment_earnings_growth:{segment}", year)
            model[f"{column}{growth_row}"].number_format = _PERCENT
            model[f"{column}{growth_row}"].font = Font(name="Arial", size=9, color=_GREEN)
            model[f"{column}{earnings_row}"] = f'=IF(\'Input Required\'!$B$3<>"READY","",{previous_column}{earnings_row}*(1+{column}{growth_row}))'
            model[f"{column}{earnings_row}"].number_format = _AMOUNT
            model[f"{column}{earnings_row}"].font = Font(name="Arial", size=9, color=_GREEN)
        for column in year_columns.values():
            model[f"{column}{earnings_row}"].alignment = Alignment(horizontal="right")
            model[f"{column}{growth_row}"].alignment = Alignment(horizontal="right")
        cursor += 2

    source_total_row = cursor
    after_tax_row = cursor + 1
    model.cell(source_total_row, 1, "Total adjusted earnings on filed source basis")
    model.cell(
        after_tax_row,
        1,
        "Adjusted earnings available to common (after tax)" if ticker == "MET"
        else "Adjusted operating income after tax (normalized tax input)",
    )
    for year, column in year_columns.items():
        segment_cells = ",".join(f"{column}{row}" for row in segment_earnings_rows)
        model[f"{column}{source_total_row}"] = f"=SUM({segment_cells})"
        model[f"{column}{source_total_row}"].number_format = _AMOUNT
        model[f"{column}{source_total_row}"].font = Font(name="Arial", size=9, bold=True)
        if ticker == "MET":
            model[f"{column}{after_tax_row}"] = f"={column}{source_total_row}"
        else:
            model[f"{column}{after_tax_row}"] = f'=IF(\'Input Required\'!$B$3<>"READY","",{column}{source_total_row}*(1-$K$9))'
        model[f"{column}{after_tax_row}"].number_format = _AMOUNT
        model[f"{column}{after_tax_row}"].font = Font(name="Arial", size=9, color=_GREEN)
    model.cell(source_total_row, 1).font = Font(name="Arial", size=9, bold=True)
    model.cell(after_tax_row, 1).font = Font(name="Arial", size=9, bold=True)
    model[f"A{source_total_row + 2}"] = (
        "MET filed adjusted earnings are already after tax and are not taxed again."
        if ticker == "MET" else
        "PRU after-tax values are derived with the normalized tax assumption, not reported by the issuer; the input is applied to both historical and forecast values."
    )
    model.merge_cells(start_row=source_total_row + 2, start_column=1, end_row=source_total_row + 2, end_column=9)
    model[f"A{source_total_row + 2}"].font = Font(name="Arial", size=9, italic=True, color=_GRAY)
    model[f"A{source_total_row + 2}"].alignment = Alignment(wrap_text=True)

    forecast_section = source_total_row + 4
    _style_section(model, forecast_section, "Statutory-capital retention and distributable-earnings schedule")
    row_labels = {
        "capital": forecast_section + 2,
        "cash_available": forecast_section + 3,
        "upstream": forecast_section + 4,
        "distributable": forecast_section + 5,
        "discount": forecast_section + 6,
        "present_value": forecast_section + 7,
    }
    for key, label in (
        ("capital", "Net statutory-capital addition / (release)"),
        ("cash_available", "Cash available before upstream limit"),
        ("upstream", "Permitted upstream dividend capacity"),
        ("distributable", "Distributable earnings"),
        ("discount", "Equity discount factor"),
        ("present_value", "Present value of distributable earnings"),
    ):
        model.cell(row_labels[key], 1, label)
    distributable_row = row_labels["distributable"]
    pv_row = row_labels["present_value"]
    for year in forecast_years:
        column = year_columns[year]
        period = year - base_year
        model[f"{column}{row_labels['capital']}"] = _input_formula(input_cells, "life_net_capital_addition", year, divisor)
        model[f"{column}{row_labels['upstream']}"] = _input_formula(input_cells, "life_permitted_upstream_dividends", year, divisor)
        model[f"{column}{row_labels['cash_available']}"] = f'=IF(\'Input Required\'!$B$3<>"READY","",{column}{after_tax_row}-{column}{row_labels["capital"]})'
        model[f"{column}{distributable_row}"] = (
            f'=IF(\'Input Required\'!$B$3<>"READY","",IF({column}{row_labels["cash_available"]}<0,'
            f'{column}{row_labels["cash_available"]},MIN({column}{row_labels["cash_available"]},{column}{row_labels["upstream"]})))'
        )
        model[f"{column}{row_labels['discount']}"] = f'=IF(\'Input Required\'!$B$3<>"READY","",1/(1+$K$8)^{period})'
        model[f"{column}{pv_row}"] = f'=IF(\'Input Required\'!$B$3<>"READY","",{column}{distributable_row}*{column}{row_labels["discount"]})'
        for row in row_labels.values():
            model[f"{column}{row}"].number_format = _PERCENT if row == row_labels["discount"] else _AMOUNT
            model[f"{column}{row}"].font = Font(name="Arial", size=9, color=_GREEN)

    assumptions = _record(life.get("assumptionSources"))
    model["J4"] = "CAPM and equity-bridge inputs"
    model["J4"].font = Font(name="Arial", size=10, bold=True, color=_WHITE)
    model["J4"].fill = PatternFill("solid", fgColor=_BLUE)
    for coordinate, value in (("K4", "Value"), ("L4", "Source / basis")):
        model[coordinate] = value
        _style_header(model[coordinate])
    market_inputs = (
        (5, "Risk-free rate", life.get("riskFreeRate"), "life_risk_free_rate", _PERCENT, 1.0, "riskFreeRate"),
        (6, "Equity-risk premium", life.get("equityRiskPremium"), "life_equity_risk_premium", _PERCENT, 1.0, "equityRiskPremium"),
        (7, "Beta", life.get("beta"), "life_beta", "0.000x", 1.0, "beta"),
    )
    for row, label, value, key, fmt, scale, source_key in market_inputs:
        model[f"J{row}"] = label
        model[f"K{row}"] = _input_formula(input_cells, key, divisor=scale) if value is None else float(value)
        model[f"K{row}"].number_format = fmt
        model[f"K{row}"].font = Font(name="Arial", size=9, color=_GREEN if value is None else _BLACK)
        model[f"L{row}"] = assumptions.get(source_key, "")
        model[f"L{row}"].alignment = Alignment(wrap_text=True, vertical="top")
    model["J8"] = "Cost of equity (CAPM)"
    model["K8"] = '=IF(OR(K5="",K6="",K7=""),"",K5+K7*K6)'
    model["K8"].number_format = _PERCENT
    model["K8"].font = Font(name="Arial", size=9, bold=True, color=_GREEN)
    model["L8"] = "Risk-free rate + beta × equity-risk premium"
    model["J9"] = "Normalized tax rate"
    if ticker == "PRU":
        model["K9"] = _input_formula(input_cells, "life_normalized_tax_rate")
        model["K9"].number_format = _PERCENT
        model["K9"].font = Font(name="Arial", size=9, color=_GREEN)
        model["L9"] = "Source-required analyst tax conversion for PRU pre-tax adjusted operating income."
    else:
        model["K9"] = "Not applied"
        model["L9"] = "MET adjusted earnings available to common are already after tax."
    model["J10"] = "Terminal growth"
    model["K10"] = _input_formula(input_cells, "terminal_growth_rate")
    model["K10"].number_format = _PERCENT
    model["K10"].font = Font(name="Arial", size=9, color=_GREEN)
    model["L10"] = "Source-required assumption; must be at least 0.5% below cost of equity and no greater than 10%."

    share_divisor = divisor
    for row, label, value, key, fmt, value_divisor, source_key in (
        (11, "Current common share price", life.get("currentPrice"), "life_current_share_price", _PRICE, 1.0, "currentPrice"),
        (12, "Diluted shares outstanding", life.get("dilutedShares"), "life_diluted_shares", _AMOUNT, share_divisor, "dilutedShares"),
    ):
        model[f"J{row}"] = label
        model[f"K{row}"] = _input_formula(input_cells, key, base_year if key == "life_diluted_shares" else None, value_divisor) if value is None else float(value) / value_divisor
        model[f"K{row}"].number_format = fmt
        model[f"K{row}"].font = Font(name="Arial", size=9, color=_GREEN if value is None else _BLACK)
        model[f"L{row}"] = assumptions.get(source_key, "")
        model[f"L{row}"].alignment = Alignment(wrap_text=True, vertical="top")
    model["J13"] = "Market context as of"
    model["K13"] = str(life.get("asOfDate") or "")
    model["L13"] = "Dated market observations are retained with their source references."

    model["J15"] = "Holding-company equity bridge"
    model["J15"].font = Font(name="Arial", size=10, bold=True, color=_WHITE)
    model["J15"].fill = PatternFill("solid", fgColor=_BLUE)
    bridge_inputs = (
        (16, "Parent cash and liquid assets", "life_parent_cash"),
        (17, "Required parent cash reserve", "life_parent_cash_reserve"),
        (18, "Parent-company debt", "life_parent_debt"),
        (19, "Preferred equity claims", "life_preferred_equity"),
        (20, "Noncontrolling interest", "life_non_controlling_interest"),
    )
    for row, label, key in bridge_inputs:
        model[f"J{row}"] = label
        model[f"K{row}"] = _input_formula(input_cells, key, divisor=divisor)
        model[f"K{row}"].number_format = _AMOUNT
        model[f"K{row}"].font = Font(name="Arial", size=9, color=_GREEN)
        model[f"L{row}"] = "Blue input on Input Required; use holding-company amounts and a source or rationale."
        model[f"L{row}"].alignment = Alignment(wrap_text=True, vertical="top")

    output_start = pv_row + 3
    _style_section(model, output_start, "Common-equity DCF valuation")
    output_rows = {
        "terminal_value": output_start + 2,
        "pv_terminal": output_start + 3,
        "pv_forecast": output_start + 4,
        "excess_cash": output_start + 5,
        "parent_debt": output_start + 6,
        "preferred": output_start + 7,
        "nci": output_start + 8,
        "equity_value": output_start + 9,
        "shares": output_start + 10,
        "per_share": output_start + 11,
        "current_price": output_start + 12,
        "upside": output_start + 13,
    }
    for key, label in (
        ("terminal_value", "Terminal value"), ("pv_terminal", "Present value of terminal value"),
        ("pv_forecast", "Present value of forecast distributable earnings"),
        ("excess_cash", "Excess parent cash above reserve"), ("parent_debt", "Less: parent debt"),
        ("preferred", "Less: preferred equity"), ("nci", "Less: noncontrolling interest"),
        ("equity_value", "Common-equity value"), ("shares", "Diluted shares outstanding"),
        ("per_share", "Implied value per share"), ("current_price", "Current share price"),
        ("upside", "Implied upside / (downside)"),
    ):
        model.cell(output_rows[key], 1, label)
    terminal_year_column = year_columns[base_year + 5]
    model[f"B{output_rows['terminal_value']}"] = f'=IF($B$4<>"READY","",{terminal_year_column}{distributable_row}*(1+$K$10)/($K$8-$K$10))'
    model[f"B{output_rows['pv_terminal']}"] = f'=IF($B$4<>"READY","",B{output_rows["terminal_value"]}/(1+$K$8)^5)'
    model[f"B{output_rows['pv_forecast']}"] = f'=IF($B$4<>"READY","",SUM(E{pv_row}:I{pv_row}))'
    model[f"B{output_rows['excess_cash']}"] = '=IF($B$4<>"READY","",MAX($K$16-$K$17,0))'
    model[f"B{output_rows['parent_debt']}"] = '=IF($B$4<>"READY","",$K$18)'
    model[f"B{output_rows['preferred']}"] = '=IF($B$4<>"READY","",$K$19)'
    model[f"B{output_rows['nci']}"] = '=IF($B$4<>"READY","",$K$20)'
    model[f"B{output_rows['equity_value']}"] = (
        f'=IF($B$4<>"READY","",B{output_rows["pv_forecast"]}+B{output_rows["pv_terminal"]}'
        f'+B{output_rows["excess_cash"]}-B{output_rows["parent_debt"]}-B{output_rows["preferred"]}-B{output_rows["nci"]})'
    )
    model[f"B{output_rows['shares']}"] = '=IF($B$4<>"READY","",$K$12)'
    model[f"B{output_rows['per_share']}"] = f'=IF($B$4<>"READY","",B{output_rows["equity_value"]}/B{output_rows["shares"]})'
    model[f"B{output_rows['current_price']}"] = '=IF($B$4<>"READY","",$K$11)'
    model[f"B{output_rows['upside']}"] = f'=IF($B$4<>"READY","",B{output_rows["per_share"]}/B{output_rows["current_price"]}-1)'
    for key, row in output_rows.items():
        cell = model[f"B{row}"]
        cell.font = Font(name="Arial", size=9, bold=key in {"equity_value", "per_share"}, color=_GREEN)
        cell.number_format = _PERCENT if key == "upside" else _PRICE if key in {"per_share", "current_price"} else _AMOUNT
    model[f"B{output_rows['equity_value']}"].font = Font(name="Arial", size=10, bold=True, color=_GREEN)
    model[f"B{output_rows['per_share']}"].font = Font(name="Arial", size=10, bold=True, color=_GREEN)

    status_formula = (
        f'=IF(\'Input Required\'!$B$3<>"READY",\'Input Required\'!$B$3,'
        f'IF(OR(NOT(ISNUMBER($K$8)),$K$8<2%,$K$8>50%,$K$10<0,$K$10>10%,$K$10>=$K$8-0.5%,'
        f'{terminal_year_column}{distributable_row}<=0,$K$16<$K$17),'
        '"INPUT ERROR — check cost of equity, terminal assumptions, terminal distributable earnings, and parent cash reserve","READY"))'
    )
    model["B4"] = status_formula
    model["B4"].font = Font(name="Arial", size=10, bold=True, color=_GREEN)

    sensitivity_row = output_start + 16
    _style_section(model, sensitivity_row, "Per-share sensitivity — cost of equity and terminal growth")
    model[f"A{sensitivity_row + 1}"] = "Cost of equity ↓  /  Terminal growth →"
    growth_columns = list(range(2, 7))
    wacc_rows = list(range(sensitivity_row + 2, sensitivity_row + 7))
    for offset, column_number in enumerate(growth_columns):
        column = get_column_letter(column_number)
        shift = offset - 2
        model[f"{column}{sensitivity_row + 1}"] = f'=IF($B$4<>"READY","",$K$10+({shift})*0.5%)'
        model[f"{column}{sensitivity_row + 1}"].number_format = _PERCENT
        _style_header(model[f"{column}{sensitivity_row + 1}"])
    for offset, row in enumerate(wacc_rows):
        shift = offset - 2
        model[f"A{row}"] = f'=IF($B$4<>"READY","",$K$8+({shift})*0.5%)'
        model[f"A{row}"].number_format = _PERCENT
        model[f"A{row}"].font = Font(name="Arial", size=9, bold=True, color=_BLACK)
        for column_number in growth_columns:
            column = get_column_letter(column_number)
            discounted_flows = "+".join(
                f"{year_columns[year]}{distributable_row}/(1+$A{row})^{year - base_year}"
                for year in forecast_years
            )
            model[f"{column}{row}"] = (
                f'=IF($B$4<>"READY","",IF(OR($A{row}<={column}${sensitivity_row + 1},'
                f'{column}${sensitivity_row + 1}>$A{row}-0.5%,{column}${sensitivity_row + 1}>10%),"",'
                f'({discounted_flows}+{terminal_year_column}{distributable_row}*(1+{column}${sensitivity_row + 1})'
                f'/($A{row}-{column}${sensitivity_row + 1})/(1+$A{row})^5+'
                f'MAX($K$16-$K$17,0)-$K$18-$K$19-$K$20)/$K$12))'
            )
            model[f"{column}{row}"].number_format = _PRICE
            model[f"{column}{row}"].font = Font(name="Arial", size=9, color=_GREEN)
    model[f"A{sensitivity_row + 8}"] = "Sensitivity cells recalculate the five forecast cash flows at each displayed cost of equity and terminal growth."
    model.merge_cells(start_row=sensitivity_row + 8, start_column=1, end_row=sensitivity_row + 8, end_column=9)
    model[f"A{sensitivity_row + 8}"].font = Font(name="Arial", size=9, italic=True, color=_GRAY)
    model[f"A{sensitivity_row + 8}"].alignment = Alignment(wrap_text=True)

    disclosures_start = sensitivity_row + 10
    _style_section(model, disclosures_start, "Filed capital and distribution disclosures (scope retained)", 12)
    disclosure_headers = ("Metric", "Entity / jurisdiction", "Fiscal year", "Reported value", "Unit / scale", "Comparison", "Accession", "Filing / source scope")
    for column, label in enumerate(disclosure_headers, start=1):
        _style_header(model.cell(disclosures_start + 1, column, label))
    disclosure_metrics = {
        "statement_based_combined_rbc_ratio_floor", "naic_based_combined_rbc_ratio_floor",
        "rbc_minimum_regulatory_threshold_floor", "statutory_capital_and_surplus", "statutory_net_income",
        "permitted_ordinary_dividend_without_approval", "paid_upstream_dividend",
    }
    disclosure_row = disclosures_start + 2
    for fact in facts:
        if _fact_value(fact, "metric") not in disclosure_metrics:
            continue
        fact_unit = str(_fact_value(fact, "unit") or "")
        fact_scale = str(_fact_value(fact, "unitScale") or "")
        unit_label = fact_unit if fact_unit == fact_scale else f"{fact_unit} {fact_scale}".strip()
        values = (
            _fact_value(fact, "metric"), _fact_value(fact, "capitalGroup"), _fact_value(fact, "fiscalYear"), _fact_value(fact, "value"),
            unit_label, _fact_value(fact, "comparisonOperator"), _fact_value(fact, "accessionNumber"), _fact_value(fact, "sourceStatement"),
        )
        for column, value in enumerate(values, start=1):
            cell = model.cell(disclosure_row, column, _safe_text(value))
            cell.font = Font(name="Arial", size=8, color=_BLACK)
            cell.alignment = Alignment(vertical="top", wrap_text=column in {2, 8})
        model.cell(disclosure_row, 4).number_format = _PERCENT if _fact_value(fact, "unit") == "ratio" else _AMOUNT
        disclosure_row += 1
    model[f"A{disclosure_row + 1}"] = (
        "The disclosed legal-entity RBC floors, statutory balances, and dividend limits are not consolidated capital-generation or parent cash. "
        "Enter aggregate forecast capital additions and upstream capacity on Input Required with a reconciliation across material entities and jurisdictions."
    )
    model.merge_cells(start_row=disclosure_row + 1, start_column=1, end_row=disclosure_row + 1, end_column=12)
    model[f"A{disclosure_row + 1}"].font = Font(name="Arial", size=9, italic=True, color=_GRAY)
    model[f"A{disclosure_row + 1}"].alignment = Alignment(wrap_text=True, vertical="top")
    model.row_dimensions[disclosure_row + 1].height = 34

    for column, width in {
        "A": 53, "B": 15, "C": 15, "D": 15, "E": 15, "F": 15, "G": 15, "H": 15, "I": 15,
        "J": 31, "K": 17, "L": 66,
    }.items():
        model.column_dimensions[column].width = width
    model.freeze_panes = "E10"
    model.auto_filter.ref = f"A9:I{after_tax_row}"
