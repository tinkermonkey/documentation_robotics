# `dr` CLI Tool - Phase 2 Development Plan

## 1. Overview

This document provides a detailed, actionable development plan for implementing Phase 2 (Validation & Integrity) of the `dr` CLI tool. Phase 2 builds upon Phase 1's foundation to add comprehensive validation, cross-layer projection capabilities, and dependency tracing.

**Phase 2 Goals:**

- Implement comprehensive schema validation for all 11 layers
- Add cross-reference validation and tracking
- Enable semantic validation rules
- Implement cross-layer projection with rules engine
- Add dependency tracing and impact analysis

**Target Timeline:** 8 weeks
**Team Size:** 1-2 developers
**Dependencies:** Phase 1 must be complete

## 2. Development Approach

### 2.1 Build Strategy

**Incremental Enhancement:**

- Enhance existing validators from Phase 1
- Add reference tracking layer
- Build projection engine
- Add dependency analysis capabilities
- Integrate all components

**Quality Standards:**

- Maintain 80%+ code coverage
- All new components fully tested
- Backward compatible with Phase 1 models
- Performance: projection < 200ms per element

### 2.2 New Dependencies

```bash
# Install Phase 2 dependencies
pip install jinja2>=3.1.0        # Template rendering
pip install networkx>=3.0        # Graph algorithms
pip install jsonpath-ng>=1.5.0   # JSON path queries
```

## 3. Task Breakdown

### 3.1 Sprint 1: Reference Registry (Week 1-2)

#### Task 1.1: Reference Data Model

**Estimated Time:** 4 hours
**Priority:** Critical
**Dependencies:** Phase 1 complete

**Description:**
Create the Reference dataclass and core data structures for tracking references.

**Deliverables:**

- [ ] Reference dataclass with all fields
- [ ] ReferenceType enum
- [ ] Reference validation logic
- [ ] Unit tests

**Implementation Steps:**

1. Create Reference dataclass in reference_registry.py
2. Define ReferenceType enum (projection, composition, aggregation, etc.)
3. Add validation for reference fields
4. Implement **hash** and **eq** for Reference
5. Write unit tests

**Acceptance Criteria:**

- [ ] Reference objects are immutable
- [ ] All reference types supported
- [ ] Hash and equality work correctly
- [ ] Unit tests pass

---

#### Task 1.2: ReferenceRegistry Core Implementation

**Estimated Time:** 10 hours
**Priority:** Critical
**Dependencies:** Task 1.1

**Description:**
Implement the core ReferenceRegistry class with indexing.

**Deliverables:**

- [ ] ReferenceRegistry class
- [ ] Triple indexing (source, target, type)
- [ ] Add/remove/query methods
- [ ] Save/load functionality
- [ ] Unit tests

**Implementation Steps:**

1. Create ReferenceRegistry class
2. Implement **init** with index structures
3. Implement add_reference() with index updates
4. Implement remove_reference() with index cleanup
5. Implement query methods (by_source, by_target, by_type)
6. Implement find_broken_references()
7. Implement find_circular_references()
8. Implement save() and load() methods
9. Write comprehensive unit tests

**Acceptance Criteria:**

- [ ] References indexed by source, target, and type
- [ ] Query performance: O(1) for indexed lookups
- [ ] Broken references detected
- [ ] Circular references detected
- [ ] Can save/load registry
- [ ] All unit tests pass

**Testing:**

