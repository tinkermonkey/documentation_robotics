# GitHub Workflows

## Current Status: Disabled

**Why?** CI workflows are temporarily disabled to prevent costly failure cycles while pre-commit hooks are being set up.

**What to do?** Install and use pre-commit hooks locally (see [../../PRE_COMMIT_SETUP.md](../../PRE_COMMIT_SETUP.md))

## Workflows

### Spec Validation (`spec-validation.yml`)

**Status:** Disabled (manual trigger only)
**Purpose:** Validate specification files

**Checks:**

- JSON Schema syntax
- Markdown link validity
- VERSION file format
- CHANGELOG updates
- Spell checking

**Re-enable when:**

- [ ] Pre-commit hooks are stable
- [ ] All files pass local validation
- [ ] Team is using hooks consistently

### CLI Tests (`cli-tests.yml`)

**Status:** Disabled (manual trigger only)
**Purpose:** Test CLI tool

**Checks:**

- Python 3.9-3.12 compatibility
- Linting (ruff, black)
- Type checking (mypy)
- Unit and integration tests
- Conformance tests
- Code coverage

**Re-enable when:**

- [ ] Pre-commit hooks are stable
- [ ] All tests pass locally
- [ ] Team is using hooks consistently

### Release (`release.yml`)

**Status:** Enabled (release tags only)
**Purpose:** Publish releases

**Note:** Keep enabled for releases, but ensure pre-commit validation passes before tagging

## How to Re-enable

When ready to re-enable CI:

1. **Verify local validation passes:**

   ```bash
   pre-commit run --all-files
   pytest  # In cli/ directory
   ```

2. **Update workflow files:**

   ```bash
   # Uncomment the push/pull_request triggers in:
   .github/workflows/spec-validation.yml
   .github/workflows/cli-tests.yml
   ```

3. **Test with small PR:**
   - Create a small test PR
   - Verify workflows run successfully
   - Merge if all passes

4. **Document re-enablement:**
   - Update this README
   - Announce to team

## Manual Workflow Triggers

Even while disabled, workflows can be triggered manually:

```bash
# Via GitHub UI:
# 1. Go to Actions tab
# 2. Select workflow
# 3. Click "Run workflow"
# 4. Select branch and run

# Via GitHub CLI:
gh workflow run spec-validation.yml
gh workflow run cli-tests.yml
```

## Local Alternative

While CI is disabled, run validation locally:

```bash
# Spec validation
pre-commit run --all-files
pre-commit run check-yaml --all-files
pre-commit run check-jsonschema --all-files

# CLI tests
cd cli
pytest
black --check src/
ruff check src/
mypy src/
```

---

**Last Updated:** 2025-01-23
**Next Review:** After pre-commit hooks stabilize
