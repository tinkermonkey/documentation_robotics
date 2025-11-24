# Claude Code Integration

This directory contains assets for integrating Documentation Robotics with Claude Code.

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
