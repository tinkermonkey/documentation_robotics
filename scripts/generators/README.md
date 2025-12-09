# JSON Schema Generator

Automated generation of JSON Schemas from markdown layer specifications.

## Overview

This module provides tools to automatically generate JSON Schema Draft 7 schemas from markdown specifications, ensuring consistency between documentation and validation schemas.

### Features

- **Automated Extraction**: Parses YAML blocks from markdown files
- **Smart Type Mapping**: Converts markdown type annotations to JSON Schema types
- **Cross-Layer Properties**: Generates nested property structures for cross-layer references
- **Enum Support**: Automatically extracts and includes enum definitions
- **Merge Capability**: Preserves hand-crafted validation rules when updating
- **Rich Output**: Beautiful terminal output with tables and colors

## Architecture

```
markdown_parser.py     → Extract entities from markdown YAML
         ↓
schema_generator.py    → Transform to JSON Schema Draft 7
         ↓
schema_merger.py       → Merge with existing schemas (optional)
         ↓
generate_schemas.py    → CLI orchestrator
```

## Usage

### Generate All Layers

```bash
python cli/scripts/generate_schemas.py --all
```

### Generate Specific Layer

```bash
python cli/scripts/generate_schemas.py --layer 02-business-layer
```

### Preview Changes (Dry Run)

```bash
python cli/scripts/generate_schemas.py --all --dry-run
```

### Update Mode (Merge with Existing)

```bash
python cli/scripts/generate_schemas.py --all --update
```

This mode:

- Uses generated structure as base
- Preserves manual validation rules (`pattern`, `minLength > 1`, etc.)
- Updates descriptions from markdown
- Warns about conflicts

### Check Mode (For Pre-commit)

```bash
python cli/scripts/generate_schemas.py --check-only
```

Returns exit code 0 if schemas are up to date, 1 otherwise.

## Markdown Format

The generator expects YAML blocks in this format:

```yaml
EntityName:
  description: "One-sentence definition"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)
    type: EnumType [enum]

  properties:
    - key: "namespace.field-name"
      value: "data-type" (optional, description)
    - key: "another.field"
      value: "value-type"

  enums:
    EnumType:
      - value1
      - value2
      - value3

  examples:
    - Example 1
    - Example 2
```

### Attribute Format

Attributes follow this pattern:

```
name: type [(format)] [enum] [(optional)]
```

Examples:

- `id: string (UUID) [PK]` → `{"type": "string", "format": "uuid"}`
- `count: integer` → `{"type": "integer"}`
- `enabled: boolean (optional)` → `{"type": "boolean"}` (not in required array)
- `status: StatusType [enum]` → `{"$ref": "#/definitions/StatusType"}`

### Property Format

Properties are cross-layer references:

```yaml
properties:
  - key: "motivation.delivers-value"
    value: "value-id-1,value-id-2" (optional, Value IDs)
```

Generates:

```json
{
  "properties": {
    "motivation": {
      "type": "object",
      "properties": {
        "delivers-value": {
          "type": "string",
          "description": "optional, Value IDs"
        }
      }
    }
  }
}
```

### Inline Descriptions

The parser handles inline descriptions in property values:

```yaml
value: "actor-id-1,actor-id-2" (optional, Security Actor IDs)
```

Automatically converted to:

```yaml
value: "actor-id-1,actor-id-2"
description: "optional, Security Actor IDs"
```

## Schema Output Structure

