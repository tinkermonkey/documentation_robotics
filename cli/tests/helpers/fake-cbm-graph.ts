/**
 * A fake codebase-memory-mcp graph for codebase_extract tests: a small Spring-style project whose
 * nodes and edges answer the extraction's queries. Cards, Tier 0, the edge mapping, the plan and
 * the staging stay the real code, with the real rules and mappings from spec/dist/analyzers/cbm.json.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractionConfigFrom } from "../../src/analyzers/cards/extract.js";
import type { CardGraph, GraphNode } from "../../src/analyzers/cards/types.js";
import { tier0RulesFrom } from "../../src/analyzers/tier0-rules.js";
import { callGateFrom } from "../../src/analyzers/call-evidence.js";
import type { AnalyzerHeuristic } from "../../src/analyzers/types.js";

export const CBM = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../spec/dist/analyzers/cbm.json"), "utf-8"));
export const CONFIG = extractionConfigFrom(
  tier0RulesFrom(CBM.heuristics.heuristics as AnalyzerHeuristic[]),
  Object.values(CBM.edges_by_type),
  Object.values(CBM.nodes_by_label),
  callGateFrom(CBM.heuristics.heuristics as AnalyzerHeuristic[])
);

export const P = "proj";
export const CONTROLLER_FILE = "src/owner/OwnerController.java";
export const OWNER_FILE = "src/owner/Owner.java";
export const SERVICE_FILE = "src/owner/OwnerService.java";
export const HELPERS_FILE = "src/util/Helpers.java";
export const TEST_FILE = "src/test/owner/OwnerTests.java";

export interface FakeNode extends GraphNode {
  source?: string;
  decorators?: string[];
  /**
   * A route's name as CBM stores it, with the code's parameter names (`/owners/{ownerId}`); an
   * infrastructure node's stored name (`Deployment/web`) when `name` is what search_graph gives.
   */
  cbm_name?: string;
}

/** What CBM records on a CALLS edge about how it resolved the call (query cells are strings). */
export interface FakeCallEvidence {
  strategy: string;
  confidence: number;
  candidates: number;
  callee: string;
  /** The callee's importance; absent for a field or a variable. */
  importance?: number;
}

export interface FakeProject {
  nodes: FakeNode[];
  edges: Array<{ type: string; from: string; to: string; evidence?: FakeCallEvidence }>;
  /** IMPORTS edges with the name each one imports: `file` imports `name` from `to` (a file). */
  imports?: Array<{ file: string; name: string; to: string }>;
  /** CBM's get_architecture, when the test gives one. */
  architecture?: CardGraph["architecture"];
}

/** A Spring-style project: a controller and its handler, the route, an entity, a service, a helper and a test. */
export function springProject(): FakeProject {
  const qn = (file: string, ...names: string[]) => `${P}.${file.replace(/\.java$/, "").replace(/\//g, ".")}.${names.join(".")}`;
  const controller = qn(CONTROLLER_FILE, "OwnerController");
  return {
    nodes: [
      { label: "Class", name: "OwnerController", qualified_name: controller, file_path: CONTROLLER_FILE, start_line: 10, end_line: 80, source: "@Controller\nclass OwnerController {\n}", decorators: ["@Controller"] },
      { label: "Method", name: "showOwner", qualified_name: `${controller}.showOwner`, file_path: CONTROLLER_FILE, parent_class: controller, start_line: 40, end_line: 52, source: '@GetMapping("/owners/{ownerId}")\npublic ModelAndView showOwner(int id) {\n}', decorators: ['@GetMapping("/owners/{ownerId}")'] },
      { label: "Method", name: "OwnerController", qualified_name: `${controller}.OwnerController`, file_path: CONTROLLER_FILE, parent_class: controller, start_line: 20, end_line: 22, source: "OwnerController(OwnerRepository owners) {\n}" },
      { label: "Route", name: "__route__GET__/owners/{}", qualified_name: "__route__GET__/owners/{}", file_path: "", method: "GET" },
      { label: "Class", name: "Owner", qualified_name: qn(OWNER_FILE, "Owner"), file_path: OWNER_FILE, start_line: 5, end_line: 60, docstring: "An owner of pets.", source: "@Entity\npublic class Owner extends Person {\n}", decorators: ["@Entity"] },
      { label: "Class", name: "OwnerService", qualified_name: qn(SERVICE_FILE, "OwnerService"), file_path: SERVICE_FILE, start_line: 3, end_line: 30, source: "@Service\npublic class OwnerService {\n}", decorators: ["@Service"] },
      { label: "Class", name: "Helpers", qualified_name: qn(HELPERS_FILE, "Helpers"), file_path: HELPERS_FILE, start_line: 1, end_line: 20, source: "public class Helpers {\n}" },
      { label: "Method", name: "format", qualified_name: qn(HELPERS_FILE, "Helpers", "format"), file_path: HELPERS_FILE, parent_class: qn(HELPERS_FILE, "Helpers"), start_line: 4, end_line: 8, source: "static String format(String s) {\n}" },
      { label: "Method", name: "testShowOwner", qualified_name: qn(TEST_FILE, "OwnerTests", "testShowOwner"), file_path: TEST_FILE, parent_class: qn(TEST_FILE, "OwnerTests"), start_line: 12, end_line: 20, source: "@Test\nvoid testShowOwner() {\n}", decorators: ["@Test"] },
    ],
    edges: [
      { type: "HANDLES", from: `${controller}.showOwner`, to: "__route__GET__/owners/{}" },
      { type: "WRITES", from: `${controller}.showOwner`, to: qn(OWNER_FILE, "Owner") },
    ],
  };
}

