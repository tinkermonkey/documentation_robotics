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
  RunningCodeChangedError,
  assertRunningCodeInstalled,
  describeRunningCodeDrift,
  enableRunningCodeGuard,
  runningCodeDrift,
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

describe("the write guard", () => {
  const drift: RunningCodeDrift = { reason: "version", running: "0.8.0", installed: { version: "0.9.0", spec: "0.15.0" } };
  const scratch: string[] = [];

  afterEach(async () => {
    enableRunningCodeGuard(false);
    await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("is off until a process turns it on", async () => {
    await expect(assertRunningCodeInstalled()).resolves.toBeUndefined();
  });

  it("refuses with both versions and the restart once drift is found, and keeps refusing", async () => {
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

  it("reuses a clean check for two seconds, then checks again", async () => {
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

  it("stops a model save before it writes anything", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dr-running-code-"));
    scratch.push(root);
    const model = await Model.init(root, { name: "guarded", version: "1.0.0", specVersion: "0.15.0" });
    enableRunningCodeGuard(true, async () => drift);
    await expect(model.saveManifest()).rejects.toBeInstanceOf(RunningCodeChangedError);
    enableRunningCodeGuard(false);
    await expect(model.saveManifest()).resolves.toBeUndefined();
  });
});
