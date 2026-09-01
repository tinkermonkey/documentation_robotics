import { Model } from "./src/core/model.js";
import { Layer } from "./src/core/layer.js";
import { Element } from "./src/core/element.js";
import { Validator } from "./src/validators/validator.js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const testDir = path.join(os.tmpdir(), `test-fullval-${Date.now()}`);
await fs.mkdir(testDir, { recursive: true });

console.log("Test directory:", testDir);

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

console.log("Model saved to disk");

// Load model fresh and validate
const model2 = await Model.load(testDir);
const validator = new Validator();
const result = await validator.validateModel(model2);

console.log("\nFull Validation Result:");
console.log("Errors:", result.errors.length);
result.errors.forEach(err => {
  console.log(`- [${err.layer}] ${err.message}`);
});

// Cleanup
await fs.rm(testDir, { recursive: true, force: true });
