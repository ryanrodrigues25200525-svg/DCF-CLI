import { execFile as execFileCb } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import {
  ModelLibrary,
  currentWorkbookPath,
  normalizeTicker,
  revisionPath,
} from '@/library/store';
import { runStaticWorkbookChecks } from '@/review/review-checks';
import { candidateWorkbookPath } from '@/review/build-candidate';

const execFileAsync = promisify(execFileCb);

export type CellDiffKind = 'added' | 'removed' | 'formula' | 'value';

export interface CellDiff {
  sheet: string;
  cell: string;
  kind: CellDiffKind;
  before: string | null;
  after: string | null;
}

export interface WorkbookDiff {
  beforeSheets: string[];
  afterSheets: string[];
  addedSheets: string[];
  removedSheets: string[];
  /** Bounded detail list (see totalChanges/truncated). */
  changes: CellDiff[];
  totalChanges: number;
  truncated: boolean;
}

/** Default detail cap; MCP may request 1..COMPARE_MAX_LIMIT. */
export const REVISION_DIFF_DEFAULT_LIMIT = 200;
export const REVISION_DIFF_MAX_LIMIT = 500;

const DIFF_SCRIPT = `
import json, sys
import openpyxl

def scalar(value):
    import datetime
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    return str(value)

def snapshot(path):
    wf = openpyxl.load_workbook(path, data_only=False, read_only=True)
    wc = openpyxl.load_workbook(path, data_only=True, read_only=True)
    cells = {}
    try:
        for ws in wf.worksheets:
            try:
                cs = wc[ws.title]
            except KeyError:
                cs = None
            for row in ws.iter_rows():
                for c in row:
                    raw = c.value
                    formula = raw if (isinstance(raw, str) and raw.startswith('=')) else None
                    if formula is not None:
                        try:
                            cached = cs[c.coordinate].value if cs is not None else None
                        except Exception:
                            cached = None
                        value = scalar(cached)
                    else:
                        value = scalar(raw)
                    if formula is None and value is None:
                        continue
                    cells[(ws.title, c.coordinate)] = (formula, value)
        titles = [ws.title for ws in wf.worksheets]
    finally:
        try:
            wf.close()
        except Exception:
            pass
        try:
            wc.close()
        except Exception:
            pass
    return titles, cells

def tag(value):
    if isinstance(value, bool):
        return ('b', value)
    if isinstance(value, (int, float)):
        return ('n', float(value))
    return ('o', value if value is None else str(value))

def render(formula, value):
    if formula is not None:
        return formula
    if value is None:
        return None
    if isinstance(value, bool):
        return 'true' if value else 'false'
    return str(value)

before_titles, before_cells = snapshot(sys.argv[1]) if sys.argv[1] else ([], {})
after_titles, after_cells = snapshot(sys.argv[2])
added_sheets = sorted(set(after_titles) - set(before_titles))
removed_sheets = sorted(set(before_titles) - set(after_titles))
changes = []
for key in sorted(set(before_cells) | set(after_cells)):
    sheet, cell = key
    if key not in before_cells:
        formula, value = after_cells[key]
        changes.append({'sheet': sheet, 'cell': cell, 'kind': 'added',
                        'before': None, 'after': render(formula, value)})
    elif key not in after_cells:
        formula, value = before_cells[key]
        changes.append({'sheet': sheet, 'cell': cell, 'kind': 'removed',
                        'before': render(formula, value), 'after': None})
    else:
        before_formula, before_value = before_cells[key]
        after_formula, after_value = after_cells[key]
        if before_formula != after_formula:
            changes.append({'sheet': sheet, 'cell': cell, 'kind': 'formula',
                            'before': render(before_formula, before_value),
                            'after': render(after_formula, after_value)})
        elif tag(before_value) != tag(after_value):
            changes.append({'sheet': sheet, 'cell': cell, 'kind': 'value',
                            'before': render(None, before_value),
                            'after': render(None, after_value)})
print(json.dumps({
    'beforeSheets': before_titles,
    'afterSheets': after_titles,
    'addedSheets': added_sheets,
    'removedSheets': removed_sheets,
    'totalChanges': len(changes),
    'changes': changes,
}))
`;

/** Diff two workbooks (beforePath null diffs against empty). Detail is
 *  capped at `limit` (default 200, max 500); totalChanges is exact. */
