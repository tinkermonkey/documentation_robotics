import { describe, expect, it } from "bun:test";
import { acceptedDeletes, acceptedLinks, fileMatches, linkKey } from "../../../src/analyzers/suggestions.js";
import type { CandidateDelete, PlannedRelationship } from "../../../src/analyzers/extraction-plan.js";

const link = (source: string, predicate: string, target: string, kind: string, extra: Partial<NonNullable<PlannedRelationship["evidence"]>> = {}, file = "src/a.ts"): PlannedRelationship => ({
  source,
  predicate,
  target,
  sourceLayer: "application",
  targetLayer: "application",
  edge: kind.replace("edge:", ""),
  evidence: { kind, edges: 1, sites: [{ from: "A", fromFile: file, to: "B", toFile: "src/b.ts" }], sourceFiles: [file], ...extra },
});

const SUGGESTED = [
  link("application.applicationfunction.a", "depends-on", "application.applicationfunction.b", "edge:CALLS", { confidence: 0.95 }),
  link("application.applicationfunction.c", "depends-on", "application.applicationfunction.b", "edge:CALLS", { confidence: 0.4 }, "src/c/c.ts"),
  link("testing.testcasesketch.t", "tests", "application.applicationfunction.b", "edge:TEST_FILE_NAME", {}, "tests/b.test.ts"),
];

describe("accepting suggested links (#1492)", () => {
  it("accepts by every condition an item gives, and nothing for an item with none", () => {
    expect(acceptedLinks([{ edge: "CALLS", minConfidence: 0.9 }], SUGGESTED).accepted.map(linkKey)).toEqual([linkKey(SUGGESTED[0])]);
    expect(acceptedLinks([{ predicate: "tests" }], SUGGESTED).accepted).toHaveLength(1);
    expect(acceptedLinks([{ files: "src/c/**" }], SUGGESTED).accepted.map(linkKey)).toEqual([linkKey(SUGGESTED[1])]);
    expect(acceptedLinks([{ files: "tests" }], SUGGESTED).accepted).toHaveLength(1);
    expect(acceptedLinks([{ keys: [linkKey(SUGGESTED[2])] }], SUGGESTED).accepted).toHaveLength(1);
    expect(acceptedLinks([{ all: true }], SUGGESTED).accepted).toHaveLength(3);
    const none = acceptedLinks([{}, { predicate: "serves" }], SUGGESTED);
    expect(none.accepted).toEqual([]);
    expect(none.empty).toEqual([0]);
    expect(none.unmatched).toEqual([1]);
  });

  it("a suggestion with no recorded confidence is not matched by minConfidence", () => {
    expect(acceptedLinks([{ minConfidence: 0.1 }], SUGGESTED).accepted).toHaveLength(2);
  });

  it("matches files as a path, a folder or a glob", () => {
    expect(fileMatches("src/a/b.ts", ["src/a"])).toBe(true);
    expect(fileMatches("src/a/b.ts", ["src/**/*.ts"])).toBe(true);
    expect(fileMatches("src/ab/b.ts", ["src/a"])).toBe(false);
  });
});

describe("accepting suggested deletes (#1492)", () => {
  const d = (id: string, evidence: CandidateDelete["evidence"], file: string): CandidateDelete => ({ id, layer: "application", type: "applicationcomponent", file, evidence, detail: "" });
  const DELETES = [d("application.applicationcomponent.x", "file-deleted", "src/x.ts"), d("application.applicationcomponent.y", "reference-never-matched", "src/y.ts")];

  it("accepts by evidence, files or ids, and an item with none accepts nothing", () => {
    expect(acceptedDeletes([{ evidence: "file-deleted" }], DELETES).accepted.map((x) => x.id)).toEqual(["application.applicationcomponent.x"]);
    expect(acceptedDeletes([{ files: "src/y.ts" }], DELETES).accepted.map((x) => x.id)).toEqual(["application.applicationcomponent.y"]);
    expect(acceptedDeletes([{ ids: ["application.applicationcomponent.y"] }], DELETES).accepted).toHaveLength(1);
    expect(acceptedDeletes([{ all: true }], DELETES).accepted).toHaveLength(2);
    expect(acceptedDeletes([{}], DELETES)).toMatchObject({ accepted: [], empty: [0] });
  });
});
