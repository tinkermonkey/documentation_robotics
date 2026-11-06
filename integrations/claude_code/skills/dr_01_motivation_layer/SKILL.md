---
name: LAYER_01_MOTIV
description: Expert knowledge for Motivation Layer modeling in Documentation Robotics
triggers:
  [
    "stakeholder",
    "driver",
    "assessment",
    "goal",
    "outcome",
    "principle",
    "requirement",
    "constraint",
    "motivation",
    "archimate motivation"
  ]
version: 0.8.3
---

# Motivation Layer Skill

**Layer Number:** 01
**Specification:** Metadata Model Spec v0.8.3
**Purpose:** Captures stakeholder concerns, goals, requirements, and constraints that drive architectural decisions using ArchiMate motivation elements.

---

## Layer Overview

The Motivation Layer is the **highest layer** in the 13-layer architecture and provides governance to all other layers. It describes:

- **WHY** - The reasons and drivers behind architectural decisions
- **WHO** - Stakeholders with interests in the outcome
- **WHAT** - Goals, requirements, principles, and constraints
- **VALUE** - The worth and importance of business outcomes

This layer uses **ArchiMate 3.2 Motivation Layer** standard without custom extensions.

---

## Entity Types

> **CLI Introspection:** Run `dr schema types motivation` for the authoritative, always-current list of node types.
> Run `dr schema node <type-id>` for full attribute details on any type.

| Entity Type     | Description                                                     | Key Attributes                                                                     |
| --------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Stakeholder** | Individual, team, or organization with interest in the outcome  | Types: internal, external, customer, partner, regulator                            |
| **Driver**      | External or internal condition that motivates an organization   | Categories: market, regulatory, technology, competitive, operational, strategic    |
| **Assessment**  | Outcome of analysis of the state of affairs (SWOT)              | Types: strength, weakness, opportunity, threat, risk, gap                          |
| **Goal**        | High-level statement of intent, direction, or desired end state | Priority: critical, high, medium, low. Can be SMART (measurable, target-date, KPI) |
| **Outcome**     | End result that has been achieved                               | Status: planned, in-progress, achieved, not-achieved                               |
| **Principle**   | Normative property of all systems in a given context            | Categories: business, data, application, technology, security, integration         |
| **Requirement** | Statement of need that must be realized                         | Types: functional, non-functional, business, technical, compliance, user           |
| **Constraint**  | Restriction on the way in which a system is realized            | Types: budget, time, technology, regulatory, organizational, resource              |
| **Meaning**     | Knowledge or expertise present in a representation              | Used to describe semantics and interpretations                                     |
| **Value**       | Relative worth, utility, or importance of something             | Types: financial, customer, operational, strategic, social                         |

---

## Type Decision Tree

Use this decision tree **before assigning a type** to any motivation concept.

```
IS this an individual, team, or organization with an interest in the system or its outcomes?
  → motivation.stakeholder

IS this an external or internal condition (market, regulatory, technology, competitive, operational,
strategic) that motivates the organization to change or act?
  → motivation.driver

IS this the result of analyzing the current state — a strength, weakness, opportunity, threat, risk,
or gap identified through assessment (e.g., SWOT)?
  → motivation.assessment

IS this a high-level statement of intent, direction, or desired end state the organization wants to achieve?
  → motivation.goal

IS this a specific, verifiable statement of need that must be realized (functional, non-functional,
compliance, business, technical, or user need)?
  → motivation.requirement

IS this a normative rule or guideline that all systems in this context must follow
(business, data, application, technology, security, integration)?
  → motivation.principle

IS this a hard restriction on HOW the system can be realized — a limit the system cannot exceed
(budget, time, technology, regulatory, organizational, resource)?
  → motivation.constraint

IS this an end result that has been or is being achieved — tracked against a goal?
  → motivation.outcome

IS this the relative worth, utility, or importance that the system or feature delivers?
  → motivation.value

IS this a semantic definition, interpretation, or piece of knowledge attached to another element?
  → motivation.meaning
```

**Key distinctions:**

- **Goal vs Requirement**: A Goal is aspirational ("improve performance"); a Requirement is a verifiable must ("API must respond in <200ms")
- **Requirement vs Constraint**: A Requirement says WHAT must be done; a Constraint says HOW it is bounded ("must use OAuth 2.0" limits the solution space)
- **Driver vs Assessment**: A Driver is an ongoing force motivating action; an Assessment is a point-in-time finding about the current state
- **Outcome vs Goal**: A Goal is what you intend to achieve; an Outcome is what has been (or is being) achieved

---

## Intra-Layer Relationships

