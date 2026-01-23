# Python CLI Deprecation Notice

**Status:** 🟡 **Deprecated** (as of January 2026)
**Final Release:** v0.8.0 (planned)
**Removal:** After 1-month transition period following v0.8.0 release

---

## Summary

The Python CLI for Documentation Robotics is **deprecated** and will be removed in a future release. All users should migrate to the **TypeScript CLI**, which is the official, actively maintained implementation.

---

## Timeline

| Date | Milestone | Description |
|------|-----------|-------------|
| **January 2026** | Deprecation Announcement | Python CLI marked as deprecated |
| **TBD** | Python CLI v0.8.0 Release | Final release with deprecation warnings |
| **v0.8.0 + 1 month** | Transition Period | Community support, migration assistance |
| **v0.8.0 + 2 months** | Python CLI Removal | Code moved to archive branch, no longer maintained |

---

## Why Are We Deprecating the Python CLI?

### 1. **Outdated Architecture**

The Python CLI uses a **deprecated link registry system** (`link-registry.json`) that was replaced by the modern **relationship catalog** (`relationship-catalog.json`) in spec v0.7.0.

- **Python CLI:** Uses link-registry.json (removed in spec v0.8.0)
- **TypeScript CLI:** Uses relationship-catalog.json v2.1.0+ (active system)

Maintaining two parallel implementations with different architectural foundations is not sustainable.

### 2. **Performance**

The TypeScript CLI (built on Bun runtime) offers significantly better performance:

- **Faster startup time** (10-100x faster)
- **Lower memory usage**
- **Better concurrency** for large models

### 3. **Development Velocity**

The TypeScript CLI is receiving **active development** with new features:

- ✅ Enhanced cascade deletion with dry-run mode
- ✅ Advanced staging workflow with drift detection
- ✅ Virtual projection for changeset preview
- ✅ Modern relationship catalog system
- ✅ OpenTelemetry instrumentation
- ✅ Better error messages and UX

Maintaining feature parity across two implementations slows down development.

### 4. **Ecosystem Alignment**

The TypeScript/JavaScript ecosystem provides better tooling:

- **Better IDE support** (TypeScript, LSP)
- **Modern build tools** (esbuild, Bun)
- **Rich package ecosystem** (npm)
- **Cross-platform compatibility**

---

## What This Means for You

### If You're Currently Using Python CLI

1. **✅ Your models are safe** - TypeScript CLI is 100% compatible with Python CLI models
2. **📖 Read the migration guide** - See [`MIGRATION_FROM_PYTHON_CLI.md`](./MIGRATION_FROM_PYTHON_CLI.md)
3. **🧪 Test in parallel** - Run both CLIs side-by-side during transition
4. **📅 Plan migration** - Budget 1-4 weeks depending on your setup
5. **💬 Get support** - GitHub Issues and Discussions are available

### If You're Starting a New Project

**Use the TypeScript CLI.** Don't start with the deprecated Python CLI.

```bash
# Install TypeScript CLI
npm install -g @documentation-robotics/cli

# Initialize new model
dr init --name "My Project"
```

---

## Migration Path

### Quick Migration (Simple Use Cases)

**Time:** 1-2 hours

If you're using basic commands (`init`, `add`, `update`, `list`, `validate`):

1. Install TypeScript CLI
2. Verify model works with `dr validate`
3. Update scripts to replace `remove` → `delete`, `find` → `show`
4. Done!

### Standard Migration (Most Users)

**Time:** 1-4 weeks

If you're using CI/CD, relationships, or advanced features:

1. **Week 1:** Install TypeScript CLI, validate compatibility
2. **Week 2:** Update scripts and CI/CD pipelines
3. **Week 3:** Test in staging environment
4. **Week 4:** Production deployment

**See:** [`MIGRATION_FROM_PYTHON_CLI.md`](./MIGRATION_FROM_PYTHON_CLI.md) for detailed steps.

### Enterprise Migration (Complex Setups)

**Time:** 1-2 months

If you have:
- Custom integrations
- Large teams
- Complex CI/CD pipelines
- Extensive automation

**Contact us:** Open a GitHub Discussion for migration planning assistance.

---

## Feature Comparison

### ✅ Full Parity

These features work identically in both CLIs:

- Model initialization (`dr init`)
- Element CRUD (add, update, delete, show)
- List and search
- Validation (4-stage pipeline)
- Export formats (ArchiMate, OpenAPI, JSON Schema, PlantUML, Markdown)
- Trace dependencies
- Relationship management
- Basic changeset operations

### 🆕 TypeScript CLI Enhancements

These features are **better** in the TypeScript CLI:

