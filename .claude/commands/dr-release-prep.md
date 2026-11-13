---
description: Prepare a CLI release (and a spec release when the spec changed) on a release branch, up to the PR. Tagging, which publishes to npm, stays a separate step the maintainer confirms.
argument-hint: "<cli-version> [--spec-version <version>]"
---

# Prepare a DR release

Prepares a release of the TypeScript CLI (`@documentation-robotics/cli`), and of the spec when spec
sources changed. It works on a `release/` branch and stops at an open PR. Tagging comes after the
PR merges, and pushing a `cli-v*` tag **is** the npm publish.

Arguments: `$ARGUMENTS`

- `<cli-version>`: the new CLI version, e.g. `0.4.0`. Required.
- `--spec-version <v>`: the new spec version. Give it only when spec sources changed since the last
  `spec-v*` tag (step 2 checks).

## Where versions live

`npx tsx scripts/release-versions.ts` checks all of these and reports what is stale. `--set` writes
the hand-edited ones.

| Location                                                                                | Kind                                                                                 |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `cli/package.json`, `cli/package-lock.json`                                             | `--set` (runs `npm version <v> --no-git-tag-version`); esbuild injects `CLI_VERSION` |
| `integrations/claude_code/.claude-plugin/plugin.json` `version`                         | `--set`; same as the CLI version. The plugin runs the `dr` on PATH                   |
| README badges, CLAUDE.md "Current Versions"                                             | `--set`                                                                              |
| `spec/VERSION`                                                                          | `--set`                                                                              |
| `cli-validation/test-project/baseline/.../manifest.yaml` `spec_version`                 | `--set`                                                                              |
| `spec/dist/**` `specVersion`                                                            | generated: `npm run build:spec` at the root                                          |
| `cli/src/schemas/bundled/**`, `BUNDLED_SPEC_VERSION` in `cli/src/utils/spec-version.ts` | generated: `npm run build` in `cli/` (`scripts/sync-spec-schemas.sh`)                |
| `cli/src/core/migration-registry.ts` latest `toVersion`                                 | by hand, on a spec bump                                                              |
| `cli/CHANGELOG.md`, `spec/CHANGELOG.md` sections                                        | by hand                                                                              |

## Steps

### 1. Start clean

```bash
git checkout main && git pull --ff-only
git status --porcelain            # must be empty
git checkout -b release/cli-<cli-version>[-spec-<spec-version>]
```

Stop if the tree is dirty or main is behind origin.

### 2. Decide the versions

```bash
PREV_CLI=$(git describe --tags --match 'cli-v*' --abbrev=0)
PREV_SPEC=$(git describe --tags --match 'spec-v*' --abbrev=0)
git log --oneline --first-parent "$PREV_CLI"..HEAD          # what the CLI release contains
git diff --stat "$PREV_SPEC"..HEAD -- spec/schemas spec/layers   # did the spec change?
```

- **CLI:** any change to a command, MCP tool, file format or default behaviour is at least a minor
  bump while the CLI is 0.x. A fix-only release is a patch.
- **Spec:** if `spec/schemas` or `spec/layers` changed and no `--spec-version` was given, ask the
  maintainer for one. If the spec didn't change, there is no spec bump and no spec tag.
- Confirm both versions with the maintainer before writing anything (CLAUDE.md: ask before version
  bumps).

### 3. Check the tags are free

```bash
npx tsx scripts/release-versions.ts --cli <cli-version> [--spec <spec-version>] --remote
```

At this point the version rows fail; that is expected. Look at the `origin tag` and `npm` rows:

- If `cli-v<cli-version>` already exists on origin, stop. Show the maintainer what it points at
  (`git ls-remote --tags origin cli-v<v>` and `git log -1 <sha>`). A stale tag from an earlier
  attempt blocked the 0.3.0 release. Never delete or move a tag without the maintainer's OK.
- The new CLI version must be newer than the one published on npm.

### 4. Write the versions

```bash
npx tsx scripts/release-versions.ts --set --cli <cli-version> [--spec <spec-version>]
```

### 5. Spec bump only: migration and generated files

- **Migration entry.** Add a `fromVersion: <previous spec>`, `toVersion: <new spec>` entry to
  `cli/src/core/migration-registry.ts`. Follow the existing entries:
  - Call `applyCatalogMigrations(model)` when relationship types or predicates were retired or
    renamed.
  - Otherwise the step only stamps the version.
  - If a development CLI already stamped real models with the new version, they will skip this step.
    In that case, make the step safe to run again (0.11.0 re-ran the catalog migration for exactly
    this reason).
- **Rewrite table.** In `cli/`, regenerate the relationship rewrite table if a new `applied-*.json`
  record landed: `bun scripts/generate-relationship-migration.ts`, then confirm it with `--check`.
- **Upgrade tests.** Update the expected latest version in
  `cli/tests/integration/upgrade-command.test.ts` (search for the previous spec version).
- **Rebuild.** Run `npm run build:spec` at the root, then `npm run build` in `cli/`.

### 6. Viewer pin

`--remote` prints the bundled viewer (`VIEWER_VERSION` in `cli/scripts/download-viewer.sh`) next to
the latest viewer release. If they differ, ask the maintainer whether this release should bump the
pin. Bumping it means editing the script and rebuilding `cli/`.

