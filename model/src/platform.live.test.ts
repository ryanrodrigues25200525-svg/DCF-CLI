import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, readlinkSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BackendApiClient } from '@/api/backend-client';
import { runValuationJob } from '@/application/run-valuation-job';
import { LocalBackendProcess } from '@/infrastructure/local-backend-process';
import { findBackendPython, findSoffice } from '@/workbook/xlsx';

const modelRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(modelRoot, '..');
const installScript = resolve(projectRoot, 'scripts/install_cli.sh');
const pathLine = 'export PATH="$HOME/.local/bin:$PATH"';
const pathSeparator = process.platform === 'win32' ? ';' : ':';
const windowsOnly = process.platform === 'win32';

function assertEdgarIdentityConfigured(): void {
  if (!process.env.EDGAR_IDENTITY?.trim()) {
    throw new Error('Set EDGAR_IDENTITY before running the live DCF checks. Its value is never logged.');
  }
}

/** A tiny stand-in soffice that accepts `--headless --version` and exits cleanly. */
async function writeFakeSoffice(directory: string): Promise<string> {
  const candidate = join(directory, windowsOnly ? 'soffice.exe' : 'soffice');
  await writeFile(candidate, '#!/bin/sh\nexit 0\n');
  await chmod(candidate, 0o755);
  return candidate;
}

function readCoverIndustry(python: string, workbookPath: string): string | null {
  const script = [
    'import json, sys, openpyxl',
    'wb = openpyxl.load_workbook(sys.argv[1], data_only=False)',
    'value = wb["Cover"]["C10"].value',
    'wb.close()',
    'print(json.dumps(value))',
  ].join('\n');
  const probe = spawnSync(python, ['-c', script, workbookPath], { encoding: 'utf8', timeout: 60_000 });
  if (probe.status !== 0) {
    throw new Error(`Cover inspection failed: ${probe.stderr || probe.error?.message || `exit ${probe.status}`}`);
  }
  const line = probe.stdout.trim().split('\n').pop() ?? '';
  const parsed: unknown = JSON.parse(line);
  return typeof parsed === 'string' ? parsed : null;
}

