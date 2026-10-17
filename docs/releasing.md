# Release guide

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

The tarball contains `dist/*.js`, README.md, README.ko.md, LICENSE and npm's required package.json.
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

The source repository is https://github.com/floydkim/adbdock. Before npm publication,
set repository/homepage/bugs metadata to match that source. The package's JavaScript
and README are public under MIT once published.

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

The npm CLI and the Git-based plugin have independent versions. Both Claude Code
and Codex use the same skill files, so these manifests must have the same plugin
name and version:

- `plugins/adbdock/plugin.json` — portable Codex manifest
- `plugins/adbdock/.claude-plugin/plugin.json` — Claude Code manifest

The two marketplace catalogs point to `plugins/adbdock/` in this repository.
No separate upload or npm publication is needed for this Git distribution.
Plugin updates are versioned automatically after a successful CI run on `main`. Existing users must
refresh their installation; a push does not immediately update every client.

### Automatic plugin releases

Change the plugin instructions, references or metadata and commit normally.
PRs validate the manifests, marketplaces and local Markdown references; they do
not require a manual version increase. A version decrease is still rejected.

After a `main` push passes both CI jobs, the version job:

1. Checks that `main` still points to the commit that passed CI. A newer commit
   is left for its own CI run to handle.
2. Compares the plugin directory with the commit that introduced its current version.
3. If there are pending changes, increases the patch version in both manifests,
   validates the result and pushes a bot commit to `main`.

Comparing against the version's history also catches plugin changes from an
interrupted run followed by a CLI-only push. A manual version increase that
includes the changes is already a release, so it is not increased again.
The bot's version-only commit is also treated as released. Its `GITHUB_TOKEN`
push does not trigger another push workflow, preventing a CI loop.

The version job alone has `contents: write`; PR checks remain read-only.
The branch must allow this bot push. Updates use ordinary pushes, never force
pushes. If another commit arrives during the push, the push is rejected and the
new commit's successful CI can handle the remaining changes.
No CLI/npm version, package-lock, tag or GitHub Release is changed.

### Manual version selection and local checks

Patch updates are automatic. To choose a minor or major version deliberately:

```sh
npm run version:plugin -- minor
npm run check
```

`version:plugin` updates both manifests together. It also accepts `patch`, `major`
or an explicit version such as `0.2.0`. Only stable `major.minor.patch` versions
are accepted, and the new version must be greater than the current one.
The command does not commit, create tags or push.

`npm run check:plugin` validates names/versions, marketplace paths and local
Markdown references; it also runs as part of `npm run check`. To use Claude Code's
own validator when available:

```sh
claude plugin validate ./plugins/adbdock --strict
claude plugin validate . --strict
```

GitHub Releases and tags are optional for the current Git marketplace setup.
GitHub's [workflow triggering rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow)
explain the bot token behavior.

### User updates and verification

See the [usage guide](usage.md#working-with-coding-agents) for update commands.
Test the installed plugin in a new session; JSON validation alone does not prove
that a client refreshed its cache or that the agent will select the skill.

Official behavior: [Claude Code version handling](https://code.claude.com/docs/en/plugins-reference#version)
and [Codex Git marketplace refresh](https://developers.openai.com/plugins/build/plugins#add-a-marketplace-from-the-cli).
