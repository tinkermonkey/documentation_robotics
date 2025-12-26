# Spec Requirements: Python CLI Deprecation

## Initial Description

Ensure that the Bun-based CLI is ready to replace the legacy Python CLI and that we can fully remove the Python CLI from the codebase.

This aligns with Phase 1 of the product roadmap which includes:

1. Complete Python-to-Bun CLI Feature Parity — Ensure Bun CLI has 100% feature parity with Python CLI across all commands, validators, and export formats. Verify through comprehensive compatibility test suite.

2. Python CLI Deprecation Path — Create deprecation notice, migration guide, and automated migration tooling to help users transition from Python to Bun CLI. Update all documentation to position Bun as primary.

The goal is to validate feature parity, create migration tooling, and safely remove the Python CLI implementation from the repository.

## Requirements Discussion

### First Round Questions

**Q1:** I assume the feature parity validation should include automated comparison testing that runs the same commands in both CLIs and compares outputs byte-for-byte or semantically. Is that correct, or should we rely on the existing compatibility test suite in `cli-bun/tests/compatibility/`?
**Answer:** Build on top of the existing compatibility test suite in `cli-bun/tests/compatibility/` and build it out to be reliable.

**Q2:** For the migration tooling, I'm thinking we should create a script that detects if users have the Python CLI installed (via `pip list`), warns them about deprecation, and provides automated installation of the Bun CLI. Should we also create a helper command like `dr migrate-from-python` that runs as part of the Bun CLI, or keep it as a standalone migration script?
**Answer:** No migration tooling necessary since both the Bun and Python CLI work on the same set of files and will be installed independently through their respective package management systems.

**Q3:** I assume the deprecation notice should be displayed prominently when users run the Python CLI (printed to stderr before every command execution starting from a specific version), with a grace period before actual removal. Should this be a warning-only period (e.g., 2-3 months) before we remove the code, or do you have a different timeline in mind?
**Answer:** The whole codebase is effectively in the alpha stage, so deprecation can be immediate as soon as the Bun CLI is ready.

**Q4:** For users who have CI/CD pipelines using the Python CLI (`pip install documentation-robotics` in their workflows), I'm thinking we should provide drop-in replacement instructions showing how to swap `pip install` with `npm install -g @doc-robotics/cli-bun`. Should we also publish a migration script that scans GitHub Actions/GitLab CI files and suggests changes?
**Answer:** Provide instructions on how to integrate the Bun CLI into a pipeline and allow the users to perform the migration themselves.

**Q5:** I assume we should update PyPI metadata for the Python package to mark it as deprecated with a link to migration docs, but keep the package published (not remove it entirely). Is that correct, or should we eventually unpublish the Python package after a deprecation period?
**Answer:** Update the PyPI metadata to mark the Python package as deprecated with a migration link but keep it published for 1 month before removing it.

**Q6:** For documentation updates, I'm thinking we should archive Python-specific docs in a `legacy/` folder rather than delete them entirely, in case users need reference for older installations. Should we keep one "legacy Python CLI" page with basic info and migration link, or completely remove Python references?
**Answer:** Completely remove the Python references. The git history can serve as a record where needed.

**Q7:** I assume the "safe removal" from the codebase means deleting the `cli/` directory and all Python-related CI/CD workflows (pytest jobs, Python test actions), but keeping the specification (`spec/`) and Bun CLI (`cli-bun/`) intact. Should we also remove Python-related GitHub issue templates and documentation?
**Answer:** "Safe removal" means deleting the `cli/` directory and Python-related CI/CD workflows (pytest jobs, Python test actions), while keeping `spec/` and `cli-bun/` intact, and removing the Python-related GitHub issue templates from the documentation and code.

**Q8:** What should we explicitly NOT include in this phase? For example, should we exclude building an automated code migration tool for users who have custom scripts importing the Python CLI as a library, or creating a Python wrapper that delegates to the Bun CLI via subprocess?
**Answer:** Do not include any migration tooling or backwards compatibility functionalities. The Bun CLI is the only CLI that is supported now and all efforts should go into making it reliable for the mission of the software. No effort should be put into backwards compatibility.

**Q9:** Are there existing features in your codebase with similar patterns we should reference?
**Answer:** All of the existing Python CLI commands should be replicated in the Bun CLI and the existing compatibility tests should be bolstered to ensure that the Bun CLI works like the Python CLI. All documentation should be updated to reference the Bun CLI syntax and install instructions and the Python CLI should not be referenced in the documentation.

**Q10:** Do you have any visual assets that could help guide development?
**Answer:** There are no visual assets at the moment. The visualization front end is in a separate codebase.

### Follow-up Questions

**Follow-up 1:** When you say "build it out to be reliable," what specific areas need the most attention? For example, should we focus on output format validation (JSON, YAML, XML exports), command exit codes, error message consistency, or model file structure compatibility?
**Answer:** The priority is model file structure compatibility and visualization server compatibility according to the API spec detailed in `docs/api-spec.yaml` and `docs/visualization-api-annotations-chat.md`

**Follow-up 2:** What specific criteria determine when the Bun CLI is ready for the Python CLI to be deprecated? Should there be a checklist of commands/features that must pass compatibility tests, a certain test coverage percentage, or specific real-world usage validation?
**Answer:** A checklist of commands showing that the Bun CLI produces the same edits to the model file as the Python CLI for the same command

**Follow-up 3:** Should the Python package version be bumped one final time to add the deprecation warning, or should we update the existing version's metadata retroactively? Also, should the deprecation warning in the CLI itself be added via a final patch release before marking deprecated?
**Answer:** The PyPI package version will be bumped one final time

