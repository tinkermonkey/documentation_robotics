import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CoverageMetrics } from "../types.js";
import { PromptTemplates } from "./prompt-templates.js";
import { getErrorMessage } from "../../utils/errors.js";

const execFileAsync = promisify(execFile);

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
  target: string; // Node type ID (e.g., "motivation.goal.customer-satisfaction")
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
      const result = await execFileAsync("claude", args, {
        cwd: process.cwd(),
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      // Rate limiting
      await this.delay(this.RATE_LIMIT_DELAY_MS);

      return result.stdout;
    } catch (error: unknown) {
      const stderr = error && typeof error === "object" && "stderr" in error
        ? (error as { stderr?: string }).stderr
        : undefined;
      throw new Error(
        `Claude invocation failed (${invocation.type}: ${invocation.target}): ${getErrorMessage(error)}\nStderr: ${stderr || "N/A"}`
      );
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
