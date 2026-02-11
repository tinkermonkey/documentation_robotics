# Technical Documentation Analysis: CLI Schema-Driven Refactoring (Issue #330)

**Issue:** #330 - Refactor the CLI to work with the newly refactored specification model
**Related Issue:** #316 - Specification model refactoring (completed)
**Status:** Documentation Planning Phase
**Date:** 2026-02-11
**Analysis by:** Technical Writer

---

## Executive Summary

This analysis identifies documentation needs for the CLI refactoring that leverages the schema-driven specification model from Issue #316. The refactoring eliminates hardcoded type definitions by making JSON schemas the single source of truth for all 354 node types and 252 relationship types.

**Key Finding:** Comprehensive documentation already exists in `CLI_SCHEMA_DRIVEN_ARCHITECTURE.md` (1,620 lines). This analysis focuses on **documentation gaps, updates needed, and integration points** rather than duplicating existing content.

**Documentation Strategy:** Enhance existing documentation with practical migration guides, troubleshooting for schema-specific errors, and developer workflows for the new schema-driven architecture.

---

## Table of Contents

1. [API Documentation](#1-api-documentation)
2. [User Documentation](#2-user-documentation)
3. [Developer Documentation](#3-developer-documentation)
4. [System Documentation](#4-system-documentation)
5. [Operations Documentation](#5-operations-documentation)
6. [Documentation Delivery Strategy](#6-documentation-delivery-strategy)

---

## 1. API Documentation

### 1.1 Current State

**Existing Documentation:**
- ✅ `CLI_SCHEMA_DRIVEN_ARCHITECTURE.md` - Comprehensive API reference (lines 19-313)
- ✅ LayerRegistry API fully documented with interfaces and examples
- ✅ SchemaValidator API with ValidationResult interfaces
- ✅ Compiled Validators API with pre-compiled validator functions
- ✅ RelationshipSchemaValidator API with validation methods

**Coverage Assessment:** **90% complete**

### 1.2 Documentation Gaps

#### 1.2.1 Missing API Examples

**Gap:** While interfaces are documented, real-world integration examples are minimal.

**Required Documentation:**

1. **CLI Extension Integration Example**
   - Location: `docs/api-examples/cli-extension-integration.md`
   - Content:
     - How to build a custom CLI command that uses LayerRegistry
     - How to validate custom element types against schemas
     - How to extend relationship validation for custom predicates
   - Code examples showing plugin architecture integration

2. **External Tool Integration Example**
   - Location: `docs/api-examples/external-tool-integration.md`
   - Content:
     - Integrate with CI/CD pipeline (validate models in GitHub Actions)
     - Integrate with IDEs (VS Code extension example)
     - Integrate with documentation generators (read layer metadata)
   - Complete working examples with repository links

3. **Schema Validation in Test Frameworks**
   - Location: `docs/api-examples/testing-with-schemas.md`
   - Content:
     - Unit testing custom validators
     - Integration testing with generated registries
     - Mocking LayerRegistry for isolated tests
   - Example test suites using Bun test framework

#### 1.2.2 API Versioning and Stability

**Gap:** No documentation on API stability guarantees or deprecation policy.

**Required Documentation:**

- **Location:** `docs/api/API_STABILITY.md`
- **Content:**
  - Which APIs are stable vs. experimental
  - Deprecation policy for generated APIs
  - Semantic versioning strategy for schema changes
  - Migration guides when breaking changes occur
  - How to detect API changes (TypeScript compile errors, runtime warnings)

### 1.3 Recommended Additions

**Priority:** Medium

1. **API Cookbook** (`docs/api/API_COOKBOOK.md`)
   - Common recipes for using generated APIs
   - How to batch validate multiple elements
   - How to cache validators efficiently
   - How to handle schema loading errors gracefully

2. **API Performance Guide** (`docs/api/API_PERFORMANCE.md`)
   - Benchmark data for validation operations
   - Optimization techniques (preloading, caching strategies)
   - Memory usage patterns
   - When to use pre-compiled vs. runtime validators

---

## 2. User Documentation

### 2.1 Current State

**Existing Documentation:**
- ✅ `cli/README.md` - Comprehensive user guide (631 lines)
- ✅ User-facing schema validation commands documented
- ✅ Element naming conventions covered
- ✅ Source reference tracking documented
- ✅ `CLI_SCHEMA_DRIVEN_ARCHITECTURE.md` - User documentation section (lines 506-742)

**Coverage Assessment:** **85% complete**

### 2.2 Documentation Gaps

#### 2.2.1 Schema Validation Error Interpretation

**Gap:** Users will encounter new schema validation errors but lack guidance on interpreting AJV error messages.

**Required Documentation:**

- **Location:** `docs/troubleshooting/schema-validation-errors.md`
- **Content:**
  - Common schema validation error types:
    - `required` - Missing required field
    - `enum` - Invalid enum value
    - `type` - Wrong data type
    - `pattern` - String doesn't match regex
    - `additionalProperties` - Unknown field present
    - `format` - Invalid format (UUID, date, etc.)
  - How to read AJV error paths (e.g., `attributes.priority`)
  - Examples of each error type with before/after fixes
  - How to find which schema caused the error
  - Tools for testing schema compliance before committing

**Example Error Documentation Format:**

```markdown
## Error: `enum` constraint violation

### Symptom
```
✗ Schema Validation Error: attributes.priority
  must be equal to one of the allowed values
  Allowed values: ["low", "medium", "high", "critical"]
  Received: "urgent"
```

### Root Cause
The `priority` attribute in `motivation.goal` only accepts predefined values.

### Solution
```bash
# Check valid values for the node type
dr schema node motivation.goal

# Update with valid value
dr update motivation.goal.customer-satisfaction \
  --properties '{"priority": "high"}'
```

### Prevention
Always check valid attribute values before creating elements:
```bash
dr schema node <spec_node_id>
```
```

#### 2.2.2 Schema Discovery Workflow

**Gap:** Users need guidance on discovering what schemas exist and how to use them effectively.

**Required Documentation:**

- **Location:** `docs/guides/schema-discovery-guide.md`
- **Content:**
  - How to list all available node types: `dr schema layers` → `dr schema types <layer>`
  - How to view node schema details: `dr schema node <spec_node_id>`
  - How to find valid relationship types for a node
  - How to understand schema inheritance (base schema + type-specific)
  - Visual diagrams showing schema hierarchy
  - Interactive schema exploration workflow

#### 2.2.3 Migration Guide for Existing Models

**Gap:** Users with existing models need step-by-step migration guidance.

**Required Documentation:**

- **Location:** `docs/guides/SCHEMA_MIGRATION_GUIDE.md`
- **Content:**
  - Pre-migration checklist (backup, version check)
  - Step 1: Validate current model: `dr validate --all --verbose`
  - Step 2: Identify schema violations (categorize by error type)
  - Step 3: Fix violations systematically:
    - Missing required attributes
    - Invalid attribute values
    - Unknown attributes to remove
    - Type mismatches
  - Step 4: Re-validate and verify
  - Step 5: Update CI/CD validation pipelines
  - Automated migration script (if feasible)
  - Rollback procedure if migration fails

### 2.3 Recommended Additions

**Priority:** High

1. **Schema-Aware CLI Usage Guide** (`docs/guides/SCHEMA_AWARE_CLI.md`)
   - How schema-driven validation changes CLI behavior
   - New error messages users will see
   - How to leverage schema introspection commands
   - Workflow: schema discovery → element creation → validation

2. **Conformance Validation Tutorial** (`docs/tutorials/conformance-validation.md`)
   - What conformance means in schema-driven architecture
   - Running conformance checks: `dr conformance`
   - Interpreting conformance reports
   - Fixing non-conforming elements
   - Continuous conformance in CI/CD

---

## 3. Developer Documentation

### 3.1 Current State

**Existing Documentation:**
- ✅ `CLI_SCHEMA_DRIVEN_ARCHITECTURE.md` - Developer documentation section (lines 743-1091)
- ✅ Code generation process documented (`generate-registry.ts`)
- ✅ Schema synchronization documented (`sync-spec-schemas.sh`)
- ✅ Validation pipeline architecture documented
- ✅ Adding new node types workflow documented

**Coverage Assessment:** **80% complete**

### 3.2 Documentation Gaps

#### 3.2.1 Development Workflow with Schema Changes

**Gap:** Developers need clear workflow for making schema changes without breaking the CLI.

**Required Documentation:**

- **Location:** `docs/developer/SCHEMA_DEVELOPMENT_WORKFLOW.md`
- **Content:**
  - Local development setup for schema work
  - How to modify an existing node schema
  - How to add a new node type (complete workflow)
  - How to add a new relationship schema
  - Testing schema changes locally:
    - Run code generation: `bun run scripts/generate-registry.ts`
    - Rebuild CLI: `npm run build`
    - Test with examples: `dr add <layer> <new-type> ...`
    - Validate generated code compiles
  - Debugging schema issues:
    - Invalid JSON schema syntax
    - `allOf` composition errors
    - Reference resolution failures
  - Committing schema changes (spec + bundled + generated)
  - PR checklist for schema changes

#### 3.2.2 Testing Strategy for Schema-Driven Architecture

**Gap:** No comprehensive testing guide for schema validation logic.

**Required Documentation:**

- **Location:** `docs/developer/TESTING_SCHEMA_VALIDATION.md`
- **Content:**
  - Unit testing validators:
    - Mock LayerRegistry for isolated tests
    - Test validator error paths
    - Test schema resolution (cache hits/misses)
  - Integration testing:
    - Test full validation pipeline with real schemas
    - Test code generation produces valid TypeScript
    - Test CLI commands against generated registries
  - Schema regression testing:
    - Maintain test fixtures for each node type
    - Validate fixtures pass with current schemas
    - Detect breaking schema changes automatically
  - Performance testing:
    - Benchmark validation speed (cold vs. warm cache)
    - Memory profiling with all schemas loaded
  - Test organization in `cli/tests/` directory
  - Golden copy pattern for test data

#### 3.2.3 Code Generation Deep Dive

**Gap:** `generate-registry.ts` is referenced but not fully explained.

**Required Documentation:**

- **Location:** `docs/developer/CODE_GENERATION_DEEP_DIVE.md`
- **Content:**
  - Architecture of `generate-registry.ts`
  - How it reads layer instances
  - How it scans node schemas
  - How it extracts metadata
  - How it generates TypeScript code
  - How AJV pre-compilation works
  - Error handling during generation
  - Extending generation for custom metadata
  - Debugging generation issues
  - Code generation best practices

### 3.3 Recommended Additions

**Priority:** High

1. **Schema Design Guidelines** (`docs/developer/SCHEMA_DESIGN_GUIDELINES.md`)
   - Best practices for node schema structure
   - When to use `enum` vs. `pattern`
   - How to design extensible attribute structures
   - Avoiding over-constrained schemas
   - Balancing validation strictness with flexibility
   - Schema versioning strategy

2. **Relationship Schema Design** (`docs/developer/RELATIONSHIP_SCHEMA_DESIGN.md`)
   - How to define valid relationship types
   - Cardinality constraint design
   - Predicate naming conventions
   - Cross-layer relationship rules
   - Testing relationship schemas

3. **Build System Integration** (`docs/developer/BUILD_SYSTEM_INTEGRATION.md`)
   - How schema sync integrates with `npm run build`
   - Build script execution order
   - CI/CD build pipeline for schema changes
   - Caching strategies for faster builds
   - Troubleshooting build failures

---

## 4. System Documentation

### 4.1 Current State

**Existing Documentation:**
- ✅ `CLI_SCHEMA_DRIVEN_ARCHITECTURE.md` - System documentation section (lines 1092-1301)
- ✅ Architecture patterns documented (Registry, Validator, Schema Resolution)
- ✅ Performance characteristics documented
- ✅ Error handling patterns documented

**Coverage Assessment:** **75% complete**

### 4.2 Documentation Gaps

#### 4.2.1 Component Interaction Diagrams

**Gap:** System architecture is described in text but lacks comprehensive diagrams.

**Required Documentation:**

- **Location:** `docs/architecture/SCHEMA_DRIVEN_ARCHITECTURE_DIAGRAMS.md`
- **Content:**
  - Build-time architecture diagram (ASCII art + Mermaid)
    - Schema sources → sync script → bundled schemas → code generation → generated artifacts
  - Runtime architecture diagram
    - CLI commands → core registries → validators → schemas
  - Validation pipeline sequence diagram
    - Element creation → schema validation → naming validation → reference validation → relationship validation
  - Schema resolution flowchart
    - Lookup cache → pre-compiled validator? → load runtime validator? → graceful degradation
  - Data flow diagram
    - User input → command parser → validator → model persistence

#### 4.2.2 Schema Cache Management

**Gap:** Caching strategy is mentioned but not fully detailed.

**Required Documentation:**

- **Location:** `docs/architecture/SCHEMA_CACHE_ARCHITECTURE.md`
- **Content:**
  - Cache structure (Map<SpecNodeId, ValidateFunction>)
  - Cache lifecycle (initialization, population, invalidation)
  - Cache hit/miss metrics
  - Memory management strategies
  - Preloading strategies for common schemas
  - Cache persistence (if applicable)
  - Thread-safety considerations (if relevant)

#### 4.2.3 Error Recovery Architecture

**Gap:** Error handling is documented but recovery strategies are not.

**Required Documentation:**

- **Location:** `docs/architecture/ERROR_RECOVERY_PATTERNS.md`
- **Content:**
  - Validation error recovery (fix and retry)
  - Schema loading failures (graceful degradation)
  - Generated code out-of-sync detection
  - Build failure recovery
  - Rollback strategies for schema changes
  - Backward compatibility handling

### 4.3 Recommended Additions

**Priority:** Medium

1. **Schema Registry Scalability** (`docs/architecture/REGISTRY_SCALABILITY.md`)
   - How registries scale with schema count (354+ node schemas)
   - Memory footprint analysis
   - Lazy loading trade-offs
   - Future optimization opportunities

2. **Version Compatibility Matrix** (`docs/architecture/VERSION_COMPATIBILITY.md`)
   - CLI version vs. Spec version compatibility
   - Schema format version evolution
   - Breaking change detection strategy

---

## 5. Operations Documentation

### 5.1 Current State

**Existing Documentation:**
- ✅ `CLI_SCHEMA_DRIVEN_ARCHITECTURE.md` - Operations documentation section (lines 1302-1619)
- ✅ Schema maintenance workflow documented
- ✅ CI/CD integration examples
- ✅ Troubleshooting common issues
- ✅ Monitoring & metrics guidance

**Coverage Assessment:** **70% complete**

### 5.2 Documentation Gaps

#### 5.2.1 Production Deployment Guide

**Gap:** No guidance on deploying schema-driven CLI in production environments.

**Required Documentation:**

- **Location:** `docs/operations/PRODUCTION_DEPLOYMENT.md`
- **Content:**
  - Pre-deployment validation checklist
  - Schema synchronization in production
  - Rollback procedures for schema changes
  - Monitoring schema validation failures in production
  - Alerting on schema loading errors
  - Health checks for generated registries
  - Performance baseline establishment
  - Log aggregation for validation errors
  - Production incident response for schema issues

#### 5.2.2 Schema Update Procedures

**Gap:** Operational procedures for updating schemas in live systems.

**Required Documentation:**

- **Location:** `docs/operations/SCHEMA_UPDATE_PROCEDURES.md`
- **Content:**
  - Change impact assessment (breaking vs. non-breaking)
  - Testing schema changes in staging
  - Coordinating CLI version with schema version
  - Blue-green deployment for schema updates
  - Canary releases for risky schema changes
  - Communication plan for breaking changes
  - Rollback triggers and procedures
  - Post-update validation

#### 5.2.3 Operational Runbook

**Gap:** No consolidated runbook for common operational issues.

**Required Documentation:**

- **Location:** `docs/operations/SCHEMA_VALIDATION_RUNBOOK.md`
- **Content:**
  - **Issue:** Generated files out of sync
    - Detection: Build errors, validation failures
    - Diagnosis: Check git diff on `cli/src/generated/`
    - Resolution: Run `npm run build`, commit generated files
  - **Issue:** Schema validation extremely slow
    - Detection: Validation taking >5 seconds per element
    - Diagnosis: Cold cache, no preloading
    - Resolution: Implement schema preloading in startup
  - **Issue:** Unknown schema for node type
    - Detection: "Schema file not found" error
    - Diagnosis: Missing schema file or layer instance not updated
    - Resolution: Add schema file, update layer instance, rebuild
  - **Issue:** AJV compilation error
    - Detection: Build fails with schema compilation error
    - Diagnosis: Invalid JSON schema syntax
    - Resolution: Validate schema with `ajv compile` tool
  - Additional 10+ common operational issues

### 5.3 Recommended Additions

**Priority:** High

1. **Monitoring Dashboard Configuration** (`docs/operations/MONITORING_SETUP.md`)
   - Metrics to track (validation latency, cache hit rate, error rate)
   - Setting up Prometheus/Grafana for schema metrics
   - Alert thresholds for validation failures
   - Dashboard templates for schema health

2. **Backup and Recovery** (`docs/operations/BACKUP_RECOVERY.md`)
   - What to back up (schemas, generated code, model data)
   - Backup frequency recommendations
   - Recovery testing procedures
   - Disaster recovery scenarios

---

## 6. Documentation Delivery Strategy

### 6.1 Prioritized Roadmap

#### Phase 1: Critical User-Facing Documentation (Week 1-2)

**High Priority - Blocks User Adoption**

1. **Schema Validation Error Interpretation**
   - `docs/troubleshooting/schema-validation-errors.md`
   - Effort: 8-12 hours
   - Impact: Reduces user confusion, improves error resolution time

2. **Schema Migration Guide**
   - `docs/guides/SCHEMA_MIGRATION_GUIDE.md`
   - Effort: 12-16 hours
   - Impact: Enables existing users to migrate models safely

3. **Schema Discovery Workflow**
   - `docs/guides/schema-discovery-guide.md`
   - Effort: 6-8 hours
   - Impact: Improves user self-service, reduces support questions

**Deliverables:** 3 new guides (26-36 hours total)

---

#### Phase 2: Developer Documentation (Week 3-4)

**High Priority - Enables Contribution**

1. **Schema Development Workflow**
   - `docs/developer/SCHEMA_DEVELOPMENT_WORKFLOW.md`
   - Effort: 10-14 hours
   - Impact: Accelerates schema development, reduces errors

2. **Testing Strategy for Schema Validation**
   - `docs/developer/TESTING_SCHEMA_VALIDATION.md`
   - Effort: 12-16 hours
   - Impact: Improves code quality, reduces regressions

3. **Code Generation Deep Dive**
   - `docs/developer/CODE_GENERATION_DEEP_DIVE.md`
   - Effort: 10-14 hours
   - Impact: Enables extending code generation

**Deliverables:** 3 new guides (32-44 hours total)

---

#### Phase 3: System & Operations Documentation (Week 5-6)

**Medium Priority - Operational Excellence**

1. **Architecture Diagrams**
   - `docs/architecture/SCHEMA_DRIVEN_ARCHITECTURE_DIAGRAMS.md`
   - Effort: 8-12 hours
   - Impact: Improves system understanding

2. **Production Deployment Guide**
   - `docs/operations/PRODUCTION_DEPLOYMENT.md`
   - Effort: 10-14 hours
   - Impact: Reduces production incidents

3. **Operational Runbook**
   - `docs/operations/SCHEMA_VALIDATION_RUNBOOK.md`
   - Effort: 12-16 hours
   - Impact: Accelerates incident resolution

**Deliverables:** 3 new guides (30-42 hours total)

---

#### Phase 4: Advanced & Enhancement Documentation (Week 7+)

**Lower Priority - Continuous Improvement**

1. **API Examples and Cookbook**
   - `docs/api-examples/*` + `docs/api/API_COOKBOOK.md`
   - Effort: 16-20 hours
   - Impact: Enables advanced integrations

2. **Schema Design Guidelines**
   - `docs/developer/SCHEMA_DESIGN_GUIDELINES.md` + `RELATIONSHIP_SCHEMA_DESIGN.md`
   - Effort: 12-16 hours
   - Impact: Improves schema quality

3. **Monitoring and Observability**
   - `docs/operations/MONITORING_SETUP.md`
   - Effort: 8-12 hours
   - Impact: Operational visibility

**Deliverables:** 5+ new guides (36-48 hours total)

---

### 6.2 Total Effort Estimation

| Phase | Documentation Items | Estimated Hours | Priority |
|-------|---------------------|-----------------|----------|
| Phase 1 | 3 guides | 26-36 | Critical |
| Phase 2 | 3 guides | 32-44 | High |
| Phase 3 | 3 guides | 30-42 | Medium |
| Phase 4 | 5+ guides | 36-48 | Lower |
| **Total** | **14+ guides** | **124-170 hours** | - |

**Timeline:** 7-9 weeks for complete documentation coverage

---

### 6.3 Documentation Integration Plan

#### Update Existing Documentation

**Files Requiring Updates:**

1. **`cli/README.md`**
   - Add section on schema-driven validation
   - Link to schema discovery guide
   - Update troubleshooting section with schema errors

2. **`docs/CLI_SCHEMA_DRIVEN_ARCHITECTURE.md`**
   - Add links to new detailed guides
   - Update API examples with links to cookbook
   - Enhance migration section with link to full guide

3. **`CLAUDE.md`**
   - Update development workflow with schema development steps
   - Add schema testing to testing section
   - Reference new troubleshooting guides

4. **`docs/ERROR_HANDLING_GUIDE.md`**
   - Integrate schema validation errors
   - Link to schema-validation-errors.md

**Effort:** 6-10 hours

---

### 6.4 Documentation Maintenance Strategy

#### Continuous Updates

**Triggers for Documentation Updates:**

1. **New Schema Added:** Update schema discovery guide
2. **Breaking API Change:** Update API stability guide, migration guide
3. **New Error Type:** Update troubleshooting guide
4. **Performance Optimization:** Update performance guide
5. **Build Process Change:** Update developer workflow

#### Documentation Review Process

1. **Technical Review:** Validate accuracy against implementation
2. **User Testing:** Test guides with real users (new contributors)
3. **Link Validation:** Verify all cross-references work
4. **Code Example Validation:** Run all code examples to ensure they work
5. **Style Consistency:** Maintain consistent formatting and tone

#### Documentation Metrics

**Track:**
- Documentation page views (top 10 most-accessed guides)
- User feedback (helpful/not helpful)
- Support question frequency (decrease expected)
- Time to onboard new contributors (target: <2 hours for first PR)

---

## 7. Documentation Success Criteria

### 7.1 User Success Metrics

1. **Reduced Support Questions:** 40% reduction in schema-related questions
2. **Faster Error Resolution:** Users resolve validation errors in <5 minutes
3. **Successful Migration:** 90%+ of existing models migrate without assistance
4. **Schema Discovery Adoption:** 60%+ of users use `dr schema` commands

### 7.2 Developer Success Metrics

1. **Faster Onboarding:** New contributors make schema PRs within 1 week
2. **Reduced Schema Errors:** 80% fewer schema syntax errors in PRs
3. **Code Generation Understanding:** Developers can debug generation issues independently
4. **Test Coverage:** Schema validation tests reach 90%+ coverage

### 7.3 Operations Success Metrics

1. **Faster Incident Resolution:** Schema-related incidents resolved in <30 minutes
2. **Reduced Production Errors:** 70% fewer schema validation failures in production
3. **Successful Deployments:** 95%+ schema updates deploy without rollback
4. **Monitoring Adoption:** Operational metrics tracked in 100% of production deployments

---

## 8. Conclusion

### 8.1 Key Findings

1. **Strong Foundation:** Existing `CLI_SCHEMA_DRIVEN_ARCHITECTURE.md` provides 90% of technical API documentation
2. **Critical Gaps:** User-facing error interpretation, migration guides, and operational procedures are missing
3. **Actionable Plan:** Phased approach prioritizes user-blocking issues first, then developer enablement
4. **Realistic Scope:** 124-170 hours (7-9 weeks) for complete documentation coverage

### 8.2 Immediate Next Steps

1. **Week 1:** Create schema validation error troubleshooting guide
2. **Week 1-2:** Write schema migration guide for existing users
3. **Week 2:** Document schema discovery workflow
4. **Week 3:** Begin developer workflow documentation

### 8.3 Long-Term Vision

The schema-driven architecture documentation should serve as a **model for self-service documentation**:
- Users can solve 80% of issues without support
- Developers can contribute schemas without deep CLI knowledge
- Operators can deploy and monitor confidently
- Documentation stays synchronized with implementation

### 8.4 Recommendations

1. **Invest in Phase 1 immediately:** User-facing documentation blocks adoption
2. **Prioritize examples over theory:** Users learn best from working code
3. **Maintain living documentation:** Update docs with every schema change
4. **Test documentation:** Validate all examples work before publishing
5. **Gather feedback:** Iterate based on real user experiences

---

**End of Technical Documentation Analysis**

_For questions or feedback, see [GitHub Issue #330](https://github.com/tinkermonkey/documentation_robotics/issues/330)_