```python
# tests/unit/test_reference_registry.py
from documentation_robotics.core.reference_registry import (
    ReferenceRegistry,
    Reference
)

def test_add_reference():
    """Test adding reference to registry."""
    registry = ReferenceRegistry()
    ref = Reference(
        source_id="business.service.customer-mgmt",
        target_id="application.component.customer-svc",
        property_path="implements",
        reference_type="projection"
    )

    registry.add_reference(ref)

    assert len(registry.references) == 1
    assert len(registry.get_references_from("business.service.customer-mgmt")) == 1

def test_find_broken_references(sample_model):
    """Test finding broken references."""
    registry = ReferenceRegistry()

    # Add reference to non-existent element
    ref = Reference(
        source_id="business.service.test",
        target_id="business.service.non-existent",
        property_path="depends_on",
        reference_type="composition"
    )
    registry.add_reference(ref)

    broken = registry.find_broken_references(sample_model)
    assert len(broken) == 1
    assert broken[0].target_id == "business.service.non-existent"

def test_find_circular_references():
    """Test circular reference detection."""
    registry = ReferenceRegistry()

    # Create circular chain: A -> B -> C -> A
    refs = [
        Reference("a", "b", "ref", "composition"),
        Reference("b", "c", "ref", "composition"),
        Reference("c", "a", "ref", "composition")
    ]

    for ref in refs:
        registry.add_reference(ref)

    cycles = registry.find_circular_references()
    assert len(cycles) > 0
    assert "a" in cycles[0]
```

---

#### Task 1.3: Model Integration for References

**Estimated Time:** 6 hours
**Priority:** Critical
**Dependencies:** Task 1.2

**Description:**
Integrate ReferenceRegistry into the Model class.

**Deliverables:**

- [ ] Enhanced Model class with reference tracking
- [ ] Auto-discovery of references in elements
- [ ] Reference updates on element add/remove/update
- [ ] Unit tests

**Implementation Steps:**

1. Add reference_registry field to Model class
2. Implement \_discover_references() method
3. Update add_element() to register references
4. Update remove_element() to clean up references
5. Update update_element() to update references
6. Add get_references() convenience method
7. Write unit tests

**Acceptance Criteria:**

- [ ] References auto-discovered on model load
- [ ] References updated on element changes
- [ ] References cleaned up on element removal
- [ ] Model.validate() checks references
- [ ] All unit tests pass

---

### 3.2 Sprint 2: Enhanced Validation (Week 3)

#### Task 2.1: Cross-Reference Validator

**Estimated Time:** 6 hours
**Priority:** Critical
**Dependencies:** Task 1.3

**Description:**
Implement comprehensive cross-reference validation.

**Deliverables:**

- [ ] CrossReferenceValidator class
- [ ] Broken reference detection
- [ ] Circular reference detection
- [ ] Orphan element detection
- [ ] Unit tests

**Implementation Steps:**

1. Create CrossReferenceValidator class
2. Implement validate() method
3. Implement \_validate_reference_targets()
4. Implement \_validate_reference_sources()
5. Implement \_check_circular_dependencies()
6. Implement \_find_orphan_elements()
7. Add helpful error messages
8. Write unit tests

**Acceptance Criteria:**

- [ ] All broken references reported
- [ ] Circular dependencies detected
- [ ] Orphan elements identified
- [ ] Error messages include fix suggestions
- [ ] All unit tests pass

---

#### Task 2.2: Semantic Validator

**Estimated Time:** 8 hours
**Priority:** High
**Dependencies:** Task 2.1

**Description:**
Implement semantic validation for layer-specific rules.

**Deliverables:**

- [ ] SemanticValidator class
- [ ] Layer-specific validation rules
- [ ] Business logic validation
- [ ] Configuration for custom rules
- [ ] Unit tests

**Implementation Steps:**

1. Create SemanticValidator class
2. Define semantic rule data structure
3. Implement built-in semantic rules:
   - Business services must have at least one application component
   - API operations must reference a data model entity
   - UX screens must have navigation entries
   - Security roles must be used in application layer
4. Implement rule configuration loading
5. Implement rule execution engine
6. Add violation reporting
7. Write unit tests for each rule

**Acceptance Criteria:**

- [ ] Built-in semantic rules work
- [ ] Custom rules can be loaded from config
- [ ] Violations reported with context
- [ ] Rules can be enabled/disabled
- [ ] All unit tests pass

**Testing:**

