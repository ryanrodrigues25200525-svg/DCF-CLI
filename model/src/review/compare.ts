/**
 * Shared read-only revision comparison for the CLI (`dcf model compare`)
 * and the MCP `model_compare` / `revisions_list` tools. Never writes
 * workbooks, manifests, or index rows. The MCP path additionally opens the
 * SQLite file itself read-only with no directory creation and no schema
 * migration (`readOnly: true`); the CLI path keeps the migrating open used
 * by builds. Older-schema rows map missing metadata columns to null.
 *
 * Each revision records BOTH the filing actually mapped into the workbook
 * facts (fact accession/filed date/period) AND the latest detected filing at
 * build time (form/accession/filed/report date), so an annual-only route is
 * never described as quarter-updated: when they differ the output states
 * explicitly that the newer filing was not mapped into the workbook.
 */
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  ModelLibrary,
  currentWorkbookPath,
  findLibraryDb,
  normalizeTicker,
  revisionPath,
} from '@/library/store';
import type { RevisionRecord } from '@/library/types';
import {
  diffWorkbookCells,
  findBackendPython,
  WORKBOOK_DIFF_DEFAULT_LIMIT,
  WORKBOOK_DIFF_HARD_CAP,
  WORKBOOK_DIFF_MAX_LIMIT,
  type WorkbookCellChange,
} from '@/workbook/xlsx';

export interface RevisionFilingView {
  accession: string | null;
  filedDate: string | null;
  period: string | null;
}

export interface RevisionLatestView {
  form: string | null;
  accession: string | null;
  filedDate: string | null;
  reportDate: string | null;
}

export interface RevisionSummary {
  id: string;
  hash: string;
  parentHash: string | null;
  createdAt: string;
  buildEvent: string | null;
  note: string | null;
  route: string | null;
  readiness: string | null;
  fact: RevisionFilingView;
  latest: RevisionLatestView;
}

export function summarizeRevision(rev: RevisionRecord): RevisionSummary {
  return {
    id: rev.id,
    hash: rev.workbook_hash,
    parentHash: rev.parent_hash,
    createdAt: rev.created_at,
    buildEvent: rev.build_event,
    note: rev.note,
    route: rev.route,
    readiness: rev.readiness,
    fact: {
      accession: rev.fact_accession,
      filedDate: rev.fact_filed_date,
      period: rev.fact_period,
    },
    latest: {
      form: rev.latest_form,
      accession: rev.latest_accession,
      filedDate: rev.latest_filed_date,
      reportDate: rev.latest_report_date,
    },
  };
}

export interface FieldDelta {
  from: string | null;
  to: string | null;
  changed: boolean;
}

function delta(from: string | null, to: string | null): FieldDelta {
  return {from, to, changed: from !== to};
}

export interface SourceDelta {
  route: FieldDelta;
  readiness: FieldDelta;
  factAccession: FieldDelta;
  factFiledDate: FieldDelta;
  factPeriod: FieldDelta;
  latestForm: FieldDelta;
  latestAccession: FieldDelta;
  latestFiledDate: FieldDelta;
  latestReportDate: FieldDelta;
}

export interface WorkbookComparison {
  beforeFile: string;
  afterFile: string;
  beforeFileSource: 'archive' | 'current-fallback';
  afterFileSource: 'archive' | 'current-fallback';
  beforeHash: string;
  afterHash: string;
  identicalBytes: boolean;
  addedSheets: string[];
  removedSheets: string[];
  totalChanges: number;
  /** True when differences exceed the hard collection cap (not listable). */
  truncated: boolean;
  /** True when another detail page is available at nextOffset. */
  hasMore: boolean;
  /** Offset for the next detail page, or null when the current page is last. */
  nextOffset: number | null;
  offset: number;
  limit: number;
  changes: WorkbookCellChange[];
}

