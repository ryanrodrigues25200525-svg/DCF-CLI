from __future__ import annotations

import re
from copy import deepcopy
from functools import lru_cache
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from defusedxml import ElementTree as ET
from lxml import etree as LET

from app.services.excel_export.mappers import (
    SHEET_DCF_BASE,
    SHEET_DCF_BEAR,
    SHEET_DCF_BULL,
    SHEET_OUTPUTS,
    SHEET_OUTPUTS_LEGACY,
)

from .xml_utils import _sheet_name_by_path, _template_cell_styles_by_sheet

_TEMPLATE_SHEET_NAME_ALIASES = {
    SHEET_OUTPUTS: SHEET_OUTPUTS_LEGACY
}

_DCF_SCENARIO_SHEET_NAMES = (
    SHEET_DCF_BASE, SHEET_DCF_BULL, SHEET_DCF_BEAR
)

_NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"

_STYLE_SOURCE_OVERRIDES: dict[str, dict[str, str]] = {
    SHEET_DCF_BULL: {
        "F11": "F11", "F13": "F13", "F14": "F14",
        "Q103": "Q103", "C16": "C16", "F9": "F9", "F10": "F10"
    },
    SHEET_DCF_BEAR: {
        "F11": "F11", "F13": "F13", "F14": "F14",
        "Q103": "Q103", "C16": "C16", "F9": "F9", "F10": "F10"
    }
}

def _style_override_source_address(sheet_name: str, address: str) -> str | None:
    overrides = _STYLE_SOURCE_OVERRIDES.get(sheet_name)
    if overrides:
        return overrides.get(address)
    return None

def _restore_template_styles(
    workbook_bytes: bytes,
    template_workbook_bytes: bytes,
    template_styles_xml: bytes,
) -> bytes:
    source = BytesIO(workbook_bytes)
    target = BytesIO()
    (
        patched_styles_xml,
        style_id_overrides_by_sheet,
        template_sheet_xml_by_name,
    ) = _cached_template_style_patch(template_workbook_bytes, template_styles_xml)

    with (
        ZipFile(source, "r") as in_zip,
        ZipFile(target, "w", compression=ZIP_DEFLATED) as out_zip,
    ):
        source_sheet_name_by_path = _sheet_name_by_path(in_zip)

        for item in in_zip.infolist():
            if item.filename == "xl/styles.xml":
                out_zip.writestr(item, patched_styles_xml)
                continue

            if item.filename.startswith("xl/worksheets/sheet"):
                source_name = source_sheet_name_by_path.get(item.filename)
                template_sheet_xml = None
                if source_name:
                    template_sheet_xml = template_sheet_xml_by_name.get(source_name)
                    if template_sheet_xml is None:
                        legacy_name = _TEMPLATE_SHEET_NAME_ALIASES.get(source_name)
                        if legacy_name:
                            template_sheet_xml = template_sheet_xml_by_name.get(legacy_name)
                if template_sheet_xml is not None:
                    patched_sheet = _patch_sheet_style_ids(
                        sheet_xml=in_zip.read(item.filename),
                        template_sheet_xml=template_sheet_xml,
                        sheet_name=source_name,
                        style_id_overrides=style_id_overrides_by_sheet.get(source_name),
                    )
                    out_zip.writestr(item, patched_sheet)
                    continue

            out_zip.writestr(item, in_zip.read(item.filename))

    return target.getvalue()



@lru_cache(maxsize=2)
def _cached_template_style_patch(
    template_workbook_bytes: bytes,
    template_styles_xml: bytes,
) -> tuple[bytes, dict[str, dict[str, str]], dict[str, bytes]]:
    with ZipFile(BytesIO(template_workbook_bytes), "r") as template_zip:
        template_sheet_name_by_path = _sheet_name_by_path(template_zip)
        template_sheet_path_by_name = {name: path for path, name in template_sheet_name_by_path.items()}
        template_cell_styles_by_sheet = _template_cell_styles_by_sheet(template_zip, template_sheet_path_by_name)
        patched_styles_xml, style_id_overrides_by_sheet = _patch_styles_xml(
            template_styles_xml,
            template_cell_styles_by_sheet,
        )
        template_sheet_xml_by_name: dict[str, bytes] = {}
        for sheet_name, sheet_path in template_sheet_path_by_name.items():
            if sheet_path in template_zip.namelist():
                template_sheet_xml_by_name[sheet_name] = template_zip.read(sheet_path)
        return patched_styles_xml, style_id_overrides_by_sheet, template_sheet_xml_by_name



