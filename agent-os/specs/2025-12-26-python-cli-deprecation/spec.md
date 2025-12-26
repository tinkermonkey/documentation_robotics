# Specification: Python CLI Deprecation

## Goal

Validate complete feature parity between Bun and Python CLIs, deprecate the Python CLI implementation with clear migration path, and safely remove all Python CLI code from the repository to establish Bun CLI as the sole implementation.

## User Stories

- As a Documentation Robotics maintainer, I want to validate that the Bun CLI has complete feature parity with the Python CLI so that I can confidently deprecate the legacy implementation
- As a Documentation Robotics user, I want clear deprecation notices and migration instructions so that I can transition to the Bun CLI without disruption

## Specific Requirements

**Feature Parity Validation via Enhanced Compatibility Tests**

- Extend existing compatibility test suite in `cli-bun/tests/compatibility/` to achieve comprehensive coverage
- Create command-by-command checklist documenting that Bun CLI produces identical model file edits as Python CLI
- Validate model file structure compatibility (highest priority) across all 12 layers
- Validate visualization server API compatibility against `docs/api-spec.yaml` and `docs/visualization-api-annotations-chat.md`
- Ensure all 24 Python commands have equivalent implementations in Bun CLI with matching behavior
- Test all validators (schema, naming, reference, semantic) produce consistent validation results between implementations
- Verify all export formats (ArchiMate XML, OpenAPI JSON, JSON Schema, PlantUML, Markdown, GraphML) produce compatible outputs
- Run compatibility tests to validate that identical inputs produce identical model state changes

**Python CLI Command Coverage Validation**

- Map all Python commands to Bun equivalents: `add.py` → `add.ts`, `annotate.py` (missing in Bun), `changeset.py` → `changeset.ts`, `chat.py` → `chat.ts`, `claude.py` (deprecated), `conformance.py` → `conformance.ts`, `copilot.py` (deprecated), `export.py` → `export.ts`, `find.py` (missing in Bun), `init.py` → `init.ts`, `links.py` (missing in Bun), `list_cmd.py` → `list.ts`, `migrate.py` → `migrate.ts`, `project.py` → `project.ts`, `relationship.py` → `relationship.ts`, `remove.py` → `delete.ts`, `search.py` → `search.ts`, `trace.py` → `trace.ts`, `update.py` → `update.ts`, `upgrade.py` → `upgrade.ts`, `validate.py` → `validate.ts`, `visualize.py` → `visualize.ts`
- Identify and document any missing Bun commands: `annotate`, `find`, `links`
- Ensure command argument compatibility and identical error handling behavior
- Validate that deprecated Python commands (`claude.py`, `copilot.py`) are not needed in Bun CLI
- Test edge cases: missing arguments, invalid values, special characters, Unicode handling, path resolution

**Python CLI Final Deprecation Release**

- Bump Python package version to final release (e.g., `v0.8.0`)
- Add deprecation warning printed to stderr on every Python CLI command execution
- Warning message must include: deprecation notice, Bun CLI installation instructions (`npm install -g @doc-robotics/cli-bun`), migration timeline (1 month until PyPI removal), and link to migration documentation
- Update PyPI package metadata to mark as deprecated with clear migration link
- Publish final Python CLI release to PyPI with deprecation warnings
- Set 1-month timeline before removing package from PyPI entirely

**Documentation Complete Migration to Bun CLI**

- Update main repository README (`/Users/austinsand/workspace/documentation_robotics/README.md`) to reference only Bun CLI
- Update CLAUDE.md (`/Users/austinsand/workspace/documentation_robotics/CLAUDE.md`) to remove all Python CLI references and update "Quick Reference" section
- Update all spec examples in `spec/examples/` directories (microservices, minimal, e-commerce, reference-implementation)
- Update CLI-specific README (`cli-bun/README.md`) to position as primary and only CLI
- Update all tutorials and guides in `/docs/guides/` with Bun CLI syntax
- Update integration documentation in `integrations/claude_code/` and `integrations/github_copilot/` folders (all agents, commands, and skills)
- Create CI/CD integration guide showing Bun CLI usage in GitHub Actions, GitLab CI, CircleCI, and Jenkins
- Update CONTRIBUTING.md to reference only Bun CLI development workflows
- Remove all Python-specific development documentation (no archival - git history is sufficient)

**Safe Removal of Python CLI from Codebase**

