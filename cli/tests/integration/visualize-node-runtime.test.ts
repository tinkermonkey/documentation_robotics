/**
 * End-to-end regression test for #800: `dr visualize` must work on a machine with
 * only Node.js installed, no Bun. Since issue 1279 (slice 4A) it starts the farm's central DR
 * process detached (`dr serve`), which is what this checks runs under node.
 *
 * PR #803 removed every Bun-specific runtime API (Bun.serve, hono/bun, Bun.spawn/
 * Bun.spawnSync, Bun.watch) from the visualization server, and changed the CLI to
 * spawn the server subprocess via `process.execPath` (whichever runtime is already
 * running the CLI) instead of a literal "bun" binary. Every other visualization-server
 * integration test in this repo spawns `dr visualize` via `bun ...` (see
 * visualization-server-api.test.ts, visualization-server-auth-flow.test.ts), so none
 * of them actually exercise the Node-only code path this fix exists for - the outer
 * CLI process is always Bun, and so is `process.execPath` inside it.
 *
 * This test spawns the CLI via a literal `node` binary AND strips any directory
 * containing a `bun` executable from the child's PATH, so there is no way for `bun`
 * to be reached anywhere in the process tree (CLI -> central process -> ...). It runs on a
 * scratch farm and state directory (tests/helpers/visualize-farm.ts).
 *
 * REQUIRES SERIAL EXECUTION: starts a real server subprocess on a live port.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync } from "fs";
import { delimiter, join } from "path";
import { portAllocator } from "../helpers.ts";
import { CLI_PATH, makeVisualizeFarm, type VisualizeFarm } from "../helpers/visualize-farm.ts";

const STARTUP_TIMEOUT = 30000; // ms – generous for CI

/**
 * Build a PATH string with every directory that contains a `bun` executable removed,
 * so a child process spawned with this PATH cannot resolve `bun` no matter where it's
 * installed (asdf/nvm-style user installs, Homebrew, a global CI package, etc.).
 */
function pathWithoutBun(): string {
  const bunExecutableName = process.platform === "win32" ? "bun.exe" : "bun";
  const dirs = (process.env.PATH || "").split(delimiter);
  return dirs.filter((dir) => !dir || !existsSync(join(dir, bunExecutableName))).join(delimiter);
}

describe.skipIf(!existsSync(CLI_PATH)).serial("dr visualize under a literal pure-Node runtime with Bun entirely unreachable", () => {
  let farm: VisualizeFarm;
  let port: number;
  let token: string;

  beforeAll(async () => {
    farm = await makeVisualizeFarm(["alpha"]);
    port = await portAllocator.allocatePort();

    const noBunPath = pathWithoutBun();
    // Sanity-check the filter actually removed something in dev environments where
    // bun is normally present, so this test can't silently pass by accident on a
    // machine where `bun` was never on PATH to begin with. On a genuinely bun-less
    // CI runner this is a no-op, which is fine - the test's real assertion is that
    // the server works at all, regardless of whether bun was ever present.
    if (process.env.PATH?.split(delimiter).some((d) => existsSync(join(d, "bun")))) {
      expect(noBunPath).not.toBe(process.env.PATH);
    }

    // Run the CLI itself via a literal "node" binary with Bun stripped from PATH, so the central
    // process it starts detached (`dr serve`'s serve-entry, run with process.execPath) can only
    // ever be node.
    const run = farm.dr(
      ["visualize", "--no-browser", "--json", "--port", String(port)],
      farm.projects.alpha,
      "node",
      { ...farm.env, PATH: noBunPath }
    );
    if (run.status !== 0) throw new Error(`dr visualize failed:\n${run.stdout}\n${run.stderr}`);
    const started = JSON.parse(run.stdout) as { port: number; url: string };
    expect(started.port).toBe(port);
    token = new URLSearchParams(started.url.split("?")[1]).get("token") ?? "";
  }, STARTUP_TIMEOUT + 5000);

  afterAll(async () => {
    await farm?.cleanup();
    portAllocator.releasePort(port);
  });

  it("serves /health over HTTP with Bun completely unreachable", async () => {
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("ok");
  });

  it("serves the viewer at / with Bun completely unreachable", async () => {
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<!DOCTYPE html>");
  });

  it("supports a WebSocket round-trip (ping/pong) with Bun completely unreachable", async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws?token=${encodeURIComponent(token)}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("WebSocket ping/pong round-trip timed out"));
      }, 10000);

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data as string);
        if (message.type === "connected") {
          ws.send(JSON.stringify({ type: "ping" }));
        } else if (message.type === "pong") {
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      };
      ws.onerror = (err) => {
        clearTimeout(timer);
        reject(err);
      };
    });
  }, 15000);
});
