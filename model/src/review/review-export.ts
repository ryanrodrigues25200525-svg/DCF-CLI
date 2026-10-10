import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { currentWorkbookPath, normalizeTicker } from '@/library/store';
import type { ModelLibrary } from '@/library/store';
import { readManifest, verifyManifest } from '@/library/manifest';
import { formatReviewReport, runStaticWorkbookChecks } from '@/review/review-checks';
import { findBackendPython, inspectWorkbook } from '@/workbook/xlsx';

export interface ReviewExportResult {
  ticker: string;
  path: string;
  lines: number;
}

export class ModelNotFoundError extends Error {}

/** Assemble the exact lines `dcf model review` prints, for file export (#51). */
export async function collectModelReviewLines(args: {
  lib: ModelLibrary;
  root: string;
  ticker: string;
}): Promise<string[]> {
  const { lib, root } = args;
  const ticker = normalizeTicker(args.ticker);
  const lines: string[] = [];
  const manifest = lib.getCompany(ticker);
  if (!manifest) throw new ModelNotFoundError(`No model found for ticker ${ticker}.`);
  const workbookPath = currentWorkbookPath(root, ticker);
  const checks = runStaticWorkbookChecks(workbookPath);
  const hashMatches = manifest.workbook_hash !== null && checks.sha256 === manifest.workbook_hash;
  const manifestFile = await readManifest(root, ticker);
  for (const problem of verifyManifest(manifestFile, checks.exists ? checks.sha256 : null)) {
    lines.push(`Manifest problem: ${problem}`);
  }
  const python = findBackendPython();
  if (python && checks.exists) {
    try {
      const inspection = await inspectWorkbook(python, workbookPath);
      lines.push(`Workbook structure: ${inspection.sheets.length} sheets (${inspection.sheets.join(', ') || 'none'}), ${inspection.formulaCount} formulas.`);
      if (inspection.hasInputRequiredSheet) {
        lines.push(`Input Required status: ${inspection.inputRequiredStatus ?? 'blank'}.`);
      }
      lines.push(`Data Review rows: ${inspection.dataReviewRows}.`);
      if (inspection.cachedErrorCells.length > 0) {
        lines.push(`Cached formula errors (${inspection.cachedErrorCells.length}):`);
        for (const cell of inspection.cachedErrorCells.slice(0, 20)) lines.push(`  ${cell}`);
      } else {
        lines.push('Cached formula errors: none.');
      }
    } catch (error) {
      lines.push(`Workbook inspection unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const watch = lib.getWatch(ticker);
  const snapshot = lib.getLatestSnapshot(ticker);
  const proposals = lib.listProposals(ticker).filter((p) => p.status === 'proposed' || p.status === 'accepted');
  lines.push(formatReviewReport(
    {ticker: manifest.ticker, route: manifest.route ?? undefined, revisionHash: manifest.workbook_hash ?? undefined},
    snapshot ? {accession: snapshot.accession, filedDate: snapshot.filed_date ?? 'unknown'} : null,
    checks,
    proposals.length > 0 ? {summary: `${proposals.length} open proposal(s)`, changeCount: proposals.length} : null,
  ));
  lines.push(hashMatches
    ? 'Hash check: on-disk workbook matches the manifest.'
    : 'Hash check: MISMATCH — the workbook may have been edited outside the library. Do not apply proposals until reviewed.');
  if (watch?.update_ready === 1) {
    lines.push(`Watch: update-ready (latest ${watch.latest_accession ?? 'unknown'}). Run \`dcf model propose-update ${ticker}\` to draft changes.`);
  }
  for (const proposal of proposals) {
    lines.push(`Open proposal: ${proposal.id} status=${proposal.status} base=${proposal.base_revision_hash ?? '-'}`);
  }
  return lines;
}

/** Write review lines to a markdown file; refuses to overwrite without force. */
export async function writeReportFile(path: string, lines: string[], force: boolean): Promise<void> {
  const { stat } = await import('node:fs/promises');
  await mkdir(dirname(path), { recursive: true });
  if (!force) {
    try {
      await stat(path);
      throw new Error(`Report already exists at ${path}; re-run with --force to overwrite.`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Report already exists')) throw error;
    }
  }
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
}

export function defaultReviewReportPath(root: string, ticker: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return join(root, 'companies', ticker.trim().toUpperCase(), `review-${date}.md`);
}

export async function exportModelReview(args: {
  lib: ModelLibrary;
  root: string;
  ticker: string;
  output?: string;
  force?: boolean;
}): Promise<ReviewExportResult> {
  const ticker = normalizeTicker(args.ticker);
  const lines = await collectModelReviewLines({ lib: args.lib, root: args.root, ticker });
  const header = `# Model review — ${ticker} (exported ${new Date().toISOString().slice(0, 10)})`;
  const path = args.output ?? defaultReviewReportPath(args.root, ticker);
  await writeReportFile(path, [header, '', ...lines], args.force ?? false);
  return { ticker, path, lines: lines.length + 2 };
}
