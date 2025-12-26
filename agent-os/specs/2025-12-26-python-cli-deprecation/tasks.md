# Task Breakdown: Python CLI Deprecation

## Overview

Total Tasks: 48 tasks across 5 major phases

## Task List

### Phase 1: Feature Parity Validation & Testing

#### Task Group 1: Command Inventory & Gap Analysis

**Dependencies:** None
**Estimated Effort:** 4-6 hours

- [ ] 1.0 Complete command inventory and gap analysis
  - [ ] 1.1 Audit all Python CLI commands in `cli/src/documentation_robotics/commands/`
    - Create comprehensive list of all 24 Python commands
    - Document command arguments, flags, and options for each
    - Identify command categories: core, AI integration, deprecated
  - [ ] 1.2 Map Python commands to Bun equivalents
    - Cross-reference with Bun CLI commands in `cli-bun/src/commands/`
    - Document mapping: `add.py` → `add.ts`, `remove.py` → `delete.ts`, etc.
    - Flag any naming differences or behavioral variations
  - [ ] 1.3 Identify missing Bun implementations
    - Create list of missing commands: `annotate`, `find`, `links`
    - Determine if missing commands are essential or can be excluded
    - Document decision for each missing command with rationale
  - [ ] 1.4 Verify deprecated commands are not needed
    - Confirm `claude.py` and `copilot.py` are deprecated in Python
    - Verify these commands are not required in Bun CLI
    - Document deprecation timeline and reasoning
  - [ ] 1.5 Create command parity checklist
    - Build checklist in markdown format showing all commands
    - Include columns: Python Command, Bun Command, Status, Notes
    - Save to `agent-os/specs/2025-12-26-python-cli-deprecation/command-parity-checklist.md`

**Acceptance Criteria:**

- Complete inventory of all 24 Python CLI commands
- Mapping document showing Python → Bun command equivalents
- Decision recorded for each missing command (implement, exclude, or document as not needed)
- Command parity checklist created and saved

#### Task Group 2: Compatibility Test Suite Enhancement - Commands

**Dependencies:** Task Group 1
**Estimated Effort:** 8-12 hours

- [ ] 2.0 Enhance command compatibility tests
  - [ ] 2.1 Review existing command tests in `cli-bun/tests/compatibility/commands.test.ts`
    - Analyze current test coverage (~20 scenarios)
    - Identify gaps in command testing
    - Document commands lacking test coverage
  - [ ] 2.2 Extend tests for all core commands
    - Add tests for: `init`, `add`, `update`, `delete`, `list`
    - Test all argument combinations and flag variations
    - Verify identical model file edits between CLIs
    - Test error handling for invalid arguments
  - [ ] 2.3 Add tests for relationship management commands
    - Test: `relationship add`, `relationship remove`, `relationship list`
    - Verify relationship registry updates identically
    - Test cross-layer reference validation
  - [ ] 2.4 Add tests for project and changeset commands
    - Test: `project`, `changeset`, `migrate`, `upgrade`
    - Verify manifest updates match between CLIs
    - Test version migration behavior
  - [ ] 2.5 Add tests for query commands
    - Test: `search`, `trace`, `list`, `find` (if implemented)
    - Verify identical output formatting
    - Test complex queries and filtering
  - [ ] 2.6 Add tests for annotation and linking (if applicable)
    - Test: `annotate`, `links` (if implemented in Bun)
    - If not implemented, document as out of scope
  - [ ] 2.7 Test edge cases for all commands
    - Missing required arguments
    - Invalid values (negative numbers, empty strings, special characters)
    - Unicode handling in element names and descriptions
    - Path resolution (relative vs. absolute paths)
    - Model directory not initialized
  - [ ] 2.8 Run enhanced command compatibility tests
    - Execute: `npm run test:compatibility` in `cli-bun/`
    - Verify all command tests pass
    - Document any failures with detailed analysis

**Acceptance Criteria:**

- All 20+ core commands have compatibility test coverage
- Edge cases tested for argument validation and error handling
- All enhanced command tests pass
- Test coverage documented in test suite

#### Task Group 3: Compatibility Test Suite Enhancement - Validators

**Dependencies:** Task Group 1
**Estimated Effort:** 6-8 hours

