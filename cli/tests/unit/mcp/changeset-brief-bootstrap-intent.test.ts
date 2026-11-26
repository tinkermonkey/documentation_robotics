/**
 * Intent tracing for a bootstrap whose motivation, business and product layers are written in the
 * same changeset as the code elements (#1329: cabinet-sheets and toland-cad). An added requirement,
 * feature or capability that realizes, satisfies or supports a goal or outcome, added or not, is an
 * anchor, so the trace ends at the goal.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { changesetBriefHandler } from "../../../src/mcp/tools/changeset-analysis-tools.js";

const parse = (result: any): any => JSON.parse(result.content[0].text);

const GOAL = "motivation.goal.specs-are-trustworthy";
const REQUIREMENT = "motivation.requirement.report-spec-errors-up-front";
const COMPONENT = "application.applicationcomponent.validate-spec";
const ORPHAN = "application.applicationcomponent.format-output";

let rootPath: string;

async function add(args: Record<string, unknown>): Promise<void> {
  const result = await modelAddHandler({ ...(args as any), rootPath });
  if (result.isError) throw new Error((result.content[0] as any).text);
}

async function relate(source: string, predicate: string, target: string): Promise<void> {
  const result = await relationshipAddHandler({ source, predicate, target, rootPath });
  if (result.isError) throw new Error((result.content[0] as any).text);
}

const intent = async () =>
  parse(await changesetBriefHandler({ sections: ["intent"], traced: true, detail: "full", rootPath })).intent;

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-bootstrap-intent-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Bootstrap Model", version: "0.1.0" });
  // A bootstrap: the base model is empty and everything is added in one changeset.
  await changesetCreateHandler({ name: "bootstrap", rootPath });
  await add({ layer: "motivation", type: "goal", name: "specs-are-trustworthy", attributes: { priority: "high" } });
  await add({
    layer: "motivation",
    type: "requirement",
    name: "report-spec-errors-up-front",
    attributes: { requirementType: "functional", priority: "high" },
  });
  await add({ layer: "application", type: "applicationcomponent", name: "validate-spec", attributes: { type: "internal" } });
  await add({ layer: "application", type: "applicationcomponent", name: "format-output", attributes: { type: "internal" } });
  await relate(REQUIREMENT, "realizes", GOAL);
  await relate(COMPONENT, "satisfies", REQUIREMENT);
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("intent tracing in a bootstrap (#1329)", () => {
  it("traces code through an added requirement that realizes an added goal", async () => {
    const result = await intent();
    expect(result.traced).toEqual([
      expect.objectContaining({
        element: COMPONENT,
        tracesTo: REQUIREMENT,
        path: [COMPONENT, REQUIREMENT],
        anchoredBy: { id: GOAL, path: [REQUIREMENT, GOAL] },
      }),
    ]);
    expect(result.unanchored).toBeUndefined();
    // A code element wired to nothing still does not trace.
    expect(result.untraced).toContain(ORPHAN);
    expect(result.untraced).not.toContain(COMPONENT);
  });

  it("anchors an added requirement that satisfies an added requirement that realizes the goal", async () => {
    await add({
      layer: "motivation",
      type: "requirement",
      name: "exit-codes-are-stable",
      attributes: { requirementType: "functional", priority: "low" },
    });
    await relate("motivation.requirement.exit-codes-are-stable", "realizes", GOAL);
    await relate(ORPHAN, "satisfies", "motivation.requirement.exit-codes-are-stable");
    const result = await intent();
    expect(result.untraced).not.toContain(ORPHAN);
    expect(result.traced.map((t: any) => t.element)).toEqual(expect.arrayContaining([COMPONENT, ORPHAN]));
  });

  it("leaves a requirement that reaches no goal unanchored", async () => {
    await add({
      layer: "motivation",
      type: "requirement",
      name: "float-free",
      attributes: { requirementType: "functional", priority: "low" },
    });
    await relate(ORPHAN, "satisfies", "motivation.requirement.float-free");
    const result = await intent();
    expect(result.untraced).toContain(ORPHAN);
    expect(result.unanchored).toEqual([
      expect.objectContaining({ element: ORPHAN, tracesTo: "motivation.requirement.float-free" }),
    ]);
  });

  it("shows a realizes chain as the path, not a route through a neighbour it merely uses (#1392)", async () => {
    const worker = "application.applicationcomponent.worker";
    const service = "application.applicationservice.spec-checking";
    await add({ layer: "application", type: "applicationcomponent", name: "worker", attributes: { type: "internal" } });
    await add({ layer: "application", type: "applicationservice", name: "spec-checking", attributes: { serviceType: "synchronous" } });
    // The shorter-to-write route comes first: worker uses validate-spec, which satisfies the requirement.
    await relate(worker, "uses", COMPONENT);
    await relate(worker, "realizes", service);
    await relate(service, "realizes", GOAL);
    const result = await intent();
    const trace = result.traced.find((t: any) => t.element === worker);
    expect(trace.path).toEqual([worker, service, GOAL]);
  });
});
