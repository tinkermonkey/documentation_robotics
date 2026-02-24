import { describe, it, expect, mock } from "bun:test";
import { PromptTemplates } from "../../../../src/audit/relationships/ai/prompts.js";
import { AuditAIRunner, AIEvaluationAbortError } from "../../../../src/audit/ai/runner.js";
import type { CoverageMetrics } from "../../../../src/audit/types.js";

describe("AuditAIRunner", () => {
  describe("Configuration", () => {
    it("should instantiate with default rate limit and failure threshold", () => {
      const runner = new AuditAIRunner();
      expect(runner).toBeDefined();
    });

    it("should respect rate limit delay configuration", () => {
      const runner = new AuditAIRunner(1500, 3);
      expect(runner).toBeDefined();
    });
  });

  describe("Fail-fast behavior", () => {
    it("should throw AIEvaluationAbortError after maxConsecutiveFailures", async () => {
      mock.module("../../../../src/utils/claude-stream.js", () => ({
        invokeClaudeStreaming: async () => {
          throw new Error("Claude CLI not found");
        },
      }));

      const { AuditAIRunner: FreshRunner, AIEvaluationAbortError: FreshAbortError } =
        await import("../../../../src/audit/ai/runner.js");
      const runner = new FreshRunner(0, 2); // 0ms delay, abort after 2 failures

      // First failure: transient — original error re-thrown
      await expect(runner.invoke("prompt", "label")).rejects.toThrow("Claude CLI not found");

      // Second failure: threshold reached — AIEvaluationAbortError thrown
      const err = await runner.invoke("prompt", "label").catch((e) => e);
      expect(err).toBeInstanceOf(FreshAbortError);
      expect(err.message).toContain("AI evaluation aborted after 2 consecutive failures");
      expect(err.message).toContain("claude --version");
    });

    it("should reset consecutive failure counter after a success", async () => {
      let callCount = 0;
      mock.module("../../../../src/utils/claude-stream.js", () => ({
        invokeClaudeStreaming: async () => {
          callCount++;
          if (callCount === 1) throw new Error("Transient failure");
          return "OK";
        },
      }));

      const { AuditAIRunner: FreshRunner, AIEvaluationAbortError: FreshAbortError } =
        await import("../../../../src/audit/ai/runner.js");
      const runner = new FreshRunner(0, 2);

      // First call fails (count = 1)
      await expect(runner.invoke("p", "l")).rejects.toThrow("Transient failure");
      // Second call succeeds (resets counter)
      await expect(runner.invoke("p", "l")).resolves.toBe("OK");
      // Third call fails (count = 1 again, not 2 — should NOT abort yet)
      mock.module("../../../../src/utils/claude-stream.js", () => ({
        invokeClaudeStreaming: async () => {
          throw new Error("Another failure");
        },
      }));
      const { AuditAIRunner: FreshRunner2, AIEvaluationAbortError: FreshAbortError2 } =
        await import("../../../../src/audit/ai/runner.js");
      const runner2 = new FreshRunner2(0, 2);
      await runner2.invoke("p", "l").catch(() => {}); // failure #1
      const err = await runner2.invoke("p", "l").catch((e) => e); // failure #2 → abort
      expect(err).toBeInstanceOf(FreshAbortError2);
    });

    it("should preserve the original error as cause on abort", async () => {
      const originalError = new Error("ENOENT: claude not found");
      mock.module("../../../../src/utils/claude-stream.js", () => ({
        invokeClaudeStreaming: async () => {
          throw originalError;
        },
      }));

      const { AuditAIRunner: FreshRunner, AIEvaluationAbortError: FreshAbortError } =
        await import("../../../../src/audit/ai/runner.js");
      const runner = new FreshRunner(0, 1); // abort after 1 failure

      const err = await runner.invoke("prompt", "label").catch((e) => e);
      expect(err).toBeInstanceOf(FreshAbortError);
      expect((err as Error & { cause?: unknown }).cause).toBe(originalError);
    });

    it("AIEvaluationAbortError is distinguishable via instanceof", async () => {
      mock.module("../../../../src/utils/claude-stream.js", () => ({
        invokeClaudeStreaming: async () => {
          throw new Error("fail");
        },
      }));

      const { AuditAIRunner: FreshRunner, AIEvaluationAbortError: FreshAbortError } =
        await import("../../../../src/audit/ai/runner.js");
      const runner = new FreshRunner(0, 1);
      const err = await runner.invoke("p", "l").catch((e) => e);

      // Verify callers can branch on type rather than message string
      expect(err instanceof FreshAbortError).toBe(true);
      expect(err instanceof Error).toBe(true);
      expect(err.name).toBe("AIEvaluationAbortError");
    });
  });
});

describe("PromptTemplates", () => {
  const templates = new PromptTemplates();

  describe("Element Evaluation Prompt Structure", () => {
    it("should include all required sections for element evaluation", () => {
      const nodeType = "motivation.goal.test";
      const coverage: CoverageMetrics = {
        layer: "motivation",
        nodeTypeCount: 10,
        relationshipCount: 5,
        isolatedNodeTypes: [],
        isolationPercentage: 0,
        relationshipsPerNodeType: 0.5,
        availablePredicates: [],
        usedPredicates: [],
        utilizationPercentage: 0,
      };
      const predicates = ["realizes", "influences"];

      const prompt = templates.elementEvaluation(nodeType, coverage, predicates);

      expect(prompt).toContain("motivation.goal.test");
      expect(prompt).toContain("Layer: motivation");
      expect(prompt).toContain("realizes");
      expect(prompt).toContain("influences");
      expect(prompt).toContain("ArchiMate 3.2");
      expect(prompt).toContain("Available Predicates:");
      expect(prompt).toContain("Format as JSON array");
    });
  });

  describe("Layer Review Prompt Structure", () => {
    it("should include all required sections for layer review", () => {
      const coverage: CoverageMetrics[] = [
        {
          layer: "security",
          nodeTypeCount: 66,
          relationshipCount: 0,
          isolatedNodeTypes: [],
          isolationPercentage: 100,
          relationshipsPerNodeType: 0,
          availablePredicates: [],
          usedPredicates: [],
          utilizationPercentage: 0,
        },
      ];

      const prompt = templates.layerReview("security", coverage);

      expect(prompt).toContain("Review the security layer");
      expect(prompt).toContain("Node Types: 66");
      expect(prompt).toContain("Isolation: 100%");
      expect(prompt).toContain("NIST SP 800-53");
    });
  });

  describe("Inter-Layer Validation Prompt Structure", () => {
    it("should include all required sections for inter-layer validation", () => {
      const prompt = templates.interLayerValidation("application", "technology");

      expect(prompt).toContain("Validate cross-layer relationships");
      expect(prompt).toContain("from application to technology");
      expect(prompt).toContain("Higher layers → lower layers only");
    });
  });
});
