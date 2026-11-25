/**
 * `dr serve` (issue 1279, slice 2B) against a fake process: a second start refused, --status and
 * --stop, and the detached start waiting for the process's record.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerRecord } from "../../../src/core/checkout-types.js";
import type { FarmLocation } from "../../../src/core/project-registry.js";
import {
  entryRunOptionsFromEnv,
  readTokenFile,
  serveCommand,
  serveEntryEnv,
  startOptionsFromEnv,
  type ServeDeps,
  type SpawnEntryOptions,
} from "../../../src/commands/serve.js";
import { writeFileSync } from "node:fs";
import type { RunningServer } from "../../../src/server/server-record.js";
import { CLIError } from "../../../src/utils/errors.js";

const stateDir = mkdtempSync(join(tmpdir(), "dr-serve-command-"));
afterAll(() => rmSync(stateDir, { recursive: true, force: true }));

const farm: FarmLocation = { root: "/farms/a", file: "/farms/a/farm.yaml", source: "folder" };

function record(overrides: Partial<ServerRecord> = {}): ServerRecord {
  return {
    farmRoot: farm.root,
    pid: 5000,
    port: 8080,
    cliVersion: "9.9.9",
    startedAt: "2026-11-23T10:00:00.000Z",
    tokenPath: "/state/servers/abc.token",
    ...overrides,
  };
}

/** The environment spawnServeEntry gives serve-entry, without spawning anything. */
function spawnEnv(options: SpawnEntryOptions): NodeJS.ProcessEnv {
  return serveEntryEnv(options);
}

/** A fake world: one optional running process, signals that end it, a clock that sleep moves. */
function world(initial: RunningServer | null) {
  let running = initial;
  let clock = 0;
  const alive = new Set<number>(initial ? [initial.record.pid] : []);
  const out: string[] = [];
  const signals: Array<[number, string]> = [];
  const removed: number[] = [];
  const spawned: SpawnEntryOptions[] = [];
  const deps: Partial<ServeDeps> = {
    env: { DR_STATE_DIR: stateDir },
    cwd: "/farms/a/project",
    resolveFarm: async () => farm,
    findRunningServer: async () => running,
    removeServerRecord: async (_root, options) => {
      removed.push(options.pid);
      if (running?.record.pid === options.pid) running = null;
      return true;
    },
    fetchHealth: async (r) => (alive.has(r.pid) ? { status: "ok", cliVersion: "9.9.9", pid: r.pid, clients: 2, loadedCheckouts: 1 } : null),
    commandLine: () => null,
    isAlive: (pid) => alive.has(pid),
    kill: (pid, signal) => {
      signals.push([pid, signal]);
      alive.delete(pid);
    },
    linkFor: async (r) => `http://127.0.0.1:${r.port}/`,
    sleep: async (ms) => void (clock += ms),
    now: () => clock,
    stopTimeoutMs: 1000,
    startTimeoutMs: 1000,
    pollMs: 100,
    out: (line) => out.push(line),
  };
  return {
    deps,
    out,
    signals,
    removed,
    spawned,
    alive,
    setRunning: (value: RunningServer | null) => (running = value),
  };
}

describe("dr serve --status", () => {
  it("says not running when no process serves the farm", async () => {
    const w = world(null);
    await serveCommand({ status: true, json: false }, w.deps);
    expect(w.out).toEqual(["No DR process is running for /farms/a."]);
  });

  it("shows the record and the health of the running process", async () => {
    const w = world({ record: record({ launcherPid: 4999 }), token: "t" });
    await serveCommand({ status: true, json: false }, w.deps);
    expect(w.out.join("\n")).toContain("pid 5000, port 8080, CLI 9.9.9");
    expect(w.out.join("\n")).toContain("started by pid 4999");
    expect(w.out.join("\n")).toContain("health: status ok, 2 tabs, 1 checkout loaded");
  });

  it("says when the process doesn't answer", async () => {
    const w = world({ record: record(), token: "t" });
    w.deps.fetchHealth = async () => null;
    await serveCommand({ status: true, json: false }, w.deps);
    expect(w.out.join("\n")).toContain("health: not answering on http://127.0.0.1:8080/health");
  });

  it("prints JSON without the token path", async () => {
    const w = world({ record: record(), token: "t" });
    await serveCommand({ status: true, json: true }, w.deps);
    const parsed = JSON.parse(w.out.join("\n"));
    expect(parsed.running).toBe(true);
    expect(parsed.answering).toBe(true);
    expect(parsed.record.pid).toBe(5000);
    expect(parsed.record.tokenPath).toBeUndefined();
  });
});

