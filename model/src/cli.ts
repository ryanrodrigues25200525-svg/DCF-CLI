#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { BackendApiClient } from '@/api/backend-client';
import { LocalBackendProcess } from '@/infrastructure/local-backend-process';
import { assertOutputDoesNotExist, writeWorkbook } from '@/infrastructure/output-writer';
import { formatValuationJobSuccess, runValuationJob } from '@/application/run-valuation-job';
import { getConfigPath, getModelsDir, getReviewHook, resolveModelsDir, setModelsDir, setReviewHook } from '@/library/config';
import {
  ModelLibrary,
  currentWorkbookPath,
  manifestPath,
  normalizeTicker as normalizeLibraryTicker,
  readManifest,
  utcNow,
  verifyManifest,
} from '@/library/index';
import { applyApprovedProposal, captureChangePriors, rejectProposal } from '@/review/apply-service';
import {
  acceptCandidate,
  formatCandidateMarkdown,
  getPendingCandidateView,
  recordCandidateVerification,
  rejectCandidate,
} from '@/review/build-candidate';
import { runBuildStaging } from '@/review/build-staging';
import { getWatchStatus, setWatchEnabled } from '@/watch/watch-service';
import { syncFilingSnapshot } from '@/watch/source-sync';
import { formatProposalMarkdown, validateProposalDraft, type ProposalDraft } from '@/review/proposal';
import { formatReviewReport, runStaticWorkbookChecks } from '@/review/review-checks';
import { compareWorkbooks, formatCompareMarkdown, resolveCompareEndpoint } from '@/review/revision-compare';
import { findBackendPython, inspectWorkbook } from '@/workbook/xlsx';

const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 5;

function checkNodeVersion(): void {
  const match = process.versions.node.match(/^(\d+)\.(\d+)/);
  const major = match ? Number(match[1]) : 0;
  const minor = match ? Number(match[2]) : 0;
  if (major < MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor < MIN_NODE_MINOR)) {
    throw new Error(
      `DCF CLI requires Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} (node:sqlite). Current: ${process.versions.node}.`,
    );
  }
}

interface CliOptions {
  ticker: string;
  output: string;
  force: boolean;
}

interface ParsedCliOptions {
  ticker?: string;
  output?: string;
  force: boolean;
}

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SOURCE_DIR, '../..');
const BACKEND_DIR = resolve(REPO_ROOT, 'backend');
const INVOKER_CWD = process.env.INIT_CWD || process.cwd();
let activeBackend: LocalBackendProcess | null = null;

class CliUsageError extends Error {}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    const exitCode = signal === 'SIGINT' ? 130 : 143;
    const backend = activeBackend;
    if (backend) {
      void backend.stop().finally(() => process.exit(exitCode));
    } else {
      process.exit(exitCode);
    }
  });
}

function usage(): string {
  return [
    'DCF CLI',
    '',
    'Legacy (preserved): dcfbuild [<ticker>] [--output <file.xlsx>] [--force]',
    'Library commands:  dcf build <ticker> [--output <file.xlsx>] [--force] [--models-dir <dir>]',
    '                   dcf models list [--models-dir <dir>] [--json]',
    '                   dcf model inspect <ticker> [--models-dir <dir>] [--json]',
    '                   dcf model compare <ticker> [--from <rev|candidate|accepted>] [--to <rev|candidate|accepted>] [--models-dir <dir>]',
    '                   dcf model open <ticker> [--models-dir <dir>]',
    '                   dcf model review <ticker> [--models-dir <dir>]',
    '                   dcf model update <ticker> [--output <file.xlsx>] [--force] [--models-dir <dir>]',
    '                   dcf model export <ticker> [--output <file.xlsx>] [--force] [--models-dir <dir>]',
    '                   dcf model propose-update <ticker> [--summary <text>] [--change <spec>]... [--accession <acc> --filed <date>] [--models-dir <dir>]',
    '                   dcf model candidate <ticker> [--models-dir <dir>]',
    '                   dcf model candidate-verify <candidate-id> --verification <text> --by <name> [--models-dir <dir>]',
    '                   dcf model accept <candidate-id> --approve [--by <name>] [--models-dir <dir>]',
    '                   dcf model candidate-reject <candidate-id> [--reason <text>] [--models-dir <dir>]',
    '                   dcf model apply <proposal-id> --approve [--by <name>] [--models-dir <dir>]',
    '                   dcf model reject <proposal-id> [--reason <text>] [--models-dir <dir>]',
    '                   dcf filings sync <ticker> [--models-dir <dir>]',
    '                   dcf watch status|check [ticker]|run [--interval <seconds>] [ticker]|pause <ticker>|resume <ticker> [--models-dir <dir>]',
    '                   dcf config models-dir [--set <dir>]',
    '                   dcf config review-hook [--set <shell-command>]',
    '                   dcf mcp (start the local stdio MCP server)',
    '       npm run dcf -- <same commands>',
    '',
    'Options:',
    '  -o, --output <file>  Output workbook (default: ~/Downloads/YYYY-MM-DD_<TICKER>_DCF.xlsx; numbered if repeated)',
    '  --force              Replace the output file if it already exists',
    '  --models-dir <dir>   Override the model-library root for one command',
    '  --approve            Explicit approval for `model apply` (required)',
    '  --json               Machine-readable output for list/inspect',
    '  -h, --help           Show this help',
    '',
    'Change spec for propose-update: sheet|cell|proposed|rationale|source[|accession]',
    '  (numbers, exponents, and true/false are typed; __BLANK__ clears the cell;',
    '   a proposed value starting with "=" is recorded as an explicit formula edit)',
    'Build gate: `dcf build` and `dcf model update` stage a pending candidate;',
    '  record the AI review with `model candidate-verify`, then promote with',
    '  `model accept --approve`. Nothing is published before approval.',
    'If no ticker is provided to the legacy command, the CLI prompts for one.',
    'Set EDGAR_IDENTITY in the environment before running build/sync commands.',
    'Set DCF_MODELS_DIR or run `dcf config models-dir --set <dir>` for the library root.',
    'Set DCF_OPEN_COMMAND to override the desktop opener used by `model open` (used for testing).',
  ].join('\n');
}

function normalizeTicker(input: string): string {
  const ticker = input.trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,10}$/.test(ticker)) {
    throw new CliUsageError(`Invalid ticker format: ${input}`);
  }
  return ticker;
}

