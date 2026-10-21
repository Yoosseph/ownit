import { createInterface } from 'node:readline';

/** Reads one line without echoing it on a TTY. Piped input is read as-is. */
export function readSecret(prompt: string): Promise<string> {
  const stdin = process.stdin;
  const out = process.stderr;
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      const rl = createInterface({ input: stdin });
      let done = false;
      rl.once('line', (line) => {
        done = true;
        rl.close();
        resolve(line);
      });
      rl.once('close', () => done || resolve(''));
    });
  }
  out.write(prompt);
  return new Promise((resolve) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          out.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          out.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}
