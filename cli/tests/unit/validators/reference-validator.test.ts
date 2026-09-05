import { describe, it, expect } from "bun:test";
import { ReferenceValidator } from "@/validators/reference-validator";
import { Model } from "@/core/model";
import { Manifest } from "@/core/manifest";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";

describe("ReferenceValidator", () => {
  function createTestModel(): Model {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });
    return new Model("/test", manifest);
  }

  it("should validate valid references", () => {
    const validator = new ReferenceValidator();
    const model = createTestModel();

    // Higher layer (motivation) references lower layer (business)
    const motivationLayer = new Layer("motivation", [
      new Element({
        id: "motivation-goal-revenue",
        type: "Goal",
        name: "Increase Revenue",
        references: [{ target: "business-process-sales", type: "implements" }],
      }),
    ]);

    const businessLayer = new Layer("business", [
      new Element({
        id: "business-process-sales",
        type: "Process",
        name: "Sales Process",
      }),
    ]);

    model.addLayer(motivationLayer);
    model.addLayer(businessLayer);

    const result = validator.validateModel(model);

    expect(result.isValid()).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should detect broken references", () => {
    const validator = new ReferenceValidator();
    const model = createTestModel();

    const motivationLayer = new Layer("motivation", [
      new Element({
        id: "motivation-goal-revenue",
        type: "Goal",
        name: "Increase Revenue",
        references: [{ target: "business-process-nonexistent", type: "implements" }],
      }),
    ]);

    model.addLayer(motivationLayer);

    const result = validator.validateModel(model);

    expect(result.isValid()).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("Broken reference");
    expect(result.errors[0].message).toContain("business-process-nonexistent");
  });

  it("should enforce directional constraint (higher to lower)", () => {
    const validator = new ReferenceValidator();
    const model = createTestModel();

    // Lower layer (business) incorrectly references higher layer (motivation)
    const businessLayer = new Layer("business", [
      new Element({
        id: "business-process-sales",
        type: "Process",
        name: "Sales Process",
        references: [{ target: "motivation-goal-revenue", type: "implements" }],
      }),
    ]);

    const motivationLayer = new Layer("motivation", [
      new Element({
        id: "motivation-goal-revenue",
        type: "Goal",
        name: "Increase Revenue",
      }),
    ]);

    model.addLayer(businessLayer);
    model.addLayer(motivationLayer);

    const result = validator.validateModel(model);

    expect(result.isValid()).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("Invalid reference direction");
  });

  it("should allow same-layer references", () => {
    const validator = new ReferenceValidator();
    const model = createTestModel();

    const businessLayer = new Layer("business", [
      new Element({
        id: "business-process-sales",
        type: "Process",
        name: "Sales Process",
        references: [{ target: "business-process-fulfillment", type: "precedes" }],
      }),
      new Element({
        id: "business-process-fulfillment",
        type: "Process",
        name: "Fulfillment Process",
      }),
    ]);

    model.addLayer(businessLayer);

    const result = validator.validateModel(model);

    expect(result.isValid()).toBe(true);
  });

  it("should handle multiple layers and references", () => {
    const validator = new ReferenceValidator();
    const model = createTestModel();

    const motivationLayer = new Layer("motivation", [
      new Element({
        id: "motivation-goal-revenue",
        type: "Goal",
        name: "Increase Revenue",
        references: [
          { target: "business-process-sales", type: "implements" },
          { target: "security-policy-data-protection", type: "subject-to" },
        ],
      }),
    ]);

    const businessLayer = new Layer("business", [
      new Element({
        id: "business-process-sales",
        type: "Process",
        name: "Sales Process",
        references: [{ target: "application-service-crm", type: "uses" }],
      }),
    ]);

    const securityLayer = new Layer("security", [
      new Element({
        id: "security-policy-data-protection",
        type: "Policy",
        name: "Data Protection",
      }),
    ]);

    const appLayer = new Layer("application", [
      new Element({
        id: "application-service-crm",
        type: "Service",
        name: "CRM Service",
      }),
    ]);

    model.addLayer(motivationLayer);
    model.addLayer(businessLayer);
    model.addLayer(securityLayer);
    model.addLayer(appLayer);

    const result = validator.validateModel(model);

    expect(result.isValid()).toBe(true);
  });

  it("should detect multiple broken references in same element", () => {
    const validator = new ReferenceValidator();
    const model = createTestModel();

    const motivationLayer = new Layer("motivation", [
      new Element({
        id: "motivation-goal-revenue",
        type: "Goal",
        name: "Increase Revenue",
        references: [
          { target: "business-process-nonexistent1", type: "implements" },
          { target: "business-process-nonexistent2", type: "implements" },
        ],
      }),
    ]);

    model.addLayer(motivationLayer);

    const result = validator.validateModel(model);

    expect(result.isValid()).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it("should handle empty reference list", () => {
    const validator = new ReferenceValidator();
    const model = createTestModel();

    const motivationLayer = new Layer("motivation", [
      new Element({
        id: "motivation-goal-revenue",
        type: "Goal",
        name: "Increase Revenue",
        references: [],
      }),
    ]);

    model.addLayer(motivationLayer);

    const result = validator.validateModel(model);

    expect(result.isValid()).toBe(true);
  });

  it("should detect reference to unknown layer", () => {
    const validator = new ReferenceValidator();
    const model = createTestModel();

    const motivationLayer = new Layer("motivation", [
      new Element({
        id: "motivation-goal-revenue",
        type: "Goal",
        name: "Increase Revenue",
        references: [{ target: "unknown-element-id", type: "implements" }],
      }),
    ]);

    model.addLayer(motivationLayer);

    const result = validator.validateModel(model);

    expect(result.isValid()).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it("should validate references from higher to lower hyphenated layers", () => {
    const validator = new ReferenceValidator();
    const model = createTestModel();

    const applicationLayer = new Layer("application", [
      new Element({
        id: "application-service-order-processing",
        type: "Service",
        name: "Order Processing Service",
        references: [{ target: "data-model-entity-order", type: "uses" }],
      }),
    ]);

    const dataModelLayer = new Layer("data-model", [
      new Element({
        id: "data-model-entity-order",
        type: "Entity",
        name: "Order Entity",
      }),
    ]);

    model.addLayer(applicationLayer);
    model.addLayer(dataModelLayer);

    const result = validator.validateModel(model);

    expect(result.isValid()).toBe(true);
  });

  it("should handle complex multi-layer scenario with hyphenated layers", () => {
    const validator = new ReferenceValidator();
    const model = createTestModel();

    // Motivation → Application → Data Model → Data Store
    const motivationLayer = new Layer("motivation", [
      new Element({
        id: "motivation-goal-serve-customers",
        type: "Goal",
        name: "Serve Customers",
        references: [{ target: "application-service-customer-management", type: "realizes" }],
      }),
    ]);

    const applicationLayer = new Layer("application", [
      new Element({
        id: "application-service-customer-management",
        type: "Service",
        name: "Customer Management Service",
        references: [{ target: "data-model-entity-customer", type: "uses" }],
      }),
    ]);

    const dataModelLayer = new Layer("data-model", [
      new Element({
        id: "data-model-entity-customer",
        type: "Entity",
        name: "Customer Entity",
        references: [{ target: "data-store-table-customers", type: "persisted-by" }],
      }),
    ]);

    const dataStoreLayer = new Layer("data-store", [
      new Element({
        id: "data-store-table-customers",
        type: "Table",
        name: "Customers Table",
      }),
    ]);

    model.addLayer(motivationLayer);
    model.addLayer(applicationLayer);
    model.addLayer(dataModelLayer);
    model.addLayer(dataStoreLayer);

    const result = validator.validateModel(model);

    expect(result.isValid()).toBe(true);
  });

  describe("loadedLayerFilter behavior", () => {
    it("should skip validation for references targeting unloaded layers when filter is active", () => {
      const validator = new ReferenceValidator();
      const model = createTestModel();

      // Only load motivation layer
      model.loadedLayerFilter = ["motivation"];

      const motivationLayer = new Layer("motivation", [
        new Element({
          id: "motivation-goal-revenue",
          type: "Goal",
          name: "Increase Revenue",
          // Reference to element in unloaded layer (business)
          references: [{ target: "business-process-sales-nonexistent", type: "implements" }],
        }),
      ]);

      model.addLayer(motivationLayer);

      const result = validator.validateModel(model);

      // Should skip validation and not report error since target is in unloaded layer
      expect(result.isValid()).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should report missing elements in loaded layers even when filter is active", () => {
      const validator = new ReferenceValidator();
      const model = createTestModel();

      // Load both motivation and business layers
      model.loadedLayerFilter = ["motivation", "business"];

      const motivationLayer = new Layer("motivation", [
        new Element({
          id: "motivation-goal-revenue",
          type: "Goal",
          name: "Increase Revenue",
          // Reference to element in loaded layer but doesn't exist
          references: [{ target: "business-process-nonexistent", type: "implements" }],
        }),
      ]);

      const businessLayer = new Layer("business", [
        new Element({
          id: "business-process-sales",
          type: "Process",
          name: "Sales Process",
        }),
      ]);

      model.addLayer(motivationLayer);
      model.addLayer(businessLayer);

      const result = validator.validateModel(model);

      // Should report error since target is in a loaded layer but doesn't exist
      expect(result.isValid()).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Broken reference");
      expect(result.errors[0].message).toContain("business-process-nonexistent");
    });
  });

  describe("qualified references", () => {
    it("should validate qualified reference with declared model", () => {
      const validator = new ReferenceValidator();
      const manifest = new Manifest({
        name: "Test Model",
        version: "1.0.0",
        models: {
          "auth-service": {},
        },
      });
      const model = new Model("/test", manifest);

      // Motivation layer referencing element in declared external model
      const motivationLayer = new Layer("motivation", [
        new Element({
          id: "motivation-goal-secure",
          type: "Goal",
          name: "Ensure Security",
          references: [{ target: "@auth-service/api.operation.authenticate", type: "implements" }],
        }),
      ]);

      model.addLayer(motivationLayer);

      const result = validator.validateModel(model);

      expect(result.isValid()).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should report error for qualified reference to undeclared model", () => {
      const validator = new ReferenceValidator();
      const manifest = new Manifest({
        name: "Test Model",
        version: "1.0.0",
        // No models declared
      });
      const model = new Model("/test", manifest);

      const motivationLayer = new Layer("motivation", [
        new Element({
          id: "motivation-goal-secure",
          type: "Goal",
          name: "Ensure Security",
          references: [{ target: "@auth-service/api.operation.authenticate", type: "implements" }],
        }),
      ]);

      model.addLayer(motivationLayer);

      const result = validator.validateModel(model);

      expect(result.isValid()).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Unknown external model reference");
      expect(result.errors[0].message).toContain("auth-service");
    });

    it("should validate qualified reference structure without external model present", () => {
      const validator = new ReferenceValidator();
      const manifest = new Manifest({
        name: "Test Model",
        version: "1.0.0",
        models: {
          "payment-service": {},
        },
      });
      const model = new Model("/test", manifest);

      const applicationLayer = new Layer("application", [
        new Element({
          id: "application-service-order",
          type: "Service",
          name: "Order Service",
          references: [{ target: "@payment-service/api.operation.process-payment", type: "uses" }],
        }),
      ]);

      model.addLayer(applicationLayer);

      const result = validator.validateModel(model);

      // Should pass validation - external model doesn't need to exist
      expect(result.isValid()).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should enforce directional constraint on qualified references", () => {
      const validator = new ReferenceValidator();
      const manifest = new Manifest({
        name: "Test Model",
        version: "1.0.0",
        models: {
          "core": {},
        },
      });
      const model = new Model("/test", manifest);

      // Data Store layer incorrectly referencing higher layer (api) in external model
      const dataStoreLayer = new Layer("data-store", [
        new Element({
          id: "data-store-table-users",
          type: "Table",
          name: "Users Table",
          references: [{ target: "@core/api.operation.get-user", type: "uses" }],
        }),
      ]);

      model.addLayer(dataStoreLayer);

      const result = validator.validateModel(model);

      expect(result.isValid()).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Invalid reference direction");
    });

    it("should report malformed qualified path segment", () => {
      const validator = new ReferenceValidator();
      const manifest = new Manifest({
        name: "Test Model",
        version: "1.0.0",
        models: {
          "external": {},
        },
      });
      const model = new Model("/test", manifest);

      const motivationLayer = new Layer("motivation", [
        new Element({
          id: "motivation-goal-test",
          type: "Goal",
          name: "Test Goal",
          // Malformed qualified path - missing required segments
          references: [{ target: "@external/invalid", type: "implements" }],
        }),
      ]);

      model.addLayer(motivationLayer);

      const result = validator.validateModel(model);

      expect(result.isValid()).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Malformed qualified reference path");
    });

    it("should allow models section to be empty", () => {
      const validator = new ReferenceValidator();
      const manifest = new Manifest({
        name: "Test Model",
        version: "1.0.0",
        models: {},
      });
      const model = new Model("/test", manifest);

      const motivationLayer = new Layer("motivation", [
        new Element({
          id: "motivation-goal-revenue",
          type: "Goal",
          name: "Increase Revenue",
          references: [{ target: "business-process-sales", type: "implements" }],
        }),
      ]);

      const businessLayer = new Layer("business", [
        new Element({
          id: "business-process-sales",
          type: "Process",
          name: "Sales Process",
        }),
      ]);

      model.addLayer(motivationLayer);
      model.addLayer(businessLayer);

      const result = validator.validateModel(model);

      expect(result.isValid()).toBe(true);
    });

    it("should validate qualified reference with hyphenated layer names in segment", () => {
      const validator = new ReferenceValidator();
      const manifest = new Manifest({
        name: "Test Model",
        version: "1.0.0",
        models: {
          "data-service": {},
        },
      });
      const model = new Model("/test", manifest);

      const applicationLayer = new Layer("application", [
        new Element({
          id: "application-service-user-mgmt",
          type: "Service",
          name: "User Management",
          references: [{ target: "@data-service/data-model.entity.user", type: "uses" }],
        }),
      ]);

      model.addLayer(applicationLayer);

      const result = validator.validateModel(model);

      expect(result.isValid()).toBe(true);
    });

    it("should handle model without manifest.models property", () => {
      const validator = new ReferenceValidator();
      const manifest = new Manifest({
        name: "Test Model",
        version: "1.0.0",
        // No models property at all
      });
      const model = new Model("/test", manifest);

      const motivationLayer = new Layer("motivation", [
        new Element({
          id: "motivation-goal-test",
          type: "Goal",
          name: "Test Goal",
          references: [{ target: "@external/api.operation.test", type: "implements" }],
        }),
      ]);

      model.addLayer(motivationLayer);

      const result = validator.validateModel(model);

      expect(result.isValid()).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Unknown external model reference");
    });

    it("should validate qualified reference from lower to lower layer same model", () => {
      const validator = new ReferenceValidator();
      const manifest = new Manifest({
        name: "Test Model",
        version: "1.0.0",
        models: {
          "external": {},
        },
      });
      const model = new Model("/test", manifest);

      // API layer referencing Data Model layer in external model (valid: api=7, data-model=8)
      const apiLayer = new Layer("api", [
        new Element({
          id: "api-endpoint-get-user",
          type: "Endpoint",
          name: "Get User",
          references: [{ target: "@external/data-model.entity.user", type: "uses" }],
        }),
      ]);

      model.addLayer(apiLayer);

      const result = validator.validateModel(model);

      expect(result.isValid()).toBe(true);
    });

    it("should handle case-insensitive manifest model lookup", () => {
      const validator = new ReferenceValidator();
      // Manifest declares model with uppercase
      const manifest = new Manifest({
        name: "Test Model",
        version: "1.0.0",
        models: {
          "Auth-Service": {}, // Declared with uppercase
        },
      });
      const model = new Model("/test", manifest);

      // Reference uses lowercase (normalized by parser)
      const motivationLayer = new Layer("motivation", [
        new Element({
          id: "motivation-goal-secure",
          type: "Goal",
          name: "Ensure Security",
          references: [{ target: "@auth-service/api.operation.authenticate", type: "implements" }],
        }),
      ]);

      model.addLayer(motivationLayer);

      const result = validator.validateModel(model);

      // Should pass validation - case-insensitive lookup should find the model
      expect(result.isValid()).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should handle mixed-case reference with uppercase model name", () => {
      const validator = new ReferenceValidator();
      // Manifest declares model with lowercase
      const manifest = new Manifest({
        name: "Test Model",
        version: "1.0.0",
        models: {
          "auth-service": {}, // Declared with lowercase
        },
      });
      const model = new Model("/test", manifest);

      // Reference uses uppercase (will be normalized by parser)
      const motivationLayer = new Layer("motivation", [
        new Element({
          id: "motivation-goal-secure",
          type: "Goal",
          name: "Ensure Security",
          references: [{ target: "@Auth-Service/api.operation.authenticate", type: "implements" }],
        }),
      ]);

      model.addLayer(motivationLayer);

      const result = validator.validateModel(model);

      // Should pass validation - parser normalizes to lowercase
      expect(result.isValid()).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