Note that the ArchiMate influence predicate is spelled `influence` (not `influences`).

### Realization and Decomposition

Requirements realize the outcomes, goals and principles they make concrete, and outcomes realize
goals. Decomposition is same-type only: `aggregates` for parts, `specializes` for variants.

| Source Type | Predicate   | Target Type | Example                                                             |
| ----------- | ----------- | ----------- | ------------------------------------------------------------------- |
| Requirement | realizes    | Goal        | "API must respond in <200ms" realizes "Improve Performance"         |
| Requirement | realizes    | Outcome     | "99.99% availability" realizes "Downtime Under 1h per Quarter"      |
| Requirement | realizes    | Principle   | "Orders API uses OAuth 2.0" realizes "Security by Design"           |
| Outcome     | realizes    | Goal        | "Churn Reduced 10%" realizes "Improve Customer Satisfaction"        |
| Goal        | aggregates  | Goal        | "Improve Customer Satisfaction" aggregates "Reduce Response Time"   |
| Requirement | aggregates  | Requirement | "Secure User Data" requirement aggregates "Encrypt Data in Transit" |
| Outcome     | aggregates  | Outcome     | "Global NPS 50" aggregates "EU NPS 50"                              |
| Stakeholder | aggregates  | Stakeholder | "Finance" aggregates "Accounts Payable Team"                        |
| Value       | aggregates  | Value       | "Lower Total Cost" aggregates "Lower Licence Cost"                  |
| Goal        | specializes | Goal        | "Reduce API Latency" specializes "Improve Performance"              |
| Requirement | specializes | Requirement | "99.95% Uptime SLA" specializes "High Availability Requirement"     |
| Constraint  | specializes | Constraint  | "EU-only Data Residency" specializes "Data Residency Constraint"    |
| Constraint  | constrains  | Requirement | "Must use OAuth 2.0" constrains "User Authentication"               |

### Influence and Association Relationships

`influence` is one motivation element shaping another. `associated-with` is kept for concerns
(stakeholders, assessments evaluating drivers) and interpretation: meaning and value are associated
with any concept and are always the source.

| Source Type | Predicate       | Target Type | Example                                                               |
| ----------- | --------------- | ----------- | --------------------------------------------------------------------- |
| Stakeholder | influence       | Goal        | "CEO" influences "Reduce Operating Costs by 20%"                      |
| Driver      | influence       | Goal        | "Digital Transformation" influences "Modernize Architecture"          |
| Driver      | influence       | Requirement | "GDPR Regulation" influences "Right to Deletion"                      |
| Driver      | influence       | Principle   | "Cloud-First Strategy" influences "Cloud-Native Architecture"         |
| Driver      | influence       | Constraint  | "GDPR Regulation" influences "EU-only Data Residency"                 |
| Assessment  | influence       | Goal        | "Legacy System Debt" influences "Modernize Architecture"              |
| Assessment  | influence       | Requirement | "Slow Checkout Weakness" influences "Checkout must complete in <2s"   |
| Assessment  | influence       | Outcome     | "Checkout p95 is 4s" influences "Checkout p95 Under 2s by Q3"         |
| Goal        | influence       | Requirement | "Improve Security" influences "Enforce MFA for Admins"                |
| Goal        | influence       | Principle   | "Modernize Architecture" influences "Cloud-Native Architecture"       |
| Principle   | influence       | Requirement | "API-First Design" influences "Every Feature Exposes an API"          |
| Constraint  | influence       | Goal        | "Fixed Q4 Budget" influences "Launch Mobile App by Q4"                |
| Stakeholder | associated-with | Driver      | "Head of Compliance" associated with "GDPR Regulation"                |
| Stakeholder | associated-with | Requirement | "End Users" associated with "Offline Mode Support"                    |
| Assessment  | associated-with | Driver      | "GDPR Gap Analysis" associated with "GDPR Regulation"                 |
| Value       | associated-with | Stakeholder | "Customer Loyalty" associated with "Customers"                        |
| Value       | associated-with | Goal        | "Customer Loyalty" associated with "Improve Customer Satisfaction"    |
| Value       | associated-with | Driver      | "Faster Time to Market" associated with "Market Competition"          |
| Meaning     | associated-with | Value       | "Definition of Customer Success" associated with "Customer Loyalty"   |
| Meaning     | associated-with | Requirement | "Definition of Session" associated with "Sessions Expire After 15min" |

---

## Cross-Layer References

**Motivation Layer is the root of traceability.** The catalog defines no outgoing references from Motivation; elements in other layers point to motivation elements to justify WHY they exist and WHAT value they deliver.

