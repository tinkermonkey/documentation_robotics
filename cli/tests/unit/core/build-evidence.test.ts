/**
 * What the build's files say about a planned element extraction did not stage (build-evidence.ts):
 * something the code registers by a name string (#1226), and the files a planned add with no source
 * reference may live in (#1159).
 */
import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILD_FILE_LIMIT, nameSpellings, readBuildFiles, registeredByName, sourceCandidates, type BuildFile } from "../../../src/core/build-evidence.js";

const SERVER: BuildFile = {
  file: "src/mcp/server.ts",
  text: [
    'import { diffSetHandler } from "./tools/diff-set.js";',
    "export function register(server: McpServer) {",
    '  server.registerTool("diff_set", diffSetHandler);',
    "  server.tool('grid_lookup', lookup);",
    "}",
  ].join("\n"),
};
const HANDLER: BuildFile = { file: "src/mcp/tools/diff-set.ts", text: "export async function diffSetHandler(args: Args) {\n  return diffSet(args);\n}\n" };

const element = (id: string, name: string, file?: string, symbol?: string) => ({
  id,
  name,
  layer: id.split(".")[0],
  type: id.split(".")[1],
  ...(file ? { sourceReference: { provenance: "manual" as const, locations: [{ file, ...(symbol ? { symbol } : {}) }] } } : {}),
});

describe("nameSpellings", () => {
  it("gives the name as code may spell it, from the name and the id", () => {
    expect(nameSpellings(element("application.applicationservice.diff-set", "Diff set")).sort()).toEqual(["DiffSet", "diff-set", "diffSet", "diff_set"]);
    // A short single word matches too much to be evidence.
    expect(nameSpellings(element("application.applicationservice.run", "run"))).toEqual([]);
  });
});

