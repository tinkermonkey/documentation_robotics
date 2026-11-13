/**
 * Architecture clusters as card evidence (src/analyzers/cards/clusters.ts): polling CBM's
 * get_architecture through `pending`, indexing system_structure, the evidence a card gets, the
 * component proposals, the Louvain communities, and extraction with and without clusters.
 * Every CBM answer is mocked.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  ArchitectureRequest,
  MAX_PROPOSALS,
  clusterEvidence,
  componentProposals,
  louvainCommunities,
  parseSystemStructure,
} from "@/analyzers/cards/clusters";
import { collectExtraction, extractionConfigFrom } from "@/analyzers/cards/extract";
import { cbmCardGraph } from "@/analyzers/cards/graph";
import type { CardGraph, GraphNode } from "@/analyzers/cards/types";
import { CbmToolError, type CbmTools } from "@/analyzers/cbm-responses";
import { tier0RulesFrom } from "@/analyzers/tier0-rules";
import type { AnalyzerHeuristic } from "@/analyzers/types";

const P = "proj";
const SERVICE_FILE = "src/owner/OwnerService.java";
const REPO_FILE = "src/owner/OwnerRepository.java";
const HELPERS_FILE = "src/util/Helpers.java";
const SERVICE = `${P}.src.owner.OwnerService.OwnerService`;
const FIND = `${SERVICE}.findOwner`;
const REPO = `${P}.src.owner.OwnerRepository.OwnerRepository`;
const HELPERS = `${P}.src.util.Helpers.Helpers`;
const FORMAT = `${HELPERS}.format`;

/** A fake clock and sleep: sleeping advances the clock. */
function clock(start = 1_000) {
  const t = { now: start, slept: [] as number[] };
  return {
    t,
    now: () => t.now,
    sleep: async (ms: number) => {
      t.slept.push(ms);
      t.now += ms;
    },
  };
}

/** A get_architecture that answers `pending` this many times, then the result; records each call's arguments. */
function pendingThen(result: unknown, pendings: number, retryAfter = 500) {
  const calls: Array<Record<string, unknown>> = [];
  let n = 0;
  return {
    calls,
    call: async (args: Record<string, unknown>) => {
      calls.push(args);
      return n++ < pendings ? { status: "pending", generation: "gen-1", retry_after_ms: retryAfter } : { status: "ready", generation: "gen-1", result };
    },
  };
}

/** A system_structure result: a two-file community, a single-file module, a test community and a file split between two. */
function structureResult() {
  const node = (qualified_name: string, component_id: string, file_path: string) => ({ id: 1, name: qualified_name.split(".").pop(), qualified_name, label: "Method", file_path, component_id });
  return {
    schema_version: 1,
    components: [
      { id: "component-1", label: "OwnerService", basis: "interaction_community", member_count: 12, file_count: 2, role: "non_test", representatives: [node(SERVICE, "component-1", SERVICE_FILE)], omitted_members: 11 },
      { id: "component-2", label: "Helpers", basis: "declared_module", member_count: 3, file_count: 1, role: "non_test", representatives: [node(HELPERS, "component-2", HELPERS_FILE)], omitted_members: 2 },
      { id: "component-3", label: "OwnerTests", basis: "interaction_community", member_count: 30, file_count: 3, role: "test", representatives: [node(`${P}.src.test.OwnerTests`, "component-3", "src/test/OwnerTests.java")], omitted_members: 29 },
      { id: "component-4", label: "Shared", basis: "interaction_community", member_count: 6, file_count: 2, role: "non_test", representatives: [node(`${P}.src.shared.A`, "component-4", "src/shared/A.java")], omitted_members: 5 },
    ],
    dependencies: [
      {
        source: "component-1",
        target: "component-1",
        type: "CALLS",
        count: 1,
        witnesses: [{ edge_id: 9, source: node(FIND, "component-1", SERVICE_FILE), target: node(`${REPO}.findById`, "component-1", REPO_FILE) }],
      },
    ],
    // src/shared/B.java has nodes in two components: its file alone places nothing.
    entrypoints: [node(`${P}.src.shared.B.x`, "component-4", "src/shared/B.java")],
    paths: [{ entrypoint_id: 1, nodes: [node(`${P}.src.shared.B.y`, "component-1", "src/shared/B.java")] }],
    totals: { components: 40 },
  };
}

