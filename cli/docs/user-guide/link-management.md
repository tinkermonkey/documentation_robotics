# Link Management Guide

This guide covers the `dr links` command group and link validation features for managing cross-layer references in your Documentation Robotics models.

## Overview

Cross-layer links are references that connect elements across the 11 architectural layers. The link management system provides:

- **Link Registry** - Catalog of all valid cross-layer reference patterns
- **Link Discovery** - Automatic detection of links in your model
- **Link Validation** - Verify that links point to valid targets with correct types
- **Link Documentation** - Auto-generate comprehensive link documentation
- **Link Navigation** - Query and trace link paths between elements

## Table of Contents

- [Migration from Existing Models](#migration-from-existing-models)
- [Link Types](#link-types)
- [Link Validation](#link-validation)
- [Command Reference](#command-reference)
  - [dr links types](#dr-links-types)
  - [dr links registry](#dr-links-registry)
  - [dr links stats](#dr-links-stats)
  - [dr links docs](#dr-links-docs)
  - [dr links list](#dr-links-list)
  - [dr links find](#dr-links-find)
  - [dr links validate](#dr-links-validate)
  - [dr links trace](#dr-links-trace)
- [Validation Integration](#validation-integration)
- [Best Practices](#best-practices)

## Migration from Existing Models

If you have an existing Documentation Robotics model that uses non-standard or inconsistent cross-layer references, you can migrate it to use standardized patterns in preparation for the v0.2.0 specification release.

### Quick Start

```bash
# 1. Check what migrations are needed (default behavior)
dr migrate

# 2. See detailed changes (dry run)
dr migrate --dry-run

# 3. Apply all migrations to latest version
dr migrate --apply

# 4. Validate the migrated model
dr validate --validate-links
```

### What Gets Migrated

The migration tool detects and fixes:

1. **Naming Convention Issues**:
   - camelCase → kebab-case in relationship names
   - Inconsistent field naming
   - Missing hyphens in compound names

   ```yaml
   # Before
   motivation:
     supportGoals: ["goal-1"]  # Wrong: camelCase

   # After
   motivation:
     supports-goals: ["goal-1"]  # Correct: kebab-case
   ```

2. **Cardinality Mismatches**:
   - Single values when arrays expected
   - Arrays when single values expected

   ```yaml
   # Before
   business:
     realizes-service: "service-1"  # Wrong: single value

   # After
   business:
     realizes-services: ["service-1"]  # Correct: array
   ```

3. **Format Issues**:
   - Non-UUID values when UUIDs expected
   - Invalid path references
   - Incorrect duration formats

### Migration Workflow

The migration system automatically detects your model's current version and applies all necessary migrations to bring it to the latest version.

#### 1. Check What's Needed

By default, `dr migrate` checks what migrations are needed:

```bash
dr migrate
```

Output:

```
Current Model Version: 0.1.1
Latest Available Version: 1.0.0

╭─ Migration Check ────────────────────────────────────╮
│ 1 migration(s) needed to upgrade from v0.1.1 to     │
│ v0.2.0                                               │
╰──────────────────────────────────────────────────────╯

Migration Path
┌──────┬──────────┬────────┬─────────────────────────────────────┐
│ Step │ From     │ To     │ Description                         │
├──────┼──────────┼────────┼─────────────────────────────────────┤
│ 1    │ 0.1.0    │ 1.0.0  │ Standardize cross-layer reference   │
│      │          │        │ patterns                            │
└──────┴──────────┴────────┴─────────────────────────────────────┘

Next steps:
  1. Preview changes: dr migrate --dry-run
  2. Apply migrations: dr migrate --apply
  3. Validate result: dr validate --validate-links
```

#### 2. Preview Changes (Dry Run)

See exactly what would change without modifying files:

```bash
dr migrate --dry-run
```

Output:

```
╭─ Dry Run ────────────────────────────────────────────╮
│ Preview: 1 migration(s) from v0.1.1 to v0.2.0       │
╰──────────────────────────────────────────────────────╯

Step 1: 0.1.0 → 1.0.0
Standardize cross-layer reference patterns

  Found 15 changes:

  services.yaml
    • service-customer-management: motivation.supportGoals → motivation.supports-goals
    • service-billing: business.realizes-service → business.realizes-service
    ... and 13 more

  ... and 7 more files

To apply these migrations:
  Run dr migrate --apply
```

#### 3. Apply Migrations

Apply all migrations to bring your model to the latest version:

```bash
dr migrate --apply
```

You'll be prompted to confirm:

```
╭─ Applying Migrations ────────────────────────────────╮
│ Migrating from v0.1.1 to v0.2.0                      │
│ 1 migration step(s) will be applied                  │
╰──────────────────────────────────────────────────────╯

  1. 0.1.0 → 1.0.0: Standardize cross-layer reference patterns

This will modify your model files. Continue? [y/N]: y

Applying migrations...

✓ Successfully applied 1 migration(s)
  1. 0.1.0 → 1.0.0
     Modified 8 file(s), 15 change(s)

✓ Updated manifest to v0.2.0

Next steps:
  1. Review changes: git diff
  2. Validate model: dr validate --validate-links
  3. Test your application
  4. Commit changes: git add . && git commit
```

#### 4. Migrate to Specific Version (Optional)

You can also migrate to a specific version instead of the latest:

```bash
dr migrate --apply --to-version 0.2.0
```

#### 5. Validate Migrated Model

Verify the migration was successful:

```bash
dr validate --validate-links
```

If successful:

```
Validating model...
Validating cross-layer links...

✓ All links are valid

✓ Validation passed
```

#### 6. Review and Commit

Review the changes before committing:

```bash
# See what changed
git diff

# Stage the changes
git add documentation-robotics/

# Commit with meaningful message
git commit -m "Migrate cross-layer references to v0.2.0 standards

- Fixed naming conventions (camelCase → kebab-case)
- Fixed cardinality mismatches
- Migrated 15 references across 8 files
- All links validated successfully"
```

### Migration Safety

The migration tool is designed to be safe:

1. **Non-Destructive by Default**: `--check` and `--dry-run` don't modify files
2. **Confirmation Required**: `--apply` prompts before making changes
3. **Git Integration**: Use version control to review and revert if needed
4. **Validation**: Always validate after migration

### Recommended Workflow

```bash
# Create a git branch for migration
git checkout -b migrate-link-standards

# Check what's needed
dr migrate

# Preview changes
dr migrate --dry-run

# Apply migrations
dr migrate --apply

# Validate
dr validate --validate-links --strict-links

# Review changes
git diff

# If satisfied, commit
git add .
git commit -m "Migrate to v0.2.0 specification

Applied automated migrations:
- Standardized cross-layer reference patterns
- Fixed naming conventions (camelCase → kebab-case)
- Fixed cardinality mismatches
- Updated manifest to v0.2.0"

# Merge to main
git checkout main
git merge migrate-link-standards
```

### Troubleshooting Migration

**Issue: "Model manifest not found"**

```bash
# Make sure you're in the project root
cd /path/to/project

# Check that manifest exists
ls -la documentation-robotics/model/manifest.yaml

# If not initialized, create project first
dr init my-project
```

**Issue: Migration doesn't detect any issues**

```bash
# Your model may already be compliant
# Check current version
dr migrate

# Verify link registry is accessible
dr links types
```

**Issue: Migration fails to apply**

```bash
# Check file permissions
ls -la documentation-robotics/model/

# Ensure files aren't read-only
chmod -R u+w documentation-robotics/model/

# Check for file conflicts
git status
```

**Issue: Validation fails after migration**

```bash
# See what's wrong
dr validate --validate-links

# Review what was migrated
git diff

# Revert if needed
git checkout documentation-robotics/

# Try migration again
dr migrate --dry-run
dr migrate --apply
```

## Link Types

The system recognizes four types of cross-layer reference patterns:

### 1. X-Extensions (OpenAPI Standard)

Used primarily in API and Application layers:

```yaml
x-archimate-ref: "element-id"
x-business-service-ref: "service-id"
x-security-model-ref: "model-id"
```

### 2. Dot-Notation Properties

Explicit nested reference structures:

```yaml
motivation:
  supports-goals: ["goal-1", "goal-2"]
  fulfills-requirements: ["req-1"]
```

### 3. Nested Object References

Grouped references in a dedicated section:

```yaml
motivationAlignment:
  supportsGoals: ["goal-1"]
  deliversValue: ["value-1"]
business:
  implements-processes: ["process-1"]
```

### 4. Direct Field Names

Standard property names that reference other layers:

```yaml
operationId: "operation-123"
schemaRef: "schema-path.json"
$ref: "#/definitions/Component"
```

## Link Validation

Link validation checks:

1. **Existence** - Target elements exist in the model
2. **Type Compatibility** - Targets are the correct element type
3. **Cardinality** - Single vs. array values match expectations
4. **Format** - UUID, path, duration formats are valid
5. **Suggestions** - Levenshtein distance for typo detection

### Validation Modes

**Warning Mode** (Default):

- Link issues are reported as warnings
- Model validation still passes
- Use for development and iterative modeling

**Strict Mode**:

- Link issues are treated as errors
- Model validation fails if links are broken
- Use for CI/CD and production deployments

## Command Reference

### dr links types

List all available link types from the registry.

**Usage:**

```bash
dr links types
dr links types --layer 06-api
dr links types --category motivation
dr links types --format json
```

**Options:**

- `--layer TEXT` - Filter by source or target layer (e.g., "06-api")
- `--category TEXT` - Filter by category (motivation, business, security, etc.)
- `--format [json|table|markdown]` - Output format (default: table)

**Examples:**

```bash
# Show all motivation-related links
dr links types --category motivation

# Show links that originate from the API layer
dr links types --layer 06-api

# Export as JSON for tooling
dr links types --format json > link-types.json
```

**Output:**

```
ID                              Name                      Category        Format
================================================================================
motivation-supports-goals       Supports Goals            motivation      uuid
motivation-fulfills-requirements Fulfills Requirements    motivation      uuid
business-service-ref            Business Service Ref      business        uuid

Total: 24 link types
```

### dr links registry

Display or export the complete link registry.

**Usage:**

```bash
dr links registry
dr links registry --format html --output ./docs/links.html
dr links registry --detailed --output ./docs/links.md
```

**Options:**

- `--format [json|markdown|html]` - Output format (default: markdown)
- `--output PATH` - Output file (defaults to stdout)
- `--detailed` - Generate detailed documentation (markdown only)

**Examples:**

```bash
# View registry summary in terminal
dr links registry

# Generate detailed markdown documentation
dr links registry --format markdown --detailed --output LINK_REGISTRY.md

# Generate interactive HTML documentation
dr links registry --format html --output link-registry.html

# Export as JSON for tooling
dr links registry --format json --output link-registry.json
```

**Output:**
The HTML format generates an interactive webpage with:

- Searchable link catalog
- Category filtering
- Format indicators
- Field path examples
- Statistics dashboard

### dr links stats

Show statistics about the link registry and model links.

**Usage:**

```bash
dr links stats
```

**Output:**

```
=== Link Registry Statistics ===

Total link types: 24
Categories: 8

Link types by category:
  motivation: 4
  business: 3
  security: 2
  api: 3
  data: 3
  ux: 3
  navigation: 3
  apm: 3

Source layers: 02-business, 04-application, 05-security, 06-api, 07-domain, 08-datastore, 09-ux, 10-navigation
Target layers: 01-motivation, 02-business, 03-archimate, 05-security, 06-api, 07-domain, 08-datastore, 09-ux

=== Model Link Statistics ===

Total links found: 156
Total elements: 89
Elements with outgoing links: 45
Elements with incoming links: 67
```

### dr links docs

Generate comprehensive link documentation in multiple formats.

**Usage:**

```bash
dr links docs
dr links docs --output-dir ./build/docs
dr links docs --formats markdown --formats html --formats mermaid
dr links docs --category motivation
```

**Options:**

- `--output-dir PATH` - Output directory (default: ./docs/links)
- `--formats [markdown|html|mermaid|quick-ref]` - Formats to generate (can specify multiple)
- `--category TEXT` - Generate docs for specific category only

**Examples:**

```bash
# Generate all default formats (markdown + HTML)
dr links docs

# Generate everything including diagrams
dr links docs --formats markdown --formats html --formats mermaid --formats quick-ref

# Generate only for motivation layer
dr links docs --category motivation --output-dir ./docs/motivation-links

# Custom output location
dr links docs --output-dir ./build/documentation/links
```

**Generated Files:**

- `link-registry-summary.md` - Overview with category tables
- `link-registry-detailed.md` - Complete reference with all details
- `link-registry.html` - Interactive searchable documentation
- `link-diagram-*.mmd` - Mermaid diagrams showing link relationships
- `link-quick-reference.md` - Common patterns quick reference

### dr links list

List all link instances in the current model.

**Usage:**

```bash
dr links list
dr links list --layer 06-api
dr links list --type motivation-supports-goals
dr links list --format json
```

**Options:**

- `--layer TEXT` - Filter by source layer
- `--type TEXT` - Filter by link type ID
- `--format [json|table|tree]` - Output format (default: table)

**Status:** This command requires a loaded model (integration pending).

### dr links find

Find all links connected to a specific element.

**Usage:**

```bash
dr links find <element-id>
dr links find <element-id> --direction up
dr links find <element-id> --link-type motivation-supports-goals
dr links find <element-id> --format json
```

**Arguments:**

- `ELEMENT-ID` - Element ID to find links for

**Options:**

- `--direction [up|down|both]` - Link direction (default: both)
  - `up` - Incoming links (other elements referencing this one)
  - `down` - Outgoing links (this element references others)
  - `both` - All connected links
- `--link-type TEXT` - Filter by link type ID
- `--format [json|table]` - Output format (default: table)

**Examples:**

```bash
# Find all links for a service
dr links find service-customer-management

# Find what references a goal
dr links find goal-improve-satisfaction --direction up

# Find what a component references
dr links find component-auth-service --direction down

# Filter by link type
dr links find service-billing --link-type business-service-ref
```

**Status:** This command requires a loaded model (integration pending).

### dr links validate

Validate all links in the current model.

**Usage:**

```bash
dr links validate
dr links validate --layer 06-api
dr links validate --type motivation-supports-goals
dr links validate --strict
dr links validate --format json
```

**Options:**

- `--layer TEXT` - Validate only links in a specific layer
- `--type TEXT` - Validate only a specific link type
- `--strict` - Treat warnings as errors
- `--format [text|json]` - Output format (default: text)

**Examples:**

```bash
# Validate all links
dr links validate

# Validate only API layer links
dr links validate --layer 06-api

# Strict validation for CI/CD
dr links validate --strict

# JSON output for tooling
dr links validate --format json > link-validation.json
```

**Output:**

```
Validating links...

[ERROR] missing_target:
  Link target 'goal-nonexistent' does not exist in the model
  Location: service-1 -> motivation.supports-goals
  Suggestion: Did you mean 'goal-customer-satisfaction'?

[WARNING] empty_array:
  Link is an empty array
  Location: service-2 -> motivation.supports-goals
  Suggestion: Either remove motivation.supports-goals or add target IDs

Validation Summary:
  Total issues: 2
  Errors: 1
  Warnings: 1
```

**Status:** This command requires a loaded model (integration pending).

### dr links trace

Find a path between two elements through links.

**Usage:**

```bash
dr links trace <source-id> <target-id>
dr links trace <source-id> <target-id> --show-types
dr links trace <source-id> <target-id> --max-hops 10
```

**Arguments:**

- `SOURCE-ID` - Starting element ID
- `TARGET-ID` - Target element ID

**Options:**

- `--show-types` - Show link types in the path
- `--max-hops INT` - Maximum number of hops (default: 10)

**Examples:**

```bash
# Find path from component to goal
dr links trace component-auth-service goal-improve-security

# Show link types in path
dr links trace service-billing goal-reduce-costs --show-types

# Limit search depth
dr links trace app-service-1 goal-1 --max-hops 5
```

**Output:**

```
Tracing path from component-auth-service to goal-improve-security...

Path found with 3 hops:

component-auth-service
  --[Implements Service]-->
service-identity-management
  --[Supports Process]-->
process-authentication
  --[Supports Goal]-->
goal-improve-security

Total distance: 3 hops
```

**Status:** This command requires a loaded model (integration pending).

## Validation Integration

Link validation is integrated into the main `dr validate` command.

### dr validate with Links

**Usage:**

```bash
dr validate --validate-links
dr validate --validate-links --strict-links
```

**Options:**

- `--validate-links` - Enable cross-layer link validation
- `--strict-links` - Treat link warnings as errors

**Examples:**

```bash
# Standard validation with link checks
dr validate --validate-links

# Strict mode for CI/CD
dr validate --strict --validate-links --strict-links

# JSON output for tooling integration
dr validate --validate-links --output json
```

**Output:**

```
Validating model...

=== Validation Summary ===
Layer           Elements  Errors  Warnings  Status
01-motivation   5         0       0         ✓
02-business     12        0       1         ✓
...

Validating cross-layer links...

Found 2 link validation issues

Schema Errors:
  ✗ [02-business] service-1: Invalid property 'name'

Link Warnings:
  ⚠  service-2 -> motivation.supports-goals
     Link is an empty array
     Suggestion: Either remove motivation.supports-goals or add target IDs

✗ Validation failed
   1 error(s), 1 warning(s)
```

### CI/CD Integration

For CI/CD pipelines, use strict mode to ensure link integrity:

```bash
#!/bin/bash
# pre-commit hook or CI script

dr validate --validate-links --strict-links --output json > validation-report.json

if [ $? -ne 0 ]; then
  echo "❌ Validation failed"
  cat validation-report.json
  exit 1
fi

echo "✅ Validation passed"
```

### Pre-Commit Hook

Add link validation to your pre-commit hooks:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: dr-validate-links
        name: Validate DR Links
        entry: dr validate --validate-links
        language: system
        pass_filenames: false
        always_run: true
```

## Best Practices

### 1. Use Appropriate Link Types

Choose the right reference pattern for your layer:

```yaml
# ✅ Good: Use x-extensions in API layer (OpenAPI standard)
paths:
  /customers:
    x-business-service-ref: "service-customer-management"

# ❌ Bad: Custom field names in OpenAPI
paths:
  /customers:
    business-service: "service-customer-management"  # Not standard
```

### 2. Validate Early and Often

Run link validation during development:

```bash
# Check links as you work
dr validate --validate-links

# Use quick validation in watch mode
watch -n 30 'dr validate --validate-links --layer 06-api'
```

### 3. Document Custom Extensions

If you create custom link types, document them:

```yaml
# Add to link-registry.json with full metadata
{
  "id": "custom-integration-ref",
  "name": "Integration Reference",
  "category": "integration",
  "description": "Reference to integration patterns",
  "examples": ["x-integration-ref: pattern-123"],
}
```

### 4. Use Strict Mode in CI/CD

Enable strict validation for production:

```bash
# Development: warnings OK
dr validate --validate-links

# CI/CD: no warnings allowed
dr validate --validate-links --strict-links
```

### 5. Generate Documentation Regularly

Keep link documentation up to date:

```bash
# Generate after registry updates
dr links docs --output-dir ./docs/architecture/links

# Commit to version control
git add docs/architecture/links/
git commit -m "Update link documentation"
```

### 6. Trace Dependencies

Use path tracing to understand dependencies:

```bash
# Understand impact of changes
dr links trace component-to-change goal-business-objective

# Document critical paths
dr links trace entry-point critical-service --show-types > critical-path.txt
```

### 7. Monitor Link Health

Track link quality over time:

```bash
# Check link statistics
dr links stats

# Validate and log results
dr validate --validate-links --output json | \
  jq '.link_issues | length' >> metrics/link-quality.log
```

## Troubleshooting

### Missing Link Registry

**Error:**

```
Error: Link registry not found at /path/to/link-registry.json
```

**Solution:**
Ensure you're running from the repository root or specify the registry path via environment variable:

```bash
export DR_LINK_REGISTRY=/path/to/spec/schemas/link-registry.json
dr links types
```

### Validation Warnings

**Warning:**

```
Link validation skipped: LinkRegistry not found
```

**Solution:**
The link registry is part of the DR specification. Ensure you have the latest spec files:

```bash
# Update to latest CLI version
pip install --upgrade documentation-robotics

# Check version
dr --version
```

### Broken Links After Refactoring

After renaming or moving elements:

```bash
# 1. Find broken links
dr validate --validate-links > broken-links.txt

# 2. Use suggestions to fix
# The validator will suggest similar element IDs

# 3. Update references in your model files

# 4. Re-validate
dr validate --validate-links
```

## Related Documentation

- [Cross-Layer Reference Registry](https://github.com/tinkermonkey/documentation_robotics/blob/main/spec/core/06-cross-layer-reference-registry.md) - Complete catalog
- [Validation Guide](./validation.md) - General validation documentation
- [Claude Code Integration](./claude-code-integration.md) - AI-powered link discovery

## Version History

- **v3.0.0** (Planned) - Full link validation with strict mode
- **v0.4.0** (Current) - Link registry, analyzer, and validator implementation
- **v0.3.3** - Foundation for link management

## Feedback

Found an issue or have suggestions? [Open an issue](https://github.com/tinkermonkey/documentation_robotics/issues) on GitHub.
