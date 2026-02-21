import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CoverageMetrics } from "../types.js";
import { ClaudeInvoker } from "./claude-invoker.js";
import { ResponseParser } from "./response-parser.js";
import type { RelationshipRecommendation, LayerReview, InterLayerValidation } from "./response-parser.js";
import { getErrorMessage } from "../../utils/errors.js";

export interface ProgressTracker {
  isCompleted(key: string): boolean;
  markCompleted(key: string): Promise<void>;
  getProgress(): { completed: number; total: number };
}

export interface AIEvaluationConfig {
  outputDir: string;
  lowCoverageThreshold: number; // Relationships per node type
  resumable: boolean;
}

export interface EvaluationFailure {
  type: "element" | "layer" | "inter-layer";
  key: string;
  error: string;
  timestamp: string;
}

export interface EvaluationSummary {
  totalAttempted: number;
  successful: number;
  failed: number;
  failures: EvaluationFailure[];
}

/**
 * In-memory progress tracker for AI evaluation
 */
export class InMemoryProgressTracker implements ProgressTracker {
  private completed = new Set<string>();
  private total = 0;

  constructor(totalItems: number) {
    this.total = totalItems;
  }

  isCompleted(key: string): boolean {
    return this.completed.has(key);
  }

  async markCompleted(key: string): Promise<void> {
    this.completed.add(key);
  }

  getProgress(): { completed: number; total: number } {
    return {
      completed: this.completed.size,
      total: this.total,
    };
  }
}

/**
 * AI-powered relationship evaluation orchestrator
 */
export class AIEvaluator {
  private claudeInvoker: ClaudeInvoker;
  private responseParser: ResponseParser;
  private config: AIEvaluationConfig;
  private failures: EvaluationFailure[] = [];

  constructor(config: Partial<AIEvaluationConfig> = {}) {
    this.claudeInvoker = new ClaudeInvoker();
    this.responseParser = new ResponseParser();
    this.config = {
      outputDir: config.outputDir || "ai-evaluation",
      lowCoverageThreshold: config.lowCoverageThreshold ?? 1.0,
      resumable: config.resumable ?? true,
    };
  }

  /**
   * Evaluate all low-coverage elements sequentially
   * @param coverage - Array of coverage metrics for all layers
   * @param getPredicatesForLayer - Function to retrieve available predicates for a given layer
   * @param tracker - Optional progress tracker for resume support (defaults to in-memory tracker)
   */
  async evaluateLowCoverageElements(
    coverage: CoverageMetrics[],
    getPredicatesForLayer: (layer: string) => Promise<string[]>,
    tracker?: ProgressTracker
  ): Promise<void> {
    // Ensure output directory exists
    const elementRecsDir = join(this.config.outputDir, "element-recommendations");
    await mkdir(elementRecsDir, { recursive: true });

    // Collect all low-coverage node types
    const lowCoverageTypes: Array<{ nodeType: string; metrics: CoverageMetrics }> =
      [];

    for (const layerMetrics of coverage) {
      for (const nodeType of layerMetrics.isolatedNodeTypes) {
        lowCoverageTypes.push({ nodeType, metrics: layerMetrics });
      }

      // Note: isolatedNodeTypes already includes zero-coverage types
      // Additional low-coverage filtering could be added here if needed
    }

    // Create tracker if not provided
    if (!tracker) {
      tracker = new InMemoryProgressTracker(lowCoverageTypes.length);
    }

    // Sequential evaluation
    let successCount = 0;
    for (const { nodeType, metrics } of lowCoverageTypes) {
      // Check if already evaluated (resume support)
      if (this.config.resumable && tracker.isCompleted(nodeType)) {
        console.log(`Skipping already-evaluated: ${nodeType}`);
        successCount++;
        continue;
      }

      console.log(
        `Evaluating element: ${nodeType} (${tracker.getProgress().completed + 1}/${tracker.getProgress().total})`
      );

      try {
        // Get available predicates for this layer
        const predicates = await getPredicatesForLayer(metrics.layer);

        // Invoke Claude for evaluation
        const response = await this.claudeInvoker.evaluateElement(
          nodeType,
          metrics,
          predicates
        );

        // Parse recommendations
        const recommendations =
          this.responseParser.parseElementRecommendations(response);

        // Save recommendations to file
        await this.saveElementRecommendations(nodeType, recommendations);

        // Mark as completed
        await tracker.markCompleted(nodeType);

        console.log(
          `Completed: ${nodeType} (${recommendations.length} recommendations)`
        );
        successCount++;
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        console.error(`Failed to evaluate ${nodeType}: ${errorMessage}`);

        // Track failure
        this.failures.push({
          type: "element",
          key: nodeType,
          error: errorMessage,
          timestamp: new Date().toISOString(),
        });
        // Continue with next element
      }
    }

    // Report element evaluation summary
    if (lowCoverageTypes.length > 0) {
      console.log(
        `\n✓ Element evaluation complete: ${successCount}/${lowCoverageTypes.length} successful`
      );
      if (this.failures.filter((f) => f.type === "element").length > 0) {
        console.error(
          `⚠️  ${this.failures.filter((f) => f.type === "element").length} element(s) failed - see summary for details`
        );
      }
    }
  }

