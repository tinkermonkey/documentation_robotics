/**
 * Integration tests for `dr relationship prune` (#964).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { Model } from "../../src/core/model.js";
import { runDr } from "../helpers/cli-runner.js";

const ALPHA = "application.applicationcomponent.alpha";
const BETA = "application.applicationcomponent.beta";
const GHOST_UUID = "44444444-4444-4444-8444-444444444444";

interface Row {
  source: string;
  target: string;
  predicate: string;
  layer: string;
  targetLayer?: string;
}

const HEADER = "# Custom relationships header\n# Last updated: 2020-01-01T00:00:00.000Z\n";

describe("dr relationship prune (#964)", () => {
  let TEST_DIR: string;
  let cleanup: () => Promise<void>;
  let alphaUuid: string;

  beforeEach(async () => {
    const workdir = await createTestWorkdir();
    TEST_DIR = workdir.path;
    cleanup = workdir.cleanup;

    for (const name of ["Alpha", "Beta"]) {
      const result = await runDr(
        ["add", "application", "component", name, "--description", "x", "--attributes", '{"type":"internal"}'],
        { cwd: TEST_DIR }
      );
      expect(result.exitCode).toBe(0);
    }
    const model = await Model.load(TEST_DIR, { lazyLoad: false });
    alphaUuid = model.getElementById(ALPHA)!.id;
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
    return (parseYaml(await readFile(relationshipsPath(), "utf-8")) ?? []) as Row[];
  }

  function row(source: string, target: string, layer = "application", targetLayer?: string): Row {
    return { source, target, predicate: "uses", layer, ...(targetLayer ? { targetLayer } : {}) };
  }

  async function writeRows(rows: Row[]): Promise<void> {
    const { stringify } = await import("yaml");
    await writeFile(relationshipsPath(), HEADER + "\n" + stringify(rows), "utf-8");
  }

  /** Mixed file: rows 0, 2 and 4 are valid (path, UUID and mixed forms); 1, 3 and 5 are dangling */
  function seedRows(): Row[] {
    return [
      row(ALPHA, BETA),
      row(GHOST_UUID, BETA),
      row(alphaUuid, BETA),
      row(ALPHA, "application.applicationcomponent.deleted", "application"),
      row(BETA, alphaUuid),
      row("api.operation.gone", ALPHA, "api", "application"),
    ];
  }

  it("--dry-run lists dangling rows with the unresolved side and writes nothing", async () => {
    const rows = seedRows();
    await writeRows(rows);
    const before = await readFile(relationshipsPath(), "utf-8");

    const result = await runDr(["relationship", "prune", "--dry-run"], { cwd: TEST_DIR });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Scanned 6 relationship(s): 3 dangling");
    expect(result.stdout).toContain(`${GHOST_UUID} --[uses]--> ${BETA} (source not found)`);
    expect(result.stdout).toContain("application.applicationcomponent.deleted (target not found)");
    expect(result.stdout).toContain("would remove 3");

    expect(await readFile(relationshipsPath(), "utf-8")).toBe(before);
  });

  it("removes only dangling rows, preserving order and the header comment", async () => {
    const rows = seedRows();
    await writeRows(rows);

    const result = await runDr(["relationship", "prune"], { cwd: TEST_DIR });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Removed 3 dangling relationship(s)");

    const after = await readRows();
    expect(after.map((r) => [r.source, r.target])).toEqual([
      [ALPHA, BETA],
      [alphaUuid, BETA],
      [BETA, alphaUuid],
    ]);

    const content = await readFile(relationshipsPath(), "utf-8");
    expect(content.startsWith("# Custom relationships header\n# Last updated: ")).toBe(true);
    expect(content).not.toContain("2020-01-01T00:00:00.000Z");
  });

  it("does not flag rows that resolve by UUID or by path (no false positives)", async () => {
    await writeRows([row(ALPHA, BETA), row(alphaUuid, BETA), row(BETA, alphaUuid)]);

    const result = await runDr(["relationship", "prune"], { cwd: TEST_DIR });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No dangling relationships found");
    expect(await readRows()).toHaveLength(3);
  });

  it("--format json reports counts and the dangling rows", async () => {
    await writeRows(seedRows());

    const result = await runDr(["relationship", "prune", "--format", "json"], { cwd: TEST_DIR });
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.status).toBe("ok");
    expect(json.scanned).toBe(6);
    expect(json.dangling).toBe(3);
    expect(json.removed).toBe(3);
    expect(json.dryRun).toBe(false);
    expect(json.staged).toBe(false);
    expect(json.relationships).toHaveLength(3);
    expect(json.relationships[0]).toEqual({
      source: GHOST_UUID,
      predicate: "uses",
      target: BETA,
      layer: "application",
      unresolved: "source",
    });
    expect(json.relationships[2].unresolved).toBe("source");
    expect(json.relationships[2].targetLayer).toBe("application");
    expect(await readRows()).toHaveLength(3);
  });

  it("--layers restricts the scan to rows whose source or target layer matches", async () => {
    await writeRows(seedRows());

    const result = await runDr(["relationship", "prune", "--layers", "api", "--format", "json"], { cwd: TEST_DIR });
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.layers).toEqual(["api"]);
    expect(json.scanned).toBe(1);
    expect(json.removed).toBe(1);
    expect(json.relationships[0].source).toBe("api.operation.gone");

    // The two application-layer dangling rows are untouched
    const after = await readRows();
    expect(after).toHaveLength(5);
    expect(after.some((r) => r.source === GHOST_UUID)).toBe(true);
  });

  it("rejects an invalid layer name", async () => {
    await writeRows(seedRows());
    const result = await runDr(["relationship", "prune", "--layers", "bogus"], { cwd: TEST_DIR });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("Invalid layer name(s): bogus");
    expect(await readRows()).toHaveLength(6);
  });

  it("rejects an unknown --format", async () => {
    const result = await runDr(["relationship", "prune", "--format", "xml"], { cwd: TEST_DIR });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("Invalid format: xml");
  });

  it("exits 0 when there is nothing to prune", async () => {
    await writeRows([]);
    const result = await runDr(["relationship", "prune"], { cwd: TEST_DIR });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No dangling relationships found");
  });

  it("stages the removals inside an active changeset and applies them at commit", async () => {
    await writeRows(seedRows());
    expect((await runDr(["changeset", "create", "cs-prune"], { cwd: TEST_DIR })).exitCode).toBe(0);
    expect((await runDr(["changeset", "activate", "cs-prune"], { cwd: TEST_DIR })).exitCode).toBe(0);

    const result = await runDr(["relationship", "prune"], { cwd: TEST_DIR });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Staged removal of 3 dangling relationship(s) to cs-prune");

    // File untouched until commit
    expect(await readRows()).toHaveLength(6);

    const staged = await runDr(["changeset", "staged", "--json"], { cwd: TEST_DIR });
    expect(staged.exitCode).toBe(0);
    expect(staged.stdout).toContain("relationship-delete");

    const commit = await runDr(["changeset", "commit"], { cwd: TEST_DIR });
    expect(commit.exitCode).toBe(0);

    const after = await readRows();
    expect(after).toHaveLength(3);
    expect(after.some((r) => r.source === GHOST_UUID)).toBe(false);
  });

  it("treats elements staged in the active changeset as present", async () => {
    expect((await runDr(["changeset", "create", "cs-staged"], { cwd: TEST_DIR })).exitCode).toBe(0);
    expect((await runDr(["changeset", "activate", "cs-staged"], { cwd: TEST_DIR })).exitCode).toBe(0);
    const added = await runDr(
      ["add", "application", "component", "Gamma", "--description", "x", "--attributes", '{"type":"internal"}'],
      { cwd: TEST_DIR }
    );
    expect(added.exitCode).toBe(0);
    await writeRows([row("application.applicationcomponent.gamma", ALPHA)]);

    const result = await runDr(["relationship", "prune", "--dry-run", "--format", "json"], { cwd: TEST_DIR });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).dangling).toBe(0);
  });
});
