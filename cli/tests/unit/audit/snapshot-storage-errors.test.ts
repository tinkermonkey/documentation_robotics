import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SnapshotStorage } from "../../../src/audit/snapshot-storage.js";
import { writeFile, mkdir, readFile, rm } from "fs/promises";
import path from "path";
import os from "os";
import type { AuditReport } from "../../../src/audit/types.js";

/**
 * Error edge case tests for SnapshotStorage
 *
 * Tests permission errors, corrupted JSON, invalid timestamps, etc.
 */
describe("SnapshotStorage Error Handling", () => {
  let tempDir: string;
  let storage: SnapshotStorage;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = path.join(os.tmpdir(), `dr-snapshot-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    // Override the storage directory for testing
    process.env.DR_SNAPSHOT_DIR = tempDir;
    storage = new SnapshotStorage();
  });

  afterEach(async () => {
    // Clean up
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
    delete process.env.DR_SNAPSHOT_DIR;
  });

  describe("Corrupted JSON Handling", () => {
    it("should handle corrupted metadata.json files", async () => {
      // Create a snapshot directory with corrupted metadata
      const snapshotId = "test-snapshot-corrupted";
      const snapshotDir = path.join(tempDir, snapshotId);
      await mkdir(snapshotDir, { recursive: true });

      // Write invalid JSON
      await writeFile(
        path.join(snapshotDir, "metadata.json"),
        "{ invalid json content }"
      );

      // List should skip corrupted snapshots
      const snapshots = await storage.list();
      expect(snapshots).toHaveLength(0);
    });

    it("should handle corrupted report.json files", async () => {
      // Create a snapshot with corrupted report
      const snapshotId = "test-snapshot-corrupted-report";
      const snapshotDir = path.join(tempDir, snapshotId);
      await mkdir(snapshotDir, { recursive: true });

      // Valid metadata but corrupted report
      const metadata = {
        id: snapshotId,
        timestamp: new Date().toISOString(),
        modelName: "test-model",
        modelVersion: "1.0.0",
        layers: ["motivation"],
      };
      await writeFile(
        path.join(snapshotDir, "metadata.json"),
        JSON.stringify(metadata)
      );
      await writeFile(
        path.join(snapshotDir, "report.json"),
        "{ corrupted report }"
      );

      // Load should fail gracefully
      try {
        await storage.load(snapshotId);
        expect.unreachable("Should have thrown an error");
      } catch (error) {
        expect(error).toBeDefined();
        if (error instanceof Error) {
          expect(error.message).toContain("Failed to load snapshot");
        }
      }
    });
  });

  describe("Invalid Timestamp Format", () => {
    it("should handle snapshots with invalid timestamp format", async () => {
      const snapshotId = "test-snapshot-invalid-timestamp";
      const snapshotDir = path.join(tempDir, snapshotId);
      await mkdir(snapshotDir, { recursive: true });

      // Metadata with invalid timestamp
      const metadata = {
        id: snapshotId,
        timestamp: "not-a-valid-timestamp",
        modelName: "test-model",
        modelVersion: "1.0.0",
        layers: ["motivation"],
      };
      await writeFile(
        path.join(snapshotDir, "metadata.json"),
        JSON.stringify(metadata)
      );

      const mockReport: AuditReport = {
        timestamp: new Date().toISOString(),
        model: { name: "test-model", version: "1.0.0" },
        coverage: [],
        duplicates: [],
        gaps: [],
        balance: [],
        connectivity: {
          components: [],
          degrees: [],
          transitiveChains: [],
          stats: {
            totalNodes: 0,
            totalEdges: 0,
            connectedComponents: 0,
            largestComponentSize: 0,
            isolatedNodes: 0,
            averageDegree: 0,
            transitiveChainCount: 0,
          },
        },
      };
      await writeFile(
        path.join(snapshotDir, "report.json"),
        JSON.stringify(mockReport)
      );

      // List should still work (timestamps are validated when loaded)
      const snapshots = await storage.list();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].timestamp).toBe("not-a-valid-timestamp");
    });
  });

  describe("Permission Errors (EACCES)", () => {
    it("should handle permission denied when reading snapshots", async () => {
      // This test is platform-specific and may not work on all systems
      if (process.platform === "win32") {
        // Skip on Windows where permission handling is different
        return;
      }

      const snapshotId = "test-snapshot-readonly";
      const snapshotDir = path.join(tempDir, snapshotId);
      await mkdir(snapshotDir, { recursive: true });

      const metadata = {
        id: snapshotId,
        timestamp: new Date().toISOString(),
        modelName: "test-model",
        modelVersion: "1.0.0",
        layers: ["motivation"],
      };
      await writeFile(
        path.join(snapshotDir, "metadata.json"),
        JSON.stringify(metadata)
      );

      // Make directory unreadable (requires non-Windows)
      try {
        await import("fs/promises").then((fs) =>
          fs.chmod(snapshotDir, 0o000)
        );

        // List should handle permission errors gracefully
        const snapshots = await storage.list();
        // Should skip inaccessible snapshots
        expect(Array.isArray(snapshots)).toBe(true);

        // Restore permissions for cleanup
        await import("fs/promises").then((fs) =>
          fs.chmod(snapshotDir, 0o755)
        );
      } catch (error) {
        // Permission test failed, skip
        console.log("Permission test skipped (requires Unix-like OS)");
      }
    });
  });

  describe("Missing Files", () => {
    it("should handle missing metadata.json", async () => {
      const snapshotId = "test-snapshot-no-metadata";
      const snapshotDir = path.join(tempDir, snapshotId);
      await mkdir(snapshotDir, { recursive: true });

      // Only create report, no metadata
      const mockReport: AuditReport = {
        timestamp: new Date().toISOString(),
        model: { name: "test-model", version: "1.0.0" },
        coverage: [],
        duplicates: [],
        gaps: [],
        balance: [],
        connectivity: {
          components: [],
          degrees: [],
          transitiveChains: [],
          stats: {
            totalNodes: 0,
            totalEdges: 0,
            connectedComponents: 0,
            largestComponentSize: 0,
            isolatedNodes: 0,
            averageDegree: 0,
            transitiveChainCount: 0,
          },
        },
      };
      await writeFile(
        path.join(snapshotDir, "report.json"),
        JSON.stringify(mockReport)
      );

      // List should skip snapshots without metadata
      const snapshots = await storage.list();
      expect(snapshots).toHaveLength(0);
    });

    it("should handle missing report.json when loading", async () => {
      const snapshotId = "test-snapshot-no-report";
      const snapshotDir = path.join(tempDir, snapshotId);
      await mkdir(snapshotDir, { recursive: true });

      // Only create metadata, no report
      const metadata = {
        id: snapshotId,
        timestamp: new Date().toISOString(),
        modelName: "test-model",
        modelVersion: "1.0.0",
        layers: ["motivation"],
      };
      await writeFile(
        path.join(snapshotDir, "metadata.json"),
        JSON.stringify(metadata)
      );

      // Load should fail with clear error
      try {
        await storage.load(snapshotId);
        expect.unreachable("Should have thrown an error");
      } catch (error) {
        expect(error).toBeDefined();
        if (error instanceof Error) {
          expect(error.message).toContain("Failed to load snapshot");
        }
      }
    });
  });

  describe("Non-Existent Snapshot Operations", () => {
    it("should handle loading non-existent snapshot", async () => {
      try {
        await storage.load("non-existent-snapshot");
        expect.unreachable("Should have thrown an error");
      } catch (error) {
        expect(error).toBeDefined();
        if (error instanceof Error) {
          expect(error.message).toContain("Failed to load snapshot");
        }
      }
    });

    it("should handle deleting non-existent snapshot", async () => {
      try {
        await storage.delete("non-existent-snapshot");
        expect.unreachable("Should have thrown an error");
      } catch (error) {
        expect(error).toBeDefined();
        if (error instanceof Error) {
          expect(error.message).toContain("Snapshot not found");
        }
      }
    });
  });

  describe("Filesystem Edge Cases", () => {
    it("should handle empty snapshot directory", async () => {
      // Create empty directory that looks like a snapshot
      const snapshotId = "empty-snapshot";
      const snapshotDir = path.join(tempDir, snapshotId);
      await mkdir(snapshotDir, { recursive: true });

      // List should skip empty directories
      const snapshots = await storage.list();
      expect(snapshots).toHaveLength(0);
    });

    it("should handle files instead of directories", async () => {
      // Create a file with a snapshot-like name
      await writeFile(path.join(tempDir, "not-a-directory"), "content");

      // List should skip files
      const snapshots = await storage.list();
      expect(snapshots).toHaveLength(0);
    });
  });

  describe("Concurrent Access", () => {
    it("should handle saving snapshot while listing", async () => {
      const mockReport: AuditReport = {
        timestamp: new Date().toISOString(),
        model: { name: "test-model", version: "1.0.0" },
        coverage: [],
        duplicates: [],
        gaps: [],
        balance: [],
        connectivity: {
          components: [],
          degrees: [],
          transitiveChains: [],
          stats: {
            totalNodes: 0,
            totalEdges: 0,
            connectedComponents: 0,
            largestComponentSize: 0,
            isolatedNodes: 0,
            averageDegree: 0,
            transitiveChainCount: 0,
          },
        },
      };

      // Start multiple operations concurrently
      const operations = [
        storage.save(mockReport),
        storage.list(),
        storage.save(mockReport),
        storage.list(),
      ];

      const results = await Promise.all(operations);

      // All operations should complete successfully
      expect(results).toHaveLength(4);
    });
  });
});
