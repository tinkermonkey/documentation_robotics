# Claude Code Integration User Guide

**For:** CLI users who have installed the DR Claude Code toolset
**Last Updated:** 2025-01-27
**CLI Version:** 0.5.0+

Welcome! This guide shows you how to get the most out of Documentation Robotics with Claude Code.

---

## 📦 What You Get

When you run `dr claude install`, you get a complete Claude Code integration:

### 🤖 The DR Architect Agent

A single, comprehensive agent that handles all DR-related tasks through intelligent workflow routing:

| Task                | Example                                             | What It Does                                          |
| ------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| **Validation**      | "Check my model", "Validate with fixes"             | Multi-level validation with confidence-scored fixes   |
| **Extraction**      | "Analyze my Python code", "Extract from codebase"   | Automatically creates DR model from source code       |
| **Documentation**   | "Generate PDF docs", "Create architecture diagrams" | Comprehensive documentation in multiple formats       |
| **Security Review** | "Check for security gaps", "GDPR compliance"        | Analyzes model for security and compliance issues     |
| **Migration**       | "Upgrade to v0.2.0", "Migrate spec version"         | Safe spec version upgrades with validation            |
| **Ideation**        | "Explore adding Redis", "Compare GraphQL vs REST"   | Collaborative exploration with research in changesets |
| **Education**       | "How do I model microservices?", "Explain links"    | Expert guidance and DR concept teaching               |
| **Modeling**        | "Add a REST API endpoint", "Link to business goal"  | Natural language element creation and updates         |

**💡 Tip:** The dr-architect agent intelligently detects your intent and routes to the appropriate workflow. You just describe what you need.

### ⌨️ Slash Commands

Quick shortcuts you type directly in chat:

| Command         | Purpose                                          | Example                                            |
| --------------- | ------------------------------------------------ | -------------------------------------------------- |
| `/dr-model`     | Add/update/query elements using natural language | `/dr-model add a REST API endpoint for user login` |
| `/dr-changeset` | Manage isolated model changes                    | `/dr-changeset create explore-graphql`             |
| `/dr-validate`  | Comprehensive validation (schema + links)        | `/dr-validate --strict --validate-links`           |
| `/dr-ingest`    | Extract model from codebase                      | `/dr-ingest src/ --layers api,implementation`      |
| `/dr-init`      | Initialize new DR model                          | `/dr-init my-new-project`                          |

**💡 Tip:** Commands are perfect for quick tasks you do repeatedly.

### ✨ Auto-Activating Skills

Skills automatically suggest themselves when relevant (no need to ask!):

- **Link Validation** - Catches broken references when working across layers
- **Changeset Reviewer** - Reviews changes before you apply them to main model

**💡 Tip:** Skills work alongside the dr-architect agent to catch issues proactively. Most validation happens automatically through the agent.

### 📚 Reference Sheets

Quick lookup guides accessible with `Ctrl+K` → `@dr`:

- DR Specification Summary (all 11 layers)
- CLI Command Reference
- Layer Definitions & Properties
- Cross-Layer Projection Rules

---

## 🚀 Common Workflows

### Starting a New Project

```
You: /dr-init customer-portal

Claude: Initialized new DR model in .dr/

You: I need to model a customer portal with user auth,
     profile management, and order history

Claude: I'll help you build this model. Let me start by adding
        motivation layer elements...
        [Creates elements across motivation, business, application layers]
```

### Exploring Architecture Ideas

```
You: I want to experiment with adding Redis caching without
     messing up my current model

dr-architect: Great idea! Let me help you explore this safely.
              Creating changeset "explore-redis-caching"...

              [Researches Redis patterns with WebSearch]
              [Proposes cache elements in changeset]
              [Validates and shows you the changes]

              Would you like to apply, refine, or try alternatives?
```

### Extracting Model from Existing Code

```
You: /dr-ingest backend/api --tech python

Claude: Analyzing Python codebase in backend/api...
        Found:
        - 12 API endpoints → API layer
        - 8 service classes → Application layer
        - 15 data models → Data layer

        Created 35 elements across 3 layers.

        Would you like me to validate the extracted model?
```

### Validating Your Model

```
You: Is my model complete and correct?

dr-architect: I'll run comprehensive validation.

              [Runs validation with link checking]

              Found 3 issues:

              1. ❌ business/customer-registration has invalid
                    status value "active" (should be "proposed"
                    or "approved")

                 Fix: Change status to "proposed"
                 Confidence: 95%, Risk: Low

              2. ⚠️  api/user-profile-endpoint references
                    data/user-profile but link not registered

                 Fix: Add link: api/user-profile-endpoint→data/user-profile
                 Confidence: 90%, Risk: Low

              I can automatically fix these high-confidence, low-risk issues.
              May I apply these 2 fixes?
```

### Working with Cross-Layer Links

