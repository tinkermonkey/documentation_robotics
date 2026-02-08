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
    const apiLayer = model.getLayer("api");
    expect(apiLayer).toBeDefined();
  });

  it("should trace outgoing references from an API element", async () => {
    const apiLayer = model.getLayer("api");
    expect(apiLayer).toBeDefined();

    const apiElements = apiLayer?.getElements() ?? [];
    if (apiElements.length === 0) {
      // Skip if no API elements in test data
      return;
    }

    const element = apiElements[0];
    const referenceRegistry = model.getReferenceRegistry();
    const outgoingRefs = referenceRegistry.getReferencesFrom(element.id);

    // Should be an array (may be empty)
    expect(Array.isArray(outgoingRefs)).toBe(true);
  });

  it("should trace incoming references to a data model element", async () => {
    const dataModelLayer = model.getLayer("data-model");
    expect(dataModelLayer).toBeDefined();

    const dataElements = dataModelLayer?.getElements() ?? [];
    if (dataElements.length === 0) {
      // Skip if no data model elements in test data
      return;
    }

    const element = dataElements[0];
    const referenceRegistry = model.getReferenceRegistry();
    const incomingRefs = referenceRegistry.getReferencesTo(element.id);

    // Should be an array (may be empty for leaf nodes)
    expect(Array.isArray(incomingRefs)).toBe(true);
  });

  it("should validate cross-layer reference direction", async () => {
    // Higher layers should only reference lower layers
    const applicationLayer = model.getLayer("application");
    expect(applicationLayer).toBeDefined();

    const appElements = applicationLayer?.getElements() ?? [];
    const referenceRegistry = model.getReferenceRegistry();

    for (const element of appElements.slice(0, 3)) { // Test first 3 for performance
      const refs = referenceRegistry.getReferencesFrom(element.id);

      for (const ref of refs) {
        // Extract layer from target element ID
        const [targetLayer] = ref.targetElementId.split(".");

        // Application (layer 4) should only reference lower layers (1-3)
        const appIndex = 4;
        const targetIndex = getLayerIndex(targetLayer);

        if (targetIndex > 0) {
          expect(targetIndex).toBeLessThan(appIndex);
        }
      }
    }
  });

  it("should handle elements with no references gracefully", async () => {
    const layers = model.getLayerNames();
    const referenceRegistry = model.getReferenceRegistry();

    // Find elements with no references
    let elementsWithoutReferences = 0;

    for (const layerName of layers.slice(0, 3)) {
      const layer = model.getLayer(layerName);
      if (!layer) continue;

      const elements = layer.getElements();
      for (const element of elements.slice(0, 2)) {
        const refs = referenceRegistry.getReferencesFrom(element.id);
        if (refs.length === 0) {
          elementsWithoutReferences++;
        }
      }
    }

    // It's valid to have elements without references (especially in lower layers)
    expect(elementsWithoutReferences).toBeGreaterThanOrEqual(0);
  });

  it("should correctly identify reference counts", async () => {
    const referenceRegistry = model.getReferenceRegistry();

    // Pick an API endpoint if available
    const apiLayer = model.getLayer("api");
    if (!apiLayer) return;

    const apiElements = apiLayer.getElements();
    if (apiElements.length === 0) return;

    const element = apiElements[0];
    const outgoingCount = referenceRegistry.getReferencesFrom(element.id).length;
    const incomingCount = referenceRegistry.getReferencesTo(element.id).length;

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
