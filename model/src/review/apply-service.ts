import { copyFile, lstat, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { ModelLibrary } from '@/library/store';
import { currentWorkbookPath, revisionPath, sha256Hex, utcNow } from '@/library/store';
import { readManifest, manifestPath, verifyManifest, writeManifestAtomic, type ModelManifest } from '@/library/manifest';
import { validateProposalDraft, type ProposalDraft, type ProposedChange } from '@/review/proposal';
import {
  AI_CHANGE_LOG_SHEET,
  applyCellEdits,
  findBackendPython,
  findSoffice,
  formatInspectionMarkdown,
  inspectWorkbook,
  newErrorCells,
  readCellStates,
  recalculateWorkbook,
  writeChangeLogSheet,
  type AppliedEdit,
  type CellEdit,
  type ChangeLogInput,
  type WorkbookInspection,
} from '@/workbook/xlsx';
import type { ProposalRecord } from '@/library/types';

export interface ApplyResult {
  proposalId: string;
  ticker: string;
  priorHash: string;
  newHash: string;
  revisionId: string;
  applied: AppliedEdit[];
  inspectionMarkdown: string;
  approvedBy: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readCurrentBytesHash(root: string, ticker: string): { path: string; hash: string } {
  const path = currentWorkbookPath(root, ticker);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new Error(`The saved workbook for ${ticker} is missing; refusing to apply. Rebuild with \`dcf build ${ticker}\`.`);
  }
  return {path, hash: sha256Hex(bytes)};
}

function toCellEdit(change: ProposedChange): CellEdit {  if (change.proposedFormula !== undefined && change.proposedFormula !== null && change.proposedFormula !== '') {
    return {sheet: change.sheet, cell: change.cell, formula: change.proposedFormula};
  }
  // An explicit null clears the cell to a true blank (the value key must be
  // present so the workbook helper writes None instead of skipping the edit).
  if (change.proposedValue !== undefined) {
    const value = change.proposedValue;
    if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error(`Change ${change.sheet}!${change.cell} has an unsupported proposed value type.`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`Change ${change.sheet}!${change.cell} has a non-finite proposed number.`);
    }
    return {sheet: change.sheet, cell: change.cell, value};
  }
  throw new Error(`Change ${change.sheet}!${change.cell} needs proposedValue or proposedFormula.`);
}

export interface PriorCapture {
  sheet: string;
  cell: string;
  priorValue: string | number | boolean | null;
  priorFormula: string | null;
}

/**
 * Read-only prior capture for proposal CREATION (CLI + MCP). Reads the
 * accepted workbook's current literal/formula for each targeted cell so the
 * proposal stores priorValue/priorFormula before any approval. Never modifies
 * the workbook. Throws when a sheet/cell is missing or engines are absent.
 */
export async function captureChangePriors(
  root: string,
  ticker: string,
  refs: Array<{ sheet: string; cell: string }>,
): Promise<PriorCapture[]> {
  const workbookPath = currentWorkbookPath(root, ticker);
  let exists = false;
  try {
    readFileSync(workbookPath);
    exists = true;
  } catch {
    exists = false;
  }
  if (!exists) throw new Error(`No saved workbook for ${ticker}; build one before proposing changes.`);
  const python = findBackendPython();
  if (!python) {
    throw new Error('No Python with openpyxl is available (backend/.venv); cannot read prior cell values.');
  }
  return readCellStates(python, workbookPath, refs);
}

// ---------------------------------------------------------------------------
// Validated AI candidate (preview + promotion). Both the CLI
// (`dcf model preview` / `dcf model apply --approve`) and the MCP tools
// (`proposal_preview` / `proposal_apply`) share this service. A preview
// applies the saved proposal to a COPY under the ticker's proposal area,
// adds an `AI Change Log` sheet, recalculates with LibreOffice, and stores
// the candidate path/hash plus a validation summary in proposal metadata
// only after every check passes. current.xlsx, manifest.json, and revision
// rows are never touched by a preview.
// ---------------------------------------------------------------------------

export interface CandidateMeta {
  /** Absolute path of the validated candidate workbook. */
  path: string;
  /** SHA-256 of the validated candidate bytes. */
  hash: string;
  /** Accepted-workbook hash the candidate was built from. */
  baseHash: string;
  /** SHA-256 of the canonical proposal changes the candidate was built from. */
  changesHash: string;
  /** Deterministic validation summary recorded in the AI Change Log. */
  validation: string;
  previewedAt: string;
  /** Cell edits as applied to the candidate (priors read from the base copy). */
  applied: AppliedEdit[];
}

export interface PreviewResult {
  proposalId: string;
  ticker: string;
  baseHash: string;
  candidatePath: string;
  candidateHash: string;
  applied: AppliedEdit[];
  validationSummary: string;
  inspectionMarkdown: string;
}

/** Filesystem-safe proposal directory name (proposal ids carry timestamps). */
export function sanitizeProposalId(proposalId: string): string {
  const clean = proposalId.replace(/[^A-Za-z0-9._-]/g, '_');
  const base = clean.length === 0 || /^\.+$/.test(clean) ? 'proposal' : clean;
  // Append a short hash of the raw id: distinct ids must never share a
  // directory (`a/b` and `a_b` sanitize identically), and `..` must not escape.
  return `${base}-${sha256Hex(Buffer.from(proposalId, 'utf8')).slice(0, 8)}`;
}

/** Unpredictable temp suffix so pre-created symlinks cannot redirect writes. */
function tmpSuffix(): string {
  return `${process.pid}-${randomBytes(4).toString('hex')}`;
}

export function proposalDir(root: string, ticker: string, proposalId: string): string {
  return join(root, 'companies', ticker.toUpperCase(), 'proposals', sanitizeProposalId(proposalId));
}

/** Absolute path of the validated candidate workbook for a proposal. */
export function candidatePathFor(root: string, ticker: string, proposalId: string): string {
  return join(proposalDir(root, ticker, proposalId), 'candidate.xlsx');
}

