import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  ModelLibrary,
  companyDir,
  currentWorkbookPath,
  normalizeTicker,
  revisionPath,
  sha256Hex,
  utcNow,
} from '@/library/store';
import { writeManifestAtomic, type ModelManifest } from '@/library/manifest';
import { runStaticWorkbookChecks } from '@/review/review-checks';
import { findBackendPython, findSoffice, inspectWorkbook, recalculateWorkbook, type WorkbookInspection } from '@/workbook/xlsx';

/** Route/readiness/source facts captured when a build/update runs. */
export interface CandidateBuildMeta {
  route: string;
  currency: string | null;
  unitScale: string | null;
  readiness: string;
  accession: string | null;
  filedDate: string | null;
}

export interface CandidateVerification {
  text: string;
  by: string;
  at: string;
}

/** Stored candidate context: what was built, from which sources, against which base. */
export interface CandidatePayload {
  ticker: string;
  route: string;
  currency: string | null;
  unitScale: string | null;
  readiness: string;
  accession: string | null;
  filedDate: string | null;
  /** Mapped fiscal period from the source snapshot, or null when unconfirmed. */
  mappedPeriod: string | null;
  baseRevisionHash: string | null;
  baseRevisionId: string | null;
  note: string;
  verification: CandidateVerification | null;
  decidedAt?: string;
  decidedBy?: string;
  decision?: string;
  decisionReason?: string;
}

/** Minimum substantive review text: a real verification result per the
 *  build-gate spec is a paragraph (freshness, sources, formulas, summary),
 *  so a few-word rubber stamp is rejected with a clear error. */
export const MIN_VERIFICATION_CHARS = 40;
const MAX_VERIFICATION_CHARS = 20000;

export function candidateDir(root: string, ticker: string, candidateId: string): string {
  return join(root, 'companies', normalizeTicker(ticker), 'candidates', candidateId);
}

export function candidateWorkbookPath(root: string, ticker: string, candidateId: string): string {
  return join(candidateDir(root, ticker, candidateId), 'candidate.xlsx');
}

/** Best-effort mapped-period label from a normalized source snapshot.
 *  Returns null when no fiscal period key is present (caller reports it
 *  as unconfirmed rather than inventing one). */
export function describeMappedPeriod(snapshotJson: string | null | undefined): string | null {
  if (!snapshotJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshotJson);
  } catch {
    return null;
  }
  const KEYS = [/fiscal.?year/i, /fiscal.?period/i, /period.?end/i, /source.?fiscal/i];
  const stack: unknown[] = [parsed];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (KEYS.some((re) => re.test(key)) && (typeof value === 'string' || typeof value === 'number')) {
        const label = `${key}=${String(value)}`.slice(0, 120);
        if (label.trim()) return label;
      }
      if (value !== null && typeof value === 'object') stack.push(value);
    }
  }
  return null;
}

