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

**Example:**

```
Persona: "Sales Representative"
├── category: primary
├── proficiency: intermediate
├── realizes → Stakeholder: "Sales Team"
├── served-by → BusinessRole: "Sales Manager"
└── pain-points:
    - Time-consuming manual data entry
    - Limited visibility into customer interactions
```

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

**Decomposition:**
Capabilities decompose into sub-capabilities via `aggregates` relationships for complex capabilities.

**Example:**

```
Capability: "Customer Data Management"
├── status: developing
├── aggregates → Capability: "Customer CRUD"
├── aggregates → Capability: "Customer Segmentation"
├── realizes → BusinessFunction: "Customer Lifecycle Management"
└── supports → Goal: "Improve Customer Retention"
```

---

## Feature Definition

A Feature is a **user-visible unit of functionality** that delivers one or more capabilities and is the primary unit of product planning.

**Distinction from Requirement (Motivation layer):**

- **Requirement** - What system _must_ do (functional/non-functional/regulatory)
- **Feature** - Planned unit of value with prioritization, sizing, and lifecycle

**Priority Levels:**

- **Critical** - Product cannot function without it (v1 release blocker)
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

**Example:**

```
Feature: "Two-Factor Authentication"
├── priority: high
├── status: developing
├── size: m
├── realizes → Capability: "Account Security"
├── serves → Persona: "Security-Conscious User"
├── satisfies → Requirement: "Support TOTP and SMS 2FA"
└── scheduled-for → Milestone: "Q3 Security Release"
```

---

## User Workflow Definition

A UserWorkflow is a **sequence of user-facing steps** through the product to accomplish a goal.

**Distinction from BusinessProcess (Business layer) and ExperienceState (UX layer):**

- **BusinessProcess** - Organization-internal process (BPMN, ArchiMate)
- **UserWorkflow** - User-centric journey through product features
- **ExperienceState** - UI/interface-level state transitions

**Complexity Assessment:**

- **Simple** - Linear flow, 2–3 steps, minimal decision points
- **Moderate** - Multiple branches, 5–10 steps, some conditional logic
- **Complex** - Many decision points, 10+ steps, cross-system integration

**Example:**

```
UserWorkflow: "Checkout Flow"
├── complexity: moderate
├── serves → Persona: "Online Shopper"
├── composes → Feature: "Shopping Cart"
├── composes → Feature: "Payment Processing"
├── composes → Feature: "Order Confirmation"
├── delivers → Outcome: "Completed Purchase"
└── aggregates → BusinessProcess: "Order Fulfillment"

Steps:
1. Add item to cart (Feature: Shopping Cart)
2. Review cart and shipping (Feature: Checkout)
3. Enter payment details (Feature: Payment Processing)
4. Confirm order (Feature: Order Confirmation)
5. Receive confirmation email
```

---

## Milestone Definition

A Milestone is a **time-bound delivery target** grouping features or capabilities.

**Lifecycle Statuses:**

- **Proposed** - Candidate milestone under evaluation
- **Planned** - Scheduled for planning and estimation
- **Active** - Development underway
- **Completed** - Released to users
- **Cancelled** - Postponed or deprioritized

**Milestone Sequencing:**
Milestones can precede/follow other milestones for roadmap planning.

**Example:**

```
Milestone: "Q3 2024 Release"
├── status: active
├── scheduled-features:
│   ├── Feature: "Two-Factor Authentication"
│   ├── Feature: "Audit Logging"
│   └── Feature: "API Rate Limiting"
├── scheduled-capabilities:
│   ├── Capability: "Account Security"
│   └── Capability: "System Reliability"
├── precedes → Milestone: "Q4 2024 Release"
└── includes → Outcome: "Improved User Trust"
```

---

## Codebase Detection Patterns

### Pattern 1: Feature Flags