/** Rebuild the review draft from a proposal row (CLI and MCP payload shapes). */
export function parseProposalDraft(proposal: ProposalRecord): ProposalDraft {
  let parsed: {
    summary?: unknown;
    changes?: unknown;
    createdAt?: unknown;
    verification?: unknown;
    accession?: unknown;
  };
  try {
    parsed = JSON.parse(proposal.payload_json) as typeof parsed;
  } catch {
    throw new Error(`Proposal ${proposal.id} has an unreadable payload; refusing to proceed.`);
  }
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.changes)) {
    throw new Error(`Proposal ${proposal.id} has an unreadable payload; refusing to proceed.`);
  }
  return {
    ticker: proposal.ticker,
    baseRevisionHash: proposal.base_revision_hash ?? '',
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    changes: parsed.changes as ProposalDraft['changes'],
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : proposal.created_at,
    verification: typeof parsed.verification === 'string' ? parsed.verification : undefined,
    accession: typeof parsed.accession === 'string' ? parsed.accession : undefined,
  };
}

/** Filing accessions a proposal may cite: accepted manifest + stored snapshots. */
export function knownAccessionsFor(lib: ModelLibrary, ticker: string, manifestAccession: string | null): Set<string> {
  const known = new Set<string>();
  if (manifestAccession) known.add(manifestAccession);
  for (const row of lib.listSnapshots(ticker)) known.add(row.accession);
  return known;
}

/**
 * Provenance gate shared by preview and apply: every change accession — and
 * the review-only filing accession — must be the accepted manifest accession
 * or a stored snapshot accession for this ticker.
 */
export function validateDraftSources(draft: ProposalDraft, known: Set<string>): void {
  draft.changes.forEach((change, index) => {
    if (!change.accession || !known.has(change.accession.trim())) {
      throw new Error(
        `Change ${change.sheet}!${change.cell} cites unknown accession ${change.accession || '(missing)'}; ` +
        `run \`dcf filings sync ${draft.ticker}\` first so the snapshot is stored.`,
      );
    }
  });
  if (draft.changes.length === 0 && draft.accession && !known.has(draft.accession.trim())) {
    throw new Error(
      `Review-only proposal cites unknown accession ${draft.accession}; ` +
      `run \`dcf filings sync ${draft.ticker}\` first so the snapshot is stored.`,
    );
  }
}

/** Two edits to the same sheet!cell would apply in an undefined order. */
export function checkDuplicateEdits(changes: ProposedChange[]): void {
  const seen = new Set<string>();
  for (const change of changes) {
    const key = `${String(change.sheet).toUpperCase()}!${String(change.cell).toUpperCase()}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate edit for ${change.sheet}!${change.cell}; merge it into a single change and re-run preview.`);
    }
    seen.add(key);
  }
}

/** Canonical hash of the proposal content a candidate was built from. Covers
 * the cell edits (sheet canonicalized like the duplicate check) AND the
 * review context, so editing the summary/verification/accession after a
 * preview invalidates the candidate just like editing a cell does. */
export function proposalContentHashFor(draft: ProposalDraft): string {
  const canonicalChanges = [...draft.changes]
    .map((c) => ({
      sheet: String(c.sheet).toUpperCase(),
      cell: String(c.cell).toUpperCase(),
      priorValue: c.priorValue ?? null,
      priorFormula: c.priorFormula ?? null,
      proposedValue: c.proposedValue === undefined ? null : c.proposedValue,
      proposedFormula: c.proposedFormula ?? null,
      rationale: String(c.rationale),
      source: String(c.source),
      accession: String(c.accession),
    }))
    .sort((a, b) => (a.sheet === b.sheet ? (a.cell < b.cell ? -1 : 1) : (a.sheet < b.sheet ? -1 : 1)));
  const canonical = {
    changes: canonicalChanges,
    summary: draft.summary ?? '',
    verification: draft.verification ?? '',
    accession: draft.accession ?? '',
  };
  return sha256Hex(Buffer.from(JSON.stringify(canonical), 'utf8'));
}

function displayLiteral(value: number | string | boolean | null | undefined): string {
  if (value === undefined || value === null) return '—';
  return String(value);
}

/**
 * Pass log text through unchanged. Formula-safety lives in the workbook
 * writer (`writeChangeLogSheet` stores "=" text with data_type "s" so it
 * stays inert text with no visible apostrophe); adding a "'" prefix here
 * would leave a visible apostrophe in Excel/LibreOffice.
 */
function logText(value: string | null): string | null {
  return value;
}

function changeLogInput(
  proposalId: string,
  draft: ProposalDraft,
  validationSummary: string,
): ChangeLogInput {
  return {
    proposalId,
    ticker: draft.ticker,
    baseHash: draft.baseRevisionHash,
    summary: logText(draft.summary) ?? '',
    verification: typeof draft.verification === 'string' && draft.verification.trim() !== '' ? logText(draft.verification) : null,
    filingAccession: typeof draft.accession === 'string' && draft.accession.trim() !== ''
      ? draft.accession
      : (draft.changes.length === 1 ? (draft.changes[0]!.accession ?? null) : null),
    validationSummary: logText(validationSummary) ?? '',
    rows: draft.changes.map((change, index) => {
      const prior = change.priorFormula ?? displayLiteral(change.priorValue);
      const proposed = change.proposedFormula
        ?? (change.proposedValue === null ? '(blank)' : displayLiteral(change.proposedValue));
      return {
        index: index + 1,
        sheet: change.sheet,
        cell: String(change.cell).toUpperCase(),
        prior: logText(prior) ?? '—',
        proposed: logText(proposed) ?? '—',
        rationale: logText(change.rationale) ?? '',
        source: logText(change.source) ?? '',
        accession: change.accession,
      };
    }),
  };
}

/**
 * Confirm every targeted cell of a recalculated candidate holds the proposed
 * literal/formula. Tolerant of LibreOffice normalizing boolean literals to
 * =TRUE()/=FALSE() formulas (the cached boolean still decides).
 */
