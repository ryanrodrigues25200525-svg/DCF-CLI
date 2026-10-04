from __future__ import annotations

import math
import re
from typing import Any

from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.workbook import Workbook
from openpyxl.worksheet.worksheet import Worksheet
from .incomplete import gate_formulas_on_ready, require_input_destination

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
_MONEY_FORMAT = '#,##0.0;[Red](#,##0.0);-'
_PERCENT_FORMAT = '0.0%;[Red](0.0%);0.0%'
_MULTIPLE_FORMAT = '0.0x;[Red](0.0x);-'
_PER_SHARE_FORMAT = '$0.00;[Red]($0.00);-'
_PRICE_FORMAT = '$#,##0.00;[Red]($#,##0.00);-'
_SHARES_FORMAT = '#,##0.0;[Red](#,##0.0);-'

_MORTGAGE_REIT_FIELDS = (
    'investment_securities_fair_value', 'total_assets', 'repo_and_other_debt', 'total_liabilities',
    'total_stockholders_equity', 'net_book_value_per_common_share', 'tangible_book_value_per_common_share',
    'period_end_common_shares', 'preferred_equity_carrying_value', 'preferred_equity_liquidation_preference',
    'gaap_interest_income', 'gaap_interest_expense', 'gaap_net_interest_income', 'economic_interest_income',
    'economic_interest_expense', 'other_gain_net', 'operating_expenses', 'net_income', 'preferred_dividends',
    'net_income_available_to_common', 'other_comprehensive_income', 'comprehensive_income',
    'comprehensive_income_available_to_common', 'common_dividends_per_share', 'average_investment_securities_at_cost',
    'average_tba_dollar_roll_position_at_cost', 'average_total_assets_fair_value', 'average_repo_borrowings',
    'average_mortgage_borrowings', 'average_stockholders_equity', 'average_at_risk_leverage',
    'period_end_at_risk_leverage', 'economic_return_on_tangible_common_equity', 'expenses_pct_average_assets',
    'average_asset_yield', 'average_aggregate_cost_of_funds', 'average_net_interest_spread',
    'average_swap_notional', 'average_swap_ratio', 'average_swap_net_pay_rate',
)

_HISTORICAL_ROWS: dict[int, tuple[str, str, str]] = {
    5: ('gaap_interest_income', 'GAAP interest income', 'money'),
    6: ('gaap_interest_expense', 'GAAP interest expense', 'money'),
    7: ('gaap_net_interest_income', 'GAAP net interest income', 'money'),
    8: ('economic_interest_income', 'Economic interest income (non-GAAP)', 'money'),
    9: ('economic_interest_expense', 'Economic interest expense (non-GAAP)', 'money'),
    11: ('average_asset_yield', 'Filed average asset yield', 'percent'),
    12: ('average_aggregate_cost_of_funds', 'Filed average aggregate cost of funds', 'percent'),
    13: ('average_net_interest_spread', 'Filed average net interest spread', 'percent'),
    15: ('average_investment_securities_at_cost', 'Average investment securities at cost', 'money'),
    16: ('average_tba_dollar_roll_position_at_cost', 'Average net TBA dollar roll position at cost', 'money'),
    17: ('average_mortgage_borrowings', 'Average mortgage borrowings, including TBA', 'money'),
    18: ('average_stockholders_equity', 'Average stockholders’ equity', 'money'),
    19: ('average_at_risk_leverage', 'Average tangible net book value at-risk leverage', 'multiple'),
    20: ('average_swap_notional', 'Average interest rate swap notional', 'money'),
    21: ('average_swap_ratio', 'Average swap ratio to mortgage borrowings', 'percent'),
    22: ('average_swap_net_pay_rate', 'Average swap net pay / (receive) rate', 'percent'),
    23: ('operating_expenses', 'Operating expenses', 'money'),
    24: ('preferred_dividends', 'Preferred dividends', 'money'),
    25: ('net_income_available_to_common', 'Net income available to common', 'money'),
    26: ('common_dividends_per_share', 'Common dividends per share', 'per_share'),
    27: ('net_book_value_per_common_share', 'Net book value per common share', 'per_share'),
    28: ('tangible_book_value_per_common_share', 'Tangible net book value per common share', 'per_share'),
    29: ('preferred_equity_liquidation_preference', 'Preferred stock liquidation preference', 'money'),
    30: ('period_end_common_shares', 'Period-end common shares', 'shares'),
    31: ('total_assets', 'Total assets', 'money'),
    32: ('repo_and_other_debt', 'Repo and other debt', 'money'),
    33: ('total_stockholders_equity', 'Total stockholders’ equity', 'money'),
    34: ('total_liabilities', 'Total liabilities', 'money'),
}

