/**
 * Integration tests for staged-changeset visibility in `dr validate` output.
 *
 * `dr validate` projects an active changeset's staged changes into the model before
 * validating, but previously gave no indication that it had done so. These tests verify
 * that an explicit notice (with a change count and the changeset id) is printed when a
 * changeset is active, and that no such notice appears when it isn't.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "path";
import { writeFile } from "fs/promises";
import { Model } from "@/core/model";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { StagedChangesetStorage } from "@/core/staged-changeset-storage";
import { validateCommand } from "@/commands/validate";
import { createTestWorkdir } from "../helpers/golden-copy.js";

async function activateChangeset(workdirPath: string, changesetId: string): Promise<void> {
  const activePath = path.join(workdirPath, "documentation-robotics", "changesets", ".active");
  await writeFile(activePath, changesetId, "utf-8");
}

async function captureConsole(fn: () => Promise<void>): Promise<string> {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  console.log = (...args: any[]) => logs.push(args.join(" "));
  console.error = (...args: any[]) => logs.push(args.join(" "));
  console.warn = (...args: any[]) => logs.push(args.join(" "));

  try {
    await fn();
  } catch {
    // validateCommand throws when validation fails; output was already captured
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }

  return logs.join("\n");
}

describe("dr validate staged-changeset visibility", () => {
  let workdir: Awaited<ReturnType<typeof createTestWorkdir>>;

  beforeEach(async () => {
    workdir = await createTestWorkdir();

    const model = await Model.init(
      workdir.path,
      {
        name: "Staged Visibility Test Model",
        version: "1.0.0",
        description: "Test model for staged-changeset validate notice",
        specVersion: "0.8.4",
        created: new Date().toISOString(),
      },
      { lazyLoad: false }
    );

    const motivationLayer = new Layer("motivation");
    motivationLayer.addElement(
      new Element({
        id: "motivation.goal.existing-goal",
        spec_node_id: "motivation.goal",
        layer_id: "motivation",
        type: "goal",
        name: "Existing Goal",
        description: "A committed goal",
        attributes: { priority: "high" },
      })
    );
    model.addLayer(motivationLayer);

    await model.saveManifest();
    await model.saveLayer("motivation");
  });

  afterEach(async () => {
    await workdir.cleanup();
  });

  it("shows no staged-changes notice when no changeset is active", async () => {
    const output = await captureConsole(() => validateCommand({ model: workdir.path }));

    expect(output).not.toContain("staged change");
  });

  it("shows a staged-changes notice with a count and changeset id when a changeset is active", async () => {
    const storage = new StagedChangesetStorage(workdir.path);
    const changesetId = "notice-test-changeset";
    const changeset = await storage.create(changesetId, "Notice Test", undefined, "base-snapshot");

    changeset.changes = [
      {
        type: "add",
        elementId: "motivation.goal.new-goal",
        layerName: "motivation",
        after: {
          id: "motivation.goal.new-goal",
          spec_node_id: "motivation.goal",
          layer_id: "motivation",
          type: "goal",
          name: "New Goal",
          description: "A staged goal",
          attributes: { priority: "medium" },
        },
        sequenceNumber: 0,
      },
    ];
    await storage.save(changeset);
    await activateChangeset(workdir.path, changesetId);

    const output = await captureConsole(() => validateCommand({ model: workdir.path }));

    expect(output).toContain("1 staged change");
    expect(output).toContain(changesetId);
  });

  it("scopes the staged-changes count to the validated layer(s) with --layers", async () => {
    const applicationLayer = new Layer("application");
    applicationLayer.addElement(
      new Element({
        id: "application.service.existing-service",
        spec_node_id: "application.service",
        layer_id: "application",
        type: "service",
        name: "Existing Service",
        description: "A committed service",
      })
    );

    const model = await Model.load(workdir.path, { lazyLoad: false });
    model.addLayer(applicationLayer);
    await model.saveManifest();
    await model.saveLayer("application");

    const storage = new StagedChangesetStorage(workdir.path);
    const changesetId = "notice-scoped-test-changeset";
    const changeset = await storage.create(changesetId, "Scoped Notice Test", undefined, "base-snapshot");

    changeset.changes = [
      {
        type: "add",
        elementId: "motivation.goal.new-goal",
        layerName: "motivation",
        after: {
          id: "motivation.goal.new-goal",
          spec_node_id: "motivation.goal",
          layer_id: "motivation",
          type: "goal",
          name: "New Goal",
          description: "A staged goal",
          attributes: { priority: "medium" },
        },
        sequenceNumber: 0,
      },
      {
        type: "add",
        elementId: "application.service.new-service",
        layerName: "application",
        after: {
          id: "application.service.new-service",
          spec_node_id: "application.service",
          layer_id: "application",
          type: "service",
          name: "New Service",
          description: "A staged service",
        },
        sequenceNumber: 1,
      },
    ];
    await storage.save(changeset);
    await activateChangeset(workdir.path, changesetId);

    const output = await captureConsole(() =>
      validateCommand({ model: workdir.path, layers: ["motivation"] })
    );

    expect(output).toContain("1 staged change");
    expect(output).toContain(changesetId);
    expect(output).not.toContain("2 staged change");
  });

  it("shows a staged-changes notice in --orphans mode when a changeset is active", async () => {
    const storage = new StagedChangesetStorage(workdir.path);
    const changesetId = "notice-orphans-test-changeset";
    const changeset = await storage.create(changesetId, "Orphans Notice Test", undefined, "base-snapshot");

    changeset.changes = [
      {
        type: "add",
        elementId: "motivation.goal.new-goal",
        layerName: "motivation",
        after: {
          id: "motivation.goal.new-goal",
          spec_node_id: "motivation.goal",
          layer_id: "motivation",
          type: "goal",
          name: "New Goal",
          description: "A staged goal",
          attributes: { priority: "medium" },
        },
        sequenceNumber: 0,
      },
    ];
    await storage.save(changeset);
    await activateChangeset(workdir.path, changesetId);

    const output = await captureConsole(() =>
      validateCommand({ model: workdir.path, orphans: true })
    );

    expect(output).toContain("1 staged change");
    expect(output).toContain(changesetId);
  });

  it("shows no staged-changes notice in --orphans mode when no changeset is active", async () => {
    const output = await captureConsole(() =>
      validateCommand({ model: workdir.path, orphans: true })
    );

    expect(output).not.toContain("staged change");
  });

  it("gracefully handles corrupted changeset by printing warning and continuing validation", async () => {
    const storage = new StagedChangesetStorage(workdir.path);
    const changesetId = "corrupted-changeset";
    const changeset = await storage.create(changesetId, "Corrupted", undefined, "base-snapshot");

    // Save the changeset
    await storage.save(changeset);

    // Corrupt it by making the YAML invalid
    const changesetPath = path.join(workdir.path, "documentation-robotics", "changesets", changesetId);
    const changesPath = path.join(changesetPath, "changes.yaml");
    await writeFile(changesPath, "invalid: yaml: content: [", "utf-8");

    // Activate the corrupted changeset
    await activateChangeset(workdir.path, changesetId);

    // Validate should not crash, but should print a warning and continue
    const output = await captureConsole(() => validateCommand({ model: workdir.path }));

    // Should show a warning about the corrupted changeset but still complete validation
    expect(output).toContain("Could not load changeset");
    expect(output).toContain(changesetId);
    // Validation should still run and report success (since the model is valid)
    expect(output).not.toContain("Validation failed");
  });
});