export async function verifyAppliedCells(
  python: string,
  candidatePath: string,
  changes: ProposedChange[],
): Promise<void> {
  if (changes.length === 0) return;
  const states = await readCellStates(python, candidatePath, changes.map((c) => ({sheet: c.sheet, cell: c.cell})));
  const mismatches: string[] = [];
  changes.forEach((change, index) => {
    const state = states[index]!;
    const label = `${change.sheet}!${String(change.cell).toUpperCase()}`;
    if (change.proposedFormula !== undefined && change.proposedFormula !== null && change.proposedFormula !== '') {
      if (state.priorFormula !== change.proposedFormula) {
        mismatches.push(`${label}: expected formula ${change.proposedFormula}, found ${state.priorFormula ?? displayLiteral(state.priorValue)}`);
      }
      return;
    }
    const expected = change.proposedValue ?? null;
    if (expected === null) {
      if (state.priorValue !== null || state.priorFormula !== null) {
        mismatches.push(`${label}: expected a blank cell, found ${state.priorFormula ?? displayLiteral(state.priorValue)}`);
      }
    } else if (typeof expected === 'boolean') {
      if (state.priorValue !== expected) {
        mismatches.push(`${label}: expected cached ${expected}, found ${displayLiteral(state.priorValue)}`);
      }
    } else if (typeof expected === 'number') {
      if (state.priorValue !== expected) {
        mismatches.push(`${label}: expected ${expected}, found ${displayLiteral(state.priorValue)}`);
      }
    } else {
      if (state.priorFormula !== null || state.priorValue !== expected) {
        mismatches.push(`${label}: expected ${JSON.stringify(expected)}, found ${state.priorFormula ?? displayLiteral(state.priorValue)}`);
      }
    }
  });
  if (mismatches.length > 0) {
    throw new Error(`Candidate cell verification failed:\n- ${mismatches.join('\n- ')}`);
  }
}

function candidateValidationSummary(
  baseline: WorkbookInspection,
  after: WorkbookInspection,
  changeCount: number,
): string {
  const added = newErrorCells(baseline, after);
  const parts = [
    'PASS: recalculated with LibreOffice',
    `sheets ${baseline.sheets.length}->${after.sheets.length} (+${AI_CHANGE_LOG_SHEET})`,
    `formulas ${baseline.formulaCount}->${after.formulaCount}`,
    `new cached errors: ${added.length === 0 ? 'none' : added.join(', ')}`,
    changeCount === 0
      ? 'no cell changes (review only)'
      : `targeted cells verified ${changeCount}/${changeCount}`,
  ];
  return parts.join('; ');
}

interface BuiltCandidate {
  applied: AppliedEdit[];
  baseline: WorkbookInspection;
  after: WorkbookInspection;
  validationSummary: string;
}

/**
 * Apply the draft to a workbook copy at destPath, attach the AI Change Log,
 * recalculate with LibreOffice, and validate. Throws on any new cached
 * formula error, lost sheet, empty formula set, or unverified cell. The
 * accepted workbook is only ever read, never written.
 */
