from __future__ import annotations

import copy
from typing import Any

class MockCell:
    def __init__(self, coordinate: str, value: Any = None, sheet: MockWorksheet | None = None):
        self.coordinate = coordinate
        self._value = value
        self._sheet = sheet
        self.data_type = None
        self.comment = None
        self.hyperlink = None
        self._number_format = None
        self._style = None

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, val):
        self._value = val
        if self._sheet is not None:
            self._sheet._record_set(self.coordinate, val)

    @property
    def number_format(self):
        return self._number_format

    @number_format.setter
    def number_format(self, val):
        self._number_format = val
        if self._sheet is not None:
            self._sheet._record_format(self.coordinate, val)

class MockWorksheet:
    def __init__(self, title: str, template_sheet: Any = None):
        self._title = title
        self._cells: dict[str, MockCell] = {}
        self._template_sheet = template_sheet
        self.column_dimensions = MockDimensions(template_sheet.column_dimensions if template_sheet else None)
        self.row_dimensions = {}
        self.sheet_view = MockSheetView()
        self.conditional_formatting = MockConditionalFormatting()
        self._batch_commands: list[dict[str, Any]] = []

    @property
    def title(self) -> str:
        return self._title

    @title.setter
    def title(self, new_title: str) -> None:
        old_title = getattr(self, "_title", None)
        self._title = new_title
        if old_title is not None and old_title != new_title:
            self._batch_commands.append({
                "command": "set",
                "path": f"/{old_title}",
                "props": {"name": new_title}
            })

    def _record_set(self, cell_ref: str, value: Any) -> None:
        if cell_ref in self._cells:
            self._cells[cell_ref]._value = value
        else:
            self._cells[cell_ref] = MockCell(cell_ref, value=value, sheet=self)

        props = {"clear": True}
        # If there is already an in-memory number format for this cell, preserve/apply it
        if self._cells[cell_ref]._number_format is not None:
            props["numberformat"] = self._cells[cell_ref]._number_format

        if isinstance(value, str) and value.startswith("="):
            # Pass as formula property (without the leading '=') for officecli
            props["formula"] = value[1:]
        else:
            if isinstance(value, str) and value.startswith("-") and not value.startswith("- "):
                value = "- "
            props["value"] = value

        self._batch_commands.append({
            "command": "set",
            "path": f"/{self.title}/{cell_ref}",
            "props": props
        })

    def _record_format(self, cell_ref: str, format_code: str) -> None:
        if cell_ref in self._cells:
            self._cells[cell_ref]._number_format = format_code
        else:
            self._cells[cell_ref] = MockCell(cell_ref, sheet=self)
            self._cells[cell_ref]._number_format = format_code

        self._batch_commands.append({
            "command": "set",
            "path": f"/{self.title}/{cell_ref}",
            "props": {
                "numberformat": format_code
            }
        })

    def __getitem__(self, coordinate: str) -> MockCell:
        if isinstance(coordinate, str) and ":" in coordinate:
            # Range requested; return a range wrapper or list if needed
            first_cell = coordinate.split(":")[0]
            if first_cell not in self._cells:
                val = None
                fmt = None
                if self._template_sheet is not None:
                    try:
                        val = self._template_sheet[first_cell].value
                        fmt = self._template_sheet[first_cell].number_format
                    except Exception:
                        pass
                self._cells[first_cell] = MockCell(first_cell, value=val, sheet=self)
                self._cells[first_cell]._number_format = fmt
            return self._cells[first_cell]
        if coordinate not in self._cells:
            val = None
            fmt = None
            if self._template_sheet is not None:
                try:
                    val = self._template_sheet[coordinate].value
                    fmt = self._template_sheet[coordinate].number_format
                except Exception:
                    pass
            self._cells[coordinate] = MockCell(coordinate, value=val, sheet=self)
            self._cells[coordinate]._number_format = fmt
        return self._cells[coordinate]

    @property
    def max_row(self) -> int:
        if self._template_sheet is not None:
            return self._template_sheet.max_row
        return 135

    @property
    def max_column(self) -> int:
        if self._template_sheet is not None:
            return self._template_sheet.max_column
        return 30

    def add_data_validation(self, validation: Any) -> None:
        pass

    def remove(self, element: Any) -> None:
        pass

    def iter_rows(self, min_row: int, max_row: int, min_col: int, max_col: int) -> list[list[MockCell]]:
        rows = []
        for r in range(min_row, max_row + 1):
            row = []
            for c in range(min_col, max_col + 1):
                col_let = chr(64 + c)
                coordinate = f"{col_let}{r}"
                row.append(self[coordinate])
            rows.append(row)
        return rows

class MockSheetView:
    def __init__(self):
        self.topLeftCell = "A1"
        self.selection = [MockSelection()]

class MockSelection:
    def __init__(self):
        self.activeCell = "A1"
        self.sqref = "A1"

class MockConditionalFormatting:
    def __init__(self):
        self.rules: list[dict[str, Any]] = []

    def add(self, range_ref: str, rule: Any) -> None:
        self.rules.append({"range": range_ref, "rule": rule})

class MockWorkbook:
    def __init__(self, sheetnames: list[str], template_wb: Any = None):
        self.sheetnames = list(sheetnames)
        self._sheets: dict[str, MockWorksheet] = {
            name: MockWorksheet(name, template_sheet=template_wb[name] if template_wb and name in template_wb.sheetnames else None)
            for name in sheetnames
        }

    def __getitem__(self, name: str) -> MockWorksheet:
        return self._sheets[name]

    def remove(self, sheet: MockWorksheet) -> None:
        if sheet.title in self._sheets:
            del self._sheets[sheet.title]
            if sheet.title in self.sheetnames:
                self.sheetnames.remove(sheet.title)

    @property
    def worksheets(self) -> list[MockWorksheet]:
        return list(self._sheets.values())

class MockDimension:
    def __init__(self, width: Any = None):
        self.width = width

class MockDimensions:
    def __init__(self, template_dims: Any = None):
        self._dims = {}
        self._template_dims = template_dims

    def __getitem__(self, key: str) -> MockDimension:
        if key not in self._dims:
            width = None
            if self._template_dims and key in self._template_dims:
                width = self._template_dims[key].width
            self._dims[key] = MockDimension(width)
        return self._dims[key]
