import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('does not accept a verified candidate with a material integrity warning', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const output = execFileSync(join(root, 'node_modules', '.bin', 'tsx'),
    ['--tsconfig', 'tsconfig.json', 'src/test-probes/candidate-integrity-probe.ts'],
    { cwd: root, encoding: 'utf8', timeout: 180_000 });
  const result = JSON.parse(output.trim().split('\n').pop()!);
  expect(result.error).toContain('material model integrity warning');
  expect(result.mcpResult.cells[0].formula).toBe('=1+2');
  expect(result.company).toBeNull();
}, 180_000);
