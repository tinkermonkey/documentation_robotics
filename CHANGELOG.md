# Changelog

All notable changes to the Documentation Robotics project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Directory Restructure** (2025-12-28)
  - Renamed `cli-bun/` directory to `cli/` since it's now the only CLI implementation
  - Updated all documentation, workflows, and build configurations
  - **Note:** This is a repository structure change only - npm package name (`@documentation-robotics/cli`) remains unchanged
  - **Impact:** Contributors need to use `cd cli` instead of `cd cli-bun`
  - Git history preserved with `git mv cli-bun cli`

### Removed

- **Python CLI Implementation Removed** (2025-12-26)
  - Removed the entire Python CLI codebase from `/cli/` directory
  - The Bun CLI (`cli/`) is now the sole implementation
  - **Reason:** Completed migration to Bun CLI with 100% feature parity for all essential commands
  - **Migration Path:** See [Migration Guide](docs/migration-from-python-cli.md)
  - **Background:**
    - Phase 1: Feature parity validation completed with 243 compatibility tests
    - Phase 2: Python CLI v0.8.0 released to PyPI with deprecation warnings
    - Phase 3: All documentation migrated to reference only Bun CLI
    - Phase 4: Python CLI code safely removed from repository
  - **Impact:**
    - Users should install Bun CLI: `npm install -g @documentation-robotics/cli`
    - Python CLI will be removed from PyPI after 1-month deprecation period
    - All functionality preserved in Bun CLI (21/21 essential commands)
    - Model files created by either CLI remain fully compatible
  - **What's Next:**
    - Python CLI will remain available on PyPI until 2025-01-26
    - After 2025-01-26, Python CLI package will be removed from PyPI
    - Git history preserves the complete Python CLI implementation for reference

### Documentation

For component-specific changelogs, see:

- **Specification:** [spec/CHANGELOG.md](spec/CHANGELOG.md)
- **Bun CLI:** See [cli/README.md](cli/README.md) for version information
- **Python CLI:** Removed (see v0.8.0 final release on PyPI for historical changelog)
