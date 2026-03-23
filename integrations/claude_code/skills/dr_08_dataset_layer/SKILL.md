---
name: LAYER_08_DATA_STORE
description: Expert knowledge for Data Store Layer modeling in Documentation Robotics
triggers:
  [
    "database",
    "collection",
    "namespace",
    "data-store",
    "NoSQL",
    "MongoDB",
    "DynamoDB",
    "document store",
    "access pattern",
    "index",
    "field"
  ]
version: 0.8.3
---

# Data Store Layer Skill

**Layer Number:** 08
**Specification:** Metadata Model Spec v0.8.3
**Purpose:** Defines paradigm-neutral physical storage modeling, capturing databases, collections/tables, fields/columns, indexes, views, stored logic, validation rules, access patterns, event handlers, and retention policies across relational, document, key-value, time-series, and graph stores.

---

## Layer Overview

The Data Store Layer captures **physical storage design** in a paradigm-neutral way:

- **DATABASES** - Database instances (any paradigm)
- **NAMESPACES** - Logical grouping of collections (schemas, keyspaces, databases)
- **COLLECTIONS** - Primary storage units (tables, collections, streams, buckets)
- **FIELDS** - Field/column definitions with types and constraints
- **INDEXES** - Query optimization indexes
- **VIEWS** - Derived or materialized views
- **STORED LOGIC** - Stored procedures, triggers, user-defined functions
- **VALIDATION RULES** - Database-level validation constraints
- **ACCESS PATTERNS** - Query access patterns for performance modeling
- **EVENT HANDLERS** - Event-driven data triggers
- **RETENTION POLICIES** - Data lifecycle and retention rules

This layer supports **multiple storage paradigms**: relational (PostgreSQL, MySQL), document (MongoDB, Firestore), key-value (Redis, DynamoDB), time-series (InfluxDB, TimescaleDB), and graph (Neo4j, Amazon Neptune).

**Central Entity:** The **Collection** (table, document collection, stream) is the core modeling unit.

> **CLI Introspection:** Run `dr schema types data-store` for the authoritative, always-current list of node types.
> Run `dr schema node <type-id>` for full attribute details on any type (e.g., `dr schema node data-store.collection`).

---

## Entity Types

### Core Data Store Entities (11 entities)

| Entity Type         | CLI Type          | Description                                                              |
| ------------------- | ----------------- | ------------------------------------------------------------------------ |
| **Database**        | `database`        | Database instance (any paradigm — relational, document, key-value, etc.) |
| **Namespace**       | `namespace`       | Logical grouping of collections (schema, keyspace, database prefix)      |
| **Collection**      | `collection`      | Primary storage unit (table, document collection, stream, bucket)        |
| **Field**           | `field`           | Field or column definition with data type and constraints                |
| **Index**           | `index`           | Query optimization index (B-tree, hash, compound, text, geospatial)      |
| **View**            | `view`            | Derived or materialized view over one or more collections                |
| **StoredLogic**     | `storedlogic`     | Stored procedures, triggers, and user-defined functions                  |
| **ValidationRule**  | `validationrule`  | Database-level validation constraint or schema enforcement rule          |
| **AccessPattern**   | `accesspattern`   | Named query access pattern (for performance and capacity planning)       |
| **EventHandler**    | `eventhandler`    | Event-driven trigger or change-data-capture handler                      |
| **RetentionPolicy** | `retentionpolicy` | Data lifecycle, TTL, and retention rule definition                       |

---

## Type Decision Tree

Use this decision tree **before assigning a type** to any storage element.

Evaluate questions top-to-bottom. Stop at the first YES match.
If none match, reconsider whether the concept belongs in a different layer.

> **storedlogic vs. eventhandler:** If the element describes _what fires and when_ (the reactive trigger mechanism), use `eventhandler`. If it describes _the computation or logic that runs_ (a function, procedure, or script), use `storedlogic`.

