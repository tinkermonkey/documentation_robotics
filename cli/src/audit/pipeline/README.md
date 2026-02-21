# Audit Pipeline

The Audit Pipeline orchestrates a comprehensive before/after AI evaluation workflow for relationship audits.

## Overview

The pipeline automates the complete audit lifecycle:

1. **Before Audit** - Initial analysis of relationship coverage, gaps, duplicates, and balance
2. **AI Evaluation** (optional) - Claude-assisted evaluation of low-coverage elements
3. **After Audit** - Re-analysis to measure improvements
4. **Differential Summary** - Side-by-side comparison with metrics, resolved gaps, and added relationships

## Architecture

### Components

- **`PipelineOrchestrator`** - Main orchestration class that sequences all pipeline steps
- **`ReportGenerator`** - Generates reports in text, JSON, or Markdown format with phase support
- **`AuditOrchestrator`** - Executes individual audit analyses
- **`AIEvaluator`** - Claude-based relationship gap resolution
- **`DifferentialAnalyzer`** - Compares before/after snapshots
- **`SnapshotStorage`** - Persists audit results for comparison

### Directory Structure

```
audit-results/
└── {timestamp}/
    ├── before/
    │   ├── audit-before.json
    │   ├── audit-before.md
    │   └── audit-before.txt
    ├── after/
    │   ├── audit-after.json
    │   ├── audit-after.md
    │   └── audit-after.txt
    └── summary/
        ├── summary.json
        ├── summary.md
        └── summary.txt
```

## Usage

### CLI Command

```bash
# Basic pipeline (no AI)
dr audit --pipeline

# Full AI-assisted pipeline
dr audit --pipeline --enable-ai --claude-api-key $ANTHROPIC_API_KEY

# Layer-specific pipeline
dr audit security --pipeline --enable-ai --claude-api-key $ANTHROPIC_API_KEY

# Custom output directory
dr audit --pipeline --output-dir my-audit-results
```

### Programmatic API

```typescript
import { PipelineOrchestrator } from "./audit/pipeline/index.js";

const pipeline = new PipelineOrchestrator("/path/to/model", "/path/to/spec");

const result = await pipeline.executePipeline({
  outputDir: "audit-results",
  layer: "security", // Optional: specific layer
  format: "markdown",
  enableAI: true,
  claudeApiKey: process.env.ANTHROPIC_API_KEY,
  verbose: true,
});

console.log(`Relationships Added: ${result.summary.relationshipsAdded}`);
console.log(`Gaps Resolved: ${result.summary.gapsResolved}`);
console.log(`Coverage Improvement: ${result.summary.coverageImprovement}`);
```

## Output Formats

### JSON
Machine-parseable format for automation and CI/CD integration.

### Markdown
Documentation-ready reports with formatted tables and sections.

### Text
Human-readable console output with ANSI colors (when supported).

## Pipeline Results

The `PipelineResult` object contains:

```typescript
{
  beforeResult: AuditResult,        // Initial audit
  afterResult?: AuditResult,        // Post-AI audit (if AI enabled)
  reports: {
    before: string,                 // Path to before report
    after?: string,                 // Path to after report
    summary?: string                // Path to differential summary
  },
  summary?: {
    relationshipsAdded: number,     // New relationships created
    gapsResolved: number,           // Gaps filled by AI
    coverageImprovement: number     // Density improvement
  }
}
```

## Differential Summary

The summary report includes:

1. **Side-by-Side Metrics Table**
   - Isolation rate (before vs after)
   - Density (relationships per node type)
   - Predicate utilization

2. **Resolved Gaps List**
   - Node types that gained relationships
   - Predicates used

3. **Added Relationships**
   - Complete list of new relationships
   - Source → target mappings

4. **Visual Coverage Heatmap**
   - ASCII bar chart visualization
   - Before/after comparison

## Integration Points

### With Existing Components

- **`AuditOrchestrator`** - Executes analysis pipeline
- **`AIEvaluator`** - Provides AI-assisted gap resolution
- **`SnapshotStorage`** - Persists snapshots for differential analysis
- **`DifferentialAnalyzer`** - Computes before/after deltas

### With CLI Commands

- **`dr audit --pipeline`** - Primary entry point
- **`dr audit:diff`** - Manual snapshot comparison (alternative workflow)
- **`dr audit:snapshots`** - List available snapshots

## Error Handling

The pipeline handles errors gracefully:

- **No AI Key** - Skips AI evaluation, runs before audit only
- **Model Load Failures** - Reports detailed error messages
- **Snapshot Failures** - Attempts recovery, warns user
- **Report Generation Failures** - Fails fast with clear diagnostics

## Performance Considerations

- **Snapshot Storage** - Uses efficient JSON serialization
- **AI Evaluation** - Configurable concurrency limit (default: 3)
- **Large Models** - Supports layer-specific audits to reduce scope
- **Incremental Updates** - Only re-analyzes changed portions

## Future Enhancements

- [ ] Support for custom AI prompts
- [ ] Parallel layer analysis
- [ ] Real-time progress indicators
- [ ] Email/Slack notifications on completion
- [ ] Historical trend analysis across multiple runs
- [ ] Integration with CI/CD quality gates
