import { readConfig, updateConfig } from '../config.js';
import { describeKey, isProvider, modelKey, PROVIDER_IDS, PROVIDERS, providerByPrefix, type Provider } from '../providers.js';
import { readSecret } from '../secret.js';
import { createPrompter } from '../ui.js';

const CHOICES = PROVIDER_IDS.join('|');

/** The provider named on the command line, else one picked from a menu. */
async function chooseProvider(arg: string | undefined): Promise<Provider | undefined> {
  const out = process.stderr;
  if (arg) {
    const id = arg.toLowerCase();
    if (isProvider(id)) return id;
    // Never echo the argument: people paste the key itself here.
    out.write(
      `Ownit: "ownit key set" takes a provider (${CHOICES}), not the key. Keys typed on the command line end up in your shell history, so run "ownit key set" and paste the key at the hidden prompt. If that was a real key, consider rotating it.\n`,
    );
    return undefined;
  }
  // Piped input is the key itself, so there is no line to spare for the menu.
  if (!process.stdin.isTTY) {
    out.write(`Ownit: name the provider when piping a key, e.g. "ownit key set ${PROVIDER_IDS[0]}". Use one of: ${CHOICES}.\n`);
    return undefined;
  }
  out.write('Which provider is this key for?\n');
  PROVIDER_IDS.forEach((id, i) => out.write(`  ${i + 1}) ${PROVIDERS[id].name.padEnd(8)} keys at ${PROVIDERS[id].keyUrl}\n`));
  const prompter = createPrompter(process.stdin, out);
  const answer = ((await prompter.ask(`Choose 1-${PROVIDER_IDS.length} [1]: `)) ?? '').trim().toLowerCase();
  prompter.close();
  if (!answer) return PROVIDER_IDS[0];
  const picked = isProvider(answer) ? answer : PROVIDER_IDS[Number(answer) - 1];
  if (!picked) out.write(`Ownit: "${answer}" is not one of the choices; nothing changed.\n`);
  return picked;
}

export async function keyCommand(argv: string[]): Promise<number> {
  const out = process.stderr;
  const [action = 'status', providerArg] = argv;
  if (action === 'set') {
    const provider = await chooseProvider(providerArg);
    if (!provider) return 1;
    const { name } = PROVIDERS[provider];
    // Read from a prompt or stdin, never argv, so the key stays out of shell history.
    const key = (await readSecret(`${name} API key (input hidden): `)).trim();
    if (!key) {
      out.write('Ownit: no key entered; nothing changed.\n');
      return 1;
    }
    const looksLike = providerByPrefix(key);
    if (looksLike && looksLike !== provider) {
      out.write(`Ownit: that key looks like it is for ${PROVIDERS[looksLike].name}. Run "ownit key set ${looksLike}" instead; nothing changed.\n`);
      return 1;
    }
    updateConfig({ provider, apiKey: key, nebiusKey: undefined });
    out.write(`Saved your ${name} key to ~/.ownit/config.json. It is sent only with debrief requests and never stored by Ownit.\n`);
    return 0;
  }
  if (action === 'clear') {
    updateConfig({ provider: undefined, apiKey: undefined, nebiusKey: undefined });
    out.write('Removed your API key.\n');
    return 0;
  }
  if (action === 'status') {
    const model = modelKey(readConfig());
    out.write(model ? `API key set (${describeKey(model)}).\n` : 'No API key set. Run "ownit key set" with a Nebius or NVIDIA key.\n');
    return 0;
  }
  out.write(`Usage: ownit key set [${CHOICES}] | clear | status\n`);
  return 1;
}
