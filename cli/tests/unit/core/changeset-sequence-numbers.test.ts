/**
 * Sequence numbers given to changes that carry none never reuse a number an unstaged change or
 * unstage event took, and a list is never left half numbered.
 */

import { describe, it, expect } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "yaml";
import {
  Changeset,
  withSequenceNumbers,
  type Change,
  type StagedChange
} from "../../../src/core/changeset.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";

const change = (elementId: string, sequenceNumber?: number): Change =>
  ({
    type: "add",
    elementId,
    layerName: "motivation",
    after: { id: elementId },
    timestamp: "2026-11-01T00:00:00.000Z",
    ...(sequenceNumber !== undefined ? { sequenceNumber } : {})
  }) as Change;

const numbers = (changes: Change[]) =>
  changes.map((c) => (c as StagedChange).sequenceNumber);

/** Changes 0..5 staged, then 5 unstaged at revision 6. */
function unstagedTop(): Changeset {
  const changeset = Changeset.create("cs", undefined, "cs", "base");
  changeset.changes = [0, 1, 2, 3, 4].map((n) =>
    change(`motivation.goal.g${n}`, n)
  );
  changeset.unstaged = [
    { sequence: 5, removedAt: 6, change: change("motivation.goal.g5") }
  ];
  changeset.lastSequence = 6;
  return changeset;
}

describe("withSequenceNumbers", () => {
  it("numbers an older, unnumbered list by position", () => {
    expect(numbers(withSequenceNumbers([change("a"), change("b")], 9))).toEqual(
      [0, 1]
    );
  });

  it("does not go below the floor it is given", () => {
    expect(
      numbers(
        withSequenceNumbers([change("a", 0), change("b", 4), change("c")], 7)
      )
    ).toEqual([0, 4, 7]);
  });
});

describe("unnumbered changes after an unstage", () => {
  // Each test gets its own directory: test:unit runs tests concurrently
  async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), "dr-seq-"));
    try {
      await run(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it("Changeset.addChange takes the next number past the tombstones and the unstage", () => {
    const changeset = unstagedTop();
    changeset.addChange("add", "motivation.goal.g6", "motivation", undefined, {
      id: "g6"
    });
    // Not 5 (the tombstone's) nor 6 (the unstage event's)
    expect(numbers(changeset.changes).at(-1)).toBe(7);
    expect(changeset.lastSequence).toBe(7);
    expect(numbers(changeset.toJSON().changes as Change[])).toEqual([
      0, 1, 2, 3, 4, 7
    ]);
  });

  it("save numbers an unnumbered change past the tombstones and records it in lastSequence", () =>
    withRoot(async (root) => {
      const storage = new StagedChangesetStorage(root);
      const changeset = unstagedTop();
      changeset.changes.push(change("motivation.goal.g6"));
      await storage.save(changeset);

      const loaded = (await storage.load("cs"))!;
      expect(numbers(loaded.changes)).toEqual([0, 1, 2, 3, 4, 7]);
      expect(loaded.lastSequence).toBe(7);
    }));

  it("updateChange on an older unnumbered changes.yaml numbers every change by position", () =>
    withRoot(async (root) => {
      const storage = new StagedChangesetStorage(root);
      const changeset = Changeset.create("cs", undefined, "cs", "base");
      await storage.save(changeset);
      const changesPath = join(storage.getChangesetPath("cs"), "changes.yaml");
      await writeFile(
        changesPath,
        yaml.stringify(
          ["a", "b", "c"].map((id) => change(`motivation.goal.${id}`))
        )
      );

      await storage.updateChange("cs", "motivation.goal.c", {
        ...change("motivation.goal.c"),
        after: { id: "c", name: "renamed" }
      } as Omit<StagedChange, "sequenceNumber">);

      const written = yaml.parse(
        await readFile(changesPath, "utf-8")
      ) as StagedChange[];
      expect(written.map((c) => [c.elementId, c.sequenceNumber])).toEqual([
        ["motivation.goal.a", 0],
        ["motivation.goal.b", 1],
        ["motivation.goal.c", 2]
      ]);
      expect(written[2].after).toEqual({ id: "c", name: "renamed" });
    }));
});
