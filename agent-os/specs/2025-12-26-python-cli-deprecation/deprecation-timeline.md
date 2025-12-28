# Python CLI Deprecation Timeline

## Overview

This document outlines the official deprecation timeline for the Python CLI implementation of Documentation Robotics. The deprecation is driven by the need to consolidate to a single, more maintainable TypeScript/Bun implementation that provides identical functionality with significantly better performance.

## Timeline

### Phase 1: Deprecation Announcement - December 26, 2025

**Status:** COMPLETED

**Actions Taken:**

- Python CLI version 0.8.0 released to PyPI
- Deprecation warning added to CLI entry point (prints to stderr on every command)
- CHANGELOG.md updated with deprecation notice
- Version bumped from 0.7.3 to 0.8.0 in:
  - `cli/pyproject.toml`
  - `cli/src/documentation_robotics/versions.py`
- Deprecation timeline documented in this file

**What Users See:**

- Large, prominent deprecation warning on every CLI command execution
- Warning printed to stderr (does not interfere with command stdout)
- Warning includes:
  - Deprecation date (2025-01-26)
  - Bun CLI installation instructions
  - Benefits of migrating (100% parity, 8x faster, active development)
  - Link to migration guide
  - Complete timeline

### Phase 2: Grace Period - December 26, 2025 to January 26, 2026 (1 month)

**Duration:** 1 month

**User Actions Expected:**

- Users install and test Bun CLI: `npm install -g @documentation-robotics/cli`
- Users verify their workflows with Bun CLI
- Users update CI/CD pipelines to use Bun CLI
- Users report any migration issues (if discovered)

**Support During Grace Period:**

- Python CLI remains fully functional
- Python CLI remains available on PyPI
- Critical bug fixes may be backported to Python CLI if necessary
- Bun CLI continues active development

**Communication:**

- Deprecation warning displays on every Python CLI command
- GitHub repository README updated to reference only Bun CLI
- Migration guide available in repository

### Phase 3: PyPI Package Removal - January 26, 2026

**Date:** January 26, 2026 (1 month after announcement)

**Actions:**

- Remove Python package from PyPI (yank all versions or delist package)
- Python CLI no longer installable via `pip install documentation-robotics`
- Users who already have Python CLI installed can continue using it until they uninstall

**Post-Removal:**

- Python CLI source code may remain in git history
- Python CLI directory removed from active repository
- All documentation updated to reference only Bun CLI
- GitHub issue templates updated for Bun CLI only

## Migration Support

### Migration Resources

1. **Migration Guide:** `/docs/migration-from-python-cli.md`
   - Command mapping (Python → Bun equivalents)
   - Installation instructions for Bun CLI
   - CI/CD migration examples (GitHub Actions, GitLab CI, CircleCI, Jenkins)
   - Troubleshooting common migration issues

2. **Readiness Report:** `/agent-os/specs/2025-12-26-python-cli-deprecation/readiness-report.md`
   - 100% feature parity confirmation
   - Test results summary (543 total tests, 100% pass rate)
   - Model file compatibility validation
   - Visualization API compatibility validation

3. **Command Parity Checklist:** `/agent-os/specs/2025-12-26-python-cli-deprecation/command-parity-checklist.md`
   - Complete mapping of all 24 Python commands to Bun equivalents
   - Status and notes for each command

### Support Channels

- **GitHub Issues:** Report migration problems as GitHub issues
- **Migration Guide:** Comprehensive step-by-step instructions
- **Compatibility Tests:** Automated tests confirm 100% parity

## Rationale for Deprecation

### Why Deprecate the Python CLI?

1. **Maintainability:** Maintaining two CLI implementations (Python and Bun) with 100% parity is costly and error-prone
2. **Performance:** Bun CLI is ~8x faster (200ms vs 1-2s startup time)
3. **Development Velocity:** Consolidating to single implementation allows faster feature development
4. **Modern Codebase:** TypeScript provides better type safety and tooling
5. **Active Development:** Bun CLI is the primary implementation receiving all new features

### Why Bun CLI is Ready

1. **100% Feature Parity:** All 21 essential commands fully implemented and tested
2. **543 Tests Passing:** Comprehensive test suite with 100% pass rate
3. **Model Compatibility:** Identical model file structure (no data migration needed)
4. **API Compatibility:** Visualization server API matches specification
5. **Production Ready:** Used in internal projects with stable performance

