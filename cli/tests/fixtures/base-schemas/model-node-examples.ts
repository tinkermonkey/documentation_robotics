/**
 * Test fixtures for ModelNode schema examples
 * Provides valid example node instances for schema validation
 */

export const modelNodeExamples = {
  goalNode: {
    id: "550e8400-e29b-41d4-a716-446655440000",
    spec_node_id: "motivation.goal",
    type: "goal",
    layer_id: "motivation",
    name: "Improve Customer Satisfaction",
    description: "Increase customer satisfaction scores to 95% by end of year",
    attributes: {
      priority: "high",
      owner: "Product Team",
      target_date: "2025-12-31"
    },
    source_reference: {
      provenance: "manual",
      locations: [
        {
          file: "roadmap/2025-goals.md",
          symbol: "customer-satisfaction"
        }
      ],
      repository: {
        url: "https://github.com/example/project",
        commit: "abc123def456abc123def456abc123def456abc1"
      }
    },
    metadata: {
      created_at: "2025-01-15T10:30:00Z",
      updated_at: "2025-02-07T15:45:00Z",
      created_by: "alice@example.com",
      version: 2
    }
  },

  requirementNode: {
    id: "660e9500-f39c-52e5-b827-557766551111",
    spec_node_id: "motivation.requirement",
    type: "requirement",
    layer_id: "motivation",
    name: "Support Mobile Access",
    description: "System must be accessible on mobile devices",
    attributes: {
      type: "functional",
      status: "approved"
    }
  },

  endpointNode: {
    id: "770f0611-041d-63f6-c938-668877662222",
    spec_node_id: "api.endpoint",
    type: "endpoint",
    layer_id: "api",
    name: "Create Customer",
    attributes: {
      method: "POST",
      path: "/api/v1/customers",
      deprecated: false
    }
  },

  tableNode: {
    id: "880a1722-152e-74a7-d949-779988773333",
    spec_node_id: "data-store.table",
    type: "table",
    layer_id: "data-store",
    name: "customers",
    attributes: {
      columns: 15,
      indexed: true
    }
  },

  testCaseNode: {
    id: "990b2833-263f-85b8-ea50-880099884444",
    spec_node_id: "testing.test-case",
    type: "test-case",
    layer_id: "testing",
    name: "User Login Happy Path",
    attributes: {
      status: "active",
      complexity: "simple"
    }
  },

  minimalNode: {
    id: "aa0c3944-374d-96c9-fb61-991100995555",
    spec_node_id: "custom.element",
    type: "element",
    layer_id: "custom",
    name: "Minimal Element"
  },

  nodeWithoutMetadata: {
    id: "bb1d4055-485e-07d0-ac72-002211006666",
    spec_node_id: "motivation.goal",
    type: "goal",
    layer_id: "motivation",
    name: "Another Goal"
  },

  entityNode: {
    id: "cc2e5166-596f-18e1-ad83-113322117777",
    spec_node_id: "data-model.entity",
    type: "entity",
    layer_id: "data-model",
    name: "Customer",
    attributes: {
      abstract: false,
      version: 3,
      tags: ["core", "high-volume"]
    },
    metadata: {
      created_at: "2024-06-01T08:00:00Z",
      version: 1
    }
  }
};

export const invalidModelNodeExamples = {
  invalidUuid: {
    id: "not-a-uuid",
    spec_node_id: "motivation.goal",
    type: "goal",
    layer_id: "motivation",
    name: "Invalid"
  },

  missingSpecNodeId: {
    id: "550e8400-e29b-41d4-a716-446655440000",
    // missing spec_node_id
    type: "goal",
    layer_id: "motivation",
    name: "Invalid"
  },

  invalidSpecNodeIdFormat: {
    id: "550e8400-e29b-41d4-a716-446655440000",
    spec_node_id: "invalid_format", // missing dot
    type: "goal",
    layer_id: "motivation",
    name: "Invalid"
  },

  extraProperties: {
    id: "550e8400-e29b-41d4-a716-446655440000",
    spec_node_id: "motivation.goal",
    type: "goal",
    layer_id: "motivation",
    name: "Invalid",
    extra_field: "should not be allowed"
  },

  invalidMetadata: {
    id: "550e8400-e29b-41d4-a716-446655440000",
    spec_node_id: "motivation.goal",
    type: "goal",
    layer_id: "motivation",
    name: "Invalid",
    metadata: {
      created_at: "not-a-date-time",
      version: "not-an-integer"
    }
  },

  invalidSourceReference: {
    id: "550e8400-e29b-41d4-a716-446655440000",
    spec_node_id: "motivation.goal",
    type: "goal",
    layer_id: "motivation",
    name: "Invalid",
    source_reference: {
      provenance: "invalid-provenance", // not in enum
      locations: [{ file: "test.txt" }]
    }
  }
};
