/** Test probe: call one MCP tool over stdio and print the raw response. */
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const modelRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
let tool = '';
let argsJson = '{}';
const extraEnv: Record<string, string> = {};
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--tool') tool = args[++i] as string;
  else if (args[i] === '--args') argsJson = args[++i] as string;
  else if (args[i] === '--env' && args[i + 1]) {
    const [k, ...rest] = (args[++i] as string).split('=');
    if (k) extraEnv[k] = rest.join('=');
  }
}
const child = spawn(join(modelRoot, 'node_modules', '.bin', 'tsx'), ['--tsconfig', 'tsconfig.json', 'src/mcp/server.ts'], {
  cwd: modelRoot,
  env: { ...process.env, ...extraEnv },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let buffer = '';
const done = new Promise<void>((resolvePromise) => {
  const timer = setTimeout(() => resolvePromise(), 25_000);
  child.stdout.on('data', (data: Buffer) => {
    buffer += data.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown };
        if (msg.id === 2) {
          clearTimeout(timer);
          process.stdout.write(JSON.stringify(msg.error ?? msg.result ?? null));
          child.kill('SIGKILL');
          resolvePromise();
        }
      } catch {
        // ignore non-JSON chatter
      }
    }
  });
});
child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
child.stdin.write(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":${JSON.stringify(tool)},"arguments":${argsJson}}}\n`);
await done;
child.kill('SIGKILL');
