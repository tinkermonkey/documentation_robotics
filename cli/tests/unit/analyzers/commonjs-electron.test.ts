/**
 * Tier 0 on plain CommonJS and Electron code (#1320): a function its module does not export is not
 * an element, an `ipcMain` registration is an application service, and the exports a CommonJS
 * module states in its text are read.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { collectExtraction, extractionConfigFrom } from "../../../src/analyzers/cards/extract.js";
import { collectIpcHandlers, readIpcHandlers } from "../../../src/analyzers/cards/ipc.js";
import { handStagedNote, thinAsBuiltWarning } from "../../../src/core/changeset-verify.js";
import { exportedElsewhere } from "../../../src/analyzers/cards/visibility.js";
import { evaluateTier0, tier0RulesFrom } from "../../../src/analyzers/tier0-rules.js";
import type { CardGraph, GraphNode } from "../../../src/analyzers/cards/index.js";
import type { AnalyzerHeuristic } from "../../../src/analyzers/types.js";

const CBM = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../spec/dist/analyzers/cbm.json"), "utf-8"));
const RULES = tier0RulesFrom(CBM.heuristics.heuristics as AnalyzerHeuristic[]);
const CONFIG = extractionConfigFrom(RULES, Object.values(CBM.edges_by_type), Object.values(CBM.nodes_by_label));

const MAIN = `const { app, ipcMain } = require("electron");
const store = require("./store");

function readFile(path) {
  return store.read(path);
}

function notify(win, text) {
  win.webContents.send("notice", text);
}

function register() {
  ipcMain.handle('files:read', async (event, path) => readFile(path));
  ipcMain.handle("files:write", async (event, path, body) => store.write(path, body));
  ipcMain.on('app:quit', () => app.quit());
  ipcMain.handle(CHANNELS.list, async () => store.list());
}

module.exports = { register, notify: notify };
`;

const RENDERER = `const api = window.api;
function render(files) {
  return files.map((f) => f.name);
}
exports.render = render;
`;

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "dr-cjs-"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

/** Functions as the graph gives them: name, file and line range read from the text. */
function functionsIn(files: Record<string, string>): GraphNode[] {
  const nodes: GraphNode[] = [];
  for (const [file, text] of Object.entries(files)) {
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      const m = /^function\s+(\w+)/.exec(line);
      if (!m) return;
      const end = lines.findIndex((l, j) => j >= i && l === "}");
      nodes.push({ label: "Function", name: m[1], qualified_name: `p.${file.replace(/\W+/g, ".")}.${m[1]}`, file_path: file, start_line: i + 1, end_line: end + 1 });
    });
  }
  return nodes;
}

function graph(files: Record<string, string>): CardGraph {
  const functions = functionsIn(files);
  return {
    project: "p",
    async search(label) {
      return label === "Function" ? functions : [];
    },
    async rows(cypher) {
      if (/MATCH \(f:File\)/.test(cypher)) return Object.keys(files).map((f) => [f]);
      return [];
    },
    async snippet() {
      return null;
    },
  };
}

describe("a function its CommonJS module does not export is not an element", () => {
  const files = { "src/main.js": MAIN, "src/renderer.js": RENDERER };

  it("rejects the private helpers by rule and leaves the exported functions undecided", async () => {
    const extraction = await collectExtraction(graph(files), CONFIG, "cbm", { sourceRoot: project(files) });
    const byName = Object.fromEntries(extraction.symbols.filter((s) => s.card.label === "Function").map((s) => [s.card.name, s]));
    // readFile is called but never exported; notify and register are exported by `module.exports = {...}`; render by `exports.render = render`.
    expect(byName.readFile.tier0).toMatchObject({ kind: "reject", rule: "tier0_js_unexported_function" });
    expect(byName.register.tier0).toBeNull();
    expect(byName.notify.tier0).toBeNull();
    expect(byName.render.tier0).toBeNull();
    expect(byName.readFile.triage?.visibility).toBe("local");
    expect(byName.register.triage?.visibility).toBe("exported");
  });

  it("does not reject a function in a TypeScript file (the rule is for JavaScript modules)", async () => {
    const ts = { "src/util.ts": "function helper() {\n  return 1;\n}\n" };
    const extraction = await collectExtraction(graph(ts), CONFIG, "cbm", { sourceRoot: project(ts) });
    expect(extraction.symbols[0].tier0).toBeNull();
  });

  it("a rule with a visibility condition never matches a symbol whose visibility is unknown", () => {
    const rules = RULES.filter((r) => r.name === "tier0_js_unexported_function");
    const symbol = { label: "Function", name: "x", file_path: "a.js", declaration: "function x() {" };
    expect(evaluateTier0(symbol, rules)).toBeNull();
    expect(evaluateTier0({ ...symbol, visibility: "local" }, rules)?.kind).toBe("reject");
    expect(evaluateTier0({ ...symbol, visibility: "exported" }, rules)).toBeNull();
  });
});

