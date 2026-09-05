# Release Process for Documentation Robotics

This document describes the correct release workflow for both the Specification and CLI components.

## Critical Rule: Never Manually Edit Bundled Files

**IMPORTANT**: The following files should NEVER be manually edited:

- `cli/src/schemas/bundled/*.json` - Copied from `spec/schemas/`
- `cli/src/schemas/bundled/common/*.json` - Copied from `spec/schemas/common/`

These files are bundled into the CLI build from the authoritative spec sources. Manual edits will be overwritten and may cause version inconsistencies.

## Release Types

There are two independent release types:

| Release Type  | Tag Format        | Example       | Artifacts                  |
| ------------- | ----------------- | ------------- | -------------------------- |
| Specification | `spec-v{version}` | `spec-v0.6.0` | `schemas-{version}.tar.gz` |
| CLI           | `cli-v{version}`  | `cli-v0.1.0`  | npm package                |

## Correct Release Workflow

### Specification Release

When making changes to the specification (schemas, layer definitions, etc.):

```
1. Edit spec files in spec/ directory
   └── spec/schemas/*.schema.json
   └── spec/layers/*.md
   └── spec/VERSION

2. Update spec/VERSION with new version number

3. Update spec/CHANGELOG.md with release notes

4. Commit changes to main branch
   git add spec/
   git commit -m "Spec: [description of changes]"

5. Create and push spec release tag
   git tag spec-v0.6.0
   git push origin spec-v0.6.0

6. GitHub Actions creates release with schemas tarball
   └── Release: spec-v0.6.0
   └── Asset: schemas-0.6.0.tar.gz
```

### CLI Release (May Depend on Spec Release)

When releasing a new CLI version:

```
1. If schema changes are needed:
   a. Create spec release first (see above)
   b. Copy updated schemas to cli/src/schemas/bundled/

2. Update cli/package.json version
   └── "version": "0.1.0"  # Increment for CLI release

3. Update cli/CHANGELOG.md with release notes

4. Test the build locally
   cd cli
   npm install
   npm run build
   npm run test

5. Commit changes
   git add cli/
   git commit -m "CLI release v0.1.0"

6. Create and push CLI release tag
   git tag cli-v0.1.0
   git push origin cli-v0.1.0

7. GitHub Actions builds and publishes to npm
```

## Version Dependencies

```
CLI Version → Spec Version (bundled schemas)
    │
    └── Schemas copied from spec/schemas/ to cli/src/schemas/bundled/
            │
            └── spec-v{SPEC_VERSION} release should exist for compatibility
```

**Rule**: When bundling new schemas, ensure the corresponding spec version has been released on GitHub.

## Common Mistakes to Avoid

### 1. Editing Bundled Schemas Directly

**Wrong**:

```bash
# NEVER DO THIS
vim cli/src/schemas/bundled/09-ux-layer.schema.json
```

**Correct**:

```bash
# Edit the source schema
vim spec/schemas/09-ux-layer.schema.json

# Create spec release
git tag spec-v0.6.1
git push origin spec-v0.6.1

# Copy to CLI bundled schemas
cp spec/schemas/09-ux-layer.schema.json cli/src/schemas/bundled/

# Build and test
cd cli
npm run build
npm run test
```

### 2. Releasing CLI Before Spec (When Schema Changes Exist)

**Wrong**:

```bash
# Spec changes not released yet
vim spec/schemas/09-ux-layer.schema.json
git commit -m "Fix schema"

# CLI release without spec release
cp spec/schemas/09-ux-layer.schema.json cli/src/schemas/bundled/
git tag cli-v0.1.1  # Bad: spec not released
```

**Correct**:

```bash
# First: Release spec
vim spec/schemas/09-ux-layer.schema.json
git commit -m "Spec: Fix schema"
git tag spec-v0.6.1
git push origin spec-v0.6.1

# Wait for GitHub Action to complete

# Then: Update CLI with new schemas
cp spec/schemas/09-ux-layer.schema.json cli/src/schemas/bundled/
npm run build
npm run test
git commit -m "Update bundled schemas to v0.6.1"
git tag cli-v0.1.1
git push origin cli-v0.1.1
```

