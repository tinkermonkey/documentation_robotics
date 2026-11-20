/**
 * The free finders that read the code index (codebase-memory-mcp): the connection probes of S2
 * and the code-side residual of S6. No model call.
 *
 * An element is tied to code through its source reference. A location with a symbol claims the
 * index nodes of that name in that file. A location with no symbol (or whose symbol names the
 * file's module) claims the file's other nodes, when at most FILE_CLAIM_MAX such elements share
 * the file; with more, the file says too little about which element an edge belongs to.
 */
import { spawnSync } from "node:child_process";
import { relationshipFor } from "../../src/analyzers/edge-relationships.js";
import { CbmTools } from "../../src/analyzers/cbm-responses.js";
import { StdioClient } from "../../src/analyzers/stdio-client.js";
import type { Finder, FinderContext, Finding } from "./finders.js";
import { triplesBetween } from "./catalog.js";
import { relKey, unorderedKey, type El, type Model } from "./model.js";

export interface CodeNode {
  qn: string;
  name: string;
  file: string;
  label: string;
}

export interface CodeEdge {
  type: string;
  from: string;
  to: string;
}

export interface CodeGraph {
  project: string;
  nodes: Map<string, CodeNode>;
  edges: CodeEdge[];
  byFile: Map<string, CodeNode[]>;
  out: Map<string, CodeEdge[]>;
  in: Map<string, CodeEdge[]>;
}

/** Edge types a path may walk: calls and uses, a class to its methods, a handler to its route. */
const WALK = new Set([
  "CALLS",
  "CALL_REFERENCE",
  "USAGE",
  "WRITES",
  "HTTP_CALLS",
  "HANDLES",
  "DEFINES_METHOD",
  "IMPORTS"
]);
/** Nodes that stand for a file rather than a declaration in it. */
const FILE_LABELS = new Set(["Module", "File"]);
/** Labels that are never a missing element on their own. */
const NOT_CANDIDATES = new Set([
  "Module",
  "File",
  "Folder",
  "Project",
  "Branch",
  "Section",
  "Variable",
  "EnvVar"
]);

export const PATH_MAX_DEPTH = 3;
export const PATH_MAX_FANOUT = 40;
export const RANKED_TOP = 100;
/** A file's undeclared remainder is claimed by its file-level elements when there are at most this many. */
export const FILE_CLAIM_MAX = 3;

export async function loadCodeGraph(
  root: string,
  edgeTypes: string[]
): Promise<CodeGraph | null> {
  const binary = spawnSync("which", ["codebase-memory-mcp"], {
    encoding: "utf8"
  }).stdout.trim();
  if (!binary) return null;
  const client = new StdioClient();
  client.spawn(binary);
  try {
    await client.initialize({ name: "dr-assess-eval", version: "0.0.1" });
    const tools = new CbmTools(client);
    const project = (await tools.listProjects()).find(
      (p) => p.root_path === root
    );
    if (!project) return null;
    const graph: CodeGraph = {
      project: project.name,
      nodes: new Map(),
      edges: [],
      byFile: new Map(),
      out: new Map(),
      in: new Map()
    };
    const node = (
      qn: unknown,
      name: unknown,
      file: unknown,
      label: unknown
    ): string | null => {
      if (typeof qn !== "string" || !qn) return null;
      if (!graph.nodes.has(qn)) {
        const n = {
          qn,
          name: String(name ?? ""),
          file: typeof file === "string" ? file : "",
          label: String(label ?? "")
        };
        graph.nodes.set(qn, n);
        if (n.file)
          graph.byFile.set(n.file, [...(graph.byFile.get(n.file) ?? []), n]);
      }
      return qn;
    };
    for (const [qn, name, file, label] of (
      await tools.queryGraph(
        "MATCH (a) RETURN a.qualified_name, a.name, a.file_path, a.label",
        project.name
      )
    ).rows) {
      node(qn, name, file, label);
    }
    for (const type of new Set([...edgeTypes, ...WALK])) {
      const rows = (
        await tools.queryGraph(
          `MATCH (a)-[r:${type}]->(b) RETURN a.qualified_name, a.name, a.file_path, a.label, b.qualified_name, b.name, b.file_path, b.label`,
          project.name
        )
      ).rows;
      for (const [aq, an, af, al, bq, bn, bf, bl] of rows) {
        const from = node(aq, an, af, al);
        const to = node(bq, bn, bf, bl);
        if (!from || !to || from === to) continue;
        const edge = { type, from, to };
        graph.edges.push(edge);
        graph.out.set(from, [...(graph.out.get(from) ?? []), edge]);
        graph.in.set(to, [...(graph.in.get(to) ?? []), edge]);
      }
    }
    return graph;
  } finally {
    client.close();
  }
}

