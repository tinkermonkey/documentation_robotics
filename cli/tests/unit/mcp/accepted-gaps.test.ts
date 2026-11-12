/**
 * Accepted gaps (#1026): an element records that a connection the catalog allows for its type is
 * deliberately absent. gap_accept and gap_reopen stage it into the active changeset; the brief lists
 * matching unwired connections and peer-pattern gaps as accepted; model_show and spec_type show it;
 * extraction, changeset_verify and codebase_verify report it as contradicted when the code has the
 * connection; validation is informational only. See docs/CHANGE_MODELING.md.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "yaml";
import { Model } from "../../../src/core/model.js";
import { Element } from "../../../src/core/element.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import {
  acceptedGapNotices,
  catalogEntryForGap,
  gapCatalogProblem,
  readAcceptedGaps,
  type AcceptedGap,
} from "../../../src/core/accepted-gaps.js";
import { routeHandlerContradictions, splitByAcceptedGaps } from "../../../src/core/accepted-gaps-verify.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelShowHandler } from "../../../src/mcp/tools/model-show.js";
import { modelValidateHandler } from "../../../src/mcp/tools/model-validate.js";
import { changesetCreateHandler, changesetActivateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { changesetBriefHandler } from "../../../src/mcp/tools/changeset-analysis-tools.js";
import { changesetVerifyHandler } from "../../../src/mcp/tools/changeset-verify.js";
import { specTypeHandler } from "../../../src/mcp/tools/spec-type.js";
import { gapAcceptHandler, gapReopenHandler } from "../../../src/mcp/tools/gap-tools.js";

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

function errorText(result: any): string {
  expect(result.isError).toBe(true);
  return result.content[0].text;
}

const GOAL = "motivation.goal.faster-checkout";
const SERVICE = "application.applicationservice.checkout";
const FUNCTION = "application.applicationfunction.export-orders";
const OPERATION = "api.operation.export-orders";

/** The triple the tests accept: no API operation realizes the export function. */
const NO_OPERATION = {
  direction: "incoming" as const,
  predicate: "realizes",
  otherType: "api.operation",
};

let rootPath: string;

async function add(args: Record<string, unknown>): Promise<void> {
  const result = await modelAddHandler({ ...(args as any), rootPath });
  if (result.isError) throw new Error((result.content[0] as any).text);
}

async function relate(source: string, predicate: string, target: string): Promise<void> {
  const result = await relationshipAddHandler({ source, predicate, target, rootPath });
  if (result.isError) throw new Error((result.content[0] as any).text);
}

/** Plans "export orders": a function realizing the checkout service, and nothing in the API. */
async function planExport(name = "export-orders"): Promise<void> {
  await changesetCreateHandler({ name, description: "Nightly order export job", rootPath });
  await add({ layer: "application", type: "applicationfunction", name: "export-orders" });
  await relate(FUNCTION, "realizes", SERVICE);
}

async function accept(extra: Record<string, unknown> = {}) {
  return gapAcceptHandler({ element: FUNCTION, ...NO_OPERATION, reason: "A nightly job: no API exposes it", ...extra, rootPath } as any);
}

async function commit(name: string): Promise<void> {
  clearModelCache();
  const model = await Model.load(rootPath, { lazyLoad: false });
  const manager = new StagingAreaManager(model.rootPath, model);
  const changeset = await manager.load(name);
  const result = await manager.commit(model, changeset!.id, { validate: true });
  expect(result.failed).toBe(0);
  // As changeset_commit does: the landed changeset is no longer the active one.
  await manager.clearActive();
  clearModelCache();
}

