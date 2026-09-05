/**
 * Integration tests for the legacy slug-id → UUID+path migration performed by
 * `Model.loadLayer()` (see cli/src/core/model.ts, the "3-case migration logic").
 *
 * Prior to spec v0.8.2, an element's `id` field held the human-readable slug
 * (e.g. `motivation.goal.customer-satisfaction`) directly and there was no
 * separate `path` field. Since 0.8.2, `id` is a UUIDv4 and `path` carries the
 * slug. `Model.loadLayer()` migrates the old shape to the new one transparently
 * on every load — it is not a one-time versioned migration step, so there is no
 * `dr upgrade` path for it; any project with pre-0.8.2 YAML on disk is migrated
 * in memory the moment it's loaded.
 *
 * Existing coverage (model-deterministic-uuid.test.ts) only exercises the
 * Layer/Element storage contract the migration relies on, with pre-computed
 * UUID/path pairs — it never loads a real legacy-format YAML file through
 * `Model.load()`. These tests close that gap by writing actual pre-0.8.2 YAML
 * to disk and loading it through the real public API.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import yaml from "yaml";
import { Model } from "../../src/core/model.js";

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Writes a minimal but realistic manifest.yaml + one layer directory to a fresh temp project root. */
async function writeLegacyProject(
  root: string,
  layerDirName: string,
  fileName: string,
  elements: Record<string, unknown>
): Promise<void> {
  const modelDir = join(root, "documentation-robotics", "model");
  const layerDir = join(modelDir, layerDirName);
  await mkdir(layerDir, { recursive: true });

  const manifest = {
    schema: "documentation-robotics-v1",
    cli_version: "0.7.0",
    spec_version: "0.8.1",
    created: "2025-01-01T00:00:00Z",
    updated: "2025-01-01T00:00:00Z",
    project: { name: "Legacy Test Project", description: "", version: "1.0.0" }
  };
  await writeFile(join(modelDir, "manifest.yaml"), yaml.stringify(manifest));
  await writeFile(join(layerDir, fileName), yaml.stringify(elements));
}

describe("Legacy slug-id migration (Model.load → loadLayer)", () => {
  let workdir: string | undefined;

  afterEach(async () => {
    if (workdir) {
      await rm(workdir, { recursive: true, force: true });
      workdir = undefined;
    }
  });

  it("migrates a pre-0.8.2 slug id to a deterministic UUID id + slug path", async () => {
    workdir = await mkdtemp(join(tmpdir(), "dr-legacy-migration-"));

    // Pre-0.8.2 shape: `id` is the slug itself, no `path` field at all.
    await writeLegacyProject(workdir, "01_motivation", "goal.yaml", {
      "motivation.goal.customer-satisfaction": {
        id: "motivation.goal.customer-satisfaction",
        type: "goal",
        layer_id: "motivation",
        name: "Customer Satisfaction",
        description: "Increase customer satisfaction score"
      }
    });

    const model = await Model.load(workdir);
    const layer = await model.getLayer("motivation");
    expect(layer).toBeDefined();

    const element = layer!.getElement("motivation.goal.customer-satisfaction");
    expect(element).toBeDefined();
    expect(element!.path).toBe("motivation.goal.customer-satisfaction");
    expect(element!.id).toMatch(UUID_V4_REGEX);
    // The old slug must not survive as the `id` after migration.
    expect(element!.id).not.toBe("motivation.goal.customer-satisfaction");
  });

  it("derives the same UUID on repeated loads of the same legacy element (deterministic)", async () => {
    workdir = await mkdtemp(join(tmpdir(), "dr-legacy-migration-det-"));

    await writeLegacyProject(workdir, "01_motivation", "goal.yaml", {
      "motivation.goal.stable-goal": {
        id: "motivation.goal.stable-goal",
        type: "goal",
        layer_id: "motivation",
        name: "Stable Goal"
      }
    });

    const firstLoad = await Model.load(workdir);
    const firstElement = (await firstLoad.getLayer("motivation"))!.getElement(
      "motivation.goal.stable-goal"
    );

    const secondLoad = await Model.load(workdir);
    const secondElement = (await secondLoad.getLayer("motivation"))!.getElement(
      "motivation.goal.stable-goal"
    );

    expect(firstElement!.id).toMatch(UUID_V4_REGEX);
    expect(firstElement!.id).toBe(secondElement!.id);
    expect(firstElement!.path).toBe(secondElement!.path);
  });

  it("leaves an already-migrated (UUID id + path) element unchanged", async () => {
    workdir = await mkdtemp(join(tmpdir(), "dr-legacy-migration-modern-"));

    const existingUuid = "550e8400-e29b-41d4-a716-446655440000";
    await writeLegacyProject(workdir, "01_motivation", "goal.yaml", {
      "motivation.goal.already-modern": {
        id: existingUuid,
        path: "motivation.goal.already-modern",
        spec_node_id: "motivation.goal",
        type: "goal",
        layer_id: "motivation",
        name: "Already Modern"
      }
    });

    const model = await Model.load(workdir);
    const element = (await model.getLayer("motivation"))!.getElement(
      "motivation.goal.already-modern"
    );

    // Case 1 (already has both a UUID id and a path) must pass through untouched.
    expect(element!.id).toBe(existingUuid);
    expect(element!.path).toBe("motivation.goal.already-modern");
  });

  it("migrates a legacy element in a non-motivation layer (product, added in spec v0.9.0)", async () => {
    workdir = await mkdtemp(join(tmpdir(), "dr-legacy-migration-product-"));

    await writeLegacyProject(workdir, "03_product", "persona.yaml", {
      "product.persona.power-user": {
        id: "product.persona.power-user",
        type: "persona",
        layer_id: "product",
        name: "Power User"
      }
    });

    const model = await Model.load(workdir);
    const element = (await model.getLayer("product"))!.getElement(
      "product.persona.power-user"
    );

    expect(element).toBeDefined();
    expect(element!.path).toBe("product.persona.power-user");
    expect(element!.id).toMatch(UUID_V4_REGEX);
  });
});
