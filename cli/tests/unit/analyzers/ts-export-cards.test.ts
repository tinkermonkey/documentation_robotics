/**
 * Exported TypeScript symbols become cards a range's extraction can decide (#1344, #1381): consts
 * holding handlers and forwardRef/memo components (CBM labels them Variable), exported types,
 * classes with methods, hooks and components, with the callbacks inside a unit rejected.
 */
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { collectExtraction, extractionConfigFrom } from "@/analyzers/cards/extract";
import { isDeclaredVariable, declarationShapesOf } from "@/analyzers/cards/shapes";
import { classifyTier0, type CardGraph, type GraphNode } from "@/analyzers/cards/index";
import { tier0RulesFrom } from "@/analyzers/tier0-rules";
import type { AnalyzerHeuristic } from "@/analyzers/types";

const P = "proj";
const CBM = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../spec/dist/analyzers/cbm.json"), "utf-8"));
const RULES = tier0RulesFrom(CBM.heuristics.heuristics as AnalyzerHeuristic[]);
const CONFIG = extractionConfigFrom(RULES, Object.values(CBM.edges_by_type), Object.values(CBM.nodes_by_label));

type N = GraphNode & { source: string };
const node = (label: string, name: string, file: string, start: number, end: number, source: string, extra: Partial<GraphNode> = {}): N => ({
  label, name, qualified_name: `${P}.${file.replace(/[/.]/g, ".")}.${name}`, file_path: file, start_line: start, end_line: end, source, ...extra,
});

const BOX = "src/components/Box.tsx";
const HANDLER = "src/handlers.ts";
const NODES: N[] = [
  // a forwardRef component, a memo component, an arrow memo, a function component with callbacks, a hook
  node("Variable", "BranchMap", BOX, 3, 5, "export const BranchMap = React.forwardRef<HTMLDivElement, Props>((props, ref) => {\n  return <div ref={ref} />;\n});"),
  node("Variable", "Chip", BOX, 7, 9, "export const Chip = React.memo(function Chip(p: Props) {\n  return <span>{p.a}</span>;\n});"),
  node("Variable", "Wrapped", "src/components/Wrapped.tsx", 1, 7, "export const Wrapped = React.forwardRef<HTMLDivElement, Props>((props, ref) => {\n  const onPick = () => 1;\n  return <div ref={ref} onClick={onPick} />;\n});"),
  node("Function", "onPick", "src/components/Wrapped.tsx", 2, 2, "const onPick = () => 1;"),
  node("Function", "Identity", BOX, 30, 30, "export function Identity<T>(x: T): T { return x; }"),
  node("Variable", "COLUMNS", BOX, 32, 32, "export const COLUMNS = [{ render: (r) => <b>{r}</b> }];"),
  node("Variable", "isAdmin", HANDLER, 40, 40, 'export const isAdmin = role === "admin";'),
  node("Variable", "TestWrapper", "src/components/Box.test.tsx", 1, 1, "export const TestWrapper = memo(() => <div />);"),
  node("Variable", "buttonVariants", "src/components/ui/button.tsx", 1, 1, "export const buttonVariants = cva(\"x\");"),
  node("Variable", "Button", "src/components/ui/button.tsx", 3, 3, "export const Button = React.forwardRef<HTMLButtonElement, Props>(() => <button />);"),
  node("Variable", "Tag", BOX, 11, 11, "export const Tag = memo((p: Props) => <span>{p.a}</span>);"),
  node("Function", "Panel", BOX, 13, 20, "export function Panel(p: Props) {\n  const onClick = () => 1;\n  return <div onClick={onClick}>{p.a}</div>;\n}"),
  node("Function", "onClick", BOX, 14, 14, "const onClick = () => 1;"),
  node("Function", "useInspectorModel", "src/hooks/useInspectorModel.ts", 1, 6, "export function useInspectorModel(id: string) {\n  const cb = () => id;\n  return cb;\n}"),
  node("Function", "cb", "src/hooks/useInspectorModel.ts", 2, 2, "const cb = () => id;"),
  node("Variable", "useOther", "src/hooks/useOther.ts", 1, 1, "export const useOther = () => useState(0);"),
  // not cards: a primitive constant, a module-private const, a lowercase helper returning JSX
  node("Variable", "LIMIT", HANDLER, 2, 2, "export const LIMIT = 5;"),
  node("Variable", "internal", HANDLER, 3, 3, "const internal = createThing();"),
  node("Function", "render", BOX, 22, 24, "export function render() {\n  return <div />;\n}"),
  // an exported const handler, an exported type, a class with methods
  node("Variable", "projectListHandler", HANDLER, 5, 5, "export const projectListHandler = createProjectListHandler();"),
  node("Type", "DrBotSessionKey", "src/contracts/session.ts", 1, 1, "export type DrBotSessionKey = { project: string; id: string };"),
  node("Class", "DrBotLauncher", HANDLER, 10, 30, "export class DrBotLauncher {\n  start() {}\n  stop() {}\n}"),
  node("Method", "start", HANDLER, 11, 11, "start() {}", { parent_class: `${P}.src.handlers.ts.DrBotLauncher` }),
  node("Method", "stop", HANDLER, 12, 12, "stop() {}", { parent_class: `${P}.src.handlers.ts.DrBotLauncher` }),
];

