import type { LayerDefinition, ParsedNodeSchema, LayerAIReview } from "../types.js";
import { NodePromptTemplates } from "./prompts.js";
import { NodeResponseParser } from "./parser.js";
import { AuditAIRunner } from "../../ai/runner.js";
import { getErrorMessage } from "../../../utils/errors.js";

const INVOKE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per invocation

export class NodeAIEvaluator {
  private readonly runner: AuditAIRunner;
  private readonly promptTemplates: NodePromptTemplates;
  private readonly responseParser: NodeResponseParser;

  constructor() {
    this.runner = new AuditAIRunner();
    this.promptTemplates = new NodePromptTemplates();
    this.responseParser = new NodeResponseParser();
  }

  /**
   * Evaluate each layer sequentially, returning one LayerAIReview per layer.
   * Layers with zero schemas are skipped.
   * Fails fast after maxConsecutiveFailures consecutive Claude invocation failures.
   */
  async evaluateLayers(
    layerDefs: LayerDefinition[],
    schemasByLayer: Map<string, ParsedNodeSchema[]>
  ): Promise<LayerAIReview[]> {
    const reviews: LayerAIReview[] = [];

    for (const layerDef of layerDefs) {
      const schemas = schemasByLayer.get(layerDef.id) ?? [];
      if (schemas.length === 0) {
        continue;
      }

      const standard = layerDef.inspiredBy
        ? `${layerDef.inspiredBy.standard} ${layerDef.inspiredBy.version}`
        : this.promptTemplates.getFallbackStandard(layerDef.id);

      process.stderr.write(`  Evaluating layer: ${layerDef.id} (${schemas.length} node types)...\n`);

      try {
        const prompt = this.promptTemplates.layerEvaluation({ layerDef, schemas });
        const response = await this.runner.invoke(prompt, `layer: ${layerDef.id}`, INVOKE_TIMEOUT_MS);
        const nodeEvaluations = this.responseParser.parseLayerEvaluation(response);

        const avgAlignmentScore =
          nodeEvaluations.length > 0
            ? nodeEvaluations.reduce((sum, e) => sum + e.alignmentScore, 0) / nodeEvaluations.length
            : 0;
        const avgDocumentationScore =
          nodeEvaluations.length > 0
            ? nodeEvaluations.reduce((sum, e) => sum + e.documentationScore, 0) /
              nodeEvaluations.length
            : 0;

        reviews.push({
          layerId: layerDef.id,
          standard,
          nodeEvaluations,
          avgAlignmentScore: Math.round(avgAlignmentScore * 10) / 10,
          avgDocumentationScore: Math.round(avgDocumentationScore * 10) / 10,
        });
      } catch (error: unknown) {
        const msg = getErrorMessage(error);
        process.stderr.write(`  ⚠️  Failed to evaluate layer ${layerDef.id}: ${msg}\n`);

        // Re-throw fail-fast errors from runner
        if (msg.includes("AI evaluation aborted")) {
          throw error;
        }
      }
    }

    return reviews;
  }
}
