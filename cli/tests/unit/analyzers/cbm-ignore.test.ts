/**
 * ensureCbmIgnore: codebase-memory-mcp has no exclude argument, so DR keeps its own folders
 * (documentation-robotics/, .dr/) out of the index through a .cbmignore at the codebase root
 * (round 2, bug 9: an uncommitted changeset grew the index from 5,375 to 5,525 nodes).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureCbmIgnore } from "../../../src/analyzers/cbm-analyzer.js";

let root: string;

beforeEach(async () => {
  root = join(tmpdir(), `dr-cbmignore-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("ensureCbmIgnore", () => {
  it("creates the file with DR's folders when there is none", async () => {
    const result = await ensureCbmIgnore(root, root);
    expect(result).toEqual({ path: join(root, ".cbmignore"), added: ["/documentation-robotics/", "/.dr/"], created: true });
    const text = await readFile(join(root, ".cbmignore"), "utf-8");
    expect(text).toMatch(/^# Added by Documentation Robotics/);
    expect(text.endsWith("/documentation-robotics/\n/.dr/\n")).toBe(true);
  });

  it("changes nothing the second time", async () => {
    await ensureCbmIgnore(root, root);
    const before = await readFile(join(root, ".cbmignore"), "utf-8");
    expect(await ensureCbmIgnore(root, root)).toEqual({ path: join(root, ".cbmignore"), added: [], created: false });
    expect(await readFile(join(root, ".cbmignore"), "utf-8")).toBe(before);
  });

  it("keeps the developer's lines, and adds only the folders they don't list in any spelling", async () => {
    await writeFile(join(root, ".cbmignore"), "fixtures/\ndocumentation-robotics");
    const result = await ensureCbmIgnore(root, root);
    expect(result.added).toEqual(["/.dr/"]);
    const text = await readFile(join(root, ".cbmignore"), "utf-8");
    expect(text.startsWith("fixtures/\ndocumentation-robotics\n\n# Added by Documentation Robotics")).toBe(true);
    expect(text.endsWith("/.dr/\n")).toBe(true);
  });

  it("names the folders relative to a codebase root above the project", async () => {
    const project = join(root, "services", "api");
    const result = await ensureCbmIgnore(root, project);
    expect(result.added).toEqual(["/services/api/documentation-robotics/", "/services/api/.dr/"]);
  });

  it("does nothing when DR's folders lie outside the codebase root", async () => {
    const code = join(root, "src");
    await mkdir(code);
    expect((await ensureCbmIgnore(code, root)).added).toEqual([]);
    expect(await Bun.file(join(code, ".cbmignore")).exists()).toBe(false);
  });
});
