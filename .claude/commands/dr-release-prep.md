---
description: Prepare a new CLI or Spec release with automated version updates, changelog generation, and validation
argument-hint: "<version> [--spec-version <version>]"
---

# Prepare DR Release

Automates the complete release preparation workflow for Documentation Robotics CLI and Spec releases.

## What This Command Does

1. Updates all version references to the new release version
2. Reviews git log to determine changes since last release
3. Ensures CLI spec version compatibility (prompts if spec release is needed)
4. Updates the CLI CHANGELOG.md with release notes
5. Runs pre-commit validation scripts
6. Updates CLI README.md and docs/README.md with new version info
7. Updates Claude Code integration documentation
8. Validates Claude integration install/update scripts
9. Runs full CLI test suite to ensure everything passes
10. Provides final release checklist

## Usage

```bash
/dr-release-prep <version> [--spec-version <spec-version>]
```

**Examples:**

```bash
/dr-release-prep 0.4.2                    # CLI patch release
/dr-release-prep 0.5.0 --spec-version 0.3.0    # CLI + Spec major release
/dr-release-prep 0.4.2 --spec-version 0.2.0    # CLI patch with existing spec
```

## Parameters

**Required:**

- `<version>`: New CLI version to release (e.g., `0.4.2`, `0.5.0`)

**Optional:**

- `--spec-version <version>`: Spec version this CLI release targets
  - If not provided, asks user to confirm spec version compatibility
  - Use when coordinating spec + CLI releases

## Instructions for Claude Code

When the user runs this command, perform a comprehensive, methodical release preparation workflow.

### Step 1: Parse Arguments & Validate (5%)

**Goal:** Extract version information and validate format

**Actions:**

1. Parse the version argument from the command
2. Validate version format (semantic versioning: MAJOR.MINOR.PATCH)
3. Parse optional --spec-version if provided
4. Display what's being prepared:

```text
Preparing Documentation Robotics Release
=========================================
CLI Version:  0.4.2
Spec Version: 0.2.0 (current) → confirm or update?

This will:
✓ Update all version references
✓ Generate changelog entries
✓ Validate compatibility
✓ Run complete test suite
✓ Prepare release artifacts

Continue? (yes/no)
```

### Step 2: Determine Spec Version Compatibility (10%)

**Goal:** Ensure CLI and Spec versions are aligned

**Actions:**

1. Read current spec version from `spec/VERSION`
2. Read current CLI spec dependency from `cli/src/documentation_robotics/__init__.py`
3. Determine if spec release is happening alongside CLI release

**If --spec-version provided:**

```bash
# Check if spec VERSION file needs updating
cat spec/VERSION

# If different from --spec-version:
echo "Spec version mismatch detected"
echo "Current: $(cat spec/VERSION)"
echo "Target:  <spec-version>"
```

**If --spec-version NOT provided:**

Ask the user:

```text
Current spec version: 0.2.0

Is a spec release being prepared alongside this CLI release?

Options:
1. No spec release - CLI 0.4.2 will target spec 0.2.0 (current)
2. Spec release planned - Which version? (must be released FIRST)
3. Let me check - I'll review the changes first

Your choice?
```

**Important Rules:**

- Spec releases MUST happen before CLI releases if both are changing
- CLI `__spec_version__` must match an existing spec VERSION
- Breaking spec changes require new spec release first

### Step 3: Review Changes Since Last Release (15%)

**Goal:** Analyze git history to understand what changed

**Actions:**

1. Find the last release tag by running:

   ```bash
   # Get last CLI release tag
   git tag --list 'cli-v*' --sort=-version:refname | head -1

   # Get last spec release tag (if spec is being released)
   git tag --list 'spec-v*' --sort=-version:refname | head -1
   ```

2. Review commit log since last release:

   ```bash
   # CLI changes
   git log --oneline <last-cli-tag>..HEAD -- cli/

   # Spec changes (if relevant)
   git log --oneline <last-spec-tag>..HEAD -- spec/
   ```