export interface RevisionComparison {
  ticker: string;
  from: RevisionSummary;
  to: RevisionSummary;
  sameRevision: boolean;
  sourceDelta: SourceDelta;
  /** Human-readable filing-freshness notes (annual-only guard lives here). */
  freshness: string[];
  workbook: WorkbookComparison;
  summary: string;
}

/** Match a revision selector to an id first, then to a workbook-hash prefix. */
function selectRevision(revisions: RevisionRecord[], selector: string, role: string): RevisionRecord {
  const exact = revisions.find((r) => r.id === selector);
  if (exact) return exact;
  const byHash = revisions.filter((r) => r.workbook_hash.startsWith(selector));
  if (byHash.length === 1) return byHash[0]!;
  if (byHash.length > 1) {
    throw new Error(
      `--${role} ${selector} matches ${byHash.length} revisions by hash prefix; use the full revision id.`,
    );
  }
  const known = revisions.map((r) => r.id).slice(0, 10).join(', ');
  throw new Error(`--${role} ${selector} matches no revision for this ticker. Known revisions: ${known || '(none)'}.`);
}

/**
 * Resolve the compared pair. Defaults: --to is the accepted (manifest)
 * revision when known, else the newest; --from is the latest strictly earlier
 * revision whose workbook hash matches --to's parent hash (never --to
 * itself, so identical-byte consecutive builds compare as two revisions),
 * else the next-older revision, else --to itself (a single-revision library
 * compares as an explicit no-change).
 */
export function resolveRevisionPair(
  revisions: RevisionRecord[],
  acceptedRevisionId: string | null,
  fromSelector?: string,
  toSelector?: string,
): { from: RevisionRecord; to: RevisionRecord } {
  if (revisions.length === 0) throw new Error('No revisions found for this ticker. Build a model first.');
  const ordered = [...revisions].sort((a, b) =>
    a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : (a.created_at < b.created_at ? -1 : 1),
  );
  const accepted = acceptedRevisionId ? revisions.find((r) => r.id === acceptedRevisionId) : undefined;
  const to = toSelector
    ? selectRevision(revisions, toSelector, 'to')
    : (accepted ?? ordered[ordered.length - 1]!);
  let from: RevisionRecord;
  if (fromSelector) {
    from = selectRevision(revisions, fromSelector, 'from');
  } else if (to.parent_hash) {
    from = resolveParentByHash(ordered, to) ?? predecessorOf(ordered, to);
  } else {
    from = predecessorOf(ordered, to);
  }
  return {from, to};
}

/**
 * Latest revision strictly earlier than `to` whose workbook hash matches
 * `to`'s parent hash. Earlier-only so a revision whose parent hash equals
 * its own hash (identical-byte consecutive builds) never resolves to itself.
 */
function resolveParentByHash(ordered: RevisionRecord[], to: RevisionRecord): RevisionRecord | null {
  const index = ordered.findIndex((r) => r.id === to.id);
  const earlier = index < 0 ? ordered : ordered.slice(0, index);
  const matches = earlier.filter((r) => r.workbook_hash === to.parent_hash);
  return matches.length > 0 ? matches[matches.length - 1]! : null;
}

