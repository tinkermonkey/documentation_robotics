# Claude Code Integration Improvements for Developers

**Audience:** CLI developers working on this codebase
**Last Updated:** 2025-01-27
**Version:** 0.4.1+

This document outlines recommended improvements to the Claude Code integration based on official Claude Code documentation and best practices.

---

## Priority 1: Implement Skills System (HIGH PRIORITY)

**Status:** ❌ Not implemented
**Impact:** High - Skills provide contextual auto-suggestions that activate when relevant

### What Are Skills?

Skills are model-invoked capabilities that Claude Code automatically suggests when relevant. Unlike commands (user-invoked) or agents (explicit subprocess), skills activate contextually during conversation.

**Key Differences:**

- **Commands:** User types `/dr-model` explicitly
- **Agents:** User or model launches subprocess with `Task` tool
- **Skills:** Model suggests automatically when context matches

### Implementation Plan

#### 1. Create Skills Directory Structure

```
integrations/claude_code/skills/
├── SCHEMA_VALIDATION/
│   └── SKILL.md
├── LINK_VALIDATION/
│   └── SKILL.md
├── MIGRATION_ASSISTANT/
│   └── SKILL.md
└── CHANGESET_REVIEWER/
    └── SKILL.md
```

#### 2. Skill File Format

Each `SKILL.md` file should contain a prompt that executes when the skill activates:

**Example: `SCHEMA_VALIDATION/SKILL.md`**

```markdown
# Schema Validation Skill

When the user's DR model has validation errors or they mention "validation", "errors", or "schema issues":

1. Run `dr validate` to check the current model
2. If errors found, categorize them by severity and layer
3. Suggest specific fixes with confidence scores
4. Offer to apply fixes automatically or guide manual fixes

## When to Activate

- User mentions validation, errors, or schema issues
- Model files have been recently modified
- User asks about model quality or correctness

## Tools Available

- Bash (for `dr validate`)
- Read (to examine model files)
- Edit (to apply fixes)

## Example Interaction

User: "I just added some elements, are there any issues?"
Assistant: [Skill activates] Let me validate your model...
```

**Example: `LINK_VALIDATION/SKILL.md`**

```markdown
# Cross-Layer Link Validation Skill

When the user works with elements across multiple layers or mentions relationships/links:

1. Run `dr links validate` to check cross-layer references
2. Identify broken links, missing targets, or circular dependencies
3. Suggest link additions based on naming patterns
4. Verify bidirectional consistency

## When to Activate

- User adds/modifies elements with references
- User mentions "links", "references", "relationships", or "traceability"
- User works across multiple layers simultaneously

## Tools Available

- Bash (for `dr links *` commands)
- Read (to examine element references)
- Grep (to find related elements)
```

**Example: `MIGRATION_ASSISTANT/SKILL.md`**

```markdown
# Migration Assistant Skill

When the user has an older spec version or mentions upgrading:

1. Check current spec version with `dr list --version`
2. If version < 0.2.0, explain what changed
3. Run `dr migrate --dry-run` to preview changes
4. Guide through migration process
5. Validate after migration

## When to Activate

- Model spec version < current (0.2.0)
- User mentions "upgrade", "migrate", or "update spec"
- Validation errors indicate old format

## Tools Available

- Bash (for `dr migrate` and `dr validate`)
- Read (to check model metadata)
```

**Example: `CHANGESET_REVIEWER/SKILL.md`**

```markdown
# Changeset Reviewer Skill

When the user works with changesets or asks for review:

1. List current changeset with `dr changeset list`
2. Show changes with `dr changeset diff`
3. Review additions/removals for:
   - Naming consistency
   - Reference validity
   - Layer-appropriate properties
4. Suggest improvements before applying

## When to Activate

- User mentions "changeset", "review changes", or "diff"
- User about to apply changeset
- User asks "what changed" or "what did I add"

## Tools Available

- Bash (for `dr changeset *` commands)
- Read (to examine changeset files)
- Grep (to check naming patterns)
```

#### 3. Update Distribution Code

**File:** `cli/src/documentation_robotics/commands/claude.py`

Add skills directory to installation:

