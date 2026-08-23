from __future__ import annotations

from datetime import datetime
from typing import Any

from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.worksheet import Worksheet

from .utils import _display_company_label, _safe_set, _safe_set_or_clear


def _map_cover_sheet(cover: Worksheet, payload: dict[str, Any], ticker: str, company_name: str | None) -> None:
    company = payload.get("company", {})
    company = company if isinstance(company, dict) else {}
    ui_meta = payload.get("uiMeta", {})
    ui_meta = ui_meta if isinstance(ui_meta, dict) else {}

    author_name = ui_meta.get("author")
    author_email = ui_meta.get("authorEmail")
    _safe_set(cover, "C9", _display_company_label(company_name, ticker))
    _safe_set_or_clear(cover, "C10", company.get("industry") or company.get("sector") or "Technology")
    _safe_set(cover, "B12", "Scenario")
    _safe_set(cover, "C12", 1)
    _safe_set(cover, "C20", datetime.now().date())
    _safe_set_or_clear(cover, "C24", author_name if isinstance(author_name, str) and author_name.strip() else None)
    _safe_set_or_clear(cover, "C25", author_email if isinstance(author_email, str) and author_email.strip() else None)
    _apply_cover_scenario_validation(cover)



def _apply_cover_scenario_validation(cover: Worksheet) -> None:
    validation = DataValidation(type="list", formula1='"1,2,3"', allow_blank=False)
    validation.errorTitle = "Invalid Scenario"
    validation.error = "Select 1 (Base), 2 (Bull), or 3 (Bear)."
    validation.promptTitle = "Scenario"
    validation.prompt = "1=Base, 2=Bull, 3=Bear"
    cover.add_data_validation(validation)
    validation.add("C12")



def _map_company_labels(
    company_name: str | None,
    ticker: str,
    outputs: Worksheet,
    dcf_base: Worksheet,
    dcf_bull: Worksheet,
    dcf_bear: Worksheet,
    wacc: Worksheet,
    comps_ws: Worksheet,
) -> None:
    label = f"Company {_display_company_label(company_name, ticker)}"
    for sheet in (outputs, dcf_base, dcf_bull, dcf_bear, wacc, comps_ws):
        _safe_set(sheet, "B3", label)



def _map_currency_labels(
    outputs: Worksheet,
    dcf_base: Worksheet,
    dcf_bull: Worksheet,
    dcf_bear: Worksheet,
    wacc: Worksheet,
    comps_ws: Worksheet,
) -> None:
    usd_label = "All $ in USD millions unless otherwise stated"
    for sheet in (outputs, dcf_base, dcf_bull, dcf_bear, wacc, comps_ws):
        _safe_set(sheet, "B4", usd_label)



def _align_income_statement_labels(
    dcf_base: Worksheet,
    dcf_bull: Worksheet,
    dcf_bear: Worksheet,
    data_original: Worksheet,
    data_recalc: Worksheet,
) -> None:
    # Align template labels with website "Performance Matrix" naming.
    for sheet in (dcf_base, dcf_bull, dcf_bear):
        _safe_set(sheet, "B20", "Total Revenue")
        _safe_set(sheet, "B23", "Cost of Revenue")
        _safe_set(sheet, "B24", "Cost of Revenue")
        _safe_set(sheet, "B27", "Other Cost of Revenue")
        _safe_set(sheet, "B36", "Research & Development")
        _safe_set(sheet, "B39", "SG&A")
        _safe_set(sheet, "B42", "D&A (included in Operating)")
        _safe_set(sheet, "B45", "Other Operating Expenses")
        _safe_set(sheet, "B57", "Income Taxes")

    for sheet in (data_original, data_recalc):
        _safe_set(sheet, "B12", "Total Revenue")
        _safe_set(sheet, "B15", "Cost of Revenue")
        _safe_set(sheet, "B16", "Cost of Revenue")
        _safe_set(sheet, "B17", "Other Cost of Revenue")
        _safe_set(sheet, "B24", "Research & Development")
        _safe_set(sheet, "B25", "SG&A")
        _safe_set(sheet, "B26", "D&A (included in Operating)")
        _safe_set(sheet, "B27", "Other Operating Expenses")
        _safe_set(sheet, "B30", "EBIT")
        _safe_set(sheet, "B31", "EBIT Margin")



