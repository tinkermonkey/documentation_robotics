/**
 * The changeset review API: GET detail/list review fields and delete blockers, PUT
 * /api/changesets/:id/review, and POST .../commit with `drop` / `deleteBlockedLinks`. Runs the
 * server's Hono app in-process against a copy of the golden model; changes are staged through the
 * real CLI (and, for a delete without its relationship deletes, through StagingAreaManager).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { runDr } from "../helpers/cli-runner.js";
import { Model } from "../../src/core/model.js";
import { StagingAreaManager } from "../../src/core/staging-area.js";
import { VisualizationServer } from "../../src/server/server.js";
import { createFakeWs } from "../unit/server/helpers.js";

const TEMP = "application.applicationcomponent.temp-comp";
const OTHER = "application.applicationcomponent.other-comp";
const NEW = "application.applicationcomponent.new-comp";
const OTHER_NEW = "application.applicationcomponent.second-comp";
const LINK = `${TEMP}::uses::${OTHER}`;

describe("changeset review API", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let server: VisualizationServer | undefined;

  beforeEach(async () => {
    const workdir = await createTestWorkdir();
    dir = workdir.path;
    cleanup = workdir.cleanup;
  });

  afterEach(async () => {
    server?.stop();
    server = undefined;
    await cleanup().catch(() => {});
  });

  async function dr(args: string[]): Promise<void> {
    const result = await runDr(args, { cwd: dir });
    expect(result.exitCode).toBe(0);
  }

  const component = (name: string) => [
    "add", "application", "component", name, "--description", "x", "--attributes", '{"type":"internal"}',
  ];

  /**
   * Base: TEMP uses OTHER. Changeset (made with `dr changeset create`, so origin cli):
   *   0 add NEW, 1 NEW uses OTHER, 2 delete TEMP (no relationship delete: TEMP uses OTHER blocks it).
   */
  async function seed(): Promise<string> {
    await dr(component("Temp Comp"));
    await dr(component("Other Comp"));
    await dr(["relationship", "add", TEMP, OTHER, "--predicate", "uses"]);
    await dr(["changeset", "create", "review-test"]);
    await dr(component("New Comp"));
    await dr(["relationship", "add", NEW, OTHER, "--predicate", "uses"]);
    const model = await Model.load(dir, { lazyLoad: false });
    const manager = new StagingAreaManager(dir, model);
    const id = (await manager.getActiveId())!;
    const temp = (await model.getBaseLayer("application"))!.getElement(TEMP)!;
    await manager.stage(id, {
      type: "delete",
      elementId: TEMP,
      layerName: "application",
      before: temp.toJSON() as unknown as Record<string, unknown>,
    });
    return id;
  }

  async function app() {
    const model = await Model.load(dir, { lazyLoad: false });
    server = new VisualizationServer(model, { authEnabled: false });
    const ws = createFakeWs();
    (server as any).clients.add(ws);
    const request = (path: string, init?: RequestInit) => (server as any).app.request(path, init) as Promise<Response>;
    const json = (method: string, body: unknown): RequestInit => ({
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { request, json, ws };
  }

  async function baseRows(): Promise<Array<{ source: string; target: string; predicate: string }>> {
    const content = await readFile(join(dir, "documentation-robotics", "model", "relationships.yaml"), "utf-8");
    return parseYaml(content) ?? [];
  }

  it("GET detail carries revision, origin, unstaged, review and the delete's blockers", async () => {
    const id = await seed();
    const { request } = await app();

    const detail = await (await request(`/api/changesets/${id}`)).json();

    expect(detail.revision).toBe(3);
    expect(detail.origin).toEqual({ kind: "cli" });
    expect(detail.unstaged).toEqual([]);
    expect(detail.review).toEqual({ decisions: {} });
    expect(detail.changes.map((c: any) => [c.sequenceNumber, c.type])).toEqual([
      [0, "add"],
      [1, "relationship-add"],
      [2, "delete"],
    ]);
    expect(detail.changes[0].blockers).toBeUndefined();
    expect(detail.changes[2].blockers).toEqual([
      { relationshipId: LINK, direction: "out", otherElementId: OTHER, predicate: "uses" },
    ]);

    const list = (await (await request("/api/changesets")).json()).changesets;
    expect(list[id]).toMatchObject({
      name: "review-test",
      origin: { kind: "cli" },
      revision: 3,
      review: { decided: 0, total: 3, asked: 0 },
    });
  });

  it("PUT review records, stamps and clears decisions, and broadcasts changesets.updated", async () => {
    const id = await seed();
    const { request, json, ws } = await app();

    const res = await request(
      `/api/changesets/${id}/review`,
      json("PUT", {
        decisions: [
          { sequence: 0, verdict: "keep" },
          { sequence: 2, verdict: "ask", note: "  move the link to X?  " },
        ],
      })
    );
    expect(res.status).toBe(200);
    const review = await res.json();
    expect(review.lastReviewedRevision).toBe(3);
    expect(review.decisions["0"]).toMatchObject({ verdict: "keep", atRevision: 3 });
    expect(review.decisions["0"].note).toBeUndefined();
    expect(review.decisions["2"]).toMatchObject({ verdict: "ask", note: "move the link to X?", atRevision: 3 });
    expect(typeof review.decisions["2"].decidedAt).toBe("string");
    expect(ws.sent.some((m) => m.type === "changesets.updated")).toBe(true);
    expect(existsSync(join(dir, "documentation-robotics", "changesets", id, "review.yaml"))).toBe(true);

    const list = (await (await request("/api/changesets")).json()).changesets;
    expect(list[id].review).toEqual({ decided: 2, total: 3, asked: 1 });
    expect((await (await request(`/api/changesets/${id}`)).json()).review).toEqual(review);

    const cleared = await (
      await request(`/api/changesets/${id}/review`, json("PUT", { decisions: [{ sequence: 0, verdict: null }] }))
    ).json();
    expect(Object.keys(cleared.decisions)).toEqual(["2"]);
  });

  it("a rewrite in place after the review marks the decision revised (removedAt > atRevision)", async () => {
    await dr(["changeset", "create", "rewrite-test"]);
    await dr(component("New Comp"));
    await dr(component("Second Comp"));
    await dr(["relationship", "add", NEW, OTHER_NEW, "--predicate", "uses"]);
    const model = await Model.load(dir, { lazyLoad: false });
    const id = (await new StagingAreaManager(dir, model).getActiveId())!;
    const { request, json } = await app();
    expect((await (await request(`/api/changesets/${id}`)).json()).revision).toBe(3);

    const put = await request(
      `/api/changesets/${id}/review`,
      json("PUT", { decisions: [0, 1, 2].map((sequence) => ({ sequence, verdict: "keep" })) })
    );
    const review = await put.json();
    expect(review.lastReviewedRevision).toBe(3);

    // Folds into the add of NEW (sequence 0): a rewrite in place.
    await dr(["update", NEW, "--description", "rewritten"]);

    const detail = await (await request(`/api/changesets/${id}`)).json();
    const tombstone = detail.unstaged.find((t: any) => t.sequence === 0);
    expect(tombstone).toMatchObject({ rewritten: true });
    expect(tombstone.removedAt).toBeGreaterThan(detail.review.decisions["0"].atRevision);
    expect(detail.changes.map((c: any) => c.sequenceNumber)).toEqual([0, 1, 2]);
    const list = (await (await request("/api/changesets")).json()).changesets;
    expect(list[id].review).toEqual({ decided: 2, total: 3, asked: 0 });
  });

  it("PUT review refuses unknown sequences (422), unknown changesets (404) and bad bodies (400)", async () => {
    const id = await seed();
    const { request, json } = await app();

    const unknown = await request(`/api/changesets/${id}/review`, json("PUT", { decisions: [{ sequence: 9, verdict: "drop" }] }));
    expect(unknown.status).toBe(422);
    expect((await unknown.json()).error).toContain("9");
    expect(existsSync(join(dir, "documentation-robotics", "changesets", id, "review.yaml"))).toBe(false);

    const missing = await request(`/api/changesets/changeset-missing/review`, json("PUT", { decisions: [] }));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBeDefined();

    const bad = await request(`/api/changesets/${id}/review`, json("PUT", { decisions: [{ sequence: 0, verdict: "maybe" }] }));
    expect(bad.status).toBe(400);
  });

  it("refuses a reviewed commit whose delete still has blockers, without writing anything", async () => {
    const id = await seed();
    const { request, json } = await app();

    const res = await request(`/api/changesets/${id}/commit`, json("POST", { drop: [0] }));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("deleteBlockedLinks");
    expect(body.blockers).toEqual({
      "2": [{ relationshipId: LINK, direction: "out", otherElementId: OTHER, predicate: "uses" }],
    });
    const detail = await (await request(`/api/changesets/${id}`)).json();
    expect(detail.status).toBe("staged");
    expect(detail.changes).toHaveLength(3);
    expect(detail.unstaged).toEqual([]);

    const unknown = await request(`/api/changesets/${id}/commit`, json("POST", { drop: [7], deleteBlockedLinks: [2] }));
    expect(unknown.status).toBe(422);
    expect((await unknown.json()).error).toContain("7");
  });

  it("commits the kept changes: drops cascade, blocked links go with the delete, broadcasts", async () => {
    const id = await seed();
    const { request, json, ws } = await app();

    const res = await request(`/api/changesets/${id}/commit`, json("POST", { drop: [0], deleteBlockedLinks: [2] }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id, status: "committed", dropped: [0, 1], linksDeleted: 1, committed: 1 });
    expect(ws.sent.some((m) => m.type === "changesets.updated")).toBe(true);
    expect(ws.sent.some((m) => m.type === "model.updated")).toBe(true);

    const model = await Model.load(dir, { lazyLoad: false });
    const layer = (await model.getBaseLayer("application"))!;
    expect(layer.getElement(TEMP)).toBeUndefined();
    expect(layer.getElement(NEW)).toBeUndefined();
    expect(layer.getElement(OTHER)).toBeDefined();
    expect(await baseRows()).toEqual([]);

    // The record shows what was left out: one unstage revision for both dropped changes.
    const detail = await (await request(`/api/changesets/${id}`)).json();
    expect(detail.changes.map((c: any) => c.sequenceNumber)).toEqual([2]);
    expect(detail.unstaged.map((t: any) => [t.sequence, t.removedAt, t.rewritten])).toEqual([
      [0, 3, undefined],
      [1, 3, undefined],
    ]);

    const review = await request(`/api/changesets/${id}/review`, json("PUT", { decisions: [{ sequence: 2, verdict: "keep" }] }));
    expect(review.status).toBe(409);
  });

  it("restores the dropped changes when the commit then fails validation", async () => {
    const id = await seed();
    const model = await Model.load(dir, { lazyLoad: false });
    await new StagingAreaManager(dir, model).stage(id, {
      type: "add",
      elementId: "api.operation.invalid-operation",
      layerName: "api",
      after: { type: "operation", name: "Invalid Operation", attributes: {} },
    });
    const { request, json } = await app();

    const res = await request(`/api/changesets/${id}/commit`, json("POST", { drop: [1], deleteBlockedLinks: [2] }));

    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("Validation failed");
    const detail = await (await request(`/api/changesets/${id}`)).json();
    expect(detail.status).toBe("staged");
    expect(detail.changes.map((c: any) => c.sequenceNumber)).toEqual([0, 1, 2, 3]);
    expect(detail.unstaged).toEqual([]);
    expect(await baseRows()).toHaveLength(1);
  });

  it("a commit without drop or deleteBlockedLinks is the plain commit", async () => {
    const id = await seed();
    const { request, json } = await app();

    const res = await request(`/api/changesets/${id}/commit`, json("POST", {}));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("committed");
    expect(body.dropped).toBeUndefined();
    expect(body.linksDeleted).toBeUndefined();
  });
});
