/**
 * Unit tests for the CBM response contract (cbm-responses.ts)
 *
 * The 0.12.1 cases replay MCP envelopes recorded from codebase-memory-mcp 0.12.1 against
 * the spring-petclinic and full-stack-fastapi-template eval corpora
 * (tests/fixtures/cbm-0.12.1/). The 0.10 cases use the flat shapes earlier versions sent.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  CbmTools,
  CbmToolError,
  ROUTE_HANDLERS_QUERY,
  assertToolResult,
  attachRouteHandlers,
  isServedRoute,
  cellLabel,
  cellNumber,
  groupedQualifiedName,
  nodesFromQuery,
  normalizeListProjects,
  normalizeQueryGraph,
  normalizeSearchGraph,
  normalizeTracePath,
  relativeToRoot,
  routeHandlersFromQuery,
} from "@/analyzers/cbm-responses.js";
import type { CbmToolInvoker } from "@/analyzers/cbm-responses.js";

const FIXTURES = join(import.meta.dir, "../../fixtures/cbm-0.12.1");
const PETCLINIC = "Users-austinsand-workspace-documentation_robotics-eval-corpus-spring-petclinic";
const OWNER_CONTROLLER =
  `${PETCLINIC}.src.main.java.org.springframework.samples.petclinic.owner.OwnerController`;

interface Fixture {
  tool: string;
  arguments: Record<string, unknown>;
  response: { content: Array<{ type: string; text: string }>; isError?: boolean };
}

function fixture(name: string): Fixture {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf-8")) as Fixture;
}

/** The tool result as StdioClient.invokeTool returns it (JSON-parsed text, else the text). */
function payload(name: string): unknown {
  const text = fixture(name).response.content[0].text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Fake client that records calls and answers with a function of (tool, args). */
function fakeClient(answer: (tool: string, args: Record<string, unknown>) => unknown) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const client: CbmToolInvoker = {
    async invokeTool(tool: string, args?: unknown) {
      const a = (args ?? {}) as Record<string, unknown>;
      calls.push({ tool, args: a });
      return answer(tool, a);
    },
  };
  return { client, calls };
}

