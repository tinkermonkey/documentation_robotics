/**
 * End to end through the dr CLI: a model is checked against the spec it declares (#1411), and
 * `dr upgrade` lays out model files an earlier dr wrote as a step of its own (#1439).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import yaml from "yaml";
import { createTempWorkdir, runDr, assertOutputContains } from "../helpers/cli-runner.js";

let tempDir: { path: string; cleanup: () => Promise<void> };

async function setModelSpecVersion(workdir: string, version: string): Promise<void> {
  const manifestPath = join(workdir, "documentation-robotics/model/manifest.yaml");
  const manifest = yaml.parse(await readFile(manifestPath, "utf-8"));
  manifest.spec_version = version;
  await writeFile(manifestPath, yaml.stringify(manifest));
}

const dr = (args: string[]) => runDr(args, { cwd: tempDir.path });

beforeEach(async () => {
  tempDir = await createTempWorkdir();
  expect((await dr(["init", "--name", "Declared Spec"])).exitCode).toBe(0);
});

afterEach(async () => {
  await tempDir.cleanup();
});

describe("a model on an older spec refuses what only a newer spec has (#1411)", () => {
  beforeEach(async () => {
    for (const args of [
      ["add", "application", "applicationservice", "proposal-service", "--attributes", '{"serviceType":"synchronous"}'],
      ["add", "application", "applicationcomponent", "proposal-repository", "--attributes", '{"type":"internal"}'],
      ["add", "data-model", "objectschema", "operation-draft", "--attributes", '{"type":"object"}'],
    ]) {
      expect((await dr(args)).exitCode).toBe(0);
    }
    await setModelSpecVersion(tempDir.path, "0.13.0");
  });

  it("dr relationship add refuses applicationservice accesses objectschema on a 0.13.0 model, naming both versions", async () => {
    const refused = await dr([
      "relationship",
      "add",
      "application.applicationservice.proposal-service",
      "data-model.objectschema.operation-draft",
      "--predicate",
      "accesses",
    ]);
    expect(refused.exitCode).not.toBe(0);
    assertOutputContains(refused, "is not in spec 0.13.0, the model's version; it exists from spec 0.14.0");

    // What 0.13.0 has is added as before
    const added = await dr([
      "relationship",
      "add",
      "application.applicationcomponent.proposal-repository",
      "data-model.objectschema.operation-draft",
      "--predicate",
      "accesses",
    ]);
    expect(added.exitCode).toBe(0);
  });

  it("dr add refuses a type only a newer spec has", async () => {
    const refused = await dr(["add", "application", "message", "operation-submitted", "--attributes", '{"messageType":"document"}']);
    expect(refused.exitCode).not.toBe(0);
    assertOutputContains(refused, "Type application.message is not in spec 0.13.0");
  });

  it("dr validate reports one already in the model as an error", async () => {
    const relationships = join(tempDir.path, "documentation-robotics/model/relationships.yaml");
    const rows = (yaml.parse(await readFile(relationships, "utf-8")) as unknown[] | null) ?? [];
    rows.push({
      source: "application.applicationservice.proposal-service",
      target: "data-model.objectschema.operation-draft",
      predicate: "accesses",
      layer: "application",
      targetLayer: "data-model",
    });
    await writeFile(relationships, yaml.stringify(rows));

    const result = await dr(["validate"]);
    expect(result.exitCode).not.toBe(0);
    assertOutputContains(result, "is not in spec 0.13.0");
  });
});

describe("dr upgrade --relayout lays out an earlier dr's files on their own (#1439)", () => {
  it("counts them without the flag, and with it lists them in the plan and lays them out, data unchanged", async () => {
    const description =
      "Exports every project, archived ones too, under one stamped folder, and reports the ones that failed to export";
    expect((await dr(["add", "motivation", "goal", "export-everything", "--description", description, "--attributes", '{"priority":"high"}'])).exitCode).toBe(0);
    const goalFile = join(tempDir.path, "documentation-robotics/model/01_motivation/goal.yaml");
    const laidOut = await readFile(goalFile, "utf-8");
    // As dr 0.7 wrote it: the long description folded at 80 columns
    const folded = yaml.stringify(yaml.parse(laidOut));
    expect(folded).not.toBe(laidOut);
    await writeFile(goalFile, folded);

    // Without --relayout the upgrade only counts them, and names the flag
    const counted = await dr(["upgrade", "--yes", "--model-only"]);
    expect(counted.exitCode).toBe(0);
    assertOutputContains(counted, "1 model file(s) are in an earlier dr's layout");
    assertOutputContains(counted, "dr upgrade --relayout");
    expect(await readFile(goalFile, "utf-8")).toBe(folded);

    const plan = await dr(["upgrade", "--dry-run", "--relayout"]);
    expect(plan.exitCode).toBe(0);
    assertOutputContains(plan, "Lay out 1 model file(s) as this dr writes them (data unchanged)");
    assertOutputContains(plan, "documentation-robotics/model/01_motivation/goal.yaml");
    expect(await readFile(goalFile, "utf-8")).toBe(folded);

    const applied = await dr(["upgrade", "--yes", "--model-only", "--relayout"]);
    expect(applied.exitCode).toBe(0);
    assertOutputContains(applied, "Laid out 1 model file(s)");
    expect(await readFile(goalFile, "utf-8")).toBe(laidOut);

    const again = await dr(["upgrade", "--dry-run", "--relayout"]);
    expect(again.stdout).not.toContain("Lay out");
    expect(again.stdout).not.toContain("earlier dr's layout");
  });
});