```python
# tests/unit/test_semantic_validator.py
from documentation_robotics.validators.semantic import SemanticValidator

def test_business_service_needs_component(sample_model):
    """Test business service without component fails."""
    validator = SemanticValidator(sample_model)

    # Add business service without component
    # ... setup code ...

    result = validator.validate()

    assert not result.is_valid()
    assert any("component" in error.message.lower()
              for error in result.errors)

def test_api_operation_references_data_model(sample_model_with_api):
    """Test API operation must reference data model."""
    validator = SemanticValidator(sample_model_with_api)

    result = validator.validate()

    # API without data model reference should fail
    assert len([e for e in result.errors
               if "data model" in e.message.lower()]) > 0
```

---

#### Task 2.3: Enhanced Validate Command

**Estimated Time:** 4 hours
**Priority:** High
**Dependencies:** Task 2.2

**Description:**
Enhance the validate command to use new validators.

**Deliverables:**

- [ ] Enhanced validate command
- [ ] Reference validation reporting
- [ ] Semantic validation reporting
- [ ] Detailed error output
- [ ] Integration tests

**Implementation Steps:**

1. Update validate command to use CrossReferenceValidator
2. Add semantic validation execution
3. Enhance output to show reference errors
4. Add --semantic flag for semantic validation
5. Add --fix-references option (dry-run)
6. Write integration tests

**Acceptance Criteria:**

- [ ] Command runs all validators
- [ ] Reference errors clearly reported
- [ ] Semantic errors clearly reported
- [ ] Output organized by error type
- [ ] Integration tests pass

---

### 3.3 Sprint 3: Projection Engine Core (Week 4)

#### Task 3.1: Projection Rule Data Model

**Estimated Time:** 4 hours
**Priority:** Critical
**Dependencies:** Task 1.3

**Description:**
Create data structures for projection rules.

**Deliverables:**

- [ ] ProjectionRule dataclass
- [ ] Rule validation
- [ ] Rule serialization/deserialization
- [ ] Unit tests

**Implementation Steps:**

1. Create ProjectionRule dataclass
2. Define rule fields (from_layer, to_layer, mappings, etc.)
3. Implement rule validation
4. Implement to_dict() and from_dict()
5. Write unit tests

**Acceptance Criteria:**

- [ ] Rules have all required fields
- [ ] Rules validate correctly
- [ ] Rules serialize to/from YAML
- [ ] Unit tests pass

---

#### Task 3.2: ProjectionEngine Implementation

**Estimated Time:** 12 hours
**Priority:** Critical
**Dependencies:** Task 3.1

**Description:**
Implement the core projection engine.

**Deliverables:**

- [ ] ProjectionEngine class
- [ ] Rule loading
- [ ] Element projection logic
- [ ] Template-based attribute mapping
- [ ] Conflict detection
- [ ] Unit tests

**Implementation Steps:**

1. Create ProjectionEngine class
2. Implement load_rules() from YAML
3. Implement find_applicable_rules()
4. Implement project_element() method:
   - Create target element
   - Apply name template
   - Map properties
   - Add reference to source
   - Validate projected element
5. Implement project_all() for bulk projection
6. Implement conflict detection
7. Implement dry-run mode
8. Write comprehensive unit tests

**Acceptance Criteria:**

- [ ] Rules load from configuration
- [ ] Elements project correctly
- [ ] Templates render correctly
- [ ] Properties map correctly
- [ ] Conflicts detected
- [ ] Dry-run shows what would be created
- [ ] All unit tests pass

**Testing:**

