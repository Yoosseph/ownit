import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanEnv, fakeServer, run } from './helpers.js';

const CLI = resolve(import.meta.dirname, '..', 'dist', 'index.js');

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const MODELS = {
  providers: [
    { id: 'nebius', name: 'Nebius', model: 'nvidia/nemotron-3-super-120b-a12b' },
    { id: 'nvidia', name: 'NVIDIA', model: 'nvidia/nemotron-3.5-super-vl-120b-a12b' },
  ],
};

async function model(env: Record<string, string>, command = 'model') {
  const s = await fakeServer({ 'GET /models': () => MODELS });
  servers.push(s);
  const home = mkdtempSync(join(tmpdir(), 'ownit-home-'));
  return run(process.execPath, [CLI, command], home, cleanEnv({ OWNIT_HOME: home, OWNIT_SERVER: s.url, ...env }));
}

describe('ownit model', { timeout: 60_000 }, () => {
  it('shows the provider and the model the server runs for it', async () => {
    const { code, output } = await model({ NVIDIA_API_KEY: 'nvapi-test-1234' });
    expect(code).toBe(0);
    expect(output).toContain('Provider:  NVIDIA');
    expect(output).toContain('Model:     nvidia/nemotron-3.5-super-vl-120b-a12b');
    expect(output).toContain('With Nebius: nvidia/nemotron-3-super-120b-a12b (ownit key set nebius)');
    expect(output).toContain('every repo on this computer');
  });

  it('answers to ownit plan and ownit currentplan', async () => {
    for (const command of ['plan', 'currentplan']) {
      const { output } = await model({ NEBIUS_API_KEY: 'nb-test-9876' }, command);
      expect(output).toContain('Model:     nvidia/nemotron-3-super-120b-a12b');
    }
  });

  it('says when no key is set', async () => {
    const { output } = await model({});
    expect(output).toContain('no key set');
    expect(output).toContain('With NVIDIA: nvidia/nemotron-3.5-super-vl-120b-a12b');
  });
});
