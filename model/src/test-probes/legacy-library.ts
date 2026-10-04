/** Test probe: create a library that predates the candidates table.
 *  Prints its directory; the caller cleans up. Used to prove the MCP
 *  candidate_inspect legacy guard still answers null instead of constructing
 *  (and therefore migrating) a store. */
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'dcf-legacy-'));
const db = new DatabaseSync(join(dir, 'library.db'));
db.exec('CREATE TABLE companies (ticker TEXT PRIMARY KEY, route TEXT)');
db.prepare('INSERT INTO companies (ticker, route) VALUES (?, ?)').run('TST', 'test');
db.close();

process.stdout.write(JSON.stringify({ dir }));
