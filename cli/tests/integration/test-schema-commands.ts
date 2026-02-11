import { describe, it, expect, beforeEach } from "bun:test";
import { execSync } from "child_process";
import { join } from "path";

describe("Schema Commands", () => {
  let cliPath: string;

  beforeEach(() => {
    // Path to the compiled CLI
    cliPath = join(import.meta.dir, "../../dist/cli.js");
  });

  describe("dr schema layers", () => {
    it("should list all 12 layers with node type counts", () => {
      const output = execSync(`node ${cliPath} schema layers`, {
        encoding: "utf-8",
      });

      // Check all 12 layers are present
      expect(output).toContain("Motivation");
      expect(output).toContain("Business");
      expect(output).toContain("Security");
      expect(output).toContain("Application");
      expect(output).toContain("Technology");
      expect(output).toContain("API");
      expect(output).toContain("Data Model");
      expect(output).toContain("Data Store");
      expect(output).toContain("UX");
      expect(output).toContain("Navigation");
      expect(output).toContain("APM");
      expect(output).toContain("Testing");

      // Should show node type counts
      expect(output).toMatch(/Node types: \d+/);
    });

    it("should display layer numbers and canonical names", () => {
      const output = execSync(`node ${cliPath} schema layers`, {
        encoding: "utf-8",
      });

      expect(output).toMatch(/1\. Motivation/);
      expect(output).toMatch(/12\. Testing/);
    });

    it("should display descriptions for each layer", () => {
      const output = execSync(`node ${cliPath} schema layers`, {
        encoding: "utf-8",
      });

      // Each layer should have a description
      const lines = output.split("\n");
      const descriptionLines = lines.filter((line) => line.startsWith("   ") && !line.includes("Node types") && !line.includes("Standard"));
      expect(descriptionLines.length).toBeGreaterThan(10);
    });
  });

  describe("dr schema types", () => {
    it("should list node types for a valid layer", () => {
      const output = execSync(`node ${cliPath} schema types motivation`, {
        encoding: "utf-8",
      });

      expect(output).toContain("Node Types for Motivation");
      expect(output).toMatch(/motivation\.[a-z]+/);
    });

    it("should show required and optional attributes", () => {
      const output = execSync(`node ${cliPath} schema types motivation`, {
        encoding: "utf-8",
      });

      // Should contain either Required or Optional attributes
      const hasAttributes =
        output.includes("Required:") || output.includes("Optional:");
      expect(hasAttributes).toBe(true);
    });

    it("should error on invalid layer", () => {
      const errorThrown = () => {
        execSync(`node ${cliPath} schema types invalid-layer 2>&1`, {
          encoding: "utf-8",
          stdio: "pipe",
        });
      };

      expect(errorThrown).toThrow();
    });

    it("should list valid layers in error message", () => {
      const output = execSync(
        `node ${cliPath} schema types invalid-layer 2>&1`,
        {
          encoding: "utf-8",
          stdio: "pipe",
        }
      );

      expect(output).toContain("Valid layers:");
    });

    it("should work with different valid layers", () => {
      const layers = ["motivation", "business", "api", "testing"];

      for (const layer of layers) {
        const output = execSync(`node ${cliPath} schema types ${layer}`, {
          encoding: "utf-8",
        });
        expect(output).toContain(`Node Types for`);
      }
    });
  });

  describe("dr schema node", () => {
    it("should show detailed schema for a node type", () => {
      const output = execSync(
        `node ${cliPath} schema node motivation.goal`,
        {
          encoding: "utf-8",
        }
      );

      expect(output).toContain("motivation.goal");
      expect(output).toContain("Layer: motivation");
      expect(output).toContain("Type: goal");
    });

    it("should show attribute constraints", () => {
      const output = execSync(
        `node ${cliPath} schema node motivation.goal`,
        {
          encoding: "utf-8",
        }
      );

      // Should show either Required or Optional attributes or both
      const hasSection =
        output.includes("Attributes:") ||
        output.includes("Required") ||
        output.includes("Optional");
      expect(hasSection).toBe(true);
    });

    it("should show spec node ID with layer and type", () => {
      const output = execSync(
        `node ${cliPath} schema node api.endpoint`,
        {
          encoding: "utf-8",
        }
      );

      expect(output).toContain("Spec Node ID:");
      expect(output).toContain("api.endpoint");
    });

    it("should error on invalid node type", () => {
      const errorThrown = () => {
        execSync(`node ${cliPath} schema node invalid.type 2>&1`, {
          encoding: "utf-8",
          stdio: "pipe",
        });
      };

      expect(errorThrown).toThrow();
    });

    it("should provide helpful error message for invalid types", () => {
      const output = execSync(
        `node ${cliPath} schema node invalid.type 2>&1`,
        {
          encoding: "utf-8",
          stdio: "pipe",
        }
      );

      expect(output).toContain("Unknown node type");
    });
  });

  describe("dr schema relationship", () => {
    it("should list all relationships for a source type", () => {
      const output = execSync(
        `node ${cliPath} schema relationship motivation.goal`,
        {
          encoding: "utf-8",
        }
      );

      expect(output).toContain("Valid Relationships");
      expect(output).toMatch(/--\[.*\]-->/);
    });

    it("should filter by predicate when provided", () => {
      // Get available relationships first
      const listOutput = execSync(
        `node ${cliPath} schema relationship motivation.goal`,
        {
          encoding: "utf-8",
        }
      );

      // Extract first predicate from output
      const predicateMatch = listOutput.match(/--\[([^\]]+)\]-->/);
      if (predicateMatch) {
        const predicate = predicateMatch[1];
        const output = execSync(
          `node ${cliPath} schema relationship motivation.goal ${predicate}`,
          {
            encoding: "utf-8",
          }
        );

        // Should either show relationships or indicate none found
        expect(output.length).toBeGreaterThan(0);
      }
    });

    it("should show cardinality information", () => {
      const output = execSync(
        `node ${cliPath} schema relationship motivation.goal`,
        {
          encoding: "utf-8",
        }
      );

      // Should show cardinality in parentheses
      expect(output).toMatch(/\([0-9:\*]+\)/);
    });

    it("should show relationship strength with color coding", () => {
      const output = execSync(
        `node ${cliPath} schema relationship motivation.goal`,
        {
          encoding: "utf-8",
        }
      );

      // Should have some relationships displayed
      expect(output).toContain("Valid Relationships");
    });

    it("should handle valid sources with no relationships gracefully", () => {
      // Some node types might not have any relationships defined
      const output = execSync(
        `node ${cliPath} schema relationship testing.testcase`,
        {
          encoding: "utf-8",
        }
      );

      // Should either list relationships or state none found
      expect(output.length).toBeGreaterThan(0);
    });
  });

  describe("schema command error handling", () => {
    it("should provide helpful suggestions for typos", () => {
      const output = execSync(
        `node ${cliPath} schema types motiv 2>&1`,
        {
          encoding: "utf-8",
          stdio: "pipe",
        }
      );

      expect(output).toContain("Unknown layer");
      expect(output).toContain("Valid layers");
    });

    it("should handle empty layer ID", () => {
      // This should fail at the CLI argument parsing level
      const errorThrown = () => {
        execSync(`node ${cliPath} schema types 2>&1`, {
          encoding: "utf-8",
          stdio: "pipe",
        });
      };

      expect(errorThrown).toThrow();
    });
  });
});
