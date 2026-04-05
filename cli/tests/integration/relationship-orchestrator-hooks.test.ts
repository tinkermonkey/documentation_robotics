/**
 * Integration tests for relationship command orchestrator hooks
 * Verifies that add-relationship and delete-relationship command handlers
 * invoke ModelReportOrchestrator.regenerate with the correct affected layers
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Model } from "../../src/core/model.js";
import { Layer } from "../../src/core/layer.js";
import { Element } from "../../src/core/element.js";
import { Manifest } from "../../src/core/manifest.js";
import { ModelReportOrchestrator } from "../../src/reports/model-report-orchestrator.js";
import { addRelationshipHandler, deleteRelationshipHandler } from "../../src/commands/relationship.js";
import { tmpdir } from "os";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";

describe("Relationship Command Orchestrator Hooks", () => {
  let model: Model;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "dr-rel-orch-test-"));

    // Create test model with multiple layers
    const manifest = new Manifest({
      name: "Relationship Orchestrator Test",
      description: "Test model for relationship orchestrator hooks",
      version: "1.0.0",
      specVersion: "0.8.3",
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    model = new Model(tempDir, manifest);

    // Create test layers
    const motivationLayer = new Layer("motivation");
    const businessLayer = new Layer("business");
    const applicationLayer = new Layer("application");
    const apiLayer = new Layer("api");
    const dataModelLayer = new Layer("data-model");

    // Add test elements
    motivationLayer.addElement(new Element({
      id: "motivation.goal.motivation-goal-goal-a",
      type: "goal",
      name: "Goal A",
    }));
    motivationLayer.addElement(new Element({
      id: "motivation.goal.motivation-goal-goal-b",
      type: "goal",
      name: "Goal B",
    }));

    businessLayer.addElement(new Element({
      id: "business.businessservice.business-businessservice-service-a",
      type: "businessservice",
      name: "Service A",
    }));

    applicationLayer.addElement(new Element({
      id: "application.service.application-service-service-b",
      type: "service",
      name: "Service B",
    }));

    apiLayer.addElement(new Element({
      id: "api.endpoint.api-endpoint-endpoint-1",
      type: "endpoint",
      name: "Endpoint 1",
    }));

    dataModelLayer.addElement(new Element({
      id: "data-model.entity.data-model-entity-entity-1",
      type: "entity",
      name: "Entity 1",
    }));

    model.addLayer(motivationLayer);
    model.addLayer(businessLayer);
    model.addLayer(applicationLayer);
    model.addLayer(apiLayer);
    model.addLayer(dataModelLayer);

    await model.saveManifest();
    await model.saveLayer("motivation");
    await model.saveLayer("business");
    await model.saveLayer("application");
    await model.saveLayer("api");
    await model.saveLayer("data-model");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("add-relationship command path invokes orchestrator with correct layers", () => {
    it("should pass affected layer to orchestrator.regenerate for intra-layer relationships", async () => {
      // This test exercises the production code path in relationship.ts by calling the actual handler
      // which verifies that the command handler internally calls orchestrator.regenerate with the correct layers

      let regenerateCallCount = 0;
      let regenerateCalledWith: Set<string> | null = null;

      const regenerateSpy = spyOn(ModelReportOrchestrator.prototype, "regenerate").mockImplementation(async function(this: ModelReportOrchestrator, affectedLayers: Set<string>) {
        regenerateCallCount++;
        regenerateCalledWith = new Set(affectedLayers);
      });

      try {
        // Call the handler function, which internally calls orchestrator.regenerate
        // This exercises the actual command handler code path (relationship.ts)
        await addRelationshipHandler(
          model,
          "motivation.goal.motivation-goal-goal-a",
          "motivation.goal.motivation-goal-goal-b",
          "aggregates"
        );

        // Verify regenerate was called by the handler with the motivation layer
        expect(regenerateCallCount).toBeGreaterThan(0);
        expect(regenerateCalledWith).toBeDefined();
        expect(regenerateCalledWith!.has("motivation")).toBe(true);
      } finally {
        regenerateSpy.mockRestore();
      }
    });

    it("should handle relationships between different layers", async () => {
      // This test verifies the handler correctly passes all affected layers to regenerate
      // using a valid cross-layer relationship (business.businessservice -> motivation.value via delivers-value)

      let regenerateCallCount = 0;
      let regenerateCalledWith: Set<string> | null = null;

      // First, add a motivation value to test against
      const motivationLayer = await model.getLayer("motivation");
      if (motivationLayer) {
        motivationLayer.addElement(new Element({
          id: "motivation.value.motivation-value-customer-value",
          type: "value",
          name: "Customer Value",
        }));
        await model.saveLayer("motivation");
      }

      const regenerateSpy = spyOn(ModelReportOrchestrator.prototype, "regenerate").mockImplementation(async function(this: ModelReportOrchestrator, affectedLayers: Set<string>) {
        regenerateCallCount++;
        regenerateCalledWith = new Set(affectedLayers);
      });

      try {
        // Test with a valid cross-layer relationship from business to motivation
        // The handler should identify and pass both layers to regenerate
        await addRelationshipHandler(
          model,
          "business.businessservice.business-businessservice-service-a",
          "motivation.value.motivation-value-customer-value",
          "delivers-value"
        );

        // Verify both layers were passed to regenerate by the handler
        expect(regenerateCallCount).toBeGreaterThan(0);
        expect(regenerateCalledWith).toBeDefined();
        expect(regenerateCalledWith!.size).toBe(2);
        expect(regenerateCalledWith!.has("business")).toBe(true);
        expect(regenerateCalledWith!.has("motivation")).toBe(true);
      } finally {
        regenerateSpy.mockRestore();
      }
    });
  });

  describe("delete-relationship command path invokes orchestrator with correct layers", () => {
    it("should pass affected layer to orchestrator.regenerate for intra-layer relationship deletion", async () => {
      // This test exercises the production code path in relationship.ts by calling the actual handler

      // Setup: Add relationship first
      model.relationships.add({
        source: "motivation.goal.motivation-goal-goal-a",
        target: "motivation.goal.motivation-goal-goal-b",
        predicate: "aggregates",
        layer: "motivation",
        category: "structural",
      });
      await model.saveRelationships();
      await model.saveManifest();

      let regenerateCallCount = 0;
      let regenerateCalledWith: Set<string> | null = null;

      const regenerateSpy = spyOn(ModelReportOrchestrator.prototype, "regenerate").mockImplementation(async function(this: ModelReportOrchestrator, affectedLayers: Set<string>) {
        regenerateCallCount++;
        regenerateCalledWith = new Set(affectedLayers);
      });

      try {
        // Call the handler function, which internally calls orchestrator.regenerate
        await deleteRelationshipHandler(
          model,
          "motivation.goal.motivation-goal-goal-a",
          "motivation.goal.motivation-goal-goal-b"
        );

        // Verify the layer was passed to regenerate by the handler
        expect(regenerateCallCount).toBeGreaterThan(0);
        expect(regenerateCalledWith).toBeDefined();
        expect(regenerateCalledWith!.has("motivation")).toBe(true);
      } finally {
        regenerateSpy.mockRestore();
      }
    });

    it("should pass both layers to orchestrator.regenerate for cross-layer relationship deletion", async () => {
      // This test exercises the production code path in relationship.ts by calling the actual handler

      // Setup: Add cross-layer relationship first
      model.relationships.add({
        source: "api.endpoint.api-endpoint-endpoint-1",
        target: "data-model.entity.data-model-entity-entity-1",
        predicate: "returns",
        layer: "api",
        targetLayer: "data-model",
        category: "structural",
      });
      await model.saveRelationships();
      await model.saveManifest();

      let regenerateCallCount = 0;
      let regenerateCalledWith: Set<string> | null = null;

      const regenerateSpy = spyOn(ModelReportOrchestrator.prototype, "regenerate").mockImplementation(async function(this: ModelReportOrchestrator, affectedLayers: Set<string>) {
        regenerateCallCount++;
        regenerateCalledWith = new Set(affectedLayers);
      });

      try {
        // Call the handler function, which internally calls orchestrator.regenerate for both layers
        await deleteRelationshipHandler(
          model,
          "api.endpoint.api-endpoint-endpoint-1",
          "data-model.entity.data-model-entity-entity-1"
        );

        // Verify both layers were passed to regenerate by the handler
        expect(regenerateCallCount).toBeGreaterThan(0);
        expect(regenerateCalledWith).toBeDefined();
        expect(regenerateCalledWith!.size).toBe(2);
        expect(regenerateCalledWith!.has("api")).toBe(true);
        expect(regenerateCalledWith!.has("data-model")).toBe(true);
      } finally {
        regenerateSpy.mockRestore();
      }
    });
  });
});
