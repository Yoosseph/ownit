import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { badgeMarkdown } from '../src/commands/badge.js';
import { describeKey, modelKey, providerByPrefix } from '../src/providers.js';
import { closestMatch } from '../src/ui.js';
import { cleanEnv, run } from './helpers.js';

// The built CLI; test/build.ts compiles it before the suite runs.
const CLI = resolve(import.meta.dirname, '..', 'dist', 'index.js');

describe('model key', () => {
  it('prefers a provider env var, then the saved key, then the older nebiusKey field', () => {
    expect(modelKey({ apiKey: 'saved' }, { NVIDIA_API_KEY: 'nvapi-env' })).toEqual({ provider: 'nvidia', key: 'nvapi-env' });
    expect(modelKey({ apiKey: 'saved' }, { NEBIUS_API_KEY: 'nb-env' })).toEqual({ provider: 'nebius', key: 'nb-env' });
    expect(modelKey({ provider: 'nvidia', apiKey: 'saved', nebiusKey: 'old' }, {})).toEqual({ provider: 'nvidia', key: 'saved' });
    expect(modelKey({ apiKey: 'saved' }, {})).toEqual({ provider: 'nebius', key: 'saved' });
    expect(modelKey({ nebiusKey: 'old' }, {})).toEqual({ provider: 'nebius', key: 'old' });
    expect(modelKey({}, {})).toBeUndefined();
  });

  it('spots keys that carry another provider\'s prefix', () => {
    expect(providerByPrefix('nvapi-abc')).toBe('nvidia');
    expect(providerByPrefix('eyJhbGciOi')).toBeUndefined();
    expect(describeKey({ provider: 'nvidia', key: 'nvapi-abc1a2b' })).toBe('NVIDIA, …1a2b');
  });
});

describe('badge Markdown', () => {
  it('links the badge image to the repo page', () => {
    expect(badgeMarkdown('https://ownit.example', 'octo/shop')).toBe(
      '[![Ownit](https://ownit.example/badge/octo/shop.svg)](https://ownit.example/octo/shop)',
    );
  });
});

describe('unknown commands', () => {
  it('matches a close typo to a listed command', () => {
    const commands = ['login', 'interview', 'init', 'badge'];
    expect(closestMatch('interviews', commands)).toBe('interview');
    expect(closestMatch('Badeg', commands)).toBe('badge');
    expect(closestMatch('deploy', commands)).toBeNull();
  });

  it('suggests the command a typo meant', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ownit-home-'));
    const res = await run(process.execPath, [CLI, 'interviews'], home, cleanEnv({ OWNIT_HOME: home }));
    expect(res.code).toBe(1);
    expect(res.output).toContain('Did you mean "ownit interview"?');
    expect(res.output).not.toContain('Usage:');
  });

  it('prints the full help when nothing is close', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ownit-home-'));
    const res = await run(process.execPath, [CLI, 'deploy'], home, cleanEnv({ OWNIT_HOME: home }));
    expect(res.output).toContain('Unknown command "deploy".');
    expect(res.output).toContain('Usage:');
  });
});

describe('ownit key', () => {
  const setup = () => {
    const home = mkdtempSync(join(tmpdir(), 'ownit-home-'));
    const env = cleanEnv({ OWNIT_HOME: home });
    const key = (args: string[], input?: string) => run(process.execPath, [CLI, 'key', ...args], home, env, input);
    const config = () => JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
    return { home, key, config };
  };

  it('saves a piped key with the provider named on the command line', async () => {
    const { key, config } = setup();
    const result = await key(['set', 'nvidia'], 'nvapi-secret-1a2b\n');
    expect(result.code).toBe(0);
    expect(result.output).toContain('Saved your NVIDIA key');
    expect(config()).toMatchObject({ provider: 'nvidia', apiKey: 'nvapi-secret-1a2b' });
    expect((await key(['status'])).output).toContain('API key set (NVIDIA, …1a2b)');
  });

  it('needs the provider named when the key is piped', async () => {
    const { key } = setup();
    const result = await key(['set'], 'nb-secret\n');
    expect(result.code).toBe(1);
    expect(result.output).toContain('name the provider when piping a key');
  });

  it('rejects an unknown provider and a key that belongs to another provider', async () => {
    const { key } = setup();
    const pasted = await key(['set', 'v1.secret-pasted-as-arg'], 'k\n');
    expect(pasted.code).toBe(1);
    expect(pasted.output).toContain('takes a provider');
    expect(pasted.output).not.toContain('secret-pasted-as-arg');
    const mismatch = await key(['set', 'nebius'], 'nvapi-secret\n');
    expect(mismatch.code).toBe(1);
    expect(mismatch.output).toContain('looks like it is for NVIDIA');
  });

  it('replaces an older nebiusKey and clears both fields', async () => {
    const { home, key, config } = setup();
    writeFileSync(join(home, 'config.json'), JSON.stringify({ nebiusKey: 'old-key' }));
    expect((await key(['status'])).output).toContain('API key set (Nebius, …-key)');
    await key(['set', 'nebius'], 'new-nebius-key\n');
    expect(config()).toEqual({ provider: 'nebius', apiKey: 'new-nebius-key' });
    await key(['clear']);
    expect(config()).toEqual({});
  });
});
