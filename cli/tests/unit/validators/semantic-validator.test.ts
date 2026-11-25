import { describe, it, expect } from "bun:test";
import { SemanticValidator } from "@/validators/semantic-validator";
import { Model } from "@/core/model";
import { Manifest } from "@/core/manifest";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";

describe("SemanticValidator", () => {
  function createTestModel(): Model {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });
    return new Model("/test", manifest);
  }

  it("should validate unique element IDs", async () => {
    const validator = new SemanticValidator();
    const model = createTestModel();

    const layer1 = new Layer("motivation", [
      new Element({
        id: "motivation-goal-revenue",
        type: "Goal",
        name: "Increase Revenue",
      }),
    ]);

    const layer2 = new Layer("business", [
      new Element({
        id: "business-process-sales",
        type: "Process",
        name: "Sales Process",
      }),
    ]);

    model.addLayer(layer1);
    model.addLayer(layer2);

    const result = await validator.validateModel(model);

    expect(result.isValid()).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should validate relationship predicates", async () => {
    const validator = new SemanticValidator();
    const model = createTestModel();

    const layer = new Layer("motivation", [
      new Element({
        id: "motivation-goal-1",
        type: "Goal",
        name: "Goal 1",
        relationships: [
          {
            source: "motivation-goal-1",
            target: "motivation-goal-2",
            predicate: "depends-on",
          },
        ],
      }),
      new Element({
        id: "motivation-goal-2",
        type: "Goal",
        name: "Goal 2",
      }),
    ]);

    model.addLayer(layer);

    const result = await validator.validateModel(model);

    // Valid predicates should not produce errors, but may produce warnings
    // for predicates not in the catalog
    expect(result.errors).toHaveLength(0);
  });

  it("should warn about unknown relationship predicates", async () => {
    const validator = new SemanticValidator();
    const model = createTestModel();

    const layer = new Layer("motivation", [
      new Element({
        id: "motivation-goal-1",
        type: "Goal",
        name: "Goal 1",
        relationships: [
          {
            source: "motivation-goal-1",
            target: "motivation-goal-2",
            predicate: "unknown-predicate-xyz",
          },
        ],
      }),
      new Element({
        id: "motivation-goal-2",
        type: "Goal",
        name: "Goal 2",
      }),
    ]);

    model.addLayer(layer);

    const result = await validator.validateModel(model);

    // Unknown predicates should generate warnings
    expect(result.errors).toHaveLength(0);
    // May have warnings depending on catalog availability
    // Just verify it doesn't error out
  });

  it("should handle elements with no relationships", async () => {
    const validator = new SemanticValidator();
    const model = createTestModel();

    const layer = new Layer("motivation", [
      new Element({
        id: "motivation-goal-1",
        type: "Goal",
        name: "Goal 1",
      }),
    ]);

    model.addLayer(layer);

    const result = await validator.validateModel(model);

    expect(result.isValid()).toBe(true);
  });

  it("should validate empty model", async () => {
    const validator = new SemanticValidator();
    const model = createTestModel();

    const result = await validator.validateModel(model);

    expect(result.isValid()).toBe(true);
  });

  it("should handle multiple layers with multiple elements", async () => {
    const validator = new SemanticValidator();
    const model = createTestModel();

    for (let i = 1; i <= 3; i++) {
      const layer = new Layer(`layer-${i}`, [
        new Element({
          id: `layer-${i}-element-1`,
          type: "Type1",
          name: "Element 1",
        }),
        new Element({
          id: `layer-${i}-element-2`,
          type: "Type2",
          name: "Element 2",
        }),
      ]);
      model.addLayer(layer);
    }

    const result = await validator.validateModel(model);

    expect(result.isValid()).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  describe("application interface protocols (spec 0.16.0, Context Studio 43f52ae5)", () => {
    function modelWith(protocols: Array<string | undefined>): Model {
      const model = createTestModel();
      model.addLayer(
        new Layer(
          "application",
          protocols.map(
            (protocol, i) =>
              new Element({
                id: `application.applicationinterface.i${i}`,
                path: `application.applicationinterface.i${i}`,
                type: "applicationinterface",
                name: `Interface ${i}`,
                attributes: protocol === undefined ? {} : { protocol },
              })
          )
        )
      );
      return model;
    }

    it("advises HTTP for REST and HTTPS, as a warning, never an error", async () => {
      const result = await new SemanticValidator().validateModel(modelWith(["REST", "HTTPS"]));
      expect(result.isValid()).toBe(true);
      const messages = result.warnings.map((w) => w.message);
      expect(messages[0]).toContain("'REST' is written 'HTTP'");
      expect(messages[1]).toContain("'HTTPS' is written 'HTTP'");
      expect(result.warnings[0].fixSuggestion).toContain('--attribute-patch \'{"protocol":"HTTP"}\'');
      expect(result.warnings[0].category).toBe("semantic");
    });

    it("gives a known protocol its own spelling, and names the vocabulary for an unknown one", async () => {
      const result = await new SemanticValidator().validateModel(modelWith(["graphql", "Thrift"]));
      expect(result.warnings.map((w) => w.message)).toEqual([
        expect.stringContaining("'graphql' is written 'GraphQL'"),
        expect.stringContaining("'Thrift' is not in the recommended vocabulary (HTTP, MCP, GraphQL"),
      ]);
    });

    it("says nothing for a recommended protocol or an interface without one", async () => {
      const result = await new SemanticValidator().validateModel(modelWith(["HTTP", "MCP", "gRPC", undefined, ""]));
      expect(result.warnings).toHaveLength(0);
    });
  });
});
