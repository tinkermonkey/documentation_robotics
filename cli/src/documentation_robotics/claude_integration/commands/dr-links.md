---
description: Use natural language to query, validate, and document cross-layer references in the architecture model
argument-hint: "<natural language request>"
---

# Cross-Layer Link Management

Use natural language to query, validate, and document cross-layer references (links) in the architecture model.

## What This Command Does

Interprets natural language requests for link management operations:

- Query and explore available link types
- Discover link instances in the model
- Validate cross-layer references
- Generate link documentation
- Trace paths between elements
- Find related elements via links

## Usage

```
/dr-links <natural language request>
```

## Instructions for Claude Code

When the user runs this command, interpret their intent and execute the appropriate link management operations. Always:

1. **Understand Intent**: Determine what link operation they need
2. **Check Context**: Verify model state and active changeset
3. **Execute**: Run appropriate `dr links` or `dr validate --validate-links` commands
4. **Present Results**: Format output clearly with insights
5. **Guide Next Steps**: Suggest follow-up actions or fixes

### Critical Decision Points

#### When to Use Link Validation

**VALIDATE LINKS when:**

- User asks to "validate", "check links", or "verify references"
- Before applying a changeset
- After bulk model changes
- Before exporting specifications
- When preparing for review or deployment
- After model extraction or migration

**DON'T validate links when:**

- Doing quick exploratory work in a changeset
- User explicitly says "skip validation"
- During rapid prototyping phase

#### When to Query Link Types

**QUERY LINK TYPES when:**

- User asks "what links can I use?"
- User is unsure about valid reference patterns
- Building new cross-layer relationships
- Documenting available integration patterns
- Learning the specification

#### When to Generate Link Documentation

**GENERATE DOCS when:**

- User requests documentation
- Creating project onboarding materials
- Preparing architecture review artifacts
- Building reference guides
- Exporting model documentation

### Supported Operations

#### 1. List and Query Link Types

**User intent patterns:**

- "What link types are available?"
- "How do I link API to Application layer?"
- "Show me security link patterns"
- "What links can I use between [layer-a] and [layer-b]?"

**Your process:**

```bash
# List all link types
dr links types

# Filter by category
dr links types --category motivation
dr links types --category security
dr links types --category api

# Filter by source layer
dr links types --from application
dr links types --from navigation

# Filter by target layer
dr links types --to motivation
dr links types --to business

# Get JSON output for parsing
dr links types --json
```

**Example:**

````
User: /dr-links How do I link my API operations to application services?

You should:
1. Query relevant link types:
   dr links types --from api --to application
2. Format results clearly:
   "Link types from API → Application:

   📋 application-service-ref
      Field: x-archimate-ref (in x-extensions)
      Cardinality: Single (one application service per operation)
      Format: UUID
      Description: Links API operation to implementing ApplicationService
      Example: x-archimate-ref: 'application.service.order-api'

   You can use this in your OpenAPI operation definitions by adding:
   ```yaml
   paths:
     /orders:
       post:
         operationId: createOrder
         x-archimate-ref: application.service.order-api
   ```"
````

#### 2. Display Link Registry

**User intent patterns:**

- "Show the complete link registry"
- "Export link registry"
- "I need a reference of all links"

**Your process:**

```bash
# Display registry as table
dr links registry

# Export as JSON
dr links registry --format json --output links.json

# Export as Markdown
dr links registry --format markdown --output links.md

# Get registry stats
dr links stats
```

**Example:**

```
User: /dr-links Show me the link registry

You should:
1. Display registry:
   dr links registry
2. Also show stats for context:
   dr links stats
3. Format output:
   "Cross-Layer Link Registry

   Total Link Types: 62
   Categories: 9 (motivation, business, security, application, api, data, ux, navigation, apm)
   Pattern Types: 4 (x-extensions, dot-notation, nested objects, direct fields)

   [Display formatted table of link types]

   For detailed reference: dr links registry --format markdown --output link-reference.md"
```

#### 3. Validate Cross-Layer Links

**User intent patterns:**

- "Validate the links in my model"
- "Check for broken references"
- "Are my cross-layer links correct?"
- "Validate with strict link checking"

**Your process:**

```bash
# Basic link validation
dr validate --validate-links

# Strict validation (warnings become errors)
dr validate --validate-links --strict-links

# Get JSON output
dr validate --validate-links --format json --output validation-report.json
```

**Example:**

