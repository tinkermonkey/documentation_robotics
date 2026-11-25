/**
 * Compact, paged reads (milestone CLI 0.9.0, "Compact changeset reads"): every read is compact by
 * default, narrows by layer and type, and pages with its true total and the call for the next page.
 *
 * changeset_list (#1250), changeset_show (#1257, #1294), changeset_unstage (#1299), model_search
 * (#1283, #1390), model_show with ids (#1395), changeset_brief's sections (#1281, #1373) and
 * model_trace's limit (#1299).
 *
 * Each test makes its own project, so the file runs under `bun test --concurrent`.
 */

import { describe, it, expect } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelShowHandler } from "../../../src/mcp/tools/model-show.js";
import { modelSearchHandler } from "../../../src/mcp/tools/model-search.js";
import { modelTraceHandler } from "../../../src/mcp/tools/model-trace.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import {
  changesetActivateHandler,
  changesetCreateHandler,
  changesetDeactivateHandler,
} from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetListHandler, CHANGESET_LIST_LIMIT } from "../../../src/mcp/tools/changeset-list.js";
import { changesetShowHandler } from "../../../src/mcp/tools/changeset-show.js";
import { changesetUnstageHandler } from "../../../src/mcp/tools/changeset-editing.js";
import { changesetBriefHandler, changesetBriefTool } from "../../../src/mcp/tools/changeset-analysis-tools.js";
import { UNSTAGE_LINES } from "../../../src/mcp/tools/unstage-report.js";

function parse(result: any): any {
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}

const SERVICE = "application.applicationservice.order-export";
const FUNCTION = "application.applicationfunction.write-csv";
const LEDGER = "application.applicationcomponent.ledger";
const ORDERS = "business.businessservice.orders";