### Incoming References (Other Layers → Motivation)

| Source Type                       | Predicate  | Target Type | Example                                                             |
| --------------------------------- | ---------- | ----------- | ------------------------------------------------------------------- |
| `business.businessservice`        | realizes   | Goal        | "Online Ordering" realizes "Grow Digital Revenue"                   |
| `business.businessservice`        | delivers   | Value       | "Same-Day Delivery" delivers "Customer Convenience"                 |
| `business.businessprocess`        | satisfies  | Requirement | "Refund Processing" satisfies "Refunds Issued Within 5 Days"        |
| `business.businessactor`          | references | Stakeholder | "Customer" actor references "Customers" stakeholder                 |
| `product.softwarecapability`      | supports   | Goal        | "Self-Service Returns" supports "Reduce Support Costs"              |
| `product.feature`                 | satisfies  | Requirement | "Two-Factor Login" satisfies "Enforce MFA for Admins"               |
| `product.persona`                 | references | Stakeholder | "Busy Parent Persona" references "Retail Customers"                 |
| `product.userworkflow`            | delivers   | Outcome     | "Checkout Flow" delivers "Cart Abandonment Reduced 15%"             |
| `security.securitypolicy`         | satisfies  | Principle   | "Encryption Policy" satisfies "Security by Design"                  |
| `security.countermeasure`         | satisfies  | Requirement | "Rate Limiting" satisfies "Prevent Credential Stuffing"             |
| `application.applicationservice`  | realizes   | Goal        | "Recommendation Service" realizes "Increase Average Order Value"    |
| `application.applicationfunction` | satisfies  | Requirement | "Audit Logging" satisfies "Log All Admin Actions"                   |
| `technology.systemsoftware`       | satisfies  | Constraint  | "PostgreSQL 15" satisfies "Approved Open-Source Databases Only"     |
| `api.operation`                   | satisfies  | Requirement | "POST /orders" satisfies "Orders Accepted via Public API"           |
| `data-store.retentionpolicy`      | satisfies  | Constraint  | "Purge PII After 30 Days" satisfies "GDPR Data Minimization"        |
| `apm.metricinstrument`            | maps-to    | Outcome     | "checkout.duration" metric maps to "Checkout Under 2s Outcome"      |
| `testing.testcoveragemodel`       | satisfies  | Requirement | "Checkout Coverage Model" satisfies "Checkout must complete in <2s" |
| `ux.view`                         | realizes   | Goal        | "Order Tracking Page" realizes "Reduce Where-Is-My-Order Calls"     |

---

## Codebase Detection Patterns

The Motivation Layer is typically **NOT extracted from code** but documented separately. However, certain patterns suggest the need for motivation elements:

### Pattern 1: Requirements Traceability Comments

```python
# REQUIREMENT: REQ-001 - User authentication must support OAuth 2.0
# GOAL: Improve security and user experience
# PRINCIPLE: Security by design

def configure_oauth(provider: str):
    pass
```

**Maps to:**

- Requirement entity (REQ-001)
- Goal entity (improve security)
- Principle entity (security by design)

### Pattern 2: Non-Functional Requirements in Tests

```python
@npm test.mark.performance
def test_api_response_time():
    """Verify API responds within 200ms (GOAL: sub-second response)"""
    response_time = measure_api_call()
    assert response_time < 0.2  # Constraint: < 200ms
```

**Maps to:**

- Goal (sub-second response)
- Constraint (< 200ms)
- Requirement (performance requirement)

### Pattern 3: Configuration Constants

```python
# Constraint: Budget limit for cloud spending
MAX_MONTHLY_CLOUD_COST = 10000  # USD

# Principle: Data residency compliance
ALLOWED_REGIONS = ["us-east-1", "us-west-2"]  # Constraint: US-only

# Goal: 99.99% availability
TARGET_UPTIME_SLA = 0.9999
```

**Maps to:**

- Constraint entities (budget, region)
- Goal (availability target)
- Principle (data residency)

### Pattern 4: README/Documentation Headers

```markdown
## Goals

- Achieve 99.9% system availability
- Reduce customer onboarding time to < 5 minutes
- Support 10,000 concurrent users

## Principles

- API-first architecture
- Microservices over monoliths
- Security by design

## Constraints

- Budget: $500K for 2024
- Timeline: Launch by Q3 2024
- Technology: Must run on AWS
```

**Maps to:** Direct creation of Goal, Principle, and Constraint entities

---

## Coverage Completeness Checklist

Before declaring motivation layer extraction complete, verify each type was considered:

