import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { loadBuiltinPatterns } from '../../src/scan/pattern-loader.js';
import { RelationshipInferenceEngine } from '../../src/scan/relationship-inference.js';
import { LAYER_MAP, getLayerNumber } from '../../src/core/layers.js';

describe('Relationship Scanning Coverage', function () {
  let patterns: Awaited<ReturnType<typeof loadBuiltinPatterns>>;

  beforeAll(async () => {
    patterns = await loadBuiltinPatterns();
  });

  describe('Layer Coverage', function () {
    it('should have relationship patterns for all 12 layers', async () => {
      const layers = new Set<string>();

      for (const patternSet of patterns) {
        layers.add(patternSet.layer);
      }

      const requiredLayers = [
        'motivation',
        'business',
        'security',
        'application',
        'technology',
        'api',
        'data-model',
        'data-store',
        'ux',
        'navigation',
        'apm',
        'testing',
      ];

      for (const layer of requiredLayers) {
        expect(layers.has(layer)).toBe(true);
      }
    });

    it('should have relationship patterns in Motivation layer', async () => {
      const motivationPatterns = patterns.filter((p) => p.layer === 'motivation');

      expect(motivationPatterns.length).toBeGreaterThan(0);
      const hasRelationships = motivationPatterns.some((p) =>
        p.patterns.some((pattern) => pattern.produces?.type === 'relationship')
      );
      expect(hasRelationships).toBe(true);
    });

    it('should have relationship patterns in Business layer', async () => {
      const businessPatterns = patterns.filter((p) => p.layer === 'business');

      expect(businessPatterns.length).toBeGreaterThan(0);
      const hasRelationships = businessPatterns.some((p) =>
        p.patterns.some((pattern) => pattern.produces?.type === 'relationship')
      );
      expect(hasRelationships).toBe(true);
    });

    it('should have relationship patterns in Technology layer', async () => {
      const technologyPatterns = patterns.filter((p) => p.layer === 'technology');

      expect(technologyPatterns.length).toBeGreaterThan(0);
      const hasRelationships = technologyPatterns.some((p) =>
        p.patterns.some((pattern) => pattern.produces?.type === 'relationship')
      );
      expect(hasRelationships).toBe(true);
    });

    it('should have relationship patterns in Navigation layer', async () => {
      const navigationPatterns = patterns.filter((p) => p.layer === 'navigation');

      expect(navigationPatterns.length).toBeGreaterThan(0);
      const hasRelationships = navigationPatterns.some((p) =>
        p.patterns.some((pattern) => pattern.produces?.type === 'relationship')
      );
      expect(hasRelationships).toBe(true);
    });
  });

  describe('Relationship Inference Engine', function () {
    it('should infer composition relationships from co-located elements', async () => {
      const elements = new Map([
        [
          'api.endpoint.get-user',
          {
            id: 'api.endpoint.get-user',
            type: 'endpoint',
            layer: 'api',
            name: 'Get User',
            confidence: 0.9,
            attributes: { module: 'api/users' },
          },
        ],
        [
          'api.endpoint.create-user',
          {
            id: 'api.endpoint.create-user',
            type: 'endpoint',
            layer: 'api',
            name: 'Create User',
            confidence: 0.9,
            attributes: { module: 'api/users' },
          },
        ],
      ]);

      const inferenceContext = {
        elements,
        existingRelationships: [],
      };

      const engine = new RelationshipInferenceEngine(inferenceContext);
      const inferred = engine.inferRelationships();

      // Should infer composition relationships between co-located elements
      const compositionRel = inferred.find(
        (r) =>
          r.sourceId === 'api.endpoint.get-user' &&
          r.targetId === 'api.endpoint.create-user' &&
          r.relationshipType === 'composed-of'
      );

      expect(compositionRel).toBeDefined();
    });

    it('should infer type-based relationships', async () => {
      const elements = new Map([
        [
          'application.service.user-service',
          {
            id: 'application.service.user-service',
            type: 'service',
            layer: 'application',
            name: 'User Service',
            confidence: 0.9,
            attributes: { consumes: 'UserDTO' },
          },
        ],
        [
          'data-model.entity.user-dto',
          {
            id: 'data-model.entity.user-dto',
            type: 'entity',
            layer: 'data-model',
            name: 'User DTO',
            confidence: 0.9,
            attributes: { produces: 'UserDTO' },
          },
        ],
      ]);

      const inferenceContext = {
        elements,
        existingRelationships: [],
      };

      const engine = new RelationshipInferenceEngine(inferenceContext);
      const inferred = engine.inferRelationships();

      // Should infer type-compatibility relationship
      const typeRel = inferred.find(
        (r) =>
          r.sourceId === 'application.service.user-service' &&
          r.targetId === 'data-model.entity.user-dto' &&
          r.relationshipType === 'consumes'
      );

      expect(typeRel).toBeDefined();
    });

    it('should infer cross-layer relationships with proper direction', async () => {
      const elements = new Map([
        [
          'application.service.user-service',
          {
            id: 'application.service.user-service',
            type: 'service',
            layer: 'application',
            name: 'User Service',
            confidence: 0.9,
            attributes: { implements: 'UserManagement' },
          },
        ],
        [
          'technology.platform.rest-api',
          {
            id: 'technology.platform.rest-api',
            type: 'platform',
            layer: 'technology',
            name: 'REST API',
            confidence: 0.9,
            attributes: { provides: 'UserManagement' },
          },
        ],
      ]);

      const inferenceContext = {
        elements,
        existingRelationships: [],
      };

      const engine = new RelationshipInferenceEngine(inferenceContext);
      const inferred = engine.inferRelationships();

      // Should infer implementation relationship
      const implRel = inferred.find(
        (r) =>
          r.sourceId === 'application.service.user-service' &&
          r.targetId === 'technology.platform.rest-api' &&
          r.relationshipType === 'implements'
      );

      expect(implRel).toBeDefined();
    });

    it('should respect layer hierarchy in inferred relationships', async () => {
      const elements = new Map([
        [
          'api.endpoint.create',
          {
            id: 'api.endpoint.create',
            type: 'endpoint',
            layer: 'api',
            name: 'Create',
            confidence: 0.9,
          },
        ],
        [
          'application.service.app',
          {
            id: 'application.service.app',
            type: 'service',
            layer: 'application',
            name: 'App Service',
            confidence: 0.9,
          },
        ],
      ]);

      const inferenceContext = {
        elements,
        existingRelationships: [],
      };

      const engine = new RelationshipInferenceEngine(inferenceContext);
      const inferred = engine.inferRelationships();

      // All inferred relationships should respect layer hierarchy
      for (const rel of inferred) {
        if (rel.sourceId && rel.targetId) {
          const sourceLayer = getLayerNumber(rel.sourceId);
          const targetLayer = getLayerNumber(rel.targetId);

          if (sourceLayer && targetLayer && sourceLayer !== targetLayer) {
            expect(sourceLayer).toBeGreaterThanOrEqual(targetLayer);
          }
        }
      }
    });

    it('should avoid creating self-referential relationships', async () => {
      const elements = new Map([
        [
          'api.endpoint.test',
          {
            id: 'api.endpoint.test',
            type: 'endpoint',
            layer: 'api',
            name: 'Test',
            confidence: 0.9,
          },
        ],
      ]);

      const inferenceContext = {
        elements,
        existingRelationships: [],
      };

      const engine = new RelationshipInferenceEngine(inferenceContext);
      const inferred = engine.inferRelationships();

      // No self-referential relationships
      for (const rel of inferred) {
        expect(rel.sourceId).not.toEqual(rel.targetId);
      }
    });

    it('should deduplicate inferred relationships', async () => {
      const existingRelationships = [
        {
          id: 'api.endpoint.create->application.service.app',
          sourceId: 'api.endpoint.create',
          targetId: 'application.service.app',
          relationshipType: 'depends-on',
          layer: 'api',
          confidence: 0.9,
        },
      ];

      const inferenceContext = {
        elements: new Map(),
        existingRelationships,
      };

      const engine = new RelationshipInferenceEngine(inferenceContext);
      const inferred = engine.inferRelationships();

      // Count reverse relationships with same key
      const uniqueKeys = new Set(
        inferred.map((r) => `${r.sourceId}|${r.targetId}|${r.relationshipType}`)
      );

      expect(uniqueKeys.size).toBe(inferred.length);
    });
  });

  describe('Pattern Consistency', function () {
    it('should have valid confidence values in all patterns', async () => {
      const allPatterns = patterns
        .flatMap((set) => set.patterns);

      for (const pattern of allPatterns) {
        expect(pattern.confidence).toBeGreaterThan(0);
        expect(pattern.confidence).toBeLessThanOrEqual(1.0);
      }
    });

    it('relationship patterns should define source and target templates', async () => {
      const relationshipPatterns = patterns
        .flatMap((set) => set.patterns)
        .filter((p) => p.produces?.type === 'relationship');

      for (const pattern of relationshipPatterns) {
        expect(pattern.mapping).toBeDefined();
        expect(
          pattern.mapping.source || pattern.mapping.sourceId
        ).toBeDefined();
        expect(
          pattern.mapping.target || pattern.mapping.targetId
        ).toBeDefined();
      }
    });
  });
});
