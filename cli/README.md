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

# Add some elements
dr add motivation goal customer-satisfaction \
  --name "Ensure customer satisfaction"

dr add business service order-management \
  --name "Order Management Service"

dr add api endpoint create-order \
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

| Option | Required | Description | Example |
|--------|----------|-------------|---------|
| `--source-file` | When using source options | Path to source file (relative to repo root) | `src/api/routes.ts` |
| `--source-symbol` | Optional | Symbol name (function, class, variable) | `createUser` |
| `--source-provenance` | When using source options | How reference was created: `extracted`, `manual`, `inferred`, `generated` | `extracted` |
| `--source-repo-remote` | Requires `--source-repo-commit` | Git remote URL | `https://github.com/example/repo.git` |
| `--source-repo-commit` | Requires `--source-repo-remote` | Full 40-character commit SHA | `a1b2c3d4...` |

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
dr relationship add <source> <target> --predicate <predicate>
dr relationship list <element-id>
dr trace <element-id>                    # Trace dependencies
dr project <element-id> <target-layer>   # Project to layer
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

All model data is stored in the `.dr/` directory in your project:

```
your-project/
├── .dr/
│   ├── manifest.json           # Model metadata
│   └── layers/
│       ├── 01-motivation.json
│       ├── 02-business.json
│       ├── 06-api.json
│       └── ...
```

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
# Custom port
dr visualize --port 3000

# Don't auto-open browser
dr visualize --no-browser
```

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

### Tracking Changes

```bash
# Create a changeset
dr changeset create "v2.0 API migration" \
  --description "Update to new API structure"

# List changesets
dr changeset list

# Apply a changeset
dr changeset apply "v2.0 API migration"

# Revert if needed
dr changeset revert "v2.0 API migration"
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

#### For Claude Code:

```bash
# Check installation
which claude

# Verify authentication
claude --version
```

If not installed, visit https://claude.ai/download

#### For GitHub Copilot:

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