```python
def install(project_path: Path) -> None:
    """Install Claude Code integration files."""
    claude_dir = project_path / ".claude"

    # Existing code for agents, commands, reference_sheets...

    # Add skills directory
    skills_dir = claude_dir / "skills"
    skills_dir.mkdir(parents=True, exist_ok=True)

    source_skills = get_integration_path() / "skills"
    if source_skills.exists():
        for skill_dir in source_skills.iterdir():
            if skill_dir.is_dir():
                target_skill = skills_dir / skill_dir.name
                target_skill.mkdir(exist_ok=True)

                skill_file = skill_dir / "SKILL.md"
                if skill_file.exists():
                    shutil.copy2(
                        skill_file,
                        target_skill / "SKILL.md"
                    )
                    console.print(f"  ✓ Installed skill: {skill_dir.name}")
```

#### 4. Update Package Data

**File:** `cli/pyproject.toml`

```toml
[tool.setuptools.package-data]
documentation_robotics = [
    "schemas/bundled/*.json",
    "claude_integration/reference_sheets/*.md",
    "claude_integration/commands/*.md",
    "claude_integration/agents/*.md",
    "claude_integration/templates/*.md",
    "claude_integration/skills/*/SKILL.md",  # ADD THIS LINE
]
```

#### 5. Update Tests

Add validation for skills in test suite:

```python
def test_skills_have_valid_structure():
    """Verify all skills have required SKILL.md file."""
    skills_dir = get_integration_path() / "skills"

    for skill_dir in skills_dir.iterdir():
        if skill_dir.is_dir():
            skill_file = skill_dir / "SKILL.md"
            assert skill_file.exists(), f"Missing SKILL.md in {skill_dir.name}"

            content = skill_file.read_text()
            assert len(content) > 100, f"SKILL.md too short in {skill_dir.name}"
            assert "## When to Activate" in content or "activate" in content.lower()
```

### Success Metrics

- ✅ Skills auto-suggest during relevant conversations
- ✅ Users report improved discovery of DR capabilities
- ✅ Reduced need to explicitly invoke commands

---

## Priority 2: Enhanced Templates and Examples

**Status:** ⚠️ Basic templates exist, need examples
**Impact:** Medium - Helps users customize integration

### Current State

We have basic templates:

- `custom-agent-template.md`
- `custom-command-template.md`

### Improvements Needed

#### 1. Add Example Files

**File:** `cli/src/documentation_robotics/claude_integration/templates/example-hook.sh`

```bash
#!/bin/bash
# Example pre-commit hook for DR model validation
#
# To use this hook:
# 1. Copy to your project: cp .claude/templates/example-hook.sh .claude/hooks/pre-commit.sh
# 2. Make executable: chmod +x .claude/hooks/pre-commit.sh
# 3. Test: trigger by running 'dr validate' or modifying model files

# Check if any model files changed
if git diff --cached --name-only | grep -q "\.dr/"; then
    echo "🤖 DR Hook: Validating model changes..."

    # Run validation
    if ! dr validate --strict; then
        echo "❌ Model validation failed. Fix errors before committing."
        exit 1
    fi

    echo "✅ Model validation passed"
fi

exit 0
```

**File:** `cli/src/documentation_robotics/claude_integration/templates/example-settings.json`

```json
{
  "comments": [
    "Example Claude Code settings for DR projects",
    "Copy relevant sections to your .claude/settings.json"
  ],
  "allow": [
    "Bash(dr *)",
    "Bash(source .venv/bin/activate)",
    "Read(*.dr/*)",
    "Write(*.dr/*)",
    "Edit(*.dr/*)"
  ],
  "deny": ["Bash(dr claude remove)", "Bash(rm -rf .dr)"],
  "hooks": {
    "SessionStart": [
      {
        "hook": {
          "type": "command",
          "command": "source /path/to/your/project/.venv/bin/activate"
        }
      }
    ],
    "user-prompt-submit": {
      "command": ".claude/hooks/pre-commit.sh",
      "description": "Validate model before processing requests"
    },
    "PreToolUse": [
      {
        "matcher": "Write(.*\\.json$)",
        "hook": {
          "type": "command",
          "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/validate-json.sh"
        }
      }
    ]
  }
}
```

**File:** `cli/src/documentation_robotics/claude_integration/templates/example-memory.md`

