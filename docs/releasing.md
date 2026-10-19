# Release guide

The public MIT package targets macOS with Node.js 22+ and separately installed
Android Platform-Tools. `0.0.1` was bootstrapped locally; `0.1.0` and `0.1.1` were
published and verified through npm Trusted Publishing (OIDC).

Release Please manages the CLI version and CHANGELOG in a Release PR. **Merging
that PR approves publication**: the workflow creates its tag and GitHub Release,
validates the release commit and publishes to npm. There is no separate environment
approval. The Git-based skills plugin keeps its independent version workflow.

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

## Release PR workflow

`.github/workflows/release.yml` runs Release Please on pushes to `main`.
The root Node package uses `release-please-config.json` and
`.release-please-manifest.json`; the initial baseline is the published `0.1.1`.
The existing `v0.1.1` release/tag is used to find unreleased commits, so introducing
this setup does not release the old changes again.

1. Merge ordinary feature/fix PRs using a Conventional Commit squash title.
2. Release Please opens or updates one Release PR containing package.json,
   package-lock.json, CHANGELOG.md and its version manifest.
3. Review the proposed version, release notes and CI on the PR's latest commit.
4. Merge the Release PR when ready to publish. Leave it open to collect more changes.
5. The next `Release` run creates `v<version>` and the GitHub Release. Its `publish`
   job checks out the action's exact release SHA, verifies the tag/version match,
   runs checks and package installation tests on macOS/Node.js 24, and publishes
   the packed tarball through OIDC.
6. Verify the workflow, npm version, provenance and installed CLI:

```sh
npm view adbdock version dist.integrity dist.attestations --json --prefer-online
npx adbdock@latest --help
```

No local `npm version`, manual version commit, tag push or Release creation is
needed in the normal flow. The workflow never auto-merges a Release PR.

### Version selection

- `fix:` produces a patch release; `feat:` produces a minor release.
- `!` or `BREAKING CHANGE:` denotes an incompatible change. Before 1.0, it bumps
  the minor version; after 1.0 it bumps the major version.
- Ordinary `docs:`, `test:`, `ci:` and `chore:` changes do not request a release on
  their own; they can be included in a later release.
- Plugin-only changes under `plugins/`, `.agents/` and `.claude-plugin/` are excluded
  from CLI version planning. The existing plugin workflow still handles them.
- To override the calculated next version, add a `Release-As: 0.2.0` footer to a
  normal code-change commit (replace with the intended version). Empty and plugin-only
  commits are excluded by the path filter. Review the updated Release PR before
  merging it. Do not manually change only package.json.

### GitHub permissions and bot CI

Enable **Settings → Actions → General → Allow GitHub Actions to create and approve
pull requests**. This permits bot PR creation; the workflow does not approve or
merge PRs. No PAT, GitHub App credential or NPM_TOKEN is required.

Release management has contents/issues/pull-requests write permissions. Its
`actions: write` permission explicitly dispatches `ci.yml` on each created or
updated Release PR branch. Check the CI run's commit matches the current PR head.
Bot-created PR events can be suppressed or require approval; the dispatched run
avoids relying on that event. If GitHub also shows an approval banner for the
PR-triggered run, approve that run in the PR UI.

The publish job has only contents:read and id-token:write. npm's trusted publisher
still points to `floydkim/adbdock`, **release.yml**, with no environment configured.
The filename is unchanged, so the npm trusted publisher needs no replacement.
Release Please's bot-created Release does not trigger another release workflow;
the action's `release_created`, `sha` and `tag_name` outputs directly select the
publish job in the same run.

### Manual operation and recovery

- Use Actions → **Release** → **Run workflow** on `main` to reconcile an existing
  Release PR or a merged Release PR if a push run did not complete.
- If npm publication fails after a Release was created, check npm first, then
  **re-run failed jobs** on that run. Re-running the entire workflow can cause
  Release Please to see the existing Release and skip publication.
- If npm accepted the package, wait for registry processing; do not publish it
  again. An existing published name/version cannot be replaced.
- A manually published stable GitHub Release still triggers the existing fallback
  publish path. Its tag must match package.json. Drafts and prereleases do not publish.
  Avoid creating it while the automatic path for that version is in progress.

Official references: [Release Please Action](https://github.com/googleapis/release-please-action),
[Conventional Commits and overrides](https://github.com/googleapis/release-please),
[GitHub workflow triggering](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow),
[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).

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
