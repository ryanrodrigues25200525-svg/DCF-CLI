from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from json import JSONDecodeError
from typing import Any, Optional

import aiosqlite

logger = logging.getLogger("app.infrastructure.repository")

# Resolve DB path from this file location so runtime CWD does not matter.
BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_DB_PATH = os.path.join(BACKEND_ROOT, "data", "financial_cache.db")
DB_PATH = os.path.abspath(os.path.expanduser(os.getenv("DCF_CACHE_DB_PATH", DEFAULT_DB_PATH)))
CACHE_TTL_DAYS = 90

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)

def _parse_dt(value: str) -> datetime:
    try:
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

class FinancialRepository:
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._initialized = False
        self._init_lock = asyncio.Lock()

    async def initialize(self):
        """Initialize the database schema if it doesn't exist."""
        async with self._init_lock:
            db_dir = os.path.dirname(self.db_path)
            os.makedirs(db_dir, exist_ok=True)
            db_exists = os.path.exists(self.db_path)

            async with aiosqlite.connect(self.db_path) as db:
                # Performance pragmas: WAL allows concurrent reads, NORMAL sync is safe for cache
                await db.execute("PRAGMA journal_mode=WAL;")
                await db.execute("PRAGMA synchronous=NORMAL;")
                await db.execute("PRAGMA busy_timeout=5000;")
                await db.execute("PRAGMA cache_size=-64000;")  # 64MB
                await db.execute("PRAGMA temp_store=MEMORY;")
                await db.execute('''
                    CREATE TABLE IF NOT EXISTS financials (
                        key TEXT PRIMARY KEY,
                        data TEXT,
                        updated_at TIMESTAMP,
                        expires_at TIMESTAMP
                    )
                ''')
                # Index for expiry sweep and prefix scans
                await db.execute("CREATE INDEX IF NOT EXISTS idx_financials_expires ON financials(expires_at);")
                await db.execute("CREATE INDEX IF NOT EXISTS idx_financials_key ON financials(key);")
                await db.commit()

            if not self._initialized or not db_exists:
                logger.info(f"FinancialRepository initialized at {self.db_path}")
            self._initialized = True

    async def _ensure_ready(self):
        """
        Ensure cache storage path and table exist.
        This is called on each operation to self-heal if the DB file/folder was removed.
        """
        if self._initialized and os.path.exists(self.db_path):
            return
        await self.initialize()

    async def get(self, key: str) -> Optional[Any]:
        """Retrieve an item from the async cache."""
        try:
            await self._ensure_ready()
            async with aiosqlite.connect(self.db_path) as db:
                async with db.execute(
                    "SELECT data, expires_at FROM financials WHERE key = ?",
                    (key,)
                ) as cursor:
                    row = await cursor.fetchone()

                    if row:
                        data_str, expires_at_str = row

                        # Check expiry
                        if expires_at_str:
                            expires_at = _parse_dt(expires_at_str)
                            if _now_utc() > expires_at:
                                # Opportunistic cleanup on read path
                                await db.execute("DELETE FROM financials WHERE key = ?", (key,))
                                await db.commit()
                                return None

                        try:
                            return json.loads(data_str)
                        except JSONDecodeError:
                            return data_str
            return None
        except Exception as e:
            logger.error(f"Repository read error for key {key}: {e}")
            return None

    async def set(self, key: str, data: Any, ttl_seconds: int = 3600):
        """Set an item in the async cache."""
        try:
            await self._ensure_ready()
            # Handle Pydantic models
            if hasattr(data, 'model_dump'):
                data_str = json.dumps(data.model_dump())
            elif hasattr(data, 'dict'):
                data_str = json.dumps(data.dict())
            elif isinstance(data, (dict, list)):
                data_str = json.dumps(data)
            else:
                data_str = str(data)

            expires_at = (_now_utc() + timedelta(seconds=ttl_seconds)).isoformat()
            updated_at = _now_utc().isoformat()

            async with aiosqlite.connect(self.db_path) as db:
                await db.execute('''
                    INSERT OR REPLACE INTO financials (key, data, updated_at, expires_at)
                    VALUES (?, ?, ?, ?)
                ''', (key, data_str, updated_at, expires_at))
                await db.commit()
        except Exception as e:
            logger.error(f"Repository write error for key {key}: {e}")

    async def delete(self, key: str):
        """Delete an item from the cache."""
        try:
            await self._ensure_ready()
            async with aiosqlite.connect(self.db_path) as db:
                await db.execute("DELETE FROM financials WHERE key = ?", (key,))
                await db.commit()
        except Exception as e:
            logger.error(f"Repository delete error for key {key}: {e}")

    async def delete_prefix_except(
        self,
        prefix_like: str,
        keep_exact: Optional[str] = None,
        keep_like: Optional[str] = None,
    ) -> int:
        """Delete cache rows by prefix while keeping one exact key or one key pattern."""
        try:
            await self._ensure_ready()
            query = "DELETE FROM financials WHERE key LIKE ?"
            params = [prefix_like]

            if keep_exact:
                query += " AND key != ?"
                params.append(keep_exact)
            if keep_like:
                query += " AND key NOT LIKE ?"
                params.append(keep_like)

            async with aiosqlite.connect(self.db_path) as db:
                cursor = await db.execute(query, tuple(params))
                await db.commit()
                return cursor.rowcount if cursor.rowcount is not None else 0
        except Exception as e:
            logger.error(f"Repository prefix delete error for {prefix_like}: {e}")
            return 0

    async def clear_expired(self):
        """Clean up expired entries."""
        try:
            await self._ensure_ready()
            now = _now_utc().isoformat()
            async with aiosqlite.connect(self.db_path) as db:
                await db.execute("DELETE FROM financials WHERE expires_at < ?", (now,))
                await db.commit()
        except Exception as e:
            logger.error(f"Error clearing expired cache: {e}")

# Global instance for startup/shutdown
repository = FinancialRepository()

async def get_repository() -> FinancialRepository:
    """Dependency for injecting the financial repository."""
    return repository
