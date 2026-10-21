#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { hookCommand } from './commands/hook.js';
import { initCommand, uninstallCommand } from './commands/init.js';
import { interviewCommand } from './commands/interview.js';
import { keyCommand } from './commands/key.js';
import { loginCommand, logoutCommand, whoamiCommand } from './commands/login.js';

const HELP = `ownit: debrief the code you just pushed.

Usage:
  ownit login [--server URL]       Sign in with GitHub (device flow)
  ownit logout                     Sign out
  ownit whoami                     Show server, login, and key status
  ownit init [--repo owner/name]   Install the pre-push hook in this repo
  ownit interview                  Debrief pushes that are still pending
  ownit interview --range A..B     Debrief a commit range
  ownit key set|clear|status       Manage your Nebius API key (stored locally)
  ownit uninstall                  Remove the pre-push hook
  ownit help                       Show this help

Set OWNIT_SKIP=1 to push once without a debrief prompt (the push is pending).
`;

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'login':
      return loginCommand(rest);
    case 'logout':
      return logoutCommand();
    case 'whoami':
    case 'status':
      return whoamiCommand();
    case 'init':
      return initCommand(rest);
    case 'uninstall':
      return uninstallCommand();
    case 'hook':
      return hookCommand(rest);
    case 'interview':
      return interviewCommand(rest);
    case 'key':
      return keyCommand(rest);
    case '--version':
    case '-v':
      process.stdout.write(`${version()}\n`);
      return 0;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HELP);
      return 0;
    default:
      process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`Ownit: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
