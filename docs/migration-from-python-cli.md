# Migrating from Python CLI to Bun CLI

This guide helps you migrate from the deprecated Python CLI to the Bun CLI.

## Overview

The Python CLI has been deprecated as of version 0.8.0 and will be removed from PyPI. The Bun CLI is now the sole implementation of the Documentation Robotics CLI, providing the same functionality with improved performance and active development.

## Deprecation Timeline

| Date              | Event                                                |
| ----------------- | ---------------------------------------------------- |
| December 26, 2025 | Python CLI v0.8.0 released with deprecation warnings |
| January 26, 2026  | Python package removed from PyPI                     |
| Ongoing           | Bun CLI receives all new features and bug fixes      |

## Why Migrate?

The Bun CLI offers several advantages:

- **8x Faster Performance**: ~200ms startup time vs ~1-2s for Python CLI
- **Active Development**: All new features and bug fixes
- **Modern Stack**: TypeScript/Node.js ecosystem
- **Better Tooling**: Native integration with npm, VS Code, and modern dev tools
- **Full Feature Parity**: All Python CLI commands are available

## Installation

### Prerequisites

- **Node.js 18 or higher** (includes npm)
- Optional: **Bun 1.3+** for best performance

### Install Bun CLI

```bash
# Uninstall Python CLI (optional)
pip uninstall documentation-robotics

# Install Bun CLI globally
npm install -g @documentation-robotics/cli

# Verify installation
dr --version
```

## Command Mapping

All Python CLI commands have direct equivalents in the Bun CLI. The command structure is identical.

### Core Commands

| Python CLI                   | Bun CLI                      | Notes                       |
| ---------------------------- | ---------------------------- | --------------------------- |
| `dr init <name>`             | `dr init --name <name>`      | Argument syntax differs     |
| `dr add <layer> <type> <id>` | `dr add <layer> <type> <id>` | Identical                   |
| `dr update <id>`             | `dr update <id>`             | Identical                   |
| `dr delete <id>`             | `dr delete <id>`             | Identical (alias: `remove`) |
| `dr list <layer>`            | `dr list <layer>`            | Identical                   |
| `dr show <id>`               | `dr show <id>`               | Identical                   |
| `dr search <query>`          | `dr search <query>`          | Identical                   |
| `dr validate`                | `dr validate`                | Identical                   |

### Relationship Commands

| Python CLI                                 | Bun CLI                                    | Notes     |
| ------------------------------------------ | ------------------------------------------ | --------- |
| `dr relationship add <source> <target>`    | `dr relationship add <source> <target>`    | Identical |
| `dr relationship delete <source> <target>` | `dr relationship delete <source> <target>` | Identical |
| `dr relationship list <id>`                | `dr relationship list <id>`                | Identical |

### Dependency Commands

| Python CLI                       | Bun CLI                          | Notes     |
| -------------------------------- | -------------------------------- | --------- |
| `dr trace <id>`                  | `dr trace <id>`                  | Identical |
| `dr project <id> <target-layer>` | `dr project <id> <target-layer>` | Identical |

### Export Commands

| Python CLI              | Bun CLI                 | Notes     |
| ----------------------- | ----------------------- | --------- |
| `dr export archimate`   | `dr export archimate`   | Identical |
| `dr export openapi`     | `dr export openapi`     | Identical |
| `dr export json-schema` | `dr export json-schema` | Identical |
| `dr export plantuml`    | `dr export plantuml`    | Identical |
| `dr export markdown`    | `dr export markdown`    | Identical |
| `dr export graphml`     | `dr export graphml`     | Identical |

### Advanced Commands

| Python CLI       | Bun CLI          | Notes     |
| ---------------- | ---------------- | --------- |
| `dr migrate`     | `dr migrate`     | Identical |
| `dr upgrade`     | `dr upgrade`     | Identical |
| `dr conformance` | `dr conformance` | Identical |
| `dr changeset`   | `dr changeset`   | Identical |
| `dr visualize`   | `dr visualize`   | Identical |
| `dr chat`        | `dr chat`        | Identical |

### Commands Not in Bun CLI

The following Python CLI commands are not implemented in the Bun CLI because they were rarely used or deprecated:

