/**
 * Integration tests for #963: `dr delete` must remove every relationships.yaml row
 * that names the deleted element, whether the row stores the element's UUID `id` or
 * its dotted `path`, on the base-model path and on the changeset path (staged delete
 * applied at `dr changeset commit`), with and without --cascade.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { Model } from "../../src/core/model.js";
import { runDr } from "../helpers/cli-runner.js";

const TEMP = "application.applicationcomponent.temp-comp";
const OTHER = "application.applicationcomponent.other-comp";
const DEP = "application.applicationcomponent.dep-comp";

interface Row {
  source: string;
  target: string;
  predicate: string;
}

describe("dr delete removes relationships naming the element (#963)", () => {
  let TEST_DIR: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const workdir = await createTestWorkdir();
    TEST_DIR = workdir.path;
    cleanup = workdir.cleanup;
  });

  afterEach(async () => {
    try {
      await cleanup();
    } catch {
      // ignore
    }
  });

  const relationshipsPath = () =>
    join(TEST_DIR, "documentation-robotics", "model", "relationships.yaml");

  async function readRows(): Promise<Row[]> {
    const content = await readFile(relationshipsPath(), "utf-8");
    return (parseYaml(content) ?? []) as Row[];
  }

  async function addComponent(name: string): Promise<void> {
    const result = await runDr(
      ["add", "application", "component", name, "--description", "x", "--attributes", '{"type":"internal"}'],
      { cwd: TEST_DIR }
    );
    expect(result.exitCode).toBe(0);
  }

  async function uuidOf(path: string): Promise<string> {
    const model = await Model.load(TEST_DIR, { lazyLoad: false });
    const element = model.getElementById(path);
    expect(element).toBeDefined();
    return element!.id;
  }

  async function addRelationship(source: string, target: string): Promise<void> {
    const result = await runDr(
      ["relationship", "add", source, target, "--predicate", "uses"],
      { cwd: TEST_DIR }
    );
    expect(result.exitCode).toBe(0);
  }

  /** Two components with rows in every form: path->path, uuid->path, path->uuid */
  async function seedRowsInEveryForm(): Promise<string> {
    await addComponent("Temp Comp");
    await addComponent("Other Comp");
    const tempUuid = await uuidOf(TEMP);
    await addRelationship(TEMP, OTHER);
    await addRelationship(tempUuid, OTHER);
    await addRelationship(OTHER, tempUuid);
    const rows = await readRows();
    expect(rows).toHaveLength(3);
    return tempUuid;
  }

  function expectNoRowNaming(rows: Row[], ...ids: string[]): void {
    for (const row of rows) {
      for (const id of ids) {
        expect(row.source).not.toBe(id);
        expect(row.target).not.toBe(id);
      }
    }
  }

  describe("without an active changeset", () => {
    it("purges rows keyed by path and by UUID on `dr delete --force`", async () => {
      const tempUuid = await seedRowsInEveryForm();

      const result = await runDr(["delete", TEMP, "--force"], { cwd: TEST_DIR });
      expect(result.exitCode).toBe(0);

      const rows = await readRows();
      expectNoRowNaming(rows, TEMP, tempUuid);
      expect(rows).toHaveLength(0);
    });

    it("purges rows on `dr delete --force --cascade`", async () => {
      const tempUuid = await seedRowsInEveryForm();

      const result = await runDr(["delete", TEMP, "--force", "--cascade"], { cwd: TEST_DIR });
      expect(result.exitCode).toBe(0);

      const rows = await readRows();
      expectNoRowNaming(rows, TEMP, tempUuid);
      expect(rows).toHaveLength(0);
    });

    it("keeps rows that do not name the deleted element", async () => {
      await addComponent("Temp Comp");
      await addComponent("Other Comp");
      await addComponent("Dep Comp");
      await addRelationship(TEMP, OTHER);
      await addRelationship(DEP, OTHER);

      const result = await runDr(["delete", TEMP, "--force"], { cwd: TEST_DIR });
      expect(result.exitCode).toBe(0);

      const rows = await readRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].source).toBe(DEP);
      expect(rows[0].target).toBe(OTHER);
    });

    it("deletes the element when the delete is addressed by UUID", async () => {
      const tempUuid = await seedRowsInEveryForm();

      const result = await runDr(["delete", tempUuid, "--force"], { cwd: TEST_DIR });
      expect(result.exitCode).toBe(0);

      const rows = await readRows();
      expectNoRowNaming(rows, TEMP, tempUuid);
      expect(rows).toHaveLength(0);
    });

    it("purges rows of cascade-deleted dependents too", async () => {
      await addComponent("Temp Comp");
      await addComponent("Other Comp");
      await addComponent("Dep Comp");
      await addRelationship(DEP, OTHER);
      await addRelationship(DEP, TEMP);

      // Make dep-comp depend on temp-comp through an explicit reference so
      // --cascade removes it as a dependent.
      const file = join(TEST_DIR, "documentation-robotics", "model", "05_application", "application_component.yaml");
      const content = await readFile(file, "utf-8");
      const data = parseYaml(content) as Record<string, Record<string, unknown>>;
      data[DEP].references = [{ target: TEMP, type: "depends-on" }];
      const { stringify } = await import("yaml");
      await writeFile(file, stringify(data), "utf-8");

      const dryRun = await runDr(["delete", TEMP, "--force", "--cascade", "--dry-run"], { cwd: TEST_DIR });
      expect(dryRun.exitCode).toBe(0);
      expect(dryRun.stdout).toContain(DEP);

      const result = await runDr(["delete", TEMP, "--force", "--cascade"], { cwd: TEST_DIR });
      expect(result.exitCode).toBe(0);

      const model = await Model.load(TEST_DIR, { lazyLoad: false });
      expect(model.getElementById(DEP)).toBeUndefined();
      expect(model.getElementById(TEMP)).toBeUndefined();

      const rows = await readRows();
      expectNoRowNaming(rows, TEMP, DEP);
      expect(rows).toHaveLength(0);
    });
  });

  describe("inside an active changeset", () => {
    async function activateChangeset(): Promise<void> {
      expect((await runDr(["changeset", "create", "cs-delete"], { cwd: TEST_DIR })).exitCode).toBe(0);
      expect((await runDr(["changeset", "activate", "cs-delete"], { cwd: TEST_DIR })).exitCode).toBe(0);
    }

    it("stages relationship deletions with the element delete and applies them at commit", async () => {
      const tempUuid = await seedRowsInEveryForm();
      await activateChangeset();

      const del = await runDr(["delete", TEMP, "--force"], { cwd: TEST_DIR });
      expect(del.exitCode).toBe(0);
      expect(del.stdout).toContain("Staged deletion");

      // Base file is untouched until commit
      expect(await readRows()).toHaveLength(3);

      const staged = await runDr(["changeset", "staged", "--json"], { cwd: TEST_DIR });
      expect(staged.exitCode).toBe(0);
      expect(staged.stdout).toContain("relationship-delete");

      const commit = await runDr(["changeset", "commit"], { cwd: TEST_DIR });
      expect(commit.exitCode).toBe(0);

      const rows = await readRows();
      expectNoRowNaming(rows, TEMP, tempUuid);
      expect(rows).toHaveLength(0);

      const model = await Model.load(TEST_DIR, { lazyLoad: false });
      expect(model.getElementById(TEMP)).toBeUndefined();
    });

    it("applies the purge at commit for --cascade deletes", async () => {
      const tempUuid = await seedRowsInEveryForm();
      await activateChangeset();

      expect((await runDr(["delete", TEMP, "--force", "--cascade"], { cwd: TEST_DIR })).exitCode).toBe(0);
      const commit = await runDr(["changeset", "commit"], { cwd: TEST_DIR });
      expect(commit.exitCode).toBe(0);

      const rows = await readRows();
      expectNoRowNaming(rows, TEMP, tempUuid);
      expect(rows).toHaveLength(0);
    });

    it("commits when the element and its relationship were both created in the changeset", async () => {
      await activateChangeset();
      await addComponent("Temp Comp");
      await addComponent("Other Comp");
      await addRelationship(TEMP, OTHER);

      expect((await runDr(["delete", TEMP, "--force"], { cwd: TEST_DIR })).exitCode).toBe(0);

      // Before the fix this failed validation: "Relationship source element ... not found"
      const commit = await runDr(["changeset", "commit"], { cwd: TEST_DIR });
      expect(commit.exitCode).toBe(0);

      const rows = await readRows();
      expectNoRowNaming(rows, TEMP);
      expect(rows).toHaveLength(0);

      const model = await Model.load(TEST_DIR, { lazyLoad: false });
      expect(model.getElementById(TEMP)).toBeUndefined();
      expect(model.getElementById(OTHER)).toBeDefined();
    });

    it("purges at commit even when the staged delete carries no relationship-delete changes", async () => {
      // Simulates a changeset staged before relationship purging existed.
      const tempUuid = await seedRowsInEveryForm();
      await activateChangeset();
      expect((await runDr(["delete", TEMP, "--force"], { cwd: TEST_DIR })).exitCode).toBe(0);

      // Strip the staged relationship-delete changes, leaving only the element delete.
      const { StagedChangesetStorage } = await import("../../src/core/staged-changeset-storage.js");
      const { StagingAreaManager } = await import("../../src/core/staging-area.js");
      const model = await Model.load(TEST_DIR, { lazyLoad: false });
      const manager = new StagingAreaManager(TEST_DIR, model);
      const active = await manager.getActive();
      expect(active).not.toBeNull();
      const storage = new StagedChangesetStorage(TEST_DIR);
      const changeset = (await storage.load(active!.id))!;
      changeset.changes = changeset.changes.filter((c) => c.type === "delete") as typeof changeset.changes;
      await storage.save(changeset);

      const commit = await runDr(["changeset", "commit"], { cwd: TEST_DIR });
      expect(commit.exitCode).toBe(0);

      const rows = await readRows();
      expectNoRowNaming(rows, TEMP, tempUuid);
      expect(rows).toHaveLength(0);
    });
  });

  describe("dr relationship delete on a dangling row", () => {
    it("removes a row whose source element no longer exists", async () => {
      await addComponent("Other Comp");
      const ghost = "33333333-3333-4333-8333-333333333333";
      await writeFile(
        relationshipsPath(),
        [
          "# Intra-layer relationships",
          `- source: ${ghost}`,
          `  target: ${OTHER}`,
          "  predicate: uses",
          "  layer: application",
          "  category: structural",
          "",
        ].join("\n"),
        "utf-8"
      );

      const result = await runDr(["relationship", "delete", ghost, OTHER, "--force"], { cwd: TEST_DIR });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Deleted 1 relationship(s)");
      expect(await readRows()).toHaveLength(0);
    });

    it("removes a row whose target element no longer exists, by predicate", async () => {
      await addComponent("Other Comp");
      await writeFile(
        relationshipsPath(),
        [
          `- source: ${OTHER}`,
          "  target: ghost-target",
          "  predicate: uses",
          "  layer: application",
          `- source: ${OTHER}`,
          "  target: ghost-target",
          "  predicate: composes",
          "  layer: application",
          "",
        ].join("\n"),
        "utf-8"
      );

      const result = await runDr(
        ["relationship", "delete", OTHER, "ghost-target", "--predicate", "uses", "--force"],
        { cwd: TEST_DIR }
      );
      expect(result.exitCode).toBe(0);
      const rows = await readRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].predicate).toBe("composes");
    });

    it("still reports no match when no such row exists", async () => {
      await addComponent("Other Comp");
      const result = await runDr(["relationship", "delete", "ghost", OTHER, "--force"], { cwd: TEST_DIR });
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toContain("No matching relationships found");
    });

    it("matches a row stored by UUID when the user types the path", async () => {
      await addComponent("Temp Comp");
      await addComponent("Other Comp");
      const tempUuid = await uuidOf(TEMP);
      await addRelationship(tempUuid, OTHER);

      const result = await runDr(["relationship", "delete", TEMP, OTHER, "--force"], { cwd: TEST_DIR });
      expect(result.exitCode).toBe(0);
      expect(await readRows()).toHaveLength(0);
    });
  });
});
