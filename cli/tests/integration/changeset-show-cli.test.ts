/**
 * dr changeset show <name> (#1219): the CLI reads any changeset by name, whatever its state or
 * purpose, and staged, diff and preview read the changeset they name instead of ignoring it. A
 * changeset's description is its intent, as markdown (#1210), given with --intent (#1433), and
 * printed with its line breaks.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { Model } from "../../src/core/model.js";
import { StagingAreaManager } from "../../src/core/staging-area.js";
import { runDr } from "../helpers/cli-runner.js";

const INTENT = [
  "Ship order exports.",
  "",
  "**In scope**",
  "- `motivation.goal.ship-exports`",
  "",
  "**Done when** the goal is in the model.",
].join("\n");

describe("dr changeset show and the changeset read commands", () => {
  let root: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const workdir = await createTestWorkdir();
    root = workdir.path;
    cleanup = workdir.cleanup;
  });

  afterEach(async () => {
    await cleanup().catch(() => undefined);
  });

  /** A staged plan that adds one goal, left inactive. */
  async function stagePlan(name: string, goal: string): Promise<string> {
    const model = await Model.load(root, { lazyLoad: false });
    const manager = new StagingAreaManager(root, model);
    const changeset = await manager.create(name, INTENT);
    await manager.stage(changeset.id!, {
      type: "add",
      elementId: `motivation.goal.${goal}`,
      layerName: "motivation",
      timestamp: new Date().toISOString(),
      after: {
        id: randomUUID(),
        spec_node_id: "motivation.goal",
        type: "goal",
        layer_id: "motivation",
        name: goal,
        attributes: { priority: "high" },
      },
    });
    return changeset.id!;
  }

  it("shows a staged changeset that isn't active, by name or id, with its markdown description and each change", async () => {
    const id = await stagePlan("ship-exports", "ship-exports");

    for (const named of ["ship-exports", id]) {
      const shown = await runDr(["changeset", "show", named], { cwd: root });
      expect(shown.exitCode).toBe(0);
      expect(shown.stdout).toContain("Changeset ship-exports");
      expect(shown.stdout).not.toContain("(active)");
      expect(shown.stdout).toContain("Status: staged | Purpose: plan");
      expect(shown.stdout).toContain("Actions: commit, discard");
      // As written, line by line
      expect(shown.stdout).toContain("  **In scope**\n  - `motivation.goal.ship-exports`\n");
      expect(shown.stdout).toContain("Changes (1)");
      expect(shown.stdout).toContain("+ #0 motivation.goal.ship-exports (goal)");
    }

    // --json returns what changeset_show with detail "summary" returns
    const json = await runDr(["--json", "changeset", "show", "ship-exports"], { cwd: root });
    expect(json.exitCode).toBe(0);
    const body = JSON.parse(json.stdout.trim().split("\n").filter((line) => line.startsWith("{")).at(-1)!);
    expect(body).toMatchObject({ name: "ship-exports", description: INTENT, status: "staged", active: false, purpose: "plan" });
    expect(body.totals.total).toBe(1);
    expect(body.changes[0]).toMatchObject({ operation: "add", elementId: "motivation.goal.ship-exports" });
  });

  it("shows an upgrade record, which can't be activated, and a committed changeset", async () => {
    const model = await Model.load(root, { lazyLoad: false });
    const manager = new StagingAreaManager(root, model);
    await manager.create("upgrade-drops-9.9.9", "The relationships a spec migration dropped.", { kind: "upgrade" }, {
      purpose: "upgrade-record",
    });
    const record = await runDr(["changeset", "show", "upgrade-drops-9.9.9"], { cwd: root });
    expect(record.exitCode).toBe(0);
    expect(record.stdout).toContain("Purpose: upgrade-record");
    expect(record.stdout).toContain("Actions: discard");

    await stagePlan("landed", "landed-goal");
    const commit = await runDr(["changeset", "commit", "landed", "--force"], { cwd: root });
    expect(commit.exitCode).toBe(0);
    const committed = await runDr(["changeset", "show", "landed"], { cwd: root });
    expect(committed.exitCode).toBe(0);
    expect(committed.stdout).toContain("Status: committed");
    expect(committed.stdout).toContain("Actions: none");
  });

  it("shows the active changeset when none is named, and fails for a name no changeset has", async () => {
    const none = await runDr(["changeset", "show"], { cwd: root });
    expect(none.exitCode).toBe(1);
    expect(none.stderr).toContain("No active changeset: name one");

    const id = await stagePlan("ship-exports", "ship-exports");
    const model = await Model.load(root, { lazyLoad: false });
    await new StagingAreaManager(root, model).setActive(id);
    const active = await runDr(["changeset", "show"], { cwd: root });
    expect(active.exitCode).toBe(0);
    expect(active.stdout).toContain("Changeset ship-exports (active)");

    const missing = await runDr(["changeset", "show", "no-such-plan"], { cwd: root });
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("Changeset 'no-such-plan' not found");
  });

  it("lists, diffs and previews the changeset staged, diff and preview name, not the active one", async () => {
    await stagePlan("ship-exports", "ship-exports");
    const otherId = await stagePlan("other-plan", "other-goal");
    const model = await Model.load(root, { lazyLoad: false });
    await new StagingAreaManager(root, model).setActive(otherId);

    const staged = await runDr(["changeset", "staged", "ship-exports"], { cwd: root });
    expect(staged.exitCode).toBe(0);
    expect(staged.stdout).toContain("motivation.goal.ship-exports");
    expect(staged.stdout).not.toContain("motivation.goal.other-goal");

    const diff = await runDr(["changeset", "diff", "ship-exports"], { cwd: root });
    expect(diff.exitCode).toBe(0);
    expect(diff.stdout).toContain("Changeset: ship-exports");

    const preview = await runDr(["changeset", "preview", "ship-exports"], { cwd: root });
    expect(preview.exitCode).toBe(0);
    expect(preview.stdout).toContain("Changeset: ship-exports");

    // Unnamed, they still read the active one
    const activeStaged = await runDr(["changeset", "staged"], { cwd: root });
    expect(activeStaged.stdout).toContain("motivation.goal.other-goal");

    const unknown = await runDr(["changeset", "staged", "no-such-plan"], { cwd: root });
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("Changeset 'no-such-plan' not found");
  });

  it("creates a changeset from a multi-line --intent, keeps it in metadata.yaml, and lists its first line", async () => {
    const created = await runDr(["changeset", "create", "ship-exports", "--intent", INTENT], { cwd: root });
    expect(created.exitCode).toBe(0);

    const model = await Model.load(root, { lazyLoad: false });
    const changeset = await new StagingAreaManager(root, model).load("ship-exports");
    expect(changeset?.description).toBe(INTENT);
    const metadata = await readFile(join(root, "documentation-robotics", "changesets", changeset!.id!, "metadata.yaml"), "utf-8");
    expect(metadata).toMatch(/^description: \|/m);

    const list = await runDr(["changeset", "list"], { cwd: root });
    expect(list.stdout).toContain("Ship order exports. …");
    expect(list.stdout).not.toContain("**In scope**");
    expect(list.stdout).toContain("dr changeset show <name> prints one in full");

    const both = await runDr(["changeset", "create", "two-names", "--intent", "One", "--description", "Other"], { cwd: root });
    expect(both.exitCode).toBe(1);
    expect(`${both.stdout}${both.stderr}`).toContain("--intent and --description name the same thing");
  });
});

