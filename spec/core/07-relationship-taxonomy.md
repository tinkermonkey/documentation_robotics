# Relationship Taxonomy

**Version**: 2.0.0
**Status**: Draft
**Last Updated**: 2025-12-10

## Overview

This document defines a comprehensive, pragmatic taxonomy of relationship predicates for the Documentation Robotics specification. The taxonomy is aligned with ArchiMate 3.2 where applicable, but extends it with software-specific and domain-specific relationships needed for modern application documentation.

### Design Principles

1. **Pragmatic Formalism**: Balance rigor with usability - avoid over-engineering while maintaining semantic precision
2. **ArchiMate Alignment**: Use ArchiMate relationships where they fit, extend where they don't
3. **Bidirectional Navigation**: Every relationship has an inverse predicate for two-way traversal
4. **Domain Extension**: Support APM, Security, UX, Navigation domains beyond core ArchiMate
5. **Traceability First**: Explicit support for upward-flowing traceability chains

### Relationship Categories

Relationships are organized into 6 primary categories:

1. **Structural Relationships** - Static structural dependencies between elements
2. **Behavioral Relationships** - Dynamic execution and flow relationships
3. **Dependency Relationships** - Usage and dependency between elements
4. **Traceability Relationships** - Links implementation to strategic elements (upward flowing)
5. **Governance Relationships** - Links elements to governance constraints
6. **Domain-Specific Relationships** - Documentation Robotics extensions beyond ArchiMate

---

## Category 1: Structural Relationships

Defines static structural dependencies between elements. These relationships describe how elements are composed, organized, and structured.

### 1.1 Composition

**Predicate**: `composes` / `composed-of`
**ArchiMate**: Composition
**Semantics**: Whole-part relationship where the part cannot exist without the whole
**Transitivity**: No
**Symmetry**: No (asymmetric)

**Description**: Indicates that an element is composed of other elements that are essential to its definition. The composed elements cannot meaningfully exist independently of the composite.

**Examples**:
- BusinessCollaboration composes BusinessRole
- ApplicationComponent composes ApplicationInterface
- Technology composes TechnologyNode

**Usage in Layers**:
- Business Layer: BusinessCollaboration → BusinessRole
- Application Layer: ApplicationComponent → ApplicationInterface
- Technology Layer: Node → Device

---

### 1.2 Aggregation

**Predicate**: `aggregates` / `aggregated-by`
**ArchiMate**: Aggregation
**Semantics**: Whole-part relationship where the part can exist independently
**Transitivity**: No
**Symmetry**: No (asymmetric)

**Description**: Indicates that an element groups or contains other elements, but the contained elements can exist independently.

**Examples**:
- Product aggregates BusinessService
- ApplicationComponent aggregates ApplicationService
- Location aggregates Node

**Usage in Layers**:
- Business Layer: Product → BusinessService
- Application Layer: ApplicationComponent → ApplicationService
- Technology Layer: Location → Node

---

### 1.3 Specialization

**Predicate**: `specializes` / `generalized-by`
**ArchiMate**: Specialization
**Semantics**: Type-subtype relationship (inheritance)
**Transitivity**: Yes
**Symmetry**: No (asymmetric)

**Description**: Indicates that an element is a more specific variant of another element, inheriting its properties.

**Examples**:
- PremiumAccount specializes Account
- RESTAPIOperation specializes APIOperation
- PostgresDB specializes Database

**Usage in Layers**:
- All layers support specialization for entity types

---

### 1.4 Realization

**Predicate**: `realizes` / `realized-by`
**ArchiMate**: Realization
**Semantics**: Implementation element realizes abstract element
**Transitivity**: Yes
**Symmetry**: No (asymmetric)

**Description**: Indicates that an implementation element realizes the behavior or structure defined by an abstract element.

**Examples**:
- ApplicationService realizes BusinessService
- TechnologyService realizes ApplicationService
- APIOperation realizes ApplicationInterface

