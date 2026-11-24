/**
 * `changeset.commit.progress` (issue 1361): while POST /api/.../changesets/:id/commit runs, the
 * committing checkout's subscribers hear how far it has got, ending with applied == total (or
 * failed: true), and the commit's response is unchanged. Reports another commit in this process
 * publishes (MCP, DrBot) reach the checkout they name and no other.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { runDr } from "../helpers/cli-runner.js";
import { Model } from "../../src/core/model.js";
import { StagingAreaManager } from "../../src/core/staging-area.js";
import { publishCommitProgress } from "../../src/core/commit-progress.js";
import { startTestFarmServer, type TestFarmServer } from "../helpers/test-farm-server.js";
import { createFakeWs } from "../unit/server/helpers.js";

const add = (name: string, operationId: string) => [
  "add",
  "api",
  "operation",
  name,
  "--attributes",
  JSON.stringify({ operationId, summary: name, tags: "progress" }),
];

describe("changeset.commit.progress", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let server: TestFarmServer | undefined;

  beforeEach(async () => {
    const workdir = await createTestWorkdir();
    dir = workdir.path;
    cleanup = workdir.cleanup;
  });

  afterEach(async () => {
    await server?.stop();
    server = undefined;
    await cleanup().catch(() => {});
  });

  async function serverWithClient() {
    server = await startTestFarmServer(dir);
    const ws = createFakeWs();
    (await server.context()).subscribers.add(ws as any);
    return { server, ws };
  }

  const progressOf = (ws: ReturnType<typeof createFakeWs>) =>
    ws.sent.filter((m) => m.type === "changeset.commit.progress");

  /** A changeset with `count` staged adds, through the CLI; returns its id. */
  async function stageAdds(count: number): Promise<string> {
    expect((await runDr(["changeset", "create", "progress-test"], { cwd: dir })).exitCode).toBe(0);
    for (let i = 0; i < count; i++) {
      expect((await runDr(add(`Progress Operation ${i}`, `progressOperation${i}`), { cwd: dir })).exitCode).toBe(0);
    }
    const model = await Model.load(dir, { lazyLoad: true });
    const id = await new StagingAreaManager(dir, model).getActiveId();
    expect(id).toBeTruthy();
    return id!;
  }

  it("reports a REST commit from validating to done, applied == total, before the response", async () => {
    const id = await stageAdds(3);
    const { server, ws } = await serverWithClient();

    const res = await server.request(`/changesets/${id}/commit`, { method: "POST" });

    // The response is the one it always was.
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, status: "committed", committed: 3, failed: 0 });

    const progress = progressOf(ws);
    expect(progress[0]).toMatchObject({ changesetId: id, applied: 0, total: 3, phase: "validating" });
    expect(progress.at(-1)).toMatchObject({ changesetId: id, applied: 3, total: 3, phase: "done" });
    expect(progress.some((p) => p.failed)).toBe(false);
    // Each phase in order, each once at least.
    const phases = [...new Set(progress.map((p) => p.phase))];
    expect(phases).toEqual(["validating", "applying", "saving", "reloading", "done"]);
    expect(progress.find((p) => p.phase === "applying")?.layer).toBe("api");
    // Stamped like every broadcast, so a viewer on another checkout ignores it.
    for (const p of progress) {
      expect(p.project).toBe(server.project);
      expect(p.checkout).toBe(server.checkout);
      expect(typeof p.timestamp).toBe("string");
    }
    // The existing broadcasts still go out, before the final report.
    const types = ws.sent.map((m) => m.type);
    expect(types).toContain("model.updated");
    expect(types.lastIndexOf("changesets.updated")).toBeLessThan(
      ws.sent.findIndex((m) => m.type === "changeset.commit.progress" && m.phase === "done")
    );
  });

  it("ends a failed commit with failed: true in the phase it stopped in", async () => {
    const id = await stageAdds(1);
    const { server, ws } = await serverWithClient();
    const backup = spyOn(StagingAreaManager.prototype as any, "backupModel").mockImplementation(async () => {
      throw new Error("disk full");
    });
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await server.request(`/changesets/${id}/commit`, { method: "POST" });
      expect(res.status).toBeGreaterThanOrEqual(400);
    } finally {
      backup.mockRestore();
      logged.mockRestore();
    }

    const last = progressOf(ws).at(-1);
    expect(last).toMatchObject({ changesetId: id, total: 1, applied: 0, phase: "validating", failed: true });
    expect(progressOf(ws).some((p) => p.phase === "done")).toBe(false);
  });

  it("sends a commit's reports published in this process to the checkout they name only", async () => {
    const { server, ws } = await serverWithClient();
    const root = (await server.context()).rootPath;

    publishCommitProgress({ rootPath: "/some/other/checkout", changesetId: "x", applied: 0, total: 1, phase: "validating" });
    publishCommitProgress({ rootPath: root, changesetId: "mine", applied: 1, total: 1, phase: "done" });
    // broadcastMessage is async (it records telemetry first).
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(progressOf(ws).map((p) => p.changesetId)).toEqual(["mine"]);
    expect(progressOf(ws)[0].rootPath).toBeUndefined();
  });

  it("stops listening when the server stops", async () => {
    const { server: running, ws } = await serverWithClient();
    const root = (await running.context()).rootPath;
    await running.stop();
    server = undefined;
    ws.sent.length = 0;

    publishCommitProgress({ rootPath: root, changesetId: "late", applied: 0, total: 1, phase: "validating" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(progressOf(ws)).toHaveLength(0);
  });
});
