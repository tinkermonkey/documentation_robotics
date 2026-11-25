/**
 * Unit tests for the project_status MCP tool, over real projects on disk and real git repos.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { MigrationRegistry } from "../../../src/core/migration-registry.js";
import { clearModelCache, loadModel } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import {
  changesetActivateHandler,
  changesetCreateHandler,
  changesetDeactivateHandler,
} from "../../../src/mcp/tools/changeset-lifecycle.js";
import {
  projectStatus,
  projectStatusHandler,
  suggestNextStep,
} from "../../../src/mcp/tools/project-status.js";
import {
  changesSpecVersion,
  LANDING_WHEN_DRIFT_BLOCKS,
  readInstalledCli,
  runGit,
  type GitRunner,
} from "../../../src/mcp/tools/project-status-collectors.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { markEnvProjectRoot, resetProjectRoot } from "../../../src/mcp/project-root.js";
import { getCliBundledSpecVersion, getCliVersion } from "../../../src/utils/spec-version.js";

const SERVICE = "application.applicationservice.checkout";

// Follows tranche 2 (#1200, drift warns and never refuses): a drifted changeset lands once the
// person confirms, with the overlaps shown; only an unattended `dr changeset commit` needs --force.
const DRIFTED_LANDING = "allowed-with-warning";
const DRIFTED_LANDING_WORDS = "Landing it is allowed, with a warning";

async function status(rootPath?: string): Promise<any> {
  const result = await projectStatusHandler(rootPath === undefined ? {} : { rootPath });
  if (result.isError) throw new Error((result.content[0] as { text: string }).text);
  return JSON.parse((result.content[0] as { text: string }).text);
}

/** One page of a list the status shortens (project_status with list). */
async function page(rootPath: string, list: string, args: { limit?: number; offset?: number } = {}): Promise<any> {
  return ok(await projectStatusHandler({ rootPath, list, ...args } as any));
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

/** An index by the active analyzer, cbm, built at `head` (at `timestamp`, by default a day ago). */
async function writeIndex(rootPath: string, head: string, timestamp = "2026-11-09T00:00:00Z"): Promise<void> {
  const analyzers = join(rootPath, ".dr", "analyzers");
  await mkdir(join(analyzers, "cbm"), { recursive: true });
  await writeFile(
    join(analyzers, "session.json"),
    JSON.stringify({ active_analyzer: "cbm", selected_at: "2026-11-09T00:00:00Z" })
  );
  await writeFile(
    join(analyzers, "cbm", "index-meta.json"),
    JSON.stringify({ git_head: head, timestamp, node_count: 10, edge_count: 4 })
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

/** The manifest's `reconciled` block, as an as-built landing writes it. */
async function stampReconciled(
  rootPath: string,
  stamp: { changeset: string; codeCommit?: string; landedAt?: string }
): Promise<void> {
  const manifest = join(rootPath, "documentation-robotics", "model", "manifest.yaml");
  const text = await readFile(manifest, "utf-8");
  expect(text).not.toMatch(/^reconciled:/m);
  await writeFile(
    manifest,
    `${text.trimEnd()}\nreconciled:\n  changeset: ${stamp.changeset}\n  changeset_id: changeset-${stamp.changeset}\n` +
      `  landed_at: ${stamp.landedAt ?? "2020-01-01T00:00:00.000Z"}\n` +
      (stamp.codeCommit ? `  code_commit: "${stamp.codeCommit}"\n` : "")
  );
  clearModelCache();
}

/** Land a staged changeset the way changeset_commit, the viewer's Apply and the CLI all do. */
async function land(rootPath: string, changesetId: string): Promise<void> {
  clearModelCache();
  const model = await Model.load(rootPath, { lazyLoad: false });
  await new StagingAreaManager(model.rootPath, model).commit(model, changesetId, { validate: true });
  clearModelCache();
}

/** A changeset made with changeset_create (a plan) that adds one service, left staged and inactive. */
async function stagePlan(rootPath: string, name: string, element: string): Promise<string> {
  clearModelCache();
  const created = await ok(await changesetCreateHandler({ name, rootPath }));
  await ok(
    await modelAddHandler({
      layer: "application",
      type: "applicationservice",
      name: element,
      attributes: { serviceType: "synchronous" },
      rootPath,
    })
  );
  await ok(await changesetDeactivateHandler({ rootPath }));
  return created.id;
}

let rootPath: string;

let savedFarmEnv: { xdg?: string; farm?: string };

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-mcp-status-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  // The checkout section reads the farm in use: never the developer's own user farm.
  savedFarmEnv = { xdg: process.env.XDG_CONFIG_HOME, farm: process.env.DR_FARM_PATH };
  process.env.XDG_CONFIG_HOME = join(rootPath, ".xdg");
  delete process.env.DR_FARM_PATH;
});

afterEach(async () => {
  clearModelCache();
  resetProjectRoot();
  if (savedFarmEnv.xdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedFarmEnv.xdg;
  if (savedFarmEnv.farm !== undefined) process.env.DR_FARM_PATH = savedFarmEnv.farm;
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
    // From the registry, so the next spec bump doesn't need this line edited
    const chain = new MigrationRegistry().getMigrationPath("0.10.0").map((m) => `${m.fromVersion} → ${m.toVersion}`);
    expect(chain[0]).toBe("0.10.0 → 0.11.0");
    expect(chain.length).toBeGreaterThanOrEqual(4);
    expect(data.spec.migration.steps).toEqual(chain);
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
    // This server is the installed CLI, so the CLI itself is too old: an update, then a restart.
    // `comparedWith` says which install was read: "current" is about that one, not every dr on the machine.
    expect(data.server).toEqual({ status: "current", version: getCliVersion(), comparedWith: expect.stringContaining("cli") });
    expect(data.spec.reason).toContain("update the dr CLI");
    expect(data.nextStep.summary).toContain("restart the session's dr server");
  });

  describe("a dr server older than the installed CLI", () => {
    const installed = (version: string, spec: string | null) => ({ installedCli: async () => ({ version, spec }) });

    it("says restart, not update, when the installed CLI already carries the model's spec", async () => {
      await initModel(rootPath);
      await setSpecVersion(rootPath, "99.0.0");

      const data = await projectStatus({ rootPath }, installed("99.1.0", "99.0.0"));

      expect(data.server).toMatchObject({ status: "stale", version: getCliVersion(), installed: { version: "99.1.0", spec: "99.0.0" } });
      expect(data.spec.status).toBe("ahead");
      expect(data.spec.reason).toContain("restart the session's dr server; the CLI needs no update");
      expect(data.spec.reason).not.toContain("update the dr CLI");
      expect(data.nextStep.tool).toBeNull();
      expect(data.nextStep.summary).toContain("The dr CLI installed now is already 99.1.0 (spec 99.0.0)");
      expect(data.nextStep.summary).toContain("Restart the session's dr server");
      expect(data.nextStep.summary).toContain("the CLI needs no update");
      expect(data.nextStep.summary).not.toContain("Update the dr CLI");
      // The restart is said once.
      expect(data.nextStep.summary.match(/restart the session's dr server/gi)).toHaveLength(1);
    });

    it("still says update when the installed CLI is too old for the model as well", async () => {
      await initModel(rootPath);
      await setSpecVersion(rootPath, "99.0.0");

      const data = await projectStatus({ rootPath }, installed("98.0.0", "98.0.0"));

      expect(data.server.status).toBe("stale");
      expect(data.spec.reason).toContain("update the dr CLI");
      expect(data.nextStep.summary).toContain("Update the dr CLI, then restart the session's dr server");
      expect(data.nextStep.summary.match(/restart the session's dr server/gi)).toHaveLength(1);
    });

    it("sends the upgrade of an older model to the installed CLI: restart first", async () => {
      await initModel(rootPath);
      await setSpecVersion(rootPath, "0.10.0");

      const data = await projectStatus({ rootPath }, installed("99.1.0", "99.0.0"));

      expect(data.spec.status).toBe("behind");
      expect(data.nextStep.tool).toBeNull();
      expect(data.nextStep.summary).toContain("99.1.0 (spec 99.0.0) is installed now");
      expect(data.nextStep.summary).toContain("then call project_status again");
    });

    it("keeps the step and adds the restart when the spec versions agree", async () => {
      await initModel(rootPath);

      const data = await projectStatus({ rootPath }, installed("99.1.0", getCliBundledSpecVersion()));

      expect(data.server.status).toBe("stale");
      expect((data.server as any).note).toContain("still runs the old code");
      expect(data.nextStep.tool).toBe("codebase_index");
      expect(data.nextStep.summary).toContain(`Also: This dr server process is CLI ${getCliVersion()}, and 99.1.0 is installed now`);
      expect(data.nextStep.summary).toContain("Restart the session's dr server");
    });

    it("sees the same version installed or built again after the server started, by its files' time", async () => {
      await initModel(rootPath);
      const sameVersion = (modifiedAt: number) => ({
        installedCli: async () => ({ version: getCliVersion(), spec: getCliBundledSpecVersion(), modifiedAt }),
      });

      const rebuilt = await projectStatus({ rootPath }, sameVersion(Date.now() + 60_000));
      expect(rebuilt.server).toMatchObject({ status: "stale", version: getCliVersion(), installed: { version: getCliVersion() } });
      expect((rebuilt.server as any).changedAt).toBeTruthy();
      expect((rebuilt.server as any).note).toContain(`after this dr server process started (the version is still ${getCliVersion()})`);
      expect(rebuilt.nextStep.tool).toBe("codebase_index");
      expect(rebuilt.nextStep.summary).toContain("Restart the session's dr server");

      // Files older than the process are the ones it was started from.
      const asStarted = await projectStatus({ rootPath }, sameVersion(Date.now() - 24 * 60 * 60 * 1000));
      expect(asStarted.server).toMatchObject({ status: "current", version: getCliVersion() });
    });

    it("says so when the installed CLI can't be read, and reports this server's version", async () => {
      await initModel(rootPath);

      const data = await projectStatus({ rootPath }, { installedCli: async () => null });

      expect(data.server).toMatchObject({ status: "unknown", version: getCliVersion() });
      expect(data.nextStep.summary).not.toContain("Restart");
    });

    it("reads the installed CLI's version and bundled spec from its package folder", async () => {
      await writeFile(join(rootPath, "package.json"), JSON.stringify({ name: "@documentation-robotics/cli", version: "1.2.3" }));
      expect(await readInstalledCli(rootPath)).toMatchObject({ version: "1.2.3", spec: null });

      await mkdir(join(rootPath, "dist", "schemas", "bundled"), { recursive: true });
      await writeFile(join(rootPath, "dist", "schemas", "bundled", "manifest.json"), JSON.stringify({ specVersion: "0.20.0" }));
      const read = await readInstalledCli(rootPath);
      expect(read).toMatchObject({ version: "1.2.3", spec: "0.20.0" });
      // package.json was written a moment ago.
      expect(Math.abs(read!.modifiedAt! - Date.now())).toBeLessThan(60_000);

      expect(await readInstalledCli(join(rootPath, "gone"))).toBeNull();
      // This checkout: the server under test is the CLI on disk.
      expect(await readInstalledCli()).toMatchObject({ version: getCliVersion(), spec: getCliBundledSpecVersion() });
    });
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
    expect(data.changesets.active.drift).toBeUndefined();
    expect(data.changesets.staged.map((c: any) => c.id)).toEqual([data.changesets.active.id]);
    expect(JSON.stringify(created)).toContain(data.changesets.active.id);
    expect(data.nextStep.tool).toBe("changeset_brief");
    expect(data.nextStep.summary).toContain("add-refunds");
  });

  it("lists staged changesets that aren't active, and flags one whose base moved under what it stages", async () => {
    await initModel(rootPath);
    await ok(await modelAddHandler({ layer: "application", type: "applicationfunction", name: "audit", rootPath }));
    await ok(await changesetCreateHandler({ name: "parked-plan", rootPath }));
    // The plan rewords the element...
    await ok(
      await modelUpdateHandler({ id: "application.applicationfunction.audit", description: "Audit log", rootPath } as any)
    );
    await ok(await changesetDeactivateHandler({ rootPath }));
    // ...and the base then changes the same element under it.
    await ok(
      await modelUpdateHandler({ id: "application.applicationfunction.audit", description: "Audit trail", rootPath } as any)
    );
    clearModelCache();

    const data = await status(rootPath);

    expect(data.changesets.active).toBeNull();
    expect(data.changesets.staged).toHaveLength(1);
    expect(data.changesets.staged[0].name).toBe("parked-plan");
    expect(data.changesets.staged[0].baseDrifted).toBe(true);
    // #1227: set aside, it says that it drifted, what a landing does and the call that lists what moved.
    const next = { tool: "changeset_brief", args: { changeset: data.changesets.staged[0].id, sections: ["drift"] } };
    expect(data.changesets.staged[0].drift).toEqual({ state: "drifted", landing: DRIFTED_LANDING, next });
    // The staged list in full describes every changeset's drift, as the active one's is.
    const described = {
      state: "drifted",
      landing: DRIFTED_LANDING,
      baseChanges: { elementsChanged: 1 },
      overlapping: { elements: 1, relationships: 0, first: ["application.applicationfunction.audit (changed-in-base)"] },
      next,
    };
    expect((await page(rootPath, "stagedChangesets")).items[0].drift).toEqual(described);

    // Active, it is the next step: read the drift before building from the plan or landing it.
    await ok(await changesetActivateHandler({ changeset: "parked-plan", rootPath }));
    const active = await status(rootPath);
    expect(active.changesets.active.drift).toEqual(described);
    expect(active.nextStep.tool).toBe("changeset_brief");
    expect(active.nextStep.args).toEqual({ sections: ["drift"], rootPath });
    expect(active.nextStep.summary).toContain("1 element changed in the base");
    expect(active.nextStep.summary).toContain("1 of its staged changes overlap (application.applicationfunction.audit (changed-in-base))");
    expect(active.nextStep.summary).toContain(DRIFTED_LANDING_WORDS);
  });

  it("says a drifted changeset with no base index can't name what changed (#1227)", async () => {
    await initModel(rootPath);
    await ok(await modelAddHandler({ layer: "application", type: "applicationfunction", name: "audit", rootPath }));
    const created = await ok(await changesetCreateHandler({ name: "old-plan", rootPath }));
    // A changeset made before base indexes were recorded has only the hash to go on.
    await rm(join(rootPath, "documentation-robotics", "changesets", created.id, "base-index.json"));
    await ok(await changesetDeactivateHandler({ rootPath }));
    await ok(
      await modelUpdateHandler({ id: "application.applicationfunction.audit", description: "Audit trail", rootPath } as any)
    );
    await ok(await changesetActivateHandler({ changeset: "old-plan", rootPath }));
    clearModelCache();

    const data = await status(rootPath);
    const entry = data.changesets.active;

    expect(entry.baseDrifted).toBe(true);
    expect(entry.drift.state).toBe("drifted");
    expect(entry.drift.landing).toBe(DRIFTED_LANDING);
    expect(entry.drift.baseIndex).toBe("not-recorded");
    expect(entry.drift.baseChanges).toBeUndefined();
    expect(entry.drift.reason).toBeTruthy();
    expect(entry.drift.next.tool).toBe("changeset_brief");
    expect(data.nextStep.summary).toContain("it has no readable base index (not-recorded), so what changed can't be named");
  });

  it("shows ten staged changesets by default, counts them all, and judges drift over every one", async () => {
    await initModel(rootPath);
    await ok(await modelAddHandler({ layer: "application", type: "applicationfunction", name: "audit", rootPath }));
    // One plan rewords an element, 21 more stage nothing, and the base then changes that element.
    await ok(await changesetCreateHandler({ name: "plan-00", rootPath }));
    await ok(
      await modelUpdateHandler({ id: "application.applicationfunction.audit", description: "Audit log", rootPath } as any)
    );
    await ok(await changesetDeactivateHandler({ rootPath }));
    for (let i = 1; i < 22; i++) {
      await ok(await changesetCreateHandler({ name: `plan-${String(i).padStart(2, "0")}`, activate: false, rootPath }));
    }
    await ok(
      await modelUpdateHandler({ id: "application.applicationfunction.audit", description: "Audit trail", rootPath } as any)
    );
    clearModelCache();
    // An index, so the next step gets as far as the staged changesets.
    await writeIndex(rootPath, "0000000");

    const data = await status(rootPath);

    expect(data.changesets.stagedTotal).toBe(22);
    expect(data.changesets.staged).toHaveLength(10);
    // The page the shown part is, in the shape every paged tool uses.
    expect(data.changesets.pages).toEqual({ stagedChangesets: { total: 22, returned: 10, offset: 0, nextOffset: 10 } });
    // `more` is one string, as in every paged tool.
    expect(data.changesets.more).toContain(
      `stagedChangesets shows 10 of 22: project_status with list: "stagedChangesets", offset: 10, rootPath: "${rootPath}" returns the rest.`
    );

    // Every staged changeset is reachable, each exactly once, across the status and the call it names.
    const rest = await page(rootPath, "stagedChangesets", { offset: 10 });
    expect(rest.page).toEqual({ total: 22, returned: 12, offset: 10 });
    const names = [...data.changesets.staged, ...rest.items].map((entry: any) => entry.name).sort();
    expect(names).toEqual(Array.from({ length: 22 }, (_, i) => `plan-${String(i).padStart(2, "0")}`));

    // The drifted plan is one of the 22 wherever it is listed, and the next step names it either way.
    const drifted = [...data.changesets.staged, ...rest.items].filter((entry: any) => entry.baseDrifted);
    expect(drifted.map((entry: any) => entry.name)).toEqual(["plan-00"]);
    const hidden = rest.items.some((entry: any) => entry.name === "plan-00");
    expect(data.changesets.more.includes("1 of those not shown has a drifted base.")).toBe(hidden);
    expect(data.nextStep.tool).toBe("changeset_activate");
    expect(data.nextStep.summary).toContain("No changeset is active; 22 staged:");
    expect(data.nextStep.summary).toContain("and 17 more");
    expect(data.nextStep.summary).toContain('The base model changed under "plan-00"');
    // The answer stays small with many changesets staged.
    expect(JSON.stringify(data).length).toBeLessThan(6000);
  });

  it("refuses limit or offset without list, and says which lists there are", async () => {
    await initModel(rootPath);

    const result = await projectStatusHandler({ rootPath, limit: 5 } as any);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("they need list");
    expect(text).toContain("changedSourceFiles");
  });

  it("answers a list call with an empty page and the reason when the section has nothing to read", async () => {
    // No model at all.
    expect(await page(rootPath, "changedSourceFiles")).toEqual({
      list: "changedSourceFiles",
      items: [],
      page: { total: 0, returned: 0, offset: 0 },
      note: "codeDrift is no-model",
    });
    expect((await page(rootPath, "stagedChangesets")).note).toBe("changesets is no-model");
  });

  it("doesn't flag a changeset when the base changed an element it neither edits nor links to", async () => {
    await initModel(rootPath);
    await ok(await modelAddHandler({ layer: "application", type: "applicationfunction", name: "audit", rootPath }));
    await ok(await modelAddHandler({ layer: "application", type: "applicationfunction", name: "billing", rootPath }));
    await ok(await changesetCreateHandler({ name: "parked-plan", rootPath }));
    await ok(
      await modelUpdateHandler({ id: "application.applicationfunction.billing", description: "Invoices", rootPath } as any)
    );
    await ok(await changesetDeactivateHandler({ rootPath }));
    // The base changes another element than the one the plan rewords.
    await ok(
      await modelUpdateHandler({ id: "application.applicationfunction.audit", description: "Audit trail", rootPath } as any)
    );
    clearModelCache();

    const data = await status(rootPath);

    expect(data.changesets.staged[0].name).toBe("parked-plan");
    expect(data.changesets.staged[0].baseDrifted).toBe(false);
    // The base moved elsewhere: the entry says so and that landing is not blocked.
    expect(data.changesets.staged[0].drift).toEqual({ state: "content-free", landing: "allowed" });
    // The staged list in full says by how much.
    expect((await page(rootPath, "stagedChangesets")).items[0].drift).toEqual({
      state: "content-free",
      landing: "allowed",
      baseChanges: { elementsChanged: 1 },
    });
  });

  it("doesn't flag a changeset whose base only gained elements since it opened (#1169)", async () => {
    await initModel(rootPath);
    await ok(await changesetCreateHandler({ name: "parked-plan", rootPath }));
    await ok(await changesetDeactivateHandler({ rootPath }));
    // The base hash changes (manifest and the new element), but nothing the plan was staged against did.
    await ok(await modelAddHandler({ layer: "application", type: "applicationfunction", name: "audit", rootPath }));
    clearModelCache();

    const data = await status(rootPath);

    expect(data.changesets.staged[0].name).toBe("parked-plan");
    expect(data.changesets.staged[0].baseDrifted).toBe(false);
  });

  describe("an active as-built changeset (final review)", () => {
    const AS_BUILT_DESCRIPTION = "As-built extraction of the code at abc1234. Staged by codebase_extract.";

    it("is the as-built side of a verify against the plan extraction recorded, and the plan is reactivated", async () => {
      await initModel(rootPath);
      const plan = await ok(await changesetCreateHandler({ name: "add-export", rootPath }));
      // Another plan, parked: the extraction record, not "the only one", decides.
      await ok(await changesetCreateHandler({ name: "other-plan", rootPath }));
      const asBuilt = await ok(
        await changesetCreateHandler({ name: "extract-abc1234", description: AS_BUILT_DESCRIPTION, rootPath })
      );
      const record = join(rootPath, ".dr", "analyzers", "extract");
      await mkdir(record, { recursive: true });
      await writeFile(
        join(record, `${asBuilt.id}.json`),
        JSON.stringify({ changesetId: asBuilt.id, changesetName: asBuilt.name, previousActive: { id: plan.id, name: plan.name }, cards: [] })
      );
      clearModelCache();

      const data = await status(rootPath);

      expect(data.changesets.active).toMatchObject({
        id: asBuilt.id,
        asBuilt: true,
        previousActive: { id: plan.id, name: "add-export" },
      });
      expect(data.changesets.staged.find((c: any) => c.id === plan.id).asBuilt).toBeUndefined();
      // Each lists its purpose and the moves it allows (#1171).
      expect(data.changesets.staged.find((c: any) => c.id === plan.id)).toMatchObject({
        purpose: "plan",
        actions: ["commit", "discard"],
      });
      expect(data.nextStep.tool).toBe("changeset_verify");
      expect(data.nextStep.args).toEqual({ changeset: plan.id, against: { changeset: asBuilt.id }, rootPath });
      expect(data.nextStep.also).toMatchObject({ tool: "changeset_activate", args: { changeset: plan.id, rootPath } });
      expect(data.nextStep.summary).toContain("not a plan");
      expect(data.nextStep.summary).not.toContain("pick up the plan");
    });

    it("is a keep-as-built catch-up when no plan is staged: reviewed and landed as itself", async () => {
      await initModel(rootPath);
      const asBuilt = await ok(
        await changesetCreateHandler({ name: "extract-abc1234", description: AS_BUILT_DESCRIPTION, rootPath })
      );
      clearModelCache();

      const data = await status(rootPath);

      expect(data.changesets.active.asBuilt).toBe(true);
      expect(data.nextStep.tool).toBe("review_open");
      expect(data.nextStep.args).toEqual({ changeset: asBuilt.id, rootPath });
      expect(data.nextStep.summary).toContain("catch-up");
      expect(data.nextStep.summary).toContain("changeset_commit when they ask");
      expect(data.nextStep.also).toBeUndefined();
    });
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

    it("counts changed files no element references apart, and says the check can't see them", async () => {
      await writeFile(join(rootPath, "src", "checkout.ts"), "export const checkout = 2;\n");
      await writeFile(join(rootPath, "src", "other.ts"), "export const other = 2;\n");
      await writeFile(join(rootPath, "src", "lighting.ts"), "export const lighting = 1;\n");
      await writeFile(join(rootPath, "README.md"), "# Read me\n");
      git(rootPath, "add", "-A");
      git(rootPath, "commit", "-q", "-m", "change the code");

      const data = await status(rootPath);

      expect(data.codeDrift.filesChangedSince).toBe(4);
      expect(data.codeDrift.referencedFilesChanged).toBe(1);
      // 3 files no element references: 2 are source, 1 of them new (listed first); the README is neither.
      expect(data.codeDrift.unreferenced).toEqual({
        files: 3,
        sourceFiles: 2,
        newSourceFiles: 1,
        first: ["src/lighting.ts", "src/other.ts"],
      });
      expect(data.nextStep.summary).toContain("1 source file the model references changed");
      expect(data.nextStep.summary).toContain("3 more changed files are referenced by no element (2 source, 1 new), so they can't show here");
    });

    it("shortens the changed files by default, counts them all, and returns the rest through list", async () => {
      const names = Array.from({ length: 17 }, (_, i) => `part-${String(i).padStart(2, "0")}`);
      for (const name of names) {
        await writeFile(join(rootPath, "src", `${name}.ts`), "export const part = 1;\n");
        await ok(
          await modelAddHandler({
            layer: "application",
            type: "applicationfunction",
            name,
            sourceFile: `src/${name}.ts`,
            sourceProvenance: "manual",
            rootPath,
          })
        );
      }
      // Five elements reference the last file: more than the three the status shows for a file.
      for (const extra of ["a", "b", "c", "d"]) {
        await ok(
          await modelAddHandler({
            layer: "application",
            type: "applicationfunction",
            name: `part-16-${extra}`,
            sourceFile: "src/part-16.ts",
            sourceProvenance: "manual",
            rootPath,
          })
        );
      }
      git(rootPath, "add", "-A");
      git(rootPath, "commit", "-q", "-m", "model the parts");
      for (const name of names) await writeFile(join(rootPath, "src", `${name}.ts`), "export const part = 2;\n");
      git(rootPath, "commit", "-q", "-am", "change the parts");
      // An index from before both commits: every part has changed since.
      await writeIndex(rootPath, modelSha);

      const data = await status(rootPath);

      // The default answer: the first 15, the whole count beside them, and the call for the rest.
      expect(data.codeDrift.referencedFilesChanged).toBe(17);
      expect(data.codeDrift.changedSourceFiles).toHaveLength(15);
      expect(data.codeDrift.truncated).toBe(true);
      expect(data.codeDrift.more).toContain(
        `changedSourceFiles shows 15 of 17: project_status with list: "changedSourceFiles", offset: 15, rootPath: "${rootPath}" returns the rest.`
      );
      expect(data.codeDrift.unreferenced).toBeUndefined();
      // The sentence counts every file, not the ones listed.
      expect(data.nextStep.summary).toContain("17 source files the model references changed");

      // The call it names returns the rest, each file with every element that references it.
      const rest = await page(rootPath, "changedSourceFiles", { offset: 15 });
      expect(rest.list).toBe("changedSourceFiles");
      // The last page: no nextOffset and no more line.
      expect(rest.page).toEqual({ total: 17, returned: 2, offset: 15 });
      expect(rest.more).toBeUndefined();
      expect(rest.items.map((f: any) => f.file)).toEqual(["src/part-15.ts", "src/part-16.ts"]);
      expect(rest.items[1].elementCount).toBe(5);
      expect(rest.items[1].elements).toHaveLength(5);

      // Paged with limit: every file is reached exactly once, and the last page names no next call.
      const seen: string[] = [];
      let offset: number | undefined = 0;
      while (offset !== undefined) {
        const next: any = await page(rootPath, "changedSourceFiles", { limit: 7, offset });
        expect(next.page.total).toBe(17);
        seen.push(...next.items.map((f: any) => f.file));
        if (next.page.nextOffset !== undefined) {
          expect(next.more).toContain(`list: "changedSourceFiles", offset: ${next.page.nextOffset}, limit: 7`);
        }
        offset = next.page.nextOffset;
      }
      expect(seen).toEqual(names.map((name) => `src/${name}.ts`));
      // limit has no upper bound: the total returns everything in one call.
      expect((await page(rootPath, "changedSourceFiles", { limit: 17 })).page).toEqual({ total: 17, returned: 17, offset: 0 });

      // The same holds for the index's own list of files changed since it was taken.
      expect(data.codeIndex.status).toBe("stale");
      expect(data.codeIndex.changedSinceIndexCount).toBe(17);
      expect(data.codeIndex.changedSinceIndex).toHaveLength(15);
      expect(data.codeIndex.more).toBe(
        `changedSinceIndex shows 15 of 17: project_status with list: "changedSinceIndex", offset: 15, rootPath: "${rootPath}" returns the rest.`
      );
      const sinceIndex = await page(rootPath, "changedSinceIndex", { offset: 15 });
      expect(sinceIndex.page).toEqual({ total: 17, returned: 2, offset: 15 });
      expect(data.codeIndex.pages).toEqual({ changedSinceIndex: { total: 17, returned: 15, offset: 0, nextOffset: 15 } });
      expect(data.codeDrift.pages).toEqual({ changedSourceFiles: { total: 17, returned: 15, offset: 0, nextOffset: 15 } });
    });

    it("shows three elements per file, with the whole count and the call that lists them all", async () => {
      for (const extra of ["a", "b", "c", "d"]) {
        await ok(
          await modelAddHandler({
            layer: "application",
            type: "applicationfunction",
            name: `checkout-${extra}`,
            sourceFile: "src/checkout.ts",
            sourceProvenance: "manual",
            rootPath,
          })
        );
      }
      git(rootPath, "add", "-A");
      git(rootPath, "commit", "-q", "-m", "model more of checkout");
      await writeFile(join(rootPath, "src", "checkout.ts"), "export const checkout = 2;\n");
      git(rootPath, "commit", "-q", "-am", "change checkout");

      const data = await status(rootPath);

      expect(data.codeDrift.changedSourceFiles).toHaveLength(1);
      expect(data.codeDrift.changedSourceFiles[0].elements).toHaveLength(3);
      expect(data.codeDrift.changedSourceFiles[0].elementCount).toBe(5);
      expect(data.codeDrift.more).toContain("elements shows 3 per file (elementCount is the whole count)");
      const all = await page(rootPath, "changedSourceFiles");
      expect(all.items[0].elements).toHaveLength(5);
    });

    it("counts every referenced file with uncommitted edits, not only the ones it lists", async () => {
      const names = Array.from({ length: 18 }, (_, i) => `edit-${String(i).padStart(2, "0")}`);
      for (const name of names) {
        await writeFile(join(rootPath, "src", `${name}.ts`), "export const edit = 1;\n");
        await ok(
          await modelAddHandler({
            layer: "application",
            type: "applicationfunction",
            name,
            sourceFile: `src/${name}.ts`,
            sourceProvenance: "manual",
            rootPath,
          })
        );
      }
      git(rootPath, "add", "-A");
      git(rootPath, "commit", "-q", "-m", "model the files");
      for (const name of names) await writeFile(join(rootPath, "src", `${name}.ts`), "export const edit = 2;\n");

      const data = await status(rootPath);

      expect(data.codeDrift.status).toBe("drift");
      expect(data.codeDrift.referencedFilesUncommitted).toBe(18);
      expect(data.codeDrift.uncommittedSourceFiles).toHaveLength(15);
      expect(data.codeDrift.more).toBe(
        `uncommittedSourceFiles shows 15 of 18: project_status with list: "uncommittedSourceFiles", offset: 15, rootPath: "${rootPath}" returns the rest.`
      );
      expect(data.nextStep.summary).toContain("18 source files the model references have uncommitted edits");
      expect((await page(rootPath, "uncommittedSourceFiles", { offset: 15 })).page).toEqual({ total: 18, returned: 3, offset: 15 });
    });

    it("names five unreferenced files, counts them all, and returns every one through list", async () => {
      await writeFile(join(rootPath, "src", "other.ts"), "export const other = 2;\n");
      for (let i = 0; i < 7; i++) await writeFile(join(rootPath, "src", `new-${i}.ts`), "export const n = 1;\n");
      await writeFile(join(rootPath, "README.md"), "# Read me\n");
      git(rootPath, "add", "-A");
      git(rootPath, "commit", "-q", "-m", "more code nothing references");

      const data = await status(rootPath);

      // Nothing the model references changed: in step, and the nine files it can't judge are counted.
      expect(data.codeDrift.status).toBe("in-step");
      expect(data.codeDrift.unreferenced).toEqual({
        files: 9,
        sourceFiles: 8,
        newSourceFiles: 7,
        first: ["src/new-0.ts", "src/new-1.ts", "src/new-2.ts", "src/new-3.ts", "src/new-4.ts"],
      });
      expect(data.codeDrift.more).toBe(
        `unreferencedFiles shows 5 of 9: project_status with list: "unreferencedFiles", offset: 5, rootPath: "${rootPath}" returns the rest.`
      );

      const rest = await page(rootPath, "unreferencedFiles", { offset: 5 });
      expect(rest.page).toEqual({ total: 9, returned: 4, offset: 5 });
      expect(data.codeDrift.pages).toEqual({ unreferencedFiles: { total: 9, returned: 5, offset: 0, nextOffset: 5 } });
      // New source files first, then other source files, then files that are not source.
      expect(rest.items).toEqual([
        { file: "src/new-5.ts", source: true, added: true },
        { file: "src/new-6.ts", source: true, added: true },
        { file: "src/other.ts", source: true, added: false },
        { file: "README.md", source: false, added: true },
      ]);
    });

    it("says which rule counts drift for a model with no as-built landing", async () => {
      const data = await status(rootPath);

      expect(data.codeDrift.basis).toBe("last-non-migration-commit");
      expect(data.codeDrift.countedFrom.sha).toBe(modelSha);
      expect(data.codeDrift.rule).toContain(`No as-built landing is recorded, so drift is counted from the last model commit that is not a spec migration (${modelSha.slice(0, 7)})`);
      expect(data.codeDrift.rule).toContain("Any commit to the model moves it");
      expect(data.codeDrift.landedSince).toBeUndefined();
    });

    describe("after an as-built landing", () => {
      /** Commit the model with its stamp, as the human does once the landing is reviewed. */
      function commitModel(message = "land the as-built model"): string {
        git(rootPath, "add", "-A", "--", "documentation-robotics");
        git(rootPath, "commit", "-q", "-m", message);
        return git(rootPath, "rev-parse", "HEAD");
      }

      it("counts drift from the code the extraction read, not from the model's later commit (#1195)", async () => {
        // The extraction read the code at modelSha. While the landing was reviewed, other work merged.
        await writeFile(join(rootPath, "src", "checkout.ts"), "export const checkout = 2;\n");
        await writeFile(join(rootPath, "src", "lighting.ts"), "export const lighting = 1;\n");
        git(rootPath, "add", "-A");
        git(rootPath, "commit", "-q", "-m", "merge other work");
        await stampReconciled(rootPath, { changeset: "extract-bootstrap", codeCommit: modelSha });
        const landingSha = commitModel();
        await writeIndex(rootPath, landingSha);

        const data = await status(rootPath);

        expect(data.codeDrift.status).toBe("drift");
        expect(data.codeDrift.basis).toBe("last-reconciling-commit");
        expect(data.codeDrift.modelCommit.sha).toBe(landingSha);
        expect(data.codeDrift.countedFrom).toMatchObject({ sha: modelSha, subject: "model and code" });
        expect(data.codeDrift.rule).toContain(`Counted from ${modelSha.slice(0, 7)}, the code the as-built landing "extract-bootstrap" read`);
        expect(data.codeDrift.rule).toContain(`the model was committed later, in ${landingSha.slice(0, 7)}`);
        expect(data.codeDrift.commitsSince).toBe(1);
        expect(data.codeDrift.changedSourceFiles.map((f: any) => f.file)).toEqual(["src/checkout.ts"]);
        expect(data.codeDrift.unreferenced).toEqual({ files: 1, sourceFiles: 1, newSourceFiles: 1, first: ["src/lighting.ts"] });
        // The catch-up reads from the extraction's commit.
        expect(data.nextStep.tool).toBe("codebase_verify");
        expect(data.nextStep.then).toEqual({ tool: "codebase_extract", args: { since: modelSha, rootPath } });
        expect(data.nextStep.summary).toContain(`since the code the as-built landing "extract-bootstrap" read (${modelSha.slice(0, 7)})`);
        expect(data.nextStep.summary).toContain(`codebase_extract with since: "${modelSha.slice(0, 7)}" and no plan active`);
        expect(data.nextStep.summary).not.toContain("in step");
      });

      it("offers the catch-up when only new, unreferenced source files merged in between (#1195)", async () => {
        await writeFile(join(rootPath, "src", "lighting.ts"), "export const lighting = 1;\n");
        git(rootPath, "add", "-A");
        git(rootPath, "commit", "-q", "-m", "merge a new subsystem");
        await stampReconciled(rootPath, { changeset: "extract-bootstrap", codeCommit: modelSha });
        await writeIndex(rootPath, commitModel());

        const data = await status(rootPath);

        // Nothing the model references changed, so it is not drift; the new file is still named.
        expect(data.codeDrift.status).toBe("in-step");
        expect(data.codeDrift.unreferenced).toEqual({ files: 1, sourceFiles: 1, newSourceFiles: 1, first: ["src/lighting.ts"] });
        expect(data.nextStep.tool).toBe("changeset_create");
        expect(data.nextStep.summary).toContain("1 other changed source file is referenced by no element (1 new), so this check can't judge it");
        expect(data.nextStep.also).toMatchObject({ tool: "codebase_extract", args: { since: modelSha, rootPath } });
      });

      it("is in step, with nothing unseen, when the model is committed right after the extraction", async () => {
        await stampReconciled(rootPath, { changeset: "extract-bootstrap", codeCommit: modelSha });
        const landingSha = commitModel();
        await writeIndex(rootPath, landingSha);

        const data = await status(rootPath);

        expect(data.codeDrift).toMatchObject({ status: "in-step", commitsSince: 0, filesChangedSince: 0, referencedFilesChanged: 0 });
        expect(data.codeDrift.unreferenced).toBeUndefined();
        expect(data.nextStep.also).toBeUndefined();
        expect(data.nextStep.summary).toContain(`since the code the as-built landing "extract-bootstrap" read (${modelSha.slice(0, 7)})`);
      });

      it("says unknown, never in step, when the repository doesn't have the commit the extraction read", async () => {
        const missing = "0123456789abcdef0123456789abcdef01234567";
        await stampReconciled(rootPath, { changeset: "extract-bootstrap", codeCommit: missing });
        const landingSha = commitModel();
        await writeIndex(rootPath, landingSha);

        const data = await status(rootPath);

        // Nothing changed since the model's commit, but the count should start earlier: not in step.
        expect(data.codeDrift.status).toBe("unknown");
        expect(data.codeDrift.incompleteHistory).toBe("missing-code-commit");
        expect(data.codeDrift.reconciledBy).toMatchObject({ changeset: "extract-bootstrap", codeCommit: missing });
        expect(data.codeDrift.reason).toContain(`read code commit ${missing.slice(0, 7)}, which this repository doesn't have`);
        expect(data.codeDrift.shallow).toBeUndefined();
        expect(data.nextStep.tool).toBeNull();
        expect(data.nextStep.summary).toContain("Code drift can't be measured here");
        expect(data.nextStep.summary).toContain("Don't take the model as current with the code");
        expect(data.nextStep.summary).not.toContain("in step");
      });

      it("still reports the drift it can see from the model's commit, and says more may be hidden", async () => {
        const missing = "0123456789abcdef0123456789abcdef01234567";
        await stampReconciled(rootPath, { changeset: "extract-bootstrap", codeCommit: missing });
        const landingSha = commitModel();
        await writeFile(join(rootPath, "src", "checkout.ts"), "export const checkout = 2;\n");
        git(rootPath, "commit", "-q", "-am", "change checkout");
        await writeIndex(rootPath, git(rootPath, "rev-parse", "HEAD"));

        const data = await status(rootPath);

        expect(data.codeDrift.status).toBe("drift");
        expect(data.codeDrift.incompleteHistory).toBe("missing-code-commit");
        expect(data.codeDrift.countedFrom.sha).toBe(landingSha);
        expect(data.codeDrift.rule).toContain(`the code commit it read (${missing.slice(0, 7)}) is not in this repository`);
        expect(data.codeDrift.rule).toContain("code that merged between the two is not counted");
        // A since run from the commit it can reach would leave the earlier code unchecked and then
        // read in step: the step is the whole codebase, with no since.
        expect(data.nextStep.tool).toBe("codebase_verify");
        expect(data.nextStep.then).toEqual({ tool: "codebase_extract", args: { rootPath } });
        expect(data.nextStep.summary).toContain("That is only what can be seen");
        expect(data.nextStep.summary).toContain("run codebase_extract with no since and no plan active");
        expect(data.nextStep.summary).not.toContain("since: \"");
      });

      it("never hands git a stamp's code commit that isn't a commit id", async () => {
        await stampReconciled(rootPath, { changeset: "extract-bootstrap", codeCommit: "--output=stolen" });
        commitModel();
        const seen: string[] = [];
        const spy: GitRunner = async (args, cwd) => {
          seen.push(...args);
          return runGit(args, cwd);
        };

        const data = (await projectStatus({ rootPath }, { git: spy })) as any;

        expect(seen.some((arg) => arg.includes("--output"))).toBe(false);
        // It names no commit this repository has, so the baseline is out of reach.
        expect(data.codeDrift.status).toBe("unknown");
      });

      it("counts from a commit that is in the repository but off this branch, tree to tree", async () => {
        // The extraction ran on a branch whose commit never became an ancestor of HEAD (a squash merge).
        git(rootPath, "checkout", "-q", "-b", "feature");
        await writeFile(join(rootPath, "src", "other.ts"), "export const other = 2;\n");
        git(rootPath, "commit", "-q", "-am", "work on the branch");
        const branchSha = git(rootPath, "rev-parse", "HEAD");
        git(rootPath, "checkout", "-q", "-");
        await stampReconciled(rootPath, { changeset: "extract-bootstrap", codeCommit: branchSha });
        commitModel();

        const data = await status(rootPath);

        expect(data.codeDrift.countedFrom.sha).toBe(branchSha);
        // The model's file is the same in both trees; the branch's other change is not on HEAD.
        expect(data.codeDrift.status).toBe("in-step");
        expect(data.codeDrift.unreferenced).toMatchObject({ files: 1, sourceFiles: 1, newSourceFiles: 0, first: ["src/other.ts"] });
      });

      it("says the rule can't tell files committed with the model from files merged in between", async () => {
        // The extraction read checkout.ts with uncommitted edits; they were committed with the model.
        await writeFile(join(rootPath, "src", "checkout.ts"), "export const checkout = 2;\n");
        await stampReconciled(rootPath, { changeset: "extract-bootstrap", codeCommit: modelSha });
        git(rootPath, "add", "-A");
        git(rootPath, "commit", "-q", "-m", "land the model with the code it describes");

        const data = await status(rootPath);

        expect(data.codeDrift.status).toBe("drift");
        expect(data.codeDrift.rule).toContain("files committed between the two count as changed, including any the extraction read before they were committed");
      });

      describe("in a shallow clone", () => {
        let clone: string;

        beforeEach(() => {
          clone = `${rootPath}-shallow`;
        });

        afterEach(async () => {
          await rm(clone, { recursive: true, force: true });
        });

        it("says unknown when the as-built landing's code commit is past where the history was cut", async () => {
          await stampReconciled(rootPath, { changeset: "extract-bootstrap", codeCommit: modelSha });
          commitModel();
          git(rootPath, "clone", "-q", "--depth", "1", `file://${rootPath}`, clone);
          clearModelCache();

          const data = await status(clone);

          expect(data.codeDrift).toMatchObject({ status: "unknown", incompleteHistory: "missing-code-commit", shallow: true });
          expect(data.codeDrift.reason).toContain("it is a shallow clone");
          expect(data.nextStep.tool).toBeNull();
          expect(data.nextStep.summary).toContain("git fetch --unshallow");
          expect(data.nextStep.summary).not.toContain("in step");
        });

        it("reports the drift a deeper clone can see, and sends the catch-up to the whole codebase, not a since", async () => {
          // Two commits deep: the last code change is visible, and the commit before it, where the
          // history was cut, passes for the one that brought the model in.
          await writeFile(join(rootPath, "src", "other.ts"), "export const other = 2;\n");
          git(rootPath, "commit", "-q", "-am", "change other");
          await writeFile(join(rootPath, "src", "checkout.ts"), "export const checkout = 2;\n");
          git(rootPath, "commit", "-q", "-am", "change checkout");
          git(rootPath, "clone", "-q", "--depth", "2", `file://${rootPath}`, clone);
          clearModelCache();
          await writeIndex(clone, git(clone, "rev-parse", "HEAD"));

          const data = await status(clone);

          expect(data.codeDrift).toMatchObject({ status: "drift", incompleteHistory: "shallow-clone", shallow: true });
          expect(data.codeDrift.changedSourceFiles.map((f: any) => f.file)).toEqual(["src/checkout.ts"]);
          expect(data.codeDrift.rule).toContain("This repository is a shallow clone whose history stops at");
          expect(data.nextStep.then).toEqual({ tool: "codebase_extract", args: { rootPath: clone } });
          expect(data.nextStep.summary).toContain("(it is a shallow clone)");
          expect(data.nextStep.summary).toContain("run codebase_extract with no since and no plan active");
        });

        it("says unknown for a model with no as-built landing when history stops at the baseline", async () => {
          git(rootPath, "clone", "-q", "--depth", "1", `file://${rootPath}`, clone);
          clearModelCache();

          const data = await status(clone);

          expect(data.codeDrift).toMatchObject({ status: "unknown", incompleteHistory: "shallow-clone", shallow: true });
          expect(data.codeDrift.reason).toContain("shallow clone and its history stops at");
          expect(data.nextStep.summary).not.toContain("in step");
        });
      });

      it("names the five latest changesets landed since, counts them all, and returns every one through list", async () => {
        await stampReconciled(rootPath, { changeset: "extract-bootstrap", codeCommit: modelSha });
        const manifest = join(rootPath, "documentation-robotics", "model", "manifest.yaml");
        const landed = Array.from({ length: 7 }, (_, i) => `plan-${i}`);
        await writeFile(
          manifest,
          `${(await readFile(manifest, "utf-8")).trimEnd()}\nchangeset_history:\n` +
            landed.map((name, i) => `  - name: ${name}\n    committed_at: 2021-01-0${i + 1}T00:00:00.000Z\n    action: committed\n`).join("")
        );
        clearModelCache();
        commitModel();
        await writeFile(join(rootPath, "src", "checkout.ts"), "export const checkout = 2;\n");
        git(rootPath, "commit", "-q", "-am", "change checkout");
        await writeIndex(rootPath, git(rootPath, "rev-parse", "HEAD"));

        const data = await status(rootPath);

        expect(data.codeDrift.landedSince).toEqual({ count: 7, changesets: ["plan-6", "plan-5", "plan-4", "plan-3", "plan-2"] });
        expect(data.codeDrift.more).toBe(
          `landedSince shows 5 of 7: project_status with list: "landedSince", offset: 5, rootPath: "${rootPath}" returns the rest.`
        );
        // The sentence gives the whole count and says how many it did not name.
        expect(data.nextStep.summary).toContain('7 landed since ("plan-6", "plan-5", "plan-4", "plan-3", "plan-2" and 2 more)');
        expect(await page(rootPath, "landedSince", { offset: 5 })).toMatchObject({
          items: ["plan-1", "plan-0"],
          page: { total: 7, returned: 2, offset: 5 },
        });
      });

      it("names the plans landed since, and says they did not move the baseline (#1228)", async () => {
        await stampReconciled(rootPath, { changeset: "extract-bootstrap", codeCommit: modelSha });
        commitModel();
        await writeFile(join(rootPath, "src", "checkout.ts"), "export const checkout = 2;\n");
        git(rootPath, "commit", "-q", "-am", "build the refunds plan");
        // The plan lands after its build was verified; landing it writes no stamp.
        await land(rootPath, await stagePlan(rootPath, "add-refunds", "refunds"));
        await writeIndex(rootPath, commitModel("land the add-refunds plan"));

        const data = await status(rootPath);

        expect(data.codeDrift.status).toBe("drift");
        expect(data.codeDrift.countedFrom.sha).toBe(modelSha);
        expect(data.codeDrift.landedSince).toEqual({ count: 1, changesets: ["add-refunds"] });
        expect(data.codeDrift.rule).toContain("a landed plan does not, verified or not");
        // The model-only commits are not code drift.
        expect(data.codeDrift.commitsSince).toBe(1);
        expect(data.codeDrift.note).toBeUndefined();
        expect(data.nextStep.summary).toContain('Landed plans don\'t reconcile it, verified or not: 1 landed since ("add-refunds") and the baseline did not move.');
        expect(data.nextStep.summary).toContain("land the reconcile changeset it makes when the user asks");
        expect(data.nextStep.summary).toContain("any other name makes a plan, which does not clear this");
      });
    });

    describe("with drift", () => {
      beforeEach(async () => {
        await writeFile(join(rootPath, "src", "checkout.ts"), "export const checkout = 2;\n");
        git(rootPath, "commit", "-q", "-am", "change the code");
      });

      it("asks for an index first when there is none, then codebase_verify", async () => {
        const data = await status(rootPath);

        expect(data.nextStep.tool).toBe("codebase_index");
        expect(data.nextStep.args).toEqual({ wait: 30, rootPath });
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

      /** The service's YAML file, relative to the repo. */
      function serviceFile(): string {
        return git(rootPath, "ls-files", "documentation-robotics/model/05_application")
          .split("\n")
          .find((file) => file.endsWith(".yaml"))!;
      }

      it("walks past spec-migration commits to the last other model commit (round 2, bug 2)", async () => {
        // Two migrations, as project_upgrade commits them: each changes spec_version in the
        // manifest; the second also rewrites relationships and moves a retyped element's block.
        await setSpecVersion(rootPath, "0.10.0");
        git(rootPath, "commit", "-q", "-am", "Upgrade DR model to spec 0.10.0");
        await setSpecVersion(rootPath, getCliBundledSpecVersion());
        await writeFile(join(rootPath, "documentation-robotics", "model", "relationships.yaml"), "[]\n");
        const from = serviceFile();
        const moved = from.replace(/[^/]+\.yaml$/, "retyped_service.yaml");
        await writeFile(join(rootPath, moved), await readFile(join(rootPath, from), "utf-8"));
        git(rootPath, "rm", "-q", from);
        git(rootPath, "add", "-A");
        git(rootPath, "commit", "-q", "-m", "Upgrade DR model");
        const upgradeSha = git(rootPath, "rev-parse", "HEAD");
        await writeIndex(rootPath, upgradeSha);

        const data = await status(rootPath);

        expect(data.codeDrift.status).toBe("drift");
        expect(data.codeDrift.modelCommit.sha).toBe(modelSha);
        expect(data.codeDrift.basis).toBe("last-non-migration-commit");
        expect(data.codeDrift.lastModelCommit).toMatchObject({ sha: upgradeSha, subject: "Upgrade DR model" });
        expect(data.codeDrift.note).toContain("migrated the model to a new spec version");
        expect(data.codeDrift.note).toContain("other model edits made in those commits");
        // One commit changed code; the two that only rewrote the model are not code drift.
        expect(data.codeDrift.commitsSince).toBe(1);
        expect(data.codeDrift.changedSourceFiles.map((f: any) => f.file)).toEqual(["src/checkout.ts"]);
        expect(data.nextStep.then).toEqual({ tool: "codebase_extract", args: { since: modelSha, rootPath } });
      });

      it("counts from an ordinary model commit, such as a catch-up that only edits a description (review)", async () => {
        const file = serviceFile();
        const text = await readFile(join(rootPath, file), "utf-8");
        await writeFile(join(rootPath, file), text.replace(/^(\s*)name: (.*)$/m, "$1name: $2\n$1description: Checks out the cart"));
        expect(await readFile(join(rootPath, file), "utf-8")).toContain("description: Checks out the cart");
        git(rootPath, "commit", "-q", "-am", "catch up after codebase_verify");
        const catchUpSha = git(rootPath, "rev-parse", "HEAD");

        const data = await status(rootPath);

        expect(data.codeDrift.modelCommit.sha).toBe(catchUpSha);
        expect(data.codeDrift.basis).toBe("last-non-migration-commit");
        expect(data.codeDrift.lastModelCommit).toBeUndefined();
        expect(data.codeDrift.note).toBeUndefined();
        expect(data.codeDrift.status).toBe("in-step");
      });

      it("falls back to the last model commit, with a note, when telling migrations apart fails (review)", async () => {
        // A migration commit, which the walk would pass over if it could tell.
        await setSpecVersion(rootPath, "0.10.0");
        git(rootPath, "commit", "-q", "-am", "Upgrade DR model");
        const lastSha = git(rootPath, "rev-parse", "HEAD");
        const failing: GitRunner = async (args, cwd) =>
          args[0] === "log" && args.includes("-p") ? { ok: false, error: "timed out" } : runGit(args, cwd);

        const data = await projectStatus({ rootPath }, { git: failing });

        expect(data.codeDrift.status).not.toBe("unknown");
        const drift = data.codeDrift as any;
        expect(drift.modelCommit.sha).toBe(lastSha);
        expect(drift.basis).toBe("last-model-commit");
        expect(drift.note).toContain("timed out");
      });
    });

    it("isn't fooled by the commit that creates the manifest: it adds a spec_version, it doesn't change one", async () => {
      const data = await status(rootPath);
      expect(data.codeDrift.modelCommit.sha).toBe(modelSha);
      expect(data.codeDrift.basis).toBe("last-non-migration-commit");
    });

    it("walks past a merge that brings in a spec upgrade (review)", async () => {
      // An upgrade lands on its own branch.
      git(rootPath, "checkout", "-q", "-b", "upgrade");
      await setSpecVersion(rootPath, "0.10.0");
      git(rootPath, "commit", "-q", "-am", "Upgrade DR model");
      git(rootPath, "checkout", "-q", "-");
      // Meanwhile the feature branch edits the model, then the code.
      const manifest = join(rootPath, "documentation-robotics", "model", "manifest.yaml");
      await writeFile(manifest, (await readFile(manifest, "utf-8")) + "# feature note\n");
      git(rootPath, "commit", "-q", "-am", "feature model edit");
      const featureSha = git(rootPath, "rev-parse", "HEAD");
      await writeFile(join(rootPath, "src", "checkout.ts"), "export const checkout = 2;\n");
      git(rootPath, "commit", "-q", "-am", "change the code");
      // `git merge` brings the upgrade in: a merge commit whose only diff from its first parent
      // is the migration.
      git(rootPath, "merge", "-q", "--no-edit", "--no-ff", "upgrade");
      const mergeSha = git(rootPath, "rev-parse", "HEAD");
      expect(git(rootPath, "rev-list", "--parents", "-n", "1", "HEAD").split(" ")).toHaveLength(3);

      const data = await status(rootPath);

      expect(data.codeDrift.modelCommit.sha).toBe(featureSha);
      expect(data.codeDrift.basis).toBe("last-non-migration-commit");
      expect(data.codeDrift.lastModelCommit.sha).toBe(mergeSha);
      expect(data.codeDrift.status).toBe("drift");
      expect(data.codeDrift.changedSourceFiles.map((f: any) => f.file)).toEqual(["src/checkout.ts"]);
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

      // A commit that changes no source file (a README) leaves the index fresh.
      await writeFile(join(rootPath, "README.md"), "later\n");
      git(rootPath, "add", "README.md");
      git(rootPath, "commit", "-q", "-m", "docs");
      data = await status(rootPath);
      expect(data.codeIndex.status).toBe("fresh");
      expect(data.codeIndex.headCommit).not.toBe(modelSha);
      expect(data.codeIndex.reason).toContain("no commit since changed a source file");

      // A source file the model doesn't reference: no drift, but the index is stale, so re-index.
      await writeFile(join(rootPath, "src", "other.ts"), "export const other = 2;\n");
      git(rootPath, "commit", "-q", "-am", "code");
      data = await status(rootPath);
      expect(data.codeDrift.status).toBe("in-step");
      expect(data.codeIndex.status).toBe("stale");
      expect(data.codeIndex.changedSinceIndex).toEqual(["src/other.ts"]);
      expect(data.nextStep.tool).toBe("codebase_index");
      expect(data.nextStep.args).toEqual({ wait: 30, rootPath });
      expect(data.nextStep.summary).toContain("Refresh");
    });

    it("calls an index that holds no code stale at its own commit, and points at codebase_index (#1345)", async () => {
      await writeIndex(rootPath, modelSha);
      const meta = join(rootPath, ".dr", "analyzers", "cbm", "index-meta.json");
      await writeFile(meta, JSON.stringify({ git_head: modelSha, timestamp: "2026-11-09T00:00:00Z", node_count: 0, edge_count: 0 }));
      const data = await status(rootPath);
      expect(data.codeIndex).toMatchObject({ status: "stale", indexedCommit: modelSha, nodes: 0 });
      expect(data.codeIndex.reason).toContain("holds no code");
      expect(data.nextStep.tool).toBe("codebase_index");
    });

    it("keeps the index fresh after a commit that touched only the model (bug 11)", async () => {
      await writeIndex(rootPath, modelSha);
      // What landing a changeset commits: model files, and DR's own folders.
      await ok(await modelAddHandler({ layer: "application", type: "applicationfunction", name: "audit", rootPath }));
      await mkdir(join(rootPath, ".dr", "notes"), { recursive: true });
      await writeFile(join(rootPath, ".dr", "notes", "helper.ts"), "export const x = 1;\n");
      git(rootPath, "add", "-A");
      git(rootPath, "commit", "-q", "-m", "land the model change");
      clearModelCache();

      const data = await status(rootPath);

      expect(data.codeIndex.status).toBe("fresh");
      expect(data.codeIndex.headCommit).not.toBe(modelSha);
      expect(data.codeIndex.changedSinceIndex).toBeUndefined();
      expect(data.nextStep.tool).toBe("changeset_create");
    });

    it("reports uncommitted source edits newer than the index (bug 11)", async () => {
      // Taken a minute ago, at the current HEAD; then a source file is edited and not committed.
      await writeIndex(rootPath, modelSha, new Date(Date.now() - 60_000).toISOString());
      await writeFile(join(rootPath, "src", "other.ts"), "export const other = 3;\n");

      const data = await status(rootPath);

      expect(data.codeIndex.status).toBe("fresh-with-uncommitted-edits");
      expect(data.codeIndex.uncommittedEdits).toEqual(["src/other.ts"]);
      expect(data.codeIndex.reason).toContain("src/other.ts");
      expect(data.nextStep.tool).toBe("codebase_index");
      expect(data.nextStep.args).toEqual({ wait: 30, rootPath });
    });

    it("ignores uncommitted edits older than the index", async () => {
      await writeFile(join(rootPath, "src", "other.ts"), "export const other = 4;\n");
      await writeIndex(rootPath, modelSha, new Date(Date.now() + 60_000).toISOString());

      const data = await status(rootPath);

      expect(data.codeIndex.status).toBe("fresh");
    });

    // An index taken later than every mtime: only what the rule counts regardless of time shows.
    const later = () => new Date(Date.now() + 60_000).toISOString();

    it("counts an uncommitted delete whatever the mtimes (review: bug 1)", async () => {
      await writeIndex(rootPath, modelSha, later());
      await rm(join(rootPath, "src", "other.ts"));

      const data = await status(rootPath);

      expect(data.codeIndex.status).toBe("fresh-with-uncommitted-edits");
      expect(data.codeIndex.uncommittedEdits).toEqual(["src/other.ts"]);
    });

    it("counts the old path of an uncommitted rename (git mv keeps the mtime)", async () => {
      await writeIndex(rootPath, modelSha, later());
      git(rootPath, "mv", "src/other.ts", "src/moved.ts");

      const data = await status(rootPath);

      expect(data.codeIndex.status).toBe("fresh-with-uncommitted-edits");
      expect(data.codeIndex.uncommittedEdits).toContain("src/other.ts");
    });

    it("ignores an mtime in the future (clock skew), so it doesn't ask for a re-index every call", async () => {
      await writeIndex(rootPath, modelSha, new Date(Date.now() - 60_000).toISOString());
      await writeFile(join(rootPath, "src", "other.ts"), "export const other = 5;\n");
      const future = new Date(Date.now() + 3_600_000);
      await utimes(join(rootPath, "src", "other.ts"), future, future);

      const data = await status(rootPath);

      expect(data.codeIndex.status).toBe("fresh");
    });

    it("ignores vendored and built code", async () => {
      await writeIndex(rootPath, modelSha, new Date(Date.now() - 60_000).toISOString());
      await mkdir(join(rootPath, "node_modules", "lib"), { recursive: true });
      await writeFile(join(rootPath, "node_modules", "lib", "index.js"), "module.exports = 1;\n");
      await mkdir(join(rootPath, "dist"), { recursive: true });
      await writeFile(join(rootPath, "dist", "out.js"), "1;\n");

      expect((await status(rootPath)).codeIndex.status).toBe("fresh");
    });

    it("sees a revert of edits the index was built with, from the run's working-tree snapshot", async () => {
      // An index built (by codebase_index's run job-7) while src/other.ts had an uncommitted edit.
      const edited = "export const other = 6;\n";
      await writeFile(join(rootPath, "src", "other.ts"), edited);
      const takenAt = new Date(Date.now() - 60_000);
      const analyzers = join(rootPath, ".dr", "analyzers");
      await writeIndex(rootPath, modelSha, new Date(takenAt.getTime() + 1000).toISOString());
      await writeFile(
        join(analyzers, "index-job.json"),
        JSON.stringify({
          version: 1,
          jobId: "job-7",
          pid: null,
          state: "done",
          analyzer: "cbm",
          force: false,
          startedAt: takenAt.toISOString(),
          finishedAt: new Date(takenAt.getTime() + 5000).toISOString(),
          error: null,
          progress: { phase: "done", updatedAt: new Date(takenAt.getTime() + 5000).toISOString() },
          logPath: join(analyzers, "index-job.log"),
          result: null,
        })
      );
      await writeFile(
        join(analyzers, "cbm", "index-worktree.json"),
        JSON.stringify({
          version: 1,
          jobId: "job-7",
          takenAt: takenAt.toISOString(),
          files: { "src/other.ts": createHash("sha1").update(edited).digest("hex") },
        })
      );

      // The working tree is as it was indexed: fresh, though the edit is newer than the index time.
      expect((await status(rootPath)).codeIndex.status).toBe("fresh");

      // `git checkout -- file` puts back the committed text: no longer what the index read.
      git(rootPath, "checkout", "--", "src/other.ts");
      const data = await status(rootPath);
      expect(data.codeIndex.status).toBe("fresh-with-uncommitted-edits");
      expect(data.codeIndex.uncommittedEdits).toEqual(["src/other.ts"]);
    });
  });
});

describe("changesSpecVersion (round 2, bug 2)", () => {
  it("is true only when the manifest diff swaps one spec_version for another", () => {
    expect(changesSpecVersion("--- a/m/manifest.yaml\n+++ b/m/manifest.yaml\n-spec_version: 0.10.0\n+spec_version: 0.11.0")).toBe(true);
    expect(changesSpecVersion('-spec_version: "0.10.0"\n+spec_version: 0.11.0')).toBe(true);
    // The commit that creates the manifest only adds it.
    expect(changesSpecVersion("--- /dev/null\n+++ b/m/manifest.yaml\n+spec_version: 0.10.0")).toBe(false);
    // Re-quoting the same version, or editing other lines, is not a migration.
    expect(changesSpecVersion('-spec_version: 0.11.0\n+spec_version: "0.11.0"')).toBe(false);
    expect(changesSpecVersion("-name: a\n+name: b")).toBe(false);
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
    expect(step.args).toEqual({ status: true, wait: 30 });
    expect(step.summary).toContain("being indexed");
    expect(step.also).toBeUndefined();
  });

  describe("with an as-built changeset active (final review)", () => {
    const entry = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      name: id,
      changes: { total: 1 },
      baseDrifted: false,
      ...extra,
    });
    const withStaged = (active: any, staged: any[]) => ({
      ...base,
      changesets: { ...base.changesets, active, staged: [active, ...staged] },
    });

    it("verifies against the single other plan when extraction recorded none", () => {
      const asBuilt = entry("extract-1", { asBuilt: true });
      const step = suggestNextStep(withStaged(asBuilt, [entry("plan-a"), entry("extract-0", { asBuilt: true })]), { root: "/p" });
      expect(step.tool).toBe("changeset_verify");
      expect(step.args).toEqual({ changeset: "plan-a", against: { changeset: "extract-1" } });
      expect(step.also).toMatchObject({ tool: "changeset_activate", args: { changeset: "plan-a" } });
    });

    it("never offers to land a verification record whose plan is no longer staged (#1171)", () => {
      const record = entry("plan-a-as-built", {
        asBuilt: true,
        purpose: "verification",
        verifies: "plan-a",
        actions: ["discard"],
        previousActive: { id: "plan-a", name: "plan-a" },
      });
      const step = suggestNextStep(withStaged(record, []), { root: "/p" });
      expect(step.tool).toBe("changeset_deactivate");
      expect(step.summary).toContain('verification record of the plan "plan-a"');
      expect(step.summary).toContain("never landed");
      expect(step.summary).toContain("keep it as a record");
      expect(step.summary).not.toContain("changeset_commit");
    });

    it("names the plans and picks none when several are staged and nothing records which", () => {
      const asBuilt = entry("extract-1", { asBuilt: true });
      const step = suggestNextStep(withStaged(asBuilt, [entry("plan-a"), entry("plan-b")]), { root: "/p" });
      expect(step.tool).toBeNull();
      expect(step.summary).toContain('"plan-a", "plan-b"');
      expect(step.summary).toContain("Ask the user");
    });

    it("still says an index run is going, in the summary, while its also reactivates the plan", () => {
      const asBuilt = entry("extract-1", { asBuilt: true });
      const indexing = {
        status: "running",
        jobId: "j",
        phase: "indexing",
        startedAt: "2026-11-10T00:00:00Z",
        finishedAt: null,
        error: null,
        logPath: "/p/.dr/analyzers/index-job.log",
      };
      const step = suggestNextStep({ ...withStaged(asBuilt, [entry("plan-a")]), indexing } as any, { root: "/p" });
      expect(step.tool).toBe("changeset_verify");
      expect(step.also).toMatchObject({ tool: "changeset_activate", args: { changeset: "plan-a" } });
      expect(step.summary).toContain("being indexed");
      expect(step.summary).toContain("status: true and wait: 30");
    });
  });

  describe("with a changeset active (round 2, bug 7)", () => {
    const active = { id: "c", name: "plan", changes: { total: 3 }, baseDrifted: false };
    const withChangeset = { ...base, changesets: { ...base.changesets, active, staged: [active] } };
    const running = {
      status: "running",
      jobId: "j",
      phase: "indexing",
      startedAt: "2026-11-10T00:00:00Z",
      finishedAt: null,
      error: null,
      logPath: "/p/.dr/analyzers/index-job.log",
    };

    it("keeps the changeset step and says an index run is going, with the call that waits for it", () => {
      const step = suggestNextStep({ ...withChangeset, indexing: running }, { root: "/p", rootPath: "/p" });
      expect(step.tool).toBe("changeset_brief");
      expect(step.also).toEqual({
        summary: expect.stringContaining("being indexed"),
        tool: "codebase_index",
        args: { status: true, wait: 30, rootPath: "/p" },
      });
      expect(step.summary).toContain('Changeset "plan"');
      expect(step.summary).toContain("being indexed");
    });

    it("says when the index hasn't seen uncommitted edits", () => {
      const step = suggestNextStep(
        {
          ...withChangeset,
          codeIndex: {
            status: "fresh-with-uncommitted-edits",
            analyzer: "cbm",
            reason: "1 source file has uncommitted changes the index hasn't seen: src/a.ts",
          },
        },
        { root: "/p" }
      );
      expect(step.tool).toBe("changeset_brief");
      expect(step.also).toMatchObject({ tool: "codebase_index", args: { wait: 30 } });
      expect(step.also!.summary).toContain("src/a.ts");
    });

    it("adds nothing when the index is fresh or absent", () => {
      for (const codeIndex of [
        { status: "fresh", analyzer: "cbm" },
        { status: "absent", analyzer: null, reason: "none" },
      ]) {
        const step = suggestNextStep({ ...withChangeset, codeIndex }, { root: "/p" });
        expect(step.tool).toBe("changeset_brief");
        expect(step.also).toBeUndefined();
      }
    });
  });
});

describe("suggestNextStep on base drift and a stale server", () => {
  const fresh = {
    model: { status: "present", path: "/p/documentation-robotics/model" },
    spec: { status: "current", model: "0.14.0", cli: "0.14.0", upgradeNeeded: false },
    server: { status: "current", version: "0.6.0" },
    changesets: { status: "ok", active: null, staged: [], committed: 0, discarded: 0 },
    codeIndex: { status: "fresh", analyzer: "cbm" },
    codeDrift: { status: "in-step" },
    indexing: { status: "none" },
    viewer: { status: "none" },
  } as any;
  const plan = (drift?: Record<string, unknown>) => ({
    id: "cs-1",
    name: "parked",
    changes: { total: 2, update: 2 },
    baseDrifted: drift?.state === "drifted",
    purpose: "plan",
    actions: ["commit", "discard"],
    ...(drift ? { drift } : {}),
  });
  const drifted = {
    state: "drifted",
    landing: DRIFTED_LANDING,
    baseChanges: { elementsChanged: 2, relationshipsAdded: 1 },
    overlapping: { elements: 4, relationships: 0, first: ["a.b.c (changed-in-base)", "a.b.d (removed-in-base)", "a.b.e (changed-in-base)"] },
    next: { tool: "changeset_brief", args: { changeset: "cs-1", sections: ["drift"] } },
  };

  it("names a staged plan whose base drifted, what landing it takes and the call that lists what moved", () => {
    const step = suggestNextStep({ ...fresh, changesets: { ...fresh.changesets, staged: [plan(drifted)] } }, { root: "/p" });

    expect(step.tool).toBe("changeset_activate");
    expect(step.summary).toContain('The base model changed under "parked"');
    expect(step.summary).toContain(DRIFTED_LANDING_WORDS);
    expect(step.summary).toContain('changeset_brief with changeset: "parked" and sections: ["drift"] names what moved');
  });

  it("says what moved under the active plan and how many staged changes overlap, cut to the first few", () => {
    const step = suggestNextStep({ ...fresh, changesets: { ...fresh.changesets, active: plan(drifted), staged: [plan(drifted)] } }, { root: "/p" });

    expect(step.tool).toBe("changeset_brief");
    expect(step.args).toEqual({ sections: ["drift"] });
    expect(step.summary).toContain("2 elements changed, 1 relationship added in the base");
    expect(step.summary).toContain("4 of its staged changes overlap (a.b.c (changed-in-base); a.b.d (removed-in-base); a.b.e (changed-in-base); ...)");
  });

  it("reports drift that only warns as allowed, from the core's answer (#1200)", () => {
    const warns = { ...drifted, landing: "allowed-with-warning" };
    const step = suggestNextStep({ ...fresh, changesets: { ...fresh.changesets, active: plan(warns), staged: [plan(warns)] } }, { root: "/p" });

    expect(step.summary).toContain("Landing it is allowed, with a warning");
    // The one case still refused without force is the CLI's unattended commit, and it says so.
    expect(step.summary).toContain("an unattended `dr changeset commit` needs --force");
    expect(step.summary).not.toContain("force: true");
  });

  it("says a base that moved elsewhere doesn't block the active plan, and keeps the ordinary step", () => {
    const elsewhere = { state: "content-free", landing: "allowed", baseChanges: { elementsAdded: 3 } };
    const step = suggestNextStep({ ...fresh, changesets: { ...fresh.changesets, active: plan(elsewhere), staged: [plan(elsewhere)] } }, { root: "/p" });

    expect(step.tool).toBe("changeset_brief");
    expect(step.args).toBeUndefined();
    expect(step.summary).toContain("The base model changed since it was created (3 elements added), but nothing it stages against. Landing it is not blocked.");
    expect(step.summary).toContain("pick up the plan");
  });

  it("agrees with its own reason for a changeset that has no base snapshot: a commit is not blocked", () => {
    const noSnapshot = {
      state: "unknown",
      landing: "allowed",
      reason: "No base snapshot was recorded for this changeset, so drift cannot be checked. A commit is not blocked by drift.",
    };
    const step = suggestNextStep({ ...fresh, changesets: { ...fresh.changesets, active: plan(noSnapshot), staged: [plan(noSnapshot)] } }, { root: "/p" });

    expect(step.summary).toContain("Its base drift could not be checked: No base snapshot was recorded");
    expect(step.summary).not.toContain("Whether it can land can't be told");
  });

  it("doesn't say a landing is allowed when drift could not be checked", () => {
    const unchecked = { state: "unknown", landing: "unknown", reason: "Drift could not be checked: boom" };
    const step = suggestNextStep({ ...fresh, changesets: { ...fresh.changesets, active: plan(unchecked), staged: [plan(unchecked)] } }, { root: "/p" });

    expect(step.summary).toContain("Its base drift could not be checked: Drift could not be checked: boom");
    expect(step.summary).toContain("Whether it can land can't be told until its drift can be checked.");
    expect(step.summary).not.toContain("not blocked");
  });

  it("tells a drifted as-built changeset what landing it takes, not only to land it", () => {
    const asBuilt = { ...plan(drifted), name: "extract-abc", purpose: "reconcile", asBuilt: true };
    const step = suggestNextStep({ ...fresh, changesets: { ...fresh.changesets, active: asBuilt, staged: [asBuilt] } }, { root: "/p" });

    expect(step.tool).toBe("review_open");
    expect(step.summary).toContain("keep-as-built catch-up");
    expect(step.summary).toContain("The base model changed under it since it was created");
    expect(step.summary).toContain(DRIFTED_LANDING_WORDS);
    expect(step.summary).toContain('changeset_brief with sections: ["drift"] lists what moved.');
  });

  it("doesn't call the model current when code drift could not be checked", () => {
    const step = suggestNextStep({ ...fresh, codeDrift: { status: "unknown", reason: "git log failed: timed out" } }, { root: "/p" });

    expect(step.summary).toContain("Whether the model is in step with the code could not be checked: git log failed: timed out.");
    expect(step.summary).not.toContain("The model is current");
  });

  it("says nothing about drift for a plan whose base is as it was", () => {
    const step = suggestNextStep({ ...fresh, changesets: { ...fresh.changesets, active: plan(), staged: [plan()] } }, { root: "/p" });

    expect(step.summary).toBe('Changeset "parked" is active with 2 staged changes. Read its brief with changeset_brief to pick up the plan.');
  });

  it("adds the restart to any step when the server is older than the installed CLI", () => {
    const stale = { status: "stale", version: "0.5.0", installed: { version: "0.6.0", spec: "0.14.0" }, note: "CLI 0.6.0 is installed now." };
    const step = suggestNextStep({ ...fresh, server: stale }, { root: "/p" });

    expect(step.tool).toBe("changeset_create");
    expect(step.summary).toContain("To plan a change, start with changeset_create. Also: CLI 0.6.0 is installed now.");
  });
});

describe("project_status indexing section", () => {
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
