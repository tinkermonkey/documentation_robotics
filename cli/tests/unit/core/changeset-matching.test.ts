/**
 * Unit tests for matchPlannedElements, the one matcher changeset_verify pairs planned and built elements with.
 */
import { describe, it, expect } from "bun:test";
import { matchPlannedElements } from "../../../src/core/changeset-matching.js";
import type { BuiltSide, Plan, PlannedElementChange, VerifyElement } from "../../../src/core/changeset-verify.js";

const el = (id: string, extra: Partial<VerifyElement> & { file?: string; symbol?: string } = {}): VerifyElement => {
  const [layer, type, ...rest] = id.split(".");
  const { file, symbol, ...more } = extra;
  return {
    id,
    layer,
    type,
    name: rest.join("."),
    attributes: {},
    ...(file ? { sourceReference: { provenance: "extracted" as const, locations: [{ file, ...(symbol ? { symbol } : {}) }] } } : {}),
    ...more,
  };
};
const plan = (...elements: VerifyElement[]): Plan => ({
  label: "plan",
  elements: elements.map((e): PlannedElementChange => ({ ...e, op: "add" })),
  relationships: [],
  notes: [],
  baseElementIds: [],
});
const built = (...elements: VerifyElement[]): BuiltSide => ({ label: "b", kind: "changeset", elements, relationships: [], changedElements: elements, notes: [] });

describe("matchPlannedElements", () => {
  it("pairs by file and symbol exactly, among several elements of one file (#1318)", () => {
    const { pairs } = matchPlannedElements(
      plan(el("api.operation.upload", { file: "s.ts", symbol: "putFile" })),
      built(el("api.operation.a", { file: "s.ts", symbol: "getFile" }), el("api.operation.b", { file: "s.ts", symbol: "putFile" }))
    );
    expect(pairs.get("api.operation.upload")).toMatchObject({ built: "api.operation.b", match: "exact", bySource: true });
  });

  it("does not pair on a symbol alone: another file is another element", () => {
    const { pairs } = matchPlannedElements(
      plan(el("api.operation.upload", { file: "s.ts", symbol: "putFile" })),
      built(el("api.operation.b", { file: "other.ts", symbol: "putFile" }))
    );
    expect(pairs.has("api.operation.upload")).toBe(false);
  });

  it("offers a file-and-symbol pair built as another type as probable", () => {
    const { pairs } = matchPlannedElements(
      plan(el("data-model.objectschema.x", { file: "s.ts", symbol: "X" })),
      built(el("data-model.entity.y", { file: "s.ts", symbol: "X" }))
    );
    expect(pairs.get("data-model.objectschema.x")).toMatchObject({ match: "probable" });
  });

  it("leaves several same-file candidates ambiguous when nothing tells them apart", () => {
    const m = matchPlannedElements(
      plan(el("api.operation.upload", { file: "s.ts" })),
      built(el("api.operation.a", { file: "s.ts" }), el("api.operation.b", { file: "s.ts" }))
    );
    expect(m.pairs.size).toBe(0);
    expect(m.ambiguous.get("api.operation.upload")).toHaveLength(2);
  });

  it("takes an element that was there before the plan for no planned add", () => {
    const p = plan(el("api.operation.upload", { file: "s.ts", symbol: "putFile" }));
    p.baseElementIds = ["api.operation.old"];
    const m = matchPlannedElements(p, built(el("api.operation.old", { file: "s.ts", symbol: "putFile" })));
    expect(m.pairs.size).toBe(0);
  });
});

import { explainUnknownId } from "../../../src/core/source-reference-adoption.js";
import { declaredSymbol } from "../../../src/core/build-evidence.js";

describe("explainUnknownId (#1253)", () => {
  const empty = { matched: [], divergent: [], missing: [], unverifiable: [], unplanned: [], deletionsNotDone: [] };
  it("says why an id names nothing to copy", () => {
    const elements = {
      ...empty,
      matched: [{ planned: "a.b.c", built: "a.b.d", op: "add" as const, match: "probable" as const }],
      missing: [{ planned: "a.b.e", layer: "a", type: "b", name: "e", op: "add" as const, reason: "x" }],
    };
    expect(explainUnknownId("a.b.c", elements)).toContain("nothing to copy");
    expect(explainUnknownId("a.b.e", elements)).toContain("references");
    expect(explainUnknownId("a.b.zzz", elements)).toContain("not a planned element");
  });
});

describe("declaredSymbol (#1429)", () => {
  const element = { id: "data-model.objectschema.t", name: "t", sourceReference: { provenance: "manual" as const, locations: [{ file: "src/t.py", symbol: "parse_t" }] } };
  it("finds the symbol as a whole word outside comments", () => {
    expect(declaredSymbol(element, [{ file: "src/t.py", text: "x = 1\ndef parse_t(d):\n  pass\n" }])).toMatchObject({ symbol: "parse_t", line: 2 });
  });
  it("ignores a comment, a longer word and another file", () => {
    expect(declaredSymbol(element, [{ file: "src/t.py", text: "# parse_t\nparse_to = 1\n" }])).toBeNull();
    expect(declaredSymbol(element, [{ file: "other.py", text: "def parse_t(): pass" }])).toBeNull();
  });
});

describe("declaredSymbol, quoted names", () => {
  it("does not take a quoted string for the symbol", () => {
    const element = { id: "a.b.c", name: "c", sourceReference: { provenance: "manual" as const, locations: [{ file: "s.ts", symbol: "AuditLog" }] } };
    expect(declaredSymbol(element, [{ file: "s.ts", text: 'log("AuditLog")' }])).toBeNull();
  });
});
