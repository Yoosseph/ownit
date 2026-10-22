import type { Config } from './config.js';

/**
 * Model providers the worker accepts, in the order `ownit key set` lists them.
 * Add a provider here and in the worker's PROVIDERS (worker/src/model.ts).
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
