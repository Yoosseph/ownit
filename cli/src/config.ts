import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Model providers the worker accepts, in the order `ownit key set` lists them.
 * Add a provider here and in the worker's PROVIDERS.
 */
export const PROVIDERS = {
  nebius: { name: 'Nebius', envVar: 'NEBIUS_API_KEY', keyUrl: 'https://tokenfactory.nebius.com/', keyPrefix: undefined },
  nvidia: { name: 'NVIDIA', envVar: 'NVIDIA_API_KEY', keyUrl: 'https://build.nvidia.com/', keyPrefix: 'nvapi-' },
} as const satisfies Record<string, { name: string; envVar: string; keyUrl: string; keyPrefix: string | undefined }>;

export type Provider = keyof typeof PROVIDERS;

export const PROVIDER_IDS = Object.keys(PROVIDERS) as Provider[];

export function isProvider(value: string): value is Provider {
  return Object.hasOwn(PROVIDERS, value);
}

export interface Config {
  /** Ownit server origin; defaults to DEFAULT_SERVER. */
  server?: string;
  /** Ownit session token issued by `ownit login`. */
  token?: string;
  login?: string;
  /** Which provider `apiKey` is for. */
  provider?: Provider;
  /** The user's own model API key. It never leaves this machine except in debrief requests. */
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

export interface ModelKey {
  provider: Provider;
  key: string;
}

/** The key to send with debriefs and its provider. A provider's env var wins over the saved key. */
export function modelKey(config: Config, env: NodeJS.ProcessEnv = process.env): ModelKey | undefined {
  for (const provider of PROVIDER_IDS) {
    const key = env[PROVIDERS[provider].envVar];
    if (key) return { provider, key };
  }
  if (config.apiKey) return { provider: config.provider ?? 'nebius', key: config.apiKey };
  if (config.nebiusKey) return { provider: 'nebius', key: config.nebiusKey };
  return undefined;
}

/** The provider whose keys have this key's prefix, if any. */
export function providerByPrefix(key: string): Provider | undefined {
  return PROVIDER_IDS.find((id) => {
    const prefix: string | undefined = PROVIDERS[id].keyPrefix;
    return prefix !== undefined && key.startsWith(prefix);
  });
}

/** e.g. "NVIDIA, …1a2b" */
export function describeKey({ provider, key }: ModelKey): string {
  return `${PROVIDERS[provider]?.name ?? provider}, …${key.slice(-4)}`;
}

export function serverUrl(config: Config, env: NodeJS.ProcessEnv = process.env): string {
  return (env.OWNIT_SERVER || config.server || DEFAULT_SERVER).replace(/\/+$/, '');
}
