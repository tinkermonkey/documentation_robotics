# Documentation Robotics Scripts

This directory contains tools for validating, generating, and analyzing the Documentation Robotics specification.

## Overview

The scripts have been consolidated into **3 core scripts**:

1. **`validate.py`** - Unified validation (markdown, schemas, relationships, structure)
2. **`generate_schemas.py`** - Generate JSON schemas from layer specifications
3. **`generate_reports.py`** - Generate all reports (cross-layer docs, intra-layer docs, traceability, catalog, GraphML)

## Quick Start

```bash
# Activate virtual environment
source .venv/bin/activate

# Run all validations
python scripts/validate.py --all

# Generate all schemas
python scripts/generate_schemas.py --all

# Generate all reports
python scripts/generate_reports.py --all
```

## Core Scripts

### 1. Validation (`validate.py`)

Unified validation tool that consolidates all validation types.

**Validation Types:**

- **Markdown**: Entity definitions, attributes, structure
- **Schemas**: JSON Schema Draft 7 syntax, $ref resolution
- **Relationships**: Cross-layer and intra-layer links
- **Structure**: Documentation template compliance

**Usage:**

```bash
# Run all validations
python scripts/validate.py --all

# Specific validation types
python scripts/validate.py --markdown [--layer 02-business]
python scripts/validate.py --schemas
python scripts/validate.py --relationships [--layer 02-business]
python scripts/validate.py --structure [--layer 02-business]

# Output control
python scripts/validate.py --all --strict           # Warnings as errors
python scripts/validate.py --all --format json      # JSON output
python scripts/validate.py --all --output custom/   # Custom output directory
```

**Outputs:**

- `reports/validation/validation-report.md`
- `reports/validation/validation-report.json`

---

### 2. Schema Generation (`generate_schemas.py`)

Generates JSON Schema definitions from layer markdown specifications.

**Usage:**

```bash
# Generate all schemas
python scripts/generate_schemas.py --all

# Specific layer
python scripts/generate_schemas.py --layer 02-business

# With validation
python scripts/generate_schemas.py --all --validate
```

**Outputs:**

- `spec/schemas/01-motivation-layer.schema.json`
- `spec/schemas/02-business-layer.schema.json`
- ... (12 total)

---

### 3. Report Generation (`generate_reports.py`)

Unified report generation tool that creates all documentation and exports.

**Report Types:**

1. **Cross-Layer Relationship Documentation** - How each layer connects to other layers
2. **Intra-Layer Relationship Documentation** - Relationships within each layer
3. **Traceability Matrices** - Goal/requirement/value/constraint traceability
4. **Link Instance Catalog** - Catalog of all link instances
5. **GraphML Export** - Ontology export for visualization tools (Gephi, yEd, Cytoscape)

**Usage:**

```bash
# Generate all reports
python scripts/generate_reports.py --all

# Specific report types
python scripts/generate_reports.py --cross-layer --all-layers
python scripts/generate_reports.py --intra-layer --layer 02-business
python scripts/generate_reports.py --traceability
python scripts/generate_reports.py --catalog
python scripts/generate_reports.py --graphml

# GraphML without entities (smaller file)
python scripts/generate_reports.py --graphml --no-entities

# Custom output directory
python scripts/generate_reports.py --all --output custom/reports
```

**Outputs:**

```
reports/
├── layers/                      # Cross-layer and intra-layer docs
│   ├── 01-motivation-cross-layer.md
│   ├── 01-motivation-intra-layer.md
│   ├── 02-business-cross-layer.md
│   ├── 02-business-intra-layer.md
│   └── ... (24 files total - 12 cross-layer + 12 intra-layer)
├── traceability/                # Traceability matrices
│   ├── motivation-to-testing.md
│   ├── business-to-technology.md
│   ├── requirements-to-tests.md
│   └── goals-to-implementation.md
├── catalog/                     # Link instance catalog
│   ├── link-instances.md
│   └── link-instances.json
├── validation/                  # Validation reports
│   ├── validation-report.md
│   └── validation-report.json
└── visualization/               # GraphML exports
    └── spec-ontology.graphml
```

---

## Directory Structure

```
scripts/
├── README.md                    # This file
├── validate.py                  # Unified validation script
├── generate_schemas.py          # Schema generation script
├── generate_reports.py          # Unified report generation script
├── validation/                  # Validation modules
│   ├── markdown_validator.py
│   ├── schema_validator.py
│   ├── structure_validator.py
│   └── relationship_validator.py
├── generators/                  # Report generation modules
│   ├── layer_doc_generator.py
│   ├── intra_layer_report_generator.py
│   ├── traceability_generator.py
│   ├── graphml_exporter.py
│   └── markdown_parser.py
├── analysis/                    # Analysis modules
│   ├── intra_layer_analyzer.py
│   └── link_instance_catalog.py
└── utils/                       # Utility modules
    ├── link_registry.py
    └── relationship_parser.py
```

---

## Common Workflows

### Complete Validation and Report Generation

```bash
# 1. Validate everything
python scripts/validate.py --all

# 2. Generate schemas
python scripts/generate_schemas.py --all

# 3. Generate all reports
python scripts/generate_reports.py --all
```

### Validate and Document a Single Layer

```bash
# Validate specific layer
python scripts/validate.py --markdown --layer 02-business
python scripts/validate.py --relationships --layer 02-business

# Generate documentation for that layer
python scripts/generate_reports.py --cross-layer --layer 02-business
python scripts/generate_reports.py --intra-layer --layer 02-business
```

### Export for Visualization

```bash
# Generate GraphML for visualization tools
python scripts/generate_reports.py --graphml

# Open in visualization tool:
#   - Gephi: File → Open → reports/visualization/spec-ontology.graphml
#   - yEd: File → Open → reports/visualization/spec-ontology.graphml
#   - Cytoscape: File → Import → Network from File
```

---

## Migration from Old Scripts

The following old scripts have been consolidated:

**Validation** (now in `validate.py`):

- `validate_markdown.py`
- `validate_links.py`
- `tools/validate_layer_structure.py`
- `validation/validate_enhanced_schemas.py`

**Report Generation** (now in `generate_reports.py`):

- `docs_generate.py`
- `generate_intra_layer_docs.py`
- `catalog_link_instances.py`
- `visualize_ontology.py`

**Removed** (ontology analysis features):

- `analyze_ontology.py`
- `query_ontology.py`
- `manage_registry.py`
- `analysis/gap_analyzer.py`
- `analysis/link_coverage_analyzer.py`
- `analysis/predicate_extractor.py`
- `reports/ontology_assessment.py`

**Old Commands → New Commands:**

```bash
# OLD
python scripts/validate_markdown.py --all
python scripts/validate_links.py
python scripts/validate_enhanced_schemas.py

# NEW
python scripts/validate.py --all

# OLD
python scripts/docs_generate.py --type relationships --all
python scripts/generate_intra_layer_docs.py --all
python scripts/catalog_link_instances.py
python scripts/visualize_ontology.py --type export

# NEW
python scripts/generate_reports.py --all
```

---

## Requirements

- Python 3.10+
- Dependencies (install via `pip install -r requirements.txt`):
  - `pyyaml>=6.0`
  - `jsonschema>=4.0`
  - `rich>=13.0`
  - `networkx>=3.1`
  - `jsonpath-ng>=1.5`

---

## Support

For issues or questions:

- Check validation reports in `reports/validation/`
- Review output of `--help` for each script
- See individual module docstrings for details
