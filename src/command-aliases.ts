import { CliError, formatCommandAliasTable, result } from './output.js';
import { readLine } from './prompt.js';
import { readConfig, saveConfig, withConfig } from './store.js';
import type { Config } from './store.js';

const defaults: Record<string, string> = {
  menu: 'adb shell input keyevent 82',
  reverse: 'if [ "$#" -gt 0 ]; then adb reverse "tcp:${2:-8081}" "tcp:${1:-8081}"; else for ports in $ADBDOCK_REVERSE_PORTS; do adb reverse "tcp:${ports%:*}" "tcp:${ports#*:}" || exit; done; fi',
  screenshot: "file=\"${ADBDOCK_DEVICE}-${ADBDOCK_RUN_ID}.png\"\ndisplay=$(adb shell dumpsys SurfaceFlinger --display-id | sed -n 's/^Display \\([0-9][0-9]*\\).*/\\1/p' | head -n 1)\nif [ -n \"$display\" ]; then set -- -d \"$display\"; else set --; fi\nadb exec-out screencap -p \"$@\" > \"$file\" && printf '%s\\n' \"$file\"",
};

export function getCommandAliases(config: Config): Record<string, string> {
  return config.commandAliases ?? { ...defaults };
}

export async function manageCommandAliases(action: string, args: string[], force: boolean) {
  if (action === 'add-defaults') {
    if (args.length || force) throw new CliError('INVALID_ARGUMENT', 'Usage: adbdock adb-alias add-defaults [--json].', 2);
    return withConfig(async config => {
      const commands = getCommandAliases(config);
      const added = Object.keys(defaults).filter(name => !Object.hasOwn(commands, name));
      if (added.length) {
        for (const name of added) commands[name] = defaults[name]!;
        config.commandAliases = commands;
        await saveConfig(config);
      }
      return result({ added });
    });
  }
  const before = getCommandAliases(await readConfig());
  if (action === 'list' || action === 'interactive') {
    if (args.length || force) throw new CliError('INVALID_ARGUMENT', 'Usage: adbdock adb-alias list [--json].', 2);
    const entries = Object.entries(before).map(([name, command]) => ({ name, command }));
    if (action === 'list' || !entries.length) return result(entries);
    process.stderr.write(`${formatCommandAliasTable(entries, true, process.stderr.columns || 80)}\n`);
    const choice = Number(await readLine('Choose an alias number: '));
    if (!Number.isInteger(choice) || choice < 1 || choice > entries.length) throw new CliError('INVALID_ARGUMENT', 'Choose one of the listed alias numbers.', 2);
    const selected = entries[choice - 1]!;
    process.stderr.write(`\n@${selected.name}\n${selected.command}\n\n`);
    const operation = await readLine('[e]dit, [d]elete or [q]uit: ');
    if (operation === 'q' || operation === '') return result('Cancelled.');
    if (operation !== 'e' && operation !== 'd') throw new CliError('INVALID_ARGUMENT', 'Choose e, d or q.', 2);
    if (operation === 'd') {
      return withConfig(async config => {
        const commands = getCommandAliases(config);
        if (commands[selected.name] !== selected.command) throw new CliError('ALIAS_CHANGED', 'The command changed while you were choosing. List aliases again.');
        delete commands[selected.name];
        config.commandAliases = commands;
        await saveConfig(config);
        return result(`Removed @${selected.name}.`);
      });
    }
    return manageCommandAliases('edit', [selected.name], false);
  }
  const [name, script] = args;
  if (!name || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new CliError('INVALID_ARGUMENT', 'Alias names start with a letter and use letters, numbers, _ or - (up to 64).', 2);
  const exists = Object.hasOwn(before, name);
  if (action === 'remove') {
    if (args.length !== 1 || force) throw new CliError('INVALID_ARGUMENT', 'Usage: adb-alias remove <name>.', 2);
    if (!exists) throw new CliError('ALIAS_NOT_FOUND', `No command alias '${name}'.`, 3);
    return withConfig(async config => {
      const commands = getCommandAliases(config);
      if (!Object.hasOwn(commands, name)) throw new CliError('ALIAS_NOT_FOUND', `No command alias '${name}'.`, 3);
      delete commands[name];
      config.commandAliases = commands;
      await saveConfig(config);
      return result(`Removed @${name}.`);
    });
  }
  let command = script;
  if (action === 'edit') {
    if (args.length !== 1 || force || !process.stdin.isTTY) throw new CliError('INVALID_ARGUMENT', 'Edit needs a terminal. Use adb-alias add <name> <command> --force in scripts.', 2);
    if (!exists) throw new CliError('ALIAS_NOT_FOUND', `No command alias '${name}'.`, 3);
    process.stderr.write(`Current command: ${before[name]}\n`);
    command = await readLine('New command (Enter to keep): ') || before[name];
    if (command === before[name]) return result({ name, command });
  } else if (action !== 'add' || args.length !== 2) {
    throw new CliError('INVALID_ARGUMENT', 'Use adb-alias add <name> <command>, list, add-defaults, edit <name> or remove <name>.', 2);
  }
  if (!command?.trim()) throw new CliError('INVALID_ARGUMENT', 'The command cannot be empty.', 2);
  if (exists && !force) {
    if (!process.stdin.isTTY) throw new CliError('ALIAS_EXISTS', `@${name} exists. Use --force to replace it.`, 2);
    process.stderr.write(`Current: ${before[name]}\nNew:     ${command}\n`);
    if (!/^y(es)?$/i.test(await readLine(`Overwrite @${name}? [y/N]: `))) return result('Cancelled; existing command kept.');
  }
  return withConfig(async config => {
    const commands = getCommandAliases(config);
    if (!force && (Object.hasOwn(commands, name) !== exists || commands[name] !== before[name])) {
      throw new CliError('ALIAS_CHANGED', 'The command changed while you were editing. Try again.');
    }
    commands[name] = command;
    config.commandAliases = commands;
    await saveConfig(config);
    return result({ name, command });
  });
}