def _patch_styles_xml(
    template_styles_xml: bytes,
    template_cell_styles_by_sheet: dict[str, dict[str, str]],
) -> tuple[bytes, dict[str, dict[str, str]]]:
    ns = {"x": _NS_MAIN}
    parser = LET.XMLParser(resolve_entities=False, no_network=True, recover=False)
    styles_root = LET.fromstring(template_styles_xml, parser=parser)
    currency_num_fmt_id = 185
    millions_num_fmt_id = 186
    no_decimal_currency_num_fmt_id = 5
    no_decimal_millions_num_fmt_id = 3

    cell_xfs = styles_root.find("x:cellXfs", ns)
    if cell_xfs is None:
        return LET.tostring(styles_root, encoding="UTF-8", xml_declaration=True, standalone=True), {}

    xfs = list(cell_xfs.findall("x:xf", ns))
    if not xfs:
        return LET.tostring(styles_root, encoding="UTF-8", xml_declaration=True, standalone=True), {}

    num_fmt_code_by_id: dict[int, str] = {}
    num_fmts = styles_root.find("x:numFmts", ns)
    if num_fmts is not None:
        for num_fmt in num_fmts.findall("x:numFmt", ns):
            raw_id = num_fmt.attrib.get("numFmtId")
            if raw_id is None:
                continue
            try:
                num_fmt_code_by_id[int(raw_id)] = num_fmt.attrib.get("formatCode", "")
            except ValueError:
                continue

    def _ensure_custom_num_fmt(format_code: str, preferred_id: int = 190) -> int:
        nonlocal num_fmts
        for fmt_id, code in num_fmt_code_by_id.items():
            if code == format_code:
                return fmt_id

        if num_fmts is None:
            num_fmts = LET.Element(f"{{{_NS_MAIN}}}numFmts")
            num_fmts.set("count", "0")
            insert_at = 0
            if len(styles_root) > 0 and styles_root[0].tag.endswith("numFmts"):
                styles_root.remove(styles_root[0])
            if len(styles_root) > 0 and styles_root[0].tag.endswith("fonts"):
                styles_root.insert(0, num_fmts)
            else:
                styles_root.insert(insert_at, num_fmts)

        used_ids = set(num_fmt_code_by_id.keys())
        fmt_id = preferred_id
        while fmt_id in used_ids:
            fmt_id += 1

        node = LET.SubElement(num_fmts, f"{{{_NS_MAIN}}}numFmt")
        node.set("numFmtId", str(fmt_id))
        node.set("formatCode", format_code)
        num_fmt_code_by_id[fmt_id] = format_code
        num_fmts.set("count", str(len(num_fmts.findall("x:numFmt", ns))))
        return fmt_id

    # Avoid locale-dependent built-in currency symbols (e.g., AED) in outputs.
    no_decimal_currency_num_fmt_id = _ensure_custom_num_fmt('"$"#,##0_);("$"#,##0);-')

    def _is_percent_style(style_id: int) -> bool:
        if not (0 <= style_id < len(xfs)):
            return False
        num_fmt_id = int(xfs[style_id].attrib.get("numFmtId", "0"))
        if num_fmt_id in {9, 10}:
            return True
        return "%" in num_fmt_code_by_id.get(num_fmt_id, "")

    dcf_base_styles = template_cell_styles_by_sheet.get("DCF Model - Base (1)", {})
    outputs_styles = template_cell_styles_by_sheet.get("Outputs - Base") or template_cell_styles_by_sheet.get("Ouputs - Base", {})
    cover_styles = template_cell_styles_by_sheet.get("Cover", {})
    wacc_styles = template_cell_styles_by_sheet.get("WACC", {})
    dcf_c16_style_id = int(dcf_base_styles.get("C16", "-1"))
    blue_font_anchor_style_id = int(dcf_base_styles.get("F9", "-1"))
    black_font_anchor_style_id = int(dcf_base_styles.get("B20", "0"))
    currency_style_ids = {
        int(dcf_base_styles.get("H20", "-1")),
        int(dcf_base_styles.get("Q94", "-1")),
    }
    for style_id in currency_style_ids:
        if not (0 <= style_id < len(xfs)):
            continue
        xf = xfs[style_id]
        xf.set("numFmtId", str(currency_num_fmt_id))
        xf.set("applyNumberFormat", "1")

    year_style_ids = {
        int(outputs_styles.get("H6", "-1")),
        int((template_cell_styles_by_sheet.get("Data Given (Recalculated)", {})).get("G6", "-1")),
    }
    for style_id in year_style_ids:
        if not (0 <= style_id < len(xfs)):
            continue
        xf = xfs[style_id]
        xf.set("numFmtId", "49")
        xf.set("applyNumberFormat", "1")

    if not (0 <= blue_font_anchor_style_id < len(xfs)):
        return LET.tostring(styles_root, encoding="UTF-8", xml_declaration=True, standalone=True), {}

    blue_font_id = int(xfs[blue_font_anchor_style_id].attrib.get("fontId", "0"))
    black_font_id = 0
    if 0 <= black_font_anchor_style_id < len(xfs):
        black_font_id = int(xfs[black_font_anchor_style_id].attrib.get("fontId", "0"))
    if not (0 <= dcf_c16_style_id < len(xfs)):
        return LET.tostring(styles_root, encoding="UTF-8", xml_declaration=True, standalone=True), {}

    dcf_c16_blue_style_id = _clone_cell_xf_with_font(
        cell_xfs,
        xfs,
        source_style_id=dcf_c16_style_id,
        font_id=blue_font_id,
    )
    dcf_sheet_names = _DCF_SCENARIO_SHEET_NAMES
    style_id_overrides_by_sheet = _initialize_dcf_style_overrides("C16", dcf_c16_blue_style_id)
    style_id_overrides_by_sheet["Cover"] = {}

    currency_clone_by_source: dict[int, int] = {}

    def _currency_style_for(source_style_id: int) -> int:
        cached = currency_clone_by_source.get(source_style_id)
        if cached is not None:
            return cached
        style_id = _clone_cell_xf_with_num_fmt(
            cell_xfs,
            xfs,
            source_style_id=source_style_id,
            num_fmt_id=currency_num_fmt_id,
        )
        currency_clone_by_source[source_style_id] = style_id
        return style_id

    no_decimal_currency_clone_by_source: dict[int, int] = {}

    def _no_decimal_currency_style_for(source_style_id: int) -> int:
        cached = no_decimal_currency_clone_by_source.get(source_style_id)
        if cached is not None:
            return cached
        style_id = _clone_cell_xf_with_num_fmt(
            cell_xfs,
            xfs,
            source_style_id=source_style_id,
            num_fmt_id=no_decimal_currency_num_fmt_id,
        )
        no_decimal_currency_clone_by_source[source_style_id] = style_id
        return style_id

    for address in ("C14", "C15"):
        source_style_raw = cover_styles.get(address)
        if source_style_raw is None:
            continue
        source_style_id = int(source_style_raw)
        if not (0 <= source_style_id < len(xfs)):
            continue
        cover_style_id = _no_decimal_currency_style_for(source_style_id)
        style_id_overrides_by_sheet["Cover"][address] = str(cover_style_id)

    centered_clone_by_source: dict[int, int] = {}
    right_aligned_clone_by_source: dict[int, int] = {}

    def _centered_style_for(source_style_id: int) -> int:
        cached = centered_clone_by_source.get(source_style_id)
        if cached is not None:
            return cached
        style_id = _clone_cell_xf_with_center_alignment(
            cell_xfs,
            xfs,
            source_style_id=source_style_id,
        )
        centered_clone_by_source[source_style_id] = style_id
        return style_id

    def _right_aligned_style_for(source_style_id: int) -> int:
        cached = right_aligned_clone_by_source.get(source_style_id)
        if cached is not None:
            return cached
        style_id = _clone_cell_xf_with_right_alignment(
            cell_xfs,
            xfs,
            source_style_id=source_style_id,
        )
        right_aligned_clone_by_source[source_style_id] = style_id
        return style_id

    border_clone_by_source_and_border: dict[tuple[int, int], int] = {}

    def _style_with_border_from(source_style_id: int, border_style_id: int) -> int:
        border_id = int(xfs[border_style_id].attrib.get("borderId", "0"))
        key = (source_style_id, border_id)
        cached = border_clone_by_source_and_border.get(key)
        if cached is not None:
            return cached
        style_id = _clone_cell_xf_with_border_id(
            cell_xfs,
            xfs,
            source_style_id=source_style_id,
            border_id=border_id,
        )
        border_clone_by_source_and_border[key] = style_id
        return style_id

    currency_rows = (
        list(range(24, 33))
        + list(range(34, 47))
        + list(range(48, 58))
        + list(range(60, 78))
        + list(range(85, 116))
    )
    currency_targets = {"C9"}
    for row in currency_rows:
        for col in "JKLMNOPQ":
            currency_targets.add(f"{col}{row}")

    for address in currency_targets:
        source_style_raw = dcf_base_styles.get(address)
        if source_style_raw is None:
            continue
        source_style_id = int(source_style_raw)
        if not (0 <= source_style_id < len(xfs)):
            continue
        if _is_percent_style(source_style_id):
            continue
        currency_style_id = _currency_style_for(source_style_id)
        _apply_override_to_sheets(style_id_overrides_by_sheet, dcf_sheet_names, address, currency_style_id)

    millions_clone_by_source: dict[int, int] = {}

    def _millions_style_for(source_style_id: int) -> int:
        cached = millions_clone_by_source.get(source_style_id)
        if cached is not None:
            return cached
        style_id = _clone_cell_xf_with_num_fmt(
            cell_xfs,
            xfs,
            source_style_id=source_style_id,
            num_fmt_id=millions_num_fmt_id,
        )
        millions_clone_by_source[source_style_id] = style_id
        return style_id

    percent_source_style_raw = dcf_base_styles.get("F11")
    percent_num_fmt_id = 171
    if percent_source_style_raw is not None:
        percent_source_style_id = int(percent_source_style_raw)
        if 0 <= percent_source_style_id < len(xfs):
            percent_num_fmt_id = int(xfs[percent_source_style_id].attrib.get("numFmtId", "171"))

    percent_clone_by_source: dict[int, int] = {}

    def _percent_style_for(source_style_id: int) -> int:
        cached = percent_clone_by_source.get(source_style_id)
        if cached is not None:
            return cached
        style_id = _clone_cell_xf_with_num_fmt(
            cell_xfs,
            xfs,
            source_style_id=source_style_id,
            num_fmt_id=percent_num_fmt_id,
        )
        percent_clone_by_source[source_style_id] = style_id
        return style_id

    black_font_clone_by_source: dict[int, int] = {}

    def _black_font_style_for(source_style_id: int) -> int:
        cached = black_font_clone_by_source.get(source_style_id)
        if cached is not None:
            return cached
        style_id = _clone_cell_xf_with_font(
            cell_xfs,
            xfs,
            source_style_id=source_style_id,
            font_id=black_font_id,
        )
        black_font_clone_by_source[source_style_id] = style_id
        return style_id

    blue_font_clone_by_source: dict[int, int] = {}

    def _blue_font_style_for(source_style_id: int) -> int:
        cached = blue_font_clone_by_source.get(source_style_id)
        if cached is not None:
            return cached
        style_id = _clone_cell_xf_with_font(
            cell_xfs,
            xfs,
            source_style_id=source_style_id,
            font_id=blue_font_id,
        )
        blue_font_clone_by_source[source_style_id] = style_id
        return style_id

    sensitivity_millions_black_clone_by_source: dict[int, int] = {}

    def _sensitivity_millions_black_style_for(source_style_id: int) -> int:
        cached = sensitivity_millions_black_clone_by_source.get(source_style_id)
        if cached is not None:
            return cached
        num_fmt_style_id = _clone_cell_xf_with_num_fmt(
            cell_xfs,
            xfs,
            source_style_id=source_style_id,
            num_fmt_id=no_decimal_millions_num_fmt_id,
        )
        style_id = _clone_cell_xf_with_font(
            cell_xfs,
            xfs,
            source_style_id=num_fmt_style_id,
            font_id=black_font_id,
        )
        sensitivity_millions_black_clone_by_source[source_style_id] = style_id
        return style_id

    statement_amount_rows = {
        20, 24, 27, 30, 32, 36, 39, 42, 45, 48, 51, 54, 57, 60, 65, 68, 74, 75, 76, 77, 78
    }
    statement_percent_rows = {
        21, 25, 28, 33, 37, 40, 43, 46, 49, 52, 55, 58, 61, 66, 69, 70, 79, 85
    }

    for row in statement_amount_rows:
        for col in "GHIJKLMNOPQ":
            address = f"{col}{row}"
            source_style_raw = dcf_base_styles.get(address)
            if source_style_raw is None:
                continue
            source_style_id = int(source_style_raw)
            if not (0 <= source_style_id < len(xfs)):
                continue
            millions_style_id = _no_decimal_currency_style_for(source_style_id)
            _apply_override_to_sheets(style_id_overrides_by_sheet, dcf_sheet_names, address, millions_style_id)

    for row in statement_percent_rows:
        for col in "GHIJKLMNOPQ":
            address = f"{col}{row}"
            source_style_raw = dcf_base_styles.get(address)
            if source_style_raw is None:
                continue
            source_style_id = int(source_style_raw)
            if not (0 <= source_style_id < len(xfs)):
                continue
            percent_style_id = _percent_style_for(source_style_id)
            _apply_override_to_sheets(style_id_overrides_by_sheet, dcf_sheet_names, address, percent_style_id)

    # Template styles for some percent rows can be inconsistent on historical
    # columns (H/I). Force these rows to percent style across all timeline cols.
    percent_source_fallback = dcf_base_styles.get("F11")
    if percent_source_fallback is not None:
        percent_source_id = int(percent_source_fallback)
        if 0 <= percent_source_id < len(xfs):
            forced_percent_style_id = _percent_style_for(percent_source_id)
            for row in (21, 85):
                for col in "GHIJKLMNOPQ":
                    address = f"{col}{row}"
                    _apply_override_to_sheets(style_id_overrides_by_sheet, dcf_sheet_names, address, forced_percent_style_id)

    sensitivity_percent_style_id: int | None = None
    sensitivity_percent_source = dcf_base_styles.get("C120")
    if sensitivity_percent_source is not None:
        sensitivity_percent_source_id = int(sensitivity_percent_source)
        if 0 <= sensitivity_percent_source_id < len(xfs):
            sensitivity_percent_style_id = _percent_style_for(sensitivity_percent_source_id)
            for address in (
                "D119", "E119", "F119", "G119", "H119",
                "C120", "C121", "C122", "C123", "C124",
                "J119", "K119", "L119", "M119", "N119",
                "I120", "I121", "I122", "I123", "I124",
            ):
                style_id_overrides_by_sheet["DCF Model - Base (1)"][address] = str(sensitivity_percent_style_id)

    # Explicit assumption/formula font semantics (applied late so they survive
    # currency/percent format override passes above):
    # - C9 is formula-driven (black)
    # - F13 is hardcoded input (blue)
    explicit_font_overrides = {
        "C9": _black_font_style_for,
        "F13": _blue_font_style_for,
    }
    for sheet_name in dcf_sheet_names:
        for address, style_fn in explicit_font_overrides.items():
            source_style_raw = style_id_overrides_by_sheet[sheet_name].get(address, dcf_base_styles.get(address))
            if source_style_raw is None:
                continue
            source_style_id = int(source_style_raw)
            if not (0 <= source_style_id < len(xfs)):
                continue
            font_style_id = style_fn(source_style_id)
            style_id_overrides_by_sheet[sheet_name][address] = str(font_style_id)

    outputs_sheet_name = "Outputs - Base"
    if outputs_sheet_name not in style_id_overrides_by_sheet:
        style_id_overrides_by_sheet[outputs_sheet_name] = {}

    outputs_amount_rows = set(range(8, 17)) | set(range(23, 43))
    for row in outputs_amount_rows:
        for col in ("D", *tuple("HIJKLMNOPQ")):
            address = f"{col}{row}"
            source_style_raw = outputs_styles.get(address)
            if source_style_raw is None:
                continue
            source_style_id = int(source_style_raw)
            if not (0 <= source_style_id < len(xfs)):
                continue
            if _is_percent_style(source_style_id):
                continue
            no_decimal_style_id = _no_decimal_currency_style_for(source_style_id)
            style_id_overrides_by_sheet[outputs_sheet_name][address] = str(no_decimal_style_id)

    # Force EBITDA row on Outputs to whole-number currency (no decimals).
    for col in "HIJKLMNOPQ":
        address = f"{col}10"
        source_style_raw = outputs_styles.get(address)
        if source_style_raw is None:
            source_style_raw = outputs_styles.get("H10")
        if source_style_raw is None:
            continue
        source_style_id = int(source_style_raw)
        if not (0 <= source_style_id < len(xfs)):
            continue
        no_decimal_style_id = _no_decimal_currency_style_for(source_style_id)
        style_id_overrides_by_sheet[outputs_sheet_name][address] = str(no_decimal_style_id)

    # Force discount rate row on Outputs to percentage formatting.
    percent_source_raw = outputs_styles.get("J22") or outputs_styles.get("D27")
    if percent_source_raw is not None:
        percent_source_id = int(percent_source_raw)
        if 0 <= percent_source_id < len(xfs):
            outputs_percent_style_id = _percent_style_for(percent_source_id)
            for col in "HIJKLMNOPQ":
                style_id_overrides_by_sheet[outputs_sheet_name][f"{col}22"] = str(outputs_percent_style_id)

    sensitivity_amount_cells = {
        *(f"{col}{row}" for row in range(120, 125) for col in "DEFGH"),
        *(f"{col}{row}" for row in range(120, 125) for col in "JKLMN"),
        *(f"C{row}" for row in range(126, 131)),
        *(f"J{row}" for row in range(126, 131)),
    }
    for address in sensitivity_amount_cells:
        source_style_raw = dcf_base_styles.get(address)
        if source_style_raw is None:
            match = re.fullmatch(r"([A-Z]+)(\d+)", address)
            if match:
                col_letters, row_text = match.groups()
                row_num = int(row_text)
                if col_letters in {"J", "K", "L", "M", "N"} and 120 <= row_num <= 124:
                    source_style_raw = dcf_base_styles.get(f"{_column_number_to_letters(ord(col_letters) - ord('J') + ord('D') - ord('A') + 1)}{row_num}")
                elif col_letters == "J" and 126 <= row_num <= 130:
                    source_style_raw = dcf_base_styles.get(f"C{row_num}")
        if source_style_raw is None:
            continue
        source_style_id = int(source_style_raw)
        if not (0 <= source_style_id < len(xfs)):
            continue
        millions_style_id = _sensitivity_millions_black_style_for(source_style_id)
        _apply_override_to_sheets(style_id_overrides_by_sheet, dcf_sheet_names, address, millions_style_id)

    sensitivity_header_number_cells = {
        *(f"{col}119" for col in "DEFGH"),
        *(f"{col}119" for col in "JKLMN"),
        *(f"I{row}" for row in range(120, 125)),
        *(f"C{row}" for row in range(120, 125)),
    }
    left_sensitivity_header_cells = {f"{col}119" for col in "DEFGH"}
    for address in sensitivity_header_number_cells:
        if address in left_sensitivity_header_cells and sensitivity_percent_style_id is not None:
            black_percent_style_id = _black_font_style_for(sensitivity_percent_style_id)
            _apply_override_to_sheets(style_id_overrides_by_sheet, dcf_sheet_names, address, black_percent_style_id)
            continue
        source_style_raw = dcf_base_styles.get(address)
        if source_style_raw is None:
            continue
        source_style_id = int(source_style_raw)
        if not (0 <= source_style_id < len(xfs)):
            continue
        black_style_id = _black_font_style_for(source_style_id)
        _apply_override_to_sheets(style_id_overrides_by_sheet, dcf_sheet_names, address, black_style_id)

    # Keep sensitivity summary table borders consistent in Bull/Bear by
    # forcing the same border-bearing styles as Base.
    sensitivity_border_cells = {
        *(f"{col}{row}" for col in "BC" for row in range(126, 131)),
        *(f"{col}{row}" for col in "I" for row in range(126, 131)),
    }
    for address in sensitivity_border_cells:
        source_style_raw = dcf_base_styles.get(address)
        match = re.fullmatch(r"([A-Z]+)(\d+)", address)
        if match is None:
            continue
        col_letters, row_text = match.groups()
        row_num = int(row_text)

        # Left table cells can directly inherit base styles.
        if col_letters in {"B", "C"}:
            if source_style_raw is None:
                alt_col = "C" if col_letters == "B" else "B"
                source_style_raw = dcf_base_styles.get(f"{alt_col}{row_num}")
                if source_style_raw is None:
                    continue
            _apply_override_to_sheets(style_id_overrides_by_sheet, dcf_sheet_names, address, source_style_raw)
            continue

        # Right table: keep cell's own number format/font and only borrow border.
        target_style_raw = dcf_base_styles.get(address)
        if target_style_raw is None:
            target_style_raw = dcf_base_styles.get(f"B{row_num}")
        if target_style_raw is None:
            continue
        border_source_raw = dcf_base_styles.get(f"B{row_num}")
        if border_source_raw is None:
            continue
        target_style_id = int(target_style_raw)
        border_source_id = int(border_source_raw)
        if not (0 <= target_style_id < len(xfs) and 0 <= border_source_id < len(xfs)):
            continue
        merged_style_id = _style_with_border_from(target_style_id, border_source_id)
        _apply_override_to_sheets(style_id_overrides_by_sheet, dcf_sheet_names, address, merged_style_id)

    # Right-align timeline year headers in core DCF sections across all scenarios.
    right_aligned_header_cells = {
        *(f"{col}{row}" for row in (18, 63, 72, 89) for col in "HIJKLMNOPQ"),
        *(f"G{row}" for row in (18, 63, 72)),
    }
    for address in right_aligned_header_cells:
        source_style_raw = dcf_base_styles.get(address)
        if source_style_raw is None:
            source_style_raw = dcf_base_styles.get("H18")
        if source_style_raw is None:
            continue
        source_style_id = int(source_style_raw)
        if not (0 <= source_style_id < len(xfs)):
            continue
        right_style_id = _right_aligned_style_for(source_style_id)
        text_right_style_id = _clone_cell_xf_with_num_fmt(
            cell_xfs,
            xfs,
            source_style_id=right_style_id,
            num_fmt_id=49,
        )
        _apply_override_to_sheets(style_id_overrides_by_sheet, dcf_sheet_names, address, text_right_style_id)

    # Right-align FY headers everywhere they appear (Outputs + data sheets).
    outputs_right_aligned_cells = {f"{col}6" for col in "HIJKLMNOPQ"}
    if outputs_sheet_name not in style_id_overrides_by_sheet:
        style_id_overrides_by_sheet[outputs_sheet_name] = {}
    for address in outputs_right_aligned_cells:
        source_style_raw = outputs_styles.get(address)
        if source_style_raw is None:
            source_style_raw = outputs_styles.get("H6")
        if source_style_raw is None:
            continue
        source_style_id = int(source_style_raw)
        if not (0 <= source_style_id < len(xfs)):
            continue
        right_style_id = _right_aligned_style_for(source_style_id)
        # Force textual FY labels even when locale/template fallback styles differ.
        text_right_style_id = _clone_cell_xf_with_num_fmt(
            cell_xfs,
            xfs,
            source_style_id=right_style_id,
            num_fmt_id=49,
        )
        style_id_overrides_by_sheet[outputs_sheet_name][address] = str(text_right_style_id)

    data_recalc_name = "Data Given (Recalculated)"
    data_recalc_styles = template_cell_styles_by_sheet.get(data_recalc_name, {})
    if data_recalc_name not in style_id_overrides_by_sheet:
        style_id_overrides_by_sheet[data_recalc_name] = {}
    for address in {f"{col}6" for col in "GHIJKLMNOP"}:
        source_style_raw = data_recalc_styles.get(address)
        if source_style_raw is None:
            continue
        source_style_id = int(source_style_raw)
        if not (0 <= source_style_id < len(xfs)):
            continue
        style_id_overrides_by_sheet[data_recalc_name][address] = str(_right_aligned_style_for(source_style_id))

    data_original_name = "Original & Adjusted Data"
    data_original_styles = template_cell_styles_by_sheet.get(data_original_name, {})
    if data_original_name not in style_id_overrides_by_sheet:
        style_id_overrides_by_sheet[data_original_name] = {}
    for address in {f"{col}6" for col in ("V", "W", "X", "Y", "Z", "AA", "AB", "AC", "AD", "AE")}:
        source_style_raw = data_original_styles.get(address)
        if source_style_raw is None:
            continue
        source_style_id = int(source_style_raw)
        if not (0 <= source_style_id < len(xfs)):
            continue
        style_id_overrides_by_sheet[data_original_name][address] = str(_right_aligned_style_for(source_style_id))

    # Display present value cash flow line as whole currency amounts (no cents).
    for col in "HIJKLMNOPQ":
        address = f"{col}87"
        source_style_raw = dcf_base_styles.get(address)
        if source_style_raw is None:
            continue
        source_style_id = int(source_style_raw)
        if not (0 <= source_style_id < len(xfs)):
            continue
        no_decimal_style_id = _no_decimal_currency_style_for(source_style_id)
        _apply_override_to_sheets(style_id_overrides_by_sheet, dcf_sheet_names, address, no_decimal_style_id)

    # Keep prior-year (G) headers visually identical to the first timeline
    # header cells so FY2020A doesn't lose bold/heading emphasis.
    for sheet_name in dcf_sheet_names:
        for g_cell, h_cell in (("G18", "H18"), ("G63", "H63"), ("G72", "H72")):
            header_style = style_id_overrides_by_sheet[sheet_name].get(h_cell)
            if header_style is None:
                header_style = dcf_base_styles.get(h_cell)
            if header_style is not None:
                style_id_overrides_by_sheet[sheet_name][g_cell] = header_style

    # Keep WACC peer equity values consistently formatted in millions.
    wacc_equity_cells = {
        *(f"J{row}" for row in range(8, 14)),
        "J16",
        "J17",
        "J18",
        "J19",
        "J23",
    }
    if "WACC" not in style_id_overrides_by_sheet:
        style_id_overrides_by_sheet["WACC"] = {}
    for address in wacc_equity_cells:
        source_style_raw = wacc_styles.get(address)
        if source_style_raw is None:
            continue
        source_style_id = int(source_style_raw)
        if not (0 <= source_style_id < len(xfs)):
            continue
        millions_style_id = _millions_style_for(source_style_id)
        style_id_overrides_by_sheet["WACC"][address] = str(millions_style_id)

    return (
        LET.tostring(styles_root, encoding="UTF-8", xml_declaration=True, standalone=True),
        style_id_overrides_by_sheet,
    )



