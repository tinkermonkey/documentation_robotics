/**
 * project_init and project_upgrade handlers: where init creates the model, and the upgrade
 * preview's version path. The full flows over stdio are in
 * tests/integration/mcp-project-tools.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "yaml";
import { Model } from "../../../src/core/model.js";
import { markEnvProjectRoot, resetProjectRoot } from "../../../src/mcp/project-root.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { projectInitHandler, projectUpgradeHandler } from "../../../src/mcp/tools/project-tools.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";

let dir: string;

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

async function setSpecVersion(root: string, version: string): Promise<void> {
  const file = join(root, "documentation-robotics/model/manifest.yaml");
  const manifest = yaml.parse(await readFile(file, "utf8"));
  manifest.spec_version = version;
  await writeFile(file, yaml.stringify(manifest));
}

beforeEach(async () => {
  dir = join(tmpdir(), `dr-project-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  clearModelCache();
  resetProjectRoot();
});

afterEach(async () => {
  resetProjectRoot();
  clearModelCache();
  await rm(dir, { recursive: true, force: true });
});

describe("project_init", () => {
  it("won't create a model in the server's own working directory when the client named no folder", async () => {
    const result = await projectInitHandler({ name: "Nowhere" });
    expect(result.isError).toBe(true);
    expect(parse(result).suggestions.join(" ")).toContain("rootPath");
  });

  it("rejects a relative rootPath and a folder that doesn't exist", async () => {
    expect(parse(await projectInitHandler({ name: "X", rootPath: "relative/dir" })).error).toContain("absolute");
    expect(parse(await projectInitHandler({ name: "X", rootPath: join(dir, "missing") })).error).toContain("Not a folder");
  });

  it("creates the model in the folder a launcher pinned (DR_MCP_ROOT_PATH)", async () => {
    markEnvProjectRoot(dir);
    const result = await projectInitHandler({ name: "Pinned" });
    expect(result.isError).toBeFalsy();
    expect(parse(result).rootPath).toBe(dir);
    expect((await Model.load(dir)).manifest.name).toBe("Pinned");
  });
});

describe("project_upgrade", () => {
  it("previews the whole version path, marking the steps that rewrite the catalog", async () => {
    await Model.init(dir, { name: "Old", version: "0.1.0", specVersion: "0.8.4" });
    const result = await projectUpgradeHandler({ rootPath: dir });
    expect(result.isError).toBeFalsy();
    const body = parse(result);
    expect(body.status).toBe("preview");
    expect(body.steps[0]).toMatchObject({ from: "0.8.4", to: "0.9.0" });
    expect(body.steps.at(-1).to).toBe(getCliBundledSpecVersion());
    expect(body.steps.filter((s: any) => s.rewritesCatalog).map((s: any) => s.to)).toContain("0.10.0");
    expect(body.actions.some((a: any) => a.type === "integration")).toBe(false);
    expect(yaml.parse(await readFile(join(dir, "documentation-robotics/model/manifest.yaml"), "utf8")).spec_version).toBe("0.8.4");
  });

  it("tells the agent to update dr when the model is newer than the spec it carries, and won't apply", async () => {
    await Model.init(dir, { name: "Future", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
    await setSpecVersion(dir, "99.0.0");

    const preview = parse(await projectUpgradeHandler({ rootPath: dir }));
    expect(preview.status).toBe("model-newer");
    expect(preview.message).toContain("Update dr");

    const applied = await projectUpgradeHandler({ rootPath: dir, apply: true });
    expect(applied.isError).toBe(true);
  });
});
