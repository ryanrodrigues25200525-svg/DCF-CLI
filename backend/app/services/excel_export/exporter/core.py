from __future__ import annotations

import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path

from io import BytesIO
from openpyxl import load_workbook

from ..mappers import (
    WACC_LOOP_MODE_ITERATIVE,
    apply_payload_to_workbook,
    resolve_wacc_loop_mode,
)
from ..mappers.utils.compatibility import MockWorkbook
from ..template import _TEMPLATE_PATH, load_template_artifact

logger = logging.getLogger(__name__)

def export_dcf_excel(payload: dict) -> bytes:
    # 1. Run mappers on MockWorkbook to collect all batch operations
    template = load_template_artifact()
    template_wb = load_workbook(BytesIO(template.workbook_bytes), data_only=False)
    sheetnames = [
        "Cover",
        "Ouputs - Base",
        "DCF Model - Base (1)",
        "DCF Model - Bull (2)",
        "DCF Model - Bear (3)",
        "WACC",
        "Comps",
        "Assumption Breakdown",
        "Data ->",
        "Data Given (Recalculated)",
        "Original & Adjusted Data",
    ]
    mock_wb = MockWorkbook(sheetnames, template_wb=template_wb)
    apply_payload_to_workbook(mock_wb, payload)

    # 2. Collect commands
    commands = []
    for sheet in mock_wb.worksheets:
        commands.extend(sheet._batch_commands)

    # 3. Add workbook calculation properties and WACC loop mode configuration
    loop_mode = resolve_wacc_loop_mode(payload)
    calc_props = {
        "fullCalcOnLoad": True,
        "forceFullCalc": True,
        "iterate": loop_mode == WACC_LOOP_MODE_ITERATIVE,
    }
    if loop_mode == WACC_LOOP_MODE_ITERATIVE:
        calc_props["iterateCount"] = 100
        calc_props["iterateDelta"] = 0.001

    commands.append({
        "command": "set",
        "path": "/workbook",
        "props": calc_props
    })

    # 4. Invoke officecli in a temp file context
    def json_serializer(obj):
        if hasattr(obj, "isoformat"):
            return obj.isoformat()
        raise TypeError(f"Type {type(obj)} not serializable")

    with tempfile.TemporaryDirectory() as tmpdir:
        temp_input_path = Path(tmpdir) / "input.xlsx"
        temp_input_path.write_bytes(template.workbook_bytes)

        # officecli batch executes all operations in a single process run
        args = ["officecli", "batch", str(temp_input_path), "--commands", json.dumps(commands, default=json_serializer), "--json"]
        logger.info(f"Running officecli: {' '.join(args[:3])} ...")

        # Set ALLOW_STDIN_REDIRECT to suppress the interactive terminal warning
        env = os.environ.copy()
        env["OFFICECLI_BATCH_ALLOW_STDIN_REDIRECT"] = "1"

        try:
            result = subprocess.run(
                args,
                capture_output=True,
                text=True,
                check=True,
                env=env,
            )
        except subprocess.CalledProcessError as err:
            logger.error(f"officecli failed: {err.stderr or err.stdout}")
            raise RuntimeError(f"OfficeCLI export failed: {err.stderr or err.stdout}") from err

        output_bytes = temp_input_path.read_bytes()
        return output_bytes
