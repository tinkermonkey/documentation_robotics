# GitHub Workflows

| File                    | Name                   | Triggers                                                                                                                                                                                                            |
| ----------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli-tests.yml`         | CLI Tests              | pull_request, workflow_dispatch                                                                                                                                                                                     |
| `release.yml`           | Release                | push                                                                                                                                                                                                                |
| `ts-cli-regression.yml` | CLI Regression Suite   | workflow_dispatch                                                                                                                                                                                                   |
| `validate-docs.yml`     | Validate Documentation | workflow_dispatch, # pull_request, # paths, # - "spec/schemas/base/**", # - "spec/schemas/_.schema.json", # - "spec/layers/_.layer.json", # - "spec/nodes/**/\*.node.json", # - "scripts/generate-layer-reports.ts" |

## CLI Tests (`cli-tests.yml`)

Runs on every pull request against `main` and on manual dispatch.

- **Build & Smoke Tests**: installs the CLI, builds it, runs lint and the curated smoke suite
  (`cli/tests/ci-smoke.manifest.ts`, what `npm run test:smoke` runs locally).
- **Validate Specification and Schemas**: JSON Schema syntax for every node and relationship
  schema, markdown lint, and the check that `cli/src/schemas/bundled/` matches `spec/dist/`.
- **Comprehensive Tests**: visualization and performance suites; runs on manual dispatch only.

The full regression suite runs locally (`npm test` in `cli/`); CI is a smoke check. See
`CLAUDE.md`, "Testing".

## Other workflows

The remaining workflows run on manual dispatch (or on push for the release workflow); trigger
them from the Actions tab or with:

```bash
gh workflow run <file> --ref <branch>
```

## History

Specification validation used to live in `spec-validation.yml`; it was consolidated into the
`spec-validation` job of `cli-tests.yml` and the old file removed on 2026-10-28. Pull-request
triggers were disabled for a period while pre-commit hooks were set up; `cli-tests.yml` has run
on pull requests since PR #974.