async function promptForTicker(): Promise<string> {
  const prompt = createInterface({input: process.stdin, output: process.stdout});
  try {
    return normalizeTicker(await prompt.question('which ticker would you like a dcf for: '));
  } finally {
    prompt.close();
  }
}

function resolveCliOptions(parsed: ParsedCliOptions, ticker: string): CliOptions {
  return {
    ticker,
    output: parsed.output
      ? resolve(INVOKER_CWD, parsed.output)
      : datedDcfOutputPath(ticker),
    force: parsed.force,
  };
}

/** Choose a unique, UTC-dated workbook name for a company export. */
function datedDcfOutputPath(ticker: string): string {
  const normalizedTicker = normalizeTicker(ticker);
  const baseName = `${utcNow().slice(0, 10)}_${normalizedTicker}_DCF`;
  const downloads = join(homedir(), 'Downloads');
  for (let sequence = 1; ; sequence += 1) {
    const suffix = sequence === 1 ? '' : `_${String(sequence).padStart(2, '0')}`;
    const candidate = join(downloads, `${baseName}${suffix}.xlsx`);
    if (!existsSync(candidate)) return candidate;
  }
}

function parseArgs(argv: string[]): ParsedCliOptions | null {
  const positionals: string[] = [];
  let output: string | undefined;
  let force = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return null;
    if (arg === '--force') {
      force = true;
      continue;
    }
    if (arg === '--output' || arg === '-o') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) throw new CliUsageError(`${arg} requires a file path.`);
      output = next;
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) throw new CliUsageError(`Unknown option: ${arg}`);
    positionals.push(arg);
  }

  if (positionals.length > 1) throw new CliUsageError('Enter only one ticker symbol.');
  return {
    ticker: positionals[0] ? normalizeTicker(positionals[0]) : undefined,
    output,
    force,
  };
}

async function generateWorkbook(options: CliOptions): Promise<void> {
  assertOutputDoesNotExist(options.output, options.force);
  const backend = new LocalBackendProcess({backendDirectory: BACKEND_DIR});
  activeBackend = backend;
  try {
    const baseUrl = await backend.start();
    const result = await runValuationJob(options.ticker, new BackendApiClient(baseUrl));
    await writeWorkbook(options.output, result.workbookBytes, options.force);
    console.log(formatValuationJobSuccess(result, options.output));
    for (const warning of result.warnings) console.error(`Warning: ${warning}`);
  } finally {
    await backend.stop();
    if (activeBackend === backend) activeBackend = null;
  }
}

// ---------------------------------------------------------------------------
// Model-library commands (share the TypeScript valuation engine; no math here)
// ---------------------------------------------------------------------------

const LIBRARY_COMMANDS = new Set(['build', 'models', 'model', 'filings', 'watch', 'config', 'mcp']);

interface GlobalFlags {
  modelsDir?: string;
  json: boolean;
  force: boolean;
  approve: boolean;
  approvedBy?: string;
  output?: string;
  summary?: string;
  changes: string[];
  accession?: string;
  filed?: string;
  set?: string;
  reason?: string;
  verification?: string;
  from?: string;
  to?: string;
  interval?: number;
  positionals: string[];
}

function parseLibraryArgs(argv: string[]): GlobalFlags {
  const flags: GlobalFlags = {json: false, force: false, approve: false, changes: [], positionals: []};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    const takeValue = (name: string): string => {
      if (!next || next.startsWith('-')) throw new CliUsageError(`${name} requires a value.`);
      i += 1;
      return next;
    };
    if (arg === '--models-dir') flags.modelsDir = takeValue(arg);
    else if (arg === '--json') flags.json = true;
    else if (arg === '--force') flags.force = true;
    else if (arg === '--approve') flags.approve = true;
    else if (arg === '--by') flags.approvedBy = takeValue(arg);
    else if (arg === '--output' || arg === '-o') flags.output = takeValue(arg);
    else if (arg === '--summary') flags.summary = takeValue(arg);
    else if (arg === '--change') flags.changes.push(takeValue(arg));
    else if (arg === '--accession') flags.accession = takeValue(arg);
    else if (arg === '--filed') flags.filed = takeValue(arg);
    else if (arg === '--set') flags.set = takeValue(arg);
    else if (arg === '--reason') flags.reason = takeValue(arg);
    else if (arg === '--from') flags.from = takeValue(arg);
    else if (arg === '--to') flags.to = takeValue(arg);
    else if (arg === '--verification') flags.verification = takeValue(arg);
    else if (arg === '--interval') {
      const raw = takeValue(arg);
      const seconds = Number(raw);
      if (!Number.isFinite(seconds) || seconds <= 0) throw new CliUsageError('--interval requires a positive number of seconds.');
      flags.interval = seconds;
    }
    else if (arg === '--help' || arg === '-h') throw new CliUsageError('__help__');
    else if (arg.startsWith('-')) throw new CliUsageError(`Unknown option: ${arg}`);
    else flags.positionals.push(arg);
  }
  return flags;
}

function openLibrary(modelsDir?: string): ModelLibrary {
  return new ModelLibrary(modelsDir !== undefined ? resolveModelsDir(modelsDir) : getModelsDir());
}

function libraryRoot(modelsDir?: string): string {
  return modelsDir !== undefined ? resolveModelsDir(modelsDir) : getModelsDir();
}

async function withBackend<T>(work: (client: BackendApiClient) => Promise<T>): Promise<T> {
  const backend = new LocalBackendProcess({backendDirectory: BACKEND_DIR});
  activeBackend = backend;
  try {
    const baseUrl = await backend.start();
    return await work(new BackendApiClient(baseUrl));
  } finally {
    await backend.stop();
    if (activeBackend === backend) activeBackend = null;
  }
}


function readCurrentHash(root: string, ticker: string): string | null {
  const checks = runStaticWorkbookChecks(currentWorkbookPath(root, ticker));
  return checks.exists ? checks.sha256 : null;
}

