# Claude Code Integration Design

**Version:** 1.0
**Date:** 2025-01-24
**Status:** Design Approved

## Table of Contents

1. [Overview](#overview)
2. [Architecture Decision](#architecture-decision)
3. [Reference Sheets Design](#reference-sheets-design)
4. [File Organization](#file-organization)
5. [CLI Command Design](#cli-command-design)
6. [Slash Commands](#slash-commands)
7. [Specialized Agents](#specialized-agents)
8. [Implementation Plan](#implementation-plan)
9. [Usage Examples](#usage-examples)

---

## Overview

This document describes the design for integrating Documentation Robotics (DR) with Claude Code to enable agentic workflows for architecture model creation and maintenance.

### Goals

1. Enable agents to effectively use the DR CLI to create and maintain architecture models
2. Provide developers with seamless tools to extract models from codebases
3. Support natural language interactions for architecture modeling
4. Balance completeness with token efficiency for agent context
5. Follow established patterns (like `pre-commit install`, `husky install`)

### Non-Goals

- Creating a remote service or API (local CLI usage only)
- Building graphical user interfaces
- Real-time collaboration features
- Replacing the CLI with agent-only interfaces

---

## Architecture Decision

### Decision: CLI-First Approach (No MCP Server)

After evaluating multiple approaches, we decided on a **CLI-first architecture** that provides agents with direct access to the DR CLI and Python API, without an intermediate MCP server layer.

### Rationale

**Why NOT MCP Server:**

The MCP (Model Context Protocol) server pattern is designed for remote/networked tool access. In our case:

- ❌ Model is local (YAML files in the codebase being documented)
- ❌ CLI is accessible via Bash tool (agents can run commands directly)
- ❌ CLI already provides structured output (JSON, YAML)
- ❌ MCP would just wrap subprocess calls: `subprocess.run(['dr', 'find', id])`
- ❌ Additional layer adds complexity without value for local use case

**Why CLI + Python API:**

- ✅ **Simpler** - One less layer to maintain
- ✅ **Transparent** - User sees exact commands executed
- ✅ **Debuggable** - Can run same commands manually
- ✅ **Flexible** - Agent chooses CLI vs Python vs file access based on need
- ✅ **Familiar** - Developers already know the CLI
- ✅ **No duplication** - Don't reimplement CLI functionality

### Three Tiers of Access

Agents have three ways to interact with DR models:

#### Tier 1: Direct CLI Commands

```bash
dr find business.service.order-management
dr add business service --name "Payment" --property criticality=high
dr validate --strict
dr export --format archimate
```

**Good for:**

- Single operations
- Queries and searches
- Validation
- Exports

**Advantages:**

- Simple and direct
- Structured output (JSON/YAML)
- Built-in error handling

#### Tier 2: Python Scripts (Complex Operations)

```python
# Agent writes: /tmp/add_feature.py
from documentation_robotics.core import Model
from documentation_robotics.core.projection_engine import ProjectionEngine

model = Model.load("./")

# Complex multi-step operation
business_svc = model.add_element("business", {
    "type": "service",
    "name": "Payment Processing",
    "properties": {"criticality": "critical"}
})

# Project with custom logic
engine = ProjectionEngine(model, "./projection-rules.yaml")
app_svc = engine.project_element(business_svc, "application")

# Validate
result = model.validate(strict=True)
print(result.to_json())
```

**Good for:**

- Complex workflows
- Conditional logic
- Batch operations
- Operations requiring state

**Advantages:**

- Full Python API access
- Structured returns
- Can use all Python libraries
- Type safety

#### Tier 3: Direct File Access

```python
# Agent reads YAML directly
Read(/path/to/model/02_business/services.yaml)

# Agent edits YAML
Edit(file_path=..., old_string=..., new_string=...)
```

**Good for:**

- Quick reviews
- Simple edits
- Debugging
- Understanding file structure

**Advantages:**

- No CLI overhead
- Direct and transparent
- Fastest for simple cases

### When MCP Would Make Sense

MCP server would be valuable if we needed to:

- ❌ Expose DR to **remote agents** (not local Claude Code)
- ❌ Build a **DR service** that runs separately from the CLI
- ❌ Integrate with **non-CLI tools** (VS Code extension, web UI)
- ❌ **Hide the filesystem** from agents (security/sandboxing)

None of these apply to our local developer workflow use case. We can revisit MCP if requirements change.

---

## Reference Sheets Design

### Three-Tier Approach

To balance completeness with token efficiency, we provide three tiers of reference documentation:

#### Tier 1: Essentials (300-500 tokens)

**File:** `tier1-essentials.md`
**Purpose:** Always loaded in agent context
**Contents:**

- 11 layers with one-line purpose
- Element ID format: `{layer}.{type}.{kebab-name}`
- 5 essential CLI commands with syntax
- 3 key cross-layer patterns (realizes, supports-goals, securedBy)
- Where to find more information

**Token budget:** ~400 tokens

#### Tier 2: Developer Guide (800-1200 tokens)

**File:** `tier2-developer-guide.md`
**Purpose:** Loaded during active modeling work
**Contents:**

- All of Tier 1, plus:
- Top 3-5 entity types per layer
- Python API methods (Model, Layer, Element classes)
- Validation levels and common errors
- Projection engine basics
- Cross-layer traceability flows
- Common operation examples

**Token budget:** ~1000 tokens

#### Tier 3: Complete Reference (2000-3000 tokens)

**File:** `tier3-complete-reference.md`
**Purpose:** Query specific sections as needed
**Contents:**

- Complete entity type catalog
- Full CLI command reference with all options
- Detailed validation rules
- Export format specifications
- Advanced projection patterns
- Troubleshooting guide

**Token budget:** ~2500 tokens

### Token Budget Strategy

```
Always in context:    Tier 1           (400 tokens)
Working session:      Tier 1 + Tier 2  (1400 tokens)
Deep work:            Query Tier 3 sections on demand
```

This provides **98.5% token efficiency** while maintaining completeness when needed.

### Content Organization Principles

**Include in reference sheets:**

- ✅ Core concepts and patterns
- ✅ Common commands and operations
- ✅ Cross-layer relationship patterns
- ✅ Most frequently used entity types
- ✅ Where to find detailed documentation

**Exclude from reference sheets (link to external docs):**

- ❌ Complete schema definitions
- ❌ All entity types for every layer
- ❌ Export format details
- ❌ Internal implementation details
- ❌ Validator implementation specifics

Agents can query detailed documentation when needed, keeping the core reference lean.

---

## File Organization

### Source Structure (in CLI codebase)

```
cli/src/documentation_robotics/
├── commands/
│   ├── claude.py                    # NEW: dr claude command
│   └── ... (existing commands)
│
└── claude_integration/              # NEW: Claude Code integration assets
    ├── __init__.py
    ├── README.md                    # Documentation for this folder
    │
    ├── reference_sheets/            # Knowledge base for agents
    │   ├── tier1-essentials.md         # 300-500 tokens, always loaded
    │   ├── tier2-developer-guide.md    # 800-1200 tokens, on-demand
    │   └── tier3-complete-reference.md # 2000-3000 tokens, query only
    │
    ├── commands/                    # Slash commands
    │   ├── dr-init.md
    │   ├── dr-model.md
    │   ├── dr-ingest.md
    │   ├── dr-project.md
    │   └── dr-validate.md
    │
    ├── agents/                      # Specialized sub-agent definitions
    │   ├── dr-extractor.md             # Model extraction agent
    │   ├── dr-validator.md             # Validation & fix agent
    │   └── dr-documenter.md            # Documentation generator
    │
    └── templates/                   # Optional: templates for customization
        ├── claude.config.yaml          # Claude Code settings template
        └── custom-command-template.md
```

### Target Structure (installed in project)

```
project-root/
├── .claude/
│   ├── .dr-version                   # Version tracking (created by install)
│   │
│   ├── knowledge/                    # Reference sheets
│   │   ├── dr-tier1-essentials.md
│   │   ├── dr-tier2-developer-guide.md
│   │   └── dr-tier3-complete-reference.md
│   │
│   ├── commands/                     # Slash commands
│   │   ├── dr-init.md
│   │   ├── dr-model.md
│   │   ├── dr-ingest.md
│   │   ├── dr-project.md
│   │   └── dr-validate.md
│   │
│   └── agents/                       # Agent definitions
│       ├── dr-extractor.md
│       ├── dr-validator.md
│       └── dr-documenter.md
│
├── dr.config.yaml                    # DR configuration
├── projection-rules.yaml             # Projection rules
└── model/                            # Architecture model
    ├── manifest.yaml
    ├── 01_motivation/
    ├── 02_business/
    └── ...
```

### File Naming Convention

**In source (`claude_integration/`):**

- Use generic names: `tier1-essentials.md`, `dr-init.md`
- Mirrors the conceptual organization

**In target (`.claude/`):**

- Add `dr-` prefix: `dr-tier1-essentials.md`, `dr-init.md`
- Makes it clear which files belong to DR
- Prevents naming conflicts with other tools

---

## CLI Command Design

### Command Interface

```bash
# Install all Claude integration files
dr claude install

# Install specific components
dr claude install --reference-only      # Just reference sheets
dr claude install --commands-only       # Just slash commands
dr claude install --agents-only         # Just agents

# Update installed files
dr claude update                        # Smart update (checks for modifications)
dr claude update --force                # Overwrite all (ignores modifications)
dr claude update --dry-run              # Preview changes

# Remove installed files
dr claude remove                        # Remove all (with confirmation)
dr claude remove --commands             # Remove just commands
dr claude remove --force                # Skip confirmation

# Status and info
dr claude status                        # Show what's installed + versions
dr claude list                          # List available components
dr claude diff                          # Show differences between installed vs latest
```

### Installation Behavior

**Install process:**

1. Check if `.claude/` directory exists (create if needed)
2. Copy files from source to target locations
3. Check for existing files:
   - If file doesn't exist: install
   - If file exists and `--force`: overwrite
   - If file exists (no force): ask user
4. Create/update `.claude/.dr-version` tracking file
5. Display success message with next steps

**File mapping:**

| Source                                         | Target                                             |
| ---------------------------------------------- | -------------------------------------------------- |
| `reference_sheets/tier1-essentials.md`         | `.claude/knowledge/dr-tier1-essentials.md`         |
| `reference_sheets/tier2-developer-guide.md`    | `.claude/knowledge/dr-tier2-developer-guide.md`    |
| `reference_sheets/tier3-complete-reference.md` | `.claude/knowledge/dr-tier3-complete-reference.md` |
| `commands/dr-init.md`                          | `.claude/commands/dr-init.md`                      |
| `commands/dr-model.md`                         | `.claude/commands/dr-model.md`                     |
| `commands/dr-ingest.md`                        | `.claude/commands/dr-ingest.md`                    |
| `commands/dr-project.md`                       | `.claude/commands/dr-project.md`                   |
| `commands/dr-validate.md`                      | `.claude/commands/dr-validate.md`                  |
| `agents/dr-extractor.md`                       | `.claude/agents/dr-extractor.md`                   |
| `agents/dr-validator.md`                       | `.claude/agents/dr-validator.md`                   |
| `agents/dr-documenter.md`                      | `.claude/agents/dr-documenter.md`                  |

### Version Tracking

**`.claude/.dr-version` file format:**

```yaml
version: "0.3.0" # DR CLI version used for install
installed_at: "2025-01-15T10:30:00Z"
components:
  reference_sheets:
    tier1-essentials.md:
      hash: "abc123..." # SHA-256 hash (first 8 chars)
      modified: false
    tier2-developer-guide.md:
      hash: "def456..."
      modified: false
    tier3-complete-reference.md:
      hash: "ghi789..."
      modified: false
  commands:
    dr-init.md:
      hash: "jkl012..."
      modified: false
    dr-model.md:
      hash: "mno345..."
      modified: true # User customized this
    dr-ingest.md:
      hash: "pqr678..."
      modified: false
    dr-project.md:
      hash: "stu901..."
      modified: false
    dr-validate.md:
      hash: "vwx234..."
      modified: false
  agents:
    dr-extractor.md:
      hash: "yza567..."
      modified: false
    dr-validator.md:
      hash: "bcd890..."
      modified: false
    dr-documenter.md:
      hash: "efg123..."
      modified: false
```

### Update Logic

**Smart update algorithm:**

```python
def update_component(source_path, target_path, force=False):
    """Update a component file with smart modification detection."""

    # 1. Check if file exists
    if not target_path.exists():
        # New file, just copy
        copy_file(source_path, target_path)
        return "installed"

    # 2. Compute current hash
    current_hash = compute_hash(target_path)

    # 3. Load version tracking data
    version_data = load_version_file()
    stored_hash = get_stored_hash(version_data, target_path)

    # 4. Check if user modified the file
    if current_hash != stored_hash:
        # File was modified by user
        if force:
            # Force mode: backup and overwrite
            backup_file(target_path)  # Save as .bak
            copy_file(source_path, target_path)
            return "overwritten (backup created)"
        else:
            # Interactive mode: ask user
            choice = prompt_user([
                "Overwrite (lose changes)",
                "Skip (keep current)",
                "Diff (show changes)",
                "Backup & overwrite"
            ])

            if choice == "overwrite":
                copy_file(source_path, target_path)
                return "overwritten"
            elif choice == "skip":
                return "skipped"
            elif choice == "diff":
                show_diff(target_path, source_path)
                # Recurse to ask again
                return update_component(source_path, target_path, force)
            elif choice == "backup":
                backup_file(target_path)
                copy_file(source_path, target_path)
                return "overwritten (backup created)"
    else:
        # File not modified, safe to update
        copy_file(source_path, target_path)
        return "updated"
```

**Update display:**

```
Available Updates
┌─────────────────────────────┬─────────────┬────────────────┐
│ File                        │ Status      │ Action         │
├─────────────────────────────┼─────────────┼────────────────┤
│ tier1-essentials.md         │ Unchanged   │ Update         │
│ tier2-developer-guide.md    │ Unchanged   │ Update         │
│ dr-model.md                 │ Modified    │ Skip (keep)    │
│ dr-ingest.md                │ New version │ Update         │
│ dr-extractor.md             │ Unchanged   │ Update         │
└─────────────────────────────┴─────────────┴────────────────┘

Proceed with updates? (y/n):
```

### Status Display

```bash
$ dr claude status

Installation Status
Version: 0.3.0
Installed: 2025-01-15T10:30:00

┌──────────────────┬───────┬──────────┐
│ Component        │ Files │ Modified │
├──────────────────┼───────┼──────────┤
│ reference_sheets │   3   │    -     │
│ commands         │   5   │    1     │
│ agents           │   3   │    -     │
└──────────────────┴───────┴──────────┘
```

---

## Slash Commands

Slash commands provide convenient access to common DR workflows. Each command is a markdown file that contains a prompt for Claude Code.

### `/dr-init` - Initialize Model

**Purpose:** Create a new DR model with interactive guidance

**Behavior:**

1. Check if model already exists (warn if yes)
2. Prompt for project details:
   - Name
   - Description
   - Version
   - Template (basic, e-commerce, microservices)
3. Run `dr init` with gathered information
4. Create initial directory structure
5. Show next steps (add first elements, configure validation)

**Example:**

```bash
/dr-init
```

### `/dr-model` - Interactive Modeling

**Purpose:** Natural language interface for model operations

**Behavior:**

1. Parse natural language intent
2. Use DR CLI to query existing model for context
3. Suggest element creation/updates
4. Show preview of changes
5. Ask for confirmation
6. Apply changes with validation
7. Suggest related actions (project, add metrics, etc.)

**Examples:**

```bash
/dr-model Add order management service to business layer
/dr-model Create authentication scheme for API layer
/dr-model Model the checkout process end-to-end
```

### `/dr-ingest` - Extract from Codebase

**Purpose:** Analyze existing code and generate architecture model

**Behavior:**

1. Launch model-extractor sub-agent
2. Agent analyzes code structure:
   - File organization
   - Imports and dependencies
   - API endpoints
   - Database schemas
   - Configuration files
3. Agent maps code → model elements across specified layers
4. Agent validates extracted model
5. Shows summary + validation report
6. Asks user to review and approve

**Examples:**

```bash
/dr-ingest ./src/api --layers business,application,api
/dr-ingest . --layers all
```

### `/dr-project` - Automated Projection

**Purpose:** Project elements across layers using rules

**Behavior:**

1. Load projection rules from `projection-rules.yaml`
2. Find matching elements in source layer
3. Show preview of projections (what will be created)
4. Ask for confirmation
5. Create projected elements
6. Validate cross-layer references
7. Show summary of created elements

**Examples:**

```bash
/dr-project business→application
/dr-project business→application --element-id business.service.orders
/dr-project application→api,data_model
```

### `/dr-validate` - Validation & Auto-fix

**Purpose:** Validate model and suggest/apply fixes

**Behavior:**

1. Run validation (schema, semantic, cross-layer)
2. Display results grouped by severity:
   - ❌ Errors (must fix)
   - ⚠️ Warnings (should fix)
   - ℹ️ Info (suggestions)
3. For each issue:
   - Show location
   - Explain problem
   - Suggest fix (if available)
   - Show confidence level
4. If `--fix` flag:
   - Show which fixes are safe vs risky
   - Apply approved fixes
   - Re-validate
   - Show final results

**Examples:**

```bash
/dr-validate
/dr-validate --strict
/dr-validate --fix
/dr-validate --layer business
```

---

## Specialized Agents

Specialized agents handle complex, multi-step operations that benefit from autonomous reasoning and decision-making.

### Model Extractor Agent

**Subagent type:** `dr-extractor`

**Purpose:** Extract architecture model from existing codebase

**Capabilities:**

- Analyze code structure (AST parsing when needed)
- Identify services, components, APIs, databases
- Map code patterns → DR elements
- Generate cross-layer references
- Validate extracted model
- Handle multiple languages/frameworks

**Tools available:**

- `Glob` - Find files by pattern
- `Grep` - Search code for keywords
- `Read` - Read source files
- `Bash` - Run DR CLI commands
- Direct Python API access (for complex operations)

**Input:**

- Codebase path
- Target layers to extract
- Optional: Technology hints (FastAPI, Express, React, etc.)

**Output:**

- Validated DR model
- Extraction report:
  - Elements created per layer
  - Confidence scores
  - Warnings/issues
  - Recommendations

**Example usage:**

```python
Task(
    subagent_type="dr-extractor",
    prompt="""Extract architecture model from ./src/api

    Target layers: business, application, api, data_model

    Technology stack: Python FastAPI, PostgreSQL

    Please:
    1. Analyze the codebase structure
    2. Identify services, endpoints, data models
    3. Create corresponding DR elements
    4. Establish cross-layer references
    5. Validate the complete model
    6. Provide extraction report with confidence scores
    """
)
```

### Architecture Validator Agent

**Subagent type:** `dr-validator`

**Purpose:** Comprehensive validation with intelligent fix suggestions

**Capabilities:**

- Multi-level validation (schema, semantic, cross-layer)
- Pattern detection (missing monitoring, no security, broken references)
- Suggest fixes with confidence scores
- Apply safe fixes automatically
- Flag risky changes for review
- Generate validation reports

**Tools available:**

- `Read` - Read model files
- `Bash` - Run DR validation commands
- `Edit` - Apply fixes to YAML files
- Direct Python API access (for complex validation logic)

**Input:**

- Model path
- Validation level (basic, standard, strict)
- Auto-fix mode (safe-only, all, none)

**Output:**

- Validation report
- Applied fixes (if auto-fix enabled)
- Remaining issues requiring manual attention
- Recommendations for model improvements

**Example usage:**

```python
Task(
    subagent_type="dr-validator",
    prompt="""Validate the DR model and apply safe fixes

    Validation level: strict
    Auto-fix: safe-only

    Please:
    1. Run full validation (schema, semantic, cross-layer)
    2. Analyze all errors and warnings
    3. Suggest fixes with confidence scores
    4. Automatically apply fixes with confidence >= 90%
    5. List remaining issues requiring review
    6. Provide recommendations for model improvements
    """
)
```

### Documentation Generator Agent

**Subagent type:** `dr-documenter`

**Purpose:** Generate comprehensive architecture documentation

**Capabilities:**

- Read complete model
- Generate narrative documentation
- Create diagrams (PlantUML, Mermaid)
- Build traceability matrices
- Export to multiple formats
- Follow documentation templates

**Tools available:**

- `Read` - Read model files
- `Bash` - Run DR export commands
- `Write` - Create documentation files
- Direct Python API access (for custom exports)

**Input:**

- Model path
- Documentation template/format
- Target audience (developers, architects, stakeholders)
- Output format (markdown, PDF, HTML)

**Output:**

- Complete architecture documentation
- Diagrams and visualizations
- Traceability matrices
- Element catalogs

**Example usage:**

```python
Task(
    subagent_type="dr-documenter",
    prompt="""Generate architecture documentation

    Target audience: Software architects
    Output format: Markdown + PlantUML diagrams

    Please:
    1. Read the complete DR model
    2. Generate layer-by-layer documentation
    3. Create component and deployment diagrams
    4. Build traceability matrices (goals → implementation)
    5. Generate element catalogs
    6. Export to ./docs/architecture/
    """
)
```

---

## Implementation Plan

### Phase 1: Foundation (Week 1)

**Goals:**

- Set up directory structure
- Implement `dr claude` command
- Create Tier 1 reference sheet

**Tasks:**

1. **Create directory structure**

   ```bash
   mkdir -p cli/src/documentation_robotics/claude_integration/{reference_sheets,commands,agents,templates}
   touch cli/src/documentation_robotics/claude_integration/{__init__.py,README.md}
   ```

2. **Implement `dr claude` command**
   - Create `cli/src/documentation_robotics/commands/claude.py`
   - Implement `ClaudeIntegrationManager` class
   - Implement subcommands: install, update, remove, status, list
   - Add tests

3. **Create Tier 1 reference sheet**
   - Write `reference_sheets/tier1-essentials.md`
   - Target: 300-500 tokens
   - Include: layers, ID format, basic commands, key patterns
   - Test with Claude Code (verify it's useful)

4. **Register command**
   - Add to CLI entry points
   - Update documentation

**Deliverables:**

- ✅ Working `dr claude install` command
- ✅ Tier 1 reference sheet
- ✅ Tests passing

### Phase 2: Reference Sheets & Commands (Week 2)

**Goals:**

- Complete all reference sheets
- Implement 2-3 slash commands

**Tasks:**

1. **Create remaining reference sheets**
   - Write `reference_sheets/tier2-developer-guide.md` (800-1200 tokens)
   - Write `reference_sheets/tier3-complete-reference.md` (2000-3000 tokens)
   - Validate token counts
   - Test with Claude Code

2. **Implement slash commands**
   - Write `commands/dr-init.md`
   - Write `commands/dr-model.md`
   - Write `commands/dr-validate.md`
   - Test each command with Claude Code

3. **Test installation workflow**
   - Test `dr claude install` with all files
   - Test `dr claude update` with modifications
   - Test `dr claude status`
   - Test `dr claude remove`

**Deliverables:**

- ✅ Three reference sheets (all tiers)
- ✅ Three working slash commands
- ✅ Installation/update workflow tested

### Phase 3: Remaining Commands (Week 3)

**Goals:**

- Complete all slash commands
- Begin agent definitions

**Tasks:**

1. **Implement remaining slash commands**
   - Write `commands/dr-ingest.md`
   - Write `commands/dr-project.md`
   - Test with real codebases

2. **Create agent definitions**
   - Write `agents/dr-extractor.md`
   - Define agent capabilities, tools, behavior
   - Test with simple extraction scenario

3. **Documentation**
   - Update user guide with Claude integration section
   - Create examples and tutorials
   - Document customization patterns

**Deliverables:**

- ✅ Five slash commands complete
- ✅ Model extractor agent defined
- ✅ Documentation updated

### Phase 4: Advanced Agents (Week 4)

**Goals:**

- Complete all agent definitions
- Refine and polish
- User testing

**Tasks:**

1. **Complete agent definitions**
   - Write `agents/dr-validator.md`
   - Write `agents/dr-documenter.md`
   - Test each agent with real scenarios

2. **Refinement**
   - Gather feedback from testing
   - Refine prompts and reference sheets
   - Optimize token usage
   - Improve error messages

3. **Templates and examples**
   - Create customization templates
   - Add example workflows
   - Create video/GIF demos

**Deliverables:**

- ✅ All agents complete and tested
- ✅ Refined based on user feedback
- ✅ Examples and templates available

### Phase 5: Release (Week 5)

**Goals:**

- Final polish
- Documentation complete
- Release as part of DR CLI

**Tasks:**

1. **Final testing**
   - Test all components together
   - Test on multiple projects
   - Validate token efficiency
   - Performance testing

2. **Documentation**
   - Complete user guide
   - API documentation
   - Tutorial videos
   - Migration guide

3. **Release**
   - Version bump
   - Changelog
   - Announcement
   - Gather feedback

**Deliverables:**

- ✅ Claude Code integration released
- ✅ Documentation complete
- ✅ Ready for user adoption

---

## Usage Examples

### Example 1: Fresh Project Setup

```bash
# Create new DR model
$ dr init
✓ Created directory structure
✓ Initialized manifest.yaml
✓ Copied schemas

# Install Claude integration
$ dr claude install
✓ Created .claude/ directory
Installing reference_sheets...
  ✓ dr-tier1-essentials.md
  ✓ dr-tier2-developer-guide.md
  ✓ dr-tier3-complete-reference.md
Installing commands...
  ✓ dr-init.md
  ✓ dr-model.md
  ✓ dr-ingest.md
  ✓ dr-project.md
  ✓ dr-validate.md
Installing agents...
  ✓ dr-extractor.md
  ✓ dr-validator.md
  ✓ dr-documenter.md

✓ Claude integration installed successfully!

Next steps:
1. Reference sheets are available in .claude/knowledge/
2. Try slash commands: /dr-init, /dr-model
3. Run `dr claude status` to see what's installed

# Start using with Claude Code
$ claude
> Let's add our first business service using /dr-model
```

### Example 2: Extract Model from Existing Codebase

```bash
# User runs slash command in Claude Code
/dr-ingest ./src/api --layers business,application,api

# Behind the scenes:
# 1. Launches dr-extractor agent
# 2. Agent analyzes code structure
# 3. Agent creates DR elements using CLI
# 4. Agent validates model
# 5. Agent returns report

Output:
✓ Extracted 5 business services
✓ Created 5 application services
✓ Mapped 23 API operations
⚠ 3 validation warnings (missing descriptions)

Created elements:
- business.service.order-management
- business.service.payment-processing
- business.service.inventory-management
- business.service.notification-service
- business.service.user-management
(and corresponding application + api elements)

Recommendations:
1. Add descriptions to services
2. Add goal traceability (supports-goals)
3. Consider adding security policies

→ Next: Review model/02_business/services.yaml
```

### Example 3: Add Feature with Natural Language

```bash
# User types in Claude Code
> Add a new payment service that handles credit card processing.
> It should be critical priority and need PCI-DSS compliance.

# Claude Code uses /dr-model or composes CLI calls directly:

# 1. Create business service
$ dr add business service \
    --name "Payment Processing" \
    --description "Handles credit card transactions and payment processing" \
    --property criticality=critical

✓ Created business.service.payment-processing

# 2. Project to application layer
$ dr project business→application \
    --element-id business.service.payment-processing

✓ Created application.service.payment-processing

# 3. Add security control (detected criticality)
$ dr add security policy \
    --name "PCI-DSS Compliance" \
    --property applies_to=application.service.payment-processing

✓ Created security.policy.pci-dss-compliance

# 4. Add monitoring (auto for critical services)
$ dr add apm metric \
    --name "payment-processing-availability" \
    --property instruments=application.service.payment-processing

✓ Created apm.metric.payment-processing-availability

# 5. Validate end-to-end
$ dr validate --strict

✓ Validation passed
  - 4 elements added
  - 6 cross-layer references validated
  - Traceability chain complete

Summary:
Created complete payment service with:
✓ Business layer definition
✓ Application layer implementation
✓ Security policy (PCI-DSS)
✓ Monitoring (availability metric)
✓ Full traceability
```

### Example 4: Validate and Fix Issues

```bash
/dr-validate --strict --fix

# Behind the scenes: runs dr-validator agent

Running validation...
✓ Schema validation (12/12 passed)
✓ Naming validation (45/45 passed)
✗ Reference validation (2 errors)
⚠ Semantic validation (5 warnings)

❌ Errors (2):
1. business.service.orders
   Location: model/02_business/services.yaml:15
   Issue: Missing 'supports-goals' reference
   Impact: No goal traceability

   Suggested fix: Add reference to motivation.goal.improve-sales
   Confidence: High (goal analysis suggests strong correlation)
   Action: ✓ Auto-fix approved

2. application.service.order-api
   Location: model/04_application/services.yaml:23
   Issue: No security policy applied
   Impact: Public service without authentication

   Suggested fix: Add security.policy.authenticated-access
   Confidence: Medium (detected HTTP endpoints)
   Action: ⚠ Requires review (not auto-fixed)

⚠ Warnings (5):
[... list of warnings with suggestions ...]

Applying fixes...
✓ Updated business.service.orders (added supports-goals)
✓ Updated business.service.inventory (added description)
⚠ Skipped application.service.order-api (requires review)

Re-validating...
✓ Validation improved (2 errors → 1 error, 5 warnings → 3 warnings)

Remaining issues:
1. application.service.order-api - Add security policy (manual review needed)
2. Warning: Consider adding rate limiting to public APIs

Recommendations:
- Review and apply suggested security policy
- Run `dr add security policy` to create authentication scheme
- Consider adding API-level rate limiting controls
```

### Example 5: Update After CLI Upgrade

```bash
# Upgrade DR CLI
$ pip install --upgrade documentation-robotics
Successfully installed documentation-robotics-0.4.0

# Check for integration updates
$ dr claude status
Installation Status
Version: 0.3.0 (newer version available: 0.4.0)
Installed: 2025-01-15T10:30:00

# Update integration files
$ dr claude update

Checking for updates...

Available Updates:
┌──────────────────────────────┬─────────────┬──────────────┐
│ File                         │ Status      │ Action       │
├──────────────────────────────┼─────────────┼──────────────┤
│ dr-tier1-essentials.md       │ Unchanged   │ Update       │
│ dr-tier2-developer-guide.md  │ New content │ Update       │
│ dr-tier3-complete-reference.md│ New content│ Update       │
│ dr-model.md                  │ Modified    │ Skip (keep)  │
│ dr-ingest.md                 │ New version │ Update       │
│ dr-validate.md               │ Unchanged   │ Update       │
│ dr-extractor.md              │ New version │ Update       │
│ dr-validator.md              │ Unchanged   │ Update       │
│ dr-documenter.md             │ Unchanged   │ Update       │
└──────────────────────────────┴─────────────┴──────────────┘

Notes:
- dr-model.md was customized by you and will be preserved
- 6 files will be updated
- 1 file will be skipped (modified)

Proceed with updates? (y/n): y

Updating files...
✓ Updated dr-tier1-essentials.md
✓ Updated dr-tier2-developer-guide.md
✓ Updated dr-tier3-complete-reference.md
⊘ Skipped dr-model.md (modified - keeping your version)
✓ Updated dr-ingest.md
✓ Updated dr-extractor.md

✓ Updates applied successfully

What's new in 0.4.0:
- Enhanced reference sheets with new validation rules
- dr-ingest command now supports TypeScript analysis
- dr-extractor agent improved for microservices

Your customization (dr-model.md) was preserved.
To see changes: dr claude diff dr-model.md
To overwrite: dr claude update --force
```

### Example 6: Customization Workflow

```bash
# Install integration
$ dr claude install
✓ Installed successfully

# Customize a slash command
$ code .claude/commands/dr-model.md
# ... make changes to add company-specific patterns ...
# ... save file ...

# Status shows modification
$ dr claude status
┌──────────────────┬───────┬──────────┐
│ Component        │ Files │ Modified │
├──────────────────┼───────┼──────────┤
│ reference_sheets │   3   │    -     │
│ commands         │   5   │    1     │  ← dr-model.md modified
│ agents           │   3   │    -     │
└──────────────────┴───────┴──────────┘

# Future updates preserve customization
$ dr claude update
...
⊘ Skipped dr-model.md (modified - keeping your version)
...

# To see what changed in new version
$ dr claude diff
Showing differences for modified files:

dr-model.md:
  Your version: Modified 2025-01-16
  Latest version: 0.4.0

  [... shows diff ...]

# Force update if you want latest
$ dr claude update --force
⚠ This will overwrite your customizations
Backup will be saved to: .claude/commands/dr-model.md.bak
Continue? (y/n): y
✓ Updated (backup saved)
```

---

## Success Metrics

### For Reference Sheets

- ✅ Tier 1 < 500 tokens, always loaded
- ✅ Agents can perform CRUD without hallucinating IDs
- ✅ 90%+ of questions answered by Tier 1-2 alone
- ✅ Agents query Tier 3 only when truly needed

### For Agentic Integration

- ✅ Extract model from codebase in < 5 minutes
- ✅ Add new feature with full traceability in < 2 minutes
- ✅ Validate + auto-fix common issues successfully (>80% fix rate)
- ✅ Zero manual YAML editing needed for 80% of tasks
- ✅ Slash commands complete successfully on first try >90% of time

### For Installation/Management

- ✅ `dr claude install` completes in < 5 seconds
- ✅ Update correctly detects modifications 100% of time
- ✅ No file corruption or data loss
- ✅ Clear, helpful error messages for all failure modes

---

## Future Considerations

### Potential Enhancements

1. **MCP Server (if needed later)**
   - If remote access becomes important
   - If building web UI or VS Code extension
   - Can wrap existing CLI commands
   - Design is compatible with future MCP addition

2. **Language-Specific Extractors**
   - Enhanced code analysis for Python, TypeScript, Java, Go
   - Framework-specific extractors (FastAPI, Express, Spring Boot)
   - AST-based analysis for deeper insights

3. **AI-Powered Validation**
   - Use LLM to suggest better element names
   - Detect semantic inconsistencies
   - Recommend architectural improvements
   - Generate descriptions automatically

4. **Collaborative Features**
   - Multi-user model editing
   - Change tracking and approval workflows
   - Conflict resolution
   - Team templates and conventions

5. **IDE Integration**
   - VS Code extension with DR commands
   - Inline model viewing and editing
   - Real-time validation
   - Code → model navigation

6. **Advanced Projections**
   - Machine learning-based projection suggestions
   - Project from code analysis (not just rules)
   - Bi-directional sync (model ↔ code)

### Migration Path

If we need MCP server in the future:

1. Create MCP server that wraps CLI commands
2. Keep CLI as primary interface
3. MCP provides same operations via protocol
4. Reference sheets remain the same (tools change, concepts don't)
5. Slash commands can use MCP tools instead of Bash
6. Zero disruption to users

---

## Appendix A: Design Decisions

### Why Three Tiers of Reference Sheets?

**Problem:** Agent context windows are limited. Loading complete documentation every time wastes tokens.

**Solution:** Graduated levels of detail

- Always load essentials (400 tokens)
- Load developer guide for active work (+1000 tokens)
- Query complete reference only when needed

**Alternative considered:** Single comprehensive reference

- **Rejected because:** Would use 2500+ tokens always, even for simple queries

### Why CLI-First vs MCP Server?

**Problem:** How should agents interact with DR functionality?

**Solution:** Direct CLI + Python API access

- Simpler (no wrapper layer)
- Transparent (user sees commands)
- Flexible (agent chooses right tool)

**Alternative considered:** MCP server wrapping CLI

- **Rejected because:** Adds complexity without value for local use case
- MCP is for remote/networked access
- CLI already provides structured output
- Can add MCP later if needed (design supports it)

### Why `dr claude` Command vs Manual Installation?

**Problem:** How do users install Claude integration files?

**Solution:** CLI command that manages installation

- Familiar pattern (like `pre-commit install`)
- Version controlled with CLI
- Easy to update
- Handles conflicts intelligently

**Alternative considered:** Manual file copying

- **Rejected because:** Error-prone, hard to update, no version tracking

### Why Slash Commands vs Pure Agent Interaction?

**Problem:** How should users trigger common workflows?

**Solution:** Both—slash commands for convenience, agents use them or compose CLI directly

- Slash commands = convenient shortcuts
- Agents can use slash commands or CLI directly
- Best of both worlds

**Alternative considered:** Only natural language (no slash commands)

- **Rejected because:** Less predictable, harder to discover capabilities

### Why File-Based Agents vs Python Functions?

**Problem:** How should specialized agents be defined?

**Solution:** Markdown files with prompts + metadata

- Easy to edit and customize
- Version controlled
- No code changes needed
- Users can create their own

**Alternative considered:** Python functions/classes

- **Rejected because:** Harder to customize, requires code changes

---

## Appendix B: Related Documentation

- [CLI Vision](/cli/docs/00_cli_vision.md)
- [CLI Requirements](/cli/docs/01_cli_requirements.md)
- [CLI Design (All Phases)](/cli/docs/02_cli_design_phase_1.md)
- [User Guide - Getting Started](/cli/docs/user-guide/getting-started.md)
- [User Guide - Validation](/cli/docs/user-guide/validation.md)
- [Specification Overview](/spec/core/00_overview.md)
- [Layer Specifications](/spec/layers/)

---

## Appendix C: Terminology

- **Reference Sheet**: Concise documentation for agents (replaces "cheat sheet")
- **Slash Command**: Claude Code command starting with `/` that triggers a workflow
- **Sub-agent**: Specialized agent launched for complex tasks (via Task tool)
- **Agent**: Autonomous entity that can reason and use tools (Claude Code)
- **CLI**: Command-line interface (the `dr` command)
- **MCP**: Model Context Protocol (protocol for tool/resource access)
- **DR**: Documentation Robotics
- **Element**: Single architecture artifact (service, component, etc.)
- **Layer**: Organizational level in architecture (motivation, business, etc.)
- **Projection**: Automatic creation of elements across layers using rules

---

**Document Status:** ✅ Design Approved
**Next Steps:** Begin Phase 1 implementation
**Owner:** Documentation Robotics Team
**Last Updated:** 2025-01-24
