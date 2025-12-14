# Layer Relationship Documentation Guide

## Overview

This guide explains how to document intra-layer and cross-layer relationships in layer specification files. Proper relationship documentation enables:

- **Traceability**: Link entities across layers for impact analysis
- **Validation**: Automated checking of relationship integrity
- **Reporting**: Generate relationship matrices and coverage reports
- **Comprehension**: Help developers understand architectural patterns

## What Gets Documented

### Intra-Layer Relationships

Relationships **within** a single layer (e.g., BusinessProcess → BusinessService).

**Location**: `spec/layers/XX-layer-name-layer.md` in the `## Relationships` section

### Cross-Layer Relationships

Relationships **between** different layers (e.g., BusinessService → Goal).

**Location**: Defined in `spec/schemas/link-registry.json` and referenced in layer files

## Intra-Layer Relationship Documentation

### Required Format

Relationships must follow this exact format for the parser to detect them:

```markdown
- **SourceEntity predicate TargetEntity**: Description
```

**Components**:

- `SourceEntity`: The entity type that originates the relationship (PascalCase)
- `predicate`: The relationship verb (kebab-case: `aggregates`, `assigned-to`, `realizes`)
- `TargetEntity`: The entity type that receives the relationship (PascalCase)
- `Description`: Human-readable explanation of the semantic meaning

### Complete Example

```markdown
## Relationships

This section documents the intra-layer relationships available within the Business Layer.
All relationship types align with ArchiMate 3.2 semantics and are catalogued in the
relationship catalog.

### Structural Relationships

Structural relationships define static connections between elements, establishing
composition, specialization, and assignment patterns.

#### Composition

- **Product composes BusinessService**: Products contain services as integral parts
- **BusinessProcess composes BusinessProcess**: Complex processes decompose into sub-processes
- **BusinessFunction composes BusinessProcess**: Functions group processes by capability

**Semantics**: Part cannot exist without the whole; lifecycle is tightly coupled.

#### Aggregation

- **Product aggregates BusinessService**: Products bundle services that can exist independently
- **Product aggregates Contract**: Products bundle contracts (SLAs, terms)
- **BusinessCollaboration aggregates BusinessRole**: Collaborations aggregate roles that participate

**Semantics**: Part can exist independently; lifecycle is loosely coupled.

#### Assignment

- **BusinessActor assigned-to BusinessRole**: Actors are assigned to perform roles
- **BusinessRole assigned-to BusinessProcess**: Roles are responsible for executing processes

**Semantics**: Active element (actor, role, collaboration) performs behavior (process, function, interaction).

### Behavioral Relationships

Behavioral relationships describe dynamic interactions, flows, and temporal dependencies.

#### Triggering

- **BusinessEvent triggers BusinessProcess**: Events initiate process execution
- **BusinessProcess triggers BusinessEvent**: Processes emit events upon completion

**Semantics**: Temporal causation; source initiates target execution.

#### Flow

- **BusinessProcess flows-to BusinessProcess**: Sequential process flow (control/data transfer)

**Semantics**: Transfer of control, data, or responsibility from one behavior to the next.
```

## Organization Best Practices

### 1. Group by Relationship Category

Organize relationships into logical categories that match your domain or standard (e.g., ArchiMate):

**Common Categories**:

- **Structural**: composition, aggregation, assignment, realization, specialization
- **Behavioral**: triggering, flow, serving, access
- **Dependency**: association, influence

### 2. Use Subcategories

Group similar relationships under h4 headers (`####`):

```markdown
### Structural Relationships

#### Composition

[composition relationships...]

#### Aggregation

[aggregation relationships...]
```

### 3. Include Semantics

After each subcategory, explain the general semantics:

```markdown
**Semantics**: Part cannot exist without the whole; lifecycle is tightly coupled.
```

### 4. Provide Context

Add a brief introduction explaining the purpose and scope:

```markdown
This section documents the intra-layer relationships available within the [Layer Name].
All relationship types align with [Standard Name] semantics and are catalogued in the
relationship catalog.
```

## Validation and Reporting

### How Documentation is Detected

The intra-layer analyzer parses your Relationships section using this pattern:

```regex
-\s+\*\*(\w+)\s+([\w-]+)\s+(\w+)\*\*:
```

This means the format **must be exact**:

- ✅ `- **Product aggregates BusinessService**: Description`
- ❌ `- Product aggregates BusinessService: Description` (missing bold)
- ❌ `- **Product aggregates BusinessService** Description` (missing colon)

### Documentation Status in Reports

Generated intra-layer reports show three types of relationships:

1. **Documented**: Found in Relationships section
   - Status: `Documented`
   - Source: `[Doc](../../spec/layers/XX-layer-name-layer.md#relationships)`
   - Documented: `[✓](...)`

