/**
 * VisualizationServer.stop and the file watcher (#1235).
 *
 * Closing a chokidar watcher while the tree it watches is being deleted deadlocks Bun's main
 * thread. server-entry.ts stopped the server and then called process.exit, so a viewer whose
 * project folder was removed as it was stopped never reached the exit and ignored every later
 * signal. A stop that is followed by process.exit leaves the watcher to the exit.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import type { VisualizationServer } from "../../../src/server/server.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";
import { createServerWithoutChatDetection } from "./helpers.js";

let rootPath: string;

beforeEach(async () => {
  const dir = join(tmpdir(), `dr-server-stop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  rootPath = await realpath(dir);
  await Model.init(rootPath, { name: "Stop Test", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
});

afterEach(async () => {
  await rm(rootPath, { recursive: true, force: true });
});

async function serverWithWatcher(): Promise<{ server: VisualizationServer; closes: () => number }> {
  const model = await Model.load(rootPath, { lazyLoad: false });
  const server = createServerWithoutChatDetection(model, { authEnabled: false });
  let closed = 0;
  (server as any).watcher = { close: () => void closed++ };
  return { server, closes: () => closed };
}

describe("VisualizationServer.stop", () => {
  it.serial("closes the file watcher", async () => {
    const { server, closes } = await serverWithWatcher();
    server.stop();
    expect(closes()).toBe(1);
  });

  it.serial("leaves the file watcher open when the process is about to exit", async () => {
    const { server, closes } = await serverWithWatcher();
    server.stop({ processExiting: true });
    expect(closes()).toBe(0);
  });
});
