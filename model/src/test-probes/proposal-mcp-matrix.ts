/** Test probe: stage a temp library with stale/manual/unpreviewed proposals.
 *  Prints paths and KEEPS the directory; the caller cleans up. */
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { ModelLibrary, companyDir, currentWorkbookPath } from '@/library/store';

const root = await mkdtemp(join(tmpdir(), 'dcf-mcpmx-'));
const lib = new ModelLibrary(root);
const out: Record<string, string> = {};
try {
  const python = '/Users/ryanrodrigues/Documents/DCF CLI/backend/.venv/bin/python';
  async function workbook(ticker: string, corrupt: boolean): Promise<string> {
    const wbPath = join(root, `${ticker}.xlsx`);
    const mk = spawnSync(python, ['-c',
      `import openpyxl, sys
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Model"
ws["A1"] = 1; ws["A2"] = "=A1+1"
wb.save(sys.argv[1])`, wbPath], { encoding: 'utf8' });
    if (mk.status !== 0) throw new Error('mk failed');
    const bytes = await readFile(wbPath);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const dir = companyDir(root, ticker);
    await mkdir(dir, { recursive: true });
    const target = currentWorkbookPath(root, ticker);
    await copyFile(wbPath, target);
    if (corrupt) await writeFile(target, Buffer.from('corrupted'));
    const builtAt = new Date().toISOString();
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({
      ticker, route: 'test', currency: 'USD', unitScale: 'millions',
      accession: '0000000000-26-000001', filedDate: '2026-01-01',
      workbookHash: hash, builtAt, readiness: 'ready',
      revisionId: null, workbookFile: 'current.xlsx', libraryVersion: 1,
    }));
    lib.upsertCompany({
      ticker, route: 'test', currency: 'USD', unit_scale: 'millions',
      accession: '0000000000-26-000001', filed_date: '2026-01-01',
      workbook_hash: hash, built_at: builtAt, readiness: 'ready',
      workbook_path: target, revision_id: null,
    });
    // verifyManifest demands a revision id: add a base revision row.
    const base = lib.addRevision({ ticker, workbook_hash: hash, parent_hash: null, note: 'probe base' });
    const dirManifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    dirManifest['revisionId'] = base.id;
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(dirManifest));
    lib.upsertCompany({ ticker, revision_id: base.id } as Parameters<typeof lib.upsertCompany>[0]);
    return hash;
  }
  function propose(ticker: string, base: string): string {
    return lib.createProposal({
      ticker,
      base_revision_hash: base,
      payload: {
        summary: 'probe',
        changes: [{
          sheet: 'Model', cell: 'A1', proposedValue: 2, priorValue: 1, priorFormula: null,
          rationale: 'probe', source: 'SEC x', accession: '0000000000-26-000001',
        }],
        createdAt: new Date().toISOString(),
      },
      status: 'proposed',
    }).id;
  }
  const okHash = await workbook('OKT', false);
  out['unpreviewed'] = propose('OKT', okHash);
  await workbook('STT', false);
  out['stale'] = propose('STT', 'deadbeef'.repeat(8));
  const manHash = await workbook('MNT', true);
  out['manual'] = propose('MNT', manHash);
  out['root'] = root;
  process.stdout.write(JSON.stringify(out));
} finally {
  lib.close();
}