function graph(): CardGraph {
  const byQn = new Map(NODES.map((n) => [n.qualified_name, n]));
  return {
    project: P,
    async search(label) {
      return NODES.filter((n) => n.label === label);
    },
    async rows() {
      return [];
    },
    async snippet(qn) {
      const n = byQn.get(qn);
      return n ? { source: n.source } : null;
    },
  };
}

describe("shapes", () => {
  const card = (label: string, name: string, file: string, source: string) => ({ label, name, file_path: file, source });
  it("reads hooks and components from the declaration", () => {
    expect(declarationShapesOf(card("Function", "useX", "a.ts", "export function useX() {}"))).toEqual(["exported", "react-hook"]);
    expect(declarationShapesOf(card("Variable", "Box", "a.tsx", "export const Box = React.forwardRef<A, B>(() => null);"))).toEqual(["exported", "react-component"]);
    expect(declarationShapesOf(card("Variable", "Box", "a.ts", "export const Box = memo(() => null);"))).toEqual(["exported", "react-component"]);
    expect(declarationShapesOf(card("Function", "Panel", "a.tsx", "export function Panel() {\n  return <div />;\n}"))).toEqual(["exported", "react-component"]);
  });
  it("is empty or only exported for the rest", () => {
    expect(declarationShapesOf(card("Function", "Panel", "a.tsx", "function Panel() {\n  return <div />;\n}"))).toEqual([]);
    expect(declarationShapesOf(card("Function", "render", "a.tsx", "export function render() {\n  return <div />;\n}"))).toEqual(["exported"]);
    expect(declarationShapesOf(card("Function", "Panel", "a.ts", "export function Panel() { return a < b; }"))).toEqual(["exported"]);
    expect(declarationShapesOf(card("Function", "Panel", "a.py", "def Panel(): pass"))).toEqual([]);
  });
  it("keeps exported non-primitive consts only", () => {
    expect(isDeclaredVariable(card("Variable", "A", "a.ts", "export const A = 5;"))).toBe(false);
    expect(isDeclaredVariable(card("Variable", "A", "a.ts", 'export const A = "x" as const;'))).toBe(false);
    expect(isDeclaredVariable(card("Variable", "A", "a.ts", "const A = make();"))).toBe(false);
    expect(isDeclaredVariable(card("Variable", "A", "a.ts", "export const A = make();"))).toBe(true);
    expect(isDeclaredVariable(card("Variable", "A", "a.py", "A = make()"))).toBe(false);
    expect(isDeclaredVariable(card("Function", "A", "a.ts", "function A() {}"))).toBe(true);
  });
});

