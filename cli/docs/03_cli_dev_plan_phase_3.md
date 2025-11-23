# `dr` CLI Tool - Phase 3 Development Plan

## 1. Overview

This document provides a detailed, actionable development plan for implementing Phase 3 (Export Capabilities) of the `dr` CLI tool. Phase 3 builds upon Phases 1 and 2 to add comprehensive export capabilities to industry-standard formats.

**Phase 3 Goals:**

- Export models to ArchiMate 3.2 XML format
- Generate OpenAPI 3.0 specifications from API layer
- Export JSON Schema definitions from Data Model layer
- Generate PlantUML diagrams (multiple types)
- Create comprehensive Markdown documentation
- Export GraphML for visualization tools

**Target Timeline:** 8 weeks
**Team Size:** 1-2 developers
**Dependencies:** Phase 1 and Phase 2 must be complete

## 2. Development Approach

### 2.1 Build Strategy

**Format-by-Format Implementation:**

- Build export infrastructure first
- Implement exporters one at a time
- Start with most complex (ArchiMate)
- Test each exporter thoroughly before next
- Create reusable templates

**Quality Standards:**

- Maintain 80%+ code coverage
- All exports validate against target schemas
- Performance: export < 2s for 100 elements
- Generated files are human-readable

### 2.2 New Dependencies

```bash
# Install Phase 3 dependencies
pip install lxml>=4.9.0           # XML generation
pip install plantuml>=0.3.0       # PlantUML diagrams
pip install markdown>=3.4.0       # Markdown processing
```

## 3. Task Breakdown

### 3.1 Sprint 1: Export Infrastructure (Week 1)

#### Task 1.1: Base Exporter Framework

**Estimated Time:** 6 hours
**Priority:** Critical
**Dependencies:** Phase 1 & 2 complete

**Description:**
Create the base exporter infrastructure and common utilities.

**Deliverables:**

- [ ] BaseExporter abstract class
- [ ] ExportFormat enum
- [ ] ExportOptions dataclass
- [ ] Common export utilities
- [ ] Unit tests

**Implementation Steps:**

1. Create BaseExporter abstract class with:
   - export() method
   - validate() method
   - get_supported_options() method
2. Create ExportFormat enum (archimate, openapi, etc.)
3. Create ExportOptions dataclass
4. Implement common utilities:
   - XML helpers
   - JSON helpers
   - File writing with backup
5. Write unit tests

**Acceptance Criteria:**

- [ ] BaseExporter provides clear interface
- [ ] All exporters will inherit from it
- [ ] Common utilities tested
- [ ] Unit tests pass

---

#### Task 1.2: ExportManager Implementation

**Estimated Time:** 8 hours
**Priority:** Critical
**Dependencies:** Task 1.1

**Description:**
Implement the ExportManager to orchestrate exports.

**Deliverables:**

- [ ] ExportManager class
- [ ] Exporter registration system
- [ ] Multi-format export support
- [ ] Template management
- [ ] Unit tests

**Implementation Steps:**

1. Create ExportManager class
2. Implement exporter registration
3. Implement export() method with format selection
4. Implement export_all() for multiple formats
5. Add template path management
6. Add validation hooks
7. Implement progress reporting
8. Write unit tests

**Acceptance Criteria:**

- [ ] Can register exporters
- [ ] Can export to any format
- [ ] Can export multiple formats at once
- [ ] Templates managed correctly
- [ ] Unit tests pass

---

#### Task 1.3: Export Command Framework

**Estimated Time:** 4 hours
**Priority:** Critical
**Dependencies:** Task 1.2

**Description:**
Create the base export command infrastructure.

**Deliverables:**

- [ ] Export command with format selection
- [ ] Common options (output path, overwrite, etc.)
- [ ] Validation integration
- [ ] Integration test framework

**Implementation Steps:**

1. Create export Click command
2. Add --format option
3. Add --output option
4. Add --validate flag
5. Add --overwrite flag
6. Implement basic export flow
7. Add error handling
8. Write integration test framework

**Acceptance Criteria:**

- [ ] Command accepts all common options
- [ ] Error handling works
- [ ] Integration tests can be added easily
- [ ] Help text is clear

---

### 3.2 Sprint 2: ArchiMate Exporter (Week 2-3)

