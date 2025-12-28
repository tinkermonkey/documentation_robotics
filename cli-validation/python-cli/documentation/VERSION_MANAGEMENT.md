# Version Management

## Single Source of Truth: `versions.py`

All version information for the Documentation Robotics CLI is managed in a **single file**:

```
cli/src/documentation_robotics/versions.py
```

This file contains:

- `CLI_VERSION` - The CLI package version (e.g., "0.7.2")
- `SPEC_VERSION` - The spec version this CLI implements (e.g., "0.5.0")
- `VIEWER_VERSION` - The bundled visualization server version (e.g., "0.1.0")
- `CONFORMANCE_LEVEL` - How completely the CLI implements the spec ("full")
- `GITHUB_CONFIG` - Repository configuration for fetching schemas

## How It Works

### Centralized Version Management

```python
# versions.py - SINGLE SOURCE OF TRUTH
CLI_VERSION = "0.7.2"
SPEC_VERSION = "0.5.0"
VIEWER_VERSION = "0.1.0"
```

### Re-exported for Compatibility

All other modules import from `versions.py`:

```python
# __init__.py
from .versions import CLI_VERSION as __version__
from .versions import SPEC_VERSION as __spec_version__

# spec_version.py (deprecated, re-exports for backward compatibility)
from .versions import SPEC_VERSION, CONFORMANCE_LEVEL, GITHUB_CONFIG

# viewer/__init__.py
from ..versions import VIEWER_VERSION as __version__
```

### Used Throughout the Codebase

- **CLI entry point** (`cli.py`): `@click.version_option(version=__version__)`
- **Build scripts** (`prepare_build.py`): Imports `SPEC_VERSION` to fetch schemas
- **Manifest creation** (`manifest.py`): Records `cli_version` and `spec_version`
- **Upgrade manager** (`upgrade_manager.py`): Tracks version changes

## Release Workflow

### Updating Versions for a Release

**ONLY edit `versions.py`** - all other version references are automatic:

```bash
# 1. Open the versions file
vim cli/src/documentation_robotics/versions.py

# 2. Update the appropriate version(s)
CLI_VERSION = "0.7.3"      # Always increment for CLI releases
SPEC_VERSION = "0.5.0"     # Only change when adopting new spec
VIEWER_VERSION = "0.1.0"   # Only change when viewer updates

# 3. Save and commit
git add cli/src/documentation_robotics/versions.py
git commit -m "Bump CLI version to 0.7.3"
```

### Version Coordination

```
Spec Release (spec-v0.5.0)
    ↓
    └─> Creates schemas-0.5.0.tar.gz on GitHub
            ↓
            └─> CLI Release (cli-v0.7.2)
                    ↓
                    ├─> Update SPEC_VERSION = "0.5.0" in versions.py
                    ├─> Update CLI_VERSION = "0.7.2" in versions.py
                    ├─> Run prepare_build.py (fetches schemas-0.5.0.tar.gz)
                    └─> Build and publish to PyPI
```

## Version Semantics

### CLI_VERSION

Follows [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes to CLI interface
- **MINOR**: New features, backward compatible
- **PATCH**: Bug fixes, backward compatible

Example: `0.7.2` → CLI v0.7.2

### SPEC_VERSION

Tracks which spec release this CLI implements:

- Must match an existing spec release tag: `spec-v{version}`
- Can lag behind latest spec (multiple CLI releases per spec version)
- Updated when CLI adopts new spec version

Example: `0.5.0` → Implements spec v0.5.0

### VIEWER_VERSION

Version of bundled visualization server:

- Independent versioning from CLI and spec
- Incremented when viewer functionality changes
- Currently at `0.1.0`

## Migration from Old System

### Before (Multiple Sources)

```
cli/src/documentation_robotics/__init__.py:
    __version__ = "0.7.1"
    __spec_version__ = "0.4.0"

cli/src/documentation_robotics/spec_version.py:
    SPEC_VERSION = "0.5.0"  # DUPLICATE!

cli/src/documentation_robotics/viewer/__init__.py:
    __version__ = "0.1.0"
```

**Problems**:

- ❌ Version mismatches (0.4.0 vs 0.5.0)
- ❌ Duplicate definitions
- ❌ Easy to forget updates
- ❌ Unclear which is authoritative

### After (Single Source)

```
cli/src/documentation_robotics/versions.py:
    CLI_VERSION = "0.7.2"
    SPEC_VERSION = "0.5.0"
    VIEWER_VERSION = "0.1.0"
```

**Benefits**:

- ✅ Single source of truth
- ✅ No duplicates
- ✅ Clear ownership
- ✅ Atomic updates

## Backward Compatibility

The old import paths still work via re-exports:

```python
# These all still work:
from documentation_robotics import __version__
from documentation_robotics import __spec_version__
from documentation_robotics.spec_version import SPEC_VERSION
from documentation_robotics.viewer import __version__
```

## Verification

Check that all versions are consistent:

```bash
# View versions
cat cli/src/documentation_robotics/versions.py

# Test the package reports correct version
cd cli && pip install -e .
dr --version  # Should show CLI_VERSION

# Verify in Python
python -c "from documentation_robotics.versions import *; \
print(f'CLI: {CLI_VERSION}, Spec: {SPEC_VERSION}, Viewer: {VIEWER_VERSION}')"
```

## Troubleshooting

### `dr --version` shows old version

- You're running an installed package from PyPI, not from source
- Run `pip install -e .` in the cli directory to use local version
- Or reinstall: `pip install --upgrade --force-reinstall documentation-robotics`

### Version mismatch in manifest

- Check that `versions.py` has been updated
- Run `dr upgrade` in your project to sync to new CLI version
- Verify with: `grep -E 'cli_version|spec_version' documentation-robotics/model/manifest.yaml`

### Build fails to fetch schemas

- Ensure `SPEC_VERSION` matches an existing GitHub release: `spec-v{version}`
- Check release exists: `https://github.com/tinkermonkey/documentation_robotics/releases/tag/spec-v0.5.0`
- Verify release has schemas asset: `schemas-{version}.tar.gz`

## Best Practices

1. **Always update versions.py first** before building or releasing
2. **Spec must release before CLI** - CLI depends on spec release artifacts
3. **Test locally** with `pip install -e .` before releasing
4. **Update CHANGELOG.md** to document version changes
5. **Tag releases consistently**: `cli-v{CLI_VERSION}`, `spec-v{SPEC_VERSION}`

## Related Files

- `cli/src/documentation_robotics/versions.py` - **Single source of truth**
- `RELEASING.md` - Complete release workflow
- `cli/CHANGELOG.md` - Version history
- `spec/CHANGELOG.md` - Spec version history
- `scripts/prepare_build.py` - Uses versions to fetch schemas
