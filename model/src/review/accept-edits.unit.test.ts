import { execFile as execFileCb } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFileCb);
const modelRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsxBin = join(modelRoot, 'node_modules', '.bin', 'tsx');

async function probe(name: string, args: string[]) {
  const res = await execFileAsync(tsxBin, ['--tsconfig', 'tsconfig.json', join('src', 'test-probes', name), ...args], {
    cwd: modelRoot, timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(res.stdout.trim().split('\n').pop() as string) as Record<string, any>;
}

describe('accept manual edits (#51)', () => {
  it('accepts a diverged current.xlsx as a child revision; clean and unknown fail closed', async () => {
    const out = await probe('accept-edits-probe.ts', []);
    try {
      expect(out.accepted.newHash).not.toBe(out.accepted.previousHash);
      expect(out.accepted.note).toBe('analyst forecast tweaks');
      expect(out.accepted.revisionChain.some(
        (r: any) => r.id === out.accepted.revisionId && r.parent_hash === out.accepted.previousHash,
      )).toBe(true);
      expect(out.accepted.companyHash).toBe(out.accepted.newHash);
      expect(String(out.cleanError)).toMatch(/no manual edits/i);
      expect(String(out.missingError)).toMatch(/no .* library|unknown/i);
    } finally {
      await rm(out.root, { recursive: true, force: true });
      if (out.cleanRoot) await rm(out.cleanRoot, { recursive: true, force: true });
    }
  }, 180_000);
});
