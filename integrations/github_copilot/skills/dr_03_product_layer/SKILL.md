---
name: LAYER_03_PRODUCT
description: Expert knowledge for Product Layer modeling in Documentation Robotics
triggers:
  [
    "product",
    "feature",
    "persona",
    "capability",
    "milestone",
    "user workflow",
    "product roadmap",
    "product planning",
    "product management"
  ]
version: 0.8.4
---

# Product Layer Skill

**Layer Number:** 03
**Specification:** Metadata Model Spec v0.8.4
**Purpose:** Defines product personas, capabilities, features, user workflows, and milestones that represent what the product does and for whom.

---

## Layer Overview

The Product Layer captures the **product management dimension** of architecture:

- **WHO** - Personas and target user archetypes
- **WHAT** - Capabilities and features the product delivers
- **HOW** - User workflows describing how users accomplish goals
- **WHEN** - Milestones representing delivery roadmap
- **WHY** - Linkage to business goals and requirements

This layer uses a **custom specification** designed for product planning, prioritization, and user-centric modeling — distinct from Business layer (organization-internal processes) and UX layer (UI/interface design).

**Key Innovation:** Bridges strategic intent (Motivation layer) and organizational structure (Business layer) with externally-facing product value planning and delivery.

---

## Entity Types

> **CLI Introspection:** Run `dr schema types product` for the authoritative, always-current list of node types.
> Run `dr schema node <type-id>` for full attribute details on any type.

| Entity Type      | Description                                                | Key Attributes                                                                                        |
| ---------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Persona**      | User archetype with shared goals, behaviors, pain points   | category (primary, secondary, served, negative), proficiency (novice, intermediate, advanced, expert) |
| **Capability**   | Product ability independent of implementation              | status (proposed, planned, developing, delivered, deprecated), properties                             |
| **Feature**      | User-visible unit of functionality delivering capabilities | priority (critical, high, medium, low, informational), status, size (xs, s, m, l, xl)                 |
| **UserWorkflow** | Sequence of user-facing steps to accomplish a goal         | complexity (simple, moderate, complex), properties                                                    |
| **Milestone**    | Time-bound delivery target grouping features/capabilities  | status (proposed, planned, active, completed, cancelled)                                              |

---

## Intra-Layer Relationships

The Product layer models product structure and planning via these core relationships:

| Source                 | Predicate       | Destination          | Cardinality  | Rationale                                      |
| ---------------------- | --------------- | -------------------- | ------------ | ---------------------------------------------- |
| `product.capability`   | `aggregates`    | `product.capability` | many-to-many | Capability decomposition into sub-capabilities |
| `product.feature`      | `realizes`      | `product.capability` | many-to-many | Feature delivers a capability                  |
| `product.feature`      | `serves`        | `product.persona`    | many-to-many | Feature targets a persona                      |
| `product.feature`      | `scheduled-for` | `product.milestone`  | many-to-many | Feature assigned to delivery milestone         |
| `product.capability`   | `scheduled-for` | `product.milestone`  | many-to-many | Capability assigned to milestone               |
| `product.userworkflow` | `serves`        | `product.persona`    | many-to-many | Workflow designed for a persona                |
| `product.userworkflow` | `composes`      | `product.feature`    | many-to-many | Workflow composed of features                  |
| `product.milestone`    | `precedes`      | `product.milestone`  | many-to-many | Milestone sequencing                           |
| `product.feature`      | `depends-on`    | `product.feature`    | many-to-many | Feature dependency                             |

---

## Cross-Layer References

### Outgoing References (Product → Motivation)

Product layer references Motivation layer to justify product decisions with strategic goals:

| Predicate        | Source       | Target      | Rationale                                    |
| ---------------- | ------------ | ----------- | -------------------------------------------- |
| `realizes`       | Persona      | Stakeholder | Persona concretizes stakeholder archetypes   |
| `satisfies`      | Feature      | Requirement | Feature satisfies business/user requirements |
| `supports`       | Capability   | Goal        | Capability supports strategic goals          |
| `delivers`       | UserWorkflow | Outcome     | Workflow delivers business outcomes          |
| `delivers-value` | Feature      | Value       | Feature delivers business value              |
| `fulfills`       | Capability   | Requirement | Capability fulfills requirements             |

### Outgoing References (Product → Business)

Product layer references Business layer to align with organizational services and roles:

| Predicate    | Source       | Target           | Rationale                               |
| ------------ | ------------ | ---------------- | --------------------------------------- |
| `realizes`   | Feature      | BusinessService  | Feature realizes a business service     |
| `aggregates` | UserWorkflow | BusinessProcess  | Workflow aggregates business processes  |
| `realizes`   | Capability   | BusinessFunction | Capability realizes a business function |
| `serves`     | Persona      | BusinessRole     | Persona is served by a business role    |

