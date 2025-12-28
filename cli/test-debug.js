const { PlantUMLExporter } = require('./dist/export/plantuml-exporter.js');
const { Model } = require('./dist/core/model.js');
const { Layer } = require('./dist/core/layer.js');
const { Element } = require('./dist/core/element.js');
const { Manifest } = require('./dist/core/manifest.js');

async function test() {
  const exporter = new PlantUMLExporter();
  const manifest = new Manifest({
    name: "Test Model",
    version: "1.0.0",
    description: "Test architecture",
  });

  const model = new Model("/test", manifest);
  const motivationLayer = new Layer("motivation");
  const goal = new Element({
    id: "motivation-goal-increase-revenue",
    type: "goal",
    name: "Increase Revenue",
  });
  motivationLayer.addElement(goal);
  model.addLayer(motivationLayer);

  const output = await exporter.export(model, {});
  console.log("=== OUTPUT ===");
  console.log(output);
  console.log("=== END ===");
  console.log("Ends with @enduml\\n:", output.endsWith("@enduml\n"));
  console.log("Includes component Increase Revenue:", output.includes('component "Increase Revenue"'));
}

test().catch(console.error);