export async function buildCandidateFile(
  python: string,
  soffice: string,
  root: string,
  proposalId: string,
  draft: ProposalDraft,
  destPath: string,
): Promise<BuiltCandidate> {
  const workDir = dirname(destPath);
  const tmpBase = join(workDir, `preview-${sanitizeProposalId(proposalId)}-${tmpSuffix()}`);
  const tmpCopy = `${tmpBase}.work.xlsx`;
  const tmpEdited = `${tmpBase}.edited.xlsx`;
  try {
    await mkdir(workDir, {recursive: true});
    await copyFile(currentWorkbookPath(root, draft.ticker), tmpCopy);
    // The accepted workbook may move between the base check and this copy;
    // refuse to build a candidate from anything but the recorded base.
    if (sha256Hex(await readFile(tmpCopy)) !== draft.baseRevisionHash) {
      throw new Error('The accepted workbook changed while the preview was starting; re-run preview against the new base.');
    }
    const baseline = await inspectWorkbook(python, tmpCopy);
    if (baseline.sheets.length === 0) throw new Error('The workbook copy has no sheets; refusing to preview.');
    if (baseline.formulaCount === 0) throw new Error('The workbook copy has no formulas; refusing to preview.');
    // Stored priors were captured at creation; re-check them against the base
    // copy so tampered or stale priors cannot mislead the review.
    if (draft.changes.length > 0) {
      const live = await readCellStates(python, tmpCopy, draft.changes.map((c) => ({sheet: c.sheet, cell: c.cell})));
      const stalePriors = draft.changes
        .map((change, index) => {
          const state = live[index]!;
          const want = JSON.stringify([change.priorValue ?? null, change.priorFormula ?? null]);
          const got = JSON.stringify([state.priorValue, state.priorFormula]);
          return want === got ? null : `${change.sheet}!${String(change.cell).toUpperCase()}`;
        })
        .filter((label): label is string => label !== null);
      if (stalePriors.length > 0) {
        throw new Error(
          `Proposal priors no longer match the accepted workbook at ${stalePriors.join(', ')}; ` +
          `re-run \`dcf model review ${draft.ticker}\` and create a fresh proposal.`,
        );
      }
    }
    const edits = draft.changes.map(toCellEdit);
    let applied: AppliedEdit[] = [];
    if (edits.length > 0) {
      applied = await applyCellEdits(python, tmpCopy, tmpEdited, edits);
    } else {
      await copyFile(tmpCopy, tmpEdited);
    }
    await writeChangeLogSheet(python, tmpEdited, changeLogInput(proposalId, draft, 'pending recalculation — candidate not yet validated'));
    await recalculateWorkbook(soffice, tmpEdited);
    const after = await inspectWorkbook(python, tmpEdited);
    const added = newErrorCells(baseline, after);
    if (added.length > 0) {
      throw new Error(`Recalculation introduced formula errors: ${added.join(', ')}. Candidate rejected; workbook left unchanged.`);
    }
    for (const sheet of baseline.sheets) {
      if (!after.sheets.includes(sheet)) {
        throw new Error(`Recalculated candidate lost sheet ${sheet}. Candidate rejected; workbook left unchanged.`);
      }
    }
    if (!after.sheets.includes(AI_CHANGE_LOG_SHEET)) {
      throw new Error(`Candidate is missing the ${AI_CHANGE_LOG_SHEET} sheet. Candidate rejected; workbook left unchanged.`);
    }
    if (after.formulaCount === 0) {
      throw new Error('Recalculated candidate lost all formulas. Candidate rejected; workbook left unchanged.');
    }
    await verifyAppliedCells(python, tmpEdited, draft.changes);
    const validationSummary = candidateValidationSummary(baseline, after, draft.changes.length);
    // Record the final PASS summary, then recalculate AGAIN: the final log
    // write must itself be recalculated and re-inspected before the candidate
    // is published, so a regressed writer (live formulas in the log) cannot
    // ship cached errors.
    await writeChangeLogSheet(python, tmpEdited, changeLogInput(proposalId, draft, validationSummary));
    await recalculateWorkbook(soffice, tmpEdited);
    const confirmed = await inspectWorkbook(python, tmpEdited);
    const confirmedAdded = newErrorCells(baseline, confirmed);
    if (confirmedAdded.length > 0) {
      throw new Error(`Recalculation after change-log finalization introduced formula errors: ${confirmedAdded.join(', ')}. Candidate rejected; workbook left unchanged.`);
    }
    for (const sheet of baseline.sheets) {
      if (!after.sheets.includes(sheet) || !confirmed.sheets.includes(sheet)) {
        throw new Error(`Recalculated candidate lost sheet ${sheet}. Candidate rejected; workbook left unchanged.`);
      }
    }
    if (!confirmed.sheets.includes(AI_CHANGE_LOG_SHEET)) {
      throw new Error(`Candidate is missing the ${AI_CHANGE_LOG_SHEET} sheet. Candidate rejected; workbook left unchanged.`);
    }
    if (confirmed.formulaCount === 0) {
      throw new Error('Recalculated candidate lost all formulas. Candidate rejected; workbook left unchanged.');
    }
    if (confirmed.formulaCount !== after.formulaCount) {
      throw new Error('Candidate changed during change-log finalization. Candidate rejected; workbook left unchanged.');
    }
    await verifyAppliedCells(python, tmpEdited, draft.changes);
    await copyFile(tmpEdited, destPath);
    return {applied, baseline, after: confirmed, validationSummary};
  } finally {
    await rm(tmpCopy, {force: true}).catch(() => undefined);
    await rm(tmpEdited, {force: true}).catch(() => undefined);
  }
}

/**
 * Shared candidate preview used by the CLI and the MCP server. Repeatable
 * and safe: rebuilding overwrites only the candidate file and refreshes the
 * candidate metadata; a failed preview changes nothing (accepted workbook,
 * manifest, revisions, and any previous candidate stay byte-for-byte).
 */