```python
# Feature flag indicating incomplete feature
if feature_flags.get("two_factor_auth_enabled"):
    user.enable_2fa()

# Feature flag with rollout percentage
if feature_flags.is_enabled("new_checkout", rollout_percentage=10):
    return new_checkout_flow()
```

**Maps to:**

- Feature: "Two-Factor Authentication" (status: developing)
- Feature: "New Checkout Flow" (status: developing, rollout: 10%)

### Pattern 2: Product Roadmap Comment

```python
# TODO: Implement user segmentation for Q3 milestone
# Feature: "User Segmentation" (priority: high)
# Capability: "Customer Segmentation"
# Milestone: "Q3 2024 Release"
def segment_users_by_behavior():
    pass
```

**Maps to:**

- Feature: "User Segmentation" (priority: high)
- Capability: "Customer Segmentation"
- Milestone: "Q3 2024 Release"

### Pattern 3: User Role / Persona References

```typescript
// Different workflows for different user personas
const workflowByPersona = {
  basicUser: {
    steps: ["login", "browse", "add-to-cart", "checkout"],
    complexity: "simple"
  },
  powerUser: {
    steps: [
      "login",
      "advanced-search",
      "bulk-compare",
      "batch-order",
      "checkout"
    ],
    complexity: "complex"
  },
  admin: {
    steps: ["login", "access-dashboard", "manage-users", "view-analytics"],
    complexity: "complex"
  }
};
```

**Maps to:**

- Persona: "Basic User" (proficiency: novice)
- Persona: "Power User" (proficiency: advanced)
- Persona: "Admin" (proficiency: expert)
- UserWorkflow: "Basic Checkout Flow" (complexity: simple) → serves → Persona: "Basic User"
- UserWorkflow: "Power User Ordering" (complexity: complex) → serves → Persona: "Power User"

### Pattern 4: Capability Requirements

```yaml
# Product capability definition
capabilities:
  authentication:
    - password-based
    - oauth2
    - saml
    - multi-factor-auth
  reporting:
    - real-time-dashboards
    - scheduled-reports
    - custom-queries
    - data-export
```

**Maps to:**

- Capability: "Authentication" → aggregates → [Password-Based Auth, OAuth2, SAML, Multi-Factor Auth]
- Capability: "Reporting" → aggregates → [Real-Time Dashboards, Scheduled Reports, Custom Queries, Data Export]

### Pattern 5: Persona Attributes in Code

```python
class UserProfile:
    """User archetype modeling"""
    def __init__(self, persona_type: str, proficiency: str):
        self.persona_type = persona_type  # e.g., "power-user", "casual-user"
        self.proficiency = proficiency    # e.g., "advanced", "novice"
        self.pain_points = []
        self.goals = []

    def can_access_feature(self, feature: str) -> bool:
        # Persona determines accessible features
        if self.persona_type == "power-user":
            return True
        return feature in self.accessible_features
```

**Maps to:**

- Persona: "Power User" (proficiency: advanced) → serves → Feature collection
- Persona: "Casual User" (proficiency: novice) → serves → Limited feature set

---

## Modeling Workflow

### Step 1: Define Target Personas

```bash
# Identify primary personas
dr add product persona "power-user" \
  --description "Expert user who uses all advanced features" \
  --attributes '{"category":"primary","proficiency":"advanced"}'

dr add product persona "casual-user" \
  --description "Occasional user focused on core features" \
  --attributes '{"category":"primary","proficiency":"novice"}'

dr add product persona "admin" \
  --description "System administrator managing users and settings" \
  --attributes '{"category":"primary","proficiency":"expert"}'
```

### Step 2: Define Product Capabilities

```bash
# Product-level abilities (outcome-focused)
dr add product capability "user-authentication" \
  --description "Authenticate and authorize users" \
  --attributes '{"status":"planned"}'

dr add product capability "data-export" \
  --description "Export user data in multiple formats" \
  --attributes '{"status":"proposed"}'

dr add product capability "real-time-collaboration" \
  --description "Enable multiple users to collaborate simultaneously" \
  --attributes '{"status":"developing"}'
```

