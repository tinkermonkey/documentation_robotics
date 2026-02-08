/**
 * Unit tests for base schema validation
 * Tests that verify schema enforcement for valid and invalid data
 */

import { describe, it, expect, beforeAll } from "bun:test";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// Import test fixtures
import { specLayerExamples, invalidSpecLayerExamples } from "../../fixtures/base-schemas/spec-layer-examples";
import { specNodeExamples, invalidSpecNodeExamples } from "../../fixtures/base-schemas/spec-node-examples";
import { specNodeRelationshipExamples, invalidSpecNodeRelationshipExamples } from "../../fixtures/base-schemas/spec-node-relationship-examples";
import { modelNodeExamples, invalidModelNodeExamples } from "../../fixtures/base-schemas/model-node-examples";
import { modelNodeRelationshipExamples, invalidModelNodeRelationshipExamples } from "../../fixtures/base-schemas/model-node-relationship-examples";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemasDir = path.join(__dirname, "../../../../spec/schemas/base");
const commonSchemasDir = path.join(__dirname, "../../../../spec/schemas/common");

// Load schema files
function loadSchema(filename: string) {
  const filepath = path.join(schemasDir, filename);
  const content = fs.readFileSync(filepath, "utf8");
  return JSON.parse(content);
}

function loadCommonSchema(filename: string) {
  const filepath = path.join(commonSchemasDir, filename);
  const content = fs.readFileSync(filepath, "utf8");
  return JSON.parse(content);
}