export async function previewProposal(root: string, proposalId: string): Promise<PreviewResult> {
  const lib = new ModelLibrary(root);
  try {
    const proposal = lib.getProposal(proposalId);
    if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
    if (proposal.status === 'applied') throw new Error(`Proposal ${proposalId} was already applied; its candidate is the accepted revision.`);
    if (proposal.status === 'rejected') throw new Error(`Proposal ${proposalId} was rejected and cannot be previewed.`);
    if (proposal.status !== 'proposed' && proposal.status !== 'accepted') {
      throw new Error(`Proposal ${proposalId} has status ${proposal.status} and cannot be previewed.`);
    }
    const draft = parseProposalDraft(proposal);
    const manifest = await readManifest(root, draft.ticker);
    const {hash: actualHash} = readCurrentBytesHash(root, draft.ticker);
    const problems = verifyManifest(manifest, actualHash);
    if (problems.length > 0) {
      throw new Error(`MANUAL_EDIT_DETECTED: ${problems.join('; ')}. Review before previewing ${draft.ticker}.`);
    }
    const baseHash = proposal.base_revision_hash ?? manifest?.workbookHash ?? '';
    if (!baseHash) throw new Error(`Proposal ${proposalId} has no base revision and ${draft.ticker} has no accepted hash.`);
    if (actualHash !== baseHash) {
      throw new Error(
        `Proposal is stale: drafted against ${baseHash} but current is ${actualHash}. ` +
        `Re-run \`dcf model review ${draft.ticker}\` and create a fresh proposal.`,
      );
    }
    draft.baseRevisionHash = baseHash;
    const validationErrors = validateProposalDraft(draft);
    if (validationErrors.length > 0) throw new Error(`Proposal invalid:\n- ${validationErrors.join('\n- ')}`);
    validateDraftSources(draft, knownAccessionsFor(lib, draft.ticker, manifest?.accession ?? null));
    checkDuplicateEdits(draft.changes);

    const python = findBackendPython();
    if (!python) throw new Error('No Python with openpyxl is available (backend/.venv); cannot build a candidate.');
    const soffice = findSoffice();
    if (!soffice) throw new Error('LibreOffice (soffice) is not available; cannot recalculate a candidate.');

    const candidatePath = candidatePathFor(root, draft.ticker, proposal.id);
    const stagedCandidate = `${candidatePath}.staged-${tmpSuffix()}.tmp`;
    const previousBackup = `${candidatePath}.prev-${tmpSuffix()}.bak`;
    await rm(stagedCandidate, {force: true}).catch(() => undefined);
    // A backup failure must never delete an existing candidate. Distinguish a
    // truly absent path (ENOENT) from any existing path via lstat: readFile
    // conflates permission/invalid-path errors with absence. Refuse symlinks
    // and non-regular files, propagate every non-ENOENT lstat error, and only
    // remove candidatePath after a later failure when lstat proved absence.
    let candidateExisted = false;
    try {
      const st = await lstat(candidatePath);
      if (st.isSymbolicLink()) {
        throw new Error(`Candidate path for proposal ${proposal.id} is a symlink; refusing to preview. Candidate left unchanged.`);
      }
      if (!st.isFile()) {
        throw new Error(`Candidate path for proposal ${proposal.id} is not a regular file; refusing to preview. Candidate left unchanged.`);
      }
      candidateExisted = true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | null)?.code;
      if (code === 'ENOENT') {
        candidateExisted = false;
      } else {
        throw err;
      }
    }
    let hadPreviousCandidate = false;
    try {
      await copyFile(candidatePath, previousBackup);
      hadPreviousCandidate = true;
    } catch {
      hadPreviousCandidate = false;
    }
    try {
      // Build to a staged file first so a failed preview never truncates a
      // previous candidate; publish with a same-directory rename on success.
      const built = await buildCandidateFile(python, soffice, root, proposal.id, draft, stagedCandidate);
      const candidateHash = sha256Hex(await readFile(stagedCandidate));
      if (candidateExisted && !hadPreviousCandidate) {
        throw new Error('Previous candidate backup failed; refusing to overwrite the existing candidate. Candidate left unchanged.');
      }
      await rename(stagedCandidate, candidatePath);

      // Metadata is stored only after every validation passed. Re-read the
      // row so concurrent payload edits (e.g. a rejection reason) survive.
      const meta: CandidateMeta = {
        path: candidatePath,
        hash: candidateHash,
        baseHash,
        changesHash: proposalContentHashFor(draft),
        validation: built.validationSummary,
        previewedAt: utcNow(),
        applied: built.applied,
      };
      const fresh = lib.getProposal(proposal.id);
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse((fresh ?? proposal).payload_json) as Record<string, unknown>;
      } catch {
        payload = {};
      }
      payload.candidate = meta;
      lib.updateProposalPayload(proposal.id, JSON.stringify(payload));
      await rm(previousBackup, {force: true}).catch(() => undefined);
      return {
        proposalId: proposal.id,
        ticker: draft.ticker,
        baseHash,
        candidatePath,
        candidateHash,
        applied: built.applied,
        validationSummary: built.validationSummary,
        inspectionMarkdown: formatInspectionMarkdown(built.baseline, built.after, built.applied),
      };
    } catch (previewError) {
      // A post-rename failure (e.g. the payload write) restores the previous
      // candidate file so file and metadata never disagree. When no candidate
      // existed before, the half-published path is removed. When a candidate
      // existed but its backup failed, the existing file is left alone: a
      // backup error must never delete an existing candidate.
      if (hadPreviousCandidate) {
        await copyFile(previousBackup, candidatePath).catch(() => undefined);
      } else if (!candidateExisted) {
        await rm(candidatePath, {force: true}).catch(() => undefined);
      }
      throw previewError;
    } finally {
      await rm(stagedCandidate, {force: true}).catch(() => undefined);
      await rm(previousBackup, {force: true}).catch(() => undefined);
    }
  } finally {
    lib.close();
  }
}

/** Apply-path draft parsing with the apply-specific refusal wording. */
function parseProposalDraftForApply(proposal: ProposalRecord): ProposalDraft {
  try {
    return parseProposalDraft(proposal);
  } catch {
    throw new Error(`Proposal ${proposal.id} has an unreadable payload; refusing to apply.`);
  }
}

/** Candidate metadata stored by a successful preview (null when never previewed). */
export function readCandidateMeta(proposal: ProposalRecord): CandidateMeta | null {
  let payload: { candidate?: unknown };
  try {
    payload = JSON.parse(proposal.payload_json) as { candidate?: unknown };
  } catch {
    return null;
  }
  const c = payload?.candidate as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object') return null;
  if (
    typeof c['path'] !== 'string'
    || typeof c['hash'] !== 'string'
    || typeof c['baseHash'] !== 'string'
    || typeof c['changesHash'] !== 'string'
    || typeof c['validation'] !== 'string'
    || !Array.isArray(c['applied'])
  ) {
    return null;
  }
  return c as unknown as CandidateMeta;
}

interface RevalidatedCandidate {
  applied: AppliedEdit[];
  baseline: WorkbookInspection;
  after: WorkbookInspection;
}

/**
 * Rebuild the audit edit list from the draft (stored payload priors, not the
 * preview report) so tampered candidate metadata cannot lie in the audit log.
 */
function appliedFromDraft(draft: ProposalDraft): AppliedEdit[] {
  return draft.changes.map((change) => {
    const priorValue = (change.priorValue ?? null) as string | number | boolean | null;
    const priorFormula = change.priorFormula ?? null;
    const base = {
      sheet: change.sheet,
      cell: String(change.cell).toUpperCase(),
      priorValue,
      priorFormula,
    };
    if (change.proposedFormula !== undefined && change.proposedFormula !== null && change.proposedFormula !== '') {
      return {...base, formula: change.proposedFormula};
    }
    return {...base, value: (change.proposedValue ?? null) as string | number | boolean | null};
  });
}

/**
 * Re-validate a previewed candidate immediately before promotion: the
 * accepted workbook must still be the preview base, the draft must be
 * unchanged since preview, the candidate bytes must match the stored hash,
 * and the candidate contents (errors, sheets, change log, targeted cells)
 * are checked again. Any mismatch refuses promotion with current.xlsx,
 * manifest, and revision rows untouched.
 */
