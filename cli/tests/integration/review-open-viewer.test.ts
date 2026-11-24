/**
 * review_open and project_status against a real central process (issue 1279, design section 9):
 * the built CLI's `dr serve` serves a farm with one project and a linked worktree. review_open,
 * with its default dependencies, returns a deep link to the changeset on that process, and the
 * link's checkout route serves that checkout's changeset with the token from the link's fragment.
 * project_status gives the checkout's link and never starts a process. Nothing is spawned by the
 * tools.
 *
 * Needs the built CLI (dist/cli.js and dist/serve-entry.js); skipped without them.
 * REQUIRES SERIAL EXECUTION: starts a real server on a live port.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { portAllocator } from "../helpers.ts";
import { Model } from "../../src/core/model.js";
import { clearModelCache } from "../../src/mcp/tools/shared.js";
import { changesetCreateHandler } from "../../src/mcp/tools/changeset-lifecycle.js";
import { createReviewOpenHandler } from "../../src/mcp/tools/review-open.js";
import { projectStatus } from "../../src/mcp/tools/project-status.js";
import { readServerRecord } from "../../src/server/server-record.js";
import { isProcessAlive } from "../../src/utils/process-liveness.js";

const CLI_PATH = join(import.meta.dir, "../../dist/cli.js");
const ready = existsSync(CLI_PATH) && existsSync(join(import.meta.dir, "../../dist/serve-entry.js"));

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, env: GIT_ENV, stdio: "pipe", encoding: "utf8" });

function parse(result: any): any {
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}

/** The token and route a link carries in its fragment. */
function fragment(url: string): { route: string; token: string | null } {
  const hash = new URL(url).hash.slice(1);
  const [route, query = ""] = hash.split("?");
  return { route, token: new URLSearchParams(query).get("token") };
}

describe.skipIf(!ready).serial("review_open and project_status on a real central process", () => {
  let scratch: string;
  let farmRoot: string;
  let project: string;
  let worktree: string;
  let port: number;
  let env: NodeJS.ProcessEnv;
  let serverPid: number | null = null;
  const saved: Record<string, string | undefined> = {};
  const ENV_KEYS = ["DR_STATE_DIR", "DR_FARM_PATH", "DR_VIEWER_PROCESS_SCAN"] as const;

  const dr = (args: string[]) => spawnSync("node", [CLI_PATH, "serve", ...args], { cwd: farmRoot, env, encoding: "utf8", timeout: 90_000 });

  beforeAll(async () => {
    scratch = await realpath(await mkdtemp(join(tmpdir(), "dr-review-open-central-")));
    farmRoot = join(scratch, "farm");
    project = join(farmRoot, "project");
    await mkdir(project, { recursive: true });
    await writeFile(
      join(farmRoot, "farm.yaml"),
      `schema: dr-farm-v2\nname: review-open-test\ncreated: "2026-11-23T00:00:00.000Z"\nmodified: "2026-11-23T00:00:00.000Z"\nprojects: {}\n`
    );
    git(project, "init", "-q", "-b", "main");
    await Model.init(project, { name: "Review Open Central", version: "0.1.0" });
    git(project, "add", "-A");
    git(project, "commit", "-q", "-m", "init");
    worktree = join(farmRoot, ".worktrees", "feature-x");
    git(project, "worktree", "add", "-q", "-b", "feature-x", worktree);
    worktree = await realpath(worktree);

    port = await portAllocator.allocatePort();
    env = { ...process.env, DR_STATE_DIR: join(scratch, "state"), DR_FARM_PATH: farmRoot, DR_VIEWER_PROCESS_SCAN: "off" };
    // The tools run in this process with their default dependencies: same farm, same state dir.
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      process.env[key] = env[key];
    }
    clearModelCache();
  }, 60_000);

  afterAll(async () => {
    if (serverPid !== null && isProcessAlive(serverPid)) {
      dr(["--stop"]);
      if (isProcessAlive(serverPid)) process.kill(serverPid, "SIGKILL");
    }
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    clearModelCache();
    portAllocator.releasePort(port);
    await rm(scratch, { recursive: true, force: true });
  });

  it("project_status says no central process runs and starts none", async () => {
    const s: any = await projectStatus({ rootPath: project });
    expect(s.checkout.status).toBe("unregistered");
    expect(s.viewer.status).toBe("none");
    expect(await readServerRecord(farmRoot, env)).toBeNull();
  });

  it("links to the changeset of each checkout on the running process, and the link opens it", async () => {
    const onMain = parse(await changesetCreateHandler({ name: "plan-on-main", rootPath: project }));
    const onWorktree = parse(await changesetCreateHandler({ name: "plan-on-worktree", rootPath: worktree }));

    const start = dr(["--port", String(port)]);
    expect(start.status, start.stderr + start.stdout).toBe(0);
    const record = await readServerRecord(farmRoot, env);
    expect(record).not.toBeNull();
    serverPid = record!.pid;

    // Default dependencies: the registry of the farm in use and the running process's record.
    const reviewOpen = createReviewOpenHandler();
    const main = parse(await reviewOpen({ rootPath: project }));
    expect(main).toMatchObject({ project: "project", checkout: "main", changesetId: onMain.id, port, started: false });
    const wt = parse(await reviewOpen({ rootPath: worktree }));
    expect(wt).toMatchObject({ project: "project", checkout: "feature-x", changesetId: onWorktree.id, port });

    for (const [opened, checkout, id, other] of [
      [main, "main", onMain.id, onWorktree.id],
      [wt, "feature-x", onWorktree.id, onMain.id],
    ] as const) {
      const url = new URL(opened.url);
      expect(url.origin).toBe(`http://127.0.0.1:${port}`);
      expect(url.search).toBe("");
      const { route, token } = fragment(opened.url);
      expect(route).toBe(`/p/project/c/${checkout}/changesets/${id}`);
      expect(token).toBeTruthy();

      // The token from the fragment opens the checkout's changesets on the process, and only this checkout's.
      const response = await fetch(`http://127.0.0.1:${port}/api/projects/project/checkouts/${checkout}/changesets`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      const body = JSON.stringify(await response.json());
      expect(body).toContain(id);
      expect(body).not.toContain(other);
    }

    const s: any = await projectStatus({ rootPath: worktree });
    expect(s.project).toMatchObject({ name: "project", checkout: "feature-x" });
    expect(s.checkout.otherCheckouts.map((c: any) => c.key)).toEqual(["main"]);
    expect(s.checkout.otherCheckouts[0]).toMatchObject({ activeChangeset: onMain.id, stagedChangesets: 1 });
    expect(s.viewer).toMatchObject({ status: "running", port, pid: record!.pid, checkout: "feature-x", outdated: false });
    expect(fragment(s.viewer.url)).toEqual({ route: "/p/project/c/feature-x/", token: fragment(wt.url).token });
  }, 120_000);
});
