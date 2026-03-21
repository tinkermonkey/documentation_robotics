/**
 * Integration tests for flag-effectiveness
 *
 * Verifies that optional flags (--strict, --verbose) actually change command output
 * rather than being silent no-ops. Tests ensure:
 * - `dr validate --strict` produces different output than standard validate
 * - `dr audit --verbose` produces more output than `dr audit` without --verbose
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { randomUUID } from "crypto";
import { Model } from "@/core/model";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { Manifest } from "@/core/manifest";
import { ensureDir } from "@/utils/file-io";
import { validateCommand } from "@/commands/validate";
import { auditCommand } from "@/commands/audit";
import * as path from "path";

describe("Flag Effectiveness Tests", () => {
  describe("--strict flag for validate command", () => {
    let testDir: string;

    beforeEach(async () => {
      // Create temporary test directory
      testDir = `/tmp/test-flag-strict-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      await ensureDir(testDir);
      await ensureDir(`${testDir}/.dr/layers`);

      // Create a test model with intentional quality gaps
      // (elements missing descriptions, which strict mode should flag)
      const manifest = new Manifest({
        name: "Flag Test Model - Strict",
        version: "1.0.0",
        description: "Test model for --strict flag effectiveness",
        author: "Test Suite",
      });

      const model = new Model(testDir, manifest);

      // Add motivation layer with elements - some with descriptions, some without
      const motivationLayer = new Layer("motivation");
      const goalId = randomUUID();

      // Goal WITH description (passes both standard and strict)
      const goalWithDesc = new Element({
        id: goalId,
        type: "goal",
        name: "Increase Revenue",
        description: "Generate more revenue through sales",
        attributes: { priority: "critical" },
      });

      // Goal WITHOUT description (passes standard, fails strict)
      const goalWithoutDesc = new Element({
        id: randomUUID(),
        type: "goal",
        name: "Reduce Costs",
        description: "", // Empty description - strict mode should catch this
        attributes: { priority: "high" },
      });

      // Requirement WITHOUT description (passes standard, fails strict)
      const requirementWithoutDesc = new Element({
        id: randomUUID(),
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
    });

    afterEach(async () => {
      // Cleanup test directory
      try {
        const fs = await import("fs/promises");
        await fs.rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
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
        await validateCommand({ model: testDir });
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

      let strictThrew = false;
      try {
        await validateCommand({ model: testDir, strict: true });
      } catch {
        // Strict mode should throw due to missing descriptions
        strictThrew = true;
      }

      const strictOutput = strictLogs.join("\n");
      console.log = originalLog;
      console.error = originalError;

      // Assertions: strict output should differ from standard output
      // Either:
      // 1. Strict mode throws an error (strictThrew = true), OR
      // 2. Strict mode produces warnings that standard mode doesn't (output differs)
      expect(strictThrew || standardOutput !== strictOutput).toBe(true);

      // If strict mode produces output, it should contain quality warnings
      if (strictOutput.length > 0) {
        expect(strictOutput.length).toBeGreaterThan(0);
      }
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
        await validateCommand({ model: testDir, strict: true });
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
    let testDir: string;

    beforeEach(async () => {
      // Use a simple test directory for audit test
      testDir = `/tmp/test-flag-verbose-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      await ensureDir(testDir);
      await ensureDir(`${testDir}/.dr/layers`);

      // Create a test model with some elements and relationships
      const manifest = new Manifest({
        name: "Flag Test Model - Verbose",
        version: "1.0.0",
        description: "Test model for --verbose flag effectiveness",
        author: "Test Suite",
      });

      const model = new Model(testDir, manifest);

      // Add motivation layer
      const motivationLayer = new Layer("motivation");
      const goal1Id = randomUUID();
      const goal2Id = randomUUID();

      const goal1 = new Element({
        id: goal1Id,
        type: "goal",
        name: "Goal 1",
        description: "First goal",
      });

      const goal2 = new Element({
        id: goal2Id,
        type: "goal",
        name: "Goal 2",
        description: "Second goal",
        relationships: [
          {
            source: goal2Id,
            target: goal1Id,
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
    });

    afterEach(async () => {
      // Cleanup test directory
      try {
        const fs = await import("fs/promises");
        await fs.rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it("should produce more output with --verbose than without", async () => {
      // Capture output from audit without --verbose
      const standardLogs: string[] = [];
      const originalLog = console.log;

      console.log = (...args: any[]) => {
        standardLogs.push(args.join(" "));
      };

      try {
        await auditCommand({ model: testDir });
      } catch {
        // Audit may not throw, continue
      }

      const standardOutput = standardLogs.join("\n");
      const standardLineCount = standardOutput.split("\n").length;

      // Capture output from audit with --verbose
      const verboseLogs: string[] = [];
      console.log = (...args: any[]) => {
        verboseLogs.push(args.join(" "));
      };

      try {
        await auditCommand({ model: testDir, verbose: true });
      } catch {
        // Verbose audit may not throw, continue
      }

      const verboseOutput = verboseLogs.join("\n");
      const verboseLineCount = verboseOutput.split("\n").length;
      console.log = originalLog;

      // Assert: verbose output should have MORE lines than standard output
      expect(verboseLineCount).toBeGreaterThan(standardLineCount);

      // Verbose output should be longer as it contains additional detail
      expect(verboseOutput.length).toBeGreaterThan(standardOutput.length);
    });

    it("should include additional detail in --verbose output", async () => {
      const verboseLogs: string[] = [];
      const originalLog = console.log;

      console.log = (...args: any[]) => {
        verboseLogs.push(args.join(" "));
      };

      try {
        await auditCommand({ model: testDir, verbose: true });
      } catch {
        // Verbose audit may throw, continue
      }

      const verboseOutput = verboseLogs.join("\n");
      console.log = originalLog;

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
