/**
 * Hidden terminal input for secrets (nothing is echoed).
 */
import readline from 'node:readline';
import { Writable } from 'node:stream';

export async function promptHidden(question: string): Promise<string> {
  if (process.stdin.isTTY !== true) throw new Error('No interactive terminal available');
  process.stdout.write(question);
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
  try {
    return await new Promise<string>((resolve) => rl.question('', resolve));
  } finally {
    rl.close();
    process.stdout.write('\n');
  }
}
