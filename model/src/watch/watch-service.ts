import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Filing identity extracted from a unified SEC payload. */
export interface FilingInfo {
  accession: string;
  filedDate: string;
}

/** One row of the watch table, mapped to camelCase. */
export interface WatchStatusEntry {
  ticker: string;
  enabled: boolean;
  updateReady: boolean;
  latestAccession: string | null;
  lastCheck: string | null;
  lastError: string | null;
}

export interface QueueUpdateResult {
  updateReady: boolean;
}

const WATCH_SCHEMA = `
CREATE TABLE IF NOT EXISTS watch (
  ticker TEXT PRIMARY KEY,
  enabled INTEGER,
  last_check TEXT,
  latest_accession TEXT,
  update_ready INTEGER,
  last_error TEXT
)`.trim();

const SNAPSHOTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS snapshots (
  ticker TEXT,
  accession TEXT,
  filed_date TEXT,
  fetched_at TEXT,
  payload_json TEXT,
  PRIMARY KEY (ticker, accession)
)`.trim();

// This module only touches the SQLite library DB (<root>/library.db).
// It never writes workbooks: no .xlsx imports, no output-writer usage by design.

function normalizeTicker(ticker: string): string {
  const normalized = ticker.trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,10}$/.test(normalized)) {
    throw new Error(`Invalid ticker format: ${ticker}`);
  }
  return normalized;
}

function openLibraryDb(root: string): DatabaseSync {
  mkdirSync(root, { recursive: true });
  return new DatabaseSync(join(root, 'library.db'));
}

function ensureTables(db: DatabaseSync): void {
  db.exec(WATCH_SCHEMA);
  db.exec(SNAPSHOTS_SCHEMA);
}

/**
 * Read the accepted accession for a ticker from the library's companies table.
 * Returns null when the table, column, or row is missing (caller treats that
 * as update-ready rather than failing).
 */
function readCompaniesAccession(db: DatabaseSync, ticker: string): string | null {
  let columns: Array<{ name: string }>;
  try {
    columns = db.prepare(`PRAGMA table_info(companies)`).all() as Array<{ name: string }>;
  } catch {
    return null;
  }
  if (columns.length === 0) return null;
  const names = new Set(columns.map((column) => column.name));
  const accessionColumn = names.has('accession')
    ? 'accession'
    : names.has('latest_accession')
      ? 'latest_accession'
      : null;
  if (accessionColumn === null || !names.has('ticker')) return null;
  try {
    const row = db
      .prepare(`SELECT ${accessionColumn} AS accession FROM companies WHERE ticker = ?`)
      .get(ticker) as { accession?: unknown } | undefined;
    return typeof row?.accession === 'string' && row.accession.length > 0 ? row.accession : null;
  } catch {
    return null;
  }
}

function recordWatchError(db: DatabaseSync, ticker: string, error: unknown): void {
  try {
    const now = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(
      `INSERT INTO watch (ticker, enabled, last_check, last_error)
       VALUES (?, 1, ?, ?)
       ON CONFLICT (ticker) DO UPDATE SET
         last_check = excluded.last_check,
         last_error = excluded.last_error`,
    ).run(ticker, now, message.slice(0, 500));
  } catch {
    // Error bookkeeping must never mask the original failure.
  }
}

/**
 * Record a fetched filing snapshot and flag the ticker update-ready when the
 * filing accession differs from the library's accepted accession.
 * Never edits or writes workbooks; it only updates SQLite rows.
 */
export function queueUpdateReady(
  root: string,
  ticker: string,
  filing: FilingInfo,
  snapshotJson: string,
): QueueUpdateResult {
  const normalized = normalizeTicker(ticker);
  if (!filing.accession || !filing.filedDate) {
    throw new Error('Filing accession and filedDate are required.');
  }
  const db = openLibraryDb(root);
  try {
    ensureTables(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO snapshots (ticker, accession, filed_date, fetched_at, payload_json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (ticker, accession) DO UPDATE SET
         filed_date = excluded.filed_date,
         fetched_at = excluded.fetched_at,
         payload_json = excluded.payload_json`,
    ).run(normalized, filing.accession, filing.filedDate, now, snapshotJson);

    const baseAccession = readCompaniesAccession(db, normalized);
    const updateReady = baseAccession === null || baseAccession !== filing.accession;

    const existing = db
      .prepare(`SELECT enabled FROM watch WHERE ticker = ?`)
      .get(normalized) as { enabled?: unknown } | undefined;
    const enabled = typeof existing?.enabled === 'number' ? existing.enabled : 1;
    db.prepare(
      `INSERT INTO watch (ticker, enabled, last_check, latest_accession, update_ready, last_error)
       VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT (ticker) DO UPDATE SET
         last_check = excluded.last_check,
         latest_accession = excluded.latest_accession,
         update_ready = excluded.update_ready,
         last_error = NULL`,
    ).run(normalized, enabled, now, filing.accession, updateReady ? 1 : 0);
    return { updateReady };
  } catch (error) {
    recordWatchError(db, normalized, error);
    throw error;
  } finally {
    db.close();
  }
}

/** Read-only status snapshot for every watched ticker, ordered by ticker. */
export function getWatchStatus(root: string): WatchStatusEntry[] {
  const db = openLibraryDb(root);
  try {
    ensureTables(db);
    const rows = db
      .prepare(
        `SELECT ticker, enabled, last_check, latest_accession, update_ready, last_error
         FROM watch ORDER BY ticker ASC`,
      )
      .all() as Array<{
      ticker: string;
      enabled: number | null;
      last_check: string | null;
      latest_accession: string | null;
      update_ready: number | null;
      last_error: string | null;
    }>;
    return rows.map((row) => ({
      ticker: row.ticker,
      enabled: (row.enabled ?? 1) === 1,
      updateReady: (row.update_ready ?? 0) === 1,
      latestAccession: row.latest_accession,
      lastCheck: row.last_check,
      lastError: row.last_error,
    }));
  } finally {
    db.close();
  }
}

/** Pause (enabled=false) or resume (enabled=true) watch notifications. */
export function setWatchEnabled(root: string, ticker: string, enabled: boolean): void {
  const normalized = normalizeTicker(ticker);
  const db = openLibraryDb(root);
  try {
    ensureTables(db);
    db.prepare(
      `INSERT INTO watch (ticker, enabled)
       VALUES (?, ?)
       ON CONFLICT (ticker) DO UPDATE SET enabled = excluded.enabled`,
    ).run(normalized, enabled ? 1 : 0);
  } finally {
    db.close();
  }
}
