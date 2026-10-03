#!/usr/bin/env node
/** Local stdio MCP server for the DCF model library (read-only inspection +
 * side-effect-free proposals; never edits workbooks, performs no valuation
 * math, and makes no network calls). */
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

interface StatementSync {
  all(...params: unknown[]): Row[];
  run(...params: unknown[]): { lastInsertRowid: bigint | number };
}
interface DatabaseLike {
  prepare(sql: string): StatementSync;
  exec(sql: string): void;
  close(): void;
}
type DatabaseSyncCtor = new (path?: string, options?: { readOnly?: boolean }) => DatabaseLike;

let cachedCtor: DatabaseSyncCtor | null | undefined;
function getDatabaseCtor(): DatabaseSyncCtor | null {
  if (cachedCtor !== undefined) return cachedCtor;
  try {
    const mod = createRequire(import.meta.url)('node:sqlite') as Row;
    cachedCtor = (typeof mod['DatabaseSync'] === 'function' ? mod['DatabaseSync'] : null) as DatabaseSyncCtor | null;
  } catch {
    cachedCtor = null; // older Node: degrade to empty results, never crash
  }
  return cachedCtor;
}

type Row = Record<string, unknown>;
type RpcId = string | number | null | undefined;
interface ToolDef { name: string; description: string; inputSchema: Row }
type McpErr = { code: string; message: string };

const SERVER_VERSION = '2.0.0';
const PREVIEW_LIMIT = 4000;
const DB_CANDIDATES = ['library.db', 'models.db', 'dcf-library.db', 'dcf.db', 'index.db'];
const PROPOSALS_DDL = `CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY,
ticker TEXT, base_revision_hash TEXT, status TEXT, created_at TEXT, payload_json TEXT)`;

/* ---------- models-dir resolution (reuses library config when present) ---------- */
function fallbackModelsDir(): string {
  if (process.env.DCF_MODELS_DIR?.trim()) return resolve(process.env.DCF_MODELS_DIR.trim());
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.config', 'dcf-builder', 'config.json'), 'utf8')) as Row;
    for (const k of ['modelsDir', 'models_dir']) {
      if (typeof cfg[k] === 'string' && (cfg[k] as string).trim()) return resolve((cfg[k] as string).trim());
    }
  } catch { /* use default */ }
  return join(homedir(), 'DCF-Models');
}

async function resolveModelsDir(): Promise<string> {
  try {
    const spec: string = '../library/config.js'; // same module the library workstream provides
    const mod = (await import(spec)) as Row;
    if (typeof mod['resolveModelsDir'] === 'function') {
      const dir = (mod['resolveModelsDir'] as () => unknown)();
      if (typeof dir === 'string' && dir.trim()) return resolve(dir.trim());
    }
  } catch { /* library not present yet — same precedence, resolved locally */ }
  return fallbackModelsDir();
}

/* ---------- defensive SQLite helpers (missing tables => empty, never crash) ---------- */
function openDb(modelsDir: string, readOnly: boolean): DatabaseLike | null {
  const Ctor = getDatabaseCtor();
  if (!Ctor) return null;
  for (const name of DB_CANDIDATES) {
    const p = join(modelsDir, name);
    if (!existsSync(p)) continue;
    try { return readOnly ? new Ctor(p, { readOnly: true }) : new Ctor(p); }
    catch { /* try next candidate */ }
  }
  return null;
}

function tryQuery(modelsDir: string, sql: string, ...params: unknown[]): Row[] {
  const db = openDb(modelsDir, true);
  if (!db) return [];
  try { return db.prepare(sql).all(...params); }
  catch { return []; }
  finally { try { db.close(); } catch { /* ignore */ } }
}

function tableColumns(db: DatabaseLike, table: string): string[] {
  try {
    return db.prepare('SELECT name FROM pragma_table_info(?)').all(table)
      .map((r) => String(r['name']));
  } catch { return []; }
}

/** Whether `table` exists in the library DB open read-only (null when the DB cannot be read; creates nothing). */
function libraryTableExists(modelsDir: string, table: string): boolean | null {
  const db = openDb(modelsDir, true);
  if (!db) return null;
  try {
    return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").all(table).length > 0;
  } catch { return null; }
  finally { try { db.close(); } catch { /* ignore */ } }
}

/** Case-insensitive lookup so minor schema renames never crash the server. */
function pick(row: Row, ...keys: string[]): unknown {
  for (const k of keys) if (k in row) return row[k];
  const lower: Row = {};
  for (const k of Object.keys(row)) lower[k.toLowerCase()] = row[k];
  for (const k of keys) if (lower[k.toLowerCase()] !== undefined) return lower[k.toLowerCase()];
  return undefined;
}

const asText = (v: unknown): string | null =>
  v === null || v === undefined ? null : typeof v === 'string' ? v : String(v);

function err(code: string, message: string): McpErr { return { code, message }; }
function isErr(e: unknown): e is McpErr {
  return !!e && typeof e === 'object'
    && typeof (e as Row)['code'] === 'string' && typeof (e as Row)['message'] === 'string';
}
function normTicker(t: unknown): string {
  if (typeof t !== 'string' || !t.trim()) throw err('INVALID_TICKER', 'ticker is required');
  return t.trim().toUpperCase();
}
function companyRows(modelsDir: string, ticker: string): Row[] {
  return tryQuery(modelsDir, 'SELECT * FROM companies WHERE ticker = ? LIMIT 1', ticker)
    .concat(tryQuery(modelsDir, 'SELECT * FROM companies WHERE symbol = ? LIMIT 1', ticker));
}
function latestSnapshotRow(modelsDir: string, ticker: string, accession?: string): Row | null {
  const qs: Array<[string, unknown[]]> = accession
    ? [[
        'SELECT * FROM snapshots WHERE ticker = ? AND (accession = ? OR accession_number = ?) LIMIT 1',
        [ticker, accession, accession],
      ]]
    : [
        ['SELECT * FROM snapshots WHERE ticker = ? ORDER BY rowid DESC LIMIT 1', [ticker]],
        ['SELECT * FROM snapshots WHERE symbol = ? ORDER BY rowid DESC LIMIT 1', [ticker]],
      ];
  for (const [sql, params] of qs) {
    const rows = tryQuery(modelsDir, sql, ...params);
    if (rows.length > 0) return rows[0];
  }
  return null;
}
const snapView = (s: Row): Row => ({
  accession: asText(pick(s, 'accession', 'accession_number')),
  filedDate: asText(pick(s, 'filed_date', 'filedDate', 'filing_date')),
  fetchedAt: asText(pick(s, 'fetched_at', 'fetchedAt', 'created_at')),
});