**Usage in Layers**:
- Application → Business: ApplicationService realizes BusinessService
- Technology → Application: TechnologyService realizes ApplicationService
- API → Application: APIOperation realizes ApplicationInterface

---

### 1.5 Assignment

**Predicate**: `assigned-to` / `assigns`
**ArchiMate**: Assignment
**Semantics**: Active element assigned to behavior or role
**Transitivity**: No
**Symmetry**: No (asymmetric)

**Description**: Indicates that an active structure element (actor, component) is assigned to perform a behavior or fulfill a role.

**Examples**:
- BusinessActor assigned-to BusinessRole
- ApplicationComponent assigned-to ApplicationFunction
- Node assigned-to TechnologyFunction

**Usage in Layers**:
- Business Layer: BusinessActor → BusinessRole
- Application Layer: ApplicationComponent → ApplicationFunction
- Technology Layer: Node → TechnologyFunction

---

## Category 2: Behavioral Relationships

Defines dynamic execution and flow relationships between behavioral elements.

### 2.1 Triggering

**Predicate**: `triggers` / `triggered-by`
**ArchiMate**: Triggering
**Semantics**: Event or behavior triggers another behavior
**Transitivity**: No
**Symmetry**: No (asymmetric)

**Description**: Indicates that an event or the completion of one behavior initiates another behavior.

**Examples**:
- BusinessEvent triggers BusinessProcess
- APIOperation triggers ApplicationFunction
- DataChange triggers EventHandler

**Usage in Layers**:
- Business Layer: BusinessEvent → BusinessProcess
- Application Layer: ApplicationEvent → ApplicationFunction
- API Layer: APIOperation → ApplicationFunction

---

### 2.2 Flow

**Predicate**: `flows-to` / `flows-from`
**ArchiMate**: Flow
**Semantics**: Sequential or data flow between behaviors
**Transitivity**: No
**Symmetry**: No (asymmetric)

**Description**: Indicates sequential ordering or data/control flow between behaviors.

**Examples**:
- BusinessProcess flows-to BusinessProcess
- ApplicationFunction flows-to ApplicationFunction
- UIState flows-to UIState

**Usage in Layers**:
- Business Layer: BusinessProcess → BusinessProcess
- Application Layer: ApplicationFunction → ApplicationFunction
- UX Layer: UIState → UIState

---

### 2.3 Serving

**Predicate**: `serves` / `served-by`
**ArchiMate**: Serving
**Semantics**: Service available to consumer
**Transitivity**: No
**Symmetry**: No (asymmetric)

**Description**: Indicates that a service provides functionality to consumers.

**Examples**:
- BusinessService serves BusinessActor
- ApplicationService serves ApplicationComponent
- TechnologyService serves TechnologyComponent

**Usage in Layers**:
- Business Layer: BusinessService → BusinessActor
- Application Layer: ApplicationService → ApplicationComponent
- Technology Layer: TechnologyService → TechnologyComponent

---

### 2.4 Access

**Predicate**: `accesses` / `accessed-by`
**ArchiMate**: Access (read/write)
**Semantics**: Behavior accesses passive element (data/artifact)
**Transitivity**: No
**Symmetry**: No (asymmetric)

**Description**: Indicates that a behavioral element reads or writes a passive structure element.

**Examples**:
- BusinessProcess accesses BusinessObject
- ApplicationFunction accesses DataObject
- APIOperation accesses Database

**Usage in Layers**:
- Business Layer: BusinessProcess → BusinessObject
- Application Layer: ApplicationFunction → DataObject
- API Layer: APIOperation → DataObject

---

## Category 3: Dependency Relationships

Defines usage and dependency between elements.

### 3.1 Uses

**Predicate**: `uses` / `used-by`
**Semantics**: Element depends on another for functionality
**Transitivity**: No
**Symmetry**: No (asymmetric)

