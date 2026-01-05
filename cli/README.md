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
- Chat with Claude AI about your architecture model
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

| Feature       | Requirement     | Notes                               |
| ------------- | --------------- | ----------------------------------- |
| Basic CLI     | Node.js 18+     | All commands work                   |
| Visualization | Node.js 18+     | Interactive web interface           |
| Chat          | Claude Code CLI | AI-powered architecture discussions |

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
dr chat                                  # Chat with Claude about your model
```

**Note**: Chat requires [Claude Code CLI](https://claude.ai/download) to be installed and authenticated.

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

### Claude Code Setup (for Chat Features)

The chat functionality requires Claude Code CLI:

1. Visit https://claude.ai/download
2. Follow installation instructions for your platform
3. Authenticate with your Anthropic account
4. Verify: `claude --version`

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

Ensure Claude Code CLI is installed and authenticated:

```bash
# Check installation
which claude

# Verify authentication
claude --version
```

If not installed, visit https://claude.ai/download

## What's Next?

- ⭐ **Star the project** on [GitHub](https://github.com/tinkermonkey/documentation_robotics)
- 📖 **Read the spec** to understand the 12-layer model
- 🎨 **Try visualization** with `dr visualize`
- 🤖 **Chat with Claude** about your architecture
- 🚀 **Export to standards** (ArchiMate, OpenAPI)

## License

MIT © Documentation Robotics Contributors

---

**Made with ❤️ by the Documentation Robotics community**
