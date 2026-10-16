#!/usr/bin/env node
import { CliError, print, result } from './output.js';
import { parseArgs } from 'node:util';
import { devices, remember, resolveDevice, selectDevices } from './devices.js';
import { isPort, readConfig, saveConfig, withConfig } from './store.js';
import { runCommands, validateCommand } from './commands.js';
import { applyBinding, problem, removeBinding, repairBindings } from './link.js';
import { status } from './status.js';

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

function port(value: unknown): number {
  const number = Number(value);
  if (!isPort(number)) throw new CliError('INVALID_ARGUMENT', 'Ports must be integers from 1 to 65535.', 2);
  return number;
}

function emit(output: ReturnType<typeof result>) {
  print(output, json);
  if (!output.ok) process.exitCode = 1;
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
  if (args[0] === 'status') {
    if (options(args.slice(1)).positionals.length) throw new CliError('INVALID_ARGUMENT', 'status takes no positional arguments.', 2);
    emit(result(await status()));
    return;
  }
  if (args[0] === 'metro') {
    const command = args[1];
    if (command === 'bind') {
      const parsed = options(args.slice(2), { port: { type: 'string' }, 'device-port': { type: 'string' }, replace: { type: 'boolean' } });
      const target = parsed.positionals[0];
      if (!target || parsed.positionals.length !== 1 || !parsed.values.port) throw new CliError('INVALID_ARGUMENT', 'Usage: metro bind <device> --port <port> [--device-port <port>] [--replace]', 2);
      const metroPort = port(parsed.values.port);
      const devicePort = port(parsed.values['device-port'] ?? 8081);
      emit(await withConfig(async config => {
        const live = await devices(config);
        const device = resolveDevice(target, live, config);
        remember(config, device);
        let binding = config.bindings.find(b => b.deviceId === device.id && b.devicePort === devicePort);
        if (binding) binding.metroPort = metroPort;
        else { binding = { deviceId: device.id, devicePort, metroPort }; config.bindings.push(binding); }
        await saveConfig(config);
        try {
          await applyBinding(binding, 'transports' in device ? device : undefined, Boolean(parsed.values.replace));
          return result({ ...binding, state: 'ready' });
        } catch (error) { return result({ ...binding, state: 'pending' }, [problem(error, device.id)]); }
        finally { await saveConfig(config); }
      }));
      return;
    }
    if (command === 'repair') {
      const parsed = options(args.slice(2), { device: { type: 'string' }, all: { type: 'boolean' } });
      if (parsed.positionals.length || Boolean(parsed.values.device) === Boolean(parsed.values.all)) throw new CliError('INVALID_ARGUMENT', 'Choose metro repair --device <device> or --all.', 2);
      emit(await withConfig(async config => {
        const live = await devices(config);
        const id = parsed.values.device ? resolveDevice(String(parsed.values.device), live, config).id : undefined;
        return repairBindings(config, live, id);
      }));
      return;
    }
    if (command === 'unbind') {
      const parsed = options(args.slice(2), { 'device-port': { type: 'string' } });
      const target = parsed.positionals[0];
      if (!target || parsed.positionals.length !== 1) throw new CliError('INVALID_ARGUMENT', 'Usage: metro unbind <device> [--device-port <port>]', 2);
      const devicePort = parsed.values['device-port'] === undefined ? undefined : port(parsed.values['device-port']);
      emit(await withConfig(async config => {
        const live = await devices(config);
        const device = resolveDevice(target, live, config);
        const matches = config.bindings.filter(b => b.deviceId === device.id && (devicePort === undefined || b.devicePort === devicePort));
        if (matches.length > 1) throw new CliError('INVALID_ARGUMENT', 'Several mappings exist. Specify --device-port.', 2);
        const binding = matches[0];
        if (!binding) return result('No matching mapping.');
        config.bindings = config.bindings.filter(b => b !== binding);
        await saveConfig(config);
        try { await removeBinding(binding, 'transports' in device ? device : undefined); return result({ ...binding, state: 'unbound' }); }
        catch (error) { return result({ ...binding, state: 'unbound' }, [problem(error, device.id)]); }
      }));
      return;
    }
    throw new CliError('INVALID_ARGUMENT', 'Expected metro bind, unbind or repair.', 2);
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
