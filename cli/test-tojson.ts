import { Layer } from "./src/core/layer.js";
import { Element } from "./src/core/element.js";

// Create layer and element exactly like the test
const layer = new Layer("motivation");
layer.addElement(
  new Element({
    id: "motivation.goal.serve-customers",
    spec_node_id: "motivation.goal",
    layer_id: "motivation",
    type: "goal",
    name: "Serve Customers",
  })
);

const element = layer.elements.get("motivation.goal.serve-customers");
if (element) {
  console.log("Before setting references:");
  console.log("- element.references:", element.references);
  console.log("- element.toJSON():", JSON.stringify(element.toJSON(), null, 2));
  
  element.references = [
    { target: "api.operation.non-existent", type: "implements" },
  ];
  
  console.log("\nAfter setting references:");
  console.log("- element.references:", element.references);
  console.log("- element.toJSON():", JSON.stringify(element.toJSON(), null, 2));
}
