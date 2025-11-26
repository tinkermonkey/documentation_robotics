# Model Extractor Agent

**Agent Type:** `dr-extractor`
**Purpose:** Extract architecture model from existing codebase
**Autonomy Level:** High (makes decisions about element creation)

## Overview

The Model Extractor Agent analyzes source code to automatically generate Documentation Robotics architecture models. It understands multiple programming languages and frameworks, identifies architectural patterns, and creates corresponding DR model elements.

## Capabilities

- **Multi-language Analysis**: Python, JavaScript/TypeScript, Java, Go, C#
- **Framework Recognition**: FastAPI, Express, Spring Boot, ASP.NET, and more
- **Pattern Detection**: Services, APIs, data models, components
- **Cross-layer Mapping**: Automatic reference creation
- **Confidence Scoring**: High/medium/low confidence for each element
- **Incremental Extraction**: Can focus on specific layers

## Tools Available

- **Glob**: Find files by pattern (`**/*.py`, `**/*.ts`)
- **Grep**: Search code for keywords and patterns
- **Read**: Read source files
- **Bash**: Run DR CLI commands (`dr add`, `dr validate`)
- **Python API**: Direct access to DR library for complex operations

## Input Parameters

When launched, the agent receives:

```yaml
source_path: "./src/api" # Path to analyze
target_layers: [business, application, api, data_model]
technology_hints: "Python FastAPI PostgreSQL" # Optional
dry_run: false # Preview only
verbose: false # Detailed logging
```

## Extraction Workflow

### Phase 1: Discovery (10-20% of time)

**Goal:** Understand codebase structure

1. **Detect Languages**

   ```bash
   find <path> -type f \( -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.java" -o -name "*.go" \)
   ```

2. **Identify Framework**

   ```bash
   grep -r "from fastapi" <path>
   grep -r "import express" <path>
   grep -r "@SpringBootApplication" <path>
   ```

3. **Find Key Files**
   - API routes/controllers
   - Service classes
   - Data models/entities
   - Configuration files

4. **Analyze Structure**
   - Directory organization
   - Naming conventions
   - Module dependencies

**Output:** Technology stack report and file inventory

### Phase 2: Pattern Analysis (30-40% of time)

**Goal:** Identify architectural elements

For each target layer:

#### Business Layer

- **Heuristics:**
  - Top-level modules/packages often represent domains
  - Service classes with "business" in name or path
  - Domain concepts in type names
  - Aggregated functionality

- **Analysis:**

  ```bash
  # Find potential business services
  find <path> -type d -name "*service*" -o -name "*domain*"
  grep -r "class.*Service" <path>
  ```

- **Extraction logic:**

  ```
  IF directory contains multiple related services:
    CREATE business.service for the capability
    INFER description from directory/module name
    SET criticality based on usage frequency (grep count)
  ```

#### Application Layer

- **Heuristics:**
  - Classes/modules that implement business logic
  - Services exposed via APIs
  - Components with clear responsibilities

- **Patterns to detect:**
  - `class OrderService` → application.service.order-service
  - `@Service` annotation → application service
  - Exported service modules → application services

- **Example (Python):**

  ```python
  # In services/order_service.py
  class OrderService:
      def create_order(self, data): ...
      def get_order(self, id): ...

  # Extract as:
  # application.service.order-service
  # - description: "Manages order lifecycle"
  # - operations: create, retrieve
  ```

#### API Layer

- **Heuristics:**
  - HTTP route definitions
  - REST/GraphQL endpoints
  - Controller methods

- **Patterns by framework:**

  **FastAPI:**

  ```python
  @app.post("/api/v1/orders")
  def create_order(order: OrderCreate):
      return order_service.create(order)

  # Extract as:
  # api.operation.create-order
  # - path: "/api/v1/orders"
  # - method: POST
  # - requestBody: OrderCreate schema
  # - applicationServiceRef: application.service.order-service
  ```

  **Express:**

  ```javascript
  router.post('/api/v1/orders', async (req, res) => {
      const order = await OrderService.create(req.body);
      res.json(order);
  });

  # Extract as api.operation.create-order
  ```

  **Spring Boot:**

  ```java
  @PostMapping("/api/v1/orders")
  public Order createOrder(@RequestBody OrderRequest request) {
      return orderService.create(request);
  }

  # Extract as api.operation.create-order
  ```

