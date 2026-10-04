import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchWithTimeout } from './fetch-with-timeout';

export interface LocalBackendProcessOptions {
  backendDirectory: string;
  pythonPath?: string;
  environment?: NodeJS.ProcessEnv;
  spawnProcess?: typeof spawn;
  fetcher?: typeof fetch;
  startupTimeoutMs?: number;
  readinessTimeoutMs?: number;
  pollIntervalMs?: number;
  shutdownTimeoutMs?: number;
}

function choosePython(backendDirectory: string, environment: NodeJS.ProcessEnv): string {
  const windows = process.platform === 'win32';
  const candidates = [
    environment.PYTHON,
    resolve(backendDirectory, windows ? '.venv/Scripts/python.exe' : '.venv/bin/python'),
    resolve(backendDirectory, windows ? 'venv/Scripts/python.exe' : 'venv/bin/python'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (!candidate.includes('/') || existsSync(candidate)) return candidate;
  }
  return windows ? 'python' : 'python3';
}

function childHasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export class LocalBackendProcess {
  private readonly options: Required<Pick<LocalBackendProcessOptions,
    'backendDirectory' | 'startupTimeoutMs' | 'readinessTimeoutMs' | 'pollIntervalMs' | 'shutdownTimeoutMs'>> & LocalBackendProcessOptions;
  private readonly fetcher: typeof fetch;
  private readonly spawnProcess: typeof spawn;
  private child: ChildProcess | null = null;
  private baseUrl: string | null = null;
  private stopPromise: Promise<void> | null = null;

  constructor(options: LocalBackendProcessOptions) {
    this.options = {
      ...options,
      backendDirectory: resolve(options.backendDirectory),
      startupTimeoutMs: options.startupTimeoutMs ?? 30_000,
      readinessTimeoutMs: options.readinessTimeoutMs ?? 15_000,
      pollIntervalMs: options.pollIntervalMs ?? 200,
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? 3_000,
    };
    this.fetcher = options.fetcher ?? fetch;
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  async start(): Promise<string> {
    if (this.baseUrl) return this.baseUrl;
    if (this.child) throw new Error('Backend process is already starting.');

    const environment: NodeJS.ProcessEnv = { PYTHONUNBUFFERED: '1' };
    const parentEnvironment = this.options.environment ?? process.env;
    for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'TEMP', 'TMP', 'EDGAR_IDENTITY', 'DCF_CACHE_DB_PATH']) {
      const value = parentEnvironment[key];
      if (value !== undefined) environment[key] = value;
    }
    const python = this.options.pythonPath ?? choosePython(this.options.backendDirectory, parentEnvironment);

    let child: ChildProcess;
    try {
      const spawnOptions: SpawnOptions = {
        cwd: this.options.backendDirectory,
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
      };
      child = this.spawnProcess(python, ['-m', 'app.local_server'], spawnOptions);
    } catch (error) {
      throw new Error(`Could not start the backend: ${errorMessage(error)}`);
    }
    this.child = child;

    try {
      const port = await this.waitForPort(child);
      const baseUrl = `http://127.0.0.1:${port}`;
      await this.waitForReady(baseUrl, child);
      this.baseUrl = baseUrl;
      return baseUrl;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.stopChild();
    return this.stopPromise;
  }

  private async waitForPort(child: ChildProcess): Promise<number> {
    return new Promise<number>((resolvePromise, rejectPromise) => {
      let settled = false;
      let pending = '';
      const finish = (error?: Error, port?: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.stdout?.off('data', onOutput);
        child.stderr?.off('data', onOutput);
        child.off('error', onError);
        child.off('exit', onExit);
        if (error) rejectPromise(error);
        else if (port !== undefined) resolvePromise(port);
        else rejectPromise(new Error('Backend process did not provide a port.'));
      };
      const onOutput = (chunk: Buffer | string) => {
        pending += chunk.toString();
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? '';
        for (const line of lines) {
          const match = line.trim().match(/^DCF_BUILDER_BACKEND_PORT=(\d+)$/);
          if (!match) continue;
          const port = Number(match[1]);
          if (Number.isInteger(port) && port > 0 && port <= 65535) finish(undefined, port);
          else finish(new Error('Backend process published an invalid loopback port.'));
          return;
        }
      };
      const onError = (error: Error) => finish(new Error(`Could not start the backend: ${error.message}`));
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        finish(new Error(`Backend exited before publishing a port (code ${code ?? signal ?? 'unknown'}).`));
      };
      const timeout = setTimeout(
        () => finish(new Error(`Backend did not publish a port within ${this.options.startupTimeoutMs} ms.`)),
        this.options.startupTimeoutMs,
      );

      child.stdout?.on('data', onOutput);
      child.stderr?.on('data', onOutput);
      child.once('error', onError);
      child.once('exit', onExit);
      if (childHasExited(child)) onExit(child.exitCode, child.signalCode);
    });
  }

  private async waitForReady(baseUrl: string, child: ChildProcess): Promise<void> {
    const deadline = Date.now() + this.options.readinessTimeoutMs;
    let lastError = '';
    while (Date.now() < deadline) {
      if (childHasExited(child)) {
        throw new Error(`Backend exited before readiness (code ${child.exitCode ?? child.signalCode ?? 'unknown'}).`);
      }
      try {
        const readiness = await fetchWithTimeout(
          this.fetcher,
          `${baseUrl}/ready`,
          undefined,
          Math.max(1, deadline - Date.now()),
          'Backend readiness request',
          async (response) => ({
            ok: response.ok,
            status: response.status,
            body: response.ok ? await response.json() : null,
          }),
        );
        if (readiness.ok) {
          const body: unknown = readiness.body;
          if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
            const warnings = (body as Record<string, unknown>).warnings;
            if (Array.isArray(warnings) && warnings.some((warning) => String(warning).includes('EDGAR_IDENTITY appears to be using a placeholder'))) {
              throw new Error('Set EDGAR_IDENTITY in your shell environment before running the CLI.');
            }
            if ((body as Record<string, unknown>).status === 'ready') return;
          }
          lastError = 'Backend readiness response did not contain a ready status.';
        } else {
          lastError = `Backend readiness returned ${readiness.status}.`;
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Set EDGAR_IDENTITY')) throw error;
        lastError = errorMessage(error);
      }
      await wait(Math.min(this.options.pollIntervalMs, Math.max(0, deadline - Date.now())));
    }
    throw new Error(`Backend did not become ready within ${this.options.readinessTimeoutMs} ms.${lastError ? ` ${lastError}` : ''}`);
  }

  private async stopChild(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.baseUrl = null;
    if (childHasExited(child)) {
      this.child = null;
      return;
    }

    const exited = new Promise<void>((resolvePromise) => child.once('exit', () => resolvePromise()));
    child.kill('SIGTERM');
    const stopped = await Promise.race([
      exited.then(() => true),
      wait(this.options.shutdownTimeoutMs).then(() => false),
    ]);
    if (!stopped && !childHasExited(child)) {
      child.kill('SIGKILL');
      await Promise.race([exited, wait(this.options.shutdownTimeoutMs)]);
    }
    this.child = null;
  }
}
