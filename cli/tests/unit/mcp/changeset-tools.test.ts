/**
 * Unit tests for the MCP changeset tool handlers — changeset_list and
 * changeset_show, mirroring the REST `/api/changesets` endpoints.
 *
 * Follows the same per-test isolated project convention as model-tools.test.ts:
 * no shared describe-scoped state, since `bun test` may run these files
 * concurrently.
 */

import { describe, it, expect } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";
import { changesetListHandler } from "../../../src/mcp/tools/changeset-list.js";
import { changesetShowHandler } from "../../../src/mcp/tools/changeset-show.js";

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

async function withProject(fn: (rootPath: string) => Promise<void>): Promise<void> {
  const rootPath = join(
    tmpdir(),
    `dr-mcp-changeset-tools-unit-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "MCP Changeset Tools Unit Test Model", version: "0.1.0" });

  try {
    await fn(rootPath);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
}

describe("MCP changeset tools", () => {
  describe("changeset_list", () => {
    it("returns an empty changeset map when none exist", async () => {
      await withProject(async (rootPath) => {
        const result = await changesetListHandler({ rootPath });
        const data = parse(result);
        expect(data.version).toBe("1.0.0");
        expect(data.changesets).toEqual({});
        expect(data.activeChangesetId).toBeNull();
      });
    });

    it("lists created changesets with REST-equivalent metadata", async () => {
      await withProject(async (rootPath) => {
        const model = await Model.load(rootPath, { lazyLoad: false });
        const manager = new StagingAreaManager(rootPath, model);
        const changeset = await manager.create("v1 migration", "Test changeset");
        await manager.setActive(changeset.id);

        const result = await changesetListHandler({ rootPath });
        const data = parse(result);

        expect(Object.keys(data.changesets)).toEqual([changeset.id]);
        expect(data.changesets[changeset.id]).toEqual({
          name: "v1 migration",
          status: "staged",
          created: changeset.created,
          changes_count: 0,
        });
        expect(data.activeChangesetId).toBe(changeset.id);
      });
    });
  });

  describe("changeset_show", () => {
    it("returns full changeset detail matching the REST detail shape", async () => {
      await withProject(async (rootPath) => {
        const model = await Model.load(rootPath, { lazyLoad: false });
        const manager = new StagingAreaManager(rootPath, model);
        const changeset = await manager.create("v1 migration", "Test changeset");

        const result = await changesetShowHandler({ changesetId: changeset.id, rootPath });
        const data = parse(result);

        expect(data.id).toBe(changeset.id);
        expect(data.name).toBe("v1 migration");
        expect(data.description).toBe("Test changeset");
        expect(data.status).toBe("staged");
        expect(data.stats).toEqual({ additions: 0, modifications: 0, deletions: 0 });
        expect(data.changes).toEqual([]);
        expect(typeof data.baseSnapshot).toBe("string");
      });
    });

    it("finds a changeset by name as well as by ID", async () => {
      await withProject(async (rootPath) => {
        const model = await Model.load(rootPath, { lazyLoad: false });
        const manager = new StagingAreaManager(rootPath, model);
        const changeset = await manager.create("v1 migration");

        const result = await changesetShowHandler({ changesetId: "v1 migration", rootPath });
        const data = parse(result);
        expect(data.id).toBe(changeset.id);
      });
    });

    it("includes the revision, origin and the reviewer's verdicts with their notes", async () => {
      await withProject(async (rootPath) => {
        const model = await Model.load(rootPath, { lazyLoad: false });
        const manager = new StagingAreaManager(rootPath, model);
        const changeset = await manager.create("reviewed", undefined, { kind: "chat" });
        await manager.stage(changeset.id, {
          type: "add",
          elementId: "motivation.goal.g",
          layerName: "motivation",
          after: { id: "g", path: "motivation.goal.g", type: "goal", name: "G" },
        });
        await new StagedChangesetStorage(rootPath).updateReview(changeset.id, () => ({
          "0": { verdict: "ask", note: "Is this the right goal?", atRevision: 1, decidedAt: "2026-11-13T00:00:00.000Z" },
        }));

        for (const detail of ["full", "summary"] as const) {
          const data = parse(await changesetShowHandler({ changesetId: changeset.id, detail, rootPath }));
          // Recording the decision took revision 1, so the changeset is now at 2.
          expect(data.revision).toBe(2);
          expect(data.origin).toEqual({ kind: "chat" });
          expect(data.review).toEqual({
            lastReviewedRevision: 1,
            decisions: [
              {
                sequence: 0,
                verdict: "ask",
                note: "Is this the right goal?",
                atRevision: 1,
                elementId: "motivation.goal.g",
                type: "add",
                current: true,
              },
            ],
          });
        }
      });
    });

    it("returns a structured not-found error for a missing changeset", async () => {
      await withProject(async (rootPath) => {
        const result = await changesetShowHandler({ changesetId: "does-not-exist", rootPath });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.category).toBe("not_found");
      });
    });
  });
});
