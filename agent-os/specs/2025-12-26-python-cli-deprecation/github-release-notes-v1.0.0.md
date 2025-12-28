# Release v1.0.0: Python CLI Removed - Bun CLI is Now Sole Implementation

**Release Date:** December 27, 2025
**Status:** PREPARED - Awaiting User Approval Before Publication

---

## Overview

This major release marks the completion of the Python CLI deprecation process. The Python CLI has been removed from the repository, and the Bun CLI is now the sole implementation of the Documentation Robotics CLI.

## Breaking Changes

### Python CLI Removed from Repository

The entire Python CLI implementation (`cli/` directory) has been removed from the repository. Users must migrate to the Bun CLI to continue receiving updates and support.

**Migration Required:**

```bash
# Uninstall Python CLI
pip uninstall documentation-robotics

# Install Bun CLI
npm install -g @documentation-robotics/cli

# Verify installation
dr --version
```

**No Data Migration Needed:** Your existing `.dr/` model files work seamlessly with the Bun CLI. No conversion is required.

### Python CLI PyPI Timeline

- **Now - January 26, 2026:** Python CLI v0.8.0 remains available on PyPI with deprecation warnings
- **January 26, 2026:** Python CLI package will be removed from PyPI
- **After January 26, 2026:** Python CLI will no longer be installable via `pip install`

## What's New

### Sole Implementation: Bun CLI

The Bun CLI is now the only supported implementation, bringing:

- **8x Faster Performance** - ~200ms startup vs ~1-2s for Python CLI
- **100% Feature Parity** - All 21 essential commands fully implemented
- **Active Development** - All new features and bug fixes
- **Modern Tooling** - TypeScript, npm ecosystem, VS Code integration
- **Better DX** - IntelliSense, type safety, faster iterations

### Comprehensive Validation

Before removal, we validated complete feature parity:

- **543 Tests Passing** - 300 unit tests, 243 compatibility tests
- **100% Pass Rate** - Zero test failures, zero flaky tests
- **Command Coverage** - All 21 essential commands tested
- **Validator Coverage** - Schema, naming, reference, semantic validators
- **Export Coverage** - All 6 formats (ArchiMate, OpenAPI, JSON Schema, PlantUML, Markdown, GraphML)
- **API Coverage** - Visualization server endpoints tested

### Documentation Completely Migrated

All documentation now references only the Bun CLI:

- Main README updated
- CLAUDE.md rewritten
- All guides and tutorials updated
- All examples updated and tested
- Integration docs updated (Claude Code, GitHub Copilot)
- CI/CD integration guide created

## Migration Guide

### Installation

**Bun CLI Installation:**

```bash
# Global installation
npm install -g @documentation-robotics/cli

# Verify
dr --version
```

**Prerequisites:**

- Node.js 18 or higher
- npm (included with Node.js)

### Command Compatibility

All Python CLI commands have direct Bun CLI equivalents. The syntax is identical except for `init`:

| Python CLI         | Bun CLI                 |
| ------------------ | ----------------------- |
| `dr init <name>`   | `dr init --name <name>` |
| All other commands | Identical syntax        |

### Model Files

**No conversion needed.** The Bun CLI uses the same `.dr/` directory structure and JSON format as the Python CLI.

```bash
# Works with your existing models
cd my-existing-project
dr validate  # Uses Bun CLI
dr list motivation  # Works with existing data
```

### CI/CD Migration

Update your pipelines to use npm instead of pip:

**GitHub Actions Example:**

```yaml
- uses: actions/setup-node@v3
  with:
    node-version: "18"
- run: npm install -g @documentation-robotics/cli
- run: dr validate
```

