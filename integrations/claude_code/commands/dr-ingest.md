---
description: Analyze an existing codebase and automatically generate a Documentation Robotics architecture model
argument-hint: "<path> [--layers <layers>] [--tech <technology>]"
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

## Usage

```
/dr-ingest <path> [--layers <layers>] [--tech <technology>]
```

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

### Step 2: Gather Information

**Required:**

- **Path**: Directory to analyze (provided by user or current directory)

**Optional:**

- **Layers**: Which layers to extract (default: business, application, api, data_model)
- **Technology**: Tech stack hints (e.g., "Python FastAPI", "Node.js Express", "Java Spring")

**Examples:**

```
/dr-ingest ./src
/dr-ingest ./src/api --layers application,api
/dr-ingest ./backend --tech "Python FastAPI PostgreSQL"
```

If user didn't specify layers or tech, ask:

```
I'll analyze the codebase at ./src

Quick questions:
1. Which layers should I extract?
   - All relevant (recommended)
   - Specific layers: business, application, api, data_model, etc.

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
```

Show user what you found:

```
Preliminary scan of ./src:

Detected:
✓ Language: Python (45 .py files)
✓ Framework: FastAPI (found fastapi imports)
✓ API: 8 route files detected
✓ Database: SQLAlchemy models found (12 files)
✓ Tests: pytest structure detected

Estimated extraction:
- Business services: ~5
- Application services: ~8
- API operations: ~35
- Data models: ~12

This will take approximately 2-3 minutes.
Proceed with extraction?
```

### Step 4: Launch Extraction Agent

Use the Task tool to launch the specialized extraction agent:

```python
Task(
    subagent_type="dr-extractor",
    prompt=f"""Extract Documentation Robotics model from codebase.

**Source Path:** {path}
**Target Layers:** {layers}
**Technology:** {technology}

**Your Task:**
1. Analyze the codebase structure
2. Identify architectural elements:
   - Services and components
   - API endpoints and operations
   - Data models and schemas
   - Database tables (if applicable)
   - Business capabilities (infer from code)

3. Create DR model elements:
   - Use `dr add` commands for each element
   - Establish cross-layer references (realizes, exposes, stores, etc.)
   - Set appropriate properties (criticality, descriptions, etc.)

4. Validate the extracted model:
   - Run `dr validate` after extraction
   - Fix any obvious issues

5. Provide extraction report:
   - Elements created per layer
   - Confidence scores (high/medium/low)
   - Warnings about uncertain mappings
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
- Establish cross-layer references where clear
- Flag uncertain mappings for review
- Run validation and fix obvious errors
"""
)
```

### Step 5: Process Agent Results

When the agent completes, parse and display the report:

```
Extraction Complete!
===================

Created Elements:
├─ Business Layer: 5 services
├─ Application Layer: 8 services, 3 components
├─ API Layer: 35 operations
└─ Data Model Layer: 12 schemas

Cross-Layer References:
✓ 8 realizes references (app → business)
✓ 35 exposes references (app → api)
✓ 12 stores references (datastore → data model)

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
- documentation-robotics/model/07_data_model/schemas.yaml (12 elements)
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
# - data_model.schema.order-create (from Pydantic model)
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
# - data_model.schema.order-request
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
/dr-ingest <correct-path>
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
User: /dr-ingest ./src/api

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
User: /dr-ingest ./backend --tech "Python FastAPI PostgreSQL"

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
User: /dr-ingest ./src --layers api

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
- Extract application layer: /dr-ingest ./src --layers application
- Link to business: /dr-model Add business services
```

## Related Commands

- `/dr-init` - Initialize new model first
- `/dr-model` - Manually add/adjust elements
- `/dr-project` - Project elements across layers
- `/dr-validate` - Validate extracted model
- `dr search` - Query extracted elements