## Key Dates Summary

| Date                     | Milestone                                           | Status      |
| ------------------------ | --------------------------------------------------- | ----------- |
| 2025-12-26               | Python CLI v0.8.0 released with deprecation warning | COMPLETED   |
| 2025-12-26 to 2026-01-26 | Grace period (1 month) - users migrate              | IN PROGRESS |
| 2026-01-26               | Python CLI removed from PyPI                        | PENDING     |
| 2026-01-26+              | Bun CLI is sole implementation                      | PENDING     |

## Frequently Asked Questions

### Q: Can I continue using the Python CLI after January 26, 2026?

**A:** If you have it already installed, yes, but it will no longer receive updates or bug fixes. However, it will not be installable via `pip install` after that date. We strongly recommend migrating to the Bun CLI for continued support and improvements.

### Q: Will my existing models work with the Bun CLI?

**A:** Yes, 100%. The model file structure is identical between Python and Bun CLIs. No data migration is required. Simply install the Bun CLI and run the same commands.

### Q: What if I find a bug in the Bun CLI during migration?

**A:** Please report it as a GitHub issue immediately. During the grace period, we will prioritize fixing any migration blockers.

### Q: Do I need to change my CI/CD pipelines?

**A:** Yes, you'll need to update installation steps from `pip install` to `npm install -g`. See the migration guide for examples for GitHub Actions, GitLab CI, CircleCI, and Jenkins.

### Q: Why only 1 month grace period?

**A:** The project is in alpha stage, user base is small, and the Bun CLI has been production-ready with 100% parity for several months. A 1-month grace period is sufficient for the current user base to migrate. If critical issues arise, the timeline may be extended.

### Q: Can I still use the Python CLI programmatically?

**A:** After PyPI removal, the Python CLI code will remain in git history but will not be supported. For programmatic use, we recommend using the Bun CLI or directly working with the model files (which are just JSON).

## Communication Plan

### Channels

1. **CLI Warning:** Every Python CLI command prints deprecation warning to stderr
2. **PyPI Package Metadata:** Package description updated with deprecation notice
3. **GitHub Repository:** README updated to reference only Bun CLI
4. **CHANGELOG.md:** Version 0.8.0 entry documents deprecation
5. **Documentation:** All docs updated to reference only Bun CLI

### Message Consistency

All deprecation communications include:

- Clear deprecation date (2025-01-26)
- Bun CLI installation instructions
- Migration guide link
- Benefits of migrating
- Support resources

## Post-Deprecation Repository State

### What Gets Removed

- `cli/` directory (entire Python CLI implementation)
- Python-specific CI/CD workflows
- Python-specific GitHub issue templates
- Python entries in root `.gitignore`

### What Remains

- Git history (Python CLI code remains in history)
- `spec/` directory (unchanged)
- `cli/` directory (sole CLI implementation)
- Migration documentation (for historical reference)

## Rollback Plan

If critical issues are discovered during the grace period that block migration:

1. **Extend Grace Period:** Postpone PyPI removal date
2. **Fix Blocking Issues:** Prioritize fixes in Bun CLI
3. **Communicate Extension:** Update all deprecation messaging with new date
4. **Re-validate Parity:** Run full compatibility test suite again

**Rollback Criteria:**

- Blocker issues that affect >25% of use cases
- Data loss or corruption issues
- Inability to migrate critical workflows

**Current Status:** No blocking issues identified. Bun CLI has been validated as production-ready.

## Conclusion

The deprecation of the Python CLI is a strategic decision to improve maintainability, performance, and development velocity. With 100% feature parity validated, comprehensive migration resources, and a 1-month grace period, users have clear path forward to the Bun CLI.

**Next Steps for Users:**

1. Install Bun CLI: `npm install -g @documentation-robotics/cli`
2. Test with your models: `dr validate`, `dr list`, etc.
3. Update CI/CD pipelines (see migration guide)
4. Uninstall Python CLI after verification: `pip uninstall documentation-robotics`

For questions or issues, please open a GitHub issue or consult the migration guide.

---

**Document Version:** 1.0
**Last Updated:** 2025-12-26
**Author:** Documentation Robotics Team
**Status:** FINAL
