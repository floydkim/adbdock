import { assignAlias, devices, resolveDevice } from './devices.js';
import { CliError } from './output.js';
import { readLine } from './prompt.js';
import { readConfig, saveConfig, withConfig } from './store.js';

export async function configureAlias(target?: string, name?: string) {
  if ((!target || name === undefined) && !process.stdin.isTTY) {
    throw new CliError('INVALID_ARGUMENT', 'Noninteractive use requires: adbdock alias <device> <name>.', 2);
  }
  let currentAlias: string | undefined;
  if (!target || name === undefined) {
    const config = await readConfig();
    const live = await devices(config);
    if (!target) {
      const entries = [...live, ...config.devices.filter(saved => !live.some(d => d.id === saved.id))];
      if (!entries.length) throw new CliError('DEVICE_NOT_FOUND', 'No connected or remembered devices.', 3);
      entries.forEach((d, i) => {
        const details = 'transports' in d ? `${d.model} | ${d.kind} | ${d.state}` : `${d.kind} | offline`;
        process.stderr.write(`${i + 1}. ${d.alias ?? '-'} | ${details} | ${d.id}\n`);
      });
      const choice = Number(await readLine('Choose a device number: '));
      if (!Number.isInteger(choice) || choice < 1 || choice > entries.length) throw new CliError('INVALID_ARGUMENT', 'Choose one of the listed device numbers.', 2);
      target = entries[choice - 1]!.id;
    }
    const selected = resolveDevice(target, live, config);
    target = selected.id;
    currentAlias = selected.alias;
    name = await readLine(`Alias${currentAlias ? ` (current: ${currentAlias}; Enter to keep)` : ''}: `) || currentAlias;
  }
  if (!name || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) {
    throw new CliError('INVALID_ARGUMENT', 'Alias must start with a letter and use letters, numbers, _ or - (up to 64 characters).', 2);
  }
  const selected = target;
  const alias = name;
  return withConfig(async config => {
    const live = await devices(config);
    const device = resolveDevice(selected!, live, config);
    const saved = assignAlias(config, device, live, alias);
    await saveConfig(config);
    return saved;
  });
}
