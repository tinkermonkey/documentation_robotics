/**
 * project_init and project_upgrade handlers: where init creates the model, and the upgrade
 * preview's version path. The full flows over stdio are in
 * tests/integration/mcp-project-tools.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "yaml";
import { Model } from "../../../src/core/model.js";
import { markEnvProjectRoot, resetProjectRoot } from "../../../src/mcp/project-root.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import {
  predictOrphans,
  wouldOrphan,
  projectInitHandler,
  projectInitTool,
  projectUpgradeHandler,
} from "../../../src/mcp/tools/project-tools.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetListHandler } from "../../../src/mcp/tools/changeset-list.js";
import { changesetShowHandler } from "../../../src/mcp/tools/changeset-show.js";
import { changesetBriefHandler } from "../../../src/mcp/tools/changeset-analysis-tools.js";
import { changesetCommitPreviewHandler } from "../../../src/mcp/tools/changeset-commit.js";
import { projectStatus, suggestNextStep } from "../../../src/mcp/tools/project-status.js";
import { installSpecReference } from "../../../src/utils/spec-installer.js";
import { Validator } from "../../../src/validators/validator.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";
import { fileExists } from "../../../src/utils/file-io.js";

let dir: string;

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

async function setSpecVersion(root: string, version: string): Promise<void> {
  const file = join(root, "documentation-robotics/model/manifest.yaml");
  const manifest = yaml.parse(await readFile(file, "utf8"));
  manifest.spec_version = version;
  await writeFile(file, yaml.stringify(manifest));
}

beforeEach(async () => {
  dir = join(tmpdir(), `dr-project-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  clearModelCache();
  resetProjectRoot();
});

afterEach(async () => {
  resetProjectRoot();
  clearModelCache();
  await rm(dir, { recursive: true, force: true });
});

describe("project_init", () => {
  it("won't create a model in the server's own working directory when the client named no folder", async () => {
    const result = await projectInitHandler({ name: "Nowhere" });
    expect(result.isError).toBe(true);
    expect(parse(result).suggestions.join(" ")).toContain("rootPath");
  });

  it("rejects a relative rootPath and a folder that doesn't exist", async () => {
    expect(parse(await projectInitHandler({ name: "X", rootPath: "relative/dir" })).error).toContain("absolute");
    expect(parse(await projectInitHandler({ name: "X", rootPath: join(dir, "missing") })).error).toContain("Not a folder");
  });

  it("creates the model in the folder a launcher pinned (DR_MCP_ROOT_PATH)", async () => {
    markEnvProjectRoot(dir);
    const result = await projectInitHandler({ name: "Pinned" });
    expect(result.isError).toBeFalsy();
    expect(parse(result).rootPath).toBe(dir);
    expect((await Model.load(dir)).manifest.name).toBe("Pinned");
  });

  it("adds /.dr/ to the project's .gitignore and says so", async () => {
    const body = parse(await projectInitHandler({ name: "Ignored", rootPath: dir }));
    expect(body.status).toBe("created");
    expect(body.gitignore).toEqual({ path: join(dir, ".gitignore"), added: ["/.dr/"] });
    expect(await readFile(join(dir, ".gitignore"), "utf8")).toContain("/.dr/\n");
    expect(body.prettierignore).toBeUndefined();
  });

  it("adds the documentation-robotics folder to .prettierignore when the project uses prettier, and says so (#1155, #1246)", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ devDependencies: { prettier: "^3.0.0" } }), "utf8");
    const body = parse(await projectInitHandler({ name: "Pretty", rootPath: dir }));
    expect(body.status).toBe("created");
    expect(body.prettierignore).toEqual({
      path: join(dir, ".prettierignore"),
      added: ["documentation-robotics/"],
    });
    expect(await readFile(join(dir, ".prettierignore"), "utf8")).toContain(
      "documentation-robotics/\n"
    );
  });

  it("warns when a large-file commit hook would refuse a changeset, and leaves the hook config alone", async () => {
    const config =
      "repos:\n  - repo: https://github.com/pre-commit/pre-commit-hooks\n    hooks:\n      - id: check-added-large-files\n        args: [--maxkb=1000]\n";
    await writeFile(join(dir, ".pre-commit-config.yaml"), config, "utf8");
    const body = parse(await projectInitHandler({ name: "Hooked", rootPath: dir }));
    expect(body.status).toBe("created");
    expect(body.warnings.join(" ")).toContain("check-added-large-files pre-commit hook refuses a new file over 1000 KB");
    expect(await readFile(join(dir, ".pre-commit-config.yaml"), "utf8")).toBe(config);
  });
});

describe("project_upgrade", () => {
  it("previews the whole version path, marking the steps that rewrite the catalog", async () => {
    await Model.init(dir, { name: "Old", version: "0.1.0", specVersion: "0.8.4" });
    const result = await projectUpgradeHandler({ rootPath: dir });
    expect(result.isError).toBeFalsy();
    const body = parse(result);
    expect(body.status).toBe("preview");
    expect(body.steps[0]).toMatchObject({ from: "0.8.4", to: "0.9.0" });
    expect(body.steps.at(-1).to).toBe(getCliBundledSpecVersion());
    expect(body.steps.filter((s: any) => s.rewritesCatalog).map((s: any) => s.to)).toContain("0.10.0");
    expect(body.actions.some((a: any) => a.type === "integration")).toBe(false);
    expect(yaml.parse(await readFile(join(dir, "documentation-robotics/model/manifest.yaml"), "utf8")).spec_version).toBe("0.8.4");
  });

  it("tells the agent to update dr when the model is newer than the spec it carries, and won't apply", async () => {
    await Model.init(dir, { name: "Future", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
    await setSpecVersion(dir, "99.0.0");

    const preview = parse(await projectUpgradeHandler({ rootPath: dir }));
    expect(preview.status).toBe("model-newer");
    expect(preview.message).toContain("Update dr");

    const applied = await projectUpgradeHandler({ rootPath: dir, apply: true });
    expect(applied.isError).toBe(true);
  });
});

async function specVersionOf(root: string): Promise<string> {
  return yaml.parse(await readFile(join(root, "documentation-robotics/model/manifest.yaml"), "utf8")).spec_version;
}

/** A model at the current spec version with its spec reference installed, as `dr init` leaves it. */
async function currentModel(root: string): Promise<void> {
  await Model.init(root, { name: "Current", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
  await installSpecReference(root, false);
}

describe("project_upgrade review fixes", () => {
  it("rejects a relative rootPath, as project_init does", async () => {
    const result = await projectUpgradeHandler({ rootPath: "relative/dir" });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain("absolute");
  });

  it("won't call a model up to date when the catalog check failed", async () => {
    await currentModel(dir);
    await writeFile(join(dir, "documentation-robotics/model/relationships.yaml"), "- source: [unclosed\n  : :\n");

    for (const apply of [false, true]) {
      const result = await projectUpgradeHandler({ rootPath: dir, apply });
      expect(result.isError).toBeFalsy();
      const body = parse(result);
      expect(body.status).toBe("check-failed");
      expect(body.errors.join(" ")).toContain("Could not check the model against the catalog");
    }
    expect(await specVersionOf(dir)).toBe(getCliBundledSpecVersion());
  });

  it("reports what it applied when a later step fails", async () => {
    // Spec reference missing (an action that succeeds), then a migration that can't load the model.
    await Model.init(dir, { name: "Broken", version: "0.1.0", specVersion: "0.10.0" });
    await writeFile(join(dir, "documentation-robotics/model/relationships.yaml"), "- source: [unclosed\n  : :\n");

    const result = await projectUpgradeHandler({ rootPath: dir, apply: true });
    expect(result.isError).toBe(true);
    const body = parse(result);
    expect(body.status).toBe("partially-applied");
    expect(body.applied.map((a: any) => a.type)).toEqual(["spec"]);
    expect(body.error).toBeTruthy();
  });

  it("says the migration was applied when validating afterwards fails", async () => {
    await Model.init(dir, { name: "Old", version: "0.1.0", specVersion: "0.10.0" });
    await installSpecReference(dir, false);
    const spy = spyOn(Validator.prototype, "validateModel").mockImplementation(async () => {
      throw new Error("validator exploded");
    });
    try {
      const result = await projectUpgradeHandler({ rootPath: dir, apply: true });
      expect(result.isError).toBeFalsy();
      const body = parse(result);
      expect(body.status).toBe("applied-with-errors");
      expect(body.applied.some((a: any) => a.from === "0.10.0")).toBe(true);
      expect(body.followUpError).toContain("validator exploded");
    } finally {
      spy.mockRestore();
    }
    expect(await specVersionOf(dir)).toBe(getCliBundledSpecVersion());
  });

  it("validates the base model only, not the active changeset's staged relationships", async () => {
    await currentModel(dir);
    const goal = { layer: "motivation", type: "goal", attributes: { priority: "high" }, rootPath: dir };
    expect((await modelAddHandler({ ...goal, name: "faster-checkout" })).isError).toBeFalsy();
    expect((await changesetCreateHandler({ name: "plan", rootPath: dir })).isError).toBeFalsy();
    expect((await modelAddHandler({ ...goal, name: "staged-goal" })).isError).toBeFalsy();
    const rel = await relationshipAddHandler({
      source: "motivation.goal.faster-checkout",
      predicate: "aggregates",
      target: "motivation.goal.staged-goal",
      rootPath: dir,
    });
    expect(rel.isError).toBeFalsy();

    // force reinstalls the spec reference, so there is something to apply on a current model.
    const result = await projectUpgradeHandler({ rootPath: dir, apply: true, force: true });
    const body = parse(result);
    expect(body.status).toBe("applied");
    expect(body.validation.scope).toContain("base model");
    expect(body.validation.errorCount).toBe(0);
  });

  it("stamps the new version with force when no migration leads to it, and only with apply", async () => {
    await Model.init(dir, { name: "Ancient", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
    await setSpecVersion(dir, "0.4.0");

    const preview = parse(await projectUpgradeHandler({ rootPath: dir }));
    expect(preview.status).toBe("no-migration-path");
    expect(preview.message).toContain("force: true");

    expect((await projectUpgradeHandler({ rootPath: dir, apply: true })).isError).toBe(true);
    const forceOnly = await projectUpgradeHandler({ rootPath: dir, force: true });
    expect(forceOnly.isError).toBe(true);
    expect(parse(forceOnly).error).toContain("apply: true");
    expect(await specVersionOf(dir)).toBe("0.4.0");

    const applied = parse(await projectUpgradeHandler({ rootPath: dir, apply: true, force: true }));
    expect(applied.status).toBe("applied");
    expect(await specVersionOf(dir)).toBe(getCliBundledSpecVersion());
  });

  it("adds the documentation-robotics folder to .prettierignore on apply when the project uses prettier (#1155, #1246)", async () => {
    await Model.init(dir, { name: "Pretty", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
    await setSpecVersion(dir, "0.4.0");
    await writeFile(join(dir, ".prettierrc.json"), "{}", "utf8");

    const preview = parse(await projectUpgradeHandler({ rootPath: dir }));
    expect(preview.prettierignore).toBeUndefined();
    expect(await fileExists(join(dir, ".prettierignore"))).toBe(false);

    const applied = parse(await projectUpgradeHandler({ rootPath: dir, apply: true, force: true }));
    expect(applied.status).toBe("applied");
    expect(applied.prettierignore).toEqual({
      path: join(dir, ".prettierignore"),
      added: ["documentation-robotics/"],
    });
  });

  it("keeps a model newer than this dr an error, even with force", async () => {
    await Model.init(dir, { name: "Future", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
    await setSpecVersion(dir, "99.0.0");
    const result = await projectUpgradeHandler({ rootPath: dir, apply: true, force: true });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain("newer");
    expect(await specVersionOf(dir)).toBe("99.0.0");
  });
});

describe("confirmations (D4)", () => {
  it("project_init asks the agent to confirm the model's name, and then bootstrap or grow", async () => {
    expect(projectInitTool.description).toContain("confirm it with the user");
    const dir = join(tmpdir(), `dr-mcp-init-confirm-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    try {
      const result = await projectInitHandler({ name: "Confirm Test", rootPath: dir });
      expect(result.isError).toBeFalsy();
      const next = JSON.parse((result.content[0] as { text: string }).text).next;
      expect(next).toContain("Ask the user whether to bootstrap");
      expect(next).toContain("wait for their answer");
    } finally {
      clearModelCache();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("project_upgrade: dropped relationships and unfilled required attributes (#1164, #1166)", () => {
  /** An operation and a response without the attributes the spec requires, linked by a retired triple */
  async function writeApiModel(root: string): Promise<void> {
    const element = (path: string) => {
      const [layerId, type, name] = path.split(".");
      return { [path]: { id: crypto.randomUUID(), path, spec_node_id: `${layerId}.${type}`, type, layer_id: layerId, name } };
    };
    const modelDir = join(root, "documentation-robotics/model");
    await mkdir(join(modelDir, "07_api"), { recursive: true });
    await writeFile(
      join(modelDir, "07_api/elements.yaml"),
      yaml.stringify({ ...element("api.operation.list-orders"), ...element("api.response.ok") })
    );
    await writeFile(
      join(modelDir, "relationships.yaml"),
      yaml.stringify([{ source: "api.operation.list-orders", predicate: "delivers", target: "api.response.ok", layer: "api" }])
    );
  }

  it("counts the drops by type in the preview, and lists the attributes left empty after apply", async () => {
    await currentModel(dir);
    await writeApiModel(dir);

    const preview = parse(await projectUpgradeHandler({ rootPath: dir }));
    expect(preview.status).toBe("preview");
    expect(preview.droppedByType).toEqual([
      { sourceType: "api.operation", predicate: "delivers", targetType: "api.response", count: 1 },
    ]);

    const applied = parse(await projectUpgradeHandler({ rootPath: dir, apply: true }));
    expect(applied.status).toBe("applied");
    expect(applied.validation.unfilledRequired.elements).toEqual([
      { elementId: "api.operation.list-orders", layer: "api", attributes: ["operationId", "summary", "tags"] },
      { elementId: "api.response.ok", layer: "api", attributes: ["description"] },
    ]);
    // Nothing is derived: the operation still has no attributes
    const apiDir = join(dir, "documentation-robotics/model/07_api");
    const api = (await Promise.all((await readdir(apiDir)).map((f) => readFile(join(apiDir, f), "utf8")))).join("\n");
    expect(api).toContain("api.operation.list-orders");
    expect(api).not.toContain("operationId");
  });

  it("names the upgrade record in the preview, writes it on apply, and the changeset tools read it as a record", async () => {
    await currentModel(dir);
    await writeApiModel(dir);
    const version = getCliBundledSpecVersion();
    const name = `upgrade-drops-${version}`;
    const changesetsDir = join(dir, "documentation-robotics/changesets");

    const preview = parse(await projectUpgradeHandler({ rootPath: dir }));
    expect(preview.dropRecord).toMatchObject({ changeset: name, relationships: 1 });
    expect(preview.dropRecord.id).toBeUndefined();
    expect(preview.dropRecord.note).toContain("Applying records the dropped relationships");
    // Nothing is written by a preview
    expect((await fileExists(changesetsDir)) ? await readdir(changesetsDir) : []).toEqual([]);

    const applied = parse(await projectUpgradeHandler({ rootPath: dir, apply: true }));
    expect(applied.status).toBe("applied");
    expect(applied.dropRecord).toMatchObject({ changeset: name, relationships: 1 });
    expect(applied.dropRecord.note).toContain("never lands");
    const id = applied.dropRecord.id as string;

    // changeset_list: the record, with the only move it allows
    const list = parse(await changesetListHandler({ rootPath: dir }));
    expect(list.changesets[id]).toMatchObject({
      name,
      status: "staged",
      changes_count: 1,
      purpose: "upgrade-record",
      actions: ["discard"],
    });
    expect(list.activeChangesetId ?? null).toBeNull();

    // changeset_show: each drop with the retired type and the change record that retired it
    const shown = parse(await changesetShowHandler({ rootPath: dir, changesetId: name, detail: "summary" }));
    expect(shown).toMatchObject({ purpose: "upgrade-record", actions: ["discard"], origin: { kind: "upgrade" } });
    expect(shown.description).toContain("1 x api.operation --[delivers]--> api.response");
    expect(shown.totals["relationship-delete"]).toBe(1);
    expect(JSON.stringify(shown.changes[0])).toContain("api.operation.list-orders");
    expect(JSON.stringify(shown.changes[0])).toContain("upgrade api.operation.delivers.api.response retired by ");

    // changeset_brief reads it without failing
    const brief = await changesetBriefHandler({ rootPath: dir, changesetId: name });
    expect(brief.isError).toBeFalsy();

    // It is never landed: the commit preview (the checks changeset_commit runs) refuses it
    const refused = await changesetCommitPreviewHandler({ rootPath: dir, changeset: name, force: true });
    expect(refused.isError).toBe(true);
    expect(parse(refused).error).toContain("is an upgrade record");

    // project_status lists it as a record, and its next step reads it instead of continuing it
    const status = await projectStatus({ rootPath: dir }, { git: async () => "" });
    expect(status.changesets).toMatchObject({ status: "ok", active: null });
    expect((status.changesets as { staged: unknown[] }).staged).toMatchObject([
      { id, name, purpose: "upgrade-record", actions: ["discard"] },
    ]);
    // With the code index out of the way, the step that would say "activate one to continue it"
    const next = suggestNextStep(
      { ...status, codeIndex: { status: "fresh" }, codeDrift: { status: "unknown" } } as unknown as Parameters<typeof suggestNextStep>[0],
      { root: dir }
    );
    expect(next.summary).toContain(`"${name}" records the relationships a spec migration dropped`);
    expect(next.tool).toBe("changeset_create");

    // A second apply has nothing to do and writes no second record
    const again = parse(await projectUpgradeHandler({ rootPath: dir, apply: true }));
    expect(again.status).toBe("up-to-date");
    expect(Object.keys(parse(await changesetListHandler({ rootPath: dir })).changesets)).toEqual([id]);
  });
});

describe("project_upgrade preview: wouldOrphan (round 2, friction)", () => {
  /** A model with these elements (and their references) and these committed relationships. */
  function fakeModel(elements: Array<{ id: string; references?: Array<{ target: string }> }>, relationships: Array<[string, string, string]>) {
    return {
      layers: new Map([["any", { listElements: () => elements.map((e) => ({ path: e.id, id: e.id, references: e.references ?? [] })) }]]),
      getBaseRelationships: () => relationships.map(([source, predicate, target]) => ({ source, predicate, target, layer: "any" })),
    } as any;
  }
  const rels = (list: Array<[string, string, string]>) => list.map(([source, predicate, target]) => ({ source, predicate, target, layer: "any" }));
  const details = (after: Array<[string, string, string]> | undefined, elementTypeChanges: any[] = []) =>
    ({
      elementTypeChanges,
      relationshipChanges: [],
      stagedRelationshipChanges: [],
      ...(after ? { committedRelationshipsAfter: rels(after) } : {}),
    }) as any;

  it("names an element the migrated relationships leave unconnected, under its new id", () => {
    const model = fakeModel(
      [{ id: "a.event.hover" }, { id: "a.collab.viewport" }, { id: "a.comp.canvas" }, { id: "p.capability.layout" }],
      [
        ["a.event.hover", "triggers", "a.collab.viewport"],
        ["a.collab.viewport", "aggregates", "a.comp.canvas"],
        ["a.comp.canvas", "implements", "p.capability.layout"],
      ]
    );
    const orphans = predictOrphans(
      model,
      details(
        [
          ["a.collab.viewport", "aggregates", "a.comp.canvas"],
          ["a.comp.canvas", "realizes", "p.softwarecapability.layout"],
        ],
        [{ from: "p.capability.layout", to: "p.softwarecapability.layout", fromType: "capability", toType: "softwarecapability" }]
      )
    );
    expect(orphans).toEqual([{ elementId: "a.event.hover", loses: ["a.event.hover --[triggers]--> a.collab.viewport"] }]);
  });

  it("leaves out an element a reference still connects, and one that was already unconnected", () => {
    const model = fakeModel(
      [{ id: "x.a" }, { id: "x.b" }, { id: "x.c", references: [{ target: "x.d" }] }, { id: "x.d" }, { id: "x.lonely" }],
      [
        ["x.a", "serves", "x.b"],
        ["x.c", "triggers", "x.d"],
      ]
    );
    expect(predictOrphans(model, details([["x.a", "serves", "x.b"]]))).toEqual([]);
  });

  it("never names a relationship end that isn't an element (review)", () => {
    const model = fakeModel([{ id: "x.a" }], [["x.a", "triggers", "x.missing"]]);
    expect(predictOrphans(model, details([]))).toEqual([
      { elementId: "x.a", loses: ["x.a --[triggers]--> x.missing"] },
    ]);
  });

  it("predicts nothing it can't read from the dry run", () => {
    const model = fakeModel([{ id: "x.a" }, { id: "x.b" }], [["x.a", "serves", "x.b"]]);
    expect(predictOrphans(model, details(undefined))).toBeNull();
  });

  it("reports an element a rewrite moves its only relationship away from, with nothing dropped (review)", async () => {
    await Model.init(dir, { name: "Orphan Rewrite", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
    for (const name of ["a", "b", "c"]) {
      const added = await modelAddHandler({ layer: "business", type: "businessfunction", name, rootPath: dir });
      expect(added.isError).toBeFalsy();
    }
    const linked = await relationshipAddHandler({
      source: "business.businessfunction.a",
      predicate: "flows-to",
      target: "business.businessfunction.b",
      rootPath: dir,
    });
    expect(linked.isError).toBeFalsy();
    clearModelCache();

    const result = await wouldOrphan(dir, {
      elementTypeChanges: [],
      relationshipChanges: [
        {
          action: "rewritten",
          before: { source: "business.businessfunction.a", predicate: "flows-to", target: "business.businessfunction.b" },
          after: { source: "business.businessfunction.a", predicate: "flows-to", target: "business.businessfunction.c" },
          rules: [],
        },
      ],
      stagedRelationshipChanges: [],
      committedRelationshipsAfter: rels([["business.businessfunction.a", "flows-to", "business.businessfunction.c"]]),
    });
    expect((result as any).wouldOrphan?.elements).toEqual([
      { elementId: "business.businessfunction.b", loses: ["business.businessfunction.a --[flows-to]--> business.businessfunction.b"] },
    ]);
  });
});

describe("project_upgrade: what it writes, derived values and files git tracks under .dr/ (#1165, #1166, #1185, #1246)", () => {
  function git(cwd: string, ...args: string[]): string {
    const result = spawnSync("git", args, { cwd, stdio: "pipe", encoding: "utf-8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    return result.stdout;
  }

  function gitInit(cwd: string): void {
    git(cwd, "init", "-q");
    git(cwd, "config", "user.email", "test@example.com");
    git(cwd, "config", "user.name", "Test");
    // A global excludes file on the machine running the tests must not decide the outcome.
    git(cwd, "config", "core.excludesFile", join(cwd, ".no-global-excludes"));
  }

  /** A model one spec version behind with one API operation that has no attributes, in dr's own file layout */
  async function behindModel(root: string): Promise<void> {
    await Model.init(root, { name: "Behind", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
    await setSpecVersion(root, "0.13.0");
    const path = "api.operation.create-order";
    await mkdir(join(root, "documentation-robotics/model/07_api"), { recursive: true });
    await writeFile(
      join(root, "documentation-robotics/model/07_api/operation.yaml"),
      yaml.stringify({
        [path]: {
          id: "00000000-0000-4000-8000-000000000001",
          path,
          spec_node_id: "api.operation",
          type: "operation",
          layer_id: "api",
          name: "Create order",
          description: "Creates an order. Reserves stock first.",
        },
      })
    );
  }

  it("previews, from a rehearsal, the model files it would write and the values it would derive; writes nothing", async () => {
    await behindModel(dir);
    const operationsBefore = await readFile(join(dir, "documentation-robotics/model/07_api/operation.yaml"), "utf8");

    const preview = parse(await projectUpgradeHandler({ rootPath: dir }));
    expect(preview.status).toBe("preview");
    // A version stamp: the manifest and nothing else in the model
    expect(preview.wouldWrite.modelFiles).toMatchObject({
      count: 1,
      modified: ["documentation-robotics/model/manifest.yaml"],
      added: [],
      removed: [],
    });
    expect(preview.wouldWrite.validationErrorsAfter).toBe(3);
    expect(preview.derivedValues).toMatchObject({ changeset: "upgrade-fills-0.14.0", values: 2, elements: 1 });
    expect(preview.derivedValues.id).toBeUndefined();
    expect(preview.derivedValues.fills.map((fill: any) => [fill.attribute, fill.value])).toEqual([
      ["operationId", "createOrder"],
      ["summary", "Creates an order."],
    ]);
    expect(preview.unfilledRequired.elements).toEqual([
      { elementId: "api.operation.create-order", layer: "api", attributes: ["tags"] },
    ]);
    expect(preview.outsideModel.specReference).toContain(".dr/spec/");

    expect(await specVersionOf(dir)).toBe("0.13.0");
    expect(await readFile(join(dir, "documentation-robotics/model/07_api/operation.yaml"), "utf8")).toBe(operationsBefore);
    expect(await fileExists(join(dir, "documentation-robotics/changesets"))).toBe(false);
  });

  it("stages the derived values in a changeset on apply and lists the model's files apart from the rest", async () => {
    await behindModel(dir);
    const operationsBefore = await readFile(join(dir, "documentation-robotics/model/07_api/operation.yaml"), "utf8");

    const applied = parse(await projectUpgradeHandler({ rootPath: dir, apply: true }));
    expect(applied.status).toBe("applied");
    expect(applied.files).toEqual({ modified: ["documentation-robotics/model/manifest.yaml"], added: [], removed: [] });
    expect(applied.filesModified).toBe(1);
    expect(applied.otherFiles.added.some((file: string) => file.endsWith("/changes.yaml"))).toBe(true);

    expect(applied.derivedValues).toMatchObject({ changeset: "upgrade-fills-0.14.0", values: 2, elements: 1 });
    expect(applied.derivedValues.note).toContain("Nothing was written to the base model");
    expect(applied.validation.stagedForReview).toMatchObject({ changeset: "upgrade-fills-0.14.0", attributeCount: 2 });
    expect(applied.validation.unfilledRequired.elements).toEqual([
      { elementId: "api.operation.create-order", layer: "api", attributes: ["tags"] },
    ]);
    // The base model was not filled in
    expect(await readFile(join(dir, "documentation-robotics/model/07_api/operation.yaml"), "utf8")).toBe(operationsBefore);

    const list = parse(await changesetListHandler({ rootPath: dir }));
    expect(list.changesets[applied.derivedValues.id]).toMatchObject({
      name: "upgrade-fills-0.14.0",
      status: "staged",
      changes_count: 1,
      purpose: "plan",
      actions: ["commit", "discard"],
    });
  });

  it("modelOnly writes nothing outside the model but the spec reference", async () => {
    await behindModel(dir);
    await writeFile(join(dir, ".prettierrc.json"), "{}", "utf8");
    await rm(join(dir, "documentation-robotics/reports"), { recursive: true, force: true });
    await rm(join(dir, ".gitignore"), { force: true });

    const preview = parse(await projectUpgradeHandler({ rootPath: dir }));
    expect(preview.outsideModel.prettierignore.add).toEqual(["documentation-robotics/"]);
    expect(preview.outsideModel.reports.generate).toHaveLength(2);
    expect(preview.outsideModel.gitignore).toEqual({ path: ".gitignore", add: ["/.dr/"] });

    const applied = parse(await projectUpgradeHandler({ rootPath: dir, apply: true, modelOnly: true }));
    expect(applied.status).toBe("applied");
    expect(await specVersionOf(dir)).toBe(getCliBundledSpecVersion());
    expect(applied.prettierignore).toBeUndefined();
    expect(applied.gitignore).toBeUndefined();
    expect(applied.reports).toBeUndefined();
    expect(await fileExists(join(dir, ".prettierignore"))).toBe(false);
    expect(await fileExists(join(dir, ".gitignore"))).toBe(false);
    expect(await fileExists(join(dir, "documentation-robotics/reports"))).toBe(false);
    expect(await fileExists(join(dir, ".dr/spec/manifest.json"))).toBe(true);
  });

  it("returns files git tracks under .dr/ as a decision and changes nothing there until the caller passes the choice", async () => {
    await behindModel(dir);
    // A project from before .dr/ was ignored: the spec reference is committed
    await installSpecReference(dir);
    await rm(join(dir, ".gitignore"), { force: true });
    gitInit(dir);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "model with .dr tracked");
    const tracked = git(dir, "ls-files", "--", ".dr").trim().split("\n").length;
    expect(tracked).toBeGreaterThan(2);

    const preview = parse(await projectUpgradeHandler({ rootPath: dir }));
    expect(preview.gitignore).toMatchObject({ wouldIgnoreTracked: tracked, alreadyIgnored: false });
    expect(preview.gitignore.options.map((option: any) => option.choice)).toEqual(["untrack", "keep-tracked", "skip"]);
    // More tracked files than the list holds by default: the rest are in git, and the hint says how to list them
    expect(preview.gitignore.trackedFiles).toHaveLength(10);
    expect(preview.gitignore).toMatchObject({ shown: 10, omitted: tracked - 10 });
    expect(preview.gitignore.more).toContain("git ls-files .dr lists them all");
    const full = parse(await projectUpgradeHandler({ rootPath: dir, detail: "full" }));
    expect(full.gitignore.trackedFiles).toHaveLength(tracked);
    expect(preview.outsideModel.gitignore).toBeUndefined();

    // Apply without a choice: the model moves, .gitignore and the index don't
    const applied = parse(await projectUpgradeHandler({ rootPath: dir, apply: true }));
    expect(applied.status).toBe("applied");
    expect(applied.gitignore.options).toHaveLength(3);
    expect(applied.next).toContain("put gitignore.options to the user");
    expect(await fileExists(join(dir, ".gitignore"))).toBe(false);
    expect(git(dir, "ls-files", "--", ".dr").trim().split("\n")).toHaveLength(tracked);

    // The model is up to date now; the decision is still open, and the choice settles it
    const still = parse(await projectUpgradeHandler({ rootPath: dir }));
    expect(still.status).toBe("up-to-date");
    expect(still.gitignore.wouldIgnoreTracked).toBe(tracked);

    const chosen = parse(await projectUpgradeHandler({ rootPath: dir, apply: true, gitignore: "untrack" }));
    expect(chosen.status).toBe("up-to-date");
    expect(chosen.gitignore).toMatchObject({ applied: "untrack", untracked: tracked, added: ["/.dr/"] });
    expect(git(dir, "ls-files", "--", ".dr").trim()).toBe("");
    expect(await readFile(join(dir, ".gitignore"), "utf8")).toContain("/.dr/\n");
    // The next git add of the upgrade just works
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "upgrade");
    expect(git(dir, "status", "--short").trim()).toBe("");
  });
  it("shortens long lists by default with their true counts and the way to the rest; detail: full returns every item", async () => {
    await Model.init(dir, { name: "Many", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
    await setSpecVersion(dir, "0.13.0");
    // 130 operations with nothing the spec requires: 260 derivable values, 130 elements left with one empty
    const operations: Record<string, unknown> = {};
    for (let i = 1; i <= 130; i++) {
      const path = `api.operation.get-item-${String(i).padStart(3, "0")}`;
      operations[path] = {
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        path,
        spec_node_id: "api.operation",
        type: "operation",
        layer_id: "api",
        name: `Get item ${i}`,
      };
    }
    await mkdir(join(dir, "documentation-robotics/model/07_api"), { recursive: true });
    await writeFile(join(dir, "documentation-robotics/model/07_api/operation.yaml"), yaml.stringify(operations));

    const preview = parse(await projectUpgradeHandler({ rootPath: dir }));
    // Counts are of everything
    expect(preview.wouldWrite.validationErrorsAfter).toBe(390);
    expect(preview.derivedValues).toMatchObject({ values: 260, elements: 130, shown: 100, omitted: 160 });
    expect(preview.derivedValues.fills).toHaveLength(100);
    expect(preview.derivedValues.more).toContain('detail: "full"');
    expect(preview.unfilledRequired).toMatchObject({ elementCount: 130, attributeCount: 130 });
    expect(preview.unfilledRequired.elements).toHaveLength(130);

    const full = parse(await projectUpgradeHandler({ rootPath: dir, detail: "full" }));
    expect(full.derivedValues.values).toBe(260);
    expect(full.derivedValues.fills).toHaveLength(260);
    expect(full.derivedValues.omitted).toBeUndefined();
    expect(full.derivedValues.more).toBeUndefined();

    // Applied: the summary is shortened and says so; the changeset holds every value
    const applied = parse(await projectUpgradeHandler({ rootPath: dir, apply: true }));
    expect(applied.status).toBe("applied");
    expect(applied.derivedValues).toMatchObject({ values: 260, shown: 100, omitted: 160 });
    expect(applied.derivedValues.more).toContain("changeset_show upgrade-fills-0.14.0 lists every staged value");
    expect(applied.validation).toMatchObject({ valid: false, errorCount: 390 });
    expect(applied.validation.errors).toHaveLength(20);
    expect(applied.validation.moreErrors).toBe(370);
    expect(applied.validation.more).toContain("model_validate lists every error and warning");
    expect(applied.validation.stagedForReview.attributeCount).toBe(260);
    // One staged update per element, all 130 of them
    const list = parse(await changesetListHandler({ rootPath: dir }));
    expect(list.changesets[applied.derivedValues.id].changes_count).toBe(130);
  });
});
