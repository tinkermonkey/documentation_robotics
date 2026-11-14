/**
 * The card state of dr-qset-2 (TIER1_DESIGN.md sections 3.3 and 8): no line range, sorted neighbour
 * lists, and a state that doesn't move when unrelated code moves or CBM returns its rows in
 * another order. dr-qset-1's state keeps the line range and the card's order.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildEdgeIndex, CardBuilder, type CardGraph, type GraphNode } from "../../../../src/analyzers/cards/index.js";
import { v1, v2, type StateCard } from "../../../../src/analyzers/classifier/index.js";

const FIXTURES = path.join(import.meta.dir, "../../../fixtures/classifier/dr-qset-1");
const fixtureCards = readFileSync(path.join(FIXTURES, "cards.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => (JSON.parse(l) as { card: StateCard }).card);

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

function card(over: Partial<StateCard> = {}): StateCard {
  return {
    label: "Function",
    name: "load",
    qualified_name: "src.core.loader.load",
    file_path: "src/core/loader.ts",
    start_line: 120,
    end_line: 128,
    signature: "(dir: string)",
    docstring: null,
    is_exported: true,
    is_entry_point: null,
    complexity: 2,
    parent_class: null,
    base_classes: [],
    return_type: "Promise<Model>",
    callers: ["src.commands.show.run", "src.commands.add.run", "src.server.api.get"],
    callees: ["src.utils.fs.read", "src.core.model.parse"],
    callers_total: 3,
    callees_total: 2,
    imports: ["src/utils/fs.ts", "src/core/model.ts"],
    env_vars: [],
    routes_handled: [],
    http_calls: [],
    inherits: [],
    implements: [],
    route_method: null,
    source: "export async function load(dir: string): Promise<Model> {\n  return parse(await read(dir));\n}",
    source_lines_total: 3,
    source_truncated: false,
    ...over,
  };
}

describe("dr-qset-2 state", () => {
  test("the File line carries the path only; dr-qset-1 keeps the line range", () => {
    const c = card();
    expect(v2.stateOf(c)).toContain("\nFile: src/core/loader.ts\n");
    expect(v2.stateOf(c)).not.toContain("lines 120");
    expect(v1.stateOf(c)).toContain("\nFile: src/core/loader.ts (lines 120-128)\n");
    for (const c of fixtureCards) expect(v2.stateOf(c)).not.toMatch(/\(lines \d+-/);
  });

  test("callers, callees and imports are sorted; dr-qset-1 keeps the card's order", () => {
    const c = card();
    const s2 = v2.stateOf(c);
    expect(s2).toContain("Callers (3): src.commands.add.run, src.commands.show.run, src.server.api.get");
    expect(s2).toContain("Callees (2): src.core.model.parse, src.utils.fs.read");
    expect(s2).toContain("File imports: src/core/model.ts, src/utils/fs.ts");
    expect(v1.stateOf(c)).toContain("Callers (3): src.commands.show.run, src.commands.add.run, src.server.api.get");
  });

  test("the first 12 neighbours and 15 imports are taken after sorting", () => {
    const names = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${String(n - i).padStart(2, "0")}`);
    const c = card({ callers: names("c", 20), callers_total: 20, imports: names("i", 18) });
    const s = v2.stateOf(c);
    expect(s).toContain(`Callers (20): ${names("c", 20).reverse().slice(0, 12).join(", ")}`);
    expect(s).toContain(`File imports: ${names("i", 18).reverse().slice(0, 15).join(", ")}`);
  });

  test("everything else is dr-qset-1's: same lines once the line range and order are taken out", () => {
    for (const c of fixtureCards) {
      const sortedCard = { ...c, callers: [...c.callers].sort(), callees: [...c.callees].sort(), imports: [...c.imports].sort(), start_line: null };
      expect(v2.stateOf(c)).toBe(v1.stateOf(sortedCard));
    }
  });

  test("moving a symbol down its file with the same text leaves its state hash unchanged", () => {
    const here = card();
    const moved = card({ start_line: 220, end_line: 228 });
    expect(hash(v2.stateOf(moved))).toBe(hash(v2.stateOf(here)));
    expect(hash(v1.stateOf(moved))).not.toBe(hash(v1.stateOf(here)));
  });

  test("the questions are dr-qset-1's under a new id", () => {
    expect(v2.QSET_ID).toBe("dr-qset-2");
    expect(v1.QSET_ID).toBe("dr-qset-1");
    expect(v2.stage1Questions).toBe(v1.stage1Questions);
    expect(v2.stage2Questions).toBe(v1.stage2Questions);
    expect(v2.KIND_CANDIDATES).toBe(v1.KIND_CANDIDATES);
    expect(v2.SOURCE_LINES).toBe(v1.SOURCE_LINES);
  });
});

// Callers, callees and imports: the lists the design sorts. Other row-ordered lists (environment
// variables, routes handled, HTTP calls, inherits, implements) keep CBM's order in both question sets.
describe("reordering CBM's CALLS and IMPORTS rows changes nothing", () => {
  const P = "proj";
  const TARGET = `${P}.src.core.loader.load`;
  const FILE = "src/core/loader.ts";
  const node: GraphNode = { label: "Function", name: "load", qualified_name: TARGET, file_path: FILE, start_line: 120, end_line: 122 };
  // more callers, callees and imports than the card keeps, so which ones are kept depends on order
  const callRows = [
    ...Array.from({ length: 20 }, (_, i) => [`${P}.src.cmd.c${(i * 7) % 20}.run`, TARGET]),
    ...Array.from({ length: 14 }, (_, i) => [TARGET, `${P}.src.util.u${(i * 5) % 14}.f`]),
  ];
  const importRows = Array.from({ length: 18 }, (_, i) => [FILE, `${P}.src.dep${(i * 5) % 18}`, `src/dep${(i * 5) % 18}.ts`]);

  function graph(reverse: boolean): CardGraph {
    const order = <T>(rows: T[]) => (reverse ? [...rows].reverse() : rows);
    return {
      project: P,
      async search() {
        return [node];
      },
      async rows(cypher) {
        if (/\[r:CALLS\]->/.test(cypher)) return order(callRows);
        if (/IMPORTS\]->\(b\) RETURN a\.file_path, b\.qualified_name, b\.file_path/.test(cypher)) return order(importRows);
        return [];
      },
      async snippet() {
        return { source: "export async function load(dir: string) {\n  return parse(await read(dir));\n}" };
      },
    };
  }

  async function built(reverse: boolean) {
    const g = graph(reverse);
    return new CardBuilder(g, await buildEdgeIndex(g), { scope: "t" }).build(node);
  }

  test("the card keeps the same first 12 callers and callees and 15 imports, sorted", async () => {
    const [a, b] = [await built(false), await built(true)];
    expect(a.callers).toEqual(b.callers);
    expect(a.callees).toEqual(b.callees);
    expect(a.imports).toEqual(b.imports);
    expect(a.callers).toHaveLength(12);
    expect(a.callees).toHaveLength(12);
    expect(a.imports).toHaveLength(15);
    expect(a.callers).toEqual([...a.callers].sort());
    expect(a.callers_total).toBe(20);
  });

  test("so the dr-qset-2 state, and its hash, are the same", async () => {
    const [a, b] = [await built(false), await built(true)];
    expect(hash(v2.stateOf(a))).toBe(hash(v2.stateOf(b)));
  });
});
