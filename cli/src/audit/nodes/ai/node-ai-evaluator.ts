import { spawn } from "node:child_process";
import type { LayerDefinition, ParsedNodeSchema, LayerAIReview } from "../node-audit-types.js";
import { NodePromptTemplates } from "./node-prompt-templates.js";
import { NodeResponseParser } from "./node-response-parser.js";
import { getErrorMessage } from "../../../utils/errors.js";

const RATE_LIMIT_DELAY_MS = 1500;
const MAX_CONSECUTIVE_FAILURES = 3;
const INVOKE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per invocation

export class NodeAIEvaluator {
  private readonly promptTemplates: NodePromptTemplates;
  private readonly responseParser: NodeResponseParser;

  constructor() {
    this.promptTemplates = new NodePromptTemplates();
    this.responseParser = new NodeResponseParser();
  }

  /**
   * Evaluate each layer sequentially, returning one LayerAIReview per layer.
   * Layers with zero schemas are skipped.
   * Fails fast after MAX_CONSECUTIVE_FAILURES consecutive Claude invocation failures.
   */
  async evaluateLayers(
    layerDefs: LayerDefinition[],
    schemasByLayer: Map<string, ParsedNodeSchema[]>
  ): Promise<LayerAIReview[]> {
    const reviews: LayerAIReview[] = [];
    let consecutiveFailures = 0;

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
        const response = await this.invokeClaude(prompt, layerDef.id);
        const nodeEvaluations = this.responseParser.parseLayerEvaluation(response);

        const avgAlignmentScore = nodeEvaluations.length > 0
          ? nodeEvaluations.reduce((sum, e) => sum + e.alignmentScore, 0) / nodeEvaluations.length
          : 0;
        const avgDocumentationScore = nodeEvaluations.length > 0
          ? nodeEvaluations.reduce((sum, e) => sum + e.documentationScore, 0) / nodeEvaluations.length
          : 0;

        reviews.push({
          layerId: layerDef.id,
          standard,
          nodeEvaluations,
          avgAlignmentScore: Math.round(avgAlignmentScore * 10) / 10,
          avgDocumentationScore: Math.round(avgDocumentationScore * 10) / 10,
        });

        consecutiveFailures = 0;
        await this.delay(RATE_LIMIT_DELAY_MS);
      } catch (error: unknown) {
        consecutiveFailures++;
        process.stderr.write(
          `  ⚠️  Failed to evaluate layer ${layerDef.id}: ${getErrorMessage(error)}\n`
        );

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          throw new Error(
            `AI evaluation aborted after ${MAX_CONSECUTIVE_FAILURES} consecutive failures. ` +
            `Is Claude CLI installed and authenticated? Run 'claude --version' to verify.`
          );
        }
      }
    }

    return reviews;
  }

  private async invokeClaude(prompt: string, layerId: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(
        "claude",
        ["--print", "--dangerously-skip-permissions", prompt],
        { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
      );

      const chunks: Buffer[] = [];
      const stderrChunks: string[] = [];

      child.stdout.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        process.stdout.write(chunk);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk.toString());
      });

      const timer = setTimeout(() => {
        child.kill();
        reject(
          new Error(
            `Claude invocation timed out after ${INVOKE_TIMEOUT_MS / 1000}s (layer: ${layerId})`
          )
        );
      }, INVOKE_TIMEOUT_MS);

      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(
            new Error(
              `Claude invocation failed (layer: ${layerId}): exited with code ${code}\nStderr: ${stderrChunks.join("") || "N/A"}`
            )
          );
        } else {
          resolve(Buffer.concat(chunks).toString("utf8"));
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(
          new Error(`Claude invocation failed (layer: ${layerId}): ${err.message}`)
        );
      });
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
