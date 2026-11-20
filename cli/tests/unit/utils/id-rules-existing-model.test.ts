/**
 * The id rules against a model that exists: this repository's own (documentation-robotics/model),
 * whose elements were made by `dr add`, model_add and codebase_extract under earlier CLI releases.
 *
 * An element keeps the id of the release that made it. When the rules that derive an id from a
 * name change (CLI 0.7.0: a word break after a digit, the root route, dots and slashes, the n-
 * prefix), a name can give another id than the element it describes has. Adding that name again
 * must still be refused, naming the element that is there: otherwise the model gets a second copy
 * under the new id, which is a rename in effect.
 *
 * So for every element of the model, adding its name again finds the element: either the name
 * still gives its id, or `existingUnderEarlierId` names it. If this fails after a change to
 * `deriveElementId`, add the rule that was replaced to `earlierElementIds` in
 * src/utils/id-generator.ts; do not change the ids in the model.
 */

import { describe, it, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { deriveElementId, earlierElementIds, existingElementsIn, existingUnderEarlierId } from "../../../src/utils/id-generator.js";

const MODEL_DIR = join(import.meta.dir, "..", "..", "..", "..", "documentation-robotics", "model");

/**
 * Elements whose id no rule ever derived from the name they carry now: renamed with model_update
 * (a rename keeps the id), or made with `dr add <id-name> --name <shown>`. Adding their name again
 * makes a new element, as it always did. List an id here only for one of those two reasons.
 */
const NAME_AND_ID_UNRELATED: string[] = [];

interface ModelElement {
  id: string;
  layer: string;
  type: string;
  name: string;
}

function readModel(): ModelElement[] {
  const elements: ModelElement[] = [];
  for (const layerDir of readdirSync(MODEL_DIR, { withFileTypes: true })) {
    if (!layerDir.isDirectory()) continue;
    for (const file of readdirSync(join(MODEL_DIR, layerDir.name))) {
      if (!file.endsWith(".yaml")) continue;
      const entries = (parse(readFileSync(join(MODEL_DIR, layerDir.name, file), "utf8")) ?? {}) as Record<string, any>;
      for (const [id, element] of Object.entries(entries)) {
        if (element && typeof element.name === "string" && typeof element.type === "string") {
          elements.push({ id: element.path ?? id, layer: element.layer_id ?? id.split(".")[0], type: element.type, name: element.name });
        }
      }
    }
  }
  return elements;
}

describe("id rules against this repository's model", () => {
  it("has the model to check", () => {
    expect(existsSync(MODEL_DIR)).toBe(true);
    expect(readModel().length).toBeGreaterThan(1000);
  });

  it("adding any element's name again finds that element, whatever rule made its id", () => {
    const elements = readModel();
    const existing = existingElementsIn(elements);
    const sameId: string[] = [];
    const underEarlierId: string[] = [];
    const wouldBeCopied: string[] = [];
    for (const element of elements) {
      const derived = deriveElementId(element.layer, element.type, element.name);
      if (derived.id === element.id) {
        sameId.push(element.id);
        continue;
      }
      // The name gives another id today. If another element already holds that id the add is
      // refused as "already exists"; otherwise the guard must name this element.
      const guard = existing.byId(derived.id)
        ? { existing: element.id }
        : existingUnderEarlierId(element.layer, element.type, element.name, derived.id, existing);
      if (guard.existing === element.id) underEarlierId.push(element.id);
      else if (!NAME_AND_ID_UNRELATED.includes(element.id)) wouldBeCopied.push(`${element.id} ("${element.name}" → ${derived.id})`);
    }

    // No element gets a second copy under a new id.
    expect(wouldBeCopied).toEqual([]);
    // The check is not empty-handed: the model does hold elements made under earlier rules.
    expect(underEarlierId.length).toBeGreaterThan(0);
    expect(sameId.length + underEarlierId.length + NAME_AND_ID_UNRELATED.length).toBe(elements.length);
  });

  it("covers each class of id the 0.7.0 rules changed", () => {
    const elements = readModel();
    const changed = elements.filter((e) => deriveElementId(e.layer, e.type, e.name).id !== e.id);
    const earlier = (e: ModelElement) => earlierElementIds(e.layer, e.type, e.name).includes(e.id);
    // The digit rule: `tier1status` for "Tier1Status".
    expect(changed.some((e) => /[0-9][A-Z][a-z]/.test(e.name) && earlier(e))).toBe(true);
    // The root route: `get` for "GET /".
    const root = elements.find((e) => e.id === "api.operation.get");
    if (root) {
      expect(root.name).toBe("GET /");
      expect(deriveElementId("api", "operation", root.name).id).toBe("api.operation.get-root");
      expect(earlier(root)).toBe(true);
    }
  });
});