/* ---------- tools ---------- */
async function toolModelsList(args: Row): Promise<unknown> {
  void args;
  const modelsDir = await resolveModelsDir();
  return {
    modelsDir,
    models: tryQuery(modelsDir, 'SELECT * FROM companies').map((r) => ({
      ticker: asText(pick(r, 'ticker', 'symbol')),
      route: asText(pick(r, 'route', 'model_route', 'modelRoute')),
      readiness: asText(pick(r, 'readiness', 'readiness_status', 'status')) ?? 'unknown',
      builtAt: asText(pick(r, 'built_at', 'builtAt', 'build_date', 'updated_at')),
    })).filter((m) => m.ticker),
  };
}

async function toolModelInspect(args: Row): Promise<unknown> {
  const ticker = normTicker(args['ticker']);
  const modelsDir = await resolveModelsDir();
  let manifest: Row | null = null;
  for (const n of ['manifest.json', `${ticker}.json`]) {
    const p = join(modelsDir, 'companies', ticker, n);
    if (!existsSync(p)) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(p, 'utf8'));
      if (parsed && typeof parsed === 'object') { manifest = parsed as Row; break; }
    } catch { /* ignore corrupt manifest */ }
  }
  const company = companyRows(modelsDir, ticker)[0] ?? null;
  if (!manifest && !company) throw err('MODEL_NOT_FOUND', `No model found for ticker ${ticker}`);
  let revisionsCount = 0;
  for (const col of ['ticker', 'symbol']) {
    const rows = tryQuery(modelsDir, `SELECT COUNT(*) AS n FROM revisions WHERE ${col} = ?`, ticker);
    const n = rows[0] ? Number(rows[0]['n']) : NaN;
    if (Number.isFinite(n)) { revisionsCount = n; break; }
  }
  const snap = latestSnapshotRow(modelsDir, ticker);
  let manifestHashMatch: boolean | null = null;
  if (manifest) {
    try {
      const p = join(modelsDir, 'companies', ticker, 'current.xlsx');
      const stored = (manifest as Row)['workbookHash'] ?? (manifest as Row)['workbook_hash'];
      if (existsSync(p) && typeof stored === 'string' && stored) {
        manifestHashMatch = createHash('sha256').update(readFileSync(p)).digest('hex') === stored;
      } else if (!existsSync(p)) {
        manifestHashMatch = false;
      }
    } catch { manifestHashMatch = null; }
  }
  let workbookSummary: Row | null = null;
  try {
    const mod = await import('../workbook/xlsx.js') as {
      findBackendPython(): string | null;
      inspectWorkbook(p: string, w: string): Promise<{
        sheets: string[]; formulaCount: number; cachedErrorCells: string[];
        hasInputRequiredSheet: boolean; inputRequiredStatus: string | null; dataReviewRows: number;
      }>;
    };
    const python = mod.findBackendPython();
    const workbookPath = join(modelsDir, 'companies', ticker, 'current.xlsx');
    if (python && existsSync(workbookPath)) {
      const inspection = await mod.inspectWorkbook(python, workbookPath);
      workbookSummary = {
        sheetCount: inspection.sheets.length,
        sheets: inspection.sheets,
        formulaCount: inspection.formulaCount,
        cachedErrorCount: inspection.cachedErrorCells.length,
        cachedErrorCells: inspection.cachedErrorCells.slice(0, 20),
        hasInputRequiredSheet: inspection.hasInputRequiredSheet,
        inputRequiredStatus: inspection.inputRequiredStatus,
        dataReviewRows: inspection.dataReviewRows,
      };
    }
  } catch { workbookSummary = null; }
  return { ticker, manifest, manifestHashMatch, workbookSummary, company, revisionsCount, latestSnapshotAccession: snap ? snapView(snap).accession : null };
}

async function toolFilingLatest(args: Row): Promise<unknown> {
  const ticker = normTicker(args['ticker']);
  const modelsDir = await resolveModelsDir();
  const snap = latestSnapshotRow(modelsDir, ticker);
  let updateReady = false;
  let lastCheck: string | null = null;
  for (const col of ['ticker', 'symbol']) {
    const rows = tryQuery(modelsDir, `SELECT * FROM watch WHERE ${col} = ? LIMIT 1`, ticker);
    if (rows.length > 0) {
      const f = pick(rows[0], 'update_ready', 'updateReady', 'update_needed');
      updateReady = f === true || f === 1 || f === '1' || f === 'true';
      lastCheck = asText(pick(rows[0], 'last_check', 'lastCheck'));
      break;
    }
  }
  const fetchedAt = snap ? asText(pick(snap, 'fetched_at', 'fetchedAt', 'created_at')) : null;
  let ageHours: number | null = null;
  let stale = true;
  if (fetchedAt) {
    const parsed = Date.parse(fetchedAt);
    if (!Number.isNaN(parsed)) {
      ageHours = Math.max(0, (Date.now() - parsed) / 3_600_000);
      stale = ageHours > 24;
    }
  }
  return { ticker, snapshot: snap ? snapView(snap) : null, updateReady, fetchedAt, ageHours, stale, lastCheck };
}

