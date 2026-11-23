/**
 * A folder farm with one git project holding a DR model, for the tools that resolve the call's
 * checkout through the project registry (review_open, project_status, project_list), and fakes of
 * the central process they link into.
 */

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Model } from "../../../src/core/model.js";
import { FarmManifest } from "../../../src/core/farm-manifest.js";
import { ProjectRegistry } from "../../../src/core/project-registry.js";
import type { ServerRecord } from "../../../src/core/checkout-types.js";
import type { EnsureCentralServer, EnsuredCentralServer, EnsureCentralServerOptions } from "../../../src/server/central-mcp-contract.js";
import type { RunningServer } from "../../../src/server/server-record.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, env: GIT_ENV, stdio: "pipe", encoding: "utf-8" });
}

export interface CentralFarm {
  scratch: string;
  farmRoot: string;
  /** The project's main checkout, holding the model (not yet in the farm). */
  project: string;
  /** The registry over this farm only, whatever the environment says. */
  openRegistry: (cwd: string) => Promise<ProjectRegistry>;
  /** Adds the project to the farm (as an MCP root would). */
  register: () => Promise<void>;
  /** A linked worktree of the project on a new branch, inside the farm folder (so the folder farm is found from it); returns its real path. */
  addWorktree: (name: string) => Promise<string>;
  cleanup: () => Promise<void>;
}

/** `<tmp>/farm/farm.yaml` (a folder farm) and `<tmp>/farm/project`, a git repository with a model. */
export async function centralFarm(modelName = "Central Farm Model"): Promise<CentralFarm> {
  const scratch = await realpath(await mkdtemp(path.join(tmpdir(), "dr-central-farm-")));
  const farmRoot = path.join(scratch, "farm");
  await mkdir(farmRoot, { recursive: true });
  await FarmManifest.create("test").save(path.join(farmRoot, "farm.yaml"));
  const project = path.join(farmRoot, "project");
  await mkdir(project, { recursive: true });
  git(project, "init", "-q", "-b", "main");
  await Model.init(project, { name: modelName, version: "0.1.0" });
  git(project, "add", "-A");
  git(project, "commit", "-q", "-m", "init");

  const openRegistry = (cwd: string) => ProjectRegistry.open({ cwd, env: {} });
  return {
    scratch,
    farmRoot,
    project,
    openRegistry,
    register: async () => {
      await (await openRegistry(project)).resolveOrRegister(project);
    },
    addWorktree: async (name) => {
      const dir = path.join(farmRoot, ".worktrees", name);
      await mkdir(path.dirname(dir), { recursive: true });
      git(project, "worktree", "add", "-q", "-b", `branch-${name}`, dir);
      return realpath(dir);
    },
    cleanup: () => rm(scratch, { recursive: true, force: true }),
  };
}

/** A server record as the central process writes it. */
export function serverRecord(farmRoot: string, overrides: Partial<ServerRecord> = {}): ServerRecord {
  return {
    farmRoot,
    pid: 424242,
    port: 4567,
    cliVersion: "999.0.0",
    startedAt: "2026-11-23T00:00:00.000Z",
    tokenPath: path.join(farmRoot, "server.token"),
    ...overrides,
  };
}

/** A fake `EnsureCentralServer` that records its calls and answers with `answer`. */
export function fakeEnsure(answer: EnsuredCentralServer): EnsureCentralServer & { calls: EnsureCentralServerOptions[] } {
  const calls: EnsureCentralServerOptions[] = [];
  const ensure = (async (options: EnsureCentralServerOptions = {}) => {
    calls.push(options);
    return answer;
  }) as EnsureCentralServer & { calls: EnsureCentralServerOptions[] };
  ensure.calls = calls;
  return ensure;
}

/** A `findRunningServer` that always finds `running` (or nothing). */
export function fakeFind(running: RunningServer | null): (farmRoot: string) => Promise<RunningServer | null> {
  return async () => running;
}
