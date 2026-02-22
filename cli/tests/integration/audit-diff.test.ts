/**
 * Integration tests for audit diff command
 *
 * Tests error handling and argument parsing for the audit diff command.
 * For comprehensive differential analysis testing, see audit-differential.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { auditDiffCommand } from "../../src/commands/audit-diff.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";

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
          // Error should indicate snapshot was not found or is invalid
          const message = (error as Error).message;
          expect(message).toMatch(/nonexistent|not found|invalid|Invalid Date/i);
        }

        expect(errorThrown).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
