import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  /** Ownit server origin; defaults to DEFAULT_SERVER. */
  server?: string;
  /** Ownit session token issued by `ownit login`. */
  token?: string;
  login?: string;
  /** The user's own Nebius or NVIDIA API key. It never leaves this machine except in debrief requests. */
  apiKey?: string;
  /** Older configs saved the key here. */
  nebiusKey?: string;
}

// The hosted Ownit server. Self-hosters point the CLI elsewhere with `ownit login --server`.
export const DEFAULT_SERVER = 'https://ownit.ownit-worker.workers.dev';

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.OWNIT_HOME || join(homedir(), '.ownit');
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), 'config.json');
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  try {
    const value = JSON.parse(readFileSync(configPath(env), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Config) : {};
  } catch {
    return {};
  }
}

/** Writes atomically with owner-only permissions, since the file holds secrets. */
export function writeConfig(config: Config, env: NodeJS.ProcessEnv = process.env) {
  const dir = configDir(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = configPath(env);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows ignores POSIX modes.
  }
}

export function updateConfig(patch: Partial<Config>, env: NodeJS.ProcessEnv = process.env): Config {
  const next = { ...readConfig(env), ...patch };
  for (const key of Object.keys(next) as (keyof Config)[]) if (next[key] === undefined) delete next[key];
  writeConfig(next, env);
  return next;
}

/** The model key to send: an env var wins over the saved one. */
export function modelKey(config: Config, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.NVIDIA_API_KEY || env.NEBIUS_API_KEY || config.apiKey || config.nebiusKey;
}

/** Mirrors the worker, which picks the provider from the key: "nvapi-" keys are NVIDIA's. */
export function keyProvider(key: string): 'NVIDIA' | 'Nebius' {
  return key.startsWith('nvapi-') ? 'NVIDIA' : 'Nebius';
}

/** e.g. "NVIDIA, …1a2b" */
export function describeKey(key: string): string {
  return `${keyProvider(key)}, …${key.slice(-4)}`;
}

export function serverUrl(config: Config, env: NodeJS.ProcessEnv = process.env): string {
  return (env.OWNIT_SERVER || config.server || DEFAULT_SERVER).replace(/\/+$/, '');
}
