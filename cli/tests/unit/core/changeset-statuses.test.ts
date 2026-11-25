/**
 * Listing changesets without parsing them (#1436): StagedChangesetStorage.listStatuses reads each
 * folder's status from metadata.yaml alone, cached by mtime and size; changesetFilesStamp tells a
 * reader when a changeset's files changed.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  StagedChangesetStorage,
  changesetFilesStamp,
  readMetadataStatus,
} from "../../../src/core/staged-changeset-storage.js";

const scratchDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dr-statuses-"));
  scratchDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(scratchDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function changeset(root: string, id: string, metadata: string, changes = "[]\n"): Promise<string> {
  const dir = path.join(root, "documentation-robotics", "changesets", id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "metadata.yaml"), metadata);
  await writeFile(path.join(dir, "changes.yaml"), changes);
  return dir;
}

describe("readMetadataStatus", () => {
  it("reads a top-level status line, plain or quoted", () => {
    expect(readMetadataStatus("id: a\nstatus: staged\nstats:\n  additions: 1\n")).toBe("staged");
    expect(readMetadataStatus('id: a\nstatus: "committed"\n')).toBe("committed");
    expect(readMetadataStatus("id: a\nstatus: 'discarded' # landed\n")).toBe("discarded");
  });

  it("ignores an indented status (a tombstone's) and parses the file when there is no single top-level one", () => {
    const text = "id: a\nunstaged:\n  - change:\n      status: staged\nstatus: committed\n";
    expect(readMetadataStatus(text)).toBe("committed");
    // Two top-level lines (not valid YAML as one mapping): parsed, and unreadable is null.
    expect(readMetadataStatus("status: staged\nstatus: committed\n")).toBeNull();
  });

  it("reads metadata with no status as staged, as loading the changeset does", () => {
    expect(readMetadataStatus("description: |\n  status: committed\nname: x\n")).toBe("staged");
    expect(readMetadataStatus("id: a\nname: a\n")).toBe("staged");
  });
});

describe("StagedChangesetStorage.listStatuses", () => {
  it("lists every folder's status from metadata.yaml, whatever changes.yaml holds", async () => {
    const root = await scratch();
    await changeset(root, "one", "id: one\nstatus: staged\n");
    await changeset(root, "two", "id: two\nstatus: committed\n", "{{{ not yaml at all");
    await mkdir(path.join(root, "documentation-robotics", "changesets", "empty"), { recursive: true });

    const statuses = await new StagedChangesetStorage(root).listStatuses();
    expect(statuses.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "empty", status: null },
      { id: "one", status: "staged" },
      { id: "two", status: "committed" },
    ]);
  });

  it("reads a status again when the file changes, not before", async () => {
    const root = await scratch();
    const dir = await changeset(root, "one", "id: one\nstatus: staged\n");
    const storage = new StagedChangesetStorage(root);
    expect(await storage.listStatuses()).toEqual([{ id: "one", status: "staged" }]);

    // Same size and mtime: the cached status stands (proof the file is not read again).
    const file = path.join(dir, "metadata.yaml");
    const when = new Date("2026-11-25T10:00:00Z");
    await utimes(file, when, when);
    expect(await storage.listStatuses()).toEqual([{ id: "one", status: "staged" }]);
    await writeFile(file, "id: one\nstatus: landed\n");
    await utimes(file, when, when);
    expect(await storage.listStatuses()).toEqual([{ id: "one", status: "staged" }]);

    // A rewrite that moves the mtime is read.
    await utimes(file, new Date(), new Date());
    expect(await storage.listStatuses()).toEqual([{ id: "one", status: "landed" }]);
  });

  it("is empty for a project with no changesets folder", async () => {
    expect(await new StagedChangesetStorage(await scratch()).listStatuses()).toEqual([]);
    expect(await new StagedChangesetStorage(await scratch()).listIds()).toEqual([]);
  });
});

describe("changesetFilesStamp", () => {
  it("changes when metadata, changes or the review file is rewritten", async () => {
    const root = await scratch();
    const dir = await changeset(root, "one", "id: one\nstatus: staged\n");
    const first = await changesetFilesStamp(dir);
    expect(await changesetFilesStamp(dir)).toBe(first);
    await writeFile(path.join(dir, "changes.yaml"), "- type: add\n  elementId: a.b.c\n");
    const second = await changesetFilesStamp(dir);
    expect(second).not.toBe(first);
    await writeFile(path.join(dir, "review.yaml"), "decisions: []\n");
    expect(await changesetFilesStamp(dir)).not.toBe(second);
  });

  it("sees metadata rewritten at the same size within one timestamp tick", async () => {
    const root = await scratch();
    const dir = await changeset(root, "one", "id: one\nstatus: staged\n");
    const file = path.join(dir, "metadata.yaml");
    const when = new Date("2026-11-25T10:00:00Z");
    await utimes(file, when, when);
    const before = await changesetFilesStamp(dir);
    await writeFile(file, "id: one\nstatus: landed\n");
    await utimes(file, when, when);
    expect(await changesetFilesStamp(dir)).not.toBe(before);
  });
});