```
User: /dr-links Check if all my links are valid

You should:
1. Run validation:
   dr validate --validate-links
2. Parse and present results:

   If valid:
   "✓ Link Validation Passed

   Summary:
   - 47 links validated
   - 0 broken links
   - 0 type mismatches
   - 0 cardinality errors

   All cross-layer references are valid!"

   If issues found:
   "✗ Link Validation Found Issues

   Errors (3):
   1. business.service.order-mgmt
      → motivation.supports-goals references non-existent 'motivation.goal.missing'
      Suggestion: Did you mean 'motivation.goal.improve-efficiency'?

   2. api.operation.create-order
      → x-archimate-ref expects UUID, got 'app-service-123' (invalid format)

   3. navigation.route.checkout
      → experience expects single value, got array [ux.view.cart, ux.view.payment]

   Warnings (2):
   1. application.service.payment-api has no link to motivation layer
      Consider adding motivation.supports-goals for traceability

   2. Unused link type 'x-deprecated-link' found in api.operation.old-endpoint

   Next steps:
   1. Fix errors: Edit element files to correct references
   2. Re-validate: dr validate --validate-links
   3. Optional: Run dr links find <element-id> to see all links"
```

#### 4. Find Links for Specific Element

**User intent patterns:**

- "What links does [element] have?"
- "Show me all references to [element]"
- "Find links for business.service.orders"
- "What references this element?"

**Your process:**

```bash
# Find links for specific element (incoming and outgoing)
dr links find business.service.orders

# Find only outgoing links
dr links find business.service.orders --direction outgoing

# Find only incoming links
dr links find business.service.orders --direction incoming

# Get JSON output
dr links find business.service.orders --json
```

**Example:**

```
User: /dr-links What links does business.service.order-management have?

You should:
1. Query links:
   dr links find business.service.order-management
2. Format clearly with categories:
   "Links for business.service.order-management

   Outgoing Links (3):
   → motivation.goal.improve-conversion (via motivation.supports-goals)
   → motivation.principle.api-first (via motivation.governed-by-principles)
   → apm.metric.order-processing-time (via apm.business-metrics)

   Incoming Links (2):
   ← application.service.order-api (via realizes)
   ← navigation.flow.checkout-flow (via realizesProcess)

   Total: 5 links

   Use 'dr links trace' to find paths between elements"
```

#### 5. Trace Paths Between Elements

**User intent patterns:**

- "Find path from [element-a] to [element-b]"
- "How are [element-a] and [element-b] connected?"
- "Trace from implementation to goals"
- "Show impact of [element]"

**Your process:**

```bash
# Find shortest path
dr links trace api.operation.create-order motivation.goal.revenue

# Find all paths (up to depth N)
dr links trace api.operation.create-order motivation.goal.revenue --all-paths --max-depth 5

# Trace impact (downstream)
dr links trace motivation.goal.revenue --direction downstream --max-depth 3
```

**Example:**

```
User: /dr-links How is api.operation.create-order connected to our business goals?

You should:
1. Run trace:
   dr links trace api.operation.create-order motivation.goal.improve-revenue --all-paths
2. Display paths clearly:
   "Tracing paths from api.operation.create-order to motivation.goal.improve-revenue

   Path 1 (shortest - 3 hops):
   api.operation.create-order
     → application.service.order-api (via x-archimate-ref)
     → business.service.order-management (via realizes)
     → motivation.goal.improve-revenue (via motivation.supports-goals)

   Path 2 (4 hops):
   api.operation.create-order
     → ux.view.checkout (via usedBy)
     → navigation.route.checkout (via route)
     → business.process.order-checkout (via realizesProcess)
     → motivation.goal.improve-revenue (via motivation.supports-goals)

   This operation has strong traceability to business goals!"
```

#### 6. List All Link Instances

**User intent patterns:**

- "List all links in the model"
- "Show me all [link-type] links"
- "Find all broken links"
- "Export link instances"

**Your process:**

```bash
# List all links
dr links list

# Filter by link type
dr links list --type motivation.supports-goals

# Filter by layer
dr links list --layer application

# Show only broken links
dr links list --broken-only

# Export as CSV
dr links list --format csv --output links.csv
```

**Example:**

```
User: /dr-links Show me all links to motivation layer

You should:
1. Query links:
   dr links list --target-layer motivation
2. Format results:
   "Links targeting Motivation Layer (18 total):

   Supports Goals (12):
   - business.service.order-mgmt → motivation.goal.improve-efficiency
   - business.service.payment → motivation.goal.increase-revenue
   - application.service.checkout-api → motivation.goal.improve-ux
   ... and 9 more

   Fulfills Requirements (4):
   - application.service.auth → motivation.requirement.secure-access
   - api.operation.login → motivation.requirement.mfa-support
   ... and 2 more

   Governed By Principles (2):
   - application.service.order-api → motivation.principle.api-first
   - business.service.customer-svc → motivation.principle.customer-centric

   Good traceability to motivation layer!"
```

