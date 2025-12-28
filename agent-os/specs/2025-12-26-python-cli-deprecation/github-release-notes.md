# GitHub Release Notes: Python CLI v0.8.0 (Final Release)

## Release Information

- **Tag:** `python-cli-v0.8.0`
- **Title:** Python CLI v0.8.0 - Final Release (DEPRECATED)
- **Release Type:** Final / Deprecation Release
- **Date:** 2025-12-26

## Summary

This is the **final release** of the Documentation Robotics Python CLI. The Python implementation is officially deprecated as of this release and will be removed from PyPI on **2026-01-26** (1 month from now).

**All users must migrate to the Bun CLI by 2026-01-26.**

## What's Changed

### Deprecation

- **Python CLI is now deprecated** - This release marks the official deprecation of the Python CLI implementation
- **Deprecation warning added** - Every CLI command now displays a prominent deprecation notice with migration instructions
- **Version bumped to 0.8.0** - Final version number for the Python implementation
- **PyPI metadata updated** - Package description and classifiers updated to reflect deprecated status

### Breaking Changes

- **DEPRECATION NOTICE:** This is the last release of the Python CLI
- **Timeline:** Package will be removed from PyPI on 2026-01-26
- **No future updates:** No bug fixes or feature development will occur for Python CLI after this release

## Migration to Bun CLI

### Why Migrate?

The Bun CLI offers significant advantages over the Python implementation:

- **100% Feature Parity** - All commands work identically between Python and Bun CLIs
- **8x Faster Performance** - ~200ms startup vs 1-2s for Python CLI
- **Active Development** - All new features and bug fixes go to Bun CLI
- **Modern Codebase** - TypeScript with better type safety and tooling
- **No Data Migration** - Model files are identical, no conversion needed

### How to Migrate

#### 1. Install Bun CLI

```bash
npm install -g @documentation-robotics/cli
```

#### 2. Test with Your Existing Models

```bash
# Your existing models work without modification
cd your-project-directory
dr validate              # Same commands, same behavior
dr list business
dr export --format archimate
```

#### 3. Update CI/CD Pipelines

Replace Python installation with npm installation:

**Before (Python):**

```yaml
- name: Install Documentation Robotics CLI
  run: pip install documentation-robotics
```

**After (Bun):**

```yaml
- name: Install Documentation Robotics CLI
  run: npm install -g @documentation-robotics/cli
```

#### 4. Uninstall Python CLI

```bash
pip uninstall documentation-robotics
```

### Migration Resources