/** Fail closed when the saved workbook changed outside the library (manual-edit gate). */
function assertNoManualEdit(lib: ModelLibrary, root: string, ticker: string, baseHash?: string | null): string {
  const manifest = lib.getCompany(ticker);
  if (!manifest) throw new CliUsageError(`No model found for ticker ${ticker}. Build one first with \`dcf build ${ticker}\`.`);
  const actual = readCurrentHash(root, ticker);
  if (!actual) throw new Error(`The saved workbook for ${ticker} is missing; refusing to apply. Rebuild with \`dcf build ${ticker}\`.`);
  if (manifest.workbook_hash && actual !== manifest.workbook_hash) {
    throw new Error(
      `MANUAL_EDIT_DETECTED: the saved workbook for ${ticker} no longer matches the library manifest ` +
      `(manifest ${manifest.workbook_hash}, file ${actual}). Review the manual edits before replacing it.`,
    );
  }
  if (baseHash && actual !== baseHash) {
    throw new Error(
      `Proposal is stale: it was drafted against revision ${baseHash} but the current workbook is ${actual}. ` +
      `Re-run \`dcf model review ${ticker}\` and create a fresh proposal.`,
    );
  }
  return actual;
}

async function cmdBuild(tickerRaw: string | undefined, flags: GlobalFlags): Promise<void> {
  if (!tickerRaw) throw new CliUsageError('Usage: dcf build <ticker> [--output <file.xlsx>] [--force] [--models-dir <dir>]');
  const ticker = normalizeTicker(tickerRaw);
  const root = libraryRoot(flags.modelsDir);
  const output = flags.output ? resolve(INVOKER_CWD, flags.output) : datedDcfOutputPath(ticker);
  const lib = openLibrary(flags.modelsDir);
  try {
    const staged = await runBuildStaging({
      lib,
      root,
      ticker,
      output,
      force: flags.force,
      hooks: {
        onBackendStart: (handle) => {
          activeBackend = handle as LocalBackendProcess;
        },
        onBackendStop: () => {
          activeBackend = null;
        },
      },
    });
    console.log(staged.valuationSummary);
    for (const line of staged.stdout) console.log(line);
    for (const line of staged.stderr) console.error(line);
  } finally {
    lib.close();
  }
}

async function cmdModelUpdate(tickerRaw: string | undefined, flags: GlobalFlags): Promise<void> {
  if (!tickerRaw) throw new CliUsageError('Usage: dcf model update <ticker> [--output <file.xlsx>] [--force] [--models-dir <dir>]');
  const ticker = normalizeLibraryTicker(tickerRaw);
  console.log(`Building or refreshing ${ticker} from the latest data mapped by its model route.`);
  await cmdBuild(ticker, flags);
}

async function cmdModelExport(tickerRaw: string | undefined, flags: GlobalFlags): Promise<void> {
  if (!tickerRaw) throw new CliUsageError('Usage: dcf model export <ticker> [--output <file.xlsx>] [--force] [--models-dir <dir>]');
  const ticker = normalizeLibraryTicker(tickerRaw);
  const root = libraryRoot(flags.modelsDir);
  const lib = openLibrary(flags.modelsDir);
  try {
    const manifest = lib.getCompany(ticker);
    if (!manifest) {
      let hint = `No model found for ticker ${ticker}. Build one first with \`dcf build ${ticker}\`.`;
      try {
        const pending = await getPendingCandidateView(lib, root, ticker);
        if (pending) hint += ` A pending build candidate ${pending.id} exists: verify it with \`dcf model candidate-verify ${pending.id} --verification \"...\" --by <name>\`, then \`dcf model accept ${pending.id} --approve\`.`;
      } catch {
        // Legacy library without a candidates table: plain missing-model error.
      }
      throw new CliUsageError(hint);
    }
    const workbookPath = currentWorkbookPath(root, ticker);
    const currentHash = readCurrentHash(root, ticker);
    if (!currentHash) throw new Error(`The accepted workbook for ${ticker} is missing; refusing to export.`);
    if (!manifest.workbook_hash || currentHash !== manifest.workbook_hash) {
      throw new Error(`MANUAL_EDIT_DETECTED: ${ticker}'s current workbook differs from its accepted revision. Review the edit before exporting.`);
    }
    const output = flags.output ? resolve(INVOKER_CWD, flags.output) : datedDcfOutputPath(ticker);
    if (resolve(output) === resolve(workbookPath)) {
      throw new CliUsageError('Output must not overwrite the accepted library workbook.');
    }
    assertOutputDoesNotExist(output, flags.force);
    await writeWorkbook(output, await readFile(workbookPath), flags.force);
    console.log(`Exported accepted ${ticker} revision ${manifest.revision_id ?? '(unknown)'}.`);
    console.log(`Workbook: ${output}`);
  } finally {
    lib.close();
  }
}

