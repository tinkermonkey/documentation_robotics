# Documentation Robotics CLI

TypeScript-based CLI for managing federated architecture data models across 12 interconnected layers.

## Overview

This is the Documentation Robotics CLI - a production-ready command-line tool for creating, managing, and exporting comprehensive architecture models that span business requirements through technical implementation.

## Foundation

- ✅ Project structure initialized
- ✅ TypeScript configuration (strict mode)
- ✅ Core domain models (Element, Layer, Model, Manifest)
- ✅ Reference and Relationship registries for tracking dependencies
- ✅ File I/O utilities with atomic writes
- ✅ JSON schemas bundled (all 12 layers)
- ✅ Comprehensive unit tests
- ✅ Code formatted and configured for linting

## Directory Structure

```
cli/
├── src/
│   ├── cli.ts                          # Entry point
│   ├── core/                           # Domain models
│   │   ├── element.ts                  # Individual architecture items
│   │   ├── layer.ts                    # Layer containers
│   │   ├── model.ts                    # Complete model orchestration
│   │   ├── manifest.ts                 # Model metadata (JSON)
│   │   ├── reference-registry.ts       # Cross-layer reference tracking
│   │   └── relationship-registry.ts    # Intra-layer relationship management
│   ├── types/
│   │   └── index.ts                    # TypeScript type definitions
│   ├── utils/
│   │   └── file-io.ts                  # File operations (atomic writes)
│   └── schemas/
│       └── bundled/                    # All JSON schemas from spec/
│           ├── 01-motivation-layer.schema.json
│           ├── 02-business-layer.schema.json
│           ├── ... (all 12 layer schemas)
│           ├── relationship-catalog.json
│           ├── link-registry.json
│           └── common/
│               ├── relationships.schema.json
│               ├── predicates.schema.json
│               └── ...
├── tests/
│   └── unit/
│       ├── core/
│       │   ├── element.test.ts
│       │   ├── layer.test.ts
│       │   ├── manifest.test.ts
│       │   ├── model.test.ts
│       │   ├── reference-registry.test.ts
│       │   ├── relationship-registry.test.ts
│       │   └── element.integration.test.js
│       └── utils/
│           └── file-io.test.ts
├── dist/                               # Compiled JavaScript
├── package.json
├── tsconfig.json
├── biome.json
└── README.md
```

## Installation & Setup

### Prerequisites

- **Node.js 18+** (npm included)
- **Bun 1.3+** (optional, recommended for best performance)
- A Documentation Robotics model directory (`.dr/`)

### Quick Start

```bash
# Install the CLI globally
npm install -g @documentation-robotics/cli

# Or install locally in your project
npm install @documentation-robotics/cli

# Run CLI
dr --version
dr --help
```

### Development Setup

For contributing to the CLI:

```bash
# Clone the repository
git clone https://github.com/tinkermonkey/documentation_robotics.git
cd documentation_robotics/cli

# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests with Bun (preferred)
bun test

# Or run tests with Node.js
npm test

# Format code
npm run format

# Run CLI locally during development
node dist/cli.js --help
```

### Installation Methods

#### Option 1: Global Installation (Recommended)

```bash
# Using npm
npm install -g @documentation-robotics/cli

# Using bun
bun add -g @documentation-robotics/cli

# Verify installation
dr --version
```

#### Option 2: Project-Local Installation

```bash
# Install as a dev dependency
npm install --save-dev @documentation-robotics/cli

# Or add to package.json and run npm install
{
  "devDependencies": {
    "@documentation-robotics/cli": "^0.1.0"
  }
}

# Run via npx
npx dr --help
```

#### Option 3: Build from Source

```bash
# Clone and build
git clone https://github.com/tinkermonkey/documentation_robotics.git
cd documentation_robotics/cli
npm install
npm run build

# Install globally from built dist
npm install -g .

# Or run directly
node dist/cli.js --help
```

### Configuration

#### Claude Code CLI Setup (for Chat Features)

