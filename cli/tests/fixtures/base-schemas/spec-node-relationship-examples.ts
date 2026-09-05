/**
 * Test fixtures for SpecNodeRelationship schema examples
 * Provides valid example relationship type definitions for schema validation
 */

export const specNodeRelationshipExamples = {
  supportsRelationship: {
    id: "motivation.supports.motivation",
    source_spec_node_id: "motivation.goal",
    source_layer: "motivation",
    destination_spec_node_id: "motivation.goal",
    destination_layer: "motivation",
    predicate: "supports",
    cardinality: "many-to-many",
    strength: "high",
    required: false,
    attributes: {
      reason: {
        type: "string",
        description: "Explanation for why this goal supports another",
      },
    },
  },

  realizesRelationship: {
    id: "motivation.realizes.business",
    source_spec_node_id: "motivation.goal",
    source_layer: "motivation",
    destination_spec_node_id: "business.service",
    destination_layer: "business",
    predicate: "realizes",
    cardinality: "many-to-one",
    strength: "high",
  },

  implementsRelationship: {
    id: "api.implements.data-model",
    source_spec_node_id: "api.endpoint",
    source_layer: "api",
    destination_spec_node_id: "data-model.entity",
    destination_layer: "data-model",
    predicate: "implements",
    cardinality: "one-to-many",
    strength: "critical",
    required: true,
  },

  persistsRelationship: {
    id: "data-model.persists-to.data-store",
    source_spec_node_id: "data-model.entity",
    source_layer: "data-model",
    destination_spec_node_id: "data-store.table",
    destination_layer: "data-store",
    predicate: "persists-to",
    cardinality: "one-to-one",
    strength: "critical",
  },

  testsRelationship: {
    id: "testing.tests.api",
    source_spec_node_id: "testing.test-case",
    source_layer: "testing",
    destination_spec_node_id: "api.endpoint",
    destination_layer: "api",
    predicate: "tests",
    cardinality: "many-to-many",
    strength: "medium",
  },

  minimalRelationship: {
    id: "custom.uses.custom",
    source_spec_node_id: "custom.element",
    destination_spec_node_id: "custom.element",
    predicate: "uses",
  },

  consumesRelationship: {
    id: "application.consumes.api",
    source_spec_node_id: "application.service",
    source_layer: "application",
    destination_spec_node_id: "api.endpoint",
    destination_layer: "api",
    predicate: "consumes",
    cardinality: "many-to-many",
    strength: "high",
    required: false,
    attributes: {
      frequency: {
        type: "enum",
        enum_values: ["realtime", "frequent", "occasional", "rare"],
        description: "How often this relationship is used",
      },
    },
  },
};

export const invalidSpecNodeRelationshipExamples = {
  invalidId: {
    id: "invalid_format", // missing dots
    source_spec_node_id: "motivation.goal",
    source_layer: "motivation",
    destination_spec_node_id: "motivation.goal",
    destination_layer: "motivation",
    predicate: "supports",
  },

  missingSourceLayer: {
    id: "motivation.supports.motivation",
    source_spec_node_id: "motivation.goal",
    // missing source_layer
    destination_spec_node_id: "motivation.goal",
    destination_layer: "motivation",
    predicate: "supports",
  },

  invalidCardinality: {
    id: "motivation.supports.motivation",
    source_spec_node_id: "motivation.goal",
    source_layer: "motivation",
    destination_spec_node_id: "motivation.goal",
    destination_layer: "motivation",
    predicate: "supports",
    cardinality: "invalid-cardinality", // not in enum
  },

  invalidStrength: {
    id: "motivation.supports.motivation",
    source_spec_node_id: "motivation.goal",
    source_layer: "motivation",
    destination_spec_node_id: "motivation.goal",
    destination_layer: "motivation",
    predicate: "supports",
    strength: "super-high", // not in enum
  },

  extraProperties: {
    id: "motivation.supports.motivation",
    source_spec_node_id: "motivation.goal",
    source_layer: "motivation",
    destination_spec_node_id: "motivation.goal",
    destination_layer: "motivation",
    predicate: "supports",
    extra_field: "not allowed",
  },
};
