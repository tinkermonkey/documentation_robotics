# CLI Scripts

This directory contains build-time and standalone scripts for the Documentation Robotics CLI.

## Script Categories

### Build-Time Scripts

Executed during `npm run build` to generate code and synchronize schemas:

- **`generate-registry.ts`** - Generates layer registry from spec layer instances
- **`generate-validators.ts`** - Generates validators from spec schemas
- **`sync-spec-schemas.sh`** - Synchronizes schemas from `spec/` to `cli/src/schemas/bundled/`

### Standalone Scripts

Independent scripts for specific tasks:

- **`relationship-audit.ts`** - Standalone relationship quality audit (see below)
- **`generate-openapi.ts`** - Generates OpenAPI spec from visualization server

### Utility Scripts

Helper scripts for development and testing:

- **`run-parallel-tests.sh`** - Runs tests in parallel shards (CI optimization)
- **`validate-coverage-threshold.js`** - Validates test coverage meets threshold
- **`update-test-ids.py`** - Updates test element IDs in bulk
- **`fix-process-exit.py`** - Fixes process.exit calls in test files

## Relationship Audit Script

### Overview

`relationship-audit.ts` is a standalone script that performs comprehensive relationship quality analysis on Documentation Robotics models. It's designed for:

- **CI/CD Pipelines** - Automated quality gates in GitHub Actions, GitLab CI, etc.
- **Pre-commit Hooks** - Validate relationship quality before committing
- **Scheduled Audits** - Daily/weekly quality monitoring via cron jobs
- **Local Development** - Quick quality checks without full CLI

### Features

- **Coverage Analysis** - Measures isolation, density, and predicate utilization
- **Gap Detection** - Identifies missing relationships based on standard patterns
- **Duplicate Detection** - Finds semantically overlapping relationships
- **Balance Assessment** - Evaluates relationship density per node type
- **Connectivity Analysis** - Analyzes graph structure and components
- **Multiple Formats** - Outputs text, JSON, or markdown
- **Quality Thresholds** - Exit codes for CI/CD integration

### Usage

#### Basic Usage

```bash
# Run from CLI directory
cd cli

# Text output to stdout
npm run audit:relationships

# JSON format
npm run audit:relationships -- --format json

# Markdown format
npm run audit:relationships -- --format markdown

# Save to file
npm run audit:relationships -- --output audit-report.md
```

#### Advanced Options

```bash
# Audit specific layer
npm run audit:relationships -- --layer api

# Verbose output (shows progress)
npm run audit:relationships -- --verbose

# Quality gate mode (exit 1 if issues detected)
npm run audit:relationships -- --threshold

# Combine options
npm run audit:relationships -- --layer security --format json --output security-audit.json --verbose
```

#### Direct Execution

```bash
# Run with tsx (no npm)
tsx scripts/relationship-audit.ts --help
tsx scripts/relationship-audit.ts --format json --threshold
```

### Command-Line Options

| Option        | Short | Description                               | Default    |
| ------------- | ----- | ----------------------------------------- | ---------- |
| `--layer`     | `-l`  | Audit specific layer only                 | All layers |
| `--format`    | `-f`  | Output format: `text`, `json`, `markdown` | `text`     |
| `--output`    | `-o`  | Write to file instead of stdout           | stdout     |
| `--verbose`   | `-v`  | Show detailed progress                    | `false`    |
| `--threshold` | `-t`  | Exit 1 if quality issues detected         | `false`    |
| `--help`      | `-h`  | Show help message                         | -          |

### Quality Thresholds

When using `--threshold`, the script applies these quality gates:

| Metric             | Threshold | Description                             |
| ------------------ | --------- | --------------------------------------- |
| Isolation          | ≤ 20%     | Max percentage of isolated node types   |
| Density            | ≥ 1.5     | Min relationships per node type         |
| High-Priority Gaps | ≤ 10      | Max high-priority missing relationships |
| Duplicates         | ≤ 5       | Max duplicate relationship candidates   |

Exceeding any threshold triggers exit code 1.

### Exit Codes

- **0** - Success (no issues or below thresholds)
- **1** - Quality issues detected (when `--threshold` used)
- **2** - Script execution error

### Output Formats

#### Text Format

