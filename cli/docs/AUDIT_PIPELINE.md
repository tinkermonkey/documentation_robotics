# Audit Pipeline Documentation

## Overview

The audit pipeline analyzes relationship quality across the 12-layer architecture model, identifying coverage gaps, semantic duplicates, balance issues, and connectivity patterns.

## Architecture

### Analysis Modules

Core analysis modules:

- **Coverage Analyzer** - Measures relationship coverage, isolation, and predicate utilization
- **Gap Analyzer** - Identifies missing relationships based on standard patterns
- **Duplicate Detector** - Finds semantically overlapping relationships
- **Balance Assessor** - Evaluates relationship density balance
- **Connectivity Analyzer** - Analyzes graph structure and connected components

Temporal analysis modules:

- **Snapshot Storage** - Persists audit reports for historical comparison
- **Differential Analyzer** - Compares before/after states to measure improvements
- **Diff Formatters** - Visualizes changes in text, JSON, and markdown

## Usage

The audit pipeline can be invoked in two ways:

1. **CLI Command** - Full-featured command with snapshot management
2. **Standalone Script** - Lightweight script for automation and CI/CD

### CLI Command

Run a full audit across all layers:

```bash
dr audit
```

Audit a specific layer:

```bash
dr audit security
```

### Standalone Script

The standalone script (`scripts/relationship-audit.ts`) provides a lightweight alternative for automation, CI/CD pipelines, and pre-commit hooks.

Run audit with npm:

```bash
npm run audit:relationships                        # Text output to stdout
npm run audit:relationships -- --format json       # JSON format
npm run audit:relationships -- --output report.md  # Save to file
npm run audit:relationships -- --layer api         # Audit specific layer
npm run audit:relationships -- --verbose           # Detailed logging
npm run audit:relationships -- --threshold         # Exit 1 if quality issues detected
```

Run directly with tsx:

```bash
tsx scripts/relationship-audit.ts --help
tsx scripts/relationship-audit.ts --format json --output audit.json
```

**Quality Thresholds**

The `--threshold` flag enables quality gates for CI/CD:

- **Isolation**: Max 20% isolated node types
- **Density**: Min 1.5 relationships per node type
- **High-Priority Gaps**: Max 10 gaps
- **Duplicates**: Max 5 duplicate candidates

Exit codes:
- `0` - Success (no issues or below thresholds)
- `1` - Quality issues detected (with `--threshold`)
- `2` - Script execution error

**Example CI/CD Integration**

```yaml
# .github/workflows/audit.yml
name: Relationship Quality Audit

on: [pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Install dependencies
        run: cd cli && npm install

      - name: Run audit with quality gates
        run: cd cli && npm run audit:relationships -- --threshold --format json --output audit.json

      - name: Upload audit report
        if: always()
        uses: actions/upload-artifact@v2
        with:
          name: audit-report
          path: cli/audit.json
```

### Saving Snapshots

Save audit results as a snapshot for later comparison:

```bash
dr audit --save-snapshot
```

Snapshots are stored in `.dr/audit-snapshots/` with timestamp-based IDs.

### Viewing Snapshots

List all available snapshots:

```bash
dr audit:snapshots list
```

Example output:

```
Audit Snapshots:
────────────────────────────────────────────────────────────────────────────────

20260220-150000
  Timestamp: 2/20/2026, 3:00:00 PM
  Model:     Documentation Robotics Model v1.0.0
  Layers:    motivation, business, security, application, technology, api, data-model, data-store, ux, navigation, apm, testing

20260220-100000
  Timestamp: 2/20/2026, 10:00:00 AM
  Model:     Documentation Robotics Model v1.0.0
  Layers:    motivation, business, security, application, technology, api, data-model, data-store, ux, navigation, apm, testing

────────────────────────────────────────────────────────────────────────────────
Total: 2 snapshots
```

### Comparing Snapshots

Compare the two most recent snapshots automatically:

```bash
dr audit:diff
```

Compare specific snapshots by ID:

```bash
dr audit:diff --before 20260220-100000 --after 20260220-150000
```

### Output Formats

All audit commands support multiple output formats:

