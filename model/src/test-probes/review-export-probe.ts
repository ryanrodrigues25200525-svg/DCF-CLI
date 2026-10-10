/** Test probe: review-export matrix (write / refuse-overwrite / missing ticker) as JSON.
 *  Run under tsx (which resolves node:sqlite); orchestrated by vitest. */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { ModelLibrary, companyDir, currentWorkbookPath, sha256Hex } from '@/library/store';
import { writeManifestAtomic, type ModelManifest } from '@/library/manifest';
import { exportModelReview } from '@/review/review-export';

const root = await mkdtemp(join(tmpdir(), 'dcf-review-export-'));
const lib = new ModelLibrary(root);
const out: Record<string, unknown> = {};
try {
  const bytes = new TextEncoder().encode('workbook v1');
  lib.upsertCompany({
    ticker: 'TST', route: 'unlevered_dcf', currency: 'USD', unit_scale: null,
    accession: null, filed_date: null, workbook_hash: sha256Hex(bytes), built_at: null,
    readiness: null, workbook_path: currentWorkbookPath(root, 'TST'), revision_id: 'rev_1',
  });
  await mkdir(companyDir(root, 'TST'), { recursive: true });
  await writeFile(currentWorkbookPath(root, 'TST'), bytes);
  const manifest: ModelManifest = {
    ticker: 'TST', route: 'unlevered_dcf', currency: 'USD', unitScale: null,
    accession: null, filedDate: null, workbookHash: sha256Hex(bytes), builtAt: null,
    readiness: null, revisionId: 'rev_1', workbookFile: 'current.xlsx', libraryVersion: 1,
  };
  await writeManifestAtomic(root, manifest);
  const first = await exportModelReview({ lib, root, ticker: 'TST' });
  out.path = first.path;
  out.content = await readFile(first.path, 'utf8');
  try {
    await exportModelReview({ lib, root, ticker: 'TST' });
    out.overwriteError = null;
  } catch (error) {
    out.overwriteError = (error as Error).message;
  }
  const forced = await exportModelReview({ lib, root, ticker: 'TST', force: true });
  out.forcedPath = forced.path;
  try {
    await exportModelReview({ lib, root, ticker: 'NOPE' });
    out.missingError = null;
  } catch (error) {
    out.missingError = (error as Error).message;
  }
  process.stdout.write(JSON.stringify({ ...out, root }));
} finally {
  lib.close();
}