  /**
   * Review layer coherence sequentially
   */
  async reviewLayerCoherence(
    layers: string[],
    coverage: CoverageMetrics[],
    getPredicatesForLayer: (layer: string) => Promise<string[]>,
    tracker?: ProgressTracker
  ): Promise<void> {
    // Ensure output directory exists
    const layerReviewsDir = join(this.config.outputDir, "layer-reviews");
    await mkdir(layerReviewsDir, { recursive: true });

    // Create tracker if not provided
    if (!tracker) {
      tracker = new InMemoryProgressTracker(layers.length);
    }

    // Sequential layer review
    let successCount = 0;
    for (const layer of layers) {
      // Check if already reviewed (resume support)
      if (this.config.resumable && tracker.isCompleted(layer)) {
        console.log(`Skipping already-reviewed layer: ${layer}`);
        successCount++;
        continue;
      }

      console.log(
        `Reviewing layer: ${layer} (${tracker.getProgress().completed + 1}/${tracker.getProgress().total})`
      );

      try {
        // Get available predicates for this layer
        const predicates = await getPredicatesForLayer(layer);

        // Invoke Claude for layer review
        const response = await this.claudeInvoker.reviewLayer(
          layer,
          coverage,
          predicates
        );

        // Parse review
        const review = this.responseParser.parseLayerReview(response);

        // Save review to file
        await this.saveLayerReview(layer, review);

        // Mark as completed
        await tracker.markCompleted(layer);

        console.log(
          `Completed: ${layer} (${review.recommendations.length} recommendations)`
        );
        successCount++;
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        console.error(`Failed to review layer ${layer}: ${errorMessage}`);

        // Track failure
        this.failures.push({
          type: "layer",
          key: layer,
          error: errorMessage,
          timestamp: new Date().toISOString(),
        });
        // Continue with next layer
      }
    }

    // Report layer review summary
    if (layers.length > 0) {
      console.log(`\n✓ Layer review complete: ${successCount}/${layers.length} successful`);
      if (this.failures.filter((f) => f.type === "layer").length > 0) {
        console.error(
          `⚠️  ${this.failures.filter((f) => f.type === "layer").length} layer(s) failed - see summary for details`
        );
      }
    }
  }

