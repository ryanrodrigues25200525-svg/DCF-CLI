import { mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getModelsDir, resolveModelsDir } from './config';
import type {
  AddRevisionInput,
  CompanyRecord,
  CreateProposalInput,
  ProposalRecord,
  RevisionRecord,
  SaveSnapshotInput,
  SnapshotRecord,
  WatchPatch,
  WatchRecord,
} from './types';

export function normalizeTicker(input: string): string {
  const ticker = input.trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,10}$/.test(ticker)) {
    throw new Error(`Invalid ticker format: ${input}`);
  }
  return ticker;
}

export function companyDir(root: string, ticker: string): string {
  return join(root, 'companies', normalizeTicker(ticker));
}

export function currentWorkbookPath(root: string, ticker: string): string {
  return join(companyDir(root, ticker), 'current.xlsx');
}

export function revisionPath(root: string, ticker: string, revId: string): string {
  return join(companyDir(root, ticker), 'revisions', `${revId}.xlsx`);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function utcNow(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  const clean = prefix.trim().length > 0 ? prefix.trim() : 'id';
  return `${clean}_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies(ticker TEXT PRIMARY KEY, route TEXT, currency TEXT, unit_scale TEXT, accession TEXT, filed_date TEXT, workbook_hash TEXT, built_at TEXT, readiness TEXT, workbook_path TEXT, revision_id TEXT);
CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY, ticker TEXT, workbook_hash TEXT, parent_hash TEXT, created_at TEXT, path TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY, ticker TEXT, base_revision_hash TEXT, status TEXT, created_at TEXT, payload_json TEXT);
CREATE TABLE IF NOT EXISTS snapshots(ticker TEXT, accession TEXT, filed_date TEXT, fetched_at TEXT, payload_json TEXT, PRIMARY KEY(ticker, accession));
CREATE TABLE IF NOT EXISTS watch(ticker TEXT PRIMARY KEY, enabled INTEGER, last_check TEXT, latest_accession TEXT, update_ready INTEGER, last_error TEXT);
`;

/** Task 3 revision filing/event columns. All nullable so pre-Task-3 rows stay readable. */
const REVISION_EXTRA_COLUMNS: Array<{ name: string; ddl: string }> = [
  {name: 'build_event', ddl: 'TEXT'},
  {name: 'fact_accession', ddl: 'TEXT'},
  {name: 'fact_filed_date', ddl: 'TEXT'},
  {name: 'fact_period', ddl: 'TEXT'},
  {name: 'latest_form', ddl: 'TEXT'},
  {name: 'latest_accession', ddl: 'TEXT'},
  {name: 'latest_filed_date', ddl: 'TEXT'},
  {name: 'latest_report_date', ddl: 'TEXT'},
  {name: 'route', ddl: 'TEXT'},
  {name: 'readiness', ddl: 'TEXT'},
];

/**
 * Idempotent schema migration for existing SQLite libraries: CREATEs cover
 * fresh databases, and each missing Task 3 column is added only when absent
 * (checked via pragma_table_info, not version flags). Never alters data.
 */
export function migrateLibrarySchema(db: { exec(sql: string): void; prepare(sql: string): { all(...p: unknown[]): Array<Record<string, unknown>> } }): void {
  db.exec(SCHEMA);
  let existing = new Set<string>();
  try {
    const rows = db.prepare('SELECT name FROM pragma_table_info(?)').all('revisions');
    existing = new Set(rows.map((r) => String(r['name'])));
  } catch {
    return; // revisions table unusable; leave untouched
  }
  for (const col of REVISION_EXTRA_COLUMNS) {
    if (!existing.has(col.name)) {
      db.exec(`ALTER TABLE revisions ADD COLUMN ${col.name} ${col.ddl}`);
    }
  }
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function num01(v: unknown, fallback: number): number {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  return n ? 1 : 0;
}

function mapCompany(row: Record<string, unknown>): CompanyRecord {
  return {
    ticker: String(row.ticker),
    route: strOrNull(row.route),
    currency: strOrNull(row.currency),
    unit_scale: strOrNull(row.unit_scale),
    accession: strOrNull(row.accession),
    filed_date: strOrNull(row.filed_date),
    workbook_hash: strOrNull(row.workbook_hash),
    built_at: strOrNull(row.built_at),
    readiness: strOrNull(row.readiness),
    workbook_path: strOrNull(row.workbook_path),
    revision_id: strOrNull(row.revision_id),
  };
}

function mapRevision(row: Record<string, unknown>): RevisionRecord {
  return {
    id: String(row.id),
    ticker: String(row.ticker),
    workbook_hash: strOrNull(row.workbook_hash) ?? '',
    parent_hash: strOrNull(row.parent_hash),
    created_at: strOrNull(row.created_at) ?? '',
    path: strOrNull(row.path),
    note: strOrNull(row.note),
    build_event: strOrNull(row.build_event),
    fact_accession: strOrNull(row.fact_accession),
    fact_filed_date: strOrNull(row.fact_filed_date),
    fact_period: strOrNull(row.fact_period),
    latest_form: strOrNull(row.latest_form),
    latest_accession: strOrNull(row.latest_accession),
    latest_filed_date: strOrNull(row.latest_filed_date),
    latest_report_date: strOrNull(row.latest_report_date),
    route: strOrNull(row.route),
    readiness: strOrNull(row.readiness),
  };
}

function mapProposal(row: Record<string, unknown>): ProposalRecord {
  return {
    id: String(row.id),
    ticker: String(row.ticker),
    base_revision_hash: strOrNull(row.base_revision_hash),
    status: strOrNull(row.status) ?? '',
    created_at: strOrNull(row.created_at) ?? '',
    payload_json: strOrNull(row.payload_json) ?? '',
  };
}

function mapSnapshot(row: Record<string, unknown>): SnapshotRecord {
  return {
    ticker: String(row.ticker),
    accession: String(row.accession),
    filed_date: strOrNull(row.filed_date),
    fetched_at: strOrNull(row.fetched_at) ?? '',
    payload_json: strOrNull(row.payload_json) ?? '',
  };
}

function mapWatch(row: Record<string, unknown>): WatchRecord {
  return {
    ticker: String(row.ticker),
    enabled: num01(row.enabled, 1),
    last_check: strOrNull(row.last_check),
    latest_accession: strOrNull(row.latest_accession),
    update_ready: num01(row.update_ready, 0),
    last_error: strOrNull(row.last_error),
  };
}

export class ModelLibrary {
  readonly root: string;
  private db: DatabaseSync;

  constructor(root: string) {
    if (!root || root.trim().length === 0) throw new Error('ModelLibrary root must be a non-empty path.');
    this.root = root;
    mkdirSync(root, { recursive: true });
    mkdirSync(join(root, 'companies'), { recursive: true });
    this.db = new DatabaseSync(join(root, 'library.db'));
    migrateLibrarySchema(this.db);
  }

  static open(explicit?: string): ModelLibrary {
    return new ModelLibrary(explicit !== undefined ? resolveModelsDir(explicit) : getModelsDir());
  }

  close(): void {
    this.db.close();
  }

  upsertCompany(rec: CompanyRecord): CompanyRecord {
    const ticker = normalizeTicker(rec.ticker);
    const existing = this.getCompany(ticker);
    const merged: CompanyRecord = {
      ticker,
      route: rec.route !== undefined ? rec.route : (existing?.route ?? null),
      currency: rec.currency !== undefined ? rec.currency : (existing?.currency ?? null),
      unit_scale: rec.unit_scale !== undefined ? rec.unit_scale : (existing?.unit_scale ?? null),
      accession: rec.accession !== undefined ? rec.accession : (existing?.accession ?? null),
      filed_date: rec.filed_date !== undefined ? rec.filed_date : (existing?.filed_date ?? null),
      workbook_hash: rec.workbook_hash !== undefined ? rec.workbook_hash : (existing?.workbook_hash ?? null),
      built_at: rec.built_at !== undefined ? rec.built_at : (existing?.built_at ?? null),
      readiness: rec.readiness !== undefined ? rec.readiness : (existing?.readiness ?? null),
      workbook_path: rec.workbook_path !== undefined ? rec.workbook_path : (existing?.workbook_path ?? null),
      revision_id: rec.revision_id !== undefined ? rec.revision_id : (existing?.revision_id ?? null),
    };
    mkdirSync(companyDir(this.root, ticker), { recursive: true });
    this.db
      .prepare(
        'INSERT OR REPLACE INTO companies(ticker, route, currency, unit_scale, accession, filed_date, workbook_hash, built_at, readiness, workbook_path, revision_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        merged.ticker,
        merged.route,
        merged.currency,
        merged.unit_scale,
        merged.accession,
        merged.filed_date,
        merged.workbook_hash,
        merged.built_at,
        merged.readiness,
        merged.workbook_path,
        merged.revision_id,
      );
    return merged;
  }

  getCompany(ticker: string): CompanyRecord | null {
    const row = this.db.prepare('SELECT * FROM companies WHERE ticker = ?').get(normalizeTicker(ticker));
    return row === undefined ? null : mapCompany(row);
  }

  listCompanies(): CompanyRecord[] {
    return this.db.prepare('SELECT * FROM companies ORDER BY ticker ASC').all().map(mapCompany);
  }

  addRevision(input: AddRevisionInput): RevisionRecord {
    const ticker = normalizeTicker(input.ticker);
    if (!input.workbook_hash || input.workbook_hash.trim().length === 0) {
      throw new Error('workbook_hash is required.');
    }
    const rec: RevisionRecord = {
      id: input.id ?? newId('rev'),
      ticker,
      workbook_hash: input.workbook_hash,
      parent_hash: input.parent_hash ?? null,
      created_at: utcNow(),
      path: input.path ?? null,
      note: input.note ?? null,
      build_event: input.build_event ?? null,
      fact_accession: input.fact_accession ?? null,
      fact_filed_date: input.fact_filed_date ?? null,
      fact_period: input.fact_period ?? null,
      latest_form: input.latest_form ?? null,
      latest_accession: input.latest_accession ?? null,
      latest_filed_date: input.latest_filed_date ?? null,
      latest_report_date: input.latest_report_date ?? null,
      route: input.route ?? null,
      readiness: input.readiness ?? null,
    };
    this.db
      .prepare('INSERT INTO revisions(id, ticker, workbook_hash, parent_hash, created_at, path, note, build_event, fact_accession, fact_filed_date, fact_period, latest_form, latest_accession, latest_filed_date, latest_report_date, route, readiness) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(rec.id, rec.ticker, rec.workbook_hash, rec.parent_hash, rec.created_at, rec.path, rec.note, rec.build_event, rec.fact_accession, rec.fact_filed_date, rec.fact_period, rec.latest_form, rec.latest_accession, rec.latest_filed_date, rec.latest_report_date, rec.route, rec.readiness);
    return rec;
  }

  listRevisions(ticker: string): RevisionRecord[] {
    return this.db
      .prepare('SELECT * FROM revisions WHERE ticker = ? ORDER BY created_at DESC, id DESC')
      .all(normalizeTicker(ticker))
      .map(mapRevision);
  }

  getRevision(id: string): RevisionRecord | null {
    const row = this.db.prepare('SELECT * FROM revisions WHERE id = ?').get(id);
    return row === undefined ? null : mapRevision(row);
  }

  createProposal(input: CreateProposalInput): ProposalRecord {
    const ticker = normalizeTicker(input.ticker);
    const payloadJson = input.payload_json !== undefined ? input.payload_json : JSON.stringify(input.payload ?? null);
    const rec: ProposalRecord = {
      id: input.id ?? newId('prop'),
      ticker,
      base_revision_hash: input.base_revision_hash ?? null,
      status: input.status ?? 'pending',
      created_at: utcNow(),
      payload_json: payloadJson,
    };
    this.db
      .prepare('INSERT INTO proposals(id, ticker, base_revision_hash, status, created_at, payload_json) VALUES(?, ?, ?, ?, ?, ?)')
      .run(rec.id, rec.ticker, rec.base_revision_hash, rec.status, rec.created_at, rec.payload_json);
    return rec;
  }

  getProposal(id: string): ProposalRecord | null {
    const row = this.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id);
    return row === undefined ? null : mapProposal(row);
  }

  setProposalStatus(id: string, status: string): ProposalRecord {
    const existing = this.getProposal(id);
    if (existing === null) throw new Error(`Proposal not found: ${id}`);
    this.db.prepare('UPDATE proposals SET status = ? WHERE id = ?').run(status, id);
    const updated = this.getProposal(id);
    if (updated === null) throw new Error(`Proposal not found: ${id}`);
    return updated;
  }

  updateProposalPayload(id: string, payloadJson: string): ProposalRecord {
    const existing = this.getProposal(id);
    if (existing === null) throw new Error(`Proposal not found: ${id}`);
    this.db.prepare('UPDATE proposals SET payload_json = ? WHERE id = ?').run(payloadJson, id);
    const updated = this.getProposal(id);
    if (updated === null) throw new Error(`Proposal not found: ${id}`);
    return updated;
  }

  /** Finalize an application: status + audit payload. Kept together so callers do one call. */
  markProposalApplied(id: string, payloadJson: string): ProposalRecord {
    const existing = this.getProposal(id);
    if (existing === null) throw new Error(`Proposal not found: ${id}`);
    this.db.prepare('UPDATE proposals SET status = ?, payload_json = ? WHERE id = ?').run('applied', payloadJson, id);
    const updated = this.getProposal(id);
    if (updated === null) throw new Error(`Proposal not found: ${id}`);
    return updated;
  }

  /** Remove a revision row (rollback only; revision files are never rewritten). */
  deleteRevision(id: string): void {
    this.db.prepare('DELETE FROM revisions WHERE id = ?').run(id);
  }

  listProposals(ticker?: string): ProposalRecord[] {
    if (ticker === undefined) {
      return this.db.prepare('SELECT * FROM proposals ORDER BY created_at DESC, id DESC').all().map(mapProposal);
    }
    return this.db
      .prepare('SELECT * FROM proposals WHERE ticker = ? ORDER BY created_at DESC, id DESC')
      .all(normalizeTicker(ticker))
      .map(mapProposal);
  }

  saveSnapshot(input: SaveSnapshotInput): SnapshotRecord {
    const ticker = normalizeTicker(input.ticker);
    if (!input.accession || input.accession.trim().length === 0) throw new Error('accession is required.');
    const payloadJson = input.payload_json !== undefined ? input.payload_json : JSON.stringify(input.payload ?? null);
    const rec: SnapshotRecord = {
      ticker,
      accession: input.accession,
      filed_date: input.filed_date ?? null,
      fetched_at: input.fetched_at ?? utcNow(),
      payload_json: payloadJson,
    };
    this.db
      .prepare('INSERT OR REPLACE INTO snapshots(ticker, accession, filed_date, fetched_at, payload_json) VALUES(?, ?, ?, ?, ?)')
      .run(rec.ticker, rec.accession, rec.filed_date, rec.fetched_at, rec.payload_json);
    return rec;
  }

  getLatestSnapshot(ticker: string): SnapshotRecord | null {
    const row = this.db
      .prepare('SELECT * FROM snapshots WHERE ticker = ? ORDER BY filed_date DESC, fetched_at DESC LIMIT 1')
      .get(normalizeTicker(ticker));
    return row === undefined ? null : mapSnapshot(row);
  }

  getSnapshot(ticker: string, accession: string): SnapshotRecord | null {
    const row = this.db
      .prepare('SELECT * FROM snapshots WHERE ticker = ? AND accession = ? LIMIT 1')
      .get(normalizeTicker(ticker), accession);
    return row === undefined ? null : mapSnapshot(row);
  }

  listSnapshots(ticker: string): SnapshotRecord[] {
    return this.db
      .prepare('SELECT * FROM snapshots WHERE ticker = ? ORDER BY filed_date DESC, fetched_at DESC')
      .all(normalizeTicker(ticker))
      .map(mapSnapshot);
  }

  setWatch(ticker: string, patch?: WatchPatch): WatchRecord {
    const key = normalizeTicker(ticker);
    const existing = this.getWatch(key);
    const toFlag = (v: number | boolean | undefined, fallback: number): number => {
      if (v === undefined) return fallback;
      return v ? 1 : 0;
    };
    const rec: WatchRecord = {
      ticker: key,
      enabled: toFlag(patch?.enabled, existing?.enabled ?? 1),
      last_check: patch?.last_check !== undefined ? patch.last_check : (existing?.last_check ?? null),
      latest_accession: patch?.latest_accession !== undefined ? patch.latest_accession : (existing?.latest_accession ?? null),
      update_ready: toFlag(patch?.update_ready, existing?.update_ready ?? 0),
      last_error: patch?.last_error !== undefined ? patch.last_error : (existing?.last_error ?? null),
    };
    this.db
      .prepare('INSERT OR REPLACE INTO watch(ticker, enabled, last_check, latest_accession, update_ready, last_error) VALUES(?, ?, ?, ?, ?, ?)')
      .run(rec.ticker, rec.enabled, rec.last_check, rec.latest_accession, rec.update_ready, rec.last_error);
    return rec;
  }

  getWatch(ticker: string): WatchRecord | null {
    const row = this.db.prepare('SELECT * FROM watch WHERE ticker = ?').get(normalizeTicker(ticker));
    return row === undefined ? null : mapWatch(row);
  }

  listWatch(): WatchRecord[] {
    return this.db.prepare('SELECT * FROM watch ORDER BY ticker ASC').all().map(mapWatch);
  }
}