```markdown
# Project Memory Template

## DR Model Context

**Spec Version:** 0.2.0
**Model Initialized:** [date]
**Primary Layers Used:** [list layers]

## Architectural Decisions

### Decision 1: [Title]

**Date:** [date]
**Context:** [why this decision was needed]
**Decision:** [what was decided]
**Consequences:** [implications]

## Common Patterns

### Element Naming

- [Pattern 1]: [example]
- [Pattern 2]: [example]

### Cross-Layer Links

- [Layer A → Layer B]: [relationship type]

## Team Conventions

[Document project-specific conventions here]
```

**File:** `cli/src/documentation_robotics/claude_integration/templates/example-validation-hook.sh`

```bash
#!/bin/bash
# Example pre-tool-use validation hook
#
# This hook validates JSON files before they're written to prevent
# syntax errors from breaking the DR model.
#
# To use this hook:
# 1. Copy to .claude/hooks/: cp .claude/templates/example-validation-hook.sh .claude/hooks/validate-json.sh
# 2. Make executable: chmod +x .claude/hooks/validate-json.sh
# 3. Add to settings.json (see example-settings.json)

# Read stdin (tool input as JSON)
input=$(cat)

# Extract file path and content from tool input
file_path=$(echo "$input" | jq -r '.tool_input.path // .tool_input.file_path // ""')
content=$(echo "$input" | jq -r '.tool_input.content // ""')

# Check if this is a JSON file operation
if [[ "$file_path" == *.json ]]; then
    # Validate JSON syntax
    if ! echo "$content" | jq empty 2>/dev/null; then
        # Block the operation
        echo '{"blocked": true, "reason": "Invalid JSON syntax. Please fix syntax errors before writing."}'
        exit 2
    fi

    # Check if it's a DR model file
    if [[ "$file_path" == *.dr/* ]]; then
        # Additional DR-specific validation could go here
        # e.g., check required fields, validate element IDs, etc.
        :
    fi
fi

# Approve the operation
echo '{"approved": true}'
exit 0
```

#### 2. Update Template README

**File:** `cli/src/documentation_robotics/claude_integration/templates/README.md`

````markdown
# Claude Code Templates

This directory contains templates and examples for customizing your DR + Claude Code integration.

## Available Templates

### Custom Agents

- `custom-agent-template.md` - Template for creating new DR-specific agents

### Custom Commands

- `custom-command-template.md` - Template for creating new slash commands

### Examples

- `example-hook.sh` - Pre-commit validation hook
- `example-settings.json` - Recommended settings for DR projects
- `example-memory.md` - Project memory structure

## Usage

### Creating a Custom Agent

1. Copy the template:
   ```bash
   cp .claude/templates/custom-agent-template.md .claude/agents/my-agent.md
   ```
````

2. Edit the YAML frontmatter and content

3. Restart Claude Code to load the new agent

### Using Example Hooks

1. Copy to hooks directory:

   ```bash
   cp .claude/templates/example-hook.sh .claude/hooks/pre-commit.sh
   chmod +x .claude/hooks/pre-commit.sh
   ```

2. Test the hook:

   ```bash
   .claude/hooks/pre-commit.sh
   ```

### Customizing Settings

1. Merge example into your settings:

   ```bash
   # Review example
   cat .claude/templates/example-settings.json

   # Manually merge into .claude/settings.json
   ```

## Best Practices

- Start with templates rather than from scratch
- Test custom agents/commands before committing
- Document customizations in project memory
- Share useful patterns with team

````

#### 3. Update Distribution Code