```
═══════════════════════════════════════════════════════════════
  RELATIONSHIP AUDIT REPORT
═══════════════════════════════════════════════════════════════

Model: Documentation Robotics Model v1.0.0
Timestamp: 2/20/2026, 3:00:00 PM

COVERAGE BY LAYER
────────────────────────────────────────────────────────────

Layer: motivation (5 node types, 12 relationships)
  Isolation:    20.0% (1 isolated node types)
  Density:      2.40 relationships/node
  Utilization:  60.0% (3/5 predicates used)
...
```

#### JSON Format

```json
{
  "timestamp": "2026-02-20T15:00:00.000Z",
  "model": {
    "name": "Documentation Robotics Model",
    "version": "1.0.0"
  },
  "coverage": [...],
  "duplicates": [...],
  "gaps": [...],
  "balance": [...],
  "connectivity": {...}
}
```

#### Markdown Format

```markdown
# Relationship Audit Report

**Model:** Documentation Robotics Model v1.0.0
**Timestamp:** 2/20/2026, 3:00:00 PM

## Coverage by Layer

### Layer: motivation

- **Node Types:** 5
- **Relationships:** 12
- **Isolation:** 20.0%
- **Density:** 2.40 relationships/node
  ...
```

### CI/CD Integration

#### GitHub Actions

```yaml
name: Relationship Quality Audit

on: [pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Setup Node
        uses: actions/setup-node@v2
        with:
          node-version: "18"

      - name: Install dependencies
        run: cd cli && npm install

      - name: Run audit with quality gates
        run: cd cli && npm run audit -- --threshold --format json --output audit.json

      - name: Upload audit report
        if: always()
        uses: actions/upload-artifact@v2
        with:
          name: audit-report
          path: cli/audit.json
```

#### GitLab CI

```yaml
audit:
  stage: test
  script:
    - cd cli && npm install
    - npm run audit -- --threshold --format json --output audit.json
  artifacts:
    when: always
    paths:
      - cli/audit.json
    reports:
      junit: cli/audit.json
```

#### Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

cd cli
npm run audit -- --threshold --format text

if [ $? -ne 0 ]; then
  echo "❌ Audit failed: relationship quality below threshold"
  exit 1
fi
```

#### Cron Job

```bash
# Daily audit at 2 AM
0 2 * * * cd /path/to/project/cli && npm run audit -- --format markdown --output daily-audit.md
```

### Comparison with CLI Command

| Feature               | Standalone Script | CLI Command     |
| --------------------- | ----------------- | --------------- |
| Basic audit           | ✅                | ✅              |
| Layer-specific        | ✅                | ✅              |
| Output formats        | ✅                | ✅              |
| Quality thresholds    | ✅                | ❌              |
| Snapshot management   | ❌                | ✅              |
| Differential analysis | ❌                | ✅              |
| Best for              | CI/CD, automation | Interactive use |

**Use the standalone script when:**

- Running in CI/CD pipelines
- Enforcing quality gates
- Automating scheduled audits
- Integrating with external tools

**Use the CLI command when:**

- Working interactively
- Comparing snapshots over time
- Tracking improvement trends
- Exploring model quality manually

### Examples

#### Check quality before commit

```bash
npm run audit -- --threshold
```

#### Generate weekly report

```bash
npm run audit -- --format markdown --output weekly-audit-$(date +%Y-%m-%d).md
```

#### Audit specific layer with details

```bash
npm run audit -- --layer security --verbose --format json --output security.json
```

#### CI/CD quality gate

```bash
npm run audit -- --threshold --format json --output audit.json || exit 1
```

### Troubleshooting

**Error: "Layer not found"**

Ensure the layer name is valid. Use one of:

- `motivation`, `business`, `security`, `application`, `technology`
- `api`, `data-model`, `data-store`, `ux`, `navigation`, `apm`, `testing`

**Error: "Failed to load model"**

Ensure you're running from the CLI directory and the model exists in `documentation-robotics/model/`.

**Script hangs**

Check that all dependencies are installed: `npm install`

**Quality threshold always fails**

Review the threshold values in the script or adjust your model to improve quality metrics.

### Development

To modify the script:

1. Edit `scripts/relationship-audit.ts`
2. Update thresholds in `QUALITY_THRESHOLDS` constant
3. Add new features to `runAudit()` function
4. Update tests in `tests/unit/scripts/relationship-audit.test.ts`
5. Run tests: `npm run test:unit`

### Related Documentation

- **Audit Pipeline**: `docs/AUDIT_PIPELINE.md` - Full audit system documentation
- **CLI Reference**: `README.md` - CLI command documentation
- **Build System**: `CLAUDE.md` - Build and development guide