```python
# tests/unit/test_projection_engine.py
from documentation_robotics.core.projection_engine import (
    ProjectionEngine,
    ProjectionRule
)

def test_project_business_to_application(sample_model):
    """Test projecting business service to application component."""
    engine = ProjectionEngine(sample_model)

    rule = ProjectionRule(
        name="business-to-app",
        from_layer="business",
        from_type="service",
        to_layer="application",
        to_type="component",
        name_template="{source.name} Service",
        property_mappings={
            "description": "{source.description}",
            "implements": "{source.id}"
        }
    )
    engine.rules.append(rule)

    # Get business service
    service = sample_model.get_element("business.service.customer-mgmt")

    # Project to application
    component = engine.project_element(service, "application", rule)

    assert component is not None
    assert component.type == "component"
    assert component.layer == "application"
    assert "implements" in component.data
    assert component.data["implements"] == service.id

def test_project_all(sample_model_with_services):
    """Test projecting all services to components."""
    engine = ProjectionEngine(sample_model_with_services)

    # Load rules
    rules_path = Path(__file__).parent / "fixtures" / "projection-rules.yaml"
    engine.load_rules(rules_path)

    # Project all
    results = engine.project_all(dry_run=True)

    assert len(results) > 0
    assert all(r["target_layer"] == "application" for r in results)
```

---

#### Task 3.3: Projection Rules Configuration

**Estimated Time:** 4 hours
**Priority:** High
**Dependencies:** Task 3.2

**Description:**
Create default projection rules for common patterns.

**Deliverables:**

- [ ] Default projection-rules.yaml
- [ ] Documentation for rule format
- [ ] Example rules for all layer pairs
- [ ] Validation for rule files

**Implementation Steps:**

1. Create .dr/projection-rules.yaml template
2. Define rules for common projections:
   - Business � Application
   - Application � Technology
   - Business � API
   - Data Model � Datastore
   - UX � Navigation
3. Document rule format in README
4. Add rule validation
5. Create examples

**Acceptance Criteria:**

- [ ] Default rules cover common cases
- [ ] Rules are well-documented
- [ ] Examples demonstrate all features
- [ ] Rule validation catches errors
- [ ] Documentation complete

---

### 3.4 Sprint 4: Projection Commands (Week 5)

#### Task 4.1: Project Command Implementation

**Estimated Time:** 8 hours
**Priority:** Critical
**Dependencies:** Task 3.2

**Description:**
Implement the `dr project` command.

**Deliverables:**

- [ ] Project command
- [ ] Single element projection
- [ ] Rule selection
- [ ] Dry-run mode
- [ ] Integration tests

**Implementation Steps:**

1. Create project Click command
2. Implement element selection
3. Implement target layer specification
4. Implement rule selection (auto or manual)
5. Implement projection execution
6. Implement conflict handling
7. Add dry-run mode
8. Add verbose output
9. Write integration tests

**Acceptance Criteria:**

- [ ] Can project single element
- [ ] Target layer can be specified
- [ ] Rule can be selected or auto-discovered
- [ ] Dry-run shows what would be created
- [ ] Conflicts reported
- [ ] Integration tests pass

**Testing:**

```python
# tests/integration/test_project.py
from click.testing import CliRunner
from documentation_robotics.cli import cli

def test_project_element(initialized_model_with_rules):
    """Test projecting single element."""
    runner = CliRunner()

    # Add business service first
    result = runner.invoke(cli, [
        "add", "business", "service",
        "--name", "Customer Management"
    ], cwd=initialized_model_with_rules)
    assert result.exit_code == 0

    # Project to application layer
    result = runner.invoke(cli, [
        "project",
        "business.service.customer-management",
        "--to", "application"
    ], cwd=initialized_model_with_rules)

    assert result.exit_code == 0
    assert "Projected to" in result.output

def test_project_dry_run(initialized_model_with_rules):
    """Test projection dry-run."""
    runner = CliRunner()

    result = runner.invoke(cli, [
        "project",
        "business.service.test",
        "--to", "application",
        "--dry-run"
    ], cwd=initialized_model_with_rules)

    assert result.exit_code == 0
    assert "Would create" in result.output
```

---

#### Task 4.2: Project-All Command Implementation

**Estimated Time:** 6 hours
**Priority:** High
**Dependencies:** Task 4.1