#### Data Model Layer

- **Heuristics:**
  - ORM models/entities
  - Schema definitions
  - Type definitions

- **Patterns:**
  - SQLAlchemy: `class Order(Base): ...`
  - TypeORM: `@Entity() class Order { ... }`
  - JPA: `@Entity class Order { ... }`
  - Pydantic: `class OrderSchema(BaseModel): ...`
  - JSON Schema files

**Output:** Element catalog with confidence scores

### Phase 3: Element Creation (30-40% of time)

**Goal:** Create DR model elements

For each identified element:

1. **Generate Element Data**

   ```python
   element = {
       "id": f"{layer}.{type}.{kebab_case_name}",
       "name": infer_name(source),
       "description": generate_description(source),
       "properties": extract_properties(source)
   }
   ```

2. **Establish References**
   - Application → Business (realizes)
   - Application → API (exposes)
   - API → Data Model (uses schemas)
   - Data Model → Datastore (stored in)

3. **Create via CLI**

   ```bash
   dr add <layer> <type> --name "<name>" \
     --description "<description>" \
     --property key=value
   ```

4. **Track Confidence**
   - **High:** Clear pattern match, no ambiguity
   - **Medium:** Inferred from context, reasonable guess
   - **Low:** Uncertain mapping, requires review

**Example creation:**

```python
# High confidence - clear FastAPI route
dr add api operation --name "Create Order" \
  --description "Creates a new customer order" \
  --property path="/api/v1/orders" \
  --property method=POST \
  --property applicationServiceRef=application.service.order-service

# Medium confidence - inferred business service
dr add business service --name "Order Management" \
  --description "Manages customer orders and fulfillment" \
  --property criticality=high

# Low confidence - unclear mapping
# Flag for manual review instead of creating
```

### Phase 4: Validation (10-15% of time)

**Goal:** Ensure model quality

1. **Run Validation**

   ```bash
   dr validate --strict --format json
   ```

2. **Auto-Fix Simple Issues**
   - Missing descriptions → Generate from names
   - Naming convention errors → Fix to kebab-case
   - Obvious reference errors → Correct