describe("registeredByName (#1226)", () => {
  it("finds a tool the code registers by a name string, with no declaration of that name", () => {
    expect(registeredByName(element("application.applicationservice.diff-set", "diff_set"), [SERVER])).toEqual({
      file: "src/mcp/server.ts",
      string: "diff_set",
      line: 3,
      how: "call-argument",
    });
    // Single quotes, and a name given in words.
    expect(registeredByName(element("application.applicationservice.grid-lookup", "Grid lookup"), [SERVER])).toMatchObject({
      file: "src/mcp/server.ts",
      string: "grid_lookup",
      line: 4,
    });
  });

  it("finds one named by a property of a definition object", () => {
    const tool: BuildFile = { file: "src/tools/verify.ts", text: 'export const tool: McpToolDefinition = {\n  name: "codebase_verify",\n  handler,\n};\n' };
    expect(registeredByName(element("api.operation.codebase-verify", "codebase_verify"), [tool])).toEqual({
      file: "src/tools/verify.ts",
      string: "codebase_verify",
      line: 2,
      how: "name-property",
    });
    const decorated: BuildFile = { file: "server.py", text: '@mcp.tool(name="grid_lookup")\ndef lookup(cell):\n    return cell\n' };
    expect(registeredByName(element("application.applicationfunction.grid-lookup", "grid_lookup"), [decorated])).toMatchObject({ how: "name-property", line: 1 });
  });

  it("never applies to a type that is declared, not registered: a planned class that was never written stays missing", () => {
    // The review's case: the plan adds component AuditLog; the build only has track("AuditLog").
    const events: BuildFile = { file: "src/events.ts", text: 'export function record() {\n  bus.defineEvent("AuditLog");\n}\n' };
    expect(registeredByName(element("application.applicationcomponent.audit-log", "AuditLog", "src/events.ts"), [events])).toBeNull();
    expect(registeredByName(element("data-model.objectschema.audit-log", "AuditLog", "src/events.ts"), [events])).toBeNull();
    // The same text is evidence for a type that can be registered by name.
    expect(registeredByName(element("application.applicationevent.audit-log", "AuditLog", "src/events.ts"), [events])).toMatchObject({ string: "AuditLog", line: 2 });
  });

  it("reads code only: a name quoted in a document or a configuration file registers nothing", () => {
    const readme: BuildFile = { file: "docs/plan.md", text: "`RateLimiter` is not written yet. See register(\"rate_limiter\", h).\n" };
    const config: BuildFile = { file: "config/tools.json", text: '{ "name": "rate_limiter" }\n' };
    const yaml: BuildFile = { file: "deploy/jobs.yaml", text: 'name: "rate_limiter"\n' };
    expect(registeredByName(element("application.applicationservice.rate-limiter", "RateLimiter"), [readme, config, yaml])).toBeNull();
  });

  it("ignores the reviewer's non-registrations: lists, analytics, translations, assertions, storage, comments, templates, tests", () => {
    const fn = element("application.applicationfunction.send-invoice", "sendInvoice");
    const cases: BuildFile[] = [
      { file: "src/config.ts", text: 'export const menu = [{ name: "sendInvoice", label: "Send invoice" }];\n' },
      { file: "src/a.ts", text: '// see register("sendInvoice", h)\nexport const x = 1;\n' },
      { file: "src/b.ts", text: '/* name: "sendInvoice" */\nexport const y = 2;\n' },
      { file: "src/c.ts", text: "const label = `${'sendInvoice'}`;\nregister(`sendInvoice`, h);\n" },
      { file: "src/d.ts", text: 'analytics.track("sendInvoice");\nconst s = t("sendInvoice");\n' },
      { file: "src/e.ts", text: 'expect(names).toContain("sendInvoice");\nlocalStorage.getItem("sendInvoice");\n' },
      { file: "src/f.ts", text: 'dispatch({ type: "sendInvoice" });\n' },
      { file: "src/g.py", text: '# name="sendInvoice"\nx = 1\n' },
      { file: "tests/invoice.test.ts", text: 'it("sendInvoice", () => {});\nregister("sendInvoice", h);\n' },
    ];
    for (const file of cases) expect(registeredByName(fn, [file])).toBeNull();
    // And a quoted name is never offered as a place to adopt from.
    expect(sourceCandidates(fn, cases)).toEqual([]);
  });

  it("takes only a string used as a registration: a call's argument or a name property", () => {
    const service = element("application.applicationservice.diff-set", "diff_set");
    for (const text of [
      'if (tool === "diff_set") return;\n', // a comparison
      'const label = "diff_set";\n', // an assignment to something else
      'throw new Error(`unknown tool ${"diff_set"}`);\n', // inside a template
      'const names = ["diff_set"];\n', // a list of strings is not a registration
      '// TODO: add "diff_set" later\n', // prose
    ]) {
      expect(registeredByName(service, [{ file: "src/a.ts", text }])).toBeNull();
    }
    expect(registeredByName(service, [{ file: "src/a.ts", text: 'server.tool(\n  "diff_set",\n  handler\n);\n' }])).toMatchObject({ line: 2, how: "call-argument" });
    // An object passed to a registering call.
    expect(registeredByName(service, [{ file: "src/b.ts", text: 'server.registerTool({ name: "diff_set", handler });\n' }])).toMatchObject({ how: "name-property" });
    // A registering call's second argument is not the name it registers.
    expect(registeredByName(service, [{ file: "src/c.ts", text: 'register(handler, "diff_set");\n' }])).toBeNull();
  });

  it("is not one when a file declares or references the name as a symbol", () => {
    const declared: BuildFile = { file: "src/tools.ts", text: 'export const diff_set = tool("diff_set", handler);\n' };
    expect(registeredByName(element("application.applicationservice.diff-set", "diff_set"), [declared])).toBeNull();
    // The handler is a declaration extraction can see: the planned handler is missing or matched, never "registered by name".
    expect(registeredByName(element("application.applicationfunction.diff-set-handler", "diffSetHandler"), [SERVER, HANDLER])).toBeNull();
  });

  it("is not one when no file names it", () => {
    expect(registeredByName(element("application.applicationservice.merge-set", "merge_set"), [SERVER, HANDLER])).toBeNull();
  });

  it("takes a one-word name only from the element's own source file", () => {
    const flags: BuildFile = { file: "src/flags.ts", text: 'registerFlag("status");\n' };
    expect(registeredByName(element("application.applicationservice.status", "status"), [flags])).toBeNull();
    expect(registeredByName(element("application.applicationservice.status", "status", "src/flags.ts"), [flags])).toMatchObject({ file: "src/flags.ts", string: "status" });
  });

  it("looks for the element's source symbol, in its own file first", () => {
    const other: BuildFile = { file: "src/other.ts", text: 'log("tools/diff");\n' };
    const hit = registeredByName(element("application.applicationservice.diff-tool", "Diff tool", "src/mcp/server.ts", "diff_set"), [other, SERVER]);
    expect(hit).toMatchObject({ file: "src/mcp/server.ts", string: "diff_set" });
  });
});

