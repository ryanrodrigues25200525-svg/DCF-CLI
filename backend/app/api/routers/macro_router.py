from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.dependencies import get_runtime_services
from app.services.runtime import RuntimeServices

router = APIRouter()


@router.get("")
async def get_macro_context(services: RuntimeServices = Depends(get_runtime_services)):
    context = await services.macro.fetch_market_context()
    return {
        "treasuryYield10Y": context.get("riskFreeRate", 0.045),
        "equityRiskPremium": context.get("equityRiskPremium", 0.055),
        "treasuryRateSource": context.get("treasuryRateSource", "default_4.5pct"),
        "lastUpdated": context.get("lastUpdated"),
    }