**Description**: Indicates that an element depends on another element to function properly.

**Examples**:
- ApplicationComponent uses TechnologyService
- BusinessProcess uses ApplicationService
- UIComponent uses ApplicationService

**Usage in Layers**:
- Application → Technology: ApplicationComponent uses TechnologyService
- Business → Application: BusinessProcess uses ApplicationService
- UX → Application: UIComponent uses ApplicationService

---

### 3.2 References

**Predicate**: `references` / `referenced-by`
**Semantics**: Pointer reference without functional dependency
**Transitivity**: No
**Symmetry**: No (asymmetric)

**Description**: Indicates a reference or link to another element without implying functional dependency.

**Examples**:
- DataObject references Schema
- APIOperation references BusinessService
- UIView references Entity

**Usage in Layers**:
- Data Model → Schema: DataObject references JSONSchema
- API → Business: APIOperation references BusinessService
- UX → Domain: UIView references EntityType

---

### 3.3 Depends-On

**Predicate**: `depends-on` / `dependency-of`
**Semantics**: Element requires another to function
**Transitivity**: Yes
**Symmetry**: No (asymmetric)

**Description**: Indicates a hard dependency where an element cannot function without another element.

**Examples**:
- ApplicationService depends-on DataObject
- APIEndpoint depends-on ApplicationService
- UIComponent depends-on DataService

**Usage in Layers**:
- Application Layer: ApplicationService → DataObject
- API Layer: APIEndpoint → ApplicationService
- UX Layer: UIComponent → DataService

---

## Category 4: Traceability Relationships

Links implementation to strategic elements. These relationships flow upward from implementation layers to strategy layers, supporting goal traceability and requirements fulfillment.

### 4.1 Supports Goals

**Predicate**: `supports-goals` / `supported-by`
**Semantics**: Implementation contributes to achieving goal
**Field Paths**: `motivation.supports-goals`, `x-supports-goals`
**Transitivity**: Yes
**Symmetry**: No (asymmetric)

**Description**: Indicates that an implementation element contributes to achieving one or more strategic goals.

**Examples**:
- BusinessService supports-goals Goal("Increase Revenue")
- ApplicationService supports-goals Goal("Improve Customer Satisfaction")
- APIOperation supports-goals Goal("Reduce Response Time")

**Usage in Layers**:
- Business → Motivation: BusinessService → Goal
- Application → Motivation: ApplicationService → Goal
- API → Motivation: APIOperation → Goal

---

### 4.2 Fulfills Requirements

**Predicate**: `fulfills-requirements` / `fulfilled-by`
**Semantics**: Implementation satisfies requirement
**Field Paths**: `motivation.fulfills-requirements`, `x-fulfills-requirements`
**Transitivity**: No
**Symmetry**: No (asymmetric)

**Description**: Indicates that an implementation element satisfies one or more requirements.

**Examples**:
- ApplicationService fulfills-requirements Requirement("Must support OAuth 2.0")
- APIOperation fulfills-requirements Requirement("Must return JSON")
- SecurityControl fulfills-requirements Requirement("Must encrypt at rest")

**Usage in Layers**:
- Application → Motivation: ApplicationService → Requirement
- API → Motivation: APIOperation → Requirement
- Security → Motivation: SecurityControl → Requirement

---

### 4.3 Delivers Value

**Predicate**: `delivers-value` / `delivered-by`
**Semantics**: Implementation provides business value
**Field Paths**: `motivation.delivers-value`
**Transitivity**: No
**Symmetry**: No (asymmetric)

**Description**: Indicates that an element delivers or creates business value.

**Examples**:
- BusinessService delivers-value Value("Customer Loyalty")
- Product delivers-value Value("Revenue Growth")
- Feature delivers-value Value("User Engagement")

**Usage in Layers**:
- Business → Motivation: BusinessService → Value
- Product → Motivation: Product → Value

---