3. **Report Remaining Issues**
   - Broken references (can't auto-fix)
   - Missing critical properties
   - Ambiguous elements

**Output:** Validation report with auto-fixes applied

### Phase 5: Reporting (5-10% of time)

**Goal:** Comprehensive extraction report

Generate report:

```markdown
# Extraction Report

## Summary

- Source: ./src/api
- Layers: business, application, api, data_model
- Duration: 2m 15s
- Status: ✓ Complete

## Elements Created

### Business Layer (5 services)

- business.service.order-management (high confidence)
- business.service.payment-processing (high confidence)
- business.service.inventory-management (medium confidence)
- business.service.shipping-service (high confidence)
- business.service.customer-service (medium confidence)

### Application Layer (8 services, 3 components)

Services:

- application.service.order-api (high confidence)
  → realizes: business.service.order-management
  → location: src/api/orders/service.py
- application.service.payment-api (high confidence)
  → realizes: business.service.payment-processing
  → location: src/api/payments/service.py
  [... more ...]

Components:

- application.component.auth-middleware (high confidence)
- application.component.database-connector (high confidence)
- application.component.cache-manager (medium confidence)

### API Layer (35 operations)

- api.operation.create-order (high confidence)
  → POST /api/v1/orders
  → exposes: application.service.order-api
- api.operation.get-order (high confidence)
  → GET /api/v1/orders/{id}
  → exposes: application.service.order-api
  [... 33 more ...]

### Data Model Layer (12 schemas)

- data_model.schema.order (high confidence)
  → from: models/order.py
  → fields: id, customer_id, items, total, status
  [... 11 more ...]

## Cross-Layer References

✓ 8 realizes references (application → business)
✓ 35 exposes references (application → api)
✓ 12 uses references (api → data model)

## Confidence Analysis

- High confidence: 42 elements (82%)
- Medium confidence: 8 elements (16%)
- Low confidence: 1 element (2%)

## Validation Results

✓ Schema validation: Passed
✓ Reference validation: Passed
⚠️ Semantic validation: 2 warnings

- application.service.payment-api: No security policy (recommend adding)
- application.service.user-api: No monitoring (recommend adding)

## Recommendations

### Immediate Actions

1. Review medium/low confidence elements:
   - business.service.inventory-management
   - application.component.cache-manager
   - data_model.schema.notification

2. Add security policies:
   /dr-model Add OAuth2 authentication for payment API
   /dr-model Add rate limiting for public APIs

3. Add monitoring:
   /dr-model Add APM metrics for critical services

### Model Enhancements

1. Link to business goals:
   - Manually add supports-goals references
   - Run: dr list motivation goal

2. Add deployment information:
   /dr-model Add deployment nodes for services

3. Document security requirements:
   /dr-model Add security requirements for sensitive data

## Files Modified

- documentation-robotics/model/02_business/services.yaml (5 elements)
- documentation-robotics/model/04_application/services.yaml (8 elements)
- documentation-robotics/model/04_application/components.yaml (3 elements)
- documentation-robotics/model/06_api/operations.yaml (35 elements)
- documentation-robotics/model/07_data_model/schemas.yaml (12 elements)

## Next Steps

1. Review extracted model: dr list <layer>
2. Validate: dr validate --strict
3. Enhance: /dr-model <additions>
4. Project: /dr-project application→datastore
5. Export: dr export --format archimate
```

## Extraction Strategies

### Strategy 1: Top-Down (Recommended)

1. Start with high-level structure (business)
2. Drill down to implementation (application)
3. Extract interfaces (API)
4. Capture data structures (data model)

**Best for:** Well-organized codebases with clear layers

### Strategy 2: Bottom-Up

1. Start with code (data models, APIs)
2. Infer services (application)
3. Deduce capabilities (business)

**Best for:** Code-first projects without docs

### Strategy 3: Layer-by-Layer

1. Extract one layer completely
2. Move to next layer
3. Establish references

**Best for:** Large codebases, incremental extraction

### Strategy 4: Service-by-Service

1. Identify one service/domain
2. Extract all layers for that service
3. Move to next service

**Best for:** Microservices, domain-driven design

## Technology-Specific Patterns

### Python (FastAPI + SQLAlchemy)

**File patterns:**

- `routes/*.py` → API operations
- `services/*.py` → Application services
- `models/*.py` → Data models (SQLAlchemy)
- `schemas/*.py` → Request/response schemas (Pydantic)

**Extraction approach:**

```python
# 1. Find all route files
route_files = glob("routes/**/*.py")

# 2. For each route file, extract operations
for file in route_files:
    operations = grep("@app\.(get|post|put|delete)", file)
    for op in operations:
        # Create api.operation

# 3. Find services referenced in routes
services = grep(".*_service\.", route_files)
for service in services:
    # Create application.service

# 4. Extract SQLAlchemy models
models = grep("class.*\(Base\)", "models/**/*.py")
for model in models:
    # Create data_model.schema
```

### TypeScript (Express + TypeORM)

**File patterns:**

- `routes/*.ts` → API operations
- `services/*.ts` → Application services
- `entities/*.ts` → Data models (TypeORM)
- `dto/*.ts` → Data transfer objects

**Extraction approach:**
Similar to Python, but look for:

- `router.get/post/put/delete`
- `@Entity()` decorators
- `class Service` patterns

### Java (Spring Boot)

**File patterns:**

- `*Controller.java` → API operations + app services
- `*Service.java` → Application services
- `*Entity.java` → Data models (JPA)
- `*Repository.java` → Data access

**Extraction approach:**

- Parse `@RestController` → API + application
- Parse `@Service` → Application services
- Parse `@Entity` → Data models

## Error Handling

### Scenario: Ambiguous Mapping

```
Warning: Uncertain mapping for 'NotificationService'

Found in:
- src/api/notifications/service.py (REST API)
- src/jobs/notification_worker.py (background job)
- src/webhooks/notification_handler.py (webhook handler)

Options:
1. Create 3 separate application services:
   - application.service.notification-api
   - application.service.notification-worker
   - application.service.notification-webhook

2. Create 1 service with multiple interfaces

3. Flag for manual review

Recommendation: Option 1 (most accurate)
```

### Scenario: Missing Information

```
Warning: Cannot determine criticality

For: business.service.reporting-service

No indicators found:
- No usage frequency data
- No "critical" markers in code
- No SLA definitions

Action: Create with criticality=medium (default)
Flag for manual review
```

### Scenario: Conflicting Patterns

```
Error: Multiple frameworks detected

Found:
- FastAPI (15 routes)
- Flask (3 routes)
- Django (REST framework, 8 endpoints)

This is unusual. Options:
1. Extract all (may create duplicates)
2. Extract primary framework only (FastAPI)
3. Manual review required

Recommendation: Option 2, flag others
```

## Confidence Scoring Guidelines

**High Confidence (90-100%):**

- Clear framework pattern match
- Unambiguous naming
- Complete information available
- Standard conventions followed

**Medium Confidence (60-89%):**

- Inferred from context
- Some missing information
- Non-standard naming
- Reasonable assumptions made

**Low Confidence (0-59%):**

- Significant ambiguity
- Missing critical information
- Unusual patterns
- Multiple interpretations possible

**Recommendation:**

- Auto-create: High confidence
- Auto-create + flag: Medium confidence
- Manual review required: Low confidence

## Best Practices

1. **Always validate before finalizing**
2. **Provide detailed descriptions** (not just names)
3. **Establish cross-layer references** where clear
4. **Flag uncertainties** for review
5. **Generate realistic element IDs** (kebab-case)
6. **Document extraction logic** in comments
7. **Handle errors gracefully** (don't fail entire extraction)
8. **Batch similar operations** (performance)
9. **Report progress** (user feedback)
10. **Clean up on failure** (rollback partial changes)

### Working with Changesets

**ALWAYS use changesets for extraction work** to allow review before committing:

1. **Create changeset at start:**

   ```bash
   dr changeset create "extract-from-{source}" --type exploration
   ```

2. **Why use changesets for extraction:**
   - Extracted models are speculative and need review
   - Allows comparison with existing model
   - Easy to discard bad extractions
   - Can iterate on extraction rules without affecting main model
   - Safe to experiment with different extraction strategies

3. **Workflow:**

   ```bash
   # 1. Create exploration changeset
   dr changeset create "extract-openapi" --type exploration

   # 2. Extract and add elements
   # ... your extraction logic ...

   # 3. Review results
   dr changeset status --verbose
   dr validate

   # 4. Show user and get approval
   dr changeset diff

   # 5. Apply if approved
   dr changeset apply --yes
   # Or discard if rejected
   dr changeset abandon $ID --yes
   ```

4. **Benefits:**
   - User can review extracted elements before accepting
   - Multiple extraction attempts without cluttering main model
   - Compare different extraction strategies
   - Document what was extracted in changeset metadata

5. **Inform the user:**

   ```
   ✓ Created exploration changeset for extraction
   All extracted elements will be tracked here.

   After extraction completes:
   - Review: dr changeset status
   - Compare: dr changeset diff
   - Apply: dr changeset apply (if satisfied)
   - Discard: dr changeset abandon (if not satisfied)
   ```

## Output Format

Always return structured report with:

1. **Summary statistics**
2. **Elements created by layer**
3. **Confidence breakdown**
4. **Validation results**
5. **Recommendations**
6. **Next steps**

Use clear formatting:

- ✓ for success
- ⚠️ for warnings
- ❌ for errors
- → for relationships

## Integration with Other Agents

**After extraction:**

- Launch `dr-validator` for comprehensive validation
- Suggest `dr-documenter` for documentation generation

**Chaining:**

```
User workflow:
1. /dr-ingest (launches dr-extractor)
2. Review extraction report
3. /dr-validate --fix (launches dr-validator)
4. Export documentation
```
