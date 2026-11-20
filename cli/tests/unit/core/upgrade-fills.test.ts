import { describe, it, expect } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import YAML from "yaml";
import { Model } from "../../../src/core/model.js";
import { upgradeModel } from "../../../src/core/model-upgrade.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";
import { camelCaseOf, deriveFills, firstSentence } from "../../../src/core/upgrade-fills.js";
import { unfilledRequired, validateBaseModel, withoutStaged } from "../../../src/core/upgrade-validation.js";
import { rehearseModelUpgrade } from "../../../src/core/upgrade-rehearsal.js";

const modelDir = (root: string) => join(root, "documentation-robotics", "model");

function operation(uuid: string, name: string, extra: { description?: string; attributes?: Record<string, unknown> } = {}) {
  const path = `api.operation.${name}`;
  return {
    [path]: {
      id: uuid,
      path,
      spec_node_id: "api.operation",
      type: "operation",
      layer_id: "api",
      name: name
        .split("-")
        .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
        .join(" "),
      ...(extra.description ? { description: extra.description } : {}),
      ...(extra.attributes ? { attributes: extra.attributes } : {}),
    },
  };
}

/**
 * A model one spec version behind whose API operations lack attributes the spec requires:
 * create-order has none of them, get-order has all, list-orders lacks the operationId another
 * operation already uses.
 */
async function writeModel(root: string): Promise<void> {
  await mkdir(join(modelDir(root), "07_api"), { recursive: true });
  await writeFile(
    join(modelDir(root), "manifest.yaml"),
    YAML.stringify({
      version: "1.0.0",
      schema: "documentation-robotics-v1",
      spec_version: "0.13.0",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      project: { name: "upgrade-fills-test", version: "1.0.0" },
    })
  );
  await writeFile(
    join(modelDir(root), "07_api", "operation.yaml"),
    YAML.stringify({
      ...operation("00000000-0000-4000-8000-000000000001", "create-order", {
        description: "Creates an order for the signed-in customer. It reserves stock first.",
      }),
      ...operation("00000000-0000-4000-8000-000000000002", "get-order", {
        attributes: { operationId: "listOrders", summary: "Get one order", tags: "orders" },
      }),
      ...operation("00000000-0000-4000-8000-000000000003", "list-orders", {
        attributes: { summary: "List orders", tags: "orders" },
      }),
    })
  );
}