Chat functionality requires **Claude Code CLI** to be installed and authenticated with your Anthropic account.

**Install Claude Code:**

1. Visit https://claude.ai/download
2. Follow installation instructions for your platform
3. Authenticate with your Anthropic account when prompted

Verify installation:

```bash
# Check Claude Code CLI is available
which claude

# Run without a model directory to test
claude --version
```

#### Visualization Server

```bash
# Run visualization server with custom port
dr visualize --port 3000

# Run without auto-opening browser
dr visualize --no-browser
```

#### Telemetry & Observability (Optional)

The CLI supports comprehensive OpenTelemetry instrumentation for tracing, logging, and observability during development and testing. Telemetry is completely optional and incurs **zero overhead in production builds** due to compile-time constant elimination.

##### Features

- **Command Tracing**: All CLI commands create root spans with command name, arguments, and working directory
- **Validator Instrumentation**: Schema, naming, reference, and semantic validation stages produce nested spans
- **Console Logging**: Console output (`console.log`, `console.error`, etc.) is automatically captured and correlated with traces
- **Test Instrumentation**: Tests can emit spans with test file names, test case names, pass/fail status, and error details
- **Project Context**: All telemetry includes your project name from the manifest for easy filtering
- **Circuit-Breaker Protection**: Graceful degradation if the telemetry collector is unavailable—no user-facing errors or blocking
- **Compile-Time Configuration**: Telemetry code is completely eliminated from production builds via dead-code elimination

##### Setup

###### Prerequisites

- Docker and Docker Compose (for running SigNoz locally)
- Node.js 18+

###### Start SigNoz Stack

Use the provided helper script to run a complete telemetry stack locally:

```bash
# From the repository root
./signoz-stack.sh start

# Wait for services to initialize (~30 seconds)
# Access SigNoz UI at http://localhost:3301
# OTEL Collector is available at http://localhost:4318
```

The stack includes:
- **OTEL Collector** (HTTP receiver on port 4318)
- **PostgreSQL** (trace storage)
- **Redis** (caching)
- **SigNoz Query Service** (trace API)
- **SigNoz Frontend** (UI for visualization)

###### Build and Run CLI with Telemetry

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

###### Verify Tracing

