import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import { Model } from "@/core/model";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { Manifest } from "@/core/manifest";
import { Changeset } from "@/core/changeset";
import { StagedChangesetStorage } from "@/core/staged-changeset-storage";
import { ensureDir } from "@/utils/file-io";
import {
  scanForAttributeCollisionDamage,
  attemptRecovery,
  applyRecovery,
} from "@/core/attribute-collision-repair";

/**
 * Tests for the repair tooling built for the "source"/"x-source-reference" attribute-collision
 * bug (see model.ts's isPersistableAttribute and its own doc comment). These simulate the
 * bug's after-effects directly — an element already missing a schema-declared attribute, as if
 * it had been saved under the old buggy code — rather than re-testing the fix itself (that's
 * covered by attribute-persistence-collision.test.ts).
 */
describe("attribute-collision-repair", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = `/tmp/test-collision-repair-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  function makeDamagedElement(): Element {
    // security.accesscondition with "source" (required) already missing — as if this element
    // had been saved once under the pre-fix buggy code.
    return new Element({
      id: "11111111-1111-4111-8111-111111111111",
      path: "security.accesscondition.damaged-condition",
      spec_node_id: "security.accesscondition",
      type: "accesscondition",
      layer_id: "security",
      name: "Damaged Condition",
      attributes: {
        field: "request.user.role",
        operator: "eq",
        value: "admin",
        message: "Role must be admin",
        // "source" intentionally absent.
      },
    });
  }

  describe("scanForAttributeCollisionDamage", () => {
    it("flags an element missing a required, schema-declared collision-prone attribute", () => {
      const manifest = new Manifest({ name: "Test", version: "1.0.0" });
      const model = new Model(testDir, manifest);
      const layer = new Layer("security");
      layer.addElement(makeDamagedElement());
      model.addLayer(layer);

      const candidates = scanForAttributeCollisionDamage(model);

      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        elementRef: "security.accesscondition.damaged-condition",
        specNodeId: "security.accesscondition",
        attribute: "source",
        required: true,
      });
    });

    it("does not flag an element whose schema doesn't declare the attribute at all", () => {
      const manifest = new Manifest({ name: "Test", version: "1.0.0" });
      const model = new Model(testDir, manifest);
      const layer = new Layer("motivation");
      layer.addElement(
        new Element({
          id: "22222222-2222-4222-8222-222222222222",
          path: "motivation.goal.unrelated-goal",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Unrelated Goal",
          attributes: {},
        })
      );
      model.addLayer(layer);

      const candidates = scanForAttributeCollisionDamage(model);
      expect(candidates).toHaveLength(0);
    });

    it("does not flag an element that already has the attribute set", () => {
      const manifest = new Manifest({ name: "Test", version: "1.0.0" });
      const model = new Model(testDir, manifest);
      const layer = new Layer("security");
      const element = makeDamagedElement();
      element.attributes.source = "already present";
      layer.addElement(element);
      model.addLayer(layer);

      const candidates = scanForAttributeCollisionDamage(model);
      expect(candidates).toHaveLength(0);
    });
  });

  describe("attemptRecovery + applyRecovery", () => {
    it("recovers a value from a committed changeset's change history and restores it on --apply", async () => {
      const manifest = new Manifest({ name: "Test", version: "1.0.0" });
      const model = new Model(testDir, manifest);
      const layer = new Layer("security");
      layer.addElement(makeDamagedElement());
      model.addLayer(layer);

      // Simulate a changeset (already committed — commit does not delete the changeset file)
      // recorded while the bug was active: the original "add" carried the correct value, which
      // never made it to the base model YAML because of the bug.
      const storage = new StagedChangesetStorage(testDir);
      const changeset = new Changeset({
        id: "cs-001",
        name: "add-access-condition",
        created: new Date(Date.now() - 60_000).toISOString(),
        modified: new Date(Date.now() - 60_000).toISOString(),
        status: "committed",
        baseSnapshot: "sha256:fake",
        changes: [
          {
            type: "add",
            elementId: "security.accesscondition.damaged-condition",
            layerName: "security",
            after: {
              attributes: {
                field: "request.user.role",
                operator: "eq",
                value: "admin",
                message: "Role must be admin",
                source: "SEC-POLICY-42 section 3.2",
              },
            },
            timestamp: new Date(Date.now() - 60_000).toISOString(),
          },
        ],
      });
      await storage.save(changeset);

      const candidates = scanForAttributeCollisionDamage(model);
      await attemptRecovery(candidates, storage);

      expect(candidates[0].recovered).toBeDefined();
      expect(candidates[0].recovered!.value).toBe("SEC-POLICY-42 section 3.2");
      expect(candidates[0].recovered!.changesetId).toBe("cs-001");

      const repaired = applyRecovery(model, candidates);
      expect(repaired).toHaveLength(1);
      await model.saveLayer("security");
      await model.saveManifest();

      // Reload from disk to confirm the repair actually persisted.
      const reloaded = await Model.load(testDir);
      const reloadedLayer = await reloaded.getLayer("security");
      const reloadedElement = reloadedLayer?.getElement("security.accesscondition.damaged-condition");
      expect(reloadedElement?.attributes.source).toBe("SEC-POLICY-42 section 3.2");
    });

    it("prefers the most recent matching change when multiple changesets touched the element", async () => {
      const manifest = new Manifest({ name: "Test", version: "1.0.0" });
      const model = new Model(testDir, manifest);
      const layer = new Layer("security");
      layer.addElement(makeDamagedElement());
      model.addLayer(layer);

      const storage = new StagedChangesetStorage(testDir);
      const older = new Changeset({
        id: "cs-older",
        name: "older",
        created: new Date(Date.now() - 120_000).toISOString(),
        modified: new Date(Date.now() - 120_000).toISOString(),
        status: "committed",
        baseSnapshot: "sha256:fake",
        changes: [
          {
            type: "add",
            elementId: "security.accesscondition.damaged-condition",
            layerName: "security",
            after: { attributes: { source: "stale value" } },
            timestamp: new Date(Date.now() - 120_000).toISOString(),
          },
        ],
      });
      const newer = new Changeset({
        id: "cs-newer",
        name: "newer",
        created: new Date(Date.now() - 30_000).toISOString(),
        modified: new Date(Date.now() - 30_000).toISOString(),
        status: "committed",
        baseSnapshot: "sha256:fake",
        changes: [
          {
            type: "update",
            elementId: "security.accesscondition.damaged-condition",
            layerName: "security",
            after: { attributes: { source: "correct latest value" } },
            timestamp: new Date(Date.now() - 30_000).toISOString(),
          },
        ],
      });
      await storage.save(older);
      await storage.save(newer);

      const candidates = scanForAttributeCollisionDamage(model);
      await attemptRecovery(candidates, storage);

      expect(candidates[0].recovered?.value).toBe("correct latest value");
    });

    it("reports (never fabricates) when no changeset holds a recoverable value", async () => {
      const manifest = new Manifest({ name: "Test", version: "1.0.0" });
      const model = new Model(testDir, manifest);
      const layer = new Layer("security");
      layer.addElement(makeDamagedElement());
      model.addLayer(layer);

      const storage = new StagedChangesetStorage(testDir);
      const candidates = scanForAttributeCollisionDamage(model);
      await attemptRecovery(candidates, storage);

      expect(candidates[0].recovered).toBeUndefined();

      const repaired = applyRecovery(model, candidates);
      expect(repaired).toHaveLength(0);
    });
  });
});
