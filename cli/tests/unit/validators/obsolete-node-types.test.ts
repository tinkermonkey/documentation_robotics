/**
 * Validation flags elements whose type the spec no longer defines (dogfood bug 8): heimdall's
 * product.capability elements passed schema validation untouched because "no type schema" was
 * treated as "custom type, nothing to check". Relationship errors also named only the endpoint
 * types, so 19 errors on different elements read identically.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Model } from "@/core/model";
import { Manifest } from "@/core/manifest";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { SchemaValidator, suggestNodeTypes } from "@/validators/schema-validator";
import { RelationshipValidator } from "@/validators/relationship-schema-validator";
import { Validator } from "@/validators/validator";

function productModel(): Model {
  const model = new Model("/test", new Manifest({ name: "Obsolete Types", version: "1.0.0" }));
  model.addLayer(
    new Layer("product", [
      new Element({
        id: "6f1c2b9e-3a4d-4e5f-8a7b-1c2d3e4f5a6b",
        path: "product.capability.graph-layout",
        spec_node_id: "product.capability",
        type: "capability",
        layer_id: "product",
        name: "Graph Layout",
      }),
    ])
  );
  return model;
}

describe("obsolete node types", () => {
  beforeEach(() => SchemaValidator.reset());

  it("suggests the type that replaced an obsolete one", () => {
    expect(suggestNodeTypes("product", "capability")).toContain("softwarecapability");
  });

  it("reports an element of a type the spec doesn't define, naming it and the likely replacement", async () => {
    const layer = productModel().layers.get("product")!;
    const result = await new SchemaValidator().validateLayer(layer);
    expect(result.isValid()).toBe(false);
    const error = result.errors.find((e) => e.elementId === "product.capability.graph-layout");
    expect(error).toBeDefined();
    expect(error!.message).toContain("product.capability.graph-layout");
    expect(error!.message).toContain("'capability'");
    expect(error!.message).toContain("softwarecapability");
    expect(error!.fixSuggestion).toContain("softwarecapability");
  });

  it("is reported by the full validation pipeline (model_validate and dr validate)", async () => {
    const result = await new Validator().validateModel(productModel());
    const messages = result.errors.map((e) => e.message);
    expect(messages.some((m) => m.includes("product.capability.graph-layout") && m.includes("softwarecapability"))).toBe(
      true
    );
  });

  it("leaves valid types alone", async () => {
    const layer = new Layer("motivation", [
      new Element({
        id: "7a2d3c0f-4b5e-4f60-9b8c-2d3e4f5a6b7c",
        path: "motivation.goal.g",
        spec_node_id: "motivation.goal",
        type: "goal",
        layer_id: "motivation",
        name: "G",
        attributes: { priority: "high" },
      }),
    ]);
    const result = await new SchemaValidator().validateLayer(layer);
    expect(result.errors.filter((e) => e.message.includes("does not define"))).toHaveLength(0);
  });
});

describe("relationship validation messages", () => {
  it("name both endpoint elements, so errors on different elements are distinguishable", async () => {
    const model = new Model("/test", new Manifest({ name: "Rel Messages", version: "1.0.0" }));
    model.addLayer(
      new Layer("motivation", [
        new Element({ id: "motivation.goal.a", path: "motivation.goal.a", spec_node_id: "motivation.goal", type: "goal", layer_id: "motivation", name: "A" }),
        new Element({ id: "motivation.goal.b", path: "motivation.goal.b", spec_node_id: "motivation.goal", type: "goal", layer_id: "motivation", name: "B" }),
        new Element({ id: "motivation.goal.c", path: "motivation.goal.c", spec_node_id: "motivation.goal", type: "goal", layer_id: "motivation", name: "C" }),
      ])
    );
    // "serves" is not a goal → goal relationship in the catalog.
    model.relationships.add({ source: "motivation.goal.a", target: "motivation.goal.b", predicate: "serves", layer: "motivation" });
    model.relationships.add({ source: "motivation.goal.c", target: "motivation.goal.b", predicate: "serves", layer: "motivation" });

    const validator = new RelationshipValidator();
    await validator.initialize();
    const result = await validator.validateModel(model);
    const noSchema = result.errors.filter((e) => e.message.includes("No schema found"));
    expect(noSchema).toHaveLength(2);
    expect(noSchema[0].message).not.toBe(noSchema[1].message);
    expect(noSchema.some((e) => e.message.includes("motivation.goal.a --[serves]--> motivation.goal.b"))).toBe(true);
    expect(noSchema.some((e) => e.message.includes("motivation.goal.c --[serves]--> motivation.goal.b"))).toBe(true);
    // The type pair stays in the message for grouping.
    expect(noSchema[0].message).toContain("motivation.goal --[serves]--> motivation.goal");
  });
});
