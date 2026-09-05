import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import yaml from "yaml";
import { Model } from "@/core/model";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { Manifest } from "@/core/manifest";
import { ensureDir } from "@/utils/file-io";
import { NODE_TYPES, type NodeTypeInfo } from "@/generated/node-types";

/**
 * Regression suite for a production bug: Model.saveLayer() stripped any attribute literally
 * named "source" or "x-source-reference" from EVERY element's attributes before writing YAML,
 * treating them as internal graph-bookkeeping fields (like __references__/__relationships__)
 * regardless of whether the element's own schema declared them as real domain attributes.
 *
 * Reported symptom: security.accesscondition.attributes.source (a REQUIRED attribute) silently
 * vanished on every save, despite validating fine in memory — validation runs BEFORE saveLayer's
 * stripping, so the write itself gave no error. The corruption only surfaced later, disconnected
 * from the write that caused it, the next time the element was loaded/validated.
 *
 * Scope of the original bug: 41 of 191 node schemas across 8 layers (API, APM, Data Store,
 * Navigation, Security, Technology, Testing, UX) legitimately declare a "source" or
 * "x-source-reference" attribute. 3 mark it required (hard validation failure on next load);
 * 38 leave it optional (permanent, completely silent data loss — nothing ever errors).
 *
 * Fix: saveLayer() now only strips a key if it's NOT declared by the element's own schema (see
 * isPersistableAttribute in model.ts). The second test below iterates every CURRENT node type
 * with declared attributes rather than a fixed list, so this suite scales automatically as new
 * schemas are added — a future schema that collides with a still-internal key
 * (__references__/__relationships__) fails immediately here instead of shipping silently.
 */

async function readSoleYamlFile(layerDirParent: string): Promise<Record<string, any>> {
  const layerDirs = await fs.readdir(layerDirParent, { withFileTypes: true });
  const layerDir = layerDirs.find((e) => e.isDirectory());
  if (!layerDir) throw new Error(`No layer directory found under ${layerDirParent}`);
  const layerPath = `${layerDirParent}/${layerDir.name}`;
  const files = (await fs.readdir(layerPath)).filter((f) => f.endsWith(".yaml"));
  if (files.length !== 1) {
    throw new Error(`Expected exactly one YAML file in ${layerPath}, found: ${files.join(", ")}`);
  }
  const content = await fs.readFile(`${layerPath}/${files[0]}`, "utf-8");
  return yaml.parse(content);
}

