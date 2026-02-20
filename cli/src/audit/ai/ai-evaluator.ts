import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CoverageMetrics } from "../types.js";
import { ClaudeInvoker } from "./claude-invoker.js";
import { ResponseParser } from "./response-parser.js";
import type { RelationshipRecommendation } from "./response-parser.js";

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

      // Also check node types with coverage below threshold
      if (layerMetrics.relationshipsPerNodeType < this.config.lowCoverageThreshold) {
        // This layer as a whole is low coverage - evaluate all its types
        // (isolatedNodeTypes already includes zero-coverage types)
      }
    }

    // Create tracker if not provided
    if (!tracker) {
      tracker = new InMemoryProgressTracker(lowCoverageTypes.length);
    }

    // Sequential evaluation
    for (const { nodeType, metrics } of lowCoverageTypes) {
      // Check if already evaluated (resume support)
      if (this.config.resumable && tracker.isCompleted(nodeType)) {
        console.log(`Skipping already-evaluated: ${nodeType}`);
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
      } catch (error: any) {
        console.error(`Failed to evaluate ${nodeType}: ${error.message}`);
        // Continue with next element
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
    for (const layer of layers) {
      // Check if already reviewed (resume support)
      if (this.config.resumable && tracker.isCompleted(layer)) {
        console.log(`Skipping already-reviewed layer: ${layer}`);
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
      } catch (error: any) {
        console.error(`Failed to review layer ${layer}: ${error.message}`);
        // Continue with next layer
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
    for (const { source, target } of layerPairs) {
      const pairKey = `${source}->${target}`;

      // Check if already validated (resume support)
      if (this.config.resumable && tracker.isCompleted(pairKey)) {
        console.log(`Skipping already-validated: ${pairKey}`);
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
      } catch (error: any) {
        console.error(`Failed to validate ${pairKey}: ${error.message}`);
        // Continue with next pair
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
  private async saveLayerReview(layer: string, review: any): Promise<void> {
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
    validation: any
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
}
