/**
 * model_add places a product workflow step after or before another (#1396): one call adds the
 * step, rewires the flows-to hand-offs around it, adds it to the workflow, and renumbers the later
 * steps' sequence where it collides.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler, modelAddTool } from "../../../src/mcp/tools/model-add.js";
import { modelShowHandler } from "../../../src/mcp/tools/model-show.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { renumberings } from "../../../src/mcp/tools/workflow-step-insert.js";
import * as staging from "../../../src/core/relationship-staging.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";

let rootPath: string;

const text = (result: any): string => result.content[0].text;
const parse = (result: any): any => {
  if (result.isError) throw new Error(text(result));
  return JSON.parse(text(result));
};
const S = (name: string) => `product.workflowstep.${name}`;
const W = "product.userworkflow.checkout";
const step = (name: string, sequence?: number) => ({
  layer: "product",
  type: "workflowstep",
  name,
  attributes: { action: `does ${name}`, ...(sequence !== undefined ? { sequence } : {}) },
});

/** A checkout workflow: cart (1) flows to pay (2) flows to receipt (3), then a gap to survey (10). */
async function seed(options: { workflow?: boolean } = {}): Promise<void> {
  const withWorkflow = options.workflow !== false;
  parse(
    await modelAddHandler({
      elements: [
        ...(withWorkflow ? [{ layer: "product", type: "userworkflow", name: "checkout", attributes: { complexity: "simple" } }] : []),
        step("cart", 1),
        step("pay", 2),
        step("receipt", 3),
        step("survey", 10),
      ],
      relationships: [
        { source: S("cart"), predicate: "flows-to", target: S("pay") },
        { source: S("pay"), predicate: "flows-to", target: S("receipt") },
        { source: S("receipt"), predicate: "flows-to", target: S("survey") },
        ...(withWorkflow
          ? ["cart", "pay", "receipt", "survey"].map((name) => ({ source: W, predicate: "composes", target: S(name) }))
          : []),
      ],
      rootPath,
    })
  );
  clearModelCache();
}

async function sequence(id: string): Promise<number> {
  clearModelCache();
  return parse(await modelShowHandler({ id, rootPath })).element.attributes.sequence;
}

async function flowsFrom(id: string): Promise<string[]> {
  clearModelCache();
  return parse(await modelShowHandler({ id, rootPath }))
    .relationships.outgoing.filter((r: any) => r.predicate === "flows-to" && r.status !== "deleted")
    .map((r: any) => r.target)
    .sort();
}

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-step-insert-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Step Insert", version: "0.1.0" });
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("renumberings", () => {
  it("shifts the steps from the new sequence on until a gap", () => {
    const steps = [
      { id: "a", sequence: 1 },
      { id: "b", sequence: 2 },
      { id: "c", sequence: 3 },
      { id: "d", sequence: 10 },
    ];
    expect(renumberings(steps, 2)).toEqual([
      { id: "b", from: 2, to: 3 },
      { id: "c", from: 3, to: 4 },
    ]);
    expect(renumberings(steps, 4)).toEqual([]);
    expect(renumberings(steps, 10)).toEqual([{ id: "d", from: 10, to: 11 }]);
  });
});

