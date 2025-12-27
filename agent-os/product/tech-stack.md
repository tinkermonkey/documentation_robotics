# Tech Stack

## Primary CLI Implementation (Bun/TypeScript)

### Core Runtime & Language

- **Bun 1.3+**: Primary JavaScript runtime - ultra-fast startup, built-in TypeScript support, native test runner
- **Node.js 18+**: Alternative runtime for compatibility - supports all environments where Bun may not be available
- **TypeScript 5.x**: Strict mode with comprehensive type coverage - ensures type safety and better developer experience

### CLI Framework & Libraries

- **Commander.js**: Command-line interface framework - provides command parsing, help generation, and option handling
- **Ansis**: Terminal colors and formatting - lightweight alternative to chalk for rich console output
- **Inquirer.js** (future): Interactive prompts for guided workflows

### Validation & Schema

- **AJV (Another JSON Validator)**: JSON Schema validation - fast, standards-compliant validation for all 12 layer schemas
- **JSON Schema Draft 7**: Schema standard for layer definitions

### Graph & Dependency Management

- **Graphology**: Graph data structure library - manages cross-layer dependencies, relationships, and traversal algorithms
- **Graphology Algorithms**: Shortest path, connectivity, centrality analysis for dependency tracing

### Web Server & Visualization

- **Hono**: Fast, lightweight web framework - powers visualization server with minimal overhead
- **WebSocket**: Real-time updates - enables live model updates in visualization interface
- **D3.js** or **Cytoscape.js** (future): Graph visualization in browser

### AI Integration

- **@anthropic-ai/sdk**: Official Anthropic Claude API client - powers chat command and AI-assisted features
- **Streaming Response Support**: Real-time AI responses in terminal

### Export & Format Handling

- **js-yaml**: YAML parsing and generation - for OpenAPI and other YAML exports
- **xml2js**: XML generation - for ArchiMate XML export
- **markdown-it** (future): Enhanced markdown generation

### Development & Testing

- **Bun Test**: Built-in test runner - fast unit and integration testing
- **Biome**: Fast linter and formatter - replaces ESLint and Prettier with single tool
- **TypeScript Compiler**: Type checking and compilation to JavaScript

### Build & Distribution

- **npm**: Package management and distribution - published to npm registry as @documentation-robotics/cli
- **esbuild** (via Bun): Fast bundling and compilation

## Legacy CLI Implementation (Python) - Deprecation Path

### Core Runtime & Language

- **Python 3.10+**: Legacy runtime - will be deprecated in favor of Bun CLI
- **Poetry**: Dependency management - used for Python package management

### CLI Framework

- **Click 8.x**: Command-line interface framework

### Validation & Schema

- **jsonschema**: JSON Schema validation
- **Pydantic**: Data validation and settings management

### Graph Management

- **NetworkX**: Graph algorithms and dependency analysis

### AI Integration

- **anthropic SDK**: Claude API client for Python

### Terminal Output

- **Rich**: Rich text and formatting in terminal

### Export Handling

- **PyYAML**: YAML processing
- **lxml**: XML processing

## Specification & Schemas

### Standards Compliance

- **ArchiMate 3.2**: Layers 1, 2, 4, 5 (Motivation, Business, Application, Technology)
- **OpenAPI 3.0**: Layer 6 (API)
- **JSON Schema Draft 7**: Layer 7 (Data Model)
- **SQL DDL**: Layer 8 (Datastore)
- **OpenTelemetry 1.0+**: Layer 11 (APM/Observability)
- **W3C Trace Context**: Distributed tracing standard

### Custom Layer Specifications

- **Security Layer** (Layer 3): Custom schema for authentication, authorization, and security policies
- **UX Layer** (Layer 9): Three-tier architecture (Libraries, Applications, Specs) with component reusability
- **Navigation Layer** (Layer 10): Custom schema for routing and navigation flows
- **Testing Layer** (Layer 12): Custom schema for test coverage modeling and traceability

### Schema Infrastructure

- **JSON Schema Files**: 12 layer schemas + common schemas (predicates, relationships, catalogs)
- **Relationship Catalog**: Machine-readable catalog of 60+ cross-layer reference patterns
- **Link Registry**: Formalized registry of valid reference types and patterns

## Documentation & Developer Tools

### Documentation

- **Markdown**: All documentation in markdown format
- **Mermaid** (future): Diagram generation in documentation
- **PlantUML**: Architecture diagram generation

### Version Control & CI/CD

- **Git**: Source control
- **GitHub Actions**: Continuous integration and testing
- **Pre-commit Hooks**: Code quality checks before commit

### Code Quality

- **TypeScript Strict Mode**: Maximum type safety
- **Biome**: Fast linting and formatting
- **Unit Test Coverage**: Comprehensive test suite with Bun test

## Data Storage & Persistence

### File System Based

- **JSON Files**: Model persistence in `.dr/` directory structure
- **Atomic Writes**: Safe file operations with crash recovery
- **Manifest**: Model metadata in `manifest.json`
- **Layer Files**: Individual layer data in `layers/{layer-name}.json`

### No External Database Required

- All data stored in filesystem for simplicity, portability, and version control compatibility

## Integration & Ecosystem

### Standards Ecosystem Access

- **ArchiMate Tools**: Export compatibility with Archi, BiZZdesign, Sparx EA
- **API Tools**: OpenAPI compatibility with Swagger UI, Postman, Stoplight
- **Diagram Tools**: PlantUML and GraphML exports for visualization tools
- **Graph Tools**: GraphML export for Gephi, yEd, Cytoscape

### AI/Agentic Tools

- **Claude Code**: Native integration via agents and commands
- **GitHub Copilot**: Agent integration support
- **VS Code** (future): Extension for inline architecture support

### CI/CD Integration

- **GitHub Actions** (future): Pre-built actions for validation
- **GitLab CI** (future): Pipeline templates
- **Jenkins** (future): Plugin support

## Future Tech Stack Additions

### Planned Additions (Phase 4-7)

- **VS Code Extension API**: For IDE integration
- **React + Vite**: Web dashboard UI
- **WebSocket Server**: Enhanced real-time collaboration
- **Git Integration Libraries**: For advanced diff/merge capabilities
- **AST Parsers**: For code-to-architecture sync (TypeScript, Python, Java parsers)

### Under Consideration

- **GraphQL**: Alternative API layer export format
- **Terraform/CloudFormation Parsers**: For infrastructure import
- **Database Introspection**: For automated datastore layer generation
- **gRPC Support**: For API layer modeling

## Platform Support

### Operating Systems

- **macOS**: Primary development and testing platform
- **Linux**: Full support via Bun and Node.js
- **Windows**: Supported via Node.js (Bun support improving)

### Deployment Targets

- **Local Development**: Primary use case - developers working on local machines
- **CI/CD Pipelines**: Validation and conformance checking in automated workflows
- **Docker** (future): Containerized CLI for consistent environments

## Performance Targets

### Bun CLI Performance Goals

- **Startup Time**: <200ms (8x faster than Python CLI)
- **Model Load**: <100ms for small models (<100 elements)
- **Validation**: <500ms for medium models (100-500 elements)
- **Export**: <1s for most export formats on medium models

### Python CLI Performance (Legacy)

- **Startup Time**: ~1-2 seconds
- **Being Deprecated**: No further performance optimization planned
