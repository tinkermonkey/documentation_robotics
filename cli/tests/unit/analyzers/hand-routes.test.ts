import { describe, expect, test } from "bun:test";
import { definitionFor, readHandRoutes, readRouteDefinitions, regexRoutePath } from "../../../src/analyzers/cards/hand-routes.js";

describe("readHandRoutes: a hand-routed http.createServer (#1321)", () => {
  const server = `
import http from "node:http";
const server = http.createServer(async (req, res) => {
  const route = new URL(req.url, "http://x").pathname;
  if (route === '/files/have' && req.method === 'POST') return have(req, res);
  if (req.method === "GET" && route === "/health") return ok(res);
  if (route === '/files/put') {
    if (req.method === 'PUT') return put(req, res);
  }
  res.statusCode = 404;
});
`;
  test("reads method and path comparisons in either order", () => {
    const read = readHandRoutes(server);
    expect(read.routes.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /files/have", "GET /health"]);
    expect(read.routes[0].line).toBe(5);
  });

  test("a path comparison with no method beside it is partial, not a made-up ANY route", () => {
    const read = readHandRoutes(server);
    expect(read.routes.some((r) => r.method === "ANY")).toBe(false);
    expect(read.partial).toBe(true);
  });

  test("takes the method from the block the line before opens", () => {
    const read = readHandRoutes(`http.createServer((req, res) => {\n  if (req.method === 'DELETE') {\n    if (pathname === '/x/y') return z();\n  }\n});`);
    expect(read.routes.map((r) => `${r.method} ${r.path}`)).toEqual(["DELETE /x/y"]);
  });

  test("a server with no readable route is partial; a file that is no server and has no table gives nothing", () => {
    expect(readHandRoutes("http.createServer((req, res) => dispatch(req, res));")).toEqual({ routes: [], partial: true });
    expect(readHandRoutes("export const x = 1;")).toEqual({ routes: [], partial: false });
  });
});

describe("readHandRoutes: route tables and regexes (toland-cad, #1321)", () => {
  test("reads a ROUTES table of literal paths and anchored regexes", () => {
    const read = readHandRoutes(`
const ROUTES = [
  { method: 'GET', path: '/api/projects', handler: listProjects },
  { method: 'POST', pattern: /^\\/api\\/projects\\/([^/]+)\\/revert$/, handler: revert },
  ['GET', '/api/photos/jobs', photoJobs],
];
export function matchRoute(method, path) {}
`);
    expect(read.routes.map((r) => `${r.method} ${r.path}${r.handler ? ` -> ${r.handler}` : ""}`).sort()).toEqual([
      "GET /api/photos/jobs -> photoJobs",
      "GET /api/projects -> listProjects",
      "POST /api/projects/{}/revert -> revert",
    ]);
    expect(read.partial).toBe(false);
  });

  test("a regex that is more than literal segments and captures is unread, and the file partial", () => {
    const read = readHandRoutes(`const ROUTES = [{ method: 'GET', pattern: /^\\/a\\/(foo|bar)$/ }];`);
    expect(read.routes).toEqual([]);
    expect(read.partial).toBe(true);
  });

  test("regexRoutePath reads literal segments and captures, names named groups, and refuses the rest", () => {
    expect(regexRoutePath("/^\\/api\\/p\\/([^/]+)\\/jobs\\/(\\d+)$/")).toBe("/api/p/{}/jobs/{}");
    expect(regexRoutePath("/^\\/api\\/p\\/(?<id>[^/]+)$/")).toBe("/api/p/{id}");
    expect(regexRoutePath("/\\/api\\/p/")).toBeNull();
    expect(regexRoutePath("/^\\/a\\/.*$/")).toBeNull();
  });
});

describe("readRouteDefinitions: createRoute metadata (#1349)", () => {
  const source = `
const getUser = createRoute({
  method: 'get',
  path: '/users/{id}',
  operationId: 'getUser',
  summary: "Get a user",
  tags: ['users'],
  responses: { 200: { description: 'ok', summary: 'nested, ignored' } },
});
const bare = createRoute({ method: 'post', path: '/users', responses: {} });
const named = createRoute({ method: 'delete', path: '/users/{id}', operationId: opId, tags: ['a', 'b'] });
`;
  test("reads operationId, summary and tags, and nothing from nested objects", () => {
    expect(readRouteDefinitions(source)[0]).toEqual({ method: "GET", path: "/users/{id}", operationId: "getUser", summary: "Get a user", tags: "users" });
  });
  test("leaves a field it can't read unset, never made up from the path", () => {
    const defs = readRouteDefinitions(source);
    expect(defs[1]).toEqual({ method: "POST", path: "/users" });
    expect(defs[2]).toEqual({ method: "DELETE", path: "/users/{id}", tags: "a, b" });
  });
  test("finds a definition by method and path, parameter names aside", () => {
    expect(definitionFor(readRouteDefinitions(source), "get", "/users/:userId")?.operationId).toBe("getUser");
    expect(definitionFor(readRouteDefinitions(source), "put", "/users/{id}")).toBeUndefined();
  });
});
