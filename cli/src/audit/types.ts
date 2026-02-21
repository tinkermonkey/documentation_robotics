/**
 * Type definitions for relationship audit system
 */

/**
 * Percentage value constrained to 0-100 range
 * Use createPercentage() to construct safely
 */
export type Percentage = number & { readonly __brand: "Percentage" };

/**
 * Create a validated percentage value (0-100)
 * @throws Error if value is not in valid range
 */
export function createPercentage(value: number): Percentage {
  if (value < 0 || value > 100 || !Number.isFinite(value)) {
    throw new Error(`Invalid percentage: ${value}. Must be a number between 0 and 100.`);
  }
  return value as Percentage;
}

/**
 * Coverage metrics for a layer
 */
export interface CoverageMetrics {
  readonly layer: string;
  readonly nodeTypeCount: number;
  readonly relationshipCount: number;

  // Node isolation
  readonly isolatedNodeTypes: readonly string[]; // Zero relationships
  /** Percentage of node types with zero relationships (0-100) */
  readonly isolationPercentage: Percentage;

  // Predicate utilization
  readonly availablePredicates: readonly string[]; // Predicates applicable to this layer
  readonly usedPredicates: readonly string[]; // Actually used
  /** Percentage of available predicates actually used (0-100) */
  readonly utilizationPercentage: Percentage;

  // Density
  readonly relationshipsPerNodeType: number;

  // Standard alignment (for ArchiMate layers)
  readonly standardAlignment?: {
    readonly standard: string;
    readonly expectedRelationships: number;
    readonly missingFromStandard: readonly string[];
  };
}

/**
 * Semantic duplicate candidate
 */
export interface DuplicateCandidate {
  readonly relationships: readonly [string, string]; // IDs of duplicate pair
  readonly predicates: readonly [string, string]; // Predicate names
  readonly sourceNodeType: string;
  readonly destinationNodeType: string;
  readonly reason: string; // Explanation of semantic overlap
  readonly confidence: "high" | "medium" | "low";
}

/**
 * Missing relationship gap candidate
 */
export interface GapCandidate {
  readonly sourceNodeType: string;
  readonly destinationNodeType: string;
  readonly suggestedPredicate: string;
  readonly reason: string;
  readonly priority: "high" | "medium" | "low";
  readonly standardReference?: string; // e.g., "ArchiMate 3.2 §5.2"
}

/**
 * Balance assessment for node type relationship density
 */
export interface BalanceAssessment {
  readonly nodeType: string;
  readonly layer: string;
  readonly category: "structural" | "behavioral" | "enumeration" | "reference";
  readonly currentCount: number;
  readonly targetRange: readonly [number, number];
  readonly status: "under" | "balanced" | "over";
  readonly recommendation?: string;
}

/**
 * Connected component in relationship graph
 */
export interface ConnectedComponent {
  readonly nodes: readonly string[];
}

/**
 * Node degree information
 */
export interface NodeDegree {
  readonly nodeType: string;
  readonly inDegree: number;
  readonly outDegree: number;
  readonly totalDegree: number;
}

/**
 * Transitive relationship chain
 */
export interface TransitiveChain {
  readonly predicate: string;
  readonly chain: readonly string[]; // Node types in chain
}

/**
 * Connectivity statistics summary
 */
export interface ConnectivityStats {
  readonly totalNodes: number;
  readonly totalEdges: number;
  readonly connectedComponents: number;
  readonly largestComponentSize: number;
  readonly isolatedNodes: number;
  readonly averageDegree: number;
  readonly transitiveChainCount: number;
}

/**
 * Comprehensive audit report combining all analysis results
 */
export interface AuditReport {
  readonly timestamp: string;
  readonly model: {
    readonly name: string;
    readonly version: string;
  };
  readonly coverage: readonly CoverageMetrics[];
  readonly duplicates: readonly DuplicateCandidate[];
  readonly gaps: readonly GapCandidate[];
  readonly balance: readonly BalanceAssessment[];
  readonly connectivity: {
    readonly components: readonly ConnectedComponent[];
    readonly degrees: readonly NodeDegree[];
    readonly transitiveChains: readonly TransitiveChain[];
    readonly stats: ConnectivityStats;
  };
}

/**
 * Summary report comparing before/after audit states
 */
export interface SummaryReport {
  readonly timestamp: string;
  readonly coverageChanges: readonly {
    readonly layer: string;
    readonly before: { readonly isolation: number; readonly density: number };
    readonly after: { readonly isolation: number; readonly density: number };
    readonly delta: { readonly isolation: number; readonly density: number };
  }[];
  readonly relationshipsAdded: number;
  readonly gapsResolved: number;
  readonly remainingGaps: number;
  readonly duplicatesResolved: number;
  readonly balanceImprovements: readonly string[];
}

/**
 * Layer-specific aggregated data
 */
export interface LayerData {
  readonly layer: string;
  readonly coverage: CoverageMetrics;
  readonly duplicates: readonly DuplicateCandidate[];
  readonly gaps: readonly GapCandidate[];
  readonly balance: readonly BalanceAssessment[];
}
