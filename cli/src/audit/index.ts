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
  AuditReport,
  ConnectivityStats,
  LayerData,
} from "./types.js";

// Analysis components
export { CoverageAnalyzer } from "./relationships/analysis/coverage-analyzer.js";
export { DuplicateDetector } from "./relationships/analysis/duplicate-detector.js";
export { GapAnalyzer } from "./relationships/analysis/gap-analyzer.js";
export type { GapAnalysisResult } from "./relationships/analysis/gap-analyzer.js";
export { BalanceAssessor } from "./relationships/analysis/balance-assessor.js";

// Graph components
export { RelationshipGraph } from "./relationships/graph/relationship-graph.js";
export { ConnectivityAnalyzer } from "./relationships/graph/connectivity.js";

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
  SkippedLayer,
} from "./differential-analyzer.js";

// AI evaluation components
export { AuditAIRunner } from "./ai/runner.js";
export { PromptTemplates } from "./relationships/ai/prompts.js";
export { ResponseParser } from "./relationships/ai/parser.js";
export type {
  RelationshipRecommendation,
  LayerReview,
  InterLayerValidation,
} from "./relationships/ai/parser.js";
export { AIEvaluator, InMemoryProgressTracker } from "./relationships/ai/evaluator.js";
export type { ProgressTracker, AIEvaluationConfig } from "./relationships/ai/evaluator.js";

// Spec relationship orchestrator
export { AuditOrchestrator } from "./relationships/spec/orchestrator.js";
export type { AuditOptions, AuditComponents } from "./relationships/spec/orchestrator.js";

// Model relationship orchestrator
export { ModelAuditOrchestrator } from "./relationships/model/orchestrator.js";
export type { ModelAuditOptions } from "./relationships/model/orchestrator.js";