```python
def install(project_path: Path) -> None:
    """Install Claude Code integration files."""
    # ... existing code ...

    # Install templates
    templates_dir = claude_dir / "templates"
    templates_dir.mkdir(parents=True, exist_ok=True)

    source_templates = get_integration_path() / "templates"
    for template_file in source_templates.glob("*.md"):
        shutil.copy2(template_file, templates_dir / template_file.name)
        console.print(f"  ✓ Installed template: {template_file.name}")

    # Install example files
    for example_file in source_templates.glob("example-*"):
        shutil.copy2(example_file, templates_dir / example_file.name)
        console.print(f"  ✓ Installed example: {example_file.name}")
````

#### 4. Enhanced Permission Model

Beyond basic permissions, consider implementing granular security controls:

**Comprehensive Permission Example:**

```json
{
  "permissions": {
    "deny": [
      "Write(/.*)", // Protect filesystem root
      "Read(./.env*)", // Protect secrets and credentials
      "Read(*.key)", // Protect private keys
      "Read(**/credentials.json)", // Protect credential files
      "Bash(rm -rf:*)", // Prevent destructive recursion
      "Bash(sudo:*)", // Prevent privilege escalation
      "Bash(curl * | bash:*)", // Prevent arbitrary code execution
      "Bash(dr claude remove)", // Prevent accidental uninstall
      "Write(*.dr/metadata.json)" // Protect DR metadata
    ],
    "ask": [
      "Write(**/*.json)", // Confirm schema changes
      "Edit(**/*.json)", // Confirm schema modifications
      "Bash(git add:*)", // Confirm before staging
      "Bash(git commit:*)", // Confirm before committing
      "Bash(dr changeset apply:*)", // Confirm before applying changes
      "Bash(dr migrate:*)", // Confirm migrations
      "Bash(npm install:*)", // Confirm package installations
      "Bash(pip install:*)" // Confirm Python package installations
    ],
    "allow": [
      "Bash(dr validate:*)", // Always allow validation
      "Bash(dr list:*)", // Always allow read operations
      "Bash(dr search:*)", // Always allow search
      "Read(*.dr/*)", // Always allow DR model reads
      "Read(**/*.md)", // Always allow doc reads
      "Bash(source .venv/bin/activate)", // Always allow venv activation
      "Grep(*)", // Always allow search
      "Glob(*)" // Always allow file pattern matching
    ]
  }
}
```

**Permission Strategy:**

1. **Deny First:** Block dangerous operations completely
   - Filesystem root access
   - Secret file access
   - Destructive commands
   - Privilege escalation

2. **Ask for Critical:** Require approval for changes
   - Schema modifications
   - Git operations
   - Package installations
   - Model migrations

3. **Allow Read-Only:** Automatic for safe operations
   - Validation and queries
   - Reading model files
   - Search operations
   - Environment activation

**Security Benefits:**

- Prevents accidental data loss
- Protects sensitive information
- Requires explicit approval for changes
- Maintains audit trail of approvals

---

## Priority 2.5: Create Specialized Agents

**Status:** ❌ Not implemented
**Impact:** Medium - Provides deeper expertise for specific tasks

### Overview

Complement the existing 5 general-purpose agents (dr-helper, dr-ideator, dr-validator, dr-extractor, dr-documenter) with domain-specific agents that provide deeper expertise in specialized areas.

**Rationale:**

- Reduces cognitive load on general agents
- Provides focused, expert-level guidance
- Enables more sophisticated workflows
- Separates concerns for better maintainability

### Recommended Specialized Agents

#### 1. dr-schema-migrator - Migration Specialist

Expert in migrating DR models from older spec versions to v0.2.0.

**File:** `cli/src/documentation_robotics/claude_integration/agents/dr-schema-migrator.md`

```markdown
---
name: dr-schema-migrator
description: Expert in migrating DR models from v0.1.x to v0.2.0. Deep knowledge of spec changes, breaking changes, and migration patterns. Specializes in safe, validated migrations.
tools: Bash, Read, Edit, Write
---

# DR Schema Migrator Agent

## Overview

Specialized agent for migrating Documentation Robotics models from older spec versions (v0.1.x) to the current spec (v0.2.0).

## Expertise

- **Spec Evolution:** Deep understanding of changes between versions
- **Breaking Changes:** Identifies and resolves compatibility issues
- **Migration Patterns:** Established patterns for safe upgrades
- **Validation:** Ensures post-migration model integrity

## Capabilities

### 1. Version Detection

- Detect current spec version: `dr list --version`
- Identify elements using old formats
- Check for deprecated properties

### 2. Migration Planning

- Run dry-run: `dr migrate --dry-run`
- Explain what will change and why
- Identify potential issues before migration

### 3. Safe Migration

- Execute migration: `dr migrate`
- Validate results: `dr validate --strict`
- Fix migration artifacts
- Verify cross-layer links intact

### 4. Post-Migration Verification

- Test all layer schemas
- Check reference integrity
- Validate naming conventions
- Ensure backward compatibility where needed

## When to Use

- Model spec version < 0.2.0
- Validation errors indicate old format
- User explicitly requests migration help
- Before major model updates

## Workflow Example

