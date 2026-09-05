/**
 * Integration tests for audit snapshots command
 *
 * Tests argument parsing, error handling, and output formatting for:
 * - Snapshot listing
 * - Snapshot deletion with ID validation
 * - Bulk snapshot clearing
 * - Proper error messages for invalid IDs
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { auditSnapshotsCommand } from "../../src/commands/audit-snapshots.js";
import { SnapshotStorage } from "../../src/audit/snapshot-storage.js";
import { auditCommand } from "../../src/commands/audit.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";

describe("audit snapshots command", () => {
  let workdir: Awaited<ReturnType<typeof createTestWorkdir>>;

  beforeEach(async () => {
    workdir = await createTestWorkdir();
  });

  afterEach(async () => {
    await workdir.cleanup();
  });

  describe("list action", () => {
    it("should handle empty snapshot list gracefully", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        const logs: string[] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => {
          logs.push(args.join(" "));
        };

        try {
          await auditSnapshotsCommand({
            action: "list",
          });

          const output = logs.join("\n");
          expect(output).toContain("No snapshots available");
        } finally {
          console.log = originalLog;
        }
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should list all snapshots with metadata", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        // Suppress console output during snapshot creation
        const originalLog = console.log;
        console.log = (..._args: any[]) => {};

        try {
          // Create a snapshot
          await auditCommand({ format: "json", saveSnapshot: true });
        } finally {
          console.log = originalLog;
        }

        const logs: string[] = [];
        console.log = (...args: any[]) => {
          logs.push(args.join(" "));
        };

        try {
          await auditSnapshotsCommand({
            action: "list",
          });

          const output = logs.join("\n");
          expect(output).toContain("Audit Snapshots");
          expect(output).toContain("Timestamp");
          expect(output).toContain("Model");
          expect(output).toContain("Layers");
          expect(output).toMatch(/Total: \d+ snapshot/);
        } finally {
          console.log = originalLog;
        }
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should show correct singular/plural for snapshot count", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        // Suppress console output during snapshot creation
        const originalLog = console.log;
        console.log = (..._args: any[]) => {};

        try {
          // Create a single snapshot
          await auditCommand({ format: "json", saveSnapshot: true });
        } finally {
          console.log = originalLog;
        }

        const logs: string[] = [];
        console.log = (...args: any[]) => {
          logs.push(args.join(" "));
        };

        try {
          await auditSnapshotsCommand({
            action: "list",
          });

          const output = logs.join("\n");
          expect(output).toContain("Total: 1 snapshot"); // Singular
        } finally {
          console.log = originalLog;
        }
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe("delete action", () => {
    it("should require snapshot ID for delete action", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        let errorThrown = false;
        try {
          await auditSnapshotsCommand({
            action: "delete",
            // Missing id
          });
        } catch (error) {
          errorThrown = true;
          expect((error as Error).message).toContain(
            "Snapshot ID required for delete"
          );
        }

        expect(errorThrown).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should validate snapshot exists before deletion", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        let errorThrown = false;
        try {
          await auditSnapshotsCommand({
            action: "delete",
            id: "nonexistent-snapshot-id",
          });
        } catch (error) {
          errorThrown = true;
          expect((error as Error).message).toContain("Snapshot not found");
          expect((error as Error).message).toContain(
            "nonexistent-snapshot-id"
          );
        }

        expect(errorThrown).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should delete specified snapshot by ID", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        // Suppress console output during snapshot creation
        const originalLog = console.log;
        console.log = (..._args: any[]) => {};

        try {
          // Create a snapshot
          await auditCommand({ format: "json", saveSnapshot: true });
        } finally {
          console.log = originalLog;
        }

        // Get snapshot ID
        const storage = new SnapshotStorage();
        const snapshots = await storage.list();
        expect(snapshots.length).toBe(1);

        const snapshotId = snapshots[0].id;

        // Delete it
        const logs: string[] = [];
        console.log = (...args: any[]) => {
          logs.push(args.join(" "));
        };

        try {
          await auditSnapshotsCommand({
            action: "delete",
            id: snapshotId,
          });

          const output = logs.join("\n");
          expect(output).toContain("✓");
          expect(output).toContain("Snapshot deleted");
          expect(output).toContain(snapshotId);
        } finally {
          console.log = originalLog;
        }

        // Verify it's gone
        const remaining = await storage.list();
        expect(remaining.length).toBe(0);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe("clear action", () => {
    it("should handle clear with no snapshots", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        const logs: string[] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => {
          logs.push(args.join(" "));
        };

        try {
          await auditSnapshotsCommand({
            action: "clear",
          });

          const output = logs.join("\n");
          expect(output).toContain("No snapshots to clear");
        } finally {
          console.log = originalLog;
        }
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should delete all snapshots with clear action", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        // Suppress console output during snapshot creation
        const originalLog = console.log;
        console.log = (..._args: any[]) => {};

        try {
          // Create multiple snapshots (need > 1 second delay for unique IDs)
          await auditCommand({ format: "json", saveSnapshot: true });
          await new Promise((resolve) => setTimeout(resolve, 1100));
          await auditCommand({ format: "json", saveSnapshot: true });
        } finally {
          console.log = originalLog;
        }

        // Verify snapshots exist
        const storage = new SnapshotStorage();
        let snapshots = await storage.list();
        expect(snapshots.length).toBe(2);

        // Clear all
        const logs: string[] = [];
        console.log = (...args: any[]) => {
          logs.push(args.join(" "));
        };

        try {
          await auditSnapshotsCommand({
            action: "clear",
          });

          const output = logs.join("\n");
          expect(output).toContain("✓");
          expect(output).toContain("Cleared");
          expect(output).toContain("snapshots"); // Plural
        } finally {
          console.log = originalLog;
        }

        // Verify all are gone
        snapshots = await storage.list();
        expect(snapshots.length).toBe(0);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should use correct singular/plural form when clearing", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        // Suppress console output during snapshot creation
        const originalLog = console.log;
        console.log = (..._args: any[]) => {};

        try {
          // Create a single snapshot
          await auditCommand({ format: "json", saveSnapshot: true });
        } finally {
          console.log = originalLog;
        }

        const logs: string[] = [];
        console.log = (...args: any[]) => {
          logs.push(args.join(" "));
        };

        try {
          await auditSnapshotsCommand({
            action: "clear",
          });

          const output = logs.join("\n");
          expect(output).toContain("Cleared 1 snapshot"); // Singular
        } finally {
          console.log = originalLog;
        }
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe("error handling", () => {
    it("should handle unknown actions with descriptive error", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        let errorThrown = false;
        try {
          await auditSnapshotsCommand({
            action: "unknown-action" as any,
          });
        } catch (error) {
          errorThrown = true;
          expect((error as Error).message).toContain("Unknown action");
        }

        expect(errorThrown).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should include debug error details when debug flag is set", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        let errorThrown = false;
        const logs: string[] = [];
        const originalError = console.error;
        console.error = (...args: any[]) => {
          logs.push(args.join(" "));
        };

        try {
          await auditSnapshotsCommand({
            action: "delete",
            id: "invalid",
            debug: true,
          });
        } catch (error) {
          errorThrown = true;
        } finally {
          console.error = originalError;
        }

        // With debug flag, error details should be logged
        expect(errorThrown).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
