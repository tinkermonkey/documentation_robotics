---
description: Analyze an existing codebase and automatically generate a Documentation Robotics architecture model
argument-hint: "<path> [--layers <layers>] [--tech <technology>] [--recipe | --targeted]"
---

# Extract Architecture Model from Codebase

Analyze an existing codebase and automatically generate a Documentation Robotics architecture model.

## What This Command Does

1. Analyzes code structure (files, directories, imports)
2. Identifies architectural elements (services, components, APIs, data)
3. Creates corresponding DR model elements across specified layers
4. Establishes cross-layer references
5. Validates the extracted model
6. Provides extraction report with confidence scores

## Two Modes: Recipe vs. Targeted

**Recipe Mode** (default for new/empty models): Extracts all 12 layers in a prescribed bottom-up order with validation checkpoints between each layer. Best for building a complete model from scratch — ensures no layers are skipped and lower layers (infrastructure, data) are populated before higher layers (business, motivation) are inferred.

**Targeted Mode** (default if `--layers` is specified or model has existing elements): Extracts specific layers without step-by-step checkpoints. Best for focused extraction or incremental additions to an existing model.

## Usage

```
/dr-map <path> [--layers <layers>] [--tech <technology>]
```

## Agent Grounding: Verification Against Live Codebase

If a CodePrism session is active, the extraction agent can verify proposed elements against the live semantic graph before proposing them to the model. This section describes that workflow.

### Orientation: Start with Repository Understanding

When a session is active, before analyzing any code files, the agent should gather orientation information:

```bash
# Understand repository structure and technology hints
dr scan session query repository_stats --format text

# Detect architectural patterns in the codebase
dr scan session query detect_patterns --format text
```

**What to do with this information:**

From `repository_stats`, the agent learns:
- Primary and secondary languages
- Detected frameworks and libraries
- Code organization (package structure, top modules)
- Module count and estimated complexity

From `detect_patterns`, the agent learns:
- Architectural style (MVC, microservices, layering, etc.)
- Design patterns used (singleton, factory, builder, etc.)
- Framework-specific patterns (Spring @Configuration, NestJS @Module, etc.)
- Suggested layer focus for extraction

**Use this to focus extraction strategy:**
- If TypeScript + NestJS detected → expect @Injectable services, @Controller endpoints, @Entity models
- If Python + FastAPI detected → expect @app decorators, Pydantic models, SQLAlchemy ORM
- If Java + Spring detected → expect @Service, @RestController, @Entity annotations

### Element Verification: The CodePrism Grounding Loop

For each proposed element, the agent should verify it exists before emitting a `dr add` command:

**Loop for each candidate element:**

```
1. Agent identifies candidate: "OrderService class at src/services/OrderService.ts"

2. Verify with explain_symbol:
   dr scan session query explain_symbol \
     --params '{"symbol":"OrderService","language":"typescript"}'

3. CodePrism response confirms or contradicts:
   ✓ Type matches (it's a class, not interface)
   ✓ Location matches (src/services/OrderService.ts)
   ✓ Additional info: decorators, methods, dependencies

4. Agent populates source_reference with confirmed location:
   --source-file "src/services/OrderService.ts" \
   --source-symbol "OrderService" \
   --source-provenance extracted

5. Agent discovers cross-layer dependencies:
   dr scan session query find_dependencies \
     --params '{"symbol":"OrderService","language":"typescript",'type':'all'}'

6. CodePrism returns dependency graph → agent wires cross-layer references

7. Emit: dr add <layer> <type> <name> \
     --source-file ... \
     --source-symbol ... \
     --source-provenance extracted
```

**When CodePrism contradicts inference:**

If CodePrism reveals the element doesn't exist or is different than expected:

```
Agent inference: OrderService is a class in src/services/OrderService.ts

CodePrism says: No symbol "OrderService" at that location.

Agent investigates:
  → Query: dr scan session query search_code \
     --params '{"pattern":"class.*OrderService","language":"typescript"}'
  → CodePrism reveals: Found at src/order/service.ts (different location)
  → Agent re-evaluates: Is this the same element or a different one?
  → Corrects location and retries explain_symbol
  → Or: Revises candidate and tries again
```

Agents must investigate rather than blindly proposing when CodePrism disagrees.

### Graceful Degradation: No Session Available

