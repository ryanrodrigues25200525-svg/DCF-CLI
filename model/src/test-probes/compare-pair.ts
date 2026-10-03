/** Test probe: build two synthetic workbooks with known differences and diff them. */
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareWorkbooks } from '@/review/revision-compare';
import { findBackendPython } from '@/workbook/xlsx';

const root = await mkdtemp(join(tmpdir(), 'dcf-cmp-'));
const python = findBackendPython();
if (!python) throw new Error('no python with openpyxl');
function writeBook(name: string, script: string): string {
  const p = join(root, name);
  const r = spawnSync(python as string, ['-c', script, p], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('mk failed: ' + r.stderr);
  return p;
}
const before = writeBook('before.xlsx', `import openpyxl, sys
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Model"
ws["A1"] = 1; ws["A2"] = "=A1+1"; ws["B1"] = "keep"
gone = wb.create_sheet("Gone"); gone["A1"] = 9
wb.save(sys.argv[1])`);
const after = writeBook('after.xlsx', `import openpyxl, sys
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Model"
ws["A1"] = 2; ws["A2"] = "=A1+2"; ws["B1"] = "keep"; ws["C1"] = "new"
fresh = wb.create_sheet("Fresh"); fresh["A1"] = 1
wb.save(sys.argv[1])`);
const same = writeBook('same.xlsx', `import openpyxl, sys
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Model"
ws["A1"] = 1; ws["A2"] = "=A1+1"; ws["B1"] = "keep"
gone = wb.create_sheet("Gone"); gone["A1"] = 9
wb.save(sys.argv[1])`);
const diff = await compareWorkbooks(python, before, after);
const identical = await compareWorkbooks(python, before, same);
process.stdout.write(JSON.stringify({ diff, identicalTotal: identical.totalChanges }));
