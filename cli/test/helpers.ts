import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

export function sh(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** A working repo with a GitHub-looking origin backed by a local bare repo. */
export function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'ownit-test-'));
  const bare = join(root, 'remote.git');
  const work = join(root, 'work');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  sh(work, 'config', 'user.email', 'dev@example.com');
  sh(work, 'config', 'user.name', 'Dev');
  sh(work, 'config', 'core.autocrlf', 'false');
  sh(work, 'remote', 'add', 'origin', bare);
  sh(work, 'config', 'ownit.repo', 'demo/shop');
  const commit = (file: string, content: string, message: string) => {
    writeFileSync(join(work, file), content);
    sh(work, 'add', file);
    sh(work, 'commit', '-q', '-m', message);
    return sh(work, 'rev-parse', 'HEAD');
  };
  return { root, bare, work, commit };
}

export interface Recorded {
  method: string;
  path: string;
  body: any;
  headers: IncomingMessage['headers'];
}

type Handler = (body: any) => unknown;

/** A stand-in Ownit server that records requests and replies from a route table. */
export async function fakeServer(routes: Record<string, Handler | Handler[]>) {
  const requests: Recorded[] = [];
  const counts: Record<string, number> = {};
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0]!;
      let body: any;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = Object.fromEntries(new URLSearchParams(raw)); // form posts, e.g. GitHub OAuth
      }
      requests.push({ method: req.method ?? '', path, body, headers: req.headers });
      const key = `${req.method} ${path}`;
      const route = routes[key];
      const n = (counts[key] = (counts[key] ?? 0) + 1);
      const handler = Array.isArray(route) ? route[Math.min(n - 1, route.length - 1)] : route;
      if (!handler) {
        res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not_found"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(handler(body)));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const AGENT_VARS = ['CI', 'CLAUDECODE', 'CODEX_SANDBOX', 'CODEX_CI', 'CURSOR_AGENT', 'GEMINI_CLI', 'AIDER_MODEL', 'OPENCODE'];

/** Environment for a child git process: no agent markers, no global `ownit` on PATH. */
export function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', GIT_TERMINAL_PROMPT: '0' };
  for (const name of AGENT_VARS) delete env[name];
  for (const name of Object.keys(env)) if (name.startsWith('OWNIT_')) delete env[name];
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = (env[pathKey] ?? '')
    .split(delimiter)
    .filter((dir) => !/npm|pnpm|yarn|volta|fnm|bun/i.test(dir) || /nodejs/i.test(dir))
    .join(delimiter);
  return { ...env, ...extra };
}

/** Runs a command; `input`, when given, is written to its stdin, which is then closed. */
export function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, input?: string) {
  return new Promise<{ code: number; output: string }>((resolve) => {
    const child = execFile(cmd, args, { cwd, env, encoding: 'utf8', timeout: 60_000 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ code, output: `${stdout}${stderr}` });
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}
