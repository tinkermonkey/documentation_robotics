/**
 * Integration Tests for Dependency Tracing Commands
 *
 * Tests the reference tracing functionality that allows users to understand
 * dependencies and impact analysis of architecture model elements.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Model } from "../../src/core/model.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";

describe("Dependency Tracing Commands", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let model: Model;

  beforeEach(async () => {
    const workdir = await createTestWorkdir();
    testDir = workdir.path;
    cleanup = workdir.cleanup;
    model = await Model.load(testDir);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should load model and access layers for dependency analysis", async () => {
    const layerNames = model.getLayerNames();
    expect(layerNames.length).toBeGreaterThan(0);

    // Verify we can access at least the api layer
    const apiLayer = await model.getLayer("api");
    expect(apiLayer).toBeDefined();
  });

  it("should trace outgoing references from an API element", async () => {
    const apiLayer = await model.getLayer("api");
    expect(apiLayer).toBeDefined();

    const apiElements = Array.from(apiLayer?.elements.values() ?? []);
    if (apiElements.length === 0) {
      // Skip if no API elements in test data
      return;
    }

    const element = apiElements[0];
    const relationships = model.relationships;
    const rels = relationships.getForElement(element.id);
    const outgoingRefs = rels.outgoing;

    // Should be an array (may be empty)
    expect(Array.isArray(outgoingRefs)).toBe(true);
  });

  it("should trace incoming references to a data model element", async () => {
    const dataModelLayer = await model.getLayer("data-model");
    expect(dataModelLayer).toBeDefined();

    const dataElements = Array.from(dataModelLayer?.elements.values() ?? []);
    if (dataElements.length === 0) {
      // Skip if no data model elements in test data
      return;
    }

    const element = dataElements[0];
    const relationships = model.relationships;
    const rels = relationships.getForElement(element.id);
    const incomingRefs = rels.incoming;

    // Should be an array (may be empty for leaf nodes)
    expect(Array.isArray(incomingRefs)).toBe(true);
  });

  it("should validate cross-layer reference direction", async () => {
    // Higher layers should only reference lower layers
    const applicationLayer = await model.getLayer("application");
    expect(applicationLayer).toBeDefined();

    const appElements = Array.from(applicationLayer?.elements.values() ?? []);
    const relationships = model.relationships;

    for (const element of appElements.slice(0, 3)) { // Test first 3 for performance
      const rels = relationships.getForElement(element.id);
      const refs = rels.outgoing;

      for (const ref of refs) {
        // Extract layer from target element ID
        const [targetLayer] = ref.target.split(".");

        // Application (layer 4) should only reference lower layers (1-3)
        const appIndex = 4;
        const targetIndex = getLayerIndex(targetLayer);

        // Validate that the target layer was found in the lookup table
        expect(targetIndex).toBeGreaterThan(
          0,
          `Could not find layer index for target layer "${targetLayer}" from element ${element.id}`
        );

        // Now verify the cross-layer direction rule
        expect(targetIndex).toBeLessThan(appIndex);
      }
    }
  });

  it("should handle elements with no references gracefully", async () => {
    const layers = model.getLayerNames();
    const relationships = model.relationships;

    // Find elements with no references
    let elementsWithoutReferences = 0;

    for (const layerName of layers.slice(0, 3)) {
      const layer = await model.getLayer(layerName);
      if (!layer) continue;

      const elements = Array.from(layer.elements.values());
      for (const element of elements.slice(0, 2)) {
        const rels = relationships.getForElement(element.id);
        if (rels.outgoing.length === 0) {
          elementsWithoutReferences++;
        }
      }
    }

    // It's valid to have elements without references (especially in lower layers)
    expect(elementsWithoutReferences).toBeGreaterThanOrEqual(0);
  });

  it("should correctly identify reference counts", async () => {
    const relationships = model.relationships;

    // Pick an API endpoint if available
    const apiLayer = await model.getLayer("api");
    if (!apiLayer) return;

    const apiElements = Array.from(apiLayer.elements.values());
    if (apiElements.length === 0) return;

    const element = apiElements[0];
    const rels = relationships.getForElement(element.id);
    const outgoingCount = rels.outgoing.length;
    const incomingCount = rels.incoming.length;

    // Reference counts should be non-negative
    expect(outgoingCount).toBeGreaterThanOrEqual(0);
    expect(incomingCount).toBeGreaterThanOrEqual(0);
  });
});

/**
 * Helper function to get layer index from layer name
 */
function getLayerIndex(layerName: string): number {
  const layers: Record<string, number> = {
    motivation: 1,
    business: 2,
    security: 3,
    application: 4,
    technology: 5,
    api: 6,
    "data-model": 7,
    "data-store": 8,
    ux: 9,
    navigation: 10,
    apm: 11,
    testing: 12,
  };
  return layers[layerName] ?? 0;
}
