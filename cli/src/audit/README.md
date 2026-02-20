# Relationship Audit System

This directory contains the relationship audit system implementation, providing deterministic analysis of relationship coverage, duplicates, gaps, and balance.

## Components

### Analysis Modules

- **CoverageAnalyzer** (`analysis/coverage-analyzer.ts`)
  - Computes relationship coverage metrics for all 12 layers
  - Identifies isolated node types (zero relationships)
  - Calculates predicate utilization (available vs. used)
  - Measures relationship density
  - Validates standard alignment (ArchiMate 3.2, NIST SP 800-53, etc.)

- **DuplicateDetector** (`analysis/duplicate-detector.ts`)
  - Detects semantic duplicate relationships
  - Groups relationships by source+destination endpoints
  - Identifies predicate category overlap
  - Assesses confidence levels (high/medium/low)
  - Uses transitivity and symmetry semantics

- **GapAnalyzer** (`analysis/gap-analyzer.ts`)
  - Identifies missing relationships using layer-specific templates
  - Supports ArchiMate 3.2 (layers 1, 2, 4, 5)
  - Supports NIST SP 800-53 (layer 3)
  - Supports OpenAPI 3.0 (layer 6)
  - Supports React/Component patterns (layers 9, 10)
  - Prioritizes gaps (high for zero-relationship layers)

- **BalanceAssessor** (`analysis/balance-assessor.ts`)
  - Assesses relationship density balance
  - Classifies node types into categories:
    - Structural (2-4 relationships): components, services
    - Behavioral (3-6 relationships): processes, operations
    - Enumeration (0-1 relationships): status, priority types
    - Reference (1-2 relationships): pointer types
  - Determines balance status (under/balanced/over)
  - Generates recommendations

### Graph Analysis

- **RelationshipGraph** (`graph/relationship-graph.ts`)
  - Builds directed graphs using GraphModel
  - Supports layer-specific and full-model graphs
  - Provides path finding, neighbor queries
  - Handles zero-relationship layers gracefully

- **ConnectivityAnalyzer** (`graph/connectivity.ts`)
  - Finds connected components
  - Calculates node degree distribution
  - Identifies isolated nodes
  - Detects transitive chains
  - Provides connectivity statistics

## Usage

### CLI Command

The audit system is integrated into the CLI via the `audit` command:

```bash
# Full audit of all layers
dr audit

# Audit specific layer
dr audit security

# Generate JSON report
dr audit --format json --output audit-report.json

# Generate Markdown report
dr audit --format markdown --output audit-report.md

# Verbose output with detailed analysis
dr audit --verbose

# Layer-specific audit with JSON output
dr audit api --output api-audit.json
```

**Output Formats:**
- `text` - Full formatted report (default)
- `json` - JSON output for automation and programmatic access
- `markdown` - Markdown report for documentation

**Analysis Types (all included in audit):**
- **Coverage** - Node type isolation and predicate utilization
- **Duplicates** - Semantic duplicate relationship detection
- **Gaps** - Missing relationship identification
- **Balance** - Relationship density assessment
- **Connectivity** - Graph connectivity and component analysis

### Programmatic Usage

```typescript
import {
  CoverageAnalyzer,
  DuplicateDetector,
  GapAnalyzer,
  BalanceAssessor,
  RelationshipGraph,
  ConnectivityAnalyzer,
} from "./audit/index.js";
import { RelationshipCatalog } from "./core/relationship-catalog.js";
import { formatAuditReport } from "./export/audit-formatters.js";
import { AuditReport } from "./audit/types.js";

// Initialize
const catalog = new RelationshipCatalog();
await catalog.load();

// Coverage Analysis
const coverageAnalyzer = new CoverageAnalyzer(catalog);
const coverageMetrics = await coverageAnalyzer.analyzeAll();

// Duplicate Detection
const duplicateDetector = new DuplicateDetector(catalog);
const duplicates = duplicateDetector.detectDuplicates();

// Gap Analysis
const gapAnalyzer = new GapAnalyzer();
const gaps = gapAnalyzer.analyzeAll();

// Balance Assessment
const balanceAssessor = new BalanceAssessor();
const assessments = balanceAssessor.assessAll();

// Graph Analysis
const graph = new RelationshipGraph();
await graph.build(); // or graph.build("security") for layer-specific

const connectivityAnalyzer = new ConnectivityAnalyzer(graph, catalog);
const components = connectivityAnalyzer.findConnectedComponents();
const isolated = connectivityAnalyzer.findIsolatedNodes();
const chains = await connectivityAnalyzer.findTransitiveChains();
const stats = connectivityAnalyzer.getConnectivityStats();

// Build comprehensive audit report
const report: AuditReport = {
  timestamp: new Date().toISOString(),
  model: { name: "My Model", version: "1.0.0" },
  coverage: coverageMetrics,
  duplicates,
  gaps,
  balance: assessments,
  connectivity: {
    components,
    degrees: connectivityAnalyzer.calculateDegreeDistribution(),
    transitiveChains: chains,
    stats: {
      totalNodes: stats.nodeCount,
      totalEdges: stats.edgeCount,
      connectedComponents: stats.componentCount,
      largestComponentSize: stats.largestComponentSize,
      isolatedNodes: stats.isolatedNodeCount,
      averageDegree: stats.averageDegree,
      transitiveChainCount: chains.length,
    },
  },
};

// Format report
const textReport = formatAuditReport(report, { format: "text", verbose: true });
const jsonReport = formatAuditReport(report, { format: "json" });
const mdReport = formatAuditReport(report, { format: "markdown" });
```

