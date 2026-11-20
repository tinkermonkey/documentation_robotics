/**
 * `dr changeset commit` when the base overlaps what the changeset stages.
 *
 * Drift never refuses a landing by itself, but someone has to have read what landing will do.
 * Through MCP and the viewer a person reads the overlaps before confirming. On the CLI:
 * - with a terminal, the overlaps are listed and the person is asked;
 * - with no terminal (a script, CI) and a real overlap, it is refused with a non-zero exit, the
 *   overlaps listed, unless `--force` is passed;
 * - with no terminal and no overlap (the base changed elsewhere), it lands and exits 0.
 * So `--force` keeps one meaning on the CLI. On `changeset_commit` and the viewer API it is ignored.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { runDr } from "../helpers/cli-runner.js";
import { Model } from "../../src/core/model.js";
import { StagingAreaManager } from "../../src/core/staging-area.js";
import { landsOverOverlaps, overlapDecision, overlapReport } from "../../src/commands/changeset.js";
import type { StagedChange } from "../../src/core/changeset.js";

const OPERATION = "api.operation.guard-test-operation";
const ADD = [
  "add",
  "api",
  "operation",
  "Guard Test Operation",
  "--attributes",
  '{"operationId":"guardTestOperation","summary":"Guard test","tags":"guard"}',
];

let dir: string;
let cleanup: () => Promise<void>;

async function fresh(): Promise<{ model: Model; manager: StagingAreaManager }> {
  const model = await Model.load(dir, { lazyLoad: false });
  return { model, manager: new StagingAreaManager(dir, model) };
}

/** The operation in the base as it is now. */
async function inBase(): Promise<Record<string, unknown>> {
  const { model } = await fresh();
  return (await model.getBaseLayer("api"))!.getElement(OPERATION)!.toJSON() as unknown as Record<string, unknown>;
}

/** A staged update of the operation's description, made on the base as it is now. */
async function reword(description: string): Promise<Omit<StagedChange, "sequenceNumber">> {
  const before = await inBase();
  return { type: "update", elementId: OPERATION, layerName: "api", before, after: { ...before, description } };
}

/** Creates a changeset (never activated) staging these changes; returns its id. */
async function plan(name: string, changes: Array<Omit<StagedChange, "sequenceNumber">>): Promise<string> {
  const { manager } = await fresh();
  const id = (await manager.create(name)).id!;
  for (const change of changes) await manager.stage(id, change);
  return id;
}

/** Lands a changeset in-process: the setup's own landings are not what is under test. */
async function land(id: string): Promise<void> {
  const { model, manager } = await fresh();
  expect((await manager.commit(model, id, { validate: false })).failed).toBe(0);
}

async function status(id: string): Promise<string> {
  return (await (await fresh()).manager.load(id))!.status;
}

beforeEach(async () => {
  const workdir = await createTestWorkdir();
  dir = workdir.path;
  cleanup = workdir.cleanup;
  // The operation every plan below is staged against, in the base.
  expect((await runDr(ADD, { cwd: dir })).exitCode).toBe(0);
});

afterEach(async () => {
  await cleanup().catch(() => {});
});