- [ ] **stakeholder** — All individuals, teams, and organizations with interests in the system are documented
- [ ] **driver** — External and internal forces motivating architectural decisions are captured
- [ ] **assessment** — SWOT-style findings (strengths, weaknesses, opportunities, threats, risks, gaps) are recorded
- [ ] **goal** — High-level intentions and desired end states are defined with priority
- [ ] **requirement** — Specific needs that must be realized are documented (functional, non-functional, compliance, etc.)
- [ ] **principle** — Normative guidelines governing all system implementations are listed
- [ ] **constraint** — Hard limits and restrictions on system realization are documented
- [ ] **outcome** — Achieved or tracked results linked to goals are recorded
- [ ] **value** — The worth and utility delivered by the system or feature is articulated
- [ ] **meaning** — Semantic definitions or knowledge interpretations are captured where elements need clarification

If any type has ZERO elements, explicitly decide:
"This type doesn't apply to this codebase" with reasoning.

---

## Modeling Workflow

### Step 1: Identify Stakeholders

Start by documenting **WHO cares** about the system:

```bash
# Add key stakeholders
dr add motivation stakeholder "End Users" \
  --description "Customers using the platform"

dr add motivation stakeholder "Product Manager" \
  --description "Defines product vision and priorities"

dr add motivation stakeholder "Compliance Team" \
  --description "Ensures regulatory compliance"
```

### Step 2: Document Drivers and Assessments

Identify **WHAT is pushing** the organization:

```bash
# Market driver
dr add motivation driver "Cloud Migration Pressure" \
  --description "Industry shift to cloud-native architectures"

# SWOT assessment
dr add motivation assessment "Legacy System Debt" \
  --description "Monolithic architecture limits agility"

dr add motivation assessment "Strong Engineering Team" \
  --description "Experienced team with cloud expertise"
```

### Step 3: Define Goals and Values

Articulate **WHAT we want to achieve**:

```bash
# Strategic goal
dr add motivation goal "Modernize Architecture" \
  --description "Migrate to microservices architecture"

# Value delivered
dr add motivation value "Operational Efficiency" \
  --description "Reduced deployment time and increased reliability"
```

### Step 4: Specify Requirements and Principles

Define **HOW we will operate**:

```bash
# Functional requirement
dr add motivation requirement "API Authentication" \
  --description "All API endpoints must authenticate users"

# Guiding principle
dr add motivation principle "API-First Design" \
  --description "All services expose RESTful APIs with OpenAPI specs"

# Hard constraint
dr add motivation constraint "AWS-Only Infrastructure" \
  --description "All services must deploy to AWS (no multi-cloud)"
```

### Step 5: Establish Relationships

Connect motivation elements using predicates:

```bash
# Driver influences Goal
dr relationship add motivation.driver.cloud-migration-pressure \
  motivation.goal.modernize-architecture --predicate influence

# Value associated with Goal (meaning and value are the source)
dr relationship add motivation.value.operational-efficiency \
  motivation.goal.modernize-architecture --predicate associated-with

# Principle influences Requirement
dr relationship add motivation.principle.api-first-design \
  motivation.requirement.api-authentication --predicate influence

# Stakeholder influences Goal
dr relationship add motivation.stakeholder.product-manager \
  motivation.goal.modernize-architecture --predicate influence

# Assessment influences Goal
dr relationship add motivation.assessment.legacy-system-debt \
  motivation.goal.modernize-architecture --predicate influence
```

### Step 6: Validate

```bash
dr validate --layers motivation
dr validate --relationships
```

---

## Traceability Patterns

### Pattern 1: Goal Decomposition Hierarchy

```
Strategic Goal: "Improve Customer Satisfaction"
├── aggregates → Business Goal: "Reduce Response Time"
│   ├── aggregates → Operational Goal: "Achieve <100ms API Latency"
│   └── aggregates → Operational Goal: "Implement Caching Layer"
└── aggregates → Business Goal: "Improve Mobile Experience"
    ├── aggregates → Operational Goal: "Launch iOS App"
    └── aggregates → Operational Goal: "Launch Android App"
```

### Pattern 2: Requirement Hierarchy

```
Business Requirement: "Secure User Data"
├── aggregates → Functional Requirement: "Encrypt Data at Rest"
│   └── aggregates → Technical Requirement: "Use AES-256 Encryption"
├── aggregates → Functional Requirement: "Encrypt Data in Transit"
│   └── aggregates → Technical Requirement: "Use TLS 1.3"
└── aggregates → Compliance Requirement: "GDPR Data Protection"
    └── aggregates → Technical Requirement: "Right to Deletion API"
```

### Pattern 3: Principle Application

