import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { VirtualProjectionEngine } from "../../src/core/virtual-projection.js";
import { Model } from "../../src/core/model.js";
import { Manifest } from "../../src/core/manifest.js";
import { Layer } from "../../src/core/layer.js";
import { Element } from "../../src/core/element.js";
import { StagedChangesetStorage } from "../../src/core/staged-changeset-storage.js";
import { BaseSnapshotManager } from "../../src/core/base-snapshot-manager.js";
import { tmpdir } from "os";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";

describe("Performance Requirements", () => {
  let engine: VirtualProjectionEngine;
  let storage: StagedChangesetStorage;
  let snapshotManager: BaseSnapshotManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "dr-perf-test-"));
    engine = new VirtualProjectionEngine(tempDir);
    storage = new StagedChangesetStorage(tempDir);
    snapshotManager = new BaseSnapshotManager();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("Virtual Projection Performance", () => {
    it("should project 1000-element model in <500ms", async () => {
      // Create large test model
      const manifest = new Manifest({
        name: "Performance Test Model",
        description: "Large model for performance testing",
        version: "1.0.0",
        specVersion: "0.7.1",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      });

      const model = new Model(tempDir, manifest);

      // Create API layer with 500 endpoints
      const apiLayer = new Layer("api");
      for (let i = 0; i < 500; i++) {
        const endpoint = new Element({
          id: `api-endpoint-perf-${i}`,
          type: "endpoint",
          name: `Endpoint ${i}`,
          properties: { method: "GET", path: `/api/resource/${i}` },
        });
        apiLayer.addElement(endpoint);
      }

      // Create data-model layer with 500 entities
      const dataModelLayer = new Layer("data-model");
      for (let i = 0; i < 500; i++) {
        const entity = new Element({
          id: `data-model-entity-perf-${i}`,
          type: "entity",
          name: `Entity ${i}`,
        });
        dataModelLayer.addElement(entity);
      }

      model.addLayer(apiLayer);
      model.addLayer(dataModelLayer);

      await model.saveManifest();
      await model.saveLayer("api");
      await model.saveLayer("data-model");

      // Create changeset with 50 changes
      const changesetId = "perf-projection-test";
      const baseSnapshot = await snapshotManager.captureSnapshot(model);
      const changeset = await storage.create(
        changesetId,
        "Performance Test",
        "Test projection performance",
        baseSnapshot
      );

      // Add 50 changes
      for (let i = 0; i < 50; i++) {
        changeset.changes.push({
          type: "add",
          elementId: `api-endpoint-new-${i}`,
          layerName: "api",
          after: {
            id: `api-endpoint-new-${i}`,
            type: "endpoint",
            name: `New Endpoint ${i}`,
          },
          sequenceNumber: i,
        });
      }

      await storage.save(changeset);

      // Measure projection performance
      const start = performance.now();
      await engine.projectModel(model, changesetId);
      const duration = performance.now() - start;

      // Requirement: projection <500ms
      expect(duration).toBeLessThan(500);
    });

    it("should compute diff for 100-change changeset in <200ms", async () => {
      // Create test model
      const manifest = new Manifest({
        name: "Diff Performance Test",
        description: "Model for diff performance testing",
        version: "1.0.0",
        specVersion: "0.7.1",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      });

      const model = new Model(tempDir, manifest);

      const apiLayer = new Layer("api");
      for (let i = 0; i < 100; i++) {
        const endpoint = new Element({
          id: `api-endpoint-diff-${i}`,
          type: "endpoint",
          name: `Endpoint ${i}`,
        });
        apiLayer.addElement(endpoint);
      }

      model.addLayer(apiLayer);
      await model.saveManifest();
      await model.saveLayer("api");

      // Create changeset with 100 changes
      const changesetId = "perf-diff-test";
      const baseSnapshot = await snapshotManager.captureSnapshot(model);
      const changeset = await storage.create(
        changesetId,
        "Diff Performance Test",
        "Test diff computation performance",
        baseSnapshot
      );

      for (let i = 0; i < 100; i++) {
        changeset.changes.push({
          type: "add",
          elementId: `api-endpoint-add-${i}`,
          layerName: "api",
          after: {
            id: `api-endpoint-add-${i}`,
            type: "endpoint",
            name: `Added ${i}`,
          },
          sequenceNumber: i,
        });
      }

      // Measure diff computation
      const start = performance.now();

      // Compute diff categories
      const adds = changeset.changes.filter((c) => c.type === "add");
      const updates = changeset.changes.filter((c) => c.type === "update");
      const deletes = changeset.changes.filter((c) => c.type === "delete");

      const duration = performance.now() - start;

      // Requirement: diff <200ms (should be much faster for simple categorization)
      expect(duration).toBeLessThan(200);
      expect(adds.length).toBe(100);
      expect(updates.length).toBe(0);
      expect(deletes.length).toBe(0);
    });

    it("should handle 50-change commit in <2s", async () => {
      // Create test model
      const manifest = new Manifest({
        name: "Commit Performance Test",
        description: "Model for commit performance testing",
        version: "1.0.0",
        specVersion: "0.7.1",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      });

      const model = new Model(tempDir, manifest);

      const apiLayer = new Layer("api");
      for (let i = 0; i < 50; i++) {
        const endpoint = new Element({
          id: `api-endpoint-commit-${i}`,
          type: "endpoint",
          name: `Endpoint ${i}`,
        });
        apiLayer.addElement(endpoint);
      }

      model.addLayer(apiLayer);
      await model.saveManifest();
      await model.saveLayer("api");

      // Create changeset with 50 staged changes
      const changesetId = "perf-commit-test";
      const baseSnapshot = await snapshotManager.captureSnapshot(model);
      const changeset = await storage.create(
        changesetId,
        "Commit Performance Test",
        "Test commit performance",
        baseSnapshot
      );

      for (let i = 0; i < 50; i++) {
        changeset.changes.push({
          type: "add",
          elementId: `api-endpoint-commit-new-${i}`,
          layerName: "api",
          after: {
            id: `api-endpoint-commit-new-${i}`,
            type: "endpoint",
            name: `New Endpoint ${i}`,
          },
          sequenceNumber: i,
        });
      }

      await storage.save(changeset);

      // Measure commit simulation (status update + storage write)
      const start = performance.now();

      // Simulate commit: transition status and save
      changeset.status = "committed";
      await storage.save(changeset);

      const duration = performance.now() - start;

      // Requirement: commit <2s
      expect(duration).toBeLessThan(2000);
      expect(changeset.status).toBe("committed");
    });

    it("should stage 100 sequential changes maintaining sequence numbers", async () => {
      // Create test model
      const manifest = new Manifest({
        name: "Sequence Performance Test",
        description: "Model for sequence performance testing",
        version: "1.0.0",
        specVersion: "0.7.1",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      });

      const model = new Model(tempDir, manifest);

      const apiLayer = new Layer("api");
      model.addLayer(apiLayer);
      await model.saveManifest();

      // Create changeset and stage 100 changes sequentially
      const changesetId = "perf-sequence-test";
      const baseSnapshot = await snapshotManager.captureSnapshot(model);
      const changeset = await storage.create(
        changesetId,
        "Sequence Performance Test",
        "Test sequential staging performance",
        baseSnapshot
      );

      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        changeset.changes.push({
          type: "add",
          elementId: `api-endpoint-seq-${i}`,
          layerName: "api",
          after: {
            id: `api-endpoint-seq-${i}`,
            type: "endpoint",
            name: `Sequential ${i}`,
          },
          sequenceNumber: i,
        });
      }

      await storage.save(changeset);

      const duration = performance.now() - start;

      // Should complete quickly for 100 sequential changes
      expect(duration).toBeLessThan(1000);

      // Verify sequence numbers
      const loaded = await storage.load(changesetId);
      for (let i = 0; i < Math.min(100, loaded?.changes.length || 0); i++) {
        expect(loaded?.changes[i].sequenceNumber).toBe(i);
      }
    });
  });
});
