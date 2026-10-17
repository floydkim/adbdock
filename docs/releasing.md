# Release guide

The first local bootstrap release is `adbdock@0.0.1`; the first planned OIDC
release is `0.1.0`. The package is public under MIT.
The `0.0.1` bootstrap was published from the reviewed tarball; registry integrity
and `npm exec` help from outside the checkout were verified. Trusted publishing
is configured for `floydkim/adbdock`, workflow `release.yml`, with direct publishing
allowed. The first real OIDC publication remains to be verified with `0.1.0`. It is intended
for macOS with Node.js 22+ and separately installed Android Platform-Tools.
`.github/workflows/release.yml` publishes stable GitHub Releases through npm
Trusted Publishing (OIDC). Preparing or pushing the workflow does not publish a
package. Publication requires both the npm trusted publisher setup below and a
GitHub Release event.

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
--dry-run`. The dry-run uses offline mode and a fresh temporary cache so already
published versions can still be checked; it does not validate version availability
or authentication. Installation checks need registry access for dependencies.
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
npm publish ./adbdock-0.0.1.tgz --dry-run
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

The source repository is https://github.com/floydkim/adbdock. The repository,
homepage and issue URLs are recorded in package.json. The package's JavaScript
and README are public under MIT once published.

## First publication and trusted publisher setup

npm requires the package to exist before configuring its trusted publisher.
For a simple bootstrap, publish the first reviewed version locally using your
personal npm account. This is a real public release; execute it only when ready:

```sh
npm login
npm whoami
npm publish ./adbdock-0.0.1.tgz --access public
```

Use the tarball produced by the checks above, substituting its actual version.
Complete npm's interactive authentication/2FA prompts. Never commit credentials.
A successful dry-run does not prove package ownership or publishing permission.
If you prefer not to publish the full initial version yet, npm also supports
[staged publishing](https://docs.npmjs.com/staged-publishing/), which creates a
public `0.0.0-stage` placeholder for a new package. It still requires an initial
authenticated setup; it is not a way to bootstrap entirely through OIDC.

Once the package exists, open its npm Settings → Trusted Publisher and register:

| npm field | Value |
|---|---|
| Provider | GitHub Actions |
| Organization or user | `floydkim` |
| Repository | `adbdock` |
| Workflow filename | `release.yml` |
| Environment | Leave blank; the workflow does not use a GitHub environment |
| Allowed actions | Enable direct publishing with `npm publish` |

Do not enter `.github/workflows/release.yml` as the filename. The workflow must
already be present in the repository. A new trusted publisher must complete its
first successful OIDC publish within two days; otherwise delete the expired
configuration and recreate it when ready. No `NPM_TOKEN` secret is needed.

After confirming OIDC works, npm's "Require two-factor authentication and disallow
tokens" setting can disable traditional publish tokens without disabling OIDC.

## Publish from GitHub

For the initial rollout, publish `0.0.1` locally, configure the trusted publisher,
then prepare the first OIDC release:

```sh
npm version 0.1.0 --no-git-tag-version
```

Review, commit and push it, then publish GitHub Release `v0.1.0`. Do not reuse
`v0.0.1` for the first OIDC run; npm cannot publish the same name/version twice.

For later stable CLI releases:

1. Update the CLI version with `npm version patch --no-git-tag-version` (or choose
   a minor/major version). This updates package.json and package-lock.json, not
   the independent plugin version.
2. Run the checks, review and commit the changes, then push to `main`.
3. Create and publish a GitHub Release targeting that commit, with a tag exactly
   matching `v<package-version>`, such as `v0.1.0`. A draft or prerelease does not publish.

The release workflow checks out the release commit and uses macOS/Node.js 24 so
macOS-specific tests run. It disables npm caching, checks the tag/version match,
runs `npm ci`, all checks and the package installation checks, then packs and
publishes the tarball. Only the publish job has `id-token: write`; no long-lived
npm credential is configured. npm generates provenance automatically for this
public package/repository when publishing with OIDC.

Publishing a GitHub Release is the deployment trigger, not merely pushing `main`
or a tag. `plugin-v...` releases are ignored. Editing an existing Release does not
retry the workflow; use Actions → Re-run jobs if the package was not published.
A published name/version cannot be reused. If npm accepted the package before a
workflow failure, check the registry before retrying.

Verify the published version:

```sh
npm view adbdock version dist.integrity --json
npx adbdock@latest --help
```

A dry-run does not validate OIDC authentication. The first real GitHub publication
is needed to confirm the npm trust configuration. Until then, no OIDC publication
should be reported as verified.

Official references: [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/),
[initial package requirement](https://docs.npmjs.com/cli/v11/commands/npm-trust/#prerequisites).

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