3. Categorize changes:
   - **Added**: New features, capabilities, commands
   - **Changed**: Modifications to existing functionality
   - **Fixed**: Bug fixes
   - **Deprecated**: Features marked for removal
   - **Removed**: Deleted features
   - **Security**: Security-related changes

4. Present summary to user:

   ```text
   Changes Since Last Release (cli-v0.4.1)
   ========================================

   Commits: 23
   Files Changed: 45

   Categories:
   ✨ Added (5):
      - New /dr-release-prep command
      - Link validation in strict mode
      - Migration dry-run preview
      [...]

   🔧 Changed (8):
      - Updated validation error messages
      - Improved changeset comparison
      [...]

   🐛 Fixed (10):
      - Fixed broken reference detection
      - Corrected spec version parsing
      [...]

   Key files modified:
      - cli/src/documentation_robotics/__init__.py
      - cli/pyproject.toml
      - cli/CHANGELOG.md
      [...]

   Ready to draft changelog entries from these changes?
   ```

### Step 4: Update Version References (15%)

**Goal:** Update all version numbers consistently

**Actions:**

Update version in all required locations:

1. **CLI Package Version** (`cli/pyproject.toml`):

   ```python
   # Update version field
   version = "<new-version>"
   ```

2. **CLI Module Version** (`cli/src/documentation_robotics/__init__.py`):

   ```python
   __version__ = "<new-version>"
   __spec_version__ = "<spec-version>"  # Update if spec changed
   ```

3. **CLI README.md** (`cli/README.md`):

   ```markdown
   # Search for version badges and update:

   [![CLI Version](https://img.shields.io/badge/CLI-v<new-version>-green)]
   [![Specification](https://img.shields.io/badge/Specification-v<spec-version>-blue)]

   # Update status section:

   **Current Version:** v<new-version>
   **Specification Version:** v<spec-version>

   # Update version history section at bottom
   ```

4. **CLI Docs README** (`cli/docs/README.md`):

   ```markdown
   # Update version in "What's New" section if present
   ```

5. **Spec VERSION** (`spec/VERSION`) - **ONLY if doing spec release:**

   ```bash
   echo "<spec-version>" > spec/VERSION
   ```

6. **Claude Integration Documentation** - Check all files mentioning version:

   ```bash
   # Find files referencing old version
   grep -r "v0.4.1" cli/src/documentation_robotics/claude_integration/

   # Update references in:
   # - cli/src/documentation_robotics/claude_integration/README.md
   # - cli/src/documentation_robotics/claude_integration/USER_GUIDE.md
   # - cli/docs/user-guide/claude-code-integration.md
   ```

Report progress:

```text
✓ Updated cli/pyproject.toml (version: 0.4.2)
✓ Updated cli/src/documentation_robotics/__init__.py (version: 0.4.2, spec: 0.2.0)
✓ Updated cli/README.md (version badges, status section)
✓ Updated cli/docs/README.md
✓ Updated Claude integration docs (3 files)
✓ Verified spec/VERSION (0.2.0)
```

### Step 5: Update CHANGELOG.md (20%)

**Goal:** Create comprehensive changelog entry for the release

**Actions:**

1. Read current `cli/CHANGELOG.md`

2. Analyze changes from Step 3

3. Draft new changelog entry following Keep a Changelog format:

   ```markdown
   ## [<new-version>] - <YYYY-MM-DD>

   ### Added

   - New /dr-release-prep command for automated release preparation
   - Enhanced link validation with strict mode support
   - [... other additions based on git log analysis]

   ### Changed

   - Improved validation error messages for better clarity
   - Updated changeset comparison to show detailed diffs
   - [... other changes]

   ### Fixed

   - Fixed broken reference detection in cross-layer validation
   - Corrected spec version parsing edge cases
   - [... other fixes]

   ### Security

   - [If any security fixes]

   ### Migration

   [If any migration steps are needed for users]
   ```

4. Insert new entry at the top of the changelog (after the header)

5. Show the draft to the user for review:

   ```text
   Drafted Changelog Entry:
   ========================

   ## [0.4.2] - 2025-01-27

   ### Added
   - New /dr-release-prep command for automated release preparation
     [... rest of entry]

   Review this changelog entry. Should I:
   1. Use this as-is
   2. Let you edit it
   3. Regenerate with different focus
   ```

