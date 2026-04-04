import { describe, it, expect, beforeEach } from 'bun:test';
import { ModelReportOrchestrator } from '@/reports/model-report-orchestrator';
import { Model } from '@/core/model';
import { Element } from '@/core/element';
import { Relationships } from '@/core/relationships';
import { Manifest } from '@/core/manifest';
import type { Relationship } from '@/core/relationships';

describe('ModelReportOrchestrator', () => {
  let model: Model;

  const createMockModel = (relationships: Relationship[] = []): Model => {
    const manifest = new Manifest({
      name: 'test-model',
      version: '1.0.0',
      description: 'Test model',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
    const testModel = new Model('/test/path', manifest);
    testModel.relationships = new Relationships(relationships);
    return testModel;
  };

  beforeEach(() => {
    model = createMockModel();
  });

  describe('computeAffectedLayers', () => {
    it('should return primary layer when no relationships exist', () => {
      const orchestrator = new ModelReportOrchestrator(model, '/test/path');
      const affected = orchestrator.computeAffectedLayers('api');

      expect(affected.has('api')).toBe(true);
      expect(affected.size).toBe(1);
    });

    it('should include target layer for outbound relationships', () => {
      const relationships: Relationship[] = [
        {
          source: 'api.endpoint.list-users',
          predicate: 'uses',
          target: 'data-model.entity.user',
          layer: 'api',
          targetLayer: 'data-model',
        },
      ];
      model = createMockModel(relationships);
      const orchestrator = new ModelReportOrchestrator(model, '/test/path');
      const affected = orchestrator.computeAffectedLayers('api');

      expect(affected.has('api')).toBe(true);
      expect(affected.has('data-model')).toBe(true);
      expect(affected.size).toBe(2);
    });

    it('should include source layer for inbound relationships', () => {
      const relationships: Relationship[] = [
        {
          source: 'application.service.user-manager',
          predicate: 'calls',
          target: 'api.endpoint.list-users',
          layer: 'application',
          targetLayer: 'api',
        },
      ];
      model = createMockModel(relationships);
      const orchestrator = new ModelReportOrchestrator(model, '/test/path');
      const affected = orchestrator.computeAffectedLayers('api');

      expect(affected.has('api')).toBe(true);
      expect(affected.has('application')).toBe(true);
      expect(affected.size).toBe(2);
    });

    it('should handle multiple relationships from same layer', () => {
      const relationships: Relationship[] = [
        {
          source: 'api.endpoint.list-users',
          predicate: 'uses',
          target: 'data-model.entity.user',
          layer: 'api',
          targetLayer: 'data-model',
        },
        {
          source: 'api.endpoint.get-user',
          predicate: 'uses',
          target: 'data-store.table.users',
          layer: 'api',
          targetLayer: 'data-store',
        },
      ];
      model = createMockModel(relationships);
      const orchestrator = new ModelReportOrchestrator(model, '/test/path');
      const affected = orchestrator.computeAffectedLayers('api');

      expect(affected.has('api')).toBe(true);
      expect(affected.has('data-model')).toBe(true);
      expect(affected.has('data-store')).toBe(true);
      expect(affected.size).toBe(3);
    });

    it('should deduplicate affected layers', () => {
      const relationships: Relationship[] = [
        {
          source: 'api.endpoint.list-users',
          predicate: 'uses',
          target: 'data-model.entity.user',
          layer: 'api',
          targetLayer: 'data-model',
        },
        {
          source: 'api.endpoint.get-user',
          predicate: 'uses',
          target: 'data-model.entity.user-profile',
          layer: 'api',
          targetLayer: 'data-model',
        },
      ];
      model = createMockModel(relationships);
      const orchestrator = new ModelReportOrchestrator(model, '/test/path');
      const affected = orchestrator.computeAffectedLayers('api');

      expect(affected.has('api')).toBe(true);
      expect(affected.has('data-model')).toBe(true);
      expect(affected.size).toBe(2);
    });

    it('should handle relationships without targetLayer field', () => {
      const relationships: Relationship[] = [
        {
          source: 'api.endpoint.list-users',
          predicate: 'uses',
          target: 'data-model.entity.user',
          layer: 'api',
          // targetLayer is undefined - should still work
        },
      ];
      model = createMockModel(relationships);
      const orchestrator = new ModelReportOrchestrator(model, '/test/path');
      const affected = orchestrator.computeAffectedLayers('api');

      // Should include api (primary), and api again (from layer field as fallback)
      expect(affected.has('api')).toBe(true);
      expect(affected.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe('reportOrchestrator integration', () => {
    it('should create orchestrator with model and path', () => {
      const orchestrator = new ModelReportOrchestrator(model, '/test/path');
      expect(orchestrator).toBeDefined();
    });

    it('should have regenerate and regenerateAll methods', () => {
      const orchestrator = new ModelReportOrchestrator(model, '/test/path');
      expect(typeof orchestrator.regenerate).toBe('function');
      expect(typeof orchestrator.regenerateAll).toBe('function');
    });
  });
});
