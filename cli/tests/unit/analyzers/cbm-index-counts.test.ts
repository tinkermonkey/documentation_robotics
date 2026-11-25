/**
 * settleIndexCounts (#1345): an index_repository answer without counts used to be recorded as 0
 * nodes and 0 edges, and every codebase tool then read that empty index as fresh. Now the counts
 * come from the answer, or from index_status once another process's run of the same code is over,
 * and anything else fails the run.
 */

import { describe, expect, it } from "bun:test";
import { settleIndexCounts, type IndexCountTools } from "../../../src/analyzers/cbm-analyzer.js";

const ROOT = "/work/app";

/** Fake CBM tools: index_status answers in turn from `statuses` (the last one repeats). */
function tools(statuses: Array<Record<string, unknown> | Error>, projects = [{ name: "work-app", root_path: ROOT }]) {
  const asked: string[] = [];
  let turn = 0;
  const fake: IndexCountTools = {
    listProjects: async () => projects,
    indexStatus: async (project) => {
      asked.push(project);
      const answer = statuses[Math.min(turn++, statuses.length - 1)];
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { fake, asked };
}

const noSleep = async () => undefined;

describe("settleIndexCounts", () => {
  it("takes the counts from an indexed answer, asking nothing more", async () => {
    const { fake, asked } = tools([]);
    const counts = await settleIndexCounts(fake, { project: "work-app", status: "indexed", nodes: 9671, edges: 35488 }, ROOT);
    expect(counts).toEqual({ nodes: 9671, edges: 35488 });
    expect(asked).toEqual([]);
  });

  it("waits for another process's run through index_status, then reads its counts", async () => {
    const { fake, asked } = tools([{ status: "indexing" }, { status: "indexing" }, { status: "ready", nodes: 8, edges: 9 }]);
    // CBM's answer while a run of the same code is in flight carries no counts and no project.
    const counts = await settleIndexCounts(fake, { status: "indexing", slot: 1, path: ROOT }, ROOT, { sleep: noSleep });
    expect(counts).toEqual({ nodes: 8, edges: 9 });
    // The project came from list_projects, by root path.
    expect(asked).toEqual(["work-app", "work-app", "work-app"]);
  });

  it("fails, saying another run is indexing, when that run doesn't finish in time", async () => {
    const { fake } = tools([{ status: "indexing" }]);
    const run = settleIndexCounts(fake, { status: "busy", project: "work-app" }, ROOT, { timeoutMs: 0, sleep: noSleep });
    await expect(run).rejects.toThrow("Another codebase-memory-mcp run is indexing this code");
    await expect(run).rejects.toThrow("this run recorded no index");
  });

  it("fails when codebase-memory-mcp says the index failed, with its reason", async () => {
    const { fake } = tools([]);
    await expect(settleIndexCounts(fake, { status: "failed", error: "Analysis worker unavailable." }, ROOT)).rejects.toThrow(
      "could not index the code: Analysis worker unavailable."
    );
    const later = tools([{ status: "failed", error: "Persistent index required." }]);
    await expect(settleIndexCounts(later.fake, { status: "pending", project: "work-app" }, ROOT, { sleep: noSleep })).rejects.toThrow(
      "Persistent index required."
    );
  });

  it("fails on an index of 0 nodes instead of recording it (#1345)", async () => {
    const { fake } = tools([]);
    const run = settleIndexCounts(fake, { project: "work-app", status: "indexed", nodes: 0, edges: 0 }, ROOT);
    await expect(run).rejects.toThrow("indexed no code at /work/app (0 nodes, 0 edges)");
  });

  it("fails when the counts stay unreadable, naming what CBM answered but not its whole text", async () => {
    const { fake } = tools([{ status: "ready", nodes: "many" }], []);
    const error = await settleIndexCounts(fake, { status: "done", nodes: "n/a", project: "work-app" }, ROOT, { sleep: noSleep }).catch((e) => e);
    expect(error.message).toContain("did not say what it indexed");
    expect(error.message).toContain("status ready");
    expect(error.message).toContain("nothing reads as fresh");

    // No project in the answer and none at this root: nothing to ask, the same error.
    const none = tools([], [{ name: "other", root_path: "/elsewhere" }]);
    await expect(settleIndexCounts(none.fake, { status: "indexing" }, ROOT, { sleep: noSleep })).rejects.toThrow("Another codebase-memory-mcp run");
    expect(none.asked).toEqual([]);
  });

  it("keeps waiting through an index_status call that errors", async () => {
    const { fake } = tools([new Error("socket closed"), { status: "ready", nodes: 3, edges: 2 }]);
    expect(await settleIndexCounts(fake, { status: "indexing", project: "work-app" }, ROOT, { sleep: noSleep })).toEqual({ nodes: 3, edges: 2 });
  });
});