6. After approval, update the file

### Step 6: Validate Claude Integration (10%)

**Goal:** Ensure Claude Code integration is functional

**Actions:**

1. **Validate Command Files:**

   ```bash
   # Check all command files have proper frontmatter
   for file in cli/src/documentation_robotics/claude_integration/commands/*.md; do
       echo "Checking $file..."
       # Verify YAML frontmatter exists
       # Verify required fields: description, argument-hint
   done
   ```

2. **Validate Agent Files:**

   ```bash
   # Check all agent files have proper frontmatter
   for file in cli/src/documentation_robotics/claude_integration/agents/*.md; do
       echo "Checking $file..."
       # Verify YAML frontmatter exists
       # Verify required fields: name, description, tools
   done
   ```

3. **Validate Package Data Configuration:**

   ```bash
   # Ensure pyproject.toml includes all Claude files
   grep -A 10 "tool.setuptools.package-data" cli/pyproject.toml
   ```

4. **Check Install Script Logic:**

   ```python
   # Verify claude.py COMPONENTS includes all new files
   # Check version tracking in ClaudeIntegrationManager
   ```

Report:

```text
Claude Integration Validation
==============================
✓ Commands: 8 files, all with valid frontmatter
✓ Agents: 5 files, all with valid frontmatter
✓ Skills: 4 directories with SKILL.md
✓ Templates: 6 files
✓ Package data configured correctly
✓ Install script includes all components

Ready for installation/upgrade testing.
```

### Step 7: Run Pre-Commit Validation (10%)

**Goal:** Ensure code quality and formatting standards

**Actions:**

1. Enable the virtual environment so the pre-commit hooks can run:

   ```bash
   source .venv/bin/activate
   ```

2. Check if pre-commit is configured:

   ```bash
   # Check for .pre-commit-config.yaml
   ls -la .pre-commit-config.yaml
   ```

3. Run pre-commit on all files:

   ```bash
   cd cli
   pre-commit run --all-files
   ```

4. Handle failures:
   - If auto-fixable: Show what was fixed
   - If manual fix needed: Show errors and stop

Report:

```text
Pre-Commit Validation
=====================
✓ black (code formatting): Passed
✓ ruff (linting): Passed
✓ mypy (type checking): 2 warnings (acceptable)
✓ trailing-whitespace: Passed
✓ end-of-file-fixer: Fixed 3 files
✓ check-yaml: Passed

All checks passed! (3 files auto-formatted)
```

### Step 8: Run Complete Test Suite (15%)

**Goal:** Verify all functionality works

**Actions:**

1. **Run pytest with coverage:**

   ```bash
   cd cli
   python -m pytest --cov=documentation_robotics --cov-report=term-missing -v
   ```

2. **Monitor for failures:**
   - Stop immediately if any test fails
   - Show detailed failure information
   - Suggest fixes based on error type

3. **Verify coverage thresholds:**
   - Overall coverage should be > 80%
   - New code should be > 90% covered

4. **Run integration tests specifically:**

   ```bash
   python -m pytest tests/integration/ -v
   ```

5. **Test CLI commands manually:**

   ```bash
   # Verify dr command is accessible
   dr --version

   # Should show new version
   # Expected: "Documentation Robotics CLI v<new-version> (spec v<spec-version>)"
   ```

Report:

```text
Test Suite Results
==================
Unit Tests:     245 passed, 0 failed
Integration:    38 passed, 0 failed
Coverage:       92% (target: 80%)

Key areas tested:
✓ Core model operations
✓ Validation system
✓ Link management
✓ Export functionality
✓ Claude integration
✓ Migration utilities

Manual CLI verification:
✓ dr --version → 0.4.2 (spec v0.2.0)
✓ dr validate --help
✓ dr links --help

All tests passed! Release is validated.
```

### Step 9: Final Validation & Checklist (5%)

**Goal:** Provide comprehensive release checklist

**Actions:**

**Verify all version references are consistent:**

