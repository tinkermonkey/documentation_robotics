# Release Process

This document describes the release process for both the specification and the CLI tool.

## Overview

The project has two releasable components:

1. **Specification** - The metadata model specification (`spec/`)
2. **CLI Tool** - The `dr` command-line tool (`cli/`)

Each component can be released independently with its own version number.

## Versioning Strategy

### Specification Versioning

**Format:** `MAJOR.MINOR.PATCH` (Semantic Versioning 2.0.0)

**Version Bumps:**

- **MAJOR** - Breaking changes to layer definitions, entity schemas, or reference types
- **MINOR** - New layers, entities, or backward-compatible additions
- **PATCH** - Clarifications, typo fixes, non-normative changes

**Examples:**

- `2.0.0` - Breaking change (e.g., rename entity type, remove required attribute)
- `1.1.0` - New feature (e.g., add new entity type, new optional attribute)
- `1.0.1` - Clarification (e.g., fix typo, clarify documentation)

### CLI Versioning

**Format:** `MAJOR.MINOR.PATCH`

**Version Bumps:**

- **MAJOR** - Breaking changes to CLI interface or behavior
- **MINOR** - New features, new commands, implement new spec features
- **PATCH** - Bug fixes, performance improvements

**Note:** CLI version is independent of spec version, but the CLI declares which spec version it implements.

## Specification Release Process

### Prerequisites

- [ ] All proposed changes merged to `main`
- [ ] CHANGELOG.md updated with all changes
- [ ] VERSION file updated
- [ ] All CI checks passing
- [ ] Conformance tests updated if needed
- [ ] Documentation reviewed

### Steps

1. **Update Version Files**

   ```bash
   # Update spec/VERSION
   echo "1.1.0" > spec/VERSION

   # Update spec/CHANGELOG.md
   # Add release date to [Unreleased] section
   # Create new [1.1.0] section
   ```

2. **Create Pull Request**

   ```bash
   git checkout -b release-spec-v1.1.0
   git add spec/VERSION spec/CHANGELOG.md
   git commit -m "chore(spec): prepare release v1.1.0"
   git push origin release-spec-v1.1.0
   ```

3. **Review and Merge**
   - Create PR
   - Wait for reviews
   - Ensure all checks pass
   - Merge to `main`

4. **Create Release Tag**

   ```bash
   git checkout main
   git pull
   git tag -a spec-v1.1.0 -m "Specification Release v1.1.0"
   git push origin spec-v1.1.0
   ```

5. **GitHub Actions**
   - Workflow automatically triggered by `spec-v*` tag
   - Verifies VERSION file matches tag
   - Packages schemas into tarball and zip files:
     - `schemas-{version}.tar.gz`
     - `schemas-{version}.zip`
   - Extracts release notes from CHANGELOG.md for this version
   - Creates GitHub release with packaged schemas attached
   - Release assets include:
     - Schema packages (tar.gz and zip)
     - VERSION file
     - CHANGELOG.md
     - README.md

6. **Announce**
   - Post in GitHub Discussions
   - Update website (if applicable)
   - Notify implementers

## CLI Release Process

### Prerequisites

- [ ] All features/fixes merged to `main`
- [ ] Tests passing
- [ ] Conformance tests passing
- [ ] Documentation updated
- [ ] pyproject.toml version updated
- [ ] Spec version compatibility verified

### Steps

1. **Update Version Files**

   ```bash
   # Update cli/pyproject.toml
   # version = "0.4.0"

   # Update cli/src/documentation_robotics/__init__.py
   # __version__ = "0.4.0"

   # Update cli/README.md if needed
   ```

2. **Run Pre-release Checks**

   ```bash
   cd cli

   # Run all tests
   pytest

   # Run conformance tests
   pytest tests/conformance/

   # Check conformance statement
   dr conformance

   # Build package
   python -m build

   # Test installation
   pip install dist/documentation_robotics-0.4.0-py3-none-any.whl
   dr --version
   ```

