/**
 * Integration test: Staging interception for model mutations
 *
 * Verifies that:
 * - When a changeset is active with 'staged' status, mutations redirect to staging
 * - Multiple accumulated changes are stored without affecting base model
 * - Base model remains unchanged while staging is active
 *
 * REQUIRES SERIAL EXECUTION: This test uses describe.serial because:
 * - Tests modify the global working directory via process.chdir()
 * - Tests interact with the file system in ways that require sequential execution
 * - Concurrent execution would cause race conditions and directory state conflicts
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Model } from "../../src/core/model.js";
import { StagingAreaManager } from "../../src/core/staging-area.js";
import { addCommand } from "../../src/commands/add.js";
import { updateCommand } from "../../src/commands/update.js";
import { deleteCommand } from "../../src/commands/delete.js";
import path from "path";
import { rm, mkdtemp } from "fs/promises";
import { fileExists, ensureDir } from "../../src/utils/file-io.js";
import { tmpdir } from "os";

describe.serial("Staging Interception Integration", () => {
  let testDir: string;
  let model: Model;
  let stagingManager: StagingAreaManager;
  let originalCwd: string;

  beforeEach(async () => {
    // Save original working directory
    originalCwd = process.cwd();
    // Create unique temporary test directory
    testDir = await mkdtemp(path.join(tmpdir(), "test-staging-int-"));

    // Initialize model with base directory structure
    const modelDir = path.join(testDir, "documentation-robotics", "model");
    await ensureDir(modelDir);

    // Create application layer directory and file
    const appLayerDir = path.join(modelDir, "04_application");
    await ensureDir(appLayerDir);
    const appLayerPath = path.join(appLayerDir, "elements.yaml");

    const dataLayerDir = path.join(modelDir, "07_data-model");
    await ensureDir(dataLayerDir);
    const dataLayerPath = path.join(dataLayerDir, "elements.yaml");

    // Create manifest in YAML format (Model.load expects YAML)
    const { writeFile } = await import("../../src/utils/file-io.js");
    const manifestPath = path.join(modelDir, "manifest.yaml");
    const manifest = `version: 0.1.0
specVersion: 0.7.1
created: ${new Date().toISOString()}
modified: ${new Date().toISOString()}
layers:
  application:
    path: documentation-robotics/model/04_application
    catalogVersion: 1.0.0
  data-model:
    path: documentation-robotics/model/07_data-model
    catalogVersion: 1.0.0`;
    await writeFile(manifestPath, manifest);

    // Create empty layer files
    await writeFile(appLayerPath, "{}");
    await writeFile(dataLayerPath, "{}");

    // Change to test directory so that commands discover the correct model
    process.chdir(testDir);

    // Load model with explicit path and manager
    model = await Model.load(testDir);
    stagingManager = new StagingAreaManager(testDir, model);
  });

  afterEach(async () => {
    // Restore original working directory
    try {
      process.chdir(originalCwd);
    } catch {
      // Ignore if restore fails
    }

    // Clean up test directory
    if (await fileExists(testDir)) {
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("Basic interception behavior", () => {
    it("should redirect add operation to staging when changeset is active", async () => {
      // Create and activate a changeset
      const changeset = await stagingManager.create("test-add-staging", "Test add staging");
      await stagingManager.setActive(changeset.id!);

      // Add element via command (should go to staging, not model)
      await addCommand("application", "service", "app-service-auth", {
        name: "Authentication Service",
        description: "Manages user authentication",
      });

      // Reload model to get latest state from disk
      model = await Model.load(testDir);

      // Verify element is NOT in base model
      const layer = await model.getLayer("application");
      const elementInModel = layer?.getElement("application.service.app-service-auth");
      expect(elementInModel).toBeUndefined();

      // Verify element IS in staging
      const loaded = await stagingManager.load(changeset.id!);
      expect(loaded?.changes.length).toBe(1);
      expect(loaded?.changes[0].elementId).toBe("application.service.app-service-auth");
      expect(loaded?.changes[0].type).toBe("add");
    });

    it("should accumulate multiple add operations in staging", async () => {
      const changeset = await stagingManager.create("test-multi-add", "Test multi add");
      await stagingManager.setActive(changeset.id!);

      // Add 5 different elements
      const elementNames = [
        "app-service-1",
        "app-service-2",
        "app-service-3",
        "app-service-4",
        "app-service-5",
      ];
      const elementIds = elementNames.map((name) => `application.service.${name}`);

      for (let i = 0; i < elementNames.length; i++) {
        await addCommand("application", "service", elementNames[i], {
          name: `Service ${i + 1}`,
          description: `Service number ${i + 1}`,
        });
      }

      // Verify ALL elements are in staging
      const loaded = await stagingManager.load(changeset.id!);
      expect(loaded?.changes.length).toBe(5);

      // Verify sequence numbers
      for (let i = 0; i < 5; i++) {
        expect((loaded?.changes[i] as any).sequenceNumber).toBe(i);
        expect(loaded?.changes[i].elementId).toBe(elementIds[i]);
      }

      // Verify stats
      expect(loaded?.stats?.additions).toBe(5);
      expect(loaded?.stats?.modifications).toBe(0);
      expect(loaded?.stats?.deletions).toBe(0);

      // Reload model to get latest state from disk
      model = await Model.load(testDir);

      // Verify base model is completely unchanged
      const layer = await model.getLayer("application");
      expect(layer?.listElements().length).toBe(0);
    });

    it("should redirect update operation to staging when changeset is active", async () => {
      // First, add an element to base model (without active changeset)
      const appLayer = await model.getLayer("application");
      const { Element } = await import("../../src/core/element.js");

      const baseElement = new Element({
        id: "application.service.app-service-existing",
        type: "service",
        name: "Existing Service",
        description: "Original description",
        layer: "application",
      });

      appLayer?.addElement(baseElement);
      await model.saveLayer("application");

      // Now create and activate a changeset
      const changeset = await stagingManager.create("test-update-staging", "Test update staging");
      await stagingManager.setActive(changeset.id!);

      // Update the element via command (should go to staging)
      await updateCommand("application.service.app-service-existing", {
        name: "Updated Service Name",
        description: "Updated description",
      });

      // Reload model to get latest state from disk
      model = await Model.load(testDir);
      const appLayerReloaded = await model.getLayer("application");

      // Verify base model element is UNCHANGED
      const unmodifiedElement = appLayerReloaded?.getElement(
        "application.service.app-service-existing"
      );
      expect(unmodifiedElement?.name).toBe("Existing Service");
      expect(unmodifiedElement?.description).toBe("Original description");

      // Verify update IS in staging
      const loaded = await stagingManager.load(changeset.id!);
      expect(loaded?.changes.length).toBe(1);
      expect(loaded?.changes[0].type).toBe("update");
      expect(loaded?.changes[0].elementId).toBe("application.service.app-service-existing");
      expect((loaded?.changes[0].after as any).name).toBe("Updated Service Name");
    });

    it("should redirect delete operation to staging when changeset is active", async () => {
      // First, add an element to base model
      const appLayer = await model.getLayer("application");
      const { Element } = await import("../../src/core/element.js");

      const baseElement = new Element({
        id: "application.service.app-service-todelete",
        type: "service",
        name: "Service to Delete",
        layer: "application",
      });

      appLayer?.addElement(baseElement);
      await model.saveLayer("application");

      // Create and activate a changeset
      const changeset = await stagingManager.create("test-delete-staging", "Test delete staging");
      await stagingManager.setActive(changeset.id!);

      // Delete the element via command (should go to staging)
      await deleteCommand("application.service.app-service-todelete", { force: true });

      // Reload model to get latest state from disk
      model = await Model.load(testDir);
      const appLayerReloaded = await model.getLayer("application");

      // Verify base model element still EXISTS
      const stillExists = appLayerReloaded?.getElement("application.service.app-service-todelete");
      expect(stillExists).toBeDefined();
      expect(stillExists?.name).toBe("Service to Delete");

      // Verify delete IS in staging
      const loaded = await stagingManager.load(changeset.id!);
      expect(loaded?.changes.length).toBe(1);
      expect(loaded?.changes[0].type).toBe("delete");
      expect(loaded?.changes[0].elementId).toBe("application.service.app-service-todelete");
    });
  });

  describe("Complex staging scenarios", () => {
    it("should handle mixed operations in single changeset", async () => {
      // Add baseline element to model
      const appLayer = await model.getLayer("application");
      const { Element } = await import("../../src/core/element.js");

      const baseElement = new Element({
        id: "application.service.app-service-baseline",
        type: "service",
        name: "Baseline Service",
        layer: "application",
      });

      appLayer?.addElement(baseElement);
      await model.saveLayer("application");

      // Create and activate changeset
      const changeset = await stagingManager.create("test-mixed-ops", "Mixed operations");
      await stagingManager.setActive(changeset.id!);

      // Stage: 3 adds, 1 update
      await addCommand("application", "service", "app-service-new-1", {
        name: "New Service 1",
      });
      await addCommand("application", "service", "app-service-new-2", {
        name: "New Service 2",
      });

      await updateCommand("application.service.app-service-baseline", {
        name: "Updated Baseline Service",
      });

      await addCommand("application", "service", "app-service-new-3", {
        name: "New Service 3",
      });

      // Verify all changes are staged
      const loaded = await stagingManager.load(changeset.id!);
      expect(loaded?.changes.length).toBe(4);
      expect(loaded?.stats?.additions).toBe(3);
      expect(loaded?.stats?.modifications).toBe(1);
      expect(loaded?.stats?.deletions).toBe(0);

      // Reload model to get latest state from disk
      model = await Model.load(testDir);
      const appLayerReloaded = await model.getLayer("application");

      // Verify base model unchanged except for baseline element
      expect(appLayerReloaded?.listElements().length).toBe(1);
      expect(
        appLayerReloaded?.getElement("application.service.app-service-baseline")
      ).toBeDefined();
      expect(appLayerReloaded?.getElement("application.service.app-service-baseline")?.name).toBe(
        "Baseline Service"
      );
      expect(appLayerReloaded?.getElement("application.service.app-service-new-1")).toBeUndefined();
      expect(appLayerReloaded?.getElement("application.service.app-service-new-2")).toBeUndefined();
      expect(appLayerReloaded?.getElement("application.service.app-service-new-3")).toBeUndefined();
    });

    it("should support unstaging specific elements", async () => {
      const changeset = await stagingManager.create("test-unstage", "Test unstaging");
      await stagingManager.setActive(changeset.id!);

      // Stage 5 elements
      for (let i = 1; i <= 5; i++) {
        await addCommand("application", "service", `app-service-${i}`, {
          name: `Service ${i}`,
        });
      }

      // Verify all 5 are staged
      let loaded = await stagingManager.load(changeset.id!);
      expect(loaded?.changes.length).toBe(5);

      // Unstage element 3
      await stagingManager.unstage(changeset.id!, "application.service.app-service-3");

      // Verify 4 remain and sequence is correct
      loaded = await stagingManager.load(changeset.id!);
      expect(loaded?.changes.length).toBe(4);
      expect(loaded?.changes.map((c) => c.elementId)).toEqual([
        "application.service.app-service-1",
        "application.service.app-service-2",
        "application.service.app-service-4",
        "application.service.app-service-5",
      ]);

      // Verify sequence numbers are resequenced
      expect((loaded?.changes[0] as any).sequenceNumber).toBe(0);
      expect((loaded?.changes[1] as any).sequenceNumber).toBe(1);
      expect((loaded?.changes[2] as any).sequenceNumber).toBe(2);
      expect((loaded?.changes[3] as any).sequenceNumber).toBe(3);

      // Reload model to verify unstaged element is not in base model
      model = await Model.load(testDir);
      const appLayer = await model.getLayer("application");
      expect(appLayer?.getElement("application.service.app-service-3")).toBeUndefined();
    });

    it("should respect changeset status - no staging when inactive", async () => {
      // Create changeset but DON'T activate it
      const changeset = await stagingManager.create("test-inactive", "Inactive changeset");

      // Add element without active changeset
      await addCommand("application", "service", "app-service-direct", {
        name: "Direct Service",
      });

      // Reload model to see persisted changes
      model = await Model.load(testDir);

      // Verify element IS in base model (not staged)
      const appLayer = await model.getLayer("application");
      expect(appLayer?.getElement("application.service.app-service-direct")).toBeDefined();
      expect(appLayer?.getElement("application.service.app-service-direct")?.name).toBe(
        "Direct Service"
      );

      // Verify changeset is empty
      const loaded = await stagingManager.load(changeset.id!);
      expect(loaded?.changes.length).toBe(0);
    });
  });

  describe("Changeset state management", () => {
    it("should maintain base model integrity across multiple staged changesets", async () => {
      // Debug: Check if there's an inherited active changeset (shouldn't be)
      const inheritedActive = await stagingManager.getActive();
      expect(inheritedActive).toBeNull();

      // Create two changesets
      const changeset1 = await stagingManager.create("test-cs-1", "Changeset 1");
      const changeset2 = await stagingManager.create("test-cs-2", "Changeset 2");

      // Activate first changeset and add elements
      await stagingManager.setActive(changeset1.id!);
      await addCommand("application", "service", "app-service-cs1-1", {
        name: "CS1 Service 1",
      });
      await addCommand("application", "service", "app-service-cs1-2", {
        name: "CS1 Service 2",
      });

      // Switch to second changeset
      await stagingManager.setActive(changeset2.id!);
      await addCommand("application", "service", "app-service-cs2-1", {
        name: "CS2 Service 1",
      });

      // Verify both changesets have their changes
      const loaded1 = await stagingManager.load(changeset1.id!);
      const loaded2 = await stagingManager.load(changeset2.id!);

      expect(loaded1?.changes.length).toBe(2);
      expect(loaded2?.changes.length).toBe(1);

      // Reload model to get latest state from disk
      model = await Model.load(testDir);

      // Verify base model is still completely empty
      const appLayer = await model.getLayer("application");
      expect(appLayer?.listElements().length).toBe(0);
    });
  });
});
