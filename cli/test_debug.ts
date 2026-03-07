import { Element } from "./dist/core/element.js";
import { Layer } from "./dist/core/layer.js";
import { Model } from "./dist/core/model.js";
import { Manifest } from "./dist/core/manifest.js";

const manifest = new Manifest({
  name: "Test API",
  version: "1.0.0",
  description: "Test API description",
});

const model = new Model("/test", manifest);

const apiLayer = new Layer("api");
const endpoint = new Element({
  id: "api-endpoint-get-users",
  type: "endpoint",
  name: "Get Users",
  description: "Retrieve list of users",
});

console.log("1. Before addElement:");
console.log("  endpoint.layer:", endpoint.layer);
console.log("  endpoint.layer_id:", endpoint.layer_id);

apiLayer.addElement(endpoint);

console.log("2. After addElement:");
console.log("  endpoint.layer:", endpoint.layer);
console.log("  endpoint.layer_id:", endpoint.layer_id);
console.log("  layer.graph nodes:", apiLayer.graph.getNodeCount());

model.addLayer(apiLayer);

console.log("3. After addLayer:");
console.log("  model.graph nodes:", model.graph.getNodeCount());
console.log("  model.graph getNodesByLayer('api'):", model.graph.getNodesByLayer("api").length);
const nodes = model.graph.getNodesByLayer("api");
for (const n of nodes) {
  console.log("    - node.id:", n.id, "node.layer:", n.layer, "node.type:", n.type);
}