3. **Create Pull Request**

   ```bash
   git checkout -b release-cli-v0.4.0
   git add cli/
   git commit -m "chore(cli): prepare release v0.4.0"
   git push origin release-cli-v0.4.0
   ```

4. **Review and Merge**
   - Create PR
   - Wait for reviews
   - Ensure all checks pass
   - Merge to `main`

5. **Create Release Tag**

   ```bash
   git checkout main
   git pull
   git tag -a cli-v0.4.0 -m "CLI Release v0.4.0"
   git push origin cli-v0.4.0
   ```

6. **GitHub Actions**
   - Workflow builds package
   - Publishes to PyPI
   - Creates GitHub release

7. **Verify Release**

   ```bash
   # Verify PyPI upload
   pip install --upgrade documentation-robotics

   # Test installation
   dr --version
   dr conformance
   ```

8. **Announce**
   - Post in GitHub Discussions
   - Update documentation site
   - Social media (if applicable)

## Hotfix Process

For critical bugs requiring immediate fix:

### Specification Hotfix

1. Create branch from main: `hotfix-spec-v1.0.1`
2. Make minimal fix
3. Update VERSION and CHANGELOG
4. Fast-track review
5. Merge and tag immediately

### CLI Hotfix

1. Create branch from main: `hotfix-cli-v0.3.1`
2. Make minimal fix
3. Update version
4. Fast-track review
5. Merge and tag immediately
6. Publish to PyPI

## Release Checklist

### Specification Release

- [ ] VERSION file updated
- [ ] CHANGELOG.md updated
- [ ] All documentation reviewed
- [ ] Schema changes validated
- [ ] Test fixtures updated
- [ ] Examples updated if needed
- [ ] Cross-references checked
- [ ] CI passing
- [ ] Tag created: `spec-v{VERSION}`
- [ ] GitHub release published
- [ ] Announcement made

### CLI Release

- [ ] pyproject.toml version updated
- [ ] **version** in **init**.py updated
- [ ] README.md updated
- [ ] All tests passing
- [ ] Conformance tests passing
- [ ] Package builds successfully
- [ ] Installation tested
- [ ] CI passing
- [ ] Tag created: `cli-v{VERSION}`
- [ ] PyPI published
- [ ] GitHub release published
- [ ] Installation verified
- [ ] Announcement made

## Version Compatibility

### CLI implements Specification

The CLI declares which specification version it implements via `spec_version.py`:

```python
SPEC_VERSION = "1.0.0"
```

**Compatibility Rules:**

- CLI SPEC_VERSION major must match model spec version major
- CLI SPEC_VERSION minor must be >= model spec version minor
- Patch versions are always compatible within same major.minor

**Example:**

- CLI implements spec v1.2.0
- Can work with models using spec v1.0.0, v1.1.0, v1.2.0
- Cannot work with models using spec v2.0.0 (major mismatch)
- May not support features from models using spec v1.3.0

## Release Calendar

**Specification:**

- **Patch releases:** As needed (1-2 months)
- **Minor releases:** Quarterly (3-4 months)
- **Major releases:** Annually or as needed

**CLI:**

- **Patch releases:** As needed (2-4 weeks)
- **Minor releases:** Monthly to quarterly
- **Major releases:** With specification major releases or as needed

## Communication

### Release Announcements

**Channels:**

- GitHub Releases (primary)
- GitHub Discussions
- Project website/blog
- Twitter/social media (if applicable)

**Template:**

```markdown
# Specification v1.1.0 Released

We're pleased to announce the release of Federated Architecture Metadata Model Specification v1.1.0.

## What's New

- [Feature 1]
- [Feature 2]
- [Improvement 1]

## Breaking Changes

None / [List if any]

## Migration Guide

[Link to migration guide if applicable]

## Resources

- [Release Notes](...)
- [Specification](...)
- [Examples](...)

## Implementations

The `dr` CLI tool v0.4.0 implements this specification.
```

## Questions

For questions about the release process:

- See [GOVERNANCE.md](spec/GOVERNANCE.md)
- Open a GitHub Discussion
- Contact maintainers

---

**Last Updated:** 2025-11-23
