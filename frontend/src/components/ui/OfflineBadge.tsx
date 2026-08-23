"use client";

import { WifiOff, RefreshCw, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useOfflineSync } from "@/hooks/useOfflineSync";

/**
 * OfflineBadge – a small floating badge that appears when the app is
 * offline or has queued company loads waiting for sync.
 *
 * Shows:
 *   • "Offline – using cached data" when offline
 *   • "Syncing…" while reconnecting
 *   • "N companies queued" when online with pending queue
 */
export function OfflineBadge() {
  const { isOnline, queuedTickers, isSyncing, retryTicker, clearQueue } =
    useOfflineSync();

  const showBadge = !isOnline || isSyncing || queuedTickers.length > 0;

  return (
    <AnimatePresence>
      {showBadge && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="fixed bottom-4 right-4 z-50"
        >
          <div
            className={`
              flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg
              border text-[12px] font-medium
              ${
                !isOnline
                  ? "bg-amber-950/90 border-amber-700/50 text-amber-200"
                  : isSyncing
                    ? "bg-blue-950/90 border-blue-700/50 text-blue-200"
                    : "bg-emerald-950/90 border-emerald-700/50 text-emerald-200"
              }
              backdrop-blur-sm
            `}
          >
            {!isOnline ? (
              <>
                <WifiOff className="w-3.5 h-3.5 shrink-0" />
                <span>Offline – using cached data</span>
              </>
            ) : isSyncing ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />
                <span>Syncing queued data…</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {queuedTickers.length} company
                  {queuedTickers.length !== 1 ? "s" : ""} queued
                </span>
              </>
            )}

            {/* Retry buttons for queued tickers */}
            {!isOnline && queuedTickers.length > 0 && (
              <div className="flex items-center gap-1 ml-1 pl-1 border-l border-amber-700/30">
                {queuedTickers.slice(0, 3).map((ticker) => (
                  <button
                    key={ticker}
                    onClick={() => retryTicker(ticker)}
                    className="px-1.5 py-0.5 rounded bg-amber-800/50 hover:bg-amber-700/60 text-amber-200 text-[10px] transition-colors"
                    title={`Retry ${ticker}`}
                  >
                    {ticker}
                  </button>
                ))}
                {queuedTickers.length > 3 && (
                  <span className="text-amber-400/60 text-[10px]">
                    +{queuedTickers.length - 3}
                  </span>
                )}
              </div>
            )}

            {/* Clear queue when online with pending items */}
            {isOnline && !isSyncing && queuedTickers.length > 0 && (
              <button
                onClick={clearQueue}
                className="ml-1 p-0.5 rounded hover:bg-emerald-800/40 transition-colors"
                title="Clear queue"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
