import { createInterface, type Interface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

const useColor = (out: Writable) => !process.env.NO_COLOR && Boolean((out as { isTTY?: boolean }).isTTY);

export function paint(out: Writable) {
  const on = useColor(out);
  const wrap = (code: string) => (text: string) => (on ? `\x1b[${code}m${text}\x1b[0m` : text);
  return { bold: wrap('1'), dim: wrap('2'), green: wrap('32'), red: wrap('31'), yellow: wrap('33'), cyan: wrap('36') };
}

/** "1 commit", "2 commits". Pass the plural form for irregular words. */
export const plural = (n: number, singular: string, pluralForm = `${singular}s`) => (n === 1 ? singular : pluralForm);

/** The message of whatever was thrown. */
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Ends a message with a period unless it already ends a sentence (server messages usually do). */
export function sentence(text: string): string {
  return /[.!?]$/.test(text.trimEnd()) ? text.trimEnd() : `${text.trimEnd()}.`;
}

/** Line-oriented input that works for a TTY and for piped stdin alike. */
export interface Prompter {
  /** Resolves to the next line, or null on end of input or timeout. */
  ask(prompt: string, timeoutMs?: number): Promise<string | null>;
  close(): void;
  out: Writable;
}

export function createPrompter(input: Readable, out: Writable): Prompter {
  const terminal = Boolean((input as { isTTY?: boolean }).isTTY && (out as { isTTY?: boolean }).isTTY);
  const rl: Interface = createInterface({ input, output: out, terminal });
  const lines: string[] = [];
  let waiter: ((line: string | null) => void) | null = null;
  let closed = false;
  rl.on('line', (line) => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(line);
    } else lines.push(line);
  });
  rl.on('close', () => {
    closed = true;
    waiter?.(null);
    waiter = null;
  });
  return {
    out,
    ask(prompt, timeoutMs) {
      out.write(prompt);
      if (lines.length) return Promise.resolve(lines.shift()!);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => {
        const timer = timeoutMs
          ? setTimeout(() => {
              waiter = null;
              out.write('\n');
              resolve(null);
            }, timeoutMs)
          : null;
        waiter = (line) => {
          if (timer) clearTimeout(timer);
          resolve(line);
        };
      });
    },
    close() {
      rl.close();
    },
  };
}

/** A spinner on a TTY; a single static line otherwise. */
export function spinner(out: Writable, text: string) {
  const tty = Boolean((out as { isTTY?: boolean }).isTTY);
  if (!tty) {
    out.write(`${text}\n`);
    return { stop() {} };
  }
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const timer = setInterval(() => out.write(`\r${frames[i++ % frames.length]} ${text}`), 80);
  return {
    stop() {
      clearInterval(timer);
      out.write(`\r${' '.repeat(text.length + 2)}\r`);
    },
  };
}

/** Word-wraps text to the terminal width with an indent. */
export function wrap(text: string, indent = '  ', width = Math.min(process.stderr.columns || 80, 100)): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && indent.length + line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.map((l) => indent + l).join('\n');
}

/** Edit distance between two short strings (insert, delete, or replace one character). */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** The candidate a typo most likely meant, or null when none is close. */
export function closestMatch(typed: string, candidates: string[]): string | null {
  const word = typed.toLowerCase();
  let best: { name: string; distance: number } | null = null;
  for (const name of candidates) {
    const distance = editDistance(word, name);
    if (distance <= 2 && distance < (best?.distance ?? Infinity)) best = { name, distance };
  }
  return best?.name ?? null;
}