If no CodePrism session is active, extraction proceeds with **static code analysis only**:

```bash
$ dr map ./src

...
Note: CodePrism session not active.
Source references will be inferred from static analysis.
For more accurate element verification, start a session first:
  dr scan session start

Proceeding with static analysis extraction...
```

**Extraction behavior when degraded:**

- Agent uses **regex and pattern matching** to identify candidates (no semantic analysis)
- All elements must still include `--source-file` when possible
- Source provenance: Use `inferred` instead of `extracted` for elements not semantically confirmed
- Cross-layer references: Inferred from type names and usage patterns, not confirmed dependencies
- Model will validate successfully but confidence will be lower

**Example degraded extraction:**

```bash
# Static regex found a class matching "Service" pattern
dr add application service "Order Service" \
  --description "Service class for order operations (inferred from static analysis)" \
  --source-file "src/services/OrderService.ts" \
  --source-symbol "OrderService" \
  --source-provenance inferred  # Not confirmed by CodePrism
```

---

## Instructions for Claude Code

This command launches a specialized model extraction agent to analyze code and generate the architecture model. Follow this workflow:

### Step 1: Validate Prerequisites

Check that a DR model exists:

```bash
ls -la documentation-robotics/model/manifest.yaml 2>/dev/null
```

If no model exists:

- Inform user: "No DR model found. Initialize one first?"
- Offer to run: `/dr-init <project-name>`
- Wait for model creation before continuing

Also check if the model is empty (no elements yet) and no `--layers` flag was provided:

```bash
dr list motivation --json 2>/dev/null
```

If model has 0 elements and no `--layers` flag: offer **Recipe Mode** vs. **Targeted Mode**.

```
I see this is a new model with no existing elements.

I can extract in two ways:

1. Recipe Mode (recommended) — Walks through all 12 layers in the correct
   architectural order, with checkpoints to review and validate each layer
   before proceeding. Takes longer but produces a complete, well-structured model.

2. Targeted Mode — Extract specific layers only.
   Which layers would you like? (e.g., application, api, data-model)

Which would you prefer?
```

If user selects Recipe Mode: follow the **Recipe Mode Workflow** section below.
If user selects Targeted Mode or `--layers` is specified: continue to Step 2.

---

### Recipe Mode Workflow

In recipe mode, extract all layers in the prescribed bottom-up order. The ordering ensures infrastructure and data layers are populated before business and motivation layers are inferred from them. Each layer is extracted, validated, and reviewed before proceeding to the next.

**Prescribed Extraction Order:**

| Order | Layer           | What to Detect                                                                                 |
| ----- | --------------- | ---------------------------------------------------------------------------------------------- |
| 1     | Technology (5)  | Frameworks, platforms, infra deps (package.json, requirements.txt, Dockerfiles, K8s manifests) |
| 2     | Data Store (8)  | DB schemas, tables, migrations (.sql files, migration scripts, ORM table configs)              |
| 3     | Data Model (7)  | Entity classes, JSON schemas, type defs (ORM models, Pydantic, TypeScript interfaces)          |
| 4     | Application (4) | Services, components, orchestrators (@Service classes, business logic modules)                 |
| 5     | API (6)         | REST endpoints, OpenAPI specs, route handlers (@route decorators, router files)                |
| 6     | UX (9)          | UI components, screens, forms — skip automatically if no frontend detected                     |
| 7     | Navigation (10) | Routing, menu structures — skip automatically if no frontend detected                          |
| 8     | APM (11)        | Monitoring instrumentation, metrics, spans (OpenTelemetry, Datadog, custom metrics)            |
| 9     | Testing (12)    | Test files, strategies, coverage patterns (_.test._, _.spec._, test directories)               |
| 10    | Business (2)    | Infer from application services + domain naming patterns                                       |
| 11    | Security (3)    | Auth patterns, RBAC, middleware (auth middleware, policy files, permission decorators)         |
| 12    | Motivation (1)  | Infer from README, docs/, comments, OKR references                                             |

**Prerequisite checks before specific layers:**

- **Before API (6)**: If Application layer has no services yet, warn: "API operations typically expose application services. Proceeding without application services may result in incomplete cross-layer references."
- **Before Business (2)**: If Application layer has fewer than 3 services, warn: "Business services are inferred from application services. Consider adding more application services first for better coverage."
- **Before Motivation (1)**: Scan README.md and docs/ before extracting — "Checking README.md and docs/ for goals, principles, and requirements..."

