/**
 * Unit tests for the project_status MCP tool, over real projects on disk and real git repos.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { realpathSync } from "node:fs";
import { writeViewerRecord } from "../../../src/server/viewer-registry.js";
import { Model } from "../../../src/core/model.js";
import { clearModelCache, loadModel } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { changesetCreateHandler, changesetDeactivateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import {
  clearProjectStatusSignatures,
  projectStatusHandler,
  suggestNextStep,
} from "../../../src/mcp/tools/project-status.js";
import { markEnvProjectRoot, resetProjectRoot } from "../../../src/mcp/project-root.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";

const SERVICE = "application.applicationservice.checkout";

async function status(rootPath?: string): Promise<any> {
  const result = await projectStatusHandler(rootPath === undefined ? {} : { rootPath });
  if (result.isError) throw new Error((result.content[0] as { text: string }).text);
  return JSON.parse((result.content[0] as { text: string }).text);
}

async function ok(result: any): Promise<any> {
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8" }
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function setSpecVersion(rootPath: string, version: string): Promise<void> {
  const manifest = join(rootPath, "documentation-robotics", "model", "manifest.yaml");
  const text = await readFile(manifest, "utf-8");
  expect(text).toMatch(/^spec_version:/m);
  await writeFile(manifest, text.replace(/^spec_version:.*$/m, `spec_version: "${version}"`));
}

/** An index by the active analyzer, cbm, built at `head`. */
async function writeIndex(rootPath: string, head: string): Promise<void> {
  const analyzers = join(rootPath, ".dr", "analyzers");
  await mkdir(join(analyzers, "cbm"), { recursive: true });
  await writeFile(
    join(analyzers, "session.json"),
    JSON.stringify({ active_analyzer: "cbm", selected_at: "2026-11-09T00:00:00Z" })
  );
  await writeFile(
    join(analyzers, "cbm", "index-meta.json"),
    JSON.stringify({ git_head: head, timestamp: "2026-11-09T00:00:00Z", node_count: 10, edge_count: 4 })
  );
}