- [ ] 3.0 Enhance validator compatibility tests
  - [ ] 3.1 Review existing validation tests in `cli-bun/tests/compatibility/validation.test.ts`
    - Analyze current schema, naming, reference validation tests
    - Identify missing validation scenarios
  - [ ] 3.2 Add schema validation tests for all 12 layers
    - Test validation of valid and invalid element schemas
    - Verify identical error messages between CLIs
    - Test schema validation for: motivation, business, security, application, technology, api, data-model, data-store, ux, navigation, apm, testing
  - [ ] 3.3 Add naming convention validation tests
    - Test: `{layer}-{type}-{kebab-case-name}` enforcement
    - Verify identical error messages for invalid names
    - Test special characters, Unicode, and edge cases
  - [ ] 3.4 Add reference validation tests
    - Test cross-layer reference integrity (higher → lower layers)
    - Test invalid references (non-existent targets)
    - Test circular dependency detection
  - [ ] 3.5 Add semantic validation tests
    - Test business rule validation (layer-specific rules)
    - Verify identical validation results
    - Test validation error message consistency
  - [ ] 3.6 Test validation error reporting consistency
    - Compare error message format and content
    - Verify exit codes match for validation failures
    - Test JSON output format for programmatic validation
  - [ ] 3.7 Run enhanced validator compatibility tests
    - Execute validator-specific tests
    - Verify all validation tests pass
    - Document any validation behavior differences

**Acceptance Criteria:**

- All 4 validator types (schema, naming, reference, semantic) have comprehensive test coverage
- Validation error messages are identical between CLIs
- All enhanced validator tests pass
- Validation behavior parity confirmed

#### Task Group 4: Compatibility Test Suite Enhancement - Export Formats

**Dependencies:** Task Group 1
**Estimated Effort:** 6-8 hours

- [ ] 4.0 Enhance export format compatibility tests
  - [ ] 4.1 Review existing export tests in `cli-bun/tests/compatibility/export.test.ts`
    - Analyze current export format test coverage
    - Identify missing export format tests
  - [ ] 4.2 Add ArchiMate XML export tests
    - Test export of layers 1, 2, 4, 5 (motivation, business, application, technology)
    - Verify semantic equivalence of XML output
    - Test ArchiMate 3.2 compliance for both CLIs
  - [ ] 4.3 Add OpenAPI JSON export tests
    - Test layer 6 (API) export to OpenAPI 3.0
    - Verify JSON structure matches specification
    - Test endpoint definitions, parameters, schemas
  - [ ] 4.4 Add JSON Schema export tests
    - Test layer 7 (Data Model) export to JSON Schema Draft 7
    - Verify schema definitions match
    - Test entity relationships and validations
  - [ ] 4.5 Add PlantUML export tests
    - Test diagram generation for all layers
    - Verify PlantUML syntax correctness
    - Test visual representation consistency
  - [ ] 4.6 Add Markdown export tests
    - Test documentation export for all layers
    - Verify markdown formatting and structure
    - Test completeness of exported documentation
  - [ ] 4.7 Add GraphML export tests
    - Test graph visualization export
    - Verify GraphML structure and node/edge definitions
    - Test dependency graph representation
  - [ ] 4.8 Run enhanced export compatibility tests
    - Execute all export format tests
    - Verify semantic equivalence (not byte-for-byte match)
    - Document any format differences with justification

**Acceptance Criteria:**

- All 6 export formats have comprehensive test coverage
- Semantic equivalence verified for all formats
- All enhanced export tests pass
- Export format parity confirmed

#### Task Group 5: Compatibility Test Suite Enhancement - Visualization API

**Dependencies:** Task Group 1
**Estimated Effort:** 6-8 hours

- [ ] 5.0 Enhance visualization API compatibility tests
  - [ ] 5.1 Review API specification documents
    - Read `docs/api-spec.yaml` (OpenAPI 3.0 spec)
    - Read `docs/visualization-api-annotations-chat.md` (additional API behavior)
    - Document all API endpoints and expected responses
  - [ ] 5.2 Review existing API tests in `cli-bun/tests/compatibility/api.test.ts`
    - Analyze current API endpoint test coverage
    - Identify missing endpoint tests
  - [ ] 5.3 Add tests for `/api/model` endpoint
    - Test GET request returning full model metadata
    - Verify JSON response structure matches spec
    - Test response field completeness (manifest, layers, stats)
  - [ ] 5.4 Add tests for `/api/layers/:name` endpoint
    - Test GET requests for all 12 layers
    - Verify layer data structure matches spec
    - Test element arrays and metadata
  - [ ] 5.5 Add tests for `/api/elements/:id` endpoint
    - Test GET requests for individual elements
    - Verify element data structure matches spec
    - Test relationships and references in response
  - [ ] 5.6 Add tests for WebSocket API (if applicable)
    - Test real-time update notifications
    - Verify message format consistency
    - Test connection lifecycle
  - [ ] 5.7 Test API error responses
    - Test 404 for non-existent layers/elements
    - Test 400 for invalid requests
    - Verify error message format consistency
  - [ ] 5.8 Run enhanced API compatibility tests
    - Execute all API endpoint tests
    - Verify JSON response parity
    - Document any API response differences

