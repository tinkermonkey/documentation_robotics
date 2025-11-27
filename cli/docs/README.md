# Documentation Robotics CLI - Documentation

Complete documentation for the Documentation Robotics CLI tool.

## 📚 Documentation Structure

### User Guides

- **[Getting Started](user-guide/getting-started.md)** - Quick start guide (5 minutes)
- **[Validation Guide](user-guide/validation.md)** - Comprehensive validation documentation
- **[Link Management Guide](user-guide/link-management.md)** - Cross-layer link registry and validation
- **[Claude Code Integration](user-guide/claude-code-integration.md)** - AI-powered modeling
- Command Reference (Coming soon)
- Troubleshooting Guide (Coming soon)

### Examples

- Minimal Example (Coming soon)
- E-commerce Example (Coming soon)
- Microservices Example (Coming soon)

### API Reference

- Validators API (Coming soon)
- Core API (Coming soon)
- Exporters API (Coming soon)

### Spec Reference

- See [Spec Documentation](../../spec/README.md)

---

## Quick Links

### For New Users

1. [Install and setup](user-guide/getting-started.md#quick-start-5-minutes)
2. [Create your first model](user-guide/getting-started.md#add-your-first-elements)
3. [Validate your model](user-guide/validation.md)
4. [Export specifications](user-guide/getting-started.md#export-formats)

### For Developers

1. [Architecture overview](../README.md)
2. [Contributing guide](../CONTRIBUTING.md) (Coming soon)
3. [API reference](api-reference/) (Coming soon)
4. [Testing guide](../tests/README.md) (Coming soon)

---

## What's New in v0.4.1

### Claude Code Compliance & Enhanced Integration

- ✅ **YAML Frontmatter Migration** - All agents and commands now use Claude Code's required format
- ✅ **3 New Agents** - Link validator, schema migrator, security reviewer
- ✅ **4 New Skills** - Reusable workflows for common tasks
- ✅ **Release Automation** - New `/dr-release-prep` command
- ✅ **Comprehensive User Guide** - 500+ lines of integration documentation
- ✅ **Example Templates** - Settings and validation hook examples

See [CHANGELOG.md](../CHANGELOG.md) for complete details.

## What's New in v0.4.0

### Link Management System

- ✅ **Link Registry** - Machine-readable catalog of 60+ cross-layer reference patterns
- ✅ **Link Discovery** - Automatic detection and graph building
- ✅ **Link Validation** - Existence, type, cardinality, format checking
- ✅ **Link Documentation** - Generate Markdown, HTML, Mermaid diagrams
- ✅ **Link Navigation** - Query, filter, and trace paths between elements
- ✅ **CLI Commands** - Full `dr links` command suite
- ✅ **Comprehensive Testing** - 100+ tests with 95%+ coverage

### Managed Upgrades

- ✅ **Version Migration** - Automated migration between spec versions
- ✅ **Pattern Analysis** - Detect non-standard reference patterns
- ✅ **Dry Run Mode** - Preview changes before applying
- ✅ **Naming Fixes** - Correct camelCase → kebab-case automatically
- ✅ **Cardinality Fixes** - Fix single/array mismatches
- ✅ **CLI Commands** - `dr migrate [--check|--dry-run|--apply]`

See [CHANGELOG](../CHANGELOG.md) for full details.

---

## Documentation Status

| Guide                   | Status      | Completeness |
| ----------------------- | ----------- | ------------ |
| Getting Started         | ✅ Complete | 100%         |
| Validation Guide        | ✅ Complete | 100%         |
| Link Management         | ✅ Complete | 100%         |
| Claude Code Integration | ✅ Complete | 100%         |
| Command Reference       | ⏳ Planned  | 0%           |
| Troubleshooting         | ⏳ Planned  | 0%           |
| Examples                | ⏳ Planned  | 0%           |
| API Reference           | ⏳ Planned  | 0%           |

---

## Contributing to Documentation

We welcome documentation contributions! To contribute:

1. Fork the repository
2. Create a documentation branch
3. Write your documentation in Markdown
4. Submit a pull request

See [Contributing Guide](../CONTRIBUTING.md) for details.

---

## Feedback

Found an issue in the documentation? Have a suggestion?

- [Report documentation issues](https://github.com/tinkermonkey/documentation_robotics/issues/new?labels=documentation)
- [Suggest improvements](https://github.com/tinkermonkey/documentation_robotics/discussions)

---

## License

Documentation is licensed under [MIT License](../LICENSE).