**Between-layer checkpoint (repeat after each layer):**

After extracting each layer:

1. **Wire intra-layer relationships** for elements just created in this layer:
   - Run `dr relationship add` for element pairs within this layer that are semantically connected
   - Use shared `source_file` as the primary signal for high-confidence pairs
   - Only attempt relationship schema combinations that are valid per `dr schema relationship <type>`
   - Aim to wire at least the highest-confidence pairs before moving on

2. **Wire cross-layer references to already-populated lower layers** (if applicable):
   - If a just-extracted element references a type that already exists in a lower layer, wire it now
   - Example: when extracting API layer, wire `api.operation →[references]→ application.applicationservice` for elements already in the Application layer
   - This eliminates a significant portion of the inter-layer pass in `/dr-relate`

3. **Pause and display checkpoint:**

```
Checkpoint: [Layer Name] Layer Complete
==========================================
Extracted N elements:
  - [element-id-1] (from [source-file:line])
  - [element-id-2] (from [source-file:line])
  ...

Validation: ✓ Passed
  — or —
⚠ N warnings, M errors: [brief description]

What would you like to do?
  [c] Continue to next layer ([Next Layer Name])
  [a] Add a missing element (describe it and I'll create it)
  [s] Skip to a specific layer
  [r] Re-extract this layer with different parameters
  [q] Finish here (model saved, resume later with /dr-map)
```

**After completing all layers:**

```
Recipe Extraction Complete!
============================
[layer list with element counts and status]

Total: N elements across M layers

Final validation:
  dr validate --strict

Connectivity:
  Run: dr validate --orphans
  This shows elements still needing relationships, grouped by layer with
  suggested predicates. Orphans remaining after /dr-map are best handled
  by running /dr-relate --orphans rather than a full /dr-relate pass.

Next steps:
  - Review flagged low-confidence elements
  - Use /dr-model to fill gaps manually
  - Use /dr-sync when code changes arrive
  - Use /dr-design to speculate on new features
```

---

### Step 2: Gather Information

**Required:**

- **Path**: Directory to analyze (provided by user or current directory)

**Optional:**

- **Layers**: Which layers to extract (default: business, application, api, data-model)
- **Technology**: Tech stack hints (e.g., "Python FastAPI", "Node.js Express", "Java Spring")

**Examples:**

```
/dr-map ./src
/dr-map ./src/api --layers application,api
/dr-map ./backend --tech "Python FastAPI PostgreSQL"
```

If user didn't specify layers or tech, ask:

```
I'll analyze the codebase at ./src

Quick questions:
1. Which layers should I extract?
   - All relevant (recommended)
   - Specific layers: business, application, api, data-model, etc.

2. Technology stack (optional, helps with analysis):
   - Auto-detect
   - Manual: e.g., "Python FastAPI, PostgreSQL, Redis"
```

### Step 3: Preliminary Code Analysis

Before launching the full extraction agent, do a quick scan:

```bash
# Detect languages
find <path> -type f -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.java" -o -name "*.go" | head -20

# Check for common files
ls -la <path> | grep -E "(package\.json|requirements\.txt|pom\.xml|go\.mod|Cargo\.toml)"

# Look for API definitions
find <path> -type f -name "*api*" -o -name "*route*" -o -name "*controller*" | head -10

# Check for database files
find <path> -type f -name "*model*" -o -name "*schema*" -o -name "*.sql" | head -10

# Detect graph visualization libraries (React Flow, Cytoscape, D3, etc.)
grep -l "@xyflow\|react-flow\|d3\|cytoscape\|vis-network" <path>/package.json 2>/dev/null

# If React Flow detected, expand scan to include graph subsystem directories:
find <path>/src/core/nodes -type f -name "*.tsx" 2>/dev/null | head -20
find <path>/src/core/edges -type f -name "*.tsx" 2>/dev/null | head -10
find <path>/src/core/layout -type f 2>/dev/null | head -10
ls <path>/src/core/nodes/nodeConfig.json 2>/dev/null
```

Show user what you found:

