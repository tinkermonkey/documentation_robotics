# CI/CD Workflows Documentation

This document describes the CI/CD workflows configured for the Documentation Robotics project.

## Overview

The repository uses GitHub Actions for continuous integration and continuous delivery. All workflows are configured in `.github/workflows/`.

## Active Workflows

### 1. Bun CLI Tests (`cli-tests.yml`)

**Purpose:** Runs automated tests for the Bun CLI on every push and pull request.

**Triggers:**

- Push to `main` or `develop` branches (when `cli-bun/**` changes)
- Pull requests to `main` or `develop` branches (when `cli-bun/**` changes)
- Manual workflow dispatch

**Jobs:**

#### `test` Job

Runs the complete Bun CLI test suite:

1. Setup Node.js 18
2. Install Bun runtime
3. Install dependencies
4. Build CLI
5. Run linting (optional, continues on error)
6. Run unit tests
7. Run integration tests
8. Run compatibility tests

**Test Commands:**

- `npm run test:unit` - Unit tests for all modules
- `npm run test:integration` - Integration tests for CLI commands
- `npm run test:compatibility` - Compatibility tests verifying CLI behavior

### 2. Specification Validation (`spec-validation.yml`)

**Purpose:** Validates JSON schemas and documentation consistency for the specification.

**Triggers:**

- Manual workflow dispatch only (currently disabled for automatic triggers)

**Jobs:**

#### `validate-schemas` Job

Validates JSON schema syntax:

1. Setup Node.js 18
2. Install AJV CLI tools
3. Validate all `spec/schemas/*.schema.json` files
4. Check schema references

#### `validate-links` Job

Checks markdown link integrity:

1. Setup Node.js 18
2. Install markdown-link-check
3. Validate links in core documentation
4. Validate links in layer documentation

#### `check-consistency` Job

Verifies specification consistency:

1. Verify `spec/VERSION` file exists
2. Validate VERSION format (semantic versioning)
3. Check CHANGELOG updates on pull requests

#### `spell-check` Job

Runs spell checking on specification markdown files:

1. Check spelling in `spec/**/*.md` files
2. Use custom dictionary from `.github/spellcheck-config.json`

### 3. Release Workflow (`release.yml`)

**Purpose:** Automates releases for both specification and Bun CLI.

**Triggers:**

- Tags matching `spec-v*.*.*` (specification releases)
- Tags matching `cli-bun-v*.*.*` (Bun CLI releases)

**Jobs:**

#### `release-spec` Job

Creates specification release:

1. Extract version from tag
2. Verify VERSION file matches tag
3. Package schemas (tarball and zip)
4. Extract release notes from CHANGELOG
5. Create GitHub release with schema artifacts

#### `release-bun-cli` Job

Creates Bun CLI release:

1. Extract version from tag
2. Setup Node.js with npm registry authentication
3. Install dependencies and build package
4. Run full test suite
5. Publish package to npm registry
6. Create GitHub release with build artifacts

## Removed Workflows

The following workflows were removed as part of Python CLI deprecation:

### Python CLI Tests (Removed)

- **Previously:** Ran pytest for Python CLI across Python 3.10-3.13
- **Removed:** December 2025
- **Reason:** Python CLI deprecated and removed from codebase
- **Replacement:** Bun CLI tests now cover all functionality

### Python CLI Conformance Tests (Removed)

- **Previously:** Ran conformance tests for Python CLI
- **Removed:** December 2025
- **Reason:** Python CLI deprecated and removed from codebase
- **Replacement:** Future conformance tests will be added to Bun CLI

### Python CLI Release (Removed from release.yml)

- **Previously:** Published Python CLI to PyPI
- **Removed:** December 2025
- **Reason:** Python CLI deprecated, final v0.8.0 published
- **Replacement:** Bun CLI releases to npm

## Workflow Configuration Files

All workflows use:

- **Node.js version:** 18
- **Ubuntu runner:** `ubuntu-latest`
- **Checkout action:** `actions/checkout@v3`
- **Node setup:** `actions/setup-node@v3`

## Running Workflows Locally

### Bun CLI Tests

```bash
cd cli-bun
npm install
npm run build
npm run test:unit
npm run test:integration
npm run test:compatibility
```

### Specification Validation

```bash
# Install tools
npm install -g ajv-cli ajv-formats markdown-link-check

# Validate schemas
for schema in spec/schemas/*.schema.json; do
  ajv compile -s "$schema" --strict=false
done

# Check links
for file in spec/layers/*.md; do
  markdown-link-check "$file"
done

# Verify VERSION
cat spec/VERSION
```

## CI/CD Best Practices

### 1. Fast Feedback

- Tests run on every push and pull request
- Failures block merges to main branch
- Parallel job execution where possible

### 2. Artifact Preservation

- Validation reports saved as artifacts
- Build outputs preserved for releases
- Coverage reports uploaded to Codecov (future)

### 3. Caching

- npm dependencies cached between runs
- Build outputs cached for release workflow

### 4. Security

- npm publish uses `NPM_TOKEN` secret
- GitHub releases use built-in `GITHUB_TOKEN`
- Workflows have minimal permissions (read by default)

## Troubleshooting

### Workflow Not Triggering

Check the path filters in `on.push.paths` - workflows only run when specified paths change.

### Test Failures

1. Check the workflow run logs in GitHub Actions tab
2. Run tests locally to reproduce: `cd cli-bun && npm test`
3. Fix failing tests and push again

### Release Workflow Issues

1. Verify tag format matches pattern: `spec-v1.2.3` or `cli-bun-v1.2.3`
2. Ensure VERSION file matches tag version
3. Check that all tests pass before tagging
4. Verify secrets are configured: `NPM_TOKEN` for npm publishing

## Future Enhancements

Planned workflow improvements:

- [ ] Add code coverage reporting to Codecov
- [ ] Add conformance tests to Bun CLI test suite
- [ ] Enable automatic spec validation on all pushes
- [ ] Add performance benchmarking workflow
- [ ] Add security scanning (Snyk/Dependabot)
- [ ] Add documentation deployment workflow

## Migration Notes

**December 2025 - Python CLI Removal:**

All Python-related CI/CD workflows have been removed. The project now uses only the Bun CLI for:

- Command-line interface
- Validation and testing
- Export functionality
- Visualization server

For migration guidance, see [Migration from Python CLI](../migration-from-python-cli.md).

## Additional Resources

- [CI/CD Integration Guide](./ci-cd-integration.md) - Using DR CLI in your own pipelines
- [Bun CLI Documentation](../cli-bun/README.md)
- [Specification Documentation](../spec/README.md)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
