# Contributing to the Specification

Thank you for your interest in contributing to the Documentation Robotics specification!

## How to Contribute

There are many ways to contribute:

1. **Report Issues** - Found an ambiguity, error, or missing feature?
2. **Propose Changes** - Have an idea for improving the specification?
3. **Provide Feedback** - Implementing the spec? Share your experience
4. **Add Examples** - Create example models demonstrating concepts
5. **Improve Documentation** - Fix typos, clarify language, add diagrams
6. **Contribute Test Fixtures** - Add test cases for validators

## Before You Start

1. **Read the Specification** - Familiarize yourself with the core concepts
2. **Check Existing Issues** - Someone may have already reported your concern
3. **Review Governance** - Understand the change process in [GOVERNANCE.md](GOVERNANCE.md)
4. **Join Discussions** - Introduce yourself in GitHub Discussions

## Reporting Issues

### Bug Reports (Errors in Specification)

When reporting an error:

```markdown
**Section:** [e.g., Layer 07: Data Model, Section 3.2]
**Issue:** [Brief description of the error]
**Current Text:** [Quote the problematic text]
**Expected:** [What should it say?]
**Rationale:** [Why is this an error?]
```

**Label:** `bug`, `spec-error`

### Feature Requests (Missing Functionality)

When proposing a new feature:

```markdown
**Use Case:** [Describe the problem you're trying to solve]
**Current Limitation:** [What can't you do today?]
**Proposed Solution:** [Your suggested approach]
**Alternatives Considered:** [Other approaches you considered]
**Impact:** [Which layers/concepts affected?]
```

**Label:** `enhancement`, `spec-proposal`

### Clarification Requests (Ambiguities)

When the specification is unclear:

```markdown
**Section:** [e.g., Layer 09: UX, Section 2.1]
**Question:** [What's unclear?]
**Interpretation A:** [One possible reading]
**Interpretation B:** [Another possible reading]
**Suggestion:** [How to clarify?]
```

**Label:** `question`, `clarification-needed`

## Making Changes

### Small Changes (Typos, Formatting)

For small editorial changes:

1. Fork the repository
2. Make your changes
3. Submit a pull request
4. Reference any related issues

No prior discussion needed.

### Medium Changes (New Examples, Clarifications)

For informative additions:

1. Open an issue describing the change
2. Wait for initial feedback
3. Fork and make changes
4. Submit PR with updated documentation
5. Link PR to issue

Discussion period: ~1 week

### Large Changes (New Entities, Layers)

For normative changes:

1. Open an issue with detailed proposal
2. Label as `spec-proposal`
3. Participate in discussion (min. 30 days)
4. Wait for approval from maintainers
5. Fork and implement changes
6. Update all affected documentation
7. Add/update test fixtures
8. Submit PR with comprehensive changes

Discussion period: 30+ days

## Pull Request Guidelines

### PR Checklist

- [ ] Linked to relevant issue(s)
- [ ] Changes follow specification style guide
- [ ] Updated CHANGELOG.md
- [ ] Updated affected layer documents
- [ ] Added/updated examples if applicable
- [ ] Added/updated test fixtures if applicable
- [ ] All links work correctly
- [ ] No spelling errors (run spell check)
- [ ] Validated against JSON Schemas (if applicable)

### PR Description Template

```markdown
## Summary

[Brief description of changes]

## Related Issue(s)

Fixes #[issue number]
Relates to #[issue number]

## Type of Change

- [ ] Editorial (typo, formatting)
- [ ] Informative (examples, guides)
- [ ] Normative (entity definitions, validation rules)
- [ ] Breaking (incompatible with previous version)

## Changes Made

- [Bullet list of specific changes]

## Testing

- [How were changes validated?]

## Documentation

- [ ] Updated layer documentation
- [ ] Updated schemas
- [ ] Updated examples
- [ ] Updated CHANGELOG.md

## Breaking Changes

[If applicable, describe breaking changes and migration path]
```

## Style Guide

### Specification Language

#### Normative Language (Requirements)

Use RFC 2119 keywords:

- **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT** - Absolute requirements
- **SHOULD**, **SHOULD NOT**, **RECOMMENDED** - Strong recommendations
- **MAY**, **OPTIONAL** - Truly optional

**Example:**

```markdown
Entity IDs MUST be unique within their layer.
Entity names SHOULD follow kebab-case convention.
Entities MAY include custom x- prefixed attributes.
```

#### Informative Language (Guidance)

Use clear, helpful language:

- "You can..." for suggestions
- "Consider..." for recommendations
- "For example..." for examples
- "Note that..." for important points

### Document Structure

Each layer specification SHOULD include:

