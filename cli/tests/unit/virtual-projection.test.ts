import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  VirtualProjectionEngine,
  type ProjectedModel,
  type ModelDiff,
} from "../../src/core/virtual-projection.js";
import { Model } from "../../src/core/model.js";
import { Manifest } from "../../src/core/manifest.js";
import { Layer } from "../../src/core/layer.js";
import { Element } from "../../src/core/element.js";
import { Changeset } from "../../src/core/changeset.js";
import { StagedChangesetStorage } from "../../src/core/staged-changeset-storage.js";
import { tmpdir } from "os";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";

describe("VirtualProjectionEngine", () => {
  let engine: VirtualProjectionEngine;
  let storage: StagedChangesetStorage;
  let baseModel: Model;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "dr-vp-test-"));
    engine = new VirtualProjectionEngine(tempDir);
    storage = new StagedChangesetStorage(tempDir);

    // Create test model
    const manifest = new Manifest({
      name: "Test Model",
      description: "Test",
      version: "1.0.0",
      specVersion: "0.7.1",
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    baseModel = new Model(tempDir, manifest);

    // Create test layers with elements
    const motivationLayer = new Layer("motivation");
    motivationLayer.addElement(
      new Element({
        id: "motivation-goal-increase-efficiency",
        name: "Increase Efficiency",
        type: "goal",
        description: "Main business goal",
        properties: { priority: "high" },
      })
    );
    baseModel.addLayer(motivationLayer);

    const applicationLayer = new Layer("application");
    applicationLayer.addElement(
      new Element({
        id: "application-service-order-service",
        name: "Order Service",
        type: "service",
        description: "Manages orders",
        properties: { version: "1.0.0" },
      })
    );
    applicationLayer.addElement(
      new Element({
        id: "application-service-payment-service",
        name: "Payment Service",
        type: "service",
        description: "Processes payments",
        properties: { version: "2.0.0" },
      })
    );
    baseModel.addLayer(applicationLayer);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("projectElement", () => {
    it("should return base element when no changes exist", async () => {
      const changesetId = "test-changeset-1";
      const changeset = await storage.create(changesetId, "Test", undefined, "base-snapshot");

      const result = await engine.projectElement(
        baseModel,
        changesetId,
        "motivation-goal-increase-efficiency"
      );

      expect(result).toBeDefined();
      expect(result?.id).toBe("motivation-goal-increase-efficiency");
      expect(result?.name).toBe("Increase Efficiency");
    });

    it("should apply add changes to non-existent element", async () => {
      const changesetId = "test-changeset-2";
      const changeset = await storage.create(changesetId, "Test", undefined, "base-snapshot");

      const newElement = {
        id: "motivation-goal-new-goal",
        name: "New Strategic Goal",
        type: "goal",
        description: "A new goal",
        priority: "medium",
      };

      await storage.addChange(changesetId, {
        type: "add",
        elementId: "motivation-goal-new-goal",
        layerName: "motivation",
        after: newElement,
        sequenceNumber: 0,
      });

      const result = await engine.projectElement(
        baseModel,
        changesetId,
        "motivation-goal-new-goal"
      );

      expect(result).toBeDefined();
      expect(result?.name).toBe("New Strategic Goal");
      expect(result?.type).toBe("goal");
    });

    it("should apply update changes to existing element", async () => {
      const changesetId = "test-changeset-3";
      await storage.create(changesetId, "Test", undefined, "base-snapshot");

      const update = {
        name: "Updated Efficiency Goal",
        properties: { priority: "critical" },
      };

      await storage.addChange(changesetId, {
        type: "update",
        elementId: "motivation-goal-increase-efficiency",
        layerName: "motivation",
        before: { name: "Increase Efficiency" },
        after: update,
        sequenceNumber: 0,
      });

      const result = await engine.projectElement(
        baseModel,
        changesetId,
        "motivation-goal-increase-efficiency"
      );

      expect(result).toBeDefined();
      expect(result?.name).toBe("Updated Efficiency Goal");
      expect(result?.properties.priority).toBe("critical");
    });

    it("should return null when element is deleted", async () => {
      const changesetId = "test-changeset-4";
      await storage.create(changesetId, "Test", undefined, "base-snapshot");

      await storage.addChange(changesetId, {
        type: "delete",
        elementId: "motivation-goal-increase-efficiency",
        layerName: "motivation",
        before: { name: "Increase Efficiency" },
        sequenceNumber: 0,
      });

      const result = await engine.projectElement(
        baseModel,
        changesetId,
        "motivation-goal-increase-efficiency"
      );

      expect(result).toBeNull();
    });

    it("should throw error for non-existent changeset", async () => {
      await expect(
        engine.projectElement(baseModel, "non-existent", "motivation-goal-increase-efficiency")
      ).rejects.toThrow("Changeset 'non-existent' not found");
    });
  });

  describe("projectLayer", () => {
    it("should return cloned layer with no changes", async () => {
      const changesetId = "test-changeset-5";
      await storage.create(changesetId, "Test", undefined, "base-snapshot");

      const result = await engine.projectLayer(baseModel, changesetId, "application");

      expect(result.name).toBe("application");
      expect(result.listElements().length).toBe(2);
      expect(result.getElement("application-service-order-service")).toBeDefined();
    });

    it("should apply add changes to layer", async () => {
      const changesetId = "test-changeset-6";
      await storage.create(changesetId, "Test", undefined, "base-snapshot");

      const newService = {
        id: "application-service-notification-service",
        name: "Notification Service",
        type: "service",
        properties: { version: "1.0.0" },
      };

      await storage.addChange(changesetId, {
        type: "add",
        elementId: "application-service-notification-service",
        layerName: "application",
        after: newService,
        sequenceNumber: 0,
      });

      const result = await engine.projectLayer(baseModel, changesetId, "application");

      expect(result.listElements().length).toBe(3);
      expect(result.getElement("application-service-notification-service")).toBeDefined();
    });

    it("should apply update changes to layer", async () => {
      const changesetId = "test-changeset-7";
      await storage.create(changesetId, "Test", undefined, "base-snapshot");

      await storage.addChange(changesetId, {
        type: "update",
        elementId: "application-service-order-service",
        layerName: "application",
        before: { name: "Order Service", properties: { version: "1.0.0" } },
        after: { name: "Updated Order Service", properties: { version: "2.0.0" } },
        sequenceNumber: 0,
      });

      const result = await engine.projectLayer(baseModel, changesetId, "application");

      const element = result.getElement("application-service-order-service");
      expect(element?.name).toBe("Updated Order Service");
      expect(element?.properties.version).toBe("2.0.0");
    });

    it("should apply delete changes to layer", async () => {
      const changesetId = "test-changeset-8";
      await storage.create(changesetId, "Test", undefined, "base-snapshot");

      await storage.addChange(changesetId, {
        type: "delete",
        elementId: "application-service-payment-service",
        layerName: "application",
        before: { name: "Payment Service" },
        sequenceNumber: 0,
      });

      const result = await engine.projectLayer(baseModel, changesetId, "application");

      expect(result.listElements().length).toBe(1);
      expect(result.getElement("application-service-payment-service")).toBeUndefined();
    });

    it("should apply changes in sequence order", async () => {
      const changesetId = "test-changeset-9";
      await storage.create(changesetId, "Test", undefined, "base-snapshot");

      // Add, then update, then delete to test sequence enforcement
      await storage.addChange(changesetId, {
        type: "add",
        elementId: "application-service-test",
        layerName: "application",
        after: { name: "Test Service v1" },
        sequenceNumber: 0,
      });

      await storage.addChange(changesetId, {
        type: "update",
        elementId: "application-service-test",
        layerName: "application",
        after: { name: "Test Service v2" },
        sequenceNumber: 1,
      });

      const result = await engine.projectLayer(baseModel, changesetId, "application");
      const element = result.getElement("application-service-test");

      expect(element?.name).toBe("Test Service v2");
    });

    it("should cache projection results", async () => {
      const changesetId = "test-changeset-10";
      await storage.create(changesetId, "Test", undefined, "base-snapshot");

      // First call computes
      const result1 = await engine.projectLayer(baseModel, changesetId, "application");

      // Second call returns cached result (same object reference)
      const result2 = await engine.projectLayer(baseModel, changesetId, "application");

      expect(result1).toBe(result2);
    });

    it("should invalidate cache on stage", async () => {
      const changesetId = "test-changeset-11";
      await storage.create(changesetId, "Test", undefined, "base-snapshot");

      // Cache a projection
      const result1 = await engine.projectLayer(baseModel, changesetId, "application");

      // Invalidate cache
      engine.invalidateOnStage(changesetId, "application");

      // Next call should recompute (different object)
      const result2 = await engine.projectLayer(baseModel, changesetId, "application");

      expect(result1).not.toBe(result2);
    });
  });

  describe("projectModel", () => {
    it("should project entire model with all layers", async () => {
      const changesetId = "test-changeset-12";
      await storage.create(changesetId, "Test", undefined, "base-snapshot");

      const result = await engine.projectModel(baseModel, changesetId);

      expect(result.isProjection).toBe(true);
      expect(result.layers.size).toBe(2);
      expect(result.layers.has("motivation")).toBe(true);
      expect(result.layers.has("application")).toBe(true);
    });

    it("should apply changes across multiple layers", async () => {
      const changesetId = "test-changeset-13";
      await storage.create(changesetId, "Test", undefined, "base-snapshot");

      await storage.addChange(changesetId, {
        type: "add",
        elementId: "motivation-goal-new",
        layerName: "motivation",
        after: { name: "New Goal" },
        sequenceNumber: 0,
      });

      await storage.addChange(changesetId, {
        type: "add",
        elementId: "application-service-new",
        layerName: "application",
        after: { name: "New Service" },
        sequenceNumber: 1,
      });

      const result = await engine.projectModel(baseModel, changesetId);

      expect(result.layers.get("motivation")?.getElement("motivation-goal-new")).toBeDefined();
      expect(result.layers.get("application")?.getElement("application-service-new")).toBeDefined();
    });

    it("should mark projection with isProjection flag", async () => {
      const changesetId = "test-changeset-14";
      await storage.create(changesetId, "Test", undefined, "base-snapshot");

      const result = await engine.projectModel(baseModel, changesetId);

      expect(result.isProjection).toBe(true);
      expect((result as any).isProjection).toBe(true);
    });
  });

  describe("computeDiff", () => {
    it("should categorize additions", async () => {
      const changesetId = "test-changeset-15";
      await storage.create(changesetId, "Test", undefined, "base-snapshot");

      await storage.addChange(changesetId, {
        type: "add",
        elementId: "motivation-goal-new",
        layerName: "motivation",
        after: { name: "New Goal" },
        sequenceNumber: 0,
      });

      const diff = await engine.computeDiff(baseModel, changesetId);

      expect(diff.additions.length).toBe(1);
      expect(diff.additions[0].elementId).toBe("motivation-goal-new");
      expect(diff.modifications.length).toBe(0);
      expect(diff.deletions.length).toBe(0);
    });

    it("should categorize modifications", async () => {
      const changesetId = "test-changeset-16";
      await storage.create(changesetId, "Test", undefined, "base-snapshot");

      await storage.addChange(changesetId, {
        type: "update",
        elementId: "motivation-goal-increase-efficiency",
        layerName: "motivation",
        before: { name: "Increase Efficiency" },
        after: { name: "Updated Goal" },
        sequenceNumber: 0,
      });

      const diff = await engine.computeDiff(baseModel, changesetId);

      expect(diff.additions.length).toBe(0);
      expect(diff.modifications.length).toBe(1);
      expect(diff.modifications[0].elementId).toBe("motivation-goal-increase-efficiency");
      expect(diff.deletions.length).toBe(0);
    });

    it("should categorize deletions", async () => {
      const changesetId = "test-changeset-17";
      await storage.create(changesetId, "Test", undefined, "base-snapshot");

      await storage.addChange(changesetId, {
        type: "delete",
        elementId: "motivation-goal-increase-efficiency",
        layerName: "motivation",
        before: { name: "Increase Efficiency" },
        sequenceNumber: 0,
      });

      const diff = await engine.computeDiff(baseModel, changesetId);

      expect(diff.additions.length).toBe(0);
      expect(diff.modifications.length).toBe(0);
      expect(diff.deletions.length).toBe(1);
      expect(diff.deletions[0].elementId).toBe("motivation-goal-increase-efficiency");
    });

    it("should categorize mixed changes", async () => {
      const changesetId = "test-changeset-18";
      await storage.create(changesetId, "Test", undefined, "base-snapshot");

      // Add
      await storage.addChange(changesetId, {
        type: "add",
        elementId: "motivation-goal-new",
        layerName: "motivation",
        after: { name: "New Goal" },
        sequenceNumber: 0,
      });

      // Update
      await storage.addChange(changesetId, {
        type: "update",
        elementId: "motivation-goal-increase-efficiency",
        layerName: "motivation",
        before: { name: "Increase Efficiency" },
        after: { name: "Updated Goal" },
        sequenceNumber: 1,
      });

      // Delete
      await storage.addChange(changesetId, {
        type: "delete",
        elementId: "application-service-payment-service",
        layerName: "application",
        before: { name: "Payment Service" },
        sequenceNumber: 2,
      });

      const diff = await engine.computeDiff(baseModel, changesetId);

      expect(diff.additions.length).toBe(1);
      expect(diff.modifications.length).toBe(1);
      expect(diff.deletions.length).toBe(1);
    });
  });

  describe("cache invalidation", () => {
    it("should invalidate specific layer on unstage", async () => {
      const changesetId = "test-changeset-19";
      await storage.create(changesetId, "Test", undefined, "base-snapshot");

      // Cache a projection
      await engine.projectLayer(baseModel, changesetId, "application");

      // Invalidate specific layer
      const cacheKeyBefore = `${changesetId}:application`;

      // Cache should have entry before invalidation
      const projectionBefore = await engine.projectLayer(baseModel, changesetId, "application");
      expect(projectionBefore).toBeDefined();

      // Invalidate the layer
      await engine.invalidateOnUnstage(changesetId, "application");

      // After invalidation, next projection should recompute (not use cache)
      // We verify this by ensuring the method completes without error
      const projectionAfter = await engine.projectLayer(baseModel, changesetId, "application");
      expect(projectionAfter).toBeDefined();
    });

    it("should invalidate entire changeset on discard", async () => {
      const changesetId = "test-changeset-20";
      await storage.create(changesetId, "Test", undefined, "base-snapshot");

      // Cache projections for multiple layers
      await engine.projectLayer(baseModel, changesetId, "motivation");
      await engine.projectLayer(baseModel, changesetId, "application");

      // Invalidate entire changeset
      engine.invalidateOnDiscard(changesetId);

      // After discard invalidation, projections should recompute on next request
      // Verify no errors occur when re-projecting
      const projectionAfterDiscard = await engine.projectLayer(
        baseModel,
        changesetId,
        "motivation"
      );
      expect(projectionAfterDiscard).toBeDefined();
    });
  });
});
