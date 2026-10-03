/** Test probe: archive hash verification + legacy-DB read behavior. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ModelLibrary, revisionPath } from '@/library/store';
import { resolveCompareEndpoint } from '@/review/revision-compare';

const out: Record<string, unknown> = {};
async function attempt(fn: () => unknown): Promise<{ ok: boolean; message: string }> {
  try {
    await fn();
    return { ok: true, message: '' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// #12: tampered + missing archives fail closed.
{
  const root = await mkdtemp(join(tmpdir(), 'dcf-arch-'));
  const lib = new ModelLibrary(root);
  try {
    const rev = lib.addRevision({ ticker: 'TST', workbook_hash: 'a'.repeat(64), parent_hash: null, note: 'base' });
    const arch = revisionPath(root, 'TST', rev.id);
    const { mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(arch), { recursive: true });
    await writeFile(arch, Buffer.from('not-the-recorded-bytes'));
    const tampered = await attempt(() => resolveCompareEndpoint(lib, root, 'TST', rev.id, 'from'));
    out['tamperedArchive'] = tampered;
    await rm(arch, { force: true });
    const missing = await attempt(() => resolveCompareEndpoint(lib, root, 'TST', rev.id, 'from'));
    out['missingArchive'] = missing;
  } finally {
    lib.close();
    await rm(root, { recursive: true, force: true });
  }
}

// #16: legacy library (companies table only) — reads must not crash or migrate.
{
  const cliArgs = process.argv.slice(2);
  const keepIdx = cliArgs.indexOf('--keep');
  const keepRoot = keepIdx >= 0 ? cliArgs[keepIdx + 1] : undefined;
  const tablesIdx = cliArgs.indexOf('--tables');
  if (tablesIdx >= 0 && cliArgs[tablesIdx + 1]) {
    const dir = cliArgs[tablesIdx + 1] as string;
    const db = new DatabaseSync(join(dir, 'library.db'));
    try {
      out['tables'] = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: unknown }>)
        .map((r) => String(r.name)).sort();
    } finally {
      db.close();
    }
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  }
  const root = keepRoot ?? await mkdtemp(join(tmpdir(), 'dcf-legacy-'));
  const dbPath = join(root, 'library.db');
  if (keepRoot) {
    // Pristine legacy setup only: no ModelLibrary construction, so nothing
    // is created or migrated. The caller exercises read paths against it.
    const { mkdir: mkd2 } = await import('node:fs/promises');
    await mkd2(root, { recursive: true });
    const fresh = new DatabaseSync(dbPath);
    try {
      fresh.exec('CREATE TABLE companies(ticker TEXT PRIMARY KEY, route TEXT, currency TEXT, unit_scale TEXT, accession TEXT, filed_date TEXT, workbook_hash TEXT, built_at TEXT, readiness TEXT, workbook_path TEXT, revision_id TEXT)');
      fresh.prepare('INSERT INTO companies VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        'LEG', 'test', 'USD', 'millions', '0000000000-26-000001', '2026-01-01', null, null, 'ready', null, null);
    } finally {
      fresh.close();
    }
    out['root'] = root;
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  }
  const setup = new DatabaseSync(dbPath);
  try {
    setup.exec('CREATE TABLE companies(ticker TEXT PRIMARY KEY, route TEXT, currency TEXT, unit_scale TEXT, accession TEXT, filed_date TEXT, workbook_hash TEXT, built_at TEXT, readiness TEXT, workbook_path TEXT, revision_id TEXT)');
    setup.prepare('INSERT INTO companies VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'LEG', 'test', 'USD', 'millions', '0000000000-26-000001', '2026-01-01', null, null, 'ready', null, null);
  } finally {
    setup.close();
  }
  const tablesBefore: string[] = (() => {
    const db = new DatabaseSync(dbPath);
    try {
      return (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: unknown }>)
        .map((r) => String(r.name)).sort();
    } finally {
      db.close();
    }
  })();
  const lib = new ModelLibrary(root);
  let pending: unknown = 'unset';
  let pendingError: string | null = null;
  try {
    pending = lib.getPendingCandidate('LEG');
  } catch (e) {
    pendingError = e instanceof Error ? e.message : String(e);
  } finally {
    lib.close();
  }
  const tablesAfter: string[] = (() => {
    const db = new DatabaseSync(dbPath);
    try {
      return (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: unknown }>)
        .map((r) => String(r.name)).sort();
    } finally {
      db.close();
    }
  })();
  out['legacyTablesBefore'] = tablesBefore;
  out['legacyTablesAfter'] = tablesAfter;
  out['legacyPending'] = pending === null ? null : 'unexpected';
  out['legacyPendingError'] = pendingError;
  if (!keepRoot) await rm(root, { recursive: true, force: true });
  else out['root'] = root;
}
process.stdout.write(JSON.stringify(out));