```
You: /dr-links show what business goals drive the auth API

Claude: Querying cross-layer links...

        Business Goal → API Endpoint links:

        business/secure-user-access
        ├─→ api/login-endpoint
        ├─→ api/logout-endpoint
        └─→ api/refresh-token-endpoint

        business/gdpr-compliance
        └─→ api/delete-user-data-endpoint

        These 2 business goals drive 4 API endpoints.
```

### Managing Changes with Changesets

```
You: /dr-changeset create try-event-sourcing

Claude: Created changeset "try-event-sourcing"
        You can now make experimental changes safely.

You: Add event store and event handlers for user actions

Claude: [Works in changeset context]
        Added to changeset:
        - data/user-event-store (new)
        - implementation/user-event-handler (new)
        - api/user-events-endpoint (new)

You: Actually I want to see the diff before applying

Claude: Running diff...

        Additions (3):
        + data/user-event-store
        + implementation/user-event-handler
        + api/user-events-endpoint

        No removals or modifications.

        Apply these changes? (yes/no/discard)
```

---

## 🎯 Best Practices

### When to Use Which Tool

**Use the dr-architect agent when:**

- Any DR-related task (it handles everything!)
- Validation, extraction, documentation, security review
- Exploring ideas or learning DR concepts
- Complex multi-step workflows
- Just describe what you need - it routes intelligently

**Use Commands when:**

- Quick, one-off tasks
- Simple additions or queries
- You know exactly what you want
- Direct shortcuts to specific operations

**Use Skills:**

- You don't actively "use" skills
- They activate automatically when relevant
- Work naturally - skills provide guardrails

### Organizing Your Workflow

**1. Start with Exploration**

```
Describe your architectural idea to dr-architect.
It will research, propose options, and help you model in changesets.
```

**2. Build with Commands or Natural Language**

```
Use /dr-model for quick additions, or just describe what you need.
dr-architect understands natural language and creates elements accordingly.
```

**3. Validate Continuously**

```
dr-architect validates automatically after changes.
Skills catch issues proactively.
Run /dr-validate --strict before major milestones.
```

**4. Document When Ready**

```
Ask dr-architect to generate documentation when your model is stable.
Supports PDF, Markdown, HTML, diagrams, and matrices.
```

### Changesets Best Practices

✅ **Do:**

- Create changesets for experimental ideas
- Use descriptive names: `explore-microservices`, not `test`
- Review diff before applying
- Discard changesets for rejected ideas

❌ **Don't:**

- Work in changesets for routine additions (just edit directly)
- Apply changesets without reviewing
- Keep unused changesets around (clutters workspace)

### Validation Best Practices

✅ **Do:**

- Let schema validation skill run automatically as you work
- Run full validation before major milestones
- Apply high-confidence fixes automatically
- Manually review low-confidence fixes

❌ **Don't:**

- Ignore validation warnings
- Apply all fixes without understanding them
- Disable validation in production models

---

## 🛠️ Customization

### Creating Custom Agents

Want a specialized agent for your domain? Use the template:

```bash
# 1. Copy template
cp .claude/templates/custom-agent-template.md .claude/agents/my-domain-expert.md

# 2. Edit the file:
---
name: my-domain-expert
description: Expert in [your domain] architecture patterns
tools: Read, Bash, Grep, Glob
---

# My Domain Expert

Expert in [your domain] with deep knowledge of:
- [Domain concept 1]
- [Domain concept 2]

[Add your domain-specific instructions here]

# 3. Restart Claude Code (if needed)
```

### Creating Custom Commands

Add project-specific shortcuts:

```bash
# 1. Copy template
cp .claude/templates/custom-command-template.md .claude/commands/my-command.md

# 2. Edit the file:
---
description: [What this command does]
argument-hint: "[expected arguments]"
---

# My Custom Command

[Instructions for what Claude should do when this command runs]

# 3. Use it: /my-command
```

### Using Hooks for Validation

Automatically validate before commits:

```bash
# 1. Copy example hook
cp .claude/templates/example-hook.sh .claude/hooks/pre-commit.sh
chmod +x .claude/hooks/pre-commit.sh

# 2. Test it
.claude/hooks/pre-commit.sh

# 3. Configure in .claude/settings.json
{
  "hooks": {
    "user-prompt-submit": {
      "command": ".claude/hooks/pre-commit.sh",
      "description": "Validate model before processing"
    }
  }
}
```

### Customizing Permissions

Control what Claude can do automatically:

```bash
# Edit .claude/settings.json
{
  "allow": [
    "Bash(dr validate*)",
    "Bash(dr list*)",
    "Read(*.dr/*)"
  ],
  "ask": [
    "Bash(dr changeset apply*)",
    "Edit(*.dr/*)",
    "Write(*.dr/*)"
  ],
  "deny": [
    "Bash(dr claude remove)",
    "Bash(rm -rf .dr)"
  ]
}
```

