const fs = require('node:fs');
const {syncBuiltinESMExports} = require('node:module');
const args = process.argv.slice(2);
if (process.env.FAKE_RUNNER_DELAY === 'watch' && process.argv[1]?.endsWith('/dist/cli.js') && args.includes('--background')) {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (...values) => {
    fs.writeFileSync(process.env.FAKE_RUNNER_MARKER, 'watcher ready');
    setTimeout(() => write(...values), 1500);
    return true;
  };
}
if (process.env.FAKE_RUNNER_DELAY === 'bind' && process.argv[1]?.endsWith('/fake-adb.mjs') && args.includes('reverse') && args.some(a => a.startsWith('tcp:')) && !args.includes('--remove')) {
  const write = fs.writeFileSync;
  fs.writeFileSync = (...values) => {
    write(...values);
    write(process.env.FAKE_RUNNER_MARKER, 'reverse created');
    setTimeout(() => {}, 1500);
  };
  syncBuiltinESMExports();
}
