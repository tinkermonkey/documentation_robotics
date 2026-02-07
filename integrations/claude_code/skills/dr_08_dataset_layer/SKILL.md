---
name: LAYER_08_DATA_STORE
description: Expert knowledge for Data Store Layer modeling in Documentation Robotics
triggers:
  [
    "database",
    "table",
    "column",
    "SQL",
    "DDL",
    "data-store",
    "PostgreSQL",
    "MySQL",
    "index",
    "constraint",
  ]
version: 0.7.0
---

# Data Store Layer Skill

**Layer Number:** 08
**Specification:** Metadata Model Spec v0.7.0
**Purpose:** Defines physical database design using SQL DDL, specifying databases, tables, columns, indexes, constraints, and triggers.

---

## Layer Overview

The Data Store Layer captures **physical database design**:

- **DATABASES** - Database instances and schemas
- **TABLES** - Database tables with columns
- **COLUMNS** - Column definitions with types and constraints
- **INDEXES** - Query optimization indexes (BTREE, HASH, GIN, etc.)
- **CONSTRAINTS** - PRIMARY KEY, UNIQUE, FOREIGN KEY, CHECK, EXCLUSION
- **TRIGGERS** - Database triggers (BEFORE/AFTER/INSTEAD OF)
- **VIEWS** - Database views (regular and materialized)

This layer uses **SQL DDL** concepts with support for PostgreSQL, MySQL, SQLite, and other RDBMS.

**Central Entity:** The **Table** (database table) is the core modeling unit.

---

## Entity Types

### Core Data Store Entities (10 entities)

| Entity Type        | Description                                        |
| ------------------ | -------------------------------------------------- |
| **Database**       | Database instance with schemas                     |
| **DatabaseSchema** | Logical grouping of tables                         |
| **Table**          | Database table with columns and constraints        |
| **Column**         | Table column with data type and constraints        |
| **Index**          | Query optimization index                           |
| **Constraint**     | PRIMARY KEY, UNIQUE, FOREIGN KEY, CHECK, EXCLUSION |
| **Trigger**        | Database trigger with timing and events            |
| **View**           | Database view (regular or materialized)            |
| **Sequence**       | Auto-increment sequences                           |
| **Partition**      | Table partitioning configuration                   |

---

## When to Use This Skill

Activate when the user:

- Mentions "database", "table", "SQL", "DDL", "data-store"
- Wants to define tables, columns, indexes, or constraints
- Asks about database design, normalization, or performance
- Needs to model physical storage for data models
- Wants to link database tables to logical data models

---

## Cross-Layer Relationships

**Outgoing (Data Store → Other Layers):**

- `x-json-schema` → Data Model Layer (what logical schema does this implement?)
- `x-governed-by-*` → Security Layer (data access policies)
- `x-apm-performance-metrics` → APM Layer (query performance monitoring)

**Incoming (Other Layers → Data Store):**

- Data Model Layer → Data Store (x-database mapping)
- Application Layer → Data Store (database connections)
- Technology Layer → Data Store (hosting infrastructure)

---

## Design Best Practices

1. **Primary keys** - Every table should have a PRIMARY KEY
2. **Indexes** - Add indexes for frequently queried columns
3. **Foreign keys** - Use FOREIGN KEY constraints for referential integrity
4. **Data types** - Choose appropriate data types (e.g., UUID vs INTEGER)
5. **Normalization** - Follow normal forms to reduce redundancy
6. **PII marking** - Use x-pii extension to mark sensitive columns
7. **Performance** - Consider partitioning for large tables
8. **Encryption** - Use x-encrypted for sensitive data at rest

---

## Common Commands

```bash
# Add database table
dr add data-store table --name "users" --property schema=public

# Add column to table
dr add data-store column --name "email" --property dataType=VARCHAR

# List tables
dr list data-store table

# Validate data-store layer
dr validate --layer data-store

# Export as SQL DDL
dr export --layer data-store --format sql
```

---

## Example: Users Table

```yaml
id: data-store.table.users
name: "Users Table"
type: table
properties:
  schema: public
  columns:
    - id:
        dataType: UUID
        nullable: false
        defaultValue: gen_random_uuid()
    - email:
        dataType: VARCHAR(255)
        nullable: false
        x-pii: true
        x-encrypted: true
    - username:
        dataType: VARCHAR(50)
        nullable: false
    - password_hash:
        dataType: VARCHAR(255)
        nullable: false
        x-encrypted: true
    - created_at:
        dataType: TIMESTAMP
        nullable: false
        defaultValue: CURRENT_TIMESTAMP
    - last_login:
        dataType: TIMESTAMP
        nullable: true
  constraints:
    - type: PRIMARY_KEY
      columns: [id]
    - type: UNIQUE
      columns: [email]
    - type: UNIQUE
      columns: [username]
  indexes:
    - name: idx_users_email
      columns: [email]
      type: BTREE
    - name: idx_users_created_at
      columns: [created_at]
      type: BTREE
  x-json-schema: data_model.object-schema.user
  x-apm-performance-metrics:
    - apm.metric.users-query-latency
```

---

## Pitfalls to Avoid

- ❌ Missing primary keys
- ❌ Not indexing foreign keys (poor join performance)
- ❌ Using TEXT when VARCHAR(n) is appropriate
- ❌ Not marking PII columns with x-pii extension
- ❌ Missing cross-layer links to data model layer
- ❌ Ignoring database-specific features (e.g., PostgreSQL JSONB)