### 7. Changelogs

For each changelog being released (`cli/CHANGELOG.md` always, `spec/CHANGELOG.md` on a spec bump):

- Move the `## [Unreleased]` entries into `## [<version>] - <YYYY-MM-DD>`, and leave an empty
  `## [Unreleased]` above it.
- Open the section with a short summary paragraph of what the release is for.
- CLI only: add `**Specification Support:** v<spec version>` under the heading.
- Merge duplicate `### Added` / `### Changed` / `### Fixed` headings. Unreleased entries accumulate
  across PRs and often repeat them.
- Compare against `git log --first-parent "$PREV_CLI"..HEAD`. Add a line for any merged PR with a
  user-visible change that has no entry. Mark breaking changes and what users must do.

### 8. Test baseline

- Copy any integration skill that changed into the baseline's copy, for skills the baseline already
  has. Then run `npm run check:skill-relationships`, which requires the layer skill copies to be
  byte-identical.

  ```bash
  diff -rq integrations/claude_code/skills cli-validation/test-project/baseline/.claude/skills
  ```

- **Commit now.** `npm run test:fs-compatibility` runs
  `git checkout -- cli-validation/test-project/baseline/` when it cleans up, which silently drops
  any uncommitted baseline edit, including the `spec_version` stamp from step 4.

```bash
git add -A && git commit -m "release: CLI <cli-version>[ with spec <spec-version>]"
```

### 9. Validate

Run the `dr-release-preflight` agent with the target versions. It runs the version check, rebuilds
and checks that generated files are unchanged, runs the spec checks and the test suites, and returns
a CLEARED or BLOCKED report. Fix what it reports, amend or add commits, and run it again until it
reports CLEARED (or CLEARED (Linux not run), below).

For reference, its suites are the CLAUDE.md ones:

- in `cli/`: `npm run test:unit`, `npm run test:integration`, `npm run test:smoke`
- at the root: `npm run test:fs-compatibility`
- in `cli/`: `npm run test:linux`, the integration suite again, in a Linux container set up like the
  release workflow's test gate (`cli/scripts/test-linux.sh`). It tests the committed HEAD, so it
  runs after step 8's commit. It needs Docker and takes several minutes.

The tag's release workflow runs the full `npm test` on Linux (ubuntu, Bun) and a fresh
`npm install -g` of the packed tarball before it publishes, so a failure there stops the publish.
The macOS suites don't catch Linux-only failures: in 0.4.0 the preflight cleared on the Mac and the
tag's run failed on Linux (a Bun `fs.watch` test and a colour-output test, fixed in #1073). That is
what the Linux run is for.

A failing Linux run is a BLOCKED preflight. If Docker isn't available, the preflight reports the
Linux run as **not run**. That doesn't clear on its own: tell the maintainer, and go on only if they
accept tagging without it, and say so in the PR body. Otherwise run `npm run test:linux` on a
machine with Docker before tagging.

### 10. Open the PR

```bash
git push -u origin HEAD
gh pr create --title "release: CLI <cli-version>[ with spec <spec-version>]" --body "<summary, versions, preflight result, the tag commands from step 11>"
```

Report the PR link and stop. Merging is the maintainer's call.

### 11. After the PR merges: tag (maintainer confirms)

Tag the merge commit on main. **Pushing a `cli-v*` tag runs `.github/workflows/release.yml`, which
publishes to npm.** Ask the maintainer before pushing, and push the spec tag first.

Before tagging, confirm the Linux run passed: the preflight reported `npm run test:linux` as ok, or
the maintainer explicitly accepted it as not run. If commits landed on the branch after the
preflight, or the merge commit differs from what it tested (main moved), run it again on the merge
commit:

```bash
(cd cli && npm run test:linux)   # must end with "test:linux: PASSED"
```

A failure here means the tag's release run would fail too. Fix it on a new PR before tagging.

```bash
git checkout main && git pull --ff-only
MERGE=$(git rev-parse HEAD)            # the release PR's merge commit
git tag spec-v<spec-version> "$MERGE"  # spec bump only
git push origin spec-v<spec-version>   # spec GitHub release (schemas tarball)
git tag cli-v<cli-version> "$MERGE"
git push origin cli-v<cli-version>     # test gate, then npm publish and GitHub release
```

Then:

- Watch the run: `gh run list --workflow release.yml -L 2`.
- Confirm the publish: `npm view @documentation-robotics/cli version`.
- Plugin users get the new plugin version with `claude plugin marketplace update documentation-robotics`,
  then `claude plugin update dr@documentation-robotics`.

## Rules

- Never push a tag, publish, or delete or move a tag without the maintainer's explicit OK.
- Don't edit `spec/dist/` or `cli/src/schemas/bundled/` by hand; rebuild them.
- Don't tag with a failing Linux run, and don't tag without one unless the maintainer accepted
  that explicitly.
- Don't skip a failing suite. Report it. Known environment-only failures (analyzer tests that need
  a local `codebase-memory-mcp`, chat tests that need `claude`/`copilot` on PATH) must be named as
  such in the PR, with the reason.
