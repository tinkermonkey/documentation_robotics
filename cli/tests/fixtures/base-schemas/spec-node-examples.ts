/**
 * Test fixtures for SpecNode schema examples
 * Provides valid example node type definitions for schema validation
 */

export const specNodeExamples = {
  goalNode: {
    id: "motivation.goal",
    layer_id: "motivation",
    name: "Goal",
    description: "A goal is an end state or outcome that a stakeholder wants to achieve",
    attributes: {
      priority: {
        type: "enum",
        enum_values: ["critical", "high", "medium", "low"],
        description: "Priority level of the goal"
      },
      owner: {
        type: "string",
        description: "Team or person responsible for achieving this goal"
      },
      target_date: {
        type: "string",
        format: "date",
        description: "Target date for goal achievement"
      }
    },
    required_attributes: ["priority"]
  },

  requirementNode: {
    id: "motivation.requirement",
    layer_id: "motivation",
    name: "Requirement",
    description: "A specific, measurable requirement derived from a goal",
    attributes: {
      type: {
        type: "enum",
        enum_values: ["functional", "non-functional", "constraint"],
        description: "Type of requirement"
      },
      status: {
        type: "enum",
        enum_values: ["proposed", "approved", "implemented", "deprecated"],
        description: "Status of the requirement",
        default: "proposed"
      }
    }
  },

  endpointNode: {
    id: "api.endpoint",
    layer_id: "api",
    name: "Endpoint",
    description: "A REST API endpoint",
    attributes: {
      method: {
        type: "enum",
        enum_values: ["GET", "POST", "PUT", "DELETE", "PATCH"],
        description: "HTTP method"
      },
      path: {
        type: "string",
        description: "URL path"
      },
      deprecated: {
        type: "boolean",
        description: "Whether this endpoint is deprecated",
        default: false
      }
    },
    required_attributes: ["method", "path"]
  },

  tableNode: {
    id: "data-store.table",
    layer_id: "data-store",
    name: "Table",
    description: "A database table",
    attributes: {
      columns: {
        type: "integer",
        description: "Number of columns"
      },
      indexed: {
        type: "boolean",
        description: "Whether table has primary index"
      }
    }
  },

  testCaseNode: {
    id: "testing.test-case",
    layer_id: "testing",
    name: "Test Case",
    description: "A single test case",
    attributes: {
      status: {
        type: "enum",
        enum_values: ["active", "inactive", "archived"],
        description: "Status of test case",
        default: "active"
      },
      complexity: {
        type: "enum",
        enum_values: ["simple", "moderate", "complex"],
        description: "Complexity level"
      }
    }
  },

  minimalNode: {
    id: "custom.minimal",
    layer_id: "custom",
    name: "Minimal Node",
    description: "Node with minimal attributes",
    attributes: {}
  },

  entityNode: {
    id: "data-model.entity",
    layer_id: "data-model",
    name: "Entity",
    description: "A logical data entity",
    attributes: {
      abstract: {
        type: "boolean",
        description: "Whether this is an abstract entity",
        default: false
      },
      version: {
        type: "integer",
        description: "Schema version"
      },
      tags: {
        type: "array",
        description: "Metadata tags"
      }
    }
  }
};

export const invalidSpecNodeExamples = {
  invalidId: {
    id: "invalid_format", // missing dot
    layer_id: "test",
    name: "Invalid",
    description: "Invalid ID format",
    attributes: {}
  },

  mismatchedLayerId: {
    id: "motivation.goal",
    layer_id: "business", // doesn't match prefix
    name: "Invalid",
    description: "Layer ID mismatch",
    attributes: {}
  },

  invalidAttributeType: {
    id: "test.node",
    layer_id: "test",
    name: "Invalid",
    description: "Invalid attribute type",
    attributes: {
      bad_attr: {
        type: "invalid-type", // not in enum
        description: "Bad type"
      }
    }
  },

  enumWithoutValues: {
    id: "test.node",
    layer_id: "test",
    name: "Invalid",
    description: "Enum without values",
    attributes: {
      status: {
        type: "enum",
        description: "Missing enum_values"
        // missing enum_values
      }
    }
  },

  missingDescription: {
    id: "test.node",
    layer_id: "test",
    name: "Invalid",
    // missing description
    attributes: {}
  },

  invalidRequiredAttribute: {
    id: "test.node",
    layer_id: "test",
    name: "Valid",
    description: "Has invalid required attribute reference",
    attributes: {
      existing: {
        type: "string",
        description: "An existing attribute"
      }
    },
    required_attributes: ["nonexistent"] // references non-existent attribute
  }
};