```bash
# Text output (default, with colors)
dr audit --format text

# JSON output (for automation)
dr audit --format json --output audit-report.json

# Markdown output (for documentation)
dr audit --format markdown --output audit-report.md
```

### Verbose Mode

Show detailed analysis with verbose flag:

```bash
dr audit --verbose
dr audit:diff --verbose
```

## Differential Analysis Workflow

### Typical Workflow

1. **Establish Baseline**

```bash
# Run initial audit and save snapshot
dr audit --save-snapshot
```

2. **Make Model Changes**

```bash
# Add relationships to address gaps
dr add motivation relationship goal-requirement \
  --source motivation.goal.customer-satisfaction \
  --destination motivation.requirement.fast-response \
  --predicate realizes
```

3. **Run Follow-up Audit**

```bash
# Audit again and save new snapshot
dr audit --save-snapshot
```

4. **Compare Results**

```bash
# View differential analysis
dr audit:diff --verbose
```

### Example Differential Report

```
═══════════════════════════════════════════════════════════════
  AUDIT DIFFERENTIAL ANALYSIS
═══════════════════════════════════════════════════════════════

Comparison Period:
  Before: 2/20/2026, 10:00:00 AM
  After:  2/20/2026, 3:00:00 PM

EXECUTIVE SUMMARY
────────────────────────────────────────────────────────────

Overall Changes:
  + 15 relationships added
  ✓ 8 gaps resolved
  ✓ 3 duplicates eliminated
  ! 12 gaps remaining

Balance Improvements:
  ✓ Goal achieved balanced density (3 relationships)
  ✓ BusinessService achieved balanced density (4 relationships)

COVERAGE CHANGES BY LAYER
────────────────────────────────────────────────────────────

Layer: motivation
  Isolation: 20.0% → 10.0% ↓ 10.0%
  Density:   1.50 → 2.50 ↑ 1.00

Layer: business
  Isolation: 15.0% → 5.0% ↓ 10.0%
  Density:   2.00 → 3.00 ↑ 1.00
```

## Metrics Explained

### Coverage Metrics

- **Isolation Percentage** - Percentage of node types with zero relationships (lower is better)
- **Density** - Average relationships per node type (higher is better)
- **Utilization Percentage** - Percentage of available predicates being used (higher is better)

### Gap Analysis

- **Gaps Resolved** - Number of missing relationships that were added
- **New Gaps** - New missing relationships identified (may appear as model evolves)
- **Remaining Gaps** - Total gaps still present
- **Resolution Rate** - Percentage of gaps resolved since last snapshot

### Duplicate Analysis

- **Duplicates Resolved** - Semantic overlaps eliminated through consolidation
- **New Duplicates** - New overlaps introduced (should be minimized)
- **Elimination Rate** - Percentage of duplicates removed since last snapshot

### Balance Assessment

- **Under** - Node type has fewer relationships than target range
- **Balanced** - Node type is within target density range
- **Over** - Node type has more relationships than recommended

Target ranges vary by node category:

- **Structural** (entities, components): 2-4 relationships
- **Behavioral** (processes, services): 3-5 relationships
- **Enumeration** (states, values): 1-2 relationships
- **Reference** (metadata, tags): 0-1 relationships

### Connectivity Metrics

- **Connected Components** - Number of disconnected subgraphs (fewer is better)
- **Isolated Nodes** - Node types with no connections (should be minimized)
- **Average Degree** - Mean number of connections per node (higher indicates better connectivity)

## Snapshot Management

### Storage Location

Snapshots are stored in `.dr/audit-snapshots/` with two files per snapshot:

- `YYYYMMDD-HHmmss.json` - Full audit report data
- `YYYYMMDD-HHmmss.meta.json` - Snapshot metadata

### Deleting Snapshots

Delete a specific snapshot:

```bash
dr audit:snapshots delete --id 20260220-100000
```

Clear all snapshots:

```bash
dr audit:snapshots clear
```

### Retention Policy

By default, snapshots are retained indefinitely. To enable automatic cleanup with a retention limit, configure the storage programmatically:

```typescript
import { SnapshotStorage } from "./audit/snapshot-storage.js";

const storage = new SnapshotStorage({
  maxSnapshots: 10, // Keep only 10 most recent snapshots
});
```

## Integration with CI/CD