### 3. Version Mismatches

The CLI can be released independently of spec changes, but when schema changes are bundled, ensure proper version tracking:

```bash
# Check spec version
cat spec/VERSION

# Check CLI version
cat cli/package.json | grep version

# Document which spec version the CLI bundles in CHANGELOG
```

## Verification Steps

### Before Spec Release

```bash
# Verify schemas are valid JSON
for file in spec/schemas/*.json; do
  echo "Validating $file"
  node -e "JSON.parse(require('fs').readFileSync('$file', 'utf8'))"
done

# Run schema validation tests
cd cli && npm run test

# Check VERSION file
cat spec/VERSION
```

### Before CLI Release

```bash
# Verify spec release exists (if bundling new schemas)
curl -s https://api.github.com/repos/tinkermonkey/documentation_robotics/releases/tags/spec-v0.6.0 | jq '.tag_name'

# Full build test
cd cli
npm install
npm run build
npm run test

# Test CLI commands
node dist/cli.js --version
node dist/cli.js validate --help
```

### After Release

```bash
# Verify npm package (when published)
npm install -g @documentation-robotics/cli
dr --version
dr validate --help
```

## Emergency: Fixing a Bad Release

If bundled schemas were accidentally modified:

```bash
# 1. Restore bundled schemas from spec source
cp spec/schemas/*.json cli/src/schemas/bundled/
cp spec/schemas/common/*.json cli/src/schemas/bundled/common/

# 2. Verify the fix
cd cli
npm run build
npm run test

# 3. Commit the fix
git add cli/src/schemas/bundled/
git commit -m "Fix: Restore bundled schemas from spec source"
```

## File Reference

| File                              | Purpose                          | Edit Directly? |
| --------------------------------- | -------------------------------- | -------------- |
| `spec/schemas/*.json`             | Authoritative schema definitions | Yes            |
| `spec/VERSION`                    | Spec version number              | Yes            |
| `cli/package.json`                | CLI version and dependencies     | Yes            |
| `cli/src/schemas/bundled/`        | Bundled schemas for CLI          | **NO**         |
| `cli/src/schemas/bundled/common/` | Bundled common schemas           | **NO**         |

## Troubleshooting

### "Release not found" Error

The spec release doesn't exist yet:

```bash
# Check if release exists
curl -s https://api.github.com/repos/tinkermonkey/documentation_robotics/releases/tags/spec-v0.6.0

# If not, create it first
git tag spec-v0.6.0
git push origin spec-v0.6.0
```

### Bundled Schemas Are Stale

The bundled schemas don't match the spec source:

```bash
# Re-copy from spec source
cp spec/schemas/*.json cli/src/schemas/bundled/
cp spec/schemas/common/*.json cli/src/schemas/bundled/common/

# Rebuild
cd cli
npm run build
npm run test
```

### Build Failures

If the build fails after updating schemas:

```bash
# Clean and rebuild
cd cli
rm -rf dist node_modules
npm install
npm run build

# Check TypeScript errors
npm run build -- --noEmit
```

## Using /dr-release-prep Command

The repository includes a `/dr-release-prep` command for Claude Code that automates release preparation:

```bash
# In Claude Code:
/dr-release-prep

# This will:
# 1. Run comprehensive validation checks
# 2. Update version numbers
# 3. Generate changelog entries
# 4. Verify CI/CD compatibility
# 5. Create a release readiness report
```

**When to use:**

- Before any version bump (spec or CLI)
- To verify release readiness
- To automate changelog generation
- To ensure all checks pass

## Related Documentation

- [BUILDING.md](BUILDING.md) - Build process details (deprecated for Python CLI)
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines
- [cli/CHANGELOG.md](cli/CHANGELOG.md) - CLI release history
- [spec/CHANGELOG.md](spec/CHANGELOG.md) - Spec release history
- [cli/README.md](cli/README.md) - CLI installation and usage
