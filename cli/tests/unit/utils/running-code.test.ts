/**
 * Whether a process runs the dr CLI that is installed (#1427): runningCodeDrift, and the write guard
 * the central process turns on, which refuses a base-model write once the CLI changed under it.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Model } from "../../../src/core/model.js";
import {
  RESTART_DR_PROCESS,
  RESTART_IN_PROCESS,
  RunningCodeChangedError,
  assertRunningCodeInstalled,
  describeRunningCodeDrift,
  enableRunningCodeGuard,
  installedChangedSince,
  restartAdvice,
  runningCodeDrift,
  watchRunningCode,
  withRunningCodeChecked,
  type InstalledCli,
  type RunningCodeDrift,
} from "../../../src/utils/running-code.js";
import { getCliVersion } from "../../../src/utils/spec-version.js";

const STARTED = Date.parse("2026-11-25T10:00:00Z");

describe("runningCodeDrift", () => {
  it("is null when the installed CLI is the running one and was written before it started", async () => {
    const installed = { version: "0.9.0", spec: "0.15.0", modifiedAt: STARTED - 60_000 };
    expect(await runningCodeDrift({ installed, running: "0.9.0", startedAt: STARTED })).toBeNull();
    // Files written during start-up (within the margin) are its own start, not a new install.
    expect(await runningCodeDrift({ installed: { ...installed, modifiedAt: STARTED + 1000 }, running: "0.9.0", startedAt: STARTED })).toBeNull();
    // A package that can't be read is not drift.
    expect(await runningCodeDrift({ installed: null, running: "0.9.0", startedAt: STARTED })).toBeNull();
  });

  it("says another version is installed", async () => {
    const drift = await runningCodeDrift({ installed: { version: "0.9.0", spec: "0.15.0" }, running: "0.8.0", startedAt: STARTED });
    expect(drift).toMatchObject({ reason: "version", running: "0.8.0", installed: { version: "0.9.0" } });
    expect(describeRunningCodeDrift(drift!)).toContain("runs CLI 0.8.0, and CLI 0.9.0 is installed now");
  });

  it("says the same version was installed or built again after the process started", async () => {
    const modifiedAt = STARTED + 3_600_000;
    const drift = await runningCodeDrift({ installed: { version: "0.9.0", spec: null, modifiedAt }, running: "0.9.0", startedAt: STARTED });
    expect(drift).toEqual({
      reason: "rewritten",
      running: "0.9.0",
      installed: { version: "0.9.0", spec: null, modifiedAt },
      changedAt: new Date(modifiedAt).toISOString(),
    });
  });

  it("reads this checkout's own package by default: the test process is not stale", async () => {
    expect(await runningCodeDrift({ running: getCliVersion(), startedAt: Date.now() })).toBeNull();
  });
});

describe("installedChangedSince and watchRunningCode: only a change since the start counts", () => {
  const at = (version: string, modifiedAt?: number): InstalledCli => ({ version, spec: null, ...(modifiedAt ? { modifiedAt } : {}) });

  it("sees another version, or the same files written again, since the baseline", () => {
    expect(installedChangedSince(at("0.9.0", 100), at("0.9.0", 100), "0.9.0")).toBeNull();
    expect(installedChangedSince(at("0.9.0", 100), at("0.10.0", 100), "0.9.0")).toMatchObject({
      reason: "version",
      running: "0.9.0",
      installed: { version: "0.10.0" },
    });
    expect(installedChangedSince(at("0.9.0", 100), at("0.9.0", 200), "0.9.0")).toMatchObject({ reason: "rewritten" });
    // Older files (a reinstall of an older copy) or unreadable ones are not a change it acts on.
    expect(installedChangedSince(at("0.9.0", 200), at("0.9.0", 100), "0.9.0")).toBeNull();
    expect(installedChangedSince(null, at("0.10.0"), "0.9.0")).toBeNull();
    expect(installedChangedSince(at("0.9.0"), null, "0.9.0")).toBeNull();
  });

  it("reports drift already there at start (a bump without a rebuild) but never acts on it", async () => {
    let installed = at("0.9.1", STARTED - 60_000);
    const watch = await watchRunningCode({ running: "0.9.0", read: async () => installed });
    expect(watch.driftAtStart).toMatchObject({ reason: "version", running: "0.9.0", installed: { version: "0.9.1" } });
    expect(await watch.check()).toBeNull();
    // A later install is a change.
    installed = at("0.10.0", STARTED + 60_000);
    expect(await watch.check()).toMatchObject({ reason: "version", installed: { version: "0.10.0" } });
  });

  it("is clean at start for the installed code, and finds a rebuild after it", async () => {
    let installed = at("0.9.0", Date.now() - 60_000);
    const watch = await watchRunningCode({ running: "0.9.0", read: async () => installed });
    expect(watch.driftAtStart).toBeNull();
    installed = at("0.9.0", Date.now() + 60_000);
    expect(await watch.check()).toMatchObject({ reason: "rewritten" });
  });
});

describe("restartAdvice", () => {
  it("names dr serve --stop for the central process, and a reconnect for an in-process dr MCP server", () => {
    expect(restartAdvice({})).toBe(RESTART_DR_PROCESS);
    expect(restartAdvice({ DR_MCP_IN_PROCESS: "1" })).toBe(RESTART_IN_PROCESS);
    expect(RESTART_IN_PROCESS).toContain("dr serve --stop does not reach it");
  });
});

// The guard is process-wide: each of these runs alone (it.serial), and turns it off after itself.
describe("the write guard", () => {
  const drift: RunningCodeDrift = { reason: "version", running: "0.8.0", installed: { version: "0.9.0", spec: "0.15.0" } };
  const scratch: string[] = [];

  afterEach(async () => {
    enableRunningCodeGuard(false);
    await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it.serial("is off until a process turns it on, with the check it reads drift with", async () => {
    await expect(assertRunningCodeInstalled()).resolves.toBeUndefined();
    expect(() => enableRunningCodeGuard(true)).toThrow("needs the check");
  });

  it.serial("checks a commit once, at its start: refused then, or never during it", async () => {
    let next: RunningCodeDrift | null = null;
    enableRunningCodeGuard(true, async () => next);
    let ran = false;
    await withRunningCodeChecked(async () => {
      next = drift;
      // Past the recheck interval: outside the commit this would be refused.
      await assertRunningCodeInstalled(Date.now() + 10_000);
      ran = true;
    });
    expect(ran).toBe(true);
    await expect(assertRunningCodeInstalled(Date.now() + 20_000)).rejects.toBeInstanceOf(RunningCodeChangedError);

    let called = false;
    await expect(
      withRunningCodeChecked(async () => {
        called = true;
      })
    ).rejects.toBeInstanceOf(RunningCodeChangedError);
    expect(called).toBe(false);
  });

  it.serial("finishes a check with the guard it started with, even if it is turned off meanwhile", async () => {
    let release!: (value: RunningCodeDrift | null) => void;
    enableRunningCodeGuard(true, () => new Promise((resolve) => (release = resolve)));
    const pending = assertRunningCodeInstalled(1_000);
    enableRunningCodeGuard(false);
    release(drift);
    await expect(pending).rejects.toBeInstanceOf(RunningCodeChangedError);
    await expect(assertRunningCodeInstalled(2_000_000)).resolves.toBeUndefined();
  });

  it.serial("refuses with both versions and the restart once drift is found, and keeps refusing", async () => {
    let checks = 0;
    enableRunningCodeGuard(true, async () => {
      checks++;
      return drift;
    });
    const refusal = await assertRunningCodeInstalled(1_000).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(RunningCodeChangedError);
    const message = (refusal as Error).message;
    expect(message).toContain("runs CLI 0.8.0, and CLI 0.9.0 is installed now");
    expect(message).toContain("Nothing was written: the old code would stamp cli_version 0.8.0");
    expect((refusal as RunningCodeChangedError).suggestions?.[0]).toContain("dr serve --stop");
    await expect(assertRunningCodeInstalled(10_000_000)).rejects.toBeInstanceOf(RunningCodeChangedError);
    expect(checks).toBe(1);
  });

  it.serial("reuses a clean check for two seconds, then checks again", async () => {
    let next: RunningCodeDrift | null = null;
    let checks = 0;
    enableRunningCodeGuard(true, async () => {
      checks++;
      return next;
    });
    await assertRunningCodeInstalled(10_000);
    next = drift;
    await assertRunningCodeInstalled(11_000);
    expect(checks).toBe(1);
    await expect(assertRunningCodeInstalled(12_000)).rejects.toBeInstanceOf(RunningCodeChangedError);
    expect(checks).toBe(2);
  });

  it.serial("stops a model save before it writes anything", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dr-running-code-"));
    scratch.push(root);
    const model = await Model.init(root, { name: "guarded", version: "1.0.0", specVersion: "0.15.0" });
    enableRunningCodeGuard(true, async () => drift);
    await expect(model.saveManifest()).rejects.toBeInstanceOf(RunningCodeChangedError);
    enableRunningCodeGuard(false);
    await expect(model.saveManifest()).resolves.toBeUndefined();
  });
});
