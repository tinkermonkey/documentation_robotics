# Relationships Added to Documentation Robotics Model

## Summary

This document describes the inter-layer (cross-layer) and intra-layer relationships that have been added to the Documentation Robotics model for the Todo application.

**Date**: 2025-12-28
**Model Location**: `documentation-robotics/model/`
**CLI Used**: Python CLI v0.7.3

---

## Cross-Layer Relationships (Inter-Layer Links)

Cross-layer relationships connect elements across different architectural layers, providing traceability from strategic goals down to implementation details.

### 1. Business → Motivation (supports-goals)

**File**: `documentation-robotics/model/02_business/services.yaml`

```yaml
Task Management Service:
  id: task-management
  motivation:
    supports-goals: manage-tasks
```

**Description**: The business service "Task Management Service" supports the strategic goal "Manage Personal Tasks" defined in the motivation layer.

**Relationship Type**: supports-goals (traceability category)
**Source Layer**: 02-business
**Target Layer**: 01-motivation

---

### 2. Application → Business (realizes-services)

**File**: `documentation-robotics/model/04_application/services.yaml`

```yaml
Todo API Service:
  id: todo-api-service
  business:
    realizes-services: task-management
```

**Description**: The application service "Todo API Service" realizes the business capability "Task Management Service".

**Relationship Type**: realizes (structural category)
**Source Layer**: 04-application
**Target Layer**: 02-business

---

### 3. Application → Motivation (supports-goals)

**File**: `documentation-robotics/model/04_application/services.yaml`

```yaml
Todo API Service:
  id: todo-api-service
  motivation:
    supports-goals: manage-tasks
```

**Description**: The application service directly supports the strategic goal, creating end-to-end traceability.

**Relationship Type**: supports-goals (traceability category)
**Source Layer**: 04-application
**Target Layer**: 01-motivation

---

### 4. API Operations → Application Service (archimate-ref)

**File**: `documentation-robotics/model/06_api/operations.yaml`

All four API operations now reference the application service:

```yaml
List Todos:
  id: list-todos
  x-archimate-ref: todo-api-service

Create Todo:
  id: create-todo
  x-archimate-ref: todo-api-service

Update Todo:
  id: update-todo
  x-archimate-ref: todo-api-service

Delete Todo:
  id: delete-todo
  x-archimate-ref: todo-api-service
```

**Description**: All API operations are linked to the "Todo API Service" application component, showing which service implements each endpoint.

**Relationship Type**: archimate-ref (ArchiMate reference)
**Source Layer**: 06-api
**Target Layer**: 04-application
**Count**: 4 relationships

---

### 5. Data Model → Datastore (maps-to)

**File**: `documentation-robotics/model/07_data_model/object-schemas.yaml`

```yaml
Todo Object:
  id: todo-object
  data:
    maps-to: todos-table
```

**Description**: The data model object "Todo Object" maps to the database table "todos-table", showing the persistence mapping.

**Relationship Type**: maps-to (data category)
**Source Layer**: 07-data_model
**Target Layer**: 08-datastore

---

## Intra-Layer Relationships (Same-Layer)

Intra-layer relationships connect elements within the same architectural layer.

### File: `documentation-robotics/model/relationships.yaml`

This file contains semantic relationships between elements in the same layer using the relationship taxonomy.

#### Datastore Layer: Table Composition

```yaml
# Table composes columns (composition relationships)
- source: todos-table
  predicate: composes
  target: todos-id-column
  category: structural
  layer: datastore

- source: todos-table
  predicate: composes
  target: todos-title-column
  category: structural
  layer: datastore

- source: todos-table
  predicate: composes
  target: todos-done-column
  category: structural
  layer: datastore
```

**Description**: The "Todos Table" is composed of three columns (id, title, done). This is a whole-part composition relationship where columns cannot exist without the table.

**Relationship Type**: composes / composed-of (structural category)
**Layer**: 08-datastore
**Count**: 3 relationships

---

#### Business Layer: Service Relationships

```yaml
# Business processes serve actors
- source: create-task-process
  predicate: serves
  target: end-user
  category: behavioral
  layer: business

- source: complete-task-process
  predicate: serves
  target: end-user
  category: behavioral
  layer: business
```

**Description**: Business processes "Create Task Process" and "Complete Task Process" serve the "End User" actor, showing who benefits from these processes.

**Relationship Type**: serves / served-by (behavioral category)
**Layer**: 02-business
**Count**: 2 relationships

---

## Relationship Summary Statistics

### Cross-Layer Relationships (Inter-Layer Links)

- **Total**: 10 relationships
- **Layers involved**: 6 layers (motivation, business, application, api, data_model, datastore)
- **Relationship types**: 4 unique types (supports-goals, realizes, archimate-ref, maps-to)

#### Breakdown by Type

