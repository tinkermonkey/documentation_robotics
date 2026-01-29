# Documentation Robotics Architecture Guide

## Overview

This document describes the internal architecture of the Documentation Robotics CLI, focusing on how different components interact and the design patterns used throughout the codebase.

## Core Architecture Layers

### 1. Command Layer (`cli/src/commands/`)

The command layer implements the CLI interface. Each command:
- Parses user input and options
- Validates input parameters
- Delegates work to core services
- Handles output formatting and error presentation

**Key files:**
- `commands/add.ts` - Add elements to layers
- `commands/validate.ts` - Validate model conformance
- `commands/export.ts` - Export to various formats
- `commands/changeset.ts` - Manage staged changes

### 2. Core Domain Layer (`cli/src/core/`)

The core layer implements the domain model and business logic:

#### Model Management
- **`model.ts`** - Central Model class managing all layers and data persistence
- **`layer.ts`** - Layer container for elements within a specific layer
- **`element.ts`** - Individual architecture element with properties and references
- **`manifest.ts`** - Project metadata and configuration

#### Reference & Relationship Management
- **`reference-registry.ts`** - Tracks cross-layer element references
- **`relationship-registry.ts`** - Tracks intra-layer element relationships
- **`dependency-tracker.ts`** - Analyzes element dependencies and traces paths

#### Staging & Changeset System
- **`changeset.ts`** - Changeset definition and operations
- **`staged-changeset-storage.ts`** - Persistence layer for staged changes
- **`staging-area.ts`** - Changeset lifecycle management (create, stage, commit)
- **`virtual-projection.ts`** - Creates virtual merged views with staged changes applied
- **`base-snapshot-manager.ts`** - Tracks base model state for drift detection

#### Change Detection & Validation
- **`drift-detector.ts`** - Detects changes to base model since changeset creation
- **`changeset-validator.ts`** - Validates staged changes before commit

#### Test Infrastructure
- **`golden-copy-cache.ts`** - Optimizes test initialization with shared cache
- **`projection-engine.ts`** - Auto-generates elements across layers based on rules

### 3. Validation Layer (`cli/src/validators/`)

Validation pipeline with multiple stages:

1. **Schema Validation** - JSON schema compliance (`schema-validator.ts`)
2. **Naming Validation** - Naming convention enforcement (`naming-validator.ts`)
3. **Reference Validation** - Cross-layer reference integrity (`reference-validator.ts`)
4. **Predicate Validation** - Relationship predicate validation (`predicate-validator.ts`)
5. **Semantic Validation** - Business rule validation (`semantic-validator.ts`)

Each validator is independent and can be used standalone or as part of the validation pipeline.

### 4. Export Layer (`cli/src/export/`)

Converts internal model to external formats:
- **ArchiMate** - Layers 1, 2, 4, 5 (XML format)
- **OpenAPI** - Layer 6 (JSON/YAML)
- **JSON Schema** - Layer 7 (JSON)
- **PlantUML** - Visual diagrams
- **Markdown** - Documentation
- **GraphML** - Graph visualization format

### 5. AI Integration Layer (`cli/src/ai/`)

Legacy and current AI integration:
- **`tools.ts`** - Tool definitions for Claude API (legacy SDK-based chat)
- **`claude-client.ts`** - Direct Claude API integration
- **`chat.ts`** - Chat command implementation (uses Claude Code CLI subprocess)

### 6. Telemetry & Observability (`cli/src/telemetry/`)

Instrumentation for performance monitoring:
- **`console-interceptor.ts`** - Captures console output for logging
- **OpenTelemetry integration** - Structured tracing and metrics

## Data Flow Patterns

### Creating an Element

```
Command (add.ts)
  ↓
Validation (validators/)
  ↓
Model.addElement()
  ↓
Layer.addElement()
  ↓
Element creation + Reference registry update
  ↓
Persist to disk
```

### Validating the Model

```
Command (validate.ts)
  ↓
Validation Pipeline:
  1. Schema Validation
  2. Naming Validation
  3. Reference Validation
  4. Semantic Validation
  ↓
Report results
```

### Staging and Committing Changes

```
User creates changeset
  ↓
StagingAreaManager.createChangeset()
  ↓
User stages changes
  ↓
StagedChangesetStorage persists changes
  ↓
VirtualProjectionEngine creates preview
  ↓
User reviews and commits
  ↓
BaseSnapshotManager checks drift
  ↓
Changes applied to base model
  ↓
Manifest updated with changeset history
```

## Key Design Patterns

### 1. Registry Pattern

The **Reference Registry** and **Relationship Registry** maintain mappings of:
- Which elements reference which other elements
- Validation rules for each reference type
- Error context for invalid references

Used in validation and dependency tracing.

### 2. Projection Pattern

**Virtual Projection Engine** creates temporary merged views:
- Reads base model (unchanged)
- Applies staged changes in sequence
- Returns projected model without persisting
- Enables safe preview and validation

Caching with TTL-based expiration improves performance for repeated previews.

### 3. Staging Pattern

**Staging Area** separates edit workflows from persistence:
- Changes are prepared in changesets
- Multiple changesets can coexist
- Base model unchanged until explicit commit
- Drift detection alerts if base model changed

Enables collaborative design and safe refactoring.

### 4. Validation Pipeline

**Validators** are independent and composable:
- Each validator focuses on one concern
- Validators can be used standalone or chained
- Clear error messages for each validation failure
- Extensible for custom validators

