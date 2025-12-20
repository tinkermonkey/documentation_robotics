import { Model } from "./dist/core/model.js";
import { Layer } from "./dist/core/layer.js";
import { Element } from "./dist/core/element.js";
import { Manifest } from "./dist/core/manifest.js";
import { ArchiMateExporter } from "./dist/export/archimate-exporter.js";

const ts = new Date().getTime();
const testDir = `/tmp/test-special-chars-${ts}`;

const manifest = new Manifest({
  name: "Test Model",
  version: "1.0.0",
});

const model = new Model(testDir, manifest);
const specialLayer = new Layer("security");
const element = new Element({
  id: "security-threat-injection",
  type: "threat",
  name: "SQL Injection <attack> & XSS",
  description: "Threat with special chars: <, >, &, \"",
});

console.log("Before adding element:");
console.log("Elements in layer:", specialLayer.listElements().length);

specialLayer.addElement(element);

console.log("After adding element:");
console.log("Elements in layer:", specialLayer.listElements().length);

model.addLayer(specialLayer);

console.log("After adding to model:");
const layer = await model.getLayer("security");
console.log("Layer from model:", layer?.name);
console.log("Elements in layer from model:", layer?.listElements().length);

const exporter = new ArchiMateExporter();
console.log("Exporter supported layers:", exporter.supportedLayers);
console.log("Security in supported:", exporter.supportedLayers.includes("security"));

const result = await exporter.export(model, {});

console.log("=== EXPORTED CONTENT ===");
console.log(result);
