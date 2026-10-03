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
});
