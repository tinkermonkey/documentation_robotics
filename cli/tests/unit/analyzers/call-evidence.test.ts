/**
 * The call-edge evidence gate (src/analyzers/call-evidence.ts), on evidence shaped like what
 * codebase-memory-mcp 0.12.1 records on CALLS edges. The cases are real edges from the eval
 * corpora and heimdall (docs/analyzers/CBM_MAPPING_INVENTORY.md, "Call-edge evidence").
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CALL_GATE_HEURISTIC, DEFAULT_CALL_GATE, bareCallee, callEdgeVerdict, callGateFrom, cellNumber } from "../../../src/analyzers/call-evidence.js";
import type { AnalyzerHeuristic } from "../../../src/analyzers/types.js";

const CBM = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../spec/dist/analyzers/cbm.json"), "utf-8"));

describe("callEdgeVerdict", () => {
  it("keeps an edge with no evidence, or at the confidence floor and above", () => {
    expect(callEdgeVerdict({})).toEqual({ keep: true, reason: "no-evidence" });
    expect(callEdgeVerdict({ strategy: "lsp_type_dispatch", confidence: 0.95, candidates: 1, callee: "owner.getPet" })).toEqual({ keep: true, reason: "confident" });
    // unique_name at 0.75 and suffix_match at 0.55 are mostly right.
    expect(callEdgeVerdict({ strategy: "suffix_match", confidence: 0.55, candidates: 2, callee: "startSpan" }).keep).toBe(true);
    expect(callEdgeVerdict({ strategy: "unique_name", confidence: 0.5, candidates: 1, callee: "f" }, { edges: ["CALLS"], minConfidence: 0.5 }).keep).toBe(true);
  });

  it("drops heimdall's packClusters -> galaxyLayout.radiusOf (#1095)", () => {
    // `radiusOf` is a destructured callback parameter; CBM matched it by suffix to a closure in
    // galaxyLayout.ts. graphPacking.ts imports only d3-hierarchy and ./graphClustering.
    const verdict = callEdgeVerdict({
      strategy: "suffix_match",
      confidence: 0.28,
      candidates: 3,
      callee: "radiusOf",
      calleeImportance: 33.17,
      callerFile: "src/utils/graphPacking.ts",
      calleeFile: "src/utils/galaxyLayout.ts",
      importedFrom: [],
    });
    expect(verdict).toEqual({ keep: false, reason: "uncorroborated" });
  });

  it("drops a library call that has a project namesake", () => {
    // tests import writeFile from fs/promises; the index matched src/utils/file-io.ts by name.
    expect(
      callEdgeVerdict({
        strategy: "unique_name",
        confidence: 0.38,
        candidates: 1,
        callee: "writeFile",
        calleeImportance: 84.85,
        callerFile: "tests/unit/config.test.ts",
        calleeFile: "src/utils/file-io.ts",
        importedFrom: [],
      }).keep
    ).toBe(false);
  });

  it("drops a low-confidence call to a field or variable (no importance)", () => {
    // MockMvc `view().name(...)` matched to NamedEntity.name, a field.
    expect(callEdgeVerdict({ strategy: "suffix_match", confidence: 0.11, candidates: 15, callee: "view().name" })).toEqual({ keep: false, reason: "not-callable" });
    // A unique member name is no help when the target is not callable.
    expect(callEdgeVerdict({ strategy: "unique_name", confidence: 0.38, candidates: 1, callee: "owner.getPet" }).keep).toBe(false);
  });

  it("keeps a unique member name called on a receiver", () => {
    expect(callEdgeVerdict({ strategy: "unique_name", confidence: 0.38, candidates: 1, callee: "crud.get_user_by_email", calleeImportance: 3.6 })).toEqual({
      keep: true,
      reason: "unique-member",
    });
    // Not when several definitions share the name.
    expect(callEdgeVerdict({ strategy: "suffix_match", confidence: 0.21, candidates: 4, callee: "this.vets.findAll", calleeImportance: 2.6 }).keep).toBe(false);
  });

  it("keeps this.m() resolved to a method in the caller's own file", () => {
    const own = { strategy: "suffix_match", confidence: 0.28, candidates: 2, callee: "this.getSourceRoot", calleeImportance: 2 };
    expect(callEdgeVerdict({ ...own, callerFile: "src/integrations/base-manager.ts", calleeFile: "src/integrations/base-manager.ts" })).toEqual({
      keep: true,
      reason: "own-member",
    });
    expect(callEdgeVerdict({ ...own, callerFile: "src/a.ts", calleeFile: "src/b.ts" }).keep).toBe(false);
  });

  it("keeps a bare call its file imports from the callee's file or a directory index above it", () => {
    const base = { strategy: "unique_name", confidence: 0.38, candidates: 1, callee: "MarkdownExporter", calleeImportance: 24.5, calleeFile: "src/export/markdown-exporter.ts" };
    expect(callEdgeVerdict({ ...base, importedFrom: ["src/export/markdown-exporter.ts"] })).toEqual({ keep: true, reason: "imported" });
    expect(callEdgeVerdict({ ...base, importedFrom: ["src/export/index.ts"] })).toEqual({ keep: true, reason: "imported" });
    expect(callEdgeVerdict({ ...base, calleeFile: "backend/app/crud/users.py", importedFrom: ["backend/app/__init__.py"] }).keep).toBe(true);
    // An index of another directory, or a sibling module, corroborates nothing.
    expect(callEdgeVerdict({ ...base, importedFrom: ["src/core/index.ts"] }).keep).toBe(false);
    expect(callEdgeVerdict({ ...base, importedFrom: ["src/export/other.ts"] }).keep).toBe(false);
  });
});

describe("callGateFrom", () => {
  it("reads the gate from the cbm mapping's heuristics", () => {
    const gate = callGateFrom(CBM.heuristics.heuristics as AnalyzerHeuristic[]);
    expect(gate).toEqual({ edges: ["CALLS"], minConfidence: 0.5 });
  });

  it("is off without the heuristic, defaults its parameters, and rejects bad ones", () => {
    expect(callGateFrom([])).toBeNull();
    expect(callGateFrom([{ name: CALL_GATE_HEURISTIC, description: "x" }])).toEqual(DEFAULT_CALL_GATE);
    expect(() => callGateFrom([{ name: CALL_GATE_HEURISTIC, description: "x", parameters: { min_confidence: 2 } }])).toThrow();
    expect(() => callGateFrom([{ name: CALL_GATE_HEURISTIC, description: "x", parameters: { edges: [] } }])).toThrow();
  });
});

describe("helpers", () => {
  it("reads query cells as numbers and callees as bare names", () => {
    expect(cellNumber("0.38")).toBe(0.38);
    expect(cellNumber(0.9)).toBe(0.9);
    expect(cellNumber("")).toBeUndefined();
    expect(cellNumber(null)).toBeUndefined();
    expect(bareCallee("writeFile")).toBe("writeFile");
    expect(bareCallee("this.load")).toBeNull();
    expect(bareCallee("view().name")).toBeNull();
    expect(bareCallee(undefined)).toBeNull();
  });
});