async function toolWorkbookReadCells(args: Row): Promise<unknown> {
  const ticker = normTicker(args['ticker']);
  const refs = args['refs'];
  if (!Array.isArray(refs) || refs.length === 0 || refs.length > 50) {
    throw err('INVALID_REFS', 'refs must be a non-empty array of at most 50 {sheet, cell} references');
  }
  const normalized = (refs as Row[]).map((r, i) => {
    if (!r || typeof r !== 'object') throw err('INVALID_REFS', `refs[${i}] must be an object`);
    const sheet = (r as Row)['sheet'];
    const cell = (r as Row)['cell'];
    if (typeof sheet !== 'string' || !sheet.trim()) throw err('INVALID_REFS', `refs[${i}].sheet is required`);
    if (typeof cell !== 'string' || !/^[A-Z]{1,3}[1-9][0-9]{0,6}$/i.test(cell.trim())) {
      throw err('INVALID_REFS', `refs[${i}].cell must be a valid Excel address (e.g. C12)`);
    }
    return {sheet: (sheet as string).trim(), cell: (cell as string).trim().toUpperCase()};
  });
  const modelsDir = await resolveModelsDir();
  const workbookPath = join(modelsDir, 'companies', ticker, 'current.xlsx');
  if (!existsSync(workbookPath)) throw err('MODEL_NOT_FOUND', `No saved workbook for ticker ${ticker}`);
  try {
    const mod = await import('../workbook/xlsx.js') as {
      findBackendPython(): string | null;
      readCellStates(p: string, w: string, r: Array<{ sheet: string; cell: string }>): Promise<Array<{
        sheet: string; cell: string; priorValue: unknown; priorFormula: string | null;
      }>>;
    };
    const python = mod.findBackendPython();
    if (!python) throw err('ENGINE_UNAVAILABLE', 'No Python with openpyxl is available; cannot read workbook cells');
    const states = await mod.readCellStates(python, workbookPath, normalized);
    return {
      ticker,
      cells: states.map((s) => ({
        sheet: s.sheet,
        cell: s.cell,
        // Cached value as last saved/recalculated; formula is the live expression.
        value: s.priorValue,
        formula: s.priorFormula,
        isFormula: s.priorFormula !== null,
      })),
      note: 'Values are cached as last saved/recalculated; formulas are the live expressions.',
    };
  } catch (e) {
    if (isErr(e)) throw e;
    throw err('READ_FAILED', e instanceof Error ? e.message : String(e));
  }
}

function repoBackendDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(resolve(here, '..', '..', '..'), 'backend');
}

async function toolFilingsSync(args: Row): Promise<unknown> {
  const ticker = normTicker(args['ticker']);
  const modelsDir = await resolveModelsDir();
  // Shared service: live backend path, normalized snapshot, watch update. Never writes workbooks.
  let backend: { start(): Promise<string>; stop(): Promise<void> } | null = null;
  try {
    const procMod = await import('../infrastructure/local-backend-process.js') as Record<string, unknown>;
    const apiMod = await import('../api/backend-client.js') as Record<string, unknown>;
    const syncMod = await import('../watch/source-sync.js') as Record<string, unknown>;
    const LocalBackendProcess = procMod['LocalBackendProcess'] as new (o: Record<string, unknown>) => {
      start(): Promise<string>;
      stop(): Promise<void>;
    };
    const BackendApiClient = apiMod['BackendApiClient'] as new (u: string) => {
      getUnifiedCompany(t: string, y: number): Promise<unknown>;
      getRecentFilings(t: string, l?: number): Promise<unknown>;
    };
    const syncFilingSnapshot = syncMod['syncFilingSnapshot'] as (
      root: string, t: string, g: Record<string, (t: string, l?: number) => Promise<unknown>>,
    ) => Promise<Record<string, unknown>>;
    backend = new LocalBackendProcess({backendDirectory: repoBackendDir()});
    const baseUrl = await backend.start();
    const client = new BackendApiClient(baseUrl);
    const report = await syncFilingSnapshot(modelsDir, ticker, {
      getUnified: (t: string) => client.getUnifiedCompany(t, 5),
      getFilings: (t: string, l?: number) => client.getRecentFilings(t, l),
    });
    return report;
  } catch (e) {
    if (isErr(e)) throw e;
    throw err('SYNC_FAILED', e instanceof Error ? e.message : String(e));
  } finally {
    if (backend) await backend.stop().catch(() => undefined);
  }
}

async function toolWorkbookValidate(args: Row): Promise<unknown> {
  const ticker = normTicker(args['ticker']);
  const modelsDir = await resolveModelsDir();
  let actualHash: string | null = null;
  let exists = false;
  try {
    const p = join(modelsDir, 'companies', ticker, 'current.xlsx');
    if (existsSync(p)) { exists = true; actualHash = createHash('sha256').update(readFileSync(p)).digest('hex'); }
  } catch { exists = false; actualHash = null; }
  const manifest = readManifestFile(modelsDir, ticker);
  const rows = companyRows(modelsDir, ticker);
  const expectedHash = manifest && typeof manifest['workbookHash'] === 'string'
    ? (manifest['workbookHash'] as string)
    : rows.length > 0 ? asText(pick(rows[0], 'workbook_hash', 'workbookHash', 'hash')) : null;
  const base = {
    ticker,
    manifest,
    expectedHash,
    actualHash,
    manifestHashMatch: exists && !!expectedHash && expectedHash === actualHash,
    exists,
  };
  // Full structural validation via the same xlsx inspection helper as CLI review.
  try {
    const mod = await import('../workbook/xlsx.js') as {
      findBackendPython(): string | null;
      inspectWorkbook(p: string, w: string): Promise<{
        sheets: string[]; formulaCount: number; cachedErrorCells: string[];
        hasInputRequiredSheet: boolean; inputRequiredStatus: string | null; dataReviewRows: number;
      }>;
    };
    const python = mod.findBackendPython();
    if (!python) {
      return {...base, fullValidation: false, reason: 'No Python with openpyxl available; hash check only, not full validation.'};
    }
    const workbookPath = join(modelsDir, 'companies', ticker, 'current.xlsx');
    const inspection = await mod.inspectWorkbook(python, workbookPath);
    return {
      ...base,
      fullValidation: true,
      sheetCount: inspection.sheets.length,
      sheets: inspection.sheets,
      formulaCount: inspection.formulaCount,
      cachedErrorCells: inspection.cachedErrorCells,
      cachedErrorCount: inspection.cachedErrorCells.length,
      hasInputRequiredSheet: inspection.hasInputRequiredSheet,
      inputRequiredStatus: inspection.inputRequiredStatus,
      dataReviewRows: inspection.dataReviewRows,
    };
  } catch (e) {
    return {...base, fullValidation: false, reason: e instanceof Error ? e.message : String(e)};
  }
}

async function toolSourceSnapshot(args: Row): Promise<unknown> {
  const ticker = normTicker(args['ticker']);
  const modelsDir = await resolveModelsDir();
  const accession = typeof args['accession'] === 'string' && args['accession'].trim()
    ? args['accession'].trim() : undefined;
  const snap = latestSnapshotRow(modelsDir, ticker, accession);
  if (!snap) throw err('SNAPSHOT_NOT_FOUND', `No source snapshot found for ticker ${ticker}`);
  const payload = asText(pick(snap, 'payload_json', 'payloadJson', 'payload', 'snapshot_json')) ?? '';
  const totalChars = payload.length;
  const offset = args['offset'] === undefined ? 0 : Number(args['offset']);
  if (!Number.isInteger(offset) || offset < 0 || offset > totalChars) {
    throw err('INVALID_PAGING', `offset must be an integer between 0 and ${totalChars}`);
  }
  const maxChars = args['maxChars'] === undefined ? 4000 : Number(args['maxChars']);
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 20000) {
    throw err('INVALID_PAGING', 'maxChars must be an integer between 1 and 20000');
  }
  const chunk = payload.slice(offset, offset + maxChars);
  const nextOffset = offset + chunk.length < totalChars ? offset + chunk.length : null;
  return {
    ...snapView(snap), ticker,
    payload: chunk,
    offset,
    maxChars,
    totalChars,
    nextOffset,
    truncated: nextOffset !== null,
  };
}

