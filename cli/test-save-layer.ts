import { Model } from "./src/core/model.js";
import { Layer } from "./src/core/layer.js";
import { Element } from "./src/core/element.js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const testDir = path.join(os.tmpdir(), `test-save-${Date.now()}`);
await fs.mkdir(testDir, { recursive: true });

const model = await Model.init(testDir, {
  name: "Test",
  version: "1.0.0",
  created: new Date().toISOString(),
}, { lazyLoad: false });

const layer = new Layer("motivation");
const elem = new Element({
  id: "motivation.goal.serve-customers",
  spec_node_id: "motivation.goal",
  layer_id: "motivation",
  type: "goal",
  name: "Serve Customers",
});

console.log("Created element:");
console.log("- path:", elem.path);
console.log("- id:", elem.id);

layer.addElement(elem);
console.log("\nAfter addElement:");
console.log("- Layer dirty:", layer.isDirty());
console.log("- Layer elements:", layer.elements.size);

// Get the element back
const gotten = layer.elements.get("motivation.goal.serve-customers");
console.log("\nGotten from layer.elements.get():");
console.log("- Found:", !!gotten);
if (gotten) {
  console.log("- ID:", gotten.id);
  console.log("- Path:", gotten.path);
  
  gotten.references = [{ target: "api.operation.non-existent", type: "implements" }];
  console.log("- References set:", gotten.references);
}

model.addLayer(layer);
await model.saveManifest();

console.log("\nBefore saveLayer:");
console.log("- Layer elements:");
for (const [k, v] of layer.elements) {
  console.log(`  ${k}: references=${JSON.stringify(v.references)}`);
}

await model.saveLayer("motivation");

const layerDir = path.join(testDir, "documentation-robotics/model/01_motivation");
const yamlContent = await fs.readFile(path.join(layerDir, "goal.yaml"), "utf-8");
console.log("\nSaved YAML:");
console.log(yamlContent);

await fs.rm(testDir, { recursive: true, force: true });
