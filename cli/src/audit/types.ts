/**
 * Type definitions for relationship audit system
 */

/**
 * Coverage metrics for a layer
 */
export interface CoverageMetrics {
  layer: string;
  nodeTypeCount: number;
  relationshipCount: number;

  // Node isolation
  isolatedNodeTypes: string[]; // Zero relationships
  isolationPercentage: number;

  // Predicate utilization
  availablePredicates: string[]; // Predicates applicable to this layer
  usedPredicates: string[]; // Actually used
  utilizationPercentage: number;

  // Density
  relationshipsPerNodeType: number;

  // Standard alignment (for ArchiMate layers)
  standardAlignment?: {
    standard: string;
    expectedRelationships: number;
    missingFromStandard: string[];
  };
}

/**
 * Semantic duplicate candidate
 */
export interface DuplicateCandidate {
  relationships: [string, string]; // IDs of duplicate pair
  predicates: [string, string]; // Predicate names
  sourceNodeType: string;
  destinationNodeType: string;
  reason: string; // Explanation of semantic overlap
  confidence: "high" | "medium" | "low";
}

/**
 * Missing relationship gap candidate
 */
export interface GapCandidate {
  sourceNodeType: string;
  destinationNodeType: string;
  suggestedPredicate: string;
  reason: string;
  priority: "high" | "medium" | "low";
  standardReference?: string; // e.g., "ArchiMate 3.2 §5.2"
}

/**
 * Balance assessment for node type relationship density
 */
export interface BalanceAssessment {
  nodeType: string;
  layer: string;
  category: "structural" | "behavioral" | "enumeration" | "reference";
  currentCount: number;
  targetRange: [number, number];
  status: "under" | "balanced" | "over";
  recommendation?: string;
}

/**
 * Connected component in relationship graph
 */
export interface ConnectedComponent {
  nodes: string[];
  size: number;
}

/**
 * Node degree information
 */
export interface NodeDegree {
  nodeType: string;
  inDegree: number;
  outDegree: number;
  totalDegree: number;
}

/**
 * Transitive relationship chain
 */
export interface TransitiveChain {
  predicate: string;
  chain: string[]; // Node types in chain
  length: number;
}

/**
 * Connectivity statistics summary
 */
export interface ConnectivityStats {
  totalNodes: number;
  totalEdges: number;
  connectedComponents: number;
  largestComponentSize: number;
  isolatedNodes: number;
  averageDegree: number;
  transitiveChainCount: number;
}

/**
 * Comprehensive audit report combining all analysis results
 */
export interface AuditReport {
  timestamp: string;
  model: {
    name: string;
    version: string;
  };
  coverage: CoverageMetrics[];
  duplicates: DuplicateCandidate[];
  gaps: GapCandidate[];
  balance: BalanceAssessment[];
  connectivity: {
    components: ConnectedComponent[];
    degrees: NodeDegree[];
    transitiveChains: TransitiveChain[];
    stats: ConnectivityStats;
  };
}

/**
 * Summary report comparing before/after audit states (Phase 3)
 */
export interface SummaryReport {
  timestamp: string;
  coverageChanges: {
    layer: string;
    before: { isolation: number; density: number };
    after: { isolation: number; density: number };
    delta: { isolation: number; density: number };
  }[];
  relationshipsAdded: number;
  gapsResolved: number;
  remainingGaps: number;
  duplicatesResolved: number;
  balanceImprovements: string[];
}

/**
 * Layer-specific aggregated data
 */
export interface LayerData {
  layer: string;
  coverage: CoverageMetrics;
  duplicates: DuplicateCandidate[];
  gaps: GapCandidate[];
  balance: BalanceAssessment[];
}