**Permission levels:**

- `allow` - Run automatically without asking
- `ask` - Ask for confirmation each time
- `deny` - Never allow, even if user requests

---

## 🆘 Troubleshooting

### Agent Not Found

**Error:** `Agent type 'dr-helper' not found`

**Fix:**

```bash
# Update to latest format
dr claude update --force

# Verify agents installed
ls .claude/agents/
# Should show: dr-helper.md, dr-ideator.md, etc.
```

### Commands Not Appearing

**Issue:** Typing `/dr-model` doesn't show autocomplete

**Fix:**

```bash
# Check commands installed
ls .claude/commands/

# Verify YAML frontmatter exists
head -5 .claude/commands/dr-model.md
# Should show:
# ---
# description: ...
# ---
```

### Skills Not Activating

**Issue:** Expected skill to suggest but it didn't

**Reasons:**

- Skills need clear context triggers (mention validation, errors, links)
- May activate silently (check if Claude is doing validation without announcing)
- Skills are suggestions, not guarantees

**Tip:** You can explicitly ask: "Can you validate my model?" to trigger validation skill

### Validation Errors

**Error:** `Schema validation failed: Unknown property 'foo'`

**Fix:**

1. Check which spec version you're using: `dr list --version`
2. If version < 0.2.0, run migration: `dr migrate`
3. Review layer schema in reference sheets: `Ctrl+K` → `@dr-layer-definitions`

### Changeset Issues

**Error:** `No active changeset`

**Fix:**

```bash
# List changesets
dr changeset list

# Create or activate one
dr changeset create my-changes
# or
dr changeset activate existing-changeset
```

---

## 📖 Learning More

### In Claude Code

- **Reference Sheets:** Press `Ctrl+K`, type `@dr` to see all DR references
- **Agent Help:** Ask dr-helper agent questions: "What are cross-layer projections?"
- **Command Help:** Type `/dr-` to see all available commands with descriptions

### Command Line

```bash
# General help
dr --help

# Command-specific help
dr model --help
dr changeset --help
dr links --help

# List elements in a layer
dr list <layer>

# Check spec version
dr --version
```

### Documentation

- **Spec Documentation:** `.dr/README.md` after `dr init`
- **CLI Documentation:** `dr --help` and `dr <command> --help`
- **Examples:** `.claude/templates/` directory

---

## 🎓 Example Projects

### Microservices API Platform

```
Layers used: Motivation, Business, Application, API, Data, Implementation
Key features:
- 15 microservices modeled
- Cross-layer links from business→api→data
- Changesets for experimental services
- Generated architecture documentation for stakeholders
```

### Mobile App with Backend

```
Layers used: Strategy, Business, Application, Technology, Physical
Key features:
- Flutter mobile app + Node.js backend
- Extracted model from existing code using dr-ingest
- Validated naming consistency across layers
- Used projections to keep frontend/backend aligned
```

### Legacy System Modernization

```
Layers used: All 11 layers
Key features:
- Extracted current state from Java monolith
- Used changesets to explore microservices migration
- Link validation ensured no broken dependencies
- Generated before/after documentation
```

---

## 🤝 Getting Help

### Within Claude Code

1. **Ask dr-helper agent:** "Use dr-helper to explain [concept]"
2. **Check reference sheets:** `Ctrl+K` → `@dr-spec-summary`
3. **Try validation skill:** Mention "validate" or "errors" to trigger help

### Command Line

```bash
dr --help                    # General help
dr <command> --help          # Command-specific help
dr list <layer>              # List elements in a layer
dr validate --strict         # Check for issues
```

### Online Resources

- **Specification:** Documentation Robotics Spec v0.2.0+
- **CLI Repository:** [Your repo URL]
- **Issues/Questions:** [Your support channel]

---

## 📝 Quick Reference Card

| I want to...        | Use this...                                                  |
| ------------------- | ------------------------------------------------------------ |
| Add an element      | `/dr-model add <description>` or describe to dr-architect    |
| Ask a question      | Describe to dr-architect: "How do I model X?"                |
| Explore an idea     | Describe to dr-architect: "What if we add caching?"          |
| Validate my model   | "Check my model" or `/dr-validate --strict --validate-links` |
| Extract from code   | `/dr-ingest <path>` or "Analyze my codebase"                 |
| Try something risky | dr-architect will suggest changeset automatically            |
| See relationships   | "Show me links for..." or "Trace from X to Y"                |
| Generate docs       | "Generate PDF documentation" or "Create diagrams"            |
| Fix issues          | dr-architect suggests and applies fixes with confirmation    |
| Security review     | "Check for security gaps" or "GDPR compliance"               |

---

**Version:** 0.5.0
**Last Updated:** 2025-01-27
**Feedback:** [Your feedback channel]