describe("ArchitectureRequest", () => {
  it("polls through pending with the generation CBM gave, at CBM's pace, until ready", async () => {
    const c = clock();
    const cbm = pendingThen({ components: [] }, 2, 700);
    const outcome = await new ArchitectureRequest(cbm.call, "system_structure", { now: c.now, sleep: c.sleep, maxWaitMs: 10_000 }).result();
    expect(outcome.status).toBe("ready");
    expect(outcome.polls).toBe(3);
    expect(c.t.slept).toEqual([700, 700]);
    expect(cbm.calls[0]).toEqual({ aspects: ["system_structure"] });
    expect(cbm.calls[1]).toEqual({ aspects: ["system_structure"], expected_generation: "gen-1" });
    expect((outcome as any).result).toEqual({ components: [] });
  });

  it("clamps CBM's retry_after_ms between polls", async () => {
    const c = clock();
    await new ArchitectureRequest(pendingThen({}, 1, 60_000).call, "system_structure", { now: c.now, sleep: c.sleep, maxWaitMs: 10_000 }).result();
    await new ArchitectureRequest(pendingThen({}, 1, 1).call, "system_structure", { now: c.now, sleep: c.sleep, maxWaitMs: 10_000 }).result();
    expect(c.t.slept).toEqual([2_000, 100]);
  });

  it("gives up as pending when the wait runs out, without sleeping past it", async () => {
    const c = clock();
    const cbm = pendingThen({}, Infinity, 500);
    const outcome = await new ArchitectureRequest(cbm.call, "system_structure", { now: c.now, sleep: c.sleep, maxWaitMs: 1_200 }).result();
    expect(outcome.status).toBe("pending");
    expect((outcome as any).reason).toContain("still computing");
    expect(c.t.slept).toEqual([500, 500]);
    expect(outcome.waitedMs).toBeLessThanOrEqual(1_200);
  });

  it("never waits past the deadline, whatever maxWaitMs says", async () => {
    const c = clock(1_000);
    const outcome = await new ArchitectureRequest(pendingThen({}, Infinity).call, "system_structure", {
      now: c.now,
      sleep: c.sleep,
      maxWaitMs: 60_000,
      deadline: 1_000 + 900,
    }).result();
    expect(outcome.status).toBe("pending");
    expect(c.t.now).toBeLessThanOrEqual(1_900);
  });

  it("answers at once with maxWaitMs 0: one call, no sleep", async () => {
    const c = clock();
    const cbm = pendingThen({}, Infinity);
    const outcome = await new ArchitectureRequest(cbm.call, "system_structure", { now: c.now, sleep: c.sleep, maxWaitMs: 0 }).result();
    expect(outcome.status).toBe("pending");
    expect(cbm.calls).toHaveLength(1);
    expect(c.t.slept).toEqual([]);
  });

  it("reports an error answer or a failed call as unavailable instead of throwing", async () => {
    const unknownTool = async () => {
      throw new CbmToolError("get_architecture", "unknown tool: get_architecture");
    };
    const broken = async () => {
      throw new Error("Process exited with code 1");
    };
    const notJson = async () => "garbage";
    for (const [call, text] of [
      [unknownTool, "unknown tool"],
      [broken, "Process exited"],
      [notJson, "unexpected answer"],
    ] as const) {
      const outcome = await new ArchitectureRequest(call, "system_structure").result();
      expect(outcome.status).toBe("unavailable");
      expect((outcome as any).reason).toContain(text);
    }
  });

  it("takes an answer with no status (the clusters aspect) as the result itself", async () => {
    const raw = { project: P, clusters: { cols: [], rows: [] } };
    const outcome = await new ArchitectureRequest(async () => raw, "clusters").result();
    expect(outcome).toMatchObject({ status: "ready", result: raw, polls: 1 });
  });

  it("starts early: the first call is made by start(), and result() reuses it", async () => {
    const cbm = pendingThen({ components: [] }, 0);
    const request = new ArchitectureRequest(cbm.call, "system_structure").start();
    expect(cbm.calls).toHaveLength(1);
    expect((await request.result()).status).toBe("ready");
    expect(cbm.calls).toHaveLength(1);
  });

  it("counts the wait from result(): a pending answer from start() that is already due is asked again at once", async () => {
    const c = clock();
    const cbm = pendingThen({ components: [] }, 1, 500);
    const request = new ArchitectureRequest(cbm.call, "system_structure", { now: c.now, sleep: c.sleep, maxWaitMs: 0 }).start();
    c.t.now += 30_000; // the caller's own work, longer than any wait
    const outcome = await request.result();
    expect(outcome).toMatchObject({ status: "ready", polls: 2, waitedMs: 0 });
    expect(c.t.slept).toEqual([]);
  });

  it("doesn't wait for a call that outlasts maxWaitMs: it comes back pending", async () => {
    const started = Date.now();
    const outcome = await new ArchitectureRequest(() => new Promise(() => {}), "system_structure", { maxWaitMs: 50 }).result();
    expect(outcome.status).toBe("pending");
    expect((outcome as any).reason).toContain("had not answered");
    expect(outcome.polls).toBe(1);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("doesn't wait for a call past the deadline, whatever maxWaitMs says", async () => {
    const started = Date.now();
    const outcome = await new ArchitectureRequest(() => new Promise(() => {}), "clusters", { maxWaitMs: 60_000, deadline: started + 50 }).result();
    expect(outcome.status).toBe("pending");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("bounds a later poll the same way: a pending answer, then a call that never returns", async () => {
    let n = 0;
    const call = () => (n++ === 0 ? Promise.resolve({ status: "pending", generation: "g", retry_after_ms: 100 }) : new Promise(() => {}));
    const started = Date.now();
    const outcome = await new ArchitectureRequest(call, "system_structure", { maxWaitMs: 300 }).result();
    expect(outcome).toMatchObject({ status: "pending", polls: 2 });
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("system_structure evidence", () => {
  const structure = parseSystemStructure(structureResult());

  it("places every node the result names, and a file only when its nodes share one component", () => {
    expect(structure.nodeComponent.get(FIND)).toBe("component-1");
    expect(structure.nodeComponent.get(`${REPO}.findById`)).toBe("component-1");
    expect(structure.fileComponent.get(REPO_FILE)).toBe("component-1");
    expect(structure.fileComponent.has("src/shared/B.java")).toBe(false);
    expect(structure.componentFiles.get("component-1")).toEqual(new Set([SERVICE_FILE, REPO_FILE, "src/shared/B.java"]));
    expect(structure.totalComponents).toBe(40);
  });

  it("gives a card its cross-file cluster, by symbol or by file, and nothing for a single-file component", () => {
    expect(clusterEvidence(structure, FIND, SERVICE_FILE)).toEqual({
      id: "component-1",
      label: "OwnerService",
      basis: "interaction_community",
      members: 12,
      files: 2,
      via: "symbol",
    });
    expect(clusterEvidence(structure, REPO, REPO_FILE)).toMatchObject({ id: "component-1", via: "file" });
    expect(clusterEvidence(structure, FORMAT, HELPERS_FILE)).toBeNull();
    expect(clusterEvidence(structure, `${P}.src.shared.B.z`, "src/shared/B.java")).toBeNull();
    expect(clusterEvidence(structure, `${P}.nowhere`, null)).toBeNull();
  });

  it("proposes multi-file communities outside tests that hold a card, largest first, bounded", () => {
    const cards = new Map([
      ["component-1", ["src.owner.OwnerService.OwnerService", "src.owner.OwnerRepository.OwnerRepository"]],
      ["component-3", ["src.test.OwnerTests"]],
      ["component-4", ["src.shared.A"]],
    ]);
    const proposals = componentProposals(structure, cards);
    expect(proposals.total).toBe(2);
    expect(proposals.items.map((p) => p.cluster)).toEqual(["component-1", "component-4"]);
    expect(proposals.items[0]).toEqual({
      cluster: "component-1",
      label: "OwnerService",
      members: 12,
      files: 2,
      knownFiles: [REPO_FILE, SERVICE_FILE, "src/shared/B.java"].sort(),
      symbols: ["src.owner.OwnerService.OwnerService", "src.owner.OwnerRepository.OwnerRepository"],
      cards: 2,
    });
    // No card of this run in it: not proposed.
    expect(componentProposals(structure, new Map()).total).toBe(0);
  });

  it("caps the proposals and their lists", () => {
    const many = parseSystemStructure({
      components: Array.from({ length: 30 }, (_, i) => ({
        id: `component-${i}`,
        label: `C${i}`,
        basis: "interaction_community",
        member_count: 10 + i,
        file_count: 3,
        role: "non_test",
        representatives: [],
      })),
    });
    const cards = new Map(Array.from({ length: 30 }, (_, i) => [`component-${i}`, Array.from({ length: 9 }, (_, j) => `s${j}`)]));
    const proposals = componentProposals(many, cards);
    expect(proposals.total).toBe(30);
    expect(proposals.items).toHaveLength(MAX_PROPOSALS);
    expect(proposals.items[0].label).toBe("C29");
    expect(proposals.items[0].symbols).toHaveLength(5);
    expect(proposals.items[0].cards).toBe(9);
  });

  it("reads the Louvain communities, largest first, top symbols by name", () => {
    const communities = louvainCommunities({
      clusters: {
        cols: ["id", "label", "members", "cohesion", "top_nodes", "packages", "edge_types"],
        rows: [
          [72, "src", 27, 0.6091954, ["george", "Owner", "setId", "findByLastName", "setLastName", "extra"], ["src"], ["CALLS"]],
          [84, "src", 40, 0.645, ["findAll"], ["src"], ["CALLS"]],
        ],
      },
    });
    expect(communities).toEqual([
      { id: 84, label: "src", members: 40, cohesion: 0.65, top: ["findAll"] },
      { id: 72, label: "src", members: 27, cohesion: 0.61, top: ["george", "Owner", "setId", "findByLastName", "setLastName"] },
    ]);
    expect(louvainCommunities({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Extraction with clusters
// ---------------------------------------------------------------------------

const CBM = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../spec/dist/analyzers/cbm.json"), "utf-8"));
const CONFIG = extractionConfigFrom(
  tier0RulesFrom(CBM.heuristics.heuristics as AnalyzerHeuristic[]),
  Object.values(CBM.edges_by_type),
  Object.values(CBM.nodes_by_label)
);

const NODES: Array<GraphNode & { source: string }> = [
  { label: "Class", name: "OwnerService", qualified_name: SERVICE, file_path: SERVICE_FILE, start_line: 1, end_line: 30, source: "public class OwnerService {\n}" },
  { label: "Method", name: "findOwner", qualified_name: FIND, file_path: SERVICE_FILE, parent_class: SERVICE, start_line: 5, end_line: 9, source: "Owner findOwner(int id) {\n}" },
  { label: "Interface", name: "OwnerRepository", qualified_name: REPO, file_path: REPO_FILE, start_line: 1, end_line: 10, source: "public interface OwnerRepository extends Repository<Owner, Integer> {\n}" },
  { label: "Class", name: "Helpers", qualified_name: HELPERS, file_path: HELPERS_FILE, start_line: 1, end_line: 20, source: "public class Helpers {\n}" },
  { label: "Method", name: "format", qualified_name: FORMAT, file_path: HELPERS_FILE, parent_class: HELPERS, start_line: 4, end_line: 8, source: "static String format(String s) {\n}" },
];

function graph(architecture?: CardGraph["architecture"]): CardGraph {
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
    ...(architecture ? { architecture } : {}),
  };
}

const LOUVAIN = {
  project: P,
  clusters: { cols: ["id", "label", "members", "cohesion", "top_nodes"], rows: [[7, "src", 9, 0.5, ["findOwner", "format"]]] },
};

/** CBM's get_architecture: system_structure pending `pendings` times, then ready; clusters at once. */
function cbmArchitecture(pendings: number) {
  const structure = pendingThen(structureResult(), pendings, 100);
  const aspects: string[][] = [];
  return {
    aspects,
    call: async (args: Record<string, unknown>) => {
      aspects.push(args.aspects as string[]);
      return (args.aspects as string[])[0] === "clusters" ? LOUVAIN : structure.call(args);
    },
  };
}

const outcomes = (symbols: Array<{ qualifiedName: string; tier0: unknown }>) => symbols.map((s) => [s.qualifiedName, s.tier0]);

describe("collectExtraction with clusters", () => {
  it("leaves clusters out unless asked: no get_architecture call, no evidence, no report", async () => {
    const cbm = cbmArchitecture(0);
    const extraction = await collectExtraction(graph(cbm.call), CONFIG, "cbm", {});
    expect(cbm.aspects).toEqual([]);
    expect(extraction.clusters).toBeUndefined();
    expect(extraction.symbols.some((s) => s.cluster)).toBe(false);
  });

  it("attaches each card's cross-file cluster and proposes the community, without changing any Tier-0 outcome", async () => {
    const plain = await collectExtraction(graph(), CONFIG, "cbm", {});
    const cbm = cbmArchitecture(2);
    const extraction = await collectExtraction(graph(cbm.call), CONFIG, "cbm", { clusters: { maxWaitMs: 5_000 } });

    expect(outcomes(extraction.symbols)).toEqual(outcomes(plain.symbols));
    expect(extraction.summary).toEqual(plain.summary);
    expect(cbm.aspects[0]).toEqual(["system_structure"]);
    expect(cbm.aspects).toContainEqual(["clusters"]);

    const cluster = Object.fromEntries(extraction.symbols.map((s) => [s.qualifiedName, s.cluster?.id ?? null]));
    expect(cluster).toEqual({ [SERVICE]: "component-1", [FIND]: "component-1", [REPO]: "component-1", [HELPERS]: null, [FORMAT]: null });

    const report = extraction.clusters!;
    expect(report.status).toBe("ready");
    expect(report.components).toBe(40);
    expect(report.cardsWithCluster).toBe(3);
    expect(report.proposals!.total).toBe(1);
    expect(report.proposals!.items[0]).toMatchObject({ cluster: "component-1", label: "OwnerService", cards: 3 });
    expect(report.communities).toEqual([{ id: 7, label: "src", members: 9, cohesion: 0.5, top: ["findOwner", "format"] }]);
  });

  it("goes on without evidence when system_structure is still pending at the end of the wait", async () => {
    const cbm = cbmArchitecture(Infinity);
    const extraction = await collectExtraction(graph(cbm.call), CONFIG, "cbm", { clusters: { maxWaitMs: 0 } });
    expect(extraction.clusters).toMatchObject({ status: "pending" });
    expect(extraction.clusters!.reason).toContain("still computing");
    expect(extraction.clusters!.proposals).toBeUndefined();
    expect(extraction.symbols.some((s) => s.cluster)).toBe(false);
    expect(extraction.summary.cards).toBe(5);
  });

  it("goes on without evidence when the analyzer can't answer", async () => {
    const failing = await collectExtraction(
      graph(async () => {
        throw new CbmToolError("get_architecture", "unknown tool");
      }),
      CONFIG,
      "cbm",
      { clusters: true }
    );
    expect(failing.clusters).toMatchObject({ status: "unavailable" });
    const none = await collectExtraction(graph(), CONFIG, "cbm", { clusters: true });
    expect(none.clusters).toMatchObject({ status: "unavailable" });
    expect(none.summary.cards).toBe(5);
  });

  it("goes on without evidence when a system_structure call never returns", async () => {
    const started = Date.now();
    const extraction = await collectExtraction(graph(() => new Promise(() => {})), CONFIG, "cbm", { clusters: { maxWaitMs: 100 } });
    expect(extraction.clusters).toMatchObject({ status: "pending" });
    expect(extraction.summary.cards).toBe(5);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("stops waiting for a slow Louvain call at the run's budget and keeps the evidence", async () => {
    const cbm = cbmArchitecture(0);
    const slowLouvain = (args: Record<string, unknown>) =>
      (args.aspects as string[])[0] === "clusters" ? new Promise<unknown>(() => {}) : cbm.call(args);
    const started = Date.now();
    // 15 s of the budget is kept for planning and staging; the cluster calls get the rest (2.3 s).
    const extraction = await collectExtraction(graph(slowLouvain), CONFIG, "cbm", { clusters: true, deadline: started + 15_000 + 2_300 });
    expect(Date.now() - started).toBeLessThan(5_000);
    const report = extraction.clusters!;
    expect(report.status).toBe("ready");
    expect(report.cardsWithCluster).toBe(3);
    expect(report.communities).toBeUndefined();
    expect(report.communitiesMissing).toMatchObject({ status: "pending" });
  });

  it("skips the Louvain call when too little of the run's budget is left", async () => {
    const cbm = cbmArchitecture(0);
    const extraction = await collectExtraction(graph(cbm.call), CONFIG, "cbm", { clusters: true, deadline: Date.now() + 15_000 + 500 });
    expect(cbm.aspects).not.toContainEqual(["clusters"]);
    expect(extraction.clusters!.status).toBe("ready");
    expect(extraction.clusters!.communitiesMissing).toMatchObject({ status: "unavailable" });
    expect(extraction.clusters!.communitiesMissing!.reason).toContain("not asked");
  });
});

describe("cbmCardGraph.architecture", () => {
  it("calls get_architecture on the project with the aspects asked for", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const tools = {
      call: async (tool: string, args: Record<string, unknown>) => {
        calls.push([tool, args]);
        return { status: "pending", generation: "g", retry_after_ms: 500 };
      },
    } as unknown as CbmTools;
    await cbmCardGraph(tools, P).architecture!({ aspects: ["system_structure"], expected_generation: "g" });
    expect(calls).toEqual([["get_architecture", { project: P, aspects: ["system_structure"], expected_generation: "g" }]]);
  });
});
