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
    "field",
  ]
version: 0.8.1
---

# Data Store Layer Skill

**Layer Number:** 08
**Specification:** Metadata Model Spec v0.8.1
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

**Outgoing (Data Store → Other Layers):**

- `x-json-schema` → Data Model Layer (what logical schema does this implement?)
- `x-governed-by-*` → Security Layer (data access policies)
- `x-apm-performance-metrics` → APM Layer (query performance monitoring)

**Incoming (Other Layers → Data Store):**

- Data Model Layer → Data Store (physical storage mapping)
- Application Layer → Data Store (database connections)
- Technology Layer → Data Store (hosting infrastructure)

---

## Design Best Practices

1. **Paradigm-neutral modeling** — Use `collection`/`field` regardless of whether the underlying store is relational or document
2. **Access patterns first** — For NoSQL (DynamoDB, Cassandra), define `AccessPattern` entities before collections
3. **Indexes** — Add indexes for frequent query paths; use `AccessPattern` to document which index serves which pattern
4. **PII marking** — Use `x-pii` on `field` entities to mark sensitive data
5. **Retention policies** — Always add a `RetentionPolicy` for collections with regulatory or storage requirements
6. **Stored logic** — Capture stored procedures, triggers, and UDFs as `StoredLogic` entities
7. **Event handlers** — Document CDC (change-data-capture) and event-driven triggers as `EventHandler` entities
8. **Validation rules** — Add `ValidationRule` for database-level constraints beyond field-level type enforcement

---

## Common Commands

```bash
# Add a database instance
dr add data-store database --name "users-db"

# Add a namespace (schema or keyspace)
dr add data-store namespace --name "public" --property parentDatabase=data-store.database.users-db

# Add a collection (table or document collection)
dr add data-store collection --name "users" --property parentNamespace=data-store.namespace.public

# Add a field to a collection
dr add data-store field --name "email" --property dataType=string --property nullable=false

# Add an index
dr add data-store index --name "idx-users-email" --property fields='["email"]' --property unique=true

# Add an access pattern (for NoSQL capacity planning)
dr add data-store accesspattern --name "get-user-by-email" --property queryType=point-lookup

# List collections
dr list data-store collection

# Validate data-store layer
dr validate --layer data-store

# Introspect available types
dr schema types data-store
```

---

## Example: Users Collection (Paradigm-Neutral)

```yaml
id: data-store.collection.users
name: "Users Collection"
type: collection
properties:
  parentNamespace: data-store.namespace.public
  paradigm: relational # or: document, key-value, time-series, graph
  fields:
    - id:
        dataType: uuid
        nullable: false
        primaryKey: true
    - email:
        dataType: string
        nullable: false
        x-pii: true
        x-encrypted: true
    - username:
        dataType: string
        nullable: false
    - created_at:
        dataType: timestamp
        nullable: false
  x-json-schema: data-model.object-schema.user
  x-apm-performance-metrics:
    - apm.metric.users-query-latency
```

### Access Pattern (for DynamoDB/NoSQL)

```yaml
id: data-store.accesspattern.get-user-by-email
name: "Get User by Email"
type: accesspattern
properties:
  collection: data-store.collection.users
  queryType: point-lookup
  keyAttributes: ["email"]
  consistencyLevel: strong
  estimatedRps: 500
```

### Retention Policy

```yaml
id: data-store.retentionpolicy.users-audit-log
name: "Users Audit Log Retention"
type: retentionpolicy
properties:
  collection: data-store.collection.users-audit-log
  ttlDays: 365
  archiveAfterDays: 90
  regulatoryBasis: "SOC2, GDPR Article 30"
```

---

## Pitfalls to Avoid

- ❌ Using SQL-only concepts (Table, Column, Constraint) — use paradigm-neutral `collection`, `field`, `validationrule`
- ❌ Skipping `AccessPattern` for NoSQL stores (DynamoDB, Cassandra) — define access patterns first
- ❌ Not marking PII fields with `x-pii`
- ❌ Missing cross-layer links to data model layer (`x-json-schema`)
- ❌ Forgetting `RetentionPolicy` for regulated data
- ❌ Not documenting `EventHandler` for CDC or change-triggered workflows
