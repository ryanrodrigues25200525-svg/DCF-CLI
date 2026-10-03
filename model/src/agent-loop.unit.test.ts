import { execFile as execFileCb } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFileCb);
const modelRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = join(modelRoot, 'node_modules', '.bin', 'tsx');

/** Run a test probe (real production services under tsx; temp dirs only). */
async function probe(name: string, args: string[]): Promise<{ status: number; json: unknown; stderr: string }> {
  try {
    const res = await execFileAsync(tsxBin, ['--tsconfig', 'tsconfig.json', join('src', 'test-probes', name), ...args], {
      cwd: modelRoot, timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
    });
    return { status: 0, json: JSON.parse(res.stdout.trim().split('\n').pop() as string), stderr: res.stderr };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    const out = String(err.stdout ?? '');
    let json: unknown = null;
    try { json = JSON.parse(out.trim().split('\n').pop() as string); } catch { /* no json */ }
    return { status: typeof err.code === 'number' ? err.code : 1, json, stderr: String(err.stderr ?? '') };
  }
}

describe('agent autonomy loop (real services, no network)', () => {
  it('inspects the staged candidate workbook for auto-review', async () => {
    const r = await probe('stage-inspect.ts', ['TST']);
    try {
      expect(r.status, r.stderr).toBe(0);
      const view = (r.json as { view: {
        id: string; inspection?: { sheets: string[]; formulaCount: number; cachedErrorCells: string[] } | null;
      } }).view;
      expect(view.inspection?.sheets).toContain('Model');
      expect(view.inspection?.formulaCount).toBeGreaterThan(0);
      expect(view.inspection?.cachedErrorCells).toEqual([]);
      const withWatch = (r.json as { viewWithWatch: {
        watchLatest?: { accession: string; updateReady: boolean } | null;
      } }).viewWithWatch;
      expect(withWatch.watchLatest?.accession).toBe('0000000000-26-000099');
      expect(withWatch.watchLatest?.updateReady).toBe(true);
    } finally {
      const root = (r.json as { root?: string })?.root;
      if (root) await rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it('runs the review hook bounded with env propagation and output cap', async () => {
    const ok = await probe('hook-run.ts', ['--cmd', '/usr/bin/true']);
    expect(ok.status, ok.stderr).toBe(0);
    expect((ok.json as { exitCode: number }).exitCode).toBe(0);
    expect((ok.json as { timedOut: boolean }).timedOut).toBe(false);

    const failing = await probe('hook-run.ts', ['--cmd', '/usr/bin/false']);
    expect(failing.status, failing.stderr).toBe(0);
    expect((failing.json as { exitCode: number }).exitCode).toBe(1);

    const envProbe = await probe('hook-run.ts', ['--cmd', '/usr/bin/env', '--env', 'DCF_TICKER=ZZZ', '--env', 'DCF_CANDIDATE_ID=c1']);
    expect(envProbe.status, envProbe.stderr).toBe(0);
    expect((envProbe.json as { output: string }).output).toContain('DCF_TICKER=ZZZ');
    expect((envProbe.json as { output: string }).output).toContain('DCF_CANDIDATE_ID=c1');

    const hung = await probe('hook-run.ts', ['--cmd', 'exec /bin/sleep 20', '--timeout', '500']);
    expect(hung.status, hung.stderr).toBe(0);
    expect((hung.json as { timedOut: boolean }).timedOut).toBe(true);
    expect((hung.json as { elapsedMs: number }).elapsedMs).toBeLessThan(10000);

    const loud = await probe('hook-run.ts', ['--cmd', `/usr/bin/python3 -c "print('x' * 100000)"`]);
    expect(loud.status, loud.stderr).toBe(0);
    expect(((loud.json as { output: string }).output ?? '').length).toBeLessThanOrEqual(8192);
  }, 180_000);

  it('verifies revision archives and never migrates on legacy reads', async () => {
    const r = await probe('compare-legacy.ts', []);
    expect(r.status, r.stderr).toBe(0);
    const m = r.json as {
      tamperedArchive: { ok: boolean; message: string };
      missingArchive: { ok: boolean; message: string };
      legacyTablesAfter: string[];
      legacyPending: null | string;
      legacyPendingError: string | null;
    };
    expect(m['tamperedArchive']?.ok).toBe(false);
    expect(m['tamperedArchive']?.message ?? '').toMatch(/does not match its recorded hash/);
    expect(m['missingArchive']?.ok).toBe(false);
    expect(m['missingArchive']?.message ?? '').toMatch(/missing/);
    expect(m['legacyPending']).toBeNull();
    expect(m['legacyPendingError']).toBeNull();
    expect(m['legacyTablesAfter'] ?? []).not.toContain('candidates');
  }, 180_000);

  it('diffs two workbooks: sheets, formulas, values, identical', async () => {
    const r = await probe('compare-pair.ts', []);
    expect(r.status, r.stderr).toBe(0);
    const { diff, identicalTotal } = r.json as { identicalTotal: number; diff: {
      addedSheets: string[]; removedSheets: string[];
      totalChanges: number; truncated: boolean;
      changes: Array<{ sheet: string; cell: string; kind: string; before: string | null; after: string | null }>;
    } };
    expect(diff.addedSheets).toContain('Fresh');
    expect(diff.removedSheets).toContain('Gone');
    expect(diff.changes).toContainEqual({ sheet: 'Model', cell: 'A2', kind: 'formula', before: '=A1+1', after: '=A1+2' });
    expect(diff.changes).toContainEqual({ sheet: 'Model', cell: 'A1', kind: 'value', before: '1', after: '2' });
    expect(diff.changes).toContainEqual({ sheet: 'Model', cell: 'C1', kind: 'added', before: null, after: 'new' });
    expect(diff.changes.some((c) => c.sheet === 'Model' && c.cell === 'B1')).toBe(false);
    expect(diff.truncated).toBe(false);
    expect(identicalTotal).toBe(0);
  }, 180_000);

  it('requires a reviewed preview before proposal promotion', async () => {
    const r = await probe('proposal-preview-matrix.ts', []);
    expect(r.status, r.stderr).toBe(0);
    const m = r.json as Record<string, { ok: boolean; message?: string; hash?: string | null }>;
    expect(m['applyWithoutPreview']?.ok).toBe(false);
    expect(m['applyWithoutPreview']?.message ?? '').toMatch(/preview/i);
    expect(m['preview']?.ok).toBe(true);
    expect(m['preview']?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(m['applyAfterPreview']?.ok).toBe(true);
    expect(m['reapply']?.ok).toBe(false);
    expect(m['staleApply']?.ok).toBe(false);
    expect(m['staleApply']?.message ?? '').toMatch(/stale/i);
    expect(m['manualApply']?.ok).toBe(false);
    expect(m['manualApply']?.message ?? '').toMatch(/MANUAL_EDIT_DETECTED/);
  }, 180_000);

  it('reports specific MCP codes for proposal preview and apply failures', async () => {
    const setup = await probe('proposal-mcp-matrix.ts', []);
    expect(setup.status, setup.stderr).toBe(0);
    const ids = setup.json as { root: string; unpreviewed: string; stale: string; manual: string };
    const env = ['--env', `DCF_MODELS_DIR=${ids.root}`];
    const call = async (tool: string, argsJson: string): Promise<{ code?: string; message?: string }> => {
      const r = await probe('mcp-call.ts', ['--tool', tool, '--args', argsJson, ...env]);
      expect(r.status, r.stderr).toBe(0);
      const raw = r.json as { content?: Array<{ text?: string }>; code?: string; message?: string };
      const text = raw?.content?.[0]?.text;
      if (typeof text === 'string') {
        try {
          return JSON.parse(text) as { code?: string; message?: string };
        } catch {
          // Fall through to the raw body.
        }
      }
      return raw;
    };
    try {
      const noPreview = await call('proposal_apply', JSON.stringify({ proposalId: ids.unpreviewed, approval: true }));
      expect(noPreview.code).toBe('PREVIEW_REQUIRED');
      const stale = await call('proposal_apply', JSON.stringify({ proposalId: ids.stale, approval: true }));
      expect(stale.code).toBe('STALE_BASE');
      const manual = await call('proposal_apply', JSON.stringify({ proposalId: ids.manual, approval: true }));
      expect(manual.code).toBe('MANUAL_EDIT_DETECTED');
      const noApproval = await call('proposal_apply', JSON.stringify({ proposalId: ids.unpreviewed, approval: false }));
      expect(noApproval.code).toBe('APPROVAL_REQUIRED');
      const previewed = await call('proposal_preview', JSON.stringify({ proposalId: ids.unpreviewed }));
      expect((previewed as unknown as { status?: string }).status ?? (previewed as unknown as { finalHash?: string }).finalHash).toBeTruthy();
      const applied = await call('proposal_apply', JSON.stringify({ proposalId: ids.unpreviewed, approval: true, approvedBy: 'probe' }));
      expect((applied as unknown as { code?: string }).code ?? (applied as unknown as { status?: string }).status).toBe('applied');
    } finally {
      await rm(ids.root, { recursive: true, force: true });
    }
  }, 180_000);

  it('rejects =-prefixed proposedValue over MCP and in cell-edit conversion', async () => {
    const mcp = await probe('mcp-call.ts', ['--tool', 'proposal_create', '--args', JSON.stringify({
      ticker: 'TST',
      summary: 'sneaky formula',
      changes: [{ sheet: 'Model', cell: 'A1', proposedValue: '=SUM(A2:A3)', rationale: 'r', source: 'SEC x', accession: '0000320193-26-000001' }],
    })]);
    expect(mcp.status, mcp.stderr).toBe(0);
    // The probe prints the tool result or the JSON-RPC error body verbatim.
    const body = mcp.json as { code?: string; message?: string };
    expect(body.code).toBe('INVALID_PROPOSAL');
    expect(body.message ?? '').toMatch(/proposedFormula/);

    const conv = await probe('to-cell-edit.ts', []);
    expect(conv.status, conv.stderr).toBe(0);
    expect((conv.json as { rejected: boolean }).rejected).toBe(true);
  }, 180_000);
});
