/**
 * The analyzer version that built an index: read from the binary, recorded in index-meta.json, and
 * an index another version built is stale (an analyzer upgrade can change the graph's format and
 * qualified names; codebase-memory-mcp 0.11, 0.12.0 and 0.12.1 each forced a rebuild).
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { analyzerChanged, parseVersion } from "@/analyzers/version.js";
import { readIndexMeta, writeIndexMeta } from "@/analyzers/session-state.js";
import { CbmAnalyzer } from "@/analyzers/cbm-analyzer.js";
import { MappingLoader } from "@/analyzers/mapping-loader.js";

describe("parseVersion", () => {
  it("reads the version CBM prints and reports", () => {
    expect(parseVersion("codebase-memory-mcp 0.12.1\n")).toBe("0.12.1");
    expect(parseVersion("0.12.1")).toBe("0.12.1");
    expect(parseVersion("v0.13.0-rc.1")).toBe("0.13.0-rc.1");
  });
  it("is null without one", () => {
    expect(parseVersion("codebase-memory-mcp")).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
    expect(parseVersion(12)).toBeNull();
  });
});

describe("analyzerChanged", () => {
  it("is a change only when both versions are known and differ", () => {
    expect(analyzerChanged({ analyzer_version: "0.12.0" }, "0.12.1")).toBe(true);
    expect(analyzerChanged({ analyzer_version: "0.12.0" }, { version: "0.12.1" })).toBe(true);
    expect(analyzerChanged({ analyzer_version: "0.12.1" }, "0.12.1")).toBe(false);
    // An index from before DR recorded the version, or a binary that reports none.
    expect(analyzerChanged({}, "0.12.1")).toBe(false);
    expect(analyzerChanged({ analyzer_version: "0.12.1" }, { version: undefined })).toBe(false);
    expect(analyzerChanged({ analyzer_version: "0.12.1" }, null)).toBe(false);
  });
});

describe("index metadata records the analyzer version", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dr-analyzer-version-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const meta = { git_head: "abc", timestamp: "2026-11-12T00:00:00.000Z", node_count: 1, edge_count: 2 };

  it("round-trips analyzer_version, and reads metadata written without it", async () => {
    await writeIndexMeta({ ...meta, analyzer_version: "0.12.1" }, dir, "cbm");
    expect((await readIndexMeta(dir, "cbm"))?.analyzer_version).toBe("0.12.1");
    await writeIndexMeta(meta, dir, "cbm");
    const read = await readIndexMeta(dir, "cbm");
    expect(read).toEqual(meta);
  });

  it("status() calls an index from another CBM version stale at the same HEAD", async () => {
    const git = (...args: string[]) =>
      spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd: dir, encoding: "utf-8" }).stdout.trim();
    git("init", "-q");
    await writeFile(join(dir, "a.ts"), "export const a = 1;\n");
    git("add", ".");
    git("commit", "-qm", "init");
    const head = git("rev-parse", "HEAD");
    await writeIndexMeta({ ...meta, git_head: head, analyzer_version: "0.12.0" }, dir, "cbm");

    const analyzer = new CbmAnalyzer(await MappingLoader.load("cbm"));
    const installed = { version: "0.12.1" as string | undefined };
    (analyzer as any).detect = async () => ({ installed: true, binary_path: "/bin/mock", contract_ok: true, mcp_registered: false, version: installed.version });

    expect((await analyzer.status(dir)).fresh).toBe(false);
    installed.version = "0.12.0";
    expect((await analyzer.status(dir)).fresh).toBe(true);
    // A binary that reports no version leaves freshness to the commit.
    installed.version = undefined;
    expect((await analyzer.status(dir)).fresh).toBe(true);
  });
});