#### 7. Generate Link Documentation

**User intent patterns:**

- "Generate link documentation"
- "Create a link reference guide"
- "Export link docs for review"
- "Create link diagram"

**Your process:**

```bash
# Generate Markdown summary
dr links docs --format markdown --output ./docs/links-summary.md

# Generate detailed reference
dr links docs --format markdown --detail full --output ./docs/links-reference.md

# Generate interactive HTML
dr links docs --format html --output ./docs/links.html

# Generate Mermaid diagram
dr links docs --format mermaid --output ./docs/link-diagram.mmd

# Generate all formats
dr links docs --format all --output ./docs/
```

**Example:**

```
User: /dr-links Create documentation for all links in the model

You should:
1. Generate comprehensive docs:
   dr links docs --format markdown --detail full --output ./documentation-robotics/specs/docs/link-reference.md
   dr links docs --format mermaid --output ./documentation-robotics/specs/diagrams/link-diagram.mmd
2. Confirm:
   "✓ Generated Link Documentation

   Created:
   - ./documentation-robotics/specs/docs/link-reference.md (Complete reference)
   - ./documentation-robotics/specs/diagrams/link-diagram.mmd (Visual diagram)

   The documentation includes:
   - Complete link type catalog (62 types)
   - Link instances in your model
   - Layer connectivity diagram
   - Usage examples for each pattern
   - Cross-layer traceability matrix

   Open link-reference.md to review"
```

#### 8. Get Link Statistics

**User intent patterns:**

- "Link statistics"
- "How many links are in the model?"
- "Show link coverage"
- "Which layers are most connected?"

**Your process:**

```bash
# Get comprehensive stats
dr links stats

# Get JSON for parsing
dr links stats --json
```

**Example:**

```
User: /dr-links Show me link statistics

You should:
1. Run stats:
   dr links stats
2. Format with insights:
   "Cross-Layer Link Statistics

   Registry:
   - Total link types: 62
   - Categories: 9
   - Pattern types: 4

   Model:
   - Total link instances: 127
   - Broken links: 0
   - Layers with links: 9/11
   - Average links per element: 3.2

   Top Connected Layers:
   1. Application → 42 links (33%)
   2. Business → 28 links (22%)
   3. API → 23 links (18%)

   Most Used Link Types:
   1. motivation.supports-goals (24 instances)
   2. realizes (18 instances)
   3. x-archimate-ref (15 instances)

   Insights:
   ✓ Strong traceability to motivation layer (24 links)
   ✓ No broken links
   ⚠ UX and Navigation layers have fewer links - consider adding more integration"
```

### Migration from v0.1.x to v0.2.0

When users have existing models that need migration to standardized link patterns:

**User intent patterns:**

- "Migrate my links"
- "Upgrade to v0.2.0"
- "Fix link naming conventions"
- "Standardize my references"

**Your process:**

```bash
# 1. Check what needs migration
dr migrate

# 2. Preview changes
dr migrate --dry-run

# 3. Apply migration
dr migrate --apply

# 4. Validate result
dr validate --validate-links
```

**Example:**

```
User: /dr-links My model uses old link patterns, help me migrate

You should:
1. Check migration needs:
   dr migrate
2. Show what will change:
   dr migrate --dry-run
3. Explain:
   "Migration from v0.1.1 to v0.2.0 Required

   Found 15 links that need updating:

   Naming Conventions (8):
   - supportGoals → supports-goals (camelCase → kebab-case)
   - realizesService → realizes-services (singular → plural)

   Cardinality Fixes (5):
   - motivation.supports-goals: single value → array
   - security.required-permissions: single value → array

   Format Fixes (2):
   - api.operation.create-order: x-archimate-ref invalid format

   These will be fixed automatically.
   Run 'dr migrate --apply' to apply (preview first)?"
4. If user confirms:
   dr migrate --apply
5. Validate:
   dr validate --validate-links
6. Confirm:
   "✓ Migration Complete

   Updated 15 links across 8 files
   ✓ All links now valid
   ✓ Model upgraded to v0.2.0

   Next: git diff to review changes, then commit"
```

### Integration with Validation

Link validation is integrated with the main validation flow:

```bash
# Standard validation + link validation
dr validate --validate-links

# Strict mode (warnings → errors)
dr validate --validate-links --strict-links

# Validate specific layer
dr validate --layer application --validate-links
```

**Guide users:**

