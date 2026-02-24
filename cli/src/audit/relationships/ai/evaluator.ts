import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CoverageMetrics } from "../../types.js";
import { AuditAIRunner } from "../../ai/runner.js";
import { PromptTemplates } from "./prompts.js";
import { ResponseParser } from "./parser.js";
import type { RelationshipRecommendation, LayerReview, InterLayerValidation } from "./parser.js";
import { getErrorMessage } from "../../../utils/errors.js";

/**
 * Tracks progress of AI evaluation operations, enabling resume support
 * for interrupted or long-running evaluation pipelines.
 * Implementations may persist progress to disk or store in memory.
 */
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
  private runner: AuditAIRunner;
  private promptTemplates: PromptTemplates;
  private responseParser: ResponseParser;
  private config: AIEvaluationConfig;
  private failures: EvaluationFailure[] = [];

  constructor(config: Partial<AIEvaluationConfig> = {}) {
    this.runner = new AuditAIRunner();
    this.promptTemplates = new PromptTemplates();
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
   * @returns Promise resolving when all evaluations are complete
   * @throws Error if consecutive invocation failures exceed threshold or if AI evaluation is misconfigured
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
    }

    // Create tracker if not provided
    if (!tracker) {
      tracker = new InMemoryProgressTracker(lowCoverageTypes.length);
    }

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
        const predicates = await getPredicatesForLayer(metrics.layer);
        const prompt = this.promptTemplates.elementEvaluation(nodeType, metrics, predicates);
        const response = await this.runner.invoke(prompt, nodeType);

        const recommendations =
          this.responseParser.parseElementRecommendations(response);

        await this.saveElementRecommendations(nodeType, recommendations);
        await tracker.markCompleted(nodeType);

        console.log(
          `Completed: ${nodeType} (${recommendations.length} recommendations)`
        );
        successCount++;
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        console.error(`Failed to evaluate ${nodeType}: ${errorMessage}`);

        this.failures.push({
          type: "element",
          key: nodeType,
          error: errorMessage,
          timestamp: new Date().toISOString(),
        });

        // Re-throw fail-fast errors from runner
        if (errorMessage.includes("AI evaluation aborted")) {
          throw error;
        }
      }
    }

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
    tracker?: ProgressTracker
  ): Promise<void> {
    const layerReviewsDir = join(this.config.outputDir, "layer-reviews");
    await mkdir(layerReviewsDir, { recursive: true });

    if (!tracker) {
      tracker = new InMemoryProgressTracker(layers.length);
    }

    let successCount = 0;
    for (const layer of layers) {
      if (this.config.resumable && tracker.isCompleted(layer)) {
        console.log(`Skipping already-reviewed layer: ${layer}`);
        successCount++;
        continue;
      }

      console.log(
        `Reviewing layer: ${layer} (${tracker.getProgress().completed + 1}/${tracker.getProgress().total})`
      );

      try {
        const prompt = this.promptTemplates.layerReview(layer, coverage);
        const response = await this.runner.invoke(prompt, layer);

        const review = this.responseParser.parseLayerReview(response);
        await this.saveLayerReview(layer, review);
        await tracker.markCompleted(layer);

        console.log(
          `Completed: ${layer} (${review.recommendations.length} recommendations)`
        );
        successCount++;
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        console.error(`Failed to review layer ${layer}: ${errorMessage}`);

        this.failures.push({
          type: "layer",
          key: layer,
          error: errorMessage,
          timestamp: new Date().toISOString(),
        });

        if (errorMessage.includes("AI evaluation aborted")) {
          throw error;
        }
      }
    }

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
    const interLayerDir = join(this.config.outputDir, "inter-layer-validation");
    await mkdir(interLayerDir, { recursive: true });

    if (!tracker) {
      tracker = new InMemoryProgressTracker(layerPairs.length);
    }

    let successCount = 0;
    for (const { source, target } of layerPairs) {
      const pairKey = `${source}->${target}`;

      if (this.config.resumable && tracker.isCompleted(pairKey)) {
        console.log(`Skipping already-validated: ${pairKey}`);
        successCount++;
        continue;
      }

      console.log(
        `Validating inter-layer: ${pairKey} (${tracker.getProgress().completed + 1}/${tracker.getProgress().total})`
      );

      try {
        const prompt = this.promptTemplates.interLayerValidation(source, target);
        const response = await this.runner.invoke(prompt, pairKey);

        const validation = this.responseParser.parseInterLayerValidation(response);
        await this.saveInterLayerValidation(pairKey, validation);
        await tracker.markCompleted(pairKey);

        console.log(
          `Completed: ${pairKey} (${validation.violations.length} violations, ${validation.recommendations.length} recommendations)`
        );
        successCount++;
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        console.error(`Failed to validate ${pairKey}: ${errorMessage}`);

        this.failures.push({
          type: "inter-layer",
          key: pairKey,
          error: errorMessage,
          timestamp: new Date().toISOString(),
        });

        if (errorMessage.includes("AI evaluation aborted")) {
          throw error;
        }
      }
    }

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
   * Sanitize a string for use in file paths, removing path traversal characters
   */
  private sanitizeForFilePath(input: string): string {
    return input
      .replace(/\.\./g, "_")
      .replace(/[\/\\]/g, "_")
      .replace(/[<>:"|?*]/g, "_");
  }

  private async saveElementRecommendations(
    nodeType: string,
    recommendations: RelationshipRecommendation[]
  ): Promise<void> {
    const sanitizedNodeType = this.sanitizeForFilePath(nodeType);
    const filename = `${sanitizedNodeType}.json`;
    const filepath = join(this.config.outputDir, "element-recommendations", filename);

    try {
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
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      throw new Error(
        `Failed to save element recommendations for "${nodeType}" to ${filepath}: ${errorMessage}. ` +
          `AI evaluation results were not persisted. Please ensure the output directory is writable and has sufficient disk space.`
      );
    }
  }

  private async saveLayerReview(layer: string, review: LayerReview): Promise<void> {
    const sanitizedLayer = this.sanitizeForFilePath(layer);
    const filename = `${sanitizedLayer}.review.json`;
    const filepath = join(this.config.outputDir, "layer-reviews", filename);

    try {
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
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      throw new Error(
        `Failed to save layer review for "${layer}" to ${filepath}: ${errorMessage}. ` +
          `AI evaluation results were not persisted. Please ensure the output directory is writable and has sufficient disk space.`
      );
    }
  }

  private async saveInterLayerValidation(
    pairKey: string,
    validation: InterLayerValidation
  ): Promise<void> {
    const filename = `${pairKey.replace("->", "_to_")}.json`;
    const filepath = join(this.config.outputDir, "inter-layer-validation", filename);

    try {
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
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      throw new Error(
        `Failed to save inter-layer validation for "${pairKey}" to ${filepath}: ${errorMessage}. ` +
          `AI evaluation results were not persisted. Please ensure the output directory is writable and has sufficient disk space.`
      );
    }
  }

  getEvaluationSummary(totalAttempted: number): EvaluationSummary {
    return {
      totalAttempted,
      successful: totalAttempted - this.failures.length,
      failed: this.failures.length,
      failures: this.failures,
    };
  }

  async saveEvaluationSummary(totalAttempted: number): Promise<void> {
    const summary = this.getEvaluationSummary(totalAttempted);
    const filepath = join(this.config.outputDir, "evaluation-summary.json");

    try {
      await writeFile(filepath, JSON.stringify(summary, null, 2));
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      throw new Error(
        `Failed to save evaluation summary to ${filepath}: ${errorMessage}. ` +
          `Summary of evaluation results was not persisted. Please ensure the output directory is writable and has sufficient disk space.`
      );
    }
  }

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
