/**
 * changeset_verify against an as-built changeset that came from extraction (FINDINGS.md D1).
 *
 * Reproduces the heimdall-build walkthrough: a TypeScript library change planned with a requirement,
 * re-exports from the package entry and Vitest cases, built, and extracted. Extraction can't see the
 * requirement, the re-exports or the TS test cases, so they are unverifiable, not missing, and the
 * verdict is decided by what it can see.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import { changesetCreateHandler, changesetDeactivateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { changesetVerifyHandler, changesetVerifyTool } from "../../../src/mcp/tools/changeset-verify.js";
import { formatVerifyReport } from "../../../src/commands/changeset-verify.js";
import { loadExtractionCoverage } from "../../../src/core/extraction-observability.js";

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

async function ok(result: any): Promise<any> {
  if (result.isError) throw new Error(result.content[0].text);
  return parse(result);
}

const REQUIREMENT = "motivation.requirement.expose-node-degrees";
const FUNCTION = "application.applicationfunction.compute-node-degrees";
const COMPONENT = "application.applicationcomponent.graph-degree";
const DATA = "application.dataobject.node-degree";
const OPERATION = "api.operation.compute-node-degrees";
const TEST_CASE = "testing.testcasesketch.compute-node-degrees-counts-degrees";

let rootPath: string;

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-mcp-verify-extract-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Heimdall Like", version: "0.1.0" });
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

async function add(args: Record<string, unknown>): Promise<void> {
  await ok(await modelAddHandler({ ...(args as any), rootPath }));
}

async function link(source: string, predicate: string, target: string): Promise<void> {
  await ok(await relationshipAddHandler({ source, predicate, target, rootPath }));
}

/** The plan, as the agent staged it in the walkthrough. */
async function stagePlan(): Promise<void> {
  await ok(await changesetCreateHandler({ name: "add-graph-degree-utils", rootPath }));
  await add({
    layer: "motivation",
    type: "requirement",
    name: "expose-node-degrees",
    description: "Consumers can compute node degrees.",
    attributes: { requirementType: "functional", priority: "low" },
  });
  await add({
    layer: "application",
    type: "applicationfunction",
    name: "compute-node-degrees",
    description: "Returns a map of node id to in, out and total degree.",
    sourceFile: "src/utils/graphDegree.ts",
    sourceSymbol: "computeNodeDegrees",
    sourceProvenance: "manual",
  });
  await add({
    layer: "application",
    type: "applicationcomponent",
    name: "graph-degree",
    description: "Module src/utils/graphDegree.ts: standalone graph degree helpers.",
    attributes: { type: "internal" },
    sourceFile: "src/utils/graphDegree.ts",
    sourceSymbol: "src.utils.graphDegree",
    sourceProvenance: "manual",
  });
  await add({
    layer: "application",
    type: "dataobject",
    name: "node-degree",
    description: "Per-node result of computeNodeDegrees. Exported type.",
    sourceFile: "src/utils/graphDegree.ts",
    sourceSymbol: "NodeDegree",
    sourceProvenance: "manual",
  });
  // The package entry re-exports the function: not an HTTP route, so extraction has no card for it.
  await add({
    layer: "api",
    type: "operation",
    name: "compute-node-degrees",
    attributes: { operationId: "computeNodeDegrees", summary: "Compute node degrees", tags: "graph" },
    sourceFile: "src/index.ts",
    sourceSymbol: "computeNodeDegrees",
    sourceProvenance: "manual",
  });
  // A Vitest case: an anonymous it() callback, which never becomes a card.
  await add({
    layer: "testing",
    type: "testcasesketch",
    name: "compute-node-degrees-counts-degrees",
    attributes: { status: "automated", implementationFormat: "automated" },
    sourceFile: "src/utils/graphDegree.test.ts",
    sourceSymbol: "computeNodeDegrees",
    sourceProvenance: "manual",
  });
  await link(FUNCTION, "satisfies", REQUIREMENT);
  await link(COMPONENT, "assigned-to", FUNCTION);
  await link(FUNCTION, "accesses", DATA);
  await link(OPERATION, "realizes", FUNCTION);
  await link(TEST_CASE, "tests", OPERATION);
  await ok(await changesetDeactivateHandler({ rootPath }));
}

type RecordEntry = {
  id?: string;
  file: string | null;
  symbol: string;
  label?: string;
  name?: string;
  candidates?: string[];
  hint?: string;
  attributes?: Record<string, unknown>;
};

/**
 * codebase_extract's record of a changeset (.dr/analyzers/extract/<id>.json): what it staged, and the
 * cards of its last run. Verify reads it to tell extracted elements from hand-added ones.
 */
