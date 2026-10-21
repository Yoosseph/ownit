import { describeKey, keyProvider, modelKey, readConfig, updateConfig } from '../config.js';
import { readSecret } from '../secret.js';

export async function keyCommand(argv: string[]): Promise<number> {
  const out = process.stderr;
  const [action = 'status'] = argv;
  if (action === 'set') {
    // Read from a prompt or stdin, never argv, so the key stays out of shell history.
    const key = (await readSecret('Nebius or NVIDIA API key (input hidden): ')).trim();
    if (!key) {
      out.write('Ownit: no key entered; nothing changed.\n');
      return 1;
    }
    updateConfig({ apiKey: key, nebiusKey: undefined });
    out.write(`Saved your ${keyProvider(key)} key to ~/.ownit/config.json. It is sent only with debrief requests and never stored by Ownit.\n`);
    return 0;
  }
  if (action === 'clear') {
    updateConfig({ apiKey: undefined, nebiusKey: undefined });
    out.write('Removed your API key.\n');
    return 0;
  }
  if (action === 'status') {
    const key = modelKey(readConfig());
    out.write(key ? `API key set (${describeKey(key)}).\n` : 'No API key set. Run "ownit key set" with a Nebius or NVIDIA key.\n');
    return 0;
  }
  out.write('Usage: ownit key [set|clear|status]\n');
  return 1;
}
