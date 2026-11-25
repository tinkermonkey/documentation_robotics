/**
 * model_add batches where two names give one id (#1297): "galaxyLayout tests" and "galaxy-layout tests"
 * both give testing.testcoveragetarget.galaxy-layout-tests. The batch keeps the first and refuses the
 * second; a relationship naming the shared id (exact or without hyphens) or the refused name is
 * reported, never attached to the element kept.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { Element } from "../../../src/core/element.js";
import { Layer } from "../../../src/core/layer.js";
import { generateUUID } from "../../../src/utils/id-generator.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";

function parse(result: any): any {
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}

let rootPath: string;

const add = async (args: Record<string, unknown>) => parse(await modelAddHandler({ ...(args as any), rootPath, verbose: true }));
const relate = async (args: Record<string, unknown>) =>
  parse(await relationshipAddHandler({ ...(args as any), rootPath, verbose: true }));

const ID = "testing.testcoveragetarget.galaxy-layout-tests";
const target = (name: string, targetType = "ui-component") => ({
  layer: "testing",
  type: "testcoveragetarget",
  name,
  attributes: targetType ? { targetType } : {},
});
const sketch = (name: string) => ({ layer: "testing", type: "testcasesketch", name, attributes: { status: "draft" } });
const SKETCH_A = "testing.testcasesketch.sketch-a";
const SKETCH_B = "testing.testcasesketch.sketch-b";

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-mcp-id-collision-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Id Collision Test Model", version: "0.1.0" });
});

const createChangeset = async () => parse(await changesetCreateHandler({ name: "plan", rootPath }));

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("model_add: two names, one id (#1297)", () => {
  beforeEach(createChangeset);

  it("keeps the first, refuses the second, and attaches none of the refused element's links to the first", async () => {
    const result = await add({
      elements: [target("galaxyLayout tests"), target("galaxy-layout tests"), sketch("sketch a"), sketch("sketch b")],
      relationships: [
        { source: ID, predicate: "composes", target: SKETCH_A },
        { source: "testing.testcoveragetarget.galaxylayouttests", predicate: "composes", target: SKETCH_A },
        { source: "galaxy-layout tests", predicate: "composes", target: SKETCH_B },
        { source: "galaxyLayout tests", predicate: "composes", target: SKETCH_A },
      ],
    });

    expect(result.elements.counts).toEqual({ staged: 3, invalid: 1 });
    const refused = result.elements.results[1];
    expect(refused).toMatchObject({ index: 1, id: ID, status: "invalid" });
    expect(refused.reason).toBe(
      `"galaxy-layout tests" gives the same id as elements[0] "galaxyLayout tests" (${ID}): an id comes from the name alone`
    );
    expect(refused.suggestions).toEqual(["Give one of the two a name that differs in its letters or digits"]);

    const rels = result.relationships.results;
    expect(rels.map((r: any) => r.status)).toEqual(["invalid", "invalid", "invalid", "staged"]);
    expect(rels[0].reason).toBe(
      `Source ${ID} is the id of more than one name: "galaxyLayout tests" (elements[0], which this call adds) and "galaxy-layout tests" (not added)`
    );
    expect(rels[0].suggestions).toEqual([
      'Give "galaxy-layout tests" a name that differs in its letters or digits, then send it and its relationships again',
      'To link "galaxyLayout tests", name it by its name',
    ]);
    expect(rels[1].reason).toContain("is the id of more than one name");
    expect(rels[2].reason).toBe(
      `Source "galaxy-layout tests" was not added: the name gives the id ${ID}, which "galaxyLayout tests" holds (elements[0], which this call adds)`
    );
    // The kept element's own name is unambiguous and still binds.
    expect(rels[3]).toMatchObject({ source: ID, target: SKETCH_A, status: "staged" });
  });

  it("reports links by a contested id when the refused element came first and the kept one later", async () => {
    // Refused for its attributes first; a different name with the same id is then added.
    const result = await add({
      elements: [target("galaxy-layout tests", ""), target("galaxyLayout tests"), sketch("sketch a")],
      relationships: [{ source: ID, predicate: "composes", target: SKETCH_A }],
    });
    expect(result.elements.counts).toEqual({ staged: 2, invalid: 1 });
    expect(result.relationships.results[0]).toMatchObject({ status: "invalid" });
    expect(result.relationships.results[0].reason).toContain(
      '"galaxyLayout tests" (elements[1], which this call adds) and "galaxy-layout tests" (not added)'
    );
  });

  it("reports links by the id of an element already there under another name", async () => {
    await add({ elements: [target("galaxyLayout tests"), sketch("sketch a")] });
    const result = await add({
      elements: [target("galaxy-layout tests")],
      relationships: [
        { source: ID, predicate: "composes", target: SKETCH_A },
        { source: "galaxy-layout tests", predicate: "composes", target: SKETCH_A },
        { source: "galaxyLayout tests", predicate: "composes", target: SKETCH_A },
      ],
    });
    expect(result.elements.results[0].reason).toBe(
      `Element ${ID} already exists, named "galaxyLayout tests": "galaxy-layout tests" gives the same id, so give the new element a name that differs in its letters or digits`
    );
    const rels = result.relationships.results;
    expect(rels.map((r: any) => r.status)).toEqual(["invalid", "invalid", "staged"]);
    expect(rels[0].reason).toContain('"galaxyLayout tests" (which this changeset adds) and "galaxy-layout tests" (not added)');
    expect(rels[1].reason).toContain("was not added");
  });

  it("still links by id when the same name is sent again for an element already there", async () => {
    await add({ elements: [target("galaxyLayout tests"), sketch("sketch a")] });
    const result = await add({
      elements: [target("galaxyLayout tests")],
      relationships: [{ source: ID, predicate: "composes", target: SKETCH_A }],
    });
    // The same element sent again is unchanged (#1296), and a link by its id binds to it.
    expect(result.elements.counts).toEqual({ unchanged: 1 });
    expect(result.relationships.results[0]).toMatchObject({ source: ID, status: "staged" });
  });

  it("leaves relationship_add alone: a later call links the kept element by its id", async () => {
    await add({ elements: [target("galaxyLayout tests"), target("galaxy-layout tests"), sketch("sketch a")] });
    const result = await relate({ relationships: [{ source: ID, predicate: "composes", target: SKETCH_A }] });
    expect(result.results[0]).toMatchObject({ status: "staged" });
  });
});

describe("model_add: a name whose element is held under an earlier rule's id (#1297)", () => {
  /** Writes an element straight into the model under an id an earlier CLI derived. */
  async function seed(layer: string, type: string, id: string, name: string, attributes: Record<string, unknown>) {
    const model = await Model.load(rootPath);
    let layerObj = await model.getLayer(layer);
    if (!layerObj) {
      layerObj = new Layer(layer);
      model.addLayer(layerObj);
    }
    layerObj.addElement(
      new Element({ id: generateUUID(), path: id, spec_node_id: `${layer}.${type}`, layer_id: layer, type, name, attributes, layer })
    );
    await model.saveLayer(layer);
    await model.saveManifest();
    clearModelCache();
  }

  const OLD_STATUS = "data-model.objectschema.tier1status"; // "Tier1Status" before 0.7.0
  const NEW_STATUS = "data-model.objectschema.tier1-status";
  const schema = (name: string, attributes: Record<string, unknown> = { type: "object" }) => ({
    layer: "data-model",
    type: "objectschema",
    name,
    attributes,
  });

  it("reports target-end links by both ids when the name's element is held under an earlier rule's id", async () => {
    await seed("data-model", "objectschema", OLD_STATUS, "Tier1Status", { type: "object" });
    await createChangeset();
    const loader = "application.applicationfunction.loader";
    for (const [refused, why] of [
      [schema("Tier1 Status"), "already exists"],
      [schema("Tier1 Status", {}), "invalid attributes"],
    ] as const) {
      // Refused as the earlier-rule element, and refused for its attributes: links are reported alike.
      clearModelCache();
      const result = await add({
        elements: [{ layer: "application", type: "applicationfunction", name: "loader" }, refused],
        relationships: [
          { source: loader, predicate: "accesses", target: OLD_STATUS },
          { source: loader, predicate: "accesses", target: NEW_STATUS },
          { source: loader, predicate: "accesses", target: "Tier1 Status" },
          { source: loader, predicate: "accesses", target: "Tier1Status" },
        ],
      });
      expect(result.elements.results[1]).toMatchObject({ status: "invalid", reason: expect.stringContaining(why) });
      const rels = result.relationships.results;
      expect(rels.map((r: any) => r.status)).toEqual(["invalid", "invalid", "invalid", expect.stringMatching(/staged|duplicate|unchanged/)]);
      expect(rels[0].reason).toBe(
        `Target ${OLD_STATUS} is the id of more than one name: "Tier1Status" (which the model has) and "Tier1 Status" (not added)`
      );
      expect(rels[1].reason).toBe(
        `Target ${NEW_STATUS} is the id of more than one name: "Tier1Status" (as ${OLD_STATUS}, which the model has) and "Tier1 Status" (not added)`
      );
      expect(rels[2].reason).toContain('Target "Tier1 Status" was not added');
      // By the kept element's own name, the link binds to it.
      expect(rels[3]).toMatchObject({ target: OLD_STATUS });
    }
  });
});