In SigNoz UI (http://localhost:3301):

1. **View Command Traces**:
   - Navigate to "Traces" section
   - Look for spans named `cli.execute`
   - Expand to see nested validator spans (`validation.stage.schema`, `validation.stage.naming`, etc.)
   - Each span shows command name, arguments, working directory, and project name

2. **View Correlated Logs**:
   - Click on a command span to view details
   - Switch to "Logs" tab to see console output captured during command execution
   - Logs include severity level (INFO, WARN, ERROR) and trace context (traceId, spanId)

3. **Filter by Project**:
   - Use the filter `dr.project.name = "YourProjectName"` to isolate telemetry for a specific project
   - Useful when multiple projects share the same collector

###### Test Instrumentation

Tests can emit telemetry to verify logging behavior. Use the test instrumentation utilities:

```typescript
import { describe, test, beforeAll, afterAll } from 'bun:test';
import {
  startTestFileSpan,
  endTestFileSpan,
  instrumentTest,
} from '../../src/telemetry/test-instrumentation.js';

beforeAll(() => {
  startTestFileSpan('tests/unit/my-feature.test.ts');
});

afterAll(() => {
  endTestFileSpan();
});

describe('MyFeature', () => {
  test(
    'should validate input',
    instrumentTest(
      'should validate input',
      async () => {
        // Test logic here
        expect(result).toBe(expected);
      },
      'MyFeature' // Suite name for organization
    )
  );
});
```

Run tests with telemetry:

```bash
npm run build:debug
npm run test

# View test spans in SigNoz UI with attributes:
# - test.file: Path to test file
# - test.name: Test case name
# - test.suite: Describe block name
# - test.status: 'pass', 'fail', or 'skip'
# - test.error.message and test.error.stack (for failed tests)
```

###### Stop SigNoz Stack

```bash
./signoz-stack.sh stop

# To remove all data and start fresh:
./signoz-stack.sh clean
```

##### Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP collector endpoint (applies to both traces and logs) |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | Derived from OTLP_ENDPOINT | Override for logs endpoint specifically |
| `DR_TELEMETRY` | Determined by build | Build-time flag (set via `npm run build:debug`) |

##### Architecture

The telemetry system consists of:

1. **Resilient OTLP Exporter** - Exports traces with circuit-breaker pattern (30s backoff on failure)
2. **Resilient Log Exporter** - Exports logs with same circuit-breaker protection
3. **Console Interceptor** - Captures console output without modifying application code
4. **Test Instrumentation** - Provides utilities for creating test spans with standard attributes
5. **Resource Attributes** - Every trace and log includes:
   - `service.name`: `dr-cli`
   - `service.version`: CLI version from package.json
   - `dr.project.name`: Project name from manifest (if available, else `unknown`)

##### Troubleshooting

###### Traces not appearing in SigNoz

1. **Verify SigNoz is running:**
   ```bash
   curl http://localhost:13133  # OTEL Collector health check
   curl http://localhost:3301   # SigNoz UI
   ```

2. **Check telemetry build:**
   ```bash
   # Verify build was done with DR_TELEMETRY=true
   npm run build:debug
   ```

3. **Verify endpoint connectivity:**
   ```bash
   node dist/cli.js validate
   # If SigNoz is unavailable, circuit-breaker activates silently after 500ms timeout
   ```

4. **Check resource attributes:**
   - In SigNoz, search for traces with filter `service.name = "dr-cli"`
   - Verify `dr.project.name` appears in span attributes

###### "Circuit-breaker activated" messages

These are internal debug messages and do not affect CLI execution. They appear when:
- The OTLP collector is unreachable
- Export timeout (500ms) is exceeded

The CLI continues normally—no errors are shown to users.

##### Production Deployment

- **Development builds** (`npm run build:debug`): Includes full telemetry code (~50KB overhead)
- **Production builds** (`npm run build`): Zero telemetry overhead via dead-code elimination
- Telemetry code is completely removed from production bundles at compile time

##### Notes

- Telemetry is **entirely optional** and disabled in production builds
- The CLI gracefully handles missing SigNoz (no blocking, no user-visible errors)
- Traces and logs are sent asynchronously without blocking CLI commands
- Default OTLP collection endpoint: `http://localhost:4318` (standard OpenTelemetry receiver)
- Supported log severity levels: DEBUG, INFO, WARN, ERROR
- Automatic trace-log correlation via traceId and spanId

### System Requirements

| Feature       | Requirement       | Notes                              |
| ------------- | ----------------- | ---------------------------------- |
| Basic CLI     | Node.js 18+       | All commands work                  |
| Visualization | Node.js 18+       | WebSocket support required         |
| Chat          | Claude Code CLI   | OAuth authentication via Claude Code |
| Telemetry     | Docker Compose    | Optional, for local SigNoz/OTLP tracing |
| Performance   | Bun 1.3+          | Optional but recommended           |

### Troubleshooting

#### Command Not Found

```bash
# If "dr" is not found after global installation
npm install -g @documentation-robotics/cli

# Check npm global location
npm config get prefix

# Add to PATH if needed (macOS/Linux)
export PATH="$(npm config get prefix)/bin:$PATH"

# Add to PATH permanently (.bashrc or .zshrc)
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

#### Module Not Found Errors

```bash
# Clear and reinstall
rm -rf node_modules package-lock.json
npm install

# Rebuild
npm run build
```

#### Test Failures

```bash
# Check that all dependencies are installed
npm list

# Reinstall with clean cache
npm cache clean --force
npm install

# Run tests with verbose output
DEBUG=* npm test
```

## Command Reference

All commands include detailed help. View help for any command:

```bash
dr --help                              # Show all commands
dr <command> --help                    # Show command-specific help
dr element add --help                  # Show element add help
```

### Quick Command Summary

| Category          | Command               | Purpose                                              |
| ----------------- | --------------------- | ---------------------------------------------------- |
| **Model**         | `init`                | Initialize a new architecture model                  |
|                   | `info`                | Show model information and statistics                |
|                   | `validate`            | Validate the complete model                          |
| **Elements**      | `add`                 | Add an element to a layer                            |
|                   | `update`              | Update an element                                    |
|                   | `delete`              | Delete an element                                    |
|                   | `show`                | Display element details                              |
|                   | `list`                | List elements in a layer                             |
|                   | `search`              | Search for elements by name/ID                       |
| **Relationships** | `relationship add`    | Add intra-layer relationship                         |
|                   | `relationship delete` | Delete a relationship                                |
|                   | `relationship list`   | List relationships for an element                    |
| **Dependencies**  | `trace`               | Trace element dependencies                           |
|                   | `project`             | Project dependencies to a target layer               |
| **Export**        | `export`              | Export to various formats (ArchiMate, OpenAPI, etc.) |
| **Visualization** | `visualize`           | Launch interactive visualization server              |
| **AI**            | `chat`                | Interactive Claude AI chat about model               |
| **Advanced**      | `migrate`             | Migrate model to new spec version                    |
|                   | `upgrade`             | Check for version upgrades                           |
|                   | `conformance`         | Check spec conformance                               |
|                   | `changeset`           | Manage model change tracking                         |

### Common Workflows

#### Create a New Model

```bash
# Initialize model
dr init --name "My Architecture" --author "Team A"

# Add some elements
dr add motivation goal customer-satisfaction --name "Ensure customer satisfaction"
dr add business service-category order-mgmt --name "Order Management"
dr add api endpoint create-order --properties '{"method":"POST","path":"/orders"}'

# View the model
dr info
dr list api
```

#### Search and Update Elements

```bash
# Search for elements
dr search customer

# Show details
dr show api-endpoint-create-order

# Update an element
dr update api-endpoint-create-order --name "Create Order API (v2)"

# Delete an element
dr delete api-endpoint-old-endpoint --force
```

#### Analyze Dependencies

```bash
# Trace dependencies for an element
dr trace api-endpoint-create-order

# Show dependencies in a specific direction
dr trace api-endpoint-create-order --direction up

# Show element metrics
dr trace api-endpoint-create-order --metrics

# Project to another layer
dr project api-endpoint-create-order business
```

#### Manage Relationships

```bash
# Add a relationship
dr relationship add business-process-1 business-process-2 --predicate depends-on

# List relationships
dr relationship list business-process-1

# Show only outgoing relationships
dr relationship list business-process-1 --direction outgoing

# Delete a relationship
dr relationship delete business-process-1 business-process-2 --force
```

#### Export and Visualize

```bash
# Export to multiple formats
dr export archimate --output model.xml
dr export openapi --layers api --output api-spec.yaml
dr export markdown --output docs/architecture.md

# Launch visualization server
dr visualize
dr visualize --port 3000 --no-browser
```

#### Chat

Interactive conversation with Claude about your architecture model.

**Requirements**: Claude Code CLI must be installed and authenticated. The chat functionality uses your Claude Code OAuth token, not an API key.

**Install Claude Code**:
1. Visit https://claude.ai/download
2. Follow installation instructions for your platform
3. Authenticate with your Anthropic account

**CLI Usage**:

```bash
dr chat
```

The chat command:
- Launches an interactive conversation loop
- Uses Claude Code CLI with restricted tools (Bash, Read)
- Provides context about your model (manifest, layer statistics)
- Streams responses in real-time
- Exit with "exit", "quit", or "q"

**Example**:

```bash
$ dr chat
┌  Documentation Robotics Chat
└  Powered by Claude Code - Ask about your architecture model

You: What are the dependencies for the create-order endpoint?
Claude: Let me check the model for you...
[Using tool: Bash]
[Tool result: Found dependencies...]

You: Show me the critical path in the business layer
Claude: I'll analyze the business layer relationships...

You: exit
└  Goodbye!
```

**WebSocket Chat** (via `dr visualize`):

The visualization server provides WebSocket-based chat using JSON-RPC 2.0:

**Request** (send message):
```json
{
  "jsonrpc": "2.0",
  "method": "chat.send",
  "params": {
    "message": "What layers are in this model?"
  },
  "id": 1
}
```

**Notifications** (streaming response):

Text content chunk:
```json
{
  "jsonrpc": "2.0",
  "method": "chat.response.chunk",
  "params": {
    "conversation_id": "conv-1-12345",
    "content": "This model has 12 layers...",
    "is_final": false,
    "timestamp": "2025-01-02T12:00:00.000Z"
  }
}
```

Tool invocation notification:
```json
{
  "jsonrpc": "2.0",
  "method": "chat.tool.invoke",
  "params": {
    "conversation_id": "conv-1-12345",
    "tool_name": "Bash",
    "tool_input": { "command": "dr list api" },
    "timestamp": "2025-01-02T12:00:00.000Z"
  }
}
```

Tool result notification:
```json
{
  "jsonrpc": "2.0",
  "method": "chat.tool.result",
  "params": {
    "conversation_id": "conv-1-12345",
    "result": "output from tool execution",
    "timestamp": "2025-01-02T12:00:00.000Z"
  }
}
```

**Completion response**:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "conversation_id": "conv-1-12345",
    "status": "complete",
    "exit_code": 0,
    "full_response": "Complete response text...",
    "timestamp": "2025-01-02T12:00:00.000Z"
  },
  "id": 1
}
```

**Error response**:
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32001,
    "message": "Claude Code CLI not available"
  },
  "id": 1
}
```

**Error Codes**:
- `-32001`: Claude Code CLI not available (install Claude Code)
- `-32002`: Invalid parameters
- `-32603`: Internal error (process failure, timeout)

#### Manage Changesets

```bash
# Create a changeset
dr changeset create "v1.1 migration" --description "Migrate to new API structure"

