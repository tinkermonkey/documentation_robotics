import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "yaml";
import { stringifyDrYaml } from "../../../src/core/dr-yaml.js";
import { filesALandingRelaysOut, landingRelayoutNote, relayoutModelFiles } from "../../../src/core/model-relayout.js";
import type { Change } from "../../../src/core/changeset.js";

const LONG = "A description long enough that yaml's default writer folds it at eighty columns, as dr 0.7 did";

function element(path: string, type: string, layer: string) {
  return { id: `${path}-uuid`, path, spec_node_id: `${layer}.${type}`, type, layer_id: layer, name: path, description: LONG };
}

/** Runs a test in a project of its own (the unit suite runs tests concurrently). */
async function withProject(test: (root: string, motivation: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "dr-relayout-"));
  const motivation = join(root, "documentation-robotics/model/01_motivation");
  await mkdir(motivation, { recursive: true });
  try {
    await test(root, motivation);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** A project with a goal file and a driver file as dr 0.7 wrote them (folded at 80 columns). */
async function withFoldedProject(test: (root: string) => Promise<void>): Promise<void> {
  await withProject(async (root, motivation) => {
    await writeFile(join(motivation, "goal.yaml"), yaml.stringify({ "motivation.goal.a": element("motivation.goal.a", "goal", "motivation") }));
    await writeFile(join(motivation, "driver.yaml"), yaml.stringify({ "motivation.driver.b": element("motivation.driver.b", "driver", "motivation") }));
    await test(root);
  });
}

describe("relayoutModelFiles (#1439)", () => {
  it("lists the files not in dr's layout with dryRun, then lays them out, data unchanged", () => withProject(async (root, motivation) => {
    const goals = { "motivation.goal.a": element("motivation.goal.a", "goal", "motivation") };
    await writeFile(join(motivation, "goal.yaml"), yaml.stringify(goals));
    await writeFile(join(motivation, "driver.yaml"), stringifyDrYaml({ "motivation.driver.b": element("motivation.driver.b", "driver", "motivation") }));

    const dry = await relayoutModelFiles(root, { dryRun: true });
    expect(dry).toEqual({ total: 2, files: ["documentation-robotics/model/01_motivation/goal.yaml"], skipped: [] });
    expect(await readFile(join(motivation, "goal.yaml"), "utf8")).toBe(yaml.stringify(goals));

    const done = await relayoutModelFiles(root);
    expect(done.files).toEqual(dry.files);
    expect(await readFile(join(motivation, "goal.yaml"), "utf8")).toBe(stringifyDrYaml(goals));
    expect((await relayoutModelFiles(root, { dryRun: true })).files).toEqual([]);
  }));

  it("leaves a file that does not parse alone, and says so", () => withProject(async (root, motivation) => {
    await writeFile(join(motivation, "goal.yaml"), "a: [unclosed\n");
    const result = await relayoutModelFiles(root);
    expect(result.files).toEqual([]);
    expect(result.skipped[0].file).toBe("documentation-robotics/model/01_motivation/goal.yaml");
    expect(result.skipped[0].reason).toContain("does not parse");
  }));

  it("does nothing for a project with no model", () => withProject(async (root) => {
    await rm(join(root, "documentation-robotics"), { recursive: true });
    expect(await relayoutModelFiles(root)).toEqual({ total: 0, files: [], skipped: [] });
  }));
});

describe("the files a landing would lay out anew (#1439)", () => {
  it("names the file holding an element the landing updates, and the file of a type it adds to", () => withFoldedProject(async (root) => {
    const update: Change = { type: "update", elementId: "motivation.goal.a", layerName: "motivation" };
    expect(await filesALandingRelaysOut(root, [update])).toEqual(["documentation-robotics/model/01_motivation/goal.yaml"]);

    const add: Change = {
      type: "add",
      elementId: "motivation.driver.new",
      layerName: "motivation",
      after: { id: "x", path: "motivation.driver.new", type: "driver", spec_node_id: "motivation.driver" },
    };
    expect(await filesALandingRelaysOut(root, [add])).toEqual(["documentation-robotics/model/01_motivation/driver.yaml"]);
  }));

  it("ignores relationship changes, which only rewrite relationships.yaml", () => withFoldedProject(async (root) => {
    const rel: Change = { type: "relationship-add", elementId: "motivation.goal.a::influences::motivation.driver.b", layerName: "motivation" };
    expect(await filesALandingRelaysOut(root, [rel])).toEqual([]);
    expect(await landingRelayoutNote(root, [rel])).toBeNull();
  }));

  it("says how many it would lay out, names them, and points at project_upgrade", () => withFoldedProject(async (root) => {
    const note = await landingRelayoutNote(root, [{ type: "delete", elementId: "motivation.driver.b", layerName: "motivation" }]);
    expect(note).toContain("lays out 1 model file(s) an earlier dr wrote");
    expect(note).toContain("documentation-robotics/model/01_motivation/driver.yaml");
    expect(note).toContain("project_upgrade with relayout: true first");
  }));
});
