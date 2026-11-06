/**
 * Expected connections in the change-modeling tools: changeset_brief's `missing-expected` gaps and
 * spec_type's `expected` list. See core/connection-expectations.ts.
 *
 * The first tests use the bundled seed expectation `application.applicationfunction.performed-by`
 * (a component is assigned to the functions it performs). If that seed is pruned, point them at
 * another; the tolerance tests inject their own expectation set and depend on no seed.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { buildBrief } from "../../../src/core/changeset-analysis.js";
import { buildExpectationSet } from "../../../src/core/connection-expectations.js";
import { clearModelCache, loadModel } from "../../../src/mcp/tools/shared.js";
import { loadChangesetGraph } from "../../../src/mcp/tools/changeset-shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelDeleteHandler } from "../../../src/mcp/tools/model-delete.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { relationshipAddHandler, relationshipDeleteHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { changesetBriefHandler } from "../../../src/mcp/tools/changeset-analysis-tools.js";
import { specTypeHandler } from "../../../src/mcp/tools/spec-type.js";

function parse(result: any): any {
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}

const EXPECTATION = "application.applicationfunction.performed-by";
const COMPONENT = "application.applicationcomponent.order-api";
const FUNCTION = "application.applicationfunction.export-orders";

let rootPath: string;

async function add(args: Record<string, unknown>): Promise<void> {
  parse(await modelAddHandler({ ...(args as any), rootPath }));
}

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-mcp-expected-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Expected Connections Test Model", version: "0.1.0" });
  await add({ layer: "application", type: "applicationcomponent", name: "order-api", attributes: { type: "internal" } });
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("changeset_brief missing-expected gaps", () => {
  it("reports an expected connection an added element lacks, and stops once it is staged", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    await add({ layer: "application", type: "applicationfunction", name: "export-orders" });

    let brief = parse(await changesetBriefHandler({ rootPath }));
    const gap = brief.gaps.find((g: any) => g.kind === "missing-expected" && g.expectation === EXPECTATION);
    expect(gap).toBeDefined();
    expect(gap.element).toBe(FUNCTION);
    expect(gap.detail).toContain("application.applicationcomponent --assigned-to--> it");
    expect(gap.rationale).toBeTruthy();
    expect(brief.expectationWarnings).toBeUndefined();

    parse(await relationshipAddHandler({ source: COMPONENT, predicate: "assigned-to", target: FUNCTION, rootPath }));
    brief = parse(await changesetBriefHandler({ rootPath }));
    expect(brief.gaps.filter((g: any) => g.expectation === EXPECTATION)).toEqual([]);
  });

  it("reports an existing element whose last expected connection the change removes", async () => {
    await add({ layer: "application", type: "applicationfunction", name: "export-orders" });
    parse(await relationshipAddHandler({ source: COMPONENT, predicate: "assigned-to", target: FUNCTION, rootPath }));

    await changesetCreateHandler({ name: "drop-assignment", rootPath });
    parse(await relationshipDeleteHandler({ source: COMPONENT, predicate: "assigned-to", target: FUNCTION, rootPath }));

    const brief = parse(await changesetBriefHandler({ rootPath }));
    const gap = brief.gaps.find((g: any) => g.kind === "missing-expected" && g.element === FUNCTION);
    expect(gap).toBeDefined();
    expect(gap.expectation).toBe(EXPECTATION);
    expect(gap.detail).toContain("removes its last expected connection");
    // The component keeps no expectation that this removal breaks.
    expect(brief.gaps.filter((g: any) => g.element === COMPONENT)).toEqual([]);
  });

  it("reports an existing element whose only expected neighbour the change deletes", async () => {
    await add({ layer: "application", type: "applicationfunction", name: "export-orders" });
    parse(await relationshipAddHandler({ source: COMPONENT, predicate: "assigned-to", target: FUNCTION, rootPath }));

    await changesetCreateHandler({ name: "drop-component", rootPath });
    parse(await modelDeleteHandler({ id: COMPONENT, force: true, rootPath }));

    const brief = parse(await changesetBriefHandler({ rootPath }));
    const gap = brief.gaps.find((g: any) => g.kind === "missing-expected" && g.element === FUNCTION);
    expect(gap).toBeDefined();
    expect(gap.expectation).toBe(EXPECTATION);
    expect(gap.detail).toContain("removes its last expected connection");
    // The deleted component itself is not reported.
    expect(brief.gaps.filter((g: any) => g.kind === "missing-expected" && g.element === COMPONENT)).toEqual([]);
  });

  it("does not report existing elements that already lacked the connection", async () => {
    await add({ layer: "application", type: "applicationfunction", name: "export-orders" });
    await add({ layer: "application", type: "applicationservice", name: "orders", attributes: { serviceType: "synchronous" } });
    parse(
      await relationshipAddHandler({
        source: FUNCTION,
        predicate: "realizes",
        target: "application.applicationservice.orders",
        rootPath,
      })
    );

    await changesetCreateHandler({ name: "unrealize", rootPath });
    parse(
      await relationshipDeleteHandler({
        source: FUNCTION,
        predicate: "realizes",
        target: "application.applicationservice.orders",
        rootPath,
      })
    );
    const brief = parse(await changesetBriefHandler({ rootPath }));
    // The function never had a component assigned; this change does not make that worse.
    expect(brief.gaps.filter((g: any) => g.element === FUNCTION && g.expectation === EXPECTATION)).toEqual([]);
  });
});

describe("expectations that no longer fit the catalog", () => {
  it("are ignored with a warning, while the ones that still fit keep working", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    await add({ layer: "application", type: "applicationfunction", name: "export-orders" });

    const set = buildExpectationSet({
      expectations: [
        {
          id: "application.applicationfunction.retired",
          source: "application.applicationfunction",
          rationale: "Uses a predicate the catalog retired.",
          anyOf: [{ direction: "incoming", predicate: "no-such-predicate" }],
        },
        {
          id: "application.applicationfunction.half-retired",
          source: "application.applicationfunction",
          rationale: "One alternative retired, one still allowed.",
          anyOf: [
            { direction: "outgoing", predicate: "no-such-predicate" },
            {
              direction: "incoming",
              predicate: "assigned-to",
              other: { types: ["application.applicationcomponent"] },
            },
          ],
        },
        {
          id: "nosuchlayer.nosuchtype.gone",
          source: "nosuchlayer.nosuchtype",
          rationale: "Source type removed from the spec.",
          anyOf: [{ direction: "outgoing", predicate: "realizes" }],
        },
      ],
    });
    expect(set.expectations.map((e) => e.id)).toEqual(["application.applicationfunction.half-retired"]);
    expect(set.warnings.length).toBeGreaterThanOrEqual(3);

    const model = await loadModel(rootPath);
    const { graph } = await loadChangesetGraph(model, undefined);
    const brief = buildBrief({ graph, expectations: set });
    const gaps = brief.gaps.filter((g) => g.kind === "missing-expected");
    expect(gaps.map((g) => g.expectation)).toEqual(["application.applicationfunction.half-retired"]);
    expect(gaps[0].detail).not.toContain("no-such-predicate");
    expect(brief.expectationWarnings).toEqual(set.warnings);
  });

  it("an unreadable expectations file yields no expectations and a warning, not an error", async () => {
    const { loadExpectations } = await import("../../../src/core/connection-expectations.js");
    const set = loadExpectations(join(rootPath, "does-not-exist.json"));
    expect(set.expectations).toEqual([]);
    expect(set.warnings[0]).toContain("could not read connection expectations");
  });
});

describe("spec_type expected connections", () => {
  it("lists the connections the spec expects of a type", async () => {
    const result = parse(await specTypeHandler({ layer: "application", type: "applicationfunction" }));
    const expected = result.expected.find((e: any) => e.id === EXPECTATION);
    expect(expected).toBeDefined();
    expect(expected.rationale).toBeTruthy();
    expect(expected.anyOf).toContainEqual({
      direction: "incoming",
      predicate: "assigned-to",
      otherTypes: ["application.applicationcomponent"],
    });
  });

  it("returns an empty list for a type with no expectations", async () => {
    const result = parse(await specTypeHandler({ layer: "api", type: "contact" }));
    expect(result.expected).toEqual([]);
  });
});