function predecessorOf(ordered: RevisionRecord[], to: RevisionRecord): RevisionRecord {
  const index = ordered.findIndex((r) => r.id === to.id);
  return index > 0 ? ordered[index - 1]! : to;
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function tryFileHash(path: string): string | null {
  try {
    return sha256File(path);
  } catch {
    return null;
  }
}

/**
 * Resolve the readable workbook file for a revision: the immutable archive
 * copy, verified byte-for-byte against the recorded revision hash. A missing
 * or diverged archive falls back to current.xlsx only when its bytes exactly
 * match the recorded hash (reported via the file-source marker, never
 * silently); otherwise comparison fails closed. Never creates or repairs
 * archive files here — a diverged archive is evidence, not something to
 * overwrite.
 */
function resolveRevisionFile(
  root: string,
  ticker: string,
  rev: RevisionRecord,
  currentHash: string | null,
): { path: string; source: 'archive' | 'current-fallback' } {
  const archived = revisionPath(root, ticker, rev.id);
  const current = currentWorkbookPath(root, ticker);
  const currentMatches =
    currentHash !== null && rev.workbook_hash !== '' && currentHash === rev.workbook_hash && existsSync(current);
  if (existsSync(archived)) {
    // No recorded hash to verify against (legacy row): nothing to check.
    if (rev.workbook_hash === '') return {path: archived, source: 'archive'};
    const archiveHash = tryFileHash(archived);
    if (archiveHash !== null && archiveHash === rev.workbook_hash) {
      return {path: archived, source: 'archive'};
    }
    if (currentMatches) {
      return {path: current, source: 'current-fallback'};
    }
    throw new Error(
      `Revision file for ${rev.id} does not match its recorded hash (${archived}; expected ${rev.workbook_hash}, found ${archiveHash ?? 'unreadable'}) and current.xlsx does not match it either; cannot compare. Restore the archive before comparing.`,
    );
  }
  if (currentMatches) {
    return {path: current, source: 'current-fallback'};
  }
  throw new Error(
    `Revision file for ${rev.id} is missing (${archived}) and current.xlsx does not match its hash; cannot compare.`,
  );
}

function currentFileHash(root: string, ticker: string): string | null {
  const current = currentWorkbookPath(root, ticker);
  if (!existsSync(current)) return null;
  try {
    return sha256File(current);
  } catch {
    return null;
  }
}

/** Filing-freshness notes; states plainly when a newer filing was NOT mapped. */
export function freshnessNotes(ticker: string, rev: RevisionSummary): string[] {
  const notes: string[] = [];
  const fact = rev.fact.accession;
  const latest = rev.latest.accession;
  if (fact && latest && fact !== latest) {
    const form = rev.latest.form ? `Form ${rev.latest.form} ` : '';
    const period = rev.fact.period ? ` (${rev.fact.period})` : '';
    const annualOnly = rev.fact.period?.startsWith('annual') === true;
    notes.push(
      `${ticker} revision ${rev.id} maps facts from ${fact}${period} (filed ${rev.fact.filedDate ?? 'unknown'}); ` +
      `latest detected filing ${form}${latest} (filed ${rev.latest.filedDate ?? 'unknown'}) was NOT mapped into this workbook` +
      (annualOnly ? ' — this is an annual-only model, not updated with the newer filing.' : '.'),
    );
  } else if (fact && latest) {
    const period = rev.fact.period ? ` (${rev.fact.period})` : '';
    notes.push(
      `${ticker} revision ${rev.id} maps facts from ${fact}${period} (filed ${rev.fact.filedDate ?? 'unknown'}); ` +
      `this was also the latest detected filing at build time.`,
    );
  } else if (fact) {
    const period = rev.fact.period ? ` (${rev.fact.period})` : '';
    notes.push(
      `${ticker} revision ${rev.id} maps facts from ${fact}${period} (filed ${rev.fact.filedDate ?? 'unknown'}); ` +
      `freshness is unconfirmed — no latest-filing metadata was captured at build time, so a newer filing may exist.`,
    );
  } else if (latest) {
    const form = rev.latest.form ? `Form ${rev.latest.form} ` : '';
    notes.push(
      `${ticker} revision ${rev.id} stores no mapped fact accession; latest detected filing ${form}${latest} ` +
      `(filed ${rev.latest.filedDate ?? 'unknown'}) — whether it was mapped into this workbook is unconfirmed; ` +
      `compare shows workbook cells only for freshness.`,
    );
  } else {
    notes.push(
      `${ticker} revision ${rev.id} predates filing-context tracking (no fact/latest accession stored); compare shows workbook cells only.`,
    );
  }
  return notes;
}

/**
 * Open the library for comparison. `readOnly: true` (the CLI compare and MCP
 * paths) opens the existing SQLite file read-only with no directory creation
 * and no schema migration; the default keeps migrating opens for builds.
 */
function openLibraryFor(root: string, readOnly?: boolean): ModelLibrary {
  return readOnly ? ModelLibrary.openReadOnly(root) : new ModelLibrary(root);
}

/** Clean build-first error when no library database exists yet. Creates nothing. */
function requireLibraryDb(root: string, ticker: string): void {
  if (!findLibraryDb(root)) {
    throw new Error(`No model found for ticker ${ticker}. Build one first with \`dcf build ${ticker}\`.`);
  }
}

export interface CompareOptions {
  from?: string;
  to?: string;
  offset?: number;
  limit?: number;
  readOnly?: boolean;
}

/**
 * Compare two revisions of a ticker's model. Read-only: opens the library
 * index and reads workbook files, writes nothing.
 */
export async function compareRevisions(
  root: string,
  tickerRaw: string,
  opts?: CompareOptions,
): Promise<RevisionComparison> {
  const ticker = normalizeTicker(tickerRaw);
  if (opts?.readOnly) requireLibraryDb(root, ticker);
  const lib = openLibraryFor(root, opts?.readOnly);
  try {
    const company = lib.getCompany(ticker);
    if (!company) throw new Error(`No model found for ticker ${ticker}. Build one first with \`dcf build ${ticker}\`.`);
    const revisions = lib.listRevisions(ticker);
    const {from, to} = resolveRevisionPair(revisions, company.revision_id, opts?.from, opts?.to);
    const fromSummary = summarizeRevision(from);
    const toSummary = summarizeRevision(to);
    const sameRevision = from.id === to.id;

    const sourceDelta: SourceDelta = {
      route: delta(fromSummary.route, toSummary.route),
      readiness: delta(fromSummary.readiness, toSummary.readiness),
      factAccession: delta(fromSummary.fact.accession, toSummary.fact.accession),
      factFiledDate: delta(fromSummary.fact.filedDate, toSummary.fact.filedDate),
      factPeriod: delta(fromSummary.fact.period, toSummary.fact.period),
      latestForm: delta(fromSummary.latest.form, toSummary.latest.form),
      latestAccession: delta(fromSummary.latest.accession, toSummary.latest.accession),
      latestFiledDate: delta(fromSummary.latest.filedDate, toSummary.latest.filedDate),
      latestReportDate: delta(fromSummary.latest.reportDate, toSummary.latest.reportDate),
    };

    const freshness = [...freshnessNotes(ticker, fromSummary)];
    if (!sameRevision) freshness.push(...freshnessNotes(ticker, toSummary));

    const onDiskHash = currentFileHash(root, ticker);
    const before = resolveRevisionFile(root, ticker, from, onDiskHash);
    const after = resolveRevisionFile(root, ticker, to, onDiskHash);
    const beforeHash = sha256File(before.path);
    const afterHash = sha256File(after.path);
    const identicalBytes = beforeHash === afterHash;

    const python = findBackendPython();
    let workbook: WorkbookComparison;
    if (identicalBytes) {
      // Skip the cell scan: identical bytes cannot differ in any cell.
      const offset = opts?.offset ?? 0;
      const limit = opts?.limit ?? WORKBOOK_DIFF_DEFAULT_LIMIT;
      if (!Number.isInteger(offset) || offset < 0) throw new Error('diff offset must be an integer >= 0.');
      if (!Number.isInteger(limit) || limit < 1 || limit > WORKBOOK_DIFF_MAX_LIMIT) {
        throw new Error(`diff limit must be an integer between 1 and ${WORKBOOK_DIFF_MAX_LIMIT}.`);
      }
      workbook = {
        beforeFile: before.path,
        afterFile: after.path,
        beforeFileSource: before.source,
        afterFileSource: after.source,
        beforeHash,
        afterHash,
        identicalBytes: true,
        addedSheets: [],
        removedSheets: [],
        totalChanges: 0,
        truncated: false,
        hasMore: false,
        nextOffset: null,
        offset,
        limit,
        changes: [],
      };
    } else {
      if (!python) {
        throw new Error('No Python with openpyxl is available (backend/.venv); cannot compare workbook cells.');
      }
      const diff = await diffWorkbookCells(python, before.path, after.path, {offset: opts?.offset, limit: opts?.limit});
      workbook = {
        beforeFile: before.path,
        afterFile: after.path,
        beforeFileSource: before.source,
        afterFileSource: after.source,
        beforeHash,
        afterHash,
        identicalBytes: false,
        addedSheets: diff.addedSheets,
        removedSheets: diff.removedSheets,
        totalChanges: diff.totalChanges,
        truncated: diff.truncated,
        hasMore: diff.hasMore,
        nextOffset: diff.nextOffset,
        offset: diff.offset,
        limit: diff.limit,
        changes: diff.changes,
      };
    }

    const sourceChanged = Object.values(sourceDelta).some((d) => d.changed);
    const summary = sameRevision || (identicalBytes && !sourceChanged)
      ? `No changes between ${from.id} and ${to.id}: identical bytes and same source context.`
      : identicalBytes
        ? `Workbook cells unchanged between ${from.id} and ${to.id} (identical bytes)${sourceChanged ? '; source/model context differs' : ''}.`
        : workbook.totalChanges === 0
          ? `No formula/value cell changes between ${from.id} and ${to.id}: workbook bytes differ (file-level metadata only)${sourceChanged ? '; source/model context also differs' : ''}.`
          : `${workbook.totalChanges} cell change(s) between ${from.id} and ${to.id}${sourceChanged ? ' plus source/model context changes' : ''}.`;

    return {ticker, from: fromSummary, to: toSummary, sameRevision, sourceDelta, freshness, workbook, summary};
  } finally {
    lib.close();
  }
}

/** Bounded revision history for CLI/MCP listing (newest first). */
export function listRevisionSummaries(
  root: string,
  tickerRaw: string,
  opts?: { offset?: number; limit?: number; readOnly?: boolean },
): { ticker: string; total: number; offset: number; limit: number; revisions: RevisionSummary[] } {
  const ticker = normalizeTicker(tickerRaw);
  const offset = opts?.offset ?? 0;
  const limit = opts?.limit ?? 20;
  if (!Number.isInteger(offset) || offset < 0) throw new Error('offset must be an integer >= 0.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer between 1 and 100.');
  if (opts?.readOnly) requireLibraryDb(root, ticker);
  const lib = openLibraryFor(root, opts?.readOnly);
  try {
    const all = lib.listRevisions(ticker);
    return {
      ticker,
      total: all.length,
      offset,
      limit,
      revisions: all.slice(offset, offset + limit).map(summarizeRevision),
    };
  } finally {
    lib.close();
  }
}

/** Human-readable compare report (mirrors the JSON payload). */
export function formatCompareMarkdown(c: RevisionComparison): string {
  const lines: string[] = [];
  const short = (h: string): string => h.slice(0, 12);
  const factLine = (s: RevisionSummary): string =>
    `fact ${s.fact.accession ?? 'unknown'}${s.fact.period ? ` (${s.fact.period})` : ''} filed ${s.fact.filedDate ?? 'unknown'}`;
  const latestLine = (s: RevisionSummary): string =>
    s.latest.accession
      ? `latest ${s.latest.form ? `${s.latest.form} ` : ''}${s.latest.accession} filed ${s.latest.filedDate ?? 'unknown'}${s.latest.reportDate ? ` report ${s.latest.reportDate}` : ''}`
      : 'latest filing unknown (predates tracking or unavailable)';
  const header = (s: RevisionSummary): string =>
    `${s.id} (${short(s.hash)}, built ${s.createdAt || 'unknown'}${s.buildEvent ? `, ${s.buildEvent}` : ''}, route=${s.route ?? '-'}, readiness=${s.readiness ?? '-'})`;
  lines.push(`# Compare ${c.ticker}: ${c.from.id} -> ${c.to.id}`);
  lines.push('');
  lines.push(`From: ${header(c.from)}`);
  lines.push(`  ${factLine(c.from)}`);
  lines.push(`  ${latestLine(c.from)}`);
  lines.push(`To:   ${header(c.to)}`);
  lines.push(`  ${factLine(c.to)}`);
  lines.push(`  ${latestLine(c.to)}`);
  lines.push('');
  for (const note of c.freshness) lines.push(`Freshness: ${note}`);
  lines.push('');
  const deltas: Array<[string, FieldDelta]> = [
    ['route', c.sourceDelta.route],
    ['readiness', c.sourceDelta.readiness],
    ['fact accession', c.sourceDelta.factAccession],
    ['fact filed date', c.sourceDelta.factFiledDate],
    ['fact period', c.sourceDelta.factPeriod],
    ['latest form', c.sourceDelta.latestForm],
    ['latest accession', c.sourceDelta.latestAccession],
    ['latest filed date', c.sourceDelta.latestFiledDate],
    ['latest report date', c.sourceDelta.latestReportDate],
  ];
  const changed = deltas.filter(([, d]) => d.changed);
  lines.push(changed.length === 0
    ? 'Source/model context: unchanged.'
    : `Source/model context changes (${changed.length}):`);
  for (const [name, d] of changed) lines.push(`  - ${name}: ${d.from ?? '-'} -> ${d.to ?? '-'}`);
  lines.push('');
  if (c.workbook.identicalBytes) {
    lines.push('Workbook cells: no changes (identical bytes).');
  } else if (c.workbook.totalChanges === 0) {
    lines.push('Workbook cells: no formula/value changes (bytes differ only in file-level metadata).');
    if (c.workbook.addedSheets.length > 0) lines.push(`  Added sheets: ${c.workbook.addedSheets.join(', ')}`);
    if (c.workbook.removedSheets.length > 0) lines.push(`  Removed sheets: ${c.workbook.removedSheets.join(', ')}`);
  } else {
    const pageNote = `showing ${c.workbook.changes.length} (offset ${c.workbook.offset}, limit ${c.workbook.limit})`;
    if (c.workbook.truncated) {
      lines.push(`Workbook cells: ${c.workbook.totalChanges} change(s) (truncated at collection cap ${WORKBOOK_DIFF_HARD_CAP}; differences past the cap are not listable) ${pageNote}${c.workbook.hasMore && c.workbook.nextOffset !== null ? ` — more pages available within the cap: rerun with offset ${c.workbook.nextOffset}.` : '.'}`);
    } else if (c.workbook.hasMore && c.workbook.nextOffset !== null) {
      lines.push(`Workbook cells: ${c.workbook.totalChanges} change(s) ${pageNote}. More changes available: rerun with offset ${c.workbook.nextOffset} (total ${c.workbook.totalChanges}).`);
    } else {
      lines.push(`Workbook cells: ${c.workbook.totalChanges} change(s) ${pageNote}.`);
    }
    if (c.workbook.addedSheets.length > 0) lines.push(`  Added sheets: ${c.workbook.addedSheets.join(', ')}`);
    if (c.workbook.removedSheets.length > 0) lines.push(`  Removed sheets: ${c.workbook.removedSheets.join(', ')}`);
    for (const ch of c.workbook.changes) {
      const before = ch.beforeFormula ?? JSON.stringify(ch.beforeValue);
      const after = ch.afterFormula ?? JSON.stringify(ch.afterValue);
      lines.push(`  - ${ch.sheet}!${ch.cell} [${ch.kind}]: ${before} -> ${after}`);
    }
  }
  lines.push('');
  lines.push(c.summary);
  return lines.join('\n');
}
