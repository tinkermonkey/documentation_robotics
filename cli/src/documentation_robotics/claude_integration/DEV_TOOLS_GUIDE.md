# Development Tools Guide

This guide covers the specialized Claude Code tools built for **developing** the Documentation Robotics project itself (not for end-users).

## Overview

Two development automation tools have been created to address the most common pain points in the DR development workflow:

1. **Spec-CLI Consistency Validator** (Skill) - Auto-activates when modifying specs or CLI
2. **Release Pre-flight Agent** (Agent) - Validates releases before version bumps

## 1. Spec-CLI Consistency Validator Skill

**Location:** `skills/SPEC_CLI_CONSISTENCY/SKILL.md`

**Type:** Auto-activating skill (proactive)

### Purpose

Prevents the #1 common pitfall: spec and CLI falling out of sync, especially schemas.

### When It Activates

The skill automatically suggests itself when:
- You modify files in `spec/layers/*.md`
- You modify files in `spec/schemas/*.schema.json`
- You modify files in `cli/src/documentation_robotics/schemas/bundled/*.schema.json`
- You modify `cli/src/documentation_robotics/core/layer.py`
- You modify validators or export formatters
- You mention "consistency", "sync", "spec", or "schema mismatch"
- Before committing changes to spec or CLI

### What It Checks

1. **Schema Synchronization** (Critical)
   - Verifies `spec/schemas/` matches `cli/schemas/bundled/`
   - Byte-for-byte comparison
   - Auto-fix: Copy schemas from spec to CLI

2. **Layer Definition Consistency**
   - Layer names in `spec/layers/` match `core/layer.py` enum
   - Layer numbering is consistent

3. **Element Type Validation**
   - Element types in spec match JSON schemas
   - Element types are validated by CLI
   - Element types are handled by exporters

4. **Cross-Layer Reference Types**
   - Link types in spec match `link-registry.json`
   - Link descriptions are consistent

5. **Export Format Mappings**
   - Export formats documented in spec match CLI exporters
   - Layer support matches between spec and implementation

6. **Validation Rules**
   - Validation rules in spec are implemented in CLI
   - No undocumented validation rules in CLI

7. **Version Compatibility**
   - CLI version >= spec version
   - Compatibility documented in CHANGELOGs

### Example Output

