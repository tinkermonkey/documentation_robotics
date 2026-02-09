/**
 * Test fixtures for SpecNode per-type schema examples
 * Provides valid example per-type JSON Schemas for schema validation
 *
 * These schemas extend spec-node.schema.json (the base schema) via allOf,
 * and add type-specific attribute constraints.
 */

export const specNodeExamples = {
  goalNode: {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://github.com/tinkermonkey/documentation_robotics/spec/nodes/motivation/goal.node.schema.json",
    title: "Goal",
    description:
      "A goal is an end state or outcome that a stakeholder wants to achieve",
    allOf: [{ $ref: "../../schemas/base/spec-node.schema.json" }],
    properties: {
      spec_node_id: { const: "motivation.goal" },
      layer_id: { const: "motivation" },
      type: { const: "goal" },
      attributes: {
        type: "object",
        properties: {
          priority: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
            description: "Priority level of the goal",
          },
          owner: {
            type: "string",
            description: "Team or person responsible for achieving this goal",
          },
          target_date: {
            type: "string",
            format: "date",
            description: "Target date for goal achievement",
          },
        },
        required: ["priority"],
        additionalProperties: false,
      },
    },
  },

  requirementNode: {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://github.com/tinkermonkey/documentation_robotics/spec/nodes/motivation/requirement.node.schema.json",
    title: "Requirement",
    description: "A specific, measurable requirement derived from a goal",
    allOf: [{ $ref: "../../schemas/base/spec-node.schema.json" }],
    properties: {
      spec_node_id: { const: "motivation.requirement" },
      layer_id: { const: "motivation" },
      type: { const: "requirement" },
      attributes: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["functional", "non-functional", "constraint"],
            description: "Type of requirement",
          },
          status: {
            type: "string",
            enum: ["proposed", "approved", "implemented", "deprecated"],
            description: "Status of the requirement",
            default: "proposed",
          },
        },
        additionalProperties: false,
      },
    },
  },

  endpointNode: {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://github.com/tinkermonkey/documentation_robotics/spec/nodes/api/endpoint.node.schema.json",
    title: "Endpoint",
    description: "A REST API endpoint",
    allOf: [{ $ref: "../../schemas/base/spec-node.schema.json" }],
    properties: {
      spec_node_id: { const: "api.endpoint" },
      layer_id: { const: "api" },
      type: { const: "endpoint" },
      attributes: {
        type: "object",
        properties: {
          method: {
            type: "string",
            enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
            description: "HTTP method",
          },
          path: {
            type: "string",
            description: "URL path",
          },
          deprecated: {
            type: "boolean",
            description: "Whether this endpoint is deprecated",
            default: false,
          },
        },
        required: ["method", "path"],
        additionalProperties: false,
      },
    },
  },

  tableNode: {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://github.com/tinkermonkey/documentation_robotics/spec/nodes/data-store/table.node.schema.json",
    title: "Table",
    description: "A database table",
    allOf: [{ $ref: "../../schemas/base/spec-node.schema.json" }],
    properties: {
      spec_node_id: { const: "data-store.table" },
      layer_id: { const: "data-store" },
      type: { const: "table" },
      attributes: {
        type: "object",
        properties: {
          columns: {
            type: "integer",
            description: "Number of columns",
          },
          indexed: {
            type: "boolean",
            description: "Whether table has primary index",
          },
        },
        additionalProperties: false,
      },
    },
  },

  testCaseNode: {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://github.com/tinkermonkey/documentation_robotics/spec/nodes/testing/test-case.node.schema.json",
    title: "Test Case",
    description: "A single test case",
    allOf: [{ $ref: "../../schemas/base/spec-node.schema.json" }],
    properties: {
      spec_node_id: { const: "testing.test-case" },
      layer_id: { const: "testing" },
      type: { const: "test-case" },
      attributes: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["active", "inactive", "archived"],
            description: "Status of test case",
            default: "active",
          },
          complexity: {
            type: "string",
            enum: ["simple", "moderate", "complex"],
            description: "Complexity level",
          },
        },
        additionalProperties: false,
      },
    },
  },

  minimalNode: {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://github.com/tinkermonkey/documentation_robotics/spec/nodes/custom/minimal.node.schema.json",
    title: "Minimal Node",
    description: "Node with minimal attributes",
    allOf: [{ $ref: "../../schemas/base/spec-node.schema.json" }],
    properties: {
      spec_node_id: { const: "custom.minimal" },
      layer_id: { const: "custom" },
      type: { const: "minimal" },
      attributes: {
        type: "object",
        additionalProperties: false,
      },
    },
  },

  entityNode: {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://github.com/tinkermonkey/documentation_robotics/spec/nodes/data-model/entity.node.schema.json",
    title: "Entity",
    description: "A logical data entity",
    allOf: [{ $ref: "../../schemas/base/spec-node.schema.json" }],
    properties: {
      spec_node_id: { const: "data-model.entity" },
      layer_id: { const: "data-model" },
      type: { const: "entity" },
      attributes: {
        type: "object",
        properties: {
          abstract: {
            type: "boolean",
            description: "Whether this is an abstract entity",
            default: false,
          },
          version: {
            type: "integer",
            description: "Schema version",
          },
          tags: {
            type: "array",
            description: "Metadata tags",
          },
        },
        additionalProperties: false,
      },
    },
  },
};

export const invalidSpecNodeExamples = {
  /** Per-type schema missing allOf (no base reference) */
  missingAllOf: {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://example.com/test.node.schema.json",
    title: "Invalid",
    description: "Missing allOf reference to base schema",
    properties: {
      spec_node_id: { const: "test.node" },
      layer_id: { const: "test" },
      type: { const: "node" },
      attributes: {
        type: "object",
        additionalProperties: false,
      },
    },
  },

  /** Per-type schema with invalid attribute property type */
  invalidAttributeProperty: {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://example.com/test2.node.schema.json",
    title: "Invalid",
    description: "Invalid attribute property type",
    allOf: [{ $ref: "../../schemas/base/spec-node.schema.json" }],
    properties: {
      spec_node_id: { const: "test.node" },
      layer_id: { const: "test" },
      type: { const: "node" },
      attributes: {
        type: "object",
        properties: {
          bad_attr: {
            type: "invalid-type",
            description: "Bad type",
          },
        },
        additionalProperties: false,
      },
    },
  },
};
