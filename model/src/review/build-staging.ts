import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackendApiClient, type BackendPort, type FilingsListResult } from '@/api/backend-client';
import type { NativeUnifiedPayload } from '@/core/types';
import type { DcfWorkbookPayload } from '@/services/exporters/excel/types';
import { LocalBackendProcess } from '@/infrastructure/local-backend-process';
import { assertOutputDoesNotExist, writeWorkbook } from '@/infrastructure/output-writer';
import { formatValuationJobSuccess, runValuationJob } from '@/application/run-valuation-job';
import { getReviewHook } from '@/library/config';
import { buildSourceSnapshot } from '@/watch/source-snapshot';
import { extractFilingInfo } from '@/watch/filing-source';
import { resolveMonitorFiling } from '@/watch/source-sync';
import {
  ModelLibrary,
  currentWorkbookPath,
  normalizeTicker,
  revisionPath,
  utcNow,
} from '@/library/store';
import { runStaticWorkbookChecks } from '@/review/review-checks';
import {
  recordAutoReview,
  runReviewHook,
  stageBuildCandidate,
  writeBytesToPath,
} from '@/review/build-candidate';

const SERVICE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SERVICE_DIR, '..', '..', '..');
const SERVICE_BACKEND_DIR = resolve(REPO_ROOT, 'backend');

export function manifestMeta(unified: NativeUnifiedPayload): {
  route: string;
  currency: string | null;
  unitScale: string | null;
  readiness: string;
  accession: string | null;
  filedDate: string | null;
} {
  const filing = extractFilingInfo(unified);
  return {
    route: unified.model_eligibility.preferred_model,
    currency: unified.canonical_financials.currency,
    unitScale: unified.canonical_financials.scale ?? null,
    readiness: unified.model_eligibility.status,
    accession: filing?.accession ?? null,
    filedDate: filing?.filedDate ?? null,
  };
}

export function snapshotJson(ticker: string, meta: ReturnType<typeof manifestMeta>): string {
  return JSON.stringify({
    ticker,
    accession: meta.accession,
    filed_date: meta.filedDate,
    fetched_at: utcNow(),
    route: meta.route,
    readiness: meta.readiness,
    currency: meta.currency,
    unit_scale: meta.unitScale,
  });
}

/** Source metadata for a staged candidate: normalized snapshot + watch only.
 *  The accepted workbook, manifest, companies row, and revision history are
 *  untouched until a human approves the candidate. */
export function saveSourceMetadata(
  lib: ModelLibrary,
  ticker: string,
  meta: ReturnType<typeof manifestMeta>,
  snapshotJsonText?: string,
): void {
  if (!meta.accession) return;
  // Prefer the full normalized snapshot when provided; fall back to metadata.
  const payload = snapshotJsonText ?? snapshotJson(ticker, meta);
  lib.saveSnapshot({ticker, accession: meta.accession, filed_date: meta.filedDate, payload_json: payload});
  lib.setWatch(ticker, {last_check: utcNow(), latest_accession: meta.accession, update_ready: false, last_error: null});
}

export function readCurrentHash(root: string, ticker: string): string | null {
  const checks = runStaticWorkbookChecks(currentWorkbookPath(root, ticker));
  return checks.exists ? checks.sha256 : null;
}

/** Backend lifecycle hooks so CLI callers keep SIGINT/SIGTERM handling. */
export interface BuildBackendHooks {
  onBackendStart?: (handle: { stop(): Promise<void> }) => void;
  onBackendStop?: () => void;
}

export interface BuildStagingResult {
  ticker: string;
  candidateId: string;
  hash: string;
  workbookPath: string;
  exportPath: string;
  route: string;
  readiness: string;
  accession: string | null;
  filedDate: string | null;
  isInitialBuild: boolean;
  valuationSummary: string;
  stdout: string[];
  stderr: string[];
}

/** Full deterministic build flow shared by the CLI and the MCP server:
 *  conflict gate, live fetch, engine validation, candidate staging, source
 *  metadata, advisory review hook, and dated export. Publishes nothing. */