```markdown
# Spec-CLI Consistency Report

## Summary
- ✅ 12 checks passed
- ❌ 3 issues found
- ⚠️ 2 warnings

## Critical Issues

### ❌ Schema Mismatch: 06-api-layer.schema.json
**Issue:** Schema in spec has new `operationSecurity` field not in CLI
**Fix:**
```bash
cp spec/schemas/06-api-layer.schema.json cli/src/documentation_robotics/schemas/bundled/
```

## Auto-fix Available

Run these commands to fix critical issues:
```bash
# Sync schemas
cp spec/schemas/*.schema.json cli/src/documentation_robotics/schemas/bundled/

# Verify
cd cli && pytest tests/unit/test_schema_validation.py
```
```

### How to Use

**Automatic (Recommended):**
The skill auto-activates when you modify relevant files. Claude Code will suggest running the consistency check.

**Manual:**
```
You: "Check if spec and CLI are in sync"
Claude: [Activates Spec-CLI Consistency Validator skill]
```

**In Development Workflow:**
```bash
# After modifying a layer spec
1. Edit spec/layers/06-api-layer.md
2. Edit spec/schemas/06-api-layer.schema.json
3. [Skill auto-activates and suggests validation]
4. Review findings
5. Apply auto-fixes or manual corrections
6. Commit changes
```

### Confidence Scoring

- **High (90-100%):** Schema mismatches, missing files, version numbers
- **Medium (70-89%):** Layer enum mismatches, element type mismatches
- **Low (50-69%):** Validation rule documentation gaps

Trust high-confidence auto-fixes - they're safe to apply.

## 2. Release Pre-flight Agent

**Location:** `agents/dr-release-preflight.md`

**Type:** Agent (manual launch)

### Purpose

Runs comprehensive validation before version bumps to prevent releasing broken code.

### When to Use

Before any version bump:
- Before running `/dr-release-prep`
- Before tagging releases
- Before publishing to PyPI
- After major feature merges

### What It Validates

#### Phase 1: Environment (10%)
- Git status clean (no uncommitted changes)
- On main/master branch
- Up-to-date with remote
- Virtual environment active
- Dependencies installed

#### Phase 2: Schema Sync (15%)
- All schemas synchronized between spec and CLI
- No schema content differences
- No orphaned schemas

#### Phase 3: Tests (25%)
- All unit tests pass (0 failures)
- All integration tests pass
- Code coverage >= 80%
- Linting passes (ruff, pre-commit)

#### Phase 4: CHANGELOG (15%)
- Spec CHANGELOG has entry for target version
- CLI CHANGELOG has entry for target version
- Entries have dates and meaningful content
- Breaking changes clearly marked

#### Phase 5: Version Compatibility (10%)
- Version bump type matches changes (major/minor/patch)
- Version numbers increment logically
- CLI-Spec compatibility maintained

#### Phase 6: Documentation (10%)
- CLAUDE.md references current versions
- README files are up-to-date
- Breaking changes documented

#### Phase 7: CI/CD (10%)
- Latest GitHub Actions run passed
- All required checks passed
- Pre-commit hooks pass

#### Phase 8: Final Checks (5%)
- No critical TODOs in new code
- No security vulnerabilities (pip-audit)

### Example Output

**Success:**
```
🚀 Release Pre-flight Check

✅ CLEARED FOR RELEASE

Summary:
- 156/156 tests passed
- 12/12 schemas synchronized
- 87% code coverage
- 0 security vulnerabilities

⚠️ 1 Warning:
  - README.md version reference needs update

Next steps:
1. Fix warning (optional)
2. Proceed: /dr-release-prep --execute
```

**Failure:**
```
🚀 Release Pre-flight Check

❌ RELEASE BLOCKED

Critical failures:
1. Schema mismatch: 3 schemas out of sync
2. Test failures: 4/156 tests failing

Required actions:
1. Sync schemas (auto-fix available)
2. Fix 4 failing tests
3. Re-run pre-flight

❌ RELEASE CANNOT PROCEED
```

### How to Use

**Via /dr-release-prep Command:**
```bash
# The command automatically runs pre-flight checks
/dr-release-prep cli 0.8.0 minor

# Dry-run mode (checks only, no changes)
/dr-release-prep cli 0.8.0 minor --dry-run

# Skip specific checks (not recommended)
/dr-release-prep cli 0.8.0 minor --skip-tests --skip-ci
```

**Manual Launch:**
```
You: "I want to release CLI v0.8.0, can you run pre-flight checks?"
Claude: [Launches dr-release-preflight agent]
```

**In Release Workflow:**
```bash
# Standard release process
1. Complete all development work
2. Update CHANGELOGs
3. Run: /dr-release-prep cli 0.8.0 minor --dry-run
4. Review pre-flight report
5. Fix any critical issues
6. Re-run pre-flight
7. Execute release: /dr-release-prep --execute
8. Tag and publish
```

### Parameters

```yaml
target: "cli"              # "cli" | "spec" | "both"
version: "0.8.0"           # Target version
bump_type: "minor"         # "major" | "minor" | "patch"
dry_run: false             # Check without changing files
skip_tests: false          # Skip running tests
skip_ci: false             # Skip CI/CD checks
auto_fix: true             # Auto-fix low-risk issues
strict: false              # Fail on warnings
```

### Error Handling

The agent blocks releases on:
- ❌ Any test failures
- ❌ Schema synchronization issues
- ❌ Missing CHANGELOG entries
- ❌ Failing CI/CD checks
- ❌ Uncommitted changes

The agent warns on:
- ⚠️ Coverage below target
- ⚠️ Old CI runs
- ⚠️ TODOs in new code
- ⚠️ Documentation out of date

You can proceed with warnings, but not critical failures.

## Integration Between Tools

The two tools work together:

```
Development Workflow:
1. Modify spec or CLI
2. [Spec-CLI Consistency Validator auto-activates]
3. Fix any consistency issues
4. Commit changes
5. Before release: Launch dr-release-preflight
6. Fix any pre-flight issues
7. Release with /dr-release-prep
```

**Pre-commit Hook Example:**
```bash
#!/bin/bash
# .git/hooks/pre-commit

# Check for spec or CLI changes
if git diff --cached --name-only | grep -qE '^(spec/|cli/src/)'; then
    echo "🔍 Running spec-CLI consistency check..."
    # Trigger consistency validation
    # (Manual for now, could be automated)
fi
```

## Best Practices

### For Spec-CLI Consistency

1. **Run after every spec change** - Catch drift immediately
2. **Trust high-confidence fixes** - Auto-apply schema syncs
3. **Investigate warnings** - They reveal undocumented assumptions
4. **Sync schemas first** - Schema mismatches break everything else
5. **Update both spec AND CLI** - Never update one without the other

### For Release Pre-flight

1. **Run pre-flight early** - Don't wait until release day
2. **Fix issues incrementally** - Address failures one at a time
3. **Never skip critical checks** - Tests, schema sync, CHANGELOG
4. **Document breaking changes** - Users need migration guidance
5. **Keep CI green** - Don't release with failing CI
6. **Use dry-run mode first** - Test the release process

## Installation

These tools are included in the claude_integration directory and will be available after running:

```bash
dr claude install
```

Or they can be used directly from the source repository by Claude Code since they're already in `.claude/` equivalent locations.

## Testing the Tools

### Test Spec-CLI Consistency Validator

```bash
# 1. Modify a schema (intentionally break sync)
echo "// test change" >> spec/schemas/01-motivation-layer.schema.json

# 2. In Claude Code, ask:
"Are the spec and CLI schemas in sync?"

# 3. Skill should activate and detect the mismatch

# 4. Restore the schema
git checkout spec/schemas/01-motivation-layer.schema.json
```

### Test Release Pre-flight Agent

```bash
# 1. Add a TODO to test final validation
echo "# TODO: test" >> cli/src/documentation_robotics/cli.py

# 2. In Claude Code, ask:
"Run pre-flight checks for CLI v0.7.4 patch release"

# 3. Agent should detect the TODO

# 4. Remove the TODO
git checkout cli/src/documentation_robotics/cli.py
```

## Troubleshooting

### Skill Not Auto-Activating

**Problem:** Spec-CLI Consistency Validator doesn't activate when modifying files

**Solutions:**
1. Mention keywords explicitly: "Check spec-CLI consistency"
2. Verify files are in the trigger paths
3. Manually trigger: "Validate that spec and CLI are in sync"

### Agent Fails to Run Tests

**Problem:** Release pre-flight agent can't run pytest

**Solutions:**
1. Ensure virtual environment is activated
2. Check current directory: `pwd` should be repo root
3. Install dependencies: `cd cli && pip install -e ".[dev]"`
4. Use `skip_tests: true` parameter if tests already run

### False Positives

**Problem:** Agent reports issues that aren't actually problems

**Solutions:**
1. Review the confidence score
2. Check if it's a warning vs. error
3. Provide context: "The TODO is intentional and documented"
4. Use `strict: false` to ignore warnings

## Future Enhancements

Potential improvements for these tools:

1. **Automated Pre-commit Hooks** - Auto-run consistency checks
2. **GitHub Actions Integration** - Run pre-flight in CI/CD
3. **Slack Notifications** - Alert on consistency issues
4. **Historical Tracking** - Track consistency scores over time
5. **Auto-remediation** - More auto-fix capabilities

## Contributing

These tools are part of the DR development workflow. To improve them:

1. Edit the markdown files directly
2. Test with real scenarios
3. Document new checks or validations
4. Update this guide
5. Submit PR with improvements

## See Also

- [CLAUDE.md](../../../CLAUDE.md) - Main AI assistant guide
- [Claude Integration README](README.md) - User-facing integration
- [Custom Agent Template](templates/custom-agent-template.md) - Create more tools
