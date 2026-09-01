import { Model } from "./src/core/model.js";
import { Layer } from "./src/core/layer.js";
import { Element } from "./src/core/element.js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const testDir = path.join(os.tmpdir(), `test-graph-${Date.now()}`);
await fs.mkdir(testDir, { recursive: true });

const model = await Model.init(testDir, {
  name: "Test",
  version: "1.0.0",
  created: new Date().toISOString(),
}, { lazyLoad: false });

const motivationLayer = new Layer("motivation");
const elem1 = new Element({
  id: "motivation.goal.serve-customers",
  spec_node_id: "motivation.goal",
  layer_id: "motivation",
  type: "goal",
  name: "Serve Customers",
});
motivationLayer.addElement(elem1);

console.log("After addElement:");
console.log(`- Element object: ${elem1.id}`);
console.log(`- References property: ${JSON.stringify(elem1.references)}`);

elem1.references = [
  { target: "api.operation.non-existent", type: "implements" },
];

console.log("\nAfter setting references on elem1:");
console.log(`- elem1.references: ${JSON.stringify(elem1.references)}`);

const elem2 = motivationLayer.elements.get("motivation.goal.serve-customers");
console.log(`- Retrieved element references: ${JSON.stringify(elem2!.references)}`);
console.log(`- Are they the same object? ${elem1 === elem2}`);

model.addLayer(motivationLayer);

console.log("\nAfter model.addLayer():");
console.log(`- elem1.references: ${JSON.stringify(elem1.references)}`);
console.log(`- Retrieved from layer: ${JSON.stringify(elem2!.references)}`);
const elem3 = motivationLayer.elements.get("motivation.goal.serve-customers");
console.log(`- Retrieved again from layer: ${JSON.stringify(elem3!.references)}`);
console.log(`- Are elem1 and elem3 the same? ${elem1 === elem3}`);

const apiLayer = new Layer("api");
apiLayer.addElement(new Element({
  id: "api.operation.real-op",
  spec_node_id: "api.operation",
  layer_id: "api",
  type: "operation",
  name: "Real Operation",
}));

model.addLayer(apiLayer);

console.log("\nAfter adding API layer:");
console.log(`- elem1.references: ${JSON.stringify(elem1.references)}`);
const elem4 = motivationLayer.elements.get("motivation.goal.serve-customers");
console.log(`- Retrieved from layer: ${JSON.stringify(elem4!.references)}`);
console.log(`- Are elem1 and elem4 the same? ${elem1 === elem4}`);

await fs.rm(testDir, { recursive: true, force: true });