export interface Claims {
  /** Node -> the elements it stands for. */
  byNode: Map<string, El[]>;
  byElement: Map<string, string[]>;
}

export function claimNodes(model: Model, graph: CodeGraph): Claims {
  const byNode = new Map<string, El[]>();
  const byElement = new Map<string, string[]>();
  const claim = (el: El, qn: string) => {
    const list = byNode.get(qn) ?? [];
    if (!list.includes(el)) list.push(el);
    byNode.set(qn, list);
    const nodes = byElement.get(el.id) ?? [];
    if (!nodes.includes(qn)) nodes.push(qn);
    byElement.set(el.id, nodes);
  };
  // File-level locations: no symbol, or a symbol that names the file's module.
  const fileLevel = new Map<string, Set<El>>();
  for (const el of model.elements.values()) {
    for (const loc of el.locations) {
      const nodes = graph.byFile.get(loc.file) ?? [];
      const isModule =
        !!loc.symbol &&
        nodes.some(
          (n) =>
            FILE_LABELS.has(n.label) &&
            (n.qn === loc.symbol || n.qn.endsWith(`.${loc.symbol}`))
        );
      if (!loc.symbol || isModule) {
        fileLevel.set(loc.file, (fileLevel.get(loc.file) ?? new Set()).add(el));
        continue;
      }
      for (const n of nodes) {
        if (
          !FILE_LABELS.has(n.label) &&
          (n.name === loc.symbol || n.qn.endsWith(`.${loc.symbol}`))
        )
          claim(el, n.qn);
      }
    }
  }
  for (const [file, els] of fileLevel) {
    if (els.size > FILE_CLAIM_MAX) continue;
    for (const n of graph.byFile.get(file) ?? []) {
      if (byNode.get(n.qn)?.some((e) => !els.has(e))) continue; // a symbol-level element has it
      for (const el of els) claim(el, n.qn);
    }
  }
  return { byNode, byElement };
}

export interface CodeContext extends FinderContext {
  graph: CodeGraph;
  claims: Claims;
}

/** S2 edge probe: extraction's own edge lookup, run over the model's elements as they stand. */
export function edgeProbe(ctx: CodeContext): Finding[] {
  const { graph, claims, catalog, idx } = ctx;
  const mappings = new Map(
    catalog.edgeMappings
      .filter((m) => m.usage === "verification_and_mapping")
      .map((m) => [m.cbm_edge, m])
  );
  const out = new Map<string, Finding>();
  for (const e of graph.edges) {
    const m = mappings.get(e.type);
    if (!m) continue;
    for (const a of claims.byNode.get(e.from) ?? []) {
      for (const b of claims.byNode.get(e.to) ?? []) {
        if (a === b) continue;
        const r = relationshipFor(m, a.type, b.type, (id) =>
          catalog.byId.has(id)
        );
        if (!r) continue;
        const [source, target] = r.inverted ? [b, a] : [a, b];
        const key = relKey({
          source: source.id,
          predicate: r.predicate,
          target: target.id
        });
        if (idx.relKeys.has(key) || out.has(key)) continue;
        out.set(key, {
          finder: "edge-probe",
          level: "relationship",
          key,
          source: source.id,
          predicate: r.predicate,
          target: target.id,
          evidence: `${e.type} ${graph.nodes.get(e.from)?.name} -> ${graph.nodes.get(e.to)?.name}`
        });
      }
    }
  }
  return [...out.values()];
}

