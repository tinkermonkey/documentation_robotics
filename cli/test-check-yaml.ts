import { Model } from "./src/core/model.js";
import { Layer } from "./src/core/layer.js";
import { Element } from "./src/core/element.js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const testDir = path.join(os.tmpdir(), `test-yaml-${Date.now()}`);
await fs.mkdir(testDir, { recursive: true });

// Initialize model  
const model = await Model.init(testDir, {
  name: "Test",
  version: "1.0.0",
  created: new Date().toISOString(),
}, { lazyLoad: false });

// Create layers exactly like the test does
const motivationLayer = new Layer("motivation");
motivationLayer.addElement(
  new Element({
    id: "motivation.goal.serve-customers",
    spec_node_id: "motivation.goal",
    layer_id: "motivation",
    type: "goal",
    name: "Serve Customers",
  })
);

const element = motivationLayer.elements.get("motivation.goal.serve-customers");
if (element) {
  element.references = [
    { target: "api.operation.non-existent", type: "implements" },
  ];
  console.log("Element references set:", element.references);
}

const apiLayer = new Layer("api");
apiLayer.addElement(
  new Element({
    id: "api.operation.real-op",
    spec_node_id: "api.operation",
    layer_id: "api",
    type: "operation",
    name: "Real Operation",
  })
);

model.addLayer(motivationLayer);
model.addLayer(apiLayer);
await model.saveManifest();
await model.saveLayer("motivation");
await model.saveLayer("api");

// Read the saved YAML
const layerDir = path.join(testDir, "documentation-robotics/model/01_motivation");
const yamlFiles = await fs.readdir(layerDir);
for (const file of yamlFiles) {
  if (file.endsWith(".yaml")) {
    const content = await fs.readFile(path.join(layerDir, file), "utf-8");
    console.log(`\n=== ${file} ===`);
    console.log(content);
  }
}

// Load and check if references are there
const model2 = await Model.load(testDir);
const layer = model2.layers.get("motivation");
for (const elem of layer!.listElements()) {
  console.log(`\nLoaded element: ${elem.path || elem.id}`);
  console.log("References:", JSON.stringify(elem.references));
}

// Cleanup
await fs.rm(testDir, { recursive: true, force: true });
