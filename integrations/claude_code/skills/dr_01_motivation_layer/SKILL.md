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

The Motivation Layer is the **highest layer** in the 12-layer architecture and provides governance to all other layers. It describes:

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

### Structural Relationships

| Source Type | Predicate   | Target Type | Example                                                      |
| ----------- | ----------- | ----------- | ------------------------------------------------------------ |
| Goal        | aggregates  | Goal        | Strategic Goal aggregates Operational Goals                  |
| Requirement | aggregates  | Requirement | Business Requirement aggregates Functional Requirements      |
| Principle   | aggregates  | Principle   | Enterprise Principles aggregate Domain Principles            |
| Constraint  | aggregates  | Constraint  | Budget Constraint aggregates Project Budget Constraints      |
| Outcome     | realizes    | Goal        | "Launched Mobile App" realizes "Launch Mobile App by Q4"     |
| Goal        | realizes    | Value       | "Improve Customer Satisfaction" realizes "Customer Value"    |
| Requirement | realizes    | Goal        | Functional Requirements realize Business Goals               |
| Requirement | realizes    | Principle   | Technical Requirements realize Security Principles           |
| Constraint  | realizes    | Principle   | Technology Constraints realize Technology Principles         |
| Goal        | specializes | Goal        | "Reduce API Latency" specializes "Improve Performance"       |
| Requirement | specializes | Requirement | "95% Uptime SLA" specializes "High Availability Requirement" |
| Principle   | specializes | Principle   | "Encrypt All PII" specializes "Data Security Principle"      |
| Value       | specializes | Value       | "Customer Retention Value" specializes "Customer Value"      |

### Behavioral Relationships

| Source Type | Predicate       | Target Type | Example                                                                 |
| ----------- | --------------- | ----------- | ----------------------------------------------------------------------- |
| Driver      | influences      | Goal        | "Digital Transformation" influences "Modernize Architecture"            |
| Driver      | influences      | Requirement | "GDPR Compliance" influences "Data Protection Requirements"             |
| Driver      | influences      | Principle   | "Cloud-First Strategy" influences "Cloud-Native Principles"             |
| Assessment  | influences      | Goal        | "Legacy System Weakness" influences "Modernization Goal"                |
| Goal        | influences      | Requirement | Business Goals influence Functional Requirements                        |
| Principle   | influences      | Requirement | Security Principles influence Technical Requirements                    |
| Principle   | influences      | Constraint  | "API-First Principle" influences "RESTful API Constraint"               |
| Constraint  | influences      | Requirement | Budget Constraints influence Implementation Requirements                |
| Value       | influences      | Goal        | "Customer Value" influences "Improve UX Goal"                           |
| Stakeholder | influences      | Goal        | "CEO" influences Strategic Goals                                        |
| Stakeholder | influences      | Requirement | "End Users" influence Functional Requirements                           |
| Stakeholder | influences      | Value       | "Shareholders" influence Financial Value                                |
| Stakeholder | associated-with | Driver      | "Product Manager" associated with "Market Competition Driver"           |
| Goal        | associated-with | Outcome     | "Improve Performance" associated with "Achieved 50ms Latency"           |
| Requirement | associated-with | Outcome     | "High Availability Requirement" associated with "99.99% Uptime Outcome" |
| Driver      | associated-with | Assessment  | "Market Driver" associated with "Competitive Threat Assessment"         |
| Value       | associated-with | Meaning     | "Customer Value" associated with "Definition of Customer Success"       |

---

## Cross-Layer References

**Motivation Layer is the highest layer** - It does **NOT reference any lower layers**. Instead, lower layers reference UP to this layer for governance.

### Incoming References (Lower Layers → Motivation)

| Layer                     | References Motivation For                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Layer 2 (Business)**    | BusinessService delivers Value, supports Goals, governed by Principles; BusinessActor is Stakeholder; Contract drives Constraints |
| **Layer 3 (Security)**    | Actor references Stakeholder; ActorObjective references Goal; Threat references Assessment; Countermeasure implements Requirement |
| **Layer 4 (Application)** | ApplicationService supports Goals, delivers Value, governed by Principles; ApplicationFunction fulfills Requirements              |
| **Layer 5 (Technology)**  | TechnologyService supports Goals, governed by Principles; Node fulfills Requirements, constrained by Constraints                  |
| **Layer 6 (API)**         | Operation supports Goals (x-supports-goals), fulfills Requirements, governed by Principles, constrained by Constraints            |
| **Layer 7-12**            | All layers can reference Principles, Constraints, Requirements, Goals for governance and traceability                             |

**Design Pattern:** Lower layers "look up" to the Motivation layer to justify WHY they exist and WHAT value they deliver.

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
  motivation.goal.modernize-architecture --predicate influences

# Goal realizes Value
dr relationship add motivation.goal.modernize-architecture \
  motivation.value.operational-efficiency --predicate realizes

# Principle influences Requirement
dr relationship add motivation.principle.api-first-design \
  motivation.requirement.api-authentication --predicate influences

# Stakeholder influences Goal
dr relationship add motivation.stakeholder.product-manager \
  motivation.goal.modernize-architecture --predicate influences

# Assessment influences Goal
dr relationship add motivation.assessment.legacy-system-debt \
  motivation.goal.modernize-architecture --predicate influences
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
│   └── influences → Technical Requirement: "Use AES-256 Encryption"
├── aggregates → Functional Requirement: "Encrypt Data in Transit"
│   └── influences → Technical Requirement: "Use TLS 1.3"
└── aggregates → Compliance Requirement: "GDPR Data Protection"
    └── influences → Technical Requirement: "Right to Deletion API"
```

### Pattern 3: Principle Application

```
Principle: "Cloud-Native Architecture"
├── influences → Requirement: "Containerized Deployments"
├── influences → Requirement: "Stateless Services"
├── influences → Constraint: "No On-Premise Infrastructure"
└── realizes → Value: "Scalability and Resilience"
```

### Pattern 4: Stakeholder → Goal → Implementation Chain

```
Stakeholder: "CEO"
└── influences → Goal: "Reduce Operating Costs by 20%"
    ├── influences → Requirement: "Automated CI/CD Pipeline"
    ├── influences → Principle: "Infrastructure as Code"
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

- `aggregates`, `realizes`, `specializes`, `influences`, `associated-with`

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
dr relationship add <source-id> <target-id> --predicate influences
dr relationship add <source-id> <target-id> --predicate aggregates
dr relationship add <source-id> <target-id> --predicate realizes
dr relationship add <source-id> <target-id> --predicate specializes
```

**Query Commands:**

```bash
dr list motivation --type goal
dr search "" --layer motivation
dr relationship list <element-id> --direction outgoing
```
