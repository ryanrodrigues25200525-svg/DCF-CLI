from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from app.infrastructure.repository import FinancialRepository, repository

logger = logging.getLogger("app.services.cache")

CACHE_BACKEND = "sqlite"


async def get_from_cache(key: str, repo: FinancialRepository | None = None) -> Optional[Any]:
    active_repo = repo or repository
    return await active_repo.get(key)


async def set_to_cache(
    key: str,
    data: Any,
    ttl_seconds: int = 3600,
    repo: FinancialRepository | None = None,
) -> None:
    active_repo = repo or repository
    await active_repo.set(key, data, ttl_seconds=ttl_seconds)

def get_cache_stats() -> Dict[str, Any]:
    """Report cache status for health/debug endpoints."""
    return {
        "storage": CACHE_BACKEND,
        "enabled": True,
        "path": repository.db_path,
    }
