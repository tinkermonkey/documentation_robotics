---
description: Link architecture elements to source code for bidirectional traceability and impact analysis
argument-hint: "<operation>"
---

# Source File Tracking

Link architecture elements to their source code implementation for bidirectional traceability, impact analysis, and automated synchronization.

## What This Command Does

Source file tracking creates explicit links between DR architecture elements and their implementation in source code:

- **Bidirectional Navigation**: Jump from element to code, code to element
- **Impact Analysis**: Know which elements are affected by code changes
- **Automated Sync**: Tools can update model when code changes
- **Team Communication**: Developers see architectural decisions in implementation
- **Code Review Context**: Reviewers understand architectural intent
- **Documentation**: Generate docs with code examples

## Usage

Source tracking is integrated into existing commands:

```bash
# Add element with source reference
dr add <layer> <type> <id> --name "Name" \
  --source-file "path/to/file" \
  --source-symbol "SymbolName" \
  --source-provenance "extracted|manual|inferred|generated"

# Update element to add/change source reference
dr update <element-id> \
  --source-file "path/to/file" \
  --source-symbol "SymbolName" \
  --source-provenance "manual"

# Search elements by source file
dr search --source-file "path/to/file"

# Show element with source details
dr show <element-id>

# Clear source reference
dr update <element-id> --clear-source-reference
```

## Instructions for Claude Code

### When to Use Source Tracking

**ALWAYS use during:**

- ✅ Code extraction/analysis
- ✅ Documenting existing systems
- ✅ Creating elements from code
- ✅ After code refactoring

**RECOMMENDED for:**

- ✅ Manual element creation (when code exists)
- ✅ Updating elements after code changes

**NOT needed for:**

- ❌ Pure architectural concepts (no implementation)
- ❌ Future work placeholders
- ❌ Abstract patterns

### Source Reference Components

#### Required Fields

**`--source-file`**: Path to source file (relative to repository root)

- Use **relative paths**: `src/api/orders.ts` not `/Users/me/project/src/api/orders.ts`
- From **repository root**: Not from current directory
- **Forward slashes**: Even on Windows (`src/api/orders.ts`)

**`--source-provenance`**: How the reference was created

- `extracted` - Automatically detected by parsing/analysis tools
- `manual` - Human reviewed code and linked manually
- `inferred` - Determined through heuristics/patterns
- `generated` - Created by code generation tool

#### Optional Fields

**`--source-symbol`**: Specific symbol name in the file

- Function name: `createOrder`
- Class name: `OrderService`
- Variable name: `orderSchema`
- Method name: `OrderController.create`

**`--source-repo-remote`**: Git repository URL

- Must be paired with `--source-repo-commit`
- Example: `https://github.com/myorg/myapp.git`

**`--source-repo-commit`**: Full 40-character commit SHA

- Must be paired with `--source-repo-remote`
- Example: `5a7b3c9d1e2f4a6b8c0d2e4f6a8b0c2d4e6f8a0b`

### Provenance Type Selection

**Use `extracted` when:**

- Running automated code analysis
- Using AST parsers or static analysis
- Tool automatically detects elements
- You are the extraction tool

**Use `manual` when:**

- You read the code yourself
- User tells you which file/symbol
- Adding reference after the fact
- Updating/correcting existing reference

**Use `inferred` when:**

- Matching by naming conventions
- Using heuristics (e.g., "orders.py" → "Order" entity)
- Not directly parsed but pattern-matched

**Use `generated` when:**

- Code was generated from model
- Reverse engineering from generated code
- Model-to-code transformation

### Common Patterns

#### Pattern 1: Extract API Endpoint

**Code:**

```python
# src/api/orders.py
@app.post("/api/v1/orders")
async def create_order(data: OrderCreate):
    return await order_service.create(data)
```

**Command:**

```bash
dr add api operation create-order \
  --name "Create Order" \
  --source-file "src/api/orders.py" \
  --source-symbol "create_order" \
  --source-provenance "extracted" \
  --property method="POST" \
  --property path="/api/v1/orders"
```

#### Pattern 2: Extract Service Class

**Code:**

```typescript
// src/services/order-service.ts
export class OrderService {
  async create(data: OrderData): Promise<Order> {
    // ...
  }
}
```

**Command:**

```bash
dr add application service order-service \
  --name "Order Service" \
  --source-file "src/services/order-service.ts" \
  --source-symbol "OrderService" \
  --source-provenance "extracted"
```

#### Pattern 3: Extract Data Model

**Code:**

```python
# src/models/order.py
class Order(BaseModel):
    id: UUID
    customer_id: UUID
    items: List[OrderItem]
```

**Command:**

```bash
dr add data_model object-schema order \
  --name "Order" \
  --source-file "src/models/order.py" \
  --source-symbol "Order" \
  --source-provenance "extracted"
```

#### Pattern 4: Manual Reference (No Extraction)

**User**: "Add an API endpoint for user login at /auth/login in our auth.py file"

**Command:**

```bash
dr add api operation login \
  --name "User Login" \
  --source-file "src/api/auth.py" \
  --source-symbol "login" \
  --source-provenance "manual" \
  --property method="POST" \
  --property path="/auth/login"
```

#### Pattern 5: Add Git Context

**When you have git information:**

