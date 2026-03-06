import { describe, it, expect } from "bun:test";
import { Changeset, migrateChangesetStatus, type ChangesetStatus } from "../../../src/core/changeset.js";
import { Manifest } from "../../../src/core/manifest.js";

describe("Changeset Status Migration", () => {
  describe("migrateChangesetStatus utility function", () => {
    it("should migrate legacy 'draft' status to 'staged'", () => {
      expect(migrateChangesetStatus("draft")).toBe("staged");
    });

    it("should migrate legacy 'applied' status to 'committed'", () => {
      expect(migrateChangesetStatus("applied")).toBe("committed");
    });

    it("should migrate legacy 'reverted' status to 'discarded'", () => {
      expect(migrateChangesetStatus("reverted")).toBe("discarded");
    });

    it("should pass through current 'staged' status", () => {
      expect(migrateChangesetStatus("staged")).toBe("staged");
    });

    it("should pass through current 'committed' status", () => {
      expect(migrateChangesetStatus("committed")).toBe("committed");
    });

    it("should pass through current 'discarded' status", () => {
      expect(migrateChangesetStatus("discarded")).toBe("discarded");
    });

    it("should default to 'staged' for undefined", () => {
      expect(migrateChangesetStatus(undefined)).toBe("staged");
    });

    it("should default to 'staged' for null", () => {
      expect(migrateChangesetStatus(null)).toBe("staged");
    });

    it("should default to 'staged' for non-string types", () => {
      expect(migrateChangesetStatus(42)).toBe("staged");
      expect(migrateChangesetStatus(true)).toBe("staged");
      expect(migrateChangesetStatus({})).toBe("staged");
    });

    it("should throw error for unrecognized status strings", () => {
      expect(() => migrateChangesetStatus("invalid")).toThrow();
      expect(() => migrateChangesetStatus("pending")).toThrow();
      expect(() => migrateChangesetStatus("archived")).toThrow();
    });

    it("should throw error containing helpful guidance", () => {
      expect(() => migrateChangesetStatus("unknown")).toThrow(
        /Expected: staged, committed, or discarded/
      );
    });
  });

  describe("StagedChangesetStorage.load() status migration", () => {
    // These tests are integration tests in changeset-storage-location.test.ts
    // They verify that legacy YAML files with old status values are properly migrated
    // when loaded from disk through StagedChangesetStorage
  });
});

