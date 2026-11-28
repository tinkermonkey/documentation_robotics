/**
 * Adopting source references amends the plan's change entries in place (#1382): no new change, no
 * renumbering, no `lastSequence` or `modified` bump. Two branches that adopt different elements into
 * copies of one staged plan therefore merge in git without a conflict.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Changeset } from "../../../src/core/changeset.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";
import { setStagedSourceReference } from "../../../src/core/staged-source-reference.js";

const ID = "plan-one";
let dir: string;

function element(name: string) {
  return { id: `application.applicationcomponent.${name}`, name, type: "applicationcomponent", description: `The ${name}.` };
}

async function seed(root: string) {
  const storage = new StagedChangesetStorage(root);
  const now = "2026-11-28T00:00:00.000Z";
  const names = ["alpha", "bravo", "charlie", "delta"];
  await storage.save(
    new Changeset({
      id: ID,
      name: ID,
      created: now,
      modified: now,
      status: "staged",
      baseSnapshot: "sha256:abc",
      lastSequence: 4,
      changes: names.map((n, i) => ({
        type: "add" as const,
        elementId: `application.applicationcomponent.${n}`,
        layerName: "application",
        after: element(n),
        sequenceNumber: i + 1,
        timestamp: now,
      })),
    })
  );
}

async function adopt(root: string, sequenceNumber: number, file: string) {
  const storage = new StagedChangesetStorage(root);
  const plan = (await storage.load(ID))!;
  const change = (plan.changes as any[]).find((c) => c.sequenceNumber === sequenceNumber);
  const after = structuredClone(change.after);
  setStagedSourceReference(after, { provenance: "extracted", locations: [{ file, symbol: "X" }] } as any);
  return storage.amendChangesInPlace(ID, [{ sequenceNumber, after }]);
}

describe("adopting source references onto a shared staged plan (#1382)", () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "adopt-merge-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("merges two branches' adoptions of different elements with no conflict", async () => {
    const base = join(dir, "base");
    const a = join(dir, "a");
    const b = join(dir, "b");
    for (const r of [base]) await mkdir(r, { recursive: true });
    await seed(base);
    for (const r of [a, b]) await cp(join(base, "documentation-robotics"), join(r, "documentation-robotics"), { recursive: true }).catch(() => undefined);
    // The storage keeps its changesets under its root: copy whatever it wrote.
    const storageDir = (root: string) => join(root, new StagedChangesetStorage(root).getChangesetPath(ID).slice(root.length + 1));
    for (const r of [a, b]) {
      await mkdir(join(storageDir(r), ".."), { recursive: true });
      await cp(storageDir(base), storageDir(r), { recursive: true });
    }

    expect(await adopt(a, 1, "src/alpha.ts")).toEqual([1]);
    expect(await adopt(b, 2, "src/bravo.ts")).toEqual([2]);

    // Nothing but the amended `after` changed: no renumbering, no tombstones, no modified bump.
    const meta = (root: string) => readFile(join(storageDir(root), "metadata.yaml"), "utf-8");
    expect(await meta(a)).toBe(await meta(base));
    expect(await meta(b)).toBe(await meta(base));

    for (const file of ["changes.yaml", "metadata.yaml"]) {
      const merged = join(dir, `merged-${file}`);
      await cp(join(storageDir(a), file), merged);
      const r = spawnSync("git", ["merge-file", merged, join(storageDir(base), file), join(storageDir(b), file)]);
      expect(r.status).toBe(0);
      if (file === "changes.yaml") {
        const text = await readFile(merged, "utf-8");
        expect(text).toContain("src/alpha.ts");
        expect(text).toContain("src/bravo.ts");
        expect(text).not.toContain("<<<<<<<");
      }
    }
  });
});
