/** Test probe: proposal preview/apply matrix on a synthetic temp library. */
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ModelLibrary } from '@/library/store';
import {
  applyApprovedProposal,
  previewProposal,
} from '@/review/apply-service';

const out: Record<string, unknown> = {};
const root = await mkdtemp(join(tmpdir(), 'dcf-prev-'));
const lib = new ModelLibrary(root);

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function makeCompany(ticker: string, corrupt: boolean): Promise<{ hash: string }> {
  const python = '/Users/ryanrodrigues/Documents/DCF CLI/backend/.venv/bin/python';
  const wbPath = join(root, 'w.xlsx');
  const mk = spawnSync(python, ['-c',
    `import openpyxl, sys
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Model"
ws["A1"] = 1; ws["A2"] = "=A1+1"
wb.save(sys.argv[1])`, wbPath], { encoding: 'utf8' });
  if (mk.status !== 0) throw new Error('mk failed');
  const { readFile: rf, mkdir, copyFile } = await import('node:fs/promises');
  const { companyDir, currentWorkbookPath } = await import('@/library/store');
  const bytes = await rf(wbPath);
  const dir = companyDir(root, ticker);
  await mkdir(dir, { recursive: true });
  const target = currentWorkbookPath(root, ticker);
  await copyFile(wbPath, target);
  let hash = sha(bytes);
  if (corrupt) {
    await writeFile(target, Buffer.from('corrupted'));
    hash = sha(bytes); // manifest keeps the ORIGINAL hash -> mismatch
  }
  const manifest = {
    ticker, route: 'test', currency: 'USD', unitScale: 'millions',
    accession: '0000000000-26-000001', filedDate: '2026-01-01',
    workbookHash: hash, builtAt: new Date().toISOString(), readiness: 'ready',
    revisionId: null as string | null, workbookFile: 'current.xlsx', libraryVersion: 1,
  };
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
  lib.upsertCompany({
    ticker, route: 'test', currency: 'USD', unit_scale: 'millions',
    accession: '0000000000-26-000001', filed_date: '2026-01-01',
    workbook_hash: hash, built_at: manifest.builtAt, readiness: 'ready',
    workbook_path: target, revision_id: null,
  });
  // Faithful accepted state: every real manifest carries its revision id.
  const base = lib.addRevision({ ticker, workbook_hash: hash, parent_hash: null, note: 'probe base' });
  manifest.revisionId = base.id;
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
  lib.upsertCompany({ ticker, revision_id: base.id } as Parameters<typeof lib.upsertCompany>[0]);
  return { hash };
}

function makeProposal(ticker: string, base: string): string {
  const rec = lib.createProposal({
    ticker,
    base_revision_hash: base,
    payload: {
      summary: 'probe proposal',
      changes: [{
        sheet: 'Model', cell: 'A1', proposedValue: 2,
        priorValue: 1, priorFormula: null,
        rationale: 'probe', source: 'SEC x', accession: '0000000000-26-000001',
      }],
      createdAt: new Date().toISOString(),
    },
    status: 'proposed',
  });
  return rec.id;
}

async function attempt(fn: () => Promise<unknown>): Promise<{ ok: boolean; message: string }> {
  try {
    await fn();
    return { ok: true, message: '' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

try {
  // OK ticker: apply without preview must demand preview; preview then apply works.
  const ok = await makeCompany('OKT', false);
  const p1 = makeProposal('OKT', ok.hash);
  const noPreview = await attempt(() => applyApprovedProposal(root, p1, 'probe'));
  out['applyWithoutPreview'] = noPreview;
  const previewed = await previewProposal(root, p1);
  out['preview'] = { ok: true, hash: previewed.changesHash ?? null };
  const applied = await attempt(() => applyApprovedProposal(root, p1, 'probe'));
  out['applyAfterPreview'] = applied;
  const reapply = await attempt(() => applyApprovedProposal(root, p1, 'probe'));
  out['reapply'] = reapply;

  // STALE ticker: base does not match accepted.
  await makeCompany('STT', false);
  const ps = makeProposal('STT', 'deadbeef'.repeat(8));
  out['staleApply'] = await attempt(() => applyApprovedProposal(root, ps, 'probe'));

  // MANUAL ticker: corrupted workbook.
  await makeCompany('MNT', true);
  const mrow = lib.getCompany('MNT');
  const pm = makeProposal('MNT', mrow?.workbook_hash ?? 'x');
  out['manualApply'] = await attempt(() => applyApprovedProposal(root, pm, 'probe'));
} finally {
  lib.close();
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(JSON.stringify(out));