export function fakeGraph(project: FakeProject): CardGraph {
  const byQn = new Map(project.nodes.map((n) => [n.qualified_name, n]));
  const edgesOf = (type: string) => project.edges.filter((e) => e.type === type);
  return {
    project: P,
    async search(label, filePattern) {
      return project.nodes.filter((n) => n.label === label && (!filePattern || n.file_path === filePattern));
    },
    async rows(cypher) {
      // The extraction's edge reads: MATCH (a)-[r:TYPE]->(b) RETURN a.qualified_name, a.file_path, a.name, ...
      const edgeRead = /^MATCH \(a\)-\[r:(\w+)\]->\(b\) RETURN a\.qualified_name, a\.file_path, a\.name/.exec(cypher);
      if (edgeRead) {
        const withEvidence = /r\.strategy, r\.confidence, r\.candidates, r\.callee, b\.importance$/.test(cypher);
        return edgesOf(edgeRead[1]).map((e) => {
          const a = byQn.get(e.from);
          const b = byQn.get(e.to);
          const row = [e.from, a?.file_path ?? "", a?.name ?? e.from, e.to, b?.file_path ?? "", b?.name ?? e.to];
          if (!withEvidence) return row;
          const ev = e.evidence;
          return [...row, ev?.strategy ?? "", ev ? String(ev.confidence) : "", ev ? String(ev.candidates) : "", ev?.callee ?? "", ev?.importance !== undefined ? String(ev.importance) : ""];
        });
      }
      if (/^MATCH \(a\)-\[r:IMPORTS\]->\(b\) RETURN a\.file_path, r\.local_name, b\.file_path$/.test(cypher)) {
        return (project.imports ?? []).map((i) => [i.file, i.name, i.to]);
      }
      const inFiles = /WHERE n\.file_path IN \[(.*)\]/.exec(cypher);
      if (inFiles) {
        const files = [...inFiles[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
        return project.nodes.filter((n) => files.includes(n.file_path)).map((n) => [n.file_path, n.qualified_name, n.name, n.label]);
      }
      if (/^MATCH \(r:Route\) RETURN r\.qualified_name, r\.name/.test(cypher)) {
        return project.nodes.filter((n) => n.label === "Route" && n.cbm_name).map((n) => [n.qualified_name, n.cbm_name]);
      }
      // Stored names of an infrastructure label (search_graph gives the end of the qualified name).
      const stored = /^MATCH \(n:(\w+)\) RETURN n\.qualified_name, n\.name$/.exec(cypher);
      if (stored) return project.nodes.filter((n) => n.label === stored[1]).map((n) => [n.qualified_name, n.cbm_name ?? n.name]);
      if (/CALLS\]->/.test(cypher)) return edgesOf("CALLS").map((e) => [e.from, e.to]);
      if (/HANDLES\]->\(x:Route\)/.test(cypher)) return edgesOf("HANDLES").map((e) => [e.from, e.to]);
      if (/-\[r\]->\(x:Route\)/.test(cypher)) return edgesOf("HANDLES").map((e) => [e.from, byQn.get(e.from)?.file_path ?? "", e.to]);
      if (/MATCH \(a:Function\)/.test(cypher)) return project.nodes.filter((n) => n.label === "Function").map((n) => [n.qualified_name, n.file_path]);
      if (/decorators IS NOT NULL/.test(cypher)) return project.nodes.filter((n) => n.decorators).map((n) => [n.qualified_name, JSON.stringify(n.decorators)]);
      return [];
    },
    async snippet(qn) {
      const n = byQn.get(qn);
      return n?.source ? { source: n.source } : null;
    },
    ...(project.architecture ? { architecture: project.architecture } : {}),
  };
}