async function withModel(test: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "dr-upgrade-fills-"));
  try {
    await writeModel(root);
    await test(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("upgrade fills (#1166)", () => {
  it("turns names into camelCase and takes a description's first sentence", () => {
    expect(camelCaseOf("create-order")).toBe("createOrder");
    expect(camelCaseOf("Get_Order by-ID")).toBe("getOrderByID");
    expect(camelCaseOf("---")).toBeUndefined();
    expect(camelCaseOf("2fa-verify")).toBeUndefined();
    expect(firstSentence("Creates an order.\nThen more.")).toBe("Creates an order.");
    expect(firstSentence("  no full stop  ")).toBe("no full stop");
    expect(firstSentence("")).toBeUndefined();
  });

  it("derives only what follows from the element, and leaves the rest listed", async () => {
    await withModel(async (root) => {
      const model = await Model.load(root, { lazyLoad: false });
      const unfilled = unfilledRequired((await validateBaseModel(model)).errors);
      const { fills, left } = deriveFills(model, unfilled);

      expect(fills).toEqual([
        {
          elementId: "api.operation.create-order",
          layer: "api",
          attribute: "operationId",
          value: "createOrder",
          rule: "operationId: the element's name in camelCase",
        },
        {
          elementId: "api.operation.create-order",
          layer: "api",
          attribute: "summary",
          value: "Creates an order for the signed-in customer.",
          rule: "summary: the first sentence of the element's description, else its name",
        },
      ]);
      // tags has no derivation; list-orders' operationId would repeat get-order's, so it isn't derived
      expect(left).toEqual([
        { elementId: "api.operation.create-order", layer: "api", attributes: ["tags"] },
        { elementId: "api.operation.list-orders", layer: "api", attributes: ["operationId"] },
      ]);
      expect(withoutStaged(unfilled, fills)).toEqual(left);
    });
  });

  it("stages the derived values in a changeset on upgrade and writes none to the base model", async () => {
    await withModel(async (root) => {
      const operationsBefore = await readFile(join(modelDir(root), "07_api", "operation.yaml"), "utf-8");
      const result = await upgradeModel(root, { fromVersion: "0.13.0", toVersion: "0.14.0" });

      expect(result.fills).toMatchObject({ name: "upgrade-fills-0.14.0", count: 2, elements: 1 });
      expect(result.fills!.error).toBeUndefined();
      expect(result.unfilled).toEqual([
        { elementId: "api.operation.create-order", layer: "api", attributes: ["tags"] },
        { elementId: "api.operation.list-orders", layer: "api", attributes: ["operationId"] },
      ]);
      // The base model still fails validation on all four: nothing was filled in
      expect(result.validationErrors).toHaveLength(4);
      expect(await readFile(join(modelDir(root), "07_api", "operation.yaml"), "utf-8")).toBe(operationsBefore);

      const changeset = await new StagedChangesetStorage(root).load(result.fills!.id!);
      expect(changeset).toMatchObject({ name: "upgrade-fills-0.14.0", status: "staged", purpose: "plan" });
      expect(changeset!.origin).toEqual({ kind: "upgrade", detail: "spec 0.13.0 -> 0.14.0" });
      expect(changeset!.description).toContain("Nothing here is in the base model yet");
      expect(changeset!.changes).toHaveLength(1);
      const [change] = changeset!.changes;
      expect(change).toMatchObject({ type: "update", elementId: "api.operation.create-order", layerName: "api" });
      expect((change.before as { attributes?: unknown }).attributes).toBeUndefined();
      expect((change.after as { attributes: unknown }).attributes).toEqual({
        operationId: "createOrder",
        summary: "Creates an order for the signed-in customer.",
      });
      expect(change.origin).toMatchObject({ by: "upgrade" });
      expect(change.origin!.rule).toContain("operationId: the element's name in camelCase");
    });
  });

  it("lands like any plan: the reviewed values reach the base model on commit", async () => {
    await withModel(async (root) => {
      const result = await upgradeModel(root, { fromVersion: "0.13.0", toVersion: "0.14.0" });

      const model = await Model.load(root, { lazyLoad: false });
      const manager = new StagingAreaManager(root, model);
      // The base still has other errors (tags, list-orders' operationId): force past validation
      await manager.commit(model, result.fills!.id!, { validate: false });

      const reloaded = await Model.load(root, { lazyLoad: false });
      const created = reloaded.layers.get("api")!.listElements().find((el) => el.path === "api.operation.create-order")!;
      expect(created.attributes).toMatchObject({ operationId: "createOrder", summary: "Creates an order for the signed-in customer." });
    });
  });

  it("a second run stages nothing the first run's unlanded changeset already holds", async () => {
    await withModel(async (root) => {
      const first = await upgradeModel(root, { fromVersion: "0.13.0", toVersion: "0.14.0" });
      expect(first.fills!.name).toBe("upgrade-fills-0.14.0");
      expect(first.stagedEarlier).toBeUndefined();

      // The same upgrade again (a re-run after a failure further on, or with --force)
      const second = await upgradeModel(root, { fromVersion: "0.13.0", toVersion: "0.14.0" });
      expect(second.fills).toBeUndefined();
      expect(second.stagedEarlier).toEqual([
        {
          changeset: "upgrade-fills-0.14.0",
          fills: [
            { elementId: "api.operation.create-order", attribute: "operationId" },
            { elementId: "api.operation.create-order", attribute: "summary" },
          ],
        },
      ]);
      // What is left empty is the same list: the staged values are not on it, and not counted twice
      expect(second.unfilled).toEqual(first.unfilled);
      const staged = (await new StagedChangesetStorage(root).list()).map((changeset) => changeset.name);
      expect(staged).toEqual(["upgrade-fills-0.14.0"]);
    });
  });

  it("once the first changeset lands, a later run has nothing staged earlier and nothing to derive again", async () => {
    await withModel(async (root) => {
      const first = await upgradeModel(root, { fromVersion: "0.13.0", toVersion: "0.14.0" });
      const model = await Model.load(root, { lazyLoad: false });
      await new StagingAreaManager(root, model).commit(model, first.fills!.id!, { validate: false });

      const later = await upgradeModel(root, { fromVersion: "0.13.0", toVersion: "0.14.0" });
      expect(later.fills).toBeUndefined();
      expect(later.stagedEarlier).toBeUndefined();
      expect(later.unfilled).toEqual(first.unfilled);
    });
  });

  it("derives nothing when the spec version doesn't change, or when told not to", async () => {
    await withModel(async (root) => {
      // A catalog-only pass at the same version lists what is empty and stages nothing
      const sameVersion = await upgradeModel(root, { fromVersion: "0.14.0", toVersion: "0.14.0", catalogOnly: true });
      expect(sameVersion.fills).toBeUndefined();
      expect(sameVersion.unfilled!.map((item) => item.elementId)).toEqual([
        "api.operation.create-order",
        "api.operation.list-orders",
      ]);

      const optedOut = await upgradeModel(root, { fromVersion: "0.13.0", toVersion: "0.14.0", stageFills: false });
      expect(optedOut.fills).toBeUndefined();
      expect(await new StagedChangesetStorage(root).list()).toEqual([]);
    });
  });

  it("a rehearsal reports the same fills and files without writing the project", async () => {
    await withModel(async (root) => {
      const manifestBefore = await readFile(join(modelDir(root), "manifest.yaml"), "utf-8");
      const rehearsal = await rehearseModelUpgrade(root, { fromVersion: "0.13.0", toVersion: "0.14.0" });

      expect(rehearsal.modelFiles).toEqual({
        modified: ["documentation-robotics/model/manifest.yaml"],
        added: [],
        removed: [],
      });
      expect(rehearsal.result.fills).toMatchObject({ name: "upgrade-fills-0.14.0", count: 2 });
      // The new changeset's files are named by the changeset, not by the copy's throwaway id
      expect(rehearsal.otherFiles.added).toEqual([
        "documentation-robotics/changesets/<new: upgrade-fills-0.14.0>/base-index.json",
        "documentation-robotics/changesets/<new: upgrade-fills-0.14.0>/changes.yaml",
        "documentation-robotics/changesets/<new: upgrade-fills-0.14.0>/metadata.yaml",
      ]);
      expect(rehearsal.otherFiles.modified).toEqual([]);

      // The project itself is untouched: same manifest, no changesets folder
      expect(await readFile(join(modelDir(root), "manifest.yaml"), "utf-8")).toBe(manifestBefore);
      expect(await new StagedChangesetStorage(root).list()).toEqual([]);
    });
  });
});