- Delete entire `cli/` directory containing Python CLI implementation
- Remove Python-related CI/CD workflows in `.github/workflows/` (pytest jobs, Python test actions in `cli-tests.yml`)
- Remove deprecated GitHub issue templates: `.github/ISSUE_TEMPLATE/bug-report-cli.md`, `.github/ISSUE_TEMPLATE/bug-report-spec.md`, `.github/ISSUE_TEMPLATE/feature-request-cli.md`, `.github/ISSUE_TEMPLATE/feature-request-spec.md`
- Remove Python-related PR templates if they exist
- Keep `spec/` directory entirely intact (no changes to specification)
- Keep `cli-bun/` directory intact as the sole CLI implementation
- Verify no broken links remain in documentation after removal
- Update root `.gitignore` to remove Python-specific entries (`.venv/`, `*.pyc`, `__pycache__/`)

**Readiness Criteria and Success Metrics**

- All compatibility tests in `cli-bun/tests/compatibility/` passing (commands, validation, export, API, edge-cases)
- Command checklist shows 100% parity for all essential commands
- Model file structure changes are byte-for-byte identical for equivalent operations
- Visualization server API responses match specification for both CLIs
- Zero missing Bun implementations for non-deprecated Python commands
- All documentation updated to reference Bun CLI exclusively
- Final Python package published to PyPI with deprecation warnings
- 1-month deprecation period timeline established and documented

**Testing Strategy**

- Run full compatibility test suite: `npm run test:compatibility` in `cli-bun/`
- Execute command-specific compatibility tests: commands, validation, export, API, edge-cases
- Manual testing of missing commands (`annotate`, `find`, `links`) to determine if implementation needed
- Test model file edits produced by identical commands in both CLIs and verify byte-for-byte match
- Validate visualization server responses from both CLIs match API specification
- Test CI/CD integration examples in test pipelines before publishing documentation
- Run pre-commit hooks to ensure code quality before removal

## Visual Design

No visual assets provided for this specification.

## Existing Code to Leverage

**Compatibility Test Suite (`cli-bun/tests/compatibility/`)**

- Harness infrastructure (`harness.ts`) already provides dual CLI execution and output comparison
- Command tests (`commands.test.ts`) validate CLI command output equivalence across 20+ scenarios
- Validation tests (`validation.test.ts`) ensure identical validation behavior for schema, naming, reference integrity
- Export tests (`export.test.ts`) compare semantic equivalence of all 6 export formats
- API tests (`api.test.ts`) validate JSON API response parity for visualization server
- Use existing test structure and extend coverage to all commands and edge cases

**Visualization API Specifications**

- `docs/api-spec.yaml` defines OpenAPI 3.0 specification for visualization server endpoints
- `docs/visualization-api-annotations-chat.md` provides additional API behavior documentation
- Use these specifications to validate that both CLIs serve compatible visualization server APIs
- Test all endpoints (`/api/model`, `/api/layers/:name`, `/api/elements/:id`) for response parity

**Python CLI Commands Directory (`cli/src/documentation_robotics/commands/`)**

- Contains 24 command implementations that must all be replicated in Bun CLI
- Use as reference for command behavior, argument parsing, error handling patterns
- Compare command execution results to ensure Bun implementations produce identical model changes
- Reference validators (`cli/src/documentation_robotics/validators/`) for validation logic parity

**Documentation Files to Update**

- Main README, CLAUDE.md, spec examples, CLI README, all guides in `/docs`, integration files in `/integrations`
- Use existing structure and formatting; only update CLI references from Python to Bun
- Provide CI/CD integration examples for common platforms (GitHub Actions, GitLab CI)
- Update contribution guidelines to reflect Bun-only development workflow

**CI/CD Workflows (`.github/workflows/`)**

- `cli-tests.yml` contains Python pytest jobs that must be removed
- Keep spec validation and Bun CLI test workflows intact
- Ensure compatibility tests run in CI pipeline before deprecation

## Out of Scope

- Automated migration tooling or scripts for users transitioning from Python to Bun CLI
- Backwards compatibility layers or Python wrapper that delegates to Bun CLI via subprocess
- Code migration tools for users importing Python CLI as a library in custom scripts
- Automated CI/CD file scanning or modification tools to update user pipelines
- Archival of Python-specific documentation in legacy folders (git history provides record)
- Visual asset creation for visualization frontend (separate codebase)
- Publishing Bun CLI to npm registry (assumed already done or separate task)
- Performance benchmarking or optimization of Bun CLI (focus is parity, not performance)
- Extended deprecation grace period beyond 1 month (project in alpha stage allows immediate deprecation)
- Support for users continuing to use Python CLI after deprecation period