Generated schemas follow this structure:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://example.com/schemas/NN-layer-name.schema.json",
  "title": "Layer Title Schema",
  "description": "Layer description",
  "type": "object",
  "properties": {
    "entity-names": {
      "type": "array",
      "items": { "$ref": "#/definitions/EntityName" }
    }
  },
  "definitions": {
    "EntityName": {
      "type": "object",
      "description": "...",
      "required": ["id", "name"],
      "properties": {
        "id": { "type": "string", "format": "uuid" },
        "name": { "type": "string", "minLength": 1 },
        "documentation": { "type": "string", "minLength": 1 }
      }
    }
  }
}
```

## Type Mappings

| Markdown          | JSON Schema                            |
| ----------------- | -------------------------------------- |
| `string`          | `{"type": "string"}`                   |
| `string (UUID)`   | `{"type": "string", "format": "uuid"}` |
| `integer`         | `{"type": "integer"}`                  |
| `boolean`         | `{"type": "boolean"}`                  |
| `number`          | `{"type": "number"}`                   |
| `array`           | `{"type": "array"}`                    |
| `object`          | `{"type": "object"}`                   |
| `TypeName [enum]` | `{"$ref": "#/definitions/TypeName"}`   |

## Format Mappings

| Markdown     | JSON Schema Format |
| ------------ | ------------------ |
| `(UUID)`     | `uuid`             |
| `(date)`     | `date`             |
| `(datetime)` | `date-time`        |
| `(email)`    | `email`            |
| `(uri)`      | `uri`              |

## Merge Strategy

When using `--update`, the merger:

1. **Structure**: Use generated schema as base
2. **Descriptions**: Update from markdown (source of truth)
3. **Validation Rules**: Preserve from existing:
   - `pattern` (regex patterns)
   - `minLength` / `maxLength` (if > 1)
   - `minimum` / `maximum`
   - `minItems` / `maxItems`
   - `uniqueItems`
   - `additionalProperties`
   - `examples` (hand-crafted)
4. **Required Fields**: Use generated (markdown is source of truth)
5. **Warnings**: Report conflicts and preserved manual rules

### Example Merge

**Existing Schema:**

```json
{
  "name": {
    "type": "string",
    "minLength": 3,
    "maxLength": 100,
    "pattern": "^[a-zA-Z]"
  }
}
```

**Generated Schema:**

```json
{
  "name": {
    "type": "string",
    "minLength": 1
  }
}
```

**Merged Result:**

```json
{
  "name": {
    "type": "string",
    "minLength": 3,
    "maxLength": 100,
    "pattern": "^[a-zA-Z]"
  }
}
```

## Pre-commit Integration

The generator integrates with pre-commit hooks:

```yaml
- id: check-schemas-up-to-date
  name: Check JSON Schemas match markdown
  entry: python cli/scripts/generate_schemas.py --check-only
  language: system
  files: ^spec/layers/.*\.md$
```

When you edit a layer markdown file and commit:

1. Pre-commit runs `--check-only`
2. If schemas outdated, hook fails with message:

   ```
   The following schemas are missing or outdated:
     - 02-business-layer

   Run: python cli/scripts/generate_schemas.py --all --update
   ```

3. Run the suggested command
4. Review the diff
5. Commit both markdown and schema

## Statistics

Generated from current specification:

```
Total Layers:    12
Total Entities:  165
Total Attributes: ~450
Total Properties: ~150
```

Layer breakdown:

| Layer | Name              | Entities |
| ----- | ----------------- | -------- |
| 01    | Motivation        | 10       |
| 02    | Business          | 13       |
| 03    | Security          | 29       |
| 04    | Application       | 9        |
| 05    | Technology        | 13       |
| 06    | API               | 15       |
| 07    | Data Model        | 14       |
| 08    | Datastore         | 7        |
| 09    | UX                | 10       |
| 10    | Navigation        | 14       |
| 11    | APM/Observability | 14       |
| 12    | Testing           | 17       |

## Implementation Details

### MarkdownLayerParser

Extracts entity definitions from markdown files.

**Key Methods:**

- `parse(markdown_path)` - Main entry point
- `_preprocess_yaml(yaml_content)` - Handles inline descriptions
- `_parse_entity(name, data)` - Parses single entity
- `_parse_attributes(attributes, entity)` - Parses attribute specs
- `_parse_properties(properties, entity)` - Parses cross-layer properties

### JSONSchemaGenerator

Converts LayerSpec to JSON Schema Draft 7.

**Key Methods:**

- `generate_layer_schema(layer_spec)` - Main generation
- `_generate_entity_schema(entity)` - Entity definition
- `_generate_attribute_schema(attr_spec)` - Single attribute
- `_to_array_name(entity_name)` - PascalCase → kebab-case-array

### SchemaMerger

Preserves manual validation rules during updates.

**Key Methods:**

- `merge(generated, existing)` - Main merge logic
- `_merge_object_schema(merged, existing, context)` - Recursive merge
- `get_warnings()` - Retrieve merge warnings

## Testing

### Manual Testing

```bash
# Test single layer
python cli/scripts/generate_schemas.py --layer 02-business-layer --dry-run

