import { execFile as execFileCb } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFileCb);
const modelRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsxBin = join(modelRoot, 'node_modules', '.bin', 'tsx');

describe('review export (#51)', () => {
  it('writes the review report to markdown; refuses silent overwrite; missing ticker fails closed', async () => {
    const res = await execFileAsync(tsxBin, ['--tsconfig', 'tsconfig.json', join('src', 'test-probes', 'review-export-probe.ts')], {
      cwd: modelRoot, timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
    });
    const out = JSON.parse(res.stdout.trim().split('\n').pop() as string) as Record<string, any>;
    try {
      expect(String(out.path)).toMatch(/companies\/TST\/review-\d{4}-\d{2}-\d{2}\.md$/);
      expect(String(out.content)).toContain('# Model review report');
      expect(String(out.content)).toContain('Reviewer checklist');
      expect(String(out.content)).toContain('Hash check: on-disk workbook matches the manifest.');
      expect(String(out.overwriteError)).toMatch(/already exists.*--force/i);
      expect(out.forcedPath).toBe(out.path);
      expect(String(out.missingError)).toMatch(/no model found/i);
    } finally {
      await rm(out.root, { recursive: true, force: true });
    }
  }, 180_000);
});