```bash
dr add security policy auth-validation \
  --name "Authentication Validation" \
  --source-file "src/auth/validator.ts" \
  --source-symbol "validateToken" \
  --source-provenance "extracted" \
  --source-repo-remote "https://github.com/myorg/myapp.git" \
  --source-repo-commit "$(git rev-parse HEAD)"
```

### Workflow: Extraction with Source Tracking

**Step 1: Analyze codebase**

```bash
# Use grep, find, or read source files
grep -r "@app.post" src/api/
find src/services -name "*service.py"
```

**Step 2: Create changeset**

```bash
dr changeset create "extract-api-$(date +%s)"
```

**Step 3: Extract with source tracking**

```bash
# For each discovered element:
dr add api operation <id> \
  --name "<name>" \
  --source-file "<path>" \
  --source-symbol "<symbol>" \
  --source-provenance "extracted" \
  --property <key>="<value>"
```

**Step 4: Validate**

```bash
dr validate --layer api
dr validate --validate-links
```

**Step 5: Review and apply**

```bash
dr changeset diff
dr changeset apply
```

### Workflow: Update Source References

**When code is refactored:**

```bash
# Find elements referencing old file
dr search --source-file "src/old/path.ts"

# Update each element
dr update api.operation.create-order \
  --source-file "src/new/path.ts" \
  --source-provenance "manual"
```

**When symbol is renamed:**

```bash
# Update symbol only
dr update api.operation.create-order \
  --source-symbol "createOrderV2" \
  --source-provenance "manual"
```

### Searching by Source File

**Find all elements from a file:**

```bash
dr search --source-file "src/api/orders.py"
```

**With layer filter:**

```bash
dr search --source-file "src/api/orders.py" --layer api
```

**With type filter:**

```bash
dr search --source-file "src/services/order.ts" --type service
```

### Displaying Source References

**When showing element to user:**

```bash
dr show api.operation.create-order
```

**Example output:**

```
Element: api.operation.create-order
Layer:   api
Type:    operation
Name:    Create Order

Source Reference:
  File:       src/api/orders.py
  Symbol:     create_order
  Provenance: extracted
  Repository: https://github.com/myorg/myapp.git
  Commit:     5a7b3c9d1e2f4a6b8c0d2e4f6a8b0c2d4e6f8a0b
```

**Always highlight source info** when displaying elements.

### Error Handling

**Error: Missing --source-file when other options provided**

```
Error: --source-file is required when specifying source reference
```

**Fix**: Add `--source-file "path/to/file"`

**Error: Missing --source-provenance**

```
Error: --source-provenance is required when specifying source reference
```

**Fix**: Add `--source-provenance "extracted"` (or manual/inferred/generated)

**Error: Invalid provenance type**

```
Error: Invalid provenance type 'auto'. Must be: extracted, manual, inferred, generated
```

**Fix**: Use one of the valid provenance types

**Error: Repository options require both URL and commit**

```
Error: Both --source-repo-remote and --source-repo-commit are required
```

**Fix**: Provide both or neither

### Best Practices

1. **Always use relative paths from repository root**
   - ✅ `src/api/orders.py`
   - ❌ `/Users/me/project/src/api/orders.py`
   - ❌ `./src/api/orders.py`

2. **Include symbol names for precision**
   - ✅ `--source-symbol "createOrder"`
   - ⚠️ Omit only for file-level references

3. **Use correct provenance**
   - `extracted` for automated analysis
   - `manual` for human-added references

4. **Add git context when available**
   - Enables version-specific tracking
   - Use `$(git rev-parse HEAD)` for current commit

5. **Keep references updated**
   - Update when code moves
   - Update when symbols rename
   - Use `--source-provenance "manual"` for updates

6. **Batch operations in changesets**
   - Create changeset before bulk extraction
   - Review all references before applying

### Quick Reference

```bash
# Add with source tracking (minimum)
dr add <layer> <type> <id> --name "Name" \
  --source-file "path/file" \
  --source-provenance "extracted"

# Add with source tracking (complete)
dr add <layer> <type> <id> --name "Name" \
  --source-file "path/file" \
  --source-symbol "Symbol" \
  --source-provenance "extracted" \
  --source-repo-remote "https://github.com/org/repo.git" \
  --source-repo-commit "<40-char-sha>"

# Update source reference
dr update <element-id> \
  --source-file "new/path" \
  --source-provenance "manual"

# Search by source file
dr search --source-file "path/file"

# Show with source details
dr show <element-id>

# Clear source reference
dr update <element-id> --clear-source-reference
```

### Integration with Other Workflows

**With changesets:**

```bash
dr changeset create "extract-source"
# Add elements with source tracking
dr changeset apply
```

**With validation:**

```bash
# Source references don't affect validation
dr validate --strict
```

**With relationships:**

```bash
# Link elements that reference related code
dr add api operation create-order --source-file "api.py" ...
dr add application service order-svc --source-file "service.py" ...
dr update api.operation.create-order --set x-archimate-ref=application.service.order-svc
```

## Summary

Source file tracking is a **core DR capability** that you should use:

- ✅ **ALWAYS** during extraction
- ✅ **RECOMMENDED** for manual adds
- ✅ **Essential** for code-to-architecture traceability

Make it a habit to add source tracking to every element that has implementation.
