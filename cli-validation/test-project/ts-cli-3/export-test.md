# test-project

## Model Information

| Property | Value |
| -------- | ----- |
| Version | 0.1.0 |
| Created | 2026-04-08T19:50:17.177Z |
| Modified | 2026-04-09T02:07:13.740Z |

## Layer: Motivation

*Goals, requirements, drivers, and strategic outcomes of the architecture.*

### Elements (1)

| ID | Name | Type | Description |
| -- | ---- | ---- | ----------- |
| `motivation.goal.manage-tasks` | Manage Personal Tasks | goal | Allow users to manage their personal task lists |

### Element Details

#### Manage Personal Tasks (`motivation.goal.manage-tasks`)

Allow users to manage their personal task lists

**Type:** goal

### Layer Summary

- **Total Elements:** 1
- **Cross-Layer References:** 0
- **Relationships:** 0

---

## Layer: Business

*Business processes, functions, roles, and services.*

### Elements (3)

| ID | Name | Type | Description |
| -- | ---- | ---- | ----------- |
| `business.actor.end-user` | End User | actor | End user of the task management system |
| `business.businessprocess.create-task-process` | Create Task Process | process | Business process for creating tasks |
| `business.businessservice.task-management` | Task Management Service | service | Business capability for task management |

### Element Details

#### End User (`business.actor.end-user`)

End user of the task management system

**Type:** actor

#### Create Task Process (`business.businessprocess.create-task-process`)

Business process for creating tasks

**Type:** process

#### Task Management Service (`business.businessservice.task-management`)

Business capability for task management

**Type:** service

### Layer Summary

- **Total Elements:** 3
- **Cross-Layer References:** 0
- **Relationships:** 0

---

## Layer: Application

*Application components, services, and interactions.*

### Elements (1)

| ID | Name | Type | Description |
| -- | ---- | ---- | ----------- |
| `application.applicationservice.todo-api-service` | Todo API Service | service | Application service implementing task management |

### Element Details

#### Todo API Service (`application.applicationservice.todo-api-service`)

Application service implementing task management

**Type:** service

### Layer Summary

- **Total Elements:** 1
- **Cross-Layer References:** 0
- **Relationships:** 0

---

## Layer: API

*REST APIs, operations, endpoints, and API integrations.*

### Elements (4)

| ID | Name | Type | Description |
| -- | ---- | ---- | ----------- |
| `api.operation.list-todos` | List Todos | operation | List all todos |
| `api.operation.create-todo` | Create Todo | operation | Create a new todo |
| `api.operation.update-todo` | Update Todo | operation | Update an existing todo |
| `api.operation.delete-todo` | Delete Todo | operation | Delete a todo |

### Element Details

#### List Todos (`api.operation.list-todos`)

List all todos

**Type:** operation

#### Create Todo (`api.operation.create-todo`)

Create a new todo

**Type:** operation

#### Update Todo (`api.operation.update-todo`)

Update an existing todo

**Type:** operation

#### Delete Todo (`api.operation.delete-todo`)

Delete a todo

**Type:** operation

### Layer Summary

- **Total Elements:** 4
- **Cross-Layer References:** 0
- **Relationships:** 0

---

## Layer: Data Model

*Data entities, relationships, and data structure definitions.*

### Elements (1)

| ID | Name | Type | Description |
| -- | ---- | ---- | ----------- |
| `data-model.entity.todo-object` | Todo Object | entity | Todo data model object |

### Element Details

#### Todo Object (`data-model.entity.todo-object`)

Todo data model object

**Type:** entity

### Layer Summary

- **Total Elements:** 1
- **Cross-Layer References:** 0
- **Relationships:** 0

---

## Layer: Data Store

*Databases, data stores, and persistence mechanisms.*

### Elements (4)

| ID | Name | Type | Description |
| -- | ---- | ---- | ----------- |
| `data-store.column.todos-id-column` | Id Column | column | Primary key column |
| `data-store.column.todos-title-column` | Title Column | column | Title column |
| `data-store.column.todos-done-column` | Done Column | column | Done status column |
| `data-store.table.todos-table` | Todos Table | table | Database table for todos |

### Element Details

#### Id Column (`data-store.column.todos-id-column`)

Primary key column

**Type:** column

#### Title Column (`data-store.column.todos-title-column`)

Title column

**Type:** column

#### Done Column (`data-store.column.todos-done-column`)

Done status column

**Type:** column

#### Todos Table (`data-store.table.todos-table`)

Database table for todos

**Type:** table

### Layer Summary

- **Total Elements:** 4
- **Cross-Layer References:** 0
- **Relationships:** 0

---

## Architecture Summary

| Metric | Count |
| ------ | ----- |
| Total Elements | 14 |
| Cross-Layer References | 0 |
| Relationships | 0 |
