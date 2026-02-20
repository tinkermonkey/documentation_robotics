/**
 * Relationship Audit System - Public API
 *
 * Exports all audit analysis components and types.
 */

// Type definitions
export type {
  CoverageMetrics,
  DuplicateCandidate,
  GapCandidate,
  BalanceAssessment,
  ConnectedComponent,
  NodeDegree,
  TransitiveChain,
  SummaryReport,
} from "./types.js";

// Analysis components
export { CoverageAnalyzer } from "./analysis/coverage-analyzer.js";
export { DuplicateDetector } from "./analysis/duplicate-detector.js";
export { GapAnalyzer } from "./analysis/gap-analyzer.js";
export { BalanceAssessor } from "./analysis/balance-assessor.js";

// Graph components
export { RelationshipGraph } from "./graph/relationship-graph.js";
export { ConnectivityAnalyzer } from "./graph/connectivity.js";

// Snapshot and differential analysis components
export { SnapshotStorage } from "./snapshot-storage.js";
export type { SnapshotMetadata, SnapshotStorageConfig } from "./snapshot-storage.js";
export { DifferentialAnalyzer } from "./differential-analyzer.js";
export type {
  DifferentialAnalysis,
  CoverageComparison,
  GapChanges,
  DuplicateChanges,
  BalanceChanges,
  ConnectivityComparison,
} from "./differential-analyzer.js";

// AI evaluation components
export { ClaudeInvoker } from "./ai/claude-invoker.js";
export type { ClaudeInvocation } from "./ai/claude-invoker.js";
export { PromptTemplates } from "./ai/prompt-templates.js";
export { ResponseParser } from "./ai/response-parser.js";
export type {
  RelationshipRecommendation,
  LayerReview,
  InterLayerValidation,
} from "./ai/response-parser.js";
export { AIEvaluator, InMemoryProgressTracker } from "./ai/ai-evaluator.js";
export type { ProgressTracker, AIEvaluationConfig } from "./ai/ai-evaluator.js";