```
Preliminary scan of ./src:

Detected:
✓ Language: Python (45 .py files)
✓ Framework: FastAPI (found fastapi imports)
✓ API: 8 route files detected
✓ Database: SQLAlchemy models found (12 files)
✓ Tests: npm test structure detected

[If React Flow detected, also show:]
✓ Graph Visualization: React Flow detected (@xyflow/react)
  → Will scan src/core/nodes/ for custom node types
  → Will scan src/core/edges/ for custom edge types
  → Will scan src/core/layout/ for layout engines
  → Will check for nodeConfig.json configuration registry

Estimated extraction:
- Business services: ~5
- Application services: ~8
- API operations: ~35
- Data models: ~12

This will take approximately 2-3 minutes.
Proceed with extraction?
```

### Step 3b: Capture Baseline Element Counts

**Before launching any extraction**, record the current element count per layer. This is the authoritative "before" snapshot — do this now, not inside the extraction agent, to avoid counting elements added mid-execution.

```bash
dr list --json 2>/dev/null | jq -r 'group_by(.layer) | map("\(.[0].layer): \(length)") | .[]'
```

Store the output as `BASELINE_COUNTS`. Pass it verbatim into the extraction agent's prompt so the final summary report can display accurate Before / After / Net-new columns.

---

### Step 4: Launch Extraction Agent

Use the Task tool to launch the specialized extraction agent:

