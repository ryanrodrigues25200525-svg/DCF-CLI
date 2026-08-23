from __future__ import annotations

import asyncio
import time
from collections import deque
from dataclasses import dataclass


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    limit: int
    remaining: int
    retry_after_seconds: int


class InMemoryRateLimiter:
    def __init__(self, limit: int, window_seconds: int):
        self.limit = max(1, int(limit))
        self.window_seconds = max(1, int(window_seconds))
        self._buckets: dict[str, deque[float]] = {}
        self._lock = asyncio.Lock()
        self._last_cleanup = 0.0

    def _gc_if_needed(self, now: float) -> None:
        # Periodic GC: every 60s or if we have >5000 keys (public API can be scraped)
        if now - self._last_cleanup < 60 and len(self._buckets) <= 5000:
            return
        self._last_cleanup = now
        cutoff = now - self.window_seconds
        dead: list[str] = []
        for k, dq in self._buckets.items():
            while dq and dq[0] <= cutoff:
                dq.popleft()
            if not dq:
                dead.append(k)
        for k in dead:
            self._buckets.pop(k, None)

    async def check(self, key: str) -> RateLimitDecision:
        now = time.time()
        cutoff = now - self.window_seconds

        async with self._lock:
            self._gc_if_needed(now)
            bucket = self._buckets.setdefault(key, deque())

            while bucket and bucket[0] <= cutoff:
                bucket.popleft()

            if len(bucket) >= self.limit:
                retry_after = max(1, int(bucket[0] + self.window_seconds - now))
                return RateLimitDecision(
                    allowed=False,
                    limit=self.limit,
                    remaining=0,
                    retry_after_seconds=retry_after,
                )

            bucket.append(now)
            remaining = max(0, self.limit - len(bucket))
            return RateLimitDecision(
                allowed=True,
                limit=self.limit,
                remaining=remaining,
                retry_after_seconds=0,
            )
