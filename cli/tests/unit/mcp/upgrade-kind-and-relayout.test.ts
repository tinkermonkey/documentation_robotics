/**
 * project_status and project_upgrade say when a migration changes nothing but the manifest
 * (#1435), and project_upgrade lays out model files an earlier dr wrote as a step of its own, which
 * changeset_commit_preview points to when a landing would do it (#1439).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "yaml";
import { Model } from "../../../src/core/model.js";
import { MigrationRegistry } from "../../../src/core/migration-registry.js";
import { stringifyDrYaml } from "../../../src/core/dr-yaml.js";
import { resetProjectRoot } from "../../../src/mcp/project-root.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { projectUpgradeHandler } from "../../../src/mcp/tools/project-tools.js";
import { projectStatus } from "../../../src/mcp/tools/project-status.js";
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetCommitPreviewHandler } from "../../../src/mcp/tools/changeset-commit.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";

let dir: string;

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

async function setSpecVersion(root: string, version: string): Promise<void> {
  const file = join(root, "documentation-robotics/model/manifest.yaml");
  const manifest = yaml.parse(await readFile(file, "utf8"));
  manifest.spec_version = version;
  await writeFile(file, stringifyDrYaml(manifest));
}

const LONG =
  "Exports every project, archived ones too, under one stamped folder, and reports the ones that failed to export";
const GOAL = "motivation.goal.export-everything";

/** A goal file as dr 0.7 wrote it: its long description folded at 80 columns. */
async function writeFoldedGoal(root: string): Promise<string> {
  const file = join(root, "documentation-robotics/model/01_motivation/goal.yaml");
  const data = {
    [GOAL]: {
      id: "00000000-0000-4000-8000-0000000000a1",
      path: GOAL,
      spec_node_id: "motivation.goal",
      type: "goal",
      layer_id: "motivation",
      name: "Export everything",
      description: LONG,
      attributes: { priority: "high" },
    },
  };
  const folded = yaml.stringify(data); // yaml's default folds at 80 columns
  expect(folded).not.toBe(stringifyDrYaml(data));
  await writeFile(file, folded);
  return file;
}