describe("Model.saveLayer — attribute persistence must not collide with internal graph fields", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = `/tmp/test-attr-persist-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await ensureDir(testDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("persists security.accesscondition's required 'source' attribute (the originally reported bug)", async () => {
    const manifest = new Manifest({ name: "Test Model", version: "1.0.0" });
    const model = new Model(testDir, manifest);
    const layer = new Layer("security");
    model.addLayer(layer);

    const element = new Element({
      id: "11111111-1111-4111-8111-111111111111",
      path: "security.accesscondition.test-condition",
      spec_node_id: "security.accesscondition",
      type: "accesscondition",
      layer_id: "security",
      name: "Test Condition",
      attributes: {
        field: "request.user.role",
        operator: "eq",
        value: "admin",
        message: "Role must be admin",
        source: "SEC-POLICY-42 section 3.2",
      },
    });
    layer.addElement(element);

    await model.saveLayer("security");

    const yamlData = await readSoleYamlFile(`${testDir}/documentation-robotics/model`);
    const persisted = yamlData["security.accesscondition.test-condition"];
    expect(persisted).toBeDefined();
    expect(persisted.attributes?.source).toBe("SEC-POLICY-42 section 3.2");
  });

  it("still strips genuinely internal graph-bookkeeping keys (__references__/__relationships__)", async () => {
    const manifest = new Manifest({ name: "Test Model", version: "1.0.0" });
    const model = new Model(testDir, manifest);
    const layer = new Layer("security");
    model.addLayer(layer);

    const element = new Element({
      id: "22222222-2222-4222-8222-222222222222",
      path: "security.accesscondition.internal-fields-test",
      spec_node_id: "security.accesscondition",
      type: "accesscondition",
      layer_id: "security",
      name: "Internal Fields Test",
      attributes: {
        field: "x",
        operator: "eq",
        value: "y",
        message: "z",
        source: "still here",
        // These should never appear on a schema-validated element in practice, but simulate
        // graph-internal keys leaking into attributes to confirm they're still stripped.
        __references__: [{ fake: "reference" }],
        __relationships__: [{ fake: "relationship" }],
      },
    });
    layer.addElement(element);

    await model.saveLayer("security");

    const yamlData = await readSoleYamlFile(`${testDir}/documentation-robotics/model`);
    const persisted = yamlData["security.accesscondition.internal-fields-test"];
    expect(persisted.attributes?.source).toBe("still here");
    expect(persisted.attributes?.__references__).toBeUndefined();
    expect(persisted.attributes?.__relationships__).toBeUndefined();
  });

  it("does not leak __semanticId__ into persisted attributes (legacy-format element with a real domain attribute)", async () => {
    // Regression test for a bug found alongside the source/x-source-reference collision:
    // GraphModel.fromElement() aliased `properties` and `attributes` to the same object, so
    // layer.ts's __semanticId__ bookkeeping injection (triggered by element.semanticId, which
    // legacy-format elements carry) mutated `attributes` too — and model.ts's internal-key
    // filter only knew about __references__/__relationships__, so __semanticId__ passed
    // straight through into persisted YAML. This goes through the REAL injection path
    // (layer.addElement(), which is what actually sets __semanticId__ on the node) rather than
    // simulating it directly in attributes, so it would have failed before the fix.
    const manifest = new Manifest({ name: "Test Model", version: "1.0.0" });
    const model = new Model(testDir, manifest);
    const layer = new Layer("security");
    model.addLayer(layer);

    const element = new Element({
      id: "33333333-3333-4333-8333-333333333333",
      path: "security.accesscondition.semantic-id-test",
      spec_node_id: "security.accesscondition",
      type: "accesscondition",
      layer_id: "security",
      name: "Semantic ID Test",
      attributes: {
        field: "x",
        operator: "eq",
        value: "y",
        message: "z",
        source: "real domain value, must survive",
      },
      semanticId: "legacy.security.accesscondition.old-slug",
    } as any);
    layer.addElement(element);

    await model.saveLayer("security");

    const yamlData = await readSoleYamlFile(`${testDir}/documentation-robotics/model`);
    const persisted = yamlData["security.accesscondition.semantic-id-test"];
    expect(persisted.attributes?.source).toBe("real domain value, must survive");
    expect(persisted.attributes?.__semanticId__).toBeUndefined();
  });

  // Scales with the schema set: iterates every CURRENT node type with declared attributes,
  // rather than a fixed list of the 41 types known to be affected today. A future schema
  // colliding with __references__/__relationships__ fails this immediately.
  describe("every node type's declared attributes survive a save/reload round trip", () => {
    const typesWithAttributes: NodeTypeInfo[] = Array.from(NODE_TYPES.values()).filter(
      (t) => t.requiredAttributes.length > 0 || t.optionalAttributes.length > 0
    );

    // Sanity guard on the guard: if this ever drops to 0, the test below would pass vacuously
    // and silently stop testing anything — fail loudly instead.
    it("found node types with declared attributes to test", () => {
      expect(typesWithAttributes.length).toBeGreaterThan(100);
    });

    for (const nodeType of typesWithAttributes) {
      it(`${nodeType.specNodeId}`, async () => {
        const dir = `/tmp/test-attr-persist-${nodeType.type}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`;
        await ensureDir(dir);
        try {
          const manifest = new Manifest({ name: "Test Model", version: "1.0.0" });
          const model = new Model(dir, manifest);
          const layer = new Layer(nodeType.layer);
          model.addLayer(layer);

          const allAttrs = [...nodeType.requiredAttributes, ...nodeType.optionalAttributes];
          // Round-trip preservation doesn't depend on the attribute's declared JSON type —
          // saveLayer's filtering operates on keys, not values — so a uniform string marker
          // per attribute name is sufficient and keeps this test independent of each schema's
          // own attributeConstraints shape (string/enum/boolean/integer/array/object).
          const attributes: Record<string, string> = {};
          for (const attr of allAttrs) {
            attributes[attr] = `roundtrip-value:${attr}`;
          }

          const element = new Element({
            id: "33333333-3333-4333-8333-333333333333",
            path: `${nodeType.specNodeId}.roundtrip-test`,
            spec_node_id: nodeType.specNodeId,
            type: nodeType.type,
            layer_id: nodeType.layer,
            name: "Roundtrip Test",
            attributes,
          });
          layer.addElement(element);

          await model.saveLayer(nodeType.layer);

          const yamlData = await readSoleYamlFile(`${dir}/documentation-robotics/model`);
          const persisted = yamlData[`${nodeType.specNodeId}.roundtrip-test`];
          expect(persisted).toBeDefined();
          for (const attr of allAttrs) {
            expect(persisted.attributes?.[attr]).toBe(`roundtrip-value:${attr}`);
          }
        } finally {
          await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        }
      });
    }
  });
});