describe("dr changeset commit with no terminal attached", () => {
  /** A plan that rewords the operation, and a base that reworded it afterwards. */
  async function overlappingPlan(): Promise<string> {
    const id = await plan("reword-operation", [await reword("The plan's wording")]);
    await land(await plan("other-reword", [await reword("The base's wording")]));
    return id;
  }

  it("refuses a real overlap with a non-zero exit, lists it, and says --force lands it", async () => {
    const id = await overlappingPlan();
    const result = await runDr(["changeset", "commit", "reword-operation"], { cwd: dir });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.exitCode).toBe(1);
    expect(output).toContain("was not committed");
    expect(output).toContain("The base model overlaps 1 staged change(s)");
    expect(output).toContain("nothing was written");
    expect(output).toContain("changed-in-base, 1 element(s)");
    expect(output).toContain("landing replaces the base's edit with the plan's version");
    expect(output).toContain(OPERATION);
    expect(output).toContain("--force");
    expect(await status(id)).toBe("staged");
    expect((await inBase()).description).toBe("The base's wording");
  });

  it("lands it with --force, and says what it landed over", async () => {
    const id = await overlappingPlan();
    const result = await runDr(["changeset", "commit", "reword-operation", "--force"], { cwd: dir });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("the base model overlapped 1 staged change(s)");
    expect(output).toContain(`${OPERATION} (changed-in-base)`);
    expect(await status(id)).toBe("committed");
    expect((await inBase()).description).toBe("The plan's wording");
  });

  it("refuses in JSON output too, with the overlaps in the message", async () => {
    await overlappingPlan();
    const result = await runDr(["--json", "changeset", "commit", "reword-operation"], { cwd: dir });
    expect(result.exitCode).toBe(1);
    const error = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
    expect(error.status).toBe("error");
    expect(error.message).toContain("The base model overlaps 1 staged change(s)");
    expect(error.message).toContain(OPERATION);
  });

  it("lands with no --force when the base changed elsewhere (no overlap), and exits 0", async () => {
    const added = {
      id: randomUUID(),
      path: "api.operation.unrelated-operation",
      spec_node_id: "api.operation",
      type: "operation",
      layer_id: "api",
      name: "Unrelated Operation",
      attributes: { operationId: "unrelatedOperation", summary: "Unrelated", tags: "guard" },
    };
    const id = await plan("add-unrelated", [{ type: "add", elementId: added.path, layerName: "api", after: added }]);
    await land(await plan("other-reword", [await reword("The base's wording")]));
    expect((await (await fresh()).manager.detectDrift(id)).contentFree).toBe(true);

    const result = await runDr(["changeset", "commit", "add-unrelated"], { cwd: dir });
    expect(result.exitCode).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("was not committed");
    // It lands with a warning: the base moved, and nothing it stages was found to overlap.
    expect(`${result.stdout}\n${result.stderr}`).toContain("The base model changed since this changeset was created");
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("Drift Overlaps");
    expect(await status(id)).toBe("committed");
  });

  it("lands with no --force when the base has not moved", async () => {
    const id = await plan("reword-operation", [await reword("The plan's wording")]);
    const result = await runDr(["changeset", "commit", "reword-operation"], { cwd: dir });
    expect(result.exitCode).toBe(0);
    expect(await status(id)).toBe("committed");
  });
});

describe("the CLI's decision about overlaps", () => {
  it("lands with none, asks at a terminal, refuses with none attached, and lands with --force", () => {
    expect(overlapDecision(0, { interactive: false })).toBe("land");
    expect(overlapDecision(0, { interactive: true })).toBe("land");
    expect(overlapDecision(3, { interactive: true })).toBe("ask");
    expect(overlapDecision(3, { interactive: false })).toBe("refuse");
    expect(overlapDecision(3, { interactive: false, force: true })).toBe("land");
    expect(overlapDecision(3, { interactive: true, force: true })).toBe("land");
  });

  it("at a terminal, lists the overlaps and lands only on a yes", async () => {
    const id = await plan("reword-operation", [await reword("The plan's wording")]);
    await land(await plan("other-reword", [await reword("The base's wording")]));
    const { manager } = await fresh();
    const changeset = (await manager.load(id))!;

    const asked: string[] = [];
    const answer = (yes: boolean) => async (message: string) => {
      asked.push(message);
      return yes;
    };
    expect(await landsOverOverlaps(manager, changeset, { interactive: true, confirm: answer(false) })).toBe(false);
    expect(await landsOverOverlaps(manager, changeset, { interactive: true, confirm: answer(true) })).toBe(true);
    expect(asked).toEqual([
      "Land changeset 'reword-operation' over this overlap?",
      "Land changeset 'reword-operation' over this overlap?",
    ]);
    // With --force nobody is asked; with no terminal and no --force it is refused.
    expect(await landsOverOverlaps(manager, changeset, { interactive: true, force: true, confirm: answer(false) })).toBe(true);
    expect(asked).toHaveLength(2);
    await expect(landsOverOverlaps(manager, changeset, { interactive: false })).rejects.toThrow("was not committed");
  });

  it("the report gives the true count and names every overlap, however many", () => {
    const items = Array.from({ length: 40 }, (_, i) => `motivation.goal.goal-${i}`);
    const lines = overlapReport([
      { of: "element", reason: "changed-in-base", consequence: "Landing replaces it.", items },
      { of: "relationship", reason: "already-removed", consequence: "Nothing to remove.", items: ["a --serves--> b"] },
    ]);
    expect(lines[0]).toBe("The base model overlaps 41 staged change(s). Landing would do this:");
    expect(lines).toContain("  - changed-in-base, 40 element(s): Landing replaces it.");
    for (const item of items) expect(lines).toContain(`      ${item}`);
    expect(lines).toContain("      a --serves--> b");
  });
});
