import { readConfig, updateConfig } from '../config.js';
import { readSecret } from '../secret.js';

export async function keyCommand(argv: string[]): Promise<number> {
  const out = process.stderr;
  const [action = 'status'] = argv;
  if (action === 'set') {
    // Read from a prompt or stdin, never argv, so the key stays out of shell history.
    const key = (await readSecret('Nebius API key (input hidden): ')).trim();
    if (!key) {
      out.write('Ownit: no key entered; nothing changed.\n');
      return 1;
    }
    updateConfig({ nebiusKey: key });
    out.write('Saved your Nebius key to ~/.ownit/config.json. It is sent only with debrief requests and never stored by Ownit.\n');
    return 0;
  }
  if (action === 'clear') {
    updateConfig({ nebiusKey: undefined });
    out.write('Removed your Nebius key.\n');
    return 0;
  }
  if (action === 'status') {
    const key = process.env.NEBIUS_API_KEY || readConfig().nebiusKey;
    out.write(key ? `Nebius key set (…${key.slice(-4)}).\n` : 'No Nebius key set. Run "ownit key set".\n');
    return 0;
  }
  out.write('Usage: ownit key [set|clear|status]\n');
  return 1;
}
