# Claude Code Integration

This directory contains assets for integrating Documentation Robotics with Claude Code.

## ⚠️ Version 0.4.1+ Format Update

**As of v0.4.1**, all agents and commands use YAML frontmatter for Claude Code discovery. If you installed these files before v0.4.1:

```bash
# Update to latest format
dr claude update --force
```

**What changed:**

- Agents now require YAML frontmatter with `name`, `description`, and `tools` fields
- Commands now include YAML frontmatter with `description` and `argument-hint` fields
- Old inline metadata format has been removed

See templates for examples of the new format.

## 🚀 Quick Start

After running `dr claude install`, you have access to:

### Specialized Agents (Launch with Task tool)

- `dr-architect` - Comprehensive DR architect handling all workflows (validation, extraction, documentation, etc.)
- `dr-release-preflight` - **DEV** Pre-release validation for version bumps (schemas, tests, changelogs, CI/CD)

### Slash Commands (Type in chat)

- `/dr-model <request>` - Add/update/query model elements
- `/dr-changeset <request>` - Manage isolated model changes
- `/dr-links <request>` - Work with cross-layer references
- `/dr-validate` - Validate model quality
- `/dr-project <source>→<target>` - Project elements across layers
- `/dr-ingest <path>` - Extract model from code
- `/dr-init [name]` - Initialize new model

### Auto-Activating Skills ✨

Skills automatically suggest when relevant:

**For Users:**
- **Link validation** - When working across multiple layers
- **Changeset review** - Before applying changeset changes

**For Developers:**
- **Spec-CLI consistency** - When modifying specs, schemas, or CLI implementation

### Reference Sheets

Press `Ctrl+K` and type `@dr` to see available reference sheets:

- DR Specification Summary
- CLI Command Reference
- Layer Definitions
- Cross-Layer Projections

## Structure

- **reference_sheets/** - Documentation for agents (three tiers)
  - `tier1-essentials.md` - 300-500 tokens, always loaded
  - `tier2-developer-guide.md` - 800-1200 tokens, on-demand
  - `tier3-complete-reference.md` - 2000-3000 tokens, query only

- **commands/** - Slash commands for common workflows
  - `dr-init.md` - Initialize model
  - `dr-model.md` - Interactive modeling
  - `dr-ingest.md` - Extract from codebase
  - `dr-project.md` - Automated projection
  - `dr-validate.md` - Validation & auto-fix

- **agents/** - Specialized sub-agent definitions
  - `dr-extractor.md` - Model extraction agent
  - `dr-validator.md` - Validation agent
  - `dr-documenter.md` - Documentation generator

- **templates/** - Customization templates
  - Templates for creating custom commands and agents

## Installation

Users install these files to their project using:

```bash
dr claude install
```

This copies files to the project's `.claude/` directory:

- Reference sheets → `.claude/knowledge/`
- Commands → `.claude/commands/`
- Agents → `.claude/agents/`

## Development

When adding new files:

1. Create the file in the appropriate subdirectory
2. Test with Claude Code to validate usefulness
3. Update version tracking in the installation command
4. Document in user guide

## Testing

Test integration files by:

1. Installing to a test project: `dr claude install`
2. Using Claude Code to interact with the project
3. Verifying commands work as expected
4. Checking token usage of reference sheets

## See Also

- [Design Document](/cli/docs/04_claude_code_integration_design.md)
- [User Guide](/cli/docs/user-guide/)
