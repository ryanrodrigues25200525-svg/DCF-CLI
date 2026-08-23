"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const QUEUE_KEY = "dcf-offline-queue";
const CACHE_PREFIX = "dcf-cache-";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface QueueEntry {
  ticker: string;
  timestamp: number;
  attempts: number;
}

interface CacheEntry {
  data: unknown;
  timestamp: number;
}

// ─── localStorage helpers (SSR-safe) ────────────────────────────────
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readQueue(): QueueEntry[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueueEntry[]): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // localStorage full or unavailable – silently drop
  }
}

/** Persist a company response under dcf-cache-{TICKER}. */
export function cacheCompanyResponse(ticker: string, data: unknown): void {
  if (!isBrowser()) return;
  try {
    const entry: CacheEntry = { data, timestamp: Date.now() };
    localStorage.setItem(`${CACHE_PREFIX}${ticker.toUpperCase()}`, JSON.stringify(entry));
  } catch {
    // quota exceeded – fine, just skip caching
  }
}

/** Read a cached company response if it exists and hasn't expired. */
export function getCachedCompanyResponse<T = unknown>(ticker: string): T | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${ticker.toUpperCase()}`);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(`${CACHE_PREFIX}${ticker.toUpperCase()}`);
      return null;
    }
    return entry.data as T;
  } catch {
    return null;
  }
}

// ─── Queue management ──────────────────────────────────────────────

/** Add a ticker to the offline queue (deduplicates). */
export function enqueueOfflineTicker(ticker: string): void {
  const queue = readQueue();
  const normalized = ticker.trim().toUpperCase();
  if (queue.some((e) => e.ticker === normalized)) return;
  queue.push({ ticker: normalized, timestamp: Date.now(), attempts: 0 });
  writeQueue(queue);
}

/** Remove a ticker from the offline queue. */
function dequeueTicker(ticker: string): void {
  const queue = readQueue().filter((e) => e.ticker !== ticker);
  writeQueue(queue);
}

// ─── React hook ────────────────────────────────────────────────────

export interface OfflineSyncState {
  isOnline: boolean;
  queuedTickers: string[];
  isSyncing: boolean;
}

export interface OfflineSyncActions {
  /** Retry a specific queued ticker. */
  retryTicker: (ticker: string) => void;
  /** Clear the entire queue. */
  clearQueue: () => void;
}

export function useOfflineSync(): OfflineSyncState & OfflineSyncActions {
  const [isOnline, setIsOnline] = useState(() =>
    isBrowser() ? navigator.onLine : true
  );
  const [queuedTickers, setQueuedTickers] = useState<string[]>(() =>
    readQueue().map((e) => e.ticker)
  );
  const [isSyncing, setIsSyncing] = useState(false);

  // A callback ref so syncFn can always call the latest version
  const _retryCallbackRef = useRef<((ticker: string) => void) | null>(null);

  // ── online/offline listeners ────────────────────────────────────
  useEffect(() => {
    if (!isBrowser()) return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // ── sync on reconnect ──────────────────────────────────────────
  useEffect(() => {
    if (!isOnline || !isBrowser()) return;

    const queue = readQueue();
    if (queue.length === 0) return;

    let cancelled = false;

    async function syncAll() {
      setIsSyncing(true);
      try {
        for (const entry of queue) {
          if (cancelled) break;
          // Trigger a fetch for each queued ticker – the component using
          // useCompanyData will pick up the result via react-query.
          try {
            await fetch(`/api/sec/company?ticker=${entry.ticker}`, {
              cache: "no-store",
              headers: { "Cache-Control": "no-cache" },
            });
            dequeueTicker(entry.ticker);
          } catch {
            // Still offline or server unreachable – leave in queue
          }
        }
      } finally {
        if (!cancelled) {
          setQueuedTickers(readQueue().map((e) => e.ticker));
          setIsSyncing(false);
        }
      }
    }

    syncAll();
    return () => { cancelled = true; };
  }, [isOnline]);

  // Keep queuedTickers in sync with localStorage (e.g. after enqueue calls from other hooks)
  useEffect(() => {
    const interval = setInterval(() => {
      setQueuedTickers(readQueue().map((e) => e.ticker));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const retryTicker = useCallback((ticker: string) => {
    const normalized = ticker.trim().toUpperCase();
    if (!isBrowser()) return;
    fetch(`/api/sec/company?ticker=${normalized}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    })
      .then(() => {
        dequeueTicker(normalized);
        setQueuedTickers(readQueue().map((e) => e.ticker));
      })
      .catch(() => {
        // Still failing – keep in queue
      });
  }, []);

  const clearQueue = useCallback(() => {
    writeQueue([]);
    setQueuedTickers([]);
  }, []);

  return {
    isOnline,
    queuedTickers,
    isSyncing,
    retryTicker,
    clearQueue,
  };
}
