/**
 * `origin` shown compactly where a person or agent reads a changeset (rollout PR 5, following PR
 * 4): `originLabel`'s one line; `changeset_show`'s summary entries; `changeset_brief`'s compact
 * changes, build view and large-plan counts; `dr changeset staged`'s table and JSON. Only changes
 * that carry an origin (codebase_extract's) show one, so a hand-made plan's output is unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { originLabel, type ChangeOrigin } from "../../../src/core/changeset.js";
import { summarizeChange } from "../../../src/core/changeset-summary.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";
import { changesByType } from "../../../src/core/changeset-brief-compact.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetShowHandler } from "../../../src/mcp/tools/changeset-show.js";
import { changesetBriefHandler } from "../../../src/mcp/tools/changeset-analysis-tools.js";
import { changesetStagedCommand } from "../../../src/commands/changeset.js";
import { setJsonMode } from "../../../src/utils/globals.js";

const TIER1: ChangeOrigin = {
  by: "tier1",
  rule: "tier1:dr-qset-2",
  provider: "cloudflare-workers-ai",
  model: "@cf/cloudflare/clef", // as codebase_extract stores it: the provider's id
  p: { layer: 0.8234, type: 0.7051 },
  confirmed: "agent",
};
const TIER0: ChangeOrigin = { by: "tier0", rule: "node-mapping:Route" };

describe("originLabel", () => {
  it("is one short line per decider", () => {
    expect(originLabel(TIER1)).toBe("tier1 clef p=0.82/0.71 confirmed=agent");
    expect(originLabel({ by: "tier1", provider: "openrouter", model: "cloudflare/clef", upstream: "deepinfra", p: { layer: 0.9, type: null } })).toBe(
      "tier1 cloudflare/clef via deepinfra p=0.90/-"
    );
    expect(originLabel({ by: "tier1", provider: "cloudflare-workers-ai" })).toBe("tier1 cloudflare-workers-ai");
    // The provider's id maps to the short name users configure; an id the registry doesn't know shows as stored.
    expect(originLabel({ by: "tier1", provider: "cloudflare-workers-ai", model: "@cf/cloudflare/clef-flash" })).toBe("tier1 clef-flash");
    expect(originLabel({ by: "tier1", provider: "cloudflare-workers-ai", model: "@cf/someone/else" })).toBe("tier1 @cf/someone/else");
    expect(originLabel(TIER0)).toBe("tier0 node-mapping:Route");
    expect(originLabel({ by: "tier0" })).toBe("tier0");
    expect(originLabel({ by: "agent" })).toBe("agent");
  });

  it("survives a hand-edited origin without a decider", () => {
    expect(originLabel({} as ChangeOrigin)).toBe("unknown");
  });
});

describe("summarizeChange", () => {
  it("adds the origin line when the change has one, and nothing otherwise", () => {
    const add = { type: "add" as const, elementId: "application.applicationservice.a", layerName: "application", after: { type: "applicationservice" } };
    expect(summarizeChange({ ...add, origin: TIER1 }, 0).origin).toBe("tier1 clef p=0.82/0.71 confirmed=agent");
    expect(summarizeChange(add, 0)).not.toHaveProperty("origin");
    const rel = { type: "relationship-add" as const, elementId: "a.b.c::realizes::d.e.f", layerName: "a", after: { source: "a.b.c", predicate: "realizes", target: "d.e.f" }, origin: TIER0 };
    expect(summarizeChange(rel, 1)).toMatchObject({ source: "a.b.c", predicate: "realizes", target: "d.e.f", origin: "tier0 node-mapping:Route" });
  });
});

describe("changesByType", () => {
  it("counts each type's changes per decider when any carries an origin", () => {
    const change = (id: string, origin?: string) => ({ op: "added" as const, id, type: id.split(".")[1], name: id, connections: [], ...(origin ? { origin } : {}) });
    const groups = changesByType({
      layers: [
        {
          layer: "application",
          changes: [
            change("application.applicationservice.a", "tier1 clef p=0.82/0.71"),
            change("application.applicationservice.b", "tier0 node-mapping:Service"),
            change("application.applicationservice.c", "tier0 node-mapping:Service"),
            change("application.applicationcomponent.d"),
          ],
        },
      ],
    } as any);
    expect(groups.find((g) => g.type === "application.applicationservice")!.byOrigin).toEqual({ tier1: 1, tier0: 2 });
    expect(groups.find((g) => g.type === "application.applicationcomponent")).not.toHaveProperty("byOrigin");
  });
});

describe("changeset views of a changeset codebase_extract staged", () => {
  const SERVICE = "application.applicationservice.owner-service";
  const COMPONENT = "application.applicationcomponent.hand-made";
  let rootPath: string;
  let changesetId: string;

  function text(result: any): string {
    if (result.isError) throw new Error(result.content[0].text);
    return result.content[0].text;
  }

  beforeEach(async () => {
    clearModelCache();
    rootPath = join(tmpdir(), `dr-origin-display-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(rootPath, { recursive: true });
    await Model.init(rootPath, { name: "Origin Display Test", version: "0.1.0" });
    changesetId = JSON.parse(text(await changesetCreateHandler({ name: "as-built", rootPath } as any))).id;
    text(await modelAddHandler({ layer: "application", type: "applicationservice", name: "owner-service", attributes: { serviceType: "synchronous" }, rootPath } as any));
    text(await modelAddHandler({ layer: "application", type: "applicationcomponent", name: "hand-made", attributes: { type: "internal" }, rootPath } as any));
    // Give the service the origin codebase_extract would have set.
    const storage = new StagedChangesetStorage(rootPath);
    const changeset = (await storage.load(changesetId))!;
    changeset.changes.find((c) => c.elementId === SERVICE)!.origin = TIER1;
    await storage.save(changeset);
    clearModelCache();
  });

  afterEach(async () => {
    setJsonMode(false);
    clearModelCache();
    await rm(rootPath, { recursive: true, force: true });
  });

  it("changeset_show: the object in full, one line in summary", async () => {
    const full = JSON.parse(text(await changesetShowHandler({ changesetId, rootPath })));
    expect(full.changes.find((c: any) => c.elementId === SERVICE).origin).toEqual(TIER1);
    const summary = JSON.parse(text(await changesetShowHandler({ changesetId, rootPath, detail: "summary" })));
    expect(summary.changes.find((c: any) => c.elementId === SERVICE).origin).toBe("tier1 clef p=0.82/0.71 confirmed=agent");
    expect(summary.changes.find((c: any) => c.elementId === COMPONENT)).not.toHaveProperty("origin");
  });

  it("changeset_brief: the compact changes and the build view carry the line", async () => {
    const compact = JSON.parse(text(await changesetBriefHandler({ changesetId, rootPath } as any)));
    const byId = Object.fromEntries(compact.changes.map((c: any) => [c.id, c]));
    expect(byId[SERVICE].origin).toBe("tier1 clef p=0.82/0.71 confirmed=agent");
    expect(byId[COMPONENT]).not.toHaveProperty("origin");

    const build = JSON.parse(text(await changesetBriefHandler({ changesetId, rootPath, sections: ["changes"] } as any)));
    expect(build.changes.find((c: any) => c.id === SERVICE).origin).toBe("tier1 clef p=0.82/0.71 confirmed=agent");
  });

  it("dr changeset staged: an Origin column, and origin in --json", async () => {
    const tables: any[] = [];
    const logs: string[] = [];
    const table = spyOn(console, "table").mockImplementation((data: any) => void tables.push(data));
    const log = spyOn(console, "log").mockImplementation((...args: any[]) => void logs.push(args.join(" ")));
    try {
      await changesetStagedCommand({ model: rootPath });
      const rows = tables[0] as Array<Record<string, string>>;
      expect(rows.find((r) => r["Element ID"] === SERVICE)!.Origin).toBe("tier1 clef p=0.82/0.71 confirmed=agent");
      expect(rows.find((r) => r["Element ID"] === COMPONENT)!.Origin).toBe("");

      setJsonMode(true);
      logs.length = 0;
      await changesetStagedCommand({ model: rootPath });
      const json = JSON.parse(logs.find((l) => l.trim().startsWith("{"))!);
      const changes = json.changes ?? json.data?.changes;
      const service = changes.find((c: any) => c.elementId === SERVICE);
      expect(service.origin).toEqual(TIER1);
      expect(service.originLabel).toBe("tier1 clef p=0.82/0.71 confirmed=agent");
      expect(changes.find((c: any) => c.elementId === COMPONENT)).not.toHaveProperty("origin");
    } finally {
      table.mockRestore();
      log.mockRestore();
    }
  });
});