See the [CI/CD Integration Guide](https://github.com/tinkermonkey/documentation_robotics/blob/main/docs/ci-cd-integration.md) for examples for GitHub Actions, GitLab CI, CircleCI, and Jenkins.

## Resources

### Migration Resources

- **[Migration Guide](https://github.com/tinkermonkey/documentation_robotics/blob/main/docs/migration-from-python-cli.md)** - Complete migration instructions
- **[Deprecation Timeline](https://github.com/tinkermonkey/documentation_robotics/blob/main/agent-os/specs/2025-12-26-python-cli-deprecation/deprecation-timeline.md)** - Detailed timeline and FAQs
- **[CI/CD Integration Guide](https://github.com/tinkermonkey/documentation_robotics/blob/main/docs/ci-cd-integration.md)** - Pipeline migration examples
- **[Readiness Report](https://github.com/tinkermonkey/documentation_robotics/blob/main/agent-os/specs/2025-12-26-python-cli-deprecation/readiness-report.md)** - Validation results

### Getting Help

- **Issues:** Report migration problems via [GitHub Issues](https://github.com/tinkermonkey/documentation_robotics/issues)
- **Discussions:** Ask questions in [GitHub Discussions](https://github.com/tinkermonkey/documentation_robotics/discussions)
- **CLI Help:** Run `dr --help` or `dr <command> --help`

## Removed Components

### Files Removed (~160 files)

- `cli/` directory - Complete Python CLI implementation
- Python CI/CD workflows - pytest jobs and Python-specific actions
- Python issue templates - Deprecated bug report and feature request templates
- Root `pyproject.toml` - Python package configuration
- Python entries from `.gitignore` - venv, pyc, pycache, etc.
- Python pre-commit hooks - Black, Ruff, mypy

### Files Updated (22 files)

- `README.md` - Now references only Bun CLI
- `CLAUDE.md` - Rewritten without Python references
- `CONTRIBUTING.md` - Updated for Bun CLI development
- `CHANGELOG.md` - Documents Python CLI removal
- All spec examples - Updated with Bun CLI syntax
- All guides and tutorials - Migrated to Bun CLI
- Integration files - Claude Code and GitHub Copilot
- CI/CD workflows - Removed Python jobs, added Bun CLI tests

## Validation Results

### Feature Parity Confirmed

- **Command Parity:** 21/21 essential commands (100%)
- **Validator Parity:** 4/4 validators (schema, naming, reference, semantic)
- **Export Parity:** 6/6 formats (ArchiMate, OpenAPI, JSON Schema, PlantUML, Markdown, GraphML)
- **API Parity:** Visualization server API matches specification

### Test Results

- **Total Tests:** 543
- **Unit Tests:** 300 passing (100%)
- **Integration Tests:** 243 passing (100%)
- **Flaky Tests:** 0
- **Pass Rate:** 100%

### Model File Compatibility

- **Structure:** Identical JSON structure between Python and Bun CLIs
- **Format:** Same `.dr/` directory layout
- **Migration:** No data conversion required
- **Validation:** Byte-for-byte equivalence for manifest and layer files

## Timeline

| Date                | Milestone                                            | Status    |
| ------------------- | ---------------------------------------------------- | --------- |
| Early December 2025 | Bun CLI reaches 100% feature parity                  | COMPLETED |
| December 26, 2025   | Python CLI v0.8.0 released with deprecation warnings | COMPLETED |
| December 27, 2025   | Python CLI removed from repository                   | COMPLETED |
| January 26, 2026    | Python CLI removed from PyPI                         | PENDING   |
| Ongoing             | Bun CLI active development                           | ONGOING   |

## What's Next

### Immediate Actions (Now - January 26, 2026)

1. **Users:** Install Bun CLI and test with existing models
2. **Users:** Update CI/CD pipelines
3. **Users:** Update team documentation
4. **Maintainers:** Monitor for migration issues
5. **Maintainers:** Provide migration support via GitHub Issues

### After January 26, 2026

1. **Remove Python CLI from PyPI** - Package will no longer be installable
2. **Bun CLI Only** - All development focuses on single implementation
3. **Future Features** - Faster feature development without maintaining two CLIs

### Roadmap

With the Python CLI removed, we can accelerate development:

- Enhanced visualization capabilities
- Better AI integration (chat, annotations)
- Performance optimizations
- New export formats
- Improved validation rules
- Better error messages and debugging

## Support Policy

### Python CLI (v0.8.0)

- **Status:** Final release, deprecated
- **Support:** No further updates or bug fixes
- **PyPI Availability:** Until January 26, 2026
- **Usage:** Can continue using if already installed, but no support after deprecation period

### Bun CLI (Current)

- **Status:** Active development, sole implementation
- **Support:** Full support, regular updates
- **Installation:** `npm install -g @documentation-robotics/cli`
- **Updates:** Regular releases with new features and bug fixes

## Acknowledgments

This migration was completed through a rigorous 5-phase process:

- **Phase 1:** Feature parity validation and comprehensive testing
- **Phase 2:** Python CLI final release with deprecation warnings
- **Phase 3:** Complete documentation migration
- **Phase 4:** Safe removal of Python CLI code
- **Phase 5:** Repository cleanup and communication

Thank you to:

- The development team for achieving 100% feature parity
- The testing team for creating comprehensive compatibility tests
- The documentation team for migrating all user-facing docs
- Early adopters who provided valuable feedback
- The community for your patience during this transition

## Frequently Asked Questions

### Can I still use the Python CLI?

If you have it installed, yes, but it will receive no further updates. We strongly recommend migrating to the Bun CLI for continued support.

### Will my models work with the Bun CLI?

Yes, 100%. No data migration is required. The model file structure is identical.

### How long do I have to migrate?

Python CLI will remain on PyPI until January 26, 2026 (1 month grace period).

### What if I find a bug during migration?

Please report it immediately via GitHub Issues. We prioritize migration blockers.

### Do I need to change my CI/CD pipelines?

Yes, update installation from `pip install` to `npm install -g`. See the CI/CD Integration Guide.

### Why only 1 month grace period?

The Bun CLI has been production-ready for months with 100% parity. The small user base can migrate quickly. We can extend if critical issues arise.

---

## Installation

```bash
# Uninstall Python CLI
pip uninstall documentation-robotics

# Install Bun CLI
npm install -g @documentation-robotics/cli

# Verify
dr --version
```

## Quick Links

- [Migration Guide](https://github.com/tinkermonkey/documentation_robotics/blob/main/docs/migration-from-python-cli.md)
- [Bun CLI Documentation](https://github.com/tinkermonkey/documentation_robotics/blob/main/cli-bun/README.md)
- [CI/CD Integration Guide](https://github.com/tinkermonkey/documentation_robotics/blob/main/docs/ci-cd-integration.md)
- [Deprecation Timeline](https://github.com/tinkermonkey/documentation_robotics/blob/main/agent-os/specs/2025-12-26-python-cli-deprecation/deprecation-timeline.md)
- [Readiness Report](https://github.com/tinkermonkey/documentation_robotics/blob/main/agent-os/specs/2025-12-26-python-cli-deprecation/readiness-report.md)

---

**Full Changelog:** See [CHANGELOG.md](https://github.com/tinkermonkey/documentation_robotics/blob/main/CHANGELOG.md) for detailed changes.

**Upgrade today and experience the performance and quality of the Bun CLI!**

---

## Publication Instructions

**IMPORTANT: Do NOT publish this release without explicit user approval.**

### Using GitHub Web Interface

1. Go to repository Releases page: `https://github.com/tinkermonkey/documentation_robotics/releases`
2. Click "Draft a new release"
3. Fill in release form:
   - **Tag version:** `v1.0.0` (create new tag)
   - **Target:** `main` branch
   - **Release title:** `v1.0.0: Python CLI Removed - Bun CLI is Now Sole Implementation`
   - **Description:** Copy the content above (from "## Overview" to the end)
   - **Set as latest release:** ✓ Check this box
   - **Create discussion:** ✓ Recommended to enable discussion
4. Click "Publish release"

### Using GitHub CLI (`gh`)

```bash
# Create and publish release
gh release create v1.0.0 \
  --title "v1.0.0: Python CLI Removed - Bun CLI is Now Sole Implementation" \
  --notes-file /Users/austinsand/workspace/documentation_robotics/agent-os/specs/2025-12-26-python-cli-deprecation/github-release-notes-v1.0.0.md \
  --latest \
  --discussion-category "Announcements"
```

### After Publication

1. Verify release appears on Releases page
2. Verify release discussion is created (if enabled)
3. Update repository metadata (see Task 20.2)
4. Share release link in announcements

---

**Document Version:** 1.0
**Date:** December 27, 2025
**Author:** Documentation Robotics Team
**Approval Status:** PENDING USER APPROVAL
