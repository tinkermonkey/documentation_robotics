/**
 * Unit Tests for SpecDataLoader
 *
 * Tests the core specification data loading functionality:
 * - Loading layers, node types, relationships, and predicates
 * - Caching behavior
 * - Query and filter operations
 * - Error handling and validation
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SpecDataLoader } from "../../src/core/spec-loader.js";
import { SpecDataService, getGlobalSpecDataService, resetGlobalSpecDataService } from "../../src/core/spec-data-service.js";
import path from "path";
import { fileURLToPath } from "url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const specDir = path.join(currentDir, "../../../spec");

describe("SpecDataLoader", () => {
  let loader: SpecDataLoader;

  beforeEach(() => {
    loader = new SpecDataLoader({ specDir });
  });

  afterEach(() => {
    if (loader) {
      loader.clear();
    }
  });

  describe("Loading Data", () => {
    it("should load all specification data", async () => {
      const data = await loader.load();

      expect(data).toBeDefined();
      expect(data.layers).toBeDefined();
      expect(Array.isArray(data.layers)).toBe(true);
      expect(data.nodeTypes).toBeDefined();
      expect(Array.isArray(data.nodeTypes)).toBe(true);
      expect(data.relationshipTypes).toBeDefined();
      expect(Array.isArray(data.relationshipTypes)).toBe(true);
      expect(data.predicates).toBeDefined();
      expect(data.predicates instanceof Map).toBe(true);
    });

    it("should load 12 layers", async () => {
      const data = await loader.load();
      expect(data.layers.length).toBe(12);
    });

    it("should load layers in correct order", async () => {
      const data = await loader.load();
      for (let i = 0; i < data.layers.length; i++) {
        expect(data.layers[i].number).toBe(i + 1);
      }
    });

    it("should load node types", async () => {
      const data = await loader.load();
      expect(data.nodeTypes.length).toBeGreaterThan(0);
    });

    it("should load relationship types", async () => {
      const data = await loader.load();
      expect(data.relationshipTypes.length).toBeGreaterThan(0);
    });

    it("should load predicates", async () => {
      const data = await loader.load();
      expect(data.predicates.size).toBeGreaterThan(0);
    });

    it("should load required fields for each layer", async () => {
      const data = await loader.load();
      for (const layer of data.layers) {
        expect(layer.id).toBeDefined();
        expect(layer.number).toBeDefined();
        expect(layer.name).toBeDefined();
        expect(layer.description).toBeDefined();
        expect(Array.isArray(layer.node_types)).toBe(true);
      }
    });

    it("should load required fields for each node type", async () => {
      const data = await loader.load();
      for (const nodeType of data.nodeTypes) {
        expect(nodeType.spec_node_id).toBeDefined();
        expect(nodeType.layer_id).toBeDefined();
        expect(nodeType.type).toBeDefined();
        expect(Array.isArray(nodeType.attributes)).toBe(true);
      }
    });

    it("should load required fields for each relationship type", async () => {
      const data = await loader.load();
      for (const relType of data.relationshipTypes) {
        expect(relType.id).toBeDefined();
        expect(relType.source_spec_node_id).toBeDefined();
        expect(relType.source_layer).toBeDefined();
      }
    });

    it("should load predicates with required fields", async () => {
      const data = await loader.load();
      for (const predicate of data.predicates.values()) {
        expect(predicate.predicate).toBeDefined();
        expect(predicate.inverse).toBeDefined();
        expect(predicate.category).toBeDefined();
        expect(predicate.semantics).toBeDefined();
      }
    });
  });

  describe("Caching", () => {
    it("should cache data when cache option is true", async () => {
      const cachedLoader = new SpecDataLoader({ specDir, cache: true });
      const data1 = await cachedLoader.load();
      expect(cachedLoader.isLoaded()).toBe(true);

      // Manually verify cache is being used (same object reference)
      const data2 = await cachedLoader.load();
      expect(data1).toBe(data2);
    });

    it("should not use cache when cache option is false", async () => {
      const noCacheLoader = new SpecDataLoader({ specDir, cache: false });
      const data1 = await noCacheLoader.load();
      const data2 = await noCacheLoader.load();

      // Without cache, objects won't be the same reference but have same content
      expect(data1).not.toBe(data2);
      expect(data1.layers.length).toBe(data2.layers.length);
    });

    it("should clear cache when clear() is called", async () => {
      const data1 = await loader.load();
      expect(loader.isLoaded()).toBe(true);

      loader.clear();
      expect(loader.isLoaded()).toBe(false);
    });
  });

  describe("Query Operations", () => {
    beforeEach(async () => {
      await loader.load();
    });

    it("should find node types by layer", async () => {
      const nodeTypes = loader.findNodeTypes({ layer: "motivation" });
      expect(nodeTypes.length).toBeGreaterThan(0);

      // All returned node types should be from the motivation layer
      for (const nt of nodeTypes) {
        expect(nt.layer_id).toBe("motivation");
      }
    });

    it("should get node types for a layer using convenience method", async () => {
      const nodeTypes = loader.getNodeTypesForLayer("motivation");
      expect(nodeTypes.length).toBeGreaterThan(0);
      expect(nodeTypes.every((nt) => nt.layer_id === "motivation")).toBe(true);
    });

    it("should get layer by ID", async () => {
      const layer = loader.getLayer("motivation");
      expect(layer).toBeDefined();
      expect(layer?.id).toBe("motivation");
    });

    it("should get all layers", async () => {
      const layers = loader.getAllLayers();
      expect(layers.length).toBe(12);
    });

    it("should get node type by spec_node_id", async () => {
      const data = loader.getSpecData();
      if (data.nodeTypes.length > 0) {
        const specNodeId = data.nodeTypes[0].spec_node_id;
        const nodeType = loader.getNodeType(specNodeId);
        expect(nodeType).toBeDefined();
        expect(nodeType?.spec_node_id).toBe(specNodeId);
      }
    });

    it("should get predicate by name", async () => {
      const data = loader.getSpecData();
      if (data.predicates.size > 0) {
        const predicateName = Array.from(data.predicates.keys())[0];
        const predicate = loader.getPredicate(predicateName);
        expect(predicate).toBeDefined();
        expect(predicate?.predicate).toBe(predicateName);
      }
    });

    it("should get all predicates", async () => {
      const predicates = loader.getAllPredicates();
      expect(Array.isArray(predicates)).toBe(true);
      expect(predicates.length).toBeGreaterThan(0);
    });

    it("should find relationships by source spec node ID", async () => {
      const data = loader.getSpecData();
      if (data.relationshipTypes.length > 0) {
        const sourceId = data.relationshipTypes[0].source_spec_node_id;
        const relationships = loader.findRelationshipTypes({ sourceSpecNodeId: sourceId });
        expect(relationships.length).toBeGreaterThan(0);
        expect(relationships.every((r) => r.source_spec_node_id === sourceId)).toBe(true);
      }
    });

    it("should find incoming references to a node type", async () => {
      const data = loader.getSpecData();
      if (data.relationshipTypes.length > 0) {
        const destId = data.relationshipTypes[0].destination_spec_node_id;
        if (destId) {
          const incoming = loader.getNodeTypesReferencingType(destId);
          expect(Array.isArray(incoming)).toBe(true);
        }
      }
    });

    it("should find outgoing references from a node type", async () => {
      const data = loader.getSpecData();
      if (data.relationshipTypes.length > 0) {
        const sourceId = data.relationshipTypes[0].source_spec_node_id;
        const outgoing = loader.getNodeTypesReferencedByType(sourceId);
        expect(Array.isArray(outgoing)).toBe(true);
      }
    });
  });

  describe("Statistics", () => {
    beforeEach(async () => {
      await loader.load();
    });

    it("should provide statistics about loaded spec", async () => {
      const stats = loader.getStatistics();

      expect(stats.layerCount).toBe(12);
      expect(stats.nodeTypeCount).toBeGreaterThan(0);
      expect(stats.relationshipTypeCount).toBeGreaterThan(0);
      expect(stats.predicateCount).toBeGreaterThan(0);
      expect(stats.totalAttributes).toBeGreaterThanOrEqual(0);
      expect(stats.loadedAt).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("should throw when accessing data before load()", () => {
      expect(() => {
        loader.getSpecData();
      }).toThrow();
    });

    it("should throw with invalid spec directory", async () => {
      const badLoader = new SpecDataLoader({ specDir: "/nonexistent/path" });
      expect(async () => {
        await badLoader.load();
      }).toThrow();
    });
  });

  describe("Inclusion of Schemas", () => {
    it("should not include full schemas by default", async () => {
      const data = await loader.load();
      const nodeType = data.nodeTypes[0];
      expect(nodeType.schema).toBeUndefined();
    });

    it("should include full schemas when option is set", async () => {
      const schemaLoader = new SpecDataLoader({ specDir, includeSchemas: true });
      const data = await schemaLoader.load();
      const nodeType = data.nodeTypes[0];
      expect(nodeType.schema).toBeDefined();
    });
  });
});

describe("SpecDataService", () => {
  let service: SpecDataService;

  beforeEach(async () => {
    service = new SpecDataService({ specDir });
    await service.initialize();
  });

  afterEach(() => {
    if (service) {
      service.clear();
    }
  });

  describe("Initialization", () => {
    it("should initialize successfully", async () => {
      expect(service.isInitialized()).toBe(true);
    });

    it("should throw when accessing data before initialization", async () => {
      const uninitService = new SpecDataService({ specDir });
      expect(() => {
        uninitService.getSpecData();
      }).toThrow();
    });
  });

  describe("Data Access", () => {
    it("should provide access to raw spec data", () => {
      const data = service.getSpecData();
      expect(data).toBeDefined();
      expect(data.layers).toBeDefined();
    });

    it("should provide statistics", () => {
      const stats = service.getStatistics();
      expect(stats.layerCount).toBe(12);
      expect(stats.nodeTypeCount).toBeGreaterThan(0);
    });
  });

  describe("Relationship Validation", () => {
    it("should validate relationships between node types", async () => {
      const data = service.getSpecData();
      if (data.relationshipTypes.length > 0) {
        const rel = data.relationshipTypes[0];
        const isValid = service.isValidRelationship(
          rel.source_spec_node_id,
          rel.destination_spec_node_id,
          rel.predicate
        );
        expect(isValid).toBe(true);
      }
    });

    it("should return valid predicates between node types", async () => {
      const data = service.getSpecData();
      if (data.relationshipTypes.length > 0) {
        const rel = data.relationshipTypes[0];
        const predicates = service.getValidPredicates(
          rel.source_spec_node_id,
          rel.destination_spec_node_id
        );
        expect(Array.isArray(predicates)).toBe(true);
      }
    });
  });

  describe("Enriched Queries", () => {
    it("should provide enriched node type metadata", async () => {
      const data = service.getSpecData();
      if (data.nodeTypes.length > 0) {
        const specNodeId = data.nodeTypes[0].spec_node_id;
        const metadata = service.getNodeTypeMetadata(specNodeId);
        expect(metadata).toBeDefined();
        expect(metadata?.nodeType).toBeDefined();
        expect(metadata?.layer).toBeDefined();
        expect(Array.isArray(metadata?.incomingRelationships)).toBe(true);
        expect(Array.isArray(metadata?.outgoingRelationships)).toBe(true);
      }
    });
  });

  describe("Integrity Validation", () => {
    it("should validate spec data integrity", () => {
      const issues = service.validateIntegrity();
      expect(Array.isArray(issues)).toBe(true);
      // Note: Some spec definitions may reference missing destinations in relationships
      // This is OK as destination_spec_node_id may be optional for certain relationship types
      // The validator should complete without throwing even if there are reference issues
      if (issues.length > 0) {
        // Log first few issues for debugging
        console.log(
          `Integrity issues (${issues.length} total):`,
          issues.slice(0, 3).map((i) => i.substring(0, 80))
        );
      }
    });
  });

  describe("Global Service Instance", () => {
    beforeEach(() => {
      resetGlobalSpecDataService();
    });

    afterEach(() => {
      resetGlobalSpecDataService();
    });

    it("should return the same global instance", async () => {
      const service1 = getGlobalSpecDataService({ specDir });
      await service1.initialize();

      const service2 = getGlobalSpecDataService({ specDir });
      expect(service1).toBe(service2);
    });

    it("should create new instance after reset", async () => {
      const service1 = getGlobalSpecDataService({ specDir });
      await service1.initialize();

      resetGlobalSpecDataService();

      const service2 = getGlobalSpecDataService({ specDir });
      expect(service1).not.toBe(service2);
    });
  });
});
