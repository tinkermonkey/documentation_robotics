/**
 * The active-changeset marker (#1218).
 *
 * A marker can name a changeset that is committed, discarded or gone: left behind by an
 * interrupted landing or, while the marker was `documentation-robotics/changesets/.active`,
 * committed to git with the changesets. Model.load used to project that changeset anyway while the
 * write path (MutationHandler) staged only into a staged one, so a write went into a projected
 * copy of the layer and was saved nowhere, with a success message. The marker now counts on every
 * surface only while it names a staged changeset.
 *
 * The marker is per-checkout state and lives in `.dr/active-changeset`. The old place is still
 * read when `.dr/` has no marker, and every write moves it.
 */
import { describe, it, expect } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import YAML from "yaml";
import { Model } from "../../../src/core/model.js";
import { Element } from "../../../src/core/element.js";
import { MutationHandler } from "../../../src/core/mutation-handler.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelShowHandler } from "../../../src/mcp/tools/model-show.js";
import { changesetDeactivateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";

const EXISTING_GOAL = "motivation.goal.keep-the-model-as-built";

async function writeModel(root: string): Promise<void> {
  const modelDir = join(root, "documentation-robotics", "model");
  await mkdir(join(modelDir, "01_motivation"), { recursive: true });
  await writeFile(
    join(modelDir, "manifest.yaml"),
    YAML.stringify({
      version: "1.0.0",
      schema: "documentation-robotics-v1",
      spec_version: getCliBundledSpecVersion(),
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      project: { name: "stale-active-marker-test", version: "1.0.0" },
    })
  );
  await writeFile(
    join(modelDir, "01_motivation", "goal.yaml"),
    YAML.stringify({
      [EXISTING_GOAL]: {
        id: crypto.randomUUID(),
        path: EXISTING_GOAL,
        spec_node_id: "motivation.goal",
        type: "goal",
        layer_id: "motivation",
        name: "Keep the model as built",
        attributes: { priority: "high" },
      },
    })
  );
  await writeFile(join(modelDir, "relationships.yaml"), YAML.stringify([]));
}

/** Run a test against its own on-disk model (the unit suite runs tests concurrently) */
async function withModel(test: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "dr-stale-active-"));
  try {
    await writeModel(root);
    await test(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const markerPath = (root: string) => join(root, ".dr", "active-changeset");
const legacyMarkerPath = (root: string) => join(root, "documentation-robotics", "changesets", ".active");
const exists = (file: string) => readFile(file).then(() => true, () => false);

const goalFile = (root: string) => readFile(join(root, "documentation-robotics", "model", "01_motivation", "goal.yaml"), "utf-8");

async function managerFor(root: string): Promise<{ model: Model; manager: StagingAreaManager; storage: StagedChangesetStorage }> {
  const model = await Model.load(root, { lazyLoad: false });
  return { model, manager: new StagingAreaManager(model.rootPath, model), storage: new StagedChangesetStorage(model.rootPath) };
}

/** A changeset that staged one goal and was then marked `status`, with the marker still naming it */
async function leaveMarkerBehind(root: string, status: "committed" | "discarded"): Promise<string> {
  const { manager, storage } = await managerFor(root);
  const changeset = await manager.create("landed-earlier", "A plan that has landed");
  await manager.setActive(changeset.id!);
  await manager.stage(changeset.id!, {
    type: "add",
    elementId: "motivation.goal.staged-in-the-old-plan",
    layerName: "motivation",
    after: { id: "motivation.goal.staged-in-the-old-plan", type: "goal", name: "Staged in the old plan" },
    timestamp: "2026-01-01T00:00:00.000Z",
  });
  const stored = (await storage.load(changeset.id!))!;
  if (status === "committed") stored.markCommitted();
  else stored.markDiscarded();
  await storage.save(stored);
  expect((await readFile(markerPath(root), "utf-8")).trim()).toBe(changeset.id!);
  return changeset.id!;
}

const text = (result: { content: Array<{ type: string; text?: string }> }): string => result.content[0]?.text ?? "";

describe("a .active marker that names a changeset that is no longer staged", () => {
  for (const status of ["committed", "discarded"] as const) {
    it(`is no active changeset when the changeset is ${status}`, () =>
      withModel(async (root) => {
        const id = await leaveMarkerBehind(root, status);
        const { model, manager } = await managerFor(root);

        expect(await manager.getActive()).toBeNull();
        expect(await manager.getActiveId()).toBeNull();
        expect(await manager.isActive(id)).toBe(false);
        expect(await manager.staleActiveMarker()).toEqual({ id, name: "landed-earlier", status });

        // The model does not project it: its staged element is not read as part of the model
        expect(model.getActiveChangesetId()).toBeNull();
        const layer = await model.getLayer("motivation");
        expect(layer?.getElement("motivation.goal.staged-in-the-old-plan")).toBeUndefined();
        expect(layer?.getElement(EXISTING_GOAL)).toBeDefined();
      }));
  }

  it("is no active changeset when the changeset is gone", () =>
    withModel(async (root) => {
      await mkdir(join(root, ".dr"), { recursive: true });
      await writeFile(markerPath(root), "changeset-1700000000000-gone00000\n");
      const { model, manager } = await managerFor(root);

      expect(await manager.getActive()).toBeNull();
      expect(await manager.getActiveId()).toBeNull();
      expect(await manager.staleActiveMarker()).toEqual({ id: "changeset-1700000000000-gone00000", status: "missing" });
      expect(model.getActiveChangesetId()).toBeNull();
    }));

  it("reports no leftover marker when there is none, or when it names the active changeset", () =>
    withModel(async (root) => {
      const { manager } = await managerFor(root);
      expect(await manager.staleActiveMarker()).toBeNull();

      const changeset = await manager.create("in-progress");
      await manager.setActive(changeset.id!);
      expect(await manager.getActiveId()).toBe(changeset.id!);
      expect(await manager.isActive(changeset.id!)).toBe(true);
      expect(await manager.staleActiveMarker()).toBeNull();
    }));

  it("lets a write through to the base model, where it can be read back", () =>
    withModel(async (root) => {
      await leaveMarkerBehind(root, "committed");

      const added = JSON.parse(
        text(
          await modelAddHandler({
            layer: "motivation",
            type: "goal",
            name: "Written after the landing",
            attributes: { priority: "low" },
            rootPath: root,
          })
        )
      );
      expect(added).toMatchObject({ status: "added", id: "motivation.goal.written-after-the-landing" });
      expect(added.changeset).toBeUndefined();

      // On disk in the base model, and nowhere in the committed changeset
      expect(await goalFile(root)).toContain("motivation.goal.written-after-the-landing");
      const shown = text(await modelShowHandler({ id: "motivation.goal.written-after-the-landing", rootPath: root }));
      expect(shown).toContain("Written after the landing");
    }));

  it("is removed by changeset_deactivate, which reports what it cleared", () =>
    withModel(async (root) => {
      await leaveMarkerBehind(root, "committed");
      const result = JSON.parse(text(await changesetDeactivateHandler({ rootPath: root })));
      expect(result).toEqual({
        deactivated: null,
        clearedLeftoverMarker: { changeset: "landed-earlier", status: "committed" },
      });
      expect(await exists(markerPath(root))).toBe(false);
      expect(JSON.parse(text(await changesetDeactivateHandler({ rootPath: root })))).toEqual({ deactivated: null });
    }));

  it("is cleared when the changeset it names is deleted", () =>
    withModel(async (root) => {
      const id = await leaveMarkerBehind(root, "committed");
      const { manager } = await managerFor(root);
      await manager.delete(id);
      expect(await exists(markerPath(root))).toBe(false);
    }));
});

describe("a base write from a model that is still projecting a changeset", () => {
  it("fails and says so, instead of saving nothing", () =>
    withModel(async (root) => {
      // The model is loaded while the changeset is staged and active, so it projects it...
      const { manager, storage } = await managerFor(root);
      const changeset = await manager.create("lands-behind-our-back");
      await manager.setActive(changeset.id!);
      const projecting = await Model.load(root, { lazyLoad: false });
      expect(projecting.getActiveChangesetId()).toBe(changeset.id!);

      // ...and the changeset stops being staged before the write (another process landed it)
      const stored = (await storage.load(changeset.id!))!;
      stored.markCommitted();
      await storage.save(stored);

      const element = new Element({
        id: "motivation.goal.lost-without-the-guard",
        name: "Lost without the guard",
        type: "goal",
        description: "",
        metadata: {},
      });
      const layer = (await projecting.getLayer("motivation"))!;
      const handler = new MutationHandler(projecting, element.id, "motivation");
      await expect(handler.executeAdd(element, (elem) => layer.addElement(elem))).rejects.toThrow(
        "The change was not saved"
      );
      expect(await goalFile(root)).not.toContain("lost-without-the-guard");
    }));
});

describe("where the marker lives", () => {
  it("is .dr/active-changeset, not beside the committed changesets", () =>
    withModel(async (root) => {
      const { manager } = await managerFor(root);
      const changeset = await manager.create("in-progress");
      await manager.setActive(changeset.id!);

      expect(await readFile(markerPath(root), "utf-8")).toBe(`${changeset.id}\n`);
      expect(await exists(legacyMarkerPath(root))).toBe(false);

      await manager.clearActive();
      expect(await exists(markerPath(root))).toBe(false);
      expect(await manager.getActiveId()).toBeNull();
    }));

  it("still reads a marker in the old place when .dr/ has none, and moves it on the next write", () =>
    withModel(async (root) => {
      const { manager } = await managerFor(root);
      const first = await manager.create("mid-change-before-the-move");
      const second = await manager.create("the-next-one");
      await writeFile(legacyMarkerPath(root), `${first.id}\n`);

      // A checkout that was mid-change keeps its active changeset, in the model too
      expect(await manager.getActiveId()).toBe(first.id!);
      expect((await Model.load(root, { lazyLoad: false })).getActiveChangesetId()).toBe(first.id!);

      await manager.setActive(second.id!);
      expect(await readFile(markerPath(root), "utf-8")).toBe(`${second.id}\n`);
      expect(await exists(legacyMarkerPath(root))).toBe(false);
      expect(await manager.getActiveId()).toBe(second.id!);
    }));

  it("prefers .dr/ when both places hold a marker", () =>
    withModel(async (root) => {
      const { manager } = await managerFor(root);
      const old = await manager.create("named-in-the-old-place");
      const current = await manager.create("named-in-dot-dr");
      await manager.setActive(current.id!);
      await writeFile(legacyMarkerPath(root), `${old.id}\n`);

      expect(await manager.getActiveId()).toBe(current.id!);
    }));

  it("removes a marker left in the old place when deactivating", () =>
    withModel(async (root) => {
      const { manager } = await managerFor(root);
      const changeset = await manager.create("mid-change-before-the-move");
      await writeFile(legacyMarkerPath(root), `${changeset.id}\n`);

      await manager.clearActive();
      expect(await exists(legacyMarkerPath(root))).toBe(false);
      expect(await exists(markerPath(root))).toBe(false);
      expect(await manager.getActiveId()).toBeNull();
    }));
});
