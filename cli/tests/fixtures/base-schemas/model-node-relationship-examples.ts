/**
 * Test fixtures for ModelNodeRelationship schema examples
 * Provides valid example relationship instances for schema validation
 */

export const modelNodeRelationshipExamples = {
  supportsRelationship: {
    id: "660e9500-f39c-52e5-b827-557766551111",
    spec_relationship_id: "motivation.supports.motivation",
    source_node_id: "550e8400-e29b-41d4-a716-446655440000",
    source_layer_id: "motivation",
    destination_node_id: "770f0611-041d-63f6-c938-668877662222",
    destination_layer_id: "motivation",
    predicate: "supports",
    attributes: {
      reason: "Higher-level goal depends on achieving this supporting goal"
    }
  },

  realizesRelationship: {
    id: "770f0611-041d-63f6-c938-668877662223",
    spec_relationship_id: "motivation.realizes.business",
    source_node_id: "550e8400-e29b-41d4-a716-446655440000",
    source_layer_id: "motivation",
    destination_node_id: "880g1722-152e-74g7-d949-779988773333",
    destination_layer_id: "business",
    predicate: "realizes"
  },

  implementsRelationship: {
    id: "880g1722-152e-74g7-d949-779988773334",
    spec_relationship_id: "api.implements.data-model",
    source_node_id: "990h2833-263f-85h8-ea50-880099884444",
    source_layer_id: "api",
    destination_node_id: "aa0i3944-374g-96i9-fb61-991100995555",
    destination_layer_id: "data-model",
    predicate: "implements"
  },

  persistsRelationship: {
    id: "aa0i3944-374g-96i9-fb61-991100995556",
    spec_relationship_id: "data-model.persists-to.data-store",
    source_node_id: "bb1j4055-485h-07j0-gc72-002211006666",
    source_layer_id: "data-model",
    destination_node_id: "cc2k5166-596i-18k1-hd83-113322117777",
    destination_layer_id: "data-store",
    predicate: "persists-to"
  },

  testsRelationship: {
    id: "bb1j4055-485h-07j0-gc72-002211006667",
    spec_relationship_id: "testing.tests.api",
    source_node_id: "cc2k5166-596i-18k1-hd83-113322117777",
    source_layer_id: "testing",
    destination_node_id: "dd3l6277-607j-29l2-ie94-224433228888",
    destination_layer_id: "api",
    predicate: "tests",
    attributes: {
      coverage_percentage: 85,
      last_run_date: "2025-02-07T14:30:00Z"
    }
  },

  consumesRelationship: {
    id: "cc2k5166-596i-18k1-hd83-113322117778",
    spec_relationship_id: "application.consumes.api",
    source_node_id: "dd3l6277-607j-29l2-ie94-224433228889",
    source_layer_id: "application",
    destination_node_id: "ee4m7388-718k-30m3-jf05-335544339999",
    destination_layer_id: "api",
    predicate: "consumes",
    attributes: {
      frequency: "frequent"
    },
    metadata: {
      created_at: "2025-01-10T09:00:00Z",
      updated_at: "2025-02-07T14:30:00Z",
      created_by: "architect@example.com",
      version: 3
    }
  },

  minimalRelationship: {
    id: "dd3l6277-607j-29l2-ie94-224433228890",
    spec_relationship_id: "custom.uses.custom",
    source_node_id: "ee4m7388-718k-30m3-jf05-335544340000",
    source_layer_id: "custom",
    destination_node_id: "ff5n8499-829l-41n4-kg16-446655440001",
    destination_layer_id: "custom",
    predicate: "uses"
  },

  relationshipWithSourceReference: {
    id: "ee4m7388-718k-30m3-jf05-335544340001",
    spec_relationship_id: "motivation.supports.motivation",
    source_node_id: "ff5n8499-829l-41n4-kg16-446655440002",
    source_layer_id: "motivation",
    destination_node_id: "gg6o9500-93am-52o5-lh27-557766551112",
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
  }
};

export const invalidModelNodeRelationshipExamples = {
  invalidUuid: {
    id: "not-a-uuid",
    spec_relationship_id: "motivation.supports.motivation",
    source_node_id: "550e8400-e29b-41d4-a716-446655440000",
    source_layer_id: "motivation",
    destination_node_id: "770f0611-041d-63f6-c938-668877662222",
    destination_layer_id: "motivation",
    predicate: "supports"
  },

  invalidSourceNodeId: {
    id: "660e9500-f39c-52e5-b827-557766551111",
    spec_relationship_id: "motivation.supports.motivation",
    source_node_id: "not-a-uuid",
    source_layer_id: "motivation",
    destination_node_id: "770f0611-041d-63f6-c938-668877662222",
    destination_layer_id: "motivation",
    predicate: "supports"
  },

  missingDestinationLayer: {
    id: "660e9500-f39c-52e5-b827-557766551111",
    spec_relationship_id: "motivation.supports.motivation",
    source_node_id: "550e8400-e29b-41d4-a716-446655440000",
    source_layer_id: "motivation",
    destination_node_id: "770f0611-041d-63f6-c938-668877662222",
    // missing destination_layer_id
    predicate: "supports"
  },

  invalidSpecRelationshipId: {
    id: "660e9500-f39c-52e5-b827-557766551111",
    spec_relationship_id: "invalid_format", // missing dots
    source_node_id: "550e8400-e29b-41d4-a716-446655440000",
    source_layer_id: "motivation",
    destination_node_id: "770f0611-041d-63f6-c938-668877662222",
    destination_layer_id: "motivation",
    predicate: "supports"
  },

  invalidSourceReference: {
    id: "660e9500-f39c-52e5-b827-557766551111",
    spec_relationship_id: "motivation.supports.motivation",
    source_node_id: "550e8400-e29b-41d4-a716-446655440000",
    source_layer_id: "motivation",
    destination_node_id: "770f0611-041d-63f6-c938-668877662222",
    destination_layer_id: "motivation",
    predicate: "supports",
    source_reference: {
      provenance: "invalid-provenance", // not in enum
      locations: [{ file: "test.txt" }]
    }
  },

  extraProperties: {
    id: "660e9500-f39c-52e5-b827-557766551111",
    spec_relationship_id: "motivation.supports.motivation",
    source_node_id: "550e8400-e29b-41d4-a716-446655440000",
    source_layer_id: "motivation",
    destination_node_id: "770f0611-041d-63f6-c938-668877662222",
    destination_layer_id: "motivation",
    predicate: "supports",
    extra_field: "not allowed"
  }
};
