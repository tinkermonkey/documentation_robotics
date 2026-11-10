/**
 * project_init and project_upgrade handlers: where init creates the model, and the upgrade
 * preview's version path. The full flows over stdio are in
 * tests/integration/mcp-project-tools.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "yaml";
import { Model } from "../../../src/core/model.js";
import { markEnvProjectRoot, resetProjectRoot } from "../../../src/mcp/project-root.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import {
  predictOrphans,
  projectInitHandler,
  projectInitTool,
  projectUpgradeHandler,
} from "../../../src/mcp/tools/project-tools.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { installSpecReference } from "../../../src/utils/spec-installer.js";
import { Validator } from "../../../src/validators/validator.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";

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

describe("project_upgrade preview: wouldOrphan (round 2, friction)", () => {
  /** A model with these elements (and their references) and these committed relationships. */
  function fakeModel(elements: Array<{ id: string; references?: Array<{ target: string }> }>, relationships: Array<[string, string, string]>) {
    return {
      layers: new Map([["any", { listElements: () => elements.map((e) => ({ path: e.id, id: e.id, references: e.references ?? [] })) }]]),
      getBaseRelationships: () => relationships.map(([source, predicate, target]) => ({ source, predicate, target, layer: "any" })),
    } as any;
  }
  const rel = (source: string, predicate: string, target: string) => ({ source, predicate, target });
  const details = (relationshipChanges: any[], elementTypeChanges: any[] = []) =>
    ({ elementTypeChanges, relationshipChanges, stagedRelationshipChanges: [] }) as any;

  it("names an element whose only relationship is dropped, under its new id", () => {
    const model = fakeModel(
      [{ id: "a.event.hover" }, { id: "a.collab.viewport" }, { id: "a.comp.canvas" }, { id: "p.capability.layout" }],
      [
        ["a.event.hover", "triggers", "a.collab.viewport"],
        ["a.collab.viewport", "aggregates", "a.comp.canvas"],
        ["a.comp.canvas", "realizes", "p.capability.layout"],
      ]
    );
    const orphans = predictOrphans(
      model,
      details(
        [
          { action: "dropped", before: rel("a.event.hover", "triggers", "a.collab.viewport"), rules: [] },
          {
            action: "rewritten",
            before: rel("a.comp.canvas", "realizes", "p.softwarecapability.layout"),
            after: rel("a.comp.canvas", "realizes", "p.softwarecapability.layout"),
            rules: [],
          },
        ],
        [{ from: "p.capability.layout", to: "p.softwarecapability.layout", fromType: "capability", toType: "softwarecapability" }]
      )
    );
    expect(orphans).toEqual([
      { elementId: "a.event.hover", loses: ["a.event.hover --[triggers]--> a.collab.viewport"] },
    ]);
  });

  it("leaves out an element another relationship or a reference still connects", () => {
    const model = fakeModel(
      [{ id: "x.a" }, { id: "x.b" }, { id: "x.c", references: [{ target: "x.d" }] }, { id: "x.d" }],
      [
        ["x.a", "triggers", "x.b"],
        ["x.a", "serves", "x.b"],
        ["x.c", "triggers", "x.d"],
      ]
    );
    const orphans = predictOrphans(
      model,
      details([
        { action: "dropped", before: rel("x.a", "triggers", "x.b"), rules: [] },
        { action: "dropped", before: rel("x.c", "triggers", "x.d"), rules: [] },
      ])
    );
    expect(orphans).toEqual([]);
  });

  it("doesn't count a dropped duplicate, whose twin stays", () => {
    const model = fakeModel([{ id: "x.a" }, { id: "x.b" }], [
      ["x.a", "serves", "x.b"],
      ["x.a", "serves", "x.b"],
    ]);
    expect(predictOrphans(model, details([{ action: "dropped-duplicate", before: rel("x.a", "serves", "x.b"), rules: [] }]))).toEqual([]);
  });
});
