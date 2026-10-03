import { copyFile, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ModelLibrary } from '@/library/store';
import { currentWorkbookPath, revisionPath, sha256Hex, utcNow } from '@/library/store';
import { readManifest, manifestPath, verifyManifest, writeManifestAtomic, type ModelManifest } from '@/library/manifest';
import { validateProposalDraft, type ProposalDraft, type ProposedChange } from '@/review/proposal';
import {
  applyCellEdits,
  findBackendPython,
  findSoffice,
  formatInspectionMarkdown,
  inspectWorkbook,
  newErrorCells,
  readCellStates,
  recalculateWorkbook,
  type AppliedEdit,
  type CellEdit,
} from '@/workbook/xlsx';

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

/** Convert a validated change to a workbook edit. Exported for tests; callers
 *  must validate drafts first (validateProposalDraft / MCP validateChanges).
 *  Rejects "="-prefixed values even here so a formula can never slip through
 *  the value path and bypass the formula gate. */
export function toCellEdit(change: ProposedChange): CellEdit {  if (change.proposedFormula !== undefined && change.proposedFormula !== null && change.proposedFormula !== '') {
    return {sheet: change.sheet, cell: change.cell, formula: change.proposedFormula};
  }
  // An explicit null clears the cell to a true blank (the value key must be
  // present so the workbook helper writes None instead of skipping the edit).
  if (change.proposedValue !== undefined) {
    const value = change.proposedValue;
    if (typeof value === 'string' && value.startsWith('=')) {
      throw new Error(`Change ${change.sheet}!${change.cell} proposedValue starts with "="; use proposedFormula for formula edits.`);
    }
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

/**
 * Shared approved-proposal application used by the CLI and the MCP server.
 * Applies every validated cell edit to a COPY, recalculates, validates, then
 * publishes through a staged sequence with rollback: new bytes are staged
 * next to current.xlsx, rollback copies/state are retained, and any failure
 * during publication restores current.xlsx, manifest.json (removed again if
 * none existed), and the SQLite company/watch/revision/proposal rows. No
 * multi-file sequence is claimed atomic; the only atomic step is each
 * same-directory temp+rename, failures compensate in reverse order, and a
 * hard process crash between the rename and the final status update fails
 * closed (hash/index mismatch refuses further applies until reviewed).
 */
export async function applyApprovedProposal(root: string, proposalId: string, approvedBy: string): Promise<ApplyResult> {
  const lib = new ModelLibrary(root);
  const workDir = join(root, 'companies', '__apply_tmp__');
  const tmpBase = join(workDir, `${proposalId.replace(/[^A-Za-z0-9._-]/g, '_')}-${process.pid}`);
  const tmpCopy = `${tmpBase}.work.xlsx`;
  const tmpEdited = `${tmpBase}.edited.xlsx`;
  let stagedPath: string | null = null;
  let published = false;
  try {
    const proposal = lib.getProposal(proposalId);
    if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
    if (proposal.status === 'applied') throw new Error(`Proposal ${proposalId} was already applied.`);
    if (proposal.status === 'rejected') throw new Error(`Proposal ${proposalId} was rejected and cannot be applied.`);
    if (proposal.status !== 'proposed' && proposal.status !== 'accepted') {
      throw new Error(`Proposal ${proposalId} has status ${proposal.status} and cannot be applied.`);
    }

    let draft: ProposalDraft;
    try {
      const parsed = JSON.parse(proposal.payload_json) as {
        summary?: string;
        changes?: ProposalDraft['changes'];
        createdAt?: string;
      };
      draft = {
        ticker: proposal.ticker,
        baseRevisionHash: proposal.base_revision_hash ?? '',
        summary: parsed.summary ?? '',
        changes: parsed.changes ?? [],
        createdAt: parsed.createdAt ?? proposal.created_at,
      };
    } catch {
      throw new Error(`Proposal ${proposalId} has an unreadable payload; refusing to apply.`);
    }

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

    const python = findBackendPython();
    if (!python) throw new Error('No Python with openpyxl is available (backend/.venv); cannot apply cell edits.');
    const soffice = findSoffice();
    if (!soffice) throw new Error('LibreOffice (soffice) is not available; cannot recalculate the workbook.');

    const edits = draft.changes.map(toCellEdit);
    await mkdir(workDir, {recursive: true});
    await copyFile(currentWorkbookPath(root, draft.ticker), tmpCopy);
    const baseline = await inspectWorkbook(python, tmpCopy);
    if (baseline.sheets.length === 0) throw new Error('The workbook copy has no sheets; refusing to apply.');
    if (baseline.formulaCount === 0) throw new Error('The workbook copy has no formulas; refusing to apply.');
    const applied = await applyCellEdits(python, tmpCopy, tmpEdited, edits);
    await recalculateWorkbook(soffice, tmpEdited);
    const after = await inspectWorkbook(python, tmpEdited);
    const added = newErrorCells(baseline, after);
    if (added.length > 0) {
      throw new Error(`Recalculation introduced formula errors: ${added.join(', ')}. Workbook left unchanged.`);
    }
    if (after.sheets.length !== baseline.sheets.length || after.formulaCount === 0) {
      throw new Error('Recalculated workbook lost sheets or formulas. Workbook left unchanged.');
    }

    const finalHash = sha256Hex(await readFile(tmpEdited));

    // --- Staged publication with rollback (finding: no atomic multi-file writes) ---
    const companyWorkbook = currentWorkbookPath(root, draft.ticker);
    stagedPath = `${companyWorkbook}.staged-${process.pid}.tmp`;
    await copyFile(tmpEdited, stagedPath);
    // Retain rollback state BEFORE replacing anything.
    const rollbackPath = `${tmpBase}.rollback.xlsx`;
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
      await copyFile(rollbackPath, companyWorkbook).catch(() => undefined);
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
      const revision = lib.addRevision({
        ticker: draft.ticker,
        workbook_hash: finalHash,
        parent_hash: actualHash,
        path: null,
        note: `apply proposal ${proposal.id} approved by ${approvedBy}`,
      });
      revisionId = revision.id;
      const archivedPath = revisionPath(root, draft.ticker, revision.id);
      await mkdir(dirname(archivedPath), {recursive: true});
      await copyFile(stagedPath, archivedPath);
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
        edits: applied,
      };
      lib.markProposalApplied(proposal.id, JSON.stringify(audit));
    } catch (publishError) {
      await rollbackPublication();
      if (stagedPath) await rm(stagedPath, {force: true}).catch(() => undefined);
      throw new Error(
        `Publication failed and was rolled back; current.xlsx, manifest, and proposal status are unchanged: ${errorMessage(publishError)}`,
      );
    }
    await rm(rollbackPath, {force: true}).catch(() => undefined);
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
      await rm(tmpCopy, {force: true}).catch(() => undefined);
      await rm(tmpEdited, {force: true}).catch(() => undefined);
      if (stagedPath) await rm(stagedPath, {force: true}).catch(() => undefined);
    }
    throw error instanceof Error ? error : new Error(errorMessage(error));
  } finally {
    await rm(tmpCopy, {force: true}).catch(() => undefined);
    await rm(tmpEdited, {force: true}).catch(() => undefined);
    if (stagedPath) await rm(stagedPath, {force: true}).catch(() => undefined);
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
