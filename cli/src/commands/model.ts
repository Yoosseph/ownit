import { createApi } from '../api.js';
import { readConfig } from '../config.js';
import { describeKey, modelKey } from '../providers.js';
import { paint } from '../ui.js';

export interface ServerModel {
  id: string;
  name: string;
  model: string;
}

/** The model each provider runs on the server, or null when the server doesn't say (older servers). */
export async function serverModels(): Promise<ServerModel[] | null> {
  try {
    const { providers } = await createApi().request<{ providers: ServerModel[] }>('GET', '/models', undefined, { timeoutMs: 5_000 });
    return providers;
  } catch {
    return null;
  }
}

/**
 * `ownit model`: which provider and model your debriefs use. The key is saved
 * for your user, so this is the same in every repo on this computer.
 */
export async function modelCommand(): Promise<number> {
  const out = process.stderr;
  const c = paint(out);
  const key = modelKey(readConfig());
  const models = await serverModels();
  const current = key && models?.find((m) => m.id === key.provider);

  if (!key) out.write(`Provider:  ${c.yellow('no key set')} (run "ownit key set")\n`);
  else {
    out.write(`Provider:  ${describeKey(key)}\n`);
    out.write(`Model:     ${current ? c.bold(current.model) : c.dim("this server doesn't report its models")}\n`);
  }
  for (const other of models ?? []) {
    if (other.id === key?.provider) continue;
    out.write(c.dim(`With ${other.name}: ${other.model} (ownit key set ${other.id})\n`));
  }
  out.write(c.dim('Your key is saved for your user, so this applies in every repo on this computer.\n'));
  return 0;
}