# Test all layers
python cli/scripts/generate_schemas.py --all --dry-run

# Validate output
check-jsonschema --schemafile https://json-schema.org/draft-07/schema \
  spec/schemas/02-business-layer.schema.json
```

### Automated Testing

```bash
# Run unit tests
cd cli
pytest tests/generators/

# Run integration tests
pytest tests/integration/test_schema_generation.py
```

## Edge Cases

### 1. Entities Without Properties

BusinessActor has only id, name, documentation:

```yaml
BusinessActor:
  description: "..."
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)
```

Generated schema omits the `properties` object:

```json
{
  "BusinessActor": {
    "type": "object",
    "required": ["id", "name"],
    "properties": {
      "id": { "type": "string", "format": "uuid" },
      "name": { "type": "string", "minLength": 1 },
      "documentation": { "type": "string", "minLength": 1 }
    }
  }
}
```

### 2. Enum Types

EventType enum in BusinessEvent:

```yaml
BusinessEvent:
  attributes:
    type: EventType [enum]

  enums:
    EventType:
      - time-driven
      - state-change
      - external
```

Generated:

```json
{
  "type": { "$ref": "#/definitions/EventType" },
  "definitions": {
    "EventType": {
      "type": "string",
      "enum": ["time-driven", "state-change", "external"]
    }
  }
}
```

### 3. Primary Key Marker

`[PK]` is recognized but not treated as an enum:

```yaml
id: string (UUID) [PK]
```

Generates:

```json
{ "type": "string", "format": "uuid" }
```

NOT:

```json
{ "$ref": "#/definitions/PK" } // ❌ Wrong
```

## Troubleshooting

### YAML Parse Errors

**Problem**: "while parsing a block mapping... expected <block end>"

**Cause**: Inline descriptions without proper quoting

**Solution**: The parser now auto-fixes this, but you can manually fix:

```yaml
# Before (causes error)
value: "something" (description here)

# After (valid YAML)
value: "something"
description: "description here"
```

### Missing Entities

**Problem**: Not all entities appearing in generated schema

**Cause**: YAML blocks not recognized

**Solution**: Ensure YAML blocks:

- Start with ` ```yaml`
- End with ` ``` `
- Have proper entity structure (description or attributes)

### Schema Validation Fails

**Problem**: Generated schema fails JSON Schema validation

**Cause**: Invalid schema structure

**Solution**:

```bash
# Validate schema
check-jsonschema --schemafile https://json-schema.org/draft-07/schema \
  spec/schemas/NN-layer.schema.json

# Check generation warnings
python cli/scripts/generate_schemas.py --layer NN-layer --dry-run
```

## Maintenance

### Adding New Type Mappings

Edit `schema_generator.py`:

```python
TYPE_MAPPINGS = {
    "string": {"type": "string"},
    "your-type": {"type": "your-json-schema-type"},
}
```

### Adding New Format Mappings

Edit `markdown_parser.py`:

```python
def _normalize_format(self, format_str: str) -> str:
    format_map = {
        "uuid": "uuid",
        "your-format": "your-json-schema-format",
    }
    return format_map.get(format_str, format_str)
```

### Updating Merge Strategy

Edit `schema_merger.py`:

```python
PRESERVE_KEYS = {
    "pattern",
    "your-custom-key",  # Add here
}
```

## Future Enhancements

Potential improvements:

1. **Relationship Extraction**: Parse "## Relationships" sections
2. **Change Detection**: Smart diff to detect actual changes
3. **Schema Splitting**: Generate per-entity schemas for reuse
4. **Validation Integration**: Auto-run `dr validate` after generation
5. **Documentation Generation**: Generate markdown from schemas
6. **Custom Validators**: Support for `$defs` and custom keywords

## Contributing

When modifying the generator:

1. Update tests in `cli/tests/generators/`
2. Run full test suite: `pytest cli/tests/`
3. Test with all 12 layers: `python cli/scripts/generate_schemas.py --all --dry-run`
4. Update this README if adding features
5. Follow existing code style (black, ruff)

## License

Part of the Documentation Robotics project. See LICENSE for details.