- **Cascade deletion** - Improved dependency tracking
- **Dry-run mode** - Preview changes before applying
- **Modern catalog** - Uses relationship-catalog.json v2.1.0+
- **Advanced staging** - Drift detection, virtual projection, unstage
- **Changeset export/import** - Share changesets across teams
- **Telemetry** - Optional OpenTelemetry instrumentation
- **Performance** - 10-100x faster operations

### ❌ Python CLI Only (Not in TypeScript CLI)

These features are **only** in Python CLI and **not planned** for TypeScript CLI:

- **Annotation system** - Thread-based element annotations
  - **Workaround:** Use element `description` field or external tools (GitHub Issues, Notion)
- **Link staleness detection** - Check commit age of referenced elements
  - **Workaround:** Manual review or git tools
- **Link path tracing** - Find paths between elements through links
  - **Workaround:** Use `dr trace <id>` command (similar functionality)

**Impact:** Low - These are niche features with acceptable workarounds

---

## Support During Transition

### Resources

- **Migration Guide:** [`MIGRATION_FROM_PYTHON_CLI.md`](./MIGRATION_FROM_PYTHON_CLI.md)
- **TypeScript CLI README:** [`/cli/README.md`](../cli/README.md)
- **GitHub Issues:** Report migration problems
- **GitHub Discussions:** Ask questions, share experiences

### Community Support

We're committed to helping you migrate:

1. **Responsive to migration issues** - High priority
2. **Documentation updates** - Based on community feedback
3. **CI/CD examples** - GitHub Actions, GitLab CI, Jenkins
4. **Office hours** - TBD based on demand

### Enterprise Support

For organizations with complex migrations:

- **Migration planning** - Architecture review and timeline
- **Script migration** - Help updating automation
- **Training sessions** - Team onboarding
- **Priority support** - Dedicated assistance

**Contact:** Open a GitHub Discussion with "Enterprise Migration" tag

---

## FAQ

### Q: Will my Python CLI models work with TypeScript CLI?

**A:** ✅ **Yes, 100% compatible.** No conversion needed. Both CLIs use the same model format.

### Q: Can I run both CLIs in parallel during migration?

**A:** ✅ **Yes, recommended.** Test TypeScript CLI while keeping Python CLI as fallback.

### Q: What happens to the Python CLI code after removal?

**A:** It will be **archived** in a git branch (`archive/python-cli-v0.8.0`) for historical reference, but will no longer receive updates.

### Q: Will the Python CLI be published to PyPI after v0.8.0?

**A:** ❌ **No.** v0.8.0 will be the final PyPI release.

### Q: What if I find a critical bug in the TypeScript CLI?

**A:** 🐛 **Report it immediately** via GitHub Issues. We'll prioritize fixes for migration-blocking bugs.

### Q: Can I contribute Python CLI bug fixes during the transition?

**A:** ⚠️ **Limited.** We'll accept critical security fixes but not new features. All development effort is focused on TypeScript CLI.

### Q: What about the spec? Does it still support Python CLI features?

**A:** The **spec** continues to evolve. The TypeScript CLI implements the **latest spec**. The Python CLI is frozen at an older spec version.

### Q: I have thousands of annotations. How do I migrate them?

**A:** Use the annotation export tool:
```bash
bun run src/utils/export-python-annotations.ts --output annotations.md
```
Then manually review and add important annotations to element descriptions.

### Q: My CI/CD pipeline is heavily customized. Will migration break it?

**A:** Probably not, but review carefully:
1. Update docker images (python → bun)
2. Replace command names (`remove` → `delete`)
3. Update link commands (`dr links` → `dr catalog`)
4. Test in staging first

See [CI/CD Migration](./MIGRATION_FROM_PYTHON_CLI.md#cicd-migration) for examples.

---

## Call to Action

### For Current Python CLI Users

1. **Read the migration guide:** [`MIGRATION_FROM_PYTHON_CLI.md`](./MIGRATION_FROM_PYTHON_CLI.md)
2. **Install TypeScript CLI:** `npm install -g @documentation-robotics/cli`
3. **Test compatibility:** `dr validate` in your model directory
4. **Plan migration:** Budget 1-4 weeks
5. **Get help if needed:** GitHub Discussions

### For New Users

**Don't use the Python CLI.** Start with the TypeScript CLI immediately.

### For Contributors

Focus contributions on the **TypeScript CLI**. Python CLI is in maintenance mode only.

---

## Thank You

The Python CLI served the community well during the early days of Documentation Robotics. We appreciate everyone who contributed code, reported bugs, and provided feedback.

The TypeScript CLI represents the next evolution of the project, with better performance, modern architecture, and active development.

**We're excited to see what you build with it!** 🚀

---

**Questions?** Open a [GitHub Discussion](https://github.com/anthropics/documentation-robotics/discussions) or [Issue](https://github.com/anthropics/documentation-robotics/issues).
