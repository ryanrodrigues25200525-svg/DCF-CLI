from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import get_runtime_services
from app.services.runtime import RuntimeServices

router = APIRouter()
logger = logging.getLogger("sec-service")

@router.get("")
async def search_companies(
    query: str = Query(..., min_length=1, max_length=120),
    limit: int = Query(10, ge=1, le=50),
    services: RuntimeServices = Depends(get_runtime_services),
):
    """Search for companies by name or ticker"""
    try:
        # edgar.search_companies is now async
        results = await services.sec.search_companies(query, limit)
        return {"query": query, "results": results}
    except Exception as e:
        logger.error(f"Search error for '{query}': {e}", exc_info=True)
        return {"query": query, "results": []}
