/**
 * `dr serve` as a consumer's E2E suite runs it (#1376), end to end with the built CLI and the real
 * server: a farm of its own (DR_FARM_PATH), its record in --state-dir, the exact --port, the token
 * the suite chose (--token-file) and a JSON ready line. Every API call still needs the token.
 * Against that process it also checks:
 * - the farm's projects listing, with a project whose repository is gone flagged (#1438), and the
 *   single-project route (#1436);
 * - a --viewer-path bundle rebuilt in place: index.html is revalidated by its ETag, so the new
 *   one is served without a restart; a hashed asset is cached for good (#1308).
 *
 * HOME and XDG_CONFIG_HOME are scratch folders too, so nothing reaches the developer's own farm
 * or viewers. REQUIRES SERIAL EXECUTION: starts a real process on a live port.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { portAllocator } from "../helpers/port-allocator.ts";
import { isProcessAlive } from "../../src/utils/process-liveness.js";

const CLI_PATH = join(import.meta.dir, "../../dist/cli.js");
const ready = existsSync(CLI_PATH) && existsSync(join(import.meta.dir, "../../dist/serve-entry.js"));
const TOKEN = "e2e-suite-token-0123456789abcdef";

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
}

async function repo(dir: string, staged: number): Promise<string> {
  await mkdir(join(dir, "documentation-robotics", "model"), { recursive: true });
  await writeFile(join(dir, "documentation-robotics", "model", "manifest.yaml"), "spec_version: 0.15.0\n");
  for (let i = 0; i < staged; i++) {
    const cs = join(dir, "documentation-robotics", "changesets", `plan-${i}`);
    await mkdir(cs, { recursive: true });
    await writeFile(join(cs, "metadata.yaml"), `id: plan-${i}\nname: plan-${i}\nstatus: staged\n`);
    await writeFile(join(cs, "changes.yaml"), "[]\n");
  }
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return realpath(dir);
}

describe.skipIf(!ready).serial("dr serve --state-dir: an isolated, authenticated process for a test suite", () => {
  let scratch: string;
  let stateDir: string;
  let bundle: string;
  let env: NodeJS.ProcessEnv;
  let port: number;
  let child: ChildProcess | undefined;
  let readyLine: Record<string, unknown>;
  let base: string;

  const dr = (args: string[]) =>
    spawnSync("node", [CLI_PATH, ...args], { cwd: scratch, env, encoding: "utf8", timeout: 60_000 });
  const get = (path: string, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(20_000) });
  const auth = { Authorization: `Bearer ${TOKEN}` };

  beforeAll(async () => {
    scratch = await realpath(await mkdtemp(join(tmpdir(), "dr-serve-isolated-")));
    stateDir = join(scratch, "state");
    const app = await repo(join(scratch, "app"), 2);
    const gone = join(scratch, "gone");
    await mkdir(join(scratch, "farm"));
    await writeFile(
      join(scratch, "farm", "farm.yaml"),
      "schema: dr-farm-v2\nname: e2e\ncreated: \"2026-11-25T00:00:00.000Z\"\nmodified: \"2026-11-25T00:00:00.000Z\"\n" +
        "projects:\n" +
        `  app:\n    name: app\n    repository: ${app}\n    model: ${join(app, "documentation-robotics", "model")}\n` +
        `  gone:\n    name: gone\n    repository: ${gone}\n    model: ${join(gone, "documentation-robotics", "model")}\n`
    );
    bundle = join(scratch, "bundle");
    await mkdir(join(bundle, "assets"), { recursive: true });
    await writeFile(join(bundle, "index.html"), "<html>build one</html>");
    await writeFile(join(bundle, "assets", "index-B3x9kQ2a.js"), "console.log(1)");
    await writeFile(join(scratch, "token"), `${TOKEN}\n`, { mode: 0o600 });

    port = await portAllocator.allocatePort();
    base = `http://127.0.0.1:${port}`;
    env = {
      ...process.env,
      HOME: join(scratch, "home"),
      XDG_CONFIG_HOME: join(scratch, "home", ".config"),
      DR_FARM_PATH: join(scratch, "farm"),
      DR_VIEWER_PROCESS_SCAN: "off",
    };
    delete env.DR_STATE_DIR;

    child = spawn(
      "node",
      [
        CLI_PATH,
        "serve",
        "--foreground",
        "--json",
        "--state-dir",
        stateDir,
        "--port",
        String(port),
        "--token-file",
        join(scratch, "token"),
        "--viewer-path",
        bundle,
      ],
      { cwd: scratch, env, stdio: ["ignore", "pipe", "pipe"] }
    );
    let output = "";
    readyLine = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ready line within 45s:\n${output}`)), 45_000);
      child!.stdout!.on("data", (chunk) => {
        output += chunk;
        for (const line of output.split("\n")) {
          if (!line.startsWith("{")) continue;
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            if (parsed.ready === true) {
              clearTimeout(timer);
              resolve(parsed);
            }
          } catch {
            // Not the whole line yet.
          }
        }
      });
      child!.stderr!.on("data", (chunk) => (output += chunk));
      child!.once("exit", (code) => reject(new Error(`exited with ${code} before it was ready:\n${output}`)));
    });
  }, 60_000);

  afterAll(async () => {
    if (child?.pid && isProcessAlive(child.pid)) child.kill("SIGKILL");
    portAllocator.releasePort(port);
    await rm(scratch, { recursive: true, force: true });
  });

  it("prints a ready line with its pid and the exact port, and records itself in its own state directory", () => {
    expect(readyLine).toMatchObject({ ready: true, port, url: `${base}/`, farmRoot: join(scratch, "farm") });
    expect(typeof readyLine.pid).toBe("number");
    expect(existsSync(join(stateDir, "servers"))).toBe(true);
    // Nothing went to the scratch HOME's state or config.
    expect(existsSync(join(scratch, "home", ".local", "state", "dr", "servers"))).toBe(false);
    expect(existsSync(join(scratch, "home", ".config", "dr", "farm.yaml"))).toBe(false);
  });

  it("answers /health without the token, and every API call only with the suite's token", async () => {
    expect((await get("/health")).status).toBe(200);
    expect((await get("/api/projects")).status).toBe(401);
    expect((await get("/api/projects", { Authorization: "Bearer wrong-token-0123456789" })).status).toBe(403);
    expect((await get("/api/projects", auth)).status).toBe(200);
  });

  it("lists the farm, flagging the project whose repository is gone, and scopes one project's checkouts", async () => {
    const { projects } = (await (await get("/api/projects", auth)).json()) as {
      projects: Array<{ name: string; missing?: boolean; remove?: string; checkouts: Array<{ stagedChangesets: number }> }>;
    };
    expect(projects.map((p) => p.name)).toEqual(["app", "gone"]);
    expect(projects[0].missing).toBeUndefined();
    expect(projects[0].checkouts[0].stagedChangesets).toBe(2);
    expect(projects[1]).toMatchObject({ missing: true, remove: "dr farm remove gone" });

    const checkouts = await get("/api/projects/app/checkouts", auth);
    expect(checkouts.status).toBe(200);
    expect(await checkouts.json()).toMatchObject({ project: "app", checkouts: [{ key: "main", stagedChangesets: 2 }] });
    expect((await get("/api/projects/nope/checkouts", auth)).status).toBe(404);
  });

  it("serves a rebuilt --viewer-path index.html without a restart, revalidating by ETag", async () => {
    const first = await get("/");
    expect(await first.text()).toBe("<html>build one</html>");
    expect(first.headers.get("cache-control")).toBe("no-cache");
    const etag = first.headers.get("etag")!;
    expect(etag).toBeTruthy();
    expect((await get("/", { "If-None-Match": etag })).status).toBe(304);

    await writeFile(join(bundle, "index.html"), "<html>build two, longer</html>");
    const later = new Date(Date.now() + 5_000);
    await utimes(join(bundle, "index.html"), later, later);
    const second = await get("/", { "If-None-Match": etag });
    expect(second.status).toBe(200);
    expect(await second.text()).toBe("<html>build two, longer</html>");
    expect(second.headers.get("etag")).not.toBe(etag);

    const asset = await get("/assets/index-B3x9kQ2a.js");
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("is found and stopped through the same --state-dir", async () => {
    const status = dr(["serve", "--status", "--json", "--state-dir", stateDir]);
    expect(status.status, status.stderr).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ running: true, answering: true, record: { port } });

    const stop = dr(["serve", "--stop", "--json", "--state-dir", stateDir]);
    expect(stop.status, stop.stderr).toBe(0);
    expect(JSON.parse(stop.stdout)).toMatchObject({ stopped: true, pid: readyLine.pid });
    expect(isProcessAlive(readyLine.pid as number)).toBe(false);
  });
});
