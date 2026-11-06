/**
 * Regression tests: commit judges the change, not the base model.
 *
 * Dogfooding on heimdall (67 base validation errors from relationships the catalog
 * has since retired), `dr changeset commit --force` failed on a changeset that only
 * updated an element's description, because that element carried a retired
 * relationship already in the base. `--no-validate` was rejected as an unknown
 * option although the help advertised `--validate`.
 *
 * Commit now validates the base and the projected model and blocks only on errors
 * the changeset introduces; it reports how many pre-existing errors it ignored.
 * `--no-validate` skips validation.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../src/core/model.js";
import { StagingAreaManager } from "../../src/core/staging-area.js";
import { ChangesetValidator } from "../../src/core/changeset-validator.js";
import { Validator } from "../../src/validators/validator.js";
import { clearModelCache } from "../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../src/mcp/tools/model-add.js";
import { runDr } from "../helpers/cli-runner.js";
import { VisualizationServer } from "../../src/server/server.js";

const SERVICE = "application.applicationservice.checkout";
const GOAL = "motivation.goal.faster-checkout";

let rootPath: string;

function ok(result: any): any {
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}

/** A service carrying a relationship the catalog does not allow: a pre-existing error. */
async function setUpModelWithPreExistingError(): Promise<number> {
  await Model.init(rootPath, { name: "Pre-existing Errors Test Model", version: "0.1.0" });
  ok(
    await modelAddHandler({
      layer: "application",
      type: "applicationservice",
      name: "checkout",
      attributes: { serviceType: "synchronous" },
      rootPath,
    })
  );
  ok(await modelAddHandler({ layer: "motivation", type: "goal", name: "faster-checkout", attributes: { priority: "high" }, rootPath }));
  clearModelCache();

  const model = await Model.load(rootPath, { lazyLoad: false });
  model.relationships.add({ source: SERVICE, target: GOAL, predicate: "aggregates", layer: "application", category: "structural" });
  await model.saveRelationships();

  const reloaded = await Model.load(rootPath, { lazyLoad: false });
  const baseErrors = (await new Validator().validateModel(reloaded)).errors;
  // The fixture is only meaningful if the base model really is invalid at the service.
  expect(baseErrors.some((e) => e.message.includes("aggregates"))).toBe(true);
  return baseErrors.length;
}

async function stageDescriptionUpdate(): Promise<{ model: Model; manager: StagingAreaManager; id: string }> {
  const model = await Model.load(rootPath, { lazyLoad: false });
  const manager = new StagingAreaManager(rootPath, model);
  const changeset = await manager.create("describe-checkout", "Description only");
  await manager.setActive(changeset.id!);
  const service = model.getElementById(SERVICE)!;
  const before = service.toJSON() as unknown as Record<string, unknown>;
  await manager.stage(changeset.id!, {
    type: "update",
    elementId: SERVICE,
    layerName: "application",
    before,
    after: { ...before, description: "Checkout, rewritten" },
    timestamp: new Date().toISOString(),
  });
  return { model, manager, id: changeset.id! };
}

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-commit-preexisting-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("changeset commit with pre-existing validation errors", () => {
  it("commits a description-only update to an element that already carries an invalid relationship", async () => {
    const baseErrorCount = await setUpModelWithPreExistingError();
    const { model, manager, id } = await stageDescriptionUpdate();

    const result = await manager.commit(model, id, { force: true });
    expect(result.committed).toBe(1);
    expect(result.validation.passed).toBe(true);
    expect(result.validation.preExistingErrors).toBe(baseErrorCount);
    expect(result.validation.preExistingSample?.some((m) => m.includes("aggregates"))).toBe(true);

    const reloaded = await Model.load(rootPath, { lazyLoad: false });
    expect(reloaded.getElementById(SERVICE)?.description).toBe("Checkout, rewritten");
  });

  it("still blocks an error the changeset introduces, and says how many pre-existing ones it ignored", async () => {
    const baseErrorCount = await setUpModelWithPreExistingError();
    const { model, manager, id } = await stageDescriptionUpdate();
    // A second disallowed relationship, staged by the changeset: a new error.
    await manager.stage(id, {
      type: "relationship-add",
      elementId: `${GOAL}::aggregates::${SERVICE}`,
      layerName: "motivation",
      after: { source: GOAL, target: SERVICE, predicate: "aggregates", layer: "motivation" },
      timestamp: new Date().toISOString(),
    });

    const report = await new ChangesetValidator(rootPath).validateChangesetReport(model, id);
    expect(report.preExistingErrors.length).toBe(baseErrorCount);
    expect(report.result.errors.length).toBeGreaterThan(0);
    expect(report.result.errors.every((e) => !e.message.startsWith("(pre-existing)"))).toBe(true);

    let message = "";
    try {
      await manager.commit(model, id, { force: true });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("introduced by this changeset");
    expect(message).toContain(`${baseErrorCount} pre-existing error(s)`);
    expect(message).toContain("--no-validate");
    const reloaded = await Model.load(rootPath, { lazyLoad: false });
    expect(reloaded.getElementById(SERVICE)?.description).toBeFalsy();
  });

  it("the viewer's commit endpoint applies the same rule and returns the ignored count", async () => {
    const baseErrorCount = await setUpModelWithPreExistingError();
    const { id } = await stageDescriptionUpdate();

    const model = await Model.load(rootPath, { lazyLoad: false });
    const server = new VisualizationServer(model, { authEnabled: false });
    const res: Response = await (server as any).app.request(`/api/changesets/${id}/commit`, { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, status: "committed", committed: 1, preExistingErrors: baseErrorCount });
  });

  it("dr changeset commit reports the ignored count, and --no-validate is accepted", async () => {
    const baseErrorCount = await setUpModelWithPreExistingError();
    await stageDescriptionUpdate();

    const committed = await runDr(["changeset", "commit", "--force"], { cwd: rootPath });
    expect(committed.exitCode).toBe(0);
    expect(committed.stdout).toContain(`${baseErrorCount} validation error(s) already in the base model were ignored`);

    clearModelCache();
    const model = await Model.load(rootPath, { lazyLoad: false });
    const manager = new StagingAreaManager(rootPath, model);
    const changeset = await manager.create("second", "Skip validation");
    await manager.setActive(changeset.id!);
    const service = model.getElementById(SERVICE)!;
    const before = service.toJSON() as unknown as Record<string, unknown>;
    await manager.stage(changeset.id!, {
      type: "update",
      elementId: SERVICE,
      layerName: "application",
      before,
      after: { ...before, description: "Checkout, again" },
      timestamp: new Date().toISOString(),
    });

    const skipped = await runDr(["changeset", "commit", "--no-validate", "--force"], { cwd: rootPath });
    expect(skipped.stderr).not.toContain("unknown option");
    expect(skipped.exitCode).toBe(0);
    expect(skipped.stdout).toContain("Validation skipped");

    const help = await runDr(["changeset", "commit", "--help"], { cwd: rootPath });
    expect(help.stdout).toContain("--no-validate");
  });
});