async function layerFileWith(id: string): Promise<string> {
  const dir = join(rootPath, "documentation-robotics", "model");
  const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith(".yaml"))
    .map((e) => join(e.parentPath, e.name));
  for (const file of files) {
    if ((await readFile(file, "utf8")).includes(`${id}:`)) return file;
  }
  throw new Error(`no layer file holds ${id}`);
}

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-accepted-gaps-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Accepted Gaps Test Model", version: "0.1.0" });
  await add({ layer: "motivation", type: "goal", name: "faster-checkout", attributes: { priority: "high" } });
  await add({ layer: "application", type: "applicationservice", name: "checkout", attributes: { serviceType: "synchronous" } });
  await relate(SERVICE, "realizes", GOAL);
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("accepted gap helpers", () => {
  it("keeps only well-formed entries and reports the rest as notices", () => {
    const good: AcceptedGap = {
      direction: "incoming",
      predicate: "realizes",
      other_spec_node_id: "api.operation",
      reason: "job",
      decided_by: "agent",
      decided_at: "2026-11-12T00:00:00.000Z",
      changeset: "cs-1",
    };
    const stored = [good, { direction: "sideways" }, { ...good }, { ...good, predicate: "nonsense-predicate" }];
    expect(readAcceptedGaps(stored)).toHaveLength(3);
    const notices = acceptedGapNotices("application.applicationfunction", stored);
    expect(notices.some((n) => n.includes("accepted_gaps[1] is ignored"))).toBe(true);
    expect(notices.some((n) => n.includes("repeats"))).toBe(true);
    expect(notices.some((n) => n.includes("does not define"))).toBe(true);
    expect(acceptedGapNotices("application.applicationfunction", "not a list")).toEqual(["accepted_gaps is not a list; it is ignored."]);
  });

  it("refuses a triple the catalog marks required", () => {
    const entry = catalogEntryForGap("application.applicationfunction", "incoming", "realizes", "api.operation")!;
    expect(entry).toBeDefined();
    const triple = { direction: "incoming" as const, predicate: "realizes", other_spec_node_id: "api.operation" };
    expect(gapCatalogProblem("application.applicationfunction", triple)).toBeNull();
    const was = entry.required;
    try {
      (entry as { required: boolean }).required = true;
      expect(gapCatalogProblem("application.applicationfunction", triple)?.kind).toBe("required");
    } finally {
      (entry as { required: boolean }).required = was;
    }
  });

  it("extraction leaves a relationship an accepted gap contradicts unstaged, and reports it", () => {
    const gap: AcceptedGap = {
      direction: "incoming",
      predicate: "realizes",
      other_spec_node_id: "api.operation",
      reason: "job",
      decided_by: "agent",
      decided_at: "2026-11-12T00:00:00.000Z",
      changeset: "cs-1",
    };
    const types: Record<string, string> = {
      [FUNCTION]: "application.applicationfunction",
      [OPERATION]: "api.operation",
      [SERVICE]: "application.applicationservice",
    };
    const { kept, contradicted } = splitByAcceptedGaps(
      [
        { source: OPERATION, predicate: "realizes", target: FUNCTION, edge: "HANDLES" },
        { source: FUNCTION, predicate: "realizes", target: SERVICE },
      ],
      (id) => types[id],
      (id) => (id === FUNCTION ? [gap] : undefined)
    );
    expect(kept).toEqual([{ source: FUNCTION, predicate: "realizes", target: SERVICE }]);
    expect(contradicted).toHaveLength(1);
    expect(contradicted[0].element).toBe(FUNCTION);
    expect(contradicted[0].evidence).toEqual({ source: OPERATION, predicate: "realizes", target: FUNCTION, edge: "HANDLES" });
  });

  it("codebase_verify reports a gap the route's handler contradicts", () => {
    const gap: AcceptedGap = {
      direction: "outgoing",
      predicate: "realizes",
      other_spec_node_id: "application.applicationfunction",
      reason: "thin proxy",
      decided_by: "agent",
      decided_at: "2026-11-12T00:00:00.000Z",
      changeset: "cs-1",
    };
    const found = routeHandlerContradictions(
      [{ id: "uuid-op", source_file: "src/orders.ts", source_symbol: "exportOrders" }],
      [
        { id: "uuid-op", path: OPERATION, layer: "api", type: "operation", locations: [], acceptedGaps: [gap] },
        {
          id: "uuid-fn",
          path: FUNCTION,
          layer: "application",
          type: "applicationfunction",
          locations: [{ file: "src/orders.ts", symbol: "exportOrders" }],
        },
      ]
    );
    expect(found).toHaveLength(1);
    expect(found[0].element).toBe(OPERATION);
    expect(found[0].evidence.handledBy).toBe(FUNCTION);
    expect(routeHandlerContradictions([{ id: "uuid-op", source_file: "src/other.ts", source_symbol: "x" }], [])).toEqual([]);
  });
});