export async function compareWorkbooks(
  python: string,
  beforePath: string | null,
  afterPath: string,
  options?: { limit?: number },
): Promise<WorkbookDiff> {
  const limit = options?.limit ?? REVISION_DIFF_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > REVISION_DIFF_MAX_LIMIT) {
    throw new Error(`compareWorkbooks: limit must be an integer 1..${REVISION_DIFF_MAX_LIMIT}`);
  }
  if (!existsSync(afterPath)) throw new Error(`compareWorkbooks: after workbook is missing: ${afterPath}`);
  if (beforePath !== null && !existsSync(beforePath)) {
    throw new Error(`compareWorkbooks: before workbook is missing: ${beforePath}`);
  }
  let stdout: string;
  try {
    const res = await execFileAsync(python, ['-c', DIFF_SCRIPT, beforePath ?? '', afterPath], {
      timeout: 180_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    stdout = res.stdout;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(`compareWorkbooks failed: ${String(e.stderr ?? e.message ?? err).slice(-2000)}`);
  }
  let parsed: {
    beforeSheets: string[]; afterSheets: string[]; addedSheets: string[];
    removedSheets: string[]; totalChanges: number;
    changes: Array<{ sheet: string; cell: string; kind: CellDiffKind; before: string | null; after: string | null }>;
  };
  try {
    parsed = JSON.parse(stdout.trim().split('\n').pop() as string);
  } catch {
    throw new Error('compareWorkbooks: could not parse python output');
  }
  return {
    beforeSheets: parsed.beforeSheets,
    afterSheets: parsed.afterSheets,
    addedSheets: parsed.addedSheets,
    removedSheets: parsed.removedSheets,
    changes: parsed.changes.slice(0, limit),
    totalChanges: parsed.totalChanges,
    truncated: parsed.totalChanges > limit,
  };
}

export interface CompareEndpoint {
  label: string;
  path: string;
}

function shaOf(path: string): string {
  return runStaticWorkbookChecks(path).sha256;
}

/** Resolve a compare endpoint: revision id, `accepted`, or `candidate`.
 *  Archives are hash-verified against their revision rows; the accepted
 *  copy must match the manifest; the candidate must match its staged hash.
 *  Anything else fails closed instead of inventing a diff. */
export function resolveCompareEndpoint(
  lib: ModelLibrary,
  root: string,
  ticker: string,
  ref: string | undefined,
  role: 'from' | 'to',
): CompareEndpoint | null {
  const norm = normalizeTicker(ticker);
  if (ref === undefined || ref === null || ref === '') {
    if (role === 'to') {
      const pending = lib.getPendingCandidate(norm);
      if (pending) {
        return verifiedCandidateEndpoint(root, norm, pending.id, pending.workbook_hash);
      }
      return resolveCompareEndpoint(lib, root, norm, 'accepted', 'to');
    }
    return defaultFromEndpoint(lib, root, norm);
  }
  const lowered = ref.trim().toLowerCase();
  if (lowered === 'candidate') {
    const pending = lib.getPendingCandidate(norm);
    if (!pending) throw new Error(`No pending build candidate for ${norm}; stage one with \`dcf build ${norm}\`.`);
    return resolveCompareEndpoint(lib, root, norm, pending.id, role);
  }
  if (lowered === 'accepted') {
    const manifest = lib.getCompany(norm);
    if (!manifest?.workbook_hash) throw new Error(`No accepted revision for ${norm}; build and accept a candidate first.`);
    const path = currentWorkbookPath(root, norm);
    if (!existsSync(path)) throw new Error(`The accepted workbook for ${norm} is missing; cannot compare.`);
    if (shaOf(path) !== manifest.workbook_hash) {
      throw new Error(`MANUAL_EDIT_DETECTED: the saved workbook for ${norm} differs from its accepted revision; cannot compare.`);
    }
    return { label: `accepted ${manifest.revision_id ?? manifest.workbook_hash}`, path };
  }
  const revision = lib.getRevision(ref.trim());
  if (!revision || revision.ticker !== norm) throw new Error(`Revision not found for ${norm}: ${ref.trim()}`);
  return verifiedArchiveEndpoint(root, norm, revision.id, revision.workbook_hash);
}

function verifiedCandidateEndpoint(root: string, ticker: string, candidateId: string, stagedHash: string): CompareEndpoint {
  const path = candidateWorkbookPath(root, ticker, candidateId);
  if (!existsSync(path)) throw new Error(`Pending candidate workbook for ${ticker} is missing; cannot compare.`);
  if (shaOf(path) !== stagedHash) {
    throw new Error(`Pending candidate workbook for ${ticker} no longer matches its staged hash; cannot compare.`);
  }
  return { label: `candidate ${candidateId}`, path };
}

function verifiedArchiveEndpoint(root: string, ticker: string, revisionId: string, recordedHash: string): CompareEndpoint {
  const path = revisionPath(root, ticker, revisionId);
  if (!existsSync(path)) throw new Error(`Revision archive ${revisionId} is missing; cannot compare.`);
  if (shaOf(path) !== recordedHash) {
    throw new Error(`Revision archive ${revisionId} does not match its recorded hash; refusing to compare.`);
  }
  return { label: `revision ${revisionId}`, path };
}

/** Default `from`: the pending candidate's recorded base revision when one is
 *  pending (what changed since the base), else the accepted copy's parent
 *  revision, else null (initial revision: everything reads as added). */
function defaultFromEndpoint(lib: ModelLibrary, root: string, ticker: string): CompareEndpoint | null {
  const norm = normalizeTicker(ticker);
  const pending = lib.getPendingCandidate(norm);
  if (pending) {
    let baseHash: string | null = pending.base_revision_hash;
    try {
      const parsed = JSON.parse(pending.payload_json) as { baseRevisionHash?: unknown };
      if (typeof parsed.baseRevisionHash === 'string' && parsed.baseRevisionHash) baseHash = parsed.baseRevisionHash;
    } catch {
      // Fall back to the row value.
    }
    if (typeof baseHash !== 'string' || !baseHash) return null;
    const base = lib.listRevisions(norm).find((r) => r.workbook_hash === baseHash) ?? null;
    if (!base) return null;
    return verifiedArchiveEndpoint(root, norm, base.id, base.workbook_hash);
  }
  return defaultFromAccepted(lib, root, norm);
}

/** Default `from` with no pending candidate: the accepted copy's parent
 *  revision, else null (initial revision). */
function defaultFromAccepted(lib: ModelLibrary, root: string, ticker: string): CompareEndpoint | null {
  const norm = normalizeTicker(ticker);
  const manifest = lib.getCompany(norm);
  if (!manifest?.workbook_hash) return null;
  const revisions = lib.listRevisions(norm);
  const parent = revisions.find((r) => r.workbook_hash === manifest.workbook_hash)?.parent_hash ?? null;
  if (!parent) return null;
  const parentRev = revisions.find((r) => r.workbook_hash === parent) ?? null;
  if (!parentRev) return null;
  return verifiedArchiveEndpoint(root, norm, parentRev.id, parentRev.workbook_hash);
}

export function formatCompareMarkdown(ticker: string, fromLabel: string, toLabel: string, diff: WorkbookDiff): string {
  const lines: string[] = [];
  lines.push(`# Revision comparison — ${ticker}`);
  lines.push('');
  lines.push(`- From: ${fromLabel}`);
  lines.push(`- To: ${toLabel}`);
  lines.push(`- Sheets: ${diff.beforeSheets.length} → ${diff.afterSheets.length}` +
    (diff.addedSheets.length > 0 ? ` (added: ${diff.addedSheets.join(', ')})` : '') +
    (diff.removedSheets.length > 0 ? ` (removed: ${diff.removedSheets.join(', ')})` : ''));
  lines.push(`- Cell changes: ${diff.totalChanges}${diff.truncated ? ` (showing first ${diff.changes.length})` : ''}`);
  lines.push('');
  if (diff.changes.length === 0) {
    lines.push('No cell changes.');
  } else {
    lines.push('| Sheet | Cell | Kind | Before | After |');
    lines.push('| ----- | ---- | ---- | ------ | ----- |');
    for (const c of diff.changes) {
      lines.push(`| ${c.sheet} | ${c.cell} | ${c.kind} | ${c.before ?? '—'} | ${c.after ?? '—'} |`);
    }
  }
  return lines.join('\n');
}