_ASSUMPTION_INPUTS = (
    (6, 'Asset yield', 'assetYield', 'percent'),
    (7, 'Annual asset yield change', 'assetYieldChange', 'percent'),
    (8, 'Aggregate cost of funds', 'aggregateCostOfFunds', 'percent'),
    (9, 'Annual pre-hedge funding cost change', 'fundingCostChange', 'percent'),
    (10, 'Average investment assets / common equity', 'investmentAssetsToCommonEquity', 'multiple'),
    (11, 'Average mortgage borrowings / common equity', 'mortgageBorrowingsToCommonEquity', 'multiple'),
    (12, 'Other income / average investment assets', 'otherIncomePctAverageAssets', 'percent'),
    (13, 'Operating expenses / average total assets', 'operatingExpensesPctAverageAssets', 'percent'),
    (14, 'Preferred dividend yield', 'preferredDividendYield', 'percent'),
    (15, 'Common earnings payout ratio', 'payoutRatio', 'percent'),
    (16, 'Annual dividend growth cap', 'dividendPerShareGrowth', 'percent'),
    (17, 'Tangible book market-value change / share', 'marketValueChangePerShare', 'per_share'),
    (18, 'Entity-level cash tax rate', 'taxRate', 'percent'),
    (19, 'Cost of equity', 'costOfEquity', 'percent'),
    (20, 'Terminal residual-income growth', 'terminalGrowthRate', 'percent'),
    (21, 'Period-end common shares (millions)', 'commonSharesOutstanding', 'shares_millions'),
    (22, 'Latest tangible book value / common share', 'commonBookValuePerShare', 'per_share'),
    (23, 'Preferred liquidation preference (USD mm)', 'preferredLiquidationPreference', 'money_millions'),
    (24, 'Current common share price', 'currentPrice', 'price'),
    (25, 'Average swap ratio / mortgage borrowings', 'averageSwapRatio', 'percent'),
    (26, 'Annual swap ratio change', 'swapRatioChange', 'percent'),
    (32, 'Average swap net pay / (receive) rate', 'averageSwapNetPayRate', 'percent'),
    (33, 'Annual swap net pay-rate change', 'swapNetPayRateChange', 'percent'),
)


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _finite(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ValueError(f"Mortgage REIT workbook requires a finite value for {name}.")
    return float(value)


def _line_value(line: Any, name: str, year: int, *, allow_missing: bool = False) -> float | None:
    record = _record(line)
    if record.get('source') == 'missing' and allow_missing:
        return None
    if record.get('source') not in {'sec_native', 'derived'}:
        raise ValueError(f"FY{year} mortgage REIT input {name} is missing or ambiguous.")
    value = _finite(record.get('value'), name)
    sources = record.get('sources')
    if not isinstance(sources, list) or not sources or any(not _record(source).get('accession') or not _record(source).get('filed') for source in sources):
        raise ValueError(f"FY{year} mortgage REIT input {name} has incomplete SEC provenance.")
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
    cell.alignment = Alignment(vertical='center', wrap_text=wrap)
    if number_format:
        cell.number_format = number_format


def _section(sheet: Worksheet, row: int, title: str, end_column: int = 15) -> None:
    for column in range(1, end_column + 1):
        cell = sheet.cell(row=row, column=column)
        cell.fill = _SECTION_FILL
        cell.font = _SECTION_FONT
    sheet.cell(row=row, column=1, value=title)


def _number_format(kind: str) -> str:
    return {
        'money': _MONEY_FORMAT,
        'percent': _PERCENT_FORMAT,
        'multiple': _MULTIPLE_FORMAT,
        'per_share': _PER_SHARE_FORMAT,
        'shares': _SHARES_FORMAT,
        'shares_millions': _SHARES_FORMAT,
        'money_millions': _MONEY_FORMAT,
        'price': _PRICE_FORMAT,
    }[kind]


def _display_value(value: float, kind: str) -> float:
    if kind in {'money', 'shares'}:
        return value / 1_000_000
    return value


def _validate_model(model: dict[str, Any]) -> tuple[list[dict[str, Any]], list[int], dict[str, Any]]:
    history = _record(model.get('history'))
    rows, years, assumptions = history.get('annual'), history.get('years'), _record(model.get('assumptions'))
    if not isinstance(rows, list) or len(rows) != 4 or not isinstance(years, list) or len(years) != 4:
        raise ValueError('Mortgage REIT workbook requires four annual periods with an opening book-value observation.')
    annual = [_record(row) for row in rows]
    if [row.get('year') for row in annual] != years or any(
        isinstance(year, bool) or not isinstance(year, int) or (index > 0 and year != years[index - 1] + 1)
        for index, year in enumerate(years)
    ):
        raise ValueError('Mortgage REIT workbook years are not four aligned consecutive fiscal periods.')
    if _finite(assumptions.get('forecastYears'), 'forecastYears') != 5:
        raise ValueError('Mortgage REIT workbook requires a five-year forecast.')
    if _finite(assumptions.get('baseYear'), 'baseYear') != years[-1]:
        raise ValueError('Mortgage REIT workbook base year must match the latest filed annual period.')
    if not isinstance(assumptions.get('asOfDate'), str) or not re.fullmatch(r'20\d{2}-\d{2}-\d{2}', assumptions['asOfDate']):
        raise ValueError('Mortgage REIT workbook requires a dated market snapshot.')
    sources = _record(assumptions.get('assumptionSources'))
    if any(not isinstance(value, str) or not value.strip() for value in sources.values()):
        raise ValueError('Mortgage REIT workbook requires filed provenance or an analyst-input disclosure for every assumption.')
    return annual, years, assumptions


def _map_assumptions(sheet: Worksheet, assumptions: dict[str, Any], history_years: list[int]) -> None:
    _write(sheet, 'M4', 'Editable forecast assumptions and current market inputs')
    sheet['M4'].fill = _SECTION_FILL
    sheet['M4'].font = _SECTION_FONT
    _write(sheet, 'M5', 'Blue font = editable analyst input or current market data', wrap=True)
    sheet['M5'].font = _SMALL_FONT
    for row, label, key, kind in _ASSUMPTION_INPUTS:
        value = _finite(assumptions.get(key), key)
        if kind in {'money_millions', 'shares_millions'}:
            value /= 1_000_000
        _write(sheet, f'M{row}', label)
        _write(sheet, f'N{row}', value, input_cell=True, number_format=_number_format(kind))
        source = _record(assumptions.get('assumptionSources')).get(key)
        if source:
            _write(sheet, f'O{row}', source, wrap=True)
            sheet.row_dimensions[row].height = max(15, 13 * math.ceil(len(source) / 90))
    _write(sheet, 'M19', 'Cost of equity — CAPM')
    _write(sheet, 'N19', '=N27+N28*N29', formula=True, number_format=_PERCENT_FORMAT)
    _write(sheet, 'O19', _record(assumptions.get('assumptionSources')).get('costOfEquity'), wrap=True)
    _write(sheet, 'M22', 'Latest tangible book value / common share')
    _write(sheet, 'N22', '=E28', formula=True, number_format=_PER_SHARE_FORMAT)
    _write(sheet, 'O22', f'Linked to FY{history_years[-1]} filed tangible net book value per common share.', wrap=True)
    _write(sheet, 'M27', 'Risk-free rate')
    _write(sheet, 'N27', _finite(assumptions.get('riskFreeRate'), 'riskFreeRate'), input_cell=True, number_format=_PERCENT_FORMAT)
    _write(sheet, 'O27', _record(assumptions.get('assumptionSources')).get('costOfEquity'), wrap=True)
    _write(sheet, 'M28', 'Equity risk premium')
    _write(sheet, 'N28', _finite(assumptions.get('equityRiskPremium'), 'equityRiskPremium'), input_cell=True, number_format=_PERCENT_FORMAT)
    _write(sheet, 'O28', _record(assumptions.get('assumptionSources')).get('costOfEquity'), wrap=True)
    _write(sheet, 'M29', 'Levered beta')
    _write(sheet, 'N29', _finite(assumptions.get('beta'), 'beta'), input_cell=True, number_format='0.00x')
    _write(sheet, 'O29', _record(assumptions.get('assumptionSources')).get('costOfEquity'), wrap=True)
    for row in (19, 27, 28, 29):
        note = str(sheet[f'O{row}'].value or '')
        sheet.row_dimensions[row].height = max(sheet.row_dimensions[row].height or 15, 13 * math.ceil(len(note) / 90))
    _write(sheet, 'M30', 'Latest common dividend / share')
    _write(sheet, 'N30', '=E26', formula=True, number_format=_PER_SHARE_FORMAT)
    _write(sheet, 'O30', f'Linked to FY{history_years[-1]} filed common dividend per share.', wrap=True)
    _write(sheet, 'M31', 'Market and ERP as-of date')
    _write(sheet, 'N31', assumptions['asOfDate'], input_cell=True)
    _write(sheet, 'O31', 'Current market price, beta, risk-free rate, and ERP were captured within 24 hours.', wrap=True)
    _write(sheet, 'M34', 'Implied funding cost before swap adjustment')
    _write(sheet, 'N34', '=N8-N25*N32', formula=True, number_format=_PERCENT_FORMAT)
    _write(sheet, 'O34', 'Derived from filed aggregate cost of funds less the filed average swap ratio × average net pay/(receive) rate; it is the forecast base before editable annual funding and hedge changes.', wrap=True)


def _map_historical_model(sheet: Worksheet, annual: list[dict[str, Any]], years: list[int]) -> None:
    for index, item in enumerate(annual):
        column = chr(ord('B') + index)
        year = int(item['year'])
        reit = _record(item.get('mortgageReit') or item.get('mortgage_reit'))
        for row, (field, label, kind) in _HISTORICAL_ROWS.items():
            value = _line_value(reit.get(field), label, year, allow_missing=(index == 0 or field == 'total_liabilities'))
            if value is not None:
                _write(sheet, f'{column}{row}', _display_value(value, kind), number_format=_number_format(kind))
        _write(sheet, f'{column}10', f'=IF(OR({column}8="",{column}9=""),"",{column}8-{column}9)', formula=True, number_format=_MONEY_FORMAT)
        for row, formula in (
            (14, f'=IF(OR({column}11="",{column}12="",{column}13=""),"",{column}11-{column}12-{column}13)'),
            (35, f'=IF(OR({column}30="",{column}29=""),"",IFERROR({column}27-({column}33-{column}29)/{column}30,""))'),
            (36, f'=IF(OR({column}31="",{column}33="",{column}34=""),"",{column}31-{column}33-{column}34)'),
        ):
            number_format = _PER_SHARE_FORMAT if row == 35 else _PERCENT_FORMAT if row == 14 else _MONEY_FORMAT
            _write(sheet, f'{column}{row}', formula, formula=True, number_format=number_format)
        sheet.cell(row=4, column=2 + index, value=f'FY{year}A').font = _HEADER_FONT
        sheet.cell(row=4, column=2 + index).fill = _HEADER_FILL


def _map_forecast(sheet: Worksheet, years: list[int]) -> None:
    for index, column in enumerate('FGHIJ', start=1):
        previous = chr(ord(column) - 1)
        year = years[-1] + index
        _write(sheet, f'{column}4', f'FY{year}E')
        sheet[f'{column}4'].font = _HEADER_FONT
        sheet[f'{column}4'].fill = _HEADER_FILL
        _write(sheet, f'{column}38', f'={"$N$22" if index == 1 else previous + "61"}', formula=True, number_format=_PER_SHARE_FORMAT)
        _write(sheet, f'{column}39', f'={column}38*$N$21', formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f'{column}40', f'={column}39*$N$10', formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f'{column}41', f'={column}39*$N$11', formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f'{column}42', f'=$N$6+{index}*$N$7', formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f'{column}43', f'={column}40*{column}42', formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f'{column}44', f'=$N$25+{index}*$N$26', formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f'{column}45', f'=$N$32+{index}*$N$33', formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f'{column}46', f'={column}44*{column}45', formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f'{column}47', f'=$N$34+{index}*$N$9', formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f'{column}48', f'={column}47+{column}46', formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f'{column}49', f'={column}41*{column}48', formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f'{column}50', f'={column}43-{column}49', formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f'{column}51', f'={column}40*$N$12', formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f'{column}52', f'={column}40*$N$13', formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f'{column}53', '=$N$23*$N$14', formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f'{column}54', f'={column}50+{column}51-{column}52-{column}53', formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f'{column}55', f'=MAX(0,{column}54)*$N$18', formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f'{column}56', f'={column}54-{column}55', formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f'{column}57', f'={column}56/$N$21', formula=True, number_format=_PER_SHARE_FORMAT)
        _write(sheet, f'{column}58', '=$N$15', formula=True, number_format=_PERCENT_FORMAT)
        previous_dividend = '$N$30' if index == 1 else f'{previous}59'
        _write(sheet, f'{column}59', f'=MIN(MAX(0,{column}57)*{column}58,MAX(0,{previous_dividend}*(1+$N$16)))', formula=True, number_format=_PER_SHARE_FORMAT)
        _write(sheet, f'{column}60', '=$N$17', formula=True, number_format=_PER_SHARE_FORMAT)
        _write(sheet, f'{column}61', f'={column}38+{column}57-{column}59+{column}60', formula=True, number_format=_PER_SHARE_FORMAT)
        _write(sheet, f'{column}62', f'={column}57-$N$19*{column}38', formula=True, number_format=_PER_SHARE_FORMAT)
        _write(sheet, f'{column}63', f'=1/(1+$N$19)^{index}', formula=True, number_format=_PERCENT_FORMAT)
        _write(sheet, f'{column}64', f'={column}62*{column}63', formula=True, number_format=_PER_SHARE_FORMAT)
        _write(sheet, f'{column}65', f'={column}50-({column}43-{column}49)', formula=True, number_format=_MONEY_FORMAT)
        _write(sheet, f'{column}66', f'={column}61-({column}38+{column}57-{column}59+{column}60)', formula=True, number_format=_PER_SHARE_FORMAT)


def _map_valuation_summary(sheet: Worksheet) -> None:
    _section(sheet, 68, 'Common equity residual-income valuation', 10)
    summary = (
        (69, 'Terminal residual income / share', '=J62*(1+$N$20)/($N$19-$N$20)', _PER_SHARE_FORMAT),
        (70, 'Present value of terminal residual income / share', '=B69*J63', _PER_SHARE_FORMAT),
        (71, 'Implied value / common share', '=N22+SUM(F64:J64)+B70', _PRICE_FORMAT),
        (72, 'Implied common equity value (USD mm)', '=B71*N21', _MONEY_FORMAT),
        (73, 'Current common share price', '=N24', _PRICE_FORMAT),
        (74, 'Upside / (downside)', '=B71/B73-1', _PERCENT_FORMAT),
    )
    for row, label, formula, number_format in summary:
        _write(sheet, f'A{row}', label)
        _write(sheet, f'B{row}', formula, formula=True, number_format=number_format)
    _write(sheet, 'D69', 'Valuation basis')
    _write(sheet, 'E69', 'Common equity / tangible book', input_cell=True)
    _write(sheet, 'D70', 'Enterprise value')
    _write(sheet, 'E70', 'Not applicable', input_cell=True)
    _section(sheet, 77, 'Implied value / share sensitivity — cost of equity vs. terminal growth', 7)
    for index, column in enumerate('CDEFG', start=-2):
        _write(sheet, f'{column}78', f'=$N$20+{index}*0.005', formula=True, number_format=_PERCENT_FORMAT)
    for row, delta in zip(range(79, 84), (-0.01, -0.005, 0, 0.005, 0.01), strict=True):
        _write(sheet, f'B{row}', f'=$N$19+({delta})', formula=True, number_format=_PERCENT_FORMAT)
        for column in 'CDEFG':
            formula = (
                f'=$N$22+$F$62/(1+$B{row})^1+$G$62/(1+$B{row})^2+$H$62/(1+$B{row})^3+'
                f'$I$62/(1+$B{row})^4+$J$62/(1+$B{row})^5+'
                f'$J$62*(1+{column}$78)/($B{row}-{column}$78)/(1+$B{row})^5'
            )
            _write(sheet, f'{column}{row}', formula, formula=True, number_format=_PRICE_FORMAT)


def _source_rows(payload: dict[str, Any], model: dict[str, Any]) -> list[list[Any]]:
    result: list[list[Any]] = []
    history = _record(model.get('history'))
    annual = history.get('annual') if isinstance(history.get('annual'), list) else []
    for item in annual:
        annual_record = _record(item)
        year = annual_record.get('year')
        reit = _record(annual_record.get('mortgageReit') or annual_record.get('mortgage_reit'))
        for field in _MORTGAGE_REIT_FIELDS:
            line = _record(reit.get(field))
            sources = line.get('sources') if isinstance(line.get('sources'), list) else []
            if sources:
                for source in sources:
                    source = _record(source)
                    result.append([
                        year, field, line.get('value'), source.get('reported_value'), source.get('unit'), source.get('unit_scale'),
                        line.get('source'), line.get('method'), line.get('concept'), source.get('label'), source.get('statement'),
                        source.get('fiscal_period'), source.get('accession'), source.get('filed'), source.get('report_date'),
                    ])
            else:
                result.append([year, field, line.get('value'), None, None, None, line.get('source'), line.get('method'), line.get('concept'), None, None, None, None, None, None])
    assumptions = _record(model.get('assumptions'))
    for field, value in _record(assumptions.get('assumptionSources')).items():
        result.append(['Assumption', field, assumptions.get(field), None, None, None, 'analyst_input_or_market', value, None, None, None, None, None, assumptions.get('asOfDate'), None])
    return result


def _map_data_review(workbook: Workbook, payload: dict[str, Any], model: dict[str, Any]) -> None:
    sheet = workbook.create_sheet('Data Review')
    sheet.sheet_view.showGridLines = False
    sheet.freeze_panes = 'A2'
    headers = ['Fiscal year', 'Canonical field', 'Canonical value', 'Reported value', 'Unit', 'Scale', 'Source type', 'Normalization / method', 'SEC concept', 'Filed label', 'Source statement', 'Fiscal period', 'Accession', 'Filed date', 'Report date']
    sheet.append(headers)
    for cell in sheet[1]:
        cell.font = _HEADER_FONT
        cell.fill = _HEADER_FILL
        cell.alignment = Alignment(wrap_text=True, vertical='center')
    for row in _source_rows(payload, model):
        sheet.append(row)
    widths = [14, 42, 20, 18, 16, 14, 22, 48, 42, 52, 52, 16, 24, 15, 15]
    for index, width in enumerate(widths, start=1):
        sheet.column_dimensions[chr(ord('A') + index - 1)].width = width
    for row in range(2, sheet.max_row + 1):
        for cell in sheet[row]:
            cell.font = _BODY_FONT
            cell.alignment = Alignment(vertical='top', wrap_text=cell.column >= 8)
            if cell.column in (3, 4) and isinstance(cell.value, (int, float)) and not isinstance(cell.value, bool):
                if cell.value == 0 or abs(cell.value) >= 0.005:
                    cell.number_format = '#,##0.00'
        wrapped_text = [str(sheet.cell(row=row, column=column).value or '') for column in range(8, 12)]
        line_count = max((math.ceil(len(value) / widths[column - 1]) for column, value in zip(range(8, 12), wrapped_text, strict=True)), default=1)
        sheet.row_dimensions[row].height = max(15, min(60, 12 * line_count))
    sheet.auto_filter.ref = sheet.dimensions
    sheet.row_dimensions[1].height = 34
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_setup.orientation = 'landscape'
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0


def apply_mortgage_reit_model(workbook: Workbook, payload: dict[str, Any]) -> None:
    model = _record(payload.get('mortgageReitModel'))
    annual, years, assumptions = _validate_model(model)
    for existing in list(workbook.worksheets):
        workbook.remove(existing)
    sheet = workbook.create_sheet('Mortgage REIT Model')
    sheet.sheet_view.showGridLines = False
    sheet.freeze_panes = 'F5'
    sheet.column_dimensions['A'].width = 55
    for column in 'BCDEFGHIJ':
        sheet.column_dimensions[column].width = 15
    sheet.column_dimensions['K'].width = 3
    sheet.column_dimensions['L'].width = 3
    sheet.column_dimensions['M'].width = 48
    sheet.column_dimensions['N'].width = 17
    sheet.column_dimensions['O'].width = 76
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_setup.orientation = 'landscape'
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_view.zoomScale = 85
    company = _record(payload.get('company'))
    ticker, name = str(company.get('ticker') or '').upper(), str(company.get('name') or company.get('ticker') or 'Company')
    sheet.merge_cells('A1:O1')
    sheet['A1'] = f'{name} ({ticker}) — Agency Mortgage REIT Residual-Income Model'
    sheet['A1'].font = Font(name='Arial', size=16, bold=True, color='FFFFFF')
    sheet['A1'].fill = _TITLE_FILL
    sheet.row_dimensions[1].height = 28
    sheet.merge_cells('A2:O2')
    sheet['A2'] = 'USD actuals display in millions; per-share data display in USD. Filed data are black, formula cells are green, and editable assumptions or current market inputs are blue.'
    sheet['A2'].font = _SMALL_FONT
    sheet['A2'].alignment = Alignment(wrap_text=True, vertical='top')
    sheet.row_dimensions[2].height = 30
    _section(sheet, 3, 'Historical GAAP and economic funding schedules; formula-driven residual-income forecast')
    sheet.cell(row=4, column=1, value='Filed schedule / fiscal year').font = _HEADER_FONT
    sheet['A4'].fill = _HEADER_FILL
    for row, (field, label, kind) in _HISTORICAL_ROWS.items():
        sheet.cell(row=row, column=1, value=label).font = Font(name='Arial', size=10, bold=field in {'gaap_net_interest_income', 'economic_interest_income', 'economic_interest_expense', 'tangible_book_value_per_common_share'})
    for row, label in (
        (10, 'Economic net interest income (derived check)'),
        (14, 'Asset yield less cost of funds less reported spread check'),
        (35, 'Reported net book value bridge check'),
        (36, 'Assets less liabilities and stockholders’ equity check (USD mm)'),
        (37, 'Forecast schedule — balances, economic income, common earnings, and book value'),
        (38, 'Beginning tangible book value / common share'),
        (39, 'Beginning tangible common equity capital base (USD mm)'),
        (40, 'Average investment assets (USD mm)'),
        (41, 'Average mortgage borrowings (USD mm)'),
        (42, 'Asset yield'),
        (43, 'Economic interest income (USD mm)'),
        (44, 'Average swap ratio / mortgage borrowings'),
        (45, 'Average swap net pay / (receive) rate'),
        (46, 'Swap hedge cost / (benefit) as % of borrowings'),
        (47, 'Funding cost before swap adjustment'),
        (48, 'Effective aggregate cost of funds after hedge'),
        (49, 'Economic interest expense (USD mm)'),
        (50, 'Economic net interest income (USD mm)'),
        (51, 'Other income / (loss) (USD mm)'),
        (52, 'Operating expenses (USD mm)'),
        (53, 'Preferred dividends (USD mm)'),
        (54, 'Pre-tax income available to common (USD mm)'),
        (55, 'Taxes (USD mm)'),
        (56, 'Net income available to common (USD mm)'),
        (57, 'Earnings per common share'),
        (58, 'Common payout ratio'),
        (59, 'Common dividend per share'),
        (60, 'Tangible book value market change / share'),
        (61, 'Ending tangible book value / common share'),
        (62, 'Residual income / common share'),
        (63, 'Discount factor'),
        (64, 'Present value of residual income / common share'),
        (65, 'Economic net interest income formula check (USD mm)'),
        (66, 'Tangible book roll-forward check / share'),
    ):
        sheet.cell(row=row, column=1, value=label).font = Font(name='Arial', size=10, bold=row in (10, 46, 52, 57, 58, 60))
    for row, title in ((4, 'Historical schedule'), (37, 'Forecast schedule'), (68, 'Common-equity valuation')):
        _section(sheet, row, title)
    _map_historical_model(sheet, annual, years)
    _map_forecast(sheet, years)
    _map_assumptions(sheet, assumptions, years)
    _map_valuation_summary(sheet)
    _map_data_review(workbook, payload, model)
    for row in (10, 14, 35, 36):
        sheet.cell(row=row, column=1).font = Font(name='Arial', size=10, italic=True, color='404040')
    sheet.auto_filter.ref = 'A4:J34'
    sheet.print_title_rows = '1:4'
    sheet.print_area = 'A1:O83'
    sheet.sheet_properties.pageSetUpPr.fitToPage = True


def apply_incomplete_mortgage_reit_model(
    workbook: Workbook,
    payload: dict[str, Any],
    input_cells: dict[str, dict[str, str]],
) -> None:
    """Expose the missing filed repo balance and withhold dependent outputs."""
    sheet = workbook['Mortgage REIT Model']
    requirement, destination = require_input_destination(
        payload, input_cells, 'average_repo_borrowings',
        missing_message='Incomplete mortgage REIT workbook requires an average_repo_borrowings input.',
        destination_message='Incomplete mortgage REIT workbook has no editable average repo borrowings input cell.',
    )
    value_ref = f"'Input Required'!{destination['cell']}"
    status_ref = "'Input Required'!$B$3"
    sheet['M35'] = 'Filed average repo borrowings (USD mm)'
    sheet['M35'].font = _BODY_FONT
    sheet['N35'] = f'=IF(AND({status_ref}="READY",ISNUMBER({value_ref}),{value_ref}>0),{value_ref}/1000000,"")'
    sheet['N35'].font = _FORMULA_FONT
    sheet['N35'].fill = _FORMULA_FILL
    sheet['N35'].number_format = _MONEY_FORMAT
    sheet['O35'] = f"Linked to Input Required!{destination['cell']}; entered value is USD actuals and displayed here in USD millions."
    sheet['O35'].font = _SMALL_FONT
    sheet['O35'].alignment = Alignment(wrap_text=True, vertical='top')

    formula_cells = [
        f'{column}{row}'
        for column in 'FGHIJ'
        for row in range(38, 67)
    ]
    formula_cells.extend(f'B{row}' for row in (*range(69, 73), 74))
    formula_cells.extend(f'{column}{row}' for row in range(79, 84) for column in 'CDEFG')
    formula_cells.append('E14')
    gate_formulas_on_ready(sheet, status_ref, formula_cells)
