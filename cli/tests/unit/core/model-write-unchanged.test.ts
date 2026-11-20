import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { Model, sameYamlData } from "../../../src/core/model.js";
import { upgradeModel } from "../../../src/core/model-upgrade.js";

const LONG =
  "A commit refuses a changeset for drift whenever any element in the base changed, which is far more often than the plan and the base actually disagree about anything";

function record(uuid: string, path: string, description?: string) {
  const [layerId, type, name] = path.split(".");
  return { id: uuid, path, spec_node_id: `${layerId}.${type}`, type, layer_id: layerId, name, ...(description ? { description } : {}) };
}

/**
 * A model at spec 0.13.0 whose files are laid out as prettier lays them out (a long scalar on the
 * line after its key), not as dr writes them.
 */
async function writeModel(root: string): Promise<{ goal: string; requirement: string }> {
  const dir = join(root, "documentation-robotics", "model");
  await mkdir(join(dir, "01_motivation"), { recursive: true });
  await writeFile(
    join(dir, "manifest.yaml"),
    YAML.stringify({
      version: "1.0.0",
      schema: "documentation-robotics-v1",
      spec_version: "0.13.0",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      project: { name: "write-unchanged-test", version: "1.0.0" },
    })
  );
  const prettierLayout = (path: string, uuid: string) =>
    `${path}:\n  id: ${uuid}\n  path: ${path}\n  spec_node_id: ${path.split(".").slice(0, 2).join(".")}\n  type: ${path.split(".")[1]}\n  layer_id: motivation\n  name: ${path.split(".")[2]}\n  description:\n    ${LONG.slice(0, 70)}\n    ${LONG.slice(71)}\n`;
  const goal = prettierLayout("motivation.goal.fewer-refusals", "00000000-0000-4000-8000-000000000001");
  const requirement = prettierLayout("motivation.requirement.drift-on-overlap", "00000000-0000-4000-8000-000000000002");
  await writeFile(join(dir, "01_motivation", "goal.yaml"), goal);
  await writeFile(join(dir, "01_motivation", "requirement.yaml"), requirement);
  return { goal, requirement };
}

async function withModel(test: (root: string, files: { goal: string; requirement: string }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "dr-write-unchanged-"));
  try {
    await test(root, await writeModel(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const layerFile = (root: string, file: string) => join(root, "documentation-robotics", "model", "01_motivation", file);

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

  it("an upgrade that only stamps the version changes only the manifest", async () => {
    await withModel(async (root, files) => {
      const result = await upgradeModel(root, { fromVersion: "0.13.0", toVersion: "0.14.0" });
      expect(result.migration!.applied).toHaveLength(1);

      expect(await readFile(layerFile(root, "goal.yaml"), "utf-8")).toBe(files.goal);
      expect(await readFile(layerFile(root, "requirement.yaml"), "utf-8")).toBe(files.requirement);
      const manifest = YAML.parse(await readFile(join(root, "documentation-robotics", "model", "manifest.yaml"), "utf-8"));
      expect(manifest.spec_version).toBe("0.14.0");
    });
  });
});