def _patch_sheet_style_ids(
    sheet_xml: bytes,
    template_sheet_xml: bytes,
    sheet_name: str | None = None,
    style_id_overrides: dict[str, str] | None = None,
) -> bytes:
    ns = {"x": _NS_MAIN}

    source_root = ET.fromstring(sheet_xml)
    template_root = ET.fromstring(template_sheet_xml)

    template_cell_styles = {}
    for cell in template_root.findall(".//x:c", ns):
        address = cell.attrib.get("r")
        if not address:
            continue
        template_cell_styles[address] = cell.attrib.get("s")

    template_row_styles = {}
    for row in template_root.findall(".//x:row", ns):
        row_num = row.attrib.get("r")
        if not row_num:
            continue
        template_row_styles[row_num] = row.attrib.get("s")

    template_col_styles = {}
    for col in template_root.findall(".//x:col", ns):
        min_col = col.attrib.get("min")
        max_col = col.attrib.get("max")
        if not min_col or not max_col:
            continue
        template_col_styles[(min_col, max_col)] = col.attrib.get("style")

    for cell in source_root.findall(".//x:c", ns):
        address = cell.attrib.get("r")
        if not address:
            continue
        forced_style_id = style_id_overrides.get(address) if style_id_overrides else None
        if forced_style_id is not None:
            cell.set("s", forced_style_id)
            continue

        style_override_source = _style_override_source_address(sheet_name, address)
        if style_override_source:
            override_style_id = template_cell_styles.get(style_override_source)
            if override_style_id is None:
                cell.attrib.pop("s", None)
            else:
                cell.set("s", override_style_id)
            continue

        if address in template_cell_styles:
            style_id = template_cell_styles[address]
            if style_id is None:
                cell.attrib.pop("s", None)
            else:
                cell.set("s", style_id)
            continue

        # Fallback only when template does not explicitly define a style for the
        # right-side sensitivity matrix cell.
        mirror_address = _mirror_right_sensitivity_to_left(address)
        if mirror_address:
            mirror_style_id = template_cell_styles.get(mirror_address)
            if mirror_style_id is None:
                cell.attrib.pop("s", None)
            else:
                cell.set("s", mirror_style_id)
            continue

        continue

    for row in source_root.findall(".//x:row", ns):
        row_num = row.attrib.get("r")
        if not row_num or row_num not in template_row_styles:
            continue
        style_id = template_row_styles[row_num]
        if style_id is None:
            row.attrib.pop("s", None)
        else:
            row.set("s", style_id)

    for col in source_root.findall(".//x:col", ns):
        min_col = col.attrib.get("min")
        max_col = col.attrib.get("max")
        if not min_col or not max_col:
            continue
        style_id = template_col_styles.get((min_col, max_col))
        if style_id is None:
            col.attrib.pop("style", None)
        else:
            col.set("style", style_id)

    return ET.tostring(source_root, encoding="utf-8", xml_declaration=True)