**Acceptance Criteria:**

- All API endpoints tested against specification
- JSON response structures match between CLIs
- All enhanced API tests pass
- Visualization server API parity confirmed

#### Task Group 6: Model File Structure Compatibility (HIGHEST PRIORITY)

**Dependencies:** Task Groups 2, 3, 4, 5
**Estimated Effort:** 10-12 hours

- [ ] 6.0 Validate model file structure compatibility
  - [ ] 6.1 Create comprehensive model editing test scenarios
    - Design test cases covering all CRUD operations
    - Include scenarios with: all 12 layers, all element types, relationships, references
    - Document expected model file structure for each scenario
  - [ ] 6.2 Test identical commands produce identical model files
    - Execute same command sequence in Python and Bun CLIs
    - Compare `.dr/manifest.json` files byte-for-byte
    - Compare `.dr/layers/{layer-name}.json` files byte-for-byte
  - [ ] 6.3 Test element creation and updates
    - Add elements using both CLIs
    - Verify element JSON structure matches exactly
    - Test all element fields: id, name, type, description, properties, relationships
  - [ ] 6.4 Test relationship and reference creation
    - Add relationships and references using both CLIs
    - Verify relationship arrays match exactly
    - Test reference integrity in both CLIs
  - [ ] 6.5 Test element deletion and cleanup
    - Delete elements using both CLIs
    - Verify element removal from layer files
    - Test orphaned reference cleanup behavior
  - [ ] 6.6 Test manifest updates
    - Modify manifest fields using both CLIs
    - Verify version, name, description updates match
    - Test timestamp formatting consistency
  - [ ] 6.7 Test model migration and upgrade
    - Run `migrate` and `upgrade` commands
    - Verify model structure after migration matches
    - Test backwards compatibility handling
  - [ ] 6.8 Validate file format consistency
    - Test JSON formatting (indentation, whitespace, property order)
    - Verify UTF-8 encoding handling
    - Test handling of special characters in element data
  - [ ] 6.9 Run comprehensive model file compatibility tests
    - Execute full test suite for model file operations
    - Verify byte-for-byte equivalence where expected
    - Document any acceptable differences (e.g., timestamp precision)

**Acceptance Criteria:**

- Identical commands produce byte-for-byte identical model files
- All CRUD operations tested across all 12 layers
- Manifest and layer file structures match exactly
- All model file compatibility tests pass

#### Task Group 7: Test Suite Reliability & Documentation

**Dependencies:** Task Groups 2, 3, 4, 5, 6
**Estimated Effort:** 4-6 hours

- [ ] 7.0 Ensure test suite reliability and document results
  - [ ] 7.1 Run full compatibility test suite multiple times
    - Execute: `npm run test:compatibility` at least 5 times
    - Verify tests pass consistently (no flaky tests)
    - Document any intermittent failures
  - [ ] 7.2 Fix any flaky or unreliable tests
    - Identify tests with inconsistent results
    - Add proper timeouts, cleanup, or isolation
    - Re-run to confirm reliability
  - [ ] 7.3 Document test coverage metrics
    - Count total compatibility tests
    - Document coverage by category: commands, validators, exports, API, model files
    - Calculate coverage percentage for each category
  - [ ] 7.4 Create test execution guide
    - Document how to run compatibility tests
    - Provide troubleshooting steps for common failures
    - Save to `cli-bun/tests/compatibility/README.md`
  - [ ] 7.5 Update command parity checklist with test results
    - Mark each command as "Tested" or "Not Tested"
    - Document any commands that failed compatibility tests
    - Provide resolution plan for failures
  - [ ] 7.6 Generate final readiness report
    - Summarize all test results
    - Confirm model file structure compatibility (highest priority)
    - Confirm visualization API compatibility
    - Document readiness criteria satisfaction
    - Save to `agent-os/specs/2025-12-26-python-cli-deprecation/readiness-report.md`

**Acceptance Criteria:**

- Full compatibility test suite runs reliably with 100% pass rate
- Test coverage documented for all categories
- Test execution guide created
- Final readiness report confirms all criteria met

### Phase 2: Python CLI Final Release & Deprecation

#### Task Group 8: Python Package Version Bump & Deprecation Warning

**Dependencies:** Phase 1 complete (Task Groups 1-7)
**Estimated Effort:** 3-4 hours

