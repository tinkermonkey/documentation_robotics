/**
 * A writer in its own process, for the #1437 tests: adds goals one after another the way `dr add`
 * does (a fresh model, MutationHandler, so getWriteTarget decides where each goes), and prints one
 * JSON line per write: {name, ok} or {name, ok: false, error}.
 *
 * Usage: bun landing-writer.ts <rootPath> <count> <intervalMs> <prefix>
 */

import { Model } from "../../src/core/model.js";
import { Element } from "../../src/core/element.js";
import { Layer } from "../../src/core/layer.js";
import { MutationHandler } from "../../src/core/mutation-handler.js";
import { generateUUID } from "../../src/utils/id-generator.js";
import { getErrorMessage } from "../../src/utils/errors.js";

const [rootPath, count = "20", intervalMs = "10", prefix = "child"] = process.argv.slice(2);

export async function writeGoal(root: string, name: string): Promise<void> {
  const model = await Model.load(root, { lazyLoad: false });
  let layer = await model.getLayer("motivation");
  if (!layer) {
    layer = new Layer("motivation");
    model.addLayer(layer);
  }
  const id = `motivation.goal.${name}`;
  const element = new Element({
    id: generateUUID(),
    path: id,
    spec_node_id: "motivation.goal",
    layer_id: "motivation",
    type: "goal",
    name,
    attributes: { priority: "high" },
    layer: "motivation",
  });
  const target = layer;
  await new MutationHandler(model, id, "motivation").executeAdd(element, (e) => {
    target.addElement(e);
  });
}

if (import.meta.main) {
  for (let i = 0; i < Number(count); i++) {
    const name = `${prefix}-${i}`;
    try {
      await writeGoal(rootPath, name);
      console.log(JSON.stringify({ name, ok: true }));
    } catch (error) {
      console.log(JSON.stringify({ name, ok: false, error: getErrorMessage(error) }));
    }
    await new Promise((resolve) => setTimeout(resolve, Number(intervalMs)));
  }
}
