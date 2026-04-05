/**
 * Integration tests for staging area commit orchestrator hooks
 * Verifies that the commit operation invokes ModelReportOrchestrator.regenerate
 * (Step 9.5 hook) with the correct set of affected layers after manifest save
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Model } from "../../src/core/model.js";
import { StagingAreaManager } from "../../src/core/staging-area.js";
import { ModelReportOrchestrator } from "../../src/reports/model-report-orchestrator.js";
import { Layer } from "../../src/core/layer.js";
import { Element } from "../../src/core/element.js";
import { Manifest } from "../../src/core/manifest.js";
import { tmpdir } from "os";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";

describe("Staging Area Commit Orchestrator Hooks (Step 9.5)", () => {
  let baseModel: Model;
  let stagingManager: StagingAreaManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "dr-staging-orchestrator-test-"));

    // Create test model
    const manifest = new Manifest({
      name: "Staging Orchestrator Test Model",
      description: "Model for testing staging orchestrator hooks",
      version: "1.0.0",
      specVersion: "0.8.3",
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    baseModel = new Model(tempDir, manifest);

    // Add API, application, and business layers for testing
    const apiLayer = new Layer("api");
    const appLayer = new Layer("application");
    const businessLayer = new Layer("business");

    // Add elements to API layer
    const endpoint1 = new Element({
      id: "api-endpoint-list-users",
      type: "endpoint",
      name: "List Users",
      description: "List all users",
      attributes: { method: "GET", path: "/users" },
    });
    apiLayer.addElement(endpoint1);

    // Add elements to application layer
    const service1 = new Element({
      id: "application-service-user-service",
      type: "service",
      name: "User Service",
      description: "User management service",
    });
    appLayer.addElement(service1);

    // Add elements to business layer
    const businessService = new Element({
      id: "business-businessservice-user-management",
      type: "businessservice",
      name: "User Management",
      description: "User management business service",
    });
    businessLayer.addElement(businessService);

    baseModel.addLayer(apiLayer);
    baseModel.addLayer(appLayer);
    baseModel.addLayer(businessLayer);

    await baseModel.saveManifest();
    await baseModel.saveLayer("api");
    await baseModel.saveLayer("application");
    await baseModel.saveLayer("business");

    // Create staging manager after model is initialized
    stagingManager = new StagingAreaManager(tempDir, baseModel);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("commit triggers orchestrator regenerate for affected layers", () => {
    it("should invoke orchestrator.regenerate with affected layers when committing element addition", async () => {
      // Create a changeset
      const changeset = await stagingManager.create("element-addition-test", "Add new endpoint");

      // Stage an element addition to api layer
      const newElementData = {
        id: "api-endpoint-create-user",
        type: "endpoint",
        name: "Create User",
        description: "Create a new user",
        attributes: { method: "POST", path: "/users" },
      };

      await stagingManager.stage(changeset.id, {
        type: "add",
        elementId: "api-endpoint-create-user",
        layerName: "api",
        after: newElementData,
      });

      // Mock the orchestrator to verify regenerate is called
      let regenerateCallCount = 0;
      let regenerateCalledWith: Set<string> | null = null;

      const regenerateSpy = spyOn(ModelReportOrchestrator.prototype, "regenerate").mockImplementation(async function(this: ModelReportOrchestrator, affectedLayers: Set<string>) {
        regenerateCallCount++;
        regenerateCalledWith = new Set(affectedLayers);
        // Do not call the original implementation - just capture the call
      });

      try {
        // Commit the changeset
        const result = await stagingManager.commit(baseModel, changeset.id, { validate: false });

        expect(result.committed).toBe(1);
        // Verify orchestrator was called with the affected layer
        expect(regenerateCallCount).toBeGreaterThan(0);
        expect(regenerateCalledWith).toBeDefined();
        expect(regenerateCalledWith!.has("api")).toBe(true);
      } finally {
        regenerateSpy.mockRestore();
      }
    });

    it("should invoke orchestrator.regenerate with all modified layers when committing changes to multiple layers", async () => {
      // Create a changeset
      const changeset = await stagingManager.create("multi-layer-test", "Multi-layer changes");

      // Add changes to both API and application layers
      await stagingManager.stage(changeset.id, {
        type: "add",
        elementId: "api-endpoint-delete-user",
        layerName: "api",
        after: {
          id: "api-endpoint-delete-user",
          type: "endpoint",
          name: "Delete User",
        },
      });

      await stagingManager.stage(changeset.id, {
        type: "add",
        elementId: "application-service-auth-service",
        layerName: "application",
        after: {
          id: "application-service-auth-service",
          type: "service",
          name: "Auth Service",
        },
      });

      // Mock the orchestrator
      let regenerateCallCount = 0;
      let regenerateCalledWith: Set<string> | null = null;

      const regenerateSpy = spyOn(ModelReportOrchestrator.prototype, "regenerate").mockImplementation(async function(this: ModelReportOrchestrator, affectedLayers: Set<string>) {
        regenerateCallCount++;
        regenerateCalledWith = new Set(affectedLayers);
        // Do not call the original implementation
      });

      try {
        // Commit the changeset
        const result = await stagingManager.commit(baseModel, changeset.id, { validate: false });

        expect(result.committed).toBe(2);
        // Verify orchestrator was called with all affected layers
        expect(regenerateCallCount).toBeGreaterThan(0);
        expect(regenerateCalledWith).toBeDefined();
        expect(regenerateCalledWith!.has("api")).toBe(true);
        expect(regenerateCalledWith!.has("application")).toBe(true);
      } finally {
        regenerateSpy.mockRestore();
      }
    });

    it("should invoke orchestrator.regenerate with correct layers when committing relationship changes", async () => {
      // Create a changeset
      const changeset = await stagingManager.create("relationship-test", "Add relationships");

      // Add relationship change between API and application layers
      const relCompositeKey = "api-endpoint-list-users::exposes::application-service-user-service";
      await stagingManager.stage(changeset.id, {
        type: "relationship-add",
        elementId: relCompositeKey,
        layerName: "api",
        after: {
          source: "api-endpoint-list-users",
          target: "application-service-user-service",
          predicate: "exposes",
          layer: "api",
          targetLayer: "application",
          category: "structural",
        },
      });

      // Mock the orchestrator
      let regenerateCallCount = 0;
      let regenerateCalledWith: Set<string> | null = null;

      const regenerateSpy = spyOn(ModelReportOrchestrator.prototype, "regenerate").mockImplementation(async function(this: ModelReportOrchestrator, affectedLayers: Set<string>) {
        regenerateCallCount++;
        regenerateCalledWith = new Set(affectedLayers);
        // Do not call the original implementation
      });

      try {
        // Commit the changeset
        const result = await stagingManager.commit(baseModel, changeset.id, { validate: false });

        expect(result.committed).toBe(1);
        // Verify orchestrator was called with affected layers
        expect(regenerateCallCount).toBeGreaterThan(0);
        expect(regenerateCalledWith).toBeDefined();
        expect(regenerateCalledWith!.has("api")).toBe(true);
        expect(regenerateCalledWith!.has("application")).toBe(true);
      } finally {
        regenerateSpy.mockRestore();
      }
    });

    it("should still complete commit successfully even if orchestrator.regenerate fails", async () => {
      // Create a changeset
      const changeset = await stagingManager.create("regenerate-failure-test", "Test regenerate failure");

      // Add changes
      await stagingManager.stage(changeset.id, {
        type: "add",
        elementId: "api-endpoint-update-user",
        layerName: "api",
        after: {
          id: "api-endpoint-update-user",
          type: "endpoint",
          name: "Update User",
        },
      });

      // Mock the orchestrator to throw an error
      const regenerateSpy = spyOn(ModelReportOrchestrator.prototype, "regenerate").mockImplementation(async function(this: ModelReportOrchestrator) {
        throw new Error("Simulated regenerate failure for testing");
      });

      try {
        // Commit should succeed despite regenerate failure
        const result = await stagingManager.commit(baseModel, changeset.id, { validate: false });

        // The commit should still be successful
        expect(result.committed).toBe(1);
        expect(result.validation.passed).toBe(true);

        // Changeset should be marked as committed
        const committedChangeset = await stagingManager.load(changeset.id);
        expect(committedChangeset).toBeDefined();
        expect(committedChangeset!.status).toBe("committed");
      } finally {
        regenerateSpy.mockRestore();
      }
    });
  });
});