  /**
   * Validate inter-layer references sequentially
   */
  async validateInterLayerReferences(
    layerPairs: Array<{ source: string; target: string }>,
    tracker?: ProgressTracker
  ): Promise<void> {
    // Ensure output directory exists
    const interLayerDir = join(this.config.outputDir, "inter-layer-validation");
    await mkdir(interLayerDir, { recursive: true });

    // Create tracker if not provided
    if (!tracker) {
      tracker = new InMemoryProgressTracker(layerPairs.length);
    }

    // Sequential validation
    let successCount = 0;
    for (const { source, target } of layerPairs) {
      const pairKey = `${source}->${target}`;

      // Check if already validated (resume support)
      if (this.config.resumable && tracker.isCompleted(pairKey)) {
        console.log(`Skipping already-validated: ${pairKey}`);
        successCount++;
        continue;
      }

      console.log(
        `Validating inter-layer: ${pairKey} (${tracker.getProgress().completed + 1}/${tracker.getProgress().total})`
      );

      try {
        // Invoke Claude for validation
        const response = await this.claudeInvoker.validateInterLayer(source, target);

        // Parse validation results
        const validation = this.responseParser.parseInterLayerValidation(response);

        // Save validation results
        await this.saveInterLayerValidation(pairKey, validation);

        // Mark as completed
        await tracker.markCompleted(pairKey);

        console.log(
          `Completed: ${pairKey} (${validation.violations.length} violations, ${validation.recommendations.length} recommendations)`
        );
        successCount++;
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        console.error(`Failed to validate ${pairKey}: ${errorMessage}`);

        // Track failure
        this.failures.push({
          type: "inter-layer",
          key: pairKey,
          error: errorMessage,
          timestamp: new Date().toISOString(),
        });
        // Continue with next pair
      }
    }

    // Report inter-layer validation summary
    if (layerPairs.length > 0) {
      console.log(
        `\n✓ Inter-layer validation complete: ${successCount}/${layerPairs.length} successful`
      );
      if (this.failures.filter((f) => f.type === "inter-layer").length > 0) {
        console.error(
          `⚠️  ${this.failures.filter((f) => f.type === "inter-layer").length} pair(s) failed - see summary for details`
        );
      }
    }
  }

  /**
   * Save element recommendations to file
   */
  private async saveElementRecommendations(
    nodeType: string,
    recommendations: RelationshipRecommendation[]
  ): Promise<void> {
    const filename = `${nodeType}.json`;
    const filepath = join(this.config.outputDir, "element-recommendations", filename);

    await writeFile(
      filepath,
      JSON.stringify(
        {
          nodeType,
          timestamp: new Date().toISOString(),
          recommendations,
        },
        null,
        2
      )
    );
  }

  /**
   * Save layer review to file
   */
  private async saveLayerReview(layer: string, review: LayerReview): Promise<void> {
    const filename = `${layer}.review.json`;
    const filepath = join(this.config.outputDir, "layer-reviews", filename);

    await writeFile(
      filepath,
      JSON.stringify(
        {
          layer,
          timestamp: new Date().toISOString(),
          review,
        },
        null,
        2
      )
    );
  }

  /**
   * Save inter-layer validation to file
   */
  private async saveInterLayerValidation(
    pairKey: string,
    validation: InterLayerValidation
  ): Promise<void> {
    const filename = `${pairKey.replace("->", "_to_")}.json`;
    const filepath = join(this.config.outputDir, "inter-layer-validation", filename);

    await writeFile(
      filepath,
      JSON.stringify(
        {
          pair: pairKey,
          timestamp: new Date().toISOString(),
          validation,
        },
        null,
        2
      )
    );
  }

  /**
   * Get evaluation summary including failures
   */
  getEvaluationSummary(totalAttempted: number): EvaluationSummary {
    return {
      totalAttempted,
      successful: totalAttempted - this.failures.length,
      failed: this.failures.length,
      failures: this.failures,
    };
  }

  /**
   * Save evaluation summary to file
   */
  async saveEvaluationSummary(totalAttempted: number): Promise<void> {
    const summary = this.getEvaluationSummary(totalAttempted);
    const filepath = join(this.config.outputDir, "evaluation-summary.json");

    await writeFile(filepath, JSON.stringify(summary, null, 2));
  }

  /**
   * Print failure summary to console
   */
  printFailureSummary(): void {
    if (this.failures.length === 0) {
      console.log("\n✓ All AI evaluations completed successfully");
      return;
    }

    console.error(`\n⚠️  AI Evaluation Failures Summary:`);
    console.error(`Total failures: ${this.failures.length}\n`);

    const failuresByType = {
      element: this.failures.filter((f) => f.type === "element"),
      layer: this.failures.filter((f) => f.type === "layer"),
      "inter-layer": this.failures.filter((f) => f.type === "inter-layer"),
    };

    for (const [type, failures] of Object.entries(failuresByType)) {
      if (failures.length > 0) {
        console.error(`${type} failures (${failures.length}):`);
        for (const failure of failures) {
          console.error(`  - ${failure.key}: ${failure.error}`);
        }
        console.error("");
      }
    }

    console.error(
      `Full details saved to: ${join(this.config.outputDir, "evaluation-summary.json")}`
    );
  }
}