### Automated Quality Gates

Use the audit pipeline in CI/CD to enforce relationship quality:

```yaml
# .github/workflows/audit.yml
name: Relationship Quality Audit

on: [pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Run Audit
        run: |
          cd cli
          npm install
          npm run build
          node dist/cli.js audit --format json --output audit.json

      - name: Check Quality Thresholds
        run: |
          # Extract metrics from audit.json
          # Fail if isolation > 15% or gaps > 20
```

### Trend Analysis

Track audit metrics over time:

```bash
# Run daily audits and save snapshots
0 0 * * * cd /path/to/project && dr audit --save-snapshot

# Generate weekly differential reports
0 0 * * 0 cd /path/to/project && dr audit:diff --format markdown --output weekly-audit.md
```

## Advanced Usage

### Layer-Specific Workflow

Audit and track changes for a specific layer:

```bash
# Baseline
dr audit security --save-snapshot

# Make changes to security layer
# ...

# Compare
dr audit security --save-snapshot
dr audit:diff --verbose
```

Note: Differential analysis compares full model snapshots even when layer-specific audits are run.

### Export for Reporting

Generate comprehensive markdown reports:

```bash
# Full audit report
dr audit --format markdown --verbose --output audit-full.md

# Differential analysis
dr audit:diff --format markdown --verbose --output audit-diff.md
```

### JSON Output for Tooling

Use JSON format for integration with external tools:

```bash
# Export audit data
dr audit --format json --output audit.json

# Export diff data
dr audit:diff --format json --output diff.json
```

## Best Practices

1. **Establish Baselines Early** - Run initial audit and save snapshot before making changes
2. **Audit Regularly** - Run audits after significant model changes to track progress
3. **Address High-Priority Gaps** - Focus on gaps marked as "high" priority from standard patterns
4. **Monitor Balance** - Keep node types within recommended density ranges
5. **Review Duplicates** - Eliminate semantic overlaps to improve clarity
6. **Track Trends** - Use differential analysis to measure improvement over time
7. **Document Decisions** - Use markdown reports to document architectural decisions

## Troubleshooting

### No Snapshots Available

If `dr audit:diff` reports no snapshots:

```bash
# Create initial snapshot
dr audit --save-snapshot

# Make changes and create second snapshot
dr audit --save-snapshot

# Now diff will work
dr audit:diff
```

### Snapshot Not Found

If a specific snapshot ID is not found:

```bash
# List all available snapshots
dr audit:snapshots list

# Use correct snapshot ID
dr audit:diff --before <id> --after <id>
```

### Large Snapshot Storage

If `.dr/audit-snapshots/` grows too large:

```bash
# Clear old snapshots
dr audit:snapshots clear

# Or delete specific snapshots
dr audit:snapshots delete --id <id>
```

## Implementation Details

### Snapshot Storage

- **Format**: JSON with full audit report data
- **Naming**: Timestamp-based IDs (YYYYMMDD-HHmmss)
- **Metadata**: Separate metadata files for quick listing
- **Sorting**: Newest first by default

### Differential Analysis

The analyzer compares snapshots using:

1. **Coverage Deltas** - Numeric differences in isolation, density, utilization
2. **Gap Signatures** - Identifies resolved/new/persistent gaps by source+destination+predicate
3. **Duplicate Signatures** - Tracks duplicates by relationship ID pairs
4. **Balance Distance** - Measures improvement toward target ranges
5. **Connectivity Changes** - Graph-level structural changes

### Performance

- Snapshot save: O(1) - simple JSON write
- Snapshot load: O(1) - single file read
- Differential analysis: O(n) where n = number of gaps + duplicates + balance assessments
- Typical audit time: 1-5 seconds for full 12-layer model
- Snapshot size: ~50-200KB per snapshot depending on model size

## Future Enhancements

Potential Phase 4 features:

- **Trend Visualization** - Chart coverage/gap metrics over time
- **Automated Recommendations** - AI-powered gap resolution suggestions
- **Regression Detection** - Alert when metrics worsen between snapshots
- **Benchmark Comparison** - Compare against industry standard models
- **Custom Rules** - User-defined quality gates and thresholds
- **Integration Webhooks** - Notify external systems of audit results
