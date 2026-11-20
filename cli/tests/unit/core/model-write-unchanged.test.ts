import { describe, expect, it, spyOn } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { Model, planLayerFiles, sameYamlData } from "../../../src/core/model.js";
import { upgradeModel } from "../../../src/core/model-upgrade.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";

const LONG =
  "A commit refuses a changeset for drift whenever any element in the base changed, which is far more often than the plan and the base actually disagree about anything";

function record(uuid: string, path: string, description?: string) {
  const [layerId, type, name] = path.split(".");
  return { id: uuid, path, spec_node_id: `${layerId}.${type}`, type, layer_id: layerId, name, ...(description ? { description } : {}) };
}

type Files = { goal: string; requirement: string; feature: string };

/**
 * A model (at spec 0.13.0 unless told otherwise) with two layers, whose files are laid out as
 * prettier lays them out (a long scalar on the line after its key), not as dr writes them.
 */
async function writeModel(root: string, specVersion: string = "0.13.0"): Promise<Files> {
  const dir = join(root, "documentation-robotics", "model");
  await mkdir(join(dir, "01_motivation"), { recursive: true });
  await mkdir(join(dir, "03_product"), { recursive: true });
  await writeFile(
    join(dir, "manifest.yaml"),
    YAML.stringify({
      version: "1.0.0",
      schema: "documentation-robotics-v1",
      spec_version: specVersion,
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      project: { name: "write-unchanged-test", version: "1.0.0" },
    })
  );
  const prettierLayout = (path: string, uuid: string, attributes: string) =>
    `${path}:\n  id: ${uuid}\n  path: ${path}\n  spec_node_id: ${path.split(".").slice(0, 2).join(".")}\n  type: ${path.split(".")[1]}\n  layer_id: ${path.split(".")[0]}\n  name: ${path.split(".")[2]}\n  description:\n    ${LONG.slice(0, 70)}\n    ${LONG.slice(71)}\n  attributes:\n${attributes}`;
  const goal = prettierLayout("motivation.goal.fewer-refusals", "00000000-0000-4000-8000-000000000001", "    priority: high\n");
  const requirement = prettierLayout(
    "motivation.requirement.drift-on-overlap",
    "00000000-0000-4000-8000-000000000002",
    "    requirementType: functional\n    priority: high\n"
  );
  const feature = prettierLayout(
    "product.feature.drift-check",
    "00000000-0000-4000-8000-000000000003",
    "    priority: high\n    status: delivered\n"
  );
  await writeFile(join(dir, "01_motivation", "goal.yaml"), goal);
  await writeFile(join(dir, "01_motivation", "requirement.yaml"), requirement);
  await writeFile(join(dir, "03_product", "feature.yaml"), feature);
  return { goal, requirement, feature };
}

