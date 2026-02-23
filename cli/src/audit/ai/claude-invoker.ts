import { spawn } from "node:child_process";
import type { CoverageMetrics } from "../types.js";
import { PromptTemplates } from "./prompt-templates.js";
import { getErrorMessage } from "../../utils/errors.js";

/**
 * Base invocation context shared by all types
 */
interface BaseInvocationContext {
  availablePredicates: string[];
  currentRelationships: string[];
}

/**
 * Element evaluation invocation
 */
export interface ElementInvocation {
  type: "element";
  target: string; // Full element ID (e.g., "motivation.goal.customer-satisfaction") uniquely identifying the node type
  prompt: string;
  context: BaseInvocationContext;
}

/**
 * Layer review invocation
 */
export interface LayerInvocation {
  type: "layer";
  target: string; // Layer name (e.g., "security")
  prompt: string;
  context: BaseInvocationContext & {
    layerStandard: string; // Standard reference (e.g., "NIST SP 800-53")
  };
}

/**
 * Inter-layer validation invocation
 */
export interface InterLayerInvocation {
  type: "inter-layer";
  target: string; // Layer pair (e.g., "application->technology")
  prompt: string;
  context: BaseInvocationContext;
}

/**
 * Discriminated union of all invocation types
 */
export type ClaudeInvocation =
  | ElementInvocation
  | LayerInvocation
  | InterLayerInvocation;

export class ClaudeInvoker {
  private readonly RATE_LIMIT_DELAY_MS = 2000;
  private readonly promptTemplates: PromptTemplates;

  constructor() {
    this.promptTemplates = new PromptTemplates();
  }

  /**
   * Invoke Claude Code CLI with a prompt
   */
  async invoke(invocation: ClaudeInvocation): Promise<string> {
    const args = [
      "--print",
      "--dangerously-skip-permissions",
      invocation.prompt,
    ];

    try {
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn("claude", args, { cwd: process.cwd() });
        const chunks: Buffer[] = [];
        const stderrChunks: string[] = [];

        child.stdout.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          process.stdout.write(chunk);
        });

        child.stderr.on("data", (chunk: Buffer) => {
          stderrChunks.push(chunk.toString());
        });

        child.on("close", (code) => {
          if (code !== 0) {
            reject(
              new Error(
                `Claude invocation failed (${invocation.type}: ${invocation.target}): exited with code ${code}\nStderr: ${stderrChunks.join("") || "N/A"}`
              )
            );
          } else {
            resolve(Buffer.concat(chunks).toString("utf8"));
          }
        });

        child.on("error", (err) => {
          reject(
            new Error(
              `Claude invocation failed (${invocation.type}: ${invocation.target}): ${err.message}`
            )
          );
        });
      });

      // Rate limiting
      await this.delay(this.RATE_LIMIT_DELAY_MS);

      return output;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error));
    }
  }

  /**
   * Evaluate a low-coverage element for relationship recommendations
   */
  async evaluateElement(
    nodeType: string,
    coverage: CoverageMetrics,
    predicates: string[]
  ): Promise<string> {
    const prompt = this.promptTemplates.elementEvaluation(
      nodeType,
      coverage,
      predicates
    );
    return this.invoke({
      type: "element",
      target: nodeType,
      prompt,
      context: {
        availablePredicates: predicates,
        currentRelationships: [], // Empty placeholder - relationship context provided via prompt template
      },
    });
  }

  /**
   * Review an entire layer for relationship coherence
   */
  async reviewLayer(
    layer: string,
    coverage: CoverageMetrics[],
    predicates: string[]
  ): Promise<string> {
    const prompt = this.promptTemplates.layerReview(layer, coverage);

    return this.invoke({
      type: "layer",
      target: layer,
      prompt,
      context: {
        availablePredicates: predicates,
        currentRelationships: [],
        layerStandard: this.promptTemplates.getLayerStandard(layer),
      },
    });
  }

  /**
   * Validate inter-layer reference relationships
   */
  async validateInterLayer(
    sourceLayer: string,
    targetLayer: string
  ): Promise<string> {
    const prompt = this.promptTemplates.interLayerValidation(
      sourceLayer,
      targetLayer
    );

    return this.invoke({
      type: "inter-layer",
      target: `${sourceLayer}->${targetLayer}`,
      prompt,
      context: {
        availablePredicates: [],
        currentRelationships: [],
      },
    });
  }

  /**
   * Delay execution for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
