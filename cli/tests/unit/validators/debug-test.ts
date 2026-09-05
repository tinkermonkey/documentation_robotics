import { describe, it, expect } from "bun:test";
import { Model } from "@/core/model";
import { Manifest } from "@/core/manifest";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";

describe("Debug test", () => {
  it("should show layer structure", async () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });
    const model = new Model("/test", manifest);

    const layer1 = new Layer("motivation", [
      new Element({
        id: "duplicate-id",
        type: "Goal",
        name: "First Element",
      }),
    ]);

    const layer2 = new Layer("business", [
      new Element({
        id: "duplicate-id",
        type: "Process",
        name: "Second Element",
      }),
    ]);

    console.log("\n=== Before addLayer ===");
    console.log("Layer 1 elements:", layer1.listElements().map(e => ({ id: e.id, layer: e.layer })));
    console.log("Layer 2 elements:", layer2.listElements().map(e => ({ id: e.id, layer: e.layer })));

    model.addLayer(layer1);
    model.addLayer(layer2);

    console.log("\n=== After addLayer ===");
    console.log("Layer 1 elements:", layer1.listElements().map(e => ({ id: e.id, layer: e.layer })));
    console.log("Layer 2 elements:", layer2.listElements().map(e => ({ id: e.id, layer: e.layer })));

    console.log("\n=== Model layers map ===");
    for (const [layerName, layer] of model.layers) {
      console.log(`  Layer: ${layerName}, Elements:`, layer.listElements().map(e => ({ id: e.id, layer: e.layer })));
    }

    expect(true).toBe(true);
  });
});
