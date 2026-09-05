import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
import { ModelReportOrchestrator } from '@/reports/model-report-orchestrator';
import { Model } from '@/core/model';
import { Element } from '@/core/element';
import { Relationships } from '@/core/relationships';
import { Manifest } from '@/core/manifest';
import type { Relationship } from '@/core/relationships';
import * as fs from 'fs/promises';

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

  describe('isInitialized() error handling', () => {
    it('should return false when files do not exist (ENOENT)', async () => {
      const orchestrator = new ModelReportOrchestrator(model, '/test/path');
      const accessSpy = spyOn(fs, 'access').mockImplementation(() => {
        const error = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        return Promise.reject(error);
      });

      const result = await orchestrator['isInitialized']();
      expect(result).toBe(false);
      accessSpy.mockRestore();
    });

    it('should propagate permission errors (EACCES)', async () => {
      const orchestrator = new ModelReportOrchestrator(model, '/test/path');
      const error = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';

      const accessSpy = spyOn(fs, 'access').mockImplementation(() => Promise.reject(error));

      try {
        await orchestrator['isInitialized']();
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect((err as NodeJS.ErrnoException).code).toBe('EACCES');
      }
      accessSpy.mockRestore();
    });

    it('should propagate I/O errors (EIO)', async () => {
      const orchestrator = new ModelReportOrchestrator(model, '/test/path');
      const error = new Error('EIO: input/output error') as NodeJS.ErrnoException;
      error.code = 'EIO';

      const accessSpy = spyOn(fs, 'access').mockImplementation(() => Promise.reject(error));

      try {
        await orchestrator['isInitialized']();
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect((err as NodeJS.ErrnoException).code).toBe('EIO');
      }
      accessSpy.mockRestore();
    });

    it('should return true when all files exist', async () => {
      const orchestrator = new ModelReportOrchestrator(model, '/test/path');
      const accessSpy = spyOn(fs, 'access').mockImplementation(() => Promise.resolve());

      const result = await orchestrator['isInitialized']();
      expect(result).toBe(true);
      accessSpy.mockRestore();
    });
  });

  describe('regenerateAll() error handling', () => {
    it('should propagate mkdir errors to caller', async () => {
      const orchestrator = new ModelReportOrchestrator(model, '/test/path');
      const error = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';

      const mkdirSpy = spyOn(fs, 'mkdir').mockImplementation(() => Promise.reject(error));

      try {
        await orchestrator['regenerateAll']();
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect((err as NodeJS.ErrnoException).code).toBe('EACCES');
      }
      mkdirSpy.mockRestore();
    });

    it('should propagate disk full errors (ENOSPC)', async () => {
      const orchestrator = new ModelReportOrchestrator(model, '/test/path');
      const error = new Error('ENOSPC: no space left on device') as NodeJS.ErrnoException;
      error.code = 'ENOSPC';

      const mkdirSpy = spyOn(fs, 'mkdir').mockImplementation(() => Promise.reject(error));

      try {
        await orchestrator['regenerateAll']();
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect((err as NodeJS.ErrnoException).code).toBe('ENOSPC');
      }
      mkdirSpy.mockRestore();
    });
  });

  describe('generateLayerReport() error handling', () => {
    it('should throw on data collection error without attempting write', async () => {
      const orchestrator = new ModelReportOrchestrator(model, '/test/path');
      const collectionError = new Error('Corrupted model data');

      // Mock the collector to throw
      const collectorSpy = spyOn(orchestrator['collector'], 'collectLayerData').mockImplementation(() => {
        throw collectionError;
      });

      // Mock fs.writeFile - should not be called
      const writeFileSpy = spyOn(fs, 'writeFile').mockImplementation(() => Promise.reject(new Error('Should not be called')));

      try {
        await orchestrator['generateLayerReport']('api');
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect((err as Error).message).toContain('programming error or corrupted model');
        expect(writeFileSpy).not.toHaveBeenCalled();
      }

      collectorSpy.mockRestore();
      writeFileSpy.mockRestore();
    });

    it('should propagate write errors instead of swallowing them', async () => {
      const orchestrator = new ModelReportOrchestrator(model, '/test/path');
      const writeError = new Error('ENOSPC: no space left on device') as NodeJS.ErrnoException;
      writeError.code = 'ENOSPC';

      // Mock collector to succeed
      const collectorSpy = spyOn(orchestrator['collector'], 'collectLayerData').mockImplementation(() => ({
        layerName: 'api',
        elements: [],
        relationships: [],
      }));

      // Mock generator to succeed
      const generatorSpy = spyOn(orchestrator['generator'], 'generate').mockImplementation(() => 'test markdown');

      // Mock fs.writeFile to throw
      const writeFileSpy = spyOn(fs, 'writeFile').mockImplementation(() => Promise.reject(writeError));

      try {
        await orchestrator['generateLayerReport']('api');
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect((err as NodeJS.ErrnoException).code).toBe('ENOSPC');
      }

      collectorSpy.mockRestore();
      generatorSpy.mockRestore();
      writeFileSpy.mockRestore();
    });

    it('should distinguish programming errors from filesystem errors', async () => {
      const orchestrator = new ModelReportOrchestrator(model, '/test/path');
      const typeError = new TypeError('Cannot read property of undefined');

      // Mock collector to throw TypeError (programming error)
      const collectorSpy = spyOn(orchestrator['collector'], 'collectLayerData').mockImplementation(() => {
        throw typeError;
      });

      try {
        await orchestrator['generateLayerReport']('api');
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        // Verify the error message indicates programming error
        expect((err as Error).message).toContain('programming error or corrupted model');
      }

      collectorSpy.mockRestore();
    });
  });
});
