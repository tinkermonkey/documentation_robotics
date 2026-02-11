# Documentation Robotics CLI

A command-line tool for managing comprehensive architecture models that span from business requirements through technical implementation.

[![npm version](https://img.shields.io/npm/v/@documentation-robotics/cli.svg)](https://www.npmjs.com/package/@documentation-robotics/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What is Documentation Robotics?

Documentation Robotics helps you build and maintain a **federated architecture model** across 12 interconnected layers:

1. **Motivation** - Goals, requirements, stakeholders
2. **Business** - Business processes and services
3. **Security** - Authentication, authorization, threats
4. **Application** - Application services and components
5. **Technology** - Infrastructure and platforms
6. **API** - REST APIs and operations
7. **Data Model** - Entities and relationships
8. **Data Store** - Database schemas
9. **UX** - User interface components
10. **Navigation** - Application routing
11. **APM** - Observability and monitoring
12. **Testing** - Test strategies and cases

**Key Benefits:**

- Trace dependencies from business goals to implementation
- Export to industry standards (ArchiMate, OpenAPI, JSON Schema)
- Visualize your architecture in an interactive web interface
- Chat with AI (Claude Code or GitHub Copilot) about your architecture model
- Validate model integrity automatically

## Installation

### Global Installation (Recommended)

```bash
npm install -g @documentation-robotics/cli
```

### Local Installation (Project-Specific)

```bash
npm install @documentation-robotics/cli
```

### Verify Installation

```bash
dr --version
dr --help
```

### System Requirements

| Feature       | Requirement                       | Notes                               |
| ------------- | --------------------------------- | ----------------------------------- |
| Basic CLI     | Node.js 18+                       | All commands work                   |
| Visualization | Node.js 18+                       | Interactive web interface           |
| Chat          | Claude Code CLI or GitHub Copilot | AI-powered architecture discussions |

## Quick Start

### 1. Create Your First Model

```bash
# Initialize a new model
dr init --name "My Architecture" --author "Your Name"

# Add some elements (format: dr add <layer> <type> <name>)
dr add motivation goal customer-satisfaction \
  --name "Ensure customer satisfaction"

dr add business service order-management \
  --name "Order Management Service"

dr add api endpoint create-order \
  --name "Create Order" \
  --properties '{"method":"POST","path":"/api/orders"}'
```

### 2. View Your Model

```bash
# Show model summary
dr info

# List elements in a layer
dr list api

# Search for elements
dr search order

# Show element details
dr show api-endpoint-create-order
```

### 3. Visualize Your Architecture

```bash
# Launch interactive visualization
dr visualize

# Opens in your browser at http://localhost:8080
# - Explore layers and relationships
# - Search and filter elements
# - Chat with Claude about your model
```

### 4. Export Your Model

```bash
# Export to ArchiMate (enterprise architecture standard)
dr export archimate --output model.xml

# Export API layer to OpenAPI spec
dr export openapi --layers api --output api-spec.yaml

# Export to Markdown documentation
dr export markdown --output docs/architecture.md
```

## Common Commands

### Model Management

```bash
dr init                     # Initialize new model
dr info                     # Show model information
dr validate                 # Validate model integrity
dr upgrade                  # Check for spec upgrades
```

### Working with Elements

```bash
dr add <layer> <type> <id>       # Add element
dr update <element-id>           # Update element
dr delete <element-id>           # Delete element
dr show <element-id>             # Show element details
dr list <layer>                  # List layer elements
dr search <query>                # Search elements
```

**Element ID Format**: `{layer}.{ElementType}.{kebab-case-name}`

Examples:

- `motivation.goal.customer-satisfaction`
- `business.service.order-management`
- `api.endpoint.create-order`
- `data-model.entity.user-profile`

**Important**: In CLI commands, element types use **lowercase** (e.g., `goal`, `service`, `endpoint`), while element names use **kebab-case** (e.g., `customer-satisfaction`). In generated element IDs, the type segment matches the CLI format (e.g., `motivation.goal.customer-satisfaction`).

See [Element Type Reference](../docs/ELEMENT_TYPE_REFERENCE.md) for comprehensive documentation of all element types by layer.

### Source File Tracking

Link architecture elements to their implementation source code:

```bash
# Add element with source reference
dr add api endpoint create-user \
  --name "Create User Endpoint" \
  --source-file "src/api/endpoints/users.ts" \
  --source-symbol "createUser" \
  --source-provenance "extracted"

# Update element to add source reference
dr update api-endpoint-create-user \
  --source-file "src/api/endpoints/users.ts" \
  --source-symbol "createUser" \
  --source-provenance "extracted" \
  --source-repo-remote "https://github.com/example/repo.git" \
  --source-repo-commit "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b"

# Show element with source reference details
dr show api-endpoint-create-user

# Search elements by source file
dr search --source-file "src/api/endpoints/users.ts"

# Clear source reference from element
dr update api-endpoint-create-user --clear-source-reference
```

**Source Reference Options:**

| Option                 | Required                        | Description                                                               | Example                               |
| ---------------------- | ------------------------------- | ------------------------------------------------------------------------- | ------------------------------------- |
| `--source-file`        | When using source options       | Path to source file (relative to repo root)                               | `src/api/routes.ts`                   |
| `--source-symbol`      | Optional                        | Symbol name (function, class, variable)                                   | `createUser`                          |
| `--source-provenance`  | When using source options       | How reference was created: `extracted`, `manual`, `inferred`, `generated` | `extracted`                           |
| `--source-repo-remote` | Requires `--source-repo-commit` | Git remote URL                                                            | `https://github.com/example/repo.git` |
| `--source-repo-commit` | Requires `--source-repo-remote` | Full 40-character commit SHA                                              | `a1b2c3d4...`                         |

**Examples:**

```bash
# Source reference with minimal information
dr add security policy auth-validate \
  --name "Auth Validation" \
  --source-file "src/security/auth.ts" \
  --source-provenance "manual"

# Source reference with symbol and repository context
dr add data-model entity user-entity \
  --name "User Entity" \
  --source-file "src/models/user.ts" \
  --source-symbol "User" \
  --source-provenance "extracted" \
  --source-repo-remote "https://github.com/myorg/myapp.git" \
  --source-repo-commit "5a7b3c9d1e2f4a6b8c0d2e4f6a8b0c2d4e6f8a0b"

# Search for all elements in a source file
dr search --source-file "src/services/auth.ts"

# Search by file with additional filters
dr search --source-file "src/api/endpoints.ts" --layer "06-api" --type "endpoint"
```

**Provenance Types:**

- **`extracted`**: Automatically detected from source code via parsing/analysis tools
- **`manual`**: Manually linked by a person reviewing source code
- **`inferred`**: Determined through pattern matching and heuristics
- **`generated`**: Created automatically from code generation or model transformation

### Relationships & Dependencies

```bash
# Add relationships between elements
dr relationship add motivation.goal.customer-satisfaction \
                        business.service.customer-support \
                        --predicate "supports"

# List relationships for an element
dr relationship list business.service.order-management

# Trace dependencies (see which elements depend on this one)
dr trace api.endpoint.create-order

# Project dependencies to another layer
dr project api.endpoint.create-order business
```

### Visualization & Export

```bash
dr visualize                             # Interactive web UI
dr export <format>                       # Export model
  # Formats: archimate, openapi, jsonschema, plantuml, markdown, graphml
```

### AI-Powered Features

```bash
dr chat                                  # Auto-detect or use saved preference
dr chat claude-code                      # Use Claude Code, save as preference
dr chat github-copilot                   # Use GitHub Copilot, save as preference
```

**Note**: Chat requires either [Claude Code CLI](https://claude.ai/download) or [GitHub Copilot CLI](https://github.com/github/gh-copilot) to be installed and authenticated. The CLI will auto-detect available clients and prompt you to choose if both are installed. You can also explicitly specify which client to use.

## Configuration

### Model Structure

Model data and changesets are stored in the `documentation-robotics/` directory:

```
your-project/
├── documentation-robotics/
│   ├── model/
│   │   ├── manifest.yaml                    # Model metadata
│   │   ├── 01_motivation/
│   │   │   ├── goals.yaml
│   │   │   └── ...
│   │   ├── 02_business/
│   │   │   ├── services.yaml
│   │   │   └── ...
│   │   └── ...
│   └── changesets/
│       ├── feature-x/
│       │   ├── metadata.yaml   # Changeset metadata
│       │   └── changes.yaml    # Staged changes
│       └── ...
```

**Legacy models**: Old projects using `.dr/` directory will auto-migrate changesets to `documentation-robotics/changesets/` on first use.

### AI Chat Setup (for Chat Features)

The chat functionality supports two AI CLI tools. You need at least one installed:

#### Option 1: Claude Code CLI

1. Visit https://claude.ai/download
2. Follow installation instructions for your platform
3. Authenticate with your Anthropic account
4. Verify: `claude --version`

#### Option 2: GitHub Copilot CLI

1. Install GitHub CLI: https://cli.github.com/
2. Install Copilot extension: `gh extension install github/gh-copilot`
3. Authenticate: `gh auth login`
4. Verify: `gh copilot --version`

**Client Selection**:

- **Auto-detection**: The first time you use `dr chat`, if both clients are available, you'll be prompted to choose one.
- **Explicit selection**: You can specify a client directly (e.g., `dr chat github-copilot` or `dr chat claude-code`).
- **Preference storage**: Your client choice is saved in the model manifest for future sessions. You can change it anytime by explicitly specifying a different client.

### Visualization Server

```bash
# Launch with default embedded viewer
dr visualize

# Custom port
dr visualize --port 3000

# Don't auto-open browser
dr visualize --no-browser

# Load custom viewer build (useful for development or custom distributions)
dr visualize --viewer-path ./dist/embedded/dr-viewer-bundle

# Combined example: custom viewer on custom port without browser
dr visualize --viewer-path ./my-viewer --port 3000 --no-browser
```

**Custom Viewer Path**:

The `--viewer-path` option allows you to serve a custom web UI instead of the default embedded viewer:

- Point to a directory containing `index.html` and supporting files (CSS, JS, assets)
- Useful for developing custom viewers or using bundled distributions
- The server will serve static files from the specified path with proper MIME types
- Path traversal protection is enforced for security

**Example custom viewer structure**:

```
my-viewer/
├── index.html          # Entry point
├── assets/
│   ├── style.css      # Stylesheets
│   ├── script.js      # JavaScript
│   └── logo.png       # Images
└── ...                 # Other static files
```

## Building from Source

The CLI uses a sophisticated multi-stage code generation system at build time to convert JSON specifications into type-safe TypeScript code.

### Quick Build

```bash
# Install dependencies
npm install

# Build the CLI
npm run build

# Verify build
npm run lint       # Type-check
npm run test       # Run tests
```

### Build Variants

| Command | Purpose | When to Use |
|---------|---------|------------|
| `npm run build` | Standard build | Development, testing |
| `npm run build:debug` | Debug build with telemetry | Debugging bundle configuration |
| `npm run build:ci` | Strict build with validation | CI/CD, releases |
| `npm run sync-schemas` | Schema sync only | Updating schemas without rebuild |

### Build Pipeline

The build runs these stages in order:

1. **Schema Sync** - Copies specification schemas from `spec/` to `cli/src/schemas/bundled/`
2. **Registry Generation** - Generates TypeScript code for 12 layers, 354 node types, 252 relationships
3. **Validator Generation** - Pre-compiles AJV validators for runtime validation
4. **TypeScript Compilation** - Compiles all TypeScript to JavaScript
5. **Bundling** - Bundles and optimizes for distribution
6. **Copy Schemas** - Packages schemas in distribution

**Build time:** ~4-5 seconds (typical full build)

### Development Workflow

When modifying specification or schema files:

```bash
# 1. Make changes to spec files
vi spec/layers/01-motivation.layer.json
vi spec/schemas/nodes/motivation/goal.node.schema.json

# 2. Rebuild (generators pick up changes)
npm run build

# 3. Type-check for compatibility
npm run lint

# 4. Run tests
npm run test

# 5. Commit generated files
git add spec/ cli/src/generated/
git commit -m "Update schemas and generated code"
```

### Documentation

- 📘 [Build System Documentation](../docs/BUILD_SYSTEM.md) - Complete build workflow guide
- 📗 [Generator Scripts Guide](../docs/GENERATOR_SCRIPTS_GUIDE.md) - How to use and maintain generators
- 📕 [Phase 5 Integration](../docs/PHASE_5_INTEGRATION.md) - Integration overview

## Example Workflows

### Analyzing Dependencies

```bash
# Find all dependencies for an API endpoint
dr trace api-endpoint-create-order

# Show only dependencies from higher layers
dr trace api-endpoint-create-order --direction up

# Show dependency metrics
dr trace api-endpoint-create-order --metrics

# Project dependencies to business layer
dr project api-endpoint-create-order business
```

### Managing Relationships

```bash
# Add a relationship between business processes
dr relationship add business-process-order business-process-payment \
  --predicate triggers

# List all relationships for an element
dr relationship list business-process-order

# Delete a relationship
dr relationship delete business-process-order business-process-payment
```

### Staging Workflow

The staging feature allows you to safely prepare and review changes before committing them to the base model:

```bash
# Create a changeset for your changes
dr changeset create user-mgmt-v2 \
  --name "User Management v2" \
  --description "Redesign user management system"

# Activate the changeset to track changes
dr changeset activate user-mgmt-v2

# Now make your changes - they will be tracked automatically
dr add api endpoint create-user \
  --properties '{"method":"POST","path":"/users"}'

dr add data-model entity user \
  --name "User Entity"

# Preview how staged changes will merge with the base model
dr changeset preview

# View changeset details
dr changeset show

# Commit when satisfied (checks for drift and validates changes)
dr changeset commit

# Or discard if you change your mind
dr changeset discard
```

**Key Features:**

- **Activate for tracking**: Activate a changeset to automatically track all changes
- **Virtual preview**: See merged view before committing
- **Drift detection**: Alerts if base model changed since changeset creation
- **Export/Import**: Share changesets across team or save for backup

**Changeset Status:**

- `staged`: Changes are prepared but not applied (default)
- `committed`: Changes have been applied to base model
- `discarded`: Changes were abandoned

For comprehensive guide, see [STAGING_GUIDE.md](../../docs/STAGING_GUIDE.md).

### Tracking Changes

> ⚠️ **IMPORTANT**: Changesets must be **ACTIVATED** to track changes.
>
> After creating a changeset:
>
> 1. `dr changeset create "my-changes"`
> 2. `dr changeset activate "my-changes"` ← **DON'T FORGET THIS**
> 3. Make your changes (add/update/delete)

```bash
# Create a changeset
dr changeset create "v2.0 API migration" \
  --description "Update to new API structure"

# Activate the changeset to track changes
dr changeset activate "v2.0 API migration"

# Now make your changes - they will be tracked
dr update api-endpoint-users --name "Users API v2"
dr add api endpoint users-list

# List changesets
dr changeset list

# Review changes
dr changeset show "v2.0 API migration"

# Apply a changeset
dr changeset apply "v2.0 API migration"

# Revert if needed
dr changeset revert "v2.0 API migration"

# Deactivate when done
dr changeset deactivate
```

## Getting Help

### Command-Line Help

Every command includes detailed help:

```bash
dr --help                    # Show all commands
dr <command> --help          # Command-specific help
dr add --help                # Show element add help
dr relationship --help       # Relationship commands
```

### Documentation

- 📚 [Full Specification](https://github.com/tinkermonkey/documentation_robotics/tree/main/spec) - The 12-layer model in detail
- 🛠️ [Contributing Guide](./CONTRIBUTING.md) - For developers working on the CLI
- 📦 [npm Package](https://www.npmjs.com/package/@documentation-robotics/cli)

### Community

- 🐛 [Report Issues](https://github.com/tinkermonkey/documentation_robotics/issues)
- 💬 [Discussions](https://github.com/tinkermonkey/documentation_robotics/discussions)
- 🌟 [GitHub Repository](https://github.com/tinkermonkey/documentation_robotics)

## Utilities

### Export Python Annotations

For migrating Python CLI annotation metadata, a utility script is available:

```bash
bun run src/utils/export-python-annotations.ts
```

This utility exports Python CLI annotations to a processable format, used during migrations between CLI versions.

## Validation

### Local Validation

Since pre-commit hooks for validation were removed in favor of CI-based validation, developers who want local feedback before committing can use the following commands to validate their changes:

#### Validate Model Conformance

Validate your architecture model against the layer specifications:

```bash
# Validate entire model
dr conformance

# Validate specific layers
dr conformance --layers motivation,business,api

# Check model statistics and summary
dr info
```

#### Validate Specifications (During Development)

If you're developing locally and modifying the specification files:

```bash
# Validate spec schemas are correct
dr validate --schemas

# List schema information for debugging
dr schema layers           # List all layers
dr schema types <layer>    # List valid types for a layer
dr schema node <id>        # Show node schema details
```

#### Schema Synchronization

After modifying specification files in `spec/`, ensure the CLI has the latest schemas:

```bash
# Sync spec schemas to CLI bundled schemas
npm run sync-schemas

# Build CLI with updated schemas
npm run build
```

These commands provide immediate feedback during development, allowing you to catch validation errors locally before pushing to CI.

## Troubleshooting

### "dr: command not found"

```bash
# Check if npm global bin is in PATH
npm config get prefix

# Add to PATH (macOS/Linux)
export PATH="$(npm config get prefix)/bin:$PATH"

# Make permanent (add to ~/.bashrc or ~/.zshrc)
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Module or Build Errors

```bash
# Clear and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Chat Not Working

Ensure at least one AI CLI tool is installed and authenticated:

#### For Claude Code

```bash
# Check installation
which claude

# Verify authentication
claude --version
```

If not installed, visit https://claude.ai/download

#### For GitHub Copilot

```bash
# Check installation
gh copilot --version

# Or check for standalone copilot
which copilot

# Authenticate GitHub CLI
gh auth login
```

If not installed, see instructions above in the "AI Chat Setup" section.

## What's Next?

- ⭐ **Star the project** on [GitHub](https://github.com/tinkermonkey/documentation_robotics)
- 📖 **Read the spec** to understand the 12-layer model
- 🎨 **Try visualization** with `dr visualize`
- 🤖 **Chat with AI** about your architecture (Claude Code or GitHub Copilot)
- 🚀 **Export to standards** (ArchiMate, OpenAPI)

## License

MIT © Documentation Robotics Contributors

---

**Made with ❤️ by the Documentation Robotics community**
