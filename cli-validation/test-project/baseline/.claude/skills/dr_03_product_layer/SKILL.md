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

| Entity Type | Description | Key Attributes |
|---|---|---|
| **Persona** | User archetype with shared goals, behaviors, pain points | category (primary, secondary, served, negative), proficiency (novice, intermediate, advanced, expert) |
| **Capability** | Product ability independent of implementation | status (proposed, planned, developing, delivered, deprecated), properties |
| **Feature** | User-visible unit of functionality delivering capabilities | priority (critical, high, medium, low, informational), status, size (xs, s, m, l, xl) |
| **UserWorkflow** | Sequence of user-facing steps to accomplish a goal | complexity (simple, moderate, complex), properties |
| **Milestone** | Time-bound delivery target grouping features/capabilities | status (proposed, planned, active, completed, cancelled) |

---

## Relationships

**Intra-Layer (Product ↔ Product):**

- Capability → Capability (aggregates)
- Feature → Capability (realizes)
- Feature → Persona (serves)
- Feature → Milestone (scheduled-for)
- UserWorkflow → Persona (serves)
- UserWorkflow → Feature (composes)
- Milestone → Milestone (precedes)
- Feature → Feature (depends-on)

**Cross-Layer (Product → Motivation):**

- Persona → Stakeholder (realizes)
- Feature → Requirement (satisfies)
- Capability → Goal (supports)
- UserWorkflow → Outcome (delivers)
- Feature → Value (delivers-value)

**Cross-Layer (Product → Business):**

- Feature → BusinessService (realizes)
- UserWorkflow → BusinessProcess (aggregates)
- Capability → BusinessFunction (realizes)
- Persona → BusinessRole (serves)

---

## Best Practices

1. Start with Personas before Features
2. Every Feature should realize at least one Capability
3. Link Capabilities to Motivation layer Goals
4. Organize Milestones sequentially with precedes relationships
5. Map Features to Personas they serve
6. Use sizing and priority consistently
7. Track feature status through development lifecycle
8. Connect to Business layer services and processes

---

## Common Modeling Patterns

**Feature Hierarchy:**
- Capability → aggregates → sub-Capabilities
- Milestone → contains → Features and Capabilities

**Persona-Driven Development:**
- Persona → served by → Features
- Persona → realizes → Stakeholder

**Roadmap Planning:**
- Feature → scheduled-for → Milestone
- Milestone → precedes → Milestone

**Workflow Design:**
- UserWorkflow → composes → Features
- UserWorkflow → serves → Personas

---

## Quick Commands

```bash
# Add entities
dr add product persona <name> --category primary --proficiency intermediate
dr add product capability <name> --status planned
dr add product feature <name> --priority high --status developing --size m
dr add product user-workflow <name> --complexity moderate
dr add product milestone <name> --status planned

# Create relationships
dr relationship add <source> <dest> --predicate realizes
dr relationship add <feature> <milestone> --predicate scheduled-for
```