describe('live host platform integration', () => {
  it('discovers host Python that can import openpyxl', () => {
    const python = findBackendPython();
    if (!python) {
      throw new Error('Live platform tests require a Python interpreter with openpyxl. Run `npm run install:all`.');
    }
    const probe = spawnSync(python, ['-c', 'import openpyxl; print(openpyxl.__version__)'], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(probe.status, probe.stderr || probe.error?.message).toBe(0);
    expect(probe.stdout.trim()).toMatch(/^\d+\.\d+/);
  });

  it('discovers a working host LibreOffice binary', () => {
    const soffice = findSoffice();
    if (!soffice) {
      throw new Error('Live platform tests require LibreOffice. Install it or set SOFFICE_PATH to the executable.');
    }
    const probe = spawnSync(soffice, ['--headless', '--version'], { encoding: 'utf8', timeout: 60_000 });
    expect(probe.status, probe.stderr || probe.error?.message).toBe(0);
    expect(`${probe.stdout}${probe.stderr}`).toMatch(/LibreOffice/i);
  });

  it('finds soffice on PATH without shelling out to which', async () => {
    if (windowsOnly) return; // Windows PATH/PATHEXT branch is not executable on this host.
    const directory = await mkdtemp(join(tmpdir(), 'dcf-soffice-path-'));
    const originalPath = process.env.PATH;
    const originalSofficePath = process.env.SOFFICE_PATH;
    try {
      const fake = await writeFakeSoffice(directory);
      delete process.env.SOFFICE_PATH;
      // PATH contains only this directory: `which` is unavailable and no LibreOffice
      // install directory is present, so discovery must scan PATH itself.
      process.env.PATH = directory;
      expect(findSoffice()).toBe(fake);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      if (originalSofficePath === undefined) delete process.env.SOFFICE_PATH;
      else process.env.SOFFICE_PATH = originalSofficePath;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps an explicit SOFFICE_PATH ahead of PATH candidates', async () => {
    if (windowsOnly) return;
    const explicitDir = await mkdtemp(join(tmpdir(), 'dcf-soffice-explicit-'));
    const pathDir = await mkdtemp(join(tmpdir(), 'dcf-soffice-onpath-'));
    const originalPath = process.env.PATH;
    const originalSofficePath = process.env.SOFFICE_PATH;
    try {
      const explicit = await writeFakeSoffice(explicitDir);
      const onPath = await writeFakeSoffice(pathDir);
      process.env.SOFFICE_PATH = explicit;
      process.env.PATH = `${pathDir}${pathSeparator}${originalPath ?? ''}`;
      expect(onPath).not.toBe(explicit);
      expect(findSoffice()).toBe(explicit);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      if (originalSofficePath === undefined) delete process.env.SOFFICE_PATH;
      else process.env.SOFFICE_PATH = originalSofficePath;
      await rm(explicitDir, { recursive: true, force: true });
      await rm(pathDir, { recursive: true, force: true });
    }
  });

  it('installs CLI links and shell startup PATH with a temporary HOME, idempotently', async () => {
    if (windowsOnly) return; // install_cli.sh targets POSIX login shells.
    const home = await mkdtemp(join(tmpdir(), 'dcf-install-home-'));
    try {
      const shells = [
        { shell: '/bin/zsh', startup: ['.zprofile'] },
        { shell: '/bin/bash', startup: ['.bash_profile', '.bashrc'] },
        { shell: '/bin/sh', startup: ['.profile'] },
      ];
      for (const { shell, startup } of shells) {
        const env = { ...process.env, HOME: home, SHELL: shell };
        const first = spawnSync('bash', [installScript], { encoding: 'utf8', env });
        expect(first.status, first.stderr).toBe(0);
        const second = spawnSync('bash', [installScript], { encoding: 'utf8', env });
        expect(second.status, second.stderr).toBe(0);
        for (const file of startup) {
          const content = await readFile(join(home, file), 'utf8');
          expect(content.split('\n').filter((line) => line === pathLine), `${shell} ${file}`).toHaveLength(1);
        }
      }
      const dcfLink = join(home, '.local', 'bin', 'dcf');
      const dcfbuildLink = join(home, '.local', 'bin', 'dcfbuild');
      expect(lstatSync(dcfLink).isSymbolicLink()).toBe(true);
      expect(lstatSync(dcfbuildLink).isSymbolicLink()).toBe(true);
      expect(readlinkSync(dcfLink)).toBe(resolve(projectRoot, 'bin', 'dcf.mjs'));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('refuses to replace an unrelated file in the install directory', async () => {
    if (windowsOnly) return;
    const home = await mkdtemp(join(tmpdir(), 'dcf-install-conflict-'));
    try {
      const binDir = join(home, '.local', 'bin');
      mkdirSync(binDir, { recursive: true });
      const occupied = join(binDir, 'dcf');
      await writeFile(occupied, 'unrelated\n');
      const env = { ...process.env, HOME: home, SHELL: '/bin/zsh' };
      const result = spawnSync('bash', [installScript], { encoding: 'utf8', env });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Refusing to replace an existing file');
      expect(await readFile(occupied, 'utf8')).toBe('unrelated\n');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('writes an honest cover label when live industry and sector are both missing', async () => {
    assertEdgarIdentityConfigured();
    const python = findBackendPython();
    if (!python) {
      throw new Error('The live cover check requires a Python interpreter with openpyxl.');
    }
    const home = await mkdtemp(join(tmpdir(), 'dcf-cover-redaction-'));
    const backend = new LocalBackendProcess({
      backendDirectory: resolve(projectRoot, 'backend'),
      environment: {
        ...process.env,
        HOME: home,
        DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
      },
    });
    try {
      const client = new BackendApiClient(await backend.start());
      const result = await runValuationJob('AAPL', client);
      if (result.status !== 'ready') {
        throw new Error(`Live AAPL model did not reach ready status for the cover check (${result.status}).`);
      }

      const livePath = join(home, 'cover_live.xlsx');
      await writeFile(livePath, result.workbookBytes);
      const liveLabel = readCoverIndustry(python, livePath);
      expect(typeof liveLabel).toBe('string');
      expect((liveLabel ?? '').trim().length).toBeGreaterThan(0);

      const redacted = structuredClone(result.exportPayload);
      delete redacted.company.industry;
      delete redacted.company.sector;
      const redactedBytes = await client.exportDcf(redacted);
      const redactedPath = join(home, 'cover_redacted.xlsx');
      await writeFile(redactedPath, redactedBytes);
      const redactedLabel = readCoverIndustry(python, redactedPath);
      expect(redactedLabel).toBe('Not disclosed');
      expect(redactedLabel).not.toBe('Technology');
    } finally {
      await backend.stop();
      await rm(home, { recursive: true, force: true });
    }
  }, 300_000);
});