````python
Task(
    subagent_type="dr-extractor",
    prompt=f"""Extract Documentation Robotics model from codebase.

**Source Path:** {path}
**Target Layers:** {layers}
**Technology:** {technology}
**Baseline Element Counts (captured before extraction):** {baseline_counts}
**CodePrism Session Active:** {"Yes" if session_is_active else "No"}

**Session Query Commands Available** (if session is active):

If a CodePrism session is active, you have access to semantic code analysis tools.
See `/dr-scan-session` command documentation for full details.

Core tools:
- \`dr scan session query repository_stats\` → Understand repo structure and frameworks
- \`dr scan session query detect_patterns\` → Discover architectural patterns
- \`dr scan session query explain_symbol\` → Verify element exists and get metadata
- \`dr scan session query find_dependencies\` → Discover cross-layer dependencies
- \`dr scan session query search_code\` → Find code matching patterns
- \`dr scan session query analyze_decorators\` → Find decorated symbols
- \`dr scan session query analyze_api_surface\` → Discover API endpoints

**Orientation Step** (only if session active):

Before analyzing code files, gather repository context:
\`\`\`bash
dr scan session query repository_stats --format text
dr scan session query detect_patterns --format text
\`\`\`

Use this information to focus your extraction strategy. For example:
- NestJS detected? Look for @Injectable services and @Controller endpoints
- FastAPI detected? Look for @app decorators and Pydantic models
- Spring detected? Look for @Service and @RestController annotations

**Per-Element Verification Loop** (only if session active):

For each proposed element, verify it exists before emitting \`dr add\`:

1. Identify candidate: "OrderService class at src/services/OrderService.ts"
2. Verify: \`dr scan session query explain_symbol --params '{"symbol":"OrderService","language":"typescript"}'\`
3. Confirm location and metadata match
4. Discover dependencies: \`dr scan session query find_dependencies --params '{"symbol":"OrderService","language":"typescript","type":"all"}'\`
5. Populate source_reference with confirmed location:
   - \`--source-file "src/services/OrderService.ts"\`
   - \`--source-symbol "OrderService"\`
   - \`--source-provenance extracted\` (confirms via CodePrism)
6. Emit: \`dr add application service "Order Service" ...\`

**When CodePrism contradicts your inference:**

If CodePrism reveals an element doesn't exist or is at a different location:
- Investigate using \`search_code\` to find the actual location
- Correct your candidate and retry
- Do not blindly propose elements CodePrism contradicts

**Graceful Degradation** (if no session is active):

If a session is NOT active, proceed with static code analysis:
- Use \`--source-provenance inferred\` instead of \`extracted\` for elements not confirmed
- Still provide \`--source-file\` and \`--source-symbol\` when possible
- Cross-layer references will be less complete (inferred from type names and usage patterns)

**Your Task:**
1. [If session active] Gather orientation information (repository_stats, detect_patterns)
2. Analyze the codebase structure
3. Identify architectural elements:
   - Services and components
   - API endpoints and operations
   - Data models and schemas
   - Database tables (if applicable)
   - Business capabilities (infer from code)

4. Create DR model elements with **mandatory source provenance**:
   - Use \`dr add\` commands for each element
   - **Always** pass \`--source-file <relative-path>\` pointing to the file the element was extracted from (relative to the repository root, e.g. \`src/services/OrderService.ts\`)
   - Pass \`--source-symbol <name>\` when the element maps to a specific class, function, or exported symbol
   - Pass \`--source-provenance extracted\` for elements verified against CodePrism (if session active); use \`inferred\` for elements reasoned from patterns or when no session is active
   - [If session active] Use the verification loop above to confirm each element
   - Establish cross-layer references (realizes, exposes, stores, etc.)
   - Set appropriate properties (criticality, descriptions, etc.)

   Source provenance is not optional metadata — it is the traceability link that makes the model useful:
   - \`/dr-sync\` uses \`source_reference\` to detect drift when code changes
   - \`dr validate\` can verify referenced files still exist
   - Without provenance, the model is a snapshot with no connection back to the code that produced it

   Example \`dr add\` invocations with provenance:
   \`\`\`bash
   # With CodePrism verification (provenance: extracted)
   dr scan session query explain_symbol --params '{"symbol":"OrderService","language":"typescript"}'
   # → Confirmed: class OrderService at src/services/OrderService.ts
   dr add application service "Order Service" \\
     --description "Handles order lifecycle" \\
     --source-file "src/services/OrderService.ts" \\
     --source-symbol "OrderService" \\
     --source-provenance extracted

   # Without CodePrism or unconfirmed (provenance: inferred)
   dr add api operation "Create Order" \\
     --description "POST /api/v1/orders" \\
     --source-file "src/routes/orders.ts" \\
     --source-symbol "createOrder" \\
     --source-provenance inferred

   # Inferred business capability
   dr add business capability "Order Management" \\
     --description "Inferred from OrderService and order routes" \\
     --source-provenance inferred
   \`\`\`

5. Validate the extracted model:
   - Run \`dr validate\` after extraction
   - Fix any obvious issues

6. Provide extraction report:
   - Elements created per layer
   - Source files referenced (list unique files)
   - Confidence scores (high/medium/low)
   - Number of elements verified via CodePrism (if session was active)
   - Warnings about uncertain mappings or missing provenance
   - Recommendations for manual review

**Analysis Guidelines:**

For Business Layer:

- Infer business services from high-level modules/packages
- Look for domain concepts in naming
- Group related functionality

For Application Layer:

- Map classes/modules to components
- Services exposed via APIs become application services
- Set criticality based on usage patterns

For API Layer:

- Extract REST/GraphQL endpoints
- Map HTTP methods to operations
- Extract request/response schemas

For Data Model Layer:

- Parse ORM models (SQLAlchemy, TypeORM, JPA, etc.)
- Extract JSON schemas if present
- Document relationships

For React Flow Applications (when `@xyflow/react` detected in package.json):

- Scan `src/core/nodes/` or similar for custom node components → `ux.librarycomponent` (type: graph-node)
- Look for a unified/shared node component that is configuration-driven → single `ux.librarycomponent` entry (do NOT create one per node type)
- Scan `src/core/edges/` for custom edge types → `ux.librarycomponent` (type: graph-edge)
- Scan `src/core/layout/engines/` for LayoutEngine class implementations → `application.applicationcomponent` (type: internal)
- Look for standalone layout utility files (e.g., `verticalLayerLayout.ts`) → `application.applicationfunction`
- Check for `nodeConfig.json` or similar configuration registry → `data-model.objectschema`

**Output Format:**

Provide a detailed report:

```

# Extraction Complete

Summary:

- Business services: X created
- Application services: Y created
- API operations: Z created
- Data models: N created

Details by Layer:
[... detailed breakdown ...]

Confidence Assessment:

- High confidence: X% of elements
- Medium confidence: Y% of elements
- Low confidence: Z% of elements

Validation Results:
[... validation output ...]

Recommendations:

1. Review low-confidence mappings
2. Add business goal references
3. Consider adding security policies
   [... more recommendations ...]

```

**Important:**

- Create realistic, meaningful descriptions
- Use proper kebab-case for IDs
- **Every `dr add` call must include `--source-file` and `--source-provenance`** — elements without provenance are untraceable and will fail the `source_files_exist` assertion in the test suite
- Establish cross-layer references where clear
- Flag uncertain mappings for review
- Run validation and fix obvious errors
  """
  )

