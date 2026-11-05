from __future__ import annotations

from typing import Any

from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.workbook import Workbook

from .review import _map_data_review_sheet


STATUS_SHEET = "Model Status"


def _safe_excel_text(value: Any) -> str:
    text = "" if value is None else str(value)
    return f"'{text}" if text.startswith(("=", "+", "-", "@")) else text


def unsupported_review_note(unsupported: dict[str, Any]) -> str:
    """The single review sentence for an issuer the engine cannot value."""
    reason = str(unsupported.get("reason") or "").strip().rstrip(".")
    model = str(unsupported.get("attemptedModel") or "the preferred model").strip()
    return (
        f"Model status: no valuation produced. {reason or 'This issuer has no production valuation route'}. "
        f"The {model} workbook was not built and no substitute model was applied."
    )


def apply_unsupported_workbook(workbook: Workbook, payload: dict[str, Any]) -> None:
    """Build a status-only workbook for an issuer with no production route.

    The workbook states the classification and refuses a valuation: no
    assumptions, no forecast rows, and no formula elsewhere that could be
    mistaken for a calculated value.
    """
    company = payload.get("company") if isinstance(payload.get("company"), dict) else {}
    unsupported = payload.get("unsupported") if isinstance(payload.get("unsupported"), dict) else {}
    name = str(company.get("name") or "Company")
    ticker = str(company.get("ticker") or "").upper()

    if STATUS_SHEET in workbook.sheetnames:
        workbook.remove(workbook[STATUS_SHEET])
    sheet = workbook.create_sheet(STATUS_SHEET, 0)
    for existing in list(workbook.worksheets):
        if existing is not sheet:
            workbook.remove(existing)
    sheet.sheet_view.showGridLines = False

    sheet["A1"] = f"MODEL STATUS — {name} ({ticker})"
    sheet["A1"].font = Font(name="Arial", size=16, bold=True, color="FFFFFF")
    sheet["A1"].fill = PatternFill("solid", fgColor="17365D")
    sheet.merge_cells("A1:D1")
    sheet.row_dimensions[1].height = 26

    sheet["A2"] = "No valuation has been calculated for this issuer and none should be inferred from this workbook."
    sheet["A2"].font = Font(name="Arial", size=10, italic=True, color="404040")
    sheet.merge_cells("A2:D2")
    sheet.row_dimensions[2].height = 30
    sheet["A2"].alignment = Alignment(wrap_text=True, vertical="top")

    reason = str(unsupported.get("reason") or "This issuer has no production valuation route.")
    attempted = str(unsupported.get("attemptedModel") or "")
    rows = (
        ("Company", name),
        ("Ticker", ticker),
        ("Company type", str(unsupported.get("companyType") or "")),
        ("Subtype", str(unsupported.get("subtype") or "unspecified")),
        ("Build status", "UNSUPPORTED"),
        ("Attempted model", attempted),
        ("Reason", reason),
        (
            "What happens next",
            "Record the classification and take the valuation outside this workbook. "
            "The engine will not substitute a model whose economics do not describe this issuer.",
        ),
    )
    for row, (label, value) in enumerate(rows, start=4):
        label_cell = sheet.cell(row=row, column=1, value=_safe_excel_text(label))
        label_cell.font = Font(name="Arial", size=10, bold=True)
        label_cell.alignment = Alignment(vertical="top")
        value_cell = sheet.cell(row=row, column=2, value=_safe_excel_text(value))
        value_cell.font = Font(name="Arial", size=10, bold=label == "Build status")
        value_cell.alignment = Alignment(wrap_text=True, vertical="top")
        if label == "Build status":
            value_cell.fill = PatternFill("solid", fgColor="FCE4D6")

    sheet.column_dimensions["A"].width = 22
    sheet.column_dimensions["B"].width = 110
    sheet.freeze_panes = "A4"

    ui_meta = payload.get("uiMeta")
    ui_meta = dict(ui_meta) if isinstance(ui_meta, dict) else {}
    warnings = [item for item in (ui_meta.get("warnings") or []) if isinstance(item, str)]
    note = unsupported_review_note(unsupported)
    if note not in warnings:
        warnings.insert(0, note)
    ui_meta["warnings"] = warnings
    payload["uiMeta"] = ui_meta
    _map_data_review_sheet(workbook, payload)
