import { createInterface, type Interface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

const useColor = (out: Writable) => !process.env.NO_COLOR && Boolean((out as { isTTY?: boolean }).isTTY);

export function paint(out: Writable) {
  const on = useColor(out);
  const wrap = (code: string) => (text: string) => (on ? `\x1b[${code}m${text}\x1b[0m` : text);
  return { bold: wrap('1'), dim: wrap('2'), green: wrap('32'), red: wrap('31'), yellow: wrap('33'), cyan: wrap('36') };
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