### Step 3: Define Features

```bash
# User-visible features (deliverable units)
dr add product feature "multi-factor-authentication" \
  --description "Two-factor auth via TOTP or SMS" \
  --attributes '{"priority":"high","size":"m","status":"developing"}'

dr add product feature "csv-export" \
  --description "Export data to CSV format" \
  --attributes '{"priority":"medium","size":"s","status":"planned"}'

dr add product feature "live-cursor-tracking" \
  --description "See other users' cursor positions in real-time" \
  --attributes '{"priority":"high","size":"l","status":"proposed"}'
```

### Step 4: Map Features to Capabilities

```bash
# Features realize capabilities
dr relationship add product.feature.multi-factor-authentication \
  product.capability.user-authentication --predicate realizes

dr relationship add product.feature.csv-export \
  product.capability.data-export --predicate realizes

dr relationship add product.feature.live-cursor-tracking \
  product.capability.real-time-collaboration --predicate realizes
```

### Step 5: Map Features to Personas

```bash
# Features serve personas
dr relationship add product.feature.multi-factor-authentication \
  product.persona.security-conscious-user --predicate serves

dr relationship add product.feature.live-cursor-tracking \
  product.persona.power-user --predicate serves

dr relationship add product.feature.csv-export \
  product.persona.data-analyst --predicate serves
```

### Step 6: Define User Workflows

```bash
# User journeys through product
dr add product user-workflow "basic-authentication-flow" \
  --description "Standard login and session management" \
  --attributes '{"complexity":"simple"}'

dr add product user-workflow "secure-authentication-flow" \
  --description "Multi-factor authentication workflow" \
  --attributes '{"complexity":"moderate"}'

dr add product user-workflow "collaboration-session" \
  --description "Join and participate in real-time collaboration" \
  --attributes '{"complexity":"complex"}'
```

### Step 7: Map Workflows to Features

```bash
# Workflows compose features
dr relationship add product.user-workflow.secure-authentication-flow \
  product.feature.multi-factor-authentication --predicate composes

dr relationship add product.user-workflow.collaboration-session \
  product.feature.live-cursor-tracking --predicate composes
```

### Step 8: Define Milestones

```bash
# Delivery roadmap
dr add product milestone "q3-security-release" \
  --description "Security-focused quarterly release" \
  --attributes '{"status":"planned"}'

dr add product milestone "q4-collaboration-release" \
  --description "Real-time collaboration release" \
  --attributes '{"status":"proposed"}'
```

### Step 9: Schedule Features to Milestones

```bash
# Assign features to delivery targets
dr relationship add product.feature.multi-factor-authentication \
  product.milestone.q3-security-release --predicate scheduled-for

dr relationship add product.feature.live-cursor-tracking \
  product.milestone.q4-collaboration-release --predicate scheduled-for
```

### Step 10: Cross-Layer Integration

```bash
# Link to Motivation layer
dr relationship add product.feature.multi-factor-authentication \
  motivation.requirement.user-account-security --predicate satisfies

dr relationship add product.capability.user-authentication \
  motivation.goal.customer-trust --predicate supports

# Link to Business layer
dr relationship add product.feature.csv-export \
  business.business-service.data-analytics --predicate realizes

dr relationship add product.persona.power-user \
  business.business-role.data-analyst --predicate serves
```

---

## Modeling Patterns

### Pattern 1: Feature Hierarchy

```
Capability: "Order Management"
├── aggregates → Capability: "Order Placement"
│   └── realizes → Feature: "Shopping Cart"
├── aggregates → Capability: "Order Tracking"
│   └── realizes → Feature: "Order History"
└── aggregates → Capability: "Order Fulfillment"
    └── realizes → Feature: "Shipment Tracking"
```

### Pattern 2: Persona-Driven Features