describe("CommonJS exports are read from the file's text", () => {
  it.each([
    ["module.exports = { a, b };", "b", true],
    ["module.exports = a;", "a", true],
    ["exports.a = function () {};", "a", true],
    ["module.exports.a = a;", "a", true],
    ["exports.alias = a;", "a", true],
    ["module.exports = { alias: a };", "a", true],
    ["module.exports = {\n  a() { return 1; },\n  b() { return { x: 1 }; },\n  c,\n};", "c", true],
    ["module.exports = { nested: { a }, other };", "a", false],
    ["Object.assign(module.exports, { a });", "a", true],
    ["module.exports = wrap(a);", "a", true],
    ["exports.x = a || b;", "a", true],
    ["module.exports = { b };", "a", false],
    ["// exports.a = 1\nconst x = 1;", "x", false],
  ])("%s exports %s: %s", (text, name, exported) => {
    expect(exportedElsewhere(text, name)).toBe(exported);
  });
});

describe("when the file cannot be read, not exported is unknown", () => {
  it("never rejects a CommonJS function without a source root", async () => {
    const files = { "src/main.js": MAIN };
    const extraction = await collectExtraction(graph(files), CONFIG, "cbm", {});
    const read = extraction.symbols.find((s) => s.card.name === "readFile")!;
    expect(read.tier0).toBeNull();
  });
});

describe("ipcMain registrations are application services", () => {
  it("ignores commented-out registrations and reads a channel once across files", () => {
    const commented = "// ipcMain.handle('old:one', f)\n/* ipcMain.on('old:two', f) */\nipcMain.handle('live', f);";
    expect(readIpcHandlers(commented).handlers.map((h) => h.channel)).toEqual(["live"]);
    const text = () => "ipcMain.handle('same', f);";
    expect(collectIpcHandlers(["b.js", "a.js"], text).handlers.map((h) => h.file)).toEqual(["a.js"]);
  });

  it("reads handle and on registrations with a literal channel, and says when a channel isn't one", () => {
    const read = readIpcHandlers(MAIN);
    expect(read.handlers).toEqual([
      { kind: "handle", channel: "files:read", line: 13 },
      { kind: "handle", channel: "files:write", line: 14 },
      { kind: "on", channel: "app:quit", line: 15 },
    ]);
    expect(read.partial).toBe(true);
  });

  it("leaves tests, vendored code and files that never mention ipcMain alone", () => {
    const text = (f: string) => (f === "renderer.js" ? RENDERER : MAIN);
    const found = collectIpcHandlers(["main.js", "renderer.js", "tests/main.test.js", "node_modules/x/main.js"], text);
    expect(found.handlers.map((h) => h.file)).toEqual(["main.js", "main.js", "main.js"]);
    expect(found.partialFiles).toEqual(["main.js"]);
  });

  it("extraction stages a card per channel, decided as application.applicationservice, and lists the file with a constant channel", async () => {
    const files = { "src/main.js": MAIN, "src/renderer.js": RENDERER };
    const extraction = await collectExtraction(graph(files), CONFIG, "cbm", { sourceRoot: project(files) });
    const ipc = extraction.symbols.filter((s) => s.card.label === "IpcHandler");
    expect(ipc.map((s) => s.card.name)).toEqual(["files:read", "files:write", "app:quit"]);
    expect(ipc.every((s) => s.tier0?.kind === "decide" && s.tier0.layer === "application" && s.tier0.type === "applicationservice")).toBe(true);
    expect(ipc[0].card.file_path).toBe("src/main.js");
    expect(ipc[0].card.start_line).toBe(13);
    expect(extraction.ipcPartial).toEqual(["src/main.js"]);
  });
});

describe("changeset_verify says an as-built side staged by hand from cards is not thin (#1320)", () => {
  const missing = ["a", "b", "c"].map((x) => ({ planned: { source: `x.${x}`, target: `y.${x}`, predicate: "serves" } }));
  const report = { elements: { matched: [], divergent: [] }, relationships: { missing } } as never;
  const built = { elements: [] } as never;
  const share = (fromCards?: number) =>
    ({ elements: { total: 4, byProvenance: {}, fromExtraction: 4, ...(fromCards ? { fromCards } : {}), agentAdded: 0 } }) as never;

  it("gives a note, not the thin warning, when most elements were staged from cards", () => {
    expect(thinAsBuiltWarning(report, built, share(3))).toBeUndefined();
    expect(handStagedNote(report, built, share(3))).toContain("staged by hand from extraction's own cards");
  });

  it("still warns when the as-built side is thin and was not staged from cards", () => {
    expect(thinAsBuiltWarning(report, built, share())).toContain("the as-built changeset is thin");
    expect(handStagedNote(report, built, share())).toBeUndefined();
  });
});
