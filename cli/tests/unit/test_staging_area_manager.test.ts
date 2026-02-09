/**
 * Unit tests for StagingAreaManager
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { StagingAreaManager } from "../../src/core/staging-area.js";
import { Model } from "../../src/core/model.js";
import path from "path";
import { rm, mkdtemp } from "fs/promises";
import { fileExists, ensureDir } from "../../src/utils/file-io.js";
import { tmpdir } from "os";

describe("StagingAreaManager", () => {
  let testDir: string;
  let manager: StagingAreaManager;
  let model: Model;

  beforeEach(async () => {
    // Create unique temporary test directory
    testDir = await mkdtemp(path.join(tmpdir(), "test-staging-"));

    // Initialize basic model structure with required files
    const modelDir = path.join(testDir, "documentation-robotics", "model");
    await ensureDir(modelDir);

    // Create manifest file in YAML format (Model.load expects YAML)
    const { writeFile } = await import("../../src/utils/file-io.js");
    const manifestPath = path.join(modelDir, "manifest.yaml");
    const manifest = `version: 0.1.0
specVersion: 0.7.1
created: ${new Date().toISOString()}
modified: ${new Date().toISOString()}
layers: {}`;
    await writeFile(manifestPath, manifest);

    // Load model with explicit path
    model = await Model.load(testDir);
    manager = new StagingAreaManager(testDir, model);
  });

  afterEach(async () => {
    // Clean up test directory
    if (await fileExists(testDir)) {
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("Changeset lifecycle", () => {
    it("should create a new changeset", async () => {
      const changeset = await manager.create("test-changeset", "Test description");

      expect(changeset).toBeDefined();
      expect(changeset.name).toBe("test-changeset");
      expect(changeset.description).toBe("Test description");
      expect(changeset.status).toBe("staged"); // Changed from 'draft' to 'staged' as changesets are now immediately ready to accept changes
      expect(changeset.changes.length).toBe(0);
      expect(changeset.id).toBeDefined();
    });

    it("should load an existing changeset by name", async () => {
      const created = await manager.create("load-test", "Load test");
      const loaded = await manager.load("load-test");

      expect(loaded).toBeDefined();
      expect(loaded?.name).toBe("load-test");
      expect(loaded?.id).toBe(created.id);
    });

    it("should load a changeset by ID", async () => {
      const created = await manager.create("by-id-test");
      const loaded = await manager.load(created.id!);

      expect(loaded).toBeDefined();
      expect(loaded?.id).toBe(created.id);
    });

    it("should list all changesets", async () => {
      await manager.create("list-test-1");
      await manager.create("list-test-2");
      await manager.create("list-test-3");

      const changesets = await manager.list();
      expect(changesets.length).toBeGreaterThanOrEqual(3);
      expect(changesets.some((cs) => cs.name === "list-test-1")).toBe(true);
      expect(changesets.some((cs) => cs.name === "list-test-2")).toBe(true);
      expect(changesets.some((cs) => cs.name === "list-test-3")).toBe(true);
    });

    it("should delete a changeset", async () => {
      const created = await manager.create("delete-test");
      await manager.delete("delete-test");

      const loaded = await manager.load("delete-test");
      expect(loaded).toBeNull();
    });

    it("should clear active changeset marker when deleting active changeset", async () => {
      const created = await manager.create("delete-active-test");
      await manager.setActive(created.id!);

      // Verify the changeset is active
      const activeBeforeDeletion = await manager.getActive();
      expect(activeBeforeDeletion).not.toBeNull();
      expect(activeBeforeDeletion?.id).toBe(created.id);

      // Delete the active changeset
      await manager.delete("delete-active-test");

      // Verify the changeset is deleted
      const loaded = await manager.load("delete-active-test");
      expect(loaded).toBeNull();

      // Verify the active marker is cleared
      const activeAfterDeletion = await manager.getActive();
      expect(activeAfterDeletion).toBeNull();
    });

    it("should return null for non-existent changeset", async () => {
      const loaded = await manager.load("nonexistent");
      expect(loaded).toBeNull();
    });
  });

  describe("Staging operations", () => {
    it("should stage an add change", async () => {
      const changeset = await manager.create("stage-add-test");
      await manager.setActive(changeset.id!);

      await manager.stage(changeset.id!, {
        type: "add",
        elementId: "test-element-1",
        layerName: "application",
        after: { id: "test-element-1", type: "component", name: "Test Component" },
      });

      const loaded = await manager.load(changeset.id!);
      expect(loaded?.changes.length).toBe(1);
      expect(loaded?.changes[0].type).toBe("add");
      expect(loaded?.changes[0].elementId).toBe("test-element-1");
      expect((loaded?.changes[0] as any).sequenceNumber).toBe(0);
    });

    it("should stage multiple changes with sequence numbers", async () => {
      const changeset = await manager.create("stage-multiple-test");
      await manager.setActive(changeset.id!);

      await manager.stage(changeset.id!, {
        type: "add",
        elementId: "elem-1",
        layerName: "application",
        after: { id: "elem-1" },
      });

      await manager.stage(changeset.id!, {
        type: "add",
        elementId: "elem-2",
        layerName: "application",
        after: { id: "elem-2" },
      });

      await manager.stage(changeset.id!, {
        type: "add",
        elementId: "elem-3",
        layerName: "data-model",
        after: { id: "elem-3" },
      });

      const loaded = await manager.load(changeset.id!);
      expect(loaded?.changes.length).toBe(3);
      expect((loaded?.changes[0] as any).sequenceNumber).toBe(0);
      expect((loaded?.changes[1] as any).sequenceNumber).toBe(1);
      expect((loaded?.changes[2] as any).sequenceNumber).toBe(2);
    });

    it("should unstage a specific element", async () => {
      const changeset = await manager.create("unstage-test");
      await manager.setActive(changeset.id!);

      await manager.stage(changeset.id!, {
        type: "add",
        elementId: "elem-1",
        layerName: "application",
        after: { id: "elem-1" },
      });

      await manager.stage(changeset.id!, {
        type: "add",
        elementId: "elem-2",
        layerName: "application",
        after: { id: "elem-2" },
      });

      await manager.unstage(changeset.id!, "elem-1");

      const loaded = await manager.load(changeset.id!);
      expect(loaded?.changes.length).toBe(1);
      expect(loaded?.changes[0].elementId).toBe("elem-2");
      expect((loaded?.changes[0] as any).sequenceNumber).toBe(0);
    });

    it("should discard all changes", async () => {
      const changeset = await manager.create("discard-test");
      await manager.setActive(changeset.id!);

      await manager.stage(changeset.id!, {
        type: "add",
        elementId: "elem-1",
        layerName: "application",
        after: { id: "elem-1" },
      });

      await manager.stage(changeset.id!, {
        type: "add",
        elementId: "elem-2",
        layerName: "application",
        after: { id: "elem-2" },
      });

      await manager.discard(changeset.id!);

      const loaded = await manager.load(changeset.id!);
      expect(loaded?.changes.length).toBe(0);
      expect(loaded?.status).toBe("discarded");
      expect(loaded?.stats?.additions).toBe(0);
    });

    it("should prevent staging when changeset status is not staged", async () => {
      const changeset = await manager.create("status-test");

      // Mark as discarded
      await manager.discard(changeset.id!);

      // Try to stage - should fail
      let error: Error | null = null;
      try {
        await manager.stage(changeset.id!, {
          type: "add",
          elementId: "elem-1",
          layerName: "application",
          after: { id: "elem-1" },
        });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain("status");
    });
  });

  describe("Active changeset tracking", () => {
    it("should set and get active changeset", async () => {
      const changeset = await manager.create("active-test");

      await manager.setActive(changeset.id!);
      const active = await manager.getActive();

      expect(active).toBeDefined();
      expect(active?.id).toBe(changeset.id);
      expect(active?.name).toBe("active-test");
    });

    it("should clear active changeset", async () => {
      const changeset = await manager.create("clear-active-test");

      await manager.setActive(changeset.id!);
      await manager.clearActive();

      const active = await manager.getActive();
      expect(active).toBeNull();
    });

    it("should check if changeset is active", async () => {
      const changeset = await manager.create("check-active-test");

      await manager.setActive(changeset.id!);
      const isActive = await manager.isActive(changeset.id!);

      expect(isActive).toBe(true);
    });

    it("should return false for non-active changeset", async () => {
      const changeset = await manager.create("non-active-test");

      const isActive = await manager.isActive(changeset.id!);
      expect(isActive).toBe(false);
    });
  });

  describe("Statistics tracking", () => {
    it("should update stats when adding changes", async () => {
      const changeset = await manager.create("stats-test");
      await manager.setActive(changeset.id!);

      await manager.stage(changeset.id!, {
        type: "add",
        elementId: "elem-add-1",
        layerName: "application",
        after: { id: "elem-add-1" },
      });

      await manager.stage(changeset.id!, {
        type: "add",
        elementId: "elem-add-2",
        layerName: "application",
        after: { id: "elem-add-2" },
      });

      await manager.stage(changeset.id!, {
        type: "update",
        elementId: "elem-update-1",
        layerName: "application",
        before: { id: "elem-update-1" },
        after: { id: "elem-update-1", updated: true },
      });

      await manager.stage(changeset.id!, {
        type: "delete",
        elementId: "elem-delete-1",
        layerName: "application",
        before: { id: "elem-delete-1" },
      });

      const loaded = await manager.load(changeset.id!);
      expect(loaded?.stats?.additions).toBe(2);
      expect(loaded?.stats?.modifications).toBe(1);
      expect(loaded?.stats?.deletions).toBe(1);
    });
  });

  describe("Error handling", () => {
    it("should throw error when staging non-existent changeset", async () => {
      let error: Error | null = null;
      try {
        await manager.stage("nonexistent-id", {
          type: "add",
          elementId: "elem",
          layerName: "application",
          after: { id: "elem" },
        });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain("not found");
    });

    it("should throw error when unstaging from non-existent changeset", async () => {
      let error: Error | null = null;
      try {
        await manager.unstage("nonexistent-id", "elem");
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain("not found");
    });

    it("should throw error when deleting non-existent changeset", async () => {
      let error: Error | null = null;
      try {
        await manager.delete("nonexistent");
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain("not found");
    });
  });

  describe("getActiveId() method", () => {
    it("should return the active changeset ID as string", async () => {
      const changeset = await manager.create("active-id-test");
      await manager.setActive(changeset.id!);

      const activeId = await manager.getActiveId();

      expect(activeId).toBeDefined();
      expect(typeof activeId).toBe("string");
      expect(activeId).toBe(changeset.id);
    });

    it("should return null when no active changeset exists", async () => {
      const activeId = await manager.getActiveId();

      expect(activeId).toBeNull();
    });

    it("should return null after clearing active changeset", async () => {
      const changeset = await manager.create("clear-id-test");
      await manager.setActive(changeset.id!);

      // Verify it's active
      let activeId = await manager.getActiveId();
      expect(activeId).toBe(changeset.id);

      // Clear and verify it's null
      await manager.clearActive();
      activeId = await manager.getActiveId();

      expect(activeId).toBeNull();
    });

    it("should return the active changeset ID without loading full changeset", async () => {
      const changeset1 = await manager.create("id-test-1");
      const changeset2 = await manager.create("id-test-2");

      await manager.setActive(changeset1.id!);

      const activeId = await manager.getActiveId();

      expect(activeId).toBe(changeset1.id);
      expect(activeId).not.toBe(changeset2.id);
    });
  });

  describe("apply() method (alias for commit)", () => {
    it("should apply a changeset as alias for commit by calling commit", async () => {
      // Test that apply() delegates to commit() by verifying it returns CommitResult
      const changeset = await manager.create("apply-test");

      // Stage a simple change for dry-run test
      await manager.stage(changeset.id!, {
        type: "add",
        elementId: "application.component.test-comp",
        layerName: "application",
        after: {
          id: "application.component.test-comp",
          type: "component",
          name: "Test Component",
        },
      });

      // Call apply with dry-run to verify it delegates to commit and returns CommitResult
      const result = await manager.apply(model, changeset.id!, {
        validate: false,
        dryRun: true,
      });

      expect(result).toBeDefined();
      expect(result.changeset).toBe("apply-test");
      expect(result.committed).toBe(1);
      expect(result.failed).toBe(0);
    });

    it("should support commit options in apply method", async () => {
      const changeset = await manager.create("apply-options-test");
      await manager.setActive(changeset.id!);

      await manager.stage(changeset.id!, {
        type: "add",
        elementId: "application.component.test",
        layerName: "application",
        after: {
          id: "application.component.test",
          type: "component",
          name: "Test",
        },
      });

      // Test with dry-run option
      const dryRunResult = await manager.apply(model, changeset.id!, {
        validate: false,
        dryRun: true,
      });

      expect(dryRunResult.committed).toBe(1);
      expect(dryRunResult.failed).toBe(0);

      // Verify changeset is still staged (not committed due to dry-run)
      const loaded = await manager.load(changeset.id!);
      expect(loaded?.status).toBe("staged");
    });
  });

  describe("revert() method (alias for discard)", () => {
    it("should revert a changeset as alias for discard", async () => {
      const changeset = await manager.create("revert-test");
      await manager.setActive(changeset.id!);

      // Stage some changes
      await manager.stage(changeset.id!, {
        type: "add",
        elementId: "elem-1",
        layerName: "application",
        after: { id: "elem-1" },
      });

      await manager.stage(changeset.id!, {
        type: "add",
        elementId: "elem-2",
        layerName: "application",
        after: { id: "elem-2" },
      });

      const beforeRevert = await manager.load(changeset.id!);
      expect(beforeRevert?.changes.length).toBe(2);
      expect(beforeRevert?.status).toBe("staged");

      // Revert using the alias method
      await manager.revert(changeset.id!);

      const afterRevert = await manager.load(changeset.id!);
      expect(afterRevert?.changes.length).toBe(0);
      expect(afterRevert?.status).toBe("discarded");
      expect(afterRevert?.stats?.additions).toBe(0);
    });

    it("should clear changes without affecting base model", async () => {
      const changeset = await manager.create("revert-no-apply-test");
      await manager.setActive(changeset.id!);

      // Stage changes
      await manager.stage(changeset.id!, {
        type: "add",
        elementId: "test-elem",
        layerName: "application",
        after: { id: "test-elem", type: "component" },
      });

      // Get list count before revert
      const allBefore = await manager.list();
      const countBefore = allBefore.length;

      // Revert (should not apply changes)
      await manager.revert(changeset.id!);

      // Verify changeset still exists but is discarded
      const loaded = await manager.load(changeset.id!);
      expect(loaded).toBeDefined();
      expect(loaded?.status).toBe("discarded");

      // Verify changeset count is unchanged (revert doesn't delete, only discards)
      const allAfter = await manager.list();
      expect(allAfter.length).toBe(countBefore);
    });

    it("should handle revert of non-existent changeset", async () => {
      let error: Error | null = null;
      try {
        await manager.revert("nonexistent-revert-id");
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain("not found");
    });
  });
});
