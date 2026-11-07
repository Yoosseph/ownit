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
    { id: 'nebius', name: 'Nebius', model: 'nvidia/Nemotron-3.5-Super-VL' },
    { id: 'nvidia', name: 'NVIDIA', model: 'nvidia/nemotron-3.5-super-vl-120b-a12b' },
    { id: 'openai', name: 'OpenAI', model: 'gpt-4.1-mini' },
    { id: 'anthropic', name: 'Claude (Anthropic)', model: 'claude-haiku-4-5' },
    { id: 'deepseek', name: 'DeepSeek', model: 'deepseek-flash' },
  ],
};

async function model(env: Record<string, string>, command = 'model') {
  const s = await fakeServer({ 'GET /models': () => MODELS });
  servers.push(s);
  const home = mkdtempSync(join(tmpdir(), 'ownit-home-'));
  return run(process.execPath, [CLI, command], home, cleanEnv({ OWNIT_HOME: home, OWNIT_SERVER: s.url, ...env }));
}

describe('ownit model', { timeout: 60_000 }, () => {
  it.each([
    ['OPENAI_API_KEY', 'OpenAI', 'gpt-4.1-mini'],
    ['ANTHROPIC_API_KEY', 'Claude (Anthropic)', 'claude-haiku-4-5'],
    ['DEEPSEEK_API_KEY', 'DeepSeek', 'deepseek-flash'],
  ])('shows the selected model for %s', async (envVar, name, selectedModel) => {
    const { code, output } = await model({ [envVar!]: 'test-key' });
    expect(code).toBe(0);
    expect(output).toContain(`Provider:  ${name}`);
    expect(output).toContain(`Model:     ${selectedModel}`);
  });
  it('shows the provider and the model the server runs for it', async () => {
    const { code, output } = await model({ NVIDIA_API_KEY: 'nvapi-test-1234' });
    expect(code).toBe(0);
    expect(output).toContain('Provider:  NVIDIA');
    expect(output).toContain('Model:     nvidia/nemotron-3.5-super-vl-120b-a12b');
    expect(output).toContain('With Nebius: nvidia/Nemotron-3.5-Super-VL (ownit key set nebius)');
    expect(output).toContain('every repo on this computer');
  });

  it('answers to ownit plan and ownit currentplan', async () => {
    for (const command of ['plan', 'currentplan']) {
      const { output } = await model({ NEBIUS_API_KEY: 'nb-test-9876' }, command);
      expect(output).toContain('Model:     nvidia/Nemotron-3.5-Super-VL');
    }
  });

  it('says when no key is set', async () => {
    const { output } = await model({});
    expect(output).toContain('no key set');
    expect(output).toContain('With NVIDIA: nvidia/nemotron-3.5-super-vl-120b-a12b');
  });
});
