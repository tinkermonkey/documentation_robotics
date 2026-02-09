# Layer 10: Navigation Layer

**Standard**: [SPA Navigation Patterns](https://www.w3.org/TR/navigation-timing-2/)

---

## Overview

This layer defines **26** node types that represent various aspects of the architecture.

## Node Types

### RouteType

**ID**: `navigation.routetype`

RouteType element in Navigation Layer

### GuardAction

**ID**: `navigation.guardaction`

Action when guard denies access

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `action`: string (required)
- `target`: string (required)
- `message`: string (required)
- `preserveRoute`: boolean (required)

### NavigationTransition

**ID**: `navigation.navigationtransition`

Transition from one route to another

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `from`: string (required)
- `to`: string (required)
- `trigger`: string (required)
- `description`: string
- `guards`: array
  - Contains relationship

### FlowAnalytics

**ID**: `navigation.flowanalytics`

Analytics for funnel tracking (Gap #9: Funnel analytics)

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `funnelMetrics`: string (required)
- `conversionGoal`: string (required)
- `dropoffAlerts`: string

### HttpMethod

**ID**: `navigation.httpmethod`

HttpMethod element in Navigation Layer

### NavigationTrigger

**ID**: `navigation.navigationtrigger`

NavigationTrigger element in Navigation Layer

### GuardType

**ID**: `navigation.guardtype`

GuardType element in Navigation Layer

### BreadcrumbMode

**ID**: `navigation.breadcrumbmode`

BreadcrumbMode element in Navigation Layer

### FlowStep

**ID**: `navigation.flowstep`

One step in a navigation flow

**Attributes**:

- `id`: string (uuid) (required)
- `sequence`: integer (required)
- `route`: string (required)
- `name`: string (required)
- `description`: string
- `required`: boolean

### ProcessTracking

**ID**: `navigation.processtracking`

Tracks business process instance across flow (Gap #3: Process correlation)

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `processInstanceId`: string (required)
- `resumable`: boolean
- `timeoutMinutes`: integer (required)
- `stateCheckpoint`: boolean (required)

### StorageType

**ID**: `navigation.storagetype`

StorageType element in Navigation Layer

### GuardActionType

**ID**: `navigation.guardactiontype`

GuardActionType element in Navigation Layer

### NavigationFlow

**ID**: `navigation.navigationflow`

Sequence of routes that realizes a business process

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `description`: string
- `steps`: array
  - Contains relationship
- `source`: object
  - Source code reference

### NotificationType

**ID**: `navigation.notificationtype`

NotificationType element in Navigation Layer

### NotificationAction

**ID**: `navigation.notificationaction`

Notification to send during flow step

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)
- `template`: string (required)
- `recipients`: string (required)

### ContextScope

**ID**: `navigation.contextscope`

ContextScope element in Navigation Layer

### RouteMeta

**ID**: `navigation.routemeta`

Route metadata

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `requiresAuth`: boolean
- `roles`: string (required)
- `permissions`: string (required)
- `layout`: string (required)
- `breadcrumb`: string
- `keepAlive`: boolean (required)
- `transition`: string (required)

### Route

**ID**: `navigation.route`

Single route/destination in the application (channel-agnostic)

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `title`: string
- `description`: string
- `type`: string (required)
- `source`: object
  - Source code reference

### TruncationType

**ID**: `navigation.truncationtype`

TruncationType element in Navigation Layer

### ContextVariable

**ID**: `navigation.contextvariable`

Shared variable across flow steps (Gap #1: Cross-experience state)

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `schemaRef`: string (required)
- `scope`: string (required)
- `persistedIn`: string (required)
- `defaultValue`: string

### NavigationGraph

**ID**: `navigation.navigationgraph`

Complete navigation structure for application

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `version`: string (required)
- `application`: string (required)
- `description`: string
- `routes`: array
  - Contains relationship
- `transitions`: array
  - Contains relationship
- `guards`: array
  - Contains relationship

### GuardCondition

**ID**: `navigation.guardcondition`

Condition expression for guard

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `expression`: string (required)
- `async`: boolean
- `timeout`: integer (required)

### NavigationGuard

**ID**: `navigation.navigationguard`

Guard condition for route access

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)
- `description`: string
- `order`: integer (required)
- `source`: object
  - Source code reference

### WaitType

**ID**: `navigation.waittype`

WaitType element in Navigation Layer

### BreadcrumbConfig

**ID**: `navigation.breadcrumbconfig`

Configuration for breadcrumb navigation display, specifying path generation rules, separator styles, truncation behavior, and home link settings. Provides users with location context and navigation history.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `label`: string (required)
- `labelTemplate`: string
- `showHome`: boolean
- `homeLabel`: string
- `homeRoute`: string

### DataMapping

**ID**: `navigation.datamapping`

Maps data between flow context and experience (Gap #2: Data handoff)

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `source`: string (required)
- `target`: string (required)
- `transform`: string (required)
- `required`: boolean

## References

- [SPA Navigation Patterns](https://www.w3.org/TR/navigation-timing-2/)