**Description:**
Implement the `dr project-all` command for bulk projection.

**Deliverables:**

- [ ] Project-all command
- [ ] Layer-to-layer projection
- [ ] Progress reporting
- [ ] Error handling
- [ ] Integration tests

**Implementation Steps:**

1. Create project-all Click command
2. Implement layer specification (from/to)
3. Implement element filtering
4. Implement batch projection
5. Add progress indicators
6. Add error aggregation
7. Add summary reporting
8. Write integration tests

**Acceptance Criteria:**

- [ ] Can project all elements in a layer
- [ ] Progress shown for large batches
- [ ] Errors aggregated and reported
- [ ] Summary shows created/skipped/failed
- [ ] Integration tests pass

---

### 3.5 Sprint 5: Dependency Tracing (Week 6)

#### Task 5.1: DependencyTracker Implementation

**Estimated Time:** 10 hours
**Priority:** High
**Dependencies:** Task 1.3

**Description:**
Implement dependency tracking and analysis using NetworkX.

**Deliverables:**

- [ ] DependencyTracker class
- [ ] Dependency graph construction
- [ ] Path finding
- [ ] Impact analysis
- [ ] Cycle detection
- [ ] Unit tests

**Implementation Steps:**

1. Create DependencyTracker class
2. Implement graph construction from ReferenceRegistry
3. Implement find_dependencies() (direct dependencies)
4. Implement find_dependents() (reverse dependencies)
5. Implement find_all_dependencies() (transitive closure)
6. Implement find_impacted_elements() (impact analysis)
7. Implement find_dependency_path()
8. Implement get_dependency_depth()
9. Add graph export (DOT, GraphML)
10. Write comprehensive unit tests

**Acceptance Criteria:**

- [ ] Dependency graph built from references
- [ ] Can find direct and transitive dependencies
- [ ] Can perform impact analysis
- [ ] Can find paths between elements
- [ ] Can detect cycles
- [ ] Graph can be exported for visualization
- [ ] All unit tests pass

**Testing:**

```python
# tests/unit/test_dependency_tracker.py
from documentation_robotics.core.dependency_tracker import DependencyTracker

def test_find_dependencies(sample_model_with_refs):
    """Test finding direct dependencies."""
    tracker = DependencyTracker(sample_model_with_refs)

    deps = tracker.find_dependencies("business.service.customer-mgmt")

    assert len(deps) > 0
    # Should include application component and data model

def test_find_impacted_elements(sample_model_with_refs):
    """Test impact analysis."""
    tracker = DependencyTracker(sample_model_with_refs)

    # Find what would be impacted if we change a data model
    impacted = tracker.find_impacted_elements("data_model.entity.customer")

    assert len(impacted) > 0
    # Should include API operations, UX screens, etc.

def test_find_dependency_path(sample_model_with_refs):
    """Test finding path between elements."""
    tracker = DependencyTracker(sample_model_with_refs)

    path = tracker.find_dependency_path(
        "business.service.customer-mgmt",
        "datastore.table.customers"
    )

    assert path is not None
    assert len(path) > 2  # Through application and data model layers
```

---

#### Task 5.2: Trace Command Implementation

**Estimated Time:** 8 hours
**Priority:** High
**Dependencies:** Task 5.1

**Description:**
Implement the `dr trace` command for dependency tracing.

**Deliverables:**

- [ ] Trace command
- [ ] Multiple trace modes (deps, dependents, impact, path)
- [ ] Tree visualization
- [ ] Graph export
- [ ] Integration tests

**Implementation Steps:**

1. Create trace Click command
2. Implement --mode option (dependencies, dependents, impact, path)
3. Implement tree output format
4. Implement table output format
5. Implement graph export (--export-graph)
6. Add depth limiting
7. Add filtering by layer
8. Write integration tests

**Acceptance Criteria:**

