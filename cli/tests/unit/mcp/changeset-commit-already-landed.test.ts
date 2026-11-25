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
import {
  clearChangesetWrites,
  writeActivityWarning,
  recordChangesetWrite,
  runAsWriter,
  RECENT_OTHER_WRITE_MS,
} from "../../../src/core/changeset-write-activity.js";
import { utimes } from "node:fs/promises";
import { FileLock } from "../../../src/utils/file-lock.js";

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
      // A type of two words: its file is application_function.yaml, not applicationfunction.yaml.
      await modelAddHandler({ layer: "application", type: "applicationfunction", name: "word wrap", rootPath });
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
      const functions = join("documentation-robotics", "model", "05_application", "application_function.yaml");
      expect(landed.files).toContain(functions);
      expect(landed.git.committed).toBe(false);
      // Every file it names is on disk, and git sees the multi-word one as uncommitted.
      expect(landed.git.uncommitted).toContain(functions);

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

  it("warns on evidence of a writer at work, not on the caller's own recent writes (#1437)", async () => {
    const rootPath = await newProject();
    try {
      await changesetCreateHandler({ name: "plan", rootPath });
      await modelAddHandler({ layer: "motivation", type: "goal", name: "Fresh", attributes: { priority: "high" }, rootPath });
      clearModelCache();
      // The agent's own write moments ago, in this process: no warning.
      const preview = parse(await changesetCommitPreviewHandler({ changeset: "plan", rootPath }));
      expect(preview.status).toBe("ready-to-commit");
      expect(preview.stillWriting).toBeUndefined();

      const manager = new StagingAreaManager(rootPath);
      const plan = (await manager.load("plan"))!;
      const folder = manager.changesetPath(plan.id!);
      // An agent's MCP session staged into it moments ago, and the person is about to Apply in the
      // viewer, which the same central process serves: a warning naming the session.
      const at = Date.now();
      await runAsWriter("mcp:agent-1", () => recordChangesetWrite(rootPath, plan.id!));
      const other = await writeActivityWarning(rootPath, folder, plan, { writer: "viewer", now: at + 5_000 });
      expect(other).toContain("An agent's MCP session (agent-1) staged into 'plan' 5 s ago");
      expect(other).toContain("refused (never lost)");
      // Another session previewing sees it too; the session itself doesn't.
      expect(await writeActivityWarning(rootPath, folder, plan, { writer: "mcp:agent-2", now: at + 5_000 })).toContain("agent-1");
      expect(await writeActivityWarning(rootPath, folder, plan, { writer: "mcp:agent-1", now: at + 5_000 })).toBeUndefined();
      // Long enough ago, it is not evidence.
      expect(await writeActivityWarning(rootPath, folder, plan, { writer: "viewer", now: at + RECENT_OTHER_WRITE_MS + 1_000 })).toBeUndefined();

      // A write holding the changeset's lock now: a warning; a landing's own hold is not a write.
      await clearChangesetWrites(rootPath, plan.id!);
      const lock = new FileLock(folder);
      await lock.acquire();
      try {
        expect(await writeActivityWarning(rootPath, folder, plan)).toContain("Something is writing into 'plan' now");
        const summary = parse(await changesetCommitPreviewHandler({ changeset: "plan", rootPath }));
        expect(summary.stillWriting).toContain("writing into 'plan' now");
        expect(summary.summary).toContain("writing into 'plan' now");
      } finally {
        await lock.release();
      }
      await lock.acquire({ owner: { purpose: "landing" } });
      try {
        expect(await writeActivityWarning(rootPath, folder, plan)).toBeUndefined();
      } finally {
        await lock.release();
      }
      // A lock a crashed writer left behind is stale, not a write in progress.
      await lock.acquire();
      try {
        const old = new Date(Date.now() - 60_000);
        await utimes(`${folder}.lock`, old, old);
        expect(await writeActivityWarning(rootPath, folder, plan)).toBeUndefined();
      } finally {
        await lock.release();
      }
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});
