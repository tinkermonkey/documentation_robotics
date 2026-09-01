import { Model } from "./src/core/model.js";
import { Layer } from "./src/core/layer.js";
import { Element } from "./src/core/element.js";
import { ReferenceValidator } from "./src/validators/reference-validator.js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const testDir = path.join(os.tmpdir(), `test-debug-${Date.now()}`);
await fs.mkdir(testDir, { recursive: true });

// Initialize model  
const model = await Model.init(testDir, {
  name: "Test",
  version: "1.0.0",
  created: new Date().toISOString(),
}, { lazyLoad: false });

// Create layers
const motivationLayer = new Layer("motivation");
motivationLayer.addElement(new Element({
  id: "motivation.goal.test",
  spec_node_id: "motivation.goal",
  layer_id: "motivation",
  type: "goal",
  name: "Test Goal",
}));

const element = motivationLayer.elements.get("motivation.goal.test");
if (element) {
  element.references = [{ target: "api.operation.non-existent", type: "implements" }];
}

const apiLayer = new Layer("api");
apiLayer.addElement(new Element({
  id: "api.operation.real",
  spec_node_id: "api.operation",
  layer_id: "api",
  type: "operation",
  name: "Real Op",
}));

model.addLayer(motivationLayer);
model.addLayer(apiLayer);
await model.saveManifest();
await model.saveLayer("motivation");
await model.saveLayer("api");

// Load model fresh
const model2 = await Model.load(testDir);

console.log("Loaded layers:");
for (const [layerName, layer] of model2.layers) {
  console.log(`- ${layerName}: ${layer.elements.size} elements`);
  for (const elem of layer.listElements()) {
    console.log(`  * ${elem.id || elem.path}`);
    console.log(`    references: ${JSON.stringify(elem.references)}`);
  }
}

// Test reference validator directly on loaded model
const validator = new ReferenceValidator();
const result = validator.validateModel(model2);

console.log("\nReference Validation Result:");
console.log("Errors:", result.errors.length);
result.errors.forEach(err => {
  console.log(`- [${err.layer}] ${err.message}`);
});

// Cleanup
await fs.rm(testDir, { recursive: true, force: true });