**Follow-up 4:** When removing Python references, should we update the main README.md (repo root), the CLAUDE.md file (which currently describes both CLIs), all tutorial/guide content in docs/, and example code snippets and quickstart guides? Should these all be updated in a single pass, or prioritized differently?
**Answer:** All README.md files, CLAUDE.md, and all tutorials/guides in `/docs`, along with all snippets and examples in the `integrations/` folder should all be updated

**Follow-up 5:** You mentioned removing Python-related templates. Should we also update the PR template, contributing guidelines, and any other developer-facing docs that reference Python CLI development workflows?
**Answer:** Issue & PR templates are no longer needed and should be removed. The contribution guidelines should be updated and retained.

## Existing Code to Reference

**Similar Features Identified:**

- Existing compatibility test suite: `cli-bun/tests/compatibility/` - This should be enhanced and made more reliable
- Visualization API specifications: `docs/api-spec.yaml` and `docs/visualization-api-annotations-chat.md` - These define the compatibility requirements for the visualization server
- Python CLI commands: `cli/src/documentation_robotics/commands/` - All commands should be replicated in Bun CLI
- Python CLI validators: `cli/src/documentation_robotics/validators/` - Validation behavior should match in Bun CLI
- Python CLI export formats: `cli/src/documentation_robotics/export/` - Export outputs should match in Bun CLI

**Documentation to Update:**

- All README.md files throughout the repository
- CLAUDE.md in the repository root
- All tutorials and guides in `/docs`
- All code snippets and examples in `/integrations`
- Contributing guidelines (CONTRIBUTING.md)

**Files/Directories to Remove:**

- `cli/` directory (entire Python CLI implementation)
- Python-related CI/CD workflows (pytest jobs, Python test actions)
- Python-related GitHub issue templates
- Python-related PR templates

## Visual Assets

No visual assets provided.

## Requirements Summary

### Functional Requirements

**Phase 1: Feature Parity Validation**

- Enhance existing compatibility test suite in `cli-bun/tests/compatibility/`
- Create checklist of all commands that must produce identical model file edits
- Validate model file structure compatibility between Python and Bun CLIs
- Validate visualization server compatibility per `docs/api-spec.yaml` and `docs/visualization-api-annotations-chat.md`
- Ensure all Python CLI commands are replicated in Bun CLI with equivalent behavior
- Test all validators produce consistent validation results
- Test all export formats produce compatible outputs

**Phase 2: Python CLI Deprecation Notice**

- Bump Python package version one final time
- Add deprecation warning to Python CLI (printed on every command execution)
- Update PyPI metadata to mark package as deprecated with migration link
- Include clear instructions pointing to Bun CLI installation
- Set 1-month timeline before PyPI package removal

**Phase 3: Documentation Updates**

- Update all README.md files to reference only Bun CLI
- Update CLAUDE.md to remove Python CLI references
- Update all tutorials/guides in `/docs` with Bun CLI syntax and examples
- Update all code snippets in `/integrations` folder
- Provide CI/CD integration instructions for Bun CLI (GitHub Actions, GitLab CI, etc.)
- Update contributing guidelines to reference only Bun CLI development
- Remove all Python-specific development workflow documentation

**Phase 4: Safe Removal from Codebase**

- Delete `cli/` directory (entire Python CLI implementation)
- Remove Python-related CI/CD workflows (pytest jobs, Python test actions)
- Remove Python-related GitHub issue templates
- Remove Python-related PR templates
- Keep `spec/` and `cli-bun/` directories intact
- Verify no broken links or references remain in documentation

### Reusability Opportunities

- Existing compatibility test infrastructure in `cli-bun/tests/compatibility/` can be extended
- Visualization API specifications already document compatibility requirements
- Existing documentation structure can be reused, just updating CLI references from Python to Bun

### Scope Boundaries

**In Scope:**

- Validating feature parity through enhanced compatibility tests
- Creating command-by-command checklist for readiness verification
- Deprecating Python CLI with clear warnings and timeline
- Updating all documentation to reference only Bun CLI
- Providing CI/CD integration instructions for Bun CLI
- Safe removal of Python CLI code, tests, and workflows
- Updating PyPI metadata and final version bump
- 1-month grace period before PyPI package removal

**Out of Scope:**

- No automated migration tooling
- No backwards compatibility layers
- No Python wrapper that delegates to Bun CLI
- No code migration tools for users importing Python CLI as library
- No automated CI/CD file scanning/modification tools
- No archival of Python-specific documentation (rely on git history)
- No visual asset creation (visualization frontend is separate codebase)

### Technical Considerations

**Compatibility Test Priorities:**

1. Model file structure compatibility (highest priority)
2. Visualization server API compatibility per spec
3. Command behavior equivalence (same inputs produce same model edits)
4. Validator consistency (same validation errors/warnings)
5. Export format output compatibility

**Readiness Criteria:**

- Complete command checklist showing Bun CLI produces identical model file edits
- All compatibility tests passing for model file operations
- Visualization server compatibility validated against API spec
- All commands from Python CLI replicated in Bun CLI

**PyPI Deprecation Process:**

1. Bump Python package version (final release)
2. Add deprecation warning to CLI
3. Update PyPI metadata with deprecation notice and migration link
4. Wait 1 month
5. Remove package from PyPI

**Documentation Migration Strategy:**

- Single-pass update of all documentation files
- Complete removal of Python references (no archival)
- Update all code examples to Bun CLI syntax
- Provide clear CI/CD integration instructions
- Update contribution guidelines for Bun-only development

**Timeline:**

- Deprecation is immediate once Bun CLI readiness criteria are met
- 1-month grace period for PyPI package before removal
- Project is in alpha stage, so no extended backwards compatibility required