describe("dr upgrade and the active-changeset marker left in its old place (#1273)", () => {
  let root: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const workdir = await createTestWorkdir();
    root = workdir.path;
    cleanup = workdir.cleanup;
  });

  afterEach(async () => {
    await cleanup().catch(() => undefined);
  });

  it("names it in the plan, removes it when run, and moves its changeset to .dr/", async () => {
    const legacy = join(root, "documentation-robotics", "changesets", ".active");
    const marker = join(root, ".dr", "active-changeset");
    await mkdir(join(root, "documentation-robotics", "changesets"), { recursive: true });
    await rm(marker, { force: true });
    await writeFile(legacy, "changeset-shared\n");

    const dryRun = await runDr(["upgrade", "--dry-run"], { cwd: root });
    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.stdout).toContain("Old active-changeset marker");
    expect(dryRun.stdout).toContain("remove    documentation-robotics/changesets/.active");
    expect(existsSync(legacy)).toBe(true);

    const run = await runDr(["upgrade", "--yes"], { cwd: root });
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("Removed documentation-robotics/changesets/.active");
    expect(run.stdout).toContain("Commit the deletion");
    expect(existsSync(legacy)).toBe(false);
    expect(await readFile(marker, "utf-8")).toBe("changeset-shared\n");
  });
});
