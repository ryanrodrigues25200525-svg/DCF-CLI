from __future__ import annotations

from fastapi import APIRouter

from app.services import finance

router = APIRouter()


@router.get("")
async def get_macro_context():
    context = await finance.fetch_market_context()
    return {
        "treasuryYield10Y": context.get("riskFreeRate", 0.045),
        "equityRiskPremium": context.get("equityRiskPremium", 0.055),
        "treasuryRateSource": context.get("treasuryRateSource", "default_4.5pct"),
        "lastUpdated": context.get("lastUpdated"),
    }