async function copyBytes(bytes: Uint8Array, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

/** Engine recalculation gate shared by staging: LibreOffice recalculates a
 *  staged copy and inspection must show sheets, formulas, and zero cached
 *  errors before anything is stored. Throws otherwise. */
export async function recalculateAndValidate(root: string, engineBytes: Uint8Array): Promise<Uint8Array> {
  const python = findBackendPython();
  if (!python) {
    throw new Error('No Python with openpyxl is available (backend/.venv); cannot validate the workbook before staging.');
  }
  const soffice = findSoffice();
  if (!soffice) {
    throw new Error('LibreOffice (soffice) is not available; cannot recalculate the workbook before staging.');
  }
  const stagingDir = await mkdtemp(join(tmpdir(), 'dcf-candidate-'));
  let recalculatedBytes: Uint8Array;
  try {
    const stagedPath = join(stagingDir, 'engine.xlsx');
    await copyBytes(engineBytes, stagedPath);
    await recalculateWorkbook(soffice, stagedPath);
    const inspection = await inspectWorkbook(python, stagedPath);
    if (inspection.sheets.length === 0) throw new Error('Recalculated workbook has no sheets; refusing to stage.');
    if (inspection.formulaCount === 0) throw new Error('Recalculated workbook has no formulas; refusing to stage.');
    if (inspection.cachedErrorCells.length > 0) {
      throw new Error(
        `Recalculated workbook has cached formula errors (${inspection.cachedErrorCells.slice(0, 10).join(', ')}); refusing to stage.`,
      );
    }
    recalculatedBytes = await readFile(stagedPath);
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
  return recalculatedBytes;
}

export interface StagedCandidate {
  candidateId: string;
  hash: string;
  workbookPath: string;
  isInitialBuild: boolean;
}

/** Stage a validated build/update as a pending candidate. Writes ONLY the
 *  candidate directory + candidates row: current.xlsx, manifest.json, the
 *  companies row, and revision history are left untouched until approval. */
export async function stageBuildCandidate(args: {
  lib: ModelLibrary;
  root: string;
  ticker: string;
  engineBytes: Uint8Array;
  meta: CandidateBuildMeta;
  snapshotJsonText?: string;
  note: string;
}): Promise<StagedCandidate> {
  const { lib, root, ticker: rawTicker, engineBytes, meta, note } = args;
  const ticker = normalizeTicker(rawTicker);
  const recalculatedBytes = await recalculateAndValidate(root, engineBytes);
  const hash = sha256Hex(recalculatedBytes);
  const previous = lib.getCompany(ticker);
  const mappedPeriod = describeMappedPeriod(args.snapshotJsonText ?? null);
  const payload: CandidatePayload = {
    ticker,
    route: meta.route,
    currency: meta.currency,
    unitScale: meta.unitScale,
    readiness: meta.readiness,
    accession: meta.accession,
    filedDate: meta.filedDate,
    mappedPeriod,
    baseRevisionHash: previous?.workbook_hash ?? null,
    baseRevisionId: previous?.revision_id ?? null,
    note,
    verification: null,
  };
  const record = lib.createCandidate({
    ticker,
    workbook_hash: hash,
    base_revision_hash: payload.baseRevisionHash,
    payload_json: JSON.stringify(payload),
    status: 'pending',
  });
  await copyBytes(recalculatedBytes, candidateWorkbookPath(root, ticker, record.id));
  return { candidateId: record.id, hash, workbookPath: candidateWorkbookPath(root, ticker, record.id), isInitialBuild: previous == null };
}

export interface CandidateView {
  id: string;
  ticker: string;
  status: string;
  createdAt: string;
  workbookHash: string;
  workbookPath: string;
  workbookExists: boolean;
  payload: CandidatePayload;
  /** Deterministic workbook inspection (sheets, formulas, cached errors);
   *  null when engines are unavailable or inspection fails. This is the
   *  machine auto-review content: numbers, formulas, and formatting faults. */
  inspection: WorkbookInspection | null;
  accepted: {
    exists: boolean;
    hashMatchesBase: boolean;
    onDiskHash: string | null;
    manifestHash: string | null;
  };
}

function parsePayload(record: { payload_json: string; id: string }): CandidatePayload {
  try {
    return JSON.parse(record.payload_json) as CandidatePayload;
  } catch {
    throw new Error(`Candidate ${record.id} has an unreadable payload; refusing to proceed.`);
  }
}

/** Pending candidate plus the accepted state it would promote onto. */
export async function getPendingCandidateView(lib: ModelLibrary, root: string, tickerRaw: string): Promise<CandidateView | null> {
  const ticker = normalizeTicker(tickerRaw);
  const record = lib.getPendingCandidate(ticker);
  if (!record) return null;
  return toView(lib, root, ticker, record.id);
}

export async function getCandidateViewById(lib: ModelLibrary, root: string, candidateId: string): Promise<CandidateView> {
  const record = lib.getCandidate(candidateId);
  if (!record) throw new Error(`Candidate not found: ${candidateId}`);
  return toView(lib, root, record.ticker, record.id);
}

async function inspectCandidateWorkbook(workbookPath: string, workbookExists: boolean): Promise<WorkbookInspection | null> {
  if (!workbookExists) return null;
  const python = findBackendPython();
  if (!python) return null;
  try {
    return await inspectWorkbook(python, workbookPath);
  } catch {
    return null;
  }
}

async function toView(lib: ModelLibrary, root: string, ticker: string, candidateId: string): Promise<CandidateView> {
  const record = lib.getCandidate(candidateId);
  if (!record) throw new Error(`Candidate not found: ${candidateId}`);
  const payload = parsePayload(record);
  const workbookPath = candidateWorkbookPath(root, ticker, candidateId);
  const workbookExists = existsSync(workbookPath);
  const manifest = lib.getCompany(ticker);
  const checks = runStaticWorkbookChecks(currentWorkbookPath(root, ticker));
  const onDiskHash = checks.exists ? checks.sha256 : null;
  const inspection = await inspectCandidateWorkbook(workbookPath, workbookExists);
  return {
    id: record.id,
    ticker,
    status: record.status,
    createdAt: record.created_at,
    workbookHash: record.workbook_hash,
    workbookPath,
    workbookExists,
    payload,
    inspection,
    accepted: {
      exists: manifest != null,
      hashMatchesBase: payload.baseRevisionHash != null
        && manifest?.workbook_hash === payload.baseRevisionHash
        && onDiskHash === payload.baseRevisionHash,
      onDiskHash,
      manifestHash: manifest?.workbook_hash ?? null,
    },
  };
}

export function formatCandidateMarkdown(view: CandidateView): string {
  const p = view.payload;
  const lines: string[] = [];
  lines.push(`# Build candidate — ${view.ticker}`);
  lines.push('');
  lines.push(`- Candidate: \`${view.id}\` (status=${view.status}, created ${view.createdAt})`);
  lines.push(`- Route: ${p.route}  Readiness: ${p.readiness}  Hash: \`${view.workbookHash}\``);
  lines.push(`- Source: accession ${p.accession ?? '(none)'}${p.filedDate ? `, filed ${p.filedDate}` : ''}`);
  lines.push(`- Mapped period: ${p.mappedPeriod ?? 'unconfirmed — see the stored source snapshot'}`);
  lines.push(view.payload.baseRevisionHash
    ? `- Base: accepted revision \`${p.baseRevisionId ?? '(unknown)'}\` (${p.baseRevisionHash}); on-disk accepted copy ${view.accepted.hashMatchesBase ? 'matches' : 'DIFFERS — candidate is stale or the library was edited'}`
    : '- Base: none — initial build, no accepted revision exists yet');
  lines.push(`- Workbook: ${view.workbookExists ? view.workbookPath : 'MISSING — cannot accept'}`);
  if (view.inspection) {
    const insp = view.inspection;
    lines.push(`- Auto-review: ${insp.sheets.length} sheets (${insp.sheets.join(', ') || 'none'}), ${insp.formulaCount} formulas, cached errors: ${insp.cachedErrorCells.length === 0 ? 'none' : insp.cachedErrorCells.slice(0, 10).join(', ')}`);
    if (insp.hasInputRequiredSheet) lines.push(`- Auto-review: Input Required status ${insp.inputRequiredStatus ?? 'blank'}; outputs stay blank while inputs fail`);
    lines.push(`- Auto-review: Data Review rows: ${insp.dataReviewRows}`);
  } else {
    lines.push('- Auto-review: workbook inspection unavailable (engines missing); review the export directly');
  }
  lines.push(p.verification
    ? `- Verification: recorded by ${p.verification.by} at ${p.verification.at} (${p.verification.text.length} chars)`
    : '- Verification: none recorded — AI/agent review is required before approval');
  lines.push('');
  if (view.status !== 'pending') {
    lines.push(`This candidate is ${view.status}; it cannot be verified or accepted.`);
    return lines.join('\n');
  }
  if (!p.verification) {
    lines.push('Next: record the AI review, then approve:');
    lines.push(`  dcf model candidate-verify ${view.id} --verification "<freshness, sources, formulas, summary>" --by <name>`);
    lines.push(`  dcf model accept ${view.id} --approve [--by <name>]`);
  } else {
    lines.push('Next: promote with explicit human approval (rejection leaves the accepted library unchanged):');
    lines.push(`  dcf model accept ${view.id} --approve [--by <name>]`);
  }
  return lines.join('\n');
}

/** Record the AI/agent review result on a pending candidate. */
export async function recordCandidateVerification(
  lib: ModelLibrary,
  root: string,
  candidateId: string,
  text: string,
  by: string,
): Promise<CandidateView> {
  const record = lib.getCandidate(candidateId);
  if (!record) throw new Error(`Candidate not found: ${candidateId}`);
  if (record.status !== 'pending') throw new Error(`Candidate ${candidateId} is ${record.status}; only pending candidates can be verified.`);
  const clean = text.trim();
  if (!clean) throw new Error('Verification text is required: summarize freshness, sources, formulas, and changes.');
  if (clean.length < MIN_VERIFICATION_CHARS) {
    throw new Error(
      `Verification is too short (${clean.length} chars, minimum ${MIN_VERIFICATION_CHARS}): record the freshness verdict, source/period checks, formula findings, and summary.`,
    );
  }
  if (clean.length > MAX_VERIFICATION_CHARS) throw new Error(`Verification exceeds ${MAX_VERIFICATION_CHARS} chars; condense the review.`);
  const reviewer = by.trim();
  if (!reviewer) throw new Error('A reviewer name is required (--by <name>).');
  const payload = parsePayload(record);
  payload.verification = { text: clean, by: reviewer, at: utcNow() };
  lib.updateCandidatePayload(candidateId, JSON.stringify(payload));
  return toView(lib, root, record.ticker, candidateId);
}

export interface AcceptedCandidate {
  candidateId: string;
  ticker: string;
  revisionId: string;
  hash: string;
  workbookPath: string;
  parentHash: string | null;
}

/** Promote a verified pending candidate to the accepted revision.
 *  Requires recorded verification + explicit approval. Any staleness
 *  (accepted state moved since staging) or manual edit fails closed with
 *  the accepted workbook, manifest, and revisions unchanged. */
export async function acceptCandidate(
  lib: ModelLibrary,
  root: string,
  candidateId: string,
  approvedBy: string,
): Promise<AcceptedCandidate> {
  if (!approvedBy.trim()) throw new Error(`Explicit approval required: re-run with an approver name to accept candidate ${candidateId}.`);
  const record = lib.getCandidate(candidateId);
  if (!record) throw new Error(`Candidate not found: ${candidateId}`);
  if (record.status !== 'pending') throw new Error(`Candidate ${candidateId} is ${record.status}; only pending candidates can be accepted.`);
  const payload = parsePayload(record);
  const ticker = record.ticker;
  if (!payload.verification) {
    throw new Error(
      `Candidate ${candidateId} has no recorded AI verification; run \`dcf model candidate-verify ${candidateId} --verification \"...\" --by <name>\` first.`,
    );
  }
  const candidateBytes = await readFile(candidateWorkbookPath(root, ticker, candidateId)).catch(() => null);
  if (!candidateBytes) throw new Error(`Candidate workbook for ${candidateId} is missing; cannot accept.`);
  if (sha256Hex(candidateBytes) !== record.workbook_hash) {
    throw new Error(`Candidate workbook for ${candidateId} no longer matches its staged hash; refusing to accept.`);
  }
  const manifest = lib.getCompany(ticker);
  const onDiskHash = readOnDiskHash(root, ticker);
  if (payload.baseRevisionHash == null) {
    // Initial build: nothing accepted may have appeared since staging.
    if (manifest?.workbook_hash || onDiskHash) {
      throw new Error(
        `Candidate ${candidateId} is stale: a revision for ${ticker} appeared after staging. Review it with \`dcf model inspect ${ticker}\`.`,
      );
    }
  } else {
    if (!manifest?.workbook_hash || manifest.workbook_hash !== payload.baseRevisionHash) {
      throw new Error(
        `Candidate ${candidateId} is stale: it was staged against ${payload.baseRevisionHash} but the accepted revision is now ${manifest?.workbook_hash ?? 'missing'}. Restage with \`dcf build ${ticker}\`.`,
      );
    }
    if (onDiskHash !== payload.baseRevisionHash) {
      throw new Error(
        `MANUAL_EDIT_DETECTED: the saved workbook for ${ticker} no longer matches the accepted revision. Review the manual edits before accepting a candidate.`,
      );
    }
  }
  // Publish: immutable revision copy + validated current copy (same
  // same-directory temp+rename discipline as proposal application).
  const workbookPath = currentWorkbookPath(root, ticker);
  await mkdir(companyDir(root, ticker), { recursive: true });
  if (existsSync(workbookPath) && manifest?.revision_id) {
    const archived = revisionPath(root, ticker, manifest.revision_id);
    if (!existsSync(archived)) {
      await mkdir(dirname(archived), { recursive: true });
      await copyFile(workbookPath, archived);
    }
  }
  const revision = lib.addRevision({
    ticker,
    workbook_hash: record.workbook_hash,
    parent_hash: payload.baseRevisionHash,
    path: null,
    note: `candidate ${candidateId} accepted`,
  });
  const archivedPath = revisionPath(root, ticker, revision.id);
  await mkdir(dirname(archivedPath), { recursive: true });
  await copyBytes(candidateBytes, archivedPath);
  const stagedPath = `${workbookPath}.staged-${process.pid}.tmp`;
  try {
    await copyBytes(candidateBytes, stagedPath);
    const checks = runStaticWorkbookChecks(stagedPath);
    if (!checks.exists || !checks.isZip || checks.sha256 !== record.workbook_hash) {
      throw new Error('Workbook validation failed after writing the library copy.');
    }
    await rename(stagedPath, workbookPath);
  } finally {
    await rm(stagedPath, { force: true }).catch(() => undefined);
  }
  const builtAt = utcNow();
  lib.upsertCompany({
    ticker,
    route: payload.route,
    currency: payload.currency,
    unit_scale: payload.unitScale,
    accession: payload.accession,
    filed_date: payload.filedDate,
    workbook_hash: record.workbook_hash,
    built_at: builtAt,
    readiness: payload.readiness,
    workbook_path: workbookPath,
    revision_id: revision.id,
  });
  const candidateManifest: ModelManifest = {
    ticker,
    route: payload.route,
    currency: payload.currency,
    unitScale: payload.unitScale,
    accession: payload.accession,
    filedDate: payload.filedDate,
    workbookHash: record.workbook_hash,
    builtAt,
    readiness: payload.readiness,
    revisionId: revision.id,
    workbookFile: 'current.xlsx',
    libraryVersion: 1,
  };
  await writeManifestAtomic(root, candidateManifest);
  const decided: CandidatePayload = {
    ...payload,
    verification: payload.verification,
    decidedAt: builtAt,
    decidedBy: approvedBy,
    decision: 'accepted',
  };
  lib.updateCandidatePayload(candidateId, JSON.stringify(decided));
  lib.setCandidateStatus(candidateId, 'accepted');
  return {
    candidateId,
    ticker,
    revisionId: revision.id,
    hash: record.workbook_hash,
    workbookPath,
    parentHash: payload.baseRevisionHash,
  };
}

/** Reject a pending candidate. The accepted library is never touched. */
export function rejectCandidate(lib: ModelLibrary, root: string, candidateId: string, reason?: string): CandidatePayload {
  const record = lib.getCandidate(candidateId);
  if (!record) throw new Error(`Candidate not found: ${candidateId}`);
  if (record.status !== 'pending') throw new Error(`Candidate ${candidateId} is ${record.status}; only pending candidates can be rejected.`);
  const payload = parsePayload(record);
  payload.decidedAt = utcNow();
  payload.decision = 'rejected';
  if (reason?.trim()) payload.decisionReason = reason.trim();
  lib.updateCandidatePayload(candidateId, JSON.stringify(payload));
  lib.setCandidateStatus(candidateId, 'rejected');
  void rm(candidateDir(root, record.ticker, candidateId), { recursive: true, force: true }).catch(() => undefined);
  return payload;
}

function readOnDiskHash(root: string, ticker: string): string | null {
  const checks = runStaticWorkbookChecks(currentWorkbookPath(root, ticker));
  return checks.exists ? checks.sha256 : null;
}
