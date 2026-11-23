/**
 * dr farm on dr-farm-v2 (issue 1279): `dr farm migrate`, `dr farm add` resolving a worktree to
 * its project, the user farm fallback and the dr-farm-v1 notice. Real temporary git repositories
 * and worktrees. Covers testing.testcasesketch.farm-commands and farm-v2-migration-sketch.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FarmManifest } from "../../src/core/farm-manifest.js";
import { farmAddCommand, farmMigrateCommand, farmRemoveCommand, farmStatusCommand } from "../../src/commands/farm.js";

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

async function createRepo(dir: string, withModel = false): Promise<string> {
  await mkdir(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  await writeFile(path.join(dir, "README.md"), "# test\n");
  if (withModel) {
    await mkdir(path.join(dir, "documentation-robotics", "model"), { recursive: true });
    await writeFile(
      path.join(dir, "documentation-robotics", "model", "manifest.yaml"),
      `version: "1.0.0"\nproject:\n  name: test\n  version: "1.0.0"\n`
    );
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return realpath(dir);
}

async function capture(fn: () => Promise<void>): Promise<{ json: any; logs: string[]; errors: string[]; exitCode?: number }> {
  const original = { log: console.log, error: console.error, warn: console.warn, exit: process.exit };
  const logs: string[] = [];
  const errors: string[] = [];
  let exitCode: number | undefined;
  console.log = (m: unknown) => logs.push(String(m));
  console.error = (m: unknown) => errors.push(String(m));
  console.warn = (m: unknown) => errors.push(String(m));
  process.exit = ((code?: number) => {
    if (exitCode === undefined) exitCode = code ?? 0;
  }) as typeof process.exit;
  try {
    await fn();
  } finally {
    console.log = original.log;
    console.error = original.error;
    console.warn = original.warn;
    process.exit = original.exit;
  }
  const line = logs.find((l) => l.startsWith("{"));
  return { json: line ? JSON.parse(line) : undefined, logs, errors, exitCode };
}

let tmp: string;
let originalCwd: string;
let originalXdg: string | undefined;
let originalFarmPath: string | undefined;

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), "dr-farm-v2-")));
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_CONFIG_HOME;
  originalFarmPath = process.env.DR_FARM_PATH;
  delete process.env.DR_FARM_PATH;
  process.env.XDG_CONFIG_HOME = path.join(tmp, "xdg");
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdg;
  if (originalFarmPath !== undefined) process.env.DR_FARM_PATH = originalFarmPath;
  await rm(tmp, { recursive: true, force: true });
});

describe("dr farm add (dr-farm-v2)", () => {
  it("adds a repository to the user farm when no folder farm is found, naming it after the main checkout", async () => {
    const repo = await createRepo(path.join(tmp, "code", "My_Service"), true);
    const wt = path.join(tmp, "code", "my-service-wt");
    git(repo, "worktree", "add", "-q", "-b", "feature", wt);
    const elsewhere = path.join(tmp, "elsewhere");
    await mkdir(elsewhere);
    process.chdir(elsewhere);

    // A worktree path: the project is its repository, registered under the main checkout
    const added = await capture(() => farmAddCommand(undefined, { codebase: wt, format: "json" }));
    expect(added.exitCode).toBeUndefined();
    expect(added.json).toMatchObject({
      status: "ok",
      project: "my-service",
      repository: repo,
      resolved_from: wt,
      created: true,
      model_adopted: true,
    });

    const userFarm = path.join(tmp, "xdg", "dr", "farm.yaml");
    const manifest = await FarmManifest.load(userFarm);
    expect(manifest.schema).toBe("dr-farm-v2");
    expect(manifest.getProject("my-service")).toMatchObject({
      repository: repo,
      model: path.join(repo, "documentation-robotics", "model"),
    });

    // The main checkout path, again: found, nothing written
    const again = await capture(() => farmAddCommand(undefined, { codebase: repo, format: "json" }));
    expect(again.json).toMatchObject({ status: "ok", project: "my-service", created: false });

    // A different explicit name for the same repository is refused
    const renamed = await capture(() => farmAddCommand("other", { codebase: wt, format: "json" }));
    expect(renamed.exitCode).toBe(1);
    expect(renamed.json.message).toContain("already in the farm as project 'my-service'");
  });

  it("records a repository without a model at its default model folder in the user farm, creating nothing", async () => {
    const repo = await createRepo(path.join(tmp, "code", "bare-svc"));
    process.chdir(path.join(tmp, "code"));
    const added = await capture(() => farmAddCommand(undefined, { codebase: "bare-svc", format: "json" }));
    expect(added.json).toMatchObject({
      status: "ok",
      project: "bare-svc",
      repository: repo,
      model: path.join(repo, "documentation-robotics", "model"),
      model_adopted: false,
    });
    expect(added.json.warning).toContain("dr init");
    expect(await Bun.file(path.join(repo, "documentation-robotics", "model", "manifest.yaml")).exists()).toBe(false);
    expect(await Bun.file(path.join(tmp, "xdg", "dr", "bare-svc-model")).exists()).toBe(false);
  });

  it("refuses a derived name another repository holds, naming the explicit-name call", async () => {
    const first = await createRepo(path.join(tmp, "a", "svc"), true);
    const second = await createRepo(path.join(tmp, "b", "svc"), true);
    process.chdir(tmp);
    expect((await capture(() => farmAddCommand(undefined, { codebase: first, format: "json" }))).json.project).toBe("svc");

    const refused = await capture(() => farmAddCommand(undefined, { codebase: second, format: "json" }));
    expect(refused.exitCode).toBe(1);
    expect(refused.json.message).toContain(`dr farm add <name> --codebase ${second}`);

    const named = await capture(() => farmAddCommand("svc-b", { codebase: second, format: "json" }));
    expect(named.json).toMatchObject({ status: "ok", project: "svc-b", created: true });
  });
});

describe("dr farm migrate", () => {
  async function v1Farm(): Promise<string> {
    const farm = path.join(tmp, "farm");
    await mkdir(farm);
    git(farm, "init", "-q", "-b", "main");
    await createRepo(path.join(farm, "service"));
    git(path.join(farm, "service"), "worktree", "add", "-q", "-b", "feature", path.join(farm, "service-feature"));
    await createRepo(path.join(farm, "web"));
    await writeFile(
      path.join(farm, "farm.yaml"),
      [
        "schema: dr-farm-v1",
        "name: Old",
        "projects:",
        "  service:",
        "    name: service",
        "    source: service",
        "    model: service-model",
        "    branch: main",
        "  service-feature:",
        "    name: service-feature",
        "    source: service-feature",
        "    model: service-model",
        "  web:",
        "    name: web",
        "    source: web",
        "    model: web-model",
        "",
      ].join("\n")
    );
    git(farm, "add", "farm.yaml");
    git(farm, "commit", "-q", "-m", "v1");
    return farm;
  }

  it("reads a v1 farm with a notice, and refuses to write it until migrated", async () => {
    const farm = await v1Farm();
    process.chdir(farm);
    const status = await capture(() => farmStatusCommand({ format: "json" }));
    expect(status.errors.join("\n")).toContain("dr farm migrate");
    expect(status.json.projects.map((p: { name: string }) => p.name)).toEqual(["service", "service-feature", "web"]);

    const removed = await capture(() => farmRemoveCommand("web", { format: "json" }));
    expect(removed.exitCode).toBe(1);
    expect(removed.json.message).toContain("dr farm migrate");
    expect(await readFile(path.join(farm, "farm.yaml"), "utf-8")).toContain("dr-farm-v1");
  });

  it("previews by default, writes and commits with --apply, and changes nothing the second time", async () => {
    const farm = await v1Farm();
    process.chdir(farm);

    const preview = await capture(() => farmMigrateCommand({ format: "json" }));
    expect(preview.exitCode).toBeUndefined();
    expect(preview.json).toMatchObject({ status: "ok", from: "dr-farm-v1", to: "dr-farm-v2", applied: false });
    expect(preview.json.projects.map((p: { name: string }) => p.name)).toEqual(["service", "web"]);
    expect(preview.json.projects[0].checkouts).toEqual([
      { entry: "service", source: "service", checkout: "main" },
      { entry: "service-feature", source: "service-feature", checkout: "service-feature" },
    ]);
    expect(preview.json.dropped).toEqual([
      { name: "service-feature", project: "service", source: "service-feature", checkout: "service-feature" },
    ]);
    expect(await readFile(path.join(farm, "farm.yaml"), "utf-8")).toContain("dr-farm-v1");

    const text = await capture(() => farmMigrateCommand({}));
    expect(text.logs.join("\n")).toContain("service-feature → project service, checkout service-feature");
    expect(text.logs.join("\n")).toContain("dr farm migrate --apply");

    const applied = await capture(() => farmMigrateCommand({ apply: true, format: "json" }));
    expect(applied.json).toMatchObject({ applied: true, git_committed: true });
    const written = await readFile(path.join(farm, "farm.yaml"), "utf-8");
    expect(written).toContain("schema: dr-farm-v2");
    expect(written).not.toContain("service-feature");
    expect(written).not.toContain("branch:");

    const second = await capture(() => farmMigrateCommand({ apply: true, format: "json" }));
    expect(second.json).toMatchObject({ up_to_date: true, applied: false });
    expect(await readFile(path.join(farm, "farm.yaml"), "utf-8")).toBe(written);
  });
});