#### Task 2.1: ArchiMate Data Model

**Estimated Time:** 6 hours
**Priority:** Critical
**Dependencies:** Task 1.3

**Description:**
Create data structures for ArchiMate concepts.

**Deliverables:**

- [ ] ArchiMate element types mapping
- [ ] Relationship types mapping
- [ ] Layer mapping
- [ ] Documentation

**Implementation Steps:**

1. Map dr layers to ArchiMate layers
2. Map dr element types to ArchiMate concepts
3. Map dr references to ArchiMate relationships
4. Create mapping configuration
5. Document mappings

**Acceptance Criteria:**

- [ ] All 11 layers map to ArchiMate
- [ ] Element types map correctly
- [ ] Relationships map correctly
- [ ] Mappings documented

---

#### Task 2.2: ArchiMate XML Generation

**Estimated Time:** 12 hours
**Priority:** Critical
**Dependencies:** Task 2.1

**Description:**
Implement ArchiMate 3.2 XML export.

**Deliverables:**

- [ ] ArchiMateExporter class
- [ ] XML generation logic
- [ ] Metadata export
- [ ] Validation against ArchiMate XSD
- [ ] Unit tests

**Implementation Steps:**

1. Create ArchiMateExporter class
2. Implement \_create_root() for XML structure
3. Implement \_add_metadata()
4. Implement \_add_elements() with layer mapping
5. Implement \_add_relationships() from references
6. Implement \_create_views() for diagrams
7. Implement \_add_properties()
8. Add XML formatting and pretty-printing
9. Implement validation against ArchiMate 3.2 XSD
10. Write comprehensive unit tests

**Acceptance Criteria:**

- [ ] Generates valid ArchiMate 3.2 XML
- [ ] All elements exported correctly
- [ ] Relationships exported correctly
- [ ] Validates against official XSD
- [ ] Unit tests pass

**Testing:**

```python
# tests/unit/test_archimate_exporter.py
from documentation_robotics.export.archimate import ArchiMateExporter
from lxml import etree

def test_export_archimate(sample_model):
    """Test ArchiMate export."""
    exporter = ArchiMateExporter(sample_model)

    output_path = exporter.export()

    assert output_path.exists()

    # Parse XML
    tree = etree.parse(str(output_path))
    root = tree.getroot()

    # Verify namespace
    assert "archimate" in root.tag

    # Verify elements section
    elements = root.find(".//elements", namespaces=root.nsmap)
    assert elements is not None
    assert len(elements) > 0

def test_archimate_validation(sample_model, archimate_xsd):
    """Test generated XML validates against XSD."""
    exporter = ArchiMateExporter(sample_model)
    output_path = exporter.export()

    # Validate
    tree = etree.parse(str(output_path))
    is_valid = archimate_xsd.validate(tree)

    assert is_valid
```

---

#### Task 2.3: ArchiMate Views Export

**Estimated Time:** 8 hours
**Priority:** Medium
**Dependencies:** Task 2.2

**Description:**
Add support for exporting ArchiMate views/diagrams.

**Deliverables:**

- [ ] View generation
- [ ] Layout hints
- [ ] Multiple view types
- [ ] Unit tests

**Implementation Steps:**

1. Implement layered view generation
2. Implement element positioning hints
3. Create views for each layer
4. Add cross-layer views
5. Write unit tests

**Acceptance Criteria:**

- [ ] Views generated for all layers
- [ ] Elements positioned reasonably
- [ ] Views open in ArchiMate tools
- [ ] Unit tests pass

---

### 3.3 Sprint 3: OpenAPI & JSON Schema Exporters (Week 4)

#### Task 3.1: OpenAPI Exporter Implementation

**Estimated Time:** 10 hours
**Priority:** Critical
**Dependencies:** Task 1.3

**Description:**
Implement OpenAPI 3.0 specification export from API layer.

**Deliverables:**

- [ ] OpenAPIExporter class
- [ ] Path and operation export
- [ ] Schema generation from data model
- [ ] Security schemes
- [ ] Validation
- [ ] Unit tests

**Implementation Steps:**

