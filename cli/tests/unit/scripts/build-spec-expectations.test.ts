/**
 * Unit tests for spec/scripts/compile-expectations.ts — compiling connection expectations.
 *
 * Expectations are soft and must never break the spec build: whatever no longer fits the catalog
 * (a retired predicate, a renamed type, a malformed entry) is dropped with a reason, at the
 * smallest grain possible, and the rest compile.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { compileExpectations, type CatalogTriple } from "../../../../spec/scripts/compile-expectations.js";

const SPEC_DIR = resolve(import.meta.dir, "../../../../spec");
const schema = JSON.parse(
  readFileSync(join(SPEC_DIR, "schemas/base/connection-expectations.schema.json"), "utf-8")
) as object;

const triples: CatalogTriple[] = [
  { source: "application.applicationcomponent", predicate: "assigned-to", destination: "application.applicationfunction" },
  { source: "api.operation", predicate: "realizes", destination: "application.applicationfunction" },
  { source: "ux.actioncomponent", predicate: "uses", destination: "application.applicationfunction" },
];
const nodeTypes = [
  "application.applicationcomponent",
  "application.applicationfunction",
  "application.applicationcollaboration",
  "api.operation",
  "ux.actioncomponent",
];

const file = (expectations: unknown[], layer = "application") => ({
  file: `${layer}.expectations.json`,
  content: JSON.stringify({ layer, expectations }),
});

const fn = (id: string, anyOf: unknown[], extra: Record<string, unknown> = {}) => ({
  id: `application.applicationfunction.${id}`,
  source: "application.applicationfunction",
  rationale: "Test rationale.",
  anyOf,
  ...extra,
});

describe("compileExpectations", () => {
  it("compiles expectations whose connections the catalog allows, including at-least-one-of groups", () => {
    const result = compileExpectations({
      files: [
        file([
          fn("performed-by", [
            { direction: "incoming", predicate: "assigned-to", other: { types: ["application.applicationcomponent"] } },
          ]),
          fn("exposed", [
            { direction: "incoming", predicate: "realizes", other: { types: ["api.operation"] } },
            { direction: "incoming", predicate: "uses", other: { layers: ["ux"] } },
          ]),
        ]),
      ],
      triples,
      nodeTypes,
      schema,
    });
    expect(result.dropped).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.expectations.map((e) => e.id)).toEqual([
      "application.applicationfunction.exposed",
      "application.applicationfunction.performed-by",
    ]);
    expect(result.expectations[0].layer).toBe("application");
    expect(result.expectations[0].anyOf).toHaveLength(2);
  });

  it("drops a connection whose predicate the catalog retired, and keeps the expectation's other alternatives", () => {
    const result = compileExpectations({
      files: [
        file([
          fn("exposed", [
            { direction: "incoming", predicate: "exposes", other: { types: ["api.operation"] } },
            { direction: "incoming", predicate: "realizes", other: { types: ["api.operation"] } },
          ]),
        ]),
      ],
      triples,
      nodeTypes,
      schema,
    });
    expect(result.dropped).toEqual([]);
    expect(result.expectations[0].anyOf).toEqual([
      { direction: "incoming", predicate: "realizes", other: { types: ["api.operation"] } },
    ]);
    expect(result.warnings.join("\n")).toContain("exposes");
  });

  it("drops an expectation none of whose connections the catalog allows, without failing", () => {
    const result = compileExpectations({
      files: [file([fn("retired", [{ direction: "outgoing", predicate: "no-longer-a-predicate" }])])],
      triples,
      nodeTypes,
      schema,
    });
    expect(result.expectations).toEqual([]);
    expect(result.dropped).toEqual([
      {
        id: "application.applicationfunction.retired",
        file: "application.expectations.json",
        reason: "the catalog no longer allows any of its connections",
      },
    ]);
  });

  it("drops named types the catalog does not allow and keeps the allowed ones", () => {
    const result = compileExpectations({
      files: [
        file([
          fn("performed-by", [
            {
              direction: "incoming",
              predicate: "assigned-to",
              other: { types: ["application.applicationcomponent", "application.applicationcollaboration"] },
            },
          ]),
        ]),
      ],
      triples,
      nodeTypes,
      schema,
    });
    expect(result.expectations[0].anyOf[0].other).toEqual({ types: ["application.applicationcomponent"] });
    expect(result.warnings.join("\n")).toContain("application.applicationcollaboration");
  });

  it("drops unknown source types, wrong-layer sources, duplicates and malformed entries, keeping the rest", () => {
    const good = fn("performed-by", [{ direction: "incoming", predicate: "assigned-to" }]);
    const result = compileExpectations({
      files: [
        file([
          good,
          { ...good }, // duplicate id
          { id: "application.gone.x", source: "application.gone", rationale: "r", anyOf: [{ direction: "incoming", predicate: "assigned-to" }] },
          fn("no-rationale", [{ direction: "incoming", predicate: "assigned-to" }], { rationale: "" }),
          fn("bad-direction", [{ direction: "sideways", predicate: "assigned-to" }]),
          { ...good, id: "api.operation.wrong-layer", source: "api.operation" },
        ]),
        { file: "broken.expectations.json", content: "{ not json" },
        { file: "odd.expectations.json", content: JSON.stringify([1, 2]) },
      ],
      triples,
      nodeTypes,
      schema,
    });
    expect(result.expectations.map((e) => e.id)).toEqual(["application.applicationfunction.performed-by"]);
    const reasons = Object.fromEntries(result.dropped.map((d) => [d.id, d.reason]));
    expect(reasons["application.applicationfunction.performed-by"]).toBe("duplicate id");
    expect(reasons["application.gone.x"]).toContain("unknown source type");
    expect(reasons["application.applicationfunction.no-rationale"]).toContain("expectation format");
    expect(reasons["application.applicationfunction.bad-direction"]).toContain("expectation format");
    expect(reasons["api.operation.wrong-layer"]).toContain("not in the file's layer");
    expect(reasons["broken.expectations.json"]).toContain("not valid JSON");
    expect(reasons["odd.expectations.json"]).toContain("not an expectations file");
  });

  it("compiles the spec's own expectation files without throwing", () => {
    const dir = join(SPEC_DIR, "schemas/expectations");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".expectations.json"))
      .map((f) => ({ file: f, content: readFileSync(join(dir, f), "utf-8") }));
    // An empty catalog drops everything, and still must not throw.
    const result = compileExpectations({ files, triples: [], nodeTypes: [], schema });
    expect(result.expectations).toEqual([]);
    expect(result.dropped.length).toBeGreaterThan(0);
  });
});
