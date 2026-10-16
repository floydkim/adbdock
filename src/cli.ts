#!/usr/bin/env node
import { CliError, print, result } from './output.js';

const help = `adbdock — multi-device ADB, optional Metro recovery

Usage:
  adbdock devices [--json]
  adbdock alias <device> <name>
  adbdock adb --device <device> [--device <device> ...] -- <adb command>
  adbdock adb --all [--json] -- <adb command>
  adbdock metro bind <device> --port <port> [--device-port <port>]
  adbdock metro unbind <device> [--device-port <port>]
  adbdock metro repair (--device <device> | --all)
  adbdock status [--json]
  adbdock watch [--background]
  adbdock stop
`;

const args = process.argv.slice(2);
const separator = args.indexOf('--');
const json = (separator < 0 ? args : args.slice(0, separator)).includes('--json');

try {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    print(result(help), json);
  } else {
    throw new CliError('INVALID_ARGUMENT', `Unknown command: ${args[0]}. Run adbdock --help.`, 2);
  }
} catch (error) {
  const failure = error instanceof CliError ? error : new CliError('INTERNAL_ERROR', String(error));
  print(result(null, [{ code: failure.code, message: failure.message }]), json);
  process.exitCode = failure.exitCode;
}
