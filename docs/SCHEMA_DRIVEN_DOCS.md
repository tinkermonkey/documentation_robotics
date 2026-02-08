# Schema-Driven Documentation Model

## Overview

Documentation Robotics implements a **schema-driven documentation generation model** where JSON schema definitions are the authoritative source of truth, and markdown documentation is automatically generated for human readability.

This approach inverts the previous model where markdown files were the source of truth.

## The Old Model (Markdown-First)

```
Markdown Files (Source)
    ↓
Auto-generate Schemas
    ↓
Manual Edits to Schemas
    ↓
Copy to CLI
    ↓
Dual maintenance burden
```

**Problems:**

- Documentation and schemas could drift
- Changes had to be made in two places
- Schema generation overwrote manual enhancements
- CI validation was difficult

## The New Model (Schema-Driven)

```
Specification Instances (Source)
├── spec/layers/*.layer.json       (SpecLayer definitions)
├── spec/nodes/**/*.node.json      (SpecNode definitions)
└── spec/relationships/...         (SpecNodeRelationship definitions)
    ↓
Auto-generate Markdown Documentation
    ↓
spec/layers/*.md (Generated)
    ↓
Human-readable documentation
```

**Benefits:**

- ✅ Single source of truth (JSON specs)
- ✅ Automatic documentation consistency
- ✅ CI validation prevents drift
- ✅ Documentation always matches spec definitions
- ✅ Easier to maintain and update

## Key Components

### 1. Specification Instances

**Location**: `spec/layers/` and `spec/nodes/`

These JSON files define the architecture specification:

```bash
spec/
├── layers/
│   ├── 01-motivation.layer.json
│   ├── 02-business.layer.json
│   └── ...
└── nodes/
    ├── motivation/
    │   ├── stakeholder.node.json
    │   ├── goal.node.json
    │   └── ...
    ├── business/
    │   └── ...
    └── ...
```

Each `*.layer.json` file contains:

```json
{
  "id": "motivation",
  "number": 1,
  "name": "Motivation Layer",
  "description": "Layer description...",
  "inspired_by": {
    "standard": "ArchiMate 3.2",
    "version": "3.2",
    "url": "https://..."
  },
  "node_types": ["motivation.stakeholder", "motivation.goal", ...]
}
```

Each `*.node.json` file contains:

```json
{
  "id": "motivation.stakeholder",
  "layer_id": "motivation",
  "name": "Stakeholder",
  "description": "Individual, team, or organization...",
  "attributes": {
    "id": {
      "type": "string",
      "description": "",
      "format": "uuid"
    },
    ...
  },
  "required_attributes": ["id", "name", "type"]
}
```

### 2. Documentation Generator

**Location**: `scripts/generate-layer-docs.ts`

The TypeScript generator:

1. Loads all SpecLayer instances from `spec/layers/*.layer.json`
2. Loads all SpecNode instances from `spec/nodes/**/*.node.json`
3. Generates markdown documentation for each layer
4. Creates an index document with cross-references

Usage:

```bash
# Generate all layer documentation
bun run scripts/generate-layer-docs.ts

# Generate specific layer
bun run scripts/generate-layer-docs.ts --layer motivation

# Generate to custom output directory
bun run scripts/generate-layer-docs.ts --output ./docs/
```

### 3. Generated Documentation

**Location**: `spec/layers/*.md` (auto-generated)

Generated markdown files contain:

- **Header**: Layer name, number, and standards reference
- **Overview**: Layer description and node type count
- **Node Types**: Full documentation for each node type including:
  - Node ID and type name
  - Description
  - All attributes with types
  - Required attributes marked
- **References**: Links to standards (ArchiMate, OpenAPI, etc.)

Example generated section:

```markdown
# Layer 1: Motivation Layer

Captures stakeholder concerns, goals, requirements...

**Standard**: [ArchiMate 3.2](https://pubs.opengroup.org/...)

---

## Overview

The Motivation Layer describes the reasons and drivers...

This layer defines **19** node types...

## Node Types

### Stakeholder

**ID**: `motivation.stakeholder`

Individual, team, or organization with interest in the outcome

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `type`: string (required)
```

## CLI Commands

### Generate Documentation

```bash
# Generate all layer documentation from specs
dr docs generate

# Generate specific layer only
dr docs generate --layer motivation

# Generate to custom directory
dr docs generate --output ./custom-docs/
```

### Validate Documentation Sync

```bash
# Check if documentation is in sync with specs
dr docs validate

# Strict mode (fail if out of sync, for CI)
dr docs validate --strict
```

## CI Validation

The `.github/workflows/validate-docs.yml` workflow:

1. Triggers on changes to spec files (schemas, nodes, layers)
2. Generates documentation from specifications
3. Compares generated docs with committed files
4. Fails if documentation is out of sync
5. Provides instructions to regenerate docs locally

This ensures documentation never drifts from the authoritative specification.

## Maintenance Workflow

### When to Update Specifications

Developers update the JSON specification instances when:

- Adding new node types
- Modifying node attributes
- Changing layer definitions
- Updating standards references

### Automatic Documentation Update

After specification changes:

1. **Locally** (before committing):

   ```bash
   dr docs generate
   git add spec/layers/*.md
   git commit -m "Update generated documentation"
   ```

2. **In CI** (automatically):
   - Workflow detects specification changes
   - Generates fresh documentation
   - Fails PR if docs are out of sync
   - Provides regeneration instructions

### Manual Documentation

Certain sections may require manual curation:

- Examples (demonstrate real-world usage)
- Implementation notes
- Design rationale

These can be:

- Added separately in `docs/` directory
- Referenced from generated files
- Maintained independently from specifications

## Migration from Old Model

If transitioning from markdown-first to schema-first:

1. **Extract specifications** from markdown files into JSON
   - One `*.layer.json` per layer
   - One `*.node.json` per node type
2. **Generate documentation**:

   ```bash
   dr docs generate
   ```

3. **Review generated output** for accuracy
4. **Commit specification instances** (new source of truth)
5. **Replace markdown files** with generated versions
6. **Update CI/CD** to validate docs are in sync

## Architecture Benefits

### Single Source of Truth

- Specifications in JSON are the authoritative source
- Documentation is a generated artifact
- No manual synchronization needed

### Consistency

- All documentation reflects spec definitions
- Impossible to have stale docs
- Automatic updates on spec changes

### Maintainability

- JSON specs are structured, machine-readable
- Easy to validate, search, analyze
- Tools can operate on specifications directly

### Standards Alignment

- Specs reference industry standards (ArchiMate, OpenAPI, JSON Schema)
- Documentation includes standard citations
- Clear provenance and inspiration

## Technical Details

### Specification Loading

The generator:

1. Reads `spec/layers/*.layer.json` files
2. Reads `spec/nodes/**/*.node.json` files
3. Groups nodes by layer_id
4. Sorts layers by number for consistent output

### Markdown Generation

For each layer:

1. Generates header with layer metadata
2. Generates overview section
3. For each node type:
   - Create subsection with name
   - List all attributes with types
   - Mark required attributes
   - Include descriptions
4. Generate references section

### Index Generation

A master index document:

- Lists all layers with links
- Groups node types by layer
- Provides cross-references
- Serves as navigation hub

## See Also

- [Layer Specifications](../spec/layers/) - Generated documentation
- [Specification Instances](../spec/layers/) - SpecLayer JSON files
- [Node Definitions](../spec/nodes/) - SpecNode JSON files
- [Generate Layer Docs Script](../scripts/generate-layer-docs.ts) - Generator implementation
