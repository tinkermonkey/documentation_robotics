/**
 * Changeset review: verdict storage (review.yaml), origin, drop cascades, decision currency, and
 * delete blockers over the projected graph.
 */

import { describe, it, expect } from "bun:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "yaml";
import { Changeset, type Change } from "../../../src/core/changeset.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";
import {
  CHANGESET_ORIGIN_ENV,
  cascadeDrops,
  decisionIsCurrent,
  deleteBlockers,
  readOrigin,
  readReview,
  resolveOrigin,
  reviewCounts,
  reviewForAgent,
  reviewRevision,
} from "../../../src/core/changeset-review.js";
import { ChangesetGraph } from "../../../src/core/changeset-graph.js";

const TS = "2026-11-13T00:00:00.000Z";

function add(id: string, sequenceNumber: number, uuid = `uuid-${id}`): Change {
  return {
    type: "add",
    elementId: id,
    layerName: id.split(".")[0],
    after: { id: uuid, path: id, type: id.split(".")[1], name: id.split(".")[2] },
    timestamp: TS,
    sequenceNumber,
  } as Change;
}

function relAdd(source: string, predicate: string, target: string, sequenceNumber: number): Change {
  return {
    type: "relationship-add",
    elementId: `${source}::${predicate}::${target}`,
    layerName: source.split(".")[0],
    after: { source, predicate, target, layer: source.split(".")[0] },
    timestamp: TS,
    sequenceNumber,
  } as Change;
}

function changesetWith(changes: Change[]): Changeset {
  const changeset = Changeset.create("review", undefined, "review", "base");
  changeset.changes = changes;
  return changeset;
}

describe("cascadeDrops", () => {
  const changeset = changesetWith([
    add("application.component.a", 0),
    add("application.component.b", 1),
    relAdd("application.component.a", "serves", "application.component.b", 2),
    // names the dropped element by UUID
    relAdd("application.component.b", "uses", "uuid-application.component.a", 3),
    { type: "update", elementId: "application.component.a", layerName: "application", after: { name: "A2" }, timestamp: TS, sequenceNumber: 4 } as Change,
    relAdd("application.component.b", "uses", "application.component.c", 5),
  ]);

  it("drops the changes that depend on a dropped add, by dotted id or UUID", () => {
    expect(cascadeDrops(changeset, [0])).toEqual({ dropped: [0, 2, 3, 4], unknown: [] });
  });

  it("does not cascade from a dropped relationship or update", () => {
    expect(cascadeDrops(changeset, [5, 4])).toEqual({ dropped: [4, 5], unknown: [] });
  });

  it("reports sequence numbers that name no staged change", () => {
    expect(cascadeDrops(changeset, [1, 42])).toEqual({ dropped: [1, 2, 3, 5], unknown: [42] });
  });
});

describe("decisions", () => {
  it("reads only well-formed decisions and computes lastReviewedRevision", () => {
    const review = readReview({
      decisions: {
        "1": { verdict: "keep", atRevision: 4, decidedAt: TS },
        "2": { verdict: "ask", note: "why?", atRevision: 6, decidedAt: TS },
        "3": { verdict: "maybe", atRevision: 9, decidedAt: TS },
        x: { verdict: "drop", atRevision: 9, decidedAt: TS },
      },
    });
    expect(Object.keys(review.decisions)).toEqual(["1", "2"]);
    expect(review.lastReviewedRevision).toBe(6);
    expect(readReview(undefined)).toEqual({ decisions: {} });
  });

  it("counts a decision only while its change is staged and not rewritten since", () => {
    const changeset = changesetWith([add("motivation.goal.a", 0), add("motivation.goal.b", 1), add("motivation.goal.c", 2)]);
    changeset.unstaged = [
      { sequence: 1, removedAt: 5, rewritten: true, change: add("motivation.goal.b", 1) },
      { sequence: 3, removedAt: 4, change: add("motivation.goal.d", 3) },
    ];
    changeset.lastSequence = 5;
    const review = readReview({
      decisions: {
        "0": { verdict: "keep", atRevision: 3, decidedAt: TS },
        "1": { verdict: "ask", atRevision: 3, decidedAt: TS }, // rewritten at 5: stale
        "2": { verdict: "ask", atRevision: 6, decidedAt: TS },
        "3": { verdict: "drop", atRevision: 3, decidedAt: TS }, // withdrawn
      },
    });
    expect(reviewRevision(changeset)).toBe(6);
    expect(decisionIsCurrent(changeset, 1, review.decisions["1"])).toBe(false);
    expect(reviewCounts(changeset, review)).toEqual({ decided: 2, total: 3, asked: 1 });

    const forAgent = reviewForAgent(changeset, review)!;
    expect(forAgent.decisions.map((d) => [d.sequence, d.current, d.elementId])).toEqual([
      [0, true, "motivation.goal.a"],
      [1, false, "motivation.goal.b"],
      [2, true, "motivation.goal.c"],
      [3, false, "motivation.goal.d"],
    ]);
    expect(reviewForAgent(changeset, { decisions: {} })).toBeUndefined();
  });
});