## Key Findings

### Zero-Relationship Layers

Three layers have zero intra-layer relationships:

- **Security** (66 node types): NIST SP 800-53 patterns not implemented
- **UX** (53 node types): React/Component patterns not implemented
- **Navigation** (26 node types): Router patterns not implemented

### Current State

| Layer          | Node Types | Relationships | Density  | Isolation % |
| -------------- | ---------- | ------------- | -------- | ----------- |
| motivation     | 19         | 58            | 3.05     | TBD         |
| api            | 29         | 52            | 1.79     | TBD         |
| testing        | 29         | 54            | 1.86     | TBD         |
| apm            | 35         | 43            | 1.23     | TBD         |
| data-store     | 26         | 18            | 0.69     | TBD         |
| business       | 15         | 15            | 1.00     | TBD         |
| data-model     | 0          | 7             | N/A      | N/A         |
| application    | 14         | 3             | 0.21     | TBD         |
| technology     | 22         | 2             | 0.09     | TBD         |
| **security**   | **66**     | **0**         | **0.00** | **100%**    |
| **ux**         | **53**     | **0**         | **0.00** | **100%**    |
| **navigation** | **26**     | **0**         | **0.00** | **100%**    |

## Testing

All analysis components have comprehensive unit and integration tests:

### Unit Tests

Located in `tests/unit/audit/`:

```bash
npm run test:unit -- tests/unit/audit/
```

Tests cover:
- Coverage metrics calculation
- Duplicate detection logic
- Gap analysis templates
- Balance assessment classification
- Graph construction and traversal
- Connectivity analysis

### Integration Tests

Located in `tests/integration/audit.test.ts`:

```bash
npm run test:integration -- tests/integration/audit.test.ts
```

Tests cover:
- Full audit command execution
- JSON report generation and validation
- Markdown report generation and structure
- Format auto-detection from file extensions
- Layer-specific audits
- Verbose mode output
- Error handling for invalid layers
- Output directory creation

## Report Generation

The audit system generates comprehensive reports in multiple formats:

### Text Format (Default)

Terminal-friendly output with ANSI colors:
- Executive summary with key metrics
- Coverage analysis summary and detailed breakdown
- Duplicate detection with confidence levels
- Gap analysis with priority categorization
- Balance assessment showing over/under-connected types
- Connectivity analysis with component detection

### JSON Format

Machine-readable output for automation:
- Complete audit data structure
- All metrics preserved with full precision
- Suitable for CI/CD pipelines and programmatic analysis
- Easy integration with other tools

### Markdown Format

Documentation-friendly output:
- Clean markdown tables and sections
- Table of contents with anchor links
- Executive summary
- Detailed analysis by category
- Ready for inclusion in documentation

### Report Structure

All audit reports include:

```typescript
interface AuditReport {
  timestamp: string;
  model: { name: string; version: string };
  coverage: CoverageMetrics[];      // Layer-by-layer coverage analysis
  duplicates: DuplicateCandidate[]; // Semantic duplicate detection
  gaps: GapCandidate[];             // Missing relationship gaps
  balance: BalanceAssessment[];     // Relationship density balance
  connectivity: {
    components: ConnectedComponent[];
    degrees: NodeDegree[];
    transitiveChains: TransitiveChain[];
    stats: ConnectivityStats;
  };
}
```

## Type Definitions

All audit types are defined in `types.ts`:

- `AuditReport` - Comprehensive audit report structure
- `CoverageMetrics` - Layer coverage metrics
- `DuplicateCandidate` - Duplicate relationship detection
- `GapCandidate` - Missing relationship gaps
- `BalanceAssessment` - Relationship density balance
- `ConnectedComponent` - Graph connected components
- `NodeDegree` - Node degree distribution
- `TransitiveChain` - Transitive relationship chains
- `ConnectivityStats` - Connectivity statistics summary

## Dependencies

This module leverages existing infrastructure:

- `RelationshipCatalog` - Predicate definitions and semantics
- `RELATIONSHIPS_BY_SOURCE` - Generated relationship index (O(1) lookups)
- `LAYERS` - Generated layer metadata
- `GraphModel` - Graph storage and traversal

## Roadmap

### ✅ Completed (Phase 2)

- ✅ Report generation (JSON, Markdown, Text)
- ✅ CLI command integration
- ✅ Format auto-detection
- ✅ Layer-specific audits
- ✅ Verbose mode for detailed analysis
- ✅ Integration tests

### 🔜 Future Enhancements

- Pipeline orchestration for CI/CD integration
- AI-assisted evaluation (Claude Code CLI integration)
- Before/after comparison reports
- Trend analysis over time
- Custom audit rules and thresholds
- Interactive audit reports (HTML format)
- Automated remediation suggestions
