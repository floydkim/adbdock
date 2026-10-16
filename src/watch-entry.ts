import { runWatcher } from './daemon.js';
import { CliError } from './output.js';

try {
  await runWatcher(Number(process.argv[2] ?? 2000), info => process.send?.({ ready: info }));
} catch (error) {
  process.send?.({ error: (error as Error).message, code: error instanceof CliError ? error.code : 'WATCH_START_FAILED' });
  process.exitCode = 1;
}
