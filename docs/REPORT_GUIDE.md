# Report Generation Guide

## Overview

The Report system provides comprehensive architecture insights through unified statistics, relationship classification, and data model analysis. Generate reports in multiple formats (text, JSON, markdown) tailored to your analysis needs.

## Quick Start

### Generate a Comprehensive Report

```bash
dr report
```

Prints a full formatted report to the console showing:
- Quality metrics
- Statistics overview
- Relationships by category
- Data model analysis

### Save Report to File

```bash
dr report --output report.md
```

Format is auto-detected from the file extension:
- `.txt` → Text format
- `.md` → Markdown format
- `.json` → JSON format

### Specify Report Type

```bash
dr report --type statistics          # Statistics and quality metrics
dr report --type relationships       # Relationship analysis
dr report --type data-model          # Data model layer analysis
dr report --type quality             # Quality metrics and recommendations
dr report --type comprehensive       # Full report (default)
```

## Report Types

### Comprehensive Report (Default)

Complete analysis including all sections.

```bash
dr report --type comprehensive --format markdown --output full-report.md
```

Includes:
- Quality metrics (coverage, compliance, structural quality)
- Statistics (elements, relationships, layers)
- Relationship analysis (by category, by predicate)
- Data model insights (entities, attributes, coverage)
- Circular dependencies
- Data quality issues

### Statistics Report

Focus on metrics and quality assessment.

```bash
dr report --type statistics --output stats.json
```

Includes:
- Element statistics by layer
- Relationship statistics
- Quality metrics
- Completeness analysis
- Validation information

### Relationships Report

Detailed relationship analysis and classification.

```bash
dr report --type relationships
```

Includes:
- Relationship breakdown by category and predicate
- Relationship patterns
- Cross-layer vs intra-layer counts
- Circular dependency detection

### Data Model Report

Layer 7 (Data Model) specific analysis.

```bash
dr report --type data-model --format text
```

Includes:
- Entity count and attributes
- Referenced vs orphaned entities
- Complexity metrics
- Cardinality analysis
- Data quality issues
- Entity clusters

### Quality Report

Quality assessment and recommendations.

```bash
dr report --type quality --format json
```

Includes:
- Coverage metrics (elements, relationships, documentation, layers)
- Compliance metrics (ArchiMate, Spec, semantic consistency)
- Structural quality (orphaned elements, circular dependencies)
- Actionable recommendations

## Output Formats

### Text Format (Default)

Human-readable formatted output with colors and ASCII visualizations.

```bash
dr report --format text
```

Features:
- Color-coded output (✓ for valid, ✗ for issues)
- Progress bars for metrics
- Structured sections
- Easy to read in terminal

### JSON Format

Complete structured data for automation and integration.

```bash
dr report --format json --output report.json
```

Includes:
- Full report data structure
- All metrics and analysis
- Timestamps
- Perfect for tooling and dashboards

### Markdown Format

Documentation-ready format with tables and formatting.

```bash
dr report --format markdown --output ARCHITECTURE.md
```

Features:
- Proper markdown structure
- Tables for metrics
- Links and sections
- Ready to commit to repository
- Renders well in GitHub/GitLab

### Compact Format

Single-line summary for quick overview.

```bash
dr report --format compact
```

Output example:
```
Test Project v1.0.0: 100 elements, 50 relationships, 0 circular deps, 80% coverage
```

## Options

### Output File (`--output`)

Specify where to save the report. Format is auto-detected from extension.

```bash
dr report --output report.md        # Markdown
dr report --output report.json      # JSON
dr report --output ./reports/2024-01-report.txt  # Text
```

Creates parent directories if they don't exist.

### Format (`--format`)

Explicitly specify output format (overrides file extension).

```bash
dr report --format json              # JSON to stdout
dr report --format markdown --output report.txt  # Force markdown format
```

### Type (`--type`)

Choose which type of report to generate.

```bash
dr report --type statistics
dr report --type relationships
dr report --type data-model
dr report --type quality
dr report --type comprehensive
```

### Verbose (`--verbose`)

Include detailed information in the report.

```bash
dr report --verbose                  # Detailed output
dr report --type statistics --verbose --format json
```

### Include Data Model (`--include-data-model`)

Control whether to include data model analysis (default: true).

```bash
dr report --include-data-model       # Include (default)
dr report --format text --include-data-model false  # Exclude
```

### Include Quality (`--include-quality`)

Control whether to include quality metrics (default: true).

```bash
dr report --include-quality          # Include (default)
dr report --type statistics --include-quality false  # Exclude
```

### Model Path (`--model`)

Specify custom model directory (default: current directory).

```bash
dr report --model /path/to/model --output report.md
dr report --model ../other-project/documentation-robotics/model
```

## Real-World Examples

### Generate Quality Assessment for Management

```bash
dr report --type quality --format markdown --output QUALITY_REPORT.md
```

Shows compliance scores, coverage metrics, and actionable recommendations.

### Export Model Metrics for Dashboard

```bash
dr report --type statistics --format json --output metrics.json
```

Use JSON output for automation and dashboard integration.

### Document Architecture for Team

