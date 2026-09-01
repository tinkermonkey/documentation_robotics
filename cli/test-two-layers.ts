import { Model } from "./src/core/model.js";
import { Layer } from "./src/core/layer.js";
import { Element } from "./src/core/element.js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const testDir = path.join(os.tmpdir(), `test-two-${Date.now()}`);
await fs.mkdir(testDir, { recursive: true });

const model = await Model.init(testDir, {
  name: "Test",
  version: "1.0.0",
  created: new Date().toISOString(),
}, { lazyLoad: false });

// Create motivation layer
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

const elem = motivationLayer.elements.get("motivation.goal.serve-customers");
if (elem) {
  elem.references = [
    { target: "api.operation.non-existent", type: "implements" },
  ];
  console.log("Set references:", elem.references);
}

// Create API layer
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

// Add both layers to model
model.addLayer(motivationLayer);
model.addLayer(apiLayer);

// Save manifest and layers
await model.saveManifest();
console.log("Saved manifest");

console.log("Layer elements before save:");
for (const [k, v] of motivationLayer.elements) {
  console.log(`- ${k}: references=${JSON.stringify(v.references)}`);
}

await model.saveLayer("motivation");
console.log("Saved motivation layer");

await model.saveLayer("api");
console.log("Saved api layer");

// Read the saved YAML
const layerDir = path.join(testDir, "documentation-robotics/model/01_motivation");
const yamlContent = await fs.readFile(path.join(layerDir, "goal.yaml"), "utf-8");
console.log("\nSaved motivation YAML:");
console.log(yamlContent);

await fs.rm(testDir, { recursive: true, force: true });
