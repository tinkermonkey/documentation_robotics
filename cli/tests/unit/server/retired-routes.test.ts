/**
 * Slice 4B of issue 1279: the server has one mode, and every project-data route names its
 * project and checkout. The unscoped paths are retired: for one release each answers
 * `410 Gone` with the scoped template that replaces it, for a custom viewer build
 * (`--viewer-path`) that still calls it, and none is in the OpenAPI document. The viewer's
 * deep-link paths (`/p/<project>/c/<checkout>/...`) load its page.
 * (`testing.testcoveragetarget.scoped-routes`, `testing.testcasesketch.scoped-routes-sketch`,
 * `api.operation.get-viewer-asset`)
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";
import { startTestFarmServer, type TestFarmServer } from "../../helpers/test-farm-server.js";

/** Every retired path, with the scoped template the 410 names. */
const RETIRED: Array<[method: string, path: string, replacement: string]> = [
  ["GET", "/api/model", "/api/projects/{project}/checkouts/{checkout}/model"],
  ["GET", "/api/layers/business", "/api/projects/{project}/checkouts/{checkout}/layers/{layerName}"],
  ["GET", "/api/annotations", "/api/projects/{project}/checkouts/{checkout}/annotations"],
  ["POST", "/api/annotations", "/api/projects/{project}/checkouts/{checkout}/annotations"],
  ["GET", "/api/annotations/a-1", "/api/projects/{project}/checkouts/{checkout}/annotations/{annotationId}"],
  ["PUT", "/api/annotations/a-1", "/api/projects/{project}/checkouts/{checkout}/annotations/{annotationId}"],
  ["PATCH", "/api/annotations/a-1", "/api/projects/{project}/checkouts/{checkout}/annotations/{annotationId}"],
  ["DELETE", "/api/annotations/a-1", "/api/projects/{project}/checkouts/{checkout}/annotations/{annotationId}"],
  ["GET", "/api/annotations/a-1/replies", "/api/projects/{project}/checkouts/{checkout}/annotations/{annotationId}/replies"],
  ["POST", "/api/annotations/a-1/replies", "/api/projects/{project}/checkouts/{checkout}/annotations/{annotationId}/replies"],
  ["GET", "/api/changesets", "/api/projects/{project}/checkouts/{checkout}/changesets"],
  ["GET", "/api/changesets/c-1", "/api/projects/{project}/checkouts/{checkout}/changesets/{changesetId}"],
  [
    "GET",
    "/api/changesets/c-1/verification",
    "/api/projects/{project}/checkouts/{checkout}/changesets/{changesetId}/verification",
  ],
  ["PUT", "/api/changesets/c-1/review", "/api/projects/{project}/checkouts/{checkout}/changesets/{changesetId}/review"],
  ["POST", "/api/changesets/c-1/commit", "/api/projects/{project}/checkouts/{checkout}/changesets/{changesetId}/commit"],
  ["POST", "/api/changesets/c-1/discard", "/api/projects/{project}/checkouts/{checkout}/changesets/{changesetId}/discard"],
  ["GET", "/api/tier1", "/api/projects/{project}/checkouts/{checkout}/tier1"],
];

let rootPath: string;
let viewerPath: string;
let server: TestFarmServer;

beforeAll(async () => {
  rootPath = await realpath(await mkdtemp(join(tmpdir(), "dr-retired-routes-")));
  await Model.init(rootPath, { name: "Retired Routes", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
  viewerPath = await realpath(await mkdtemp(join(tmpdir(), "dr-retired-viewer-")));
  await mkdir(join(viewerPath, "assets"));
  await writeFile(join(viewerPath, "index.html"), "<!doctype html><title>viewer page</title>");
  await writeFile(join(viewerPath, "assets", "app.js"), "console.log('app');");
  server = await startTestFarmServer(rootPath, { server: { viewerPath } });
});

afterAll(async () => {
  await server?.stop();
  await rm(rootPath, { recursive: true, force: true });
  await rm(viewerPath, { recursive: true, force: true });
});

describe("the retired unscoped routes", () => {
  for (const [method, path, replacement] of RETIRED) {
    it(`${method} ${path} answers 410 Gone, naming ${replacement}`, async () => {
      const response = await server.raw(path, {
        method,
        headers: { ...server.auth, "Content-Type": "application/json" },
        body: method === "GET" || method === "DELETE" ? undefined : "{}",
      });
      expect(response.status).toBe(410);
      const body = await response.json();
      expect(body.replacement).toBe(replacement);
      expect(body.error).toContain("/api/projects");
    });
  }

  it("do not count as use of the server, where the scoped routes do", async () => {
    const before = server.server.centralActivity().lastActivityAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await server.raw("/api/model")).status).toBe(410);
    expect(server.server.centralActivity().lastActivityAt).toBe(before);
    expect((await server.request("/model")).status).toBe(200);
    expect(server.server.centralActivity().lastActivityAt).toBeGreaterThan(before);
  });

  it("still asks for the token first", async () => {
    expect((await server.raw("/api/model", { headers: {} })).status).toBe(401);
  });

  it("serves the scoped twin of each", async () => {
    expect((await server.request("/model")).status).toBe(200);
    expect((await server.request("/changesets")).status).toBe(200);
    expect((await server.request("/annotations")).status).toBe(200);
  });

  it("are not in the OpenAPI document; the scoped ones and the non-project routes are", () => {
    const doc = server.server.getOpenAPIDocument({ openapi: "3.1.0", info: { title: "t", version: "1" } });
    const paths = Object.keys(doc.paths);
    for (const [, path] of RETIRED) {
      const template = path.replace(/\/(business|a-1|c-1)(?=\/|$)/, "/{x}");
      expect(paths.some((p) => p.replace(/\{[^}]+\}|:[A-Za-z]+/g, "{x}") === template)).toBe(false);
    }
    for (const [, , replacement] of RETIRED) {
      expect(paths.map((p) => p.replace(/:([A-Za-z]+)/g, "{$1}"))).toContain(replacement);
    }
    // Outside the project and checkout scope: only the farm's own routes, health, the spec, the
    // docs, the websocket and MCP.
    const unscoped = paths.filter((p) => !p.startsWith("/api/projects/:project/checkouts/:checkout/"));
    expect(unscoped.sort()).toEqual(
      [
        "/api/projects",
        "/api/projects/:project",
        "/api/projects/:project/checkouts",
        "/api/spec",
        "/health",
        "/ws",
        "/mcp",
        "/api-docs",
        "/api-spec.yaml",
      ].sort()
    );
  });
});

describe("the viewer's deep-link paths", () => {
  it("load the viewer's page, without the token", async () => {
    for (const path of [`/p/${server.project}/c/main`, `/p/${server.project}/c/main/changesets/c-1`, "/p"]) {
      const response = await server.raw(path, { headers: {} });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("viewer page");
    }
  });

  it("leave the viewer's own files, the API, /mcp and /health to their routes", async () => {
    expect(await (await server.raw("/assets/app.js", { headers: {} })).text()).toContain("app");
    expect((await server.raw("/health", { headers: {} })).status).toBe(200);
    expect((await server.raw("/mcp", { method: "POST", headers: {} })).status).toBe(401);
    expect((await server.raw("/api/projects", { headers: {} })).status).toBe(401);
  });
});