function validateChanges(changes: unknown, opts?: { verification?: unknown }): Row[] {
  if (!Array.isArray(changes)) throw err('INVALID_PROPOSAL', 'changes must be an array');
  if (changes.length === 0) {
    // Review-only proposals carry no cell edits; they must still carry a
    // non-empty AI summary (checked by the caller) and verification result.
    const verification = opts?.verification;
    if (typeof verification !== 'string' || !verification.trim()) {
      throw err('INVALID_PROPOSAL', 'changes is empty: review-only proposals need a non-empty verification result');
    }
    return [];
  }
  const seen = new Set<string>();
  return (changes as Row[]).map((ch, i) => {
    const missing = ['sheet', 'cell', 'rationale', 'source', 'accession']
      .filter((f) => typeof ch[f] !== 'string' || !(ch[f] as string).trim());
    // Mirror the CLI exactly-one rule: an explicit null is a blank-clear
    // value edit (not a missing value); a "=" string is a formula, never a value.
    const hasValue = ch['proposedValue'] !== undefined;
    const hasFormula = typeof ch['proposedFormula'] === 'string' && (ch['proposedFormula'] as string).startsWith('=');
    if (!hasValue && !hasFormula) missing.push('proposedValue or proposedFormula (formula must start with "=")');
    if (hasValue && hasFormula) throw err('INVALID_PROPOSAL', `change[${i}] sets both proposedValue and proposedFormula; set exactly one`);
    if (typeof ch['proposedValue'] === 'string' && (ch['proposedValue'] as string).startsWith('=')) {
      throw err('INVALID_PROPOSAL', `change[${i}].proposedValue starts with "="; use proposedFormula for formula edits`);
    }
    if (missing.length > 0) throw err('INVALID_PROPOSAL', `change[${i}] missing: ${missing.join(', ')}`);
    if (typeof ch['cell'] === 'string' && !/^[A-Z]{1,3}[1-9][0-9]{0,6}$/i.test(ch['cell'].trim())) {
      throw err('INVALID_PROPOSAL', `change[${i}].cell must be a valid Excel address (e.g. C12)`);
    }
    if (typeof ch['accession'] === 'string' && !/^\d{10}-\d{2}-\d{6}$/.test(ch['accession'].trim())) {
      throw err('INVALID_PROPOSAL', `change[${i}].accession must be a filed SEC accession (NNNNNNNNNN-NN-NNNNNN)`);
    }
    const key = `${String(ch['sheet']).toUpperCase()}!${String(ch['cell']).toUpperCase()}`;
    if (seen.has(key)) throw err('INVALID_PROPOSAL', `change[${i}] duplicates ${key}; merge it into a single change`);
    seen.add(key);
    return ch;
  });
}

function readManifestFile(modelsDir: string, ticker: string): Row | null {
  for (const name of ['manifest.json']) {
    const p = join(modelsDir, 'companies', ticker, name);
    if (!existsSync(p)) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(p, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed as Row;
    } catch { /* ignore corrupt manifest */ }
  }
  return null;
}