describe("dr serve --stop", () => {
  it("says not running when there is nothing to stop", async () => {
    const w = world(null);
    await serveCommand({ stop: true, json: false }, w.deps);
    expect(w.signals).toEqual([]);
    expect(w.out[0]).toContain("No DR process is running");
  });

  it("sends SIGTERM, waits for the process to go and removes its record", async () => {
    const w = world({ record: record(), token: "t" });
    await serveCommand({ stop: true, json: false }, w.deps);
    expect(w.signals).toEqual([[5000, "SIGTERM"]]);
    expect(w.removed).toEqual([5000]);
    expect(w.out[0]).toBe("Stopped the DR process for /farms/a (pid 5000).");
  });

  it("kills a process that outlasts the stop timeout", async () => {
    const w = world({ record: record(), token: "t" });
    w.deps.kill = (pid, signal) => {
      w.signals.push([pid, signal]);
      if (signal === "SIGKILL") w.alive.delete(pid);
    };
    await serveCommand({ stop: true, json: false }, w.deps);
    expect(w.signals).toEqual([
      [5000, "SIGTERM"],
      [5000, "SIGKILL"],
    ]);
    expect(w.out[0]).toContain("killed after SIGTERM timed out");
  });

  it("signals nothing when the pid can't be confirmed to be the DR process", async () => {
    const w = world({ record: record(), token: "t" });
    w.deps.fetchHealth = async () => null;
    w.deps.commandLine = () => "/usr/bin/vim notes.txt";
    await expect(serveCommand({ stop: true, json: false }, w.deps)).rejects.toThrow("could not be confirmed");
    expect(w.signals).toEqual([]);
  });

  it("confirms by command line when /health doesn't answer", async () => {
    const w = world({ record: record(), token: "t" });
    w.deps.fetchHealth = async () => null;
    w.deps.commandLine = () => "/usr/local/bin/node /opt/dr/dist/serve-entry.js";
    await serveCommand({ stop: true, json: false }, w.deps);
    expect(w.signals).toEqual([[5000, "SIGTERM"]]);
  });

  it("refuses when /health names another pid", async () => {
    const w = world({ record: record(), token: "t" });
    w.deps.fetchHealth = async () => ({ status: "ok", cliVersion: "9.9.9", pid: 6000 });
    await expect(serveCommand({ stop: true, json: false }, w.deps)).rejects.toThrow("could not be confirmed");
    expect(w.signals).toEqual([]);
  });
});

describe("dr serve (start)", () => {
  it("refuses a second process and points to the running one", async () => {
    const w = world({ record: record(), token: "t" });
    w.deps.spawnEntry = (options) => {
      w.spawned.push(options);
      return { pid: 1, exited: new Promise(() => {}) };
    };
    const attempt = serveCommand({ json: false }, w.deps);
    await expect(attempt).rejects.toBeInstanceOf(CLIError);
    await expect(serveCommand({ json: false }, w.deps)).rejects.toThrow("already serves /farms/a: pid 5000, http://127.0.0.1:8080/");
    expect(w.spawned).toEqual([]);
  });

  it("starts the entry detached, waits for its record and prints its link and pid", async () => {
    const w = world(null);
    w.deps.spawnEntry = (options) => {
      w.spawned.push(options);
      // The entry records itself a moment later.
      setTimeout(() => w.setRunning({ record: record({ pid: 7000, port: 8081 }), token: "t" }), 0);
      return { pid: 7000, exited: new Promise(() => {}) };
    };
    w.deps.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5)));
    w.deps.now = Date.now;
    await serveCommand({ port: "8081", json: false }, w.deps);
    expect(w.spawned.length).toBe(1);
    expect(w.spawned[0]).toMatchObject({ foreground: false, port: 8081, farm });
    expect(w.spawned[0].logPath).toMatch(/servers\/[0-9a-f]{24}\.log$/);
    expect(w.out.join("\n")).toContain("http://127.0.0.1:8081/");
    expect(w.out.join("\n")).toContain("pid 7000, port 8081");
  });

  it("reports the exit code when the entry ends before recording itself", async () => {
    const w = world(null);
    w.deps.spawnEntry = () => ({ pid: 7000, exited: Promise.resolve(1) });
    await expect(serveCommand({ json: false }, w.deps)).rejects.toThrow("it exited with code 1");
  });

  it("runs the entry attached with --foreground and waits for it", async () => {
    const w = world(null);
    w.deps.spawnEntry = (options) => {
      w.spawned.push(options);
      return { pid: 7000, exited: Promise.resolve(0) };
    };
    await serveCommand({ foreground: true, json: false }, w.deps);
    expect(w.spawned[0]).toMatchObject({ foreground: true });
  });

  it("rejects a bad port, and --port with --status or --stop", async () => {
    const w = world(null);
    await expect(serveCommand({ port: "0" }, w.deps)).rejects.toThrow("Invalid port number");
    await expect(serveCommand({ port: "80x" }, w.deps)).rejects.toThrow("Invalid port number");
    await expect(serveCommand({ status: true, port: "9000" }, w.deps)).rejects.toThrow("--port is used only");
    await expect(serveCommand({ status: true, stop: true }, w.deps)).rejects.toThrow("don't go together");
  });
});

