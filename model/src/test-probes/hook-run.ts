/** Test probe: run the review hook and print the JSON result. */
import { runReviewHook } from '@/review/build-candidate';

const args = process.argv.slice(2);
let command = '';
let timeoutMs: number | undefined;
const env: Record<string, string> = {};
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--cmd') command = args[++i] as string;
  else if (args[i] === '--timeout') timeoutMs = Number(args[++i]);
  else if (args[i] === '--env' && args[i + 1]) {
    const [k, ...rest] = (args[++i] as string).split('=');
    if (k) env[k] = rest.join('=');
  }
}
const started = Date.now();
const result = await runReviewHook(command, env, timeoutMs === undefined ? {} : { timeoutMs });
process.stdout.write(JSON.stringify({ ...result, elapsedMs: Date.now() - started }));