1. Check version and analyze model
2. Run dry-run and explain changes
3. Get user approval
4. Execute migration
5. Validate thoroughly
6. Report results and next steps
```

#### 2. dr-link-validator - Link Validation Specialist

Expert in cross-layer link validation and management.

**File:** `cli/src/documentation_robotics/claude_integration/agents/dr-link-validator.md`

```markdown
---
name: dr-link-validator
description: Expert in cross-layer link validation and management. Specializes in finding broken links, suggesting missing links, validating bidirectional consistency, and maintaining link registry integrity.
tools: Bash, Read, Grep, Write
---

# DR Link Validator Agent

## Overview

Specialized agent for validating, analyzing, and maintaining cross-layer references in DR models.

## Expertise

- **Link Registry:** Deep understanding of link management
- **Cross-Layer Traceability:** Validates relationships across all 11 layers
- **Reference Integrity:** Ensures targets exist and are valid
- **Bidirectional Consistency:** Verifies forward and backward links match

## Capabilities

### 1. Comprehensive Link Validation

- Check all registered links: `dr links validate`
- Find broken references (missing targets)
- Identify orphaned elements (no incoming links)
- Detect circular dependencies

### 2. Link Discovery

- Suggest missing links based on naming patterns
- Find implicit relationships in descriptions
- Recommend links based on layer adjacency
- Identify gaps in traceability chain

### 3. Link Analysis

- Visualize link patterns: `dr links show <query>`
- Analyze coverage by layer
- Find weak traceability paths
- Generate link reports

### 4. Link Maintenance

- Add missing links to registry
- Remove invalid links
- Update link metadata
- Ensure registry consistency

## When to Use

- Before major releases (validate all links)
- After bulk element additions
- When traceability is questioned
- During architecture reviews

## Workflow Example

1. Run full link validation
2. Categorize issues by severity
3. Suggest fixes with confidence scores
4. Apply approved fixes
5. Re-validate and report
```

#### 3. dr-security-reviewer - Security Analysis Specialist

Security-focused architecture model reviewer.

**File:** `cli/src/documentation_robotics/claude_integration/agents/dr-security-reviewer.md`

```markdown
---
name: dr-security-reviewer
description: Security-focused architecture model reviewer. Analyzes DR models for security considerations, compliance requirements, data protection patterns, and security best practices across all layers.
tools: Read, Grep, Bash, WebSearch
---

# DR Security Reviewer Agent

## Overview

Specialized agent for security-focused review of DR architecture models.

## Expertise

- **Security Architecture:** Security patterns across all layers
- **Data Protection:** Privacy and data security modeling
- **Compliance:** GDPR, HIPAA, SOC2 considerations
- **Threat Modeling:** Security implications of architectural decisions

## Capabilities

### 1. Security Pattern Analysis

- Identify authentication/authorization elements
- Check encryption/security controls
- Validate data protection measures
- Review access control models

### 2. Compliance Review

- Check for compliance-required elements
- Validate data handling documentation
- Review privacy considerations
- Identify compliance gaps

### 3. Threat Surface Analysis

- Identify exposed APIs and interfaces
- Review data flow security
- Check for security boundaries
- Analyze trust boundaries

### 4. Security Recommendations

- Suggest missing security elements
- Recommend security controls
- Provide security pattern guidance
- Link to security best practices

## When to Use

- Before security audits
- During compliance reviews
- When adding sensitive data handling
- For security-critical systems

## Workflow Example

1. Analyze model for security elements
2. Check compliance requirements
3. Identify security gaps
4. Suggest security enhancements
5. Provide implementation guidance
```

### Implementation Steps

1. **Create agent files** in `cli/src/documentation_robotics/claude_integration/agents/`:
   - `dr-schema-migrator.md`
   - `dr-link-validator.md`
   - `dr-security-reviewer.md`

2. **Update distribution** - Agents automatically included by existing `claude.py` install logic

3. **Add to tests** - Update test suite to validate new agent files:

   ```python
   def test_specialized_agents_exist():
       """Verify specialized agents are present."""
       agents_dir = get_integration_path() / "agents"
       assert (agents_dir / "dr-schema-migrator.md").exists()
       assert (agents_dir / "dr-link-validator.md").exists()
       assert (agents_dir / "dr-security-reviewer.md").exists()
   ```

4. **Update USER_GUIDE.md** - Add specialized agents to "What You Get" section

### Success Metrics

- ✅ Specialized agents provide focused expertise
- ✅ Users can access migration help without general agent overhead
- ✅ Link validation becomes more thorough and actionable
- ✅ Security reviews are more comprehensive

---

## Priority 3: Improve README for Discovery

**Status:** ✅ README exists but could be enhanced
**Impact:** Low - Improves initial user experience

### Enhancements

**File:** `cli/src/documentation_robotics/claude_integration/README.md`

Add section after version update notice:

```markdown
## 🚀 Quick Start

