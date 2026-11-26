/**
 * Route recognition in extraction (#1321, #1349, #1303): hand-routed servers, false routes, and what
 * a route definition states.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { collectExtraction, extractionConfigFrom } from "../../../src/analyzers/cards/extract.js";
import { deriveAttributes } from "../../../src/analyzers/extraction-plan.js";
import { isServedRoute } from "../../../src/analyzers/cbm-responses.js";
import { tier0RulesFrom } from "../../../src/analyzers/tier0-rules.js";
import type { CardGraph, GraphNode } from "../../../src/analyzers/cards/index.js";
import type { AnalyzerHeuristic } from "../../../src/analyzers/types.js";

const CBM = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../spec/dist/analyzers/cbm.json"), "utf-8"));
const CONFIG = extractionConfigFrom(
  tier0RulesFrom(CBM.heuristics.heuristics as AnalyzerHeuristic[]),
  Object.values(CBM.edges_by_type),
  Object.values(CBM.nodes_by_label)
);

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "dr-routes-"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

function graph(files: string[], routes: GraphNode[] = [], handles: Array<[string, string]> = []): CardGraph {
  return {
    project: "p",
    async search(label) {
      return label === "Route" ? routes : [];
    },
    async rows(cypher) {
      if (/MATCH \(f:File\)/.test(cypher)) return files.map((f) => [f]);
      if (/MATCH \(r:Route\) RETURN r\.qualified_name, r\.name/.test(cypher)) return routes.map((r) => [r.qualified_name, r.name]);
      if (/HANDLES\]->\(x:Route\)/.test(cypher)) return handles;
      if (/-\[r\]->\(x:Route\)/.test(cypher)) return handles.map(([from, to]) => [from, "src/h.ts", to]);
      return [];
    },
    async snippet() {
      return null;
    },
  };
}

const route = (method: string, path: string, file: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  label: "Route",
  name: `__route__${method}__${path}`,
  qualified_name: `__route__${method}__${path}`,
  file_path: file,
  method,
  ...extra,
});

describe("hand-routed servers become routes (#1321)", () => {
  const server = `import http from "node:http";
http.createServer((req, res) => {
  const route = req.url;
  if (route === '/files/have' && req.method === 'POST') return have(req, res);
  if (req.method === 'GET' && route === '/files/list') return list(res);
});
`;
  it("stages an operation card per comparison, decided as api.operation, from the file's text", async () => {
    const root = project({ "src/server.js": server });
    const extraction = await collectExtraction(graph(["src/server.js"]), CONFIG, "cbm", { sourceRoot: root });
    const routes = extraction.symbols.filter((s) => s.handRouted);
    expect(routes.map((s) => s.card.name)).toEqual(["__route__POST__/files/have", "__route__GET__/files/list"]);
    expect(routes.every((s) => s.tier0?.kind === "decide" && s.tier0.layer === "api" && s.tier0.type === "operation")).toBe(true);
    expect(routes[0].card.file_path).toBe("src/server.js");
    expect(routes[0].card.start_line).toBe(4);
    expect(extraction.routes).toContain("POST /files/have");
    expect(extraction.handRoutesPartial).toBeUndefined();
  });

  it("doesn't repeat a route the graph already has, and says when a hand-routed file was read only in part", async () => {
    const root = project({ "src/server.js": server + "if (route === '/ping') return ping(res);\n" });
    const known = route("POST", "/files/have", "src/server.js");
    const extraction = await collectExtraction(graph(["src/server.js"], [known]), CONFIG, "cbm", { sourceRoot: root });
    const names = extraction.symbols.map((s) => s.card.name);
    expect(names.filter((n) => n === "__route__POST__/files/have")).toHaveLength(1);
    // `/ping` has no method beside it: not made into a route, and the file is listed for the agent.
    expect(names).not.toContain("__route__ANY__/ping");
    expect(extraction.handRoutesPartial).toEqual(["src/server.js"]);
  });

  it("reads a route table's regex paths and ignores test files", async () => {
    const root = project({
      "src/gateway.ts": "const ROUTES = [{ method: 'POST', pattern: /^\\/api\\/projects\\/([^/]+)\\/revert$/, handler: revert }];\n",
      "tests/gateway.test.ts": "const ROUTES = [{ method: 'GET', path: '/only/in/tests' }];\n",
    });
    const extraction = await collectExtraction(graph(["src/gateway.ts", "tests/gateway.test.ts"]), CONFIG, "cbm", { sourceRoot: root });
    expect(extraction.symbols.map((s) => s.card.name)).toEqual(["__route__POST__/api/projects/{}/revert"]);
  });
});

describe("false routes are not served routes (#1321, #1303)", () => {
  it("leaves a URL string in a test file, an ANY URL with no handler, and non-path text out of the cards", async () => {
    const root = project({});
    const routes = [
      route("ANY", "/api/projects/p_oloid_turntable/revert", "tests/api.test.ts"),
      route("ANY", "/api/photos/ph_nope/retry", "src/viewer/client.ts"),
      route("GET", "/>", "src/ui/App.tsx"),
      route("GET", "/real", "src/server.ts"),
    ];
    const extraction = await collectExtraction(graph(["src/server.ts"], routes), CONFIG, "cbm", { sourceRoot: root });
    const decided = extraction.symbols.filter((s) => s.tier0?.kind === "decide").map((s) => s.card.name);
    expect(decided).toEqual(["__route__GET__/real"]);
    // The ones with a file are listed as unhandled (a call, at most a `uses` hint), never decided.
    expect(extraction.symbols.filter((s) => s.unhandled).map((s) => s.card.name)).toEqual([
      "__route__ANY__/api/photos/ph_nope/retry",
    ]);
  });

  it("verify and endpoint discovery don't serve a test file's URL, an ANY route nothing handles, or a handled one", () => {
    const node = (file: string, props: Record<string, unknown>, qn = "__route__GET__/x"): any => ({ qualified_name: qn, file_path: file, properties: props });
    expect(isServedRoute(node("tests/e2e/page.spec.ts", { method: "GET" }))).toBe(false);
    expect(isServedRoute(node("src/client.ts", { method: "ANY" }, "__route__ANY__/x"))).toBe(false);
    expect(isServedRoute(node("src/client.ts", { method: "ANY", handler_name: "p.handle" }, "__route__ANY__/x"))).toBe(true);
    expect(isServedRoute(node("src/server.ts", { method: "GET" }))).toBe(true);
  });
});

describe("what a route definition states is read, never made up (#1349)", () => {
  const defs = `const getUser = createRoute({ method: 'get', path: '/users/{id}', operationId: 'getUser', summary: 'Get a user', tags: ['users'] });
const listUsers = createRoute({ method: 'get', path: '/users', responses: {} });
`;
  it("reads operationId, summary and tags, and records placeholders only for what it can't read", async () => {
    const root = project({ "src/server.ts": defs });
    const routes = [route("GET", "/users/{}", "src/server.ts"), route("GET", "/users", "src/server.ts")];
    const extraction = await collectExtraction(graph(["src/server.ts"], routes), CONFIG, "cbm", { sourceRoot: root });
    const [one, two] = extraction.symbols;
    expect(one.definition).toEqual({ operationId: "getUser", summary: "Get a user", tags: "users" });
    expect(two.definition).toBeUndefined();

    const read = deriveAttributes("api", "operation", one);
    expect(read.facts).toMatchObject({ http_method: "GET", operationId: "getUser", summary: "Get a user", tags: "users" });
    expect(read.defaulted).toBeUndefined();
    const unread = deriveAttributes("api", "operation", two);
    expect(unread.facts).not.toHaveProperty("operationId");
    expect(unread.defaulted).toEqual(["operationId", "summary", "tags"]);
  });
});