- [ ] 8.0 Prepare Python CLI final deprecation release
  - [ ] 8.1 Bump Python package version
    - Update version in `cli/pyproject.toml` to `0.8.0` (final release)
    - Update version in `cli/src/documentation_robotics/__init__.py`
    - Document version bump in `cli/CHANGELOG.md`
  - [ ] 8.2 Add deprecation warning to CLI entry point
    - Edit `cli/src/documentation_robotics/cli.py`
    - Add deprecation notice printed to stderr on every command
    - Warning must include: deprecation notice, Bun CLI installation instructions, 1-month timeline, migration doc link
    - Example format: "WARNING: The Python CLI is deprecated and will be removed from PyPI on [DATE]. Please migrate to the Bun CLI: npm install -g @doc-robotics/cli-bun. Migration guide: [URL]"
  - [ ] 8.3 Test deprecation warning displays correctly
    - Run Python CLI commands: `dr --help`, `dr init`, `dr validate`
    - Verify warning prints to stderr before each command execution
    - Verify warning does not interfere with command output (stdout)
  - [ ] 8.4 Create deprecation timeline document
    - Document deprecation announcement date
    - Set PyPI removal date (1 month from announcement)
    - Save to `agent-os/specs/2025-12-26-python-cli-deprecation/deprecation-timeline.md`

**Acceptance Criteria:**

- Python package version bumped to `0.8.0`
- Deprecation warning displays on every CLI command
- Warning message includes all required information
- Deprecation timeline documented

#### Task Group 9: PyPI Metadata Update & Final Release

**Dependencies:** Task Group 8
**Estimated Effort:** 2-3 hours

- [ ] 9.0 Update PyPI metadata and publish final release
  - [ ] 9.1 Update PyPI package metadata
    - Edit `cli/pyproject.toml` metadata fields
    - Add deprecation notice to package description
    - Add "Development Status :: 7 - Inactive" classifier
    - Add link to migration documentation in project URLs
  - [ ] 9.2 Update package README for PyPI
    - Edit `cli/README.md` to add prominent deprecation notice at top
    - Include Bun CLI installation instructions
    - Add migration timeline and link to migration guide
    - Keep existing documentation for reference
  - [ ] 9.3 Build Python package
    - Run: `cd cli && python -m build`
    - Verify package builds successfully
    - Check built artifacts in `cli/dist/`
  - [ ] 9.4 Test package installation locally
    - Create test virtual environment
    - Install built package: `pip install dist/documentation_robotics-0.8.0.tar.gz`
    - Run commands to verify deprecation warning works
  - [ ] 9.5 Publish final release to PyPI
    - Run: `python -m twine upload dist/*`
    - Verify package appears on PyPI with deprecation metadata
    - Test installation from PyPI: `pip install documentation-robotics`
  - [ ] 9.6 Create GitHub release for Python CLI final version
    - Create tag: `python-cli-v0.8.0`
    - Write release notes documenting deprecation
    - Include migration instructions and timeline

**Acceptance Criteria:**

- PyPI metadata updated with deprecation notice
- Package README shows prominent deprecation warning
- Final release published to PyPI successfully
- GitHub release created for `v0.8.0`

### Phase 3: Documentation Migration to Bun CLI

#### Task Group 10: Main Repository Documentation Updates

**Dependencies:** Phase 2 complete (Task Groups 8-9)
**Estimated Effort:** 6-8 hours

- [ ] 10.0 Update main repository documentation
  - [ ] 10.1 Update root README.md
    - Edit `/Users/austinsand/workspace/documentation_robotics/README.md`
    - Remove all Python CLI installation instructions
    - Replace with Bun CLI installation: `npm install -g @doc-robotics/cli-bun`
    - Update all code examples to use Bun CLI syntax
    - Update quick start guide to reference only Bun CLI
    - Remove Python version requirements section
    - Add Node.js version requirements (18+)
  - [ ] 10.2 Update CLAUDE.md
    - Edit `/Users/austinsand/workspace/documentation_robotics/CLAUDE.md`
    - Remove entire "Python CLI Setup (Legacy/Fallback)" section
    - Remove Python CLI comparison table rows
    - Update "Quick Reference" to show only Bun CLI
    - Remove Python-specific commands (pytest, pip install, venv activation)
    - Update "Approved Commands" to remove Python CLI commands
    - Remove all references to `cli/` directory
    - Update "Repository Structure" to remove `cli/` section
  - [ ] 10.3 Update CONTRIBUTING.md
    - Remove Python development setup instructions
    - Replace with Bun CLI development workflow
    - Update testing instructions to use `npm run test` instead of `pytest`
    - Update code style guidelines to reference TypeScript instead of Python
    - Remove Python linting/formatting instructions (Black, isort)
    - Add TypeScript linting/formatting instructions (ESLint, Prettier)
  - [ ] 10.4 Verify updated documentation for accuracy
    - Read through all updated files
    - Check all code examples are valid Bun CLI syntax
    - Verify no broken internal links
    - Test installation instructions in fresh environment

**Acceptance Criteria:**

