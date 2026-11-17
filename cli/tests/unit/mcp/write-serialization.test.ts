/**
 * Base-model write tools run one at a time per project (#1127).
 *
 * Each write tool reads the model, edits it and saves whole layer files. changeset_commit lands a
 * changeset through its own fresh Model instance, so without the per-project write lock a
 * model_update on the cached model could save the layer as it was before the landing (or the
 * landing could save it as it was before the update). These tests fire model_update calls while
 * changeset_commit is landing a changeset into the same layer, and check that nothing is lost.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { CHANGESET_ONLY_ENV } from "../../../src/core/changeset-only-guard.js";
import {
  acquireModelWriteLock,
  withModelWriteLock
} from "../../../src/core/model-write-tracker.js";
import { McpToolRegistry } from "../../../src/mcp/tool-registry.js";
import { clearModelCache, loadModel } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import {
  changesetCreateHandler,
  changesetDeactivateHandler
} from "../../../src/mcp/tools/changeset-lifecycle.js";
import { createTestWorkdir } from "../../helpers/golden-copy.js";

const TYPES = [
  "assessment",
  "constraint",
  "driver",
  "goal",
  "meaning",
  "outcome",
  "principle",
  "requirement",
  "stakeholder",
  "value"
];
const PER_TYPE = 50;
const LANDED = "motivation.goal.landed-goal";

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let workdir: { path: string; cleanup: () => Promise<void> };
let client: Client | undefined;
let savedEnv: string | undefined;

/** A motivation layer large enough that saving it takes a while: PER_TYPE elements of each type. */
async function fillMotivationLayer(root: string): Promise<void> {
  const dir = join(root, "documentation-robotics", "model", "01_motivation");
  for (const type of TYPES) {
    let text = "";
    for (let n = 0; n < PER_TYPE; n++) {
      text +=
        `motivation.${type}.x-${n}:\n  id: ${crypto.randomUUID()}\n  path: motivation.${type}.x-${n}\n` +
        `  spec_node_id: motivation.${type}\n  type: ${type}\n  layer_id: motivation\n  name: X ${n}\n  description: Item ${n}\n`;
    }
    await writeFile(join(dir, `${type}.yaml`), text);
  }
}

/** A client whose person confirms every commit, on a server with the real tool surface. */
async function connect(): Promise<Client> {
  const server = new McpServer({ name: "dr-test", version: "0.0.0" });
  new McpToolRegistry().registerAll(server);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const created = new Client(
    { name: "test-client", version: "0.0.0" },
    { capabilities: { elicitation: {} } }
  );
  created.setRequestHandler(ElicitRequestSchema, async () => ({
    action: "accept",
    content: { confirm: true }
  }));
  await created.connect(clientTransport);
  client = created;
  return created;
}

beforeEach(async () => {
  savedEnv = process.env[CHANGESET_ONLY_ENV];
  delete process.env[CHANGESET_ONLY_ENV];
  clearModelCache();
  workdir = await createTestWorkdir();
});

afterEach(async () => {
  await client?.close();
  client = undefined;
  if (savedEnv === undefined) delete process.env[CHANGESET_ONLY_ENV];
  else process.env[CHANGESET_ONLY_ENV] = savedEnv;
  clearModelCache();
  await workdir.cleanup();
});

describe("model write lock", () => {
  it.serial(
    "grants the lock per project in the order it was asked for",
    async () => {
      const order: string[] = [];
      const first = await acquireModelWriteLock(workdir.path);
      const second = withModelWriteLock(workdir.path, async () => {
        order.push("second");
      });
      // Another project's lock is free.
      await withModelWriteLock(join(workdir.path, "other"), async () => {
        order.push("other");
      });
      await sleep(5);
      order.push("first");
      first();
      first(); // a second release does nothing
      await second;
      expect(order).toEqual(["other", "first", "second"]);
    }
  );

  it.serial("is reentrant within the context that holds it", async () => {
    const result = await withModelWriteLock(workdir.path, () =>
      withModelWriteLock(join(workdir.path, "."), async () => "inner")
    );
    expect(result).toBe("inner");
  });
});

describe("base-model writes while changeset_commit lands (#1127)", () => {
  it.serial(
    "loses neither the landing nor any model_update fired while it writes",
    async () => {
      const rootPath = workdir.path;
      await fillMotivationLayer(rootPath);
      await loadModel(rootPath);

      // A plan that adds a goal to the same layer the updates write, set aside so the updates go
      // to the base model.
      expect(
        parse(
          await changesetCreateHandler({
            name: "land-it",
            description: "Adds a goal",
            rootPath
          })
        ).error
      ).toBeUndefined();
      expect(
        parse(
          await modelAddHandler({
            layer: "motivation",
            type: "goal",
            name: "landed-goal",
            attributes: { priority: "high" },
            rootPath
          })
        ).status
      ).toBe("staged");
      await changesetDeactivateHandler({ rootPath });

      // Fire the updates once the commit has begun writing (after the person confirmed).
      let commitWriting!: () => void;
      const writing = new Promise<void>((resolve) => {
        commitWriting = resolve;
      });
      const realCommit = StagingAreaManager.prototype.commit;
      const spy = spyOn(
        StagingAreaManager.prototype,
        "commit"
      ).mockImplementation(function (
        this: StagingAreaManager,
        ...args: Parameters<StagingAreaManager["commit"]>
      ) {
        if (!args[2]?.dryRun) commitWriting();
        return realCommit.apply(this, args);
      });

      try {
        const c = await connect();
        const committing = c.callTool({
          name: "changeset_commit",
          arguments: { changeset: "land-it", force: true, rootPath }
        });
        await writing;
        const updates: Array<Promise<any>> = [];
        const ids: string[] = [];
        for (let i = 0; i < TYPES.length; i++) {
          const id = `motivation.${TYPES[i]}.x-${i}`;
          ids.push(id);
          updates.push(
            modelUpdateHandler({ id, description: `UPDATED ${i}`, rootPath })
          );
          await sleep(3);
        }
        const [committed, ...updated] = await Promise.all([
          committing,
          ...updates
        ]);

        expect(parse(committed).status).toBe("committed");
        for (const result of updated) expect(result.isError).toBeFalsy();

        const disk = await Model.load(rootPath, { lazyLoad: false });
        const elements = (await disk.getLayer("motivation"))!.listElements();
        const byId = new Map(elements.map((e) => [e.path, e]));
        expect(byId.has(LANDED)).toBe(true);
        for (const [i, id] of ids.entries())
          expect(byId.get(id)?.description).toBe(`UPDATED ${i}`);
        expect(elements.filter((e) => e.path.includes(".x-")).length).toBe(
          TYPES.length * PER_TYPE
        );
      } finally {
        spy.mockRestore();
      }
    },
    60_000
  );
});