1. Create OpenAPIExporter class
2. Implement \_create_openapi_spec() base structure
3. Implement \_add_paths() from API operations
4. Implement \_add_schemas() from data model
5. Implement \_add_security() from security layer
6. Implement \_add_servers()
7. Implement \_add_tags()
8. Add validation against OpenAPI 3.0 schema
9. Support multiple services (multi-file output)
10. Write comprehensive unit tests

**Acceptance Criteria:**

- [ ] Generates valid OpenAPI 3.0 specs
- [ ] All API operations exported
- [ ] Schemas linked to data model
- [ ] Security schemes included
- [ ] Validates with openapi-spec-validator
- [ ] Unit tests pass

**Testing:**

```python
# tests/unit/test_openapi_exporter.py
from documentation_robotics.export.openapi import OpenAPIExporter
import json

def test_export_openapi(sample_model_with_api):
    """Test OpenAPI export."""
    exporter = OpenAPIExporter(sample_model_with_api)

    output_path = exporter.export()

    assert output_path.exists()

    # Load spec
    with open(output_path) as f:
        spec = json.load(f)

    assert spec["openapi"] == "3.0.0"
    assert "paths" in spec
    assert "components" in spec
    assert len(spec["paths"]) > 0

def test_openapi_validation(sample_model_with_api):
    """Test OpenAPI spec validates."""
    from openapi_spec_validator import validate_spec

    exporter = OpenAPIExporter(sample_model_with_api)
    output_path = exporter.export()

    with open(output_path) as f:
        spec = json.load(f)

    # Should not raise
    validate_spec(spec)
```

---

#### Task 3.2: JSON Schema Exporter Implementation

**Estimated Time:** 8 hours
**Priority:** High
**Dependencies:** Task 3.1

**Description:**
Implement JSON Schema Draft 7 export from Data Model layer.

**Deliverables:**

- [ ] JSONSchemaExporter class
- [ ] Entity to schema conversion
- [ ] Relationship handling
- [ ] Validation
- [ ] Unit tests

**Implementation Steps:**

1. Create JSONSchemaExporter class
2. Implement \_entity_to_schema() conversion
3. Implement \_field_to_property() conversion
4. Implement \_add_required_fields()
5. Implement \_add_relationships() as references
6. Support for nested objects
7. Support for arrays
8. Add validation against JSON Schema meta-schema
9. Write unit tests

**Acceptance Criteria:**

- [ ] Generates valid JSON Schema Draft 7
- [ ] All entities exported
- [ ] Types mapped correctly
- [ ] Required fields marked
- [ ] Validates against meta-schema
- [ ] Unit tests pass

---

### 3.4 Sprint 4: PlantUML Exporter (Week 5)

#### Task 4.1: PlantUML Diagram Generator

**Estimated Time:** 12 hours
**Priority:** High
**Dependencies:** Task 1.3

**Description:**
Implement PlantUML diagram generation for multiple diagram types.

**Deliverables:**

- [ ] PlantUMLExporter class
- [ ] Component diagrams
- [ ] Class diagrams
- [ ] Sequence diagrams
- [ ] Deployment diagrams
- [ ] Unit tests

**Implementation Steps:**

1. Create PlantUMLExporter class
2. Implement component diagram generation:
   - Application layer � components
   - Technology layer � deployment
3. Implement class diagram generation:
   - Data model � classes
   - Relationships � associations
4. Implement sequence diagram generation:
   - API operations � sequences
   - Flows from UX to data
5. Implement deployment diagram generation:
   - Technology infrastructure
6. Add styling and formatting
7. Support diagram type selection
8. Write unit tests

**Acceptance Criteria:**

- [ ] Generates valid PlantUML syntax
- [ ] Multiple diagram types supported
- [ ] Diagrams render correctly
- [ ] Element relationships preserved
- [ ] Unit tests pass

**Testing:**

```python
# tests/unit/test_plantuml_exporter.py
from documentation_robotics.export.plantuml import PlantUMLExporter

def test_export_component_diagram(sample_model):
    """Test component diagram generation."""
    exporter = PlantUMLExporter(sample_model)

    output_path = exporter.export(diagram_type="component")

    assert output_path.exists()

    # Read content
    content = output_path.read_text()

    assert "@startuml" in content
    assert "@enduml" in content
    assert "component" in content

def test_export_class_diagram(sample_model_with_data_model):
    """Test class diagram generation."""
    exporter = PlantUMLExporter(sample_model_with_data_model)

    output_path = exporter.export(diagram_type="class")

    content = output_path.read_text()

    assert "class" in content
    # Should have entities as classes
```

