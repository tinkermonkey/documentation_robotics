# `dr` CLI Tool - Phase 5 Development Plan

## 1. Overview

This document provides a detailed, actionable development plan for implementing Phase 5 (Advanced Features) of the `dr` CLI tool. Phase 5 is the final phase and adds power-user features including interactive REPL, diff/merge, advanced reporting, and a plugin system.

**Phase 5 Goals:**
- Interactive REPL mode for exploratory work
- Diff and merge capabilities for model evolution
- Advanced reporting system with visualizations
- Plugin architecture for extensibility
- Performance optimization across all features
- Advanced query capabilities

**Target Timeline:** 8 weeks
**Team Size:** 1-2 developers
**Dependencies:** Phases 1-4 must be complete

## 2. Development Approach

### 2.1 Build Strategy

**Feature-by-Feature Implementation:**
- Build REPL infrastructure first (most complex)
- Add diff/merge capabilities
- Implement reporting system
- Create plugin architecture
- Optimize and polish

**Quality Standards:**
- Maintain 80%+ code coverage
- REPL is responsive and intuitive
- Diff algorithm is accurate
- Reports are insightful and actionable
- Plugin API is stable

### 2.2 New Dependencies

```bash
# Install Phase 5 dependencies
pip install prompt_toolkit>=3.0.0   # REPL framework
pip install pygments>=2.15.0        # Syntax highlighting
pip install deepdiff>=6.0.0         # Deep comparison
pip install plotly>=5.14.0          # Interactive charts
pip install tabulate>=0.9.0         # Table formatting
```

## 3. Task Breakdown

### 3.1 Sprint 1: Interactive REPL Foundation (Week 1-2)

#### Task 1.1: REPL Core Infrastructure
**Estimated Time:** 8 hours
**Priority:** Critical
**Dependencies:** Phase 1-4 complete

**Description:**
Create the foundation for the interactive REPL.

**Deliverables:**
- [ ] REPLEngine class
- [ ] Command parser
- [ ] Context management
- [ ] History support
- [ ] Unit tests

**Implementation Steps:**
1. Create REPLEngine class
2. Implement PromptSession with prompt_toolkit
3. Implement command parser (support quoted args)
4. Implement context management:
   - Current model
   - Current layer
   - Current element
   - Working set
5. Implement FileHistory for command history
6. Add AutoSuggestFromHistory
7. Implement basic commands:
   - help
   - exit/quit
   - clear
8. Write unit tests

**Acceptance Criteria:**
- [ ] REPL starts and accepts commands
- [ ] History works
- [ ] Auto-suggest works
- [ ] Context tracked correctly
- [ ] Unit tests pass

---

#### Task 1.2: REPL Command System
**Estimated Time:** 10 hours
**Priority:** Critical
**Dependencies:** Task 1.1

**Description:**
Implement the REPL command system.

**Deliverables:**
- [ ] Command registration system
- [ ] All dr commands available in REPL
- [ ] REPL-specific commands
- [ ] Error handling
- [ ] Unit tests

**Implementation Steps:**
1. Create Command abstract class
2. Implement command registration
3. Integrate existing dr commands:
   - add, find, list, update, remove
   - validate, project, trace
   - export, generate
4. Implement REPL-specific commands:
   - cd (change current layer/element)
   - ls (list current context)
   - pwd (show current context)
   - set (set working set)
   - inspect (detailed element view)
   - history (show command history)
   - alias (create command aliases)
5. Add tab completion for commands
6. Add tab completion for element IDs
7. Write comprehensive unit tests

**Acceptance Criteria:**
- [ ] All dr commands work in REPL
- [ ] REPL-specific commands work
- [ ] Tab completion works
- [ ] Error handling graceful
- [ ] Unit tests pass

**Testing:**
```python
# tests/unit/test_repl.py
from documentation_robotics.interactive.repl import REPLEngine

def test_repl_cd_command(sample_model):
    """Test cd command changes context."""
    repl = REPLEngine(sample_model)

    repl.execute("cd business")
    assert repl.current_layer == "business"

    repl.execute("cd business.service.customer-mgmt")
    assert repl.current_element == "business.service.customer-mgmt"

def test_repl_ls_command(sample_model_with_elements):
    """Test ls command lists elements."""
    repl = REPLEngine(sample_model_with_elements)
    repl.execute("cd business")

    output = repl.execute("ls")

    # Should list business layer elements
    assert "service" in output

def test_repl_completion(sample_model):
    """Test tab completion."""
    repl = REPLEngine(sample_model)

    # Get completions for "cd bu"
    completions = repl.get_completions("cd bu")

    assert "business" in [c.text for c in completions]
```