```bash
dr report --type comprehensive --format markdown --output ARCHITECTURE.md
```

Commit to repository for team documentation.

### Analyze Relationships

```bash
dr report --type relationships --output relationships.json
```

Detailed predicate and category breakdown for relationship review.

### Data Model Review

```bash
dr report --type data-model --format markdown --output DATA_MODEL.md
```

Entity analysis with coverage metrics for data model team.

### Quick Status Check

```bash
dr report --format compact
```

Get one-line overview of model health.

### Comprehensive Review with All Details

```bash
dr report --type comprehensive --format markdown --verbose --output full-review.md
```

Complete analysis with all available information.

## Quality Metrics Explained

### Coverage Metrics

**Element Coverage** - Percentage of elements defined (0-100%)
- 0% = No elements
- 100% = Model fully populated

**Relationship Coverage** - Relationship density (0-100%)
- Ratio of relationships to elements
- Higher = Well-connected model

**Documentation Coverage** - Elements with descriptions (0-100%)
- Higher = Better documented
- Aim for 80%+

**Layer Coverage** - Populated layers / Total layers (0-100%)
- 100% = All 12 layers used
- Lower = Incomplete model

### Compliance Metrics

**ArchiMate Compliance** - Relationships aligned with ArchiMate 3.2 (0-100%)
- Higher = Better alignment with standard
- Useful for ArchiMate exports

**Spec Compliance** - Relationships matching spec schemas (0-100%)
- Higher = Better alignment with specification
- Should be 95%+

**Semantic Consistency** - Average compliance score (0-100%)
- Higher = Consistent relationship usage
- Overall quality indicator

### Structural Quality

**Orphaned Elements** - Elements with no relationships
- Should be 0 or minimal
- Review and remove or connect

**Circular Dependencies** - Cyclic relationships detected
- Should be 0 for clean architecture
- May indicate design issues

## Relationship Categories

Reports show relationships organized by 13 semantic categories:

- **Motivation** - Goals, requirements, constraints
- **Business** - Business processes and services
- **Security** - Authentication, authorization, threats
- **Application** - Application services, components
- **Technology** - Infrastructure, platforms, tools
- **API** - REST APIs, endpoints, operations
- **Data** - Schema relationships, mappings
- **Data Store** - Database relationships
- **UX** - User interface components
- **Navigation** - Routing, navigation structures
- **APM** - Observability, monitoring
- **Testing** - Tests, test suites, fixtures

Each category shows:
- Total count
- Percentage of all relationships
- Top predicates in category

## Data Model Analysis Details

For Layer 7 (Data Model) reports:

**Entity Metrics**
- Total entities/schemas
- Referenced entities (from other layers)
- Orphaned entities (unreferenced)

**Complexity**
- Average attributes per entity
- Maximum attributes on any entity
- Average relationships per entity

**Coverage**
- Entity coverage (referenced %)
- Attribute coverage (documented %)
- Constraint coverage (constrained %)

**Quality Issues**
- Incomplete entities (no attributes)
- Orphaned entities
- Missing constraints
- Inconsistent types

## Troubleshooting

### Report is Empty or Shows 0 Elements

Check that your model is initialized:
```bash
dr list motivation  # Should show elements
```

### Output File Has Wrong Format

File extension determines format. Use explicit `--format`:
```bash
dr report --format json --output report.txt  # Forces JSON despite .txt
```

### Data Model Section Shows No Entities

Layer 7 may be empty. Check:
```bash
dr list data-model
```

### Circular Dependencies Detected

Review and refactor relationships:
```bash
dr report --type relationships --format json > rels.json
```

Then examine the relationships in `rels.json`.

## Advanced Usage

### Generate Reports in All Formats

```bash
dr report --type comprehensive --output report.txt
dr report --type comprehensive --output report.md
dr report --type comprehensive --output report.json
```

### Automated Report Generation

Create a script for periodic reporting:

```bash
#!/bin/bash
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
dr report --type comprehensive \
          --format markdown \
          --output "reports/report-${TIMESTAMP}.md"
```

### Integration with CI/CD

```yaml
# Example GitHub Actions
- name: Generate Architecture Report
  run: dr report --type comprehensive --format markdown --output ARCHITECTURE.md

- name: Generate Metrics
  run: dr report --type statistics --format json --output metrics.json
```

### Quality Gate Checking

Extract metrics for quality gates:

```bash
dr report --type quality --format json | jq '.quality.archimateCompliance'
```

Check compliance scores and fail CI if below threshold.

## Best Practices

1. **Regular Reports** - Generate reports periodically to track evolution
2. **Version Control** - Commit markdown reports to track changes over time
3. **Format Selection** - Use markdown for documentation, JSON for automation
4. **Type Combinations** - Use specific types for focused analysis
5. **Verbose Mode** - Use `--verbose` when investigating issues
6. **Archival** - Keep timestamped reports for historical analysis

## See Also

- [Stats Command](STATS_GUIDE.md) - Basic statistics
- [Validate Command](VALIDATE.md) - Model validation
- [Relationship Catalog](RELATIONSHIP_CATALOG.md) - Predicate reference