```
Is this a database server/instance/cluster?
  YES → data-store.database  (e.g., PostgreSQL instance, MongoDB Atlas cluster)

Is this a logical grouping of collections (schema, keyspace, database prefix)?
  YES → data-store.namespace  (e.g., PostgreSQL schema, Cassandra keyspace, MongoDB database)

Is this a primary storage unit (table, document collection, stream, bucket, topic)?
  YES → data-store.collection  (e.g., users table, orders collection, events stream)

Is this a field or column definition inside a collection?
  YES → data-store.field  (e.g., email VARCHAR, user_id UUID, created_at TIMESTAMP)

Is this a query optimization index (B-tree, hash, compound, text, vector)?
  YES → data-store.index  (e.g., idx_users_email, full-text search index)

Is this a derived or materialized view over one or more collections?
  YES → data-store.view  (e.g., active_users_view, monthly_revenue_mv)

Is this a stored procedure, function, or user-defined aggregate in the database?
  YES → data-store.storedlogic  (e.g., calculate_discount(), get_user_stats(), normalize_email())

Is this a database-level validation constraint or schema enforcement rule?
  YES → data-store.validationrule  (e.g., check constraint, JSON schema validator,
        foreign key [database-enforced referential integrity — not a cross-layer relationship])

Is this a named query access pattern describing how the application reads or writes data?
  YES → data-store.accesspattern  (e.g., get-user-by-email, list-orders-by-date, time-range-query)

Is this a CDC handler, database trigger, or event-driven data workflow?
  YES → data-store.eventhandler  (e.g., on-insert audit log, DynamoDB Streams handler)

Is this a TTL, archival, or data lifecycle rule?
  YES → data-store.retentionpolicy  (e.g., 90-day audit log TTL, GDPR deletion policy)
```

---

## When to Use This Skill

Activate when the user:

- Mentions "database", "collection", "namespace", "data-store", "NoSQL", "document store"
- Wants to define collections, fields, indexes, or access patterns
- Asks about storage design for MongoDB, DynamoDB, PostgreSQL, Redis, etc.
- Needs to model physical storage for data models (any paradigm)
- Wants to link physical storage to logical data models
- Discusses event-driven data handling or change-data-capture
- Asks about data retention, TTL policies, or lifecycle management

---

## Cross-Layer Relationships

Cross-layer links are created via `dr relate`, not inline YAML attributes. Key relationships from the spec:

**Outgoing (Data Store → Other Layers):**

| Relationship                                         | Example                                       |
| ---------------------------------------------------- | --------------------------------------------- |
| `collection.realizes.api.schema`                     | Users collection → API response schema        |
| `collection.maps-to.api.requestbody`                 | Orders collection → POST /orders body         |
| `collection.serves.api.operation`                    | Products collection → GET /products operation |
| `collection.implements.security.secureresource`      | PII collection → SecureResource policy        |
| `collection.satisfies.security.dataclassification`   | Payments collection → PCI data class          |
| `field.satisfies.security.dataclassification`        | email field → PII data classification         |
| `field.requires.security.fieldaccesscontrol`         | SSN field → FieldAccessControl rule           |
| `field.maps-to.api.parameter`                        | user_id field → API path parameter            |
| `database.satisfies.security.securitypolicy`         | DB → encryption-at-rest policy                |
| `database.depends-on.technology.systemsoftware`      | PostgreSQL DB → pg systemsoftware             |
| `retentionpolicy.satisfies.security.retentionpolicy` | Retention rule → security retention policy    |

**Incoming (Other Layers → Data Store):**

| Relationship                                           | Example                          |
| ------------------------------------------------------ | -------------------------------- |
| `application.applicationcomponent.serves → collection` | UserService → users collection   |
| `technology.systemsoftware.depends-on → database`      | PostgreSQL technology → database |

---

## Design Best Practices

1. **Paradigm-neutral modeling** — Use `collection`/`field` regardless of whether the underlying store is relational or document
2. **Access patterns first** — For NoSQL (DynamoDB, Cassandra), define `AccessPattern` entities before collections
3. **Indexes** — Add indexes for frequent query paths; use `AccessPattern` to document which index serves which pattern
4. **PII marking** — Link sensitive `field` entities to a security `dataclassification` node via `field.satisfies.security.dataclassification`; note PII status in the field `description`
5. **Retention policies** — Always add a `RetentionPolicy` for collections with regulatory or storage requirements
6. **Stored logic** — Capture stored procedures, triggers, and UDFs as `StoredLogic` entities
7. **Event handlers** — Document CDC (change-data-capture) and event-driven triggers as `EventHandler` entities
8. **Validation rules** — Add `ValidationRule` for database-level constraints beyond field-level type enforcement

---

## Common Commands