1. **supports-goals**: 2 relationships (business→motivation, application→motivation)
2. **realizes-services**: 1 relationship (application→business)
3. **archimate-ref**: 4 relationships (api operations→application service)
4. **maps-to**: 1 relationship (data_model→datastore)

### Intra-Layer Relationships (Same-Layer)

- **Total**: 5 relationships
- **Layers involved**: 2 layers (datastore, business)
- **Relationship types**: 2 unique types (composes, serves)

#### Breakdown by Type

1. **composes**: 3 relationships (table→columns in datastore layer)
2. **serves**: 2 relationships (processes→actor in business layer)

### Grand Total

- **Total relationships added**: 15
- **Cross-layer**: 10
- **Intra-layer**: 5

---

## Relationship Categories

According to the DR Relationship Catalog v2.1.0, relationships fall into these categories:

1. **Structural** (composes, aggregates, specializes, realizes, assignment, association)
2. **Behavioral** (serves, influence, triggering, flow, access)
3. **Dependency** (uses, references, depends-on)
4. **Traceability** (supports-goals, fulfills-requirements, delivers-value, measures-outcome)
5. **Governance** (governed-by-principles, constrained-by, enforces-requirement)
6. **Data** (maps-to, references-table, derives-from)
7. **Security** (protects, authenticates, authorizes)
8. **APM** (traces, monitors, measures)
9. **UX** (renders, binds-to, navigates-to)
10. **Testing** (validates)

### Relationships Added by Category

- **Structural**: 4 (realizes, composes×3)
- **Behavioral**: 2 (serves×2)
- **Traceability**: 2 (supports-goals×2)
- **Data**: 1 (maps-to)
- **ArchiMate reference**: 4 (archimate-ref×4)

---

## Architectural Traceability Chain

The relationships create an end-to-end traceability chain:

```
Layer 01 (Motivation)
  manage-tasks (goal)
    ↑ supported-by
Layer 02 (Business)
  task-management (service)
    ↑ realized-by
Layer 04 (Application)
  todo-api-service (service)
    ↑ referenced-by
Layer 06 (API)
  list-todos, create-todo, update-todo, delete-todo (operations)
    ↓ uses (implicit)
Layer 07 (Data Model)
  todo-object (object-schema)
    ↓ maps-to
Layer 08 (Datastore)
  todos-table (table)
    ↓ composes
  todos-id-column, todos-title-column, todos-done-column (columns)
```

This chain demonstrates how:

1. Strategic goals drive business capabilities
2. Business capabilities are realized by application services
3. Application services expose API operations
4. API operations work with data models
5. Data models persist in database tables
6. Tables are composed of columns

---

## Files Modified

The following files were modified to add relationships:

### Cross-Layer Relationship Fields Added

1. `documentation-robotics/model/02_business/services.yaml`
   - Added `motivation.supports-goals` field

2. `documentation-robotics/model/04_application/services.yaml`
   - Added `business.realizes-services` field
   - Added `motivation.supports-goals` field

3. `documentation-robotics/model/06_api/operations.yaml`
   - Added `x-archimate-ref` field to all 4 operations

4. `documentation-robotics/model/07_data_model/object-schemas.yaml`
   - Added `data.maps-to` field

### Intra-Layer Relationship File Created

5. `documentation-robotics/model/relationships.yaml`
   - New file containing 5 intra-layer relationships

---

## Validation

The relationships follow the DR specification v0.6.0:

- **Cross-layer links** use the correct field paths defined in layer schemas
- **Relationship directions** follow the catalog (higher layers → lower layers)
- **Element IDs** are valid and reference existing elements
- **Relationship types** are from the official relationship catalog v2.1.0
- **Cardinality** matches the schema (single value vs arrays)

### Validation Commands

```bash
# Validate entire model
dr validate

# Validate relationships specifically
dr relationship validate

# List all links
dr links list

# Validate links
dr links validate
```

---

## Next Steps

To further enhance the model's relationship network, consider adding:

1. **Testing Layer Links**:
   - Link test cases to API operations they validate
   - Link test coverage model to application service

2. **UX Layer Links**:
   - Link UI views to navigation routes
   - Link state actions to API operations they call

3. **Technology Layer Links**:
   - Link application components to deployment platforms
   - Add "uses" relationships between components and frameworks

4. **Security Layer Links**:
   - Link security policies to protected services
   - Add authentication requirements to API operations

5. **Additional Data Relationships**:
   - Add foreign key relationships between tables
   - Link API schemas to data model schemas

---

## References

- **DR Specification**: v0.6.0
- **Relationship Catalog**: v2.1.0
- **Link Registry**: 39 link types across 11 categories
- **Schemas**: `.dr/schemas/relationship-catalog.json`
- **Documentation**: Documentation Robotics specification layers
