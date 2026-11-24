/**
 * VisualizationServer.stop and the file watcher (#1235).
 *
 * Closing a chokidar watcher while the tree it watches is being deleted deadlocks Bun's main
 * thread. server-entry.ts stopped the server and then called process.exit, so a viewer whose
 * project folder was removed as it was stopped never reached the exit and ignored every later
 * signal. A stop that is followed by process.exit leaves the watcher to the exit.
 *
 * On the one-mode server the watcher belongs to the checkout's context: stop() goes through
 * stopCentral, which stops the pool with the same `processExiting`.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";
import { startTestFarmServer, type TestFarmServer } from "../../helpers/test-farm-server.js";

let rootPath: string;
let farm: TestFarmServer | undefined;

beforeEach(async () => {
  const dir = join(tmpdir(), `dr-server-stop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  rootPath = await realpath(dir);
  await Model.init(rootPath, { name: "Stop Test", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
});

afterEach(async () => {
  await farm?.stop();
  farm = undefined;
  await rm(rootPath, { recursive: true, force: true });
});

async function serverWithWatcher(): Promise<{ farm: TestFarmServer; closes: () => number }> {
  farm = await startTestFarmServer(rootPath);
  const context = await farm.context();
  // The checkout's real watcher, if it opened one, is closed here so only the stand-in is counted.
  await context.watcher?.close?.();
  let closed = 0;
  context.watcher = { close: () => void closed++ } as any;
  return { farm, closes: () => closed };
}

describe("VisualizationServer.stop", () => {
  it.serial("closes the file watcher", async () => {
    const { farm, closes } = await serverWithWatcher();
    farm.server.stop();
    await farm.server.stopCentral(); // the same stop, awaited
    expect(closes()).toBe(1);
  });

  it.serial("leaves the file watcher open when a later stop says the process is about to exit", async () => {
    const { farm, closes } = await serverWithWatcher();
    // An MCP endpoint to close first, so the first stop is still under way when the second comes.
    let release!: () => void;
    const closing = new Promise<void>((resolve) => (release = resolve));
    (farm.server as any).central.mcp = Promise.resolve({ close: () => closing });
    const first = farm.server.stopCentral();
    const second = farm.server.stopCentral({ processExiting: true });
    release();
    await Promise.all([first, second]);
    expect(closes()).toBe(0);
  });

  it.serial("leaves the file watcher open when the process is about to exit", async () => {
    const { farm, closes } = await serverWithWatcher();
    farm.server.stop({ processExiting: true });
    await farm.server.stopCentral(); // the same stop, awaited
    expect(closes()).toBe(0);
  });
});