export async function revalidateStoredCandidate(
  python: string,
  root: string,
  proposalId: string,
  draft: ProposalDraft,
  stored: CandidateMeta,
  actualHash: string,
): Promise<RevalidatedCandidate> {
  if (stored.baseHash !== actualHash) {
    throw new Error(
      `Candidate is stale: previewed against ${stored.baseHash} but current is ${actualHash}. ` +
      `Re-run \`dcf model preview ${proposalId}\` before approval. Current workbook left unchanged.`,
    );
  }
  if (stored.changesHash !== proposalContentHashFor(draft)) {
    throw new Error(
      `Proposal ${proposalId} changed since its preview; ` +
      `re-run \`dcf model preview ${proposalId}\` before approval. Current workbook left unchanged.`,
    );
  }
  const expectedPath = candidatePathFor(root, draft.ticker, proposalId);
  if (stored.path !== expectedPath) {
    throw new Error(
      `Candidate path mismatch for proposal ${proposalId}; ` +
      `re-run \`dcf model preview ${proposalId}\` before approval. Current workbook left unchanged.`,
    );
  }
  let candidateBytes: Buffer;
  try {
    candidateBytes = await readFile(expectedPath);
  } catch {
    throw new Error(
      `Candidate workbook for proposal ${proposalId} is missing; ` +
      `re-run \`dcf model preview ${proposalId}\` before approval. Current workbook left unchanged.`,
    );
  }
  if (sha256Hex(candidateBytes) !== stored.hash) {
    throw new Error(
      `Candidate workbook for proposal ${proposalId} changed since preview (hash mismatch); ` +
      `re-run \`dcf model preview ${proposalId}\` before approval. Current workbook left unchanged.`,
    );
  }
  const baseline = await inspectWorkbook(python, currentWorkbookPath(root, draft.ticker));
  const after = await inspectWorkbook(python, expectedPath);
  const added = newErrorCells(baseline, after);
  if (added.length > 0) {
    throw new Error(`Candidate re-validation failed: formula errors ${added.join(', ')}. Current workbook left unchanged.`);
  }
  for (const sheet of baseline.sheets) {
    if (!after.sheets.includes(sheet)) {
      throw new Error(`Candidate re-validation failed: lost sheet ${sheet}. Current workbook left unchanged.`);
    }
  }
  if (!after.sheets.includes(AI_CHANGE_LOG_SHEET)) {
    throw new Error(`Candidate re-validation failed: missing ${AI_CHANGE_LOG_SHEET} sheet. Current workbook left unchanged.`);
  }
  if (after.formulaCount === 0) {
    throw new Error('Candidate re-validation failed: no formulas. Current workbook left unchanged.');
  }
  await verifyAppliedCells(python, expectedPath, draft.changes);
  return {applied: appliedFromDraft(draft), baseline, after};
}

/**
 * Shared approved-proposal application used by the CLI and the MCP server.
 * Promotes the preview-validated candidate workbook through a staged sequence
 * with rollback: new bytes are staged
 * next to current.xlsx, rollback copies/state are retained, and any failure
 * during publication restores current.xlsx, manifest.json (removed again if
 * none existed), and the SQLite company/watch/revision/proposal rows. A
 * preview is required: apply without a stored candidate refuses promotion
 * instead of building inline. No
 * multi-file sequence is claimed atomic; the only atomic step is each
 * same-directory temp+rename, failures compensate in reverse order, and a
 * hard process crash between the rename and the final status update fails
 * closed (hash/index mismatch refuses further applies until reviewed).
 */
