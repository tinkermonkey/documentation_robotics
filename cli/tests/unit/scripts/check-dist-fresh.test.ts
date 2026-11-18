import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  defaultPaths,
  distStaleReason,
  newestFile
} from "../../../scripts/check-dist-fresh.js";

function writeAt(file: string, mtimeSec: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "x");
  fs.utimesSync(file, mtimeSec, mtimeSec);
}

describe("check-dist-fresh", () => {
  let root: string;
  let cliDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "dist-fresh-"));
    cliDir = path.join(root, "cli");
    writeAt(path.join(cliDir, "src", "cli.ts"), 1000);
    writeAt(path.join(root, "integrations", "claude_code", "skill.md"), 1000);
    writeAt(path.join(root, "spec", "dist", "api.json"), 1000);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reports dist as stale when dist/cli.js is missing", () => {
    expect(distStaleReason(defaultPaths(cliDir))).toContain("is missing");
  });

  it("reports dist as fresh when it is newer than every source", () => {
    writeAt(path.join(cliDir, "dist", "cli.js"), 2000);
    expect(distStaleReason(defaultPaths(cliDir))).toBeNull();
  });

  it.each([
    ["a CLI source file", ["cli", "src", "commands", "analyzer.ts"]],
    ["an integration file", ["integrations", "claude_code", "skill.md"]],
    ["a compiled spec file", ["spec", "dist", "api.json"]]
  ])("reports dist as stale when %s is newer", (_label, parts) => {
    writeAt(path.join(cliDir, "dist", "cli.js"), 2000);
    const changed = path.join(root, ...parts);
    writeAt(changed, 3000);
    const reason = distStaleReason(defaultPaths(cliDir));
    expect(reason).toContain(changed);
    expect(reason).toContain("is newer than");
  });

  it("ignores src/generated, which the build itself writes", () => {
    writeAt(path.join(cliDir, "dist", "cli.js"), 2000);
    writeAt(path.join(cliDir, "src", "generated", "registry.ts"), 3000);
    expect(distStaleReason(defaultPaths(cliDir))).toBeNull();
  });

  it("ignores dotfiles", () => {
    writeAt(path.join(cliDir, "dist", "cli.js"), 2000);
    writeAt(path.join(cliDir, "src", ".DS_Store"), 3000);
    expect(distStaleReason(defaultPaths(cliDir))).toBeNull();
  });

  it("newestFile skips missing directories and returns null when there are no files", () => {
    expect(newestFile([path.join(root, "nope")])).toBeNull();
    const found = newestFile([path.join(root, "nope"), path.join(root, "spec")]);
    expect(found?.file).toBe(path.join(root, "spec", "dist", "api.json"));
  });
});
