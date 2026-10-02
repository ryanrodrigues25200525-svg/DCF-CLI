import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { companyDir } from './store';

export interface ModelManifest {
  ticker: string;
  route: string | null;
  currency: string | null;
  unitScale: string | null;
  accession: string | null;
  filedDate: string | null;
  workbookHash: string | null;
  builtAt: string | null;
  readiness: string | null;
  revisionId: string | null;
  workbookFile: 'current.xlsx';
  libraryVersion: 1;
}

export function manifestPath(root: string, ticker: string): string {
  return join(companyDir(root, ticker.toUpperCase()), 'manifest.json');
}

function isManifest(value: unknown): value is ModelManifest {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.ticker === 'string' && record.workbookFile === 'current.xlsx';
}

export async function readManifest(root: string, ticker: string): Promise<ModelManifest | null> {
  let raw: string;
  try {
    const {readFile} = await import('node:fs/promises');
    raw = await readFile(manifestPath(root, ticker), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Atomic manifest write (temp file in the same directory + rename). */
export async function writeManifestAtomic(root: string, manifest: ModelManifest): Promise<void> {
  const {writeFile, rename} = await import('node:fs/promises');
  const dest = manifestPath(root, manifest.ticker);
  await mkdir(dirname(dest), {recursive: true});
  const tmp = `${dest}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(tmp, dest);
}

/** Human-readable discrepancies between manifest and on-disk state (empty = agree). */
export function verifyManifest(manifest: ModelManifest | null, actualHash: string | null): string[] {
  if (!manifest) return ['manifest.json is missing'];
  const problems: string[] = [];
  if (!manifest.workbookHash) problems.push('manifest has no workbook hash');
  else if (!actualHash) problems.push('saved workbook is missing');
  else if (actualHash !== manifest.workbookHash) {
    problems.push(`workbook hash ${actualHash} does not match manifest ${manifest.workbookHash}`);
  }
  if (!manifest.revisionId) problems.push('manifest has no revision id');
  return problems;
}
