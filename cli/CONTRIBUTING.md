# Contributing to Documentation Robotics CLI

This guide is for developers who want to contribute to the Documentation Robotics CLI codebase.

## Development Setup

### Prerequisites

- **Node.js 18+** with npm
- **Bun 1.3+** (recommended for development and testing)
- **Git** for version control

### Clone and Install

```bash
git clone https://github.com/tinkermonkey/documentation_robotics.git
cd documentation_robotics/cli
npm install
```

### Build the CLI

```bash
# Production build (no telemetry overhead)
npm run build

# Development build with telemetry enabled
npm run build:debug

# Copy bundled schemas to dist/
npm run copy-schemas
```

The build process:

1. TypeScript compilation (`tsc`)
2. esbuild bundling for optimal distribution
3. Schema files copied to `dist/schemas/`

### Run Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit                # Unit tests only
npm run test:integration         # Integration tests only
npm run test:validators          # Validator tests only
npm run test:compatibility       # Compatibility tests

# Run with coverage
npm run test:coverage            # Terminal output
npm run test:coverage:html       # HTML report in coverage/
npm run test:coverage:ci         # CI coverage validation
```

### Code Quality

```bash
# Type checking
npm run lint

# Run before committing
npm run type-check
```

## Architecture Overview

### Core Classes

#### Element

Individual architecture items in the model. Supports:

- Properties with type-safe getters/setters
- Array properties with add/get operations
- References to other elements (cross-layer)
- Relationships with other elements (intra-layer)

```typescript
const element = new Element({
  id: "motivation-goal-test",
  type: "Goal",
  name: "Test Goal",
  description: "A test goal",
  properties: { priority: "high" },
});

element.setProperty("owner", "team-a");
element.addToArrayProperty("tags", "important");
```

**Location**: `src/core/element.ts`

#### Layer

Container for elements within a single layer. Supports:

- Add/get/delete/list operations
- Dirty tracking (unsaved changes)
- JSON serialization/deserialization

```typescript
const layer = new Layer("motivation");
layer.addElement(element);

if (layer.isDirty()) {
  await model.saveLayer("motivation");
  layer.markClean();
}
```

**Location**: `src/core/layer.ts`

#### Manifest

Model metadata (JSON-based). Supports:

- Automatic timestamp management
- JSON serialization/deserialization
- Version tracking

```typescript
const manifest = new Manifest({
  name: "Test Model",
  version: "1.0.0",
  description: "A test model",
  specVersion: "0.6.0",
});

const json = JSON.stringify(manifest.toJSON());
const deserialized = Manifest.fromJSON(json);
```

**Location**: `src/core/manifest.ts`

#### Model

Central orchestrator for the complete architecture model. Supports:

- Lazy layer loading
- Manifest management
- Atomic persistence to `.dr/` directory structure

```typescript
// Initialize a new model
const model = await Model.init(".", {
  name: "My Model",
  version: "1.0.0",
});

// Load an existing model
const loaded = await Model.load(".");

// Save changes
await model.saveManifest();
await model.saveDirtyLayers();
```

**Location**: `src/core/model.ts`

#### ReferenceRegistry

Tracks cross-layer references between architecture elements. Provides:

- Add/query references by source, target, or type
- Reference validation and integrity checking
- Impact analysis (find all references to/from an element)
- Statistics on reference usage

```typescript
const refRegistry = new ReferenceRegistry();

refRegistry.addReference({
  source: "01-motivation-goal-create-customer",
  target: "02-business-process-create-order",
  type: "realizes",
});

const refsFrom = refRegistry.getReferencesFrom("01-motivation-goal-create-customer");
const refsTo = refRegistry.getReferencesTo("02-business-process-create-order");
```

**Location**: `src/core/reference-registry.ts`

#### RelationshipRegistry

Manages intra-layer relationships and their semantic metadata. Provides:

- Register relationship types with predicates and metadata
- Query relationships by source, layer, or predicate
- Validate relationship predicates
- Layer-specific relationship rules

```typescript
const relRegistry = new RelationshipRegistry();

relRegistry.registerType({
  id: "depends-on",
  predicate: "depends-on",
  category: "dependency",
});

