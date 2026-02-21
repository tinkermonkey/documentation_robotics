/**
 * Integration tests for audit diff command
 *
 * Tests argument parsing, error handling, and output formatting for:
 * - Explicit snapshot ID/timestamp loading
 * - Auto-detection of latest two snapshots
 * - Different output formats (text, json, markdown)
 * - File output vs stdout
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { auditDiffCommand } from "../../src/commands/audit-diff.js";
import { SnapshotStorage } from "../../src/audit/snapshot-storage.js";
import { auditCommand } from "../../src/commands/audit.js";
import { fileExists, readFile } from "../../src/utils/file-io.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import path from "path";
import { unlinkSync } from "node:fs";

describe("audit diff command", () => {
  let workdir: Awaited<ReturnType<typeof createTestWorkdir>>;

  beforeEach(async () => {
    workdir = await createTestWorkdir();
  });

  afterEach(async () => {
    await workdir.cleanup();
  });

  describe("argument parsing and error handling", () => {
    it("should require snapshots to be available", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        let errorThrown = false;
        try {
          // Try to diff without any snapshots
          await auditDiffCommand({});
        } catch (error) {
          errorThrown = true;
          expect(error).toBeDefined();
          expect((error as Error).message).toContain(
            "Not enough snapshots available"
          );
        }

        expect(errorThrown).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should handle invalid snapshot ID with descriptive error", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        let errorThrown = false;
        try {
          await auditDiffCommand({
            before: "nonexistent-id",
            after: "also-nonexistent",
          });
        } catch (error) {
          errorThrown = true;
          expect(error).toBeDefined();
          // Error should include the snapshot ID that failed
          const message = (error as Error).message;
          expect(
            message.includes("Snapshot not found") ||
            message.includes("Failed to parse")
          ).toBe(true);
        }

        expect(errorThrown).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should accept before/after snapshot IDs as arguments", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        // Create two snapshots with a delay to ensure different timestamps
        const storage = new SnapshotStorage();

        const before = await auditCommand({
          format: "json",
        });

        // Wait a moment to ensure different timestamp
        await new Promise((resolve) => setTimeout(resolve, 10));

        const after = await auditCommand({
          format: "json",
        });

        const snapshots = await storage.list();
        expect(snapshots.length).toBeGreaterThanOrEqual(2);

        // Now run diff with explicit snapshot IDs
        const logs: string[] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => {
          logs.push(args.join(" "));
        };

        try {
          await auditDiffCommand({
            before: snapshots[1].id,
            after: snapshots[0].id,
          });

          const output = logs.join("\n");
          // Should produce differential output
          expect(output.length).toBeGreaterThan(0);
        } finally {
          console.log = originalLog;
        }
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe("output formatting", () => {
    beforeEach(async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        // Create snapshots for testing
        await auditCommand({ format: "json" });
        await new Promise((resolve) => setTimeout(resolve, 10));
        await auditCommand({ format: "json" });
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should output text format by default to stdout", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        const logs: string[] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => {
          logs.push(args.join(" "));
        };

        try {
          await auditDiffCommand({});

          const output = logs.join("\n");
          // Text output should have readable content
          expect(output.length).toBeGreaterThan(0);
          expect(output).not.toContain("```json");
        } finally {
          console.log = originalLog;
        }
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should generate JSON diff output", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        const outputPath = path.join(workdir.path, "diff-output.json");

        await auditDiffCommand({
          output: outputPath,
          format: "json",
        });

        expect(await fileExists(outputPath)).toBe(true);

        const content = await readFile(outputPath);
        const parsed = JSON.parse(content);

        // Verify differential analysis structure
        expect(parsed).toHaveProperty("summary");
        expect(parsed).toHaveProperty("detailed");

        unlinkSync(outputPath);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should generate Markdown diff output", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        const outputPath = path.join(workdir.path, "diff-output.md");

        await auditDiffCommand({
          output: outputPath,
          format: "markdown",
        });

        expect(await fileExists(outputPath)).toBe(true);

        const content = await readFile(outputPath);

        // Verify markdown structure
        expect(content).toContain("#");
        expect(content.length).toBeGreaterThan(0);

        unlinkSync(outputPath);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should auto-detect format from file extension", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        // Test with .json extension without explicit format
        const jsonPath = path.join(workdir.path, "diff.json");
        await auditDiffCommand({
          output: jsonPath,
          // No format specified - should detect from .json extension
        });

        expect(await fileExists(jsonPath)).toBe(true);
        const jsonContent = await readFile(jsonPath);
        const parsed = JSON.parse(jsonContent); // Should parse as valid JSON
        expect(parsed).toBeDefined();

        unlinkSync(jsonPath);

        // Test with .md extension without explicit format
        const mdPath = path.join(workdir.path, "diff.md");
        await auditDiffCommand({
          output: mdPath,
          // No format specified - should detect from .md extension
        });

        expect(await fileExists(mdPath)).toBe(true);
        const mdContent = await readFile(mdPath);
        expect(mdContent.length).toBeGreaterThan(0);

        unlinkSync(mdPath);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe("debug mode", () => {
    it("should output debug information when debug flag is set", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        // Create snapshots
        await auditCommand({ format: "json" });
        await new Promise((resolve) => setTimeout(resolve, 10));
        await auditCommand({ format: "json" });

        const logs: string[] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => {
          logs.push(args.join(" "));
        };

        try {
          await auditDiffCommand({
            debug: true,
          });

          const output = logs.join("\n");
          // Debug output should include loading messages
          expect(output).toMatch(/Loading|analysis/i);
        } finally {
          console.log = originalLog;
        }
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