async function withModel(test: (root: string, files: Files) => Promise<void>, specVersion?: string) {
  const root = await mkdtemp(join(tmpdir(), "dr-write-unchanged-"));
  try {
    await test(root, await writeModel(root, specVersion));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const layerFile = (root: string, file: string) => join(root, "documentation-robotics", "model", "01_motivation", file);
const featureFile = (root: string) => join(root, "documentation-robotics", "model", "03_product", "feature.yaml");

describe("model writes keep files whose data is unchanged (#1246)", () => {
  it("compares YAML by data, not layout", () => {
    expect(sameYamlData("a:\n  long text\n", 'a: "long text"\n', YAML.parse)).toBe(true);
    expect(sameYamlData("b: 1\na: 2\n", "a: 2\nb: 1\n", YAML.parse)).toBe(true);
    expect(sameYamlData("a: 1\n", "a: 2\n", YAML.parse)).toBe(false);
    expect(sameYamlData("a: [unclosed\n", "a: 1\n", YAML.parse)).toBe(false);
  });

  it("the fixture really is in a layout dr would not write", async () => {
    await withModel(async (_root, files) => {
      expect(YAML.stringify(YAML.parse(files.goal))).not.toBe(files.goal);
    });
  });

  it("saving a loaded model rewrites no layer file when nothing changed", async () => {
    await withModel(async (root, files) => {
      const model = await Model.load(root, { lazyLoad: false });
      // Loading leaves the layer dirty, so this does call the writer
      expect(model.layers.get("motivation")!.isDirty()).toBe(true);
      await model.saveDirtyLayers();
      expect(await readFile(layerFile(root, "goal.yaml"), "utf-8")).toBe(files.goal);
      expect(await readFile(layerFile(root, "requirement.yaml"), "utf-8")).toBe(files.requirement);
    });
  });

  it("a change to one element rewrites its type's file and leaves the layer's other files alone", async () => {
    await withModel(async (root, files) => {
      const model = await Model.load(root, { lazyLoad: false });
      const layer = model.layers.get("motivation")!;
      const goal = layer.listElements().find((element) => element.path === "motivation.goal.fewer-refusals")!;
      goal.description = "Shorter now";
      layer.updateElement(goal);
      await model.saveDirtyLayers();

      const written = YAML.parse(await readFile(layerFile(root, "goal.yaml"), "utf-8"));
      expect(written["motivation.goal.fewer-refusals"].description).toBe("Shorter now");
      expect(await readFile(layerFile(root, "requirement.yaml"), "utf-8")).toBe(files.requirement);
    });
  });

  it("still removes the file of a type the layer no longer has", async () => {
    await withModel(async (root, files) => {
      const model = await Model.load(root, { lazyLoad: false });
      const layer = model.layers.get("motivation")!;
      const requirement = layer.listElements().find((element) => element.type === "requirement")!;
      layer.deleteElement(requirement.id);
      await model.saveDirtyLayers();
      expect((await readdir(join(root, "documentation-robotics", "model", "01_motivation"))).sort()).toEqual(["goal.yaml"]);
      expect(await readFile(layerFile(root, "goal.yaml"), "utf-8")).toBe(files.goal);
    });
  });

  it("landing a changeset rewrites the file of the element it changes and no other, in any loaded layer", async () => {
    await withModel(async (root, files) => {
      const model = await Model.load(root, { lazyLoad: false });
      const manager = new StagingAreaManager(root, model);
      const changeset = await manager.create("shorter-goal", "Shorten the goal's description");
      const goal = model.layers.get("motivation")!.listElements().find((element) => element.type === "goal")!;
      const before = goal.toJSON() as unknown as Record<string, unknown>;
      await manager.stage(changeset.id!, {
        type: "update",
        elementId: "motivation.goal.fewer-refusals",
        layerName: "motivation",
        before,
        after: { ...before, description: "Shorter now" },
      });

      const result = await manager.commit(await Model.load(root, { lazyLoad: false }), changeset.id!, { validate: false });
      expect(result.committed).toBe(1);

      const landed = YAML.parse(await readFile(layerFile(root, "goal.yaml"), "utf-8"));
      expect(landed["motivation.goal.fewer-refusals"].description).toBe("Shorter now");
      // Same layer, another type; and another layer: both loaded, both dirty, neither written
      expect(await readFile(layerFile(root, "requirement.yaml"), "utf-8")).toBe(files.requirement);
      expect(await readFile(featureFile(root), "utf-8")).toBe(files.feature);
    }, getCliBundledSpecVersion());
  });

  it("model_add to one layer leaves the other loaded layers' files, and its own layer's other types, alone", async () => {
    await withModel(async (root, files) => {
      clearModelCache();
      try {
        // The MCP server loads every layer; no changeset is active, so this writes the base model
        const result = await modelAddHandler({
          rootPath: root,
          layer: "motivation",
          type: "goal",
          name: "Reviewable diffs",
          attributes: { priority: "medium" },
        });
        expect(result.isError).toBeFalsy();
      } finally {
        clearModelCache();
      }

      const goals = YAML.parse(await readFile(layerFile(root, "goal.yaml"), "utf-8"));
      expect(Object.keys(goals).sort()).toEqual(["motivation.goal.fewer-refusals", "motivation.goal.reviewable-diffs"]);
      expect(await readFile(layerFile(root, "requirement.yaml"), "utf-8")).toBe(files.requirement);
      expect(await readFile(featureFile(root), "utf-8")).toBe(files.feature);
    }, getCliBundledSpecVersion());
  });

  it("an upgrade that only stamps the version changes only the manifest", async () => {
    await withModel(async (root, files) => {
      const result = await upgradeModel(root, { fromVersion: "0.13.0", toVersion: "0.14.0" });
      expect(result.migration!.applied).toHaveLength(1);

      expect(await readFile(layerFile(root, "goal.yaml"), "utf-8")).toBe(files.goal);
      expect(await readFile(layerFile(root, "requirement.yaml"), "utf-8")).toBe(files.requirement);
      expect(await readFile(featureFile(root), "utf-8")).toBe(files.feature);
      const manifest = YAML.parse(await readFile(join(root, "documentation-robotics", "model", "manifest.yaml"), "utf-8"));
      expect(manifest.spec_version).toBe("0.14.0");
    });
  });
});

describe("a layer file named in another letter case is never deleted by a save (PR 1266 review)", () => {
  it("plans a rename for a case variant of a wanted file, and treats it as stale only beside the exact name", () => {
    // What a case-insensitive filesystem lists: the variant alone. It is the wanted file.
    expect(planLayerFiles(["Goal.yaml", "requirement.yaml"], ["goal.yaml", "requirement.yaml"])).toEqual({
      renames: [["Goal.yaml", "goal.yaml"]],
      stale: [],
    });
    // Only a case-sensitive filesystem lists both: there the variant is a different, stale file.
    expect(planLayerFiles(["Goal.yaml", "goal.yaml"], ["goal.yaml"])).toEqual({ renames: [], stale: ["Goal.yaml"] });
    // Two variants and no exact name: one becomes the wanted file, the other is stale.
    expect(planLayerFiles(["GOAL.yaml", "Goal.yaml"], ["goal.yaml"])).toEqual({
      renames: [["GOAL.yaml", "goal.yaml"]],
      stale: ["Goal.yaml"],
    });
    // A type the layer no longer has, and another extension, are stale; exact names are neither.
    expect(planLayerFiles(["goal.yaml", "driver.yaml", "elements.yml"], ["goal.yaml"])).toEqual({
      renames: [],
      stale: ["driver.yaml", "elements.yml"],
    });
    expect(planLayerFiles([], ["goal.yaml"])).toEqual({ renames: [], stale: [] });
  });

  const motivationDir = (root: string) => join(root, "documentation-robotics", "model", "01_motivation");

  /** The goal's file under a capitalised name: on macOS and Windows that is the file `goal.yaml` names */
  async function capitalise(root: string): Promise<void> {
    await rename(join(motivationDir(root), "goal.yaml"), join(motivationDir(root), "Goal.yaml"));
    expect((await readdir(motivationDir(root))).sort()).toEqual(["Goal.yaml", "requirement.yaml"]);
  }

  it("keeps the type's data when nothing changed (runs on whatever filesystem the tests are on)", async () => {
    await withModel(async (root, files) => {
      await capitalise(root);
      const model = await Model.load(root, { lazyLoad: false });
      await model.saveDirtyLayers();

      // The file has the writer's name, and its bytes: renamed, not rewritten, never removed
      expect((await readdir(motivationDir(root))).sort()).toEqual(["goal.yaml", "requirement.yaml"]);
      expect(await readFile(layerFile(root, "goal.yaml"), "utf-8")).toBe(files.goal);
      const reloaded = await Model.load(root, { lazyLoad: false });
      expect(reloaded.layers.get("motivation")!.listElements().map((element) => element.path).sort()).toEqual([
        "motivation.goal.fewer-refusals",
        "motivation.requirement.drift-on-overlap",
      ]);
    });
  });

  it("keeps the type's data when an element in it changed", async () => {
    await withModel(async (root) => {
      await capitalise(root);
      const model = await Model.load(root, { lazyLoad: false });
      const layer = model.layers.get("motivation")!;
      const goal = layer.listElements().find((element) => element.type === "goal")!;
      goal.description = "Shorter now";
      layer.updateElement(goal);
      await model.saveDirtyLayers();

      expect((await readdir(motivationDir(root))).sort()).toEqual(["goal.yaml", "requirement.yaml"]);
      const written = YAML.parse(await readFile(layerFile(root, "goal.yaml"), "utf-8"));
      expect(written["motivation.goal.fewer-refusals"].description).toBe("Shorter now");
    });
  });

  it("still removes a legacy file of another name once its elements are in their types' files", async () => {
    await withModel(async (root) => {
      // An older layout: every element of the layer in one elements.yaml
      const dir = motivationDir(root);
      const all = { ...YAML.parse(await readFile(join(dir, "goal.yaml"), "utf-8")), ...YAML.parse(await readFile(join(dir, "requirement.yaml"), "utf-8")) };
      await rm(join(dir, "goal.yaml"));
      await rm(join(dir, "requirement.yaml"));
      await writeFile(join(dir, "elements.yaml"), YAML.stringify(all));

      const model = await Model.load(root, { lazyLoad: false });
      await model.saveDirtyLayers();
      expect((await readdir(dir)).sort()).toEqual(["goal.yaml", "requirement.yaml"]);
      const reloaded = await Model.load(root, { lazyLoad: false });
      expect(reloaded.layers.get("motivation")!.listElements()).toHaveLength(2);
    });
  });
});

describe("a save removes or replaces only files whose every entry the model loaded (PR 1266 re-review)", () => {
  const motivationDir = (root: string) => join(root, "documentation-robotics", "model", "01_motivation");

  /** Change the goal's description and save, as `dr update` does */
  async function editGoalAndSave(root: string): Promise<void> {
    const model = await Model.load(root, { lazyLoad: false });
    const layer = model.layers.get("motivation")!;
    const goal = layer.listElements().find((element) => element.path === "motivation.goal.fewer-refusals")!;
    goal.description = "Edited";
    layer.updateElement(goal);
    await model.saveDirtyLayers();
  }

  it.serial("keeps a file that holds something other than elements, and says so", async () => {
    await withModel(async (root) => {
      await writeFile(join(motivationDir(root), "notes.yaml"), "Just a note the team keeps here\n");
      await writeFile(join(motivationDir(root), "mixed.yaml"), "owner: platform-team\n");
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        await editGoalAndSave(root);
        expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
          "kept 01_motivation/notes.yaml: it holds content that is not a model element"
        );
      } finally {
        warn.mockRestore();
      }
      expect(await readFile(join(motivationDir(root), "notes.yaml"), "utf-8")).toBe("Just a note the team keeps here\n");
      expect(await readFile(join(motivationDir(root), "mixed.yaml"), "utf-8")).toBe("owner: platform-team\n");
    }, getCliBundledSpecVersion());
  });

  it.serial("keeps a file that did not parse when the model was loaded", async () => {
    await withModel(async (root) => {
      const broken =
        "motivation.goal.hand-added:\n  id: 00000000-0000-4000-8000-000000000009\n  path: motivation.goal.hand-added\n  name: [unclosed\n";
      await writeFile(join(motivationDir(root), "hand-added.yaml"), broken);
      const error = spyOn(console, "error").mockImplementation(() => {});
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        await editGoalAndSave(root);
        expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
          "kept 01_motivation/hand-added.yaml: it did not parse when the model was loaded"
        );
      } finally {
        error.mockRestore();
        warn.mockRestore();
      }
      expect(await readFile(join(motivationDir(root), "hand-added.yaml"), "utf-8")).toBe(broken);
      const goals = YAML.parse(await readFile(layerFile(root, "goal.yaml"), "utf-8"));
      expect(goals["motivation.goal.fewer-refusals"].description).toBe("Edited");
    }, getCliBundledSpecVersion());
  });

  it.serial("refuses to write over a file that did not parse, rather than lose what it holds", async () => {
    await withModel(async (root) => {
      // goal.yaml itself is broken: its goal was never loaded, and the save would replace the file
      const broken = "motivation.goal.lost-one:\n  name: [unclosed\n";
      await writeFile(layerFile(root, "goal.yaml"), broken);
      await writeFile(
        join(motivationDir(root), "goal-extra.yaml"),
        YAML.stringify({
          "motivation.goal.other": {
            id: "00000000-0000-4000-8000-000000000008",
            path: "motivation.goal.other",
            spec_node_id: "motivation.goal",
            type: "goal",
            layer_id: "motivation",
            name: "other",
            attributes: { priority: "low" },
          },
        })
      );
      const error = spyOn(console, "error").mockImplementation(() => {});
      try {
        const model = await Model.load(root, { lazyLoad: false });
        const layer = model.layers.get("motivation")!;
        const goal = layer.listElements().find((element) => element.path === "motivation.goal.other")!;
        goal.description = "Edited";
        layer.updateElement(goal);
        await expect(model.saveDirtyLayers()).rejects.toThrow(
          "writing 01_motivation/goal.yaml would lose data, because it did not parse"
        );
      } finally {
        error.mockRestore();
      }
      expect(await readFile(layerFile(root, "goal.yaml"), "utf-8")).toBe(broken);
    }, getCliBundledSpecVersion());
  });

  it.serial("keeps a file added after the model was loaded", async () => {
    await withModel(async (root) => {
      const model = await Model.load(root, { lazyLoad: false });
      const later = YAML.stringify({ "motivation.goal.later": { id: "x", path: "motivation.goal.later", name: "later" } });
      await writeFile(join(motivationDir(root), "added-later.yaml"), later);
      const layer = model.layers.get("motivation")!;
      const goal = layer.listElements().find((element) => element.path === "motivation.goal.fewer-refusals")!;
      goal.description = "Edited";
      layer.updateElement(goal);
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        await model.saveDirtyLayers();
      } finally {
        warn.mockRestore();
      }
      expect(await readFile(join(motivationDir(root), "added-later.yaml"), "utf-8")).toBe(later);
    }, getCliBundledSpecVersion());
  });

  it("loads a file with an upper-case extension, and a save keeps every element it held", async () => {
    await withModel(async (root, files) => {
      const goals: Record<string, unknown> = YAML.parse(files.goal);
      for (const name of ["second", "third"]) {
        const path = `motivation.goal.${name}`;
        goals[path] = {
          id: `00000000-0000-4000-8000-00000000001${name.length}`,
          path,
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name,
          attributes: { priority: "low" },
        };
      }
      await rm(layerFile(root, "goal.yaml"));
      await writeFile(join(motivationDir(root), "GOAL.YAML"), YAML.stringify(goals));

      const model = await Model.load(root, { lazyLoad: false });
      expect(model.layers.get("motivation")!.listElements().filter((element) => element.type === "goal")).toHaveLength(3);
      await editGoalAndSave(root);

      const names = (await readdir(motivationDir(root))).filter((file) => file.toLowerCase() === "goal.yaml");
      expect(names).toEqual(["goal.yaml"]);
      const saved = YAML.parse(await readFile(layerFile(root, "goal.yaml"), "utf-8"));
      expect(Object.keys(saved).sort()).toEqual([
        "motivation.goal.fewer-refusals",
        "motivation.goal.second",
        "motivation.goal.third",
      ]);
      expect(saved["motivation.goal.fewer-refusals"].description).toBe("Edited");
    }, getCliBundledSpecVersion());
  });

  it("still removes a type's file when its last element is deleted", async () => {
    await withModel(async (root) => {
      const model = await Model.load(root, { lazyLoad: false });
      const layer = model.layers.get("motivation")!;
      layer.deleteElement(layer.listElements().find((element) => element.type === "requirement")!.id);
      await model.saveDirtyLayers();
      expect((await readdir(motivationDir(root))).sort()).toEqual(["goal.yaml"]);
    }, getCliBundledSpecVersion());
  });
});
