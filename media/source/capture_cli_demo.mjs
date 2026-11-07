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
out.on('data', (chunk) => {
  if (chunk.toString().includes('Question 2/2')) time = 14;
  events.push({ time: Number(time.toFixed(4)), kind, text: chunk.toString() });
});
const answers = [
  'So customers can quickly find the product they want.',
  'The shop only shows products with shoes in the name.',
];
let answerIndex = 0;
const prompter = {
  out,
  async ask(prompt) {
    const answer = answers[answerIndex];
    out.write(prompt);
    kind = 'input';
    for (let i = 0; i < answer.length; i++) {
      time = (answerIndex === 0 ? 8.9 : 18) + i * .057;
      out.write(answer[i]);
    }
    time += .15;
    out.write('\n');
    kind = 'output';
    answerIndex++;
    return answer;
  },
  close() {},
};
const api = {
  server: 'offline-demo',
  async request(method, path, body) {
    if (path === '/api/interview/start') {
      time = 4.35;
      return { push_id: 1, total: 2, session: 'demo-0',
        questions: [
          { idx: 0, kind: 'why', text: 'Why did you add a search box to the shop?' },
          { idx: 1, kind: 'how', text: 'What happens when someone searches for shoes?' },
        ] };
    }
    if (path === '/api/interview/answer' && body.answer === answers[body.idx]) {
      time = body.idx === 0 ? 12.4 : 22;
      return { pass: true, feedback: body.idx === 0 ? 'Customers can find products faster.' : 'Yes, the search matches product names.',
        done: body.idx === 1, status: body.idx === 1 ? 'verified' : 'pending',
        followup: null, session: `demo-${body.idx + 1}` };
    }
    throw new Error(`Unexpected demo request: ${method} ${path}`);
  },
};
const code = [
  'export function searchProducts(products, query) {',
  '  const search = query.trim().toLowerCase();',
  '  return products.filter(product =>',
  '    product.name.toLowerCase().includes(search)',
  '  );',
  '}',
];
const result = await runDebrief(api, prompter, {
  repo: 'demo/shop', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
  commits: [{ sha: 'b'.repeat(40), message: 'Add product search to the shop' }],
  diff: { diff: 'diff --git a/search.ts b/search.ts\n' + code.map((line) => '+' + line).join('\n'),
    truncated: false, changedLines: code.length, files: 1, omitted: [] },
});
if (result.status !== 'verified') throw new Error('Demo did not finish successfully');
const metadata = {
  provenance: 'Output captured by running cli/src/debrief.ts with controlled offline demo API replies. Shell command and hook prompt are staged. No live model or remote push.',
  code, events, result,
};
writeFileSync(join(root, 'media/source/cli-demo.json'), JSON.stringify(metadata, null, 2) + '\n');
writeFileSync(join(root, 'media/source/cli-demo.txt'), events.map((event) => event.text).join(''));
console.log(`Captured ${events.length} CLI events; outcome: ${result.status}.`);
