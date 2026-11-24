/**
 * A scratch farm for tests that run `dr visualize` as a process (issue 1279, slice 4A).
 *
 * Each farm has its own farm file, state directory and config directory, so a test never touches
 * the user's real farm, server records or settings, and the process scan is off, so `--list` and
 * `--stop` never see the user's own viewers. `dr visualize` starts the farm's central process
 * detached; `stop()` stops it with `dr visualize --stop` and then kills whatever is left.
 */

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProcessAlive } from "../../src/utils/process-liveness.js";

export const CLI_PATH = join(import.meta.dir, "../../dist/cli.js");

/** What `dr visualize --json` prints. */
export interface VisualizeResult {
  url: string;
  project: string;
  checkout: string;
  pid: number;
  port: number;
  started: boolean;
  notApplied?: string[];
  notice?: string;
}

export interface VisualizeFarm {
  scratch: string;
  farmRoot: string;
  /** The environment every command runs with. */
  env: NodeJS.ProcessEnv;
  /** Project folders by name (git repositories with a DR model). */
  projects: Record<string, string>;
  /** Runs the built CLI with `runtime` (default node) in `cwd`. */
  dr(args: string[], cwd: string, runtime?: string, env?: NodeJS.ProcessEnv): { status: number | null; stdout: string; stderr: string };
  /** `dr visualize --no-browser --json [args]` in `cwd`; throws with its output when it fails. */
  visualize(cwd: string, args?: string[]): VisualizeResult;
  /** The token in a link's fragment. */
  tokenOf(result: VisualizeResult): string;
  /** Stops the central process (and anything else this farm started), then removes the scratch folder. */
  cleanup(): Promise<void>;
}

/** Makes a farm with one git repository and DR model per name. */
export async function makeVisualizeFarm(names: string[] = ["alpha"]): Promise<VisualizeFarm> {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "dr-visualize-farm-")));
  const farmRoot = join(scratch, "farm");
  await mkdir(farmRoot, { recursive: true });
  await writeFile(
    join(farmRoot, "farm.yaml"),
    `schema: dr-farm-v2\nname: visualize-test\ncreated: "2026-11-24T00:00:00.000Z"\nmodified: "2026-11-24T00:00:00.000Z"\nprojects: {}\n`
  );
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("DR_SERVE_")) delete env[key];
  Object.assign(env, {
    DR_FARM_PATH: farmRoot,
    DR_STATE_DIR: join(scratch, "state"),
    XDG_CONFIG_HOME: join(scratch, "config"),
    DR_VIEWER_PROCESS_SCAN: "off",
  });

  const dr: VisualizeFarm["dr"] = (args, cwd, runtime = "node", extraEnv = env) => {
    const result = spawnSync(runtime, [CLI_PATH, ...args], { cwd, env: extraEnv, encoding: "utf8", timeout: 60_000 });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };

  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", ...args], { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  };

  const projects: Record<string, string> = {};
  for (const name of names) {
    const dir = join(scratch, name);
    await mkdir(dir, { recursive: true });
    git(dir, "init", "-q");
    const init = dr(["init", "--name", name], dir);
    if (init.status !== 0) throw new Error(`dr init failed: ${init.stderr}`);
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "init");
    projects[name] = dir;
  }

  const started = new Set<number>();
  const visualize: VisualizeFarm["visualize"] = (cwd, args = []) => {
    const run = dr(["visualize", "--no-browser", "--json", ...args], cwd);
    if (run.status !== 0) throw new Error(`dr visualize failed (${run.status}):\n${run.stdout}\n${run.stderr}`);
    const parsed = JSON.parse(run.stdout) as VisualizeResult;
    started.add(parsed.pid);
    return parsed;
  };

  return {
    scratch,
    farmRoot,
    env,
    projects,
    dr,
    visualize,
    tokenOf: (result) => new URLSearchParams(result.url.split("?")[1]).get("token") ?? "",
    async cleanup() {
      dr(["visualize", "--stop"], farmRoot);
      for (const pid of started) {
        if (!isProcessAlive(pid)) continue;
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Gone between the check and the signal.
        }
      }
      await rm(scratch, { recursive: true, force: true });
    },
  };
}
