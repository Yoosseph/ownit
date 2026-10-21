#!/usr/bin/env node
// Local development only: creates a user and an Ownit session in the *local* D1
// database, so the CLI can talk to `wrangler dev` without a GitHub App.
//
//   node scripts/dev-login.mjs <github-login> [github-id]
//   echo <printed token> | ownit login --with-token --server http://127.0.0.1:8787
//
// Run wrangler dev with `--var DEV_LOCAL_TRUST:1` to skip the push-access check
// (honored only for requests to localhost).
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [login, id = '1000001'] = process.argv.slice(2);
if (!login || !/^[\w-]+$/.test(login) || !/^\d+$/.test(id)) {
  console.error('Usage: node scripts/dev-login.mjs <github-login> [github-id]');
  process.exit(1);
}

const token = `ownit_${randomBytes(32).toString('base64url')}`;
const hash = createHash('sha256').update(token).digest('hex');
const sql = [
  `INSERT INTO users (github_id, login) VALUES (${id}, '${login}') ON CONFLICT (github_id) DO UPDATE SET login = excluded.login;`,
  `INSERT INTO sessions (token_hash, github_id, created_at, expires_at) VALUES ('${hash}', ${id}, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 days'));`,
].join(' ');

const worker = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wranglerPkg = createRequire(import.meta.url).resolve('wrangler/package.json');
const wrangler = join(dirname(wranglerPkg), 'bin', 'wrangler.js');
const dir = mkdtempSync(join(tmpdir(), 'ownit-dev-login-'));
const file = join(dir, 'session.sql');
writeFileSync(file, sql);
try {
  execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'ownit', '--local', '--file', file], { cwd: worker, stdio: 'ignore' });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(token);
