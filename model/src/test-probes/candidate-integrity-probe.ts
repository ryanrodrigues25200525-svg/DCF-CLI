import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelLibrary } from '@/library/store';
import { findBackendPython } from '@/workbook/xlsx';
import { acceptCandidate, recordCandidateVerification, stageBuildCandidate } from '@/review/build-candidate';

const root = await mkdtemp(join(tmpdir(), 'dcf-integrity-'));
const lib = new ModelLibrary(root);
try {
  const python = findBackendPython();
  if (!python) throw new Error('openpyxl is required');
  const workbook = join(root, 'engine.xlsx');
  execFileSync(python, ['-c', 'import openpyxl,sys; w=openpyxl.Workbook(); w.active["A1"]="=1+2"; w.save(sys.argv[1])', workbook]);
  const candidate = await stageBuildCandidate({
    lib, root, ticker: 'TST', engineBytes: await readFile(workbook),
    meta: { route: 'unlevered_dcf', currency: 'USD', unitScale: 'millions', readiness: 'review_required', accession: null, filedDate: null },
    snapshotJsonText: '{}', note: 'integrity test',
  });
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workbook_read_cells', arguments: { ticker: 'TST', target: 'candidate', refs: [{ sheet: 'Sheet', cell: 'A1' }] } } };
  const response = JSON.parse(execFileSync(join(process.cwd(), 'node_modules', '.bin', 'tsx'), ['--tsconfig', 'tsconfig.json', 'src/mcp/server.ts'], {
    cwd: process.cwd(), env: { ...process.env, DCF_MODELS_DIR: root }, input: `${JSON.stringify(request)}\n`, encoding: 'utf8',
  }).trim());
  const mcpResult = response.result ? JSON.parse(response.result.content[0].text) : response.error;
  await recordCandidateVerification(lib, root, candidate.candidateId, 'The projected balance sheet is materially out of balance.', 'reviewer');
  let error: string | null = null;
  try { await acceptCandidate(lib, root, candidate.candidateId, 'approver'); }
  catch (e) { error = e instanceof Error ? e.message : String(e); }
  console.log(JSON.stringify({ error, company: lib.getCompany('TST'), mcpResult }));
} finally {
  lib.close();
  await rm(root, { recursive: true, force: true });
}