function newTextId(prefix: string): string {
  const clean = prefix.trim() || 'id';
  let rand = '';
  try {
    const bytes = createRequire(import.meta.url)('node:crypto') as Row;
    const fn = bytes['randomBytes'] as ((n: number) => { toString(e: string): string }) | undefined;
    if (typeof fn === 'function') rand = fn(4).toString('hex');
  } catch { /* fallback below */ }
  if (!rand) rand = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${clean}_${Date.now().toString(36)}${rand}`;
}

async function toolProposalCreate(args: Row): Promise<unknown> {
  const ticker = normTicker(args['ticker']);
  if (typeof args['summary'] !== 'string' || !args['summary'].trim()) throw err('INVALID_PROPOSAL', 'summary is required');
  const verification = typeof args['verification'] === 'string' && args['verification'].trim()
    ? args['verification'].trim() : undefined;
  const reviewAccession = typeof args['accession'] === 'string' && args['accession'].trim()
    ? args['accession'].trim() : undefined;
  const changes = validateChanges(args['changes'], {verification});
  if (changes.length === 0 && typeof args['summary'] !== 'string') throw err('INVALID_PROPOSAL', 'summary is required');
  const modelsDir = await resolveModelsDir();
  // Base revision: explicit value or the accepted manifest hash; refuse stale bases.
  const manifest = readManifestFile(modelsDir, ticker);
  const baseRevisionHash = typeof args['baseRevisionHash'] === 'string' && args['baseRevisionHash'].trim()
    ? args['baseRevisionHash'].trim()
    : typeof manifest?.['workbookHash'] === 'string' ? (manifest['workbookHash'] as string) : null;
  if (!baseRevisionHash) throw err('STALE_BASE', `No accepted revision hash for ${ticker}; build a model first`);
  if (manifest) {
    try {
      const p = join(modelsDir, 'companies', ticker, 'current.xlsx');
      if (existsSync(p)) {
        const actual = createHash('sha256').update(readFileSync(p)).digest('hex');
        if (actual !== baseRevisionHash) {
          throw err('MANUAL_EDIT_DETECTED', `Saved workbook for ${ticker} differs from the base revision; review before proposing`);
        }
      }
    } catch (e) {
      if (isErr(e)) throw e;
      throw err('LIBRARY_UNAVAILABLE', e instanceof Error ? e.message : String(e));
    }
  }
  // Stale-source gate: every change accession must be the accepted manifest
  // accession or a stored snapshot accession for this ticker.
  const knownAccessions = new Set<string>();
  const manifestAccession = typeof manifest?.['accession'] === 'string' ? (manifest['accession'] as string) : null;
  if (manifestAccession) knownAccessions.add(manifestAccession);
  for (const row of tryQuery(modelsDir, 'SELECT accession FROM snapshots WHERE ticker = ?', ticker)
    .concat(tryQuery(modelsDir, 'SELECT accession_number AS accession FROM snapshots WHERE ticker = ?', ticker))) {
    const value = row['accession'];
    if (typeof value === 'string' && value.trim()) knownAccessions.add(value.trim());
  }
  for (let i = 0; i < changes.length; i++) {
    const changeAccession = changes[i]?.['accession'];
    if (typeof changeAccession !== 'string' || !knownAccessions.has(changeAccession.trim())) {
      throw err('STALE_ACCESSION', `change[${i}] cites unknown accession ${String(changeAccession)}; run filings_sync for ${ticker} first`);
    }
  }
  // Review-only filing context must also be a known source for this ticker.
  if (changes.length === 0) {
    if (reviewAccession !== undefined && !knownAccessions.has(reviewAccession)) {
      throw err('STALE_ACCESSION', `accession cites unknown accession ${reviewAccession}; run filings_sync for ${ticker} first`);
    }
    if (reviewAccession !== undefined && !/^\d{10}-\d{2}-\d{6}$/.test(reviewAccession)) {
      throw err('INVALID_PROPOSAL', 'accession must be a filed SEC accession (NNNNNNNNNN-NN-NNNNNN)');
    }
  }
  // Capture current literals/formulas BEFORE approval so review shows priors.
  // Review-only proposals have no cells to capture.
  let enriched = changes;
  if (changes.length > 0) {
    try {
      const mod = await import('../review/apply-service.js') as {
        captureChangePriors(r: string, t: string, c: Array<{ sheet: string; cell: string }>): Promise<Array<{
          sheet: string; cell: string; priorValue: unknown; priorFormula: string | null;
        }>>;
      };
      const priors = await mod.captureChangePriors(modelsDir, ticker, changes.map((c) => ({
        sheet: String(c['sheet']), cell: String(c['cell']),
      })));
      enriched = changes.map((c, i) => ({
        ...c,
        priorValue: priors[i]?.priorValue ?? null,
        priorFormula: priors[i]?.priorFormula ?? null,
      }));
    } catch (e) {
      throw err('PRIOR_CAPTURE_FAILED', e instanceof Error ? e.message : String(e));
    }
  }
  const proposalPayload = JSON.stringify({
    summary: args['summary'],
    changes: enriched,
    baseRevisionHash,
    ...(verification !== undefined ? {verification} : {}),
    ...(reviewAccession !== undefined ? {accession: reviewAccession} : {}),
  });
  const db = openDb(modelsDir, false);
  if (!db) throw err('LIBRARY_UNAVAILABLE', `No library database found under ${modelsDir}`);
  try {
    try { db.exec(PROPOSALS_DDL); } catch { /* table exists with its own schema */ }
    const cols = new Set(tableColumns(db, 'proposals'));
    if (cols.size === 0) throw err('LIBRARY_UNAVAILABLE', 'proposals table is not usable');
    // Preferred: the model-library schema (TEXT id, payload_json). Fall back to
    // adaptive column mapping for older databases.
    if (cols.has('id') && cols.has('ticker') && cols.has('payload_json')) {
      const id = newTextId('prop');
      const payload = proposalPayload;
      const useCols = ['id', 'ticker', 'payload_json'];
      const useVals: unknown[] = [id, ticker, payload];
      if (cols.has('base_revision_hash')) { useCols.push('base_revision_hash'); useVals.push(baseRevisionHash); }
      if (cols.has('status')) { useCols.push('status'); useVals.push('proposed'); }
      if (cols.has('created_at')) { useCols.push('created_at'); useVals.push(new Date().toISOString()); }
      try {
        db.prepare(`INSERT INTO proposals (${useCols.join(', ')}) VALUES (${useCols.map(() => '?').join(', ')})`).run(...useVals);
      } catch { throw err('LIBRARY_UNAVAILABLE', 'Could not insert proposal row'); }
      return { proposalId: id, status: 'proposed' };
    }
    const col = (...names: string[]): string | undefined => names.find((c) => cols.has(c));
    const pairs: Array<[string | undefined, unknown]> = [
      [col('ticker', 'symbol'), ticker],
      [col('summary'), String(args['summary'])],
      [col('changes_json', 'changesJson', 'changes', 'payload_json', 'payload'),
        proposalPayload],
      [col('base_revision_hash', 'baseRevisionHash', 'base_revision'), baseRevisionHash],
      [col('status'), 'proposed'],
      [col('created_at', 'createdAt'), new Date().toISOString()],
    ];
    const use = pairs.filter((p): p is [string, unknown] => !!p[0] && p[1] !== undefined);
    if (use.length === 0) throw err('LIBRARY_UNAVAILABLE', 'proposals table has no writable columns');
    const result = db.prepare(
      `INSERT INTO proposals (${use.map((p) => p[0]).join(', ')}) VALUES (${use.map(() => '?').join(', ')})`,
    ).run(...use.map((p) => p[1]));
    return { proposalId: Number(result.lastInsertRowid), status: 'proposed' };
  } finally { try { db.close(); } catch { /* ignore */ } }
}

/**
 * Map a shared apply-service error message to a stable MCP error code. Preview
 * and apply deliberately share this mapping so the same failure category never
 * reports a different code in each tool:
 *  - MANUAL_EDIT_DETECTED  the accepted workbook diverged from the manifest
 *  - STALE_ACCESSION       a cited filing accession is not a stored source
 *  - PREVIEW_REQUIRED      no usable stored candidate: re-run proposal_preview
 *  - STALE_BASE            the proposal was drafted against an older base
 *  - ENGINE_UNAVAILABLE    openpyxl/LibreOffice is needed but missing
 *  - INVALID_PROPOSAL      missing/unknown/terminal-status/malformed proposal
 *  - fallback              PREVIEW_FAILED or APPLY_FAILED for the caller
 */
function classifyProposalFailure(message: string, fallback: 'PREVIEW_FAILED' | 'APPLY_FAILED'): McpErr {
  if (/MANUAL_EDIT_DETECTED/.test(message)) return err('MANUAL_EDIT_DETECTED', message);
  if (/unknown accession|cites unknown accession/.test(message)) return err('STALE_ACCESSION', message);
  // A stored candidate is missing or no longer matches the accepted base, the
  // current draft, or its recorded bytes: the caller must re-run preview.
  if (
    /Candidate is stale|no previewed candidate|previewed against|changed since (its )?preview|Candidate path mismatch|Candidate (workbook|re-validation)|changed before promotion|changed during promotion|changed while the preview was starting|(?:re-)?run .?dcf model preview/.test(message)
  ) {
    return err('PREVIEW_REQUIRED', message);
  }
  if (/Proposal is stale|drafted against/.test(message)) return err('STALE_BASE', message);
  if (/No Python with openpyxl|LibreOffice|soffice/.test(message)) return err('ENGINE_UNAVAILABLE', message);
  if (
    /Proposal not found|already applied|was rejected|cannot be applied|cannot be previewed|has status|unreadable payload|Proposal invalid|Duplicate edit|needs proposedValue|unsupported proposed value|non-finite proposed number|proposedFormula must start|no base revision/.test(message)
  ) {
    return err('INVALID_PROPOSAL', message);
  }
  return err(fallback, message);
}

async function toolProposalApply(args: Row): Promise<unknown> {
  if (args['approval'] !== true) {
    throw err('APPROVAL_REQUIRED', 'Explicit approval required: call proposal_apply with approval=true');
  }
  const raw = args['proposalId'];
  const proposalId: string | number = typeof raw === 'number' && Number.isInteger(raw) ? raw
    : typeof raw === 'string' && raw.trim().length > 0 ? raw.trim()
    : Number.NaN;
  if (typeof proposalId === 'number' && !Number.isFinite(proposalId)) {
    throw err('INVALID_PROPOSAL', 'proposalId is required');
  }
  const approvedBy = typeof args['approvedBy'] === 'string' ? args['approvedBy'] : null;
  const modelsDir = await resolveModelsDir();
  // Explicit approval runs the SAME shared application service as the CLI:
  // edits go to a copy, LibreOffice recalculates, validation runs, then a
  // staged publication (same-directory renames, rollback on failure) commits
  // current.xlsx + manifest + revision + proposal status.
  try {
    const mod = await import('../review/apply-service.js') as {
      applyApprovedProposal(root: string, id: string, by: string): Promise<{
        proposalId: unknown; ticker: string; priorHash: string; newHash: string;
        revisionId: string; applied: Array<{ sheet: string; cell: string }>;
      }>;
    };
    const applied = await mod.applyApprovedProposal(modelsDir, String(proposalId), approvedBy ?? 'mcp');
    return {
      proposalId: applied.proposalId,
      status: 'applied',
      ticker: applied.ticker,
      priorHash: applied.priorHash,
      newHash: applied.newHash,
      revisionId: applied.revisionId,
      appliedCells: applied.applied.map((e) => `${e.sheet}!${e.cell}`),
    };
  } catch (e) {
    if (isErr(e)) throw e;
    throw classifyProposalFailure(e instanceof Error ? e.message : String(e), 'APPLY_FAILED');
  }
}

/** Human-readable literal for an applied edit field (null/undefined => blank). */
function previewLiteral(value: unknown): string {
  return value === null || value === undefined ? '(blank)' : String(value);
}

async function toolProposalPreview(args: Row): Promise<unknown> {
  const raw = args['proposalId'];
  const proposalId: string | number = typeof raw === 'number' && Number.isInteger(raw) ? raw
    : typeof raw === 'string' && raw.trim().length > 0 ? raw.trim()
    : Number.NaN;
  if (typeof proposalId === 'number' && !Number.isFinite(proposalId)) {
    throw err('INVALID_PROPOSAL', 'proposalId is required');
  }
  const modelsDir = await resolveModelsDir();
  // Read-only toward the accepted workbook: builds the validated candidate
  // copy through the SAME shared service as `dcf model preview`.
  try {
    const mod = await import('../review/apply-service.js') as {
      previewProposal(root: string, id: string): Promise<{
        proposalId: unknown; ticker: string; baseHash: string; candidatePath: string;
        candidateHash: string; validationSummary: string; inspectionMarkdown: string;
        applied: Array<{
          sheet: string; cell: string;
          value?: string | number | boolean | null;
          formula?: string;
          priorValue: string | number | boolean | null;
          priorFormula: string | null;
        }>;
      }>;
    };
    const previewed = await mod.previewProposal(modelsDir, String(proposalId));
    return {
      proposalId: previewed.proposalId,
      status: 'proposed',
      ticker: previewed.ticker,
      baseHash: previewed.baseHash,
      candidatePath: previewed.candidatePath,
      candidateHash: previewed.candidateHash,
      validationSummary: previewed.validationSummary,
      // Deterministic inspection report (same renderer as the CLI preview).
      inspectionMarkdown: previewed.inspectionMarkdown,
      // Compact address list for parity with the CLI/tests...
      previewedCells: previewed.applied.map((e) => `${e.sheet}!${e.cell}`),
      // ...plus every applied cell's prior/proposed literal or formula so the
      // AI/human can review the candidate without opening the workbook.
      appliedCells: previewed.applied.map((e) => ({
        sheet: e.sheet,
        cell: e.cell,
        prior: e.priorFormula ?? previewLiteral(e.priorValue),
        proposed: e.formula ?? previewLiteral(e.value),
        priorValue: e.priorValue,
        priorFormula: e.priorFormula,
        proposedValue: e.formula !== undefined ? null : (e.value ?? null),
        proposedFormula: e.formula ?? null,
        isFormula: e.formula !== undefined,
      })),
      note: 'Preview only — the accepted workbook is unchanged. Promote with proposal_apply approval=true.',
    };
  } catch (e) {
    if (isErr(e)) throw e;
    throw classifyProposalFailure(e instanceof Error ? e.message : String(e), 'PREVIEW_FAILED');
  }
}

async function toolProposalReject(args: Row): Promise<unknown> {
  const raw = args['proposalId'];
  const proposalId: string | number = typeof raw === 'number' && Number.isInteger(raw) ? raw
    : typeof raw === 'string' && raw.trim().length > 0 ? raw.trim()
    : Number.NaN;
  if (typeof proposalId === 'number' && !Number.isFinite(proposalId)) {
    throw err('INVALID_PROPOSAL', 'proposalId is required');
  }
  const reason = typeof args['reason'] === 'string' ? args['reason'] : undefined;
  const modelsDir = await resolveModelsDir();
  // Status-only rejection: never touches workbook files.
  try {
    const mod = await import('../review/apply-service.js') as {
      rejectProposal(root: string, id: string, reason?: string): { id: string; status: string };
    };
    const rejected = mod.rejectProposal(modelsDir, String(proposalId), reason);
    return rejected;
  } catch (e) {
    throw err('REJECT_FAILED', e instanceof Error ? e.message : String(e));
  }
}

/* ---------- revision history + comparison (read-only; same data as CLI) ---------- */

function pagingInt(value: unknown, name: string, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') throw err('INVALID_PAGING', `${name} must be an integer between ${min} and ${max}`);
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw err('INVALID_PAGING', `${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

interface CompareModule {
  listRevisionSummaries(r: string, t: string, o: { offset: number; limit: number; readOnly: boolean }): unknown;
  compareRevisions(r: string, t: string, o: { from?: string; to?: string; offset: number; limit: number; readOnly: boolean }): Promise<unknown>;
}

async function loadCompareModule(): Promise<CompareModule> {
  return (await import('../review/compare.js')) as CompareModule;
}

async function libraryDbFound(modelsDir: string): Promise<boolean> {
  const store = (await import('../library/store.js')) as { findLibraryDb(root: string): string | null };
  return store.findLibraryDb(modelsDir) !== null;
}

async function toolRevisionsList(args: Row): Promise<unknown> {
  const ticker = normTicker(args['ticker']);
  const modelsDir = await resolveModelsDir();
  // Read-only guard aligned with the shared open path: never create a
  // library database for a lookup.
  const mod = await loadCompareModule();
  if (!(await libraryDbFound(modelsDir))) return {ticker, total: 0, offset: 0, limit: 20, revisions: []};
  const offset = pagingInt(args['offset'], 'offset', 0, 1000000, 0);
  const limit = pagingInt(args['limit'], 'limit', 1, 100, 20);
  // A very old library can carry a companies table without a revisions table.
  // Serve an empty page; neither this probe nor the list may create or migrate it.
  if (libraryTableExists(modelsDir, 'revisions') === false) return {ticker, total: 0, offset, limit, revisions: []};
  try {
    // True read-only: no directory creation, no schema migration.
    return mod.listRevisionSummaries(modelsDir, ticker, {offset, limit, readOnly: true});
  } catch (e) {
    if (isErr(e)) throw e;
    throw err('LIBRARY_UNAVAILABLE', e instanceof Error ? e.message : String(e));
  }
}

async function toolModelCompare(args: Row): Promise<unknown> {
  const ticker = normTicker(args['ticker']);
  const modelsDir = await resolveModelsDir();
  const mod = await loadCompareModule();
  if (!(await libraryDbFound(modelsDir))) throw err('MODEL_NOT_FOUND', `No model found for ticker ${ticker}`);
  const from = typeof args['from'] === 'string' && args['from'].trim() ? args['from'].trim() : undefined;
  const to = typeof args['to'] === 'string' && args['to'].trim() ? args['to'].trim() : undefined;
  const offset = pagingInt(args['offset'], 'offset', 0, 1000000, 0);
  const maxChanges = pagingInt(args['maxChanges'], 'maxChanges', 1, 500, 100);
  try {
    // True read-only: no directory creation, no schema migration.
    return await mod.compareRevisions(modelsDir, ticker, {from, to, offset, limit: maxChanges, readOnly: true});
  } catch (e) {
    if (isErr(e)) throw e;
    const message = e instanceof Error ? e.message : String(e);
    if (/No model found|No revisions found/.test(message)) throw err('MODEL_NOT_FOUND', message);
    if (/matches no revision|matches \d+ revisions|Revision file.*missing|recorded hash/i.test(message)) {
      throw err('INVALID_REVISION', message);
    }
    if (/offset|limit/.test(message)) throw err('INVALID_PAGING', message);
    if (/openpyxl|Python/.test(message)) throw err('ENGINE_UNAVAILABLE', message);
    throw err('COMPARE_FAILED', message);
  }
}

/* ---------- tool registry (inputSchema key order is part of the contract) ---------- */
const changeSchema: Row = {
  type: 'object',
  properties: {
    sheet: { type: 'string' }, cell: { type: 'string' },
    priorValue: { description: 'Current value (captured at creation; server fills if absent)' },
    priorFormula: { description: 'Current formula (captured at creation; server fills if absent)' },
    proposedValue: { description: 'Proposed value (set exactly one of proposedValue/proposedFormula)' },
    proposedFormula: { description: 'Proposed formula starting with = (explicit formula edit)' },
    rationale: { type: 'string' }, source: { type: 'string' }, accession: { type: 'string' },
  },
  required: ['sheet', 'cell', 'rationale', 'source', 'accession'],
  additionalProperties: false,
};
const tickerProp = { ticker: { type: 'string', description: 'Company ticker symbol' } };
const TOOLS: ToolDef[] = [
  { name: 'models_list', description: 'List companies in the local model library (ticker, route, readiness, builtAt).',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false } },
  { name: 'model_inspect', description: 'Show manifest, revision count, and latest snapshot accession for a ticker.',
    inputSchema: { type: 'object', properties: { ...tickerProp }, required: ['ticker'], additionalProperties: false } },
  { name: 'filing_latest', description: 'Latest stored snapshot row or watch updateReady flag. Read-only, no network.',
    inputSchema: { type: 'object', properties: { ...tickerProp }, required: ['ticker'], additionalProperties: false } },
  { name: 'workbook_validate', description: 'Recompute SHA-256 of companies/<T>/current.xlsx vs stored workbook_hash.',
    inputSchema: { type: 'object', properties: { ...tickerProp }, required: ['ticker'], additionalProperties: false } },
  { name: 'source_snapshot', description: 'Stored snapshot payload, paged (offset/maxChars; 20000 max). Read-only, no network.',
    inputSchema: { type: 'object', properties: {
      ...tickerProp,
      accession: { type: 'string' },
      offset: { type: 'integer', description: 'Start character within the payload' },
      maxChars: { type: 'integer', description: 'Characters to return (1-20000, default 4000)' },
    }, required: ['ticker'], additionalProperties: false } },
  { name: 'workbook_read_cells', description: 'Read live workbook values (cached) and formulas for up to 50 sheet/cell refs. Read-only.',
    inputSchema: { type: 'object', properties: {
      ...tickerProp,
      refs: { type: 'array', maxItems: 50, items: {
        type: 'object',
        properties: { sheet: { type: 'string' }, cell: { type: 'string' } },
        required: ['sheet', 'cell'],
        additionalProperties: false,
      } },
    }, required: ['ticker', 'refs'], additionalProperties: false } },
  { name: 'filings_sync', description: 'Fetch latest filing via the live backend, store the normalized snapshot, update watch status. Never writes workbooks.',
    inputSchema: { type: 'object', properties: { ...tickerProp }, required: ['ticker'], additionalProperties: false } },
  { name: 'proposal_create', description: 'Insert a validated change proposal with status proposed. Pass changes=[] with verification for a review-only proposal.',
    inputSchema: { type: 'object', properties: {
      ...tickerProp,
      summary: { type: 'string' },
      changes: { type: 'array', items: changeSchema },
      verification: { type: 'string', description: 'AI verification result (required when changes is empty)' },
      accession: { type: 'string', description: 'Filing accession giving source context to a review-only proposal' },
      baseRevisionHash: { type: 'string' },
    }, required: ['ticker', 'summary', 'changes'], additionalProperties: false } },
  { name: 'proposal_preview', description: 'Build the validated candidate workbook for a proposal (adds an AI Change Log sheet, recalculates, validates) and return deterministic inspectionMarkdown plus each applied cell prior/proposed literal or formula. Preview only — never alters the accepted workbook.',
    inputSchema: { type: 'object', properties: {
      proposalId: { description: 'Proposal id (text id or integer row id)' },
    }, required: ['proposalId'], additionalProperties: false } },
  { name: 'proposal_apply', description: 'Apply an approved proposal: edits a copy, recalculates, validates, publishes a new revision. Requires approval=true.',
    inputSchema: { type: 'object', properties: {
      proposalId: { description: 'Proposal id (text id or integer row id)' }, approval: { type: 'boolean' }, approvedBy: { type: 'string' },
    }, required: ['proposalId', 'approval'], additionalProperties: false } },
  { name: 'proposal_reject', description: 'Reject a proposal (status-only; never alters the workbook).',
    inputSchema: { type: 'object', properties: {
      proposalId: { description: 'Proposal id (text id or integer row id)' }, reason: { type: 'string' },
    }, required: ['proposalId'], additionalProperties: false } },
  { name: 'revisions_list', description: 'Revision history with filing/event metadata (build event, mapped fact accession/period, latest detected filing, route/readiness). Paged (offset/limit 1-100). Read-only.',
    inputSchema: { type: 'object', properties: {
      ...tickerProp,
      offset: { type: 'integer', description: 'Start index within the history (newest first)' },
      limit: { type: 'integer', description: 'Revisions to return (1-100, default 20)' },
    }, required: ['ticker'], additionalProperties: false } },
  { name: 'model_compare', description: 'Compare two revisions: formula/value cell changes plus source and model-readiness deltas. Same data as `dcf model compare`. Read-only; cell list is paged (offset/maxChanges 1-500): hasMore/nextOffset point at the next detail page (stop when hasMore is false), truncated flags the hard collection cap.',
    inputSchema: { type: 'object', properties: {
      ...tickerProp,
      from: { type: 'string', description: 'From revision id (default: predecessor of to)' },
      to: { type: 'string', description: 'To revision id (default: accepted revision)' },
      offset: { type: 'integer', description: 'Start index within the cell changes' },
      maxChanges: { type: 'integer', description: 'Cell changes to return (1-500, default 100)' },
    }, required: ['ticker'], additionalProperties: false } },
];
const HANDLERS: Record<string, (args: Row) => Promise<unknown>> = {
  models_list: toolModelsList, model_inspect: toolModelInspect, filing_latest: toolFilingLatest,
  workbook_validate: toolWorkbookValidate, source_snapshot: toolSourceSnapshot,
  workbook_read_cells: toolWorkbookReadCells, filings_sync: toolFilingsSync,
  proposal_create: toolProposalCreate, proposal_apply: toolProposalApply,
  proposal_preview: toolProposalPreview, proposal_reject: toolProposalReject,
  revisions_list: toolRevisionsList, model_compare: toolModelCompare,
};

/* ---------- stdio JSON-RPC loop ---------- */
function send(id: RpcId, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: id ?? null, result })}\n`);
}
function sendErr(id: RpcId, code: unknown, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })}\n`);
}