function formatTable(rows: string[][]): string {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => (row[i] ?? '').length)));
  return rows.map((row) => row.map((cell, i) => (cell ?? '').padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

async function cmdModelsList(flags: GlobalFlags): Promise<void> {
  const lib = openLibrary(flags.modelsDir);
  try {
    const companies = lib.listCompanies();
    if (flags.json) {
      console.log(JSON.stringify(companies, null, 2));
      return;
    }
    if (companies.length === 0) {
      console.log(`No models in ${libraryRoot(flags.modelsDir)}. Build one with \`dcf build <ticker>\`.`);
      return;
    }
    console.log(formatTable([
      ['TICKER', 'ROUTE', 'READINESS', 'BUILT_AT', 'ACCESSION'],
      ...companies.map((c) => [c.ticker, c.route ?? '-', c.readiness ?? '-', c.built_at ?? '-', c.accession ?? '-']),
    ]));
  } finally {
    lib.close();
  }
}

async function cmdModelInspect(tickerRaw: string | undefined, flags: GlobalFlags): Promise<void> {
  if (!tickerRaw) throw new CliUsageError('Usage: dcf model inspect <ticker> [--json]');
  const ticker = normalizeLibraryTicker(tickerRaw);
  const root = libraryRoot(flags.modelsDir);
  const lib = openLibrary(flags.modelsDir);
  try {
    const manifest = lib.getCompany(ticker);
    if (!manifest) throw new CliUsageError(`No model found for ticker ${ticker}.`);
    const manifestFile = await readManifest(root, ticker);
    const manifestProblems = verifyManifest(manifestFile, readCurrentHash(root, ticker));
    const revisions = lib.listRevisions(ticker);
    const proposals = lib.listProposals(ticker);
    const snapshot = lib.getLatestSnapshot(ticker);
    const watch = lib.getWatch(ticker);
    const actualHash = readCurrentHash(root, ticker);
    const payload = {
      manifest,
      workbookExists: actualHash !== null,
      hashMatchesManifest: manifest.workbook_hash !== null && actualHash === manifest.workbook_hash,
      revisions: revisions.map((r) => ({id: r.id, hash: r.workbook_hash, parent: r.parent_hash, createdAt: r.created_at, note: r.note})),
      proposals: proposals.map((p) => ({id: p.id, status: p.status, baseRevisionHash: p.base_revision_hash, createdAt: p.created_at})),
      latestSnapshot: snapshot ? {accession: snapshot.accession, filedDate: snapshot.filed_date, fetchedAt: snapshot.fetched_at} : null,
      watch: watch ? {enabled: watch.enabled === 1, updateReady: watch.update_ready === 1, latestAccession: watch.latest_accession, lastCheck: watch.last_check, lastError: watch.last_error} : null,
    };
    if (flags.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`# ${manifest.ticker}`);
    console.log(`Manifest file: ${manifestPath(root, ticker)}${manifestFile ? '' : ' (MISSING — rebuild to regenerate)'}`);
    if (manifestFile && manifestFile.revisionId !== manifest.revision_id) {
      console.log(`Manifest revision drift: file=${manifestFile.revisionId ?? '-'} index=${manifest.revision_id ?? '-'}`);
    }
    for (const problem of manifestProblems) console.log(`Manifest problem: ${problem}`);
    console.log(`Route: ${manifest.route ?? '-'}  Readiness: ${manifest.readiness ?? '-'}  Currency: ${manifest.currency ?? '-'}  Unit scale: ${manifest.unit_scale ?? '-'}`);
    console.log(`Accession: ${manifest.accession ?? '-'}  Filed: ${manifest.filed_date ?? '-'}  Built: ${manifest.built_at ?? '-'}`);
    console.log(`Workbook: ${manifest.workbook_path ?? '-'}  Hash: ${manifest.workbook_hash ?? '-'}`);
    console.log(`On-disk hash matches manifest: ${payload.hashMatchesManifest ? 'yes' : 'NO — possible manual edit'}`);
    console.log(`Revisions: ${revisions.length}  Proposals: ${proposals.length}`);
    try {
      const pending = await getPendingCandidateView(lib, root, ticker);
      if (pending) {
        console.log(`Pending candidate: ${pending.id} status=${pending.status} hash=${pending.workbookHash} verification=${pending.payload.verification ? 'recorded' : 'missing'}`);
      }
    } catch {
      // Legacy library without a candidates table: no pending candidate.
    }
    if (snapshot) console.log(`Latest snapshot: ${snapshot.accession} (filed ${snapshot.filed_date ?? 'unknown'})`);
    if (watch) console.log(`Watch: ${watch.enabled === 1 ? 'enabled' : 'paused'}, update-ready: ${watch.update_ready === 1 ? 'yes' : 'no'}`);
  } finally {
    lib.close();
  }
}

const OPEN_EXIT_TIMEOUT_MS = 15_000;

async function cmdModelOpen(tickerRaw: string | undefined, flags: GlobalFlags): Promise<void> {
  if (!tickerRaw) throw new CliUsageError('Usage: dcf model open <ticker>');
  const ticker = normalizeLibraryTicker(tickerRaw);
  const root = libraryRoot(flags.modelsDir);
  const workbookPath = currentWorkbookPath(root, ticker);
  if (!existsSync(workbookPath)) throw new CliUsageError(`No saved workbook for ticker ${ticker}. Build one first with \`dcf build ${ticker}\`.`);
  // DCF_OPEN_COMMAND overrides the desktop opener (used by the live
  // regression to force launch success/failure deterministically).
  const openerOverride = process.env.DCF_OPEN_COMMAND?.trim() || null;
  const isDesktop = process.platform === 'darwin' || process.platform === 'win32';
  if (!isDesktop && !openerOverride && !process.env.DISPLAY?.trim() && !process.env.WAYLAND_DISPLAY?.trim()) {
    // Headless Linux: xdg-open would fail after we already claimed success,
    // so report the path instead of spawning the opener.
    console.log('No desktop session detected (DISPLAY/WAYLAND_DISPLAY are unset); the workbook was not opened.');
    console.log(`Workbook: ${workbookPath}`);
    return;
  }
  const opener = openerOverride ?? (process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open');
  const openerArgs = openerOverride !== null || process.platform !== 'win32' ? [workbookPath] : ['/c', 'start', '""', workbookPath];
  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(opener, openerArgs, {detached: true, stdio: 'ignore'});
      } catch (error) {
        rejectPromise(error);
        return;
      }
      let settled = false;
      const settle = (finish: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        finish();
      };
      // Success is the opener's clean exit, not merely surviving the wait:
      // a nonzero exit at any point fails, and an opener that never exits
      // fails closed instead of being reported as opened.
      const timer = setTimeout(() => settle(() => {
        child.unref();
        rejectPromise(new Error(
          `workbook opener did not exit within ${OPEN_EXIT_TIMEOUT_MS / 1000} seconds (${opener}); the workbook open was not confirmed`,
        ));
      }), OPEN_EXIT_TIMEOUT_MS);
      child.once('error', (error) => settle(() => rejectPromise(error)));
      child.once('exit', (code) => {
        if (code === 0) {
          settle(() => {
            child.unref();
            resolvePromise();
          });
        } else {
          settle(() => rejectPromise(new Error(`workbook opener exited with code ${code} (${opener}); the workbook was not confirmed open`)));
        }
      });
      child.once('spawn', () => {
        child.unref();
      });
    });
  } catch (error) {
    throw new Error(`Could not open ${workbookPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(`Open request sent for ${workbookPath} (the OS accepted the request; a visible spreadsheet window cannot be confirmed. The library copy is unchanged).`);
}

async function cmdFilingsSync(tickerRaw: string | undefined, flags: GlobalFlags): Promise<void> {
  if (!tickerRaw) throw new CliUsageError('Usage: dcf filings sync <ticker>');
  const ticker = normalizeTicker(tickerRaw);
  const root = libraryRoot(flags.modelsDir);
  const report = await withBackend((client) => syncFilingSnapshot(root, ticker, {
    getUnified: (t) => client.getUnifiedCompany(t, 5),
    getFilings: (t, limit) => client.getRecentFilings(t, limit),
  }));
  const formNote = report.form ? ` (Form ${report.form})` : '';
  if (report.updateReady) {
    console.log(`${ticker}: update-ready — latest filing${formNote} ${report.accession} (filed ${report.filedDate ?? 'unknown'}) differs from accepted ${report.acceptedAccession ?? 'none'}. Snapshot queued (${report.snapshotChars} chars${report.truncated ? ', trimmed' : ''}); workbook unchanged.`);
  } else {
    console.log(`${ticker}: up to date — latest filing${formNote} ${report.accession} matches the accepted revision. Snapshot refreshed (${report.snapshotChars} chars).`);
  }
  console.log(`Filing source: ${report.filingSource}; workbook facts: ${report.factAccession ?? 'unknown'}.`);
}

async function cmdModelReview(tickerRaw: string | undefined, flags: GlobalFlags): Promise<void> {
  if (!tickerRaw) throw new CliUsageError('Usage: dcf model review <ticker>');
  const ticker = normalizeLibraryTicker(tickerRaw);
  const root = libraryRoot(flags.modelsDir);
  const lib = openLibrary(flags.modelsDir);
  try {
    const manifest = lib.getCompany(ticker);
    if (!manifest) throw new CliUsageError(`No model found for ticker ${ticker}.`);
    const workbookPath = currentWorkbookPath(root, ticker);
    const checks = runStaticWorkbookChecks(workbookPath);
    const hashMatches = manifest.workbook_hash !== null && checks.sha256 === manifest.workbook_hash;
    const manifestFile = await readManifest(root, ticker);
    for (const problem of verifyManifest(manifestFile, checks.exists ? checks.sha256 : null)) {
      console.log(`Manifest problem: ${problem}`);
    }
    const python = findBackendPython();
    if (python && checks.exists) {
      try {
        const inspection = await inspectWorkbook(python, workbookPath);
        console.log(`Workbook structure: ${inspection.sheets.length} sheets (${inspection.sheets.join(', ') || 'none'}), ${inspection.formulaCount} formulas.`);
        if (inspection.hasInputRequiredSheet) {
          console.log(`Input Required status: ${inspection.inputRequiredStatus ?? 'blank'}.`);
        }
        console.log(`Data Review rows: ${inspection.dataReviewRows}.`);
        if (inspection.cachedErrorCells.length > 0) {
          console.log(`Cached formula errors (${inspection.cachedErrorCells.length}):`);
          for (const cell of inspection.cachedErrorCells.slice(0, 20)) console.log(`  ${cell}`);
        } else {
          console.log('Cached formula errors: none.');
        }
      } catch (error) {
        console.log(`Workbook inspection unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const watch = lib.getWatch(ticker);
    const snapshot = lib.getLatestSnapshot(ticker);
    const proposals = lib.listProposals(ticker).filter((p) => p.status === 'proposed' || p.status === 'accepted');
    console.log(formatReviewReport(
      {ticker: manifest.ticker, route: manifest.route ?? undefined, revisionHash: manifest.workbook_hash ?? undefined},
      snapshot ? {accession: snapshot.accession, filedDate: snapshot.filed_date ?? 'unknown'} : null,
      checks,
      proposals.length > 0 ? {summary: `${proposals.length} open proposal(s)`, changeCount: proposals.length} : null,
    ));
    console.log(hashMatches
      ? 'Hash check: on-disk workbook matches the manifest.'
      : 'Hash check: MISMATCH — the workbook may have been edited outside the library. Do not apply proposals until reviewed.');
    if (watch?.update_ready === 1) {
      console.log(`Watch: update-ready (latest ${watch.latest_accession ?? 'unknown'}). Run \`dcf model propose-update ${ticker}\` to draft changes.`);
    }
    for (const proposal of proposals) {
      console.log(`Open proposal: ${proposal.id} status=${proposal.status} base=${proposal.base_revision_hash ?? '-'}`);
    }
  } finally {
    lib.close();
  }
}

