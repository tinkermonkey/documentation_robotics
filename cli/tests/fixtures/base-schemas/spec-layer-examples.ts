/**
 * Test fixtures for SpecLayer schema examples
 * Provides valid example layer definitions for schema validation
 */

export const specLayerExamples = {
  motivationLayer: {
    id: "motivation",
    number: 1,
    name: "Motivation Layer",
    description: "Captures stakeholder concerns, goals, requirements, and constraints that drive architectural decisions using ArchiMate motivation elements.",
    inspired_by: {
      standard: "ArchiMate 3.2",
      version: "3.2",
      url: "https://pubs.opengroup.org/architecture/archimate32-doc/"
    },
    node_types: [
      "motivation.goal",
      "motivation.requirement",
      "motivation.constraint",
      "motivation.stakeholder",
      "motivation.driver"
    ]
  },

  businessLayer: {
    id: "business",
    number: 2,
    name: "Business Layer",
    description: "Captures business processes, services, and organizational structures.",
    inspired_by: {
      standard: "ArchiMate 3.2",
      version: "3.2",
      url: "https://pubs.opengroup.org/architecture/archimate32-doc/"
    },
    node_types: ["business.service", "business.process", "business.actor"]
  },

  dataModelLayer: {
    id: "data-model",
    number: 7,
    name: "Data Model Layer",
    description: "Defines entities, attributes, and relationships in the logical data model.",
    inspired_by: {
      standard: "JSON Schema Draft 7",
      version: "Draft 7",
      url: "https://json-schema.org/"
    },
    node_types: ["data-model.entity", "data-model.value-object"]
  },

  dataStoreLayer: {
    id: "data-store",
    number: 8,
    name: "Data Store Layer",
    description: "Represents physical database schemas and storage structures.",
    node_types: ["data-store.table", "data-store.index", "data-store.view"]
  },

  apiLayer: {
    id: "api",
    number: 6,
    name: "API Layer",
    description: "Defines REST APIs and operation contracts.",
    inspired_by: {
      standard: "OpenAPI 3.0",
      version: "3.0.0",
      url: "https://spec.openapis.org/oas/v3.0.0"
    },
    node_types: ["api.endpoint", "api.schema"]
  },

  testingLayer: {
    id: "testing",
    number: 12,
    name: "Testing Layer",
    description: "Defines test strategies, test cases, and test data structures.",
    node_types: ["testing.test-case", "testing.test-suite"]
  },

  minimalLayer: {
    id: "minimal",
    number: 13,
    name: "Minimal Layer",
    description: "Layer with only required fields"
  }
};

export const invalidSpecLayerExamples = {
  invalidId: {
    id: "Invalid-Id", // starts with uppercase
    number: 1,
    name: "Invalid",
    description: "Invalid ID pattern"
  },

  invalidNumber: {
    id: "valid",
    number: 0, // must be >= 1
    name: "Invalid",
    description: "Invalid number"
  },

  missingRequired: {
    id: "valid",
    // missing number
    name: "Invalid",
    description: "Missing required field"
  },

  extraProperties: {
    id: "valid",
    number: 1,
    name: "Invalid",
    description: "Has extra property",
    extra_field: "should not be allowed"
  },

  invalidNodeTypeRef: {
    id: "valid",
    number: 1,
    name: "Valid",
    description: "Valid",
    node_types: [
      "invalid-node-id-format", // missing dot
      "valid.node"
    ]
  }
};
