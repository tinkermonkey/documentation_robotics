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
import { nameSpellings, readBuildFiles, registeredByName, sourceCandidates, type BuildFile } from "../../../src/core/build-evidence.js";

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
    expect(registeredByName(element("application.applicationservice.diff-set", "diff_set"), [SERVER])).toEqual({ file: "src/mcp/server.ts", string: "diff_set" });
    // Single quotes, and a name given in words.
    expect(registeredByName(element("application.applicationservice.grid-lookup", "Grid lookup"), [SERVER])).toEqual({ file: "src/mcp/server.ts", string: "grid_lookup" });
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
    const flags: BuildFile = { file: "src/flags.ts", text: 'enable("status");\n' };
    expect(registeredByName(element("application.applicationservice.status", "status"), [flags])).toBeNull();
    expect(registeredByName(element("application.applicationservice.status", "status", "src/flags.ts"), [flags])).toEqual({ file: "src/flags.ts", string: "status" });
  });

  it("looks for the element's source symbol, in its own file first", () => {
    const other: BuildFile = { file: "src/other.ts", text: 'log("tools/diff");\n' };
    const hit = registeredByName(element("application.applicationservice.diff-tool", "Diff tool", "src/mcp/server.ts", "diff_set"), [other, SERVER]);
    expect(hit).toEqual({ file: "src/mcp/server.ts", string: "diff_set" });
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

  it("ranks the build's files by how they name the element: the code before its tests", () => {
    const feature = element("product.feature.commit-confirmation-token", "Commit confirmation token");
    expect(sourceCandidates(feature, files)).toEqual([
      { file: "cli/src/core/commit-confirmation-token.ts", evidence: "file-name" },
      { file: "cli/src/mcp/tools/changeset-commit.ts", evidence: "mentions-words" },
      { file: "cli/tests/unit/commit-confirmation-token.test.ts", evidence: "file-name" },
    ]);
  });

  it("offers the string a tool is registered by as its symbol", () => {
    expect(sourceCandidates(element("product.feature.diff-set", "Diff set"), files)).toEqual([
      { file: "src/mcp/server.ts", symbol: "diff_set", evidence: "named-as-string" },
    ]);
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