````

### Step 5: Process Agent Results

When the agent completes, read the current element counts (the "after" state) and display the report. Use `BASELINE_COUNTS` (captured in Step 3b) for the Before column — do NOT re-derive it from within the agent's output, which may reflect an intermediate state.

```bash
dr list --json 2>/dev/null | jq -r 'group_by(.layer) | map("\(.[0].layer): \(length)") | .[]'
````

```

# Extraction Complete

Created Elements (Before → After, Net-new):
├─ Business Layer:      N → M  (+X services)
├─ Application Layer:   N → M  (+X services, +Y components)
├─ API Layer:           N → M  (+X operations)
└─ Data Model Layer:    N → M  (+X schemas)

Cross-Layer References:
✓ 8 realizes references (app → business)
✓ 35 exposes references (app → api)
✓ 12 stores references (data-store → data model)

Connectivity Check:
Run: dr validate --orphans
[show orphan count and top 3 layers with most orphans]

Validation: ⚠️ 2 warnings, 0 errors

Confidence:
✓ High: 85% (very confident in these mappings)
⚠ Medium: 12% (review recommended)
❌ Low: 3% (manual review needed)

Files Modified:

- documentation-robotics/model/02_business/services.yaml (3 elements)
- documentation-robotics/model/04_application/services.yaml (8 elements)
- documentation-robotics/model/04_application/components.yaml (3 elements)
- documentation-robotics/model/06_api/operations.yaml (25 elements)
- documentation-robotics/model/07_data-model/schemas.yaml (12 elements)

```

### Step 6: Validation & Review

After extraction, run validation:

```bash
dr validate --strict
```

Present results and ask user to review:

```
Validation Results
==================

✓ Schema validation passed
⚠ 2 semantic warnings:

1. application.service.order-service
   Warning: No security policy assigned
   Recommendation: Add authentication

2. application.service.payment-service
   Warning: Critical service not monitored
   Recommendation: Add APM metrics

Next Steps:
1. Review extracted elements:
   - Check element descriptions
   - Verify cross-layer references
   - Adjust criticality levels

2. Add missing metadata:
   /dr-model Add security policies to services
   /dr-model Add monitoring to critical services

3. Enhance traceability:
   /dr-model Link services to business goals

Would you like me to address the warnings automatically?
```

### Step 7: Post-Extraction Enhancements

Offer to enhance the extracted model:

**Option 1: Add Security**

```
I noticed several services without security policies.
Would you like me to add authentication schemes?

Options:
- OAuth2 for external APIs
- JWT for internal services
- Basic auth for admin endpoints
```

**Option 2: Add Monitoring**

```
Critical services should have monitoring.
Should I add standard APM metrics?

- Availability (99.9% SLO)
- Latency (P95 < 200ms)
- Error rate (< 1%)
```

**Option 3: Add Business Goals**

```
I extracted technical elements but couldn't infer business goals.
Would you like to:
- Manually add goals: /dr-model Add goals
- Skip for now
```

## Analysis Patterns by Technology

### Python FastAPI

**Look for:**

- `@app.get/post/put/delete` decorators → API operations
- `class Model(Base)` → Data models (SQLAlchemy)
- `class Service` → Application services
- `pydantic.BaseModel` → Request/response schemas

**Example extraction:**

```python
# In routes/orders.py
@app.post("/api/v1/orders")
def create_order(order: OrderCreate):
    return order_service.create(order)

# Extracts to:
# - api.operation.create-order (path: /api/v1/orders, method: POST)
# - application.service.order-service (if referenced)
# - data-model.objectschema.order-create (from Pydantic model)
```

### Node.js Express

**Look for:**

- `router.get/post/put/delete()` → API operations
- `class Service` or exported functions → Application services
- `mongoose.Schema` or TypeORM entities → Data models
- `export interface` → Type definitions

**Example extraction:**

```typescript
// In routes/orders.ts
router.post('/api/v1/orders', async (req, res) => {
  const order = await OrderService.create(req.body);
  res.json(order);
});

