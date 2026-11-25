/**
 * changeset_commit_preview on a changeset that is already landed answers that it is (#1441): when
 * it landed, the files it wrote and whether git has them, not an error that reads as if the wrong
 * changeset was named. And a preview of a changeset staged into moments ago says writes may still
 * be arriving (#1437).
 */

import { describe, it, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetCommitPreviewHandler } from "../../../src/mcp/tools/changeset-commit.js";
import { recentWritesWarning } from "../../../src/mcp/tools/changeset-landed.js";

async function newProject(): Promise<string> {
  clearModelCache();
  const rootPath = join(tmpdir(), `dr-already-landed-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Already Landed", version: "0.1.0" });
  return rootPath;
}

function git(rootPath: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: rootPath, stdio: "ignore" });
}

const parse = (result: { content: Array<{ text?: string }> }) => JSON.parse(result.content[0].text!);

describe("changeset_commit_preview on a changeset already landed (#1441)", () => {
  it("answers that it is landed, with when, its files and whether git has them", async () => {
    const rootPath = await newProject();
    try {
      git(rootPath, "init", "-q");
      await changesetCreateHandler({ name: "dr-milestone-wording", rootPath });
      await modelAddHandler({ layer: "motivation", type: "goal", name: "Clear wording", attributes: { priority: "high" }, rootPath });
      clearModelCache();
      const model = await Model.load(rootPath, { lazyLoad: false });
      const manager = new StagingAreaManager(model.rootPath, model);
      const plan = (await manager.load("dr-milestone-wording"))!;
      await manager.commit(model, plan.id!, { validate: true });
      clearModelCache();

      const result = await changesetCommitPreviewHandler({ changeset: "dr-milestone-wording", rootPath });
      expect(result.isError).toBeFalsy();
      const landed = parse(result);
      expect(landed.status).toBe("already-landed");
      expect(landed.name).toBe("dr-milestone-wording");
      expect(typeof landed.landedAt).toBe("string");
      expect(landed.nothingToDo).toContain("already landed");
      expect(landed.files).toContain(join("documentation-robotics", "model", "01_motivation", "goal.yaml"));
      expect(landed.git.committed).toBe(false);
      expect(landed.git.uncommitted.length).toBeGreaterThan(0);

      // Once the model is committed, git says so.
      git(rootPath, "add", "-A");
      git(rootPath, "commit", "-q", "-m", "model");
      expect(parse(await changesetCommitPreviewHandler({ changeset: "dr-milestone-wording", rootPath })).git).toEqual({
        committed: true,
      });
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("warns when changes were staged into the changeset moments ago", async () => {
    const rootPath = await newProject();
    try {
      await changesetCreateHandler({ name: "plan", rootPath });
      await modelAddHandler({ layer: "motivation", type: "goal", name: "Fresh", attributes: { priority: "high" }, rootPath });
      clearModelCache();
      const preview = parse(await changesetCommitPreviewHandler({ changeset: "plan", rootPath }));
      expect(preview.status).toBe("ready-to-commit");
      expect(preview.stillWriting).toContain("A change was staged into 'plan'");
      expect(preview.stillWriting).toContain("refused (never lost)");

      const manager = new StagingAreaManager(rootPath);
      const plan = (await manager.load("plan"))!;
      // Long enough ago, nothing to say.
      expect(await recentWritesWarning(manager.changesetPath(plan.id!), plan, Date.parse(plan.modified) + 120_000)).toBeUndefined();
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});