---

#### Task 1.3: REPL Output Formatting
**Estimated Time:** 6 hours
**Priority:** High
**Dependencies:** Task 1.2

**Description:**
Add rich output formatting to REPL.

**Deliverables:**
- [ ] Syntax highlighting
- [ ] Table formatting
- [ ] Pager for long output
- [ ] Visual enhancements

**Implementation Steps:**
1. Integrate Pygments for syntax highlighting
2. Add YAML/JSON syntax highlighting for element display
3. Add table formatting with Rich
4. Implement pager for long output
5. Add colors and styling
6. Add ASCII art logo
7. Write tests

**Acceptance Criteria:**
- [ ] Output is syntax highlighted
- [ ] Tables formatted nicely
- [ ] Long output paged
- [ ] Visually appealing

---

### 3.2 Sprint 2: REPL Features & Polish (Week 3)

#### Task 2.1: Interactive Workflows
**Estimated Time:** 8 hours
**Priority:** High
**Dependencies:** Task 1.3

**Description:**
Add interactive workflow features to REPL.

**Deliverables:**
- [ ] Guided workflows
- [ ] Interactive prompts
- [ ] Wizards for common tasks
- [ ] Integration tests

**Implementation Steps:**
1. Implement workflow engine
2. Create guided workflows:
   - New element wizard
   - Project wizard (guided projection)
   - Validation wizard (guided fixes)
3. Add interactive prompts with validation
4. Add multi-step operations
5. Write integration tests

**Acceptance Criteria:**
- [ ] Workflows guide user through tasks
- [ ] Prompts validate input
- [ ] Can cancel workflows
- [ ] Integration tests pass

---

#### Task 2.2: Interactive Command
**Estimated Time:** 4 hours
**Priority:** Critical
**Dependencies:** Task 2.1

**Description:**
Implement `dr interactive` command to launch REPL.

**Deliverables:**
- [ ] Interactive command
- [ ] Banner and welcome message
- [ ] Integration with existing model
- [ ] Integration tests

**Implementation Steps:**
1. Create interactive Click command
2. Load model from current directory
3. Show welcome banner
4. Start REPL
5. Handle cleanup on exit
6. Write integration tests

**Acceptance Criteria:**
- [ ] Command launches REPL
- [ ] Model loaded correctly
- [ ] Exit works cleanly
- [ ] Integration tests pass

---

### 3.3 Sprint 3: Diff Engine (Week 4)

#### Task 3.1: Diff Engine Core
**Estimated Time:** 10 hours
**Priority:** Critical
**Dependencies:** Phase 1-4 complete

**Description:**
Implement model comparison and diff generation.

**Deliverables:**
- [ ] DiffEngine class
- [ ] Element-level diffs
- [ ] Deep comparison
- [ ] Diff result data structure
- [ ] Unit tests

**Implementation Steps:**
1. Create DiffEngine class
2. Implement diff() method using DeepDiff
3. Implement _compare_elements()
4. Implement _compare_layers()
5. Create DiffResult data structure:
   - Added elements
   - Removed elements
   - Modified elements (with details)
   - Moved elements
6. Implement _categorize_changes()
7. Implement semantic diff (understand significance)
8. Write comprehensive unit tests

**Acceptance Criteria:**
- [ ] Accurately detects all changes
- [ ] Deep comparison works
- [ ] Semantic understanding
- [ ] Results well-structured
- [ ] Unit tests pass

**Testing:**
```python
# tests/unit/test_diff_engine.py
from documentation_robotics.diff.diff_engine import DiffEngine

def test_diff_added_elements(model_v1, model_v2_with_new_element):
    """Test detecting added elements."""
    diff_engine = DiffEngine(model_v1, model_v2_with_new_element)

    result = diff_engine.diff()

    assert len(result.added) == 1
    assert result.added[0].id == "business.service.new-service"

def test_diff_modified_elements(model_v1, model_v2_modified):
    """Test detecting modified elements."""
    diff_engine = DiffEngine(model_v1, model_v2_modified)

    result = diff_engine.diff()

    assert len(result.modified) > 0
    mod = result.modified[0]
    assert "description" in mod.changes  # Description changed

def test_diff_semantic(model_v1, model_v2_breaking):
    """Test semantic diff detects breaking changes."""
    diff_engine = DiffEngine(model_v1, model_v2_breaking)

    result = diff_engine.diff(semantic=True)

    # Should detect breaking change
    assert any(change.is_breaking for change in result.all_changes())
```

