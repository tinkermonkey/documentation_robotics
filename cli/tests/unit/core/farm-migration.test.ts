/**
 * dr-farm-v2 and the dr-farm-v1 migration (issue 1279), against real temporary git
 * repositories and worktrees. Covers testing.testcasesketch.farm-v2-migration-sketch.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FarmManifest, farmPathFor } from "../../../src/core/farm-manifest.js";
import { migrateFarmManifest } from "../../../src/core/farm-migration.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, env: GIT_ENV, stdio: "pipe" });
}

async function createRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  await writeFile(path.join(dir, "README.md"), "# test\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
}

// Tests in tests/unit/core/ run concurrently: each test gets its own farm folder.
const scratchDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "dr-farm-migrate-")));
  scratchDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(scratchDirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe("dr-farm-v2 manifest", () => {
  it("writes dr-farm-v2 with name, repository, model and remote, and reads it back", async () => {
    const farm = await scratch();
    const farmFile = path.join(farm, "farm.yaml");
    const manifest = FarmManifest.create("Farm");
    manifest.addProject("api", { name: "api", repository: "api", model: "api-model", remote: "https://x/api.git" });
    await manifest.save(farmFile);

    const text = await readFile(farmFile, "utf-8");
    expect(text).toContain("schema: dr-farm-v2");
    expect(text).toContain("repository: api");
    expect(text).not.toContain("source:");
    expect(text).not.toContain("branch:");

    const loaded = await FarmManifest.load(farmFile);
    expect(loaded.isLegacy()).toBe(false);
    expect(loaded.getProject("api")).toEqual({
      name: "api",
      repository: "api",
      model: "api-model",
      remote: "https://x/api.git",
    });
  });

  it("refuses a second project for a repository the farm already holds, naming that project", async () => {
    const farm = await scratch();
    const farmFile = path.join(farm, "farm.yaml");
    const manifest = FarmManifest.create("Farm");
    manifest.filePath = farmFile;
    manifest.addProject("api", { name: "api", repository: "services/api", model: "api-model" });
    expect(() =>
      manifest.addProject("api-2", { name: "api-2", repository: path.join(farm, "services", "api"), model: "m" })
    ).toThrow(/already in the farm as project 'api'/);
  });

  it("requires repository in a dr-farm-v2 entry", async () => {
    const farm = await scratch();
    const farmFile = path.join(farm, "farm.yaml");
    await writeFile(farmFile, "schema: dr-farm-v2\nname: F\nprojects:\n  a:\n    name: a\n    model: m\n");
    await expect(FarmManifest.load(farmFile)).rejects.toThrow(/missing required 'repository' field/);
  });

  it("refuses an unknown schema", async () => {
    const farm = await scratch();
    const farmFile = path.join(farm, "farm.yaml");
    await writeFile(farmFile, "schema: dr-farm-v9\nname: F\nprojects: {}\n");
    await expect(FarmManifest.load(farmFile)).rejects.toThrow(/Unsupported farm schema 'dr-farm-v9'/);
  });

  it("reads dr-farm-v1 with a notice naming dr farm migrate, and refuses to write it", async () => {
    const farm = await scratch();
    const farmFile = path.join(farm, "farm.yaml");
    await writeFile(
      farmFile,
      "schema: dr-farm-v1\nname: F\nprojects:\n  a:\n    name: a\n    source: a\n    model: a-model\n    branch: dev\n"
    );
    const manifest = await FarmManifest.load(farmFile);
    expect(manifest.isLegacy()).toBe(true);
    expect(manifest.getProject("a")).toEqual({ name: "a", repository: "a", model: "a-model" });
    expect(manifest.legacyEntries?.get("a")?.branch).toBe("dev");
    expect(manifest.legacyNotice()).toContain("dr farm migrate");
    await expect(manifest.save()).rejects.toThrow(/dr farm migrate/);
  });

  it("records a path inside the farm relative to it, and one outside as absolute", async () => {
    const farm = await scratch();
    const farmFile = path.join(farm, "farm.yaml");
    expect(farmPathFor("/f", "/f/a/b")).toBe("a/b");
    expect(farmPathFor("/f", "/f")).toBe(".");
    expect(farmPathFor("/f", "/g/a")).toBe("/g/a");
  });
});

describe("migrateFarmManifest", () => {
  /**
   * A v1 farm with three entries: `service` (the main checkout of services/service),
   * `service-feature` (a linked worktree of it) and `web` (another repository).
   */
  async function v1Farm(farm: string, farmFile: string): Promise<void> {
    await createRepo(path.join(farm, "services", "service"));
    git(path.join(farm, "services", "service"), "worktree", "add", "-q", "-b", "feature", path.join(farm, "trees", "feature"));
    await createRepo(path.join(farm, "web"));
    await writeFile(
      farmFile,
      [
        "schema: dr-farm-v1",
        "name: Old Farm",
        "platform_view: true",
        "projects:",
        "  service-feature:",
        "    name: service-feature",
        "    source: trees/feature",
        "    model: service-model",
        "    branch: feature",
        "  service:",
        "    name: service",
        "    source: services/service",
        "    model: service-model",
        "    remote: https://example.com/service.git",
        "    branch: main",
        "  web:",
        "    name: web",
        "    source: web",
        "    model: web-model",
        "",
      ].join("\n")
    );
  }

  it("previews one project per repository, its checkouts and the dropped names; apply writes v2; a second run changes nothing", async () => {
    const farm = await scratch();
    const farmFile = path.join(farm, "farm.yaml");
    await v1Farm(farm, farmFile);
    const manifest = await FarmManifest.load(farmFile);
    const plan = await migrateFarmManifest(manifest, farm);

    expect(plan.upToDate).toBe(false);
    expect(plan.conflicts).toEqual([]);
    expect(plan.projects.map((p) => p.project)).toEqual([
      {
        name: "service",
        repository: "services/service",
        model: "service-model",
        remote: "https://example.com/service.git",
      },
      { name: "web", repository: "web", model: "web-model" },
    ]);
    expect(plan.projects[0].entries).toEqual([
      { entry: "service", source: "services/service", checkout: "main" },
      { entry: "service-feature", source: "trees/feature", checkout: "feature" },
    ]);
    expect(plan.dropped).toEqual([
      { name: "service-feature", project: "service", source: "trees/feature", checkout: "feature" },
    ]);

    // Preview writes nothing
    expect(await readFile(farmFile, "utf-8")).toContain("dr-farm-v1");

    await plan.manifest!.save(farmFile);
    const migrated = await FarmManifest.load(farmFile);
    expect(migrated.schema).toBe("dr-farm-v2");
    expect(migrated.name).toBe("Old Farm");
    expect(migrated.platform_view).toBe(true);
    expect([...migrated.projects.keys()]).toEqual(["service", "web"]);
    expect(await readFile(farmFile, "utf-8")).not.toContain("branch:");

    const again = await migrateFarmManifest(migrated, farm);
    expect(again.upToDate).toBe(true);
    expect(again.manifest).toBeUndefined();
  });

  it("names a project after the main checkout's folder when no entry is the main checkout", async () => {
    const farm = await scratch();
    const farmFile = path.join(farm, "farm.yaml");
    await createRepo(path.join(farm, "My_Repo"));
    git(path.join(farm, "My_Repo"), "worktree", "add", "-q", "-b", "x", path.join(farm, "wt-x"));
    await writeFile(
      farmFile,
      "schema: dr-farm-v1\nname: F\nprojects:\n  only-wt:\n    name: only-wt\n    source: wt-x\n    model: wt-x/documentation-robotics/model\n"
    );
    const plan = await migrateFarmManifest(await FarmManifest.load(farmFile), farm);
    expect(plan.projects).toHaveLength(1);
    expect(plan.projects[0].nameDerived).toBe(true);
    // A model inside the worktree moves to the same place in the main checkout
    expect(plan.projects[0].project).toEqual({
      name: "my-repo",
      repository: "My_Repo",
      model: "My_Repo/documentation-robotics/model",
    });
    expect(plan.dropped.map((d) => d.name)).toEqual(["only-wt"]);
  });

  it("keeps a folder that is not in git as a project of its own", async () => {
    const farm = await scratch();
    const farmFile = path.join(farm, "farm.yaml");
    await mkdir(path.join(farm, "plain"));
    await writeFile(farmFile, "schema: dr-farm-v1\nname: F\nprojects:\n  plain:\n    name: plain\n    source: plain\n    model: plain-model\n");
    const plan = await migrateFarmManifest(await FarmManifest.load(farmFile), farm);
    expect(plan.notInGit).toEqual(["plain"]);
    expect(plan.projects.map((p) => p.project)).toEqual([{ name: "plain", repository: "plain", model: "plain-model" }]);
  });

  it("reports a conflict, and no manifest, when two repositories would share a name", async () => {
    const farm = await scratch();
    const farmFile = path.join(farm, "farm.yaml");
    await createRepo(path.join(farm, "a", "svc"));
    await createRepo(path.join(farm, "b", "svc"));
    git(path.join(farm, "b", "svc"), "worktree", "add", "-q", "-b", "w", path.join(farm, "b-wt"));
    await writeFile(
      farmFile,
      "schema: dr-farm-v1\nname: F\nprojects:\n  svc:\n    name: svc\n    source: a/svc\n    model: m1\n  other:\n    name: other\n    source: b-wt\n    model: m2\n"
    );
    const plan = await migrateFarmManifest(await FarmManifest.load(farmFile), farm);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].message).toContain("Two repositories would be named 'svc'");
    expect(plan.manifest).toBeUndefined();
  });
});
