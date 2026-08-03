/**
 * Each test creates its own root directory via withStore() rather than
 * beforeEach/afterEach, since `test`/`test:unit` run this file under
 * `bun test --concurrent` (every `it` runs concurrently) — a shared
 * describe-scoped `let rootPath`/`store` would race across tests.
 */

import { describe, it, expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import yaml from "yaml";
import { AnnotationStore } from "../../../src/core/annotation-store.js";

async function withStore(fn: (store: AnnotationStore, rootPath: string) => Promise<void>): Promise<void> {
  const rootPath = await mkdtemp(join(tmpdir(), "dr-annotation-store-"));
  try {
    await fn(new AnnotationStore(rootPath), rootPath);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
}

describe("AnnotationStore", () => {
  it("returns an empty list when no annotations exist yet", async () => {
    await withStore(async (store) => {
      expect(await store.list()).toEqual([]);
    });
  });

  it("creates an annotation with defaults for author and tags", async () => {
    await withStore(async (store) => {
      const annotation = await store.create({
        elementId: "api.endpoint.create-order",
        content: "Needs review",
      });

      expect(annotation.id).toMatch(/^ann-/);
      expect(annotation.author).toBe("Anonymous");
      expect(annotation.tags).toEqual([]);
      expect(annotation.resolved).toBe(false);
      expect(annotation.replies).toEqual([]);
    });
  });

  it("persists created annotations across store instances", async () => {
    await withStore(async (store, rootPath) => {
      const created = await store.create({
        elementId: "api.endpoint.create-order",
        content: "Needs review",
        author: "alice",
        tags: ["needs-review"],
      });

      const reloaded = await new AnnotationStore(rootPath).get(created.id);
      expect(reloaded).toEqual(created);
    });
  });

  it("lists annotations filtered by elementId", async () => {
    await withStore(async (store) => {
      await store.create({ elementId: "api.endpoint.create-order", content: "a" });
      const other = await store.create({ elementId: "api.endpoint.delete-order", content: "b" });

      const filtered = await store.list("api.endpoint.delete-order");
      expect(filtered.map((a) => a.id)).toEqual([other.id]);
    });
  });

  it("updates content, tags, and resolved independently", async () => {
    await withStore(async (store) => {
      const created = await store.create({ elementId: "api.endpoint.create-order", content: "original" });

      const updated = await store.update(created.id, { resolved: true });
      expect(updated?.content).toBe("original");
      expect(updated?.resolved).toBe(true);
      expect(updated?.updatedAt).toBeDefined();
    });
  });

  it("returns null when updating a nonexistent annotation", async () => {
    await withStore(async (store) => {
      expect(await store.update("does-not-exist", { resolved: true })).toBeNull();
    });
  });

  it("adds replies and returns null for a nonexistent annotation", async () => {
    await withStore(async (store) => {
      const created = await store.create({ elementId: "api.endpoint.create-order", content: "original" });

      const reply = await store.addReply(created.id, { author: "bob", content: "Fixed it" });
      expect(reply?.content).toBe("Fixed it");

      const withReply = await store.get(created.id);
      expect(withReply?.replies).toHaveLength(1);

      expect(await store.addReply("does-not-exist", { author: "bob", content: "x" })).toBeNull();
    });
  });

  it("deletes annotations and reports whether one existed", async () => {
    await withStore(async (store) => {
      const created = await store.create({ elementId: "api.endpoint.create-order", content: "original" });

      expect(await store.delete(created.id)).toBe(true);
      expect(await store.get(created.id)).toBeNull();
      expect(await store.delete(created.id)).toBe(false);
    });
  });

  it("sanitizes path-traversal characters out of IDs instead of escaping the annotations directory", async () => {
    await withStore(async (store) => {
      expect(await store.get("../../etc/passwd")).toBeNull();
    });
  });

  it("rejects an ID that sanitizes to an empty string", async () => {
    await withStore(async (store) => {
      await expect(store.get("..")).rejects.toThrow(/Invalid annotation ID/);
    });
  });

  it("rejects a hand-edited annotation file missing required fields (e.g. tags)", async () => {
    await withStore(async (store, rootPath) => {
      const annotationsDir = join(rootPath, "documentation-robotics", "annotations");
      await store.create({ elementId: "api.endpoint.create-order", content: "placeholder" });
      const filePath = join(annotationsDir, "corrupt.yaml");
      await writeFile(
        filePath,
        yaml.stringify({
          id: "corrupt",
          elementId: "api.endpoint.create-order",
          author: "alice",
          content: "missing tags field",
          createdAt: new Date().toISOString(),
          resolved: false,
          replies: [],
        })
      );

      await expect(store.get("corrupt")).rejects.toThrow(/invalid annotation data/);
    });
  });

  it("list() skips a corrupt annotation file instead of failing the whole list", async () => {
    await withStore(async (store, rootPath) => {
      const valid = await store.create({ elementId: "api.endpoint.create-order", content: "valid" });

      const annotationsDir = join(rootPath, "documentation-robotics", "annotations");
      await writeFile(
        join(annotationsDir, "corrupt.yaml"),
        yaml.stringify({
          id: "corrupt",
          elementId: "api.endpoint.create-order",
          author: "alice",
          content: "missing tags field",
          createdAt: new Date().toISOString(),
          resolved: false,
          replies: [],
        })
      );

      const results = await store.list();
      expect(results.map((a) => a.id)).toEqual([valid.id]);
    });
  });
});
