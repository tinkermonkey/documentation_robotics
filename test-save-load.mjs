import { Model } from "./cli/dist/core/model.js";
import { Layer } from "./cli/dist/core/layer.js";
import { Element } from "./cli/dist/core/element.js";
import { Manifest } from "./cli/dist/core/manifest.js";
import { $ } from "bun";
import { randomUUID } from "crypto";

const testDir = "/tmp/dr-test-" + randomUUID();
await $`mkdir -p ${testDir}`;

const manifest = new Manifest({
  name: "Test Model",
  version: "1.0.0",
});

const model = new Model(testDir, manifest);

const element = new Element({
  id: "motivation-goal-test",
  type: "goal",
  name: "Test Goal",
  description: "A test goal",
});

const layer = new Layer("motivation", [element]);
layer.metadata = { layer: "motivation", version: "1.0" };

model.addLayer(layer);
console.log("Saving layer...");
await model.saveLayer("motivation");

// Create new model and load layer
const model2 = new Model(testDir, manifest);
console.log("Loading layer...");
await model2.loadLayer("motivation");

console.log("Layer exists:", model2.layers.has("motivation"));
const loadedLayer = model2.layers.get("motivation");
console.log("Elements count:", loadedLayer?.listElements().length);
const loadedElement = loadedLayer?.getElement("motivation-goal-test");
console.log("Element found:", loadedElement);
console.log("Element name:", loadedElement?.name);
console.log("Expected: Test Goal");

// Cleanup
await $`rm -rf ${testDir}`;
