# Python CLI v0.8.0 - Final Release

**Release Date:** 2026-01-23
**Status:** 🔴 **DEPRECATED** - This is the final Python CLI release

---

## ⚠️ Important Notice

**The Python CLI is deprecated and will be removed in a future release.**

- **This is the final Python CLI release** (v0.8.0)
- **No further updates** will be published to PyPI
- **Migration required:** All users must migrate to the TypeScript CLI
- **Timeline:** 1-month transition period, then code will be archived

---

## Migration Information

### Migrate to TypeScript CLI

The **TypeScript CLI** is the official, actively maintained implementation with better performance and features.

**Install:**
```bash
npm install -g @documentation-robotics/cli
# or
bun install -g @documentation-robotics/cli
```

**Verify:**
```bash
dr version
```

### Migration Resources

- **Migration Guide:** [`docs/MIGRATION_FROM_PYTHON_CLI.md`](../../docs/MIGRATION_FROM_PYTHON_CLI.md)
- **Deprecation Notice:** [`docs/PYTHON_CLI_DEPRECATION.md`](../../docs/PYTHON_CLI_DEPRECATION.md)
- **TypeScript CLI Docs:** [`cli/README.md`](../../cli/README.md)

### Model Compatibility

✅ **Your models are 100% compatible.** No conversion needed.

The TypeScript CLI can read models created by the Python CLI without any changes. Both use the same format.

---

## Why Deprecate?

### 1. Outdated Architecture
- Python CLI uses **deprecated link-registry.json** (removed in spec v0.8.0)
- TypeScript CLI uses **modern relationship-catalog.json** v2.1.0+

### 2. Performance
- TypeScript CLI (Bun runtime) is **10-100x faster**
- Lower memory usage
- Better concurrency

### 3. Development Velocity
- TypeScript CLI receives **active development**
- New features: cascade deletion, modern catalog, advanced staging
- Maintaining two implementations slows development

### 4. Better Ecosystem
- Modern build tools (esbuild, Bun)
- Better IDE support (TypeScript)
- Rich npm ecosystem

---

## What's in v0.8.0?

### Deprecation Warning
- ⚠️ **Deprecation warning displayed** on every CLI invocation
- Clear migration guidance in warning message

### Maintenance Updates
- Bundled relationship catalog (34 relationship types)
- Enhanced relationship validation
- Layer schema updates with relationship metadata
- Bug fixes and stability improvements

### No New Features
- No new features in this release
- Focus on deprecation communication
- All development effort on TypeScript CLI

---

## Timeline

| Date | Milestone |
|------|-----------|
| **Jan 2026** | v0.8.0 released (this release) |
| **Jan-Feb 2026** | 1-month transition period |
| **Feb 2026** | Python CLI code archived |
| **After Feb 2026** | No Python CLI support |

---

## Getting Help

### Migration Support

- **Migration Guide:** Complete step-by-step migration instructions
- **GitHub Discussions:** Ask questions, get community help
- **GitHub Issues:** Report migration blockers

### CI/CD Migration

The migration guide includes examples for:
- GitHub Actions
- GitLab CI
- Jenkins
- Docker

### Enterprise Support

For organizations with complex setups:
- Migration planning assistance
- Script migration help
- Training sessions

**Contact:** Open a GitHub Discussion with "Enterprise Migration" tag

---

## Frequently Asked Questions

### Q: Will my Python CLI models work with TypeScript CLI?

**A:** ✅ Yes, 100% compatible. No conversion needed.

### Q: Can I run both CLIs during migration?

**A:** ✅ Yes, recommended. Test TypeScript CLI while keeping Python CLI as fallback.

### Q: What happens after the transition period?

**A:** The Python CLI code will be archived in a git branch for reference, but will receive no updates.

### Q: Will Python CLI be on PyPI after v0.8.0?

**A:** ❌ No. v0.8.0 is the final PyPI release.

### Q: What about annotations and link staleness?

**A:** These Python-only features have acceptable workarounds:
- **Annotations:** Use element `description` field or external tools (GitHub Issues)
- **Link staleness:** Manual review or git tools

### Q: My CI/CD is complex. Will migration break it?

**A:** Probably not. The migration guide has CI/CD examples. Key changes:
- Docker: `python:3.10` → `oven/bun:latest`
- Commands: `dr remove` → `dr delete`, `dr find` → `dr show`
- Links: `dr links` → `dr catalog`

---

## Installation (Not Recommended)

⚠️ **Do not install for new projects.** Use TypeScript CLI instead.

**For existing users only:**
```bash
pip install documentation-robotics==0.8.0
```

**Better option - Migrate now:**
```bash
npm install -g @documentation-robotics/cli
```

---

## Checksums

SHA256 checksums will be provided after PyPI upload.

---

## Thank You

The Python CLI served the community well during Documentation Robotics' early days. We appreciate everyone who:
- Contributed code
- Reported bugs
- Provided feedback
- Built with the tool

The **TypeScript CLI** represents the next evolution with:
- ✅ Better performance
- ✅ Modern architecture
- ✅ Active development
- ✅ Enhanced features

**We're excited to see what you build with it!** 🚀

---

## Links

- **Migration Guide:** [docs/MIGRATION_FROM_PYTHON_CLI.md](../../docs/MIGRATION_FROM_PYTHON_CLI.md)
- **Deprecation Notice:** [docs/PYTHON_CLI_DEPRECATION.md](../../docs/PYTHON_CLI_DEPRECATION.md)
- **TypeScript CLI:** [cli/README.md](../../cli/README.md)
- **GitHub Discussions:** https://github.com/anthropics/documentation-robotics/discussions
- **GitHub Issues:** https://github.com/anthropics/documentation-robotics/issues

---

**Questions?** Open a GitHub Discussion or Issue. We're here to help with migration! 💬
