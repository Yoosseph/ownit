#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { badgeCommand } from './commands/badge.js';
import { hookCommand } from './commands/hook.js';
import { initCommand, uninstallCommand } from './commands/init.js';
import { interviewCommand } from './commands/interview.js';
import { keyCommand } from './commands/key.js';
import { loginCommand, logoutCommand, whoamiCommand } from './commands/login.js';
import { settingsCommand } from './commands/settings.js';
import { closestMatch, errorMessage } from './ui.js';

interface Command {
  /** [usage, description] lines for `ownit help`. Commands without them are not listed. */
  help?: [string, string][];
  /** Longer explanation with examples, for `ownit help <command>` and `ownit <command> --help`. */
  details?: string;
  run(args: string[]): Promise<number> | number;
}

/** Every command, in the order `ownit help` lists them. */
const COMMANDS: Record<string, Command> = {
  login: {
    help: [['ownit login [--server URL]', 'Sign in with GitHub (device flow)']],
    details: `Shows a code and opens GitHub. Approve there, and you're signed in.
Use --server URL only for a self-hosted Ownit server.`,
    run: loginCommand,
  },
  logout: { help: [['ownit logout', 'Sign out']], run: logoutCommand },
  whoami: { help: [['ownit whoami', 'Show server, login, and key status']], run: whoamiCommand },
  init: {
    help: [['ownit init [--repo owner/name]', 'Install the pre-push hook in this repo']],
    details: `Run it inside a clone of your GitHub repo. It installs the pre-push hook, registers the
repo with Ownit, and prints the README badge. The Ownit GitHub App must be installed on the
repo; if it isn't, init prints the link. Use --repo owner/name when the remote isn't GitHub.`,
    run: initCommand,
  },
  interview: {
    help: [
      ['ownit interview', 'List waiting pushes and debrief the one you pick'],
      ['ownit interview --all', 'Debrief every waiting push in turn'],
      ['ownit interview --range A..B', 'Debrief a commit range, or one commit (SHA)'],
    ],
    details: `With no options, it lists the pushes waiting for a debrief and asks which one to do:
  a number   that push           Enter   the newest
  a          all, one by one     q       quit
During a debrief, type "s" to stop and finish later. Disagree with a miss? Type "--force" at the
follow-up to let your answer through: it passes, shown as disputed (once per debrief).

Older commits (count once verified, if "ownit settings earlier on"):
  ownit interview --range 8d21b07            just that commit
  ownit interview --range 7a9e3f1..f3c9a12   every commit after 7a9e3f1, up to f3c9a12
Find commit IDs with "git log --oneline". Keep ranges small, about the size of a normal push.`,
    run: interviewCommand,
  },
  key: {
    help: [
      ['ownit key set [nebius|nvidia]', 'Save your model API key (stored locally)'],
      ['ownit key clear|status', 'Remove or show it'],
    ],
    details: `  ownit key set           asks for the provider, then the key at a hidden prompt
  ownit key set nvidia    an nvapi- key from build.nvidia.com
  ownit key set nebius    a key from tokenfactory.nebius.com
Never type the key after the command: it would end up in your shell history.
NVIDIA_API_KEY or NEBIUS_API_KEY in the environment work too.`,
    run: keyCommand,
  },
  badge: {
    help: [['ownit badge', "Print this repo's badge Markdown for your README"]],
    details: `Paste the output into your README. To copy it straight away:
  ownit badge | clip      (Windows)
  ownit badge | pbcopy    (macOS)
The repo page also has a Copy button.`,
    run: badgeCommand,
  },
  settings: {
    help: [
      ['ownit settings', "Show this repo's settings and page link"],
      ['ownit settings questions on|off', 'Show debrief questions on the page (admins)'],
      ['ownit settings answers on|off', 'Show passing answers on the page (admins)'],
      ['ownit settings earlier on|off', 'Count older commits once debriefed (admins)'],
    ],
    details: `Anyone who can push sees the settings; admins and maintainers change them.
  questions   show debrief questions on the repo page (default on)
  answers     show passing answers there too (default off; off deletes saved ones)
  earlier     count commits from before Ownit once someone debriefs them (default off)
Examples:
  ownit settings answers on
  ownit settings earlier on
Private repos never show questions or answers.`,
    run: settingsCommand,
  },
  uninstall: { help: [['ownit uninstall', 'Remove the pre-push hook']], run: uninstallCommand },
  help: { help: [['ownit help [command]', 'Show this help, or details for one command']], run: (args) => helpCommand(args) },
  // Not listed: the installed git hook calls `ownit hook pre-push`.
  hook: { run: (args) => hookCommand(args) },
  version: { run: () => print(`${version()}\n`) },
};

const ALIASES: Record<string, string> = { interviews: 'interview', setting: 'settings', page: 'settings', status: 'whoami', '--help': 'help', '-h': 'help', '--version': 'version', '-v': 'version' };

const commandName = (name: string) => (Object.hasOwn(ALIASES, name) ? ALIASES[name]! : name);

function findCommand(name: string): Command | undefined {
  const key = commandName(name);
  return Object.hasOwn(COMMANDS, key) ? COMMANDS[key] : undefined;
}

const usageLines = (lines: [string, string][]) => lines.map(([line, description]) => `  ${line.padEnd(33)}${description}`).join('\n');

/** One command's usage lines and details. */
function commandHelp(command: Command): string {
  return `Usage:\n${usageLines(command.help ?? [])}\n${command.details ? `\n${command.details}\n` : ''}`;
}

function helpCommand(args: string[]): number {
  const [name] = args;
  if (!name) return print(helpText());
  const command = findCommand(name);
  if (!command?.help) return unknownCommand(name);
  return print(commandHelp(command));
}

/** Points a typo at the closest listed command, or prints the full help. */
function unknownCommand(name: string): number {
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

function helpText(): string {
  const usage = usageLines(Object.values(COMMANDS).flatMap((command) => command.help ?? []));
  return `ownit: debrief the code you just pushed.

Get started:  ownit login, then ownit key set, then ownit init in your repo.
After that, just git push: Ownit asks "Debrief now? [Y/n]".

Usage:
${usage}

Run "ownit help <command>" (or "ownit <command> --help") for details and examples.
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
  if (!command) return unknownCommand(name);
  if (command.help && (args.includes('--help') || args.includes('-h'))) return print(commandHelp(command));
  try {
    return await command.run(args);
  } catch (error) {
    // A mistyped option, e.g. --rnage: say where the right ones are listed.
    if ((error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      process.stderr.write(`Ownit: ${errorMessage(error)}\nRun "ownit help ${commandName(name)}" for the options.\n`);
      return 1;
    }
    throw error;
  }
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
