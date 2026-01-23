# Migration Guide: Python CLI → TypeScript CLI

**Last Updated:** 2026-01-23
**Python CLI Version:** 0.7.x → **TypeScript CLI Version:** 0.1.0+

This guide helps you migrate from the deprecated Python CLI to the modern TypeScript CLI.

---

## Table of Contents

1. [Overview](#overview)
2. [Why Migrate?](#why-migrate)
3. [Quick Start](#quick-start)
4. [Command Mapping](#command-mapping)
5. [Feature Comparison](#feature-comparison)
6. [Breaking Changes](#breaking-changes)
7. [Migration Checklist](#migration-checklist)
8. [CI/CD Migration](#cicd-migration)
9. [Troubleshooting](#troubleshooting)

---

## Overview

The TypeScript CLI is the **official, actively maintained** implementation of Documentation Robotics. The Python CLI is deprecated and will be removed in a future release.

### Key Benefits of TypeScript CLI

- ✅ **Faster performance** - Built on Bun runtime
- ✅ **Modern architecture** - Uses relationship-catalog.json instead of deprecated link-registry.json
- ✅ **Enhanced safety** - Cascade deletion, dry-run mode, better dependency tracking
- ✅ **Active development** - Regular updates, new features, bug fixes
- ✅ **Better staging workflow** - Advanced changeset management with drift detection

---

## Why Migrate?

| Aspect | Python CLI | TypeScript CLI |
|--------|-----------|----------------|
| **Maintenance Status** | ⚠️ Deprecated (no new features) | ✅ Active development |
| **Link/Relationship System** | ❌ Uses deprecated link-registry.json | ✅ Uses modern relationship-catalog.json v2.1.0 |
| **Performance** | Moderate (CPython) | Fast (Bun runtime) |
| **Cascade Deletion** | ✅ Supported | ✅ Supported (improved) |
| **Dry-Run Mode** | ✅ Supported | ✅ Supported |
| **Staging Workflow** | Basic | ✅ Advanced (drift detection, virtual projection) |
| **Telemetry** | ❌ None | ✅ OpenTelemetry support |

**Deprecation Timeline:**
- Python CLI v0.8.0 will be the final release with deprecation warnings
- Removal planned after 1-month transition period

---

## Quick Start

### Installation

**Python CLI (old):**
```bash
pip install documentation-robotics
```

**TypeScript CLI (new):**
```bash
npm install -g @documentation-robotics/cli
# or
bun install -g @documentation-robotics/cli
```

### Verify Installation

```bash
# Old
dr --version  # Python CLI

# New
dr version    # TypeScript CLI
```

### Model Compatibility

✅ **Good News:** Your existing models are **100% compatible**. The TypeScript CLI can read models created by the Python CLI without any conversion.

Both CLIs use the same:
- Model structure (`.dr/` or `documentation-robotics/`)
- Manifest format
- Layer JSON files
- Relationship format

---

## Command Mapping

### Core Commands

| Python CLI | TypeScript CLI | Notes |
|------------|---------------|-------|
| `dr init` | `dr init` | ✅ Identical |
| `dr add <layer> <type> <name>` | `dr add <layer> <type> <name>` | ✅ Identical |
| `dr update <id>` | `dr update <id>` | ✅ Identical |
| `dr remove <id>` | `dr delete <id>` | ⚠️ Command renamed |
| `dr find <id>` | `dr show <id>` | ⚠️ Command renamed |
| `dr list <layer>` | `dr list <layer>` | ✅ Identical |
| `dr search <query>` | `dr search <query>` | ✅ Identical |
| `dr validate` | `dr validate` | ✅ Identical |

### Advanced Commands

| Python CLI | TypeScript CLI | Notes |
|------------|---------------|-------|
| `dr trace <id>` | `dr trace <id>` | ✅ Identical |
| `dr export <format>` | `dr export <format>` | ✅ Identical |
| `dr upgrade` | `dr upgrade` | ✅ Identical |
| `dr version` | `dr version` | ✅ Identical |
| `dr conformance` | `dr conformance` | ✅ Identical |

### Relationship Commands

| Python CLI | TypeScript CLI | Notes |
|------------|---------------|-------|
| `dr relationship add` | `dr relationship add` | ✅ Identical |
| `dr relationship delete` | `dr relationship delete` | ✅ Identical |
| `dr relationship list` | `dr relationship list` | ✅ Identical |
| `dr relationship show` | `dr relationship show` | ✅ Identical |

### Link/Catalog Commands (Major Change)

| Python CLI | TypeScript CLI | Notes |
|------------|---------------|-------|
| `dr links types` | `dr catalog types` | ⚠️ New command, modern catalog |
| `dr links list` | `dr catalog types --format json` | ⚠️ Different approach |
| `dr links validate` | `dr catalog validate` | ⚠️ New command |
| `dr links docs` | `dr catalog docs` | ⚠️ New command |
| `dr links registry` | `dr catalog info` | ⚠️ Shows modern catalog info |
| `dr links find` | ❌ Not needed | Reference validation built-in |
| `dr links trace` | `dr trace` | ✅ Use trace command instead |
| `dr links check-staleness` | ❌ Not implemented | Low priority feature |
| `dr links stats` | `dr catalog info` | Similar info available |

### Changeset Commands

| Python CLI | TypeScript CLI | Notes |
|------------|---------------|-------|
| `dr changeset create` | `dr changeset create` | ✅ Enhanced in TS CLI |
| `dr changeset list` | `dr changeset list` | ✅ Identical |
| `dr changeset activate` | `dr changeset activate` | ✅ Identical |
| `dr changeset deactivate` | `dr changeset deactivate` | ✅ Identical |
| `dr changeset stage` | `dr changeset stage` | ✅ Enhanced in TS CLI |
| `dr changeset unstage` | `dr changeset unstage` | ✅ New in TS CLI |
| `dr changeset preview` | `dr changeset preview` | ✅ Enhanced in TS CLI |
| `dr changeset commit` | `dr changeset commit` | ✅ Enhanced (drift detection) |
| `dr changeset discard` | `dr changeset discard` | ✅ Identical |
| `dr changeset diff` | `dr changeset diff` | ✅ New in TS CLI |
| `dr changeset export` | `dr changeset export` | ✅ New in TS CLI |
| `dr changeset import` | `dr changeset import` | ✅ New in TS CLI |

### Annotation Commands

| Python CLI | TypeScript CLI | Notes |
|------------|---------------|-------|
| `dr annotate <id>` | ❌ Not implemented | Use element `description` field |
| `dr annotate list` | ❌ Not implemented | Low priority feature |
| `dr annotate thread` | ❌ Not implemented | Use external tools (GitHub Issues) |

**Workaround:** Use the `description` field on elements for annotations:
```bash
dr update <id> --description "Your annotation here"
```

---

## Feature Comparison

### ✅ Feature Parity (Works the Same)

- **Model initialization** - `dr init`
- **Element CRUD** - Add, update, delete (renamed from `remove`), show (renamed from `find`)
- **List and search** - Same syntax and output
- **Validation** - Same 4-stage pipeline (schema, naming, reference, semantic)
- **Export formats** - ArchiMate, OpenAPI, JSON Schema, PlantUML, Markdown
- **Trace dependencies** - Same dependency tracking
- **Relationship management** - Intra-layer relationships work identically
- **Changeset basics** - Create, activate, deactivate, commit, discard

### 🆕 TypeScript CLI Enhancements

#### 1. **Enhanced Delete Command**
```bash
# Cascade deletion (removes dependents automatically)
dr delete <id> --cascade

# Dry-run mode (preview without deleting)
dr delete <id> --dry-run

# Combined (preview cascade deletion)
dr delete <id> --cascade --dry-run
```

#### 2. **Modern Relationship Catalog**
```bash
# List relationship types
dr catalog types

# Filter by category
dr catalog types --category structural

# Search relationships
dr catalog search "composition"

# Validate relationships
dr catalog validate --strict

# Generate documentation
dr catalog docs --output relationships.md
```

#### 3. **Advanced Changeset Features**
```bash
# Drift detection (warns if base model changed)
dr changeset commit <name>

# Virtual projection (preview merged state)
dr changeset preview <name>

# Export/import changesets
dr changeset export <name> --output changeset.json
dr changeset import changeset.json

# Unstage specific changes
dr changeset unstage <name> --element-id <id>

# Detailed diff
dr changeset diff <name>
```

#### 4. **Telemetry & Observability**
- OpenTelemetry instrumentation
- Span tracking for all operations
- Performance monitoring
- Error tracking

### ❌ Python CLI Features Not in TypeScript CLI

#### 1. **Annotation System** (Low Impact)
- **Python CLI:** Thread-based annotations on elements
- **Workaround:** Use element `description` field or external tools:
  ```bash
  # Add annotation to element
  dr update <id> --description "Important note about this element"

  # Use GitHub Issues for collaborative discussions
  # Use Notion/Confluence for extended documentation
  ```

#### 2. **Link Staleness Detection** (Low Impact)
- **Python CLI:** `dr links check-staleness` checks commit age
- **Workaround:** Manual review or use git tools:
  ```bash
  # Check recently modified elements
  dr list <layer> --format json | jq '.[] | select(.modifiedAt > "2026-01-01")'
  ```

#### 3. **Link Path Tracing** (Covered by Trace)
- **Python CLI:** `dr links trace` finds paths between elements
- **TypeScript CLI:** Use `dr trace <id>` which provides similar functionality

---

## Breaking Changes

### 1. Command Renames

| Old (Python) | New (TypeScript) | Migration |
|--------------|------------------|-----------|
| `dr remove <id>` | `dr delete <id>` | Simple find-replace in scripts |
| `dr find <id>` | `dr show <id>` | Simple find-replace in scripts |
| `dr links *` | `dr catalog *` | See [Link/Catalog Commands](#linkcatalog-commands-major-change) |

### 2. Output Format Differences

**Python CLI:**
- Colorized tables with `rich` library
- YAML output option

**TypeScript CLI:**
- Colorized tables with `ansis` library (similar)
- No YAML output (JSON only)
- More consistent JSON structure

**Migration:** If you parse CLI output in scripts:
```bash
# Old (Python)
dr list motivation --format yaml

# New (TypeScript)
dr list motivation --format json
```

### 3. Deleted Flags

| Command | Removed Flag | Alternative |
|---------|-------------|-------------|
| `dr delete` | `--yes` | Use `--force` instead |
| `dr remove` | (entire command) | Use `dr delete` |

### 4. Link Registry → Relationship Catalog

**Major architectural change:**

**Python CLI** uses deprecated `link-registry.json`:
- 39 link types
- Field-path based references
- Deprecated in spec v0.7.0

**TypeScript CLI** uses modern `relationship-catalog.json`:
- 34 relationship types
- Predicate-based relationships
- Active system (spec v2.1.0+)

**Migration:**
```bash
# Old (Python) - deprecated system
dr links types --category motivation

# New (TypeScript) - modern catalog
dr catalog types --category structural
```

---

## Migration Checklist

### Pre-Migration

- [ ] **Backup your model**
  ```bash
  tar -czf model-backup-$(date +%Y%m%d).tar.gz .dr/
  ```

- [ ] **Document current Python CLI version**
  ```bash
  dr --version > python-cli-version.txt
  ```

- [ ] **List all elements**
  ```bash
  dr list --all --format json > elements-snapshot.json
  ```

- [ ] **Export model in all formats**
  ```bash
  dr export archimate --output archimate-backup.xml
  dr export markdown --output docs-backup/
  ```

### Installation

- [ ] **Install TypeScript CLI**
  ```bash
  npm install -g @documentation-robotics/cli
  ```

- [ ] **Verify installation**
  ```bash
  dr version
  ```

### Validation

- [ ] **Validate model with TypeScript CLI**
  ```bash
  dr validate
  ```

- [ ] **Compare element counts**
  ```bash
  # Python
  dr list --all | wc -l

  # TypeScript (should match)
  dr list --all | wc -l
  ```

- [ ] **Validate relationships**
  ```bash
  dr catalog validate
  ```

### Script Migration

- [ ] **Update CI/CD scripts** (see [CI/CD Migration](#cicd-migration))
- [ ] **Replace command names** (`remove` → `delete`, `find` → `show`)
- [ ] **Update link commands** (`dr links` → `dr catalog`)
- [ ] **Test all scripts** in staging environment

### Cleanup

- [ ] **Uninstall Python CLI** (after confirming everything works)
  ```bash
  pip uninstall documentation-robotics
  ```

- [ ] **Remove Python CLI references** from documentation
- [ ] **Update team documentation** with new commands

---

## CI/CD Migration

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

      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.10'

      - name: Install Python CLI
        run: pip install documentation-robotics

      - name: Validate model
        run: dr validate --strict
```

**After (TypeScript CLI):**
```yaml
name: Validate Model
on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Set up Bun
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Install TypeScript CLI
        run: bun install -g @documentation-robotics/cli

      - name: Validate model
        run: dr validate --strict

      - name: Validate relationships
        run: dr catalog validate --strict
```

### GitLab CI

**Before (Python CLI):**
```yaml
validate:
  image: python:3.10
  script:
    - pip install documentation-robotics
    - dr validate --strict
```

**After (TypeScript CLI):**
```yaml
validate:
  image: oven/bun:latest
  script:
    - bun install -g @documentation-robotics/cli
    - dr validate --strict
    - dr catalog validate --strict
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
                sh 'dr validate --strict'
            }
        }
    }
}
```

**After (TypeScript CLI):**
```groovy
pipeline {
    agent any
    stages {
        stage('Setup') {
            steps {
                sh 'curl -fsSL https://bun.sh/install | bash'
                sh 'export PATH="$HOME/.bun/bin:$PATH"'
            }
        }
        stage('Validate') {
            steps {
                sh 'bun install -g @documentation-robotics/cli'
                sh 'dr validate --strict'
                sh 'dr catalog validate --strict'
            }
        }
    }
}
```

### Docker

**Before (Python CLI):**
```dockerfile
FROM python:3.10-slim

RUN pip install documentation-robotics

WORKDIR /model
COPY . .

CMD ["dr", "validate"]
```

**After (TypeScript CLI):**
```dockerfile
FROM oven/bun:latest

RUN bun install -g @documentation-robotics/cli

WORKDIR /model
COPY . .

CMD ["dr", "validate"]
```

---

## Troubleshooting

### Issue: "Command not found: dr"

**Cause:** TypeScript CLI not in PATH

**Solution:**
```bash
# Check installation
npm list -g @documentation-robotics/cli

# If not installed
npm install -g @documentation-robotics/cli

# Check PATH
echo $PATH

# Add to PATH if needed (add to ~/.bashrc or ~/.zshrc)
export PATH="$PATH:$(npm bin -g)"
```

### Issue: "Element <id> not found" (but it exists in Python CLI)

**Cause:** Different working directory or model path

**Solution:**
```bash
# Check current directory
pwd

# Verify model exists
ls -la .dr/

# Try explicit model path
dr show <id> --model /path/to/model
```

### Issue: "Unknown predicate" in catalog validate

**Cause:** Using predicates from deprecated link-registry.json

**Solution:**
```bash
# List valid predicates
dr catalog types --predicates

# Update relationships to use catalog predicates
dr relationship delete <source> <target>
dr relationship add <source> <target> --predicate <valid-predicate>
```

### Issue: Annotations are missing

**Cause:** Annotation system not implemented in TypeScript CLI

**Solution:**
```bash
# Export annotations from Python CLI first (manual process)
# Then add to element descriptions
dr update <id> --description "Annotation content here"

# Or use external tools
# - GitHub Issues for collaborative discussions
# - Notion/Confluence for extended documentation
```

### Issue: Scripts using `dr remove` fail

**Cause:** Command renamed to `delete`

**Solution:**
```bash
# Find all occurrences
grep -r "dr remove" .

# Replace
sed -i 's/dr remove/dr delete/g' script.sh

# Or create alias (temporary)
alias dr remove='dr delete'
```

### Issue: Different output format breaks parsing

**Cause:** Output format differences between Python and TypeScript CLIs

**Solution:**
```bash
# Always use --format json for parsing
dr list <layer> --format json | jq '.[] | .id'

# Don't parse table output (fragile)
```

### Issue: Performance seems slower than Python CLI

**Cause:** Possible Bun runtime issue or large model

**Solution:**
```bash
# Check Bun version
bun --version

# Update Bun to latest
curl -fsSL https://bun.sh/install | bash

# Check model size
du -sh .dr/

# Consider model optimization
dr upgrade  # May optimize storage format
```

---

## Support & Resources

### Documentation
- **TypeScript CLI README:** `/cli/README.md`
- **Specification:** `/spec/` directory
- **CLAUDE.md:** Project conventions and guidelines

### Getting Help
- **GitHub Issues:** https://github.com/anthropics/documentation-robotics/issues
- **GitHub Discussions:** For questions and community support

### Feedback
If you encounter issues during migration:
1. Check this guide first
2. Search existing GitHub issues
3. Create a new issue with:
   - Python CLI version
   - TypeScript CLI version
   - Model details
   - Error messages
   - Steps to reproduce

---

## Summary

### Migration is Straightforward

✅ **Models are compatible** - No conversion needed
✅ **Most commands identical** - Minimal script changes
✅ **Better features** - Cascade deletion, modern catalog, enhanced staging
✅ **Active support** - Ongoing development and updates

### Key Changes to Remember

1. **Command renames:** `remove` → `delete`, `find` → `show`
2. **Link system:** `dr links` → `dr catalog` (modern architecture)
3. **Annotations:** Use element `description` or external tools
4. **Output:** JSON only (no YAML)

### Recommended Timeline

- **Week 1:** Install TypeScript CLI, validate compatibility
- **Week 2:** Update scripts and CI/CD pipelines
- **Week 3:** Test in staging environment
- **Week 4:** Production deployment, uninstall Python CLI

---

**Questions?** Open a GitHub Discussion or Issue. We're here to help! 🚀
