import { execFile as execFileCb, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFileCb);
const modelRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = join(modelRoot, 'node_modules', '.bin', 'tsx');
const cliEntry = join(modelRoot, 'src', 'cli.ts');
const mcpEntry = join(modelRoot, 'src', 'mcp', 'server.ts');

if (!process.env.EDGAR_IDENTITY?.trim()) {
  throw new Error('Set EDGAR_IDENTITY before running the live candidate checks. Its value is never logged.');
}

interface RunResult { stdout: string; stderr: string; exitCode: number }

async function cli(modelsDir: string, args: string[]): Promise<RunResult> {
  try {
    const res = await execFileAsync(tsxBin, ['--tsconfig', 'tsconfig.json', cliEntry, ...args, '--models-dir', modelsDir], {
      cwd: modelRoot,
      timeout: 590_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout: res.stdout, stderr: res.stderr, exitCode: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return { stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? ''), exitCode: typeof err.code === 'number' ? err.code : 1 };
  }
}

function candidateIdFromBuild(stdout: string): string {
  const m = stdout.match(/Staged build candidate (\S+) for/);
  if (!m) throw new Error(`No staged candidate id in build output:\n${stdout.slice(0, 2000)}`);
  return m[1] as string;
}

function routeOf(stdout: string): string {
  return stdout.match(/route=(\S+)/)?.[1] ?? 'unknown';
}

function readinessOf(stdout: string): string {
  return stdout.match(/readiness=(\S+)/)?.[1] ?? 'unknown';
}

function accessionOf(stdout: string): string | null {
  return stdout.match(/accession (\d{10}-\d{2}-\d{6})/)?.[1] ?? null;
}

describe('live build-candidate gate', () => {
  it('stages an AAPL initial build, verifies, accepts, then refreshes with parent linkage', async () => {
    const modelsDir = await mkdtemp(join(tmpdir(), 'dcf-cand-aapl-'));
    const export1 = join(modelsDir, 'aapl-1.xlsx');
    const export2 = join(modelsDir, 'aapl-2.xlsx');
    try {
      // Initial build stages a candidate and publishes nothing.
      const b1 = await cli(modelsDir, ['build', 'AAPL', '--output', export1]);
      expect(b1.exitCode, b1.stdout + b1.stderr).toBe(0);
      expect(b1.stdout).toMatch(/Staged build candidate \S+ for AAPL/);
      expect(b1.stdout).toMatch(/No accepted revision exists yet/);
      const cand1 = candidateIdFromBuild(b1.stdout);
      expect(existsSync(export1)).toBe(true);
      expect(existsSync(join(modelsDir, 'companies', 'AAPL', 'current.xlsx'))).toBe(false);
      const route = routeOf(b1.stdout);
      const readiness = readinessOf(b1.stdout);
      const accession = accessionOf(b1.stdout);
      expect(accession).not.toBeNull();

      // Accept without verification fails closed.
      const noVerify = await cli(modelsDir, ['model', 'accept', cand1, '--approve']);
      expect(noVerify.exitCode).toBe(1);
      expect(noVerify.stdout + noVerify.stderr).toMatch(/no recorded AI verification/i);

      // Record an honest agent review built from the actual staged facts.
      const verification =
        `Agent review of staged AAPL candidate ${cand1} from live SEC data. ` +
        `Freshness: source accession ${accession} captured at build time. ` +
        `Route/readiness: ${route}/${readiness} as reported by the deterministic engine. ` +
        `Formulas: the staging gate recalculated with LibreOffice and refused on any cached formula error, so the candidate carries zero cached errors. ` +
        `No prior accepted model exists; nothing was overwritten by staging. ` +
        `Summary: candidate is a faithful deterministic build of the mapped filing and is safe to promote.`;
      const v1 = await cli(modelsDir, ['model', 'candidate-verify', cand1, '--verification', verification, '--by', 'agent-cli-live-test']);
      expect(v1.exitCode, v1.stdout + v1.stderr).toBe(0);

      const a1 = await cli(modelsDir, ['model', 'accept', cand1, '--approve', '--by', 'agent-cli-live-test']);
      expect(a1.exitCode, a1.stdout + a1.stderr).toBe(0);
      expect(a1.stdout).toMatch(/new revision \S+/);
      expect(existsSync(join(modelsDir, 'companies', 'AAPL', 'current.xlsx'))).toBe(true);
      const firstHash = (a1.stdout.match(/\(([0-9a-f]{64})\)/)?.[1]) ?? null;
      expect(firstHash).not.toBeNull();

      // Refresh build stages against the accepted base, then promotes with linkage.
      const b2 = await cli(modelsDir, ['model', 'update', 'AAPL', '--output', export2]);
      expect(b2.exitCode, b2.stdout + b2.stderr).toBe(0);
      const cand2 = candidateIdFromBuild(b2.stdout);
      expect(cand2).not.toBe(cand1);
      expect(b2.stdout).toMatch(/accepted library copy is unchanged/i);
      const v2 = await cli(modelsDir, ['model', 'candidate-verify', cand2, '--verification', verification, '--by', 'agent-cli-live-test']);
      expect(v2.exitCode, v2.stdout + v2.stderr).toBe(0);
      const a2 = await cli(modelsDir, ['model', 'accept', cand2, '--approve', '--by', 'agent-cli-live-test']);
      expect(a2.exitCode, a2.stdout + a2.stderr).toBe(0);
      expect(a2.stdout).toMatch(/Prior revision preserved/);
      const inspect = await cli(modelsDir, ['model', 'inspect', 'AAPL', '--json']);
      expect(inspect.exitCode, inspect.stdout + inspect.stderr).toBe(0);
      const payload = JSON.parse(inspect.stdout) as { revisions: Array<{ id: string; hash: string; parent: string | null }> };
      expect(payload.revisions.length).toBeGreaterThanOrEqual(2);
      expect(payload.revisions.some((r) => r.parent === firstHash)).toBe(true);
    } finally {
      await rm(modelsDir, { recursive: true, force: true });
    }
  }, 590_000);

  it('stages an input-required DUK build and rejects it without publishing', async () => {
    const modelsDir = await mkdtemp(join(tmpdir(), 'dcf-cand-duk-'));
    const exportPath = join(modelsDir, 'duk.xlsx');
    try {
      const b = await cli(modelsDir, ['build', 'DUK', '--output', exportPath]);
      expect(b.exitCode, b.stdout + b.stderr).toBe(0);
      const cand = candidateIdFromBuild(b.stdout);
      expect(b.stdout).toMatch(/readiness=\S+/);
      const verification =
        `Agent review of staged DUK candidate ${cand} from live SEC data. ` +
        `Freshness: source accession ${(accessionOf(b.stdout) ?? 'unreported')} as captured at build time. ` +
        `Route/readiness: ${routeOf(b.stdout)}/${readinessOf(b.stdout)}; required regulatory inputs are missing, so the workbook withholds valuation and must stay visibly input-required. ` +
        `Formulas: staging recalculated clean with zero cached errors. ` +
        `Summary: do not invent value; rejecting this candidate to prove rejection leaves the library untouched.`;
      const v = await cli(modelsDir, ['model', 'candidate-verify', cand, '--verification', verification, '--by', 'agent-cli-live-test']);
      expect(v.exitCode, v.stdout + v.stderr).toBe(0);
      const r = await cli(modelsDir, ['model', 'candidate-reject', cand, '--reason', 'live-test rejection path']);
      expect(r.exitCode, r.stdout + r.stderr).toBe(0);
      expect(existsSync(join(modelsDir, 'companies', 'DUK', 'current.xlsx'))).toBe(false);
      const again = await cli(modelsDir, ['model', 'accept', cand, '--approve']);
      expect(again.exitCode).toBe(1);
    } finally {
      await rm(modelsDir, { recursive: true, force: true });
    }
  }, 590_000);

  it('stages an AAPL candidate through MCP model_build without publishing', async () => {
    const modelsDir = await mkdtemp(join(tmpdir(), 'dcf-cand-mcp-'));
    const home = await mkdtemp(join(tmpdir(), 'dcf-cand-mcp-home-'));
    const child = spawn(tsxBin, ['--tsconfig', 'tsconfig.json', mcpEntry], {
      cwd: modelRoot,
      env: { ...process.env, DCF_MODELS_DIR: modelsDir, HOME: home },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    try {
      const send = (msg: unknown): void => {
        if (!child.stdin) throw new Error('MCP server stdin is unavailable');
        void child.stdin.write(`${JSON.stringify(msg)}\n`);
      };
      const responses = new Map<string | number, unknown>();
      let buffer = '';
      const waitFor = (id: string | number, ms: number): Promise<unknown> =>
        new Promise((resolvePromise, rejectPromise) => {
          const deadline = setTimeout(() => rejectPromise(new Error(`timed out waiting for MCP response ${String(id)}`)), ms);
          const poll = (): void => {
            if (responses.has(id)) {
              clearTimeout(deadline);
              resolvePromise(responses.get(id));
              return;
            }
            setTimeout(poll, 250);
          };
          poll();
        });
      child.stdout.on('data', (data: Buffer) => {
        buffer += data.toString('utf8');
        let idx: number;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line) as { id?: string | number; result?: unknown; error?: unknown };
            if (msg.id !== undefined) responses.set(msg.id, msg.error ?? msg.result);
          } catch {
            // Non-JSON server chatter is ignored.
          }
        }
      });
      send({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: {} });
      await waitFor('init', 30_000);
      const unwrap = (msg: unknown): Record<string, unknown> => {
        const m = msg as { content?: Array<{ text?: string }> };
        const text = m?.content?.[0]?.text;
        if (typeof text === 'string') {
          try {
            return JSON.parse(text) as Record<string, unknown>;
          } catch {
            // Fall through to raw message.
          }
        }
        return (msg ?? {}) as Record<string, unknown>;
      };
      send({ jsonrpc: '2.0', id: 'build', method: 'tools/call', params: { name: 'model_build', arguments: { ticker: 'AAPL' } } });
      const built = unwrap(await waitFor('build', 540_000)) as { candidateId: string; status: string; hash: string };
      if ((built as { code?: string }).code) throw new Error(`model_build failed: ${JSON.stringify(built).slice(0, 500)}`);
      expect(built.status).toBe('staged');
      expect(typeof built.candidateId).toBe('string');
      expect(built.candidateId.length).toBeGreaterThan(0);
      // Staged means staged: accepted copy absent, candidate row present.
      expect(existsSync(join(modelsDir, 'companies', 'AAPL', 'current.xlsx'))).toBe(false);
      send({ jsonrpc: '2.0', id: 'inspect', method: 'tools/call', params: { name: 'candidate_inspect', arguments: { ticker: 'AAPL' } } });
      const inspected = unwrap(await waitFor('inspect', 60_000)) as {
        pendingCandidate: { id: string; payload: { verification: null } };
      };
      expect(inspected.pendingCandidate.id).toBe(built.candidateId);
      expect(inspected.pendingCandidate.payload.verification).toBeNull();
    } finally {
      child.kill('SIGKILL');
      await rm(modelsDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  }, 590_000);
});