### 4.4 Measures Outcome

**Predicate**: `measures-outcome` / `measured-by`
**Semantics**: Metric validates outcome achievement
**Field Paths**: `motivationMapping.measuresOutcome`
**Transitivity**: No
**Symmetry**: No (asymmetric)

**Description**: Indicates that a metric or KPI measures the achievement of an outcome.

**Examples**:
- Metric("Response Time") measures-outcome Outcome("Fast Performance")
- Metric("Customer Satisfaction Score") measures-outcome Outcome("Happy Customers")
- SLA measures-outcome Outcome("Reliable Service")

**Usage in Layers**:
- APM → Motivation: Metric → Outcome
- Testing → Motivation: TestSuite → Outcome

---

## Category 5: Governance Relationships

Links elements to governance constraints and architectural principles.

### 5.1 Governed By Principles

**Predicate**: `governed-by-principles` / `governs`
**Semantics**: Element follows architectural principle
**Field Paths**: `motivation.governed-by-principles`, `x-governed-by-principles`
**Transitivity**: No
**Symmetry**: No (asymmetric)

**Description**: Indicates that an element adheres to one or more architectural principles.

**Examples**:
- ApplicationService governed-by-principles Principle("API First")
- DataModel governed-by-principles Principle("Single Source of Truth")
- APIOperation governed-by-principles Principle("RESTful Design")

**Usage in Layers**:
- Application → Motivation: ApplicationService → Principle
- Data Model → Motivation: DataModel → Principle
- API → Motivation: APIOperation → Principle

---

### 5.2 Constrained By

**Predicate**: `constrained-by` / `constrains`
**Semantics**: Element limited by constraint
**Field Paths**: `motivation.constrained-by`, `x-constrained-by`
**Transitivity**: No
**Symmetry**: No (asymmetric)

**Description**: Indicates that an element is subject to constraints that limit its design or implementation.

**Examples**:
- TechnologyComponent constrained-by Constraint("Must use approved libraries")
- APIOperation constrained-by Constraint("Rate limit: 1000 req/min")
- DataObject constrained-by Constraint("GDPR compliance required")

**Usage in Layers**:
- Technology → Motivation: TechnologyComponent → Constraint
- API → Motivation: APIOperation → Constraint
- Data Model → Motivation: DataObject → Constraint

---

### 5.3 Enforces Requirement

**Predicate**: `enforces-requirement` / `enforced-by`
**Semantics**: Element actively enforces requirement
**Field Paths**: `motivationAlignment.enforcesRequirement`
**Transitivity**: No
**Symmetry**: No (asymmetric)

**Description**: Indicates that an element actively enforces or validates a requirement.

**Examples**:
- NavigationGuard enforces-requirement Requirement("Must be authenticated")
- ValidationRule enforces-requirement Requirement("Email must be valid")
- SecurityControl enforces-requirement Requirement("MFA required")

**Usage in Layers**:
- Navigation → Motivation: NavigationGuard → Requirement
- Security → Motivation: SecurityControl → Requirement

---

## Category 6: Domain-Specific Relationships

Documentation Robotics extensions beyond ArchiMate for specialized domains.

### 6.1 APM Relationships

#### Traces

**Predicate**: `traces` / `traced-by`
**Semantics**: Distributed tracing relationships
**Field Paths**: `apm.traces`, `x-traces`

**Description**: Indicates that an operation or service participates in a distributed trace.

**Examples**:
- APIOperation traces DistributedTrace
- ApplicationService traces TransactionFlow

---

#### Monitors

**Predicate**: `monitors` / `monitored-by`
**Semantics**: Health/performance monitoring
**Field Paths**: `apm.monitors`, `x-monitors`

**Description**: Indicates that an element is monitored for health or performance.

**Examples**:
- HealthCheck monitors ApplicationService
- Metric monitors APIEndpoint

---

#### Measures

