# Documentation Robotics for GitHub Copilot - User Guide

**Welcome to Documentation Robotics for GitHub Copilot!** This guide will help you master conversational architecture modeling within VS Code.

---

## Table of Contents

<!-- markdownlint-disable MD051 -->

1. [Quick Start](#quick-start)
2. [Installation](#installation)
3. [Basic Usage](#basic-usage)
4. [Slash Commands](#slash-commands)
5. [Natural Language Modeling](#natural-language-modeling)
6. [Skills (Auto-Activation)](#skills-auto-activation)
7. [Workflows](#workflows)
8. [Common Scenarios](#common-scenarios)
9. [Tips & Best Practices](#tips-best-practices)
10. [Troubleshooting](#troubleshooting)

<!-- markdownlint-enable MD051 -->

---

## Quick Start

### 5-Minute Getting Started

1. **Open GitHub Copilot Chat** in VS Code (Cmd/Ctrl + Shift + I)

2. **Initialize a project:**

   ```
   @dr /init
   ```

3. **Model something naturally:**

   ```
   @dr /model Add a REST API for user authentication
   ```

4. **Validate your work:**

   ```
   @dr /validate
   ```

That's it! You just created architecture documentation conversationally.

---

## Installation

### Prerequisites

- **VS Code** version 1.85 or higher
- **GitHub Copilot** subscription (active)
- **Documentation Robotics CLI** installed:

  ```bash
  pip install documentation-robotics
  ```

### Install the Extension

**Option 1: From VSIX (Development)**

```bash
cd integrations/github_copilot
npm install
npm run compile
# Press F5 in VS Code to launch Extension Development Host
```

**Option 2: From VS Code Marketplace** (when published)

1. Open Extensions view (Cmd/Ctrl + Shift + X)
2. Search for "Documentation Robotics"
3. Click Install

### Configuration

The extension auto-detects the `dr` CLI in:

1. `.venv/bin/dr` (current workspace)
2. `venv/bin/dr` (current workspace)
3. `env/bin/dr` (current workspace)
4. System PATH

**Manual Configuration:**

```json
// settings.json
{
  "documentation-robotics.drPath": "/path/to/your/dr"
}
```

---

## Basic Usage

### The @dr Chat Participant

All interactions start with `@dr` in GitHub Copilot Chat:

```
@dr <your natural language request>
@dr /<command> <arguments>
```

### First Project

**1. Initialize:**

```
@dr /init
```

This creates the 11-layer architecture structure in `documentation-robotics/model/`.

**2. Add your first element:**

```
@dr /model Add a business service for managing orders
```

**3. See what was created:**

```
@dr /model Show me the business layer elements
```

**4. Validate:**

```
@dr /validate
```

---

## Slash Commands

### `/init` - Initialize Project

**Purpose:** Create a new DR project with 11-layer structure

**Usage:**

```
@dr /init
```

**What it does:**

- Creates `documentation-robotics/model/` directory
- Initializes 11 layers (motivation → testing)
- Creates `manifest.yaml`
- Sets up project metadata

**Options:**

```
@dr /init Project Name: "E-Commerce Platform"
```

---

### `/model` - Interactive Modeling

**Purpose:** Model architecture elements conversationally with intent detection

**Usage:**

```
@dr /model <natural language description>
```

**Features:**

- ✅ **Intent Detection**: Automatically detects what you want to do
- ✅ **Entity Extraction**: Understands layers, types, and names
- ✅ **Workflow Routing**: Uses specialized workflows for different tasks
- ✅ **Skills Activation**: Link validation, changeset review auto-activate

**Examples:**

**Add a single element:**

```
@dr /model Add a REST API operation for creating users
```

**Model an entire feature:**

```
@dr /model Model a payment processing feature with:
- Business service for payments
- Application component for payment gateway integration
- API operations for checkout and refunds
- Data model for transactions
```

**Explore an idea:**

```
@dr /model What if we switched from REST to GraphQL for our user API?
```

**Learn about modeling:**

```
@dr /model How do I model a microservice architecture?
```

**Validate and fix:**

```
@dr /model Check my model and fix any errors
```

---

### `/validate` - Validate Model

**Purpose:** Check model correctness with AI-powered analysis

**Usage:**

```
@dr /validate
```

**What it does:**

1. Runs `dr validate --strict`
2. Activates **Validator Agent** persona
3. Analyzes errors and suggests fixes
4. Provides fix commands with confidence scores

**Output:**

- Schema violations
- Link errors (broken references)
- Semantic warnings
- Suggested fixes (HIGH/MEDIUM/LOW confidence)

**Example Output:**

````
Skills activated: Link Validation

Running validation...

Found 3 errors:

1. [CRITICAL] business.service.payment-processing
   Missing required field: description
   Fix (HIGH confidence):
   ```execute
   dr update business.service.payment-processing --set description="Payment processing service"
````

2. [HIGH] api.operation.create-payment
   Broken link: operationId references non-existent component
   Fix (MEDIUM confidence):
   Create the referenced component or update the link

```

---

### `/ingest` - Extract from Code

**Purpose:** Analyze existing codebase and extract architecture model

**Usage:**
```

@dr /ingest

```

**What it does:**
- Scans your codebase
- Detects framework patterns (Django, FastAPI, Spring Boot, Express, etc.)
- Creates elements in appropriate layers
- Establishes cross-layer links
- Uses changesets for safe extraction

**Example:**
```

@dr /ingest Analyze my Python FastAPI application

Response:
Skills activated: Link Validation
Intent detected: EXTRACT_CODE (95% confidence)

I'll extract your FastAPI application into a DR model.
Creating changeset for safe extraction...

Found:

- 5 API endpoints → api layer
- 3 service classes → application layer
- 2 data models → data_model layer

Creating elements...

```

---

### `/project` - Cross-Layer Projection

**Purpose:** Project elements across layers using rules

**Usage:**
```

@dr /project

```

**What it does:**
- Projects elements from one layer to others
- Applies projection rules
- Maintains traceability

**Example:**
```

@dr /project Project business services to application layer

```

---

## Natural Language Modeling

### How It Works

The `/model` command uses **intent detection** to understand what you want:

```

Your Message → Intent Detector → Workflow Router → Specialized Agent

```

### 10 Intent Types

| What You Say | Detected Intent | What Happens |
|--------------|-----------------|--------------|
| "Check my model" | **VALIDATE** | Runs validation workflow |
| "Fix the errors" | **FIX_ERRORS** | Validates and suggests fixes |
| "Analyze my Python code" | **EXTRACT_CODE** | Runs extraction workflow |
| "Generate documentation" | **GENERATE_DOCS** | Exports to formats |
| "Check security" | **SECURITY_REVIEW** | Security audit workflow |
| "Upgrade to v0.2.0" | **MIGRATE_VERSION** | Migration workflow |
| "What if we used Redis?" | **EXPLORE_IDEA** | Ideation workflow |
| "How do I model X?" | **LEARN** | Educational workflow |
| "Add a service" | **ADD_ELEMENT** | Modeling workflow |
| "Model authentication" | **MODEL_FEATURE** | Modeling workflow |

### Intent Detection in Action

**Example 1: Validation**
```

You: @dr /model Is my model correct?

Response:
Intent detected: VALIDATE (85% confidence)

Running comprehensive validation...

```

**Example 2: Exploration**
```

You: @dr /model Should we use MongoDB or PostgreSQL for our user data?

Response:
Skills activated: Changeset Reviewer
Intent detected: EXPLORE_IDEA (90% confidence)

Great question! Let me help you explore both options.

First, a few questions:

1. What's your expected data volume and growth rate?
2. Do you need complex queries or relationships?
3. What's your team's experience level with each?

```

**Example 3: Learning**
```

You: @dr /model Which layer should I use for my REST API?

Response:
Intent detected: LEARN (95% confidence)

REST APIs belong in the **api layer**!

The api layer represents the INTERFACE of your system. Here's the decision tree:

- WHY → motivation (goals, requirements)
- WHAT → business (services, processes)
- INTERFACE → api (endpoints, operations) ← Your REST API
  ...

```

---

## Skills (Auto-Activation)

Skills are **background helpers** that automatically activate based on your conversation.

### Link Validation Skill 🔗

**Activates when:**
- You mention "link", "reference", "traceability"
- You add/modify elements across multiple layers
- You perform bulk operations (3+ additions)

**What it does:**
- Suggests `dr links validate` after operations
- Detects missing cross-layer references
- Suggests links based on naming patterns
- Validates bidirectional consistency

**Example:**
```

You: @dr /model Add these services:

- User management
- Order processing
- Payment processing
- Notification service

Response:
Skills activated: Link Validation

Creating services in business layer...

[Creates 4 services]

I've added 4 business services. I noticed these are standalone currently.
Should I validate cross-layer links to see if they reference:

- Application layer components (implementations)?
- Motivation layer goals (business value)?
- API layer operations (interfaces)?

```execute
dr links validate
```

```

### Changeset Reviewer Skill 📋

**Activates when:**
- You mention "changeset", "apply", "review"
- A changeset is active
- You're about to apply changes

**What it does:**
- Reviews changes before applying
- Checks for quality issues
- Validates within changeset
- Recommends apply only when safe

**Example:**
```

You: @dr /model Apply the exploration changeset

Response:
Skills activated: Changeset Reviewer

Before applying, let me review the changeset...

```execute
dr changeset diff explore-redis-123456
```

Found 5 changes:

- 2 new components (Redis cache, Cache manager)
- 3 updated components (User service, Order service, Session manager)

Quality check:
✅ All elements have documentation
✅ Cross-layer links present
⚠️ Validation has 1 warning: Redis component missing security policy link

Should I fix the warning first, or apply as-is?

```

### Skill Indicators

You'll see skill activations:
```

Skills activated: Link Validation, Changeset Reviewer

```

This means those skills are guiding the agent's behavior for this interaction.

---

## Workflows

Workflows provide specialized expertise for different task types.

### Validation Workflow ✅

**Triggered by:** "check", "validate", "is this correct?"

**Focus:**
- Comprehensive validation (schema + links)
- Error categorization by type and severity
- Pattern detection (batch fix opportunities)
- Confidence-scored fix suggestions

**Example:**
```

@dr /model Validate my model and fix all errors

[Validation Workflow activates]

Running: dr validate --strict --validate-links

Found 10 errors:

Pattern detected: 5 elements missing 'description' field
Batch fix available (HIGH confidence):

```execute
dr update business.service.* --set description="[Generated]"
```

Should I apply this batch fix?

```

### Extraction Workflow 🔬

**Triggered by:** "analyze code", "extract", "ingest"

**Focus:**
- Always uses changesets (safe)
- Framework pattern detection
- Layer mapping (API → api, Services → application, etc.)
- Automatic cross-layer linking

**Example:**
```

@dr /model Extract my Django application

[Extraction Workflow activates]

Creating changeset: extraction-1701234567

Analyzing Django project...
Detected:

- 8 models.py classes → data_model layer
- 6 views.py endpoints → api layer
- 4 services/ classes → application layer

Extracting with confidence scores...

```

### Ideation Workflow 💡

**Triggered by:** "what if", "should we", "compare"

**Focus:**
- Ask questions first (understand context)
- Research (web search for comparisons)
- Changeset for each alternative
- Pros/cons analysis
- Merge guidance

**Example:**
```

@dr /model What if we added caching with Redis?

[Ideation Workflow activates]

Great idea! Let me help you explore this.

First, a few questions:

1. What data do you want to cache?
2. What's your expected cache hit rate?
3. Are you caching for performance or scalability?

[After your answers]

Creating changeset: explore-redis-caching

Researching Redis caching patterns...
[WebSearch results...]

Modeling the Redis integration:

- application.component.redis-cache
- application.interface.cache-manager
- Links to: business.service.user-management

Pros:
✅ 10-100x performance improvement for reads
✅ Reduces database load
✅ Simple key-value API

Cons:
❌ Added complexity (cache invalidation)
❌ Extra infrastructure cost
❌ Potential data inconsistency

Would you like to:

1. Apply this changeset (add Redis to main model)
2. Keep exploring (compare with Memcached?)
3. Discard (not a good fit)

```

### Security Review Workflow 🔒

**Triggered by:** "security", "compliance", "vulnerabilities"

**Focus:**
- Security layer completeness
- Authentication/authorization checks
- Data protection verification
- Compliance (SOC2, GDPR, HIPAA)
- Threat analysis

**Example:**
```

@dr /model Review security for GDPR compliance

[Security Review Workflow activates]

Running security audit...

Checking security layer: 12 elements found

GDPR Compliance Check:

✅ PASS: Data encryption at rest (datastore.encryption.aes-256)
✅ PASS: User consent tracking (business.process.consent-management)
⚠️ WARNING: No data retention policy found
❌ CRITICAL: No right-to-deletion process modeled

Recommendations:

1. [CRITICAL] Add deletion process:

   ```execute
   dr add business process --name "User Data Deletion" --description "GDPR right to erasure"
   ```

2. [WARNING] Add retention policy:

   ```execute
   dr add security policy --name "Data Retention" --description "Retention periods per GDPR"
   ```

```

### Migration Workflow ⬆️

**Triggered by:** "migrate", "upgrade", "update version"

**Focus:**
- Check current status
- Dry-run preview
- Git branch recommendation
- Apply migration
- Post-migration validation

**Example:**
```

@dr /model Upgrade to spec v0.3.0

[Migration Workflow activates]

Checking migration status...
Current: v0.2.0
Target: v0.3.0

Running dry-run...

```execute
dr migrate --dry-run
```

Changes preview:

- Add 'testing' layer (new in v0.3.0)
- Update manifest format
- Migrate 3 link types to new patterns

Before applying, I recommend creating a git branch:

```shell
git checkout -b migrate-to-v0.3.0
git add documentation-robotics/
git commit -m "Pre-migration checkpoint"
```

Proceed with migration?

```

### Education Workflow 📚

**Triggered by:** "how do I", "which layer", "explain"

**Focus:**
- Clear concept explanations
- Layer decision tree
- Examples from guide
- Next learning steps
- Encouragement

**Example:**
```

@dr /model How do I model a microservice?

[Education Workflow activates]

Great question! Let me walk you through modeling a microservice.

A microservice typically spans multiple layers:

1. **Business Layer** (WHAT):
   - business.service - The business capability
     Example: business.service.user-management

2. **Application Layer** (HOW):
   - application.component - The microservice implementation
     Example: application.component.user-service

3. **API Layer** (INTERFACE):
   - api.operation - REST/GraphQL endpoints
     Example: api.operation.get-user

4. **Data Model Layer** (STRUCTURE):
   - data_model.entity - Domain entities
     Example: data_model.entity.user

Let's model a real example. What microservice would you like to create?

```

### Modeling Workflow 🏗️

**Triggered by:** "add", "create", "model"

**Focus:**
- Natural language interpretation
- Query first (avoid duplicates)
- Layer and type suggestion
- Proper properties
- Automatic linking
- Post-creation validation

**Example:**
```

@dr /model Add a REST API for creating orders

[Modeling Workflow activates]

Interpreting your request...

- Layer: api (REST API)
- Type: operation (API operation)
- Name: create-order

Checking for existing elements...
No duplicates found.

Creating API operation...

```execute
dr add api operation --name "Create Order" --description "Creates a new customer order" --set method=POST --set path=/orders
```

Cross-layer linking suggestions:

1. Link to business.service.order-management (business capability)
2. Link to application.component.order-service (implementation)
3. Link to data_model.entity.order (data structure)

Should I create these links?

```

---

## Common Scenarios

### Scenario 1: Starting a New Project

**Goal:** Model a new e-commerce platform from scratch

```

Step 1: Initialize
@dr /init Project: "E-Commerce Platform"

Step 2: Define goals
@dr /model Add these business goals:

- Increase online sales
- Improve customer experience
- Reduce cart abandonment

Step 3: Model business capabilities
@dr /model Add business services for:

- Product catalog
- Shopping cart
- Order processing
- Payment processing
- User management

Step 4: Design application architecture
@dr /model For each business service, create corresponding application components as microservices

Step 5: Define APIs
@dr /model Create REST APIs for:

- Product browsing
- Cart management
- Checkout flow
- User authentication

Step 6: Validate
@dr /validate

```

### Scenario 2: Extracting from Existing Code

**Goal:** Document existing Python FastAPI application

```

Step 1: Initialize (if not done)
@dr /init

Step 2: Extract
@dr /ingest Analyze my Python FastAPI application in src/

Step 3: Review changeset
@dr /model Show me the changeset diff

Step 4: Refine if needed
@dr /model Add missing security policies for authentication endpoints

Step 5: Apply
@dr /model Apply the extraction changeset

Step 6: Validate and link
@dr /validate

```

### Scenario 3: Exploring Architecture Changes

**Goal:** Evaluate switching from monolith to microservices

```

Step 1: Create exploration changeset
@dr /model What if we split our monolithic order service into microservices?

Step 2: Research (agent does this)
[Agent researches microservices patterns]

Step 3: Model alternatives
@dr /model Model this split:

- Order management microservice
- Inventory microservice
- Shipping microservice
- Payment microservice

Step 4: Analyze dependencies
@dr /model Show dependencies between these services

Step 5: Evaluate
@dr /model What are the pros and cons of this split?

Step 6: Decide
@dr /model Keep this changeset for future reference but don't apply yet

```

### Scenario 4: Security Audit

**Goal:** Ensure SOC2 compliance

```

Step 1: Security review
@dr /model Review my architecture for SOC2 compliance

Step 2: Fix critical issues
@dr /model Fix all critical security issues found

Step 3: Add missing elements
@dr /model Add security elements for:

- Access logging
- Encryption policies
- Authentication mechanisms

Step 4: Validate
@dr /validate

Step 5: Generate documentation
@dr /model Generate security documentation for audit

```

### Scenario 5: Onboarding New Team Member

**Goal:** Help new developer understand the architecture

```

New dev: @dr /model Explain the overall architecture

New dev: @dr /model Which services handle payments?

New dev: @dr /model Show me the API endpoints for user management

New dev: @dr /model How is authentication implemented?

New dev: @dr /model Generate a diagram of the authentication flow

```

---

## Tips & Best Practices

### Be Natural

✅ **Good:**
```

@dr /model Add a payment service with Stripe integration

```

❌ **Unnecessary:**
```

@dr execute dr add business service --name "Payment" --set integration=stripe

```

The whole point is natural language! Let the agent figure out the commands.

### Use Changesets for Exploration

✅ **Good:**
```

@dr /model What if we used GraphQL instead of REST?
[Agent creates changeset automatically]

```

✅ **Good:**
```

@dr /model I want to experiment with event-driven architecture

```

Changesets keep your experiments safe.

### Let Skills Activate Naturally

You don't need to ask for link validation or changeset reviews. They activate automatically!

✅ **Good:**
```

@dr /model Add 10 microservices for my platform
[Link Validation skill activates automatically]

```

❌ **Unnecessary:**
```

@dr /model Add microservices and then validate links

```

### Ask Questions

The agent is educational! Don't hesitate to ask:

```

@dr /model I'm not sure which layer to use for my API gateway. Can you explain?

```

```

@dr /model Why did the validation fail?

```

```

@dr /model What's the difference between business and application layers?

```

### Be Specific About Intent

When the agent isn't sure, provide more context:

✅ **Good:**
```

@dr /model I want to model the complete authentication feature, including:

- Business process for login
- Application component for JWT handling
- API endpoints for auth
- Security policies

```

❌ **Vague:**
```

@dr /model Do authentication stuff

```

### Review Before Applying

For changesets, always review:

```

@dr /model Show me the changeset diff before applying

```

### Validate Frequently

After major changes:

```

@dr /validate

```

Or just:

```

@dr /model Check if everything is correct

````

---

## Troubleshooting

### Extension Not Activating

**Problem:** `@dr` doesn't autocomplete in chat

**Solutions:**
1. Ensure GitHub Copilot is active (check status bar)
2. Reload VS Code window (Cmd/Ctrl + Shift + P → "Reload Window")
3. Check extension is installed and enabled

### DR CLI Not Found

**Problem:** "dr: command not found"

**Solutions:**
1. Verify DR CLI is installed: `pip list | grep documentation-robotics`
2. Check virtual environment is activated
3. Configure path manually:
   ```json
   {
     "documentation-robotics.drPath": "/path/to/dr"
   }
````

### Skills Not Activating

**Problem:** Link Validation doesn't activate when adding elements

**Possible causes:**

- Need 3+ additions for bulk trigger
- Need 2+ layers modified for cross-layer trigger
- Need link-related keywords

**Solutions:**

- Be explicit: "Add these and validate links"
- Check activation indicators in response

### Intent Not Detected

**Problem:** "Intent detected: UNKNOWN (0% confidence)"

**Solutions:**

- Be more explicit about what you want
- Use keywords from intent types (validate, extract, model, etc.)
- Provide more context

**Example:**
Instead of:

```
@dr /model Do the thing
```

Try:

```
@dr /model Validate my model and fix errors
```

### Commands Failing

**Problem:** `dr` commands return errors

**Solutions:**

1. Check you're in project root (where `documentation-robotics/` exists)
2. Verify element IDs are correct
3. Check YAML syntax if manually edited
4. Run `dr validate` to see specific errors

### Agent Loops Forever

**Problem:** Agent keeps making tool calls indefinitely

**Cause:** Max 10 loops to prevent infinite execution

**Solutions:**

- Usually means validation is failing repeatedly
- Check error messages in tool outputs
- Break request into smaller steps

### Wrong Layer Suggested

**Problem:** Agent suggests wrong layer for element

**Solutions:**

- Be explicit about layer:

  ```
  @dr /model Add a business service for payments
  ```

- Ask for explanation:

  ```
  @dr /model Why did you put that in the application layer?
  ```

- Correct and learn:

  ```
  @dr /model Actually, move that to the business layer
  ```

---

## Advanced Usage

### Multi-Step Workflows

Chain operations naturally:

```
@dr /model Create a complete user management feature:
1. Business service
2. Application component with JWT
3. REST API endpoints
4. Data model
5. Security policies
Then validate everything
```

The agent will execute all steps and validate at the end.

### Batch Operations

```
@dr /model Add these 5 microservices and link them all to the platform goal
```

### Research Integration

For ideation workflow:

```
@dr /model Compare these caching solutions and model the best one:
- Redis
- Memcached
- Varnish
```

The agent will research each option (WebSearch) before modeling.

### Custom Validation Rules

```
@dr /model Validate but focus on security layer completeness
```

### Documentation Generation

```
@dr /model Generate comprehensive architecture documentation including:
- Layer diagrams
- Dependency matrices
- Traceability reports
Export to markdown
```

---

## Keyboard Shortcuts

**Open Chat:**

- Mac: `Cmd + Shift + I`
- Windows/Linux: `Ctrl + Shift + I`

**Quick @dr:**

1. Open chat
2. Type `@dr`
3. Space to accept autocomplete
4. Type your request

---

## Getting Help

### In-Extension Help

```
@dr /model How do I...?
@dr /model Explain...
@dr /model What is...?
```

The Education Workflow will activate and help you learn.

### Documentation

- **Design Document**: `DESIGN.md` - Technical architecture
- **README**: `README.md` - Quick start and overview
- **DR CLI Docs**: Run `dr --help` or visit docs

### Reporting Issues

GitHub Issues: `https://github.com/anthropics/documentation-robotics/issues`

Include:

- VS Code version
- Extension version
- DR CLI version (`dr --version`)
- Error messages
- Steps to reproduce

---

## What's Next?

### Learn More

1. **DR Specification**: Understand the 11 layers

   ```
   @dr /model Explain the 11 architecture layers
   ```

2. **Link Types**: Learn about cross-layer references

   ```
   @dr /model What are the different types of cross-layer links?
   ```

3. **Advanced Validation**: Deep dive into validation

   ```
   @dr /model Explain validation levels and link validation
   ```

### Try Advanced Scenarios

- Model a complete microservices architecture
- Extract and document a legacy codebase
- Perform a security audit with compliance checks
- Migrate between spec versions
- Create custom projection rules

### Contribute

- Share your workflows
- Suggest new skills
- Report bugs and feature requests
- Contribute to prompts and workflows

---

## Appendix: Quick Reference

### Slash Commands

| Command         | Purpose                                    |
| --------------- | ------------------------------------------ |
| `/init`         | Initialize new DR project                  |
| `/model <text>` | Interactive modeling with intent detection |
| `/validate`     | Validate model with AI analysis            |
| `/ingest`       | Extract from codebase                      |
| `/project`      | Cross-layer projection                     |

### Intent Keywords

| Intent          | Keywords                                |
| --------------- | --------------------------------------- |
| VALIDATE        | check, validate, is correct, any errors |
| FIX_ERRORS      | fix errors, auto-fix                    |
| EXTRACT_CODE    | analyze code, extract, ingest           |
| GENERATE_DOCS   | generate docs, create documentation     |
| SECURITY_REVIEW | security, compliance, GDPR, SOC2        |
| MIGRATE_VERSION | migrate, upgrade version                |
| EXPLORE_IDEA    | what if, should we, compare             |
| LEARN           | how do I, which layer, explain          |
| ADD_ELEMENT     | add, create                             |
| MODEL_FEATURE   | model, design                           |

### Skill Triggers

| Skill              | Triggers                                   |
| ------------------ | ------------------------------------------ |
| Link Validation    | link, reference, 3+ adds, 2+ layers        |
| Changeset Reviewer | changeset, apply, review, active changeset |

### 11 Layers

| Layer       | Purpose                            |
| ----------- | ---------------------------------- |
| motivation  | WHY - Goals, requirements          |
| business    | WHAT - Services, processes         |
| security    | WHO CAN - Policies, roles          |
| application | HOW - Components, services         |
| technology  | WITH WHAT - Infrastructure         |
| api         | INTERFACE - Endpoints, operations  |
| data_model  | STRUCTURE - Entities, schemas      |
| datastore   | STORAGE - Databases, tables        |
| ux          | PRESENTATION - Views, components   |
| navigation  | FLOW - Routes, transitions         |
| apm         | OBSERVE - Metrics, logs, traces    |
| testing     | VERIFY - Test coverage, partitions |

---

**Happy Modeling! 🎉**

Remember: Just talk naturally to `@dr`. The skills, intent detection, and workflows will guide you to create comprehensive architecture documentation effortlessly.