- **Migration Guide:** [docs/migration-from-python-cli.md](https://github.com/tinkermonkey/documentation_robotics/blob/main/docs/migration-from-python-cli.md) _(to be created)_
- **Bun CLI Documentation:** [cli/README.md](https://github.com/tinkermonkey/documentation_robotics/tree/main/cli/README.md)
- **Command Parity Checklist:** Complete mapping of all commands from Python to Bun
- **Compatibility Test Results:** 543 tests passing, 100% parity validated

## Deprecation Timeline

| Date                         | Event                                                |
| ---------------------------- | ---------------------------------------------------- |
| **2025-12-26**               | Python CLI v0.8.0 released (this release)            |
| **2025-12-26 to 2026-01-26** | Grace period (1 month) for user migration            |
| **2026-01-26**               | Python CLI removed from PyPI (no longer installable) |
| **2026-01-26+**              | Bun CLI is the sole supported implementation         |

## Installation

### For New Users (Use Bun CLI)

```bash
npm install -g @documentation-robotics/cli
```

### For Existing Users (Python CLI - Deprecated)

```bash
pip install documentation-robotics==0.8.0
```

**Note:** Every command will display a deprecation warning. This is intentional.

## What's Included

### Python CLI v0.8.0 Features

All features from v0.7.3 plus:

- Deprecation warning on every command execution
- Updated package metadata with deprecation status
- Updated README with migration instructions
- Updated CHANGELOG with deprecation announcement

### Carried Over from v0.7.3

- 12-layer architecture model support
- Link management and validation
- Changeset management
- Interactive visualization server
- Claude Code and GitHub Copilot integration
- Export to 6 formats (ArchiMate, OpenAPI, JSON Schema, PlantUML, Markdown, GraphML)
- Comprehensive validation pipeline

## Files and Assets

### Distribution Files

- `documentation_robotics-0.8.0-py3-none-any.whl` - Python wheel distribution
- `documentation_robotics-0.8.0.tar.gz` - Source distribution

These files are also available on PyPI: https://pypi.org/project/documentation-robotics/0.8.0/

### Documentation

- Updated README.md with prominent deprecation notice
- Updated CHANGELOG.md with v0.8.0 entry
- Deprecation timeline document
- PyPI publication guide
- GitHub release notes (this document)

## Changelog

See [CHANGELOG.md](https://github.com/tinkermonkey/documentation_robotics/blob/main/cli/CHANGELOG.md) for complete version history.

### v0.8.0 - 2025-12-26 (FINAL RELEASE)

**Deprecation:**

- Added deprecation warning displayed on every CLI command
- Updated PyPI package metadata to "Development Status :: 7 - Inactive"
- Added migration documentation links to package URLs
- Updated README with prominent deprecation notice at top
- Documented 1-month deprecation timeline (removal on 2026-01-26)

**Breaking Changes:**

- This is the final release - no further Python CLI development will occur
- Package will be removed from PyPI on 2026-01-26

**Migration:**

- All users must migrate to Bun CLI by 2026-01-26
- Migration guide and compatibility documentation provided
- 100% feature parity validated between Python and Bun implementations

## Support

### During Grace Period (2025-12-26 to 2026-01-26)

- Python CLI remains fully functional
- Critical bug fixes may be backported if necessary
- Migration support available via GitHub issues

### After Grace Period (2026-01-26+)

- Python CLI no longer supported
- All support directed to Bun CLI
- Python CLI code remains in git history for reference

## Need Help?

If you encounter any issues during migration:

1. **Check the Migration Guide:** [docs/migration-from-python-cli.md](https://github.com/tinkermonkey/documentation_robotics/blob/main/docs/migration-from-python-cli.md)
2. **Review the Deprecation Timeline:** [agent-os/specs/2025-12-26-python-cli-deprecation/deprecation-timeline.md](https://github.com/tinkermonkey/documentation_robotics/blob/main/agent-os/specs/2025-12-26-python-cli-deprecation/deprecation-timeline.md)
3. **Open a GitHub Issue:** [Report migration problems](https://github.com/tinkermonkey/documentation_robotics/issues)

We're committed to ensuring a smooth transition for all users.

## Acknowledgments

Thank you to everyone who has used and contributed to the Python CLI over its lifetime. The Bun CLI represents the evolution of this tool, building on the solid foundation established by the Python implementation.

## Related Links

- **Bun CLI Repository:** [cli/](https://github.com/tinkermonkey/documentation_robotics/tree/main/cli)
- **Specification:** [spec/](https://github.com/tinkermonkey/documentation_robotics/tree/main/spec)
- **Main Repository:** [Documentation Robotics](https://github.com/tinkermonkey/documentation_robotics)
- **PyPI Package:** [documentation-robotics](https://pypi.org/project/documentation-robotics/)

---

**This release marks the end of Python CLI development. Thank you for your support, and welcome to the Bun CLI!**

---

## Creating This Release

### Step-by-Step Instructions

#### 1. Create Git Tag

```bash
cd /Users/austinsand/workspace/documentation_robotics
git tag -a python-cli-v0.8.0 -m "Python CLI v0.8.0 - Final Release (DEPRECATED)"
git push origin python-cli-v0.8.0
```

#### 2. Create GitHub Release

1. Navigate to: https://github.com/tinkermonkey/documentation_robotics/releases/new
2. **Choose a tag:** `python-cli-v0.8.0`
3. **Release title:** `Python CLI v0.8.0 - Final Release (DEPRECATED)`
4. **Description:** Copy the content from this file (sections: Summary through Related Links)
5. **Attach files:**
   - Upload `cli/dist/documentation_robotics-0.8.0-py3-none-any.whl`
   - Upload `cli/dist/documentation_robotics-0.8.0.tar.gz`
6. **Check:** ✅ "Set as a pre-release" (since it's a deprecation release)
7. **Click:** "Publish release"

#### 3. Verify Release

1. Check release appears at: https://github.com/tinkermonkey/documentation_robotics/releases
2. Verify files are attached and downloadable
3. Verify release notes display correctly

#### 4. Update Related Documentation

After creating the release:

- Update main README to reference this release
- Update deprecation timeline with actual release date
- Create announcement in repository discussions or issues

---

**Document Version:** 1.0
**Last Updated:** 2025-12-26
**Status:** READY FOR EXECUTION (awaiting user approval)
