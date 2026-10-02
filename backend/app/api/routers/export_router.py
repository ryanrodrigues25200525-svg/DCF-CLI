from __future__ import annotations

import re

from fastapi import APIRouter, Body, Depends
from fastapi.responses import Response

from app.api.contracts import DcfExportRequest
from app.api.dependencies import get_runtime_services
from app.services.excel_export.service import export_workbook
from app.services.runtime import RuntimeServices

router = APIRouter()


def _sanitize_filename_part(value: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]+', "", value.strip())
    return cleaned or "ticker"


@router.post("/dcf/excel")
async def export_excel(
    payload: DcfExportRequest = Body(...),
    services: RuntimeServices = Depends(get_runtime_services),
) -> Response:
    export_payload = payload.model_dump(by_alias=True, exclude_unset=True)
    workbook_bytes = await export_workbook(export_payload, services)
    company = export_payload.get("company")
    ticker_raw = company.get("ticker") if isinstance(company, dict) else None
    ticker = _sanitize_filename_part(str(ticker_raw or "ticker")).lower()[:20]
    return Response(
        content=workbook_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{ticker}_dcf.xlsx"'},
    )
