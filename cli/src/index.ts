#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { badgeCommand } from './commands/badge.js';
import { hookCommand } from './commands/hook.js';
import { initCommand, uninstallCommand } from './commands/init.js';
import { interviewCommand } from './commands/interview.js';
import { keyCommand } from './commands/key.js';
import { loginCommand, logoutCommand, whoamiCommand } from './commands/login.js';
import { pageCommand } from './commands/page.js';
import { closestMatch, errorMessage } from './ui.js';

interface Command {
  /** [usage, description] lines for `ownit help`. Commands without them are not listed. */
  help?: [string, string][];
  run(args: string[]): Promise<number> | number;
}

/** Every command, in the order `ownit help` lists them. */
const COMMANDS: Record<string, Command> = {
  login: { help: [['ownit login [--server URL]', 'Sign in with GitHub (device flow)']], run: loginCommand },
  logout: { help: [['ownit logout', 'Sign out']], run: logoutCommand },
  whoami: { help: [['ownit whoami', 'Show server, login, and key status']], run: whoamiCommand },
  init: { help: [['ownit init [--repo owner/name]', 'Install the pre-push hook in this repo']], run: initCommand },
  interview: {
    help: [
      ['ownit interview', 'List waiting pushes and debrief the one you pick'],
      ['ownit interview --all', 'Debrief every waiting push in turn'],
      ['ownit interview --range A..B', 'Debrief a commit range'],
    ],
    run: interviewCommand,
  },
  key: {
    help: [
      ['ownit key set [nebius|nvidia]', 'Save your model API key (stored locally)'],
      ['ownit key clear|status', 'Remove or show it'],
    ],
    run: keyCommand,
  },
  badge: { help: [['ownit badge', "Print this repo's badge Markdown for your README"]], run: badgeCommand },
  page: {
    help: [
      ['ownit page', "Show this repo's public page and what it shows"],
      ['ownit page questions on|off', 'Show or hide debrief questions there (admins)'],
      ['ownit page answers on|off', 'Show or hide passing answers there (admins)'],
    ],
    run: pageCommand,
  },
  uninstall: { help: [['ownit uninstall', 'Remove the pre-push hook']], run: uninstallCommand },
  help: { help: [['ownit help', 'Show this help']], run: () => print(helpText()) },
  // Not listed: the installed git hook calls `ownit hook pre-push`.
  hook: { run: (args) => hookCommand(args) },
  version: { run: () => print(`${version()}\n`) },
};

const ALIASES: Record<string, string> = { status: 'whoami', '--help': 'help', '-h': 'help', '--version': 'version', '-v': 'version' };

function findCommand(name: string): Command | undefined {
  const key = Object.hasOwn(ALIASES, name) ? ALIASES[name]! : name;
  return Object.hasOwn(COMMANDS, key) ? COMMANDS[key] : undefined;
}

function helpText(): string {
  const usage = Object.values(COMMANDS)
    .flatMap((command) => command.help ?? [])
    .map(([line, description]) => `  ${line.padEnd(33)}${description}`)
    .join('\n');
  return `ownit: debrief the code you just pushed.

Usage:
${usage}

Set OWNIT_SKIP=1 to push once without a debrief prompt (the push is pending).
`;
}

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

function print(text: string): number {
  process.stdout.write(text);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [name = 'help', ...args] = argv;
  const command = findCommand(name);
  if (!command) {
    // Suggest only listed commands, so a typo never points at the hidden hook command.
    const listed = Object.keys(COMMANDS).filter((key) => COMMANDS[key]!.help);
    const guess = closestMatch(name, listed);
    process.stderr.write(
      guess
        ? `Unknown command "${name}". Did you mean "ownit ${guess}"?\nRun "ownit help" to see every command.\n`
        : `Unknown command "${name}".\n\n${helpText()}`,
    );
    return 1;
  }
  return command.run(args);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`Ownit: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  },
);
