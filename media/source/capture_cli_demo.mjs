/** Capture the actual CLI debrief renderer with deterministic demo model replies.
 * No network calls, credentials, Git pushes, or modifications to application source.
 * Node 24+: node media/source/capture_cli_demo.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PassThrough } from 'node:stream';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = join(root, '.tmp', 'demo-cli');
mkdirSync(temporary, { recursive: true });
writeFileSync(join(temporary, 'package.json'), '{"type":"module"}\n');
for (const name of ['debrief', 'ui', 'api', 'config', 'providers']) {
  const source = readFileSync(join(root, 'cli/src', `${name}.ts`), 'utf8');
  writeFileSync(join(temporary, `${name}.js`), stripTypeScriptTypes(source, { mode: 'transform' }));
}
const { runDebrief } = await import(pathToFileURL(join(temporary, 'debrief.js')));
const events = [];
let time = 3.7;
let kind = 'output';
const out = new PassThrough();
out.on('data', (chunk) => events.push({ time: Number(time.toFixed(4)), kind, text: chunk.toString() }));
const answer = "So a temporary error doesn't lose the sale.";
const prompter = {
  out,
  async ask(prompt) {
    out.write(prompt);
    kind = 'input';
    for (let i = 0; i < answer.length; i++) {
      time = 8.9 + i * .057;
      out.write(answer[i]);
    }
    time += .15;
    out.write('\n');
    kind = 'output';
    return answer;
  },
  close() {},
};
const api = {
  server: 'offline-demo',
  async request(method, path, body) {
    if (path === '/api/interview/start') {
      time = 4.35;
      return { push_id: 1, total: 1, session: 'demo-0',
        questions: [{ idx: 0, kind: 'why', text: 'Why retry temporary payment failures?' }] };
    }
    if (path === '/api/interview/answer' && body.answer === answer) {
      time = 12.4;
      return { pass: true, feedback: 'Nice, you covered the main idea.', done: true,
        status: 'verified', followup: null, session: 'demo-1' };
    }
    throw new Error(`Unexpected demo request: ${method} ${path}`);
  },
};
const code = [
  'export async function chargeWithRetry(pay) {',
  '  const maxAttempts = 3;',
  '  for (let attempt = 1; attempt <= maxAttempts; attempt++) {',
  '    try {',
  '      return await pay();',
  '    } catch (error) {',
  '      if (!error.temporary || attempt === maxAttempts) {',
  '        throw error;',
  '      }',
  '      await sleep(250 * attempt);',
  '    }',
  '  }',
  '}',
];
const result = await runDebrief(api, prompter, {
  repo: 'demo/shop', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
  commits: [{ sha: 'b'.repeat(40), message: 'Retry temporary payment errors' }],
  diff: { diff: 'diff --git a/checkout.ts b/checkout.ts\n' + code.map((line) => '+' + line).join('\n'),
    truncated: false, changedLines: 14, files: 1, omitted: [] },
});
if (result.status !== 'verified') throw new Error('Demo did not finish successfully');
const metadata = {
  provenance: 'Output captured by running cli/src/debrief.ts with controlled offline demo API replies. Shell command and hook prompt are staged. No live model or remote push.',
  code, events, result,
};
writeFileSync(join(root, 'media/source/cli-demo.json'), JSON.stringify(metadata, null, 2) + '\n');
writeFileSync(join(root, 'media/source/cli-demo.txt'), events.map((event) => event.text).join(''));
console.log(`Captured ${events.length} CLI events; outcome: ${result.status}.`);
