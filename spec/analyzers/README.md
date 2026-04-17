# Analyzers

This directory contains analyzer mapping configurations that define how external code analyzers map their outputs to the Documentation Robotics specification model.

## Four-File Pattern

Each analyzer consists of four JSON files that work together to define how analyzer tool outputs are mapped to DR elements:

### 1. `analyzer.json` — Analyzer Metadata
Defines the analyzer itself: name, description, tool contract, and supported capabilities.

**Required fields:**
- `name` — unique identifier (e.g., `codeprise`)
- `display_name` — human-readable display name
- `mcp_server_name` — MCP server identifier for this analyzer
- `supported_tool_contract` — specifies the contract version and input/output types
- `supported_languages` — array of supported programming languages
- `project_identification` — how this analyzer identifies the project being analyzed

**Example:**
```json
{
  "name": "codeprism",
  "display_name": "CodePrism",
  "mcp_server_name": "codeprism",
  "supported_tool_contract": {
    "version": "1.0",
    "input_type": "codebase",
    "output_type": "semantic_graph"
  },
  "supported_languages": ["typescript", "javascript", "python"],
  "project_identification": {
    "method": "package.json",
    "fields": ["name", "version"]
  }
}
```

### 2. `node-mapping.json` — Node Type Mappings
Maps analyzer output node types to DR model node types across layers.

**Structure:**
- `mappings` — array of node type mappings
- Each mapping includes:
  - `analyzer_node_type` — type identifier from analyzer output
  - `dr_layer` — canonical DR layer (`motivation`, `business`, `security`, `application`, `technology`, `api`, `data-model`, `data-store`, `ux`, `navigation`, `apm`, `testing`)
  - `dr_node_type` — node type within that layer
  - `confidence` — mapping confidence level (`high`, `medium`, `low`)
  - `attribute_mappings` — optional array of analyzer field → DR attribute mappings

**Example:**
```json
{
  "mappings": [
    {
      "analyzer_node_type": "function",
      "dr_layer": "application",
      "dr_node_type": "component",
      "confidence": "high",
      "attribute_mappings": [
        {
          "analyzer_field": "name",
          "dr_attribute": "name"
        }
      ]
    }
  ]
}
```

### 3. `edge-mapping.json` — Relationship Mappings
Maps analyzer relationship types to DR predicate relationships.

**Structure:**
- `mappings` — array of edge/relationship mappings
- Each mapping includes:
  - `analyzer_edge_type` — relationship type from analyzer output
  - `dr_relationship` — predicate name from `predicates.json` (or `null` if not mappable)
  - `directionality_transform` — optional transformation (e.g., `invert`, `bidirectional`)
  - `confidence` — mapping confidence level (`high`, `medium`, `low`)

**Example:**
```json
{
  "mappings": [
    {
      "analyzer_edge_type": "calls",
      "dr_relationship": "uses",
      "directionality_transform": null,
      "confidence": "high"
    }
  ]
}
```

### 4. `extraction-heuristics.json` — Extraction Rules
Defines heuristics and rules for post-processing analyzer output to improve mapping accuracy.

**Structure:**
- `heuristics` — array of extraction rules
- `inference_rules` — optional rules for inferring implicit relationships
- `filtering_rules` — optional rules for filtering noise
- `deduplication_rules` — optional rules for handling duplicate mappings

**Example:**
```json
{
  "heuristics": [
    {
      "name": "infer-module-composition",
      "description": "Infer composition relationships between modules based on file structure",
      "applies_to": ["application.module"],
      "rule": "if file_a contains file_b, then composition relationship"
    }
  ],
  "inference_rules": [],
  "filtering_rules": [],
  "deduplication_rules": []
}
```

## Compilation Flow

When analyzer mappings are added to this directory:

1. **Validation** — Each analyzer's four JSON files are validated against their respective schemas
   - `analyzer.json` → `analyzer-spec.schema.json`
   - `node-mapping.json` → `analyzer-node-mapping.schema.json`
   - `edge-mapping.json` → `analyzer-edge-mapping.schema.json`
   - `extraction-heuristics.json` → `analyzer-heuristics.schema.json`

2. **Compilation** — The spec build process compiles all analyzer mappings into:
   - `spec/dist/analyzers-catalog.json` — consolidated catalog of all analyzers
   - Per-analyzer compiled outputs in `spec/dist/analyzers/{analyzer_name}/`

3. **Distribution** — Compiled analyzer catalogs are synced to CLI:
   - `cli/src/schemas/bundled/analyzers-catalog.json`
   - `cli/src/analyzers/{analyzer_name}/` (mapping files)

4. **Runtime** — The CLI loads the compiled catalog and uses mappings to:
   - Transform analyzer output into DR model elements
   - Validate analyzer outputs during ingestion
   - Track analyzer metadata and capabilities

## Adding a New Analyzer

To add a new analyzer to the specification:

1. **Create subdirectory** — `spec/analyzers/{analyzer_name}/`

2. **Author four mapping files:**
   ```bash
   spec/analyzers/{analyzer_name}/
   ├── analyzer.json
   ├── node-mapping.json
   ├── edge-mapping.json
   └── extraction-heuristics.json
   ```

3. **Validate** — Each file must conform to its schema:
   - All required fields present
   - Canonical layer names used (not underscores or alternative forms)
   - Edge mappings reference existing predicates from `predicates.json`
   - Confidence values are `high`, `medium`, or `low`

4. **Compile** — Run the build command (once available):
   ```bash
   npm run build:spec
   ```

5. **Test** — Validate the compiled output and sync to CLI:
   ```bash
   cd cli && npm run build
   ```

6. **Commit** — Both the source mappings and compiled outputs go in a single commit

## Why Mappings Live in Spec

Analyzer mappings reside in the specification layer (not the CLI) because:

1. **Single Source of Truth** — Mappings are normative definitions of the DR model, not implementation details
2. **Separation of Concerns** — CLI loads pre-compiled mappings; spec owns authoring and validation
3. **Version Control** — Spec version bumps when mappings change, ensuring CLI stays synchronized
4. **Extensibility** — Other tools can depend on the published specification
5. **Auditability** — All mapping decisions and changes are tracked in spec history

## Schema References

For detailed schema definitions, see:
- `spec/schemas/base/analyzer-spec.schema.json`
- `spec/schemas/base/analyzer-node-mapping.schema.json`
- `spec/schemas/base/analyzer-edge-mapping.schema.json`
- `spec/schemas/base/analyzer-heuristics.schema.json`
