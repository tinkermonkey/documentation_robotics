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

// Initialize
const catalog = new RelationshipCatalog();
await catalog.load();

// Coverage Analysis
const coverageAnalyzer = new CoverageAnalyzer(catalog);
const coverageMetrics = await coverageAnalyzer.analyzeAll();

// Duplicate Detection
const duplicateDetector = new DuplicateDetector(catalog);
const duplicates = await duplicateDetector.detectDuplicates();

// Gap Analysis
const gapAnalyzer = new GapAnalyzer(catalog);
const gaps = await gapAnalyzer.analyzeAll();

// Balance Assessment
const balanceAssessor = new BalanceAssessor();
const assessments = await balanceAssessor.assessAll();

// Graph Analysis
const graph = new RelationshipGraph();
await graph.build(); // or graph.build("security") for layer-specific

const connectivityAnalyzer = new ConnectivityAnalyzer(graph, catalog);
const components = connectivityAnalyzer.findConnectedComponents();
const isolated = connectivityAnalyzer.findIsolatedNodes();
const chains = await connectivityAnalyzer.findTransitiveChains();
```

## Key Findings

### Zero-Relationship Layers

Three layers have zero intra-layer relationships:
- **Security** (66 node types): NIST SP 800-53 patterns not implemented
- **UX** (53 node types): React/Component patterns not implemented
- **Navigation** (26 node types): Router patterns not implemented

### Current State

| Layer | Node Types | Relationships | Density | Isolation % |
|-------|------------|---------------|---------|-------------|
| motivation | 19 | 58 | 3.05 | TBD |
| api | 29 | 52 | 1.79 | TBD |
| testing | 29 | 54 | 1.86 | TBD |
| apm | 35 | 43 | 1.23 | TBD |
| data-store | 26 | 18 | 0.69 | TBD |
| business | 15 | 15 | 1.00 | TBD |
| data-model | 0 | 7 | N/A | N/A |
| application | 14 | 3 | 0.21 | TBD |
| technology | 22 | 2 | 0.09 | TBD |
| **security** | **66** | **0** | **0.00** | **100%** |
| **ux** | **53** | **0** | **0.00** | **100%** |
| **navigation** | **26** | **0** | **0.00** | **100%** |

## Testing

All analysis components have comprehensive unit tests in `tests/unit/audit/`:

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

## Type Definitions

All audit types are defined in `types.ts`:
- `CoverageMetrics`
- `DuplicateCandidate`
- `GapCandidate`
- `BalanceAssessment`
- `ConnectedComponent`
- `NodeDegree`
- `TransitiveChain`

## Dependencies

This module leverages existing infrastructure:
- `RelationshipCatalog` - Predicate definitions and semantics
- `RELATIONSHIPS_BY_SOURCE` - Generated relationship index (O(1) lookups)
- `LAYERS` - Generated layer metadata
- `GraphModel` - Graph storage and traversal

## Next Steps (Phase 2+)

Phase 1 provides deterministic analysis. Future phases will add:
- Report generation (JSON, Markdown)
- Pipeline orchestration
- AI-assisted evaluation (Claude Code CLI integration)
- Before/after comparison reports