```bash
# Add a database instance
dr add data-store database "users-db"

# Add a namespace (schema or keyspace)
dr add data-store namespace "public" --description "Default database namespace"

# Add a collection (table or document collection)
dr add data-store collection "users" --description "User records collection"

# Add a field to a collection
dr add data-store field "email" --description "User email address"

# Add an index
dr add data-store index "idx-users-email" --description "Index on email field"

# Add an access pattern (for NoSQL capacity planning)
dr add data-store accesspattern "get-user-by-email" --description "Point lookup by email"

# List collections
dr list data-store --type collection

# Validate data-store layer
dr validate --layers data-store

# Introspect available types
dr schema types data-store
```

---

## Example: Users Collection (Paradigm-Neutral)

```yaml
# Collection — use collectionType to specify the paradigm-specific storage unit
id: data-store.collection.users
name: "Users Collection"
type: collection
description: "User account records — relational table (PostgreSQL)"
properties:
  collectionType: TABLE
  partitionKey: "id"
  validationSchema: data-model.object-schema.user
```

```yaml
# Fields are separate data-store.field elements — not nested inside the collection
id: data-store.field.users-id
name: "Users ID"
type: field
description: "Primary key"
properties:
  dataType: uuid
  nullable: false
  fieldRole: PARTITION_KEY

id: data-store.field.users-email
name: "Users Email"
type: field
description: "User email address — PII"
properties:
  dataType: string
  nullable: false

id: data-store.field.users-created-at
name: "Users Created At"
type: field
properties:
  dataType: timestamp
  nullable: false
```

### Access Pattern

```yaml
id: data-store.accesspattern.get-user-by-email
name: "Get User by Email"
type: accesspattern
description: "Point lookup by email — used for login and profile fetch"
properties:
  patternType: POINT_READ
  targetCollection: data-store.collection.users
  keyCondition: "email"
  consistencyRequirement: STRONG
  expectedFrequency: HIGH_THROUGHPUT
```

### Retention Policy

```yaml
id: data-store.retentionpolicy.audit-log-retention
name: "Audit Log Retention"
type: retentionpolicy
description: "365-day retention for regulatory compliance (SOC2, GDPR Article 30)"
properties:
  targetCollection: data-store.collection.users-audit-log
  retentionDuration: "P365D"
  action: ARCHIVE
  enabled: true
```

---

## Pitfalls to Avoid

- ❌ Using SQL-only concepts (Table, Column, Constraint) — use paradigm-neutral `collection`, `field`, `validationrule`
- ❌ Skipping `AccessPattern` for NoSQL stores (DynamoDB, Cassandra) — define access patterns first
- ❌ Nesting fields inline inside a collection element — `field` entities are always separate elements linked via `collection.composes.field`
- ❌ Using invented `x-pii`, `x-json-schema`, or `x-apm-performance-metrics` attributes — these are not in the spec; use relationships (`field.satisfies.security.dataclassification`, `collection.realizes.api.schema`) instead
- ❌ Using `ttlDays` / `archiveAfterDays` in retentionpolicy — use `retentionDuration` (ISO 8601, e.g. `"P365D"`) and `action` (enum: DELETE | ARCHIVE | ...)
- ❌ Forgetting `RetentionPolicy` for regulated data
- ❌ Not documenting `EventHandler` for CDC or change-triggered workflows

---

## Coverage Completeness Checklist

Before declaring data-store layer extraction complete, verify each type was considered:

- [ ] **database** — Database instance (any paradigm: relational, document, key-value, time-series, graph)
- [ ] **namespace** — Logical grouping of collections (PostgreSQL schema, Cassandra keyspace, MongoDB database)
- [ ] **collection** — Primary storage unit (table, document collection, stream, bucket)
- [ ] **field** — Field or column definition with data type and constraints
- [ ] **index** — Query optimization index (B-tree, hash, compound, text, geospatial, vector)
- [ ] **view** — Derived or materialized view over one or more collections
- [ ] **storedlogic** — Stored procedures, functions, and user-defined aggregates
- [ ] **validationrule** — Database-level validation constraint or schema enforcement rule
- [ ] **accesspattern** — Named query access pattern (especially required for NoSQL: DynamoDB, Cassandra, MongoDB)
- [ ] **eventhandler** — Event-driven trigger or change-data-capture handler
- [ ] **retentionpolicy** — Data lifecycle, TTL, and retention rule definition

If any type has ZERO elements, explicitly decide:
"This type doesn't apply to this codebase" with reasoning.

> **Note:** `accesspattern` is strongly recommended for any NoSQL store (DynamoDB, Cassandra, Firestore) — NoSQL schema design is driven by access patterns.
> `retentionpolicy` is strongly recommended for any collection subject to regulatory requirements (GDPR, SOC2, HIPAA).
