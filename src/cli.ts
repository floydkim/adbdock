#!/usr/bin/env node
import { CliError, print, result } from './output.js';
import { parseArgs } from 'node:util';
import { devices, remember, resolveDevice, selectDevices } from './devices.js';
import { isPort, readConfig, saveConfig, withConfig } from './store.js';
import { runCommands, validateCommand } from './commands.js';
import { applyBinding, problem, removeBinding, repairBindings } from './link.js';
import { configureAlias } from './alias.js';
import { pairDevice, pairingServices } from './pair.js';
import { status } from './status.js';
import { runWatcher, startBackground, stopWatcher, watcherInfo } from './daemon.js';

const help = `adbdock — multi-device ADB, optional Metro recovery

Usage:
  adbdock devices [--json]
  adbdock alias [device] [name]
  adbdock pair [ip:pairing-port] [--alias <name>] [--connect <ip:connection-port>]
  adbdock pair <ip:pairing-port> --code-stdin [--json]
  adbdock pair --list [--json]
  adbdock pair --qr [--alias <name>] [--timeout <milliseconds>]
  adbdock adb --device <device> [--device <device> ...] -- <adb command>
  adbdock adb --all [--json] -- <adb command>
  adbdock metro bind <device> --port <port> [--device-port <port>]
  adbdock metro unbind <device> [--device-port <port>]
  adbdock metro repair (--device <device> | --all)
  adbdock status [--json]
  adbdock watch [--background] [--interval <milliseconds>]
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
    if (parsed.positionals.length > 2) throw new CliError('INVALID_ARGUMENT', 'Usage: adbdock alias [device] [name].', 2);
    print(result(await configureAlias(parsed.positionals[0], parsed.positionals[1])), json);
    return;
  }
  if (args[0] === 'pair') {
    const parsed = options(args.slice(1), { list: { type: 'boolean' }, qr: { type: 'boolean' }, timeout: { type: 'string' }, alias: { type: 'string' }, connect: { type: 'string' }, 'code-stdin': { type: 'boolean' } });
    if (parsed.positionals.length > 1 || (parsed.values.list && (parsed.positionals.length || parsed.values.alias || parsed.values.connect || parsed.values['code-stdin'] || parsed.values.qr || parsed.values.timeout))) {
      throw new CliError('INVALID_ARGUMENT', 'Use pair [ip:pairing-port] or pair --list.', 2);
    }
    if ((parsed.values.qr && (parsed.positionals.length || parsed.values['code-stdin'])) || (parsed.values.timeout && !parsed.values.qr)) {
      throw new CliError('INVALID_ARGUMENT', '--qr cannot use a pairing endpoint or --code-stdin. --timeout applies to QR scanning.', 2);
    }
    const timeout = Number(parsed.values.timeout ?? 60_000);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300_000) throw new CliError('INVALID_ARGUMENT', '--timeout must be 1..300000 milliseconds.', 2);
    if (parsed.values.list) emit(result(await pairingServices()));
    else emit(await pairDevice({ endpoint: parsed.positionals[0], alias: parsed.values.alias as string | undefined,
      connect: parsed.values.connect as string | undefined, codeStdin: Boolean(parsed.values['code-stdin']), qr: Boolean(parsed.values.qr), timeout }));
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
    const output = { ...result(await status()), watcher: await watcherInfo() };
    emit(output);
    return;
  }
  if (args[0] === 'watch') {
    const parsed = options(args.slice(1), { background: { type: 'boolean' }, interval: { type: 'string' } });
    const interval = Number(parsed.values.interval ?? 2000);
    if (parsed.positionals.length || !Number.isInteger(interval) || interval < 100 || interval > 60_000) throw new CliError('INVALID_ARGUMENT', '--interval must be 100..60000 milliseconds.', 2);
    if (parsed.values.background) emit(result(await startBackground(interval)));
    else await runWatcher(interval, info => emit(result(info)));
    return;
  }
  if (args[0] === 'stop') {
    if (options(args.slice(1)).positionals.length) throw new CliError('INVALID_ARGUMENT', 'stop takes no positional arguments.', 2);
    emit(result(await stopWatcher()));
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