function parseChangeSpec(spec: string, fallbackAccession: string): {
  sheet: string;
  cell: string;
  proposedValue: string | number | boolean | null;
  rationale: string;
  source: string;
  accession: string;
} {
  const parts = spec.split('|').map((part) => part.trim());
  if (parts.length < 5 || parts.length > 6) {
    throw new CliUsageError(`Invalid --change spec (want sheet|cell|proposed|rationale|source[|accession]): ${spec}`);
  }
  const [sheet, cell, proposed, rationale, source, accession] = parts as [string, string, string, string, string, string?];
  const resolvedAccession = (accession ?? '').trim() || fallbackAccession;
  if (!sheet || !cell || !proposed || !rationale || !source || !resolvedAccession) {
    throw new CliUsageError(`Invalid --change spec (empty field): ${spec}`);
  }
  return {sheet, cell, proposedValue: coerceScalar(proposed), rationale, source, accession: resolvedAccession};
}

/**
 * CLI --change values arrive as strings. Plain numeric literals (including
 * exponent notation) become JSON numbers, true/false become JSON booleans,
 * and the explicit __BLANK__ token becomes null so a cell can be cleared;
 * anything else stays a string. Leading '=' is handled by the caller as an
 * explicit formula edit and never reaches this coercion as a value.
 */
const BLANK_VALUE_TOKEN = '__BLANK__';

function coerceScalar(raw: string): string | number | boolean | null {
  const trimmed = raw.trim();
  if (trimmed === BLANK_VALUE_TOKEN) return null;
  const lowered = trimmed.toLowerCase();
  if (lowered === 'true') return true;
  if (lowered === 'false') return false;
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;
  }
  return raw;
}

