import { describe, expect, it } from 'vitest';
import { describeKey, keyProvider, modelKey } from '../src/config';

describe('model key', () => {
  it('prefers an env var, then the saved key, then the older nebiusKey field', () => {
    expect(modelKey({ apiKey: 'saved' }, { NVIDIA_API_KEY: 'nvapi-env' })).toBe('nvapi-env');
    expect(modelKey({ apiKey: 'saved' }, { NEBIUS_API_KEY: 'nb-env' })).toBe('nb-env');
    expect(modelKey({ apiKey: 'saved', nebiusKey: 'old' }, {})).toBe('saved');
    expect(modelKey({ nebiusKey: 'old' }, {})).toBe('old');
    expect(modelKey({}, {})).toBeUndefined();
  });

  it('names the provider from the key prefix, as the worker does', () => {
    expect(keyProvider('nvapi-abc')).toBe('NVIDIA');
    expect(keyProvider('eyJhbGciOi')).toBe('Nebius');
    expect(describeKey('nvapi-abc1a2b')).toBe('NVIDIA, …1a2b');
  });
});