**Predicate**: `measures` / `measured-by`
**Semantics**: Metric collection relationships
**Field Paths**: `apm.measures`, `x-measures`

**Description**: Indicates that a metric measures a specific aspect of an element.

**Examples**:
- Metric("Response Time") measures APIOperation
- Metric("Error Rate") measures ApplicationService

---

### 6.2 Security Relationships

#### Protects

**Predicate**: `protects` / `protected-by`
**Semantics**: Security control relationships
**Field Paths**: `security.protects`, `x-protects`

**Description**: Indicates that a security control protects an element.

**Examples**:
- SecurityControl protects ApplicationService
- EncryptionPolicy protects DataObject

---

#### Authenticates

**Predicate**: `authenticates` / `authenticated-by`
**Semantics**: Authentication flows
**Field Paths**: `security.authenticates`, `x-authenticates`

**Description**: Indicates authentication relationships.

**Examples**:
- AuthenticationService authenticates User
- OAuth2Flow authenticates APIClient

---

#### Authorizes

**Predicate**: `authorizes` / `authorized-by`
**Semantics**: Permission grants
**Field Paths**: `security.authorizes`, `x-authorizes`

**Description**: Indicates authorization relationships.

**Examples**:
- Role authorizes Operation
- Permission authorizes Access

---

### 6.3 UX Relationships

#### Renders

**Predicate**: `renders` / `rendered-by`
**Semantics**: UI rendering relationships
**Field Paths**: `ux.renders`, `x-renders`

**Description**: Indicates that a component renders another component or view.

**Examples**:
- UIComponent renders UIView
- LayoutComponent renders ContentComponent

---

#### Binds To

**Predicate**: `binds-to` / `bound-by`
**Semantics**: Data binding relationships
**Field Paths**: `ux.binds-to`, `x-binds-to`

**Description**: Indicates data binding between UI and data elements.

**Examples**:
- UIComponent binds-to DataObject
- FormField binds-to EntityProperty

---

#### Navigates To

**Predicate**: `navigates-to` / `navigated-from`
**Semantics**: Navigation flows
**Field Paths**: `navigation.navigates-to`, `x-navigates-to`

**Description**: Indicates navigation relationships between views or routes.

**Examples**:
- UIView navigates-to UIView
- Route navigates-to Route

---

### 6.4 Data Relationships

#### Maps To

**Predicate**: `maps-to` / `mapped-from`
**Semantics**: Schema/table mapping
**Field Paths**: `data.maps-to`, `x-maps-to`

**Description**: Indicates mapping between data models at different abstraction levels.

**Examples**:
- BusinessObject maps-to DataObject
- DataObject maps-to DatabaseTable

---

#### References Table

**Predicate**: `references-table` / `table-referenced-by`
**Semantics**: Foreign key relationships
**Field Paths**: `data.references-table`, `x-references-table`

**Description**: Indicates foreign key references between database tables.

**Examples**:
- OrderTable references-table CustomerTable
- LineItemTable references-table ProductTable

---

#### Derives From

**Predicate**: `derives-from` / `derived-by`
**Semantics**: Calculated field relationships
**Field Paths**: `data.derives-from`, `x-derives-from`

**Description**: Indicates that a field is calculated or derived from other fields.

**Examples**:
- TotalPrice derives-from (Quantity, UnitPrice)
- FullName derives-from (FirstName, LastName)

---

## Predicate Summary

### Quick Reference Table

| Category | Predicate Count | ArchiMate Aligned |
|----------|-----------------|-------------------|
| Structural | 5 | 5 |
| Behavioral | 4 | 4 |
| Dependency | 3 | 0 |
| Traceability | 4 | 0 |
| Governance | 3 | 0 |
| APM | 3 | 0 |
| Security | 3 | 0 |
| UX | 3 | 0 |
| Data | 3 | 0 |
| **Total** | **31** | **9** |

### Bidirectional Pairs