---

### 3.5 Sprint 5: Markdown & GraphML Exporters (Week 6)

#### Task 5.1: Markdown Documentation Generator

**Estimated Time:** 10 hours
**Priority:** High
**Dependencies:** Task 1.3

**Description:**
Generate comprehensive Markdown documentation from model.

**Deliverables:**

- [ ] MarkdownExporter class
- [ ] Multi-file documentation structure
- [ ] Index generation
- [ ] Cross-references
- [ ] Diagrams integration
- [ ] Unit tests

**Implementation Steps:**

1. Create MarkdownExporter class
2. Implement directory structure creation
3. Implement index.md generation
4. Implement per-layer documentation
5. Implement per-element detail pages
6. Add cross-reference links
7. Embed diagrams (PlantUML, Mermaid)
8. Add table of contents generation
9. Support templates for custom formatting
10. Write unit tests

**Acceptance Criteria:**

- [ ] Complete documentation structure
- [ ] All elements documented
- [ ] Cross-references work
- [ ] Readable and navigable
- [ ] Unit tests pass

---

#### Task 5.2: GraphML Exporter Implementation

**Estimated Time:** 6 hours
**Priority:** Medium
**Dependencies:** Task 1.3

**Description:**
Export model as GraphML for visualization in tools like yEd, Gephi.

**Deliverables:**

- [ ] GraphMLExporter class
- [ ] Node and edge export
- [ ] Metadata export
- [ ] Validation
- [ ] Unit tests

**Implementation Steps:**

1. Create GraphMLExporter class
2. Implement GraphML XML structure
3. Implement node export (elements)
4. Implement edge export (references)
5. Add metadata attributes
6. Add layer information
7. Add visual hints (colors, shapes)
8. Validate against GraphML schema
9. Write unit tests

**Acceptance Criteria:**

- [ ] Generates valid GraphML
- [ ] Opens in visualization tools
- [ ] Layers distinguished visually
- [ ] Relationships preserved
- [ ] Unit tests pass

---

### 3.6 Sprint 6: Integration & Polish (Week 7-8)

#### Task 6.1: Export Command Completion

**Estimated Time:** 8 hours
**Priority:** Critical
**Dependencies:** All exporters complete

**Description:**
Complete the export command with all format support.

**Deliverables:**

- [ ] Full export command
- [ ] All formats integrated
- [ ] Batch export
- [ ] Validation options
- [ ] Integration tests

**Implementation Steps:**

1. Register all exporters with ExportManager
2. Implement format-specific options
3. Add batch export (--all flag)
4. Add validation integration
5. Add preview mode
6. Add progress reporting
7. Write comprehensive integration tests

**Acceptance Criteria:**

- [ ] All formats accessible via command
- [ ] Format-specific options work
- [ ] Batch export works
- [ ] Progress shown for large exports
- [ ] Integration tests pass

**Testing:**

```python
# tests/integration/test_export.py
from click.testing import CliRunner
from documentation_robotics.cli import cli

def test_export_archimate(initialized_model_with_elements):
    """Test ArchiMate export command."""
    runner = CliRunner()

    result = runner.invoke(cli, [
        "export",
        "--format", "archimate",
        "--output", "specs/archimate/model.xml"
    ], cwd=initialized_model_with_elements)

    assert result.exit_code == 0
    assert Path("specs/archimate/model.xml").exists()

def test_export_all(initialized_model_with_elements):
    """Test exporting all formats."""
    runner = CliRunner()

    result = runner.invoke(cli, [
        "export",
        "--all"
    ], cwd=initialized_model_with_elements)

    assert result.exit_code == 0
    # Check that multiple formats created
    assert Path("specs/archimate").exists()
    assert Path("specs/openapi").exists()
```

---

#### Task 6.2: Template System

**Estimated Time:** 8 hours
**Priority:** High
**Dependencies:** All exporters complete

**Description:**
Create comprehensive template system for customization.

**Deliverables:**