After running `dr claude install`, you have access to:

### Specialized Agents (Launch with Task tool)

- `dr-helper` - Ask questions about DR concepts and CLI usage
- `dr-ideator` - Brainstorm architecture ideas using changesets
- `dr-validator` - Validate model and get fix suggestions
- `dr-extractor` - Extract models from existing codebases
- `dr-documenter` - Generate documentation in multiple formats

### Slash Commands (Type in chat)

- `/dr-model <request>` - Add/update/query model elements
- `/dr-changeset <request>` - Manage isolated model changes
- `/dr-links <request>` - Work with cross-layer references
- `/dr-validate` - Validate model quality
- `/dr-project <source>→<target>` - Project elements across layers
- `/dr-ingest <path>` - Extract model from code
- `/dr-init [name]` - Initialize new model

### Auto-Activating Skills

Skills automatically suggest when relevant:

- Schema validation when editing models
- Link validation when working across layers
- Migration assistance for old spec versions
- Changeset review before applying changes

### Reference Sheets

Press `Ctrl+K` and type `@dr` to see available reference sheets:

- DR Specification Summary
- CLI Command Reference
- Layer Definitions
- Cross-Layer Projections

## 💡 Example Workflows

### Starting a New Project
```

User: /dr-init my-api-project
User: Help me model a REST API for user management

```

### Exploring Ideas
```

User: I want to experiment with adding caching
Claude: [Launches dr-ideator agent]
Agent: Creates changeset, researches caching patterns, proposes elements

```

### Extracting from Code
```

User: /dr-ingest src/ --tech python
Claude: [Analyzes code and creates model elements across layers]

```

### Validating Quality
```

User: Is my model complete?
Claude: [Schema validation skill activates]
Claude: Running validation... [shows results and suggests fixes]

```

```

---

## Priority Matrix

This matrix helps prioritize improvements based on implementation effort and user impact:

| Improvement           | Effort | Impact | Priority | Status                   |
| --------------------- | ------ | ------ | -------- | ------------------------ |
| Skills system         | Low    | High   | ⭐⭐⭐   | ❌ Not implemented       |
| .claude/README.md     | Low    | High   | ⭐⭐⭐   | ⚠️ Partial               |
| Specialized agents    | Medium | Medium | ⭐⭐     | ❌ Not implemented       |
| Enhanced templates    | Low    | Medium | ⭐⭐     | ⚠️ Basic templates exist |
| Validation hooks      | Medium | Medium | ⭐⭐     | ❌ Not implemented       |
| Permission refinement | Low    | Low    | ⭐       | ⚠️ Basic permissions     |
| SessionStart hook     | Low    | Low    | ⭐       | ❌ Not implemented       |
| MCP server            | High   | Low\*  | ⭐       | ❌ Not planned           |
| Plugin distribution   | High   | Low\*  | ⭐       | ❌ Future consideration  |

**Note:** Low impact items marked with \* are low impact because the current CLI-based approach already works well. They're alternatives for specific use cases, not replacements.

**Recommended Implementation Order:**

1. **Phase 1 (v0.5.0):** Skills system - Highest impact, enables proactive suggestions
2. **Phase 2 (v0.5.1):** Specialized agents + Enhanced templates - Medium effort, good value
3. **Phase 3 (v0.5.1):** Documentation improvements - Low effort, improves discoverability
4. **Phase 4 (v0.6.0):** Polish and refinement based on user feedback

---

## Implementation Checklist

### Phase 1: Skills System (v0.5.0)

- [ ] Create `skills/` directory structure
- [ ] Implement 4 core skills (schema, links, migration, changeset)
- [ ] Update `claude.py` to copy skills during install
- [ ] Add skills to `pyproject.toml` package data
- [ ] Test skill activation in Claude Code
- [ ] Update CHANGELOG

### Phase 2: Enhanced Templates + Specialized Agents (v0.5.1)

- [ ] Create example validation hook (example-validation-hook.sh)
- [ ] Create example session hook configuration
- [ ] Update example-settings.json with hooks and enhanced permissions
- [ ] Implement 3 specialized agents (dr-schema-migrator, dr-link-validator, dr-security-reviewer)
- [ ] Add templates README
- [ ] Update distribution code to copy new examples
- [ ] Add specialized agents to USER_GUIDE.md
- [ ] Test agent activation and template workflow
- [ ] Update CHANGELOG

### Phase 3: Documentation (v0.5.1)

- [ ] Enhance main README with quick start
- [ ] Add example workflows
- [ ] Document skill activation patterns
- [ ] Update design doc with skills architecture

### Phase 4: Polish (v0.6.0)

- [ ] User testing and feedback
- [ ] Refine skill activation prompts
- [ ] Add more examples based on feedback
- [ ] Consider MCP server alternative (optional)

---

## Testing Guidelines

### Testing Skills

```bash
# 1. Install locally
cd cli
pip install -e .

