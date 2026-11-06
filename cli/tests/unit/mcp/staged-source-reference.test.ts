/**
 * Regression tests: a staged update must carry its source-reference change.
 *
 * `model_update` (MCP) and `dr update` wrote the new reference under a camelCase
 * `after.sourceReference` key while staged snapshots use `source_reference`, so
 * the change was lost: model_show showed no reference, the brief's codeTouched
 * left the file out, and clearSourceReference did not clear. Both now go through
 * setStagedSourceReference; readers also accept changes.yaml files already
 * written with the camelCase key.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { ChangesetGraph } from "../../../src/core/changeset-graph.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelShowHandler } from "../../../src/mcp/tools/model-show.js";
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetBriefHandler } from "../../../src/mcp/tools/changeset-analysis-tools.js";
import { updateCommand } from "../../../src/commands/update.js";

function parse(result: any): any {
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}

const SERVICE = "application.applicationservice.checkout";
const GOAL = "motivation.goal.faster-checkout";
const OLD_FILE = "src/checkout/old.ts";
const NEW_FILE = "src/checkout/new.ts";

let rootPath: string;

async function changesetId(): Promise<string> {
  const dir = join(rootPath, "documentation-robotics", "changesets");
  const [id] = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  return id;
}

async function changesPath(): Promise<string> {
  return join(rootPath, "documentation-robotics", "changesets", await changesetId(), "changes.yaml");
}

async function changesFile(): Promise<any[]> {
  return parseYaml(await readFile(await changesPath(), "utf-8")) as any[];
}

async function shownFiles(id: string): Promise<string[]> {
  const shown = parse(await modelShowHandler({ id, rootPath }));
  return (shown.element.source_reference?.locations ?? []).map((l: any) => l.file);
}

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-staged-source-ref-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Staged Source Reference Test Model", version: "0.1.0" });
  parse(
    await modelAddHandler({
      layer: "application",
      type: "applicationservice",
      name: "checkout",
      attributes: { serviceType: "synchronous" },
      sourceFile: OLD_FILE,
      sourceProvenance: "manual",
      rootPath,
    } as any)
  );
  parse(await modelAddHandler({ layer: "motivation", type: "goal", name: "faster-checkout", attributes: { priority: "high" }, rootPath }));
  clearModelCache();
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("staged source-reference updates", () => {
  it("model_update stages a new source file under source_reference, visible to model_show and the brief", async () => {
    parse(await changesetCreateHandler({ name: "fix-refs", rootPath }));
    const result = parse(
      await modelUpdateHandler({ id: SERVICE, sourceFile: NEW_FILE, sourceProvenance: "manual", rootPath } as any)
    );
    expect(result.status).toBe("staged");

    const [change] = await changesFile();
    expect(change.type).toBe("update");
    expect(change.after.sourceReference).toBeUndefined();
    expect(change.after.source_reference.locations[0].file).toBe(NEW_FILE);

    clearModelCache();
    expect(await shownFiles(SERVICE)).toEqual([NEW_FILE]);
    const brief = parse(await changesetBriefHandler({ changesetId: "fix-refs", rootPath }));
    expect(brief.codeTouched.map((c: any) => c.file)).toContain(NEW_FILE);
  });

  it("model_update clearSourceReference clears it in the projection and on commit", async () => {
    parse(await changesetCreateHandler({ name: "fix-refs", rootPath }));
    parse(await modelUpdateHandler({ id: SERVICE, clearSourceReference: true, rootPath } as any));
    const [change] = await changesFile();
    expect(change.after.source_reference).toBeNull();

    clearModelCache();
    expect(await shownFiles(SERVICE)).toEqual([]);

    const model = await Model.load(rootPath, { lazyLoad: false });
    const manager = new StagingAreaManager(rootPath, model);
    await manager.commit(model, await changesetId(), { force: true });
    const reloaded = await Model.load(rootPath, { lazyLoad: false });
    expect(reloaded.getElementById(SERVICE)?.getSourceReference()).toBeUndefined();
  });

  it("dr update stages the new source file and commit writes it to the base", async () => {
    parse(await changesetCreateHandler({ name: "fix-refs", rootPath }));
    await updateCommand(SERVICE, { model: rootPath, sourceFile: NEW_FILE, sourceProvenance: "manual" });

    const [change] = await changesFile();
    expect(change.after.sourceReference).toBeUndefined();
    expect(change.after.source_reference.locations[0].file).toBe(NEW_FILE);

    const model = await Model.load(rootPath, { lazyLoad: false });
    const manager = new StagingAreaManager(rootPath, model);
    await manager.commit(model, await changesetId(), { force: true });
    const reloaded = await Model.load(rootPath, { lazyLoad: false });
    expect(reloaded.getElementById(SERVICE)?.getSourceReference()?.locations[0].file).toBe(NEW_FILE);
  });

  it("dr update --clear-source-reference clears a staged reference", async () => {
    parse(await changesetCreateHandler({ name: "fix-refs", rootPath }));
    await updateCommand(SERVICE, { model: rootPath, clearSourceReference: true });
    const [change] = await changesFile();
    expect(change.after.source_reference).toBeNull();
    clearModelCache();
    expect(await shownFiles(SERVICE)).toEqual([]);
  });

  it("reads a changes.yaml already written with the legacy camelCase key", async () => {
    parse(await changesetCreateHandler({ name: "fix-refs", rootPath }));
    // Stage a plain update, then rewrite it the way the buggy builds did: the stale
    // snake_case copy of `before` plus the intended new value under sourceReference.
    parse(await modelUpdateHandler({ id: SERVICE, description: "Checkout", rootPath }));
    const changes = await changesFile();
    const newRef = { provenance: "manual", locations: [{ file: NEW_FILE }] };
    changes[0].after.source_reference = changes[0].before.source_reference;
    changes[0].after.sourceReference = newRef;
    await writeFile(await changesPath(), stringifyYaml(changes), "utf-8");

    clearModelCache();
    expect(await shownFiles(SERVICE)).toEqual([NEW_FILE]);

    const model = await Model.load(rootPath, { lazyLoad: false });
    const manager = new StagingAreaManager(rootPath, model);
    const changeset = await manager.load(await changesetId());
    const graph = await ChangesetGraph.build(model, changeset!);
    expect(graph.getElement(SERVICE)?.sourceReference?.locations[0].file).toBe(NEW_FILE);

    await manager.commit(model, await changesetId(), { force: true });
    const reloaded = await Model.load(rootPath, { lazyLoad: false });
    const committed = reloaded.getElementById(SERVICE)!;
    expect(committed.getSourceReference()?.locations[0].file).toBe(NEW_FILE);
    expect((committed as any).sourceReference).toBeUndefined();
  });
});