beforeEach(async () => {
  dir = join(tmpdir(), `dr-upgrade-kind-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  clearModelCache();
  resetProjectRoot();
});

afterEach(async () => {
  resetProjectRoot();
  clearModelCache();
  await rm(dir, { recursive: true, force: true });
});

describe("migration kind (#1435)", () => {
  it("the registry calls a path of version stamps manifest-only, and one with a catalog step model", () => {
    const registry = new MigrationRegistry();
    expect(registry.migrationKind("0.14.0", "0.15.0")).toBe("manifest-only");
    // 0.16.0 rewrites application interfaces' protocol and interfaceType (Context Studio 43f52ae5)
    expect(registry.migrationKind("0.15.0", "0.16.0")).toBe("model");
    expect(registry.migrationKind("0.5.0", "0.8.4")).toBe("manifest-only");
    expect(registry.migrationKind("0.13.0", "0.15.0")).toBe("model");
    expect(registry.migrationKind("0.8.4", "0.9.0")).toBe("model");
    expect(registry.migrationKind("0.4.0", "0.15.0")).toBeNull();
    expect(registry.migrationKind(getCliBundledSpecVersion())).toBeNull();
  });

  it("project_status says a pending version stamp changes nothing in the model", async () => {
    await Model.init(dir, { name: "Stamp", version: "0.1.0" });
    const previous = new MigrationRegistry().getMigrationPath("0.5.0").at(-1)!;
    await setSpecVersion(dir, previous.fromVersion);

    const status: any = await projectStatus({ rootPath: dir }, { git: async () => "" });
    expect(status.spec.status).toBe("behind");
    expect(status.spec.migration.kind).toBe(previous.stampsOnly ? "manifest-only" : "model");
    if (previous.stampsOnly) {
      expect(status.nextStep.tool).toBe("project_upgrade");
      expect(status.nextStep.summary).toContain("nothing in the model changes but spec_version");
    }
  });

  it("project_status calls a path with a catalog step model", async () => {
    await Model.init(dir, { name: "Catalog", version: "0.1.0" });
    await setSpecVersion(dir, "0.13.0");
    const status: any = await projectStatus({ rootPath: dir }, { git: async () => "" });
    expect(status.spec.migration.kind).toBe("model");
    expect(status.nextStep.summary).not.toContain("nothing in the model changes");
  });

  it("project_upgrade's preview reads the kind off its rehearsal: manifest-only when only the manifest is written", async () => {
    await Model.init(dir, { name: "Stamp", version: "0.1.0" });
    // Even across a catalog step, a model it rewrites nothing in gets only the version stamp
    await setSpecVersion(dir, "0.13.0");
    const preview = parse(await projectUpgradeHandler({ rootPath: dir }));
    expect(preview.status).toBe("preview");
    expect(preview.wouldWrite.modelFiles.modified).toEqual(["documentation-robotics/model/manifest.yaml"]);
    expect(preview.migration.kind).toBe("manifest-only");
    expect(preview.migration.note).toContain("Nothing in the model changes but spec_version");
    expect(preview.next).toContain("changes nothing in their model but its spec version");
  });

  it("project_upgrade's preview calls a migration that stages derived values model", async () => {
    await Model.init(dir, { name: "Fills", version: "0.1.0" });
    await setSpecVersion(dir, "0.13.0");
    // An operation without its required attributes: the upgrade derives some and stages them
    await mkdir(join(dir, "documentation-robotics/model/07_api"), { recursive: true });
    await writeFile(
      join(dir, "documentation-robotics/model/07_api/operation.yaml"),
      stringifyDrYaml({
        "api.operation.create-order": {
          id: "00000000-0000-4000-8000-000000000001",
          path: "api.operation.create-order",
          spec_node_id: "api.operation",
          type: "operation",
          layer_id: "api",
          name: "Create order",
          description: "Creates an order.",
        },
      })
    );
    const preview = parse(await projectUpgradeHandler({ rootPath: dir }));
    expect(preview.migration.kind).toBe("model");
    expect(preview.next).not.toContain("changes nothing in their model");
  });
});

describe("relayout as an upgrade step (#1439)", () => {
  it("only counts them without relayout: an upgrade writes no model file whose data does not change", async () => {
    await Model.init(dir, { name: "Folded", version: "0.1.0" });
    const goal = await writeFoldedGoal(dir);
    const before = await readFile(goal, "utf8");

    // The spec reference is still to install: a preview, with no relayout step in it
    const preview = parse(await projectUpgradeHandler({ rootPath: dir }));
    expect(preview.actions.some((action: any) => action.type === "relayout")).toBe(false);
    expect(preview.relayout).toMatchObject({ count: 1, files: ["documentation-robotics/model/01_motivation/goal.yaml"] });
    expect(preview.relayout.note).toContain("relayout: true");

    const applied = parse(await projectUpgradeHandler({ rootPath: dir, apply: true, modelOnly: true }));
    expect(applied.status).toBe("applied");
    expect(await readFile(goal, "utf8")).toBe(before);

    // With nothing else to do, the up-to-date result names the call
    clearModelCache();
    const status = parse(await projectUpgradeHandler({ rootPath: dir }));
    expect(status.status).toBe("up-to-date");
    expect(status.relayout.count).toBe(1);
    expect(status.next).toContain("relayout: true");
  });

  it("with relayout: true, previews, then lays out, files an earlier dr wrote on a model already on this spec", async () => {
    await Model.init(dir, { name: "Folded", version: "0.1.0" });
    const goal = await writeFoldedGoal(dir);
    const before = await readFile(goal, "utf8");

    const preview = parse(await projectUpgradeHandler({ rootPath: dir, relayout: true }));
    expect(preview.status).toBe("preview");
    expect(preview.relayout).toMatchObject({ count: 1, dataUnchanged: true });
    expect(preview.relayout.note).toContain("The relayout step lays out these 1 file(s) as this dr writes them, data unchanged");
    const relayout = preview.actions.find((action: any) => action.type === "relayout");
    expect(relayout.description).toContain("Lay out 1 model file(s)");
    expect(relayout.details).toContain("documentation-robotics/model/01_motivation/goal.yaml");
    expect(await readFile(goal, "utf8")).toBe(before);

    const applied = parse(await projectUpgradeHandler({ rootPath: dir, apply: true, modelOnly: true, relayout: true }));
    expect(applied.status).toBe("applied");
    expect(applied.applied).toContainEqual(expect.objectContaining({ type: "relayout", files: 1 }));
    expect(applied.files.modified).toContain("documentation-robotics/model/01_motivation/goal.yaml");
    const after = await readFile(goal, "utf8");
    expect(after).toContain(`description: ${LONG}`);
    expect(yaml.parse(after)).toEqual(yaml.parse(before));

    // Nothing left to lay out
    clearModelCache();
    const after2 = parse(await projectUpgradeHandler({ rootPath: dir, relayout: true }));
    expect(after2.status).toBe("up-to-date");
    expect(after2.relayout).toBeUndefined();
  });

  it("changeset_commit_preview names the files a landing would lay out, and how to do it first", async () => {
    await Model.init(dir, { name: "Folded", version: "0.1.0" });
    await writeFoldedGoal(dir);
    await changesetCreateHandler({ name: "reword-goal", rootPath: dir });
    const updated = await modelUpdateHandler({ id: GOAL, name: "Export every project", rootPath: dir });
    expect(updated.isError).toBeFalsy();

    const preview = parse(await changesetCommitPreviewHandler({ rootPath: dir, changeset: "reword-goal" }));
    const summary = JSON.stringify(preview);
    expect(summary).toContain("lays out 1 model file(s) an earlier dr wrote");
    expect(summary).toContain("documentation-robotics/model/01_motivation/goal.yaml");
    expect(summary).toContain("Run the relayout first, on its own: project_upgrade with relayout: true");
    expect(summary).toContain("commit it apart from this plan");
  });

  it("changeset_commit_preview says nothing about layout when the files are in dr's layout", async () => {
    await Model.init(dir, { name: "Laid out", version: "0.1.0" });
    await writeFoldedGoal(dir);
    await projectUpgradeHandler({ rootPath: dir, apply: true, modelOnly: true, relayout: true });
    clearModelCache();
    await changesetCreateHandler({ name: "reword-goal", rootPath: dir });
    await modelUpdateHandler({ id: GOAL, name: "Export every project", rootPath: dir });

    const preview = parse(await changesetCommitPreviewHandler({ rootPath: dir, changeset: "reword-goal" }));
    expect(JSON.stringify(preview)).not.toContain("earlier dr wrote");
  });
});
