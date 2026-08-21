/**
 * Integration tests for cross-layer relationship validation under --layers filtering
 *
 * Tests that relationships crossing layer boundaries do not produce spurious
 * "not found" errors when validating with --layers filtering, while still
 * catching genuinely missing elements.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "path";
import { Model } from "@/core/model";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { Relationships } from "@/core/relationships";
import { validateCommand } from "@/commands/validate";
import { StagingAreaManager } from "@/core/staging-area";
import { createTestWorkdir } from "../helpers/golden-copy.js";

async function captureConsole(fn: () => Promise<void>): Promise<string> {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: any[]) => logs.push(args.join(" "));
  console.error = (...args: any[]) => logs.push(args.join(" "));

  try {
    await fn();
  } catch {
    // validateCommand throws when validation fails; output was already captured
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return logs.join("\n");
}

describe("cross-layer relationship validation under --layers filtering", () => {
  let workdir: Awaited<ReturnType<typeof createTestWorkdir>>;

  beforeEach(async () => {
    workdir = await createTestWorkdir();
  });

  afterEach(async () => {
    await workdir.cleanup();
  });

  it("does not report spurious 'not found' errors for valid cross-layer relationships", async () => {
    // Set up a model with elements in two layers and a cross-layer relationship
    const model = await Model.init(
      workdir.path,
      {
        name: "Cross-Layer Test Model",
        version: "1.0.0",
        description: "Test model for cross-layer relationship filtering",
        specVersion: "0.8.4",
        created: new Date().toISOString(),
      },
      { lazyLoad: false }
    );

    // Create business layer with a service
    const businessLayer = new Layer("business");
    businessLayer.addElement(
      new Element({
        id: "business.businessservice.customer-management",
        spec_node_id: "business.businessservice",
        layer_id: "business",
        type: "businessservice",
        name: "Customer Management Service",
        description: "Manages customer data",
      })
    );
    model.addLayer(businessLayer);

    // Create motivation layer with a goal
    const motivationLayer = new Layer("motivation");
    motivationLayer.addElement(
      new Element({
        id: "motivation.goal.customer-satisfaction",
        spec_node_id: "motivation.goal",
        layer_id: "motivation",
        type: "goal",
        name: "Customer Satisfaction",
        description: "Achieve high customer satisfaction",
      })
    );
    model.addLayer(motivationLayer);

    // Add a cross-layer relationship: business service realizes motivation goal
    model.relationships.add({
      source: "business.businessservice.customer-management",
      target: "motivation.goal.customer-satisfaction",
      predicate: "realizes",
      layer: "business",
      properties: {},
    });

    await model.saveManifest();
    await model.saveLayer("business");
    await model.saveLayer("motivation");
    await model.saveRelationships();

    // Validate with --layers business filter
    // The source (business service) is in business layer (included)
    // The target (motivation goal) is in motivation layer (excluded)
    // This should NOT report a "not found" error for the goal
    const output = await captureConsole(() =>
      validateCommand({ model: workdir.path, layers: ["business"] })
    );

    // Should not report "not found" error for cross-layer relationship
    // (the relationship is skipped because target is in unloaded layer)
    expect(output).not.toContain("Relationship target element 'motivation.goal.customer-satisfaction' not found");

    // Validate with --layers motivation filter
    // The source (business service) is in business layer (excluded)
    // The target (motivation goal) is in motivation layer (included)
    // This should also NOT report a "not found" error for the business service
    const output2 = await captureConsole(() =>
      validateCommand({ model: workdir.path, layers: ["motivation"] })
    );

    // Should not report "not found" error for cross-layer relationship
    expect(output2).not.toContain("Relationship source element 'business.businessservice.customer-management' not found");
  });

  it("skips cross-layer relationships under filtering while catching missing elements in unfiltered mode", async () => {
    const model = await Model.init(
      workdir.path,
      {
        name: "Missing Element Test Model",
        version: "1.0.0",
        description: "Test model for detecting genuinely missing elements",
        specVersion: "0.8.4",
        created: new Date().toISOString(),
      },
      { lazyLoad: false }
    );

    // Create business layer with a service
    const businessLayer = new Layer("business");
    businessLayer.addElement(
      new Element({
        id: "business.businessservice.customer-management",
        spec_node_id: "business.businessservice",
        layer_id: "business",
        type: "businessservice",
        name: "Customer Management Service",
        description: "Manages customer data",
      })
    );
    model.addLayer(businessLayer);

    // Create motivation layer (but don't add the goal element)
    const motivationLayer = new Layer("motivation");
    model.addLayer(motivationLayer);

    // Add a relationship to a goal that doesn't exist
    model.relationships.add({
      source: "business.businessservice.customer-management",
      target: "motivation.goal.nonexistent-goal",
      predicate: "realizes",
      layer: "business",
      properties: {},
    });

    await model.saveManifest();
    await model.saveLayer("business");
    await model.saveLayer("motivation");
    await model.saveRelationships();

    // Validate without layer filter - should report missing target
    const output = await captureConsole(() =>
      validateCommand({ model: workdir.path })
    );

    expect(output).toContain("not found");
    expect(output).toContain("motivation.goal.nonexistent-goal");

    // Validate with --layers business filter
    // When filtering to a single layer, cross-layer relationships where the target
    // is in an unloaded layer are skipped (design decision: we can't validate them
    // since the target layer is not loaded and we don't know if the element exists).
    const output2 = await captureConsole(() =>
      validateCommand({ model: workdir.path, layers: ["business"] })
    );

    // Should NOT report the missing goal when filtering to business only
    // (design decision: can't validate cross-layer refs to unloaded layers)
    expect(output2).not.toContain("motivation.goal.nonexistent-goal");
  });

  it("reports genuinely missing elements within the filtered layer", async () => {
    const model = await Model.init(
      workdir.path,
      {
        name: "Intra-Layer Missing Element Test",
        version: "1.0.0",
        description: "Test detection of missing elements within a filtered layer",
        specVersion: "0.8.4",
        created: new Date().toISOString(),
      },
      { lazyLoad: false }
    );

    // Create business layer with one service but reference another that doesn't exist
    const businessLayer = new Layer("business");
    businessLayer.addElement(
      new Element({
        id: "business.businessservice.order-management",
        spec_node_id: "business.businessservice",
        layer_id: "business",
        type: "businessservice",
        name: "Order Management Service",
        description: "Manages orders",
      })
    );
    model.addLayer(businessLayer);

    // Add an intra-layer relationship where target doesn't exist
    // Both source and target are in the business layer
    model.relationships.add({
      source: "business.businessservice.order-management",
      target: "business.businessservice.nonexistent-service",
      predicate: "supports",
      layer: "business",
      properties: {},
    });

    await model.saveManifest();
    await model.saveLayer("business");
    await model.saveRelationships();

    // Validate with --layers business filter
    // Both endpoints are in the business layer, so the missing target should be reported
    const output = await captureConsole(() =>
      validateCommand({ model: workdir.path, layers: ["business"] })
    );

    // Should report the missing service since both endpoints are in the filtered layer
    expect(output).toContain("not found");
    expect(output).toContain("business.businessservice.nonexistent-service");
  });

  it("validates consistency across multiple layer filters", async () => {
    const model = await Model.init(
      workdir.path,
      {
        name: "Multi-Filter Test Model",
        version: "1.0.0",
        description: "Test consistency across multiple layer filters",
        specVersion: "0.8.4",
        created: new Date().toISOString(),
      },
      { lazyLoad: false }
    );

    // Create three layers with interconnected elements
    const motivationLayer = new Layer("motivation");
    motivationLayer.addElement(
      new Element({
        id: "motivation.goal.customer-satisfaction",
        spec_node_id: "motivation.goal",
        layer_id: "motivation",
        type: "goal",
        name: "Customer Satisfaction",
      })
    );
    model.addLayer(motivationLayer);

    const businessLayer = new Layer("business");
    businessLayer.addElement(
      new Element({
        id: "business.businessservice.customer-management",
        spec_node_id: "business.businessservice",
        layer_id: "business",
        type: "businessservice",
        name: "Customer Management",
      })
    );
    model.addLayer(businessLayer);

    const dataModelLayer = new Layer("data-model");
    dataModelLayer.addElement(
      new Element({
        id: "data-model.schemadefinition.customer-schema",
        spec_node_id: "data-model.schemadefinition",
        layer_id: "data-model",
        type: "schemadefinition",
        name: "Customer Schema",
      })
    );
    model.addLayer(dataModelLayer);

    // Create cross-layer relationships
    model.relationships.add({
      source: "business.businessservice.customer-management",
      target: "motivation.goal.customer-satisfaction",
      predicate: "realizes",
      layer: "business",
      properties: {},
    });

    model.relationships.add({
      source: "business.businessservice.customer-management",
      target: "data-model.schemadefinition.customer-schema",
      predicate: "uses",
      layer: "business",
      properties: {},
    });

    await model.saveManifest();
    await model.saveLayer("motivation");
    await model.saveLayer("business");
    await model.saveLayer("data-model");
    await model.saveRelationships();

    // Validate with each layer filter - all should be clean
    const businessOutput = await captureConsole(() =>
      validateCommand({ model: workdir.path, layers: ["business"] })
    );
    expect(businessOutput).not.toContain("not found");

    const motivationOutput = await captureConsole(() =>
      validateCommand({ model: workdir.path, layers: ["motivation"] })
    );
    expect(motivationOutput).not.toContain("not found");

    const dataModelOutput = await captureConsole(() =>
      validateCommand({ model: workdir.path, layers: ["data-model"] })
    );
    expect(dataModelOutput).not.toContain("not found");
  });

  it("correctly applies layer filter to projected model with active changeset", async () => {
    // Set up a model with elements in multiple layers and cross-layer relationships
    const model = await Model.init(
      workdir.path,
      {
        name: "Cross-Layer Changeset Test",
        version: "1.0.0",
        description: "Test layer filtering with staged changes",
        specVersion: "0.8.4",
        created: new Date().toISOString(),
      },
      { lazyLoad: false }
    );

    // Create business layer with a service
    const businessLayer = new Layer("business");
    businessLayer.addElement(
      new Element({
        id: "business.businessservice.payment-processing",
        spec_node_id: "business.businessservice",
        layer_id: "business",
        type: "businessservice",
        name: "Payment Processing Service",
        description: "Processes payments",
      })
    );
    model.addLayer(businessLayer);

    // Create motivation layer with a goal
    const motivationLayer = new Layer("motivation");
    motivationLayer.addElement(
      new Element({
        id: "motivation.goal.financial-security",
        spec_node_id: "motivation.goal",
        layer_id: "motivation",
        type: "goal",
        name: "Financial Security",
        description: "Ensure financial security",
      })
    );
    model.addLayer(motivationLayer);

    // Add a cross-layer relationship
    model.relationships.add({
      source: "business.businessservice.payment-processing",
      target: "motivation.goal.financial-security",
      predicate: "realizes",
      layer: "business",
      properties: {},
    });

    await model.saveManifest();
    await model.saveLayer("business");
    await model.saveLayer("motivation");
    await model.saveRelationships();

    // Create and activate a changeset to trigger the projection code path
    const manager = new StagingAreaManager(workdir.path, model);
    const changeset = await manager.create(
      "test-cross-layer-projection",
      "Test changeset for cross-layer projection"
    );
    if (changeset.id) {
      await manager.setActive(changeset.id);
    }

    // Load model with layer filter - now with active changeset
    const filteredModel = await Model.load(workdir.path, {
      lazyLoad: false,
      layers: ["business"],
    });

    // Verify loadedLayerFilter is set
    expect(filteredModel.loadedLayerFilter).toEqual(["business"]);

    // Verify active changeset is present
    expect(filteredModel.getActiveChangesetId()).toBe(changeset.id);

    // Validate with the filtered model - should not report spurious errors for cross-layer relationships
    const output = await captureConsole(() =>
      validateCommand({ model: workdir.path, layers: ["business"] })
    );

    // The motivation goal should not be reported as "not found" even though
    // it's in an unloaded layer (crossed by a relationship from business layer)
    // Note: warnings about missing source references may still appear for all elements,
    // but relationship validation should not report the element as missing/not found
    expect(output).not.toContain("motivation.goal.financial-security': At");
    expect(output).not.toContain("Relationship target element 'motivation.goal.financial-security' not found");
  });
});