- "Always validate links before applying changesets"
- "Use --strict-links in CI/CD for highest quality"
- "Link validation catches broken references, type mismatches, and format errors"

### Error Handling and Troubleshooting

**Common issues:**

1. **Broken reference (target doesn't exist):**

   ```
   Error: application.service.orders
   → motivation.supports-goals references 'motivation.goal.missing' (not found)

   Fix options:
   1. Create the missing goal:
      dr add motivation goal --name "Missing Goal"
   2. Remove the reference:
      dr update application.service.orders --remove motivation.supports-goals
   3. Fix the typo:
      dr links find --suggest motivation.goal.missing
   ```

2. **Type mismatch:**

   ```
   Error: api.operation.create-order
   → x-archimate-ref expects ApplicationService, got BusinessService

   Fix: Reference the correct application service:
   x-archimate-ref: application.service.order-api (not business.service.orders)
   ```

3. **Cardinality error:**

   ```
   Error: business.service.orders
   → motivation.supports-goals expects array, got single string

   Fix: Change to array format:
   motivation:
     supports-goals: ["motivation.goal.revenue"]  # Array, not string
   ```

4. **Format error:**

   ```
   Error: api.operation.create-order
   → x-archimate-ref expects UUID format, got 'app-service-123'

   Fix: Use proper element ID:
   x-archimate-ref: application.service.order-api
   ```

### Best Practices

1. **Validate early and often**
   - Run link validation during development
   - Integrate into CI/CD pipeline
   - Validate before applying changesets

2. **Use proper link patterns**
   - Query link types before creating references
   - Follow naming conventions (kebab-case, plurals)
   - Use appropriate pattern (x-extensions, dot-notation, etc.)

3. **Maintain traceability**
   - Link implementation to motivation layer
   - Use `dr links trace` to verify end-to-end paths
   - Document link rationale in descriptions

4. **Generate documentation**
   - Keep link reference docs up to date
   - Create diagrams for stakeholders
   - Export link matrices for reviews

5. **Monitor link health**
   - Check statistics regularly
   - Identify orphaned elements
   - Ensure balanced connectivity across layers

### Quick Reference

```bash
# Query and explore
dr links types                          # All link types
dr links types --from api --to application  # Filtered
dr links registry                       # Full registry
dr links stats                          # Statistics

# Validation
dr validate --validate-links            # Validate all links
dr validate --validate-links --strict-links  # Strict mode

# Discovery
dr links find business.service.orders   # Links for element
dr links list --target-layer motivation # All links to layer
dr links trace elem-a elem-b            # Path between elements

# Documentation
dr links docs --format markdown --output ./docs/  # Generate docs
dr links docs --format mermaid --output diagram.mmd  # Diagram

# Migration
dr migrate                              # Check needs
dr migrate --dry-run                    # Preview changes
dr migrate --apply                      # Apply migration
```

### Python API for Advanced Operations

```python
from documentation_robotics.core import Model
from documentation_robotics.validation.link_registry import LinkRegistry
from documentation_robotics.validation.link_analyzer import LinkAnalyzer
from documentation_robotics.validation.link_validator import LinkValidator

# Load model
model = Model.load("./")

# Load link registry
registry = LinkRegistry()
print(f"Total link types: {len(registry.get_all_link_types())}")

# Analyze links in model
analyzer = LinkAnalyzer(model, registry)
links = analyzer.discover_all_links()
print(f"Found {len(links)} link instances")

# Build link graph
graph = analyzer.build_link_graph()
print(f"Nodes: {graph.number_of_nodes()}, Edges: {graph.number_of_edges()}")

# Find path between elements
path = analyzer.find_path(
    "api.operation.create-order",
    "motivation.goal.revenue"
)
if path:
    print(f"Path: {' → '.join(path)}")

# Validate links
validator = LinkValidator(model, registry)
issues = validator.validate_all()

for issue in issues.errors:
    print(f"Error: {issue.element_id} - {issue.message}")
    if issue.suggestion:
        print(f"  Suggestion: {issue.suggestion}")
```

### Integration with Other DR Commands

Link management integrates seamlessly with other commands:

- **dr add/update**: Automatically validates links when `--validate-links` is used
- **dr validate**: Includes link validation with `--validate-links` flag
- **dr export**: Uses link information for traceability matrices
- **dr changeset**: Link validation works in changeset context
- **dr project**: Projection can create links between layers

**Guide users on workflow:**

```
1. Model changes → dr changeset create "feature"
2. Add elements → dr add/update
3. Validate links → dr validate --validate-links
4. Review links → dr links find <element-id>
5. Apply changes → dr changeset apply --yes
```