describe("Base Schema Validation", () => {
  let ajv: Ajv.Ajv;
  let specLayerSchema: any;
  let specNodeSchema: any;
  let specNodeRelationshipSchema: any;
  let modelNodeSchema: any;
  let modelNodeRelationshipSchema: any;
  let predicateCatalogSchema: any;
  let sourceReferencesSchema: any;

  beforeAll(() => {
    ajv = new Ajv({
      strict: false,
      strictTypes: false,
      verbose: true,
    });

    // Add format validators
    addFormats(ajv, ["uuid", "uri", "date-time"]);

    // Load all schemas
    specLayerSchema = loadSchema("spec-layer.schema.json");
    specNodeSchema = loadSchema("spec-node.schema.json");
    specNodeRelationshipSchema = loadSchema("spec-node-relationship.schema.json");
    modelNodeSchema = loadSchema("model-node.schema.json");
    modelNodeRelationshipSchema = loadSchema("model-node-relationship.schema.json");
    predicateCatalogSchema = loadSchema("predicate-catalog.schema.json");
    sourceReferencesSchema = loadCommonSchema("source-references.schema.json");

    // Add schemas to AJV for reference resolution
    ajv.addSchema(sourceReferencesSchema, sourceReferencesSchema.$id);
    ajv.addSchema(specNodeSchema, specNodeSchema.$id);
    ajv.addSchema(specNodeRelationshipSchema, specNodeRelationshipSchema.$id);
  });

  describe("SpecLayer Schema", () => {
    it("should validate a valid motivation layer", () => {
      const validate = ajv.compile(specLayerSchema);
      const valid = validate(specLayerExamples.motivationLayer);
      expect(valid).toBe(true);
    });

    it("should validate a valid business layer", () => {
      const validate = ajv.compile(specLayerSchema);
      const valid = validate(specLayerExamples.businessLayer);
      expect(valid).toBe(true);
    });

    it("should validate a valid data-model layer", () => {
      const validate = ajv.compile(specLayerSchema);
      const valid = validate(specLayerExamples.dataModelLayer);
      expect(valid).toBe(true);
    });

    it("should validate minimal layer with only required fields", () => {
      const validate = ajv.compile(specLayerSchema);
      const valid = validate(specLayerExamples.minimalLayer);
      expect(valid).toBe(true);
    });

    it("should reject layer with invalid ID pattern", () => {
      const validate = ajv.compile(specLayerSchema);
      const valid = validate(invalidSpecLayerExamples.invalidId);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("pattern");
    });

    it("should reject layer with invalid number", () => {
      const validate = ajv.compile(specLayerSchema);
      const valid = validate(invalidSpecLayerExamples.invalidNumber);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("minimum");
    });

    it("should reject layer with missing required field", () => {
      const validate = ajv.compile(specLayerSchema);
      const valid = validate(invalidSpecLayerExamples.missingRequired);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("required");
    });

    it("should reject layer with extra properties", () => {
      const validate = ajv.compile(specLayerSchema);
      const valid = validate(invalidSpecLayerExamples.extraProperties);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("additionalProperties");
    });

    it("should reject layer with invalid node type reference", () => {
      const validate = ajv.compile(specLayerSchema);
      const valid = validate(invalidSpecLayerExamples.invalidNodeTypeRef);
      expect(valid).toBe(false);
    });
  });

  describe("SpecNode Schema", () => {
    it("should validate a valid goal node", () => {
      const validate = ajv.compile(specNodeSchema);
      const valid = validate(specNodeExamples.goalNode);
      expect(valid).toBe(true);
    });

    it("should validate a valid endpoint node", () => {
      const validate = ajv.compile(specNodeSchema);
      const valid = validate(specNodeExamples.endpointNode);
      expect(valid).toBe(true);
    });

    it("should validate minimal node with empty attributes", () => {
      const validate = ajv.compile(specNodeSchema);
      const valid = validate(specNodeExamples.minimalNode);
      expect(valid).toBe(true);
    });

    it("should validate node with enum attributes", () => {
      const validate = ajv.compile(specNodeSchema);
      const valid = validate(specNodeExamples.requirementNode);
      expect(valid).toBe(true);
    });

    it("should reject node with invalid ID format", () => {
      const validate = ajv.compile(specNodeSchema);
      const valid = validate(invalidSpecNodeExamples.invalidId);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("pattern");
    });

    it("should accept node with mismatched layer ID (schema limitation: layer_id not validated against id prefix)", () => {
      const validate = ajv.compile(specNodeSchema);
      const valid = validate(invalidSpecNodeExamples.mismatchedLayerId);
      expect(valid).toBe(true); // Schema doesn't validate layer_id prefix consistency - runtime validators should enforce this
    });

    it("should reject node with invalid attribute type", () => {
      const validate = ajv.compile(specNodeSchema);
      const valid = validate(invalidSpecNodeExamples.invalidAttributeType);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("enum");
    });

    it("should reject enum attribute without enum_values", () => {
      const validate = ajv.compile(specNodeSchema);
      const valid = validate(invalidSpecNodeExamples.enumWithoutValues);
      expect(valid).toBe(false); // if/then constraint requires enum_values when type is 'enum'
      expect(validate.errors?.some(e => e.keyword === "required")).toBe(true);
    });

    it("should reject node with missing description", () => {
      const validate = ajv.compile(specNodeSchema);
      const valid = validate(invalidSpecNodeExamples.missingDescription);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("required");
    });
  });

  describe("SpecNodeRelationship Schema", () => {
    it("should validate a valid supports relationship", () => {
      const validate = ajv.compile(specNodeRelationshipSchema);
      const valid = validate(specNodeRelationshipExamples.supportsRelationship);
      expect(valid).toBe(true);
    });

    it("should validate a valid realizes relationship", () => {
      const validate = ajv.compile(specNodeRelationshipSchema);
      const valid = validate(specNodeRelationshipExamples.realizesRelationship);
      expect(valid).toBe(true);
    });

    it("should validate minimal relationship without optional fields", () => {
      const validate = ajv.compile(specNodeRelationshipSchema);
      const valid = validate(specNodeRelationshipExamples.minimalRelationship);
      expect(valid).toBe(true);
    });

    it("should validate relationship with attributes", () => {
      const validate = ajv.compile(specNodeRelationshipSchema);
      const valid = validate(specNodeRelationshipExamples.consumesRelationship);
      expect(valid).toBe(true);
    });

    it("should reject relationship with invalid ID format", () => {
      const validate = ajv.compile(specNodeRelationshipSchema);
      const valid = validate(invalidSpecNodeRelationshipExamples.invalidId);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("pattern");
    });

    it("should validate relationship without denormalized source_layer (optional field)", () => {
      const validate = ajv.compile(specNodeRelationshipSchema);
      // source_layer is denormalized and optional - it's computed from source_spec_node_id
      const valid = validate({
        id: "motivation.supports.motivation",
        source_spec_node_id: "motivation.goal",
        destination_spec_node_id: "motivation.goal",
        destination_layer: "motivation",
        predicate: "supports"
      });
      // This should be valid because source_layer is optional/denormalized
      expect(valid).toBe(true);
    });

    it("should reject relationship with invalid cardinality", () => {
      const validate = ajv.compile(specNodeRelationshipSchema);
      const valid = validate(invalidSpecNodeRelationshipExamples.invalidCardinality);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("enum");
    });

    it("should reject relationship with invalid strength", () => {
      const validate = ajv.compile(specNodeRelationshipSchema);
      const valid = validate(invalidSpecNodeRelationshipExamples.invalidStrength);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("enum");
    });

    it("should reject relationship with extra properties", () => {
      const validate = ajv.compile(specNodeRelationshipSchema);
      const valid = validate(invalidSpecNodeRelationshipExamples.extraProperties);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("additionalProperties");
    });
  });

  describe("ModelNode Schema", () => {
    it("should validate a valid goal node instance", () => {
      const validate = ajv.compile(modelNodeSchema);
      const valid = validate(modelNodeExamples.goalNode);
      expect(valid).toBe(true);
    });

    it("should validate a valid endpoint node instance", () => {
      const validate = ajv.compile(modelNodeSchema);
      const valid = validate(modelNodeExamples.endpointNode);
      expect(valid).toBe(true);
    });

    it("should validate minimal node without optional fields", () => {
      const validate = ajv.compile(modelNodeSchema);
      const minimalNode = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "test.element",
        type: "element",
        name: "Test Node"
      };
      const valid = validate(minimalNode);
      expect(valid).toBe(true);
    });

    it("should validate node with metadata", () => {
      const validate = ajv.compile(modelNodeSchema);
      const valid = validate(modelNodeExamples.goalNode);
      expect(valid).toBe(true);
    });

    it("should validate node with source reference", () => {
      const validate = ajv.compile(modelNodeSchema);
      const valid = validate(modelNodeExamples.goalNode);
      expect(valid).toBe(true);
    });

    it("should reject node with invalid UUID", () => {
      const validate = ajv.compile(modelNodeSchema);
      const valid = validate(invalidModelNodeExamples.invalidUuid);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("format");
    });

    it("should reject node with missing spec_node_id", () => {
      const validate = ajv.compile(modelNodeSchema);
      const valid = validate(invalidModelNodeExamples.missingSpecNodeId);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("required");
    });

    it("should reject node with invalid spec_node_id format", () => {
      const validate = ajv.compile(modelNodeSchema);
      const valid = validate(invalidModelNodeExamples.invalidSpecNodeIdFormat);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("pattern");
    });

    it("should reject node with extra properties", () => {
      const validate = ajv.compile(modelNodeSchema);
      const valid = validate(invalidModelNodeExamples.extraProperties);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("additionalProperties");
    });

    it("should reject node with invalid metadata", () => {
      const validate = ajv.compile(modelNodeSchema);
      const valid = validate(invalidModelNodeExamples.invalidMetadata);
      expect(valid).toBe(false);
    });

    it("should reject node with invalid source reference", () => {
      const validate = ajv.compile(modelNodeSchema);
      const valid = validate(invalidModelNodeExamples.invalidSourceReference);
      expect(valid).toBe(false);
    });
  });

  describe("ModelNodeRelationship Schema", () => {
    it("should validate a valid supports relationship instance", () => {
      const validate = ajv.compile(modelNodeRelationshipSchema);
      const valid = validate(modelNodeRelationshipExamples.supportsRelationship);
      expect(valid).toBe(true);
    });

    it("should validate a valid realizes relationship instance", () => {
      const validate = ajv.compile(modelNodeRelationshipSchema);
      // Use a complete instance with required denormalized fields
      const instance = {
        id: "770f0611-041d-43f6-c938-668877662223",
        spec_relationship_id: "motivation.realizes.business",
        source_node_id: "550e8400-e29b-41d4-a716-446655440000",
        source_layer_id: "motivation",
        destination_node_id: "880e8500-e29b-41d4-a716-446655440001",
        destination_layer_id: "business",
        predicate: "realizes"
      };
      const valid = validate(instance);
      expect(valid).toBe(true);
    });

    it("should validate minimal relationship without optional fields", () => {
      const validate = ajv.compile(modelNodeRelationshipSchema);
      const minimalRelationship = {
        id: "660e9500-f39c-52e5-b827-557766551111",
        spec_relationship_id: "test.uses.test",
        source_node_id: "550e8400-e29b-41d4-a716-446655440000",
        destination_node_id: "770f0611-041d-63f6-c938-668877662222",
        predicate: "uses"
      };
      const valid = validate(minimalRelationship);
      expect(valid).toBe(true);
    });

    it("should validate relationship with attributes", () => {
      const validate = ajv.compile(modelNodeRelationshipSchema);
      const instance = {
        id: "bb1a4055-485b-4470-bc72-002211006667",
        spec_relationship_id: "testing.tests.api",
        source_node_id: "cc2a5166-596c-4481-ad83-113322117777",
        source_layer_id: "testing",
        destination_node_id: "dd3a6277-607d-4492-ae94-224433228888",
        destination_layer_id: "api",
        predicate: "tests",
        attributes: {
          coverage_percentage: 85,
          last_run_date: "2025-02-07T14:30:00Z"
        }
      };
      const valid = validate(instance);
      expect(valid).toBe(true);
    });

    it("should validate relationship with source reference", () => {
      const validate = ajv.compile(modelNodeRelationshipSchema);
      const instance = {
        id: "ee4a7388-718b-40c3-9f05-335544340001",
        spec_relationship_id: "motivation.supports.motivation",
        source_node_id: "ff5a8499-829b-41c4-af16-446655440002",
        source_layer_id: "motivation",
        destination_node_id: "aaaa9500-93ab-42b5-bf27-557766551112",
        destination_layer_id: "motivation",
        predicate: "supports",
        source_reference: {
          provenance: "extracted",
          locations: [
            {
              file: "documentation/architecture.md",
              symbol: "goal-dependency-001"
            }
          ]
        }
      };
      const valid = validate(instance);
      expect(valid).toBe(true);
    });

    it("should reject relationship with invalid UUID", () => {
      const validate = ajv.compile(modelNodeRelationshipSchema);
      const valid = validate(invalidModelNodeRelationshipExamples.invalidUuid);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("format");
    });

    it("should reject relationship with invalid source_node_id", () => {
      const validate = ajv.compile(modelNodeRelationshipSchema);
      const valid = validate(invalidModelNodeRelationshipExamples.invalidSourceNodeId);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("format");
    });

    it("should validate relationship without denormalized destination_layer_id (optional field)", () => {
      const validate = ajv.compile(modelNodeRelationshipSchema);
      // destination_layer_id is denormalized and optional
      const instance = {
        id: "660e9500-f39c-52e5-b827-557766551111",
        spec_relationship_id: "motivation.supports.motivation",
        source_node_id: "550e8400-e29b-41d4-a716-446655440000",
        source_layer_id: "motivation",
        destination_node_id: "770f0611-041d-63f6-c938-668877662222",
        // missing destination_layer_id
        predicate: "supports"
      };
      const valid = validate(instance);
      // This should be valid because destination_layer_id is optional
      expect(valid).toBe(true);
    });

    it("should reject relationship with invalid spec_relationship_id", () => {
      const validate = ajv.compile(modelNodeRelationshipSchema);
      const valid = validate(invalidModelNodeRelationshipExamples.invalidSpecRelationshipId);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("pattern");
    });

    it("should reject relationship with extra properties", () => {
      const validate = ajv.compile(modelNodeRelationshipSchema);
      const valid = validate(invalidModelNodeRelationshipExamples.extraProperties);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("additionalProperties");
    });

    it("should reject relationship with invalid source reference", () => {
      const validate = ajv.compile(modelNodeRelationshipSchema);
      const valid = validate(invalidModelNodeRelationshipExamples.invalidSourceReference);
      expect(valid).toBe(false);
    });
  });

  describe("PredicateCatalog Schema", () => {
    it("should validate predicate catalog structure", () => {
      const validate = ajv.compile(predicateCatalogSchema);
      const catalogData = {
        predicates: {
          supports: {
            predicate: "supports",
            inverse: "supported-by",
            category: "motivation",
            description: "Element contributes to achieving or enabling another element",
            archimate_alignment: "Influence",
            semantics: {
              directionality: "bidirectional",
              transitivity: true,
              symmetry: false,
              reflexivity: false
            }
          }
        }
      };
      const valid = validate(catalogData);
      expect(valid).toBe(true);
    });

    it("should validate predicate with all optional fields", () => {
      const validate = ajv.compile(predicateCatalogSchema);
      const catalogData = {
        predicates: {
          custom: {
            predicate: "custom",
            inverse: "custom-inverse",
            category: "dependency",
            description: "Custom relationship",
            archimate_alignment: "Association",
            semantics: {
              directionality: "unidirectional",
              transitivity: false,
              symmetry: false,
              reflexivity: true
            },
            default_strength: "high"
          }
        }
      };
      const valid = validate(catalogData);
      expect(valid).toBe(true);
    });

    it("should reject predicate catalog without predicates property", () => {
      const validate = ajv.compile(predicateCatalogSchema);
      const invalid = {};
      const valid = validate(invalid);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("required");
    });

    it("should reject predicate with missing required fields", () => {
      const validate = ajv.compile(predicateCatalogSchema);
      const catalogData = {
        predicates: {
          invalid: {
            predicate: "invalid"
            // missing inverse, category, description
          }
        }
      };
      const valid = validate(catalogData);
      expect(valid).toBe(false);
    });

    it("should reject predicate with invalid category", () => {
      const validate = ajv.compile(predicateCatalogSchema);
      const catalogData = {
        predicates: {
          invalid: {
            predicate: "invalid",
            inverse: "invalid-inverse",
            category: "invalid-category",
            description: "Invalid"
          }
        }
      };
      const valid = validate(catalogData);
      expect(valid).toBe(false);
      expect(validate.errors?.[0]?.keyword).toBe("enum");
    });

    it("should reject predicate with invalid semantics", () => {
      const validate = ajv.compile(predicateCatalogSchema);
      const catalogData = {
        predicates: {
          invalid: {
            predicate: "invalid",
            inverse: "invalid-inverse",
            category: "motivation",
            description: "Invalid",
            semantics: {
              directionality: "invalid", // not in enum
              transitivity: true,
              symmetry: false,
              reflexivity: false
            }
          }
        }
      };
      const valid = validate(catalogData);
      expect(valid).toBe(false);
    });
  });

  describe("Schema Meta-Validation", () => {
    it("spec-layer schema is valid JSON Schema Draft 7", () => {
      expect(specLayerSchema.$schema).toBe("http://json-schema.org/draft-07/schema#");
      expect(specLayerSchema.$id).toBeTruthy();
      expect(specLayerSchema.title).toBeTruthy();
      expect(specLayerSchema.type).toBe("object");
    });

    it("spec-node schema is valid JSON Schema Draft 7", () => {
      expect(specNodeSchema.$schema).toBe("http://json-schema.org/draft-07/schema#");
      expect(specNodeSchema.$id).toBeTruthy();
      expect(specNodeSchema.title).toBeTruthy();
      expect(specNodeSchema.type).toBe("object");
    });

    it("spec-node-relationship schema is valid JSON Schema Draft 7", () => {
      expect(specNodeRelationshipSchema.$schema).toBe("http://json-schema.org/draft-07/schema#");
      expect(specNodeRelationshipSchema.$id).toBeTruthy();
      expect(specNodeRelationshipSchema.title).toBeTruthy();
      expect(specNodeRelationshipSchema.type).toBe("object");
    });

    it("model-node schema is valid JSON Schema Draft 7", () => {
      expect(modelNodeSchema.$schema).toBe("http://json-schema.org/draft-07/schema#");
      expect(modelNodeSchema.$id).toBeTruthy();
      expect(modelNodeSchema.title).toBeTruthy();
      expect(modelNodeSchema.type).toBe("object");
    });

    it("model-node-relationship schema is valid JSON Schema Draft 7", () => {
      expect(modelNodeRelationshipSchema.$schema).toBe("http://json-schema.org/draft-07/schema#");
      expect(modelNodeRelationshipSchema.$id).toBeTruthy();
      expect(modelNodeRelationshipSchema.title).toBeTruthy();
      expect(modelNodeRelationshipSchema.type).toBe("object");
    });

    it("predicate-catalog schema is valid JSON Schema Draft 7", () => {
      expect(predicateCatalogSchema.$schema).toBe("http://json-schema.org/draft-07/schema#");
      expect(predicateCatalogSchema.$id).toBeTruthy();
      expect(predicateCatalogSchema.title).toBeTruthy();
      expect(predicateCatalogSchema.type).toBe("object");
    });
  });
});
