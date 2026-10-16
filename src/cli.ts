#!/usr/bin/env node
import { CliError, print, result } from './output.js';
import { parseArgs } from 'node:util';
import { devices, remember, resolveDevice, selectDevices } from './devices.js';
import { readConfig, saveConfig, withConfig } from './store.js';
import { runCommands, validateCommand } from './commands.js';

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

function options(input: string[], definitions: Record<string, { type: 'string' | 'boolean'; multiple?: boolean }> = {}): { positionals: string[]; values: Record<string, string | boolean | string[] | undefined> } {
  try {
    return parseArgs({ args: input, allowPositionals: true, options: { json: { type: 'boolean' }, ...definitions } });
  } catch (error) { throw new CliError('INVALID_ARGUMENT', (error as Error).message, 2); }
}

async function main() {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    print(result(help), json);
    return;
  }
  if (args[0] === 'devices') {
    const parsed = options(args.slice(1));
    if (parsed.positionals.length) throw new CliError('INVALID_ARGUMENT', 'devices takes no positional arguments.', 2);
    print(result(await devices(await readConfig())), json);
    return;
  }
  if (args[0] === 'alias') {
    const parsed = options(args.slice(1));
    const [target, name] = parsed.positionals;
    if (!target || !name || parsed.positionals.length !== 2 || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) {
      throw new CliError('INVALID_ARGUMENT', 'Usage: adbdock alias <device> <name>; names start with a letter and use letters, numbers, _ or -.', 2);
    }
    const saved = await withConfig(async config => {
      const live = await devices(config);
      const device = resolveDevice(target, live, config);
      if (config.devices.some(d => d.id !== device.id && (d.alias === name || d.serials.includes(name) || d.id === name))
        || live.some(d => d.id !== device.id && (d.id === name || d.transports.some(t => t.serial === name)))) {
        throw new CliError('ALIAS_EXISTS', `Alias '${name}' already identifies another device.`, 2);
      }
      const saved = remember(config, device);
      saved.alias = name;
      await saveConfig(config);
      return saved;
    });
    print(result(saved), json);
    return;
  }
  if (args[0] === 'adb') {
    if (separator < 0) throw new CliError('INVALID_ARGUMENT', 'Separate adbdock options and ADB arguments with --.', 2);
    const parsed = options(args.slice(1, separator), { device: { type: 'string', multiple: true }, all: { type: 'boolean' }, timeout: { type: 'string' } });
    if (parsed.positionals.length) throw new CliError('INVALID_ARGUMENT', 'Unexpected arguments before --.', 2);
    const command = args.slice(separator + 1);
    validateCommand(command);
    const timeout = Number(parsed.values.timeout ?? 10_000);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 3_600_000) throw new CliError('INVALID_ARGUMENT', '--timeout must be 1..3600000 milliseconds.', 2);
    const config = await readConfig();
    const selected = selectDevices((parsed.values.device ?? []) as string[], Boolean(parsed.values.all), await devices(config), config);
    const output = await runCommands(selected, command, timeout);
    print(output, json);
    if (!output.ok) process.exitCode = 1;
    return;
  }
  throw new CliError('INVALID_ARGUMENT', `Unknown command: ${args[0]}. Run adbdock --help.`, 2);
}

try {
  await main();
} catch (error) {
  const failure = error instanceof CliError ? error : new CliError('INTERNAL_ERROR', String(error));
  print(result(null, [{ code: failure.code, message: failure.message }]), json);
  process.exitCode = failure.exitCode;
}