- Root README.md references only Bun CLI
- CLAUDE.md completely updated with no Python references
- CONTRIBUTING.md reflects Bun-only development workflow
- All documentation verified for accuracy

#### Task Group 11: CLI-Specific Documentation Updates

**Dependencies:** Task Group 10
**Estimated Effort:** 4-5 hours

- [ ] 11.0 Update CLI-specific documentation
  - [ ] 11.1 Update Bun CLI README
    - Edit `cli-bun/README.md`
    - Update introduction to position as "primary and only CLI"
    - Remove any language comparing to Python CLI or positioning as "alternative"
    - Emphasize stability and production-readiness
    - Update installation instructions to be primary path
  - [ ] 11.2 Update CLI development documentation
    - Review all files in `cli-bun/docs/` (if any)
    - Remove references to Python CLI or compatibility
    - Update architecture docs to reflect sole implementation status
  - [ ] 11.3 Create migration guide document
    - Create `docs/migration-from-python-cli.md`
    - Document command mapping (Python → Bun equivalents)
    - Provide installation instructions for Bun CLI
    - Include CI/CD migration examples
    - Add troubleshooting section for common migration issues
    - Document deprecation timeline and support policy
  - [ ] 11.4 Add migration guide link to main README
    - Edit root README.md
    - Add prominent "Migrating from Python CLI" section
    - Link to migration guide document

**Acceptance Criteria:**

- Bun CLI README positions CLI as primary and only implementation
- Migration guide document created with complete instructions
- Migration guide linked from main README
- CLI development docs updated

#### Task Group 12: Specification Examples & Tutorials Updates

**Dependencies:** Task Group 10
**Estimated Effort:** 6-8 hours

- [ ] 12.0 Update specification examples and tutorials
  - [ ] 12.1 Update spec example: microservices
    - Edit `spec/examples/microservices/` files
    - Update all CLI commands to Bun syntax
    - Verify example model can be created with Bun CLI
    - Test all commands in example work correctly
  - [ ] 12.2 Update spec example: minimal
    - Edit `spec/examples/minimal/` files
    - Update all CLI commands to Bun syntax
    - Verify minimal example works end-to-end
  - [ ] 12.3 Update spec example: e-commerce
    - Edit `spec/examples/e-commerce/` files
    - Update all CLI commands to Bun syntax
    - Test complete example workflow
  - [ ] 12.4 Update spec example: reference-implementation
    - Edit `spec/examples/reference-implementation/` files
    - Update all CLI commands to Bun syntax
    - Verify reference implementation demonstrates all features
  - [ ] 12.5 Update guides in `/docs/guides/`
    - List all guide files in directory
    - Update each guide to use Bun CLI syntax
    - Update installation instructions in each guide
    - Test guide examples work correctly
  - [ ] 12.6 Update any tutorial content
    - Search for tutorial files in `/docs/`
    - Update CLI commands to Bun syntax
    - Verify tutorial workflows are accurate

**Acceptance Criteria:**

- All 4 spec examples updated and tested
- All guides in `/docs/guides/` updated
- All tutorials updated and verified
- Examples and tutorials work correctly with Bun CLI

#### Task Group 13: Integration Documentation Updates

**Dependencies:** Task Group 10
**Estimated Effort:** 8-10 hours

- [ ] 13.0 Update integration documentation
  - [ ] 13.1 Update Claude Code integration
    - List all files in `integrations/claude_code/`
    - Update agents in `integrations/claude_code/agents/` to reference Bun CLI
    - Update commands in `integrations/claude_code/commands/` to use Bun CLI syntax
    - Update skills in `integrations/claude_code/skills/` to reference Bun CLI
    - Update any README or guide files
  - [ ] 13.2 Update GitHub Copilot integration
    - List all files in `integrations/github_copilot/`
    - Update agents in `integrations/github_copilot/agents/` to reference Bun CLI
    - Update commands in `integrations/github_copilot/commands/` to use Bun CLI syntax
    - Update skills in `integrations/github_copilot/skills/` to reference Bun CLI
    - Update any README or guide files
  - [ ] 13.3 Create CI/CD integration guide
    - Create `docs/ci-cd-integration.md`
    - Provide GitHub Actions example workflow
    - Provide GitLab CI example configuration
    - Provide CircleCI example configuration
    - Provide Jenkins example pipeline
    - Include installation, caching, and execution steps
    - Add troubleshooting section for CI/CD issues
  - [ ] 13.4 Update integration examples with CI/CD
    - Add example workflow files to `docs/examples/ci-cd/`
    - Include: `.github/workflows/dr-validate.yml` example
    - Include: `.gitlab-ci.yml` example
    - Include: `Jenkinsfile` example
    - Test examples in actual CI/CD environments if possible
  - [ ] 13.5 Verify all integration docs updated
    - Review all files in `integrations/` directories
    - Check for any remaining Python CLI references
    - Test integration examples work correctly