- `dr annotate` - Element annotations are managed through `dr update` with properties
- `dr find` - Functionality covered by `dr search` and `dr trace`
- `dr links` - Functionality covered by `dr trace` and `dr relationship list`
- `dr claude` - Deprecated in Python CLI; use `dr chat` instead
- `dr copilot` - Deprecated in Python CLI; AI integration via agents

## Model File Compatibility

**Good news:** The Bun CLI uses the same `.dr/` directory structure and JSON format as the Python CLI. Your existing models work without modification.

```bash
# No conversion needed - just switch CLIs
cd my-existing-project
dr validate  # Uses Bun CLI now
dr list motivation  # Works with existing data
```

### File Structure (Unchanged)

```
my-project/
└── .dr/
    ├── manifest.json          # Model metadata
    └── layers/
        ├── 01-motivation.json
        ├── 02-business.json
        ├── 03-security.json
        └── ...
```

## CI/CD Migration

Update your CI/CD pipelines to use the Bun CLI.

### GitHub Actions

**Before (Python CLI):**

```yaml
name: Validate Model
on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: "3.10"
      - name: Install CLI
        run: pip install documentation-robotics
      - name: Validate
        run: dr validate
```

**After (Bun CLI):**

```yaml
name: Validate Model
on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: "18"
      - name: Install CLI
        run: npm install -g @documentation-robotics/cli
      - name: Validate
        run: dr validate
```

### GitLab CI

**Before (Python CLI):**

```yaml
validate:
  image: python:3.10
  before_script:
    - pip install documentation-robotics
  script:
    - dr validate
```

**After (Bun CLI):**

```yaml
validate:
  image: node:18
  before_script:
    - npm install -g @documentation-robotics/cli
  script:
    - dr validate
```

### CircleCI

**Before (Python CLI):**

```yaml
version: 2.1
jobs:
  validate:
    docker:
      - image: python:3.10
    steps:
      - checkout
      - run: pip install documentation-robotics
      - run: dr validate
```

**After (Bun CLI):**

```yaml
version: 2.1
jobs:
  validate:
    docker:
      - image: node:18
    steps:
      - checkout
      - run: npm install -g @documentation-robotics/cli
      - run: dr validate
```

### Jenkins

**Before (Python CLI):**

```groovy
pipeline {
    agent any
    stages {
        stage('Validate') {
            steps {
                sh 'pip install documentation-robotics'
                sh 'dr validate'
            }
        }
    }
}
```

**After (Bun CLI):**

```groovy
pipeline {
    agent any
    stages {
        stage('Validate') {
            steps {
                sh 'npm install -g @documentation-robotics/cli'
                sh 'dr validate'
            }
        }
    }
}
```

## Development Workflow Migration

### Virtual Environments

**Before (Python CLI):**

```bash
# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate  # On macOS/Linux
.venv\Scripts\activate     # On Windows

# Install CLI in editable mode
pip install -e cli/
```

**After (Bun CLI):**

```bash
# No virtual environment needed
cd cli-bun

# Install dependencies
npm install

# Build and test
npm run build
npm test
```

### Running Tests

**Before (Python CLI):**

```bash
# Python tests
pytest
pytest --cov
pytest tests/unit/
```

**After (Bun CLI):**

```bash
# Bun tests
npm test
npm run test:unit
npm run test:integration
npm run test:compatibility
```

### Code Formatting

**Before (Python CLI):**

```bash
# Python formatting
black .
isort .
```

**After (Bun CLI):**

```bash
# TypeScript formatting
npm run format
```

## API Integration Migration

If you've been importing the Python CLI as a library in your scripts:

**Before (Python CLI):**

```python
from documentation_robotics.core.model import Model
from documentation_robotics.core.element import Element

model = Model.load(".")
element = model.get_element("api-endpoint-create-order")
```

**After (Bun CLI):**

```typescript
import { Model } from "@documentation-robotics/cli";

const model = await Model.load(".");
const element = model.getElement("api-endpoint-create-order");
```

For JavaScript/TypeScript projects, you can now use the Bun CLI as a native library:

```bash
npm install @documentation-robotics/cli
```