export async function applyApprovedProposal(root: string, proposalId: string, approvedBy: string): Promise<ApplyResult> {
  const lib = new ModelLibrary(root);
  const workDir = join(root, 'companies', '__apply_tmp__');
  const tmpBase = join(workDir, sanitizeProposalId(proposalId) + `-${tmpSuffix()}`);
  let stagedPath: string | null = null;
  let rollbackPath: string | null = null;
  let published = false;
  try {
    const proposal = lib.getProposal(proposalId);
    if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
    if (proposal.status === 'applied') throw new Error(`Proposal ${proposalId} was already applied.`);
    if (proposal.status === 'rejected') throw new Error(`Proposal ${proposalId} was rejected and cannot be applied.`);
    if (proposal.status !== 'proposed' && proposal.status !== 'accepted') {
      throw new Error(`Proposal ${proposalId} has status ${proposal.status} and cannot be applied.`);
    }

    const draft = parseProposalDraftForApply(proposal);

    const manifest = await readManifest(root, draft.ticker);
    const {hash: actualHash} = readCurrentBytesHash(root, draft.ticker);
    const problems = verifyManifest(manifest, actualHash);
    if (problems.length > 0) {
      throw new Error(`MANUAL_EDIT_DETECTED: ${problems.join('; ')}. Review before replacing ${draft.ticker}.`);
    }
    const baseHash = proposal.base_revision_hash ?? manifest?.workbookHash ?? '';
    if (!baseHash) throw new Error(`Proposal ${proposalId} has no base revision and ${draft.ticker} has no accepted hash.`);
    if (actualHash !== baseHash) {
      throw new Error(
        `Proposal is stale: drafted against ${baseHash} but current is ${actualHash}. ` +
        `Re-run \`dcf model review ${draft.ticker}\` and create a fresh proposal.`,
      );
    }
    draft.baseRevisionHash = baseHash;
    const validationErrors = validateProposalDraft(draft);
    if (validationErrors.length > 0) throw new Error(`Proposal invalid:\n- ${validationErrors.join('\n- ')}`);
    validateDraftSources(draft, knownAccessionsFor(lib, draft.ticker, manifest?.accession ?? null));
    checkDuplicateEdits(draft.changes);

    const python = findBackendPython();
    if (!python) throw new Error('No Python with openpyxl is available (backend/.venv); cannot apply cell edits.');
    void findSoffice;

    // Promotion requires a previewed candidate. Re-validate the stored
    // candidate (current hash, candidate bytes, cell contents) before
    // promotion; without a preview refuse instead of building inline.
    await mkdir(workDir, {recursive: true});
    const storedCandidate = readCandidateMeta(proposal);
    if (!storedCandidate) {
      throw new Error(
        `Proposal ${proposal.id} has no previewed candidate; ` +
        `run \`dcf model preview ${proposal.id}\` before approval. Current workbook left unchanged.`,
      );
    }
    let candidateFile: string;
    let applied: AppliedEdit[];
    let baseline: WorkbookInspection;
    let after: WorkbookInspection;
    ({applied, baseline, after} = await revalidateStoredCandidate(python, root, proposal.id, draft, storedCandidate, actualHash));
    candidateFile = candidatePathFor(root, draft.ticker, proposal.id);

    const finalHash = sha256Hex(await readFile(candidateFile));
    if (finalHash !== storedCandidate.hash) {
      throw new Error(
        `Candidate workbook changed since preview (hash mismatch); ` +
        `re-run \`dcf model preview ${proposal.id}\` before approval. Current workbook left unchanged.`,
      );
    }

    // --- Staged publication with rollback (finding: no atomic multi-file writes) ---
    const companyWorkbook = currentWorkbookPath(root, draft.ticker);
    // Re-hash immediately before staging: the accepted workbook must still be
    // the validated base, and the staged bytes (not the source file) decide.
    if (sha256Hex(await readFile(companyWorkbook)) !== actualHash) {
      throw new Error(
        `The accepted workbook changed before promotion; ` +
        `re-run \`dcf model preview ${proposal.id}\` before approval. Current workbook left unchanged.`,
      );
    }
    stagedPath = `${companyWorkbook}.staged-${tmpSuffix()}.tmp`;
    await copyFile(candidateFile, stagedPath);
    if (sha256Hex(await readFile(stagedPath)) !== finalHash) {
      throw new Error('Staged promotion bytes do not match the validated candidate; refusing to promote.');
    }
    // Retain rollback state BEFORE replacing anything.
    rollbackPath = `${tmpBase}.rollback.xlsx`;
    await copyFile(companyWorkbook, rollbackPath);
    let priorManifestRaw: string | null = null;
    try {
      priorManifestRaw = await readFile(manifestPath(root, draft.ticker), 'utf8');
    } catch {
      priorManifestRaw = null;
    }
    const priorCompany = lib.getCompany(draft.ticker);
    const priorWatch = lib.getWatch(draft.ticker);
    const priorProposalStatus = proposal.status;
    let revisionId: string | null = null;
    let manifestWritten = false;
    const rollbackPublication = async (): Promise<void> => {
      // Restore the pre-promotion workbook only when current.xlsx still holds
      // bytes from this promotion (untouched base or our staged rename).
      // Anything else means a concurrent write landed mid-flight: leave those
      // bytes alone (the hash gate fails closed on next use) and only unwind
      // index rows and the orphan archive below.
      if (!rollbackPath) return;
      const rollbackFile: string = rollbackPath;
      try {
        const currentHash = sha256Hex(await readFile(companyWorkbook));
        if (currentHash === actualHash || currentHash === finalHash) {
          await copyFile(rollbackFile, companyWorkbook).catch(() => undefined);
        }
      } catch {
        await copyFile(rollbackFile, companyWorkbook).catch(() => undefined);
      }
      if (manifestWritten) {
        if (priorManifestRaw !== null) {
          try {
            await writeManifestAtomic(root, JSON.parse(priorManifestRaw) as ModelManifest);
          } catch {
            // Best-effort: manifest mismatch will fail closed on next use.
          }
        } else {
          // No manifest existed before: remove the newly created one.
          const {unlink} = await import('node:fs/promises');
          await unlink(manifestPath(root, draft.ticker)).catch(() => undefined);
        }
      }
      if (priorCompany) {
        try {
          lib.upsertCompany(priorCompany);
        } catch {
          // Best-effort; hash mismatch will fail closed on next use.
        }
      }
      if (priorWatch) {
        try {
          lib.setWatch(draft.ticker, {
            enabled: priorWatch.enabled === 1,
            last_check: priorWatch.last_check,
            latest_accession: priorWatch.latest_accession,
            update_ready: priorWatch.update_ready === 1,
            last_error: priorWatch.last_error,
          });
        } catch {
          // Best-effort.
        }
      }
      if (revisionId) {
        try {
          lib.deleteRevision(revisionId);
        } catch {
          // Best-effort; orphan rows reference an existing archive copy.
        }
        // Remove the orphan archive file staged for the rolled-back revision.
        await rm(revisionPath(root, draft.ticker, revisionId), {force: true}).catch(() => undefined);
      }
      try {
        const current = lib.getProposal(proposal.id);
        if (current && current.status !== priorProposalStatus) {
          lib.setProposalStatus(proposal.id, priorProposalStatus);
        }
      } catch {
        // Best-effort.
      }
    };

    const changeAccessions = [...new Set(draft.changes.map((c) => c.accession).filter(Boolean))];
    const appliedAt = utcNow();
    let audit: Record<string, unknown> = {};
    try {
      audit = JSON.parse(proposal.payload_json) as Record<string, unknown>;
    } catch {
      audit = {};
    }
    try {
      // Preserve the prior revision's filing/route/readiness context on the
      // new apply revision: an AI proposal cites source accessions but does
      // not remap workbook facts to a new period, so fact_period is inherited
      // (never invented) along with the other filing context. The apply event
      // and proposal source are recorded in the note.
      const priorRevisionId = manifest?.revisionId ?? priorCompany?.revision_id ?? null;
      const priorRevision = priorRevisionId ? lib.getRevision(priorRevisionId) : null;
      const proposalSource = changeAccessions.length > 0
        ? changeAccessions.join(', ')
        : (draft.accession ?? 'no accession');
      const revision = lib.addRevision({
        ticker: draft.ticker,
        workbook_hash: finalHash,
        parent_hash: actualHash,
        path: null,
        note: `apply proposal ${proposal.id} approved by ${approvedBy}: ${draft.summary} [${proposalSource}]`,
        build_event: `apply proposal ${proposal.id} approved by ${approvedBy}`,
        fact_accession: priorRevision?.fact_accession ?? manifest?.accession ?? priorCompany?.accession ?? null,
        fact_filed_date: priorRevision?.fact_filed_date ?? manifest?.filedDate ?? priorCompany?.filed_date ?? null,
        fact_period: priorRevision?.fact_period ?? null,
        latest_form: priorRevision?.latest_form ?? null,
        latest_accession: priorRevision?.latest_accession ?? null,
        latest_filed_date: priorRevision?.latest_filed_date ?? null,
        latest_report_date: priorRevision?.latest_report_date ?? null,
        route: priorRevision?.route ?? manifest?.route ?? priorCompany?.route ?? null,
        readiness: priorRevision?.readiness ?? manifest?.readiness ?? priorCompany?.readiness ?? null,
      });
      revisionId = revision.id;
      const archivedPath = revisionPath(root, draft.ticker, revision.id);
      await mkdir(dirname(archivedPath), {recursive: true});
      await copyFile(stagedPath, archivedPath);
      // Last-moment base check: abort (and roll back the revision row/archive)
      // when the accepted workbook moved during publication staging.
      if (sha256Hex(await readFile(companyWorkbook)) !== actualHash) {
        throw new Error('The accepted workbook changed during promotion; refusing to replace it.');
      }
      // File swap (same-directory rename). The true point of no return is the
      // final markProposalApplied below; a crash between the rename and that
      // update fails closed (manifest/index disagree with the workbook) and a
      // process crash cannot run in-memory rollback — document, don't hide.
      await rename(stagedPath, companyWorkbook);

      const nextManifest: ModelManifest = {
        ticker: draft.ticker,
        route: manifest?.route ?? null,
        currency: manifest?.currency ?? null,
        unitScale: manifest?.unitScale ?? null,
        accession: changeAccessions.length === 1 ? changeAccessions[0]! : (manifest?.accession ?? null),
        filedDate: manifest?.filedDate ?? null,
        workbookHash: finalHash,
        builtAt: appliedAt,
        readiness: manifest?.readiness ?? null,
        revisionId: revision.id,
        workbookFile: 'current.xlsx',
        libraryVersion: 1,
      };
      await writeManifestAtomic(root, nextManifest);
      manifestWritten = true;
      lib.upsertCompany({
        ticker: draft.ticker,
        route: nextManifest.route,
        currency: nextManifest.currency,
        unit_scale: nextManifest.unitScale,
        accession: nextManifest.accession,
        filed_date: nextManifest.filedDate,
        workbook_hash: finalHash,
        built_at: nextManifest.builtAt,
        readiness: nextManifest.readiness,
        workbook_path: companyWorkbook,
        revision_id: revision.id,
      });
      const watch = lib.getWatch(draft.ticker);
      if (watch && nextManifest.accession && watch.latest_accession === nextManifest.accession) {
        lib.setWatch(draft.ticker, {update_ready: false, last_check: utcNow(), last_error: null});
      }
      audit.applied = {
        approvedBy,
        appliedAt,
        priorHash: actualHash,
        newHash: finalHash,
        revisionId: revision.id,
        candidatePath: candidateFile,
        candidateHash: finalHash,
        edits: applied,
      };
      lib.markProposalApplied(proposal.id, JSON.stringify(audit));
    } catch (publishError) {
      await rollbackPublication();
      if (stagedPath) await rm(stagedPath, {force: true}).catch(() => undefined);
      // The rollback copy is temp state: remove it on every failed publish so
      // a failed apply leaves no rollback workbook behind.
      if (rollbackPath) await rm(rollbackPath, {force: true}).catch(() => undefined);
      throw new Error(
        `Publication failed and was rolled back; current.xlsx, manifest, and proposal status are unchanged: ${errorMessage(publishError)}`,
      );
    }
    if (rollbackPath) await rm(rollbackPath, {force: true}).catch(() => undefined);
    published = true;
    if (!revisionId) throw new Error('Publication succeeded but the revision id was lost; refusing to report success.');
    return {
      proposalId: proposal.id,
      ticker: draft.ticker,
      priorHash: actualHash,
      newHash: finalHash,
      revisionId,
      applied,
      inspectionMarkdown: formatInspectionMarkdown(baseline, after, applied),
      approvedBy,
    };
  } catch (error) {
    if (!published) {
      if (stagedPath) await rm(stagedPath, {force: true}).catch(() => undefined);
      // Clean the rollback workbook on every failed apply, including
      // validation/revalidation failures before publication staging.
      if (rollbackPath) await rm(rollbackPath, {force: true}).catch(() => undefined);
    }
    throw error instanceof Error ? error : new Error(errorMessage(error));
  } finally {
    if (stagedPath) await rm(stagedPath, {force: true}).catch(() => undefined);
    if (!published && rollbackPath) await rm(rollbackPath, {force: true}).catch(() => undefined);
    try {
      const {readdir, rmdir} = await import('node:fs/promises');
      if ((await readdir(workDir)).length === 0) await rmdir(workDir);
    } catch {
      // Best-effort temp cleanup.
    }
    lib.close();
  }
}

/** Status-only rejection: never touches workbook files. */
export function rejectProposal(root: string, proposalId: string, reason?: string): { id: string; status: string } {
  const lib = new ModelLibrary(root);
  try {
    const proposal = lib.getProposal(proposalId);
    if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
    if (proposal.status === 'applied') throw new Error(`Proposal ${proposalId} was already applied and cannot be rejected.`);
    if (proposal.status === 'rejected') return {id: proposal.id, status: proposal.status};
    if (reason && reason.trim()) {
      try {
        const payload = JSON.parse(proposal.payload_json) as Record<string, unknown>;
        payload.rejection = {reason: reason.trim(), rejectedAt: utcNow()};
        lib.updateProposalPayload(proposal.id, JSON.stringify(payload));
      } catch {
        // Keep rejection status-only when the payload is unreadable.
      }
    }
    const updated = lib.setProposalStatus(proposal.id, 'rejected');
    return {id: updated.id, status: updated.status};
  } finally {
    lib.close();
  }
}