/** A model whose one service references src/checkout.ts. */
async function initModel(rootPath: string): Promise<void> {
  await Model.init(rootPath, { name: "Status Test Model", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
  await ok(
    await modelAddHandler({
      layer: "application",
      type: "applicationservice",
      name: "checkout",
      attributes: { serviceType: "synchronous" },
      sourceFile: "src/checkout.ts",
      sourceProvenance: "manual",
      rootPath,
    })
  );
}

let rootPath: string;

beforeEach(async () => {
  clearModelCache();
  clearProjectStatusSignatures();
  rootPath = join(tmpdir(), `dr-mcp-status-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
});

afterEach(async () => {
  clearModelCache();
  resetProjectRoot();
  await rm(rootPath, { recursive: true, force: true });
});

describe("project_status", () => {
  it("reports a project with no model without erroring, and points at project_init", async () => {
    const data = await status(rootPath);

    expect(data.project).toEqual({ root: rootPath, resolvedBy: "rootPath", projectRoot: null });
    expect(data.model.status).toBe("absent");
    expect(data.spec).toEqual({ status: "no-model", model: null, cli: getCliBundledSpecVersion(), upgradeNeeded: false });
    expect(data.changesets).toEqual({ status: "no-model" });
    expect(data.codeDrift).toEqual({ status: "no-model" });
    expect(data.codeIndex.status).toBe("absent");
    expect(data.nextStep.tool).toBe("project_init");
    expect(data.nextStep.args).toEqual({ rootPath });
  });

  it("says how the root was resolved when no rootPath is given", async () => {
    resetProjectRoot(rootPath);
    const fromCwd = await status();
    expect(fromCwd.project.resolvedBy).toBe("cwd");
    // No rootPath was given, so the next step doesn't name one.
    expect(fromCwd.nextStep.args).toBeUndefined();

    markEnvProjectRoot(rootPath);
    const data = await status();
    expect(data.project.resolvedBy).toBe("DR_MCP_ROOT_PATH");
    expect(data.project.root).toBe(rootPath);
  });

  it("reports an outdated model with its migration path, and points at project_upgrade", async () => {
    await initModel(rootPath);
    await setSpecVersion(rootPath, "0.10.0");

    const data = await status(rootPath);

    expect(data.model.status).toBe("present");
    expect(data.spec.status).toBe("behind");
    expect(data.spec.model).toBe("0.10.0");
    expect(data.spec.upgradeNeeded).toBe(true);
    expect(data.spec.migration.available).toBe(true);
    expect(data.spec.migration.steps).toEqual(["0.10.0 → 0.11.0"]);
    expect(data.nextStep.tool).toBe("project_upgrade");
    expect(data.nextStep.summary).toContain("0.10.0");
  });

  it("says when an outdated model has no migration path", async () => {
    await initModel(rootPath);
    await setSpecVersion(rootPath, "0.4.0");

    const data = await status(rootPath);

    expect(data.spec.status).toBe("behind");
    expect(data.spec.migration).toEqual({ available: false, steps: [] });
    expect(data.spec.reason).toContain("no migration path");
    expect(data.nextStep.tool).toBe("project_upgrade");
  });

  it("tells the agent to update the CLI when the model is on a newer spec", async () => {
    await initModel(rootPath);
    await setSpecVersion(rootPath, "99.0.0");

    const data = await status(rootPath);

    expect(data.spec.status).toBe("ahead");
    expect(data.spec.upgradeNeeded).toBe(false);
    expect(data.nextStep.tool).toBeNull();
    expect(data.nextStep.summary).toContain("Update the dr CLI");
  });

  it("assumes 0.6.0 for a manifest without spec_version, as dr upgrade does, and says so", async () => {
    await initModel(rootPath);
    const manifest = join(rootPath, "documentation-robotics", "model", "manifest.yaml");
    await writeFile(manifest, (await readFile(manifest, "utf-8")).replace(/^spec_version:.*\n/m, ""));

    const data = await status(rootPath);

    expect(data.spec.status).toBe("behind");
    expect(data.spec.model).toBe("0.6.0");
    expect(data.spec.assumed).toBe(true);
    expect(data.spec.note).toContain("no spec_version");
    expect(data.nextStep.tool).toBe("project_upgrade");
  });

  it("reads the model fresh when its files changed behind the server's cache", async () => {
    await initModel(rootPath);
    expect((await status(rootPath)).model.elements).toBe(1);

    // Unchanged files: the cached model is reused.
    const cached = await loadModel(rootPath);
    await status(rootPath);
    expect(await loadModel(rootPath)).toBe(cached);

    // Another writer (the CLI, a pull, a hand edit) changes the files; a different cache key
    // stands in for it, so the cache under rootPath is left stale.
    await ok(await modelAddHandler({ layer: "application", type: "applicationfunction", name: "refund", rootPath: `${rootPath}/` }));
    expect((await status(rootPath)).model.elements).toBe(2);
  });

  it("describes the active analyzer's index, not another analyzer's", async () => {
    await initModel(rootPath);
    const analyzers = join(rootPath, ".dr", "analyzers");
    await mkdir(join(analyzers, "other"), { recursive: true });
    await writeFile(
      join(analyzers, "other", "index-meta.json"),
      JSON.stringify({ git_head: "abc", timestamp: "2026-11-09T00:00:00Z", node_count: 1, edge_count: 0 })
    );

    // None active: the first indexed analyzer, and the result says so.
    let data = await status(rootPath);
    expect(data.codeIndex.analyzer).toBe("other");
    expect(data.codeIndex.analyzerSource).toBe("first-indexed");
    expect(data.codeIndex.note).toContain("no analyzer is active");

    // cbm active but not indexed: absent, even though another analyzer has an index.
    await writeFile(
      join(analyzers, "session.json"),
      JSON.stringify({ active_analyzer: "cbm", selected_at: "2026-11-09T00:00:00Z" })
    );
    data = await status(rootPath);
    expect(data.codeIndex).toMatchObject({ status: "absent", analyzer: "cbm", analyzerSource: "session" });
    expect(data.nextStep.tool).toBe("codebase_index");
  });

  it("reports a codebase root that doesn't exist, not a missing git", async () => {
    await initModel(rootPath);
    const manifest = join(rootPath, "documentation-robotics", "model", "manifest.yaml");
    await writeFile(manifest, `${await readFile(manifest, "utf-8")}codebase_path: ./no-such-dir\n`);
    const analyzers = join(rootPath, ".dr", "analyzers");
    await mkdir(join(analyzers, "cbm"), { recursive: true });
    await writeFile(
      join(analyzers, "cbm", "index-meta.json"),
      JSON.stringify({ git_head: "abc", timestamp: "2026-11-09T00:00:00Z", node_count: 1, edge_count: 0 })
    );

    const data = await status(rootPath);

    expect(data.codeIndex.status).toBe("unknown");
    expect(data.codeIndex.reason).toContain("does not exist");
    expect(data.codeIndex.reason).not.toContain("git is not installed");
  });

  it("reports the active changeset with its change counts, and points at changeset_brief", async () => {
    await initModel(rootPath);
    const created = await ok(await changesetCreateHandler({ name: "add-refunds", rootPath }));
    await ok(await modelAddHandler({ layer: "application", type: "applicationfunction", name: "refund", rootPath }));

    const data = await status(rootPath);

    expect(data.changesets.status).toBe("ok");
    expect(data.changesets.active.name).toBe("add-refunds");
    expect(data.changesets.active.changes).toEqual({ total: 1, add: 1 });
    expect(data.changesets.active.baseDrifted).toBe(false);
    expect(data.changesets.staged.map((c: any) => c.id)).toEqual([data.changesets.active.id]);
    expect(JSON.stringify(created)).toContain(data.changesets.active.id);
    expect(data.nextStep.tool).toBe("changeset_brief");
    expect(data.nextStep.summary).toContain("add-refunds");
  });

  it("lists staged changesets that aren't active, and flags one whose base moved", async () => {
    await initModel(rootPath);
    await ok(await changesetCreateHandler({ name: "parked-plan", rootPath }));
    await ok(await changesetDeactivateHandler({ rootPath }));
    // A base-model write after the changeset opened moves its base.
    await ok(await modelAddHandler({ layer: "application", type: "applicationfunction", name: "audit", rootPath }));
    clearModelCache();

    const data = await status(rootPath);

    expect(data.changesets.active).toBeNull();
    expect(data.changesets.staged).toHaveLength(1);
    expect(data.changesets.staged[0].name).toBe("parked-plan");
    expect(data.changesets.staged[0].baseDrifted).toBe(true);
  });

  it("reports a directory that isn't a git repository plainly", async () => {
    await initModel(rootPath);

    const data = await status(rootPath);

    expect(data.codeDrift.status).toBe("no-git");
    expect(data.codeDrift.reason).toContain("not in a git repository");
    expect(data.nextStep.tool).toBe("codebase_index");
  });

  describe("in a git repository", () => {
    let modelSha: string;

    beforeEach(async () => {
      git(rootPath, "init", "-q");
      await initModel(rootPath);
      await mkdir(join(rootPath, "src"), { recursive: true });
      await writeFile(join(rootPath, "src", "checkout.ts"), "export const checkout = 1;\n");
      await writeFile(join(rootPath, "src", "other.ts"), "export const other = 1;\n");
      git(rootPath, "add", "-A");
      git(rootPath, "commit", "-q", "-m", "model and code");
      modelSha = git(rootPath, "rev-parse", "HEAD");
    });

    it("finds the code in step with the model right after the model's commit", async () => {
      const data = await status(rootPath);

      expect(data.codeDrift.status).toBe("in-step");
      expect(data.codeDrift.modelCommit.sha).toBe(modelSha);
      expect(data.codeDrift.commitsSince).toBe(0);
      expect(data.codeDrift.referencedFiles).toBe(1);
      expect(data.codeDrift.changedSourceFiles).toEqual([]);
      expect(data.nextStep.tool).toBe("codebase_index");
    });

    it("reports referenced source files changed in commits after the model's last commit", async () => {
      await writeFile(join(rootPath, "src", "checkout.ts"), "export const checkout = 2;\n");
      await writeFile(join(rootPath, "src", "other.ts"), "export const other = 2;\n");
      git(rootPath, "commit", "-q", "-am", "change the code");

      const data = await status(rootPath);

      expect(data.codeDrift.status).toBe("drift");
      expect(data.codeDrift.modelCommit.sha).toBe(modelSha);
      expect(data.codeDrift.modelCommit.subject).toBe("model and code");
      expect(data.codeDrift.commitsSince).toBe(1);
      expect(data.codeDrift.filesChangedSince).toBe(2);
      expect(data.codeDrift.changedSourceFiles).toEqual([
        { file: "src/checkout.ts", elements: [SERVICE], elementCount: 1 },
      ]);
      expect(data.codeDrift.uncommittedSourceFiles).toEqual([]);
      expect(data.codeDrift.modelUncommitted).toBe(false);
    });

    it("counts a renamed source file as changed under its old path", async () => {
      git(rootPath, "mv", "src/checkout.ts", "src/checkout-flow.ts");
      git(rootPath, "commit", "-q", "-m", "rename");

      const data = await status(rootPath);

      expect(data.codeDrift.status).toBe("drift");
      expect(data.codeDrift.changedSourceFiles.map((f: any) => f.file)).toEqual(["src/checkout.ts"]);
    });

    it("counts a staged rename as an uncommitted change to the old path", async () => {
      git(rootPath, "mv", "src/checkout.ts", "src/checkout-flow.ts");

      const data = await status(rootPath);

      expect(data.codeDrift.status).toBe("drift");
      expect(data.codeDrift.uncommittedSourceFiles.map((f: any) => f.file)).toEqual(["src/checkout.ts"]);
    });

    describe("with drift", () => {
      beforeEach(async () => {
        await writeFile(join(rootPath, "src", "checkout.ts"), "export const checkout = 2;\n");
        git(rootPath, "commit", "-q", "-am", "change the code");
      });

      it("asks for an index first when there is none, then codebase_verify", async () => {
        const data = await status(rootPath);

        expect(data.nextStep.tool).toBe("codebase_index");
        expect(data.nextStep.args).toEqual({ rootPath });
        expect(data.nextStep.then).toEqual({ tool: "codebase_verify", args: { rootPath } });
        expect(data.nextStep.summary).toContain("codebase_verify");
      });

      it("asks for a fresh index first when the index is stale", async () => {
        await writeIndex(rootPath, modelSha);

        const data = await status(rootPath);

        expect(data.codeIndex.status).toBe("stale");
        expect(data.nextStep.tool).toBe("codebase_index");
        expect(data.nextStep.summary).toContain("stale");
        expect(data.nextStep.then.tool).toBe("codebase_verify");
      });

      it("goes to codebase_verify, then codebase_extract since the model's commit, with a fresh index", async () => {
        await writeIndex(rootPath, git(rootPath, "rev-parse", "HEAD"));

        const data = await status(rootPath);

        expect(data.codeIndex.status).toBe("fresh");
        expect(data.nextStep.tool).toBe("codebase_verify");
        expect(data.nextStep.args).toEqual({ rootPath });
        expect(data.nextStep.then).toEqual({ tool: "codebase_extract", args: { since: modelSha, rootPath } });
      });
    });

    it("reports referenced source files with uncommitted changes", async () => {
      await writeFile(join(rootPath, "src", "checkout.ts"), "export const checkout = 3;\n");

      const data = await status(rootPath);

      expect(data.codeDrift.status).toBe("drift");
      expect(data.codeDrift.commitsSince).toBe(0);
      expect(data.codeDrift.uncommittedSourceFiles.map((f: any) => f.file)).toEqual(["src/checkout.ts"]);
    });

    it("reads the code index's freshness from .dr/analyzers and git HEAD", async () => {
      await writeIndex(rootPath, modelSha);

      let data = await status(rootPath);
      expect(data.codeIndex).toMatchObject({
        status: "fresh",
        analyzer: "cbm",
        analyzerSource: "session",
        indexedCommit: modelSha,
        nodes: 10,
      });
      expect(data.nextStep.tool).toBe("changeset_create");

      // A commit the model doesn't reference: no drift, but the index is stale, so re-index.
      await writeFile(join(rootPath, "README.md"), "later\n");
      git(rootPath, "add", "README.md");
      git(rootPath, "commit", "-q", "-m", "docs");
      data = await status(rootPath);
      expect(data.codeDrift.status).toBe("in-step");
      expect(data.codeIndex.status).toBe("stale");
      expect(data.codeIndex.headCommit).not.toBe(modelSha);
      expect(data.nextStep.tool).toBe("codebase_index");
      expect(data.nextStep.summary).toContain("Refresh");
    });
  });
});

describe("suggestNextStep", () => {
  const base = {
    model: { status: "present", path: "/p/documentation-robotics/model" },
    spec: { status: "current", model: "0.11.0", cli: "0.11.0", upgradeNeeded: false },
    changesets: { status: "ok", active: null, staged: [], committed: 0, discarded: 0 },
    codeIndex: { status: "absent", analyzer: null, reason: "none" },
    codeDrift: { status: "in-step" },
    indexing: { status: "none" },
    viewer: { status: "none" },
  } as any;

  it("puts an upgrade before the active changeset", () => {
    const step = suggestNextStep(
      {
        ...base,
        spec: { ...base.spec, status: "behind", model: "0.10.0", migration: { available: true, steps: [] } },
        changesets: { ...base.changesets, active: { id: "c", name: "c", changes: { total: 0 }, baseDrifted: false } },
      },
      { root: "/p" }
    );
    expect(step.tool).toBe("project_upgrade");
  });

  it("names a model that fails to load rather than guessing", () => {
    const step = suggestNextStep({ ...base, model: { ...base.model, loadError: "bad yaml" } }, { root: "/p" });
    expect(step.tool).toBeNull();
    expect(step.summary).toContain("bad yaml");
  });

  it("waits for an index run in progress instead of starting another", () => {
    const step = suggestNextStep(
      {
        ...base,
        indexing: {
          status: "running",
          jobId: "j",
          phase: "indexing",
          startedAt: "2026-11-10T00:00:00Z",
          finishedAt: null,
          error: null,
          logPath: "/p/.dr/analyzers/index-job.log",
        },
      },
      { root: "/p" }
    );
    expect(step.tool).toBe("codebase_index");
    expect(step.args).toEqual({ status: true });
    expect(step.summary).toContain("being indexed");
  });
});

describe("project_status viewer and indexing sections", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  it("reports no viewer and no index run for a fresh project", async () => {
    await initModel(rootPath);
    const s = await status(rootPath);
    expect(s.viewer).toEqual({ status: "none" });
    expect(s.indexing).toEqual({ status: "none" });
  });

  it("reports the running viewer with its link, from the viewer record", async () => {
    await initModel(rootPath);
    server = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status: req.url === "/health" ? "ok" : "no" }));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as { port: number }).port;
    await writeViewerRecord({
      pid: process.pid,
      port,
      token: "tok",
      projectRoot: realpathSync(rootPath),
      startedAt: "2026-11-10T00:00:00Z",
      withChangesets: true,
    });

    const s = await status(rootPath);
    expect(s.viewer.status).toBe("running");
    expect(s.viewer.url).toBe(`http://localhost:${port}/?token=tok`);
    expect(s.viewer.withChangesets).toBe(true);
  });

  it("reports an index run in progress and tells the agent to poll it", async () => {
    await initModel(rootPath);
    const analyzers = join(rootPath, ".dr", "analyzers");
    await mkdir(analyzers, { recursive: true });
    await writeFile(
      join(analyzers, "index-job.json"),
      JSON.stringify({
        version: 1,
        jobId: "job-1",
        pid: process.pid,
        state: "running",
        analyzer: "cbm",
        force: false,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
        progress: { phase: "indexing", updatedAt: new Date().toISOString() },
        logPath: join(analyzers, "index-job.log"),
        result: null,
      })
    );

    const s = await status(rootPath);
    // This test process is not a `dr analyzer index --job job-1` process, so the record reads as failed
    // unless ps can't tell; either way the section reports the run.
    expect(["running", "failed"]).toContain(s.indexing.status);
    expect(s.indexing.jobId).toBe("job-1");
  });
});