- [ ] Template structure
- [ ] Default templates for all formats
- [ ] Custom template support
- [ ] Template documentation

**Implementation Steps:**

1. Create .dr/templates/ structure
2. Create templates for each export format
3. Implement template loading
4. Add Jinja2 filters for common transforms
5. Add template validation
6. Document template format
7. Create examples

**Acceptance Criteria:**

- [ ] Default templates for all formats
- [ ] Custom templates can override defaults
- [ ] Templates documented
- [ ] Examples provided

---

#### Task 6.3: Export Validation & Quality

**Estimated Time:** 6 hours
**Priority:** High
**Dependencies:** Task 6.1

**Description:**
Add comprehensive validation for exported files.

**Deliverables:**

- [ ] Export validators
- [ ] Quality checks
- [ ] Validation reporting
- [ ] Unit tests

**Implementation Steps:**

1. Implement validation for each format:
   - ArchiMate � XSD validation
   - OpenAPI � spec validator
   - JSON Schema � meta-schema
   - PlantUML � syntax check
   - GraphML � schema validation
2. Add quality checks:
   - Completeness
   - Consistency
   - Formatting
3. Add validation reporting
4. Write unit tests

**Acceptance Criteria:**

- [ ] All exports validate by default
- [ ] Validation can be disabled
- [ ] Validation errors are clear
- [ ] Quality issues reported

---

#### Task 6.4: Documentation & Examples

**Estimated Time:** 8 hours
**Priority:** High
**Dependencies:** All tasks complete

**Description:**
Create comprehensive documentation for export features.

**Deliverables:**

- [ ] Export guide
- [ ] Format-specific guides
- [ ] Template guide
- [ ] Examples
- [ ] Troubleshooting

**Sections:**

1. Export overview
2. ArchiMate export guide
3. OpenAPI export guide
4. JSON Schema export guide
5. PlantUML export guide
6. Markdown export guide
7. GraphML export guide
8. Template customization
9. Troubleshooting exports

**Acceptance Criteria:**

- [ ] All formats documented
- [ ] Examples for each format
- [ ] Template customization explained
- [ ] Troubleshooting guide complete

---

#### Task 6.5: Performance Optimization

**Estimated Time:** 6 hours
**Priority:** Medium
**Dependencies:** Task 6.3

**Description:**
Optimize export performance for large models.

**Deliverables:**

- [ ] Performance profiling
- [ ] Optimization implementations
- [ ] Benchmark results

**Focus Areas:**

- XML generation performance
- Large model handling
- Multi-format batch export
- Template rendering

**Acceptance Criteria:**

- [ ] Export 100 elements < 2s (any format)
- [ ] Batch export 100 elements < 10s (all formats)
- [ ] Memory usage reasonable
- [ ] Benchmarks documented

---

## 4. Testing Strategy

### 4.1 Unit Tests

**Coverage per Exporter:**

- ArchiMateExporter: Element mapping, relationship mapping, XML generation
- OpenAPIExporter: Path generation, schema generation, security
- JSONSchemaExporter: Type mapping, required fields, references
- PlantUMLExporter: Each diagram type
- MarkdownExporter: Structure, cross-references, formatting
- GraphMLExporter: Node/edge generation, metadata

**Coverage Target:** 85%+

### 4.2 Integration Tests

**Export Command Tests:**

- Each format individually
- Batch export
- Format-specific options
- Validation integration
- Error handling

**Validation Tests:**

- Generated files validate against official schemas
- Quality checks pass
- Error messages are helpful

### 4.3 Format Validation Tests

**External Validation:**

- ArchiMate: Validate with Archi tool
- OpenAPI: Validate with Swagger Editor
- PlantUML: Render diagrams
- GraphML: Open in yEd

## 5. Exporter Specifications

### 5.1 ArchiMate Exporter

**Input:** Complete model
**Output:** ArchiMate 3.2 XML file
**Options:**

- include-views: Generate views (default: true)
- view-types: Specify view types
- namespace: Custom namespace

**Layer Mapping:**

```
Motivation � Motivation Layer
Business � Business Layer
Application � Application Layer
Technology � Technology Layer
Security � (Aspect in applicable layers)
API � Application Layer (Interface)
Data Model � Application Layer (Data Object)
Datastore � Technology Layer
UX � Application Layer (Interface)
Navigation � Application Layer
APM � Technology Layer
```