async function cmdModelProposeUpdate(tickerRaw: string | undefined, flags: GlobalFlags): Promise<void> {
  if (!tickerRaw) throw new CliUsageError('Usage: dcf model propose-update <ticker> [--summary <text>] [--change <spec>]... [--accession <acc> --filed <date>]');
  const ticker = normalizeLibraryTicker(tickerRaw);
  const root = libraryRoot(flags.modelsDir);
  const lib = openLibrary(flags.modelsDir);
  try {
    const manifest = lib.getCompany(ticker);
    if (!manifest) throw new CliUsageError(`No model found for ticker ${ticker}.`);
    const baseHash = manifest.workbook_hash;
    if (!baseHash) throw new Error(`No accepted revision hash for ${ticker}; rebuild with \`dcf build ${ticker}\` first.`);
    assertNoManualEdit(lib, root, ticker);
    const snapshot = lib.getLatestSnapshot(ticker);
    const accession = flags.accession ?? snapshot?.accession ?? manifest.accession;
    if (!accession) throw new CliUsageError('No filing accession available. Provide --accession <acc> --filed <YYYY-MM-DD>.');
    // Stale-source gate: the proposal accession must be the accepted one or a
    // stored snapshot accession for this ticker — never an unknown filing.
    const knownAccessions = new Set<string>();
    if (manifest.accession) knownAccessions.add(manifest.accession);
    for (const row of lib.listSnapshots(ticker)) knownAccessions.add(row.accession);
    if (!knownAccessions.has(accession)) {
      throw new CliUsageError(
        `Unknown source accession ${accession} for ${ticker}. Run \`dcf filings sync ${ticker}\` first so the snapshot is stored.`,
      );
    }
    const summary = flags.summary ?? `Update ${ticker} from SEC filing ${accession}`;
    let draft: ProposalDraft;
    if (flags.changes.length > 0) {
      const parsedChanges = flags.changes.map((spec) => {
        const parsed = parseChangeSpec(spec, accession);
        // A proposed value starting with '=' is an explicit formula edit.
        const proposed = parsed.proposedValue;
        return typeof proposed === 'string' && proposed.startsWith('=')
          ? {
            sheet: parsed.sheet,
            cell: parsed.cell,
            proposedFormula: proposed,
            rationale: parsed.rationale,
            source: parsed.source,
            accession: parsed.accession,
          }
          : {
            sheet: parsed.sheet,
            cell: parsed.cell,
            proposedValue: proposed,
            rationale: parsed.rationale,
            source: parsed.source,
            accession: parsed.accession,
          };
      });
      // Capture current literals/formulas BEFORE approval so review shows priors.
      const priors = await captureChangePriors(root, ticker, parsedChanges);
      for (const change of parsedChanges) {
        const changeAccession = change.accession;
        if (changeAccession && !knownAccessions.has(changeAccession)) {
          throw new CliUsageError(
            `Change ${change.sheet}!${change.cell} cites unknown accession ${changeAccession}; sync it first with \`dcf filings sync ${ticker}\`.`,
          );
        }
      }
      draft = {
        ticker,
        baseRevisionHash: baseHash,
        summary,
        createdAt: utcNow(),
        changes: parsedChanges.map((change, index) => ({
          ...change,
          priorValue: priors[index]?.priorValue ?? null,
          priorFormula: priors[index]?.priorFormula ?? null,
        })),
      };
    } else {
      console.log('No filed facts supplied: add one or more --change specs (sheet|cell|proposed|rationale|source[|accession]) to record sourced edits.');
      console.log('No proposal recorded.');
      return;
    }
    const errors = validateProposalDraft(draft);
    if (errors.length > 0) {
      console.log(formatProposalMarkdown(draft));
      throw new CliUsageError(`Proposal invalid:\n- ${errors.join('\n- ')}`);
    }
    const record = lib.createProposal({ticker, base_revision_hash: baseHash, payload: {summary: draft.summary, changes: draft.changes, createdAt: draft.createdAt}, status: 'proposed'});
    console.log(formatProposalMarkdown(draft));
    console.log(`Proposal ${record.id} recorded as proposed. Approval required before apply: \`dcf model apply ${record.id} --approve\`.`);
  } finally {
    lib.close();
  }
}

async function cmdModelApply(proposalIdRaw: string | undefined, flags: GlobalFlags): Promise<void> {
  if (!proposalIdRaw) throw new CliUsageError('Usage: dcf model apply <proposal-id> --approve [--by <name>]');
  if (!flags.approve) {
    throw new CliUsageError(`Explicit approval required: re-run with --approve to apply proposal ${proposalIdRaw}.`);
  }
  const root = libraryRoot(flags.modelsDir);
  const result = await applyApprovedProposal(root, proposalIdRaw, flags.approvedBy ?? 'cli');
  console.log(`Applied proposal ${result.proposalId} (approved by ${result.approvedBy}): preserved revision ${result.priorHash} and saved new revision ${result.revisionId} (${result.newHash}).`);
  console.log(result.inspectionMarkdown);
}

async function cmdModelReject(proposalIdRaw: string | undefined, flags: GlobalFlags): Promise<void> {
  if (!proposalIdRaw) throw new CliUsageError('Usage: dcf model reject <proposal-id> [--reason <text>]');
  const root = libraryRoot(flags.modelsDir);
  const rejected = rejectProposal(root, proposalIdRaw, flags.reason);
  console.log(`Proposal ${rejected.id} rejected (status=${rejected.status}). The workbook is unchanged.`);
}

async function cmdModelCompare(tickerRaw: string | undefined, flags: GlobalFlags): Promise<void> {
  if (!tickerRaw) throw new CliUsageError('Usage: dcf model compare <ticker> [--from <revision|candidate|accepted>] [--to <revision|candidate|accepted>] [--models-dir <dir>]');
  const ticker = normalizeLibraryTicker(tickerRaw);
  const root = libraryRoot(flags.modelsDir);
  const lib = openLibrary(flags.modelsDir);
  try {
    const from = resolveCompareEndpoint(lib, root, ticker, flags.from, 'from');
    const to = resolveCompareEndpoint(lib, root, ticker, flags.to, 'to');
    if (!from) {
      console.log(`No earlier revision to compare for ${ticker}; the accepted model is the initial revision.`);
      return;
    }
    if (!to) throw new Error(`Nothing to compare for ${ticker}: no pending candidate and no accepted revision.`);
    const python = findBackendPython();
    if (!python) throw new Error('No Python with openpyxl is available (backend/.venv); cannot compare workbooks.');
    const diff = await compareWorkbooks(python, from.path, to.path);
    console.log(formatCompareMarkdown(ticker, from.label, to.label, diff));
  } finally {
    lib.close();
  }
}

async function cmdModelCandidate(tickerRaw: string | undefined, flags: GlobalFlags): Promise<void> {
  if (!tickerRaw) throw new CliUsageError('Usage: dcf model candidate <ticker> [--models-dir <dir>]');
  const ticker = normalizeLibraryTicker(tickerRaw);
  const root = libraryRoot(flags.modelsDir);
  const lib = openLibrary(flags.modelsDir);
  try {
    const view = await getPendingCandidateView(lib, root, ticker);
    if (!view) {
      console.log(`No pending build candidate for ${ticker}. Stage one with \`dcf build ${ticker}\`.`);
      return;
    }
    console.log(formatCandidateMarkdown(view));
  } finally {
    lib.close();
  }
}