**Acceptance Criteria:**

- All Claude Code integration files updated
- All GitHub Copilot integration files updated
- CI/CD integration guide created with examples for 4 platforms
- Example workflow files created and tested
- All integration documentation verified

#### Task Group 14: Documentation Link Verification

**Dependencies:** Task Groups 10, 11, 12, 13
**Estimated Effort:** 2-3 hours

- [ ] 14.0 Verify documentation links and completeness
  - [ ] 14.1 Search for remaining Python CLI references
    - Run: `grep -r "pip install" /Users/austinsand/workspace/documentation_robotics/docs/`
    - Run: `grep -r "pytest" /Users/austinsand/workspace/documentation_robotics/docs/`
    - Run: `grep -r "python" /Users/austinsand/workspace/documentation_robotics/ --include="*.md"`
    - Review results and update any missed references
  - [ ] 14.2 Verify all internal links work
    - Use link checker tool or manual verification
    - Check links in: README.md, CLAUDE.md, all docs/, all integrations/
    - Fix any broken links to removed Python CLI content
  - [ ] 14.3 Test all code examples
    - Extract code examples from documentation
    - Test each example with Bun CLI
    - Verify examples work as documented
    - Fix any incorrect examples
  - [ ] 14.4 Create documentation update checklist
    - List all updated files
    - Mark each file as "Updated" and "Verified"
    - Save to `agent-os/specs/2025-12-26-python-cli-deprecation/documentation-updates.md`

**Acceptance Criteria:**

- No remaining Python CLI references in documentation
- All internal links verified and working
- All code examples tested and working
- Documentation update checklist completed

### Phase 4: Safe Removal from Codebase

#### Task Group 15: Remove Python CLI Code

**Dependencies:** Phase 3 complete (Task Groups 10-14)
**Estimated Effort:** 2-3 hours

- [ ] 15.0 Remove Python CLI implementation
  - [ ] 15.1 Verify Phase 3 documentation updates are complete
    - Confirm all documentation references only Bun CLI
    - Verify no critical information exists only in Python CLI docs
    - Review readiness checklist from Phase 1
  - [ ] 15.2 Delete Python CLI directory
    - Remove: `/Users/austinsand/workspace/documentation_robotics/cli/`
    - Verify directory deletion is complete
  - [ ] 15.3 Verify deletion was successful
    - Check that `cli/` directory no longer exists
    - Verify no symbolic links or references remain
  - [ ] 15.4 Document removal in changelog
    - Create entry in root CHANGELOG.md or release notes
    - Document Python CLI removal and migration path
    - Include links to migration guide and Bun CLI docs

**Acceptance Criteria:**

- Python CLI directory (`cli/`) completely removed
- No remaining file system references to Python CLI
- Removal documented in changelog

#### Task Group 16: Remove Python CI/CD Workflows

**Dependencies:** Task Group 15
**Estimated Effort:** 2-3 hours

- [ ] 16.0 Remove Python-related CI/CD workflows
  - [ ] 16.1 Review existing CI/CD workflows
    - Read `.github/workflows/` files
    - Identify Python-specific jobs (pytest, Python test actions)
    - List files that need modification: likely `cli-tests.yml`
  - [ ] 16.2 Remove Python test jobs from workflows
    - Edit `.github/workflows/cli-tests.yml` or similar
    - Remove pytest job definitions
    - Remove Python setup actions
    - Remove Python dependency installation steps
    - Keep spec validation and Bun CLI test workflows intact
  - [ ] 16.3 Update workflow names and descriptions
    - Rename workflows to remove "Python" references
    - Update workflow descriptions to reflect Bun CLI only
  - [ ] 16.4 Test CI/CD workflows
    - Create test branch
    - Push change to trigger CI/CD
    - Verify Bun CLI tests still run correctly
    - Verify spec validation still runs correctly
    - Verify Python tests are no longer executed
  - [ ] 16.5 Update CI/CD documentation
    - Update any CI/CD documentation in `docs/`
    - Reflect removal of Python test workflows
    - Document remaining workflows

**Acceptance Criteria:**

- Python test jobs removed from all CI/CD workflows
- Bun CLI and spec validation workflows still functional
- CI/CD workflows tested and passing
- CI/CD documentation updated

#### Task Group 17: Remove GitHub Templates

**Dependencies:** Task Group 15
**Estimated Effort:** 1-2 hours

