# Building the Documentation Robotics CLI

This document describes how to build and package the Documentation Robotics CLI tool.

> **IMPORTANT**: Bundled schemas should NEVER be manually edited. See [RELEASING.md](RELEASING.md)
> for the correct spec -> CLI release workflow.

## Prerequisites

- **Python 3.10 or higher**
- **pip** (Python package manager)
- **build** package: `pip install build`

## Build Process Overview

The CLI package build process has three main steps:

1. **Bundle Viewer**: Download and bundle the viewer web application
2. **Prepare Build**: Fetch schemas from GitHub releases and copy integration files
3. **Build Package**: Create the distributable Python package

## Quick Build

```bash
# From the repository root
python scripts/bundle_viewer.py  # Bundle the viewer first
python scripts/prepare_build.py
cd cli
python -m build
```

## Detailed Build Instructions

### Step 0: Bundle Viewer (Required)

The viewer must be bundled before building the CLI package. The viewer provides the web-based visualization interface for the `dr view` command.

**Bundle the viewer**:

```bash
python scripts/bundle_viewer.py
```

This script:

1. Downloads the latest viewer release from [documentation_robotics_viewer](https://github.com/tinkermonkey/documentation_robotics_viewer)
2. Extracts the viewer bundle to `cli/src/documentation_robotics/viewer/dist/`
3. Verifies the bundle includes all required assets (HTML, JS, CSS)

**Options**:

| Option      | Description                             |
| ----------- | --------------------------------------- |
| `--version` | Specify viewer version (default: 0.1.0) |
| `--force`   | Force re-download even if viewer exists |

**Examples**:

```bash
# Bundle specific version
python scripts/bundle_viewer.py --version 0.2.0

# Force re-download
python scripts/bundle_viewer.py --force
```

**Validation**: The build includes a validation test to ensure the viewer is properly bundled:

```bash
cd cli
pytest tests/validation/test_viewer_bundling.py -v
```

This test verifies:

- Viewer dist directory exists
- index.html exists and contains React root element
- JavaScript bundles exist and are not empty
- CSS files exist and are not empty
- pyproject.toml includes viewer/dist in package data

**Important**: Without the bundled viewer, the CLI will fail validation tests and the visualization features will not work in the installed package.

### Step 1: Prepare Build

The `prepare_build.py` script bundles schemas and integration files into the CLI package source.

**Default behavior**: Fetches schemas from the corresponding GitHub release:

```bash
python scripts/prepare_build.py
```

**Options**:

| Option                   | Description                                                        |
| ------------------------ | ------------------------------------------------------------------ |
| `--local`                | Use local schemas instead of fetching from GitHub                  |
| `--spec-version VERSION` | Override the spec version (default: from spec_version.py)          |
| `--dry-run`              | Show what would be done without making changes                     |
| `--verbose`, `-v`        | Enable verbose output                                              |
| `--root-dir PATH`        | Override project root directory                                    |
| `--verify`               | Verify integrity of existing bundled schemas (detect manual edits) |

**Examples**:

```bash
# Verbose output with dry run
python scripts/prepare_build.py --verbose --dry-run

# Use local schemas (for development)
python scripts/prepare_build.py --local

# Build for a specific spec version
python scripts/prepare_build.py --spec-version 0.5.0
```

### Step 2: Build Package

```bash
cd cli
python -m build
```

This creates:

- `dist/documentation_robotics-X.Y.Z.tar.gz` - Source distribution
- `dist/documentation_robotics-X.Y.Z-py3-none-any.whl` - Wheel distribution

## Schema Bundling

### How It Works

The build script fetches schemas from GitHub releases to ensure version consistency:

1. Reads spec version from `cli/src/documentation_robotics/spec_version.py`
2. Downloads `schemas-{version}.tar.gz` from the corresponding GitHub release
3. Extracts and copies schema files to `cli/src/documentation_robotics/schemas/bundled/`
4. Copies `link-registry.json` to `cli/src/documentation_robotics/schemas/` (DEPRECATED as of v0.7.0)
5. Copies `relationship-catalog.json`, `relationship-type.schema.json`, and common schema files to `cli/src/documentation_robotics/schemas/bundled/`

### GitHub Release Requirement

For each spec version, the corresponding GitHub release must exist with the schemas tarball:

- **Release tag**: `spec-v{version}` (e.g., `spec-v0.5.0`)
- **Required asset**: `schemas-{version}.tar.gz` (e.g., `schemas-0.5.0.tar.gz`)

The release workflow (`.github/workflows/release.yml`) automatically creates these assets when tagging a spec release.

### Fallback Behavior

If GitHub fetch fails (network issues, missing release, etc.):

1. Warning is displayed
2. Script attempts to use local schemas from `spec/schemas/`
3. Local schema version is verified against expected version
4. If versions match, local schemas are used
5. If versions don't match, build fails with exit code 2

### Environment Variables

| Variable       | Description                                      |
| -------------- | ------------------------------------------------ |
| `GITHUB_TOKEN` | Optional GitHub token for higher API rate limits |

## Version Configuration

Version information is configured in `cli/src/documentation_robotics/spec_version.py`:

```python
# Specification version implemented
SPEC_VERSION = "0.5.0"

# GitHub repository configuration
GITHUB_CONFIG = {
    "owner": "tinkermonkey",
    "repo": "documentation_robotics",
    "release_tag_prefix": "spec-v",
}
```

To release a new CLI version with a different spec version:

1. Update `SPEC_VERSION` in `spec_version.py`
2. Ensure the corresponding spec release exists on GitHub
3. Run the build process

## Exit Codes

| Code | Meaning                                                                |
| ---- | ---------------------------------------------------------------------- |
| 0    | Success                                                                |
| 1    | Schema bundling failed                                                 |
| 2    | Both GitHub fetch and local fallback failed                            |
| 3    | Configuration error                                                    |
| 4    | Integrity verification failed (bundled schemas were manually modified) |

## CI/CD Integration

### GitHub Actions

The release workflow automatically handles builds when pushing tags:

```yaml
# For CLI releases (cli-v*.*.*)
- name: Build package
  working-directory: ./cli
  run: python -m build
```

For local CI testing:

```bash
# Test build without network (uses local schemas)
python scripts/prepare_build.py --local --verbose
cd cli
python -m build

# Verify package
pip install dist/documentation_robotics-*.whl
dr --version
```

### Pre-release Testing

Before releasing:

```bash
# 1. Bundle viewer
python scripts/bundle_viewer.py

# 2. Verify viewer is bundled correctly
cd cli
pytest tests/validation/test_viewer_bundling.py -v
cd ..

# 3. Verify schemas are up to date
python scripts/generate_schemas.py --check-only

# 4. Test build with dry run
python scripts/prepare_build.py --dry-run --verbose

# 5. Build and install locally
python scripts/prepare_build.py --local
cd cli
pip install -e .

# 6. Run all tests
pytest

# 7. Verify version and conformance
dr conformance
```

## Troubleshooting

### Viewer Bundling Fails

**Symptoms**: `bundle_viewer.py` fails with "Could not find viewer bundle directory" or download errors

**Solutions**:

1. Verify the viewer release exists: `https://github.com/tinkermonkey/documentation_robotics_viewer/releases/tag/v{version}`
2. Check that `dr-viewer-bundle-{version}.zip` asset is attached to the release
3. Try a different version: `python scripts/bundle_viewer.py --version 0.1.0`
4. Check network connectivity and firewall settings

**Symptoms**: Validation tests fail with "Viewer dist directory not found"

**Solutions**:

```bash
# Re-bundle the viewer
python scripts/bundle_viewer.py --force

# Verify the viewer is bundled
cd cli
pytest tests/validation/test_viewer_bundling.py -v
```

### GitHub Fetch Fails

**Symptoms**: Build fails with "Release not found" or "Network error"

**Solutions**:

1. Verify the spec release exists: `https://github.com/tinkermonkey/documentation_robotics/releases/tag/spec-v{version}`
2. Check that `schemas-{version}.tar.gz` asset is attached to the release
3. Set `GITHUB_TOKEN` environment variable for higher rate limits
4. Use `--local` flag if working offline (requires matching local spec version)

### Local Fallback Fails

**Symptoms**: Build fails with "Local fallback not available: version mismatch"

**Solutions**:

1. Check `spec/VERSION` matches expected version
2. Run `python scripts/generate_schemas.py --all` to regenerate local schemas
3. Consider using `--spec-version` to override the expected version

### Missing Dependencies

**Symptoms**: Import errors when running prepare_build.py

**Solutions**:

```bash
# Ensure CLI package is installed (for spec_version module)
cd cli
pip install -e .
```

## Related Documentation

- [RELEASING.md](RELEASING.md) - **Release workflow and process**
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines
- [cli/README.md](cli/README.md) - CLI documentation
- [spec/README.md](spec/README.md) - Specification documentation
- [.github/workflows/release.yml](.github/workflows/release.yml) - Release workflow
