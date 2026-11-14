/**
 * `origin` on changeset changes over REST (docs/analyzers/TIER1_DESIGN.md section 7): GET
 * /api/changesets/:id returns each staged change's origin, and each unstage tombstone's, as
 * ChangesetDetailSchema documents them; changes and changesets without one still validate.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import type { ChangeOrigin } from "../../../src/core/changeset.js";
import { ChangeOriginSchema, ChangesetDetailSchema, ChangesetsListSchema } from "../../../src/server/schemas.js";
import type { VisualizationServer } from "../../../src/server/server.js";
import { createServerWithoutChatDetection } from "./helpers.js";

const TIER1: ChangeOrigin = {
  by: "tier1",
  rule: "tier1:dr-qset-2",
  provider: "cloudflare-workers-ai",
  model: "@cf/cloudflare/clef",
  p: { layer: 0.82, type: 0.71 },
  confirmed: "agent",
};
const TIER0: ChangeOrigin = { by: "tier0", rule: "node-mapping:Route" };
const SERVICE = "application.applicationservice.owner-service";
const ROUTE = "api.operation.get-owner";
const MANUAL = "application.applicationcomponent.manual-comp";
const DROPPED = "application.applicationservice.dropped-service";

let rootPath: string;
let server: VisualizationServer | undefined;

beforeEach(async () => {
  const dir = join(tmpdir(), `dr-server-origin-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  rootPath = await realpath(dir);
  await Model.init(rootPath, { name: "Origin REST Test", version: "0.1.0" });
});

afterEach(async () => {
  server?.stop();
  server = undefined;
  await rm(rootPath, { recursive: true, force: true });
});

const snapshot = (id: string) => ({ id, path: id, type: id.split(".")[1], name: id.split(".")[2] });

async function seed(): Promise<string> {
  const model = await Model.load(rootPath, { lazyLoad: false });
  const manager = new StagingAreaManager(rootPath, model);
  const changeset = await manager.create("as-built");
  const id = changeset.id!;
  await manager.stage(id, { type: "add", elementId: SERVICE, layerName: "application", after: snapshot(SERVICE), origin: TIER1 });
  await manager.stage(id, { type: "add", elementId: ROUTE, layerName: "api", after: snapshot(ROUTE), origin: TIER0 });
  await manager.stage(id, {
    type: "relationship-add",
    elementId: `${ROUTE}::realizes::${SERVICE}`,
    layerName: "api",
    after: { source: ROUTE, predicate: "realizes", target: SERVICE },
    origin: TIER0,
  });
  await manager.stage(id, { type: "add", elementId: MANUAL, layerName: "application", after: snapshot(MANUAL) });
  await manager.stage(id, { type: "add", elementId: DROPPED, layerName: "application", after: snapshot(DROPPED), origin: { by: "agent" } });
  await manager.unstage(id, DROPPED);
  return id;
}

async function app() {
  const model = await Model.load(rootPath, { lazyLoad: false });
  server = createServerWithoutChatDetection(model, { authEnabled: false });
  return (path: string) => (server as any).app.request(path) as Promise<Response>;
}

describe("origin on changeset changes over REST", () => {
  it("GET detail carries each change's origin and the tombstone's, as the schema documents", async () => {
    const id = await seed();
    const request = await app();
    const response = await request(`/api/changesets/${id}`);
    expect(response.status).toBe(200);
    const detail = await response.json();

    const byId = Object.fromEntries(detail.changes.map((c: any) => [c.elementId, c]));
    expect(byId[SERVICE].origin).toEqual(TIER1);
    expect(byId[ROUTE].origin).toEqual(TIER0);
    expect(byId[`${ROUTE}::realizes::${SERVICE}`].origin).toEqual(TIER0);
    expect(byId[MANUAL]).not.toHaveProperty("origin");
    expect(detail.unstaged.map((t: any) => [t.change.elementId, t.change.origin])).toEqual([[DROPPED, { by: "agent" }]]);

    // The documented schema keeps origin (zod would strip a field it doesn't declare).
    const parsed = ChangesetDetailSchema.parse(detail);
    expect(parsed.changes.find((c) => c.elementId === SERVICE)!.origin).toEqual(TIER1);
    expect(parsed.unstaged[0].change.origin).toEqual({ by: "agent" });

    // The list carries counts, not changes; the changeset's own origin is a different field.
    const list = ChangesetsListSchema.parse(await (await request("/api/changesets")).json());
    expect(list.changesets[id].changes_count).toBe(4);
  });

  it("a changeset without origins (older ones) still validates", () => {
    const old = {
      id: "old",
      name: "old",
      status: "staged",
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-01T00:00:00.000Z",
      stats: { additions: 1, modifications: 0, deletions: 0 },
      revision: 2,
      unstaged: [{ sequence: 0, removedAt: 1, change: { type: "add", elementId: "a.b.c", layerName: "a" } }],
      review: { decisions: {} },
      changes: [{ type: "add", elementId: "a.b.d", layerName: "a", sequenceNumber: 1, after: { id: "a.b.d" } }],
    };
    expect(ChangesetDetailSchema.safeParse(old).success).toBe(true);
  });

  it("ChangeOriginSchema accepts every shape ChangeOrigin allows and rejects an unknown decider", () => {
    for (const origin of [TIER1, TIER0, { by: "agent" }, { by: "tier1", p: { layer: 0.6, type: null } }, { by: "tier1", upstream: "deepinfra", confirmed: "auto" }]) {
      expect(ChangeOriginSchema.safeParse(origin).success).toBe(true);
    }
    expect(ChangeOriginSchema.safeParse({ by: "someone" }).success).toBe(false);
  });
});
