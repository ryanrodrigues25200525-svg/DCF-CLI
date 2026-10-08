import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  companyDir,
  currentWorkbookPath,
  normalizeTicker,
  revisionPath,
  sha256Hex,
} from '@/library/store.js';
import { utcNow } from '@/library/store.js';
import type { ModelLibrary } from '@/library/store.js';
import { readManifest, writeManifestAtomic } from '@/library/manifest.js';
import type { ModelManifest } from '@/library/manifest.js';

export interface AcceptManualEditsArgs {
  lib: ModelLibrary;
  root: string;
  ticker: string;
  note?: string;
}

export interface AcceptManualEditsResult {
  ticker: string;
  revisionId: string;
  previousHash: string | null;
  newHash: string;
  note: string;
  workbookPath: string;
  archivedPath: string;
}

async function readCurrentHash(root: string, ticker: string): Promise<string | null> {
  try {
    return sha256Hex(await readFile(currentWorkbookPath(root, ticker)));
  } catch {
    return null;
  }
}

/**
 * Accept a manually edited `current.xlsx` as a new library revision (#51).
 * The diverged bytes become a child revision of the previously accepted
 * hash; pending proposals keep their base hash and go stale through the
 * existing gate instead of being silently rebased.
 */
export async function acceptManualEdits(args: AcceptManualEditsArgs): Promise<AcceptManualEditsResult> {
  const { lib, root } = args;
  const ticker = normalizeTicker(args.ticker);
  const note = args.note?.trim() || 'manual edits accepted as new revision';
  const existing = lib.getCompany(ticker);
  if (!existing) throw new Error(`No ${ticker} library entry; build a model before accepting edits.`);
  const manifest = await readManifest(root, ticker);
  const acceptedHash = manifest?.workbookHash ?? existing.workbook_hash;
  const onDiskHash = await readCurrentHash(root, ticker);
  if (onDiskHash === null) throw new Error(`Saved workbook for ${ticker} is missing; nothing to accept.`);
  if (acceptedHash !== null && onDiskHash === acceptedHash) {
    throw new Error(`No manual edits detected for ${ticker}; the saved workbook matches the accepted revision.`);
  }
  const revision = lib.addRevision({
    ticker,
    workbook_hash: onDiskHash,
    parent_hash: acceptedHash,
    path: null,
    note,
  });
  const archivedPath = revisionPath(root, ticker, revision.id);
  await mkdir(dirname(archivedPath), { recursive: true });
  await writeFile(archivedPath, await readFile(currentWorkbookPath(root, ticker)));
  const builtAt = utcNow();
  const workbookPath = currentWorkbookPath(root, ticker);
  lib.upsertCompany({
    ticker,
    route: existing.route,
    currency: existing.currency,
    unit_scale: existing.unit_scale,
    accession: existing.accession,
    filed_date: existing.filed_date,
    workbook_hash: onDiskHash,
    built_at: builtAt,
    readiness: existing.readiness,
    workbook_path: workbookPath,
    revision_id: revision.id,
  });
  const next: ModelManifest = {
    ticker,
    route: manifest?.route ?? existing.route,
    currency: manifest?.currency ?? existing.currency,
    unitScale: manifest?.unitScale ?? existing.unit_scale,
    accession: manifest?.accession ?? existing.accession,
    filedDate: manifest?.filedDate ?? existing.filed_date,
    workbookHash: onDiskHash,
    builtAt: builtAt,
    readiness: manifest?.readiness ?? existing.readiness,
    revisionId: revision.id,
    workbookFile: 'current.xlsx',
    libraryVersion: 1,
  };
  await mkdir(companyDir(root, ticker), { recursive: true });
  await writeManifestAtomic(root, next);
  return { ticker, revisionId: revision.id, previousHash: acceptedHash, newHash: onDiskHash, note, workbookPath, archivedPath };
}