describe("sourceCandidates (#1159)", () => {
  const files: BuildFile[] = [
    { file: "cli/src/mcp/tools/changeset-commit.ts", text: "export function confirmToken() {}\n// the commit confirmation token is checked here\n" },
    { file: "cli/src/core/commit-confirmation-token.ts", text: "export function issue() {}\n" },
    { file: "cli/tests/unit/commit-confirmation-token.test.ts", text: "import { issue } from '../src/core/commit-confirmation-token.js';\n" },
    { file: "cli/src/core/model.ts", text: "export class Model {}\n" },
    SERVER,
  ];

  it("ranks the build's files by how they name the element, and never offers a test", () => {
    const feature = element("product.feature.commit-confirmation-token", "Commit confirmation token");
    expect(sourceCandidates(feature, files)).toEqual([
      { file: "cli/src/core/commit-confirmation-token.ts", evidence: "file-name" },
      { file: "cli/src/mcp/tools/changeset-commit.ts", evidence: "mentions-words" },
    ]);
  });

  it("never offers a file that only quotes the name", () => {
    // A name the file only quotes is no evidence of where the code is: nothing is offered.
    expect(sourceCandidates(element("product.feature.diff-set", "Diff set"), files)).toEqual([]);
  });

  it("offers nothing for an element no file names", () => {
    expect(sourceCandidates(element("motivation.goal.faster-reviews", "Faster reviews"), files)).toEqual([]);
  });
});

describe("readBuildFiles", () => {
  // Each test makes its own repository: the suite runs concurrently.
  async function repo(): Promise<{ root: string; git: (...args: string[]) => unknown }> {
    const root = await realpath(await mkdtemp(join(tmpdir(), "dr-build-files-")));
    const git = (...args: string[]) => spawnSync("git", args, { cwd: root, stdio: "pipe" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "old.ts"), "export const old = 1;\n");
    await writeFile(join(root, "src", "plan.ts"), "export const plan = 1;\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "feature");
    return { root, git };
  }

  it("reads the files changed since the base, and the planned elements' own files", async () => {
    const { root, git } = await repo();
    try {
      await writeFile(join(root, "src", "server.ts"), 'server.registerTool("diff_set", h);\n');
      await writeFile(join(root, "package-lock.json"), "{}\n");
      await writeFile(join(root, "logo.png"), "not text");
      git("add", ".");
      git("commit", "-q", "-m", "build");
      const read = await readBuildFiles(root, "main", ["src/plan.ts", "src/gone.ts"]);
      // The plan's own file first; lock files, binaries and files that are gone are left out.
      expect(read.files.map((f) => f.file)).toEqual(["src/plan.ts", "src/server.ts"]);
      expect(read.note).toBeUndefined();

      // A file too large to search is named, so "missing" is never read as "looked everywhere".
      await writeFile(join(root, "src", "bundle.ts"), `export const blob = "${"x".repeat(600 * 1024)}";\n`);
      git("add", ".");
      git("commit", "-q", "-m", "bundle");
      const withLarge = await readBuildFiles(root, "main");
      expect(withLarge.files.map((f) => f.file)).toEqual(["src/server.ts"]);
      expect(withLarge.note).toContain("1 file(s) over 512 KB were not searched");
      expect(withLarge.note).toContain("src/bundle.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("names how many files were not searched when the build changed more than it reads", async () => {
    const { root, git } = await repo();
    try {
      await mkdir(join(root, "src", "gen"), { recursive: true });
      for (let i = 0; i < BUILD_FILE_LIMIT + 3; i++) await writeFile(join(root, "src", "gen", `f${String(i).padStart(4, "0")}.ts`), `export const v${i} = ${i};\n`);
      git("add", ".");
      git("commit", "-q", "-m", "many");
      const read = await readBuildFiles(root, "main");
      expect(read.files).toHaveLength(BUILD_FILE_LIMIT);
      expect(read.note).toContain(`${BUILD_FILE_LIMIT + 3} files changed in the build; the first ${BUILD_FILE_LIMIT}`);
      expect(read.note).toContain("the other 3 were not");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("says so when the range can't be listed, and still reads the planned elements' files", async () => {
    const { root } = await repo();
    try {
      const read = await readBuildFiles(root, "no-such-ref", ["src/plan.ts"]);
      expect(read.files.map((f) => f.file)).toEqual(["src/plan.ts"]);
      expect(read.note).toContain("could not be listed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
