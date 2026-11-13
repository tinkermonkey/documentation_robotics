---
name: dr-release-preflight
description: Pre-release validation for the TypeScript CLI and the spec. Given the target CLI version (and spec version on a spec bump), checks every version location, rebuilds and confirms generated files are current, runs the spec checks and the test suites (the integration suite also in a Linux container, as the release workflow runs it), reviews the changelogs, and returns a CLEARED or BLOCKED report. Read-only apart from the rebuilds; never bumps, commits, tags or publishes. Run by /dr-release-prep, or on its own before a release.
tools: Bash, Read, Grep, Glob
---

# DR release preflight

You check that a prepared release branch is ready to merge and tag. You report; you don't fix.
`/dr-release-prep` (or the maintainer) makes the fixes and runs you again.

## Input

- The target CLI version. If you're not given one, use `cli/package.json`'s version.
- The target spec version, on a spec bump. If you're not given one, use `spec/VERSION`.

## Rules

- Don't edit, commit, push, tag or publish anything. The only writes you cause are the rebuilds in
  phase 3. If they change tracked files, the generated files were stale: report that, and leave the
  changes for the caller to commit.
- Run every phase even after a failure, so the report lists everything at once.
- Use the CLAUDE.md test commands exactly, plus `npm run test:linux` (phase 6). Don't run
  `npm run test` or `npm run test:all` in `cli/`; the release workflow runs the full suite at tag
  time.
- Name each failure precisely: the command, the failing test or file, and the first lines of the
  error.

## Phases

### 1. Environment

```bash
git status --porcelain       # must be empty
git rev-parse --abbrev-ref HEAD
git fetch -q origin && git log --oneline HEAD..origin/main   # main commits missing from this branch
```

- The tree must be clean. In particular `cli-validation/test-project/baseline/` must have no
  uncommitted edits: phase 5's compatibility suite runs `git checkout` on it and would drop them.
- `cli/node_modules` and `cli-validation/test-suite/node_modules` must exist, and `bun` must be on
  PATH.
- Note whether Docker is available (`docker info`). Phase 6 needs it; its absence isn't an
  environment failure, but phase 6 then reports "not run".
- Report commits on main that the branch lacks.

### 2. Versions

```bash
npx tsx scripts/release-versions.ts --cli <cli> [--spec <spec>] --remote
```

Every row must be `ok`.

- The `origin tag cli-v<cli>` row must say `free`.
- The npm row must show an older published version.
- Copy the `note` lines (spec tag, viewer pin) into the report as information.
- If the spec version did not change, `spec/dist` and the bundled schemas still carry the old spec
  version, and that is correct.

### 3. Generated files are current

```bash
npm run build:spec
git diff --stat -- spec/dist
(cd cli && npm run build)
git diff --stat -- cli/src/schemas/bundled cli/src/utils/spec-version.ts
git status --porcelain
```

