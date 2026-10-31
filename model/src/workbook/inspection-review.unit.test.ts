import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findBackendPython, inspectWorkbook } from './xlsx';

describe('workbook inspection', () => {
  it('returns review notes so an agent can identify material model warnings', async () => {
    const python = findBackendPython();
    if (!python) throw new Error('openpyxl is required');
    const dir = mkdtempSync(join(tmpdir(), 'dcf-review-test-'));
    try {
      const file = join(dir, 'model.xlsx');
      execFileSync(python, ['-c', `import openpyxl, sys
w = openpyxl.Workbook()
s = w.active
s.title = 'Data Review'
s.append(['Status', 'Area', 'Review note'])
s.append(['REVIEW', 'Model', 'Projected balance sheet check fails by 100'])
s.append(['INFO', 'Source', 'FY2025 filing'])
w.save(sys.argv[1])`, file]);
      const inspection = await inspectWorkbook(python, file);
      expect(inspection.reviewNotes).toContainEqual({ status: 'REVIEW', area: 'Model', note: 'Projected balance sheet check fails by 100' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
