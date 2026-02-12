/**
 * Unit tests for SpecDataService
 *
 * Tests high-level specification data service operations including:
 * - Service initialization
 * - Node type queries and filtering
 * - Relationship type queries and filtering
 * - Layer lookups
 * - Metadata computation
 * - Caching behavior
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { SpecDataService } from "../../../src/core/spec-data-service.js";
import * as path from "path";

describe("SpecDataService", () => {
  let service: SpecDataService;
  let testSpecDir: string;

  beforeEach(async () => {
    testSpecDir = path.join(process.cwd(), "spec");
    service = new SpecDataService({ specDir: testSpecDir });
    await service.initialize();
  });

  describe("initialization", () => {
    it("should initialize without errors", async () => {
      const newService = new SpecDataService({ specDir: testSpecDir });
      await expect(newService.initialize()).resolves.toBeUndefined();
    });

    it("should report initialized state correctly", async () => {
      const newService = new SpecDataService({ specDir: testSpecDir });
      expect(newService.isInitialized()).toBe(false);

      await newService.initialize();
      expect(newService.isInitialized()).toBe(true);
    });

    it("should provide access to raw spec data after initialization", () => {
      const specData = service.getSpecData();

      expect(specData).toBeDefined();
      expect(specData.layers).toBeDefined();
      expect(specData.nodeTypes).toBeDefined();
      expect(specData.relationshipTypes).toBeDefined();
      expect(specData.predicates).toBeDefined();
    });
  });

  describe("layer operations", () => {
    it("should get all layers", () => {
      const layers = service.getAllLayers();

      expect(Array.isArray(layers)).toBe(true);
      expect(layers.length).toBeGreaterThan(0);
    });

    it("should get layer by ID", () => {
      const layers = service.getAllLayers();
      expect(layers.length).toBeGreaterThan(0);

      const firstLayer = layers[0];
      const retrieved = service.getLayer(firstLayer.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(firstLayer.id);
      expect(retrieved?.name).toBe(firstLayer.name);
    });

    it("should return undefined for nonexistent layer", () => {
      const retrieved = service.getLayer("nonexistent-layer");
      expect(retrieved).toBeUndefined();
    });

    it("should have consistent layer ordering", () => {
      const layers = service.getAllLayers();

      for (let i = 1; i < layers.length; i++) {
        expect(layers[i].number).toBeGreaterThan(layers[i - 1].number);
      }
    });
  });

  describe("node type operations", () => {
    it("should find node types without filters", () => {
      const nodeTypes = service.findNodeTypes();

      expect(Array.isArray(nodeTypes)).toBe(true);
      expect(nodeTypes.length).toBeGreaterThan(0);
    });

    it("should get node type by spec_node_id", () => {
      const nodeTypes = service.findNodeTypes();
      expect(nodeTypes.length).toBeGreaterThan(0);

      const firstNodeType = nodeTypes[0];
      const retrieved = service.getNodeType(firstNodeType.spec_node_id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.spec_node_id).toBe(firstNodeType.spec_node_id);
      expect(retrieved?.type).toBe(firstNodeType.type);
    });

    it("should return undefined for nonexistent node type", () => {
      const retrieved = service.getNodeType("nonexistent.nonexistent");
      expect(retrieved).toBeUndefined();
    });

    it("should get node types for specific layer", () => {
      const layers = service.getAllLayers();
      expect(layers.length).toBeGreaterThan(0);

      const firstLayer = layers[0];
      const nodeTypes = service.getNodeTypesForLayer(firstLayer.id);

      expect(Array.isArray(nodeTypes)).toBe(true);

      // All returned node types should belong to the specified layer
      for (const nodeType of nodeTypes) {
        expect(nodeType.layer_id).toBe(firstLayer.id);
      }
    });

    it("should filter node types by layer", () => {
      const allNodeTypes = service.findNodeTypes();
      const layers = service.getAllLayers();

      if (layers.length > 0) {
        const firstLayer = layers[0];
        const filtered = service.findNodeTypes({ layer_id: firstLayer.id });

        // All filtered should be from the layer
        for (const nodeType of filtered) {
          expect(nodeType.layer_id).toBe(firstLayer.id);
        }

        // Should have fewer or equal results than all
        expect(filtered.length).toBeLessThanOrEqual(allNodeTypes.length);
      }
    });

    it("should filter node types by name pattern", () => {
      const nodeTypes = service.findNodeTypes();
      if (nodeTypes.length > 0) {
        const firstType = nodeTypes[0];

        // Filter for exact type match
        const filtered = service.findNodeTypes({ type: firstType.type });

        // All filtered should match the type
        for (const nodeType of filtered) {
          expect(nodeType.type).toBe(firstType.type);
        }

        // Should have at least the first one
        expect(filtered.length).toBeGreaterThan(0);
      }
    });
  });

  describe("relationship type operations", () => {
    it("should find relationship types without filters", () => {
      const relTypes = service.findRelationshipTypes();

      expect(Array.isArray(relTypes)).toBe(true);
      expect(relTypes.length).toBeGreaterThan(0);
    });

    it("should filter relationship types by source layer", () => {
      const layers = service.getAllLayers();
      if (layers.length > 0) {
        const firstLayer = layers[0];
        const filtered = service.findRelationshipTypes({
          source_layer: firstLayer.id,
        });

        expect(Array.isArray(filtered)).toBe(true);

        // All filtered should have matching source layer
        for (const relType of filtered) {
          expect(relType.source_layer).toBe(firstLayer.id);
        }
      }
    });

    it("should filter relationship types by destination layer", () => {
      const layers = service.getAllLayers();
      if (layers.length > 0) {
        const firstLayer = layers[0];
        const filtered = service.findRelationshipTypes({
          destination_layer: firstLayer.id,
        });

        expect(Array.isArray(filtered)).toBe(true);

        // All filtered should have matching destination layer
        for (const relType of filtered) {
          expect(relType.destination_layer).toBe(firstLayer.id);
        }
      }
    });

    it("should filter relationship types by predicate", () => {
      const relTypes = service.findRelationshipTypes();
      if (relTypes.length > 0) {
        const firstRelType = relTypes[0];
        const filtered = service.findRelationshipTypes({
          predicate: firstRelType.predicate,
        });

        // All filtered should have matching predicate
        for (const relType of filtered) {
          expect(relType.predicate).toBe(firstRelType.predicate);
        }

        // Should have at least the first one
        expect(filtered.length).toBeGreaterThan(0);
      }
    });
  });

  describe("predicate operations", () => {
    it("should get all predicates", () => {
      const predicates = service.getAllPredicates();

      expect(Array.isArray(predicates)).toBe(true);
      expect(predicates.length).toBeGreaterThan(0);
    });

    it("should get predicate by name", () => {
      const predicates = service.getAllPredicates();
      expect(predicates.length).toBeGreaterThan(0);

      const firstPredicate = predicates[0];
      const retrieved = service.getPredicate(firstPredicate.name);

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe(firstPredicate.name);
    });

    it("should return undefined for nonexistent predicate", () => {
      const retrieved = service.getPredicate("nonexistent-predicate");
      expect(retrieved).toBeUndefined();
    });
  });

  describe("statistics", () => {
    it("should provide statistics", () => {
      const stats = service.getStatistics();

      expect(stats).toBeDefined();
      expect(typeof stats.totalLayers).toBe("number");
      expect(typeof stats.totalNodeTypes).toBe("number");
      expect(typeof stats.totalRelationshipTypes).toBe("number");
      expect(typeof stats.totalPredicates).toBe("number");
    });

    it("should have correct statistics values", () => {
      const stats = service.getStatistics();
      const layers = service.getAllLayers();
      const nodeTypes = service.findNodeTypes();
      const relTypes = service.findRelationshipTypes();
      const predicates = service.getAllPredicates();

      expect(stats.totalLayers).toBe(layers.length);
      expect(stats.totalNodeTypes).toBe(nodeTypes.length);
      expect(stats.totalRelationshipTypes).toBe(relTypes.length);
      expect(stats.totalPredicates).toBe(predicates.length);
    });
  });

  describe("metadata operations", () => {
    it("should get node type metadata for valid spec_node_id", () => {
      const nodeTypes = service.findNodeTypes();
      if (nodeTypes.length > 0) {
        const firstNodeType = nodeTypes[0];
        const metadata = service.getNodeTypeMetadata(firstNodeType.spec_node_id);

        expect(metadata).toBeDefined();
        expect(metadata?.nodeType).toBeDefined();
        expect(metadata?.nodeType.spec_node_id).toBe(firstNodeType.spec_node_id);
      }
    });

    it("should return undefined for nonexistent node type metadata", () => {
      const metadata = service.getNodeTypeMetadata("nonexistent.nonexistent");
      expect(metadata).toBeUndefined();
    });

    it("should include layer in node type metadata", () => {
      const nodeTypes = service.findNodeTypes();
      if (nodeTypes.length > 0) {
        const firstNodeType = nodeTypes[0];
        const metadata = service.getNodeTypeMetadata(firstNodeType.spec_node_id);

        expect(metadata?.layer).toBeDefined();
        expect(metadata?.layer?.id).toBe(firstNodeType.layer_id);
      }
    });

    it("should include relationship information in metadata", () => {
      const nodeTypes = service.findNodeTypes();
      if (nodeTypes.length > 0) {
        const firstNodeType = nodeTypes[0];
        const metadata = service.getNodeTypeMetadata(firstNodeType.spec_node_id);

        expect(metadata?.incomingRelationships).toBeDefined();
        expect(Array.isArray(metadata?.incomingRelationships)).toBe(true);
        expect(metadata?.outgoingRelationships).toBeDefined();
        expect(Array.isArray(metadata?.outgoingRelationships)).toBe(true);
      }
    });
  });

  describe("caching behavior", () => {
    it("should cache node type metadata on multiple accesses", () => {
      const nodeTypes = service.findNodeTypes();
      if (nodeTypes.length > 0) {
        const firstNodeType = nodeTypes[0];

        // Get metadata twice
        const metadata1 = service.getNodeTypeMetadata(firstNodeType.spec_node_id);
        const metadata2 = service.getNodeTypeMetadata(firstNodeType.spec_node_id);

        // Should return the same cached object
        expect(metadata1).toBe(metadata2);
      }
    });
  });

  describe("combined operations", () => {
    it("should support complex queries combining multiple operations", () => {
      // Get a layer
      const layers = service.getAllLayers();
      if (layers.length > 0) {
        const layer = layers[0];

        // Get node types in that layer
        const nodeTypes = service.getNodeTypesForLayer(layer.id);

        // For each node type, get predicates it uses
        let foundPredicates = new Set<string>();
        for (const nodeType of nodeTypes) {
          const metadata = service.getNodeTypeMetadata(nodeType.spec_node_id);
          if (metadata) {
            for (const rel of metadata.incomingRelationships) {
              foundPredicates.add(rel.predicate?.name || "unknown");
            }
            for (const rel of metadata.outgoingRelationships) {
              foundPredicates.add(rel.predicate?.name || "unknown");
            }
          }
        }

        // Verify we can look up predicates
        const allPredicates = service.getAllPredicates();
        for (const predicateName of foundPredicates) {
          if (predicateName !== "unknown") {
            const predicate = service.getPredicate(predicateName);
            expect(predicate).toBeDefined();
          }
        }
      }
    });
  });
});