---

#### Task 3.2: Diff Formatting & Output
**Estimated Time:** 6 hours
**Priority:** High
**Dependencies:** Task 3.1

**Description:**
Format and display diff results.

**Deliverables:**
- [ ] Diff formatters
- [ ] Multiple output formats
- [ ] Visualization
- [ ] Unit tests

**Implementation Steps:**
1. Implement text diff formatter (unified diff style)
2. Implement JSON diff formatter
3. Implement HTML diff formatter (with highlighting)
4. Implement summary formatter
5. Add statistics (# added, removed, modified)
6. Add impact analysis (affected layers)
7. Write unit tests

**Acceptance Criteria:**
- [ ] Multiple output formats supported
- [ ] Text format is readable
- [ ] HTML format has highlighting
- [ ] Statistics accurate
- [ ] Unit tests pass

---

#### Task 3.3: Diff Command Implementation
**Estimated Time:** 4 hours
**Priority:** Critical
**Dependencies:** Task 3.2

**Description:**
Implement `dr diff` command.

**Deliverables:**
- [ ] Diff command
- [ ] Options for filtering and formatting
- [ ] Integration tests

**Implementation Steps:**
1. Create diff Click command
2. Add source/target specification (paths, branches, etc.)
3. Add layer filtering
4. Add output format selection
5. Add semantic flag
6. Implement comparison execution
7. Write integration tests

**Acceptance Criteria:**
- [ ] Can compare two model versions
- [ ] Filtering works
- [ ] Output formats work
- [ ] Integration tests pass

---

### 3.4 Sprint 4: Merge & Reporting (Week 5)

#### Task 4.1: Merge Engine
**Estimated Time:** 12 hours
**Priority:** High
**Dependencies:** Task 3.3

**Description:**
Implement model merging capabilities.

**Deliverables:**
- [ ] MergeEngine class
- [ ] Three-way merge
- [ ] Conflict detection
- [ ] Conflict resolution strategies
- [ ] Unit tests

**Implementation Steps:**
1. Create MergeEngine class
2. Implement merge() method
3. Implement three-way merge algorithm:
   - Base version
   - Version A
   - Version B
4. Implement conflict detection
5. Implement conflict resolution strategies:
   - ours (prefer A)
   - theirs (prefer B)
   - manual (require user input)
6. Create MergeResult data structure
7. Write comprehensive unit tests

**Acceptance Criteria:**
- [ ] Three-way merge works
- [ ] Conflicts detected accurately
- [ ] Resolution strategies work
- [ ] Unit tests pass

---

#### Task 4.2: Report Engine Implementation
**Estimated Time:** 10 hours
**Priority:** High
**Dependencies:** Task 1.1

**Description:**
Implement advanced reporting system.

**Deliverables:**
- [ ] ReportEngine class
- [ ] Multiple report types
- [ ] Visualization generation
- [ ] Unit tests

**Implementation Steps:**
1. Create ReportEngine class
2. Implement report types:
   - Coverage report (completeness by layer)
   - Dependency report (element dependencies)
   - Traceability report (end-to-end tracing)
   - Complexity report (model complexity metrics)
   - Compliance report (validation issues)
   - Statistics report (counts, trends)
3. Integrate Plotly for visualizations:
   - Bar charts
   - Pie charts
   - Network graphs
   - Heatmaps
4. Implement HTML report generation
5. Implement CSV/Excel export
6. Write unit tests

**Acceptance Criteria:**
- [ ] All report types work
- [ ] Visualizations render correctly
- [ ] HTML reports are interactive
- [ ] Export formats work
- [ ] Unit tests pass

**Testing:**
```python
# tests/unit/test_report_engine.py
from documentation_robotics.reporting.report_engine import ReportEngine

def test_coverage_report(sample_model):
    """Test coverage report generation."""
    engine = ReportEngine(sample_model)

    report_path = engine.generate_report(
        report_type="coverage",
        output_format="html"
    )

    assert report_path.exists()
    assert report_path.suffix == ".html"

    # Read report
    content = report_path.read_text()
    assert "Coverage Report" in content
    assert "plotly" in content  # Has visualization

def test_dependency_report(sample_model_with_deps):
    """Test dependency report generation."""
    engine = ReportEngine(sample_model_with_deps)

    report_path = engine.generate_report(report_type="dependencies")

    # Should have network graph
    content = report_path.read_text()
    assert "Network" in content or "Graph" in content
```

---

#### Task 4.3: Report Command Implementation
**Estimated Time:** 4 hours
**Priority:** High
**Dependencies:** Task 4.2

**Description:**
Implement `dr report` command.

**Deliverables:**
- [ ] Report command
- [ ] Report type selection
- [ ] Format selection
- [ ] Integration tests

**Implementation Steps:**
1. Create report Click command
2. Add report type selection
3. Add output format selection
4. Add filtering options
5. Implement report generation
6. Add auto-open option for HTML reports
7. Write integration tests

**Acceptance Criteria:**
- [ ] All report types accessible
- [ ] Formats work
- [ ] Filtering works
- [ ] Integration tests pass

---

### 3.5 Sprint 5: Plugin System (Week 6)

#### Task 5.1: Plugin Architecture
**Estimated Time:** 10 hours
**Priority:** Critical
**Dependencies:** All previous phases

**Description:**
Create plugin architecture for extensibility.

**Deliverables:**
- [ ] PluginManager class
- [ ] Plugin base classes
- [ ] Extension points
- [ ] Plugin loading
- [ ] Unit tests

**Implementation Steps:**
1. Create PluginManager class
2. Define extension points:
   - Validators (custom validation rules)
   - Generators (custom code generators)
   - Exporters (custom export formats)
   - Commands (custom REPL commands)
   - Reports (custom report types)
3. Create base plugin classes:
   - ValidatorPlugin
   - GeneratorPlugin
   - ExporterPlugin
   - CommandPlugin
   - ReportPlugin
4. Implement plugin discovery (from .dr/plugins/)
5. Implement plugin loading with importlib
6. Implement plugin validation
7. Add plugin hooks
8. Write unit tests

**Acceptance Criteria:**
- [ ] Plugins can be loaded
- [ ] All extension points work
- [ ] Plugin isolation
- [ ] Error handling
- [ ] Unit tests pass

---

#### Task 5.2: Plugin API & SDK
**Estimated Time:** 8 hours
**Priority:** High
**Dependencies:** Task 5.1

**Description:**
Create plugin development SDK.

**Deliverables:**
- [ ] Plugin API documentation
- [ ] Plugin templates
- [ ] Example plugins
- [ ] Plugin testing utilities

**Implementation Steps:**
1. Document plugin API
2. Create plugin templates for each type
3. Create example plugins:
   - Custom validator
   - Custom exporter
   - Custom report
4. Create plugin testing utilities
5. Create plugin scaffolding command
6. Write documentation

**Acceptance Criteria:**
- [ ] API documented
- [ ] Templates available
- [ ] Examples work
- [ ] Easy to create plugins

---

### 3.6 Sprint 6: Optimization & Final Polish (Week 7-8)

#### Task 6.1: Performance Optimization
**Estimated Time:** 10 hours
**Priority:** High
**Dependencies:** All features complete

**Description:**
Optimize performance across all features.

**Deliverables:**
- [ ] Performance profiling results
- [ ] Optimization implementations
- [ ] Benchmark suite
- [ ] Performance guide

**Focus Areas:**
- Model loading performance
- Query performance
- REPL responsiveness
- Diff algorithm performance
- Report generation performance
- Memory usage optimization

**Optimization Techniques:**
1. Lazy loading for large models
2. Caching frequently accessed data
3. Index optimization
4. Parallel processing where possible
5. Memory-efficient data structures

**Acceptance Criteria:**
- [ ] Load 1000 elements < 2s
- [ ] REPL response < 100ms
- [ ] Diff 1000 elements < 3s
- [ ] Report generation < 5s
- [ ] Memory usage reasonable
- [ ] Benchmarks documented

---

#### Task 6.2: Advanced Query System
**Estimated Time:** 8 hours
**Priority:** Medium
**Dependencies:** Task 6.1

**Description:**
Add advanced query capabilities.

**Deliverables:**
- [ ] Query language/DSL
- [ ] Complex filters
- [ ] Aggregations
- [ ] Query command

**Implementation Steps:**
1. Design query language
2. Implement query parser
3. Implement query executor
4. Add support for:
   - Complex filters (AND, OR, NOT)
   - Property comparisons
   - Cross-layer queries
   - Aggregations (count, group by)
5. Create query command
6. Write tests

**Acceptance Criteria:**
- [ ] Query language works
- [ ] Complex queries supported
- [ ] Aggregations work
- [ ] Tests pass

---

#### Task 6.3: Documentation Completion
**Estimated Time:** 12 hours
**Priority:** Critical
**Dependencies:** All features complete

**Description:**
Complete all documentation for Phase 5 and overall project.

**Deliverables:**
- [ ] Phase 5 feature documentation
- [ ] Complete user guide
- [ ] Plugin development guide
- [ ] Performance tuning guide
- [ ] Migration guides
- [ ] Video tutorials (optional)

**Sections:**
1. Interactive mode guide
2. Diff and merge guide
3. Reporting guide
4. Plugin development guide
5. Performance tuning guide
6. Complete command reference
7. Architecture overview
8. Contributing guide
9. Troubleshooting guide
10. FAQ

**Acceptance Criteria:**
- [ ] All features documented
- [ ] User guide complete
- [ ] Plugin guide complete
- [ ] Examples abundant
- [ ] Clear and well-organized

---

#### Task 6.4: Integration Testing
**Estimated Time:** 8 hours
**Priority:** Critical
**Dependencies:** Task 6.3

**Description:**
Comprehensive integration testing across all phases.

**Deliverables:**
- [ ] End-to-end test suites
- [ ] Cross-phase integration tests
- [ ] Performance test suite
- [ ] Regression test suite

**Test Scenarios:**
1. Complete workflow from init to code generation
2. Multi-user collaboration scenario
3. Large model handling (10,000+ elements)
4. Plugin integration
5. Export ’ Import ’ Diff roundtrip
6. REPL workflow scenarios

**Acceptance Criteria:**
- [ ] All E2E tests pass
- [ ] Cross-phase integration verified
- [ ] Performance tests pass
- [ ] Regression tests pass

---

#### Task 6.5: Release Preparation
**Estimated Time:** 6 hours
**Priority:** Critical
**Dependencies:** All tasks complete

**Description:**
Prepare for 1.0 release.

**Deliverables:**
- [ ] Release notes
- [ ] Migration guide
- [ ] Package metadata
- [ ] Release checklist

**Implementation Steps:**
1. Write comprehensive release notes
2. Create migration guide from earlier versions
3. Update package metadata
4. Create release checklist
5. Prepare announcement
6. Tag release

**Acceptance Criteria:**
- [ ] Release notes complete
- [ ] Migration guide clear
- [ ] Metadata updated
- [ ] Ready for release

---

## 4. Testing Strategy

### 4.1 Unit Tests

**New Components:**
- REPLEngine and commands
- DiffEngine
- MergeEngine
- ReportEngine
- PluginManager
- All plugins

**Coverage Target:** 85%+

### 4.2 Integration Tests

**REPL Tests:**
- Command execution
- Context management
- Workflows
- Error handling

**Diff/Merge Tests:**
- Various diff scenarios
- Merge with conflicts
- Conflict resolution

**Reporting Tests:**
- All report types
- Visualization generation
- Export formats

**Plugin Tests:**
- Plugin loading
- Each extension point
- Plugin isolation

### 4.3 Performance Tests

**Benchmarks:**
- REPL responsiveness
- Large model handling
- Diff performance
- Report generation
- Memory usage

## 5. Feature Matrix

All features across 5 phases:

| Feature | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 |
|---------|---------|---------|---------|---------|---------|
| Model Init |  | | | | |
| Element CRUD |  | | | | |
| Basic Validation |  | | | | |
| Reference Tracking | |  | | | |
| Projection | |  | | | |
| Dependency Tracing | |  | | | |
| ArchiMate Export | | |  | | |
| OpenAPI Export | | |  | | |
| PlantUML Export | | |  | | |
| API Client Gen | | | |  | |
| Database Gen | | | |  | |
| UI Component Gen | | | |  | |
| Test Gen | | | |  | |
| Interactive REPL | | | | |  |
| Diff/Merge | | | | |  |
| Advanced Reports | | | | |  |
| Plugin System | | | | |  |

## 6. Risk Management

### Risk 1: REPL Complexity
**Probability:** High
**Impact:** Medium
**Mitigation:**
- Start with basic REPL
- Incremental feature addition
- Extensive user testing
- Good error messages

### Risk 2: Diff Accuracy
**Probability:** Medium
**Impact:** High
**Mitigation:**
- Leverage proven libraries (DeepDiff)
- Comprehensive test scenarios
- Semantic understanding
- Clear diff output

### Risk 3: Plugin Security
**Probability:** Medium
**Impact:** High
**Mitigation:**
- Plugin validation
- Sandboxing where possible
- Clear security guidelines
- Plugin signing (future)

### Risk 4: Performance Degradation
**Probability:** High
**Impact:** Medium
**Mitigation:**
- Early profiling
- Continuous benchmarking
- Optimization sprints
- Performance budget

## 7. Phase 5 Acceptance Criteria

Phase 5 is complete when:

### Functional Requirements:
- [ ] Interactive REPL works smoothly
- [ ] Diff detects all changes accurately
- [ ] Merge handles conflicts correctly
- [ ] All report types generate successfully
- [ ] Plugin system loads and executes plugins
- [ ] Advanced queries work
- [ ] Performance targets met

### Non-Functional Requirements:
- [ ] Code coverage > 80%
- [ ] REPL responsive (< 100ms)
- [ ] Documentation complete
- [ ] All phases integrated

### Quality Criteria:
- [ ] All E2E tests pass
- [ ] Performance benchmarks met
- [ ] No critical bugs
- [ ] Ready for 1.0 release

## 8. Timeline Summary

| Week | Sprint | Focus | Key Deliverables |
|------|--------|-------|------------------|
| 1-2 | Sprint 1 | REPL Foundation | REPLEngine, commands, formatting |
| 3 | Sprint 2 | REPL Features | Workflows, polish, interactive command |
| 4 | Sprint 3 | Diff Engine | DiffEngine, formatting, diff command |
| 5 | Sprint 4 | Merge & Reporting | MergeEngine, ReportEngine, commands |
| 6 | Sprint 5 | Plugin System | PluginManager, API, examples |
| 7-8 | Sprint 6 | Optimization | Performance, docs, testing, release |

**Total Estimated Time:** 160 hours (8 weeks × 20 hours/week)

## 9. Success Metrics

### User Experience
- **Target:** Intuitive and enjoyable to use
- **Measure:** User satisfaction surveys

### Performance
- **Target:** Responsive for large models
- **Measure:** Benchmark suite

### Extensibility
- **Target:** Easy to create plugins
- **Measure:** Community plugin count

### Completeness
- **Target:** Covers all use cases
- **Measure:** Feature requests vs implemented

## 10. Post-Phase 5: 1.0 Release

After Phase 5 completion:

1. **1.0 Release:** Ship production-ready CLI tool
2. **Community Building:** Foster plugin ecosystem
3. **Integration Partnerships:** Integrate with IDEs, CI/CD
4. **Enterprise Features:** Add enterprise-specific features
5. **Cloud Platform:** Consider cloud-hosted version
6. **Continuous Improvement:** Ongoing optimization and features

---

## 11. Complete Project Summary

**Total Development Time:** 40 weeks (8 weeks × 5 phases)
**Total Estimated Hours:** 800 hours

**Phase Summary:**
- **Phase 1:** Core MVP - Model management, basic validation
- **Phase 2:** Validation & Integrity - References, projection, dependencies
- **Phase 3:** Export - ArchiMate, OpenAPI, PlantUML, Markdown
- **Phase 4:** Code Generation - API clients, database, UI, tests
- **Phase 5:** Advanced Features - REPL, diff/merge, reports, plugins

**Final Deliverables:**
- Production-ready CLI tool
- Complete documentation
- 80%+ code coverage
- Comprehensive test suite
- Plugin ecosystem foundation
- Performance benchmarks
- Migration guides

---

**Document Version:** 1.0
**Last Updated:** 2024-11-22
**Author:** Development Team