/** S2 path probe: two unrelated elements joined in code through nodes that are not elements. */
export function pathProbe(ctx: CodeContext): Finding[] {
  const { graph, claims, catalog, idx, model } = ctx;
  const out = new Map<string, Finding>();
  for (const [elementId, starts] of claims.byElement) {
    const from = model.elements.get(elementId);
    if (!from) continue;
    const seen = new Set(starts);
    let frontier = starts.map((qn) => ({
      qn,
      path: [graph.nodes.get(qn)?.name ?? qn]
    }));
    for (let depth = 1; depth <= PATH_MAX_DEPTH && frontier.length; depth++) {
      const next: typeof frontier = [];
      for (const at of frontier) {
        const edges = (graph.out.get(at.qn) ?? []).filter((e) =>
          WALK.has(e.type)
        );
        if (edges.length > PATH_MAX_FANOUT) continue;
        for (const e of edges) {
          if (seen.has(e.to)) continue;
          seen.add(e.to);
          const path = [...at.path, graph.nodes.get(e.to)?.name ?? e.to];
          const owners = claims.byNode.get(e.to);
          if (!owners) {
            next.push({ qn: e.to, path });
            continue;
          }
          if (depth < 2) continue; // a direct edge is the edge probe's
          for (const to of owners) {
            const key = unorderedKey(from.id, to.id);
            if (to === from || out.has(key) || idx.linked.has(key)) continue;
            const candidates = triplesBetween(catalog, from.type, to.type).map(
              (t) => t.id
            );
            if (!candidates.length) continue;
            out.set(key, {
              finder: "path-probe",
              level: "link",
              key,
              ends: [from.id, to.id],
              candidates,
              evidence: path.join(" -> ")
            });
          }
        }
      }
      frontier = next;
    }
  }
  return [...out.values()];
}

function ranked(
  finder: string,
  scores: Array<{ node: CodeNode; score: number; evidence: string }>
): Finding[] {
  return scores
    .sort((a, b) => b.score - a.score || a.node.qn.localeCompare(b.node.qn))
    .slice(0, RANKED_TOP)
    .map((s, i) => ({
      finder,
      level: "element",
      key: s.node.qn,
      nodes: [s.node.qn],
      file: s.node.file,
      rank: i + 1,
      evidence: s.evidence
    }));
}

/** S2 frontier probe: unmodelled code next to the most modelled elements. */
export function frontierProbe(ctx: CodeContext): Finding[] {
  const { graph, claims } = ctx;
  const scores: Array<{ node: CodeNode; score: number; evidence: string }> = [];
  for (const node of graph.nodes.values()) {
    if (claims.byNode.has(node.qn) || NOT_CANDIDATES.has(node.label)) continue;
    const neighbours = new Set<string>();
    for (const e of graph.out.get(node.qn) ?? [])
      for (const el of claims.byNode.get(e.to) ?? []) neighbours.add(el.id);
    for (const e of graph.in.get(node.qn) ?? [])
      for (const el of claims.byNode.get(e.from) ?? []) neighbours.add(el.id);
    if (neighbours.size >= 2)
      scores.push({
        node,
        score: neighbours.size,
        evidence: `${node.label} ${node.name}: edges to ${neighbours.size} modelled elements`
      });
  }
  return ranked("frontier-probe", scores);
}

/** S6: unmodelled code ranked by how much of the code depends on it. */
export function residual(ctx: CodeContext): Finding[] {
  const { graph, claims } = ctx;
  const scores: Array<{ node: CodeNode; score: number; evidence: string }> = [];
  for (const node of graph.nodes.values()) {
    if (claims.byNode.has(node.qn) || NOT_CANDIDATES.has(node.label)) continue;
    const callers = new Set(
      (graph.in.get(node.qn) ?? [])
        .filter((e) => WALK.has(e.type))
        .map((e) => e.from)
    ).size;
    if (callers >= 2)
      scores.push({
        node,
        score: callers,
        evidence: `${node.label} ${node.name}: ${callers} dependants`
      });
  }
  return ranked("residual", scores);
}

export const CODE_FINDERS: Record<string, (ctx: CodeContext) => Finding[]> = {
  "edge-probe": edgeProbe,
  "path-probe": pathProbe,
  "frontier-probe": frontierProbe,
  residual
};

/** How much of a model the index can see. */
export function coverage(model: Model, graph: CodeGraph, claims: Claims) {
  const located = [...model.elements.values()].filter(
    (e) => e.locations.length > 0
  );
  return {
    project: graph.project,
    nodes: graph.nodes.size,
    edges: graph.edges.length,
    elementsLocated: located.length,
    elementsWithIndexedFile: located.filter((e) =>
      e.locations.some((l) => graph.byFile.has(l.file))
    ).length,
    elementsClaimingNodes: claims.byElement.size
  };
}

export type { Finder };