```bash
# Search for old version references
echo "Checking for old version references..."
grep -r "0.4.1" cli/ --exclude-dir=.venv --exclude-dir=__pycache__ --exclude="*.pyc"
```

**Generate release checklist:**

```text
Release Preparation Complete! ✓
================================

Version: CLI v0.4.2 (Spec v0.2.0)
Date: 2025-01-27

Completed Steps:
✓ Version numbers updated (6 files)
✓ CHANGELOG.md updated with release notes
✓ README files updated
✓ Claude integration validated
✓ Pre-commit checks passed
✓ Test suite passed (283 tests, 92% coverage)

Files Modified:
  cli/pyproject.toml
  cli/src/documentation_robotics/__init__.py
  cli/CHANGELOG.md
  cli/README.md
  cli/docs/README.md
  [+ 3 Claude integration files]

Next Steps - Release Process:
===============================

1. Review Changes:
   git status
   git diff

2. Commit Release:
   git add cli/
   git commit -m "Release cli-v0.4.2"

3. Create Git Tag:
   git tag -a cli-v0.4.2 -m "Release CLI v0.4.2"

4. Push to Remote:
   git push origin main
   git push origin cli-v0.4.2

5. Build Package:
   cd cli
   python -m build

6. Test Package Installation:
   pip install dist/documentation_robotics-0.4.2-py3-none-any.whl

7. Publish to PyPI (if authorized):
   python -m twine upload dist/*

8. Create GitHub Release:
   - Go to: https://github.com/tinkermonkey/documentation_robotics/releases/new
   - Tag: cli-v0.4.2
   - Title: "CLI v0.4.2"
   - Description: Copy from CHANGELOG.md
   - Attach: dist/documentation_robotics-0.4.2-py3-none-any.whl

9. Update Documentation:
   - Verify README displays correctly on GitHub
   - Check PyPI page formatting
   - Update any external documentation links

10. Announce:
    - Update main project README if needed
    - Post to discussions/social media
    - Notify users of important changes

Spec Release (if applicable):
==============================
[Only if spec version changed]

Before publishing CLI v0.4.2, you MUST release spec v0.3.0:

1. Commit spec changes:
   git add spec/
   git commit -m "Release spec-v0.3.0"

2. Tag spec release:
   git tag -a spec-v0.3.0 -m "Release Spec v0.3.0"

3. Push spec first:
   git push origin spec-v0.3.0

4. THEN proceed with CLI release steps above

Validation Checklist:
=====================
Before proceeding with release, verify:

[ ] All tests pass locally
[ ] Pre-commit checks pass
[ ] Version numbers are consistent everywhere
[ ] CHANGELOG.md is complete and accurate
[ ] README.md reflects new version
[ ] No debug code or TODO comments in release
[ ] All new features are documented
[ ] Breaking changes are clearly noted
[ ] Migration guide is provided (if needed)
[ ] Claude integration commands work
[ ] CLI help text is up to date
[ ] No sensitive information in commits

Ready to proceed with git commit and tagging!
```

## Error Handling

### Error: Invalid Version Format

```text
Error: Invalid version format: "0.4"

Version must follow semantic versioning: MAJOR.MINOR.PATCH
Examples:
  ✓ 0.4.2
  ✓ 1.0.0
  ✓ 2.1.3
  ✗ 0.4
  ✗ v0.4.2 (remove 'v' prefix)
  ✗ 0.4.2-beta (pre-release tags not supported yet)
```

### Error: Spec Version Mismatch

```text
Error: CLI spec dependency mismatch

CLI __spec_version__: 0.3.0
Spec VERSION file:    0.2.0

Resolution options:
1. Release spec v0.3.0 first, then CLI
2. Keep CLI at spec v0.2.0 (downgrade __spec_version__)
3. Abort and review changes

Which option? (1/2/3)
```

### Error: Tests Failed

```text
Error: Test suite failed

Failed tests: 3
  - test_relationship_validation_strict_mode (FAILED)
  - test_migration_v01_to_v02 (FAILED)
  - test_export_archimate_with_links (FAILED)

Cannot proceed with release until tests pass.

Suggested actions:
1. Review test failures: pytest -v --lf
2. Fix failing tests
3. Re-run: /dr-release-prep 0.4.2

Aborting release preparation.
```

