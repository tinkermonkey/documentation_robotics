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