/** A project with a service, a function that realizes it, a component and a business service. */
async function withProject(fn: (rootPath: string) => Promise<void>): Promise<void> {
  const rootPath = join(tmpdir(), `dr-compact-reads-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  try {
    await Model.init(rootPath, { name: "Compact reads", version: "0.1.0" });
    const fixture = parse(
      await modelAddHandler({
        rootPath,
        elements: [
          {
            layer: "application",
            type: "applicationservice",
            name: "order-export",
            description: "Exports orders for the finance team.",
            attributes: { serviceType: "batch" },
          },
          { layer: "application", type: "applicationfunction", name: "write-csv", description: "Writes the order rows as CSV." },
          {
            layer: "application",
            type: "applicationcomponent",
            name: "ledger",
            description: "Keeps the orders export ledger.",
            attributes: { type: "internal" },
          },
          { layer: "business", type: "businessservice", name: "orders", description: "Taking and tracking orders." },
        ],
        relationships: [{ source: FUNCTION, predicate: "realizes", target: SERVICE }],
      } as any)
    );
    if (fixture.elements.counts.added !== 4 || fixture.relationships.counts.added !== 1) {
      throw new Error(`fixture not written: ${JSON.stringify(fixture)}`);
    }
    await fn(rootPath);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
}

/** `n` application functions, staged or not, each realizing the service. */
async function addFunctions(rootPath: string, n: number, prefix = "step"): Promise<string[]> {
  const names = Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
  parse(
    await modelAddHandler({
      rootPath,
      elements: names.map((name) => ({ layer: "application", type: "applicationfunction", name })),
      relationships: names.map((name) => ({ source: `application.applicationfunction.${name}`, predicate: "realizes", target: SERVICE })),
    } as any)
  );
  return names.map((name) => `application.applicationfunction.${name}`);
}

describe("changeset_list: staged by default, counted by status, paged (#1250)", () => {
  it("lists the staged changesets and counts the others", async () => {
    await withProject(async (rootPath) => {
      parse(await changesetCreateHandler({ name: "open-a", rootPath }));
      parse(await changesetCreateHandler({ name: "open-b", rootPath }));
      const landed = parse(await changesetCreateHandler({ name: "landed", rootPath }));
      // Mark one committed, as a landed plan is.
      const storage = new StagedChangesetStorage(rootPath);
      const record = (await storage.load(landed.id))!;
      record.status = "committed";
      await storage.save(record);

      const list = parse(await changesetListHandler({ rootPath }));
      expect(list.status).toBe("staged");
      expect(list.counts).toEqual({ staged: 2, committed: 1, discarded: 0 });
      expect(Object.values(list.changesets).map((c: any) => c.name).sort()).toEqual(["open-a", "open-b"]);
      expect(list.page).toEqual({ total: 2, returned: 2, offset: 0 });
      expect(list.more).toContain("Not listed: 1 committed");

      const all = parse(await changesetListHandler({ status: "all", rootPath }));
      expect(Object.keys(all.changesets)).toHaveLength(3);
      expect(all.more).toBeUndefined();
      const committed = parse(await changesetListHandler({ status: "committed", rootPath }));
      expect(Object.values(committed.changesets).map((c: any) => c.name)).toEqual(["landed"]);

      // A page of one, with the true total and the call for the next page.
      const first = parse(await changesetListHandler({ status: "all", limit: 1, rootPath }));
      expect(first.page).toEqual({ total: 3, returned: 1, offset: 0, nextOffset: 1 });
      expect(first.more).toContain(`changeset_list ${JSON.stringify({ status: "all", limit: 1, rootPath, offset: 1 })}`);
      const seen = new Set<string>();
      for (let offset: number | undefined = 0; offset !== undefined; ) {
        const part = parse(await changesetListHandler({ status: "all", limit: 1, offset, rootPath }));
        for (const id of Object.keys(part.changesets)) seen.add(id);
        offset = part.page.nextOffset;
      }
      expect(seen.size).toBe(3);
      expect(CHANGESET_LIST_LIMIT).toBe(50);
    });
  });
});

describe("changeset_show: compact lines, filters, pages (#1257, #1294)", () => {
  it("narrows by layer, type and operation, and pages every form", async () => {
    await withProject(async (rootPath) => {
      parse(await changesetCreateHandler({ name: "plan", rootPath }));
      const added = await addFunctions(rootPath, 6);
      parse(await modelAddHandler({ layer: "business", type: "businessservice", name: "refunds", rootPath }));

      const all = parse(await changesetShowHandler({ changeset: "plan", rootPath }));
      expect(all.detail).toBe("compact");
      expect(all.totals).toMatchObject({ add: 7, "relationship-add": 6, total: 13 });
      expect(all.byLayer).toEqual({ application: { add: 6, "relationship-add": 6 }, business: { add: 1 } });
      expect(all.changes).toHaveLength(13);
      expect(all.changes[0]).toBe(`#0 add ${added[0]}`);
      expect(all.changes).toContain(`#6 relationship-add ${added[0]} --realizes--> ${SERVICE}`);

      // One layer's element ids: the use #1294 was filed for.
      const business = parse(await changesetShowHandler({ changeset: "plan", layers: ["business"], rootPath }));
      expect(business.changes).toEqual(["#12 add business.businessservice.refunds"]);
      expect(business.matched).toBe(1);
      expect(business.filter).toEqual({ layers: ["business"] });
      // totals and byLayer stay the whole changeset's.
      expect(business.totals.total).toBe(13);

      const fns = parse(
        await changesetShowHandler({ changeset: "plan", types: ["application.applicationfunction"], operations: ["add"], rootPath })
      );
      expect(fns.changes).toEqual(added.map((id, i) => `#${i} add ${id}`));
      // A relationship change is kept when either end is.
      const services = parse(await changesetShowHandler({ changeset: "plan", types: ["applicationservice"], rootPath }));
      expect(services.changes).toHaveLength(6);
      expect(services.changes.every((line: string) => line.includes("relationship-add"))).toBe(true);

      // Pages: the same call with nextOffset continues, and the pages are the whole list.
      const first = parse(await changesetShowHandler({ changeset: "plan", limit: 5, rootPath }));
      expect(first.page).toEqual({ total: 13, returned: 5, offset: 0, nextOffset: 5 });
      expect(first.more).toContain(`changeset_show ${JSON.stringify({ changeset: "plan", limit: 5, rootPath, offset: 5 })}`);
      const lines: string[] = [];
      for (let offset: number | undefined = 0; offset !== undefined; ) {
        const part = parse(await changesetShowHandler({ changeset: "plan", limit: 5, offset, rootPath }));
        lines.push(...part.changes);
        offset = part.page.nextOffset;
      }
      expect(lines).toEqual(all.changes);

      const summary = parse(await changesetShowHandler({ changeset: "plan", detail: "summary", limit: 2, offset: 12, rootPath }));
      expect(summary.changes).toEqual([{ sequence: 12, operation: "add", layer: "business", elementId: "business.businessservice.refunds", elementType: "businessservice" }]);
      const full = parse(await changesetShowHandler({ changeset: "plan", detail: "full", limit: 1, rootPath }));
      expect(full.changes).toHaveLength(1);
      expect(full.changes[0].after).toBeDefined();
      expect(full.page).toMatchObject({ total: 13, nextOffset: 1 });

      // A layer that is not one keeps nothing, and the answer says so.
      const typo = parse(await changesetShowHandler({ changeset: "plan", layers: ["buisness"], rootPath }));
      expect(typo.changes).toEqual([]);
      expect(typo.more).toContain("Not a layer: buisness");
    });
  });
});