# List changesets
dr changeset list

# Apply a changeset
dr changeset apply "v1.1 migration"

# Revert a changeset
dr changeset revert "v1.1 migration"
```

## Core Classes

### Element

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

### Layer

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

### Manifest

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

### Model

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

### ReferenceRegistry

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

### RelationshipRegistry

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

## File I/O Utilities

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

## Type Definitions

Core types defined in `src/types/index.ts`:

- `Element` - Architecture item representation
- `LayerData` - Layer serialization format
- `ManifestData` - Manifest metadata
- `Reference` - Cross-layer references
- `Relationship` - Intra-layer relationships
- `ModelOptions` - Model configuration

## Testing

Comprehensive test coverage for core classes:

```bash
# Run Bun tests (requires Bun runtime)
bun test

# Run specific test file
bun test tests/unit/core/element.test.ts

# With coverage
bun test --coverage

# Node.js integration test
node tests/unit/core/element.integration.test.js
```

## Bundled Schemas

All JSON schemas from `spec/schemas/` are bundled:

- **Layer Schemas**: 01-motivation through 12-testing
- **Catalogs**: relationship-catalog.json, link-registry.json
- **Common Schemas**: predicates, relationships, source-references, layer-extensions

These schemas are loaded at build time and do not require filesystem access at runtime.

## Code Quality

- **TypeScript**: Strict mode with comprehensive type coverage
- **Linting**: Biome configured for code quality checks
- **Formatting**: Code formatted to project standards

## Related Resources

- Specification: `/workspace/spec/`
- Design Discussion: [GitHub Discussion #68](https://github.com/tinkermonkey/documentation_robotics/discussions/68)
- Migration Guide: [Migrating from Python CLI](../docs/migration-from-python-cli.md)

## License

MIT