async function cmdCandidateVerify(candidateIdRaw: string | undefined, flags: GlobalFlags): Promise<void> {
  if (!candidateIdRaw) throw new CliUsageError('Usage: dcf model candidate-verify <candidate-id> --verification <text> --by <name> [--models-dir <dir>]');
  if (!flags.verification) throw new CliUsageError('A review result is required: re-run with --verification "<freshness, sources, formulas, summary>".');
  if (!flags.approvedBy) throw new CliUsageError('A reviewer name is required: re-run with --by <name>.');
  const root = libraryRoot(flags.modelsDir);
  const lib = openLibrary(flags.modelsDir);
  try {
    const view = await recordCandidateVerification(lib, root, candidateIdRaw, flags.verification, flags.approvedBy);
    console.log(`Recorded AI verification for candidate ${view.id} (reviewed by ${flags.approvedBy}).`);
    console.log(`Promote with explicit human approval: \`dcf model accept ${view.id} --approve [--by <name>]\`.`);
  } finally {
    lib.close();
  }
}

async function cmdModelAccept(candidateIdRaw: string | undefined, flags: GlobalFlags): Promise<void> {
  if (!candidateIdRaw) throw new CliUsageError('Usage: dcf model accept <candidate-id> --approve [--by <name>] [--models-dir <dir>]');
  if (!flags.approve) {
    throw new CliUsageError(`Explicit approval required: re-run with --approve to accept candidate ${candidateIdRaw}.`);
  }
  const root = libraryRoot(flags.modelsDir);
  const lib = openLibrary(flags.modelsDir);
  try {
    const accepted = await acceptCandidate(lib, root, candidateIdRaw, flags.approvedBy ?? 'cli');
    console.log(`Accepted candidate ${accepted.candidateId} (approved by ${flags.approvedBy ?? 'cli'}): new revision ${accepted.revisionId} (${accepted.hash}).`);
    if (accepted.parentHash) console.log(`Prior revision preserved: ${accepted.parentHash}.`);
    console.log(`Accepted library copy: ${accepted.workbookPath}`);
  } finally {
    lib.close();
  }
}

async function cmdCandidateReject(candidateIdRaw: string | undefined, flags: GlobalFlags): Promise<void> {
  if (!candidateIdRaw) throw new CliUsageError('Usage: dcf model candidate-reject <candidate-id> [--reason <text>] [--models-dir <dir>]');
  const root = libraryRoot(flags.modelsDir);
  const lib = openLibrary(flags.modelsDir);
  try {
    const payload = rejectCandidate(lib, root, candidateIdRaw, flags.reason);
    console.log(`Candidate ${candidateIdRaw} rejected. The accepted library copy is unchanged.`);
    void payload;
  } finally {
    lib.close();
  }
}

async function checkOneTicker(root: string, modelsDir: string | undefined, ticker: string): Promise<void> {
  try {
    const report = await withBackend((client) => syncFilingSnapshot(root, ticker, {
      getUnified: (t) => client.getUnifiedCompany(t, 5),
      getFilings: (t, limit) => client.getRecentFilings(t, limit),
    }));
    const formNote = report.form ? `Form ${report.form} ` : '';
    console.log(`${ticker}: ${report.updateReady ? `update-ready (${formNote}${report.accession})` : 'up to date'} — snapshot stored (${report.snapshotChars} chars), workbook untouched.`);
  } catch (error) {
    console.error(`${ticker}: check failed: ${error instanceof Error ? error.message : String(error)}`);
    const errorLib = openLibrary(modelsDir);
    try {
      errorLib.setWatch(ticker, {last_check: utcNow(), last_error: error instanceof Error ? error.message : String(error)});
    } finally {
      errorLib.close();
    }
  }
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, seconds * 1000));
}

async function cmdWatch(statusArgs: string[], flags: GlobalFlags): Promise<void> {
  const [sub, target] = statusArgs;
  const root = libraryRoot(flags.modelsDir);
  if (sub === 'status' || !sub) {
    const entries = getWatchStatus(root);
    if (entries.length === 0) {
      console.log(`Watch: no tickers tracked. Run \`dcf filings sync <ticker>\` to start tracking.`);
      return;
    }
    console.log(formatTable([
      ['TICKER', 'ENABLED', 'UPDATE_READY', 'LATEST_ACCESSION', 'LAST_CHECK'],
      ...entries.map((e) => [e.ticker, e.enabled ? 'yes' : 'no', e.updateReady ? 'yes' : 'no', e.latestAccession ?? '-', e.lastCheck ?? '-']),
    ]));
    return;
  }
  if (sub === 'pause' || sub === 'resume') {
    if (!target) throw new CliUsageError(`Usage: dcf watch ${sub} <ticker>`);
    setWatchEnabled(root, normalizeTicker(target), sub === 'resume');
    console.log(`Watch ${sub === 'resume' ? 'resumed' : 'paused'} for ${normalizeTicker(target)}.`);
    return;
  }
  if (sub === 'check') {
    const lib = openLibrary(flags.modelsDir);
    let tickers: string[];
    try {
      tickers = target ? [normalizeTicker(target)] : lib.listWatch().filter((w) => w.enabled === 1).map((w) => w.ticker);
    } finally {
      lib.close();
    }
    if (tickers.length === 0) {
      console.log('Watch: nothing to check. Track a ticker with `dcf filings sync <ticker>` first.');
      return;
    }
    for (const ticker of tickers) {
      await checkOneTicker(root, flags.modelsDir, ticker);
    }
    return;
  }
  if (sub === 'run') {
    const intervalSeconds = flags.interval ?? 300;
    if (target) normalizeTicker(target);
    console.log(`Watching ${target ?? 'enabled tickers'} every ${intervalSeconds}s (Ctrl+C stops; snapshots only, workbooks are never modified).`);
    for (;;) {
      const lib = openLibrary(flags.modelsDir);
      let tickers: string[];
      try {
        tickers = target ? [normalizeTicker(target)] : lib.listWatch().filter((w) => w.enabled === 1).map((w) => w.ticker);
      } finally {
        lib.close();
      }
      if (tickers.length === 0) {
        console.log('Watch: nothing tracked yet. Run `dcf filings sync <ticker>` to start tracking.');
      }
      for (const ticker of tickers) {
        await checkOneTicker(root, flags.modelsDir, ticker);
      }
      await sleep(intervalSeconds);
    }
  }
  throw new CliUsageError('Usage: dcf watch status|check [ticker]|run [--interval <seconds>] [ticker]|pause <ticker>|resume <ticker>');
}