- [ ] Can trace dependencies
- [ ] Can trace dependents
- [ ] Can perform impact analysis
- [ ] Can find paths
- [ ] Tree visualization is clear
- [ ] Can export graph for visualization
- [ ] Integration tests pass

**Testing:**

```python
# tests/integration/test_trace.py
from click.testing import CliRunner
from documentation_robotics.cli import cli

def test_trace_dependencies(initialized_model_with_deps):
    """Test tracing dependencies of an element."""
    runner = CliRunner()

    result = runner.invoke(cli, [
        "trace",
        "business.service.customer-mgmt",
        "--mode", "dependencies"
    ], cwd=initialized_model_with_deps)

    assert result.exit_code == 0
    assert "application.component" in result.output

def test_trace_impact(initialized_model_with_deps):
    """Test impact analysis."""
    runner = CliRunner()

    result = runner.invoke(cli, [
        "trace",
        "data_model.entity.customer",
        "--mode", "impact"
    ], cwd=initialized_model_with_deps)

    assert result.exit_code == 0
    # Should show impacted API, UX, etc.
```

---

### 3.6 Sprint 6: Integration & Testing (Week 7-8)

#### Task 6.1: End-to-End Workflows

**Estimated Time:** 8 hours
**Priority:** Critical
**Dependencies:** All previous tasks

**Description:**
Create end-to-end tests for complete workflows.

**Deliverables:**

- [ ] E2E test scenarios
- [ ] Full workflow tests
- [ ] Performance tests
- [ ] Documentation

**Test Scenarios:**

1. **Projection Workflow:**
   - Initialize model
   - Add business services
   - Project to application layer
   - Validate projections
   - Trace dependencies

2. **Validation Workflow:**
   - Create model with broken references
   - Run validation
   - Fix broken references
   - Re-validate
   - Verify clean

3. **Dependency Analysis Workflow:**
   - Create multi-layer model
   - Trace dependencies across layers
   - Perform impact analysis
   - Export dependency graph

**Acceptance Criteria:**

- [ ] All E2E scenarios pass
- [ ] Workflows documented
- [ ] Performance acceptable
- [ ] Integration with Phase 1 verified

---

#### Task 6.2: Performance Optimization

**Estimated Time:** 6 hours
**Priority:** Medium
**Dependencies:** Task 6.1

**Description:**
Optimize performance for large models.

**Deliverables:**

- [ ] Performance profiling
- [ ] Optimization implementations
- [ ] Benchmark results

**Focus Areas:**

- Reference registry lookups
- Dependency graph construction
- Projection performance
- Validation speed

**Acceptance Criteria:**

- [ ] Reference lookups: O(1) average
- [ ] Projection: < 200ms per element
- [ ] Validation: < 5s for 1000 elements
- [ ] Graph construction: < 2s for 1000 elements

---

#### Task 6.3: Documentation Updates

**Estimated Time:** 8 hours
**Priority:** High
**Dependencies:** All previous tasks

**Description:**
Update documentation for Phase 2 features.

**Deliverables:**

- [ ] Updated README
- [ ] Projection guide
- [ ] Validation guide
- [ ] Dependency tracing guide
- [ ] API documentation

**Sections to Add:**

1. Cross-layer projection guide
2. Writing projection rules
3. Understanding validation errors
4. Dependency analysis techniques
5. Reference management
6. Best practices

**Acceptance Criteria:**

- [ ] All new commands documented
- [ ] Examples for all features
- [ ] Troubleshooting guide updated
- [ ] API docs complete

---

#### Task 6.4: Migration Support

**Estimated Time:** 4 hours
**Priority:** Medium
**Dependencies:** Task 6.3

**Description:**
Create migration support for Phase 1 models.

**Deliverables:**

- [ ] Migration script
- [ ] Reference discovery utility
- [ ] Migration documentation

**Implementation Steps:**

1. Create dr migrate command
2. Implement reference discovery for existing models
3. Create reference registry from existing model
4. Validate migration
5. Document process

**Acceptance Criteria:**

