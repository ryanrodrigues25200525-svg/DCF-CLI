/** Test probe: accept-edits matrix (diverged / clean / unknown ticker) as JSON.
 *  Run under tsx (which resolves node:sqlite); orchestrated by vitest. */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelLibrary, companyDir, currentWorkbookPath, sha256Hex } from '@/library/store';
import { writeManifestAtomic, type ModelManifest } from '@/library/manifest';
import { acceptManualEdits } from '@/review/accept-edits';
import { mkdir } from 'node:fs/promises';

async function stage(root: string, bytes: Uint8Array, hash: string | null): Promise<ModelLibrary> {
  const lib = new ModelLibrary(root);
  lib.upsertCompany({
    ticker: 'TST',
    route: null,
    currency: 'USD',
    unit_scale: null,
    accession: null,
    filed_date: null,
    workbook_hash: hash,
    built_at: null,
    readiness: null,
    workbook_path: currentWorkbookPath(root, 'TST'),
    revision_id: 'rev_1',
  });
  await mkdir(companyDir(root, 'TST'), { recursive: true });
  await writeFile(currentWorkbookPath(root, 'TST'), bytes);
  const manifest: ModelManifest = {
    ticker: 'TST',
    route: null,
    currency: 'USD',
    unitScale: null,
    accession: null,
    filedDate: null,
    workbookHash: hash,
    builtAt: null,
    readiness: null,
    revisionId: 'rev_1',
    workbookFile: 'current.xlsx',
    libraryVersion: 1,
  };
  await writeManifestAtomic(root, manifest);
  return lib;
}

const root = await mkdtemp(join(tmpdir(), 'dcf-accept-probe-'));
const v1 = new TextEncoder().encode('workbook v1');
const lib = await stage(root, v1, sha256Hex(v1));
const out: Record<string, unknown> = { root };
try {
  const v2 = new TextEncoder().encode('workbook v2 analyst tweaks');
  await writeFile(currentWorkbookPath(root, 'TST'), v2);
  const accepted = await acceptManualEdits({ lib, root, ticker: 'TST', note: 'analyst forecast tweaks' });
  out.accepted = {
    ...accepted,
    revisionChain: lib.listRevisions('TST').map((r) => ({ id: r.id, parent_hash: r.parent_hash })),
    companyHash: lib.getCompany('TST')?.workbook_hash,
  };
  const cleanRoot = await mkdtemp(join(tmpdir(), 'dcf-accept-clean-'));
  const cleanLib = await stage(cleanRoot, v1, sha256Hex(v1));
  try {
    await acceptManualEdits({ lib: cleanLib, root: cleanRoot, ticker: 'TST' });
    out.cleanError = null;
  } catch (error) {
    out.cleanError = (error as Error).message;
  } finally {
    out.cleanRoot = cleanRoot;
    cleanLib.close();
  }
  try {
    await acceptManualEdits({ lib, root, ticker: 'NOPE' });
    out.missingError = null;
  } catch (error) {
    out.missingError = (error as Error).message;
  }
  process.stdout.write(JSON.stringify(out));
} finally {
  lib.close();
}