### Incoming References (Lower Layers → Product)

Higher layers (Security through Testing) reference Product layer for feature-level concerns:

- Application → Feature: Application components implement features
- UX → Feature: UI views render features
- Testing → Feature: Test cases validate features
- API → Feature: API operations expose features

---

## Persona Definition

A Persona is a **user archetype** representing a class of users with shared goals, behaviors, and pain points.

**Distinction from Stakeholder (Motivation layer):**

- **Stakeholder** - Organizational relationship (internal/external/regulatory/customer)
- **Persona** - Behavioral archetype with usage patterns and proficiency levels

**Categories:**

- **Primary** - Core user the product is designed for
- **Secondary** - Important but not primary user
- **Served** - User who benefits indirectly
- **Negative** - User archetype the product explicitly doesn't serve

**Proficiency Levels:**

- **Novice** - First-time users, minimal technical background
- **Intermediate** - Recurring users with some experience
- **Advanced** - Power users with domain expertise
- **Expert** - Specialists who push product limits

---

## Capability Definition

A Capability is an **ability the product possesses**, independent of how it's implemented.

**Distinction from BusinessFunction (Business layer):**

- **BusinessFunction** - Internal organizational grouping of behavior
- **Capability** - Externally-facing product ability

**Lifecycle Statuses:**

- **Proposed** - Idea under evaluation
- **Planned** - Scheduled for development
- **Developing** - Currently being built
- **Delivered** - Implemented and released
- **Deprecated** - No longer supported

---

## Feature Definition

A Feature is a **user-visible unit of functionality** that delivers one or more capabilities and is the primary unit of product planning.

**Distinction from Requirement (Motivation layer):**

- **Requirement** - What system _must_ do (functional/non-functional/regulatory)
- **Feature** - Planned unit of value with prioritization, sizing, and lifecycle

**Priority Levels:**

- **Critical** - Product cannot function without it
- **High** - Core functionality users expect
- **Medium** - Valuable enhancement
- **Low** - Nice-to-have optimization
- **Informational** - Documentation or informational

**Sizing Estimates:**

- **XS** - < 1 day of effort
- **S** - 1–3 days
- **M** - 1–2 weeks
- **L** - 2–4 weeks
- **XL** - > 4 weeks

---

## User Workflow Definition

A UserWorkflow is a **sequence of user-facing steps** through the product to accomplish a goal.

**Complexity Assessment:**

- **Simple** - Linear flow, 2–3 steps, minimal decision points
- **Moderate** - Multiple branches, 5–10 steps, some conditional logic
- **Complex** - Many decision points, 10+ steps, cross-system integration

---

## Milestone Definition

A Milestone is a **time-bound delivery target** grouping features or capabilities.

**Lifecycle Statuses:**

- **Proposed** - Candidate milestone under evaluation
- **Planned** - Scheduled for planning and estimation
- **Active** - Development underway
- **Completed** - Released to users
- **Cancelled** - Postponed or deprioritized

---

## Best Practices

1. **Start with Personas, End with Workflows** - Understand users first, model journeys last
2. **Features Deliver Capabilities** - Every feature should map to at least one capability
3. **Capabilities Support Goals** - Link capabilities to motivation layer goals for justification
4. **Milestones Sequence Logically** - Plan dependencies and prerequisites
5. **Workflows are User-Centric** - Name them from the user's perspective
6. **Prioritization Reflects Business Value** - Higher priority features deliver more strategic value
7. **Link to Business Layer** - Map features to business services to show value realization

---

## Quick Reference

**Add Commands:**

```bash
dr add product persona <name>
dr add product capability <name>
dr add product feature <name>
dr add product user-workflow <name>
dr add product milestone <name>
```

**Relationship Commands:**

```bash
dr relationship add <source> <destination> --predicate <predicate>
```

**Available Predicates:**

- `aggregates` - Capability decomposes into sub-capability
- `realizes` - Feature/Capability realizes capability/service/function
- `serves` - Feature/Workflow/Persona serves persona/role
- `scheduled-for` - Feature/Capability scheduled for milestone
- `composes` - Workflow composed of features
- `depends-on` - Feature depends on feature
- `precedes` - Milestone precedes milestone
- `satisfies` - Feature satisfies requirement
- `supports` - Capability supports goal
- `delivers` - Workflow delivers outcome
- `delivers-value` - Feature delivers value
- `fulfills` - Capability fulfills requirement
