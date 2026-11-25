/**
 * Planned adds as the elements they would stage, checked against their types' schemas: the one
 * judgement of whether extraction can stage an add or must hand it to the agent as a
 * needs-attributes card. codebase_extract stages by it, and codebase_verify reads a symbol a project
 * rule held for Tier 0 by it (project-rules.ts), so both say the same of the same code.
 */
import { Element } from "../core/element.js";
import { Layer } from "../core/layer.js";
import { generateUUID } from "../utils/id-generator.js";
import { SchemaValidator } from "../validators/schema-validator.js";
import type { PlannedElement } from "./extraction-plan.js";

/** The element a planned add stages. */
export function elementOfAdd(add: PlannedElement, now: string): Element {
  const element = new Element({
    id: generateUUID(),
    path: add.id,
    spec_node_id: `${add.layer}.${add.type}`,
    layer_id: add.layer,
    type: add.type,
    name: add.name,
    description: add.description,
    attributes: add.attributes,
    metadata: { created_at: now, updated_at: now, version: 1 },
    layer: add.layer,
  });
  if (add.sourceReference) element.setSourceReference(add.sourceReference);
  return element;
}

/** Each add with its element and the schema's errors for it (none when it validates), layer by layer, each layer's in the order given. */
export async function validatePlannedAdds(
  adds: readonly PlannedElement[],
  now: string = new Date().toISOString()
): Promise<Array<{ add: PlannedElement; element: Element; errors: string[] }>> {
  const validator = new SchemaValidator();
  const out = adds.map((add) => ({ add, element: elementOfAdd(add, now), errors: [] as string[] }));
  const byLayer = new Map<string, typeof out>();
  for (const item of out) (byLayer.get(item.add.layer) ?? byLayer.set(item.add.layer, []).get(item.add.layer)!).push(item);
  for (const [layerName, items] of byLayer) {
    const layer = new Layer(layerName);
    for (const item of items) layer.addElement(item.element);
    const result = await validator.validateLayer(layer);
    const errors = new Map<string, string[]>();
    for (const e of result.errors) {
      if (!e.elementId) continue;
      (errors.get(e.elementId) ?? errors.set(e.elementId, []).get(e.elementId)!).push(e.message);
    }
    for (const item of items) item.errors = errors.get(item.add.id) ?? [];
  }
  return [...byLayer.values()].flat();
}
