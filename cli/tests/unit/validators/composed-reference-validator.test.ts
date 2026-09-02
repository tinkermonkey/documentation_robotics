import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ComposedReferenceValidator } from "@/validators/composed-reference-validator";
import { Model } from "@/core/model";
import { Manifest } from "@/core/manifest";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { promises as fs } from "fs";
import path from "path";

describe("ComposedReferenceValidator", () => {
  function createTestModel(manifest?: Manifest): Model {
    const defaultManifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });
    return new Model("/test", manifest || defaultManifest);
  }

  describe("case-insensitive manifest model lookup", () => {
    it("should match uppercase manifest model with lowercase reference", async () => {
      const validator = new ComposedReferenceValidator();
      const manifest = new Manifest({
        name: "Test Model",
        version: "1.0.0",
        models: {
          "Auth-Service": {}, // Declared with uppercase
        },
      });
      const model = createTestModel(manifest);

      // Add element with lowercase reference (normalized by parser)
      const motivationLayer = new Layer("motivation", [
        new Element({
          id: "motivation-goal-secure",
          type: "Goal",
          name: "Ensure Security",
          references: [{ target: "@auth-service/api.operation.authenticate", type: "implements" }],
        }),
      ]);

      model.addLayer(motivationLayer);

      const result = await validator.validateModel(model);

      // Should not report "unknown external model" error due to case mismatch
      const modelErrors = result.errors.filter(
        e => e.message.includes("Unknown external model") || e.message.includes("unknown external model")
      );
      expect(modelErrors).toHaveLength(0);
    });

    it("should match lowercase manifest model with uppercase reference", async () => {
      const validator = new ComposedReferenceValidator();
      const manifest = new Manifest({
        name: "Test Model",
        version: "1.0.0",
        models: {
          "auth-service": {}, // Declared with lowercase
        },
      });
      const model = createTestModel(manifest);

      // Add element with uppercase reference (will be normalized by parser)
      const motivationLayer = new Layer("motivation", [
        new Element({
          id: "motivation-goal-secure",
          type: "Goal",
          name: "Ensure Security",
          references: [{ target: "@Auth-Service/api.operation.authenticate", type: "implements" }],
        }),
      ]);

      model.addLayer(motivationLayer);

      const result = await validator.validateModel(model);

      // Should not report "unknown external model" error
      const modelErrors = result.errors.filter(
        e => e.message.includes("Unknown external model") || e.message.includes("unknown external model")
      );
      expect(modelErrors).toHaveLength(0);
    });

    it("should correctly identify referenced models case-insensitively", async () => {
      const validator = new ComposedReferenceValidator();
      const manifest = new Manifest({
        name: "Test Model",
        version: "1.0.0",
        models: {
          "Auth-Service": {},
          "Payment-Service": {},
        },
      });
      const model = createTestModel(manifest);

      // Add elements with mixed-case references
      const apiLayer = new Layer("api", [
        new Element({
          id: "api-operation-login",
          type: "operation",
          name: "Login",
          references: [
            { target: "@auth-service/api.operation.authenticate", type: "uses" },
            { target: "@payment-service/api.operation.process", type: "uses" },
          ],
        }),
      ]);

      model.addLayer(apiLayer);

      const result = await validator.validateModel(model);

      // Should not report any "unknown external model" errors
      const modelErrors = result.errors.filter(
        e => e.message.includes("Unknown external model") || e.message.includes("unknown external model")
      );
      expect(modelErrors).toHaveLength(0);
    });
  });

  describe("case-insensitive modelPathOverrides lookup", () => {
    it("should find modelPathOverride with different casing than manifest", async () => {
      // Create a temporary directory structure for testing
      const tmpDir = await fs.mkdtemp(path.join(process.cwd(), "test-"));

      try {
        // Create external model directory structure
        const externalModelPath = path.join(tmpDir, "external-model");
        const modelDir = path.join(externalModelPath, "documentation-robotics", "model");
        const apiLayerDir = path.join(modelDir, "07_api");
        await fs.mkdir(apiLayerDir, { recursive: true });

        // Create an element file in the external model
        await fs.writeFile(
          path.join(apiLayerDir, "operations.yaml"),
          `elements:
  - path: "api.operation.authenticate"
    spec_node_id: "api.operation"
    type: "operation"
    name: "Authenticate"
`
        );

        // Validator with lowercase override key
        const validator = new ComposedReferenceValidator({
          "auth-service": externalModelPath, // Override key is lowercase
        });

        // Model with uppercase manifest declaration
        const manifest = new Manifest({
          name: "Test Model",
          version: "1.0.0",
          models: {
            "Auth-Service": {}, // Manifest key is uppercase
          },
        });
        const model = createTestModel(manifest);

        // Add element with lowercase reference
        const apiLayer = new Layer("api", [
          new Element({
            id: "api-endpoint-login",
            type: "endpoint",
            name: "Login",
            references: [{ target: "@auth-service/api.operation.authenticate", type: "uses" }],
          }),
        ]);

        model.addLayer(apiLayer);

        const result = await validator.validateModel(model);

        // Should NOT report "could not be resolved" error due to case-insensitive override lookup
        const resolutionErrors = result.errors.filter(
          e => e.message.includes("could not be resolved") || e.message.includes("unresolvable")
        );
        expect(resolutionErrors).toHaveLength(0);
      } finally {
        // Clean up temporary directory
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("should find modelPathOverride with uppercase key when manifest is lowercase", async () => {
      const tmpDir = await fs.mkdtemp(path.join(process.cwd(), "test-"));

      try {
        // Create external model directory structure
        const externalModelPath = path.join(tmpDir, "external-model");
        const modelDir = path.join(externalModelPath, "documentation-robotics", "model");
        const apiLayerDir = path.join(modelDir, "07_api");
        await fs.mkdir(apiLayerDir, { recursive: true });

        // Create an element file in the external model
        await fs.writeFile(
          path.join(apiLayerDir, "operations.yaml"),
          `elements:
  - path: "api.operation.authenticate"
    spec_node_id: "api.operation"
    type: "operation"
    name: "Authenticate"
`
        );

        // Validator with uppercase override key
        const validator = new ComposedReferenceValidator({
          "Auth-Service": externalModelPath, // Override key is uppercase
        });

        // Model with lowercase manifest declaration
        const manifest = new Manifest({
          name: "Test Model",
          version: "1.0.0",
          models: {
            "auth-service": {}, // Manifest key is lowercase
          },
        });
        const model = createTestModel(manifest);

        // Add element with lowercase reference
        const apiLayer = new Layer("api", [
          new Element({
            id: "api-endpoint-login",
            type: "endpoint",
            name: "Login",
            references: [{ target: "@auth-service/api.operation.authenticate", type: "uses" }],
          }),
        ]);

        model.addLayer(apiLayer);

        const result = await validator.validateModel(model);

        // Should NOT report resolution errors
        const resolutionErrors = result.errors.filter(
          e => e.message.includes("could not be resolved") || e.message.includes("unresolvable")
        );
        expect(resolutionErrors).toHaveLength(0);
      } finally {
        // Clean up temporary directory
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("reference tracking with case-insensitive models", () => {
    it("should correctly track referenced models regardless of casing", async () => {
      const validator = new ComposedReferenceValidator();
      const manifest = new Manifest({
        name: "Test Model",
        version: "1.0.0",
        models: {
          "Auth-Service": {},
          "unused-service": {},
        },
      });
      const model = createTestModel(manifest);

      // Add element that references only Auth-Service (case variations)
      const apiLayer = new Layer("api", [
        new Element({
          id: "api-operation-login",
          type: "operation",
          name: "Login",
          references: [
            { target: "@auth-service/api.operation.authenticate", type: "uses" }, // lowercase
            { target: "@AUTH-SERVICE/api.operation.validate", type: "uses" }, // uppercase
          ],
        }),
      ]);

      model.addLayer(apiLayer);

      const result = await validator.validateModel(model);

      // "unused-service" should generate warning about being declared but not referenced
      const unusedWarnings = result.warnings.filter(e => e.message.includes("unused-service"));
      expect(unusedWarnings.length).toBeGreaterThan(0);

      // No "unknown external model" errors should be reported
      const modelErrors = result.errors.filter(
        e => e.message.includes("Unknown external model") || e.message.includes("unknown external model")
      );
      expect(modelErrors).toHaveLength(0);
    });
  });
});
