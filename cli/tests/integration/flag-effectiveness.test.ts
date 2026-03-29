/**
 * Integration tests for flag-effectiveness
 *
 * Verifies that optional flags (--strict, --verbose) actually change command output
 * rather than being silent no-ops. Tests ensure:
 * - `dr validate --strict` produces different output than standard validate
 * - `dr audit --verbose` produces more output than `dr audit` without --verbose
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Model } from "@/core/model";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { validateCommand } from "@/commands/validate";
import { auditCommand } from "@/commands/audit";
import { createTestWorkdir, GOLDEN_COPY_HOOK_TIMEOUT } from "../helpers/golden-copy.js";
import path from "path";

describe("Flag Effectiveness Tests", () => {
  describe("--strict flag for validate command", () => {
    let workdir: Awaited<ReturnType<typeof createTestWorkdir>>;

    beforeEach(async () => {
      workdir = await createTestWorkdir();

      // Create a test model with intentional quality gaps
      // (elements missing descriptions, which strict mode should flag)
      const model = await Model.init(
        workdir.path,
        {
          name: "Flag Test Model - Strict",
          version: "1.0.0",
          description: "Test model for --strict flag effectiveness",
          specVersion: "0.8.3",
          created: new Date().toISOString(),
        },
        { lazyLoad: false }
      );

      // Add motivation layer with elements - some with descriptions, some without
      const motivationLayer = new Layer("motivation");

      // Goal WITH description (passes both standard and strict)
      const goalWithDesc = new Element({
        id: "motivation.goal.increase-revenue",
        spec_node_id: "motivation.goal",
        layer_id: "motivation",
        type: "goal",
        name: "Increase Revenue",
        description: "Generate more revenue through sales",
        attributes: { priority: "critical" },
      });

      // Goal WITHOUT description (passes standard, fails strict)
      const goalWithoutDesc = new Element({
        id: "motivation.goal.reduce-costs",
        spec_node_id: "motivation.goal",
        layer_id: "motivation",
        type: "goal",
        name: "Reduce Costs",
        description: "", // Empty description - strict mode should catch this
        attributes: { priority: "high" },
      });

      // Requirement WITHOUT description (passes standard, fails strict)
      const requirementWithoutDesc = new Element({
        id: "motivation.requirement.system-performance",
        spec_node_id: "motivation.requirement",
        layer_id: "motivation",
        type: "requirement",
        name: "System Performance",
        // No description field at all
      });

      motivationLayer.addElement(goalWithDesc);
      motivationLayer.addElement(goalWithoutDesc);
      motivationLayer.addElement(requirementWithoutDesc);
      model.addLayer(motivationLayer);

      // Save model to disk
      await model.saveManifest();
      await model.saveLayer("motivation");
    }, GOLDEN_COPY_HOOK_TIMEOUT);

    afterEach(async () => {
      await workdir.cleanup();
    });

    it("should produce different output between standard validate and validate --strict", async () => {
      // Capture output from standard validate
      const standardLogs: string[] = [];
      const originalLog = console.log;
      const originalError = console.error;

      console.log = (...args: any[]) => {
        standardLogs.push(args.join(" "));
      };
      console.error = (...args: any[]) => {
        standardLogs.push(args.join(" "));
      };

      try {
        await validateCommand({ model: workdir.path });
      } catch {
        // Standard validate may not throw, continue
      }

      const standardOutput = standardLogs.join("\n");

      // Capture output from strict validate
      const strictLogs: string[] = [];
      console.log = (...args: any[]) => {
        strictLogs.push(args.join(" "));
      };
      console.error = (...args: any[]) => {
        strictLogs.push(args.join(" "));
      };

      try {
        await validateCommand({ model: workdir.path, strict: true });
      } catch {
        // Strict mode may throw due to missing descriptions, continue
      }

      const strictOutput = strictLogs.join("\n");
      console.log = originalLog;
      console.error = originalError;

      // Assertions: strict mode should produce warnings about missing descriptions
      // The strict output should contain the actual warning message
      expect(strictOutput).toContain("no description");

      // Strict output should be longer/different than standard output
      expect(strictOutput.length).toBeGreaterThan(standardOutput.length);
    });

    it("should exit with error code when --strict finds quality issues", async () => {
      let errorThrown = false;
      const logs: string[] = [];
      const originalLog = console.log;
      const originalError = console.error;

      console.log = (...args: any[]) => {
        logs.push(args.join(" "));
      };
      console.error = (...args: any[]) => {
        logs.push(args.join(" "));
      };

      try {
        await validateCommand({ model: workdir.path, strict: true });
      } catch (err) {
        errorThrown = true;
      }

      console.log = originalLog;
      console.error = originalError;

      // With quality gaps present, strict mode should throw
      expect(errorThrown).toBe(true);
    });
  });

  describe("--verbose flag for audit command", () => {
    let workdir: Awaited<ReturnType<typeof createTestWorkdir>>;

    beforeEach(async () => {
      workdir = await createTestWorkdir();

      // Create a test model with some elements and relationships
      const model = await Model.init(
        workdir.path,
        {
          name: "Flag Test Model - Verbose",
          version: "1.0.0",
          description: "Test model for --verbose flag effectiveness",
          specVersion: "0.8.3",
          created: new Date().toISOString(),
        },
        { lazyLoad: false }
      );

      // Add motivation layer with elements and relationships
      const motivationLayer = new Layer("motivation");

      const goal1 = new Element({
        id: "motivation.goal.goal-1",
        spec_node_id: "motivation.goal",
        layer_id: "motivation",
        type: "goal",
        name: "Goal 1",
        description: "First goal",
      });

      const goal2 = new Element({
        id: "motivation.goal.goal-2",
        spec_node_id: "motivation.goal",
        layer_id: "motivation",
        type: "goal",
        name: "Goal 2",
        description: "Second goal",
        relationships: [
          {
            source: "motivation.goal.goal-2",
            target: "motivation.goal.goal-1",
            type: "supports",
          },
        ],
      });

      motivationLayer.addElement(goal1);
      motivationLayer.addElement(goal2);
      model.addLayer(motivationLayer);

      // Save model to disk
      await model.saveManifest();
      await model.saveLayer("motivation");
    }, GOLDEN_COPY_HOOK_TIMEOUT);

    afterEach(async () => {
      await workdir.cleanup();
    });

    it("should produce more output with --verbose than without", async () => {
      // Capture output from audit without --verbose
      const standardLogs: string[] = [];
      const originalLog = console.log;
      const originalError = console.error;

      console.log = (...args: any[]) => {
        standardLogs.push(args.join(" "));
      };
      console.error = (...args: any[]) => {
        standardLogs.push(args.join(" "));
      };

      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);
        await auditCommand({});
      } catch {
        // Audit may not throw, continue
      } finally {
        process.chdir(originalCwd);
      }

      const standardOutput = standardLogs.join("\n");
      const standardLineCount = standardOutput.split("\n").length;

      // Capture output from audit with --verbose
      const verboseLogs: string[] = [];
      console.log = (...args: any[]) => {
        verboseLogs.push(args.join(" "));
      };
      console.error = (...args: any[]) => {
        verboseLogs.push(args.join(" "));
      };

      try {
        process.chdir(workdir.path);
        await auditCommand({ verbose: true });
      } catch {
        // Verbose audit may not throw, continue
      } finally {
        process.chdir(originalCwd);
      }

      const verboseOutput = verboseLogs.join("\n");
      const verboseLineCount = verboseOutput.split("\n").length;
      console.log = originalLog;
      console.error = originalError;

      // Assert: verbose output should have MORE lines than standard output
      expect(verboseLineCount).toBeGreaterThan(standardLineCount);

      // Verbose output should be longer as it contains additional detail
      expect(verboseOutput.length).toBeGreaterThan(standardOutput.length);
    });

    it("should include additional detail in --verbose output", async () => {
      const verboseLogs: string[] = [];
      const originalLog = console.log;
      const originalError = console.error;

      console.log = (...args: any[]) => {
        verboseLogs.push(args.join(" "));
      };
      console.error = (...args: any[]) => {
        verboseLogs.push(args.join(" "));
      };

      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);
        await auditCommand({ verbose: true });
      } catch {
        // Verbose audit may throw, continue
      } finally {
        process.chdir(originalCwd);
      }

      const verboseOutput = verboseLogs.join("\n");
      console.log = originalLog;
      console.error = originalError;

      // Verbose output should contain meaningful content
      expect(verboseOutput.length).toBeGreaterThan(0);

      // Output should have detailed sections
      // The actual structure depends on audit implementation,
      // but it should have multiple lines of output
      const lineCount = verboseOutput.split("\n").filter((line) => line.trim().length > 0).length;
      expect(lineCount).toBeGreaterThan(1);
    });
  });
});