- [ ] 17.0 Remove deprecated GitHub issue and PR templates
  - [ ] 17.1 Identify templates to remove
    - List: `.github/ISSUE_TEMPLATE/bug-report-cli.md` (already deleted per git status)
    - List: `.github/ISSUE_TEMPLATE/bug-report-spec.md` (already deleted per git status)
    - List: `.github/ISSUE_TEMPLATE/feature-request-cli.md` (already deleted per git status)
    - List: `.github/ISSUE_TEMPLATE/feature-request-spec.md` (already deleted per git status)
    - Verify these are already deleted or delete them
  - [ ] 17.2 Check for Python-specific PR templates
    - Review `.github/PULL_REQUEST_TEMPLATE/` if it exists
    - Remove any Python-specific PR templates
  - [ ] 17.3 Update or create new issue templates (if needed)
    - Consider creating generic bug report template
    - Consider creating generic feature request template
    - Ensure templates reference Bun CLI only
  - [ ] 17.4 Test GitHub template usage
    - Navigate to repository Issues page
    - Verify issue templates appear correctly
    - Verify no Python CLI references in templates

**Acceptance Criteria:**

- All Python-specific issue templates removed
- Python-specific PR templates removed (if any existed)
- Generic templates created or updated if needed
- Templates verified in GitHub UI

#### Task Group 18: Clean Up Repository Configuration

**Dependencies:** Task Groups 15, 16, 17
**Estimated Effort:** 1-2 hours

- [ ] 18.0 Clean up repository configuration files
  - [ ] 18.1 Update root `.gitignore`
    - Remove Python-specific entries: `.venv/`, `*.pyc`, `__pycache__/`, `*.pyo`, `*.egg-info/`, `dist/`, `build/`
    - Verify Node.js entries remain: `node_modules/`, `*.log`, `dist/` (if used by Bun)
    - Keep spec-related entries intact
  - [ ] 18.2 Check for other Python configuration files
    - Look for: `.python-version`, `pyproject.toml` (in root), `setup.py`, `setup.cfg`, `requirements.txt`
    - Remove any Python config files found in root (not in `cli/` which is already deleted)
  - [ ] 18.3 Update pre-commit configuration if it exists
    - Check for `.pre-commit-config.yaml`
    - Remove Python linting hooks (Black, isort, flake8)
    - Keep or add TypeScript/JavaScript linting hooks
    - Keep spec validation hooks
  - [ ] 18.4 Verify repository cleanliness
    - Run: `git status` to see working tree state
    - Confirm only intended deletions and modifications
    - Check for any unexpected file changes

**Acceptance Criteria:**

- `.gitignore` updated with Python entries removed
- No Python configuration files remain in repository root
- Pre-commit hooks updated for TypeScript/Bun development
- Repository working tree clean and verified

#### Task Group 19: Final Verification & Testing

**Dependencies:** Task Groups 15, 16, 17, 18
**Estimated Effort:** 3-4 hours

- [ ] 19.0 Final verification and testing
  - [ ] 19.1 Perform full repository search for Python CLI references
    - Run: `grep -r "documentation-robotics" /Users/austinsand/workspace/documentation_robotics/ --include="*.md" --include="*.yml" --include="*.yaml"`
    - Review results for any remaining Python package references
    - Update or verify each reference is intentional (e.g., in changelog, migration guide)
  - [ ] 19.2 Test Bun CLI from clean install
    - Create fresh directory
    - Install Bun CLI: `npm install -g @doc-robotics/cli-bun`
    - Run basic workflow: init, add, validate, list, export
    - Verify CLI works correctly without Python CLI present
  - [ ] 19.3 Verify documentation completeness
    - Review main README.md
    - Review CLAUDE.md
    - Review migration guide
    - Confirm all information needed for users is present
  - [ ] 19.4 Run Bun CLI test suite
    - Run: `cd cli-bun && npm run test`
    - Verify all tests pass
    - Run: `npm run test:compatibility`
    - Verify compatibility tests still pass (now testing only Bun CLI behavior)
  - [ ] 19.5 Create final removal checklist
    - Document all removed files and directories
    - Document all updated files
    - Document verification steps completed
    - Save to `agent-os/specs/2025-12-26-python-cli-deprecation/removal-checklist.md`

**Acceptance Criteria:**

- No unintended Python CLI references remain
- Bun CLI works correctly from clean install
- Documentation complete and accurate
- All Bun CLI tests passing
- Final removal checklist created

### Phase 5: Post-Removal Tasks

#### Task Group 20: Repository Cleanup & Communication

**Dependencies:** Phase 4 complete (Task Groups 15-19)
**Estimated Effort:** 2-3 hours