describe("model_add after / before for a workflow step (#1396)", () => {
  for (const staged of [true, false]) {
    it(`inserts after a step: sequence, hand-offs, workflow and later steps (${staged ? "in a changeset" : "in the model"})`, async () => {
      await seed();
      if (staged) await changesetCreateHandler({ name: "plan", rootPath });
      const result = parse(await modelAddHandler({ ...step("check stock"), after: S("cart"), rootPath } as any));
      expect(result.status).toBe(staged ? "staged" : "added");
      expect(result.id).toBe(S("check-stock"));
      expect(result.inserted).toEqual({
        after: S("cart"),
        sequence: 2,
        workflow: W,
        renumbered: [
          { id: S("pay"), from: 2, to: 3 },
          { id: S("receipt"), from: 3, to: 4 },
        ],
        flowsTo: {
          removed: [`${S("cart")} -> ${S("pay")}`],
          added: [`${S("cart")} -> ${S("check-stock")}`, `${S("check-stock")} -> ${S("pay")}`],
        },
      });
      expect(await sequence(S("check-stock"))).toBe(2);
      expect(await sequence(S("pay"))).toBe(3);
      expect(await sequence(S("receipt"))).toBe(4);
      expect(await sequence(S("survey"))).toBe(10);
      expect(await flowsFrom(S("cart"))).toEqual([S("check-stock")]);
      expect(await flowsFrom(S("check-stock"))).toEqual([S("pay")]);
      clearModelCache();
      const composed = parse(await modelShowHandler({ id: W, rootPath })).relationships.outgoing.map((r: any) => r.target);
      expect(composed).toContain(S("check-stock"));
    });
  }

  it("inserts before a step, and between the two ends of a hand-off", async () => {
    await seed();
    await changesetCreateHandler({ name: "plan", rootPath });
    const first = parse(await modelAddHandler({ ...step("browse"), before: S("cart"), rootPath } as any));
    expect(first.inserted.sequence).toBe(1);
    expect(first.inserted.flowsTo).toEqual({ removed: [], added: [`${S("browse")} -> ${S("cart")}`] });
    expect(await sequence(S("cart"))).toBe(2);

    const between = parse(await modelAddHandler({ ...step("confirm"), after: S("pay"), before: S("receipt"), rootPath } as any));
    expect(between.inserted.flowsTo.removed).toEqual([`${S("pay")} -> ${S("receipt")}`]);
    expect(await flowsFrom(S("pay"))).toEqual([S("confirm")]);
    expect(await flowsFrom(S("confirm"))).toEqual([S("receipt")]);
  });

  it("in a changeset, stages the whole insert in one write", async () => {
    await seed();
    await changesetCreateHandler({ name: "plan", rootPath });
    const many = spyOn(StagingAreaManager.prototype, "stageMany");
    const single = spyOn(StagingAreaManager.prototype, "stage");
    try {
      parse(await modelAddHandler({ ...step("check stock"), after: S("cart"), rootPath } as any));
      expect(many).toHaveBeenCalledTimes(1);
      expect(single).not.toHaveBeenCalled();
    } finally {
      many.mockRestore();
      single.mockRestore();
    }
  });

  for (const staged of [true, false]) {
    it(`writes nothing when a link it needs is refused (${staged ? "in a changeset" : "in the model"})`, async () => {
      await seed();
      if (staged) await changesetCreateHandler({ name: "plan", rootPath });
      const before = staged ? (await new StagingAreaManager(rootPath).load("plan"))!.changes.length : 0;
      const plan = staging.planRelationshipBatch;
      const refuse = spyOn(staging, "planRelationshipBatch").mockImplementation(async (...args) => {
        const result = await plan(...args);
        const [first, ...rest] = result.results;
        return { ...result, results: [{ ...first, status: "invalid" as const, reason: "The catalog has no such link" }, ...rest] };
      });
      try {
        const result = await modelAddHandler({ ...step("check stock"), after: S("cart"), rootPath } as any);
        expect(result.isError).toBe(true);
        expect(text(result)).toContain("was not added");
        expect(text(result)).toContain("The catalog has no such link");
      } finally {
        refuse.mockRestore();
      }
      // Nothing changed: no step, no renumbering, the hand-off intact, nothing staged.
      clearModelCache();
      const missing = await modelShowHandler({ id: S("check-stock"), rootPath });
      expect(missing.isError).toBe(true);
      expect(await sequence(S("pay"))).toBe(2);
      expect(await flowsFrom(S("cart"))).toEqual([S("pay")]);
      if (staged) expect((await new StagingAreaManager(rootPath).load("plan"))!.changes.length).toBe(before);
    });
  }

  it("renumbers the steps downstream along flows-to when no workflow composes them", async () => {
    await seed({ workflow: false });
    const result = parse(await modelAddHandler({ ...step("check stock"), after: S("cart"), rootPath } as any));
    expect(result.inserted.workflow).toBeUndefined();
    expect(result.inserted.renumbered.map((r: any) => r.id)).toEqual([S("pay"), S("receipt")]);
  });

  it("refuses a sequence sent with it, an anchor that is not a step, and ends that are not one hand-off", async () => {
    await seed();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...step("x", 5), after: S("cart") }, "Send no sequence with after or before"],
      [{ ...step("x"), after: W }, "is a product.userworkflow, not a product.workflowstep"],
      [{ ...step("x"), after: S("nope") }, "is not in the model or the active changeset"],
      [{ ...step("x"), after: S("cart"), before: S("receipt") }, "does not flow to"],
      [{ layer: "product", type: "feature", name: "x", after: S("cart") }, "after and before place a product workflow step"],
    ];
    for (const [args, message] of cases) {
      const result = await modelAddHandler({ ...args, rootPath } as any);
      expect(result.isError).toBe(true);
      expect(text(result)).toContain(message);
    }
    // Nothing was written.
    expect(await sequence(S("pay"))).toBe(2);
    expect(await flowsFrom(S("cart"))).toEqual([S("pay")]);
    expect(modelAddTool.description).toContain("after or before");
  });
});