def _initialize_dcf_style_overrides(initial_address: str, style_id: int) -> dict[str, dict[str, str]]:
    return {
        sheet_name: {initial_address: str(style_id)}
        for sheet_name in _DCF_SCENARIO_SHEET_NAMES
    }



def _clone_cell_xf_with_font(
    cell_xfs,
    xfs,
    *,
    source_style_id: int,
    font_id: int,
) -> int:
    source_xf = xfs[source_style_id]
    if int(source_xf.attrib.get("fontId", "0")) == font_id:
        source_xf.set("applyFont", "1")
        return source_style_id

    clone = deepcopy(source_xf)
    clone.set("fontId", str(font_id))
    clone.set("applyFont", "1")
    cell_xfs.append(clone)
    xfs.append(clone)
    cell_xfs.set("count", str(len(xfs)))
    return len(xfs) - 1



def _clone_cell_xf_with_num_fmt(
    cell_xfs,
    xfs,
    *,
    source_style_id: int,
    num_fmt_id: int,
) -> int:
    source_xf = xfs[source_style_id]
    if int(source_xf.attrib.get("numFmtId", "0")) == num_fmt_id:
        source_xf.set("applyNumberFormat", "1")
        return source_style_id

    clone = deepcopy(source_xf)
    clone.set("numFmtId", str(num_fmt_id))
    clone.set("applyNumberFormat", "1")
    cell_xfs.append(clone)
    xfs.append(clone)
    cell_xfs.set("count", str(len(xfs)))
    return len(xfs) - 1



