import { Model } from "./src/core/model.js";
import { Layer } from "./src/core/layer.js";
import { Element } from "./src/core/element.js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const testDir = path.join(os.tmpdir(), `test-refs-${Date.now()}`);
await fs.mkdir(testDir, { recursive: true });

console.log("Test directory:", testDir);

// Initialize model
const model = await Model.init(testDir, {
  name: "Test",
  version: "1.0.0",
  created: new Date().toISOString(),
}, { lazyLoad: false });

// Create a layer with a broken reference
const layer = new Layer("motivation");
layer.addElement(new Element({
  id: "motivation.goal.test",
  spec_node_id: "motivation.goal",
  layer_id: "motivation",
  type: "goal",
  name: "Test Goal",
  references: [{ target: "api.operation.non-existent", type: "implements" }],
}));

model.addLayer(layer);
await model.saveManifest();
await model.saveLayer("motivation");

// Read the YAML file to see if references were saved
const layerDir = path.join(testDir, "documentation-robotics/model/01_motivation");
const yamlFiles = await fs.readdir(layerDir);
console.log("YAML files in layer:", yamlFiles);

for (const file of yamlFiles) {
  if (file.endsWith(".yaml")) {
    const content = await fs.readFile(path.join(layerDir, file), "utf-8");
    console.log(`\n=== ${file} ===`);
    console.log(content);
  }
}

// Load the model fresh and check if references are loaded
const model2 = await Model.load(testDir);
const loadedLayer = model2.layers.get("motivation");
if (loadedLayer) {
  for (const elem of loadedLayer.listElements()) {
    console.log(`\nElement: ${elem.id}`);
    console.log("References:", elem.references);
  }
}

// Cleanup
await fs.rm(testDir, { recursive: true, force: true });