describe("cbm-responses", () => {
  describe("assertToolResult()", () => {
    it("raises a Cypher error sent as text (0.12.1)", () => {
      expect(fixture("query_graph.syntax-error").response.isError).toBe(true);
      expect(() => assertToolResult("query_graph", payload("query_graph.syntax-error"))).toThrow(
        CbmToolError
      );
    });

    it("raises an error payload and keeps its hint (0.12.1 trace_path not found)", () => {
      try {
        assertToolResult("trace_path", payload("trace_path.not-found"));
        throw new Error("expected a throw");
      } catch (error) {
        expect(error).toBeInstanceOf(CbmToolError);
        const e = error as CbmToolError;
        expect(e.detail).toBe("function not found");
        expect(e.hint).toContain("search_graph");
        expect(e.suggestions?.[0]).toBe(e.hint);
      }
    });

    it("raises status: error", () => {
      expect(() => assertToolResult("index_repository", { status: "error", hint: "x" })).toThrow(
        CbmToolError
      );
    });

    it("accepts data payloads", () => {
      expect(() => assertToolResult("index_repository", payload("index_repository"))).not.toThrow();
      expect(() => assertToolResult("search_graph", { results: [] })).not.toThrow();
    });
  });

  describe("normalizeSearchGraph()", () => {
    it("flattens grouped Route rows (0.12.1)", () => {
      const res = normalizeSearchGraph(payload("search_graph.route.page1"));
      expect(res.hasMore).toBe(true);
      expect(res.nextOffset).toBe(4);
      expect(res.nodes).toHaveLength(4);

      const [welcome, oups] = res.nodes;
      expect(welcome).toMatchObject({
        name: "/",
        qualified_name: "__route__GET__/",
        label: "Route",
        file_path: "src/main/java/org/springframework/samples/petclinic/system/WelcomeController.java",
      });
      expect(welcome.properties).toMatchObject({ name: "/", fan_in: 0, fan_out: 0 });
      // The method stays in the qualified name (search_graph sends no method column unasked)
      expect(welcome.properties?.method).toBeUndefined();
      // Empty file comes back as no file
      expect(oups.qualified_name).toBe("__route__GET__/oups");
      expect(oups.file_path).toBeUndefined();
    });

    it("rebuilds qualified names split at a dot (__route__GET__/vets + html)", () => {
      const res = normalizeSearchGraph(payload("search_graph.route.split-qn"));
      const vetsHtml = res.nodes.find((n) => n.qualified_name === "__route__GET__/vets.html");
      expect(vetsHtml).toBeDefined();
      expect(vetsHtml!.name).toBe("/vets.html");
    });

    it("maps lines, in/out and extra fields onto properties (0.12.1 Method rows)", () => {
      const res = normalizeSearchGraph(payload("search_graph.method.fields"));
      const find = res.nodes.find((n) => n.name === "findPaginatedForOwnersLastName");
      expect(find).toBeDefined();
      expect(find!.qualified_name).toBe(`${OWNER_CONTROLLER}.findPaginatedForOwnersLastName`);
      expect(find!.label).toBe("Method");
      expect(find!.file_path).toBe("src/main/java/org/springframework/samples/petclinic/owner/OwnerController.java");
      expect(find!.properties).toMatchObject({
        name: "findPaginatedForOwnersLastName",
        start_line: 141,
        end_line: 146,
        fan_in: 1,
        fan_out: 3,
        is_entry_point: false,
      });
    });

    it("reads fastapi Route rows that carry no file", () => {
      const res = normalizeSearchGraph(payload("search_graph.route.fastapi"));
      expect(res.nodes.map((n) => n.qualified_name)).toEqual([
        "__route__GET__/",
        "__route__POST__/",
        "__route__GET__/health-check/",
      ]);
      expect(res.nodes[1].name).toBe("/");
      expect(res.nodes.every((n) => n.file_path === undefined)).toBe(true);
    });

    it("passes 0.10 flat results through unpaged", () => {
      const node = { label: "Route", name: "/users", qualified_name: "__route__GET__/users", file_path: "a.ts" };
      expect(normalizeSearchGraph({ results: [node] })).toEqual({ nodes: [node], hasMore: false });
      expect(normalizeSearchGraph({ nodes: [node] }).nodes).toEqual([node]);
    });

    it("rejects responses with no results", () => {
      expect(() => normalizeSearchGraph(null)).toThrow("Invalid response from search_graph");
      expect(() => normalizeSearchGraph({ total: 0 })).toThrow("no results");
    });
  });

  describe("normalizeQueryGraph() and cells", () => {
    it("reads columns/rows with a cursor (0.12.1)", () => {
      const res = normalizeQueryGraph(payload("query_graph.handles.page1"));
      expect(res.columns).toContain("route_qualified_name");
      expect(res.rows).toHaveLength(2);
      expect(res.hasMore).toBe(true);
      expect(typeof res.nextCursor).toBe("string");
    });

    it("converts legacy records into columns/rows", () => {
      const res = normalizeQueryGraph({ records: [{ a: 1, b: "x" }, { a: 2 }] });
      expect(res.columns).toEqual(["a", "b"]);
      expect(res.rows).toEqual([[1, "x"], [2, undefined]]);
      expect(res.hasMore).toBe(false);
    });

    it("parses 0.12 cell encodings", () => {
      expect(cellNumber("45")).toBe(45);
      expect(cellNumber(7)).toBe(7);
      expect(cellNumber("")).toBeUndefined();
      expect(cellLabel('["Route"]')).toBe("Route");
      expect(cellLabel(["Method"])).toBe("Method");
      expect(cellLabel("Class")).toBe("Class");
    });

    it("builds nodes from explicit node columns", () => {
      const nodes = nodesFromQuery({
        columns: ["name", "qualified_name", "file_path", "start_line", "end_line", "label"],
        rows: [["useAuth", "p.frontend.useAuth", "frontend/src/hooks/useAuth.ts", "10", "40", '["Function"]']],
      });
      expect(nodes).toEqual([
        {
          name: "useAuth",
          qualified_name: "p.frontend.useAuth",
          label: "Function",
          file_path: "frontend/src/hooks/useAuth.ts",
          properties: { name: "useAuth", start_line: 10, end_line: 40 },
        },
      ]);
    });

    it("passes through legacy single-column node records", () => {
      const node = { label: "Function", name: "fetchUsers", file_path: "src/api.ts" };
      expect(nodesFromQuery({ columns: ["n"], rows: [[node]] })).toEqual([node]);
    });
  });

  describe("route handlers", () => {
    const handlers = [
      ...routeHandlersFromQuery(normalizeQueryGraph(payload("query_graph.handles.page1"))),
      ...routeHandlersFromQuery(normalizeQueryGraph(payload("query_graph.handles.page2"))),
    ];

    it("records the analyzer's own HANDLES query", () => {
      expect(fixture("query_graph.handles.page1").arguments.query).toBe(ROUTE_HANDLERS_QUERY);
    });

    it("reads handlers from a HANDLES query (0.12.1)", () => {
      const oups = handlers.find((h) => h.route_qualified_name === "__route__GET__/oups");
      expect(oups).toMatchObject({
        name: "triggerException",
        file_path: "src/main/java/org/springframework/samples/petclinic/system/CrashController.java",
        start_line: 31,
        end_line: 35,
      });
    });

    it("fills handler, symbol, lines and a missing file onto routes", () => {
      const routes = normalizeSearchGraph(payload("search_graph.route.page1")).nodes;
      const [welcome, oups, , ownersOne] = attachRouteHandlers(routes, handlers);

      expect(oups.file_path).toBe("src/main/java/org/springframework/samples/petclinic/system/CrashController.java");
      expect(oups.properties).toMatchObject({ symbol: "triggerException", start_line: 31, end_line: 35 });
      expect(String(oups.properties?.handler_name)).toEndWith("CrashController.triggerException");

      // The route's own file wins over the handler's
      expect(welcome.file_path).toBe(
        "src/main/java/org/springframework/samples/petclinic/system/WelcomeController.java"
      );
      expect(welcome.properties?.symbol).toBe("welcome");

      // A route nothing handles (a test's HTTP call target) is left as it was
      expect(ownersOne.file_path).toBeUndefined();
      expect(ownersOne.properties?.handler_name).toBeUndefined();
    });
  });

  describe("route handlers shared by one Route node", () => {
    it("splits a route with several handlers into one node per handler", () => {
      const route = { name: "/{}", qualified_name: "__route__GET__/{}", label: "Route", properties: { name: "/{}" } };
      const h = (mod: string, fn: string, line: number) => ({
        route_qualified_name: "__route__GET__/{}",
        qualified_name: `p.backend.app.api.routes.${mod}.${fn}`,
        name: fn,
        file_path: `backend/app/api/routes/${mod}.py`,
        start_line: line,
      });
      const out = attachRouteHandlers(
        [route],
        [h("users", "read_user_by_id", 163), h("items", "read_item", 40), h("items", "read_item", 40)]
      );
      expect(out.map((n) => [n.file_path, n.properties?.symbol])).toEqual([
        ["backend/app/api/routes/users.py", "read_user_by_id"],
        ["backend/app/api/routes/items.py", "read_item"],
      ]);
    });
  });

  describe("normalizeTracePath()", () => {
    it("reads callees with hops (0.12.1)", () => {
      const res = normalizeTracePath(payload("trace_path.outbound"), "outbound");
      expect(res).not.toBeNull();
      expect(res!.shape).toBe("grouped");
      expect(res!.edges).toEqual([]);
      const byName = new Map(res!.nodes.map((n) => [n.name, n]));
      expect(byName.get("findPaginatedForOwnersLastName")).toMatchObject({
        qualified_name: `${OWNER_CONTROLLER}.findPaginatedForOwnersLastName`,
        source_symbol: "findPaginatedForOwnersLastName",
        depth: 1,
      });
      expect(byName.get("findByLastNameStartingWith")?.depth).toBe(2);
      expect(res!.nodes).toHaveLength(5);
    });

    it("reads callers (0.12.1)", () => {
      const res = normalizeTracePath(payload("trace_path.inbound"), "inbound");
      expect(res!.nodes.map((n) => n.qualified_name)).toEqual([`${OWNER_CONTROLLER}.processFindForm`]);
    });

    it("passes 0.10 nodes/edges through", () => {
      const raw = { nodes: [{ id: "a", depth: 1 }], edges: [{ from_node: "x", to_node: "a", type: "CALLS" }] };
      const res = normalizeTracePath(raw, "inbound");
      expect(res).toMatchObject({ nodes: raw.nodes, edges: raw.edges, shape: "flat" });
    });

    it("returns null when the response holds no call graph", () => {
      expect(normalizeTracePath({ status: "ok" }, "inbound")).toBeNull();
    });
  });

  describe("normalizeListProjects()", () => {
    it("reads a page (0.12.1)", () => {
      const res = normalizeListProjects(payload("list_projects.page1"));
      expect(res.projects).toHaveLength(2);
      expect(res.projects[0]).toHaveProperty("root_path");
      expect(res).toMatchObject({ hasMore: true, nextOffset: 2 });
    });

    it("treats a missing projects array as none", () => {
      expect(normalizeListProjects({}).projects).toEqual([]);
      expect(() => normalizeListProjects("text")).toThrow("Invalid response from list_projects");
    });
  });

  describe("CbmTools pager", () => {
    it("asks for JSON and follows list_projects offsets", async () => {
      const { client, calls } = fakeClient((_tool, args) =>
        args.offset === 2 ? payload("list_projects.page2") : payload("list_projects.page1")
      );
      const projects = await new CbmTools(client).listProjects();
      expect(projects.map((p) => p.name)).toContain(PETCLINIC);
      expect(projects).toHaveLength(3);
      expect(calls).toHaveLength(2);
      expect(calls.every((c) => c.args.format === "json")).toBe(true);
    });

    it("follows search_graph next_offset until has_more is false", async () => {
      const page = (offset: number, more: boolean) => ({
        cols: ["name", "label", "lines", "in", "out"],
        groups: [{ qn_prefix: "m", file: "a.py", rows: [[`f${offset}`, "Function", "1-2", 0, 0]] }],
        has_more: more,
        next_offset: more ? offset + 1 : undefined,
      });
      const { client, calls } = fakeClient((_t, args) => page(Number(args.offset), Number(args.offset) < 2));
      const nodes = await new CbmTools(client).searchGraph({ label: "Function", project: "p" });
      expect(nodes.map((n) => n.qualified_name)).toEqual(["m.f0", "m.f1", "m.f2"]);
      expect(calls.map((c) => c.args.offset)).toEqual([0, 1, 2]);
      expect(calls[0].args).toMatchObject({ label: "Function", project: "p", format: "json", limit: 500 });
    });

    it("stops when has_more is set without a next offset", async () => {
      const { client, calls } = fakeClient(() => ({ cols: ["name", "label"], groups: [], has_more: true }));
      expect(await new CbmTools(client).searchGraph({ label: "X", project: "p" })).toEqual([]);
      expect(calls).toHaveLength(1);
    });

    it("follows query_graph cursors (0.12.1 HANDLES query)", async () => {
      const first = fixture("query_graph.handles.page1");
      const second = fixture("query_graph.handles.page2");
      const { client, calls } = fakeClient((_t, args) => {
        if (!args.cursor) return payload("query_graph.handles.page1");
        if (args.cursor === second.arguments.cursor) return payload("query_graph.handles.page2");
        // Later pages are not recorded; end the result here
        return { columns: (payload("query_graph.handles.page1") as { columns: string[] }).columns, rows: [], has_more: false };
      });
      const result = await new CbmTools(client).queryGraph(String(first.arguments.query), PETCLINIC);
      expect(result.rows.length).toBeGreaterThanOrEqual(4);
      expect(calls[1].args.cursor).toBe(second.arguments.cursor);
      expect(calls[0].args).toMatchObject({ format: "json", max_rows: 5000 });
    });

    it("raises query_graph errors", async () => {
      const { client } = fakeClient(() => payload("query_graph.syntax-error"));
      await expect(new CbmTools(client).queryGraph("MATCH (n) RETURN n LIMIT x", "p")).rejects.toThrow(
        CbmToolError
      );
    });

    it("raises trace_path depth to 1 and returns null for a call-graph-less response", async () => {
      const { client, calls } = fakeClient(() => ({ unexpected: true }));
      const res = await new CbmTools(client).tracePath({
        function_name: "f",
        direction: "inbound",
        depth: 0,
        project: "p",
      });
      expect(res).toBeNull();
      expect(calls[0].args.depth).toBe(1);
    });

    it("looks up files for qualified names in one IN query", async () => {
      const { client, calls } = fakeClient(() => ({
        columns: ["qualified_name", "file_path"],
        rows: [["a.b", "src/a.py"]],
        has_more: false,
      }));
      const files = await new CbmTools(client).filePathsOf(["a.b", "a.b", "c'd"], "p");
      expect(files.get("a.b")).toBe("src/a.py");
      expect(calls).toHaveLength(1);
      expect(String(calls[0].args.query)).toContain('IN ["a.b"]');
    });
  });

  describe("helpers", () => {
    it("builds qualified names from the qn rule", () => {
      expect(groupedQualifiedName("", "__route__GET__/")).toBe("__route__GET__/");
      expect(groupedQualifiedName("a.B", "m")).toBe("a.B.m");
    });

    it("relativises only absolute paths", () => {
      expect(relativeToRoot("/repo", "/repo/src/a.ts")).toBe("src/a.ts");
      expect(relativeToRoot("/repo", "src/a.ts")).toBe("src/a.ts");
      expect(relativeToRoot(undefined, "/repo/src/a.ts")).toBe("/repo/src/a.ts");
    });
  });
});

describe("isServedRoute", () => {
  const route = (file_path: string | undefined, properties: Record<string, unknown> = {}) => ({
    label: "Route",
    qualified_name: "__route__GET__/pets",
    file_path,
    properties,
  });

  it("keeps a route with a file of its own or a handler", () => {
    expect(isServedRoute(route("src/pets.py", { source: "decorator" }))).toBe(true);
    expect(isServedRoute(route(undefined, { handler_name: "app.pets.list_pets" }))).toBe(true);
  });

  it("drops a route with neither: a URL the code calls", () => {
    expect(isServedRoute(route(undefined))).toBe(false);
  });

  it("drops a route on another host, even with a file or handler", () => {
    expect(isServedRoute(route("src/client.ts", { external: "true" }))).toBe(false);
    expect(isServedRoute(route(undefined, { external: true, handler_name: "x" }))).toBe(false);
  });

  it("drops a route only an OpenAPI file declares", () => {
    expect(isServedRoute(route("openapi.yaml", { source: "openapi" }))).toBe(false);
  });
});