relRegistry.addRelationship({
  source: "02-process-create-order",
  target: "02-process-validate-order",
  predicate: "depends-on",
});
```

**Location**: `src/core/relationship-registry.ts`

### File I/O Utilities

Atomic file operations for safe persistence:

```typescript
import { ensureDir, writeFile, readFile, writeJSON, readJSON, atomicWrite } from "@/utils/file-io";

// Ensure directory exists
await ensureDir(".dr/layers");

// Atomic write (safe for crash recovery)
await atomicWrite(".dr/manifest.json", content);

// JSON operations
await writeJSON(".dr/layers/motivation.json", data, true);
const loaded = await readJSON(".dr/layers/motivation.json");
```

**Location**: `src/utils/file-io.ts`

### Type Definitions

Core types defined in `src/types/index.ts`:

- `Element` - Architecture item representation
- `LayerData` - Layer serialization format
- `ManifestData` - Manifest metadata
- `Reference` - Cross-layer references
- `Relationship` - Intra-layer relationships
- `ModelOptions` - Model configuration

### Bundled Schemas

All JSON schemas from `spec/schemas/` are bundled into the CLI distribution:

- **Layer Schemas**: 01-motivation through 12-testing
- **Catalogs**: relationship-catalog.json
- **Common Schemas**: predicates, relationships, source-references, layer-extensions

Schemas are loaded at build time via `src/schemas/bundled/` and do not require filesystem access at runtime.

### Validation Pipeline

The CLI uses a multi-stage validation pipeline (`src/validators/`):

1. **Schema Validation** (`schema-validator.ts`) - JSON schema compliance using AJV
2. **Naming Validation** (`naming-validator.ts`) - Element ID naming convention enforcement
3. **Reference Validation** (`reference-validator.ts`) - Cross-layer reference integrity
4. **Semantic Validation** (`semantic-validator.ts`) - Business rule validation

### Export System

Export handlers in `src/export/`:

- **ArchiMate** (`archimate-exporter.ts`) - Layers 1, 2, 4, 5
- **OpenAPI** (`openapi-exporter.ts`) - Layer 6 (API)
- **JSON Schema** (`json-schema-exporter.ts`) - Layer 7 (Data Model)
- **PlantUML** (`plantuml-exporter.ts`) - Visual diagrams
- **Markdown** (`markdown-exporter.ts`) - Documentation
- **GraphML** (`graphml-exporter.ts`) - Graph visualization

## Telemetry & Observability (Development)

The CLI supports comprehensive OpenTelemetry instrumentation for development and testing.

### Features

- **Command Tracing**: All CLI commands create root spans with command name, arguments, and working directory
- **Validator Instrumentation**: Schema, naming, reference, and semantic validation stages produce nested spans
- **Console Logging**: Console output is automatically captured and correlated with traces
- **Test Instrumentation**: Tests can emit spans with test file names, test case names, pass/fail status, and error details
- **Project Context**: All telemetry includes your project name from the manifest
- **Circuit-Breaker Protection**: Graceful degradation if the telemetry collector is unavailable
- **Compile-Time Configuration**: Telemetry code is completely eliminated from production builds

### Setup

#### Start OTEL Collector (Optional)

An example SigNoz configuration is provided in `docs/otel_example/`:

```bash
# From the repository root
./docs/otel_example/signoz-stack.sh start

# Wait for services to initialize (~30 seconds)
# Access SigNoz UI at http://localhost:3301
# OTEL Collector is available at http://localhost:4318
```

⚠️ **Note**: This is an example configuration only. See [`docs/otel_example/README.md`](../docs/otel_example/README.md) for details.

#### Build and Run with Telemetry

```bash
# Build CLI with telemetry enabled
npm run build:debug

# Set telemetry endpoint (optional - defaults to localhost:4318)
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Run CLI commands - traces and logs will be sent to SigNoz
node dist/cli.js validate
node dist/cli.js list motivation
node dist/cli.js add business service my-service --name "My Service"

# View traces and logs in SigNoz UI
# http://localhost:3301
```

#### Verify Tracing

In SigNoz UI (http://localhost:3301):

1. **View Command Traces**:
   - Navigate to "Traces" section
   - Look for spans named `cli.execute`
   - Expand to see nested validator spans
   - Each span shows command name, arguments, and working directory

2. **View Correlated Logs**:
   - Click on a command span
   - Switch to "Logs" tab to see console output
   - Logs include severity level and trace context

3. **Filter by Project**:
   - Use filter `dr.project.name = "YourProjectName"`

#### Test Instrumentation

Tests can emit telemetry using test instrumentation utilities:

```typescript
import { describe, test, beforeAll, afterAll } from "bun:test";
import {
  startTestFileSpan,
  endTestFileSpan,
  instrumentTest,
} from "../../src/telemetry/test-instrumentation.js";

