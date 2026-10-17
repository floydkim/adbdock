# npm release preparation

The package is configured as `adbdock@0.1.0`, public, under MIT. It is intended
for macOS with Node.js 22+ and separately installed Android Platform-Tools.
There is no automatic publish job. Removing `private` enables a future release;
it does not publish anything or reserve the package name.

## Validate the release candidate

From a source checkout:

```sh
npm ci
npm run check
npm run check:package
```

`check` runs typecheck and the isolated CLI/runner suite; no physical devices
are required. `check:package` uses `npm pack` to build the real artifact, checks
its file list and executable mode, installs under a temporary global prefix
with `--omit=dev`, and runs installed help/device-query/watcher start-stop checks.
ADB is faked only for those package checks; they do not touch real devices.
It also verifies `npm exec --package <tarball>` and `npm publish <tarball>
--dry-run`. It needs npm registry access to resolve runtime dependencies.
Only temporary installation/config resources are removed; normal npm caches
may be updated. It does not globally install into the user's normal prefix.

The tarball contains `dist/*.js`, README, LICENSE and npm's required package.json.
It excludes source, tests, TypeScript declarations/maps, local configuration,
device logs and development docs. Internal relative JS modules, including the
background watcher entry, stay together. No install/prepare build hook requires
TypeScript on consumer machines. `prepack` builds before packing and
`prepublishOnly` checks a source-directory publish.

## Prepare the artifact

```sh
npm pack --json
# Inspect the returned file list, size, integrity and executable mode.
npm publish ./adbdock-0.1.0.tgz --dry-run
```

Use the version/file returned by npm if the package version changed. A dry run
neither uploads the package nor reserves a name, and does not establish that the
current npm account can claim it. Query the name again immediately before first
publication:

```sh
npm view adbdock name version --json
```

E404 means no visible package was found at that time, not a reservation or a
guarantee that publication will succeed. Do not publish over an unexpected
existing package. If the name is unavailable, choose a different/scoped name
and repeat packaging checks.

No Git remote is currently configured. Set repository/homepage/bugs metadata
when the actual public source URL is known; do not invent one. If publication is
from a private source checkout, remember that the tarball's JavaScript and README
are still public under the chosen license.

## Publish only when explicitly requested

After the user has approved the reviewed release candidate and publication:

```sh
npm login
npm whoami
npm publish ./adbdock-0.1.0.tgz
```

Use the npm account intended to own the package and complete npm's authentication
prompts. Do not write credentials into the repository. `publishConfig` selects
public access and https://registry.npmjs.org/. Publishing a prebuilt tarball uses
that artifact, so run checks before packing; do not rely on a source checkout's
publish hook to validate an arbitrary tarball.

Then verify registry metadata and the documented install/one-off commands:

```sh
npm view adbdock version dist.integrity --json
npm install --global adbdock
adbdock --help
npx --yes adbdock@0.1.0 devices
```

These final commands install/run the released package and require that publication
has occurred. Version 0.1.0 has not been published during preparation. For the
next release, select a new version; published name/version pairs cannot be reused.


## Git-based skills plugin

The npm package remains CLI-only. `plugins/adbdock/` is an instruction-only
plugin with one shared skill and three on-demand references. Its root plugin.json
uses the portable Codex format; .claude-plugin/plugin.json supports Claude Code.
The repository's two marketplace catalogs both point to that same directory.

Before sharing the repository, validate the plugin and marketplace:

```sh
claude plugin validate ./plugins/adbdock --strict
claude plugin validate . --strict
```

Codex can inspect the local catalog without registering/installing it or modifying
user settings (substitute the absolute checkout path):

```sh
codex -c 'marketplaces.adbdock.source_type="local"' \
  -c 'marketplaces.adbdock.source="/ABSOLUTE/CHECKOUT"' \
  plugin list --marketplace adbdock --available --json
```

Check that adbdock@adbdock is available. Once a real Git remote is chosen and
published, users follow README's marketplace installation commands. Installation
and an actual new-session selection check are separate from manifest validation;
validation alone does not prove the model will select a skill. Keep the two plugin
manifest versions consistent and bump them when distributing plugin changes.
The CLI's npm release and the Git plugin can be updated independently.
