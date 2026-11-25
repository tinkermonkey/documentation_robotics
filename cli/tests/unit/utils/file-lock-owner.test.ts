/**
 * FileLock's owner, heartbeat and refusal (#1437): a holder records why it holds the lock, a long
 * hold stays fresh so no waiter takes it for a crashed process's lock, and a waiter can refuse at
 * once when the holder says so (a landing) instead of waiting it out.
 */

import { describe, it, expect } from "bun:test";
import { mkdtemp, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileLock } from "../../../src/utils/file-lock.js";

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "file-lock-owner-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("FileLock owner, heartbeat and refusal", () => {
  it("records its owner while held and forgets it when released", async () => {
    await withDir(async (dir) => {
      const resource = path.join(dir, "changeset");
      const lock = new FileLock(resource);
      await lock.acquire({ owner: { purpose: "landing", changeset: "plan" } });
      const owner = await FileLock.readOwner(resource);
      expect(owner?.purpose).toBe("landing");
      expect(owner?.changeset).toBe("plan");
      expect(owner?.pid).toBe(process.pid);
      expect(typeof owner?.since).toBe("string");
      await lock.release();
      expect(await FileLock.readOwner(resource)).toBeNull();
    });
  });

  it("refuses at once when the holder's owner says so", async () => {
    await withDir(async (dir) => {
      const resource = path.join(dir, "changeset");
      const holder = new FileLock(resource);
      await holder.acquire({ owner: { purpose: "landing" } });
      try {
        const started = Date.now();
        const error = await new FileLock(resource)
          .acquire({ refuseWhenHeldBy: (owner) => (owner?.purpose === "landing" ? new Error("being landed") : null) })
          .catch((e) => e);
        expect(error.message).toBe("being landed");
        expect(Date.now() - started).toBeLessThan(1000);
      } finally {
        await holder.release();
      }
    });
  });

  it("names the holder's purpose when a wait times out", async () => {
    await withDir(async (dir) => {
      const resource = path.join(dir, "changeset");
      const holder = new FileLock(resource);
      await holder.acquire({ owner: { purpose: "landing" } });
      try {
        const error = await new FileLock(resource).acquire({ timeout: 100 }).catch((e) => e);
        expect(error.message).toContain("It is held for landing");
      } finally {
        await holder.release();
      }
    });
  });

  it("keeps a long hold fresh, so a waiter never removes it as stale", async () => {
    await withDir(async (dir) => {
      const resource = path.join(dir, "changeset");
      const holder = new FileLock(resource);
      await holder.acquire({ heartbeat: 20, staleLockThreshold: 200 });
      try {
        // Age the lock past the stale threshold; the heartbeat freshens it again.
        const old = new Date(Date.now() - 10_000);
        await utimes(`${resource}.lock`, old, old);
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(Date.now() - (await stat(`${resource}.lock`)).mtime.getTime()).toBeLessThan(200);
        const waiter = await new FileLock(resource).acquire({ timeout: 100, staleLockThreshold: 200 }).catch((e) => e);
        expect(waiter).toBeInstanceOf(Error);
        expect(holder.isAcquired()).toBe(true);
      } finally {
        await holder.release();
      }
    });
  });
});