1. **Overview** - Purpose and scope
2. **Layer Characteristics** - Standard used, validation approach
3. **Entity Definitions** - All entities with attributes
4. **Relationships** - How entities relate
5. **Integration Points** - Cross-layer references
6. **Examples** - Concrete examples
7. **Validation Rules** - What must be validated
8. **Best Practices** - Recommended patterns

### Code Examples

Use YAML for examples:

```yaml
# Good: Clear, commented example
Entity:
  id: "example-entity" # Unique identifier
  name: "Example Entity"
  type: "EntityType"
  # Optional documentation
  documentation: "Describes what this entity does"
```

Use JSON for schemas:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Entity",
  "type": "object",
  "required": ["id", "name", "type"],
  "properties": {
    "id": { "type": "string" },
    "name": { "type": "string" },
    "type": { "type": "string" }
  }
}
```

### Diagrams

- Use ASCII art for simple diagrams
- Use Mermaid for complex diagrams
- Include alt text for accessibility
- Keep diagrams simple and focused

### Naming Conventions

- **File names:** `kebab-case.md`
- **Section headers:** Title Case
- **Entity types:** PascalCase (e.g., `ApplicationService`)
- **Attribute names:** camelCase (e.g., `operationId`)
- **Enum values:** lowercase with hyphens (e.g., `get-request`)

## Adding Examples

### Example Model Guidelines

Good examples:

- **Complete** - Include all required attributes
- **Realistic** - Based on real-world scenarios
- **Commented** - Explain non-obvious choices
- **Valid** - Pass all validation rules
- **Focused** - Demonstrate one concept clearly

### Example Structure

```
spec/examples/[example-name]/
├── README.md                 # Description and learning objectives
├── model/                    # Architecture model files
│   ├── manifest.yaml
│   ├── 01_motivation/
│   ├── 02_business/
│   └── ...
├── specs/                    # Generated specifications
│   ├── api/
│   ├── schemas/
│   └── ...
└── validation-report.txt     # Validation results
```

## Adding Test Fixtures

### Valid Test Fixtures

Add to `spec/test-fixtures/valid/[layer]/`:

- Must pass all validation rules
- Cover different scenarios
- Include edge cases
- Well-documented

### Invalid Test Fixtures

Add to `spec/test-fixtures/invalid/[error-type]/`:

- Must fail validation appropriately
- Include expected error message
- Cover common mistakes
- Help implementers test validators

### Test Fixture Format

```yaml
# test-fixtures/valid/motivation/goal-basic.yaml
metadata:
  testId: "valid-goal-basic"
  description: "Basic valid goal with required attributes only"
  expectation: "pass"

data:
  id: "goal-customer-satisfaction"
  name: "Improve Customer Satisfaction"
  type: "Goal"
```

## Contributing to Schemas

### JSON Schema Guidelines

- Follow JSON Schema Draft 7 specification
- Include clear descriptions
- Define all constraints
- Provide examples
- Use consistent patterns

### Schema Validation

Before submitting schema changes:

```bash
# Validate schema syntax
ajv compile -s spec/schemas/[layer].schema.json

# Test against valid fixtures
ajv test -s spec/schemas/[layer].schema.json \
  -d "spec/test-fixtures/valid/[layer]/*.yaml" \
  --valid

# Test against invalid fixtures
ajv test -s spec/schemas/[layer].schema.json \
  -d "spec/test-fixtures/invalid/[layer]/*.yaml" \
  --invalid
```

## Review Process

### What Reviewers Look For

1. **Correctness** - Is the change technically correct?
2. **Completeness** - Are all necessary changes included?
3. **Clarity** - Is the language clear and unambiguous?
4. **Consistency** - Does it fit with existing specification?
5. **Impact** - What's the impact on existing implementations?

### Responding to Feedback

- Be responsive and respectful
- Address all comments
- Explain your reasoning
- Be open to suggestions
- Iterate based on feedback

## Building Locally

### Prerequisites

```bash
# Install dependencies
npm install -g ajv-cli markdown-link-check

# Or use Python
pip install jsonschema markdown-it-py
```

### Validation

```bash
# Validate all schemas
./scripts/validate-schemas.sh

# Check all links
./scripts/check-links.sh

# Run spell check
./scripts/spell-check.sh
```

### Generate Documentation

```bash
# Generate entity index
./scripts/generate-entity-index.sh

# Generate relationship diagram
./scripts/generate-relationships.sh
```

## Recognition

Contributors are recognized:

- In release notes for significant contributions
- In the project README
- As co-authors on commits (if substantial changes)

## Questions?

- **General Questions:** GitHub Discussions
- **Specific Issues:** GitHub Issues
- **Real-time Chat:** [Link to Discord/Slack if available]
- **Email:** [Maintainer email]

## Code of Conduct

All contributors must adhere to the project's Code of Conduct. We are committed to providing a welcoming and inclusive environment.

---

Thank you for contributing to making architecture modeling better!