export async function runBuildStaging(args: {
  lib: ModelLibrary;
  root: string;
  ticker: string;
  output: string;
  force: boolean;
  note?: string;
  backendDirectory?: string;
  hooks?: BuildBackendHooks;
}): Promise<BuildStagingResult> {
  const { lib, root, force } = args;
  const ticker = normalizeTicker(args.ticker);
  const output = args.output;
  const note = args.note ?? 'dcf build';
  const stdout: string[] = [];
  const stderr: string[] = [];
  if (resolve(output) === resolve(currentWorkbookPath(root, ticker))) {
    throw new Error('Output must not overwrite the accepted library workbook.');
  }
  assertOutputDoesNotExist(output, force);
  // Conflict gate: refuse to stage over a diverged library copy without --force.
  // --force archives the diverged bytes as their own revision before staging.
  const existing = lib.getCompany(ticker);
  const onDiskHash = readCurrentHash(root, ticker);
  const hasDivergedCopy = onDiskHash !== null
    && (!existing?.workbook_hash || onDiskHash !== existing.workbook_hash);
  if (hasDivergedCopy && !force) {
    throw new Error(
      `MANUAL_EDIT_DETECTED: the saved workbook for ${ticker} differs from the accepted revision ` +
      `(accepted ${existing?.workbook_hash ?? 'missing or unknown'}, file ${onDiskHash}). Re-run with --force to archive the diverged copy as a revision and rebuild, or review it first with \`dcf model review ${ticker}\`.`,
    );
  }
  if (hasDivergedCopy && force) {
    const divergedBytes = await readFile(currentWorkbookPath(root, ticker));
    const archived = lib.addRevision({
      ticker,
      workbook_hash: onDiskHash,
      parent_hash: existing?.workbook_hash ?? null,
      path: null,
      note: 'diverged copy archived before --force rebuild',
    });
    await writeBytesToPath(divergedBytes, revisionPath(root, ticker, archived.id));
    stdout.push(`Archived diverged copy as revision ${archived.id} before rebuilding.`);
  }
  const backend = new LocalBackendProcess({ backendDirectory: args.backendDirectory ?? SERVICE_BACKEND_DIR });
  let result: Awaited<ReturnType<typeof runValuationJob>>;
  let unified: NativeUnifiedPayload;
  let filings: FilingsListResult | null;
  args.hooks?.onBackendStart?.(backend);
  try {
    const baseUrl = await backend.start();
    const client = new BackendApiClient(baseUrl);
    unified = await client.getUnifiedCompany(ticker, 5);
    try {
      filings = await client.getRecentFilings(ticker, 50);
    } catch (error) {
      filings = null;
      stderr.push(`Warning: filings list unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    const cached: BackendPort = {
      getUnifiedCompany: async () => unified,
      exportDcf: (payload: DcfWorkbookPayload) => client.exportDcf(payload),
    };
    result = await runValuationJob(ticker, cached);
  } finally {
    await backend.stop();
    args.hooks?.onBackendStop?.();
  }
  const meta = manifestMeta(unified);
  const built = buildSourceSnapshot(unified);
  const fullSnapshotJson = JSON.stringify({ ...built.snapshot, _ticker: ticker, _fetchedAt: utcNow() });
  // Build gate: stage a pending candidate for AI review + human approval.
  // The accepted library copy, manifest, and revisions stay unchanged.
  const staged = await stageBuildCandidate({
    lib, root, ticker, engineBytes: result.workbookBytes, meta, snapshotJsonText: fullSnapshotJson, note,
  });
  saveSourceMetadata(lib, ticker, meta, fullSnapshotJson);
  const hookCommand = getReviewHook();
  if (hookCommand) {
    stdout.push(`Running review hook for candidate ${staged.candidateId}...`);
    const hookResult = await runReviewHook(hookCommand, {
      DCF_TICKER: ticker,
      DCF_CANDIDATE_ID: staged.candidateId,
      DCF_WORKBOOK: staged.workbookPath,
      DCF_MODELS_DIR: root,
    });
    recordAutoReview(lib, staged.candidateId, hookResult);
    stdout.push(
      `Review hook finished (exit ${hookResult.exitCode ?? 'unknown'}${hookResult.timedOut ? ', timed out' : ''}); ` +
      'output recorded on the candidate as advisory auto-review (not a verification).',
    );
    if (hookResult.timedOut || (hookResult.exitCode !== 0 && hookResult.exitCode !== null)) {
      stderr.push('Warning: the review hook did not succeed; staging is unaffected. Inspect the candidate before verifying.');
    }
  }
  await writeWorkbook(output, await readFile(staged.workbookPath), force);
  const valuationSummary = formatValuationJobSuccess(result, output);
  stdout.push(`Staged build candidate ${staged.candidateId} for ${ticker} (route=${meta.route} readiness=${meta.readiness} hash=${staged.hash}).`);
  if (staged.isInitialBuild) {
    stdout.push('No accepted revision exists yet; nothing was published.');
  } else {
    stdout.push('The accepted library copy is unchanged until approval.');
  }
  stdout.push('Review the export, then record the AI review and approve:');
  stdout.push(`  dcf model candidate ${ticker}`);
  stdout.push(`  dcf model candidate-verify ${staged.candidateId} --verification "<freshness, sources, formulas, summary>" --by <name>`);
  stdout.push(`  dcf model accept ${staged.candidateId} --approve [--by <name>]`);
  if (meta.accession) stdout.push(`Source: accession ${meta.accession}, filed ${meta.filedDate ?? 'unknown'}.`);
  // The candidate carries the fact-source accession represented by the workbook.
  // If the SEC filings list has something newer, queue it on watch only.
  // Identity-validated: cross-CIK rows can never queue update-ready.
  if (filings) {
    try {
      const profileCik = typeof unified.profile?.cik === 'string' ? unified.profile.cik : null;
      const resolved = resolveMonitorFiling(filings, profileCik, ticker);
      const latestFiling = resolved.latest;
      if (latestFiling && meta.accession && latestFiling.accession !== meta.accession) {
        lib.setWatch(ticker, { last_check: utcNow(), latest_accession: latestFiling.accession, update_ready: true, last_error: null });
        stdout.push(`Watch: newer ${latestFiling.form} ${latestFiling.accession} (filed ${latestFiling.filingDate}) queued update-ready; candidate keeps fact source ${meta.accession}.`);
      }
      if (resolved.rejectedRowCount > 0) {
        stdout.push(`Watch: ${resolved.rejectedRowCount} report-form row(s) with invalid accession/date metadata ignored.`);
      }
    } catch (error) {
      stderr.push(`Warning: filing identity check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const warning of result.warnings) stderr.push(`Warning: ${warning}`);
  return {
    ticker,
    candidateId: staged.candidateId,
    hash: staged.hash,
    workbookPath: staged.workbookPath,
    exportPath: output,
    route: meta.route,
    readiness: meta.readiness,
    accession: meta.accession,
    filedDate: meta.filedDate,
    isInitialBuild: staged.isInitialBuild,
    valuationSummary,
    stdout,
    stderr,
  };
}