### Error: Uncommitted Changes

```text
Warning: Uncommitted changes detected

Git status shows uncommitted changes in:
  cli/src/documentation_robotics/validators/
  cli/tests/unit/

Recommendation:
1. Commit or stash current changes first
2. Re-run /dr-release-prep on clean branch

Continue anyway? (not recommended) (yes/no)
```

### Error: Pre-commit Failed

```text
Error: Pre-commit validation failed

Failed checks:
  ✗ ruff - Found 5 linting errors
  ✗ black - Code formatting issues in 3 files

Auto-fixable:
  - black can auto-format (run: black cli/src/)

Manual fixes needed:
  - ruff errors in cli/src/documentation_robotics/commands/export.py:45
    → Unused import 'sys'

Fix these issues and re-run /dr-release-prep.
```

## Advanced Usage

### Coordinated Spec + CLI Release

When releasing both spec and CLI together:

```bash
# Step 1: Prepare spec release first
/dr-release-prep 0.5.0 --spec-version 0.3.0

# This will:
# 1. Ask to confirm spec changes
# 2. Update spec/VERSION to 0.3.0
# 3. Update CLI __spec_version__ to 0.3.0
# 4. Prepare both changelogs
# 5. Remind you to release spec FIRST

# Step 2: Release spec (manual)
git add spec/
git commit -m "Release spec-v0.3.0"
git tag spec-v0.3.0
git push origin spec-v0.3.0

# Step 3: Release CLI (manual)
git add cli/
git commit -m "Release cli-v0.5.0"
git tag cli-v0.5.0
git push origin cli-v0.5.0
```

### Patch Release (No Spec Changes)

For bug fixes and minor updates:

```bash
/dr-release-prep 0.4.3

# Uses current spec version (0.2.0)
# Focuses changelog on bug fixes
# Faster validation
```

### Pre-release / RC Builds

For release candidates (future enhancement):

```bash
# Not yet supported - manual process
# Future: /dr-release-prep 0.5.0-rc1 --spec-version 0.3.0-rc1
```

## Integration with Other Commands

**Related Commands:**

- `/dr-validate` - Validate model before release
- `/dr-changeset` - Test changes in isolation
- `dr claude upgrade` - Upgrade Claude integration files

**Suggested Workflow:**

```text
Development Cycle:
1. /dr-changeset create release-prep
2. [Make changes]
3. /dr-validate --strict
4. /dr-changeset apply release-prep
5. /dr-release-prep 0.4.2
6. [Follow release checklist]
```

## Configuration

Currently uses hard-coded paths and conventions. Future enhancement: `.dr-release.yaml` config:

```yaml
# Future configuration option
release:
  version_files:
    - cli/pyproject.toml
    - cli/src/documentation_robotics/__init__.py
    - cli/README.md

  changelog:
    path: cli/CHANGELOG.md
    format: keep-a-changelog

  validation:
    required:
      - pre-commit
      - pytest
      - coverage >= 80%

  publish:
    pypi: true
    github_release: true
```

## Notes for Developers

**This command automates but doesn't replace judgment:**

- Review all generated changelog entries
- Verify version numbers make sense
- Ensure breaking changes are documented
- Test installation on clean environment
- Review all modified files before committing

**Security considerations:**

- Never commit sensitive data
- Review all changes to install scripts
- Verify no debug/development code in release
- Check for proper input validation

**Best practices:**

- Always release spec before CLI if both change
- Run full test suite locally before releasing
- Keep changelog entries user-focused
- Document breaking changes prominently
- Provide migration guides when needed

## Related Documentation

- [Semantic Versioning](https://semver.org/)
- [Keep a Changelog](https://keepachangelog.com/)
- [DR Changelog](../../../CHANGELOG.md)
- [DR Spec Version History](../../../../../spec/CHANGELOG.md)
- [Python Packaging Guide](https://packaging.python.org/)
