/**
 * CbmAnalyzer against codebase-memory-mcp 0.12.1 response shapes
 *
 * Replays responses recorded from CBM 0.12.1 on spring-petclinic
 * (tests/fixtures/cbm-0.12.1/) through a patched StdioClient and checks the analyzer's
 * own output: every call asks for JSON, Route nodes get their HANDLES handler, and
 * trace_path rows get their files.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { CbmAnalyzer } from "@/analyzers/cbm-analyzer.js";
import { MappingLoader } from "@/analyzers/mapping-loader.js";
import { StdioClient } from "@/analyzers/stdio-client.js";
import { CbmTools, ROUTE_HANDLERS_QUERY } from "@/analyzers/cbm-responses.js";
import { VerifyEngine } from "@/analyzers/verify-engine.js";

const FIXTURES = join(import.meta.dir, "../../fixtures/cbm-0.12.1");
const PETCLINIC = "Users-austinsand-workspace-documentation_robotics-eval-corpus-spring-petclinic";
const CODEBASE_ROOT = "/nonexistent/spring-petclinic";
const OWNER_CONTROLLER =
  `${PETCLINIC}.src.main.java.org.springframework.samples.petclinic.owner.OwnerController`;

function payload(name: string): Record<string, unknown> {
  const f = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf-8"));
  return JSON.parse(f.response.content[0].text);
}

/** The recorded first page with paging switched off, plus extra rows. */
function lastPage(name: string, extraRows: unknown[][] = []): Record<string, unknown> {
  const p = payload(name);
  return { ...p, rows: [...((p.rows as unknown[][]) ?? []), ...extraRows], has_more: false, next_cursor: undefined };
}