2. **XML Only**: Found in Example Model but not documented
   - Status: `XML`
   - Source: `[XML](../../spec/layers/XX-layer-name-layer.md#example-model)`
   - Documented: `✗`

3. **Implicit**: Inferred but not explicitly defined
   - Status: `Implicit`
   - Source: (source location)
   - Documented: `✗`

### Checking Coverage

Generate intra-layer reports to see documentation status:

```bash
dr generate reports --intra-layer --all-layers
```

Review the reports in `reports/layers/XX-layer-name-intra-layer.md`:

```markdown
## Entity: BusinessService

### Outgoing Relationships (BusinessService → Other Entities)

| Relationship Type | Target Entity | Predicate | Status     | Source     | In Catalog | Documented |
| ----------------- | ------------- | --------- | ---------- | ---------- | ---------- | ---------- |
| serving           | BusinessActor | `serves`  | Documented | [Doc](...) | ✓          | [✓](...)   |
```

## Common Patterns

### ArchiMate Alignment

When following ArchiMate semantics, use these standard relationship types:

**Structural**:

- `composition` / `composes`
- `aggregation` / `aggregates`
- `assignment` / `assigned-to`
- `realization` / `realizes`
- `specialization` / `specializes`

**Dependency**:

- `serving` / `serves`
- `access` / `accesses`
- `influence` / `influences`
- `association` / `associated-with`

**Dynamic**:

- `triggering` / `triggers`
- `flow` / `flows-to`

### Bidirectional Relationships

Some relationships are naturally bidirectional. Document the primary direction:

```markdown
- **BusinessService serves BusinessActor**: Services are available to actors
```

The inverse (`BusinessActor served-by BusinessService`) is implied and will appear in reports.

### Self-Referential Relationships

When entities relate to themselves, document explicitly:

```markdown
- **BusinessProcess composes BusinessProcess**: Complex processes decompose into sub-processes
- **BusinessObject specializes BusinessObject**: Type hierarchy (e.g., PremiumOrder specializes Order)
```

## Cross-Layer Relationships

Cross-layer relationships are defined in `spec/schemas/link-registry.json` and referenced in layer files through properties.

**Example**:

```yaml
BusinessService:
  properties:
    - key: "motivation.supports-goals"
      value: "goal-id-1,goal-id-2" (optional, comma-separated Goal IDs)
```

See the [Link Registry Design](../link-registry-v2-design.md) for details on cross-layer relationship configuration.

## Workflow

### Adding New Relationships

1. **Define in Layer File**: Add to `## Relationships` section using proper format
2. **Add Examples**: Include in `## Example Model` with XML `<relationship>` tags
3. **Generate Reports**: Run `dr generate reports --intra-layer --layer XX-layer-name`
4. **Review Coverage**: Check the generated report for documentation status
5. **Update Catalog** (if needed): Add new relationship types to `spec/schemas/relationship-catalog.json`

### Documenting Existing Relationships

If XML examples exist but documentation is missing:

1. Review the intra-layer report for relationships marked with `✗` in Documented column
2. Add them to the `## Relationships` section following the format
3. Regenerate reports to verify they're now marked `[✓]`

## Quick Reference

### ✅ Valid Format

```markdown
- **Product aggregates BusinessService**: Products bundle services that can exist independently
- **BusinessActor assigned-to BusinessRole**: Actors are assigned to perform roles
- **BusinessEvent triggers BusinessProcess**: Events initiate process execution
```

### ❌ Invalid Formats

```markdown
Product aggregates BusinessService: Missing bold markers

- Product aggregates BusinessService: Missing bold markers
- **Product aggregates BusinessService** Missing colon
- ** Product aggregates BusinessService **: Extra spaces in bold
- **Product -> BusinessService**: Wrong predicate format
```

### Checklist

- [ ] Listed in `## Relationships` section
- [ ] Uses format: `- **Source predicate Target**: Description`
- [ ] Source and Target match entity types defined in layer
- [ ] Predicate uses kebab-case
- [ ] Description explains semantic meaning
- [ ] Grouped under appropriate category
- [ ] Semantics explanation provided for category
- [ ] Examples exist in `## Example Model` section

## Tools

### Generate Reports

```bash
# Single layer
dr generate reports --intra-layer --layer 02-business

# All layers
dr generate reports --intra-layer --all-layers
```

### Validate Relationships

```bash
dr validate --layer 02-business-layer
```

## Further Reading

- [Layer Specification Template](../../spec/layers/README.md)
- [Relationship Catalog](../../spec/schemas/relationship-catalog.json)
- [Link Registry Design](../link-registry-v2-design.md)
- [ArchiMate 3.2 Specification](https://pubs.opengroup.org/architecture/archimate3-doc/)
