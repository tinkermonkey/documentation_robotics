# PyPI Publication Guide for Python CLI v0.8.0 (Final Release)

## Overview

This document provides step-by-step instructions for publishing the final Python CLI release (v0.8.0) to PyPI with deprecation metadata.

**IMPORTANT:** This is the final release of the Python CLI. After 1 month (2026-01-26), the package will be removed from PyPI.

## Prerequisites

- PyPI account with appropriate permissions for `documentation-robotics` package
- Twine installed and configured
- Package built and tested locally (see Task 9.3 and 9.4)

## Publication Steps

### Step 1: Verify Package Build

Ensure the package has been built successfully:

```bash
cd /Users/austinsand/workspace/documentation_robotics/cli
ls -lh dist/

# Should show:
# documentation_robotics-0.8.0-py3-none-any.whl
# documentation_robotics-0.8.0.tar.gz
```

### Step 2: Test Package Locally (Already Completed)

The package has been tested locally and confirmed working:

- ✅ Package installs successfully
- ✅ Deprecation warning displays correctly on command execution
- ✅ All dependencies resolve properly
- ✅ CLI commands function as expected

### Step 3: Verify Package Metadata

Check that the package metadata includes deprecation information:

```bash
cd /Users/austinsand/workspace/documentation_robotics/cli

# Extract and inspect package metadata
tar -xzf dist/documentation_robotics-0.8.0.tar.gz
cat documentation_robotics-0.8.0/PKG-INFO | grep -A 5 "Classifier:"

# Should show:
# Classifier: Development Status :: 7 - Inactive
```

Cleanup:

```bash
rm -rf documentation_robotics-0.8.0
```

### Step 4: Upload to Test PyPI (Optional but Recommended)

Before publishing to production PyPI, test on Test PyPI:

```bash
cd /Users/austinsand/workspace/documentation_robotics/cli
source ../.venv/bin/activate

# Upload to Test PyPI
python -m twine upload --repository testpypi dist/documentation_robotics-0.8.0*

# Test installation from Test PyPI
pip install --index-url https://test.pypi.org/simple/ --no-deps documentation-robotics==0.8.0

# Verify deprecation warning
dr list business  # Should display deprecation warning before error

# Uninstall test package
pip uninstall documentation-robotics
```

### Step 5: Upload to Production PyPI

**WARNING:** This action cannot be easily undone. Ensure all previous steps are completed successfully.

```bash
cd /Users/austinsand/workspace/documentation_robotics/cli
source ../.venv/bin/activate

# Upload to PyPI
python -m twine upload dist/documentation_robotics-0.8.0*

# You will be prompted for:
# - PyPI username (or use __token__ for API token)
# - PyPI password (or API token value)
```

Expected output:

```
Uploading distributions to https://upload.pypi.org/legacy/
Uploading documentation_robotics-0.8.0-py3-none-any.whl
100% ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ XX.X/XX.X kB • --:-- • ?
Uploading documentation_robotics-0.8.0.tar.gz
100% ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ XX.X/XX.X kB • --:-- • ?

View at:
https://pypi.org/project/documentation-robotics/0.8.0/
```

### Step 6: Verify Publication on PyPI

1. Visit https://pypi.org/project/documentation-robotics/
2. Verify version 0.8.0 is listed
3. Check that package description shows deprecation notice
4. Verify classifiers include "Development Status :: 7 - Inactive"
5. Check that project URLs include "Migration Guide" and "Bun CLI" links

### Step 7: Test Installation from PyPI

```bash
# Create fresh test environment
python3 -m venv /tmp/test-pypi-install
source /tmp/test-pypi-install/bin/activate

# Install from PyPI
pip install documentation-robotics==0.8.0

# Verify installation
dr --version  # Should show: dr, version 0.8.0

# Test deprecation warning
dr list business 2>&1 | head -30  # Should display deprecation warning

# Cleanup
deactivate
rm -rf /tmp/test-pypi-install
```

## Post-Publication Checklist

After successful publication to PyPI:

- [ ] Verify package appears on PyPI: https://pypi.org/project/documentation-robotics/0.8.0/
- [ ] Verify deprecation metadata is visible on PyPI page
- [ ] Test installation from PyPI in clean environment
- [ ] Verify deprecation warning displays on command execution
- [ ] Update internal documentation with PyPI publication date
- [ ] Proceed to Task 9.6: Create GitHub release

## Troubleshooting

### Issue: Twine authentication fails

**Solution:** Use API token instead of username/password:

1. Generate API token at https://pypi.org/manage/account/token/
2. Use `__token__` as username
3. Use the token value (starting with `pypi-`) as password

Or configure `.pypirc`:

```ini
[pypi]
username = __token__
password = pypi-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### Issue: Package already exists

**Solution:** If v0.8.0 was already uploaded, you cannot re-upload the same version. You must:

1. Bump version to 0.8.1
2. Update pyproject.toml
3. Rebuild package
4. Upload new version

### Issue: Upload fails with "Invalid distribution file"

**Solution:** Ensure you're uploading from the correct directory:

```bash
cd /Users/austinsand/workspace/documentation_robotics/cli
ls dist/  # Should show v0.8.0 files
python -m twine upload dist/documentation_robotics-0.8.0*  # Note the wildcard
```

## Package Removal Timeline

According to the deprecation timeline:

- **2025-12-26:** v0.8.0 released to PyPI (deprecation announced)
- **2025-12-26 to 2026-01-26:** 1-month grace period for users to migrate
- **2026-01-26:** Package removed from PyPI (yank all versions or delist package)

### How to Remove Package from PyPI (After Grace Period)

When the grace period ends, remove the package:

**Option 1: Yank the release (recommended)**

1. Log in to PyPI
2. Navigate to https://pypi.org/manage/project/documentation-robotics/releases/
3. Click "Options" next to version 0.8.0
4. Select "Yank release"
5. Provide reason: "Python CLI deprecated. Please use Bun CLI: npm install -g @documentation-robotics/cli"

**Option 2: Delete the entire project (if all versions should be removed)**

1. Log in to PyPI
2. Navigate to https://pypi.org/manage/project/documentation-robotics/settings/
3. Scroll to "Delete project"
4. Follow deletion instructions

**Note:** Yanked packages can still be installed by specifying exact version, but will not appear in search results or `pip install documentation-robotics` without version specifier.

## Files Generated

This publication process uses the following files:

- `/Users/austinsand/workspace/documentation_robotics/cli/dist/documentation_robotics-0.8.0-py3-none-any.whl` - Wheel distribution
- `/Users/austinsand/workspace/documentation_robotics/cli/dist/documentation_robotics-0.8.0.tar.gz` - Source distribution
- `/Users/austinsand/workspace/documentation_robotics/cli/pyproject.toml` - Package metadata with deprecation
- `/Users/austinsand/workspace/documentation_robotics/cli/README.md` - Package README with deprecation notice

## References

- Twine documentation: https://twine.readthedocs.io/
- PyPI packaging guide: https://packaging.python.org/
- Deprecation timeline: `/Users/austinsand/workspace/documentation_robotics/agent-os/specs/2025-12-26-python-cli-deprecation/deprecation-timeline.md`
- Migration guide: `/Users/austinsand/workspace/documentation_robotics/docs/migration-from-python-cli.md` (to be created in Task Group 11)

---

**Document Version:** 1.0
**Last Updated:** 2025-12-26
**Status:** READY FOR EXECUTION (awaiting user approval)
