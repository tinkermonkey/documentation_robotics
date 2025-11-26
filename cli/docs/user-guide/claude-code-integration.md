# Using Documentation Robotics with Claude Code

This guide shows you how to use Documentation Robotics (DR) with Claude Code for AI-powered architecture modeling.

## Table of Contents

1. [Overview](#overview)
2. [Installation](#installation)
3. [Quick Start](#quick-start)
4. [Reference Sheets](#reference-sheets)
5. [Slash Commands](#slash-commands)
6. [Specialized Agents](#specialized-agents)
7. [Customization](#customization)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

---

## Overview

The Claude Code integration enables you to:

- **Create architecture models** using natural language
- **Extract models from code** automatically
- **Validate and fix** model issues
- **Generate documentation** from models
- **Query and search** models conversationally

### How It Works

The integration provides:

1. **Reference Sheets**: Knowledge base for Claude about DR concepts
2. **Slash Commands**: Quick access to common workflows
3. **Specialized Agents**: Autonomous agents for complex tasks

Claude Code can:

- Run DR CLI commands directly
- Use Python API for complex operations
- Read/write model files
- Generate and validate models

---

## Installation

### Prerequisites

1. **Install Documentation Robotics CLI**:

   ```bash
   pip install documentation-robotics
   ```

2. **Install Claude Code**:
   - Download from [claude.ai/claude-code](https://claude.ai/claude-code)
   - Or use the CLI version

3. **Initialize DR model** (if new project):

   ```bash
   cd your-project
   dr init
   ```

### Install Claude Integration

```bash
dr claude install
```

This installs:

```
.claude/
├── knowledge/
│   ├── dr-tier1-essentials.md
│   ├── dr-tier2-developer-guide.md
│   └── dr-tier3-complete-reference.md
├── commands/
│   ├── dr-init.md
│   ├── dr-model.md
│   ├── dr-ingest.md
│   ├── dr-project.md
│   ├── dr-validate.md
│   └── dr-changeset.md
└── agents/
    ├── dr-extractor.md
    ├── dr-validator.md
    └── dr-documenter.md
```

### Verify Installation

```bash
# Check installation status
dr claude status
```

Expected output:

```
Installation Status
Version: 0.3.3
Installed: 2025-01-26T10:30:00

┌──────────────────┬───────┬──────────┐
│ Component        │ Files │ Modified │
├──────────────────┼───────┼──────────┤
│ reference_sheets │   3   │    -     │
│ commands         │   6   │    -     │
│ agents           │   3   │    -     │
└──────────────────┴───────┴──────────┘
```

---

## Quick Start

### Example 1: Create a New Model

Open Claude Code in your project:

```bash
cd your-project
claude
```

Then in Claude Code:

```
Let's create a new architecture model for an e-commerce platform.

First, let me define the business goals:
/dr-model Add three business goals:
1. Increase conversion rate by 20%
2. Reduce cart abandonment by 30%
3. Improve customer satisfaction score to 4.5/5

Now add the core business services:
/dr-model Create business services for:
- Product catalog
- Shopping cart
- Order management
- Payment processing
- Customer accounts
```

Claude will:

1. Create goal elements with KPIs
2. Create business services
3. Link services to goals
4. Validate the model
5. Suggest next steps

### Example 2: Extract from Existing Code

```
I have an existing FastAPI application in ./src/api
Can you extract an architecture model from it?

/dr-ingest ./src/api --layers business,application,api,data_model
```

Claude will:

1. Launch the extractor agent
2. Analyze your codebase
3. Identify services, APIs, and data models
4. Create DR elements
5. Provide a detailed report

### Example 3: Validate and Fix

```
/dr-validate --fix
```

Claude will:

1. Run comprehensive validation
2. Identify issues
3. Suggest fixes with confidence scores
4. Apply safe fixes automatically
5. Report remaining issues

---

## Reference Sheets

The reference sheets provide Claude with knowledge about DR concepts.

### Tier 1: Essentials (Always Loaded)

**Location**: `.claude/knowledge/dr-tier1-essentials.md`

**Contents**:

- 11 layer definitions
- Element ID format
- 5 essential CLI commands
- Key cross-layer patterns

**Token budget**: ~400 tokens

**When loaded**: Always in Claude's context

### Tier 2: Developer Guide (On-Demand)

**Location**: `.claude/knowledge/dr-tier2-developer-guide.md`

**Contents**:

- Top entity types per layer
- Python API methods
- Validation levels
- Projection engine basics
- Cross-layer traceability
- Common operations

**Token budget**: ~1000 tokens

**When loaded**: During active modeling work

### Tier 3: Complete Reference (Query Only)

**Location**: `.claude/knowledge/dr-tier3-complete-reference.md`

**Contents**:

- Complete entity type catalog
- Full CLI command reference
- Detailed validation rules
- Export format specifications
- Advanced projection patterns
- Troubleshooting guide

**Token budget**: ~2500 tokens

**When loaded**: When Claude needs detailed information

### How Claude Uses Reference Sheets

Claude automatically:

1. Loads Tier 1 at session start
2. Loads Tier 2 when you start modeling
3. Queries Tier 3 for specific details

You don't need to think about this—Claude manages it.

---

## Slash Commands

Slash commands provide quick access to common DR workflows.

### `/dr-changeset` - Changeset Management

**Purpose**: Manage isolated workspaces for exploring changes

**Usage**:

```
/dr-changeset <natural language request>
```

**Examples**:

**Create changeset**:

```
/dr-changeset Create a new changeset for exploring the payment API redesign
```

**Check status**:

```
/dr-changeset What changes have I made?
```

**Compare with main**:

```
/dr-changeset Show me what's different from the main model
```

**Apply changes**:

```
/dr-changeset Apply these changes to the main model
```

**What it does**:

1. Interprets your natural language intent
2. Executes appropriate changeset operations
3. Provides clear feedback and guidance
4. Helps you work safely with isolated changes

**Key operations**:

- Create new changesets for exploration
- Check active changeset status
- Compare changesets or with main model
- Apply changes when ready
- Abandon changes if not needed
- Switch between multiple changesets

### `/dr-init` - Initialize Model

**Purpose**: Create a new DR model with interactive guidance

**Usage**:

```
/dr-init
```

**What it does**:

1. Checks if model already exists
2. Prompts for project details
3. Runs `dr init`
4. Creates directory structure
5. Shows next steps

**Example**:

```
/dr-init

Project name: E-Commerce Platform
Description: Online retail platform
Version: 1.0.0
Template: e-commerce

✓ Model initialized
✓ Directory structure created
✓ Schemas copied

Next steps:
1. Add business goals: /dr-model Add business goals
2. Define services: /dr-model Create business services
3. Extract from code: /dr-ingest ./src
```

### `/dr-model` - Interactive Modeling

**Purpose**: Natural language interface for model operations

**Usage**:

```
/dr-model [your request in natural language]
```

**Examples**:

**Add a service**:

```
/dr-model Add an order management service to the business layer
```

**Create authentication**:

```
/dr-model Create OAuth2 authentication scheme for all public APIs
```

**Model end-to-end feature**:

```
/dr-model Model the checkout process end-to-end, including:
- Business service
- Application service
- REST API endpoints
- Data models
- Security controls
```

**What it does**:

1. Parses your natural language request
2. Queries existing model for context
3. Suggests element creation/updates
4. Shows preview of changes
5. Asks for confirmation
6. Applies changes with validation
7. Suggests related actions

### `/dr-ingest` - Extract from Codebase

**Purpose**: Analyze code and generate architecture model

**Usage**:

```
/dr-ingest <path> [--layers layer1,layer2,...]
```

**Examples**:

**Extract from API directory**:

```
/dr-ingest ./src/api --layers business,application,api
```

**Extract entire codebase**:

```
/dr-ingest . --layers all
```

**What it does**:

1. Launches model-extractor agent
2. Agent analyzes code structure
3. Identifies architectural patterns
4. Maps code → DR elements
5. Creates elements across layers
6. Validates extracted model
7. Provides detailed report

**Supported languages/frameworks**:

- Python (FastAPI, Flask, Django)
- TypeScript/JavaScript (Express, NestJS)
- Java (Spring Boot)
- Go (Gin, Echo)

### `/dr-project` - Automated Projection

**Purpose**: Project elements across layers using rules

**Usage**:

```
/dr-project <source-layer>→<target-layer> [--element-id id]
```

**Examples**:

**Project business to application**:

```
/dr-project business→application
```

**Project specific element**:

```
/dr-project business→application --element-id business.service.orders
```

**Project to multiple layers**:

```
/dr-project application→api,data_model
```

**What it does**:

1. Loads projection rules
2. Finds matching elements in source layer
3. Shows preview of projections
4. Asks for confirmation
5. Creates projected elements
6. Validates cross-layer references
7. Shows summary

### `/dr-validate` - Validation & Auto-fix

**Purpose**: Validate model and suggest/apply fixes

**Usage**:

```
/dr-validate [--strict] [--fix] [--layer layer-name]
```

**Examples**:

**Basic validation**:

```
/dr-validate
```

**Strict validation**:

```
/dr-validate --strict
```

**Validate and auto-fix**:

```
/dr-validate --fix
```

**Validate specific layer**:

```
/dr-validate --layer security
```

**What it does**:

1. Runs validation (schema, semantic, cross-layer)
2. Displays results by severity
3. For each issue:
   - Shows location
   - Explains problem
   - Suggests fix
   - Shows confidence level
4. If `--fix`: applies approved fixes
5. Re-validates and shows results

---

## Specialized Agents

Agents are autonomous sub-processes for complex tasks.

### Model Extractor Agent

**Type**: `dr-extractor`

**Purpose**: Extract architecture model from existing codebase

**How to use**:

Via slash command:

```
/dr-ingest ./src/api --layers business,application,api
```

Or directly in conversation:

```
Please analyze my codebase at ./src and create an architecture model.
Focus on the business, application, and API layers.
```

**What it does**:

1. Discovers languages and frameworks
2. Identifies architectural patterns
3. Extracts services, APIs, data models
4. Creates DR elements with confidence scores
5. Establishes cross-layer references
6. Validates and reports

**Output**:

- Extracted model elements
- Confidence scores (high/medium/low)
- Validation report
- Recommendations

**See also**: [Model Extractor Agent](../src/documentation_robotics/claude_integration/agents/dr-extractor.md)

### Architecture Validator Agent

**Type**: `dr-validator`

**Purpose**: Comprehensive validation with intelligent fixes

**How to use**:

Via slash command:

```
/dr-validate --fix
```

Or directly:

```
Please validate my architecture model and fix any issues you can.
Use strict validation mode.
```

**What it does**:

1. Multi-level validation
2. Pattern detection
3. Fix suggestions with confidence
4. Applies safe fixes automatically
5. Reports remaining issues
6. Provides recommendations

**Output**:

- Validation report (before/after)
- Applied fixes
- Remaining issues
- Remediation roadmap

**See also**: [Validator Agent](../src/documentation_robotics/claude_integration/agents/dr-validator.md)

### Documentation Generator Agent

**Type**: `dr-documenter`

**Purpose**: Generate comprehensive architecture documentation

**How to use**:

Directly in conversation:

```
Please generate comprehensive architecture documentation.
Target audience: software architects
Format: Markdown + PlantUML diagrams
Output: ./docs/architecture/
```

**What it does**:

1. Analyzes model structure
2. Generates narrative documentation
3. Creates diagrams (component, deployment, etc.)
4. Builds traceability matrices
5. Exports to multiple formats
6. Customizes for audience

**Output**:

- Markdown documentation
- PlantUML diagrams
- Traceability matrices
- Element catalogs
- PDF/HTML exports

**See also**: [Documenter Agent](../src/documentation_robotics/claude_integration/agents/dr-documenter.md)

---

## Customization

### Creating Custom Commands

You can create custom slash commands for your organization.

**Example**: Add microservice with company standards

1. **Copy template**:

   ```bash
   cp .claude/templates/custom-command-template.md \
      .claude/commands/add-acme-service.md
   ```

2. **Define workflow** in the file:

   ```markdown
   # Add Acme Corp Microservice

   Creates a microservice following Acme Corp standards...

   ## Workflow

   1. Create business service
   2. Create application service (Spring Boot)
   3. Add CRUD API operations
   4. Apply OAuth2 + API Gateway security
   5. Add Kubernetes deployment (3 replicas)
   6. Add standard monitoring (availability, latency, errors)
   7. Validate and generate docs
   ```

3. **Test**:

   ```
   /add-acme-service payment-processing
   ```

**See**: [Custom Command Template](../src/documentation_robotics/claude_integration/templates/custom-command-template.md)

### Creating Custom Agents

You can create specialized agents for your needs.

**Example**: Compliance validation agent

1. **Copy template**:

   ```bash
   cp .claude/templates/custom-agent-template.md \
      .claude/agents/acme-compliance.md
   ```

2. **Define capabilities**:

   ```markdown
   # Acme Compliance Validator

   **Agent Type:** `acme-compliance`
   **Purpose:** Validates against SOC2, GDPR, HIPAA

   ## Capabilities

   - Multi-framework validation
   - Control mapping
   - Gap analysis
   - Risk assessment
   - Remediation guidance
   - Evidence collection
   ```

3. **Launch**:

   ```
   Please validate our architecture for SOC2 compliance.
   ```

**See**: [Custom Agent Template](../src/documentation_robotics/claude_integration/templates/custom-agent-template.md)

### Modifying Reference Sheets

You can customize reference sheets for your organization.

**Warning**: Modified files won't be updated automatically. Use `dr claude diff` to see changes in new versions.

**Example**: Add company-specific patterns

Edit `.claude/knowledge/dr-tier2-developer-guide.md`:

```markdown
## Acme Corp Patterns

### Standard Microservice Pattern

All microservices must include:

- OAuth2 authentication (Okta)
- API Gateway (Kong)
- Kubernetes deployment (3+ replicas)
- PostgreSQL database
- Redis cache
- Standard monitoring (availability, latency, errors)

### Security Requirements

- All APIs: OAuth2 + rate limiting
- Critical services: + MFA
- PII handling: + encryption at rest
```

---

## Best Practices

### 1. Validate Frequently

Run validation after significant changes:

```
/dr-validate
```

Best: Enable auto-validation in workflow:

```
After each change, run validation to catch issues early.
```

### 2. Commit Model with Code

Keep architecture docs in sync:

```bash
git add model/ docs/architecture/
git commit -m "Add payment feature

Architecture changes:
- Add business.service.payment-processing
- Add application.service.payment-api
- Add security controls (PCI-DSS)
- Add monitoring metrics
"
```

### 3. Use Natural Language

Don't overthink commands—just describe what you want:

❌ Bad:

```
/dr-model --layer business --type service --name "Order Management" --property criticality=high
```

✅ Good:

```
/dr-model Add a high-criticality order management service to the business layer
```

### 4. Build Incrementally

Start small and grow:

1. **Day 1**: Define goals and core services
2. **Week 1**: Model main application services
3. **Week 2**: Add API layer
4. **Week 3**: Add security and monitoring
5. **Ongoing**: Keep model current

### 5. Link to Business Value

Always connect to goals:

```
/dr-model Link the payment-processing service to the "increase conversion" goal
```

### 6. Review with Team

Architecture is collaborative:

```
Please generate a summary of our architecture for team review.
Include: business services, key APIs, security controls.
Format: Markdown with diagrams.
```

### 7. Keep Documentation Current

Regenerate docs after changes:

```bash
dr export --format markdown --output docs/architecture/
```

Or:

```
Please update our architecture documentation to reflect recent changes.
```

### 8. Use Agents for Complex Tasks

For multi-step operations, let agents work autonomously:

Instead of:

```
1. Extract services
2. Validate
3. Fix issues
4. Generate docs
```

Do:

```
Please extract our architecture from ./src, validate it,
fix any issues, and generate documentation.
```

### 9. Customize for Your Organization

Create custom commands for common patterns:

- Add microservice (your standards)
- Add API (your conventions)
- Add security (your policies)

### 10. Track Progress

Use the model to track implementation:

```yaml
# In element properties
implementation_status: planned # or: in-progress, complete
target_date: "2025-Q2"
owner: "@platform-team"
```

---

## Troubleshooting

### Issue: Claude doesn't know about DR

**Symptom**: Claude responds "I don't have information about Documentation Robotics"

**Solution**:

1. Check installation: `dr claude status`
2. Reinstall if needed: `dr claude install`
3. Restart Claude Code
4. Verify files in `.claude/knowledge/`

### Issue: Slash command not found

**Symptom**: `/dr-model` shows "Command not found"

**Solution**:

1. Check files exist: `ls .claude/commands/`
2. Verify filenames match command names
3. Restart Claude Code session
4. Check file permissions

### Issue: Agent produces errors

**Symptom**: Agent fails with "Command not found: dr"

**Solution**:

1. Verify DR CLI installed: `dr --version`
2. Check PATH includes DR: `which dr`
3. Install if missing: `pip install documentation-robotics`
4. Restart terminal and Claude Code

### Issue: Validation always fails

**Symptom**: `dr validate` reports many errors

**Solution**:

1. Start with basic validation: `dr validate` (not --strict)
2. Fix high-priority issues first
3. Use auto-fix: `/dr-validate --fix`
4. Review one layer at a time: `/dr-validate --layer business`

### Issue: Can't extract from code

**Symptom**: Extractor agent finds nothing

**Solution**:

1. Verify correct path: `ls ./src/api`
2. Check supported frameworks (Python FastAPI, etc.)
3. Provide hints: `/dr-ingest ./src --layers application --tech "FastAPI Python"`
4. Try manual modeling first

### Issue: Model grows too large

**Symptom**: Model has hundreds of elements, hard to manage

**Solution**:

1. Use layer filters: `dr list application service --filter domain=orders`
2. Create views: `dr export --filter "criticality=high"`
3. Split into modules: Use multiple model directories
4. Archive deprecated elements

### Issue: Token limit reached

**Symptom**: Claude says "I've reached my token limit"

**Solution**:

1. Use focused queries: Ask about specific layers/elements
2. Export to files: Generate docs, then ask Claude to review files
3. Break into sessions: Complete one layer at a time
4. Clear context: Start fresh session for new topics

### Issue: Customizations lost on update

**Symptom**: Custom commands overwritten by `dr claude update`

**Solution**:

1. Check status first: `dr claude status` (shows modified files)
2. Use smart update: `dr claude update` (preserves modifications)
3. Review changes: `dr claude diff your-command.md`
4. Backup custom files before force update

---

## Next Steps

### Getting Started

1. **Install**: `dr claude install`
2. **Try quick start**: Create a simple model
3. **Experiment**: Use slash commands
4. **Customize**: Create organization-specific commands

### Learning More

- [Design Document](../04_claude_code_integration_design.md) - Architecture and rationale
- [Workflow Examples](../src/documentation_robotics/claude_integration/templates/workflow-examples.md) - 10 complete workflows
- [Custom Command Template](../src/documentation_robotics/claude_integration/templates/custom-command-template.md)
- [Custom Agent Template](../src/documentation_robotics/claude_integration/templates/custom-agent-template.md)

### Getting Help

- **Documentation**: Full docs at `/cli/docs/`
- **Examples**: See `templates/workflow-examples.md`
- **Issues**: [GitHub Issues](https://github.com/yourusername/documentation-robotics/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/documentation-robotics/discussions)

### Contributing

We welcome:

- Custom command/agent contributions
- Workflow examples
- Documentation improvements
- Bug reports and feature requests

See [CONTRIBUTING.md](../../CONTRIBUTING.md)

---

## Summary

The Claude Code integration makes architecture modeling:

- **Faster**: Natural language instead of manual YAML
- **Smarter**: AI suggests fixes and improvements
- **Easier**: Slash commands for common tasks
- **Automated**: Agents extract from code and generate docs
- **Customizable**: Create organization-specific workflows

**Key commands**:

- `/dr-changeset` - Manage isolated workspaces
- `/dr-model` - Interactive modeling
- `/dr-ingest` - Extract from code
- `/dr-validate` - Validate and fix
- `dr claude install` - Install integration
- `dr claude status` - Check installation

Start modeling with AI today!