All 31 predicates have defined inverse predicates, enabling bidirectional navigation:

- `composes` ⇄ `composed-of`
- `aggregates` ⇄ `aggregated-by`
- `specializes` ⇄ `generalized-by`
- `realizes` ⇄ `realized-by`
- `assigned-to` ⇄ `assigns`
- `triggers` ⇄ `triggered-by`
- `flows-to` ⇄ `flows-from`
- `serves` ⇄ `served-by`
- `accesses` ⇄ `accessed-by`
- `uses` ⇄ `used-by`
- `references` ⇄ `referenced-by`
- `depends-on` ⇄ `dependency-of`
- `supports-goals` ⇄ `supported-by`
- `fulfills-requirements` ⇄ `fulfilled-by`
- `delivers-value` ⇄ `delivered-by`
- `measures-outcome` ⇄ `measured-by`
- `governed-by-principles` ⇄ `governs`
- `constrained-by` ⇄ `constrains`
- `enforces-requirement` ⇄ `enforced-by`
- `traces` ⇄ `traced-by`
- `monitors` ⇄ `monitored-by`
- `measures` ⇄ `measured-by`
- `protects` ⇄ `protected-by`
- `authenticates` ⇄ `authenticated-by`
- `authorizes` ⇄ `authorized-by`
- `renders` ⇄ `rendered-by`
- `binds-to` ⇄ `bound-by`
- `navigates-to` ⇄ `navigated-from`
- `maps-to` ⇄ `mapped-from`
- `references-table` ⇄ `table-referenced-by`
- `derives-from` ⇄ `derived-by`

---

## Usage Guidelines

### Choosing the Right Predicate

1. **Start with ArchiMate**: If an ArchiMate relationship fits, use it (Structural, Behavioral categories)
2. **Traceability for Upward Links**: Use Traceability predicates when linking implementation → strategy
3. **Governance for Constraints**: Use Governance predicates when referencing principles, constraints, requirements
4. **Domain-Specific for Specialized Cases**: Use domain predicates for APM, Security, UX, Data domains

### Predicate Naming Conventions

- Use kebab-case for predicates: `supports-goals`, `fulfills-requirements`
- Use verb phrases: predicates describe actions or relationships
- Forward direction is active: "X supports-goals Y" means X supports Y
- Inverse direction is passive: "Y supported-by X" means Y is supported by X

### Field Path Conventions

Field paths encode predicates in YAML/JSON property definitions:

- **Motivation domain**: `motivation.{predicate}` (e.g., `motivation.supports-goals`)
- **Cross-layer references**: `{domain}.{predicate}` (e.g., `application.realized-by-process`)
- **OpenAPI extensions**: `x-{predicate}` (e.g., `x-supports-goals`)

---

## Migration from v0.6.0

### Changes from Previous Version

1. **Formalized Predicates**: All relationships now have explicit predicates (previously implied by field names)
2. **Inverse Predicates**: All predicates now have defined inverses for bidirectional navigation
3. **Category Organization**: Predicates organized into 6 categories (previously no formal categorization)
4. **Domain Extensions**: Added 12 domain-specific predicates for APM, Security, UX, Data

### Backward Compatibility

- Existing field paths remain valid (e.g., `motivation.supports-goals`)
- New `predicate` field in link-registry.json is additive
- Existing examples and documentation continue to work
- Migration tools available in `scripts/migration/`

---

## Related Documents

- [Cross-Layer Reference Registry](06-cross-layer-reference-registry.md) - Registry of valid link patterns
- [Reference Directionality](04-reference-directionality.md) - Upward-flowing traceability design
- Link Registry Schema (`spec/schemas/link-registry.json`) - Machine-readable link definitions
- Relationship Catalog (`spec/schemas/relationship-catalog.json`) - Complete predicate catalog

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0.0 | 2025-12-10 | Initial comprehensive taxonomy with 31 predicates across 6 categories |