```
Principle: "Cloud-Native Architecture"
├── influence → Requirement: "Containerized Deployments"
├── influence → Requirement: "Stateless Services"
└── associated-with → Value: "Scalability and Resilience"
```

### Pattern 4: Stakeholder → Goal → Implementation Chain

```
Stakeholder: "CEO"
└── influence → Goal: "Reduce Operating Costs by 20%"
    ├── influence → Requirement: "Automated CI/CD Pipeline"
    ├── influence → Principle: "Infrastructure as Code"
    └── realizes → Value: "Financial Efficiency"
        └── (lower layers reference this chain)
```

---

## Common Modeling Scenarios

### Scenario 1: New Feature Justification

**Question:** "Why are we building this feature?"

**Approach:**

1. Add **Stakeholder** who requested it
2. Add **Driver** (market, customer, regulatory)
3. Add **Goal** the feature achieves
4. Add **Value** delivered
5. Lower layers reference the Goal

### Scenario 2: Regulatory Compliance

**Question:** "How do we track GDPR compliance?"

**Approach:**

1. Add **Driver** ("GDPR Regulation")
2. Add **Constraint** ("Data Residency: EU only")
3. Add **Requirement** ("Right to Deletion", "Data Portability")
4. Add **Principle** ("Privacy by Design")
5. Security layer references these elements

### Scenario 3: Architecture Decision Records (ADR)

**Question:** "Document why we chose microservices?"

**Approach:**

1. Add **Assessment** (strength/weakness of monolith)
2. Add **Principle** ("Microservices Architecture")
3. Add **Goal** ("Improve Deployment Frequency")
4. Add **Constraint** ("Team size supports distributed ownership")
5. Application layer references the Principle

---

## ArchiMate Integration

When exporting to ArchiMate format:

```bash
dr export archimate --layers motivation --output motivation.archimate
```

**Supported ArchiMate Elements:**

- `Stakeholder` → ArchiMate Stakeholder
- `Driver` → ArchiMate Driver
- `Assessment` → ArchiMate Assessment
- `Goal` → ArchiMate Goal
- `Outcome` → ArchiMate Outcome
- `Principle` → ArchiMate Principle
- `Requirement` → ArchiMate Requirement
- `Constraint` → ArchiMate Constraint
- `Meaning` → ArchiMate Meaning
- `Value` → ArchiMate Value

**Supported Relationships:**

- `aggregates`, `realizes`, `specializes`, `influence`, `associated-with`

---

## Best Practices

1. **Start with Stakeholders** - Understand WHO before WHAT
2. **Use SMART Goals** - Make goals Specific, Measurable, Achievable, Relevant, Time-bound
3. **Distinguish Requirements from Constraints**:
   - **Requirement**: "System MUST authenticate users" (functional need)
   - **Constraint**: "System MUST use OAuth 2.0" (limits HOW requirement is met)
4. **Link Principles to Requirements** - Every requirement should trace to a principle or goal
5. **Use Assessments for Trade-offs** - Document strengths/weaknesses to justify decisions
6. **Track Outcomes** - Update outcome status as goals are achieved
7. **Don't Over-Document** - Focus on high-value motivation elements that drive decisions

---

## Validation Tips

Common validation issues:

| Issue                  | Cause                                   | Fix                                             |
| ---------------------- | --------------------------------------- | ----------------------------------------------- |
| Orphaned Goal          | No stakeholder influences it            | Add stakeholder or driver that influences goal  |
| Unrealized Requirement | No goal justifies it                    | Link requirement to goal or principle           |
| Unused Principle       | No requirements reference it            | Either apply principle or remove it             |
| Missing Value          | Goals don't realize any value           | Add value elements and link goals               |
| No Traceability        | Lower layers don't reference motivation | Add references from business/application layers |

---

## Quick Reference

**Add Commands:**

```bash
dr add motivation stakeholder <name> --description <description>
dr add motivation driver <name> --description <description>
dr add motivation goal <name> --description <description>
dr add motivation requirement <name> --description <description>
dr add motivation principle <name> --description <description>
dr add motivation constraint <name> --description <description>
```

**Relationship Commands:**

```bash
dr relationship add <source-id> <target-id> --predicate influence
dr relationship add <source-id> <target-id> --predicate aggregates
dr relationship add <source-id> <target-id> --predicate realizes
dr relationship add <source-id> <target-id> --predicate specializes
dr relationship add <source-id> <target-id> --predicate associated-with
```

**Query Commands:**

```bash
dr list motivation --type goal
dr search "" --layer motivation
dr relationship list <element-id> --direction outgoing
```