async function cmdConfigReviewHook(flags: GlobalFlags): Promise<void> {
  if (flags.set !== undefined) {
    const saved = setReviewHook(flags.set);
    console.log(`Review hook: ${saved ?? '(cleared)'} (saved to ${getConfigPath()})`);
    return;
  }
  console.log(`Review hook: ${getReviewHook() ?? '(unset)'}`);
  console.log(`DCF_REVIEW_HOOK: ${process.env.DCF_REVIEW_HOOK?.trim() || '(unset)'}`);
  console.log('Set with `dcf config review-hook --set "<shell command>"`; clear by removing "reviewHook" from the config file.');
}

async function cmdConfigModelsDir(flags: GlobalFlags): Promise<void> {
  if (flags.set !== undefined) {
    const resolved = setModelsDir(flags.set);
    console.log(`Model library root: ${resolved} (saved to ${getConfigPath()})`);
    return;
  }
  const resolved = libraryRoot(flags.modelsDir);
  const envDir = process.env.DCF_MODELS_DIR?.trim() || '(unset)';
  let configDir = '(no config file)';
  try {
    const raw = await readFile(getConfigPath(), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.modelsDir === 'string' && parsed.modelsDir.trim()) configDir = parsed.modelsDir;
  } catch {
    // No config file yet.
  }
  console.log(`Model library root: ${resolved}`);
  console.log(`DCF_MODELS_DIR: ${envDir}`);
  console.log(`Config file (${getConfigPath()}): ${configDir}`);
}

async function dispatchLibraryCommands(argv: string[]): Promise<boolean> {
  const [command, subcommand, ...rest] = argv;
  if (!command || !LIBRARY_COMMANDS.has(command)) return false;
  // A flag in the subcommand/ticker slot (e.g. `dcf build --models-dir <dir>`)
  // can never be a valid subcommand or ticker. Reject it with command usage
  // before it reaches ticker validation, which would report the confusing
  // `Invalid ticker format: --models-dir`. The mcp command owns its own
  // raw-argv gate below.
  if (command !== 'mcp' && subcommand !== undefined && subcommand.startsWith('-')) {
    const usageByCommand: Record<string, string> = {
      build: 'Usage: dcf build <ticker> [--output <file.xlsx>] [--force] [--models-dir <dir>]',
      models: 'Usage: dcf models list [--json]',
      model: 'Usage: dcf model inspect|compare|open|review|update|export|propose-update|apply|reject|candidate|candidate-verify|accept|candidate-reject ...',
      filings: 'Usage: dcf filings sync <ticker>',
      watch: 'Usage: dcf watch status|check [ticker]|run [--interval <seconds>] [ticker]|pause <ticker>|resume <ticker>',
      config: 'Usage: dcf config models-dir|review-hook [--set <value>]',
    };
    throw new CliUsageError(usageByCommand[command] ?? `Usage: dcf ${command} ...`);
  }
  const flags = parseLibraryArgs(command === 'mcp' ? [] : rest);
  const args = flags.positionals;
  const sub = command === 'mcp' ? undefined : subcommand;
  switch (command) {
    case 'build':
      await cmdBuild(sub, flags);
      return true;
    case 'models':
      if (sub !== 'list') throw new CliUsageError('Usage: dcf models list [--json]');
      await cmdModelsList(flags);
      return true;
    case 'model':
      if (sub === 'inspect') await cmdModelInspect(args[0], flags);
      else if (sub === 'compare') await cmdModelCompare(args[0], flags);
      else if (sub === 'open') await cmdModelOpen(args[0], flags);
      else if (sub === 'review') await cmdModelReview(args[0], flags);
      else if (sub === 'update') await cmdModelUpdate(args[0], flags);
      else if (sub === 'export') await cmdModelExport(args[0], flags);
      else if (sub === 'propose-update') await cmdModelProposeUpdate(args[0], flags);
      else if (sub === 'apply') await cmdModelApply(args[0], flags);
      else if (sub === 'reject') await cmdModelReject(args[0], flags);
      else if (sub === 'candidate') await cmdModelCandidate(args[0], flags);
      else if (sub === 'candidate-verify') await cmdCandidateVerify(args[0], flags);
      else if (sub === 'accept') await cmdModelAccept(args[0], flags);
      else if (sub === 'candidate-reject') await cmdCandidateReject(args[0], flags);
      else throw new CliUsageError('Usage: dcf model inspect|compare|open|review|update|export|propose-update|apply|reject|candidate|candidate-verify|accept|candidate-reject ...');
      return true;
    case 'filings':
      if (sub !== 'sync') throw new CliUsageError('Usage: dcf filings sync <ticker>');
      await cmdFilingsSync(args[0], flags);
      return true;
    case 'watch':
      await cmdWatch(sub ? [sub, ...args] : [], flags);
      return true;
    case 'config':
      if (sub === 'models-dir') {
        await cmdConfigModelsDir(flags);
        return true;
      }
      if (sub === 'review-hook') {
        await cmdConfigReviewHook(flags);
        return true;
      }
      throw new CliUsageError('Usage: dcf config models-dir|review-hook [--set <value>]');
    case 'mcp': {
      // Raw-argv gate: the stdio server takes no arguments. Exactly --help/-h
      // prints usage; anything else is rejected before startup so a typo never
      // holds the terminal in the MCP request loop.
      const tail = subcommand === undefined ? rest : [subcommand, ...rest];
      if (tail.length === 1 && (tail[0] === '--help' || tail[0] === '-h')) {
        console.log(usage());
        return true;
      }
      if (tail.length > 0) {
        throw new CliUsageError(`Usage: dcf mcp (takes no arguments). Unexpected: ${tail.join(' ')}`);
      }
      const {startMcpServer} = await import('@/mcp/server');
      await startMcpServer();
      return true;
    }
    default:
      return false;
  }
}

async function main(): Promise<void> {
  try {
    checkNodeVersion();
    const argv = process.argv.slice(2);
    if (argv.length > 0 && LIBRARY_COMMANDS.has(argv[0]!)) {
      try {
        await dispatchLibraryCommands(argv);
      } catch (error) {
        if (error instanceof CliUsageError && error.message === '__help__') {
          console.log(usage());
          return;
        }
        throw error;
      }
      return;
    }
    const parsed = parseArgs(argv);
    if (!parsed) {
      console.log(usage());
      return;
    }
    const ticker = parsed.ticker ?? await promptForTicker();
    await generateWorkbook(resolveCliOptions(parsed, ticker));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof CliUsageError) console.error(`\n${usage()}`);
    process.exitCode = 1;
  }
}

void main();