- [ ] 20.0 Complete repository cleanup and communication
  - [ ] 20.1 Create repository announcement
    - Draft announcement for repository README or CHANGELOG
    - Include: Python CLI removed, migration guide link, Bun CLI benefits
    - Add timeline: PyPI package removal date (1 month from Phase 2)
  - [ ] 20.2 Update repository description and topics
    - Update GitHub repository description to remove Python references
    - Update repository topics/tags to reflect TypeScript/Bun implementation
    - Add topics: `typescript`, `bun`, `cli-tool`
    - Remove topics: `python` (if present)
  - [ ] 20.3 Create GitHub release notes
    - Create release documenting Python CLI removal
    - Title: "Python CLI Removed - Bun CLI is Now Sole Implementation"
    - Include: summary of changes, migration guide link, breaking changes note
    - Tag release version (e.g., `v1.0.0` or appropriate version)
  - [ ] 20.4 Update project documentation metadata
    - Update any project documentation with Python CLI sunset date
    - Update support documentation to reference only Bun CLI
    - Archive or update any Python CLI-specific FAQs
  - [ ] 20.5 Plan PyPI package removal
    - Set calendar reminder for PyPI removal date (1 month after Phase 2)
    - Document PyPI removal process: `twine remove` or PyPI web interface
    - Create task for future PyPI package removal

**Acceptance Criteria:**

- Repository announcement created
- GitHub repository metadata updated
- Release notes published
- PyPI removal planned and documented

## Execution Order

Recommended implementation sequence:

**Phase 1: Feature Parity Validation & Testing** (Complete first - prerequisite for all other phases)

1. Task Group 1: Command Inventory & Gap Analysis
2. Task Groups 2-5: Compatibility Test Suite Enhancement (can run in parallel)
3. Task Group 6: Model File Structure Compatibility (HIGHEST PRIORITY - depends on 2-5)
4. Task Group 7: Test Suite Reliability & Documentation

**Phase 2: Python CLI Final Release & Deprecation** (Complete second - after Phase 1 validation) 5. Task Group 8: Python Package Version Bump & Deprecation Warning 6. Task Group 9: PyPI Metadata Update & Final Release

**Phase 3: Documentation Migration to Bun CLI** (Complete third - after deprecation release) 7. Task Group 10: Main Repository Documentation Updates 8. Task Groups 11-13: Specific Documentation Updates (can run in parallel after 10) 9. Task Group 14: Documentation Link Verification

**Phase 4: Safe Removal from Codebase** (Complete fourth - after documentation migration) 10. Task Group 15: Remove Python CLI Code 11. Task Groups 16-18: Clean Up CI/CD, Templates, and Config (can run in parallel after 15) 12. Task Group 19: Final Verification & Testing

**Phase 5: Post-Removal Tasks** (Complete last - finalization) 13. Task Group 20: Repository Cleanup & Communication

## Testing Strategy

**Compatibility Testing:**

- Run `npm run test:compatibility` in `cli-bun/` after completing Task Groups 2-6
- Execute category-specific tests: commands, validation, export, API, model files
- Verify 100% pass rate before proceeding to Phase 2

**Documentation Testing:**

- Extract and test all code examples from updated documentation
- Verify installation instructions work in fresh environment
- Test CI/CD integration examples in actual pipelines if possible

**Final Verification Testing:**

- Fresh Bun CLI installation and workflow testing
- Full Bun CLI test suite execution
- Repository-wide search for unintended Python references
- Link verification across all documentation

## Success Metrics

**Phase 1 Success:**

- All compatibility tests passing with 100% reliability
- Command parity checklist shows complete coverage
- Model file structure compatibility confirmed (byte-for-byte match)
- Visualization API compatibility confirmed (JSON response parity)
- Readiness report confirms all criteria met

**Phase 2 Success:**

- Python package v0.8.0 published to PyPI with deprecation warnings
- Deprecation warning displays on every Python CLI command
- GitHub release created for final Python CLI version
- 1-month timeline established and documented

**Phase 3 Success:**

- All documentation references only Bun CLI
- Zero Python CLI references remain (except in migration guide and changelog)
- Migration guide created with complete instructions
- All code examples tested and working
- CI/CD integration guide created with 4+ platform examples

**Phase 4 Success:**

- Python CLI directory (`cli/`) completely removed
- Python CI/CD workflows removed
- Issue/PR templates removed
- Repository configuration cleaned
- All Bun CLI tests passing
- Fresh installation verified working

**Phase 5 Success:**

- Repository announcement published
- GitHub metadata updated
- Release notes created
- PyPI removal planned

## Estimated Total Effort

**Phase 1:** 44-60 hours
**Phase 2:** 5-7 hours
**Phase 3:** 26-34 hours
**Phase 4:** 9-14 hours
**Phase 5:** 2-3 hours

**Total:** 86-118 hours (~2-3 weeks for one developer, or ~1-1.5 weeks for a team)
