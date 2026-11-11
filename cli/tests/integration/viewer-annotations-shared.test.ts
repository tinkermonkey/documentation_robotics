/**
 * The viewer server and the MCP annotation tools share one annotation store, the files under
 * documentation-robotics/annotations/:
 * - a comment left in the viewer is seen by annotation_list, and survives a restart;
 * - an annotation or reply the agent makes through MCP is served by GET /api/annotations and
 *   broadcast to connected viewers;
 * - the viewer accepts a comment on an element the open changeset adds.
 *
 * Runs the server in-process against a copy of the golden model; the changeset is staged
 * through the real CLI. Starts the server on a free port so its file watcher runs.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { runDr } from "../helpers/cli-runner.js";
import { portAllocator } from "../helpers/port-allocator.js";
import { Model } from "../../src/core/model.js";
import { VisualizationServer } from "../../src/server/server.js";
import { clearModelCache } from "../../src/mcp/tools/shared.js";
import { annotationCreateHandler } from "../../src/mcp/tools/annotation-create.js";
import { annotationDeleteHandler } from "../../src/mcp/tools/annotation-delete.js";
import { annotationGetHandler } from "../../src/mcp/tools/annotation-get.js";
import { annotationListHandler } from "../../src/mcp/tools/annotation-list.js";
import { annotationReplyHandler } from "../../src/mcp/tools/annotation-reply.js";
import { annotationUpdateHandler } from "../../src/mcp/tools/annotation-update.js";
import { createFakeWs, waitFor } from "../unit/server/helpers.js";

const BASE_ELEMENT = "motivation.goal.manage-tasks";
const PLANNED_ELEMENT = "api.operation.planned-review-operation";

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

describe("viewer and MCP share annotations", () => {
  // The annotation store replaces a file by renaming a temp file over it. Under Bun on Linux,
  // fs.watch misses that rename, so the in-process server's chokidar watcher never sees the MCP
  // write and nothing is broadcast (the 0.4.0 release gate failed on it). `dr` runs under Node,
  // where chokidar sees every replace (checked in node:22 on Linux), so only this test polls.
  const pollUnderBunOnLinux = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined" && process.platform === "linux";
  const savedPolling = process.env.CHOKIDAR_USEPOLLING;
  beforeAll(() => {
    if (pollUnderBunOnLinux) process.env.CHOKIDAR_USEPOLLING = "1";
  });
  afterAll(() => {
    if (!pollUnderBunOnLinux) return;
    if (savedPolling === undefined) delete process.env.CHOKIDAR_USEPOLLING;
    else process.env.CHOKIDAR_USEPOLLING = savedPolling;
  });

  let dir: string;
  let cleanup: () => Promise<void>;
  let port: number;
  const servers: VisualizationServer[] = [];

  beforeEach(async () => {
    clearModelCache();
    const workdir = await createTestWorkdir();
    dir = workdir.path;
    cleanup = workdir.cleanup;
    port = await portAllocator.allocatePort();
  });

  afterEach(async () => {
    for (const server of servers.splice(0)) server.stop();
    portAllocator.releasePort(port);
    clearModelCache();
    await cleanup().catch(() => {});
  });

  async function startServer(): Promise<{ server: VisualizationServer; ws: ReturnType<typeof createFakeWs> }> {
    const model = await Model.load(dir, { lazyLoad: false });
    const server = new VisualizationServer(model, { authEnabled: false });
    servers.push(server);
    await server.start(port);
    const ws = createFakeWs();
    (server as any).clients.add(ws);
    return { server, ws };
  }

  function request(server: VisualizationServer, path: string, init?: RequestInit): Promise<Response> {
    return (server as any).app.request(path, init);
  }

  function post(server: VisualizationServer, path: string, body: unknown): Promise<Response> {
    return request(server, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("a comment and reply left in the viewer reach annotation_list, and survive a restart", async () => {
    const { server, ws } = await startServer();

    const created = await post(server, "/api/annotations", {
      elementId: BASE_ELEMENT,
      author: "Reviewer",
      content: "Is this goal still in scope?",
      tags: ["question"],
    });
    expect(created.status).toBe(201);
    const annotation = await created.json();
    expect(annotation).toMatchObject({ elementId: BASE_ELEMENT, author: "Reviewer", resolved: false, replies: [] });

    const replied = await post(server, `/api/annotations/${annotation.id}/replies`, {
      author: "Reviewer",
      content: "Asking because of the rescope.",
    });
    expect(replied.status).toBe(201);
    const reply = await replied.json();

    const listed = parse(await annotationListHandler({ rootPath: dir }));
    expect(listed.annotations).toHaveLength(1);
    expect(listed.annotations[0]).toMatchObject({
      id: annotation.id,
      content: "Is this goal still in scope?",
      tags: ["question"],
      replies: [{ id: reply.id, author: "Reviewer", content: "Asking because of the rescope." }],
    });

    // Broadcast once each, by the route; the watcher sees the files but nothing new in them.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(ws.sent.filter((m) => m.type === "annotation.added")).toHaveLength(1);
    expect(ws.sent.filter((m) => m.type === "annotation.reply.added")).toHaveLength(1);

    // A new server (a restart) serves the same annotation and its reply.
    server.stop();
    servers.length = 0;
    const restarted = await startServer();
    const all = await (await request(restarted.server, "/api/annotations")).json();
    expect(all.annotations.map((a: any) => a.id)).toEqual([annotation.id]);
    const replies = await (await request(restarted.server, `/api/annotations/${annotation.id}/replies`)).json();
    expect(replies.replies.map((r: any) => r.id)).toEqual([reply.id]);
  }, 30000);

  it("an annotation and reply made through MCP are served and broadcast to the viewer", async () => {
    const { server, ws } = await startServer();

    const created = parse(
      await annotationCreateHandler({
        elementId: BASE_ELEMENT,
        content: "Open gap: no owner for this goal yet.",
        author: "agent",
        tags: ["open-gap"],
        rootPath: dir,
      })
    );

    const added = await waitFor(() => ws.sent.find((m) => m.type === "annotation.added"));
    expect(added).toMatchObject({ annotationId: created.id, elementId: BASE_ELEMENT });

    const served = await (await request(server, `/api/annotations?elementId=${BASE_ELEMENT}`)).json();
    expect(served.annotations).toHaveLength(1);
    expect(served.annotations[0]).toMatchObject({ id: created.id, author: "agent", tags: ["open-gap"] });

    const reply = parse(
      await annotationReplyHandler({ annotationId: created.id, author: "agent", content: "Recorded as accepted.", rootPath: dir })
    );
    const replyAdded = await waitFor(() => ws.sent.find((m) => m.type === "annotation.reply.added"));
    expect(replyAdded).toMatchObject({ annotationId: created.id, replyId: reply.id });
    const replies = await (await request(server, `/api/annotations/${created.id}/replies`)).json();
    expect(replies.replies.map((r: any) => r.id)).toEqual([reply.id]);

    await annotationUpdateHandler({ annotationId: created.id, resolved: true, rootPath: dir });
    const updated = await waitFor(() => ws.sent.find((m) => m.type === "annotation.updated"));
    expect(updated.annotationId).toBe(created.id);
    expect((await (await request(server, `/api/annotations/${created.id}`)).json()).resolved).toBe(true);

    await annotationDeleteHandler({ annotationId: created.id, rootPath: dir });
    const deleted = await waitFor(() => ws.sent.find((m) => m.type === "annotation.deleted"));
    expect(deleted.annotationId).toBe(created.id);
    expect((await request(server, `/api/annotations/${created.id}`)).status).toBe(404);

    // Each change was broadcast once.
    for (const type of ["annotation.added", "annotation.reply.added", "annotation.updated", "annotation.deleted"]) {
      expect(ws.sent.filter((m) => m.type === type)).toHaveLength(1);
    }
  }, 30000);

  it("a viewer write inside the watcher's debounce doesn't swallow an MCP change made just before", async () => {
    const { server, ws } = await startServer();
    const created = await (
      await post(server, "/api/annotations", { elementId: BASE_ELEMENT, author: "Reviewer", content: "Why this goal?" })
    ).json();

    // The agent replies (another process), and the reviewer edits before the watcher syncs.
    const agentReply = parse(
      await annotationReplyHandler({ annotationId: created.id, author: "agent", content: "Because of X.", rootPath: dir })
    );
    const patched = await request(server, `/api/annotations/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Why this goal, given the rescope?" }),
    });
    expect(patched.status).toBe(200);

    // Then a reviewer reply races a second agent reply the same way.
    const secondAgentReply = parse(
      await annotationReplyHandler({ annotationId: created.id, author: "agent", content: "And Y.", rootPath: dir })
    );
    const reviewerReply = await (
      await post(server, `/api/annotations/${created.id}/replies`, { author: "Reviewer", content: "OK." })
    ).json();

    await new Promise((resolve) => setTimeout(resolve, 600));
    const replyIds = ws.sent.filter((m) => m.type === "annotation.reply.added").map((m) => m.replyId);
    expect(replyIds.sort()).toEqual([agentReply.id, secondAgentReply.id, reviewerReply.id].sort());
    expect(ws.sent.filter((m) => m.type === "annotation.updated")).toHaveLength(1);
    expect(ws.sent.filter((m) => m.type === "annotation.added")).toHaveLength(1);
  }, 30000);

  it("an update, reply and delete made in the viewer are what annotation_get sees", async () => {
    const { server } = await startServer();
    const created = parse(
      await annotationCreateHandler({ elementId: BASE_ELEMENT, content: "Agent note", author: "agent", rootPath: dir })
    );

    const patched = await request(server, `/api/annotations/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: true }),
    });
    expect(patched.status).toBe(200);
    expect(parse(await annotationGetHandler({ annotationId: created.id, rootPath: dir })).resolved).toBe(true);

    expect((await request(server, `/api/annotations/${created.id}`, { method: "DELETE" })).status).toBe(204);
    const gone = await annotationGetHandler({ annotationId: created.id, rootPath: dir });
    expect(gone.isError).toBe(true);
  }, 30000);

  it("accepts a comment on an element the open changeset adds, and refuses an unknown one", async () => {
    expect((await runDr(["changeset", "create", "review-plan"], { cwd: dir })).exitCode).toBe(0);
    const add = await runDr(
      [
        "add",
        "api",
        "operation",
        "Planned Review Operation",
        "--attributes",
        '{"operationId":"plannedReviewOperation","summary":"Planned","tags":"review"}',
      ],
      { cwd: dir }
    );
    expect(add.exitCode).toBe(0);

    const { server } = await startServer();
    const planned = await post(server, "/api/annotations", {
      elementId: PLANNED_ELEMENT,
      author: "Reviewer",
      content: "Should this be a batch operation?",
    });
    expect(planned.status).toBe(201);
    expect((await planned.json()).elementId).toBe(PLANNED_ELEMENT);
    const listed = parse(await annotationListHandler({ elementId: PLANNED_ELEMENT, rootPath: dir }));
    expect(listed.annotations).toHaveLength(1);

    const unknown = await post(server, "/api/annotations", {
      elementId: "api.operation.not-in-any-plan",
      author: "Reviewer",
      content: "?",
    });
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error).toBe("Element not found");
  }, 60000);
});