describe("Changeset History Migration", () => {
  describe("Manifest.migrateChangesetHistory", () => {
    it("should migrate legacy applied_at field to committed_at", () => {
      const manifest = new Manifest({
        name: "Test",
        version: "1.0.0",
        changeset_history: [
          {
            name: "test-changeset",
            committed_at: undefined as any,
            applied_at: "2024-01-01T00:00:00Z",
            action: "committed",
          } as any,
        ],
      });

      expect(manifest.changeset_history).toHaveLength(1);
      expect(manifest.changeset_history![0].committed_at).toBe("2024-01-01T00:00:00Z");
    });

    it("should prefer committed_at over applied_at when both present", () => {
      const manifest = new Manifest({
        name: "Test",
        version: "1.0.0",
        changeset_history: [
          {
            name: "test-changeset",
            committed_at: "2024-02-01T00:00:00Z",
            applied_at: "2024-01-01T00:00:00Z",
            action: "committed",
          } as any,
        ],
      });

      expect(manifest.changeset_history![0].committed_at).toBe("2024-02-01T00:00:00Z");
    });

    it("should generate fallback timestamp if both committed_at and applied_at missing", () => {
      const beforeCall = new Date().toISOString();
      const manifest = new Manifest({
        name: "Test",
        version: "1.0.0",
        changeset_history: [
          {
            name: "test-changeset",
            action: "committed",
          } as any,
        ],
      });
      const afterCall = new Date().toISOString();

      const committedAt = manifest.changeset_history![0].committed_at;
      expect(committedAt).toBeDefined();
      // Verify it's a reasonable timestamp (between before and after call)
      expect(committedAt >= beforeCall).toBe(true);
      expect(committedAt <= afterCall).toBe(true);
    });

    it("should migrate legacy 'applied' action to 'committed'", () => {
      const manifest = new Manifest({
        name: "Test",
        version: "1.0.0",
        changeset_history: [
          {
            name: "test-changeset",
            committed_at: "2024-01-01T00:00:00Z",
            action: "applied",
          } as any,
        ],
      });

      expect(manifest.changeset_history![0].action).toBe("committed");
    });

    it("should migrate legacy 'reverted' action to 'discarded'", () => {
      const manifest = new Manifest({
        name: "Test",
        version: "1.0.0",
        changeset_history: [
          {
            name: "test-changeset",
            committed_at: "2024-01-01T00:00:00Z",
            action: "reverted",
          } as any,
        ],
      });

      expect(manifest.changeset_history![0].action).toBe("discarded");
    });

    it("should pass through 'committed' action unchanged", () => {
      const manifest = new Manifest({
        name: "Test",
        version: "1.0.0",
        changeset_history: [
          {
            name: "test-changeset",
            committed_at: "2024-01-01T00:00:00Z",
            action: "committed",
          },
        ],
      });

      expect(manifest.changeset_history![0].action).toBe("committed");
    });

    it("should pass through 'discarded' action unchanged", () => {
      const manifest = new Manifest({
        name: "Test",
        version: "1.0.0",
        changeset_history: [
          {
            name: "test-changeset",
            committed_at: "2024-01-01T00:00:00Z",
            action: "discarded",
          },
        ],
      });

      expect(manifest.changeset_history![0].action).toBe("discarded");
    });

    it("should throw error for unrecognized action values", () => {
      expect(() => {
        new Manifest({
          name: "Test",
          version: "1.0.0",
          changeset_history: [
            {
              name: "test-changeset",
              committed_at: "2024-01-01T00:00:00Z",
              action: "invalid",
            } as any,
          ],
        });
      }).toThrow(/Invalid changeset history action/);
    });

    it("should include changeset name in error message", () => {
      expect(() => {
        new Manifest({
          name: "Test",
          version: "1.0.0",
          changeset_history: [
            {
              name: "my-changeset",
              committed_at: "2024-01-01T00:00:00Z",
              action: "unknown",
            } as any,
          ],
        });
      }).toThrow(/my-changeset/);
    });

    it("should handle empty history array", () => {
      const manifest = new Manifest({
        name: "Test",
        version: "1.0.0",
        changeset_history: [],
      });

      expect(manifest.changeset_history).toEqual([]);
    });

    it("should handle undefined history", () => {
      const manifest = new Manifest({
        name: "Test",
        version: "1.0.0",
      });

      expect(manifest.changeset_history).toEqual([]);
    });

    it("should migrate multiple history entries correctly", () => {
      const manifest = new Manifest({
        name: "Test",
        version: "1.0.0",
        changeset_history: [
          {
            name: "changeset-1",
            applied_at: "2024-01-01T00:00:00Z",
            action: "applied",
          } as any,
          {
            name: "changeset-2",
            committed_at: "2024-01-02T00:00:00Z",
            action: "reverted",
          } as any,
          {
            name: "changeset-3",
            committed_at: "2024-01-03T00:00:00Z",
            action: "committed",
          },
        ],
      });

      expect(manifest.changeset_history).toHaveLength(3);
      expect(manifest.changeset_history![0]).toEqual({
        name: "changeset-1",
        committed_at: "2024-01-01T00:00:00Z",
        action: "committed",
      });
      expect(manifest.changeset_history![1]).toEqual({
        name: "changeset-2",
        committed_at: "2024-01-02T00:00:00Z",
        action: "discarded",
      });
      expect(manifest.changeset_history![2]).toEqual({
        name: "changeset-3",
        committed_at: "2024-01-03T00:00:00Z",
        action: "committed",
      });
    });
  });
});

describe("Patch Export Attributes Handling", () => {
  // Tests for exportToPatch method checking both properties and attributes
  // These are integration tests in changeset-export-import.test.ts
  // They verify that newly created elements using 'attributes' field
  // are properly included in patch exports
});
