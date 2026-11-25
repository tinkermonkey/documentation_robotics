/**
 * A checkout context reads its changesets again on every request that lists them, and a
 * checkout's changesets run to megabytes of YAML (#1436): only those whose files changed are
 * parsed again.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";
import { CheckoutContext } from "../../../src/server/checkout-context.js";

const scratchDirs: string[] = [];
afterAll(async () => {
  await Promise.all(scratchDirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe("CheckoutContext.loadChangesets", () => {
  it("keeps an unchanged changeset as read, and reads a changed, new or removed one again", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dr-context-changesets-"));
    scratchDirs.push(root);
    const model = await Model.init(root, { name: "ctx", version: "1.0.0", specVersion: "0.15.0" });
    const storage = new StagedChangesetStorage(root);
    await storage.create("plan-a", "plan-a", "first", "sha256:base");
    await storage.create("plan-b", "plan-b", "second", "sha256:base");

    const context = new CheckoutContext({ project: "p", checkout: "main" }, model);
    await context.loadChangesets();
    const a = context.changesets.get("plan-a");
    const b = context.changesets.get("plan-b");
    expect(a?.description).toBe("first");
    expect(b).toBeDefined();

    await context.loadChangesets();
    expect(context.changesets.get("plan-a")).toBe(a);
    expect(context.changesets.get("plan-b")).toBe(b);

    // Rewritten on disk: read again. (The write may land in the same millisecond, so it also changes the size.)
    const changed = (await storage.load("plan-a"))!;
    changed.description = "first, revised";
    await storage.save(changed);
    await storage.create("plan-c", "plan-c", "third", "sha256:base");
    await storage.delete("plan-b");
    await context.loadChangesets();
    expect(context.changesets.get("plan-a")).not.toBe(a);
    expect(context.changesets.get("plan-a")?.description).toBe("first, revised");
    expect(context.changesets.has("plan-b")).toBe(false);
    expect(context.changesets.get("plan-c")?.description).toBe("third");
  });
});