beforeAll(() => {
  startTestFileSpan("tests/unit/my-feature.test.ts");
});

afterAll(() => {
  endTestFileSpan();
});

describe("MyFeature", () => {
  test(
    "should validate input",
    instrumentTest(
      "should validate input",
      async () => {
        // Test logic here
        expect(result).toBe(expected);
      },
      "MyFeature"
    )
  );
});
```

Run tests with telemetry:

```bash
npm run build:debug
npm run test

# View test spans in SigNoz UI
```

#### Stop the Example Stack

```bash
./docs/otel_example/signoz-stack.sh stop

# To remove all data:
./docs/otel_example/signoz-stack.sh clean
```

### Configuration

| Variable                           | Default                    | Purpose                                 |
| ---------------------------------- | -------------------------- | --------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`      | `http://localhost:4318`    | OTLP collector endpoint                 |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | Derived from OTLP_ENDPOINT | Override for logs endpoint              |
| `DR_TELEMETRY`                     | Set by build               | Build-time flag (`npm run build:debug`) |

### Architecture

1. **Resilient OTLP Exporter** - Circuit-breaker pattern (30s backoff on failure)
2. **Resilient Log Exporter** - Same circuit-breaker protection
3. **Console Interceptor** - Captures console output without code changes
4. **Test Instrumentation** - Standard attributes for test spans
5. **Resource Attributes**:
   - `service.name`: `dr-cli`
   - `service.version`: CLI version from package.json
   - `dr.project.name`: Project name from manifest

### Troubleshooting

#### Traces not appearing

1. Verify SigNoz is running:

   ```bash
   curl http://localhost:13133  # OTEL Collector health
   curl http://localhost:3301   # SigNoz UI
   ```

2. Check telemetry build:

   ```bash
   npm run build:debug
   ```

3. Check resource attributes in SigNoz:
   - Filter: `service.name = "dr-cli"`
   - Verify `dr.project.name` in span attributes

#### Circuit-breaker messages

Internal debug messages when the collector is unreachable. CLI continues normally.

### Production vs Development

- **Development**: `npm run build:debug` includes telemetry (~50KB overhead)
- **Production**: `npm run build` has zero telemetry overhead via dead-code elimination

## Code Quality Standards

- **TypeScript**: Strict mode with comprehensive type coverage
- **Linting**: Biome configured for code quality checks
- **Formatting**: Consistent code formatting via Biome
- **Testing**: Comprehensive unit and integration test coverage

## Project Structure

```
cli/
├── src/
│   ├── commands/          # CLI command implementations
│   ├── core/              # Domain models & registries
│   ├── validators/        # Validation pipeline
│   ├── export/            # Export format handlers
│   ├── server/            # Visualization server
│   ├── telemetry/         # OpenTelemetry instrumentation
│   ├── ai/                # Claude AI integration
│   ├── utils/             # Utility functions
│   ├── schemas/           # Schema loading
│   └── types/             # TypeScript type definitions
├── tests/
│   ├── unit/              # Unit tests
│   ├── integration/       # Integration tests
│   └── compatibility/     # Compatibility tests
├── dist/                  # Build output (generated)
├── docs/                  # Developer documentation
└── package.json           # Package configuration
```

## Adding a New Command

1. Create command file in `src/commands/your-command.ts`
2. Implement command using Commander.js patterns
3. Register in `src/cli.ts`
4. Add integration tests in `tests/integration/`
5. Update this documentation

## Making a Release

See `/cli/NPM_PUBLISHING_SETUP.md` for npm publishing setup.

Use the `/dr-release-prep` command for proper release preparation.

## Related Resources

- [Main README](../README.md) - Repository overview
- [Specification](../spec/) - The 12-layer model specification
- [Migration Guide](../docs/migration-from-python-cli.md) - Migrating from Python CLI
- [Design Discussion](https://github.com/tinkermonkey/documentation_robotics/discussions/68)

## License

MIT