async function handleMessage(msg: Row): Promise<void> {
  const id = (msg['id'] ?? null) as RpcId;
  const notif = msg['id'] === undefined;
  try {
    if (msg['jsonrpc'] !== '2.0' || typeof msg['method'] !== 'string') {
      if (!notif) sendErr(id, -32600, 'Invalid Request');
      return;
    }
    const method = msg['method'] as string;
    const params = ((msg['params'] ?? {}) as Row) ?? {};
    if (method === 'notifications/initialized') return;
    if (method === 'initialize') {
      send(id, { protocolVersion: '2024-11-05',
        capabilities: { tools: {} }, serverInfo: { name: 'dcf-model-library', version: SERVER_VERSION } });
      return;
    }
    if (method === 'ping') { send(id, {}); return; }
    if (method === 'tools/list') { send(id, { tools: TOOLS }); return; }
    if (method === 'tools/call') {
      const name = params['name'];
      const handler = typeof name === 'string' ? HANDLERS[name] : undefined;
      if (!handler) { sendErr(id, -32602, `Unknown tool: ${typeof name === 'string' ? name : String(name)}`); return; }
      try {
        send(id, { content: [{ type: 'text', text: JSON.stringify(await handler((params['arguments'] ?? {}) as Row)) }] });
      } catch (e) {
        if (isErr(e)) sendErr(id, e.code, e.message);
        else sendErr(id, -32603, e instanceof Error ? e.message : String(e));
      }
      return;
    }
    if (!notif) sendErr(id, -32601, `Method not found: ${method}`);
  } catch (e) { if (!notif) sendErr(id, -32603, e instanceof Error ? e.message : String(e)); }
}

export async function startMcpServer(): Promise<void> {
  const rl = createInterface({ input: process.stdin, terminal: false });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: unknown;
    try { msg = JSON.parse(line); }
    catch { sendErr(null, -32700, 'Parse error'); continue; }
    if (Array.isArray(msg)) {
      for (const m of msg) {
        if (m && typeof m === 'object') await handleMessage(m as Row);
      }
    } else if (msg && typeof msg === 'object') {
      await handleMessage({ ...(msg as object) } as Row);
    } else {
      sendErr(null, -32600, 'Invalid Request');
    }
  }
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
const thisFile = fileURLToPath(import.meta.url);
if (invoked === thisFile || invoked.endsWith('/mcp/server.ts') || invoked.endsWith('/mcp/server.js')) {
  startMcpServer().catch((e: unknown) => {
    process.stderr.write(`MCP server error: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  });
}