// Extracts to:
# - api.operation.create-order
# - application.service.order-service
```

### Java Spring Boot

**Look for:**

- `@RestController` classes → Application services + API operations
- `@Service` classes → Application services
- `@Entity` classes → Data models
- `@Table` annotations → Database tables

**Example extraction:**

```java
@RestController
@RequestMapping("/api/v1/orders")
public class OrderController {
    @PostMapping
    public Order createOrder(@RequestBody OrderRequest request) {
        return orderService.create(request);
    }
}

// Extracts to:
# - api.operation.create-order
# - application.service.order-controller
# - data-model.objectschema.order-request
```

## Handling Edge Cases

### Large Codebases (>100 files)

```
This is a large codebase (500+ files).

Options:
1. Extract all (may take 5-10 minutes)
2. Extract specific directories:
   - ./src/api → API layer only
   - ./src/services → Application layer
   - ./src/models → Data model layer
3. Extract incrementally (one layer at a time)

Which approach?
```

### Monorepo

```
Detected monorepo structure:

packages/
├── api/
├── web/
├── mobile/
└── shared/

Should I:
1. Extract entire monorepo
2. Extract specific package(s)
3. Create separate models per package
```

### Missing Information

```
Extraction complete with gaps:

Could not determine:
❌ Business capabilities (no clear domain structure)
❌ Service criticality (no indicators found)
❌ Security requirements (no auth code found)

Recommendations:
1. Manually add business services: /dr-model
2. Review and set criticality levels
3. Add security policies for public endpoints
```

### Conflicting Patterns

```
Found conflicting patterns:

Issue: Multiple services named "OrderService"
- src/api/orders/service.py (REST API)
- src/jobs/order_processor.py (Background job)
- src/admin/order_admin.py (Admin interface)

Created as:
- application.service.order-api
- application.service.order-processor
- application.service.order-admin

Please review and adjust if needed.
```

## Error Handling

### Error: Path not found

```
Error: Directory ./src not found

Please check the path and try again:
/dr-map <correct-path>
```

### Error: No code files found

```
Warning: No recognizable code files found in ./src

Supported languages:
- Python (.py)
- JavaScript/TypeScript (.js, .ts)
- Java (.java)
- Go (.go)
- C# (.cs)

Is this the correct directory?
```

### Error: Extraction failed

```
Error: Extraction agent encountered an error

Last successful step: Analyzed 45 files
Issue: [error details]

Options:
1. Retry extraction
2. Extract specific layer only
3. Manual extraction with /dr-model
```

## Example Interactions

### Example 1: Simple Extraction

```
User: /dr-map ./src/api

You:
Scanning ./src/api...

Found:
- Python FastAPI application
- 8 route files
- 25 endpoints
- 12 Pydantic models

Launching extraction agent...

[Agent runs...]

✓ Extraction complete!

Created:
- 8 application services
- 25 API operations
- 12 data models

Validation: ✓ Passed

Next: Review documentation-robotics/model/04_application/ and documentation-robotics/model/06_api/
```

### Example 2: With Technology Hints

```
User: /dr-map ./backend --tech "Python FastAPI PostgreSQL"

You:
Analyzing Python FastAPI application...

Using technology hints:
✓ FastAPI patterns recognized
✓ PostgreSQL schema extraction enabled
✓ SQLAlchemy ORM detection active

Extraction progress:
[Progress indicator]

✓ Complete!

Created full model with:
- Business services (inferred)
- Application services (from code)
- API operations (from routes)
- Data models (from ORM)
- Database tables (from migrations)
```

### Example 3: Incremental Extraction

```
User: /dr-map ./src --layers api

You:
Extracting API layer only...

Found 45 HTTP endpoints.

Creating elements:
✓ api.operation.create-user
✓ api.operation.get-user
✓ api.operation.update-user
[... 42 more ...]

✓ Complete! Created 45 API operations.

Next steps:
- Extract application layer: /dr-map ./src --layers application
- Link to business: /dr-model Add business services
```

## Related Commands

- `/dr-init` - Initialize new model first
- `/dr-model` - Manually add/adjust elements
- `/dr-sync` - Update model when code changes arrive (PR sync, branch diff)
- `/dr-design` - Speculate on new features before implementation
- `/dr-validate` - Validate extracted model
- `dr search` - Query extracted elements
