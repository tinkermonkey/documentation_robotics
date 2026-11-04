/**
 * CbmAnalyzer.classify: Tier-0 classification through a patched StdioClient answering in
 * codebase-memory-mcp 0.12's grouped JSON shapes.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { CbmAnalyzer } from "@/analyzers/cbm-analyzer.js";
import { MappingLoader } from "@/analyzers/mapping-loader.js";
import { StdioClient } from "@/analyzers/stdio-client.js";

const PROJECT = "Users-me-spring-petclinic";
const ROOT = "/nonexistent/spring-petclinic";
const PKG = `${PROJECT}.src.main.java.owner`;
const FILE = "src/main/java/owner/OwnerController.java";

const SEARCH: Record<string, unknown> = {
  Class: {
    qn_rule: "qn_prefix + '.' + name",
    cols: ["name", "label", "lines", "in", "out"],
    groups: [{ qn_prefix: PKG, file: FILE, rows: [["OwnerController", "Class", "10-80", 0, 3]] }],
    has_more: false,
  },
  Method: {
    cols: ["name", "label", "lines", "in", "out", "signature", "parent_class"],
    groups: [{ qn_prefix: `${PKG}.OwnerController`, file: FILE, rows: [["showOwner", "Method", "40-52", 1, 1, "(int id)", `${PKG}.OwnerController`]] }],
    has_more: false,
  },
};

describe("CbmAnalyzer.classify", () => {
  const original = {
    spawn: StdioClient.prototype.spawn,
    close: StdioClient.prototype.close,
    initialize: StdioClient.prototype.initialize,
    invokeTool: StdioClient.prototype.invokeTool,
  };
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  let closed = 0;
  let analyzer: CbmAnalyzer;

  beforeEach(async () => {
    analyzer = new CbmAnalyzer(await MappingLoader.load("cbm"));
    (analyzer as any).status = async () => ({
      indexed: true,
      fresh: true,
      detected: { installed: true, binary_path: "/bin/mock", contract_ok: true, mcp_registered: false },
    });
    calls.length = 0;
    closed = 0;
    StdioClient.prototype.spawn = function () { /* noop */ };
    StdioClient.prototype.close = function () { closed++; };
    StdioClient.prototype.initialize = async function () { return { capabilities: {} } as any; };
    StdioClient.prototype.invokeTool = async function (tool: string, params?: unknown) {
      const args = (params ?? {}) as Record<string, unknown>;
      calls.push({ tool, args });
      if (tool === "list_projects") return { projects: [{ name: PROJECT, root_path: ROOT }], has_more: false };
      if (tool === "search_graph") {
        return SEARCH[String(args.label)] ?? { cols: ["name"], groups: [], has_more: false };
      }
      if (tool === "query_graph") {
        const q = String(args.query);
        if (q.includes("decorators IS NOT NULL")) {
          return { columns: ["b.qualified_name", "b.decorators"], rows: [[`${PKG}.OwnerController`, '["@Controller"]'], [`${PKG}.OwnerController.showOwner`, '["@GetMapping(\\"/owners/{id}\\")"]']], has_more: false };
        }
        return { columns: [], rows: [], has_more: false };
      }
      if (tool === "get_code_snippet") {
        if (String(args.qualified_name).endsWith(".showOwner")) return { source: '@GetMapping("/owners/{id}")\npublic String showOwner(int id) {' };
        return { error: "function not found" };
      }
      throw new Error(`unexpected tool ${tool}`);
    };
  });

  afterEach(() => {
    Object.assign(StdioClient.prototype, original);
  });

  it("classifies the project's symbols with the mapping's Tier-0 rules", async () => {
    const report = await analyzer.classify(ROOT, { codebaseRoot: ROOT });
    expect(report.project).toBe(PROJECT);
    expect(report.rules).toBeGreaterThan(10);
    const outcome = Object.fromEntries(report.results.map((r) => [r.qualified_name, r.tier0?.kind === "decide" ? `${r.tier0.layer}.${r.tier0.type}` : r.tier0?.kind ?? null]));
    expect(outcome).toEqual({
      "src.main.java.owner.OwnerController": "application.applicationinterface",
      "src.main.java.owner.OwnerController.showOwner": "application.applicationfunction",
    });
    // The controller's source was not found: the card has none, and the decorator still decides it.
    expect(report.results[0]).toMatchObject({ start_line: 10, end_line: 80 });
    expect(report.summary).toMatchObject({ cards: 2, decided: 2 });
  });

  it("asks CBM for JSON on every call, searches the project, and closes the client", async () => {
    await analyzer.classify(ROOT, { codebaseRoot: ROOT, labels: ["Method"] });
    expect(calls.every((c) => c.args.format === "json")).toBe(true);
    const searches = calls.filter((c) => c.tool === "search_graph");
    expect(searches.map((c) => c.args.label)).toEqual(["Method"]);
    expect(searches[0].args.project).toBe(PROJECT);
    expect(closed).toBe(1);
  });

  it("rejects unknown labels before contacting CBM", async () => {
    await expect(analyzer.classify(ROOT, { labels: ["class"] })).rejects.toThrow(/Unknown label: class/);
    expect(calls).toEqual([]);
  });

  it("refuses an unindexed project", async () => {
    (analyzer as any).status = async () => ({ indexed: false, fresh: false, detected: { installed: true, binary_path: "/bin/mock" } });
    await expect(analyzer.classify(ROOT)).rejects.toThrow(/not indexed/);
  });
});
