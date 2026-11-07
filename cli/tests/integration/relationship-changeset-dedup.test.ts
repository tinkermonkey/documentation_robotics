/**
 * Integration tests: `dr relationship add|delete` inside an active changeset read the changeset's
 * projected graph (base plus staged relationships), the same way the MCP relationship tools do.
 *
 * - Adding a relationship already staged, or already in the base model, is reported as a
 *   duplicate and stages nothing.
 * - Re-adding a relationship the changeset staged for deletion unstages the deletion.
 * - Deleting a relationship the changeset added unstages the add.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { Model } from "../../src/core/model.js";
import { StagingAreaManager } from "../../src/core/staging-area.js";
import { runDr } from "../helpers/cli-runner.js";

const A = "application.applicationcomponent.dedup-a";
const B = "application.applicationcomponent.dedup-b";
const C = "application.applicationcomponent.dedup-c";

describe("dr relationship add/delete in a changeset", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const workdir = await createTestWorkdir();
    dir = workdir.path;
    cleanup = workdir.cleanup;

    for (const name of ["Dedup A", "Dedup B", "Dedup C"]) {
      const result = await runDr(
        ["add", "application", "component", name, "--description", "x", "--attributes", '{"type":"internal"}'],
        { cwd: dir }
      );
      expect(result.exitCode).toBe(0);
    }
    // A base relationship, committed before the changeset exists.
    expect((await dr("relationship", "add", A, B, "--predicate", "uses")).exitCode).toBe(0);
    expect((await dr("changeset", "create", "dedup-plan")).exitCode).toBe(0);
  });

  afterEach(async () => {
    await cleanup().catch(() => {});
  });

  function dr(...args: string[]) {
    return runDr(args, { cwd: dir });
  }

  /** The active changeset's relationship changes, as `type source predicate target`. */
  async function stagedRelationshipChanges(): Promise<string[]> {
    const model = await Model.load(dir, { lazyLoad: true });
    const changeset = await new StagingAreaManager(dir, model).getActive();
    expect(changeset).toBeTruthy();
    return changeset!.changes
      .filter((c) => c.type.startsWith("relationship-"))
      .map((c) => `${c.type} ${c.elementId.split("::").join(" ")}`);
  }

  it("stages a new relationship once and reports the repeat as a duplicate", async () => {
    const first = await dr("relationship", "add", B, C, "--predicate", "uses");
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("[staged]");

    const again = await dr("relationship", "add", B, C, "--predicate", "uses");
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain("already exists");

    expect(await stagedRelationshipChanges()).toEqual([`relationship-add ${B} uses ${C}`]);
  });

  it("reports a relationship already in the base model as a duplicate without staging it", async () => {
    const result = await dr("relationship", "add", A, B, "--predicate", "uses");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("already exists");
    expect(await stagedRelationshipChanges()).toEqual([]);
  });

  it("restores a relationship this changeset deletes by unstaging the deletion", async () => {
    expect((await dr("relationship", "delete", A, B, "--predicate", "uses", "--force")).exitCode).toBe(0);
    expect(await stagedRelationshipChanges()).toEqual([`relationship-delete ${A} uses ${B}`]);

    const readd = await dr("relationship", "add", A, B, "--predicate", "uses");
    expect(readd.exitCode).toBe(0);
    expect(readd.stdout).toContain("Restored relationship");
    expect(await stagedRelationshipChanges()).toEqual([]);
  });

  it("unstages a relationship this changeset added when it is deleted", async () => {
    expect((await dr("relationship", "add", B, C, "--predicate", "uses")).exitCode).toBe(0);
    const removed = await dr("relationship", "delete", B, C, "--predicate", "uses", "--force");
    expect(removed.exitCode).toBe(0);
    expect(await stagedRelationshipChanges()).toEqual([]);

    // And a delete of what is no longer there is an error, not a stacked change.
    const again = await dr("relationship", "delete", B, C, "--predicate", "uses", "--force");
    expect(again.exitCode).not.toBe(0);
    expect(await stagedRelationshipChanges()).toEqual([]);
  });

  it("does not stage a second deletion of a relationship already staged for deletion", async () => {
    expect((await dr("relationship", "delete", A, B, "--predicate", "uses", "--force")).exitCode).toBe(0);
    const again = await dr("relationship", "delete", A, B, "--predicate", "uses", "--force");
    expect(again.exitCode).not.toBe(0);
    expect(await stagedRelationshipChanges()).toEqual([`relationship-delete ${A} uses ${B}`]);
  });
});