```
Persona: "Enterprise Administrator"
├── proficiency: expert
├── served-by → Feature: "Bulk User Import"
├── served-by → Feature: "Advanced Reporting"
├── served-by → Feature: "API Key Management"
└── serves → BusinessRole: "IT Operations"
```

### Pattern 3: Milestone Roadmap

```
Milestone: "Q1 2025 MVP"
├── scheduled-features:
│   ├── Feature: "User Authentication"
│   ├── Feature: "Basic Search"
│   └── Feature: "Profile Management"
├── precedes → Milestone: "Q2 2025 Enhancement"
│   ├── scheduled-features:
│   │   ├── Feature: "Advanced Search"
│   │   └── Feature: "Real-Time Notifications"
```

### Pattern 4: Workflow with Multiple Features

```
UserWorkflow: "Power User Data Analysis"
├── complexity: complex
├── serves → Persona: "Data Analyst"
├── composes → Feature: "Advanced Search"
├── composes → Feature: "Custom Dashboards"
├── composes → Feature: "CSV Export"
├── composes → Feature: "Scheduled Reports"
└── aggregates → BusinessProcess: "Business Intelligence"
```

---

## Best Practices

1. **Start with Personas, End with Workflows** - Understand users first, model journeys last
2. **Features Deliver Capabilities** - Every feature should map to at least one capability
3. **Capabilities Support Goals** - Link capabilities to motivation layer goals for justification
4. **Milestones Sequence Logically** - Plan dependencies and prerequisites
5. **Workflows are User-Centric** - Name them from the user's perspective, not system perspective
6. **Complexity Reflects User Experience** - Complex workflows should have features to manage that complexity
7. **Prioritization Reflects Business Value** - Higher priority features deliver more strategic value
8. **Personas Evolve** - As product matures, update persona proficiency and categories
9. **Features Have Clear Status** - Track development progress from proposed to delivered
10. **Link to Business Layer** - Map features to business services to show value realization

---

## Validation Tips

| Issue               | Cause                                 | Fix                                   |
| ------------------- | ------------------------------------- | ------------------------------------- |
| Orphaned Feature    | Feature doesn't realize a capability  | Add capability or remove feature      |
| Unused Persona      | Persona serves no features            | Add features for persona or remove    |
| Unmapped Capability | Capability doesn't support a goal     | Link to Motivation goal or remove     |
| Incomplete Workflow | Workflow has no features              | Add feature composition or simplify   |
| Future Milestone    | Milestone has no scheduled features   | Add features or mark as candidate     |
| Vague Persona       | Persona lacks proficiency or category | Define proficiency level and category |
| Unlinked Feature    | Feature doesn't satisfy a requirement | Add requirement link or remove        |

---

## Quick Reference

**Add Commands:**

```bash
dr add product persona <name> --description <desc> --attributes '{"category":"<category>","proficiency":"<proficiency>"}'
dr add product capability <name> --description <desc> --attributes '{"status":"<status>"}'
dr add product feature <name> --description <desc> --attributes '{"priority":"<priority>","status":"<status>","size":"<size>"}'
dr add product user-workflow <name> --description <desc> --attributes '{"complexity":"<complexity>"}'
dr add product milestone <name> --description <desc> --attributes '{"status":"<status>"}'
```

**Relationship Commands:**

```bash
dr relationship add <capability> <capability> --predicate aggregates
dr relationship add <feature> <capability> --predicate realizes
dr relationship add <feature> <persona> --predicate serves
dr relationship add <workflow> <feature> --predicate composes
dr relationship add <feature> <milestone> --predicate scheduled-for
dr relationship add <milestone> <milestone> --predicate precedes
```

**Cross-Layer Commands:**

```bash
dr relationship add <persona> <stakeholder> --predicate realizes
dr relationship add <feature> <requirement> --predicate satisfies
dr relationship add <capability> <goal> --predicate supports
dr relationship add <workflow> <outcome> --predicate delivers
dr relationship add <feature> <business-service> --predicate realizes
```
