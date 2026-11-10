/**
 * Round-2 friction: `dr changeset commit` rewrote documentation-robotics/README.md and the report
 * of every layer related to a changed layer, although their content had not changed (only the
 * footer's timestamp). A commit now regenerates the reports of the layers it changed, and no
 * report is rewritten when only its timestamp would change.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { changesetCreateHandler, changesetDeactivateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { modelDeleteHandler } from "../../../src/mcp/tools/model-delete.js";

function parse(result: any): any {
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}

let rootPath: string;

async function reports(): Promise<Record<string, string>> {
  const dir = join(rootPath, "documentation-robotics", "reports");
  const files: Record<string, string> = {};
  for (const name of (await readdir(dir)).sort()) {
    files[name] = await readFile(join(dir, name), "utf-8");
  }
  files["README.md"] = await readFile(join(rootPath, "documentation-robotics", "README.md"), "utf-8");
  return files;
}

function changedFiles(before: Record<string, string>, after: Record<string, string>): string[] {
  return Object.keys(after).filter((name) => before[name] !== after[name]).sort();
}

async function commitActive(name: string, force = false): Promise<void> {
  clearModelCache();
  const model = await Model.load(rootPath, { lazyLoad: false });
  const manager = new StagingAreaManager(rootPath, model);
  const changeset = (await manager.list()).find((c) => c.name === name)!;
  await manager.commit(model, changeset.id!, { validate: false, force });
  clearModelCache();
}

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-commit-report-scope-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Commit Report Scope", version: "0.1.0" });
  // An application service realizing a motivation goal: the application and motivation layers are related.
  parse(await modelAddHandler({ layer: "motivation", type: "goal", name: "faster-checkout", attributes: { priority: "high" }, rootPath }));
  parse(
    await modelAddHandler({
      layer: "application",
      type: "applicationservice",
      name: "checkout",
      attributes: { serviceType: "synchronous" },
      rootPath,
    })
  );
  parse(
    await relationshipAddHandler({
      source: "application.applicationservice.checkout",
      predicate: "realizes",
      target: "motivation.goal.faster-checkout",
      rootPath,
    })
  );
  clearModelCache();
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("changeset commit report regeneration", () => {
  it("rewrites only the changed layer's report and the README, not reports of related layers", async () => {
    const before = await reports();
    parse(await changesetCreateHandler({ name: "add-function", rootPath }));
    parse(await modelAddHandler({ layer: "application", type: "applicationfunction", name: "export-orders", rootPath }));
    await commitActive("add-function");

    const changed = changedFiles(before, await reports());
    expect(changed).toContain("05-application-layer-report.md");
    expect(changed).toContain("README.md");
    // The motivation layer is related to the application layer but nothing in it changed.
    expect(changed).toEqual(["05-application-layer-report.md", "README.md"]);
  });

  it("leaves the README alone when its content would not change", async () => {
    const before = await reports();
    parse(await changesetCreateHandler({ name: "describe-goal", rootPath }));
    parse(await modelUpdateHandler({ id: "motivation.goal.faster-checkout", description: "Checkout in one step", rootPath }));
    await commitActive("describe-goal");

    const changed = changedFiles(before, await reports());
    expect(changed).not.toContain("README.md");
    expect(changed).not.toContain("05-application-layer-report.md");
  });

  it("regenerates both ends' reports for a relationship change", async () => {
    parse(await modelAddHandler({ layer: "motivation", type: "goal", name: "fewer-refunds", attributes: { priority: "low" }, rootPath }));
    clearModelCache();
    const before = await reports();
    parse(await changesetCreateHandler({ name: "link", rootPath }));
    parse(
      await relationshipAddHandler({
        source: "application.applicationservice.checkout",
        predicate: "realizes",
        target: "motivation.goal.fewer-refunds",
        rootPath,
      })
    );
    await commitActive("link");

    const changed = changedFiles(before, await reports());
    expect(changed).toContain("01-motivation-layer-report.md");
    expect(changed).toContain("05-application-layer-report.md");
  });

  // PR 1065 review: the report layers were read after the changes applied, when an element
  // delete had already purged relationships with no staged relationship-delete.
  it("regenerates the other end's report when a delete purges a relationship that landed after it was staged", async () => {
    parse(await modelAddHandler({ layer: "motivation", type: "goal", name: "fewer-refunds", attributes: { priority: "low" }, rootPath }));
    parse(await changesetCreateHandler({ name: "drop-goal", rootPath }));
    parse(await modelDeleteHandler({ id: "motivation.goal.fewer-refunds", rootPath } as any));
    parse(await changesetDeactivateHandler({ rootPath }));
    // Someone else lands a relationship to the goal in the base: the changeset has no
    // relationship-delete for it, so the commit's delete purges it.
    parse(
      await relationshipAddHandler({
        source: "application.applicationservice.checkout",
        predicate: "realizes",
        target: "motivation.goal.fewer-refunds",
        rootPath,
      })
    );
    clearModelCache();
    const before = await reports();
    expect(before["05-application-layer-report.md"]).toContain("motivation.goal.fewer-refunds");

    await commitActive("drop-goal", true);

    const after = await reports();
    expect(changedFiles(before, after)).toContain("05-application-layer-report.md");
    expect(after["05-application-layer-report.md"]).not.toContain("motivation.goal.fewer-refunds");
  });
});