describe("extraction of exported TypeScript symbols", () => {
  it("gives each shape a card, narrowed to UX types where Tier 0 can", async () => {
    const x = await collectExtraction(graph(), CONFIG, "cbm", {});
    const by = new Map(x.symbols.map((s) => [s.card.name, s]));
    const narrowed = (name: string) => {
      const t = by.get(name)?.tier0;
      return t?.kind === "narrow" ? t.candidates.map((c) => `${c.layer}.${c.type}`) : t;
    };
    for (const name of ["BranchMap", "Chip", "Tag", "Panel"]) {
      expect(narrowed(name)).toEqual(["ux.view", "ux.subview", "ux.librarycomponent", "ux.librarysubview", "ux.actioncomponent"]);
    }
    for (const name of ["useInspectorModel", "useOther"]) expect(narrowed(name)).toEqual(["ux.dataconfig", "ux.stateaction", "ux.statepattern"]);
    // exported consts, types and classes with their methods are cards for the agent to decide
    for (const name of ["projectListHandler", "DrBotSessionKey", "DrBotLauncher", "start", "stop", "render"]) expect(by.has(name)).toBe(true);
    expect(by.get("projectListHandler")?.triage?.visibility).toBe("exported");
    expect(by.get("start")?.triage?.visibility).toBe("public");
    // not cards: a primitive constant and a private const
    expect(by.has("LIMIT")).toBe(false);
    expect(by.has("internal")).toBe(false);
  });

  it("rejects the callbacks inside a component or hook, and nothing else", async () => {
    const x = await collectExtraction(graph(), CONFIG, "cbm", {});
    const by = new Map(x.symbols.map((s) => [s.card.name, s]));
    expect(by.get("onClick")?.tier0).toMatchObject({ kind: "reject", rule: "nested-in-react-unit" });
    expect(by.get("cb")?.tier0).toMatchObject({ kind: "reject", rule: "nested-in-react-unit" });
    // inside a Variable component too (forwardRef), the case that has no Function container
    expect(by.get("onPick")?.tier0).toMatchObject({ kind: "reject", rule: "nested-in-react-unit" });
    expect(by.get("Panel")?.tier0?.kind).toBe("narrow");
    expect(x.summary.rejected).toBe(4);
    expect(x.summary.cards).toBe(x.summary.decided + x.summary.rejected + x.summary.narrowed + x.summary.undecided);
  });

  it("does not mistake type arguments, JSX tables or comparisons for components or primitives", async () => {
    const x = await collectExtraction(graph(), CONFIG, "cbm", {});
    const by = new Map(x.symbols.map((s) => [s.card.name, s]));
    expect(by.get("Identity")?.tier0).toBeNull();
    expect(by.has("COLUMNS") && by.get("COLUMNS")?.tier0 !== null).toBe(false);
    expect(by.has("isAdmin")).toBe(true);
  });

  it("rejects a Variable in a test file, and narrows a ui-library component but not its variants helper", async () => {
    const x = await collectExtraction(graph(), CONFIG, "cbm", {});
    const by = new Map(x.symbols.map((s) => [s.card.name, s]));
    expect(by.get("TestWrapper")?.tier0?.kind).toBe("reject");
    const t = by.get("Button")?.tier0;
    expect(t?.kind === "narrow" ? t.candidates.map((c) => c.type) : t).toEqual(["librarycomponent", "actioncomponent"]);
    expect(by.get("buttonVariants")?.tier0).toBeNull();
  });

  it("classify's limit counts cards, not the Variables dropped before them", async () => {
    const all = await classifyTier0(graph(), RULES, "cbm", {});
    const some = await classifyTier0(graph(), RULES, "cbm", { limit: 5 });
    expect(all.results.length).toBeGreaterThan(5);
    expect(some.results).toHaveLength(5);
  });

  it("classifies the same cards", async () => {
    const r = await classifyTier0(graph(), RULES, "cbm", {});
    const names = r.results.map((c) => c.name);
    expect(names).toContain("BranchMap");
    expect(names).not.toContain("LIMIT");
  });
});