def _clone_cell_xf_with_center_alignment(
    cell_xfs,
    xfs,
    *,
    source_style_id: int,
) -> int:
    source_xf = xfs[source_style_id]
    alignment = source_xf.find(f"{{{_NS_MAIN}}}alignment")
    if alignment is not None and alignment.attrib.get("horizontal") == "center":
        source_xf.set("applyAlignment", "1")
        return source_style_id

    clone = deepcopy(source_xf)
    clone_alignment = clone.find(f"{{{_NS_MAIN}}}alignment")
    if clone_alignment is None:
        clone_alignment = LET.Element(f"{{{_NS_MAIN}}}alignment")
        clone.append(clone_alignment)
    clone_alignment.set("horizontal", "center")
    clone_alignment.set("vertical", "center")
    clone.set("applyAlignment", "1")
    cell_xfs.append(clone)
    xfs.append(clone)
    cell_xfs.set("count", str(len(xfs)))
    return len(xfs) - 1



def _clone_cell_xf_with_right_alignment(
    cell_xfs,
    xfs,
    *,
    source_style_id: int,
) -> int:
    source_xf = xfs[source_style_id]
    alignment = source_xf.find(f"{{{_NS_MAIN}}}alignment")
    if alignment is not None and alignment.attrib.get("horizontal") == "right":
        source_xf.set("applyAlignment", "1")
        return source_style_id

    clone = deepcopy(source_xf)
    clone_alignment = clone.find(f"{{{_NS_MAIN}}}alignment")
    if clone_alignment is None:
        clone_alignment = LET.Element(f"{{{_NS_MAIN}}}alignment")
        clone.append(clone_alignment)
    clone_alignment.set("horizontal", "right")
    clone_alignment.set("vertical", "center")
    clone.set("applyAlignment", "1")
    cell_xfs.append(clone)
    xfs.append(clone)
    cell_xfs.set("count", str(len(xfs)))
    return len(xfs) - 1