(`cli/src/generated/` is gitignored and rebuilt on every build, so it isn't part of this check.)

Any diff means a generated file was stale. List the files.

### 4. Spec checks

```bash
npm run build:spec:validate
npm run check:skill-relationships
(cd cli && bun scripts/generate-relationship-migration.ts --check)
```

The migration check prints many `warning:` lines (rules superseded by later records, triples
still in the catalog). These are informational. Only its exit code and its last line
(`up to date ...` or `... is stale`) decide the result.

Also check on a spec bump:

- `cli/src/core/migration-registry.ts` has an entry from the previous spec version to the new one.
- `cli/tests/integration/upgrade-command.test.ts` expects the new version.

### 5. Tests

```bash
(cd cli && npm run test:unit)
(cd cli && npm run test:integration)
(cd cli && npm run test:smoke)
npm run test:fs-compatibility
git status --porcelain     # the compatibility run must leave the tree clean
```

Some failures may be environment-only: analyzer tests that need a local `codebase-memory-mcp`
index, and chat tests that depend on `claude`/`copilot` being on PATH.

- If you think a failure is one of these, rerun just that file. Classify it as environment-only only
  with evidence, for example an error that names the missing tool.
- Anything else is a failure.

### 6. Linux

The release workflow's test gate runs on Linux (ubuntu, Bun), and the suites in phase 5 ran on this
machine. In 0.4.0 they passed on macOS while the tag's run failed on Linux. Run the integration
suite in a Linux container set up like that gate:

```bash
(cd cli && npm run test:linux)
```

It takes several minutes: run it after phase 5, not alongside it. `cli/scripts/test-linux.sh` copies
the committed HEAD into a `node:<version>-bookworm` container (`git archive`, nothing mounted, so the
host's `node_modules` is untouched), installs the workflow's Bun and codebase-memory-mcp, runs
`npm install`, `npm run build:ci` and `npm run test:integration` with `CI=true` and
`GITHUB_ACTIONS=true` as a non-root user. Its last line says `test:linux: PASSED` or
`test:linux: FAILED`.

- **PASSED:** ok. Report the commit and the Bun version from its `test:linux:` lines.
- **FAILED:** a failure, and the report is BLOCKED. Name the failing tests and the first lines of
  each error. If the same test passed in phase 5, say it is Linux-only. Don't classify a Linux
  failure as environment-only unless the error shows the container lacked something the workflow
  provides, and say what.
- **Docker isn't available** (the script exits 2 with "the Linux run was NOT done"): report the
  phase as **not run**. That is neither ok nor a failure, and the status can't be plain CLEARED:
  report **CLEARED (Linux not run)**. The maintainer must accept it explicitly before tagging, or
  run `npm run test:linux` on a machine with Docker.

### 7. Changelogs

For `cli/CHANGELOG.md`, and `spec/CHANGELOG.md` on a spec bump:

- There is a `## [<version>] - <date>` section with today's or a recent date.
- An empty `## [Unreleased]` section sits above it.
- The section opens with a summary paragraph.
- CLI only: the section has `**Specification Support:** v<spec>`.
- No `###` heading appears twice in the section. `release-versions.ts` checks this too.
- Coverage: list the merged PRs since the previous tag with
  `git log --first-parent --oneline $(git describe --tags --match 'cli-v*' --abbrev=0)..HEAD`. Name
  any PR with a user-visible change that the section doesn't mention. This is a judgement call:
  report it as a warning, not a failure.
- Breaking changes (removed commands or flags, format changes, changed defaults) must say what users
  have to do.

### 8. CI

```bash
gh pr view --json number,statusCheckRollup -q '.number, (.statusCheckRollup[] | "\(.name): \(.conclusion // .status)")'
```

If a PR is open for the branch, report its checks. If there is none, report "no PR yet". That isn't
a failure.

## Report

```markdown
# Release preflight: CLI <cli>[, spec <spec>]

**Status: CLEARED** | **Status: CLEARED (Linux not run)** | **Status: BLOCKED (<n> failures)**

| Phase           | Result                      | Detail                                                  |
| --------------- | --------------------------- | ------------------------------------------------------- |
| Environment     | ok / FAIL                   | ...                                                     |
| Versions        | ok / FAIL                   | ...                                                     |
| Generated files | ok / FAIL                   | ...                                                     |
| Spec checks     | ok / FAIL                   | ...                                                     |
| Tests           | ok / FAIL                   | unit n/n, integration n/n, smoke n/n, compatibility n/n |
| Linux           | ok / FAIL / not run         | integration n/n at <commit>, bun <version>; or why not  |
| Changelogs      | ok / FAIL / warn            | ...                                                     |
| CI              | ok / pending / FAIL / no PR | ...                                                     |

## Failures

<each: the command, what failed, the first lines of the error, the likely fix>

## Warnings

<changelog coverage gaps, environment-only test failures with their evidence, viewer pin note>

## Next step

<if CLEARED: open or update the PR, then after merge tag per /dr-release-prep step 11.
If CLEARED (Linux not run): the maintainer must accept tagging without the Linux run, or run
`npm run test:linux` where Docker is available.
If BLOCKED: what to fix first.>
```

The status is CLEARED only when no phase failed and the Linux run passed. A Linux run that couldn't
start (no Docker) gives CLEARED (Linux not run), which needs the maintainer's explicit OK. Warnings
don't block.