describe("dr serve start options (slice 4A)", () => {
  it("passes --viewer-path, --with-danger and --read-only to the entry it starts", async () => {
    const w = world(null);
    w.deps.spawnEntry = (options) => {
      w.spawned.push(options);
      return { pid: 7000, exited: Promise.resolve(0) };
    };
    await serveCommand({ foreground: true, viewerPath: "/viewers/custom", readOnly: true, json: false }, w.deps);
    expect(w.spawned[0]).toMatchObject({ viewerPath: "/viewers/custom", readOnly: true, foreground: true });
  });

  it("refuses them with --status or --stop", async () => {
    const w = world(null);
    await expect(serveCommand({ stop: true, viewerPath: "/v", withDanger: true }, w.deps)).rejects.toThrow(
      "--viewer-path, --with-danger are used only when dr serve starts the process."
    );
  });

  it("hands them to serve-entry in its environment, and nothing inherited from the caller's", () => {
    const env = spawnEnv({
      farm,
      foreground: false,
      cwd: "/farms/a/project",
      env: { DR_SERVE_READ_ONLY: "1", DR_SERVE_VIEWER_PATH: "/stale" },
      viewerPath: "viewer",
      withDanger: true,
      port: 9001,
    });
    expect(startOptionsFromEnv(env)).toEqual({ port: 9001, viewerPath: "/farms/a/project/viewer", withDanger: true });
    expect(startOptionsFromEnv({})).toEqual({});
  });
});

describe("an isolated process for a test suite (#1376, #1369)", () => {
  const tokenFile = join(stateDir, "suite.token");
  writeFileSync(tokenFile, "suite-token-0123456789\n");

  it("keeps --state-dir's record apart, sweeps nothing, takes the exact port and the suite's token", async () => {
    const w = world(null);
    const lookedIn: Array<string | undefined> = [];
    w.deps.findRunningServer = async (_root, options) => {
      lookedIn.push(options.env.DR_STATE_DIR);
      return null;
    };
    w.deps.spawnEntry = (options) => {
      w.spawned.push(options);
      return { pid: 7000, exited: Promise.resolve(0) };
    };
    await serveCommand(
      { foreground: true, stateDir: "e2e/state", port: "8099", tokenFile, json: true },
      { ...w.deps, cwd: "/suite" }
    );
    expect(lookedIn).toEqual(["/suite/e2e/state"]);
    expect(w.spawned[0]).toMatchObject({
      foreground: true,
      port: 8099,
      exactPort: true,
      sweep: false,
      tokenFile,
      readyJson: true,
    });
    expect(w.spawned[0].env.DR_STATE_DIR).toBe("/suite/e2e/state");
  });

  it("finds --status and --stop's process in the same state directory", async () => {
    const w = world(null);
    const lookedIn: Array<string | undefined> = [];
    w.deps.findRunningServer = async (_root, options) => {
      lookedIn.push(options.env.DR_STATE_DIR);
      return null;
    };
    await serveCommand({ status: true, stateDir: "/suite/state", json: true }, w.deps);
    await serveCommand({ stop: true, stateDir: "/suite/state", json: true }, w.deps);
    expect(lookedIn).toEqual(["/suite/state", "/suite/state"]);
  });

  it("skips the sweep with --no-sweep, and searches ports without --state-dir", async () => {
    const w = world(null);
    w.deps.spawnEntry = (options) => {
      w.spawned.push(options);
      return { pid: 7000, exited: Promise.resolve(0) };
    };
    await serveCommand({ foreground: true, port: "9000", sweep: false, json: false }, w.deps);
    expect(w.spawned[0]).toMatchObject({ port: 9000, sweep: false });
    expect(w.spawned[0].exactPort).toBeUndefined();
    expect(w.spawned[0].readyJson).toBe(false);
  });

  it("refuses a short or unreadable token file before starting anything, and the start-only flags with --stop", async () => {
    const w = world(null);
    const short = join(stateDir, "short.token");
    writeFileSync(short, "abc\n");
    await expect(serveCommand({ foreground: true, tokenFile: short }, w.deps)).rejects.toThrow("16 or more characters");
    await expect(serveCommand({ foreground: true, tokenFile: join(stateDir, "nope") }, w.deps)).rejects.toThrow(
      "Could not read the token file"
    );
    await expect(serveCommand({ stop: true, tokenFile, sweep: false }, w.deps)).rejects.toThrow(
      "--token-file, --no-sweep are used only when dr serve starts the process."
    );
    expect(w.spawned).toEqual([]);
    expect(readTokenFile(tokenFile)).toBe("suite-token-0123456789");
  });

  it("hands the run options to serve-entry in its environment, and nothing inherited", () => {
    const env = spawnEnv({
      farm,
      foreground: true,
      cwd: "/suite",
      env: { DR_SERVE_NO_SWEEP: "1", DR_SERVE_TOKEN_FILE: "/stale" },
      exactPort: true,
      tokenFile: "token",
      readyJson: true,
    });
    expect(entryRunOptionsFromEnv(env)).toEqual({ exactPort: true, tokenFile: "/suite/token", sweep: true, readyJson: true });
    expect(entryRunOptionsFromEnv({})).toEqual({ exactPort: false, sweep: true, readyJson: false });
  });
});