describe("gap_accept and gap_reopen", () => {
  it("refuses without an active changeset", async () => {
    await add({ layer: "application", type: "applicationfunction", name: "export-orders" });
    expect(errorText(await accept())).toContain("none is active");
  });

  it("refuses a triple the catalog doesn't define, and one the element already has", async () => {
    await planExport();
    expect(errorText(await accept({ predicate: "serves", otherType: "motivation.goal" }))).toContain("does not define");
    const wired = await gapAcceptHandler({
      element: FUNCTION,
      direction: "outgoing",
      predicate: "realizes",
      otherType: "application.applicationservice",
      reason: "no",
      rootPath,
    });
    expect(errorText(wired)).toContain("not a gap");
  });

  it("stages the gap, shows it in model_show and spec_type, and lands it on commit", async () => {
    await planExport();
    const result = parse(await accept({ decidedBy: "alice" }));
    expect(result.status).toBe("staged");
    expect(result.gap).toMatchObject({ direction: "incoming", predicate: "realizes", otherType: "api.operation", decidedBy: "alice" });

    // Nothing reaches the base model before the changeset lands.
    expect(await readFile(await layerFileWith(SERVICE), "utf8")).not.toContain("accepted_gaps");

    const shown = parse(await modelShowHandler({ id: FUNCTION, rootPath }));
    expect(shown.acceptedGaps).toHaveLength(1);
    expect(shown.acceptedGaps[0].reason).toBe("A nightly job: no API exposes it");

    const spec = parse(await specTypeHandler({ layer: "application", element: FUNCTION, rootPath }));
    expect(spec.specNodeId).toBe("application.applicationfunction");
    const marked = spec.incoming.find((r: any) => r.source === "api.operation" && r.predicate === "realizes");
    expect(marked.accepted.reason).toBe("A nightly job: no API exposes it");
    expect(spec.element.acceptedGaps).toHaveLength(1);

    // Accepting it again with the same reason is a no-op.
    expect(parse(await accept({ decidedBy: "alice" })).status).toBe("already-accepted");

    await commit("export-orders");
    const model = await Model.load(rootPath, { lazyLoad: false });
    const element = (await model.getLayer("application"))!.getElement(FUNCTION)!;
    expect(element.acceptedGaps()).toHaveLength(1);
    expect(element.acceptedGaps()[0].changeset).toBe(result.changeset.id);
    expect(await readFile(await layerFileWith(FUNCTION), "utf8")).toContain("accepted_gaps");

    // Reopen it in another changeset; it leaves the element when that one lands.
    await changesetCreateHandler({ name: "reopen", rootPath });
    const reopened = parse(await gapReopenHandler({ element: FUNCTION, ...NO_OPERATION, rootPath }));
    expect(reopened.status).toBe("staged");
    expect(reopened.remaining).toBe(0);
    expect(errorText(await gapReopenHandler({ element: FUNCTION, ...NO_OPERATION, rootPath }))).toContain("no accepted gap");
    await commit("reopen");
    expect(await readFile(await layerFileWith(FUNCTION), "utf8")).not.toContain("accepted_gaps");
  }, 180_000);

  it("keeps a malformed hand-edited entry and reports it for information only", async () => {
    await planExport();
    await accept();
    await commit("export-orders");
    const file = await layerFileWith(FUNCTION);
    const data = yaml.parse(await readFile(file, "utf8"));
    data[FUNCTION].accepted_gaps.unshift({ direction: "sideways" });
    await writeFile(file, yaml.stringify(data));
    clearModelCache();

    const validation = parse(await modelValidateHandler({ rootPath, strict: false }));
    expect(validation.acceptedGaps.informational).toBe(true);
    expect(validation.acceptedGaps.total).toBe(1);
    expect(validation.acceptedGaps.notices.some((n: any) => n.message.includes("is ignored"))).toBe(true);
    const issues = [...(validation.errors ?? []), ...(validation.warnings ?? [])].map((i: any) => JSON.stringify(i));
    expect(issues.some((i) => i.includes("accepted_gaps"))).toBe(false);

    // A save keeps the entry as it was.
    const model = await Model.load(rootPath, { lazyLoad: false });
    const layer = (await model.getLayer("application"))!;
    const element = layer.getElement(FUNCTION)!;
    expect(element.accepted_gaps).toHaveLength(2);
    layer.updateElement(new Element({ ...element.toJSON(), description: "edited" }));
    await model.saveLayer("application");
    expect(await readFile(file, "utf8")).toContain("direction: sideways");
  }, 120_000);
});

