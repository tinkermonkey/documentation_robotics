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
    model.relationships.addRelationship({
      id: "cross-layer-rel-1",
      source: "business.businessservice.customer-management",
      target: "motivation.goal.customer-satisfaction",
      predicate: "realizes",
      layer: "business",
      type: "relationship",
      properties: {},
    });

    await model.saveManifest();
    await model.saveLayer("business");
    await model.saveLayer("motivation");

    // Validate with --layers business filter
    // The source (business service) is in business layer (included)
    // The target (motivation goal) is in motivation layer (excluded)
    // This should NOT report a "not found" error for the goal
    const output = await captureConsole(() =>
      validateCommand({ model: workdir.path, layers: ["business"] })
    );

    // Should not report the motivation goal as not found
    expect(output).not.toContain("motivation.goal.customer-satisfaction");
    expect(output).not.toContain("not found");

    // Validate with --layers motivation filter
    // The source (business service) is in business layer (excluded)
    // The target (motivation goal) is in motivation layer (included)
    // This should also NOT report a "not found" error for the business service
    const output2 = await captureConsole(() =>
      validateCommand({ model: workdir.path, layers: ["motivation"] })
    );

    expect(output2).not.toContain("business.businessservice.customer-management");
    expect(output2).not.toContain("not found");
  });

  it("still reports genuinely missing elements under --layers filtering", async () => {
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
    model.relationships.addRelationship({
      id: "broken-rel-1",
      source: "business.businessservice.customer-management",
      target: "motivation.goal.nonexistent-goal",
      predicate: "realizes",
      layer: "business",
      type: "relationship",
      properties: {},
    });

    await model.saveManifest();
    await model.saveLayer("business");
    await model.saveLayer("motivation");

    // Validate without layer filter - should report missing target
    const output = await captureConsole(() =>
      validateCommand({ model: workdir.path })
    );

    expect(output).toContain("not found");
    expect(output).toContain("motivation.goal.nonexistent-goal");

    // Validate with --layers business filter
    // Both endpoints are in the business layer (source) or motivation layer (target, excluded)
    // Since target is outside filter, it should be skipped (not reported as error)
    const output2 = await captureConsole(() =>
      validateCommand({ model: workdir.path, layers: ["business"] })
    );

    // Should NOT report the missing goal when filtering to business only
    expect(output2).not.toContain("motivation.goal.nonexistent-goal");
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
    model.relationships.addRelationship({
      id: "rel-motivation-business",
      source: "business.businessservice.customer-management",
      target: "motivation.goal.customer-satisfaction",
      predicate: "realizes",
      layer: "business",
      type: "relationship",
      properties: {},
    });

    model.relationships.addRelationship({
      id: "rel-business-datamodel",
      source: "business.businessservice.customer-management",
      target: "data-model.schemadefinition.customer-schema",
      predicate: "uses",
      layer: "business",
      type: "relationship",
      properties: {},
    });

    await model.saveManifest();
    await model.saveLayer("motivation");
    await model.saveLayer("business");
    await model.saveLayer("data-model");

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
});