# 2. Install in test project
cd /tmp/test-project
dr claude install

# 3. Verify skills installed
ls .claude/skills/
# Should show: SCHEMA_VALIDATION/ LINK_VALIDATION/ etc.

# 4. Test activation in Claude Code
# - Make intentional validation error
# - Check if schema validation skill suggests
```

### Testing Templates

```bash
# 1. Check templates copied
ls .claude/templates/
# Should show: custom-agent-template.md, example-hook.sh, etc.

# 2. Test hook
cp .claude/templates/example-hook.sh .claude/hooks/test.sh
chmod +x .claude/hooks/test.sh
.claude/hooks/test.sh

# 3. Verify settings example is valid JSON
cat .claude/templates/example-settings.json | jq .
```

---

## Future Considerations

### MCP Server Alternative

Instead of CLI tool, could provide MCP server for direct integration:

**Pros:**

- No shell command overhead
- Direct Python API access
- Better error handling
- Streaming responses

**Cons:**

- More complex setup
- Requires MCP client
- Different distribution model

**Recommendation:** Keep CLI-based approach for now. MCP server could be v2.0 feature for advanced users.

### Multi-Project Support

Consider supporting DR projects outside current directory:

```json
{
  "dr-projects": {
    "main-api": "/path/to/api",
    "mobile-app": "/path/to/mobile"
  }
}
```

**Recommendation:** Low priority. Most users work on one project at a time.

### Plugin Distribution

Package the entire Claude Code integration as an installable plugin for easier distribution:

**Structure:**

```
dr-plugin/
├── plugin.json
├── agents/
│   ├── dr-helper.md
│   ├── dr-ideator.md
│   ├── dr-validator.md
│   ├── dr-extractor.md
│   ├── dr-documenter.md
│   ├── dr-schema-migrator.md
│   ├── dr-link-validator.md
│   └── dr-security-reviewer.md
├── commands/
│   ├── dr-model.md
│   ├── dr-changeset.md
│   └── ... (all commands)
├── skills/
│   ├── SCHEMA_VALIDATION/
│   ├── LINK_VALIDATION/
│   └── ... (all skills)
└── templates/
    └── ... (all templates)
```

**Installation:**

```bash
claude plugin install dr-plugin
```

**Benefits:**

- Easier distribution and version management
- Automatic updates via plugin system
- Centralized plugin registry
- Simpler installation for users
- Better discoverability

**Trade-offs:**

- More complex packaging and distribution
- Requires Claude Code plugin system
- Different installation model than current CLI
- May not be available on all platforms

**Recommendation:** Consider for v2.0 if user base grows significantly. Current CLI-based approach (`dr claude install`) works well for now and aligns with DR's command-line nature. Plugin distribution would be beneficial when:

- Managing multiple installations becomes cumbersome
- Users request simpler installation
- Claude Code plugin ecosystem matures
- Team wants centralized version control

---

## Questions for Team Discussion

1. **Skill naming:** Should skills use SCREAMING_CASE (current) or kebab-case?
2. **Auto-update:** Should `dr claude install` auto-update existing installations?
3. **Version pinning:** Should users be able to pin integration version separately from CLI?
4. **Custom skill registry:** Should we support user-contributed skills?

---

## Related Documents

- [Claude Code Integration Design](04_claude_code_integration_design.md)
- [Agent and Command Format Specification](04_claude_code_integration_design.md#agent-and-command-format-specification)
- [CHANGELOG](../CHANGELOG.md)
