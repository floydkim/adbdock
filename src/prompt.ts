import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { CliError } from './output.js';

export function readLine(prompt: string, hidden = false, piped = false, cancelCode = 'CANCELLED'): Promise<string> {
  return new Promise((resolve, reject) => {
    const output = hidden ? new Writable({ write(_chunk, _encoding, done) { done(); } }) : process.stderr;
    const reader = createInterface({ input: process.stdin, output, terminal: !piped });
    const cancel = () => { reader.close(); };
    process.once('SIGINT', cancel);
    reader.once('SIGINT', cancel);
    reader.once('close', () => {
      process.removeListener('SIGINT', cancel);
      process.stdin.pause();
      reject(new CliError(cancelCode, 'Input cancelled.', 130));
    });
    const answer = (line: string) => { resolve(line.trim()); reader.close(); if (hidden && !piped) process.stderr.write('\n'); };
    if (piped) reader.once('line', answer);
    else {
      if (hidden) process.stderr.write(prompt);
      reader.question(hidden ? '' : prompt, answer);
    }
  });
}