describe("CbmAnalyzer with CBM 0.12.1 responses", () => {
  let analyzer: CbmAnalyzer;
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const original = {
    spawn: StdioClient.prototype.spawn,
    close: StdioClient.prototype.close,
    initialize: StdioClient.prototype.initialize,
    invokeTool: StdioClient.prototype.invokeTool,
  };

  beforeEach(async () => {
    analyzer = new CbmAnalyzer(await MappingLoader.load("cbm"));
    (analyzer as any).status = async () => ({
      indexed: true,
      fresh: true,
      detected: { installed: true, binary_path: "/bin/mock", contract_ok: true, mcp_registered: false },
    });
    calls.length = 0;

    StdioClient.prototype.spawn = function () { /* noop */ };
    StdioClient.prototype.close = function () { /* noop */ };
    StdioClient.prototype.initialize = async function () { return { capabilities: {} } as any; };
    StdioClient.prototype.invokeTool = async function (tool: string, params?: unknown) {
      const args = (params ?? {}) as Record<string, unknown>;
      calls.push({ tool, args });
      if (tool === "list_projects") {
        return { projects: [{ name: PETCLINIC, root_path: CODEBASE_ROOT }], has_more: false };
      }
      if (tool === "search_graph") {
        return { ...payload("search_graph.route.page1"), has_more: false };
      }
      if (tool === "query_graph") {
        const query = String(args.query);
        if (query === ROUTE_HANDLERS_QUERY) {
          return lastPage("query_graph.handles.page1", payload("query_graph.handles.page2").rows as unknown[][]);
        }
        if (query.includes("IN [")) {
          return {
            columns: ["qualified_name", "file_path"],
            rows: [[`${OWNER_CONTROLLER}.findPaginatedForOwnersLastName`, "src/main/java/org/springframework/samples/petclinic/owner/OwnerController.java"]],
            has_more: false,
          };
        }
        return { columns: [], rows: [], has_more: false };
      }
      if (tool === "trace_path") {
        return payload("trace_path.outbound");
      }
      return {};
    };
  });

  afterEach(() => {
    Object.assign(StdioClient.prototype, original);
  });

  it("endpoints(): attaches HANDLES handlers and recovers files routes lack", async () => {
    const endpoints = await analyzer.endpoints(CODEBASE_ROOT);
    const byPath = new Map(endpoints.map((e) => [`${e.http_method} ${e.http_path}`, e]));

    expect(byPath.get("GET /")).toMatchObject({
      source_file: "src/main/java/org/springframework/samples/petclinic/system/WelcomeController.java",
      source_symbol: "welcome",
      handler_qualified_name: `${PETCLINIC}.src.main.java.org.springframework.samples.petclinic.system.WelcomeController.welcome`,
      source_start_line: 25,
      source_end_line: 28,
    });
    // The Route node has no file; its handler does
    expect(byPath.get("GET /oups")?.source_file).toBe(
      "src/main/java/org/springframework/samples/petclinic/system/CrashController.java"
    );
    // A route nothing handles and no file names is dropped
    expect(byPath.has("GET /owners/1")).toBe(false);

    expect(calls.every((c) => c.args.format === "json")).toBe(true);
    expect(calls.find((c) => c.tool === "search_graph")?.args).toMatchObject({ label: "Route", project: PETCLINIC });
  });

  it("verify() route shaping: routes carry handler symbols", async () => {
    // verify() runs fetchRoutes() then shapeRoute(); the comparison itself is VerifyEngine's
    const nodes = await (analyzer as any).fetchRoutes(new CbmTools(new StdioClient()), PETCLINIC, "Route");
    const routes = nodes.map((n: any) => analyzer.shapeRoute(n));
    const welcome = routes.find((r: any) => r.http_path === "/");
    expect(welcome).toMatchObject({
      http_method: "GET",
      source_symbol: "welcome",
      id: "src/main/java/org/springframework/samples/petclinic/system/WelcomeController.java:welcome",
    });
  });

  describe("routes that aren't served here", () => {
    const WELCOME = "src/main/java/org/springframework/samples/petclinic/system/WelcomeController.java";
    // A search_graph page with the route fields extraction asks for: the fixture's served route,
    // its handled file-less route, and three Route nodes this codebase does not serve.
    const routePage = {
      cols: ["name", "label", "lines", "in", "out", "method", "source", "external"],
      groups: [
        { qn_prefix: "", file: WELCOME, rows: [["__route__GET__/", "Route", "", 0, 0, "GET", "decorator", null]] },
        // No file, but a HANDLES edge (CrashController.triggerException): served.
        { qn_prefix: "", file: "", rows: [["__route__GET__/oups", "Route", "", 1, 0, "GET", "decorator", null]] },
        // No file and no handler: a URL the code calls.
        { qn_prefix: "", file: "", rows: [["__route__GET__/owners/1", "Route", "", 1, 0, "GET", null, null]] },
        // Declared in an OpenAPI file only: it has a file, but no code serves it.
        { qn_prefix: "", file: "openapi.yaml", rows: [["__route__GET__/pets", "Route", "", 0, 0, "GET", "openapi", null]] },
        // Another host's route the code calls.
        { qn_prefix: "", file: "", rows: [["__route__GET__/health", "Route", "", 1, 0, "GET", null, "true"]] },
      ],
      has_more: false,
    };
    let computeReport: typeof VerifyEngine.prototype.computeReport;

    beforeEach(() => {
      const replay = StdioClient.prototype.invokeTool;
      StdioClient.prototype.invokeTool = async function (tool: string, params?: unknown) {
        if (tool === "search_graph") {
          calls.push({ tool, args: (params ?? {}) as Record<string, unknown> });
          return routePage;
        }
        return replay.call(this, tool, params);
      };
      computeReport = VerifyEngine.prototype.computeReport;
    });

    afterEach(() => {
      VerifyEngine.prototype.computeReport = computeReport;
    });

    it("endpoints(): keeps only routes with a file or handler, not external, not OpenAPI-only", async () => {
      const endpoints = await analyzer.endpoints(CODEBASE_ROOT);
      expect(endpoints.map((e) => `${e.http_method} ${e.http_path}`).sort()).toEqual(["GET /", "GET /oups"]);
      // The route discovery asks for the fields the filter reads.
      expect(calls.find((c) => c.tool === "search_graph")?.args.fields).toEqual(["method", "source", "external"]);
    });

    it("verify(): compares only served routes with the model", async () => {
      let compared: Array<{ http_method: string; http_path: string }> = [];
      VerifyEngine.prototype.computeReport = async function (_root: string, routes: any[]) {
        compared = routes;
        return {} as any;
      } as any;
      await analyzer.verify(CODEBASE_ROOT);
      expect(compared.map((r) => `${r.http_method} ${r.http_path}`).sort()).toEqual(["GET /", "GET /oups"]);
    });
  });

  it("callees(): reads grouped trace rows and looks up their files", async () => {
    const callees = await analyzer.callees(CODEBASE_ROOT, `${OWNER_CONTROLLER}.processFindForm`, 2);
    expect(callees).toHaveLength(5);
    const find = callees.find((c) => c.source_symbol === "findPaginatedForOwnersLastName");
    expect(find).toMatchObject({
      qualified_name: `${OWNER_CONTROLLER}.findPaginatedForOwnersLastName`,
      source_file: "src/main/java/org/springframework/samples/petclinic/owner/OwnerController.java",
      depth: 1,
      edge_type: "CALLS",
    });
    expect(callees.find((c) => c.source_symbol === "findByLastNameStartingWith")?.depth).toBe(2);

    const trace = calls.find((c) => c.tool === "trace_path");
    expect(trace?.args).toMatchObject({ direction: "outbound", depth: 2, format: "json" });
  });

  it("callers(): reports an unknown symbol as not found", async () => {
    StdioClient.prototype.invokeTool = async function (tool: string) {
      if (tool === "list_projects") return { projects: [{ name: PETCLINIC, root_path: CODEBASE_ROOT }] };
      return payload("trace_path.not-found");
    };
    await expect(analyzer.callers(CODEBASE_ROOT, "nonexistentThing")).rejects.toThrow(
      "Symbol not found in the code graph: nonexistentThing"
    );
  });

  it("query(): surfaces a Cypher error as a query failure", async () => {
    StdioClient.prototype.invokeTool = async function (tool: string) {
      if (tool === "list_projects") return { projects: [{ name: PETCLINIC, root_path: CODEBASE_ROOT }] };
      return "expected token type 87, got 85 at pos 39";
    };
    await expect(analyzer.query(CODEBASE_ROOT, "MATCH (n) RETURN n LIMIT x")).rejects.toThrow(
      "Query failed: expected token type 87"
    );
  });
});
