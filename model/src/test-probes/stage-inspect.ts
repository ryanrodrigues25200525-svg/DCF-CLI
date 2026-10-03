/** Test probe: stage a synthetic candidate and print its pending view as JSON.
 *  Run under tsx (which resolves node:sqlite); orchestrated by vitest. */
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelLibrary } from '@/library/store';
import { findBackendPython } from '@/workbook/xlsx';
import { getPendingCandidateView, stageBuildCandidate } from '@/review/build-candidate';

const ticker = process.argv[2] ?? 'TST';
const root = await mkdtemp(join(tmpdir(), 'dcf-probe-'));
const lib = new ModelLibrary(root);
try {
  const python = findBackendPython();
  if (!python) throw new Error('no python with openpyxl');
  const engPath = join(root, 'engine.xlsx');
  const mk = spawnSync(python, ['-c',
    `import openpyxl, sys
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Model"
ws["A1"] = 2; ws["A2"] = 3; ws["A3"] = "=A1+A2"
wb.save(sys.argv[1])`, engPath], { encoding: 'utf8' });
  if (mk.status !== 0) throw new Error('synthetic workbook failed');
  const staged = await stageBuildCandidate({
    lib, root, ticker, engineBytes: await readFile(engPath),
    meta: { route: 'test', currency: 'USD', unitScale: 'millions', readiness: 'ready', accession: '0000000000-26-000001', filedDate: '2026-01-01' },
    snapshotJsonText: '{"fiscal_year": 2025}',
    note: 'probe',
  });
  const view = await getPendingCandidateView(lib, root, ticker);
  lib.setWatch(ticker, { last_check: new Date().toISOString(), latest_accession: '0000000000-26-000099', update_ready: true, last_error: null });
  const viewWithWatch = await getPendingCandidateView(lib, root, ticker);
  process.stdout.write(JSON.stringify({ root, candidateId: staged.candidateId, view, viewWithWatch }));
} finally {
  lib.close();
}
