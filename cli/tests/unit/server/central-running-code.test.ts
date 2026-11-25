/**
 * The central process and the code it runs (#1427), on the real server over a scratch farm:
 * - the viewer's Apply (`POST …/changesets/{id}/commit`) is refused, with nothing written, once
 *   the installed CLI changed under the process;
 * - a commit checked at its start runs to the end even when the CLI changes partway through;
 * - `centralActivity().requestsInFlight` counts the API requests and MCP tool calls being
 *   answered, which a restart must never cut.
 *
 * The write guard is process-wide, so each of these runs alone (it.serial) and turns it off after itself.
 */

import { describe, expect, it, spyOn } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { countToolCall } from "../../../src/mcp/tool-calls-in-flight.js";
import {
  enableRunningCodeGuard,
  withRunningCodeChecked,
  type RunningCodeDrift,
} from "../../../src/utils/running-code.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";
import { startTestFarmServer } from "../../helpers/test-farm-server.js";

const DRIFT: RunningCodeDrift = { reason: "version", running: "0.8.0", installed: { version: "0.9.0", spec: null } };

/** A scratch project with a model, its own per test: the unit suite runs files concurrently. */
async function withProject(run: (rootPath: string) => Promise<void>): Promise<void> {
  const dir = join(tmpdir(), `dr-central-running-code-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  const rootPath = await realpath(dir);
  await Model.init(rootPath, { name: "Running code", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
  try {
    await run(rootPath);
  } finally {
    enableRunningCodeGuard(false);
    await rm(rootPath, { recursive: true, force: true });
  }
}

/** A staged changeset adding one goal. */
async function stagePlan(rootPath: string): Promise<string> {
  const model = await Model.load(rootPath, { lazyLoad: false });
  const manager = new StagingAreaManager(rootPath, model);
  const changeset = await manager.create("plan", "a goal");
  await manager.stage(changeset.id!, {
    type: "add",
    elementId: "motivation.goal.ship-it",
    layerName: "motivation",
    after: {
      id: randomUUID(),
      path: "motivation.goal.ship-it",
      type: "goal",
      layer_id: "motivation",
      spec_node_id: "motivation.goal",
      name: "Ship it",
      attributes: { priority: "high" },
    },
  } as never);
  return changeset.id!;
}

describe("the central process and the installed CLI", () => {
  it.serial("refuses the viewer's Apply once the CLI changed under it, writing nothing", () =>
    withProject(async (rootPath) => {
      const id = await stagePlan(rootPath);
      const server = await startTestFarmServer(rootPath);
      try {
        enableRunningCodeGuard(true, async () => DRIFT);

        const response = await server.request(`/changesets/${id}/commit`, { method: "POST" });
        expect(response.status).toBe(409);
        const body = (await response.json()) as { error: string; restart?: string };
        expect(body.error).toContain("runs CLI 0.8.0, and CLI 0.9.0 is installed now");
        expect(body.error).toContain("Nothing was written");
        expect(body.restart).toContain("dr serve --stop");

        expect((await new StagedChangesetStorage(rootPath).load(id))?.status).toBe("staged");
        const layer = await (await Model.load(rootPath, { lazyLoad: false })).getLayer("motivation");
        const goals = layer?.listElements() ?? [];
        expect(goals.map((element) => element.path)).not.toContain("motivation.goal.ship-it");

        // Once the process runs the installed CLI again (here: the guard off), the same Apply lands.
        enableRunningCodeGuard(false);
        expect((await server.request(`/changesets/${id}/commit`, { method: "POST" })).status).toBe(200);
        expect((await new StagedChangesetStorage(rootPath).load(id))?.status).toBe("committed");
      } finally {
        await server.stop();
      }
    }));

  it.serial("lands a commit checked at its start even when the CLI changes partway through", () =>
    withProject(async (rootPath) => {
      const id = await stagePlan(rootPath);
      let drift: RunningCodeDrift | null = null;
      enableRunningCodeGuard(true, async () => drift);
      const model = await Model.load(rootPath, { lazyLoad: false });
      const manager = new StagingAreaManager(rootPath, model);

      await withRunningCodeChecked(async () => {
        // The upgrade lands now: a guard checked per write would refuse what follows.
        drift = DRIFT;
        await new Promise((resolve) => setTimeout(resolve, 2_100));
        await manager.commit(model, id, { validate: true });
      });
      expect((await new StagedChangesetStorage(rootPath).load(id))?.status).toBe("committed");

      // A write outside a checked commit is refused.
      await expect(model.saveManifest()).rejects.toThrow("is installed now");
    }));

  it.serial("counts the API requests and MCP tool calls it is answering", () =>
    withProject(async (rootPath) => {
      const server = await startTestFarmServer(rootPath);
      expect(server.server.centralActivity().requestsInFlight).toBe(0);

      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const listing = spyOn(server.registry, "listProjects").mockImplementation(async () => {
        await held;
        return [];
      });
      try {
        const request = server.raw("/api/projects");
        while (listing.mock.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
        expect(server.server.centralActivity().requestsInFlight).toBe(1);

        const tool = countToolCall(() => held);
        expect(server.server.centralActivity().requestsInFlight).toBe(2);

        release();
        expect((await request).status).toBe(200);
        await tool;
        expect(server.server.centralActivity().requestsInFlight).toBe(0);
      } finally {
        listing.mockRestore();
        await server.stop();
      }
    }));
});