### 5.2 OpenAPI Exporter

**Input:** API layer
**Output:** OpenAPI 3.0 JSON/YAML
**Options:**

- per-service: Generate file per service
- include-security: Include security schemes
- server-urls: Add server URLs
- output-format: JSON or YAML

### 5.3 JSON Schema Exporter

**Input:** Data Model layer
**Output:** JSON Schema Draft 7 files
**Options:**

- per-entity: File per entity
- include-examples: Add example values
- additional-properties: Allow additional properties

### 5.4 PlantUML Exporter

**Input:** All layers
**Output:** PlantUML text files
**Options:**

- diagram-type: component, class, sequence, deployment
- layout: top-bottom, left-right
- style: default, custom
- split-by-layer: Separate diagram per layer

### 5.5 Markdown Exporter

**Input:** Complete model
**Output:** Markdown documentation tree
**Options:**

- include-diagrams: Embed diagrams
- diagram-format: plantuml, mermaid
- depth: Documentation detail level
- template: Custom template

### 5.6 GraphML Exporter

**Input:** Complete model
**Output:** GraphML XML file
**Options:**

- include-attributes: Include all attributes
- visual-hints: Add colors, shapes
- layout-hints: Add positioning info

## 6. Risk Management

### Risk 1: Format Specification Complexity

**Probability:** High
**Impact:** Medium
**Mitigation:**

- Start with simple subset
- Incremental feature addition
- Extensive testing against reference tools
- Clear documentation of supported features

### Risk 2: Performance with Large Models

**Probability:** Medium
**Impact:** Medium
**Mitigation:**

- Streaming XML generation
- Lazy loading where possible
- Progress indicators
- Benchmarking early

### Risk 3: Tool Compatibility

**Probability:** Medium
**Impact:** Low
**Mitigation:**

- Test with target tools
- Follow specifications strictly
- Provide validation
- Document known issues

## 7. Phase 3 Acceptance Criteria

Phase 3 is complete when:

### Functional Requirements

- [ ] ArchiMate export generates valid XML
- [ ] OpenAPI export generates valid specs
- [ ] JSON Schema export generates valid schemas
- [ ] PlantUML export generates renderable diagrams
- [ ] Markdown export generates complete docs
- [ ] GraphML export opens in visualization tools
- [ ] All exports validate against target schemas

### Non-Functional Requirements

- [ ] Code coverage > 80%
- [ ] Export performance < 2s for 100 elements
- [ ] Generated files are human-readable
- [ ] Documentation complete

### Quality Criteria

- [ ] All integration tests pass
- [ ] External tools can import exports
- [ ] Templates customizable
- [ ] No critical bugs

## 8. Timeline Summary

| Week | Sprint   | Focus            | Key Deliverables                |
| ---- | -------- | ---------------- | ------------------------------- |
| 1    | Sprint 1 | Infrastructure   | BaseExporter, ExportManager     |
| 2-3  | Sprint 2 | ArchiMate        | ArchiMate exporter, views       |
| 4    | Sprint 3 | OpenAPI/JSON     | OpenAPI & JSON Schema exporters |
| 5    | Sprint 4 | PlantUML         | PlantUML diagram generation     |
| 6    | Sprint 5 | Markdown/GraphML | Documentation & graph export    |
| 7-8  | Sprint 6 | Integration      | Commands, templates, docs       |

**Total Estimated Time:** 160 hours (8 weeks � 20 hours/week)

## 9. Success Metrics

### Compatibility

- **Target:** 100% valid exports
- **Measure:** External tool validation

### Performance

- **Target:** < 2s export time for 100 elements
- **Measure:** pytest-benchmark

### Usability

- **Target:** Exports usable without modification
- **Measure:** User testing

## 10. Next Steps After Phase 3

1. **Phase 3 Retrospective:** Review export quality
2. **Phase 4 Planning:** Plan code generation features
3. **Tool Integration:** Integrate with CI/CD pipelines
4. **Format Extensions:** Add new export formats based on feedback
5. **Template Library:** Build library of custom templates

---

**Document Version:** 1.0
**Last Updated:** 2024-11-22
**Author:** Development Team