- [ ] Phase 1 models migrate cleanly
- [ ] References auto-discovered
- [ ] Migration documented
- [ ] Rollback supported

---

## 4. Testing Strategy

### 4.1 Unit Tests

**New Components to Test:**

- ReferenceRegistry (all methods)
- ProjectionEngine (rule loading, projection logic)
- DependencyTracker (graph operations)
- CrossReferenceValidator
- SemanticValidator

**Coverage Target:** 85%+

### 4.2 Integration Tests

**Command Tests:**

- `dr project` - single element projection
- `dr project-all` - bulk projection
- `dr trace` - all trace modes
- `dr validate` - enhanced validation

**Workflow Tests:**

- Projection workflow
- Validation workflow
- Dependency analysis workflow

### 4.3 Performance Tests

**Benchmarks:**

- Reference registry with 10,000 references
- Projection of 1,000 elements
- Dependency graph with 1,000 nodes
- Validation with broken references

## 5. Risk Management

### Risk 1: Circular Reference Performance

**Probability:** Medium
**Impact:** Medium
**Mitigation:**

- Use NetworkX for efficient cycle detection
- Cache cycle detection results
- Limit search depth

### Risk 2: Projection Rule Complexity

**Probability:** High
**Impact:** Low
**Mitigation:**

- Start with simple rules
- Comprehensive validation
- Good error messages
- Extensive examples

### Risk 3: Backward Compatibility

**Probability:** Low
**Impact:** High
**Mitigation:**

- Maintain Phase 1 API
- Migration script
- Comprehensive testing
- Clear migration docs

## 6. Phase 2 Acceptance Criteria

Phase 2 is complete when:

### Functional Requirements

- [ ] Reference registry tracks all cross-layer references
- [ ] Cross-reference validation detects broken references
- [ ] Semantic validation enforces business rules
- [ ] Projection engine creates elements from rules
- [ ] Dependency tracker analyzes impact
- [ ] All commands work with large models (1000+ elements)

### Non-Functional Requirements

- [ ] Code coverage > 80%
- [ ] Projection performance < 200ms per element
- [ ] Validation performance < 5s for 1000 elements
- [ ] Documentation complete
- [ ] Phase 1 models migrate cleanly

### Quality Criteria

- [ ] All E2E tests pass
- [ ] No critical bugs
- [ ] Performance benchmarks met
- [ ] Migration tested

## 7. Success Metrics

### Functionality

- **Target:** All commands work correctly
- **Measure:** Integration test pass rate

### Performance

- **Target:** < 200ms projection time
- **Measure:** pytest-benchmark

### Validation Coverage

- **Target:** 95% of common errors caught
- **Measure:** Test scenario coverage

## 8. Timeline Summary

| Week | Sprint   | Focus               | Key Deliverables                           |
| ---- | -------- | ------------------- | ------------------------------------------ |
| 1-2  | Sprint 1 | Reference Registry  | ReferenceRegistry, Model integration       |
| 3    | Sprint 2 | Enhanced Validation | CrossReferenceValidator, SemanticValidator |
| 4    | Sprint 3 | Projection Core     | ProjectionEngine, rules                    |
| 5    | Sprint 4 | Projection Commands | `dr project`, `dr project-all`             |
| 6    | Sprint 5 | Dependency Tracing  | DependencyTracker, `dr trace`              |
| 7-8  | Sprint 6 | Integration         | E2E tests, docs, optimization              |

**Total Estimated Time:** 160 hours (8 weeks � 20 hours/week)

## 9. Next Steps After Phase 2

1. **Phase 2 Retrospective:** Review projection and validation effectiveness
2. **Phase 3 Planning:** Plan export capabilities
3. **User Feedback:** Gather feedback on projection rules
4. **Performance Tuning:** Optimize based on real usage
5. **Rule Library:** Build library of common projection patterns

---

**Document Version:** 1.0
**Last Updated:** 2024-11-22
**Author:** Development Team
