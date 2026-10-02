import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, normalize } from 'node:path';

export function getConfigPath(): string {
  return join(homedir(), '.config', 'dcf-builder', 'config.json');
}

function expandValidated(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new Error('Models dir must be a non-empty absolute path or ~-prefixed path.');
  if (trimmed === '~' || trimmed.startsWith('~/')) {
    return normalize(join(homedir(), trimmed.slice(1).replace(/^\/+/, '')));
  }
  if (trimmed.startsWith('~')) {
    throw new Error(`Models dir must be an absolute path or ~-prefixed path: ${raw}`);
  }
  if (!isAbsolute(trimmed)) {
    throw new Error(`Models dir must be an absolute path or ~-prefixed path: ${raw}`);
  }
  return normalize(trimmed);
}

function readConfigModelsDir(): string | null {
  try {
    const p = getConfigPath();
    if (!existsSync(p)) return null;
    const parsed: unknown = JSON.parse(readFileSync(p, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const v = (parsed as Record<string, unknown>).modelsDir;
    if (typeof v !== 'string' || v.trim().length === 0) return null;
    return v;
  } catch {
    return null;
  }
}

export function resolveModelsDir(explicitOverride?: string): string {
  if (explicitOverride !== undefined && explicitOverride.trim().length > 0) {
    return expandValidated(explicitOverride);
  }
  const env = process.env.DCF_MODELS_DIR;
  if (env !== undefined && env.trim().length > 0) {
    return expandValidated(env);
  }
  const fromConfig = readConfigModelsDir();
  if (fromConfig !== null) {
    return expandValidated(fromConfig);
  }
  return join(homedir(), 'DCF-Models');
}

export function getModelsDir(): string {
  return resolveModelsDir();
}

export function setModelsDir(path: string): string {
  const resolved = expandValidated(path);
  mkdirSync(resolved, { recursive: true });
  const configPath = getConfigPath();
  let existing: Record<string, unknown> = {};
  try {
    if (existsSync(configPath)) {
      const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
      if (typeof parsed === 'object' && parsed !== null) {
        existing = parsed as Record<string, unknown>;
      }
    }
  } catch {
    existing = {};
  }
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ ...existing, modelsDir: resolved }, null, 2) + '\n', 'utf8');
  return resolved;
}