### 5. Branded Types

**Type-safe string wrappers** for semantic meaning:
- `Sha256Hash` - SHA256 checksums (not arbitrary strings)
- `ElementId` (planned) - Element identifiers (not strings)
- `LayerName` (planned) - Layer identifiers (not strings)

Prevents accidental misuse at compile time.

## Model Persistence

### Directory Structure

```
documentation-robotics/
├── model/                          # Base model (primary storage)
│   ├── manifest.yaml              # Project metadata
│   ├── 01_motivation/
│   │   └── {element-id}.yaml
│   ├── 02_business/
│   │   └── {element-id}.yaml
│   └── ... (all 12 layers)
│
└── changesets/                     # Staged changes
    ├── {changeset-id}/
    │   ├── metadata.yaml           # Changeset metadata
    │   └── changes.yaml            # Staged changes
    └── ...
```

### File Formats

- **YAML** - Human-readable format for model data
- **Manifest** - Project-wide metadata (manifest.yaml)
- **Element** - Individual architecture elements (one file per element)
- **Changeset** - Staged changes (one file per changeset)

### Migration (Python CLI to TypeScript CLI)

The **Changeset Migration** system auto-migrates changesets from Python CLI format:
- Automatically detects `.dr/changesets/` location
- Migrates to `documentation-robotics/changesets/` on first use
- Creates backup at `.dr.backup/changesets/` for rollback
- Updates internal paths transparently

## Test Infrastructure

### Golden Copy Optimization

**Problem:** Tests require loading complete baseline model repeatedly, slow.

**Solution:** **Golden Copy Cache**
1. Create single shared golden copy at test suite startup
2. Clone from golden copy for each test (faster than copying from source)
3. Each test gets isolated working directory
4. Safe for concurrent test execution

**Performance:** ~20-30% reduction in test initialization time.

**Implementation:**
- `golden-copy.ts` - Test helpers for creating working directories
- `golden-copy-cache.ts` - Manager for shared golden copy
- `setup.ts` - Initializes golden copy at suite startup
- Baseline project: `cli-validation/test-project/baseline/`

### Updating Golden Copy Baseline

To add test data:
1. Edit files in `cli-validation/test-project/baseline/`
2. Next test run automatically creates fresh golden copy
3. All test working directories include new data
4. Document changes in `cli-validation/test-project/baseline/README.md`

## Type System Enhancements

### Public API Types

All public APIs now have proper type definitions:
- `ToolDefinition` - Claude AI tool schema
- `ToolParameter` - Tool input parameter
- `ToolInputSchema` - Tool input structure
- `ToolExecutionResult` - Tool execution result

Replaced loose `any[]` types with specific interfaces.

### Manifest Types

Explicit types for manifest metadata:
- `ModelStatistics` - Statistics about the model
- `CrossReferenceStatistics` - Reference tracking
- `ChangesetHistoryEntry` - Changeset application records
- `PythonCliCompat` - Backward compatibility fields

### Python CLI Compatibility

The `PythonCliCompat` interface documents:
- Fields required for Python CLI v0.8.0 interoperability
- Migration path from Python CLI format
- Changeset history handling
- Legacy layer configuration

## Error Handling Strategy

### CLIError Class

Structured error reporting with:
- Message describing what failed
- Category (e.g., 'validation', 'reference', 'file-io')
- Contextual information
- Suggestions for resolution

Used consistently across command layer and validators.

### Validation Errors

Specific error types for different validation failures:
- `SchemError` - JSON schema violation
- `NamingError` - Naming convention violation
- `ReferenceError` - Invalid cross-layer reference
- `PredicateError` - Invalid relationship type
- `SemanticError` - Business rule violation

## Performance Considerations

### Caching

- **Layer caching** - Layers loaded once and cached
- **Projection caching** - Virtual projections cached with TTL
- **Golden copy cache** - Test baseline cached for fast cloning
- **Lazy loading** - Layers loaded on demand by default

### Lazy Loading

Model can defer layer loading until accessed:
```typescript
const model = await Model.load(basePath, { lazyLoad: true });
const layer = await model.getLayer('api');  // Loaded on first access
```

### Performance Benchmarks

- Startup time: ~150ms (vs. ~1200ms for Python CLI)
- Element creation: <1ms per element
- Validation: <100ms for typical 50-element model
- Export: <500ms to any format

## Extension Points

### Adding Custom Validators

1. Implement `Validator` interface
2. Return validation results with error details
3. Register in validation pipeline
4. Use `npm run build && npm run test`

### Adding Custom Export Formats

1. Implement `Exporter` interface with `export()` method
2. Handle source model type checking
3. Return formatted output
4. Register in export command

### Adding Custom Commands

1. Create command file in `cli/src/commands/`
2. Implement command logic with clear error handling
3. Register in `cli.ts` command router
4. Add integration tests in `cli/tests/integration/`

## Related Documentation

- **[STAGING_GUIDE.md](./STAGING_GUIDE.md)** - Detailed staging workflow documentation
- **[ELEMENT_TYPE_REFERENCE.md](./ELEMENT_TYPE_REFERENCE.md)** - Element type specifications
- **[COLLABORATION_GUIDE.md](./COLLABORATION_GUIDE.md)** - Team collaboration patterns
- **[cli/README.md](../cli/README.md)** - CLI user guide
- **[CLAUDE.md](../CLAUDE.md)** - AI assistant guidelines
