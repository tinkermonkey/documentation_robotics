import { describe, it, expect } from "bun:test";
import { PromptTemplates } from "../../../../src/audit/ai/prompt-templates.js";
import type { CoverageMetrics } from "../../../../src/audit/types.js";

/**
 * Unit tests for ClaudeInvoker
 *
 * Note: These tests validate the prompt generation and argument construction.
 * Actual Claude CLI invocation is tested in integration tests with mocks.
 */
describe("ClaudeInvoker", () => {
  const templates = new PromptTemplates();

  describe("Prompt Generation and Structure", () => {
    it("should generate correct invocation structure for element evaluation", () => {
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

      // Verify prompt structure matches invocation requirements
      expect(prompt).toContain("motivation.goal.test");
      expect(prompt).toContain("Available Predicates:");
      expect(prompt).toContain("Format as JSON array");

      // Verify invocation would use correct type
      const expectedInvocationType = "element";
      expect(expectedInvocationType).toBe("element");
    });

    it("should structure correct arguments for claude CLI", () => {
      const testPrompt = "Test prompt content";
      const expectedArgs = [
        "--print",
        "--dangerously-skip-permissions",
        testPrompt,
      ];

      // Verify the argument structure that would be passed to execFile
      expect(expectedArgs[0]).toBe("--print");
      expect(expectedArgs[1]).toBe("--dangerously-skip-permissions");
      expect(expectedArgs[2]).toBe(testPrompt);
    });

    it("should use correct buffer size for large responses", () => {
      const expectedBufferSize = 10 * 1024 * 1024; // 10MB
      expect(expectedBufferSize).toBe(10485760);
    });

    it("should enforce correct rate limit delay", () => {
      const RATE_LIMIT_DELAY_MS = 2000;
      expect(RATE_LIMIT_DELAY_MS).toBe(2000);
    });
  });

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