```javascript
// ES Modules
import { Model, Element, Layer } from "@documentation-robotics/cli";

// CommonJS
const { Model, Element, Layer } = require("@documentation-robotics/cli");
```

## Troubleshooting

### "Command not found: dr"

After installing the Bun CLI, if `dr` is not found:

```bash
# Check npm global bin directory
npm config get prefix

# Add to PATH (macOS/Linux)
export PATH="$(npm config get prefix)/bin:$PATH"

# Add permanently to shell profile
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Python CLI Still Shows Deprecation Warning

If you've uninstalled the Python CLI but still see warnings:

```bash
# Verify Python CLI is uninstalled
pip list | grep documentation-robotics

# If still present, uninstall with pip
pip uninstall documentation-robotics

# Check which 'dr' command is being used
which dr  # Should point to npm global bin, not Python

# If pointing to wrong location, update PATH
export PATH="$(npm config get prefix)/bin:$PATH"
```

### Model Validation Errors After Migration

The Bun CLI has the same validators as Python CLI. If you see new validation errors:

1. **Check spec version**: Ensure your model's `specVersion` in `manifest.json` matches the CLI version
2. **Run migrate**: Use `dr migrate --dry-run` to see if migration is needed
3. **Check conformance**: Run `dr conformance` to see conformance status

```bash
# Check what would change with migration
dr migrate --dry-run

# Apply migration if needed
dr migrate

# Verify conformance
dr conformance
```

### Performance Issues

If the Bun CLI seems slow:

1. **Check Node.js version**: Ensure you have Node.js 18 or higher
2. **Use Bun runtime** (optional): Install Bun for ~2x faster execution
3. **Check for large models**: Very large models (10000+ elements) may take longer

```bash
# Check Node.js version
node --version  # Should be v18.x or higher

# Optional: Install Bun for better performance
curl -fsSL https://bun.sh/install | bash
```

### Missing Commands

If you used `annotate`, `find`, or `links` commands:

- **`annotate`**: Use `dr update <id> --properties '{"key":"value"}'` to add element metadata
- **`find`**: Use `dr search <query>` to find elements by name or ID
- **`links`**: Use `dr trace <id>` to see cross-layer references and `dr relationship list <id>` for intra-layer relationships

## Getting Help

If you encounter issues during migration:

- **Documentation**: [Bun CLI User Guide](../cli-bun/docs/user-guide/)
- **Issues**: [GitHub Issues](https://github.com/tinkermonkey/documentation_robotics/issues)
- **Discussions**: [GitHub Discussions](https://github.com/tinkermonkey/documentation_robotics/discussions)
- **CLI Help**: Run `dr --help` or `dr <command> --help` for command-specific help

## Support Policy

- **Python CLI v0.8.0**: Final release with deprecation warnings, no further updates
- **PyPI Package**: Will be removed on January 26, 2026 (1 month after deprecation announcement)
- **Bun CLI**: Active development, receives all new features and bug fixes
- **Models**: Your `.dr/` model files continue to work with Bun CLI indefinitely

## Benefits After Migration

Once you've migrated to the Bun CLI, you'll enjoy:

- **Faster execution**: ~8x faster startup time
- **Better developer experience**: Modern TypeScript tooling, IntelliSense, type safety
- **Active maintenance**: Regular updates, bug fixes, and new features
- **Ecosystem integration**: Native npm packages, VS Code extensions, and more
- **Future-proof**: All future development happens on Bun CLI

## Checklist

Use this checklist to track your migration:

- [ ] Install Node.js 18 or higher
- [ ] Install Bun CLI: `npm install -g @documentation-robotics/cli`
- [ ] Test with existing model: `dr validate`
- [ ] Update CI/CD pipelines (GitHub Actions, GitLab CI, etc.)
- [ ] Update documentation scripts and automation
- [ ] Update team documentation and onboarding materials
- [ ] Uninstall Python CLI: `pip uninstall documentation-robotics`
- [ ] Remove Python-specific dependencies from project (if any)
- [ ] Celebrate faster build times!

---

**Questions?** Open a [GitHub Discussion](https://github.com/tinkermonkey/documentation_robotics/discussions) or file an [issue](https://github.com/tinkermonkey/documentation_robotics/issues).