describe("origin", () => {
  it("is chat in DrBot's environment, else the caller's kind", () => {
    expect(resolveOrigin("plan", {})).toEqual({ kind: "plan" });
    expect(resolveOrigin("cli", { [CHANGESET_ORIGIN_ENV]: "chat" })).toEqual({ kind: "chat" });
  });

  it("ignores a malformed origin", () => {
    expect(readOrigin({ kind: "robot" })).toBeUndefined();
    expect(readOrigin("plan")).toBeUndefined();
    expect(readOrigin({ kind: "extract", detail: "x" })).toEqual({ kind: "extract", detail: "x" });
  });
});

/** A storage over its own temp directory (tests in this file may run concurrently). */
async function withStorage(fn: (storage: StagedChangesetStorage) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "dr-review-"));
  try {
    await fn(new StagedChangesetStorage(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("StagedChangesetStorage review and origin", () => {
  it("stores the origin in metadata.yaml and loads it back", () =>
    withStorage(async (storage) => {
      await storage.create("cs-1", "one", undefined, "base", { kind: "plan" });
      const metadata = yaml.parse(await readFile(join(storage.getChangesetPath("cs-1"), "metadata.yaml"), "utf-8"));
      expect(metadata.origin).toEqual({ kind: "plan" });
      const loaded = (await storage.load("cs-1"))!;
      expect(loaded.origin).toEqual({ kind: "plan" });
      // A save keeps it
      await storage.save(loaded);
      expect((await storage.load("cs-1"))!.origin).toEqual({ kind: "plan" });
    }));

  it("loads a changeset without origin or review.yaml", () =>
    withStorage(async (storage) => {
      await storage.create("cs-2", "two", undefined, "base");
      const loaded = (await storage.load("cs-2"))!;
      expect(loaded.origin).toBeUndefined();
      expect(loaded.review).toEqual({ decisions: {} });
    }));

  it("writes decisions to review.yaml under the lock and removes it when the last is cleared", () =>
    withStorage(async (storage) => {
      await storage.create("cs-3", "three", undefined, "base");
      await storage.addChange("cs-3", { type: "add", elementId: "motivation.goal.a", layerName: "motivation", after: { id: "a" } });
      const reviewPath = join(storage.getChangesetPath("cs-3"), "review.yaml");

      const review = await storage.updateReview("cs-3", (_changeset, decisions) => ({
        ...decisions,
        "0": { verdict: "drop", note: "not now", atRevision: 1, decidedAt: TS },
    }));
    expect(review).toEqual({
      decisions: { "0": { verdict: "drop", note: "not now", atRevision: 1, decidedAt: TS } },
      lastReviewedRevision: 1,
    });
    expect((await storage.load("cs-3"))!.review.decisions["0"].verdict).toBe("drop");
    // A save of the changeset never touches review.yaml
    await storage.save((await storage.load("cs-3"))!);
    expect(existsSync(reviewPath)).toBe(true);

    await storage.updateReview("cs-3", () => ({}));
    expect(existsSync(reviewPath)).toBe(false);
    }));

  it("writes nothing when the update refuses", () =>
    withStorage(async (storage) => {
      await storage.create("cs-4", "four", undefined, "base");
      await expect(
        storage.updateReview("cs-4", () => {
          throw new Error("refused");
        })
      ).rejects.toThrow("refused");
      expect(existsSync(join(storage.getChangesetPath("cs-4"), "review.yaml"))).toBe(false);
    }));

  it("an unreadable review.yaml reads as no decisions", () =>
    withStorage(async (storage) => {
      await storage.create("cs-5", "five", undefined, "base");
      await writeFile(join(storage.getChangesetPath("cs-5"), "review.yaml"), "decisions: [unclosed", "utf-8");
      const warn = console.warn;
      console.warn = () => {};
      try {
        expect((await storage.load("cs-5"))!.review).toEqual({ decisions: {} });
      } finally {
        console.warn = warn;
      }
    }));

  it("removes changes by sequence number as one revision, keeping other changes to the same element", () =>
    withStorage(async (storage) => {
      await storage.create("cs-6", "six", undefined, "base");
      await storage.addChange("cs-6", { type: "add", elementId: "motivation.goal.a", layerName: "motivation", after: { id: "a" } });
      await storage.addChange("cs-6", { type: "update", elementId: "motivation.goal.a", layerName: "motivation", after: { id: "a", name: "A" } });
      await storage.addChange("cs-6", { type: "add", elementId: "motivation.goal.b", layerName: "motivation", after: { id: "b" } });

      await storage.removeChangesBySequence("cs-6", [1, 2]);

      const loaded = (await storage.load("cs-6"))!;
      expect(loaded.changes.map((c) => [c.type, c.elementId])).toEqual([["add", "motivation.goal.a"]]);
      expect(loaded.unstaged.map((t) => [t.sequence, t.removedAt, t.rewritten])).toEqual([
        [1, 3, undefined],
        [2, 3, undefined],
      ]);
      expect(reviewRevision(loaded)).toBe(4);
    }));
});

describe("deleteBlockers", () => {
  /** A minimal model double: what ChangesetGraph.build reads. */
  function modelWith(elements: Array<{ path: string; id: string }>, relationships: Array<{ source: string; predicate: string; target: string }>) {
    const byLayer = new Map<string, Array<{ path: string; id: string }>>();
    for (const e of elements) {
      const layer = e.path.split(".")[0];
      byLayer.set(layer, [...(byLayer.get(layer) ?? []), e]);
    }
    return {
      getLayerNames: () => [...byLayer.keys()],
      getBaseLayer: async (name: string) => ({
        listElements: () =>
          (byLayer.get(name) ?? []).map((e) => ({
            toJSON: () => ({ id: e.id, path: e.path, type: e.path.split(".")[1], name: e.path.split(".")[2] }),
          })),
      }),
      getBaseRelationships: () => relationships.map((r) => ({ ...r, layer: r.source.split(".")[0] })),
    } as any;
  }

  it("lists the live relationships that still name a deleted element, by either id", async () => {
    const model = modelWith(
      [
        { path: "application.component.a", id: "uuid-a" },
        { path: "application.component.b", id: "uuid-b" },
        { path: "business.service.s", id: "uuid-s" },
      ],
      [
        { source: "uuid-a", predicate: "serves", target: "business.service.s" },
        { source: "application.component.b", predicate: "uses", target: "application.component.a" },
        { source: "application.component.b", predicate: "serves", target: "business.service.s" },
      ]
    );
    const changeset = changesetWith([
      {
        type: "delete",
        elementId: "application.component.a",
        layerName: "application",
        before: { id: "uuid-a", path: "application.component.a" },
        timestamp: TS,
        sequenceNumber: 0,
      } as Change,
      // the changeset deletes one of the two relationships itself
      {
        type: "relationship-delete",
        elementId: "application.component.b::uses::application.component.a",
        layerName: "application",
        before: { source: "application.component.b", predicate: "uses", target: "application.component.a" },
        timestamp: TS,
        sequenceNumber: 1,
      } as Change,
      {
        type: "delete",
        elementId: "application.component.b",
        layerName: "application",
        before: { id: "uuid-b" },
        timestamp: TS,
        sequenceNumber: 2,
      } as Change,
    ]);

    const blockers = deleteBlockers(await ChangesetGraph.build(model, changeset), changeset);

    expect(blockers.get(0)).toEqual([
      {
        relationshipId: "application.component.a::serves::business.service.s",
        direction: "out",
        otherElementId: "business.service.s",
        predicate: "serves",
      },
    ]);
    expect(blockers.get(2)).toEqual([
      {
        relationshipId: "application.component.b::serves::business.service.s",
        direction: "out",
        otherElementId: "business.service.s",
        predicate: "serves",
      },
    ]);
  });
});
