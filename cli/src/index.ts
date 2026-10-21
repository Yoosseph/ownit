#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { interviewCommand } from './commands/interview.js';
import { keyCommand } from './commands/key.js';

const HELP = `ownit: debrief the code you just pushed.

Usage:
  ownit interview [--range A..B]   Debrief a commit range
  ownit key set|clear|status       Manage your Nebius API key (stored locally)
  ownit help                       Show this help
`;

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
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
