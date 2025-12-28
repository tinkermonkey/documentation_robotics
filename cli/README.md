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

#### API Key Setup (for Chat Features)

```bash
# Set Anthropic API key (for chat command)
export ANTHROPIC_API_KEY="sk-xxx..."

# Or add to .env file
echo "ANTHROPIC_API_KEY=sk-xxx..." >> .env
```

#### Visualization Server

```bash
# Run visualization server with custom port
dr visualize --port 3000

# Run without auto-opening browser
dr visualize --no-browser
```

#### Telemetry & Observability (Optional)

The CLI supports OpenTelemetry instrumentation for tracing and observability during development. To view traces locally, use the provided Docker Compose configuration to run Jaeger.

**Prerequisites:**

- Docker and Docker Compose installed

**Start Jaeger locally:**

```bash
# From the repository root
docker-compose -f docker/docker-compose.telemetry.yml up -d

# Verify Jaeger is running
curl http://localhost:16686/search

# View Jaeger UI
# Open http://localhost:16686 in your browser
```

**Run CLI with telemetry enabled:**

```bash
# Build CLI with telemetry support
npm run build:debug

# Run commands - traces will be sent to localhost:4318 (OTLP HTTP)
node dist/cli.js validate
node dist/cli.js list motivation

# View traces in Jaeger UI at http://localhost:16686
```

**Stop Jaeger:**

```bash
docker-compose -f docker/docker-compose.telemetry.yml down
```

**Notes:**

- Telemetry is **compile-time configurable** - production builds have zero overhead
- The CLI gracefully handles missing Jaeger (no blocking or errors)
- Default telemetry collection endpoint: `http://localhost:4318` (OTLP HTTP)
- Requires gRPC and HTTP OTLP collectors enabled in Jaeger (default in all-in-one image)

### System Requirements

| Feature       | Requirement       | Notes                              |
| ------------- | ----------------- | ---------------------------------- |
| Basic CLI     | Node.js 18+       | All commands work                  |
| Visualization | Node.js 18+       | WebSocket support required         |
| Chat          | ANTHROPIC_API_KEY | Requires Anthropic API access      |
| Telemetry     | Docker Compose    | Optional, for local Jaeger tracing |
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

#### Use AI Chat

```bash
# Interactive chat with Claude about your architecture
dr chat

# Ask about dependencies
# > What are the dependencies for the create-order endpoint?

# Get architecture insights
# > Show me the critical path in the business layer
```

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