def _clone_cell_xf_with_border_id(
    cell_xfs,
    xfs,
    *,
    source_style_id: int,
    border_id: int,
) -> int:
    source_xf = xfs[source_style_id]
    if int(source_xf.attrib.get("borderId", "0")) == border_id:
        source_xf.set("applyBorder", "1")
        return source_style_id

    clone = deepcopy(source_xf)
    clone.set("borderId", str(border_id))
    clone.set("applyBorder", "1")
    cell_xfs.append(clone)
    xfs.append(clone)
    cell_xfs.set("count", str(len(xfs)))
    return len(xfs) - 1



def _apply_override_to_sheets(
    overrides_by_sheet: dict[str, dict[str, str]],
    sheet_names: list[str],
    address: str,
    style_id: int | str
) -> None:
    for sheet_name in sheet_names:
        if sheet_name not in overrides_by_sheet:
            overrides_by_sheet[sheet_name] = {}
        overrides_by_sheet[sheet_name][address] = str(style_id)



def _mirror_right_sensitivity_to_left(address: str) -> str | None:
    match = re.fullmatch(r"([A-Z]+)(\d+)", address)
    if not match:
        return None
    col, row = match.groups()
    row_num = int(row)
    if not (120 <= row_num <= 130):
        return None

    # Map JKLMN back to DEFGH
    col_map = {"J": "D", "K": "E", "L": "F", "M": "G", "N": "H"}
    if col in col_map:
        return f"{col_map[col]}{row}"

    # Map right-side summary table headers back to left
    if col == "I" and 120 <= row_num <= 124:
        return f"C{row}"

    return None



def _column_number_to_letters(n: int) -> str:
    result = ""
    while n > 0:
        n, remainder = divmod(n - 1, 26)
        result = chr(65 + remainder) + result
    return result