async function writeExtractionRecord(changesetId: string, record: { staged?: RecordEntry[]; cards?: RecordEntry[]; [extra: string]: unknown }): Promise<void> {
  const dir = join(rootPath, ".dr", "analyzers", "extract");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${changesetId.replace(/[^\w.-]/g, "_")}.json`),
    JSON.stringify({ changesetId, changesetName: "as-built", gitHead: "9f6f50f", since: "main", layers: null, createdAt: "", ...record, cards: record.cards ?? [], staged: record.staged ?? [] })
  );
}

const GRAPH_DEGREE = "src/utils/graphDegree.ts";
/** What extraction staged in the walkthrough: the function, the module and the type. */
const STAGED: RecordEntry[] = [
  { id: FUNCTION, file: GRAPH_DEGREE, symbol: "computeNodeDegrees", label: "Function" },
  { id: COMPONENT, file: GRAPH_DEGREE, symbol: "src.utils.graphDegree", label: "Module" },
  { id: DATA, file: GRAPH_DEGREE, symbol: "NodeDegree", label: "Interface" },
];

/** The as-built changeset, the way codebase_extract writes it: extracted elements and edges only. */
async function stageExtraction(name = "add-graph-degree-utils-as-built", staged: RecordEntry[] = STAGED): Promise<string> {
  const created = await ok(
    await changesetCreateHandler({
      name,
      description: "As-built extraction of the code at 9f6f50f, files changed since main. Staged by codebase_extract.",
      rootPath,
    })
  );
  await writeExtractionRecord(created.id, { staged });
  const extracted = { sourceFile: "src/utils/graphDegree.ts", sourceProvenance: "extracted" };
  await add({ layer: "application", type: "applicationfunction", name: "compute-node-degrees", sourceSymbol: "computeNodeDegrees", ...extracted });
  await add({
    layer: "application",
    type: "applicationcomponent",
    name: "graph-degree",
    description: "Module src/utils/graphDegree.ts.",
    attributes: { type: "internal" },
    sourceSymbol: "src.utils.graphDegree",
    ...extracted,
  });
  // Extraction's placeholder text where the code has no doc comment.
  await add({
    layer: "application",
    type: "dataobject",
    name: "node-degree",
    description: "Interface NodeDegree in src/utils/graphDegree.ts.",
    sourceSymbol: "NodeDegree",
    ...extracted,
  });
  await link(FUNCTION, "accesses", DATA);
  return created.id;
}

describe("changeset_verify against an extracted as-built changeset (D1)", () => {
  it("reports what extraction can't see as unverifiable, and matches on the rest", async () => {
    await stagePlan();
    await stageExtraction();

    const report = await ok(
      await changesetVerifyHandler({ planned: "add-graph-degree-utils", against: { changesetId: "add-graph-degree-utils-as-built" }, rootPath })
    );

    expect(report.verdict).toBe("match");
    expect(report.verdictText).toContain("can't be seen by extraction");
    expect(report.extraction.applied).toBe(true);
    expect(report.extraction.analyzer).toBe("cbm");

    expect(report.elements.matched.map((m: any) => m.planned).sort()).toEqual([COMPONENT, DATA, FUNCTION].sort());
    expect(report.elements.missing).toEqual([]);
    expect(report.elements.divergent).toEqual([]);
    const unverifiable = Object.fromEntries(report.elements.unverifiable.map((u: any) => [u.planned, u.reason]));
    expect(Object.keys(unverifiable).sort()).toEqual([OPERATION, REQUIREMENT, TEST_CASE].sort());
    expect(unverifiable[REQUIREMENT]).toContain("intent");
    expect(unverifiable[OPERATION]).toContain("HTTP routes");
    expect(unverifiable[TEST_CASE]).toContain("TypeScript test cases");

    expect(report.relationships.matched.map((m: any) => m.planned.predicate)).toEqual(["accesses"]);
    expect(report.relationships.missing).toEqual([]);
    expect(report.relationships.unverifiable.map((u: any) => u.planned.predicate).sort()).toEqual(
      ["assigned-to", "realizes", "satisfies", "tests"].sort()
    );
    const assigned = report.relationships.unverifiable.find((u: any) => u.planned.predicate === "assigned-to");
    expect(assigned.reason).toContain("DEFINES_METHOD");

    expect(report.summary.elements).toMatchObject({ planned: 6, matched: 3, missing: 0, unverifiable: 3 });
    expect(report.summary.relationships).toMatchObject({ planned: 5, matched: 1, missing: 0, unverifiable: 4 });

    // Description differences (prose against the placeholder) are notes, not divergence.
    const data = report.elements.matched.find((m: any) => m.planned === DATA);
    expect(data.notes).toEqual([
      { field: "description", planned: "Per-node result of computeNodeDegrees. Exported type.", built: "Interface NodeDegree in src/utils/graphDegree.ts." },
    ]);

    // How much of the as-built side came from extraction.
    expect(report.extraction.asBuilt).toEqual({
      elements: { total: 3, byProvenance: { extracted: 3 }, fromExtraction: 3, agentAdded: 0 },
      relationships: { total: 1, betweenExtracted: 1, other: 0 },
      record: "found",
    });
    expect(report.warning).toBeUndefined();

    const text = formatVerifyReport(report);
    expect(text).toContain("Unverifiable elements");
    expect(text).toContain("As-built: 3 elements (3 extracted declared; 3 from extraction, 0 added by the agent)");
  });

  it("still reports what extraction can see and the build lacks as missing", async () => {
    await stagePlan();
    const partial = await ok(
      await changesetCreateHandler({
        name: "partial-build",
        description: "As-built extraction of the code at 9f6f50f. Staged by codebase_extract.",
        rootPath,
      })
    );
    await writeExtractionRecord(partial.id, { staged: [STAGED[1]] });
    await add({
      layer: "application",
      type: "applicationcomponent",
      name: "graph-degree",
      attributes: { type: "internal" },
      sourceFile: "src/utils/graphDegree.ts",
      sourceSymbol: "src.utils.graphDegree",
      sourceProvenance: "extracted",
    });

    const report = await ok(await changesetVerifyHandler({ planned: "add-graph-degree-utils", against: { changesetId: "partial-build" }, rootPath }));
    expect(report.verdict).toBe("incomplete");
    expect(report.elements.missing.map((m: any) => m.planned).sort()).toEqual([DATA, FUNCTION].sort());
    expect(report.relationships.missing.map((m: any) => m.planned.predicate)).toEqual(["accesses"]);
    expect(report.elements.unverifiable).toHaveLength(3);
  });

  it("flags plan elements copied by hand into an extracted as-built changeset", async () => {
    await stagePlan();
    await stageExtraction("as-built-with-copies");
    // The circular comparison from the walkthrough: the plan's operation added by hand.
    await add({
      layer: "api",
      type: "operation",
      name: "compute-node-degrees",
      attributes: { operationId: "computeNodeDegrees", summary: "Compute node degrees", tags: "graph" },
    });

    const report = await ok(await changesetVerifyHandler({ planned: "add-graph-degree-utils", against: { changesetId: "as-built-with-copies" }, rootPath }));
    expect(report.extraction.asBuilt.elements.byProvenance).toEqual({ extracted: 3, none: 1 });
    expect(report.extraction.asBuilt.elements).toMatchObject({ fromExtraction: 3, agentAdded: 1 });
    expect(report.extraction.asBuilt.copiedFromPlan).toEqual([OPERATION]);
    expect(report.notes.join(" ")).toContain("did not come from extraction");
  });

  it("checks every planned change when the as-built side was not extracted", async () => {
    await stagePlan();
    await ok(await changesetCreateHandler({ name: "hand-written", rootPath }));
    await add({ layer: "application", type: "applicationfunction", name: "compute-node-degrees" });

    const report = await ok(await changesetVerifyHandler({ planned: "add-graph-degree-utils", against: { changesetId: "hand-written" }, rootPath }));
    expect(report.extraction.applied).toBe(false);
    expect(report.elements.unverifiable).toEqual([]);
    expect(report.elements.missing.map((m: any) => m.planned)).toContain(REQUIREMENT);
    expect(report.verdict).toBe("incomplete");
  });

  it("does not apply the rule against the base model", async () => {
    await stagePlan();
    const report = await ok(await changesetVerifyHandler({ planned: "add-graph-degree-utils", against: { base: true }, rootPath }));
    expect(report.extraction.applied).toBe(false);
    expect(report.elements.unverifiable).toEqual([]);
  });

  it("says the as-built side should come from codebase_extract, not be written by hand", () => {
    const asBuilt: string = (changesetVerifyTool.inputSchema.against as any).shape.changesetId.description;
    expect(asBuilt).toContain("codebase_extract");
    expect(asBuilt).not.toContain("or by hand");
    expect(changesetVerifyTool.description).toContain("codebase_extract");
    expect(changesetVerifyTool.description).toContain("unverifiable");
  });
});

describe("extraction coverage, from the cbm mapping", () => {
  it("derives the observable element types from the node mapping and the Tier-0 rules", async () => {
    const coverage = (await loadExtractionCoverage("cbm"))!;
    const types = coverage.observableTypes();
    for (const t of ["api.operation", "application.applicationfunction", "application.dataobject", "testing.testcasesketch", "data-model.objectschema"]) {
      expect(types).toContain(t);
    }
    expect(types.some((t) => /^(motivation|business|product)\./.test(t))).toBe(false);
    expect(types).not.toContain("testing.testcoveragetarget");
  });

  it("decides by the element's file and symbol where the rules do", async () => {
    const coverage = (await loadExtractionCoverage("cbm"))!;
    const at = (layer: string, type: string, file: string, symbol?: string, attributes?: Record<string, unknown>) => ({
      layer,
      type,
      ...(attributes ? { attributes } : {}),
      sourceReference: { provenance: "manual" as const, locations: [{ file, ...(symbol ? { symbol } : {}) }] },
    });

    // Test cases: cards exist for Java and Python tests, not for JS/TS ones.
    expect(coverage.element(at("testing", "testcasesketch", "src/test/java/OwnerControllerTests.java", "OwnerControllerTests.testShow")).observable).toBe(true);
    expect(coverage.element(at("testing", "testcasesketch", "src/utils/graphDegree.test.ts")).observable).toBe(false);
    // With no file of its own, the build's files decide.
    expect(coverage.element({ layer: "testing", type: "testcasesketch" }, ["src/a.test.ts", "src/a.ts"]).observable).toBe(false);
    expect(coverage.element({ layer: "testing", type: "testcasesketch" }, ["src/OwnerTests.java"]).observable).toBe(true);

    // Operations come from HTTP routes only.
    expect(coverage.element(at("api", "operation", "src/main/java/OwnerController.java", "GET /owners/{ownerId}")).observable).toBe(true);
    expect(coverage.element(at("api", "operation", "src/index.ts", "computeNodeDegrees")).observable).toBe(false);
    expect(coverage.element(at("api", "operation", "src/index.ts", "computeNodeDegrees", { http_method: "GET" })).observable).toBe(true);

    // A Tier-0 rule with a file condition: views come from route files.
    expect(coverage.element(at("ux", "view", "src/routes/home.tsx")).observable).toBe(true);
    expect(coverage.element(at("ux", "view", "src/lib/format.ts")).observable).toBe(false);

    expect(coverage.element({ layer: "motivation", type: "goal" }).observable).toBe(false);
  });

  it("decides relationships by the edge mapping, within what each edge links", async () => {
    const coverage = (await loadExtractionCoverage("cbm"))!;
    const fn = (symbol: string) => ({
      layer: "application",
      type: "applicationfunction",
      sourceReference: { provenance: "extracted" as const, locations: [{ file: "src/x.ts", symbol }] },
    });
    const component = { layer: "application", type: "applicationcomponent" };
    const data = { layer: "application", type: "dataobject" };

    expect(coverage.relationship(fn("run"), "accesses", data).observable).toBe(true);
    expect(coverage.relationship(fn("run"), "depends-on", fn("other")).observable).toBe(true);
    // DEFINES_METHOD links a class to its methods, not a module to its functions.
    expect(coverage.relationship(component, "assigned-to", fn("OwnerController.showOwner")).observable).toBe(true);
    expect(coverage.relationship(component, "assigned-to", fn("computeNodeDegrees")).observable).toBe(false);
    // HANDLES: an operation realizes the function handling it.
    expect(coverage.relationship({ layer: "api", type: "operation" }, "realizes", fn("OwnerController.showOwner")).observable).toBe(true);
    expect(coverage.relationship(fn("run"), "satisfies", { layer: "motivation", type: "requirement" }).observable).toBe(false);
  });
});

describe("changeset_verify review fixes (PR 1057)", () => {
  const EXISTING = "application.applicationfunction.existing-fn";
  const GET_OWNER = "api.operation.get-owner";
  const LIST_OWNERS = "api.operation.list-owners";

  /** A bootstrapped base: code elements from an earlier extraction. */
  async function extractedBase(): Promise<void> {
    await add({
      layer: "application",
      type: "applicationfunction",
      name: "existing-fn",
      description: "Loads owners.",
      sourceFile: "src/main/java/OwnerRepository.java",
      sourceSymbol: "OwnerRepository.load",
      sourceProvenance: "extracted",
    });
    for (const [name, path] of [
      ["get-owner", "/owners/{ownerId}"],
      ["list-owners", "/owners"],
    ]) {
      await add({
        layer: "api",
        type: "operation",
        name,
        attributes: { operationId: name, summary: `GET ${path}`, tags: "owners", http_method: "GET", http_path: path },
        sourceFile: "src/main/java/OwnerController.java",
        sourceSymbol: `GET ${path}`,
        sourceProvenance: "extracted",
      });
    }
  }

  it("bug: a hand-written as-built changeset that updates an extracted base element is not extraction output", async () => {
    await extractedBase();
    await stagePlan();
    await ok(await changesetCreateHandler({ name: "hand-built", rootPath }));
    await ok(await modelUpdateHandler({ id: EXISTING, description: "Loads owners, cached.", rootPath } as any));

    const report = await ok(await changesetVerifyHandler({ planned: "add-graph-degree-utils", against: { changesetId: "hand-built" }, rootPath }));
    expect(report.extraction.applied).toBe(false);
    expect(report.extraction.asBuilt.elements.byProvenance).toEqual({ sourceUnchanged: 1 });
    expect(report.extraction.asBuilt.record).toBe("not-found");
    expect(report.elements.unverifiable).toEqual([]);
    expect(report.relationships.unverifiable).toEqual([]);
    expect(report.elements.missing.map((m: any) => m.planned).sort()).toEqual(
      [COMPONENT, DATA, FUNCTION, OPERATION, REQUIREMENT, TEST_CASE].sort()
    );
    expect(report.relationships.missing).toHaveLength(5);
    expect(report.verdict).toBe("incomplete");
  });

  it("risk 5: planned updates to fields extraction never writes are unverifiable, per field; code fields still count", async () => {
    await extractedBase();
    await ok(await changesetCreateHandler({ name: "touch-ups", rootPath }));
    await ok(await modelUpdateHandler({ id: EXISTING, description: "Loads owners, cached.", rootPath } as any));
    await ok(await modelUpdateHandler({ id: GET_OWNER, attributePatch: { deprecated: true }, rootPath } as any));
    await ok(await modelUpdateHandler({ id: LIST_OWNERS, attributePatch: { http_path: "/owners/all" }, rootPath } as any));
    await ok(await changesetDeactivateHandler({ rootPath }));
    await stageExtraction("touch-ups-as-built");

    const report = await ok(
      await changesetVerifyHandler({ planned: "touch-ups", against: { changesetId: "touch-ups-as-built" }, rootPath })
    );
    expect(report.extraction.applied).toBe(true);
    const unverifiable = Object.fromEntries(report.elements.unverifiable.map((u: any) => [u.planned, u.fields.map((f: any) => f.field)]));
    expect(unverifiable).toEqual({ [EXISTING]: ["description"], [GET_OWNER]: ["attributes.deprecated"] });
    // A method and path are code facts extraction writes: an update the build lacks is missing.
    expect(report.elements.missing.map((m: any) => m.planned)).toEqual([LIST_OWNERS]);

    // Against the base, the same rule on request (a landed extraction), and not without it.
    const landed = await ok(await changesetVerifyHandler({ planned: "touch-ups", against: { base: true, extracted: true }, rootPath }));
    expect(landed.extraction.applied).toBe(true);
    expect(landed.elements.unverifiable.map((u: any) => u.planned).sort()).toEqual([EXISTING, GET_OWNER].sort());
    expect(landed.elements.missing.map((m: any) => m.planned)).toEqual([LIST_OWNERS]);
    const plain = await ok(await changesetVerifyHandler({ planned: "touch-ups", against: { base: true }, rootPath }));
    expect(plain.extraction.applied).toBe(false);
    expect(plain.elements.missing).toHaveLength(3);

    const refused = await changesetVerifyHandler({
      planned: "touch-ups",
      against: { changesetId: "touch-ups-as-built", extracted: true },
      rootPath,
    } as any);
    expect(refused.isError).toBe(true);
  });

  it("risk 5: a planned attribute extraction doesn't fill, absent from an extracted add, is unverifiable, not divergent", async () => {
    await ok(await changesetCreateHandler({ name: "plan-attrs", rootPath }));
    await add({
      layer: "application",
      type: "applicationcomponent",
      name: "graph-degree",
      attributes: { type: "internal", documentation: "Degree helpers." },
      sourceFile: "src/utils/graphDegree.ts",
      sourceProvenance: "manual",
    });
    await ok(await changesetDeactivateHandler({ rootPath }));
    await stageExtraction("attrs-as-built");

    const report = await ok(await changesetVerifyHandler({ planned: "plan-attrs", against: { changesetId: "attrs-as-built" }, rootPath }));
    // The build's other extracted elements are unplanned; the component itself matches.
    expect(report.elements.divergent).toEqual([]);
    const match = report.elements.matched.find((m: any) => m.planned === COMPONENT);
    expect(match.unverifiableFields).toEqual([{ field: "attributes.documentation", planned: "Degree helpers.", built: null }]);
  });
});

describe("extraction coverage review fixes (PR 1057)", () => {
  it("risk 3: bounds edges as extraction does, by from/to types and the catalog, not dr_pattern layers", async () => {
    const coverage = (await loadExtractionCoverage("cbm"))!;
    const fn = (symbol: string) => ({
      layer: "application",
      type: "applicationfunction",
      sourceReference: { provenance: "extracted" as const, locations: [{ file: "src/x.tsx", symbol }] },
    });
    // CALLS from a UI action component to a function: extraction stages it as triggers.
    expect(coverage.relationship({ layer: "ux", type: "actioncomponent" }, "triggers", fn("save")).observable).toBe(true);
    // DEPLOYS links infrastructure resources, which never become elements: no component assigned-to from it.
    expect(
      coverage.relationship({ layer: "application", type: "applicationcomponent" }, "assigned-to", fn("computeNodeDegrees")).observable
    ).toBe(false);
  });

  it("risk 4: an operation is a re-export only on evidence: a barrel file", async () => {
    const coverage = (await loadExtractionCoverage("cbm"))!;
    const op = (file: string, symbol: string) => ({
      layer: "api",
      type: "operation",
      sourceReference: { provenance: "manual" as const, locations: [{ file, symbol }] },
    });
    expect(coverage.element(op("src/main/java/OwnerController.java", "OwnerController.showVisits")).observable).toBe(true);
    expect(coverage.element(op("app/api/routes/items.py", "read_items")).observable).toBe(true);
    expect(coverage.element(op("src/index.ts", "computeNodeDegrees")).observable).toBe(false);
    expect(coverage.element(op("pkg/__init__.py", "compute")).observable).toBe(false);
    expect(coverage.element(op("src/index.ts", "GET /health")).observable).toBe(true);
  });

  it("risk 5: knows which fields extraction writes", async () => {
    const coverage = (await loadExtractionCoverage("cbm"))!;
    const op = { layer: "api", type: "operation" };
    expect(coverage.field(op, "attributes.http_path")).toBe(true);
    expect(coverage.field(op, "attributes.operationId")).toBe(true);
    expect(coverage.field(op, "attributes.deprecated")).toBe(false);
    expect(coverage.field(op, "description")).toBe(false);
    expect(coverage.field(op, "name")).toBe(true);
  });
});

describe("changeset_verify fix wave 3 (FINDINGS-ROUND2.md)", () => {
  const PLAN_FUNCTION = "application.applicationfunction.graph-node-degree-computation";
  const TARGET = "testing.testcoveragetarget.graph-degree-utilities";
  const TEST_FILE = "src/utils/graphDegree.test.ts";
  /** The cards of the run: the function, and the test module hinted as a component. */
  const CARDS: RecordEntry[] = [
    { file: GRAPH_DEGREE, symbol: "computeNodeDegrees", label: "Function", name: "computeNodeDegrees", candidates: [], hint: "application.applicationfunction" },
    { file: TEST_FILE, symbol: "src.utils.graphDegree.test", label: "Module", candidates: [], hint: "application.applicationcomponent" },
  ];

  async function stageShapedPlan(): Promise<void> {
    await ok(await changesetCreateHandler({ name: "graph-degree-plan", rootPath }));
    await add({ layer: "application", type: "applicationfunction", name: "graph-node-degree-computation", description: "Degrees per node." });
    await add({ layer: "testing", type: "testcoveragetarget", name: "graph-degree-utilities", attributes: { targetType: "integration-flow", priority: "medium" } });
    await ok(await changesetDeactivateHandler({ rootPath }));
  }

  async function createAsBuilt(name: string): Promise<string> {
    const created = await ok(
      await changesetCreateHandler({ name, description: "As-built extraction of the code at 57168fb. Staged by codebase_extract.", rootPath })
    );
    return created.id;
  }

  it("bug 3: an element marked extracted that extraction didn't stage counts as agent-added, and warns", async () => {
    await stageShapedPlan();
    const id = await createAsBuilt("shaped-as-built");
    await writeExtractionRecord(id, { cards: CARDS });
    // The round-2 build turn: the function named after the plan, and a test target extraction never makes.
    await add({
      layer: "application",
      type: "applicationfunction",
      name: "graph-node-degree-computation",
      sourceFile: GRAPH_DEGREE,
      sourceSymbol: "computeNodeDegrees",
      sourceProvenance: "extracted",
    });
    await add({
      layer: "testing",
      type: "testcoveragetarget",
      name: "graph-degree-utilities",
      attributes: { targetType: "integration-flow", priority: "medium" },
      sourceFile: TEST_FILE,
      sourceProvenance: "extracted",
    });

    const report = await ok(await changesetVerifyHandler({ planned: "graph-degree-plan", against: { changesetId: "shaped-as-built" }, rootPath }));
    const share = report.extraction.asBuilt;
    expect(share.elements).toEqual({ total: 2, byProvenance: { extracted: 2 }, fromExtraction: 0, agentAdded: 2 });
    const why = Object.fromEntries(share.agentAdded.map((a: any) => [a.id, a]));
    expect(why[PLAN_FUNCTION]).toMatchObject({ declared: "extracted", reason: "named after the plan's element, not after its card" });
    expect(why[TARGET]).toMatchObject({
      declared: "extracted",
      reason: "extraction can't produce it: the cbm mapping produces no testing.testcoveragetarget elements",
    });
    expect([...share.copiedFromPlan].sort()).toEqual([PLAN_FUNCTION, TARGET].sort());

    expect(report.warning).toContain("2 of the 2 as-built elements were not staged by extraction");
    expect(report.verdictText).toContain("not staged by extraction");
    expect(report.elements.matched.length).toBeGreaterThan(0);
    expect(report.elements.matched.every((m: any) => m.builtByAgent === true)).toBe(true);
    expect(formatVerifyReport(report)).toContain("Warning: 2 of the 2 as-built elements");
  });

  it("bug 3: an element staged from a card and named after it counts as extracted", async () => {
    await stageShapedPlan();
    const id = await createAsBuilt("honest-as-built");
    await writeExtractionRecord(id, {
      cards: [...CARDS, { file: GRAPH_DEGREE, symbol: "findIsolatedNodes", candidates: ["application.applicationfunction"] }],
      staged: [{ id: DATA, file: GRAPH_DEGREE, symbol: "NodeDegree", label: "Interface" }],
    });
    await add({ layer: "application", type: "applicationfunction", name: "computeNodeDegrees", sourceFile: GRAPH_DEGREE, sourceSymbol: "computeNodeDegrees", sourceProvenance: "extracted" });
    await add({ layer: "application", type: "dataobject", name: "node-degree", sourceFile: GRAPH_DEGREE, sourceSymbol: "NodeDegree", sourceProvenance: "extracted" });
    // A card's symbol given a type the card doesn't allow does not count.
    await add({ layer: "application", type: "dataobject", name: "find-isolated-nodes", sourceFile: GRAPH_DEGREE, sourceSymbol: "findIsolatedNodes", sourceProvenance: "extracted" });

    const report = await ok(await changesetVerifyHandler({ planned: "graph-degree-plan", against: { changesetId: "honest-as-built" }, rootPath }));
    const share = report.extraction.asBuilt;
    expect(share.elements).toMatchObject({ total: 3, fromExtraction: 2, agentAdded: 1 });
    expect(share.agentAdded).toEqual([
      { id: "application.dataobject.find-isolated-nodes", declared: "extracted", reason: "its card allows application.applicationfunction, not application.dataobject" },
    ]);
    expect(share.copiedFromPlan).toBeUndefined();
    expect(report.warning).toBeUndefined();
  });

  it("bug 3: a staged id the plan also adds still has to be named after its symbol", async () => {
    await stageShapedPlan();
    const id = await createAsBuilt("staged-plan-named");
    // The record lists the element (as a re-run records what was staged from a card), but its name is the plan's.
    await writeExtractionRecord(id, { staged: [{ id: PLAN_FUNCTION, file: GRAPH_DEGREE, symbol: "computeNodeDegrees", label: "Function" }] });
    await add({
      layer: "application",
      type: "applicationfunction",
      name: "graph-node-degree-computation",
      sourceFile: GRAPH_DEGREE,
      sourceSymbol: "computeNodeDegrees",
      sourceProvenance: "extracted",
    });

    const report = await ok(await changesetVerifyHandler({ planned: "graph-degree-plan", against: { changesetId: "staged-plan-named" }, rootPath }));
    expect(report.extraction.asBuilt.agentAdded).toEqual([
      { id: PLAN_FUNCTION, declared: "extracted", reason: "named after the plan's element, not after the symbol extraction staged it from" },
    ]);
    expect(report.extraction.asBuilt.copiedFromPlan).toEqual([PLAN_FUNCTION]);
  });

  it("bug 3: without codebase_extract's record, declared provenance confirms nothing", async () => {
    await stageShapedPlan();
    await ok(await changesetCreateHandler({ name: "hand-marked", rootPath }));
    await add({ layer: "application", type: "applicationfunction", name: "computeNodeDegrees", sourceFile: GRAPH_DEGREE, sourceSymbol: "computeNodeDegrees", sourceProvenance: "extracted" });

    const report = await ok(await changesetVerifyHandler({ planned: "graph-degree-plan", against: { changesetId: "hand-marked" }, rootPath }));
    // Declared extracted adds alone no longer turn the extraction rule on.
    expect(report.extraction.applied).toBe(false);
    expect(report.extraction.asBuilt).toMatchObject({ record: "not-found", elements: { fromExtraction: 0, agentAdded: 1 } });
    expect(report.warning).toContain("1 of the 1 as-built elements were not staged by extraction");
  });

  it("bug 4: a planned operation with no method, path or source reference is unverifiable, and says how to fix it", async () => {
    await ok(await changesetCreateHandler({ name: "reexport-plan", rootPath }));
    // As model_add advises for planned elements: no source fields.
    await add({ layer: "api", type: "operation", name: "compute-node-degrees", attributes: { operationId: "computeNodeDegrees", summary: "Compute node degrees", tags: "graph" } });
    await add({ layer: "application", type: "applicationfunction", name: "compute-node-degrees" });
    await link(OPERATION, "realizes", FUNCTION);
    await ok(await changesetDeactivateHandler({ rootPath }));
    await stageExtraction("reexport-as-built");

    const report = await ok(await changesetVerifyHandler({ planned: "reexport-plan", against: { changesetId: "reexport-as-built" }, rootPath }));
    expect(report.elements.missing).toEqual([]);
    const op = report.elements.unverifiable.find((u: any) => u.planned === OPERATION);
    expect(op.reason).toContain("no method, path or source reference");
    expect(op.reason).toContain("http_method and http_path");
    expect(op.reason).toContain("sourceFile and sourceSymbol");
    expect(report.relationships.unverifiable.map((u: any) => u.planned.predicate)).toEqual(["realizes"]);
    expect(report.verdict).toBe("diverges"); // the build's other extracted elements are unplanned
    expect(report.summary.elements).toMatchObject({ matched: 1, missing: 0, unverifiable: 1 });
  });

  it("bug 4: handler-symbol and method-and-path operations stay observable", async () => {
    const coverage = (await loadExtractionCoverage("cbm"))!;
    const bare = coverage.element({ layer: "api", type: "operation", attributes: { operationId: "computeNodeDegrees" } });
    expect(bare.observable).toBe(false);
    expect(bare.reason).toContain("no method, path or source reference");
    expect(coverage.element({ layer: "api", type: "operation", attributes: { http_method: "GET", http_path: "/owners" } }).observable).toBe(true);
    expect(
      coverage.element({
        layer: "api",
        type: "operation",
        sourceReference: { provenance: "manual", locations: [{ file: "src/main/java/OwnerController.java", symbol: "OwnerController.showVisits" }] },
      }).observable
    ).toBe(true);
  });
});

describe("changeset_verify PR 1066 review", () => {
  const EXISTING = "application.applicationfunction.existing-fn";
  const OLD = "application.applicationfunction.old-fn";
  const GET_OWNER = "api.operation.get-owner";

  async function base(): Promise<void> {
    for (const [name, symbol] of [
      ["existing-fn", "OwnerRepository.load"],
      ["old-fn", "OwnerRepository.old"],
    ]) {
      await add({
        layer: "application",
        type: "applicationfunction",
        name,
        sourceFile: "src/main/java/OwnerRepository.java",
        sourceSymbol: symbol,
        sourceProvenance: "extracted",
      });
    }
  }

  async function asBuiltChangeset(name: string): Promise<string> {
    return (await ok(await changesetCreateHandler({ name, description: "As-built extraction. Staged by codebase_extract.", rootPath }))).id;
  }

  async function emptyPlan(): Promise<void> {
    await ok(await changesetCreateHandler({ name: "plan", rootPath }));
    await add({ layer: "application", type: "applicationfunction", name: "unrelated-plan-fn" });
    await ok(await changesetDeactivateHandler({ rootPath }));
  }

  it("1: an update counts as extracted only when the record lists it; a delete only when it is a candidate delete", async () => {
    await base();
    await emptyPlan();
    const id = await asBuiltChangeset("updates-as-built");
    await writeExtractionRecord(id, { updated: [{ id: EXISTING, fields: ["sourceReference"] }], candidateDeletes: [] });
    // Both updates stage an extracted source reference; only one is in the record.
    await ok(await modelUpdateHandler({ id: EXISTING, sourceFile: "src/main/java/OwnerRepo.java", sourceSymbol: "OwnerRepository.load", sourceProvenance: "extracted", rootPath } as any));
    await ok(await modelUpdateHandler({ id: OLD, sourceFile: "src/main/java/OwnerRepo.java", sourceSymbol: "OwnerRepository.old", sourceProvenance: "extracted", rootPath } as any));

    let report = await ok(await changesetVerifyHandler({ planned: "plan", against: { changesetId: "updates-as-built" }, rootPath }));
    expect(report.extraction.asBuilt.elements).toMatchObject({ total: 2, fromExtraction: 1, agentAdded: 1 });
    expect(report.extraction.asBuilt.agentAdded).toEqual([{ id: OLD, declared: "extracted", reason: "an update extraction did not stage" }]);

    // A delete: extraction's only when it was a candidate delete.
    await writeExtractionRecord(id, { updated: [{ id: EXISTING }, { id: OLD }], candidateDeletes: [] });
    clearModelCache();
    const deleting = await asBuiltChangeset("deletes-as-built");
    await writeExtractionRecord(deleting, { candidateDeletes: [OLD] });
    const { modelDeleteHandler } = await import("../../../src/mcp/tools/model-delete.js");
    await ok(await modelDeleteHandler({ id: OLD, force: true, rootPath } as any));
    await ok(await modelDeleteHandler({ id: EXISTING, force: true, rootPath } as any));
    report = await ok(await changesetVerifyHandler({ planned: "plan", against: { changesetId: "deletes-as-built" }, rootPath }));
    expect(report.extraction.asBuilt.elements).toMatchObject({ total: 2, byProvenance: { deleted: 2 }, fromExtraction: 1, agentAdded: 1 });
    expect(report.extraction.asBuilt.agentAdded).toEqual([
      { id: EXISTING, declared: "deleted", reason: "a delete that is not one of extraction's candidate deletes" },
    ]);
  });

  it("1: an extracted add whose name or attributes changed after extraction is still extracted, and the match lists the edits", async () => {
    await stagePlan();
    const id = await stageExtraction("edited-as-built", [
      { ...STAGED[0] },
      { ...STAGED[1], name: "graph-degree", attributes: { type: "library" } },
      { ...STAGED[2] },
    ]);
    const report = await ok(await changesetVerifyHandler({ planned: "add-graph-degree-utils", against: { changesetId: "edited-as-built" }, rootPath }));
    expect(id).toBeTruthy();
    expect(report.extraction.asBuilt.elements).toMatchObject({ fromExtraction: 3, agentAdded: 0 });
    expect(report.extraction.asBuilt.editedAfterExtraction).toEqual([
      { id: COMPONENT, edits: [{ field: "attributes.type", extracted: "library", now: "internal" }] },
    ]);
    const match = report.elements.matched.find((m: any) => m.planned === COMPONENT);
    expect(match.editedAfterExtraction).toEqual([{ field: "attributes.type", extracted: "library", now: "internal" }]);
    expect(report.notes.join(" ")).toContain("changed after extraction staged them");

    // An update extraction folded into the add is its own, not an edit.
    await writeExtractionRecord(id, {
      staged: [{ ...STAGED[0] }, { ...STAGED[1], name: "graph-degree", attributes: { type: "library" } }, { ...STAGED[2] }],
      updated: [{ id: COMPONENT, fields: ["attributes.type"] }],
    });
    const again = await ok(await changesetVerifyHandler({ planned: "add-graph-degree-utils", against: { changesetId: "edited-as-built" }, rootPath }));
    expect(again.extraction.asBuilt.editedAfterExtraction).toBeUndefined();
  });

  it("2: a card-staged element carried into staged still needs a type its card allows", async () => {
    await stagePlan();
    const id = await asBuiltChangeset("carried");
    const TEST_FILE = "src/utils/graphDegree.test.ts";
    // As a re-run records it: the agent's element under staged, its card under earlierCards.
    await writeExtractionRecord(id, {
      staged: [{ id: "application.dataobject.degree-suite", file: TEST_FILE, symbol: "degreeSuite", label: "Function", name: "degree-suite" }],
      earlierCards: [{ file: TEST_FILE, symbol: "degreeSuite", label: "Function", candidates: ["application.applicationfunction"] }],
    });
    await add({ layer: "application", type: "dataobject", name: "degree-suite", sourceFile: TEST_FILE, sourceSymbol: "degreeSuite", sourceProvenance: "extracted" });
    const report = await ok(await changesetVerifyHandler({ planned: "add-graph-degree-utils", against: { changesetId: "carried" }, rootPath }));
    expect(report.extraction.asBuilt.agentAdded).toEqual([
      { id: "application.dataobject.degree-suite", declared: "extracted", reason: "its card allows application.applicationfunction, not application.dataobject" },
    ]);
  });

  it("2: cards modelled in earlier runs (earlierCards) still confirm the elements staged from them", async () => {
    await stagePlan();
    const id = await ok(await changesetCreateHandler({ name: "earlier-cards", description: "Staged by codebase_extract.", rootPath }));
    await writeExtractionRecord(id.id, {
      cards: [],
      earlierCards: [{ file: GRAPH_DEGREE, symbol: "computeNodeDegrees", label: "Function", cardId: "c1" }],
    });
    await add({ layer: "application", type: "applicationfunction", name: "compute-node-degrees", sourceFile: GRAPH_DEGREE, sourceSymbol: "computeNodeDegrees", sourceProvenance: "extracted" });
    const report = await ok(await changesetVerifyHandler({ planned: "add-graph-degree-utils", against: { changesetId: "earlier-cards" }, rootPath }));
    expect(report.extraction.asBuilt.elements).toMatchObject({ fromExtraction: 1, agentAdded: 0 });
  });

  it("2: a run that staged nothing confirms the changeset of its name through pending.json, at the current commit only", async () => {
    await stagePlan();
    // The project is not a git repository here, so make the head known: the codebase root is the project.
    const { spawnSync } = await import("node:child_process");
    spawnSync("git", ["init", "-q"], { cwd: rootPath });
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x"], { cwd: rootPath });
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: rootPath, encoding: "utf-8" }).stdout.trim();
    const dir = join(rootPath, ".dr", "analyzers", "extract");
    await mkdir(dir, { recursive: true });
    const pending = (gitHead: string) =>
      writeFile(
        join(dir, "pending.json"),
        JSON.stringify({ pending: true, changesetId: "", changesetName: "from-pending", gitHead, staged: [], cards: [{ file: GRAPH_DEGREE, symbol: "computeNodeDegrees", label: "Function", candidates: [] }] })
      );
    await ok(await changesetCreateHandler({ name: "from-pending", rootPath }));
    await add({ layer: "application", type: "applicationfunction", name: "compute-node-degrees", sourceFile: GRAPH_DEGREE, sourceSymbol: "computeNodeDegrees", sourceProvenance: "extracted" });

    await pending(head);
    let report = await ok(await changesetVerifyHandler({ planned: "add-graph-degree-utils", against: { changesetId: "from-pending" }, rootPath }));
    expect(report.extraction.applied).toBe(true);
    expect(report.extraction.asBuilt).toMatchObject({ record: "pending", elements: { fromExtraction: 1, agentAdded: 0 } });

    await pending("0000000");
    report = await ok(await changesetVerifyHandler({ planned: "add-graph-degree-utils", against: { changesetId: "from-pending" }, rootPath }));
    expect(report.extraction.applied).toBe(false);
    expect(report.extraction.asBuilt.record).toBe("not-found");
  });

  it("3: a route element is named after its card whatever the path parameters are called", async () => {
    const op = { operationId: "showOwner", summary: "Show an owner", tags: "owners" };
    await ok(await changesetCreateHandler({ name: "route-plan", rootPath }));
    // The build has the plan's id, so it must be named after its card: GET /owners/{} is GET /owners/{ownerId}.
    await add({ layer: "api", type: "operation", name: "GET /owners/{}", attributes: { ...op, http_method: "GET", http_path: "/owners/{ownerId}" } });
    await ok(await changesetDeactivateHandler({ rootPath }));
    const id = await asBuiltChangeset("route-as-built");
    const built = await ok(
      await modelAddHandler({
        layer: "api",
        type: "operation",
        name: "GET /owners/{}",
        attributes: { ...op, http_method: "GET", http_path: "/owners/{}" },
        sourceFile: "src/main/java/OwnerController.java",
        sourceSymbol: "GET /owners/{ownerId}",
        sourceProvenance: "extracted",
        rootPath,
      } as any)
    );
    // The card's symbol names the parameter; the element doesn't. Only the route key matches them.
    await writeExtractionRecord(id, { cards: [{ file: "src/main/java/OwnerController.java", symbol: "GET /owners/{ownerId}", label: "Route", candidates: ["api.operation"] }] });
    const report = await ok(await changesetVerifyHandler({ planned: "route-plan", against: { changesetId: "route-as-built" }, rootPath }));
    expect(report.extraction.asBuilt.elements).toMatchObject({ fromExtraction: 1, agentAdded: 0 });
    expect(built.id).toBeTruthy();
    void GET_OWNER;
  });

  it("4: the codebase_extract description alone neither applies the rule nor confirms anything", async () => {
    await stagePlan();
    await ok(await changesetCreateHandler({ name: "marker-only", description: "As-built extraction. Staged by codebase_extract.", rootPath }));
    await add({ layer: "application", type: "applicationfunction", name: "compute-node-degrees", sourceFile: GRAPH_DEGREE, sourceSymbol: "computeNodeDegrees", sourceProvenance: "extracted" });
    const report = await ok(await changesetVerifyHandler({ planned: "add-graph-degree-utils", against: { changesetId: "marker-only" }, rootPath }));
    expect(report.extraction.applied).toBe(false);
    expect(report.elements.unverifiable).toEqual([]);
    expect(report.extraction.asBuilt.record).toBe("not-found");
    expect(report.notes.join(" ")).toContain("its record is gone");
  });

  it("4: an element of an open card that extraction can't produce from its file is agent-added", async () => {
    await stagePlan();
    const id = await asBuiltChangeset("open-card");
    const TEST_FILE = "src/utils/graphDegree.test.ts";
    await writeExtractionRecord(id, { cards: [{ file: TEST_FILE, symbol: "degreeSuite", label: "Function", candidates: [] }] });
    // testcasesketch is an observable type, but not in a TypeScript file.
    await add({
      layer: "testing",
      type: "testcasesketch",
      name: "degree-suite",
      attributes: { status: "automated", implementationFormat: "automated" },
      sourceFile: TEST_FILE,
      sourceSymbol: "degreeSuite",
      sourceProvenance: "extracted",
    });
    const report = await ok(await changesetVerifyHandler({ planned: "add-graph-degree-utils", against: { changesetId: "open-card" }, rootPath }));
    expect(report.extraction.asBuilt.agentAdded).toEqual([
      expect.objectContaining({ id: "testing.testcasesketch.degree-suite", reason: expect.stringContaining("extraction can't produce it from its card") }),
    ]);
  });

  it("5: an unsourced planned operation stays missing, with the hint, when the build has unplanned operations", async () => {
    await ok(await changesetCreateHandler({ name: "op-plan", rootPath }));
    await add({ layer: "api", type: "operation", name: "show-owner", attributes: { operationId: "showOwner", summary: "Show an owner", tags: "owners" } });
    await ok(await changesetDeactivateHandler({ rootPath }));
    const id = await asBuiltChangeset("ops-as-built");
    const opId = (
      await ok(
        await modelAddHandler({
          layer: "api",
          type: "operation",
          name: "GET /owners/{ownerId}",
          attributes: { operationId: "showOwner2", summary: "GET /owners/{ownerId}", tags: "owners", http_method: "GET", http_path: "/owners/{ownerId}" },
          sourceFile: "src/main/java/OwnerController.java",
          sourceSymbol: "GET /owners/{ownerId}",
          sourceProvenance: "extracted",
          rootPath,
        } as any)
      )
    ).id;
    await writeExtractionRecord(id, { staged: [{ id: opId, file: "src/main/java/OwnerController.java", symbol: "GET /owners/{ownerId}", label: "Route" }] });
    const report = await ok(await changesetVerifyHandler({ planned: "op-plan", against: { changesetId: "ops-as-built" }, rootPath }));
    expect(report.elements.unverifiable).toEqual([]);
    expect(report.elements.missing).toHaveLength(1);
    expect(report.elements.missing[0].reason).toContain(`unplanned api.operation element(s) (${opId})`);
    expect(report.elements.missing[0].reason).toContain("http_method");
  });
});
