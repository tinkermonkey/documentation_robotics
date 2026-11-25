/**
 * End to end through the CLI (#1437): after `dr changeset commit` lands the active changeset, a
 * later `dr add` or `dr relationship add` is refused, naming the changeset, instead of writing the
 * base model; `dr changeset status` says why, and `dr changeset deactivate` lets writes go to the
 * base model again.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { runDr } from "../helpers/cli-runner.js";
import { Model } from "../../src/core/model.js";

let dir: string;
let home: string;
let cleanup: () => Promise<void>;

/** Every dr run gets a scratch home, so nothing touches the real farm (#1369, #1438). */
const dr = (args: string[]) => runDr(args, { cwd: dir, env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") } });
const goal = (name: string) => ["add", "motivation", "goal", name, "--attributes", '{"priority":"high"}'];

async function baseGoals(): Promise<string[]> {
  const model = await Model.load(dir, { lazyLoad: false });
  return ((await model.getBaseLayer("motivation"))?.listElements() ?? []).map((e) => e.path ?? e.id);
}

beforeEach(async () => {
  const workdir = await createTestWorkdir();
  dir = workdir.path;
  cleanup = workdir.cleanup;
  home = await mkdtemp(join(tmpdir(), "dr-landed-writes-home-"));
});

afterEach(async () => {
  await cleanup().catch(() => {});
  await rm(home, { recursive: true, force: true });
});

describe("writes after the active changeset is landed (#1437)", () => {
  it("are refused naming the changeset until the checkout deactivates", async () => {
    expect((await dr(["changeset", "create", "wire-tests"])).exitCode).toBe(0);
    expect((await dr(goal("landed-goal"))).exitCode).toBe(0);
    expect((await dr(goal("other-goal"))).exitCode).toBe(0);
    const landed = await dr(["changeset", "commit", "wire-tests", "--force"]);
    expect(landed.exitCode).toBe(0);

    const refused = await dr(goal("after-goal"));
    expect(refused.exitCode).not.toBe(0);
    expect(`${refused.stdout}\n${refused.stderr}`).toContain("Changeset 'wire-tests' was landed");
    const relationship = await dr([
      "relationship",
      "add",
      "motivation.goal.landed-goal",
      "motivation.goal.other-goal",
      "--predicate",
      "aggregates",
    ]);
    expect(relationship.exitCode).not.toBe(0);
    expect(`${relationship.stdout}\n${relationship.stderr}`).toContain("Changeset 'wire-tests' was landed");
    expect(await baseGoals()).toContain("motivation.goal.landed-goal");
    expect(await baseGoals()).not.toContain("motivation.goal.after-goal");

    const status = await dr(["changeset", "status"]);
    expect(status.stdout).toContain("'wire-tests' was landed");

    const deactivated = await dr(["changeset", "deactivate"]);
    expect(deactivated.exitCode).toBe(0);
    expect(`${deactivated.stdout}\n${deactivated.stderr}`).toContain("writes go to the base model now");
    expect((await dr(goal("after-goal"))).exitCode).toBe(0);
    expect(await baseGoals()).toContain("motivation.goal.after-goal");
  }, 120_000);
});