describe("changeset_brief", () => {
  it("lists a matching unwired connection as accepted, and the gap in the delta", async () => {
    await planExport();
    const before = parse(await changesetBriefHandler({ unwired: "full", rootPath }));
    const unwiredOf = (brief: any) => brief.unwired.elements.find((e: any) => e.element === FUNCTION);
    const isNoOperation = (e: any) => e.direction === "in" && e.predicate === "realizes" && e.otherType === "api.operation";
    expect(unwiredOf(before).byLayer.flatMap((l: any) => l.entries).some(isNoOperation)).toBe(true);

    await accept();
    const after = parse(await changesetBriefHandler({ unwired: "full", since: before.revisionToken, detail: "full", rootPath }));
    expect(unwiredOf(after).byLayer.flatMap((l: any) => l.entries).some(isNoOperation)).toBe(false);
    expect(unwiredOf(after).accepted).toEqual([
      { direction: "in", predicate: "realizes", otherType: "api.operation", reason: "A nightly job: no API exposes it" },
    ]);
    expect(unwiredOf(after).total).toBe(unwiredOf(before).total - 1);
    expect(after.acceptedGaps).toHaveLength(1);
    expect(after.acceptedGaps[0]).toMatchObject({ element: FUNCTION, stagedHere: true, otherType: "api.operation" });
    expect(after.acceptedGaps[0].contradictedBy).toBeUndefined();

    // The delta: accepted since, and not counted as wired.
    expect(after.delta.acceptedGaps.accepted).toEqual([
      { element: FUNCTION, direction: "in", predicate: "realizes", otherType: "api.operation", reason: "A nightly job: no API exposes it" },
    ]);
    expect(after.delta.unwired.wired.some(isNoOperation)).toBe(false);

    // The compact brief lists it in one line, and its delta too.
    const compact = parse(await changesetBriefHandler({ since: before.revisionToken, rootPath }));
    expect(compact.acceptedGaps).toEqual([
      `${FUNCTION}: accepted: api.operation --realizes--> it: A nightly job: no API exposes it (staged here)`,
    ]);
    expect(compact.delta.acceptedGaps.accepted).toHaveLength(1);
    expect(parse(await changesetBriefHandler({ sections: ["acceptedGaps"], rootPath })).acceptedGaps).toHaveLength(1);

    // Reopened: back in the delta as reopened.
    const mid = parse(await changesetBriefHandler({ rootPath }));
    await gapReopenHandler({ element: FUNCTION, ...NO_OPERATION, rootPath });
    const reopened = parse(await changesetBriefHandler({ since: mid.revisionToken, sections: ["delta"], rootPath }));
    expect(reopened.delta.acceptedGaps.reopened).toHaveLength(1);
  }, 120_000);

  it("answers a peer-pattern gap with an accepted gap, and marks one the plan wires anyway", async () => {
    // Two existing functions realize the service, each realized by an operation: the convention.
    for (const name of ["import-orders", "list-orders"]) {
      await add({ layer: "application", type: "applicationfunction", name });
      await add({
        layer: "api",
        type: "operation",
        name,
        attributes: { operationId: name, summary: name, tags: "orders" },
      });
      await relate(`application.applicationfunction.${name}`, "realizes", SERVICE);
      await relate(`api.operation.${name}`, "realizes", `application.applicationfunction.${name}`);
    }
    await planExport();
    const open = parse(await changesetBriefHandler({ sections: ["gaps"], rootPath }));
    const peer = (gaps: any[]) => gaps.filter((g) => g.kind === "peer-pattern" && g.element === FUNCTION);
    expect(peer(open.gaps)).toHaveLength(1);

    await accept();
    const answered = parse(await changesetBriefHandler({ sections: ["gaps", "acceptedGaps"], rootPath }));
    expect(peer(answered.gaps)).toHaveLength(0);
    expect(answered.acceptedGaps[0].answersPeerPattern).toContain("api.operation");

    // Wiring the triple anyway contradicts the gap.
    await add({ layer: "api", type: "operation", name: "export-orders", attributes: { operationId: "x", summary: "x", tags: "orders" } });
    await relate(OPERATION, "realizes", FUNCTION);
    const contradicted = parse(await changesetBriefHandler({ sections: ["acceptedGaps"], rootPath }));
    expect(contradicted.acceptedGaps[0].contradictedBy).toEqual({ source: OPERATION, predicate: "realizes", target: FUNCTION });
  }, 120_000);
});

describe("changeset_verify", () => {
  async function buildAsBuilt(withOperation: boolean): Promise<void> {
    await changesetCreateHandler({ name: "as-built", rootPath });
    await add({ layer: "application", type: "applicationfunction", name: "export-orders" });
    await relate(FUNCTION, "realizes", SERVICE);
    if (withOperation) {
      await add({ layer: "api", type: "operation", name: "export-orders", attributes: { operationId: "x", summary: "x", tags: "orders" } });
      await relate(OPERATION, "realizes", FUNCTION);
    }
  }

  it("reports an accepted gap in the plan that the build contradicts", async () => {
    await planExport();
    await accept();
    await buildAsBuilt(true);
    await changesetActivateHandler({ changesetId: "export-orders", rootPath });

    const report = parse(await changesetVerifyHandler({ planned: "export-orders", against: { changesetId: "as-built" }, rootPath }));
    expect(report.acceptedGaps.checked).toBe(1);
    expect(report.acceptedGaps.contradicted).toHaveLength(1);
    expect(report.acceptedGaps.contradicted[0]).toMatchObject({
      element: FUNCTION,
      builtElement: FUNCTION,
      evidence: { source: OPERATION, predicate: "realizes", target: FUNCTION },
    });
    expect(report.verdict).toBe("diverges");
    expect(report.verdictText).toContain("accepted gap");
  }, 120_000);

  it("finds nothing to report when the build leaves the gap open", async () => {
    await planExport();
    await accept();
    await buildAsBuilt(false);
    const report = parse(await changesetVerifyHandler({ planned: "export-orders", against: { changesetId: "as-built" }, rootPath }));
    expect(report.acceptedGaps).toEqual({ checked: 1, contradicted: [] });
    expect(report.verdict).not.toBe("diverges");
  }, 120_000);
});