describe("changeset_unstage: counts and lines, not every change in full (#1299)", () => {
  it("lists the first changes as lines and counts the rest, in both forms", async () => {
    await withProject(async (rootPath) => {
      parse(await changesetCreateHandler({ name: "plan", rootPath }));
      await addFunctions(rootPath, 30);
      const one = parse(await changesetUnstageHandler({ target: SERVICE, rootPath }));
      expect(one.unstagedCount).toBe(30);
      expect(one.byOperation).toEqual({ "relationship-add": 30 });
      expect(one.unstaged).toHaveLength(UNSTAGE_LINES);
      expect(one.unstaged[0]).toMatch(/^#\d+ relationship-add application\.applicationfunction\.step-0 --realizes--> /);
      expect(one.unstagedNotListed).toBe(30 - UNSTAGE_LINES);
      expect(one.notes.join(" ")).toContain("lists every change this unstage removed");
      // A few kilobytes, where the objects were about 300 bytes each.
      expect(JSON.stringify(one).length).toBeLessThan(5_000);

      const batch = parse(
        await changesetUnstageHandler({ changes: [{ elementId: "application.applicationfunction.step-0" }], rootPath })
      );
      expect(batch.results[0]).toMatchObject({ status: "unstaged", unstagedCount: 1, byOperation: { add: 1 } });
      expect(batch.more).toBeUndefined();

      const full = parse(await changesetUnstageHandler({ elementId: "application.applicationfunction.step-1", detail: "full", rootPath }));
      expect(full.unstaged).toEqual([expect.objectContaining({ type: "add", elementId: "application.applicationfunction.step-1" })]);
    });
  });
});

describe("model_search: excludes, fields, words, ranking, pages (#1283, #1390)", () => {
  it("leaves layers and types out", async () => {
    await withProject(async (rootPath) => {
      const ids = async (args: Record<string, unknown>) =>
        parse(await modelSearchHandler({ ...args, rootPath } as any)).results.map((r: any) => r.id);
      expect(await ids({ query: "order" })).toEqual(expect.arrayContaining([SERVICE, ORDERS]));
      expect(await ids({ query: "order", excludeLayers: ["business"] })).toEqual([SERVICE]);
      expect((await ids({ query: "e", excludeTypes: ["applicationfunction", "business.businessservice"] })).sort()).toEqual([LEDGER, SERVICE]);
      const refused = await modelSearchHandler({ query: "order", excludeLayers: ["buisness"], rootPath });
      expect(refused.isError).toBe(true);
    });
  });

  it("finds words in descriptions and attributes when asked, ranks name hits first, and says where else they are", async () => {
    await withProject(async (rootPath) => {
      const byName = parse(await modelSearchHandler({ query: "finance", rootPath }));
      expect(byName.count).toBe(0);
      expect(byName.more).toContain("1 in description");
      expect(byName.more).toContain('fields: ["id","name","description"]');

      const described = parse(await modelSearchHandler({ query: "finance", fields: ["name", "description"], rootPath }));
      expect(described.results).toEqual([expect.objectContaining({ id: SERVICE, matchedIn: ["description"] })]);

      // A phrase that no element has whole; its words apart, the name hit first.
      const phrase = parse(await modelSearchHandler({ query: "finance ledger", fields: ["name", "description"], rootPath }));
      expect(phrase.count).toBe(0);
      expect(phrase.more).toContain('match: "all" or "any"');
      const any = parse(await modelSearchHandler({ query: "finance ledger", fields: ["name", "description"], match: "any", rootPath }));
      expect(any.results.map((r: any) => r.id)).toEqual([LEDGER, SERVICE]);
      // Words match as substrings: "export" is in "Exports".
      const all = parse(await modelSearchHandler({ query: "orders export", fields: ["description"], match: "all", rootPath }));
      expect(all.results.map((r: any) => r.id).sort()).toEqual([LEDGER, SERVICE]);
      const tracking = parse(await modelSearchHandler({ query: "tracking finance", fields: ["description"], match: "all", rootPath }));
      expect(tracking.count).toBe(0);

      // An exact name comes before a longer one that contains it.
      const exact = parse(await modelSearchHandler({ query: "orders", rootPath }));
      expect(exact.results[0].id).toBe(ORDERS);
    });
  });

  it("finds a staged element by its description inside the active changeset (#1390)", async () => {
    await withProject(async (rootPath) => {
      parse(await changesetCreateHandler({ name: "plan", rootPath }));
      parse(
        await modelAddHandler({
          layer: "application",
          type: "applicationfunction",
          name: "cloud-link-client",
          description: "Keeps the song time in step with the operator console.",
          rootPath,
        })
      );
      const found = parse(await modelSearchHandler({ query: "song time", fields: ["description"], rootPath }));
      expect(found.changeset.name).toBe("plan");
      expect(found.results).toEqual([
        expect.objectContaining({ id: "application.applicationfunction.cloud-link-client", changeStatus: "added", matchedIn: ["description"] }),
      ]);
    });
  });

  it("returns compact entries a page at a time, with the true count and counts by layer and type", async () => {
    await withProject(async (rootPath) => {
      await addFunctions(rootPath, 7);
      const first = parse(await modelSearchHandler({ query: "step-", limit: 3, rootPath }));
      expect(first.count).toBe(7);
      expect(first.results).toHaveLength(3);
      expect(first.page).toEqual({ total: 7, returned: 3, offset: 0, nextOffset: 3 });
      expect(first.byLayer).toEqual([{ layer: "application", count: 7, types: { applicationfunction: 7 } }]);
      expect(first.more).toContain(`model_search ${JSON.stringify({ query: "step-", limit: 3, rootPath, offset: 3 })}`);
      const one = parse(await modelSearchHandler({ query: "write-csv", rootPath }));
      expect(one.results[0]).toEqual({
        layer: "application",
        id: FUNCTION,
        type: "applicationfunction",
        name: "write-csv",
        description: "Writes the order rows as CSV.",
      });
      expect(one.byLayer).toBeUndefined();
    });
  });
});

describe("model_show ids: several elements in one call (#1395)", () => {
  it("returns a card each, lists ids not in the model, and pages", async () => {
    await withProject(async (rootPath) => {
      const shown = parse(await modelShowHandler({ ids: [SERVICE, FUNCTION, "application.applicationservice.nope"], rootPath }));
      expect(shown.detail).toBe("compact");
      expect(shown.elements).toEqual([
        {
          id: SERVICE,
          name: "order-export",
          description: "Exports orders for the finance team.",
          connectionTotal: 1,
          connections: [`realizes ← ${FUNCTION}`],
        },
        {
          id: FUNCTION,
          name: "write-csv",
          description: "Writes the order rows as CSV.",
          connectionTotal: 1,
          connections: [`realizes → ${SERVICE}`],
        },
      ]);
      expect(shown.notFound).toEqual(["application.applicationservice.nope"]);
      expect(shown.more).toContain("Not in the model: application.applicationservice.nope");

      const paged = parse(await modelShowHandler({ ids: [SERVICE, FUNCTION, LEDGER], limit: 2, rootPath }));
      expect(paged.page).toEqual({ total: 3, returned: 2, offset: 0, nextOffset: 2 });
      const full = parse(await modelShowHandler({ ids: [SERVICE], detail: "full", rootPath }));
      expect(full.elements[0].element.path).toBe(SERVICE);
      expect(full.elements[0].relationships.incoming).toHaveLength(1);

      expect((await modelShowHandler({ rootPath })).isError).toBe(true);
      expect((await modelShowHandler({ id: SERVICE, ids: [SERVICE], rootPath })).isError).toBe(true);
    });
  });

  it("counts a busy element's connections past a few per predicate, and marks staged ones", async () => {
    await withProject(async (rootPath) => {
      await addFunctions(rootPath, 4, "base");
      parse(await changesetCreateHandler({ name: "plan", rootPath }));
      await addFunctions(rootPath, 4, "planned");
      const card = parse(await modelShowHandler({ ids: [SERVICE], rootPath })).elements[0];
      expect(card.status).toBe("unchanged");
      expect(card.connectionTotal).toBe(9);
      // What the plan stages comes first, then the base, five per predicate and direction.
      expect(card.connections.slice(0, 4)).toEqual([0, 1, 2, 3].map((i) => `realizes ← application.applicationfunction.planned-${i} (added)`));
      expect(card.connections).toHaveLength(5);
      expect(card.connectionCounts).toEqual({ "realizes ← application": 4 });
      const wide = parse(await modelShowHandler({ ids: [SERVICE], maxConnections: 20, rootPath })).elements[0];
      expect(wide.connections).toHaveLength(9);
      expect(wide.connectionCounts).toBeUndefined();
    });
  });
});

describe("changeset_brief: every top-level block is a section, and drift is named once (#1281, #1373)", () => {
  it("takes summary, byLayer and reach as sections", async () => {
    await withProject(async (rootPath) => {
      parse(await changesetCreateHandler({ name: "plan", rootPath }));
      await addFunctions(rootPath, 2);
      const summary = parse(await changesetBriefHandler({ sections: ["summary"], rootPath }));
      expect(summary.summary).toMatchObject({ elementsAdded: 2, relationshipsAdded: 2 });
      expect(summary.byLayer).toEqual([{ layer: "application", added: 2, updated: 0, deleted: 0 }]);
      expect(summary.changes).toBeUndefined();
      expect(parse(await changesetBriefHandler({ sections: ["reach"], rootPath })).reach.touched).toEqual(["application"]);
      const byType = parse(await changesetBriefHandler({ sections: ["changesByType"], rootPath })).changesByType;
      expect(byType).toEqual([expect.objectContaining({ type: "application.applicationfunction", added: 2 })]);
      // A name that is not a section is refused with the ones that are.
      const refused = changesetBriefTool.inputSchema.sections.safeParse(["sumary"]);
      expect(refused.success).toBe(false);
      expect(JSON.stringify(refused.error!.issues)).toContain("summary");
    });
  });

  it("names the drift once and pages its lists with the answer's other lists", async () => {
    await withProject(async (rootPath) => {
      parse(await changesetCreateHandler({ name: "plan", rootPath }));
      await addFunctions(rootPath, 1, "planned");
      // The base moves under the plan: three elements land in it.
      parse(await changesetDeactivateHandler({ rootPath }));
      await addFunctions(rootPath, 3, "landed");
      parse(await changesetActivateHandler({ changeset: "plan", rootPath }));

      const both = parse(await changesetBriefHandler({ sections: ["changeset", "drift"], limit: 2, rootPath }));
      expect(both.changeset.drift).toBeUndefined();
      expect(both.drift.isDrifted).toBe(true);
      expect(both.drift.baseChanges.counts).toMatchObject({ elementsAdded: 3, relationshipsAdded: 3 });
      expect(both.drift.baseChanges.elementsAdded).toHaveLength(2);
      expect(both.page.totals).toMatchObject({ "drift.elementsAdded": 3, "drift.relationshipsAdded": 3 });
      expect(both.page.nextOffset).toBe(2);
      const rest = parse(await changesetBriefHandler({ sections: ["changeset", "drift"], limit: 2, offset: 2, rootPath }));
      expect([...both.drift.baseChanges.elementsAdded, ...rest.drift.baseChanges.elementsAdded].sort()).toEqual(
        [0, 1, 2].map((i) => `application.applicationfunction.landed-${i}`)
      );
      expect(rest.page.nextOffset).toBeUndefined();

      // Asked for alone, the changeset section carries the drift in its compact form.
      const alone = parse(await changesetBriefHandler({ sections: ["changeset"], rootPath }));
      expect(alone.changeset.drift).toMatchObject({ isDrifted: true, baseChanges: { counts: { elementsAdded: 3 } } });
      // driftLimit still pages the drift's lists apart from the answer's.
      const apart = parse(await changesetBriefHandler({ sections: ["drift"], driftLimit: 1, rootPath }));
      expect(apart.drift.baseChanges.elementsAdded).toHaveLength(1);
      expect(apart.drift.baseChanges.page).toMatchObject({ nextOffset: 1 });
    });
  });
});

describe("model_trace honours limit on every list (#1299)", () => {
  it("pages the changed edges with their true total", async () => {
    await withProject(async (rootPath) => {
      parse(await changesetCreateHandler({ name: "plan", rootPath }));
      await addFunctions(rootPath, 6, "planned");
      const trace = parse(await modelTraceHandler({ id: SERVICE, limit: 2, rootPath }));
      expect(trace.changedEdges).toHaveLength(2);
      expect(trace.page.totals.changedEdges).toBe(6);
      expect(trace.page.nextOffset).toBe(2);
      expect(trace.more).toContain("offset: 2");
    });
  });
});

describe("review of PR 1451: no answer reads as complete when it is not", () => {
  it("names a type that is not one in changeset_show and in the brief, instead of an empty list read as whole", async () => {
    await withProject(async (rootPath) => {
      parse(await changesetCreateHandler({ name: "plan", rootPath }));
      await addFunctions(rootPath, 2);
      const shown = parse(await changesetShowHandler({ changeset: "plan", types: ["aplicationfunction"], rootPath }));
      expect(shown.changes).toEqual([]);
      expect(shown.more).toContain("Not an element type: aplicationfunction (did you mean applicationfunction?)");
      const brief = parse(await changesetBriefHandler({ sections: ["changes"], types: ["aplicationfunction"], rootPath }));
      expect(brief.changes).toEqual([]);
      expect(brief.more).toContain("Not an element type: aplicationfunction");
      // The brief's unknown layers go through the same note, otherLayers included.
      const layers = parse(await changesetBriefHandler({ sections: ["layers"], otherLayers: ["prodct"], rootPath }));
      expect(layers.more).toContain("Not a layer: prodct");
    });
  });

  it("says changesByType is cut, and names the call that lists a type whole", async () => {
    await withProject(async (rootPath) => {
      parse(await changesetCreateHandler({ name: "plan", rootPath }));
      await addFunctions(rootPath, 8);
      const result = parse(await changesetBriefHandler({ sections: ["changesByType"], rootPath }));
      expect(result.changesByType).toEqual([expect.objectContaining({ type: "application.applicationfunction", added: 8, more: 3 })]);
      expect(result.more).toContain("application.applicationfunction: 3 more");
      expect(result.more).toContain(
        `changeset_brief ${JSON.stringify({ rootPath, sections: ["changes"], types: ["application.applicationfunction"] })}`
      );
      expect(result.more).not.toContain("Every list is whole");
      // The call it names lists all eight.
      const all = parse(await changesetBriefHandler({ sections: ["changes"], types: ["application.applicationfunction"], rootPath }));
      expect(all.changes).toHaveLength(8);
    });
  });

  it("names the call that lists every change an unstage removed past the lines it shows", async () => {
    await withProject(async (rootPath) => {
      const plan = parse(await changesetCreateHandler({ name: "plan", rootPath }));
      const added = await addFunctions(rootPath, 30);
      const result = parse(await changesetUnstageHandler({ target: SERVICE, rootPath }));
      expect(result.unstagedNotListed).toBe(5);
      const named = /changeset_brief (\{.*?\}) lists every change/.exec(result.notes.join(" "))![1];
      const call = JSON.parse(named);
      expect(call).toEqual({ changeset: plan.id, sections: ["delta"], since: expect.any(Number) });
      // That call lists all 30, the 5 not shown included.
      const brief = parse(await changesetBriefHandler({ ...call, rootPath }));
      expect(brief.delta.unstaged).toHaveLength(30);
      for (const id of added) expect(brief.delta.unstaged.some((line: string) => line.includes(`${id} --realizes-->`))).toBe(true);
    });
  });

  it("lists changesets newest first", async () => {
    await withProject(async (rootPath) => {
      const storage = new StagedChangesetStorage(rootPath);
      for (const [name, created] of [
        ["middle", "2026-11-02T00:00:00.000Z"],
        ["oldest", "2026-11-01T00:00:00.000Z"],
        ["newest", "2026-11-03T00:00:00.000Z"],
      ]) {
        const made = parse(await changesetCreateHandler({ name, activate: false, rootPath } as any));
        const record = (await storage.load(made.id))!;
        record.created = created;
        await storage.save(record);
      }
      const list = parse(await changesetListHandler({ rootPath }));
      expect(Object.values(list.changesets).map((c: any) => c.name)).toEqual(["newest", "middle", "oldest"]);
    });
  });

  it("keeps a limited unwired page near targetBytes through the tool, and says it holds fewer (#1334)", async () => {
    await withProject(async (rootPath) => {
      parse(await changesetCreateHandler({ name: "plan", rootPath }));
      await addFunctions(rootPath, 20);
      // One function's unwired listing is about 4 KB: room for a few, not all 20.
      const targetBytes = 16_000;
      const result = await changesetBriefHandler({ sections: ["unwired"], limit: 20, targetBytes, rootPath });
      const json = parse(result);
      expect(json.page.totals.unwired).toBe(20);
      expect(json.page.returned.unwired).toBeGreaterThan(1);
      expect(json.page.returned.unwired).toBeLessThan(20);
      expect(json.page.nextOffset).toBe(json.page.returned.unwired);
      expect(json.more).toContain("limit 20 would take this answer past the 16 KB target");
      expect(Buffer.byteLength(result.content[0].text as string)).toBeLessThanOrEqual(targetBytes);
    });
  });

  it("pages the unchanged cards with the answer's other lists (#1395)", async () => {
    await withProject(async (rootPath) => {
      const base = await addFunctions(rootPath, 3, "base");
      parse(await changesetCreateHandler({ name: "plan", rootPath }));
      await addFunctions(rootPath, 1, "planned");
      const ids = ["application.applicationfunction.planned-0", ...base, LEDGER];
      const first = parse(await changesetBriefHandler({ sections: ["changes"], ids, limit: 2, rootPath }));
      expect(first.changes).toHaveLength(1);
      expect(first.unchanged.map((c: any) => c.id)).toEqual(base.slice(0, 2));
      expect(first.page.totals).toMatchObject({ changes: 1, unchanged: 4 });
      expect(first.page.nextOffset).toBe(2);
      const second = parse(await changesetBriefHandler({ sections: ["changes"], ids, limit: 2, offset: 2, rootPath }));
      expect(second.unchanged.map((c: any) => c.id)).toEqual([base[2], LEDGER]);
      expect(second.page.nextOffset).toBeUndefined();
    });
  });

  it("says the changeset section's drift lists only some base changes, and where the rest are", async () => {
    await withProject(async (rootPath) => {
      parse(await changesetCreateHandler({ name: "plan", rootPath }));
      await addFunctions(rootPath, 1, "planned");
      parse(await changesetDeactivateHandler({ rootPath }));
      await addFunctions(rootPath, 2, "landed");
      parse(await changesetActivateHandler({ changeset: "plan", rootPath }));
      const result = parse(await changesetBriefHandler({ sections: ["changeset"], rootPath }));
      expect(result.changeset.drift.baseChanges.counts.elementsAdded).toBe(2);
      expect(result.more).toContain('sections: ["drift"] lists them all');
      expect(result.more).not.toContain("Every list is whole");
      // The default compact brief says it too.
      expect(parse(await changesetBriefHandler({ rootPath })).more).toContain('sections: ["drift"] lists them all');
    });
  });

  it("model_search: the hint counts words split between a searched field and one that is not; all fields at once; full detail", async () => {
    await withProject(async (rootPath) => {
      // "ledger" is in the name, "export" only in the description.
      const split = parse(await modelSearchHandler({ query: "ledger export", match: "all", rootPath }));
      expect(split.count).toBe(0);
      expect(split.more).toContain("1 in description");
      const every = parse(
        await modelSearchHandler({ query: "ledger export", match: "all", fields: ["id", "name", "description", "attributes"], rootPath })
      );
      expect(every.results.map((r: any) => r.id)).toEqual([LEDGER]);
      // Attribute values are searched too.
      const attribute = parse(await modelSearchHandler({ query: "batch", fields: ["attributes"], rootPath }));
      expect(attribute.results).toEqual([expect.objectContaining({ id: SERVICE, matchedIn: ["attributes"] })]);

      const long = `Exports orders. ${"It writes every row the finance team asks for, in order. ".repeat(5)}`;
      parse(await modelAddHandler({ layer: "business", type: "businessservice", name: "long-export", description: long, rootPath }));
      const compact = parse(await modelSearchHandler({ query: "long-export", rootPath }));
      expect(compact.results[0].description).toBe("Exports orders. …");
      const full = parse(await modelSearchHandler({ query: "long-export", detail: "full", rootPath }));
      expect(full.results[0].description).toBe(long);
    });
  });
});
