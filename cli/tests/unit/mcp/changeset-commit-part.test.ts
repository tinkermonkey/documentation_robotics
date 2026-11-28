/**
 * Landing part of a plan (#1388) and milestone scope (#1389), through the real tool surface.
 * A plan with two milestones, a feature scheduled for each, and a service realizing each feature:
 * the first milestone's part lands as its own committed changeset, the rest stays staged.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Model } from "../../../src/core/model.js";
import { CHANGESET_ONLY_ENV } from "../../../src/core/changeset-only-guard.js";
import { McpToolRegistry } from "../../../src/mcp/tool-registry.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetShowHandler } from "../../../src/mcp/tools/changeset-show.js";

const M1 = "product.milestone.v1";
const M2 = "product.milestone.v2";
const F1 = "product.feature.export-csv";
const F2 = "product.feature.crowd-control";
const S1 = "application.applicationservice.csv-exporter";
const S2 = "application.applicationservice.crowd-service";

let rootPath: string;
let savedEnv: string | undefined;
let client: Client | undefined;

const parse = (result: any) => JSON.parse(result.content[0].text);

async function connect(): Promise<Client> {
  const server = new McpServer({ name: "dr-test", version: "0.0.0" });
  new McpToolRegistry().registerAll(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const created = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: {} });
  await created.connect(clientTransport);
  client = created;
  return created;
}

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  return (client ?? (await connect())).callTool({ name, arguments: { rootPath, ...args } });
}

async function link(source: string, predicate: string, target: string): Promise<void> {
  const added = parse(await relationshipAddHandler({ source, predicate, target, rootPath }));
  expect(added.status).toBe("staged");
}

async function baseText(): Promise<string> {
  const dir = join(rootPath, "documentation-robotics", "model");
  const files = (await readdir(dir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((f) => join(f.parentPath, f.name)).sort();
  return (await Promise.all(files.map((f) => readFile(f, "utf-8")))).join("\n");
}

async function show(name: string): Promise<any> {
  return parse(await changesetShowHandler({ changesetId: name, rootPath }));
}

beforeEach(async () => {
  savedEnv = process.env[CHANGESET_ONLY_ENV];
  delete process.env[CHANGESET_ONLY_ENV];
  clearModelCache();
  rootPath = join(tmpdir(), `dr-mcp-commit-part-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Commit Part Test Model", version: "0.1.0" });
  await changesetCreateHandler({ name: "roadmap", description: "Two steps of a roadmap", rootPath });
  await modelAddHandler({ layer: "product", type: "milestone", name: "v1", attributes: { status: "planned" }, rootPath });
  await modelAddHandler({ layer: "product", type: "milestone", name: "v2", attributes: { status: "planned" }, rootPath });
  await modelAddHandler({ layer: "product", type: "feature", name: "export-csv", attributes: { priority: "high", status: "planned" }, rootPath });
  await modelAddHandler({ layer: "product", type: "feature", name: "crowd-control", attributes: { priority: "high", status: "planned" }, rootPath });
  await modelAddHandler({ layer: "application", type: "applicationservice", name: "csv-exporter", attributes: { serviceType: "synchronous" }, rootPath });
  await modelAddHandler({ layer: "application", type: "applicationservice", name: "crowd-service", attributes: { serviceType: "synchronous" }, rootPath });
  await link(F1, "scheduled-for", M1);
  await link(F2, "scheduled-for", M2);
  await link(S1, "realizes", F1);
  await link(S2, "realizes", F2);
});

afterEach(async () => {
  await client?.close();
  client = undefined;
  if (savedEnv === undefined) delete process.env[CHANGESET_ONLY_ENV];
  else process.env[CHANGESET_ONLY_ENV] = savedEnv;
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("milestone scope (#1389)", () => {
  it("model_search with milestone lists the features scheduled for it and what realizes them, with a true total", async () => {
    const result = parse(await call("model_search", { milestone: "v1" }));
    expect(result.count).toBe(2);
    expect(result.results.map((r: any) => r.id).sort()).toEqual([S1, F1]);
    expect(result.results.find((r: any) => r.id === S1).scopeVia).toBe(`realizes ${F1}`);
    expect(result.milestone).toMatchObject({ milestones: [M1], scheduled: 1, inScope: 2 });
    const both = parse(await call("model_search", { milestone: [M1, M2], limit: 1 }));
    expect(both.count).toBe(4);
    expect(both.page).toMatchObject({ total: 4, returned: 1 });
  });

  it("refuses a milestone the model does not have, listing the ones it has", async () => {
    const result = await call("model_search", { milestone: "v9" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(M1);
  });

  it("changeset_brief with milestone covers only the changed elements in its scope", async () => {
    const brief = parse(await call("changeset_brief", { changeset: "roadmap", sections: ["changes"], milestone: M1, detail: "full" }));
    const text = JSON.stringify(brief);
    expect(text).toContain(S1);
    expect(text).not.toContain(S2);
    expect(brief.milestone).toMatchObject({ milestones: [M1], inScope: 2, changedInScope: 2 });
  });
});

describe("landing part of a plan (#1388)", () => {
  it("previews the links that cross the boundary of a part chosen by ids", async () => {
    const preview = parse(await call("changeset_commit_preview", { changeset: "roadmap", ids: [F1] }));
    expect(preview.status).toBe("crossing-links");
    expect(preview.partial.crossing.count).toBe(2);
    expect(preview.partial.crossing.links.join("\n")).toContain(`${S1} --realizes--> ${F1}`);
    expect(preview.partial.lands.elements).toBe(1);
  });

  it("refuses to land a part with crossing links unless told what to do, and lands nothing", async () => {
    const result = await call("changeset_commit", { changeset: "roadmap", ids: [F1] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("cross the boundary");
    expect((await show("roadmap")).status).toBe("staged");
    expect((await baseText())).not.toContain("export-csv");
  });

  it("lands a milestone's part as its own changeset and keeps the rest staged as the plan", async () => {
    const preview = parse(await call("changeset_commit_preview", { changeset: "roadmap", milestone: M1, crossing: "include" }));
    expect(preview.status).toBe("ready-to-commit");
    expect(preview.partial.lands).toMatchObject({ elements: 3 });
    expect(preview.summary).toContain('part of "roadmap"');
    // The preview left nothing behind but the plan.
    const before = parse(await call("changeset_list", {}));
    expect(JSON.stringify(before)).not.toContain("roadmap-landed");

    const landed = parse(await call("changeset_commit", { changeset: "roadmap", milestone: M1, crossing: "include" }));
    expect(landed.status).toBe("committed");
    expect(landed.name).toBe("roadmap-landed");
    expect(landed.partOf.plan).toMatchObject({ name: "roadmap", status: "staged" });
    expect(landed.partOf.part.lands.elements).toBe(3);

    const base = await baseText();
    expect(base).toContain("export-csv");
    expect(base).toContain("csv-exporter");
    expect(base).not.toContain("crowd-control");
    const relationships = await readFile(join(rootPath, "documentation-robotics", "model", "relationships.yaml"), "utf-8");
    expect(relationships).toContain("export-csv");
    expect(relationships).not.toContain("crowd");

    // The plan stays staged with what is left, and records the part.
    const plan = await show("roadmap");
    expect(plan.status).toBe("staged");
    const text = JSON.stringify(plan);
    expect(text).toContain("crowd-control");
    expect(text).not.toContain("export-csv");
    const record = await readFile(join(rootPath, "documentation-robotics", "changesets", plan.id, "metadata.yaml"), "utf-8");
    expect(record).toContain("landed:");
    expect(record).toContain("roadmap-landed");
    // The landed half is a committed changeset in the model's history.
    expect(await readFile(join(rootPath, "documentation-robotics", "model", "manifest.yaml"), "utf-8")).toContain("roadmap-landed");

    // The rest lands as before.
    const rest = parse(await call("changeset_commit", { changeset: "roadmap" }));
    expect(rest.status).toBe("committed");
    expect(await baseText()).toContain("crowd-control");
  });

  it("with crossing leave, lands the chosen elements and keeps their crossing links staged", async () => {
    const landed = parse(await call("changeset_commit", { changeset: "roadmap", ids: [F1, S1], crossing: "leave" }));
    expect(landed.status).toBe("committed");
    expect(landed.partOf.part.crossing.count).toBe(1);
    expect(landed.partOf.part.lands).toMatchObject({ elements: 2, relationships: 1 });
    const plan = JSON.stringify(await show("roadmap"));
    // The link to the milestone, which did not land, is still planned.
    expect(plan).toContain("v1");
    expect(plan).not.toContain("csv-exporter");
  });

  it("chooses the part by source reference", async () => {
    await call("model_update", { id: S1, sourceFile: "src/exporter.ts", sourceSymbol: "CsvExporter", sourceProvenance: "manual" });
    const preview = parse(await call("changeset_commit_preview", { changeset: "roadmap", withSourceReference: true }));
    expect(preview.partial.lands.elements).toBe(1);
    expect(preview.partial.elements).toEqual([S1]);
  });

  it("refuses an empty part instead of landing the whole plan", async () => {
    for (const args of [{ ids: [] }, { milestone: [] }, { milestone: " " }]) {
      const result = await call("changeset_commit", { changeset: "roadmap", ...args });
      expect(result.isError).toBe(true);
    }
    expect((await show("roadmap")).status).toBe("staged");
  });

  it("keeps an edit staged while the part landed, instead of losing it", async () => {
    // The part is copied, then the plan's S1 is edited in place (same sequence number), then the plan is trimmed.
    const { StagingAreaManager } = await import("../../../src/core/staging-area.js");
    const { planPartialLanding, changesOfPart } = await import("../../../src/core/partial-landing.js");
    const model = await Model.load(rootPath, { lazyLoad: false });
    const manager = new StagingAreaManager(rootPath, model);
    const plan = (await manager.load("roadmap"))!;
    const part = await planPartialLanding(model, plan, { ids: [S1], crossing: "leave" });
    const copied = changesOfPart(plan, part);
    await call("model_update", { id: S1, description: "EDITED-DURING-LANDING" });
    const kept = await manager.removeLanded(plan.id!, copied, { changeset: "x", id: "x", at: "now", selection: "ids", elements: [S1], relationships: 0 });
    expect(kept.length).toBe(1);
    expect(JSON.stringify(parse(await call("changeset_show", { changeset: "roadmap", detail: "full" })))).toContain("EDITED-DURING-LANDING");
  });

  it("leaves a link's removal with the deletion it belongs to when the part does not take the deletion", async () => {
    expect(parse(await call("changeset_commit", { changeset: "roadmap" })).status).toBe("committed");
    await changesetCreateHandler({ name: "p2", description: "Reword the exporter, drop the feature", rootPath });
    await call("model_update", { id: S1, description: "Exports orders as CSV" });
    await call("model_delete", { id: F1 });
    const staged = JSON.stringify(parse(await call("changeset_show", { changeset: "p2" })));
    expect(staged).toContain("relationship-delete");

    const landed = parse(await call("changeset_commit", { changeset: "p2", ids: [S1], crossing: "leave" }));
    expect(landed.status).toBe("committed");
    expect(landed.partOf.part.lands.relationships).toBe(0);
    // The link is still in the base: its removal waits with the deletion of F1, which is still planned.
    const relationships = await readFile(join(rootPath, "documentation-robotics", "model", "relationships.yaml"), "utf-8");
    expect(relationships).toContain(S1);
    expect(relationships).toContain(F1);
    const plan = JSON.stringify(parse(await call("changeset_show", { changeset: "p2" })));
    expect(plan).toContain("relationship-delete");
    expect(plan).toContain(`delete ${F1}`);
  });

  it("refuses a part that names nothing the plan changes", async () => {
    const result = await call("changeset_commit", { changeset: "roadmap", ids: ["product.feature.nope"] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Nothing in the plan matches");
  });
});

describe("changeset_verify and changeset_adopt_source_references with milestone (#1389)", () => {
  it("computes the verdict and counts over the milestone's scope, with the whole plan's beside them", async () => {
    const whole = parse(await call("changeset_verify", { changeset: "roadmap", against: { base: true } }));
    const scoped = parse(await call("changeset_verify", { changeset: "roadmap", against: { base: true }, milestone: M1 }));
    expect(scoped.subset.filter.milestone).toEqual({ milestones: [M1], elementCount: 2 });
    expect(scoped.subset.planned.elements).toBe(2);
    expect(scoped.verdictText).toContain(`milestone ${M1}`);
    expect(scoped.summary.elements.planned).toBe(2);
    expect(scoped.wholePlan.summary.elements.planned).toBe(whole.summary.elements.planned);
    expect(whole.summary.elements.planned).toBeGreaterThan(2);
  });

  it("adopt lists the unreferenced elements of the milestone's scope only", async () => {
    const adopted = parse(
      await call("changeset_adopt_source_references", { changeset: "roadmap", against: { base: true }, milestone: M1 })
    );
    expect(adopted.unreferenced.count).toBe(2);
    const all = parse(await call("changeset_adopt_source_references", { changeset: "roadmap", against: { base: true } }));
    expect(all.unreferenced.count).toBeGreaterThan(2);
  });
});
