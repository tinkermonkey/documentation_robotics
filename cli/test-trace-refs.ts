import { Model } from "./src/core/model.js";
import { Layer } from "./src/core/layer.js";
import { Element } from "./src/core/element.js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const testDir = path.join(os.tmpdir(), `test-trace-${Date.now()}`);
await fs.mkdir(testDir, { recursive: true });

const model = await Model.init(testDir, {
  name: "Test",
  version: "1.0.0",
  created: new Date().toISOString(),
}, { lazyLoad: false });

console.log("1. After Model.init()");

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

console.log("2. After addElement to layer");
let elem = motivationLayer.elements.get("motivation.goal.serve-customers");
console.log(`   Element references: ${JSON.stringify(elem!.references)}`);

elem!.references = [
  { target: "api.operation.non-existent", type: "implements" },
];

console.log("3. After setting element.references");
console.log(`   Element references: ${JSON.stringify(elem!.references)}`);

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

console.log("4. After creating API layer");
elem = motivationLayer.elements.get("motivation.goal.serve-customers");
console.log(`   Element references: ${JSON.stringify(elem!.references)}`);

model.addLayer(motivationLayer);

console.log("5. After model.addLayer(motivationLayer)");
elem = motivationLayer.elements.get("motivation.goal.serve-customers");
console.log(`   Element references: ${JSON.stringify(elem!.references)}`);

model.addLayer(apiLayer);

console.log("6. After model.addLayer(apiLayer)");
elem = motivationLayer.elements.get("motivation.goal.serve-customers");
console.log(`   Element references: ${JSON.stringify(elem!.references)}`);

await fs.rm(testDir, { recursive: true, force: true });
