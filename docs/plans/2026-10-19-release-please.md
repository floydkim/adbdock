# Release Please implementation plan

Goal: maintain a CLI Release PR from Conventional Commits; merging it creates a
GitHub Release and publishes the validated artifact through existing npm OIDC.

1. Configure the root Node package at the published 0.1.1 baseline. Keep v-prefixed
   tags; exclude Git-based plugin changes from CLI release planning.
2. Extend release.yml with Release Please and explicit CI dispatch for its PRs.
   Publish using the action's release SHA/tag in the same workflow. Retain manual
   GitHub Release publication and failed-job retries; preserve the trusted filename.
3. Document merge-as-release approval, version rules, bot permissions, verification
   and recovery. Do not merge automatically or publish a new npm version during setup.
4. Validate workflow syntax and configuration, run read-only Release Please plans
   against the real repository, exercise version scenarios and run existing checks.
5. Propose the commit message for approval before committing/pushing. Enable the
   repository's bot PR permission when activating the reviewed configuration.

Use the default GITHUB_TOKEN; no PAT or GitHub App setup. Explicit CI dispatch is
needed because bot events may suppress downstream runs or require approval.
The publish job keeps contents:read and id-token:write; only release management
gets contents/issues/pull-requests write, and CI dispatch gets actions:write.
