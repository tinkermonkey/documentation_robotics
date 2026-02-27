import { describe, it, expect } from "bun:test";
import { PromptTemplates } from "../../../../src/audit/relationships/ai/prompts.js";
import type { CoverageMetrics } from "../../../../src/audit/types.js";

describe("PromptTemplates", () => {
  const templates = new PromptTemplates();

  describe("elementEvaluation", () => {
    it("should generate element evaluation prompt with all required sections", () => {
      const nodeType = "motivation.goal.customer-satisfaction";
      const coverage: CoverageMetrics = {
        layer: "motivation",
        nodeTypeCount: 10,
        relationshipCount: 5,
        isolatedNodeTypes: [nodeType],
        isolationPercentage: 10,
        relationshipsPerNodeType: 0.5,
      };
      const predicates = ["realizes", "influences", "triggers"];

      const prompt = templates.elementEvaluation(nodeType, coverage, predicates);

      // Check for essential sections
      expect(prompt).toContain("motivation.goal.customer-satisfaction");
      expect(prompt).toContain("Layer: motivation");
      expect(prompt).toContain("Node Type: goal");
      expect(prompt).toContain("Current Relationships: 0.5");
      expect(prompt).toContain("ArchiMate 3.2");
      expect(prompt).toContain("Available Predicates:");
      expect(prompt).toContain("- realizes:");
      expect(prompt).toContain("- influences:");
      expect(prompt).toContain("- triggers:");
      expect(prompt).toContain("Format as JSON array");
    });

    it("should include predicate definitions in prompt", () => {
      const nodeType = "api.endpoint.create-order";
      const coverage: CoverageMetrics = {
        layer: "api",
        nodeTypeCount: 20,
        relationshipCount: 15,
        isolatedNodeTypes: [],
        isolationPercentage: 0,
        relationshipsPerNodeType: 0.75,
      };
      const predicates = ["accesses", "triggers"];

      const prompt = templates.elementEvaluation(nodeType, coverage, predicates);

      expect(prompt).toContain("- accesses:");
      expect(prompt).toContain("- triggers:");
      expect(prompt).toContain("OpenAPI 3.0");
    });
  });

  describe("layerReview", () => {
    it("should generate layer review prompt with metrics and standard", () => {
      const coverage: CoverageMetrics[] = [
        {
          layer: "security",
          nodeTypeCount: 66,
          relationshipCount: 0,
          isolatedNodeTypes: [],
          isolationPercentage: 100,
          relationshipsPerNodeType: 0,
        },
      ];

      const prompt = templates.layerReview("security", coverage);

      expect(prompt).toContain("Review the security layer");
      expect(prompt).toContain("Node Types: 66");
      expect(prompt).toContain("Current Relationships: 0");
      expect(prompt).toContain("Isolation: 100%");
      expect(prompt).toContain("Density: 0 per node type");
      expect(prompt).toContain("NIST SP 800-53");
      expect(prompt).toContain("Semantic coherence");
      expect(prompt).toContain("Missing critical relationship patterns");
      expect(prompt).toContain("Balance assessment");
    });

    it("should throw error for missing layer metrics", () => {
      const coverage: CoverageMetrics[] = [
        {
          layer: "motivation",
          nodeTypeCount: 10,
          relationshipCount: 5,
          isolatedNodeTypes: [],
          isolationPercentage: 10,
          relationshipsPerNodeType: 0.5,
        },
      ];

      expect(() => templates.layerReview("nonexistent", coverage)).toThrow(
        "No coverage metrics found for layer: nonexistent"
      );
    });
  });

  describe("interLayerValidation", () => {
    it("should generate inter-layer validation prompt", () => {
      const prompt = templates.interLayerValidation("application", "technology");

      expect(prompt).toContain("Validate cross-layer relationships");
      expect(prompt).toContain("from application to technology");
      expect(prompt).toContain("Higher layers → lower layers only");
      expect(prompt).toContain("No circular dependencies");
      expect(prompt).toContain("sourceLayer");
      expect(prompt).toContain("targetLayer");
      expect(prompt).toContain("issue");
    });
  });

  describe("getLayerStandard", () => {
    it("should return correct standard for ArchiMate layers", () => {
      expect(templates.getLayerStandard("motivation")).toBe("ArchiMate 3.2");
      expect(templates.getLayerStandard("business")).toBe("ArchiMate 3.2");
      expect(templates.getLayerStandard("application")).toBe("ArchiMate 3.2");
      expect(templates.getLayerStandard("technology")).toBe("ArchiMate 3.2");
    });

    it("should return correct standard for API layer", () => {
      expect(templates.getLayerStandard("api")).toBe("OpenAPI 3.0");
    });

    it("should return correct standard for data-model layer", () => {
      expect(templates.getLayerStandard("data-model")).toBe("JSON Schema Draft 7");
    });

    it("should return correct standard for security layer", () => {
      expect(templates.getLayerStandard("security")).toBe("NIST SP 800-53");
    });

    it("should return default for unknown layer", () => {
      expect(templates.getLayerStandard("unknown")).toBe(
        "Architecture best practices"
      );
    });
  });
});
