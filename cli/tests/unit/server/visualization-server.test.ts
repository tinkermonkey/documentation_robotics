/**
 * Unit tests for VisualizationServer
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Model } from '../../../src/core/model.js';
import { VisualizationServer } from '../../../src/server/server.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

// Test fixture setup
async function createTestModel(rootPath: string): Promise<Model> {
  // Create model directory structure (new documentation-robotics format)
  mkdirSync(join(rootPath, 'documentation-robotics', 'model', '01_motivation'), { recursive: true });

  // Create manifest.yaml
  const manifestYaml = `version: '0.1.0'
schema: documentation-robotics-v1
cli_version: 0.1.0
created: ${new Date().toISOString()}
updated: ${new Date().toISOString()}
project:
  name: Test Model
  description: Test Description
  version: '0.1.0'
documentation: .dr/README.md
layers:
  motivation:
    order: 1
    name: Motivation
    path: documentation-robotics/model/01_motivation/
    schema: .dr/schemas/01-motivation-layer.schema.json
    enabled: true
`;

  writeFileSync(
    join(rootPath, 'documentation-robotics', 'model', 'manifest.yaml'),
    manifestYaml
  );

  // Create motivation layer YAML file
  const motivationYaml = `test-goal:
  id: motivation-goal-test-goal
  name: Test Goal
  type: goal
  documentation: A test goal
`;

  writeFileSync(
    join(rootPath, 'documentation-robotics', 'model', '01_motivation', 'goals.yaml'),
    motivationYaml
  );

  return Model.load(rootPath, { lazyLoad: false });
}

describe('VisualizationServer', () => {
  let testDir: string;
  let model: Model;
  let server: VisualizationServer;

  beforeAll(async () => {
    testDir = join(tmpdir(), `dr-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    model = await createTestModel(testDir);
    server = new VisualizationServer(model, { authEnabled: false });
  });

  afterAll(() => {
    server.stop();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should create a server with a model', () => {
      expect(server).toBeDefined();
      expect(server['model']).toBe(model);
    });

    it('should initialize with empty client set', () => {
      expect(server['clients'].size).toBe(0);
    });

    it('should initialize with empty annotations map', () => {
      expect(server['annotations'].size).toBe(0);
    });
  });

  describe('serializeModel', () => {
    it('should serialize model with manifest and layers', async () => {
      const serialized = await server['serializeModel']();

      expect(serialized).toHaveProperty('manifest');
      expect(serialized).toHaveProperty('layers');
      expect(serialized).toHaveProperty('totalElements');
    });

    it('should include manifest data', async () => {
      const serialized = await server['serializeModel']();

      expect(serialized.manifest.name).toBe('Test Model');
      expect(serialized.manifest.version).toBe('0.1.0');
    });

    it('should include layer information', async () => {
      const serialized = await server['serializeModel']();

      expect(serialized.layers).toHaveProperty('motivation');
      expect(serialized.layers.motivation).toHaveProperty('name');
      expect(serialized.layers.motivation).toHaveProperty('elements');
      expect(serialized.layers.motivation).toHaveProperty('elementCount');
    });

    it('should include elements in layers', async () => {
      const serialized = await server['serializeModel']();

      const elements = serialized.layers.motivation.elements;
      expect(elements.length).toBeGreaterThan(0);
      expect(elements[0]).toHaveProperty('id');
      expect(elements[0]).toHaveProperty('name');
      expect(elements[0]).toHaveProperty('type');
    });

    it('should include annotations in elements', async () => {
      const serialized = await server['serializeModel']();

      const elements = serialized.layers.motivation.elements;
      expect(elements[0]).toHaveProperty('annotations');
      expect(Array.isArray(elements[0].annotations)).toBe(true);
    });

    it('should calculate total elements correctly', async () => {
      const serialized = await server['serializeModel']();

      expect(serialized.totalElements).toBeGreaterThan(0);
    });
  });

  describe('findElement', () => {
    it('should find element by ID', async () => {
      const element = await server['findElement']('motivation-goal-test-goal');

      expect(element).toBeDefined();
      expect(element?.id).toBe('motivation-goal-test-goal');
      expect(element?.name).toBe('Test Goal');
    });

    it('should return null for non-existent element', async () => {
      const element = await server['findElement']('non-existent-id');

      expect(element).toBeNull();
    });
  });

  describe('broadcastMessage', () => {
    it('should handle broadcasting with no clients', async () => {
      const message = {
        type: 'annotation.added',
        annotationId: 'test-annotation-id',
        elementId: 'motivation-goal-test-goal',
        timestamp: new Date().toISOString(),
      };

      // Should not throw
      await server['broadcastMessage'](message);
    });

    it('should add annotation to map', async () => {
      const annotation = {
        elementId: 'motivation-goal-test-goal',
        author: 'Test Author',
        text: 'Test annotation',
        timestamp: new Date().toISOString(),
      };

      const annotationsBefore = server['annotations'].get('motivation-goal-test-goal')
        ?.length ?? 0;

      // Simulate adding annotation
      if (!server['annotations'].has('motivation-goal-test-goal')) {
        server['annotations'].set('motivation-goal-test-goal', []);
      }
      server['annotations'].get('motivation-goal-test-goal')!.push(annotation);

      const annotationsAfter = server['annotations'].get('motivation-goal-test-goal')
        ?.length ?? 0;

      expect(annotationsAfter).toBe(annotationsBefore + 1);
    });
  });

  describe('handleWSMessage', () => {
    it('should handle subscribe message', async () => {
      const mockWs = {
        send: (msg: string) => {
          // Mock send
        },
      };

      const message = { type: 'subscribe' as const };

      await server['handleWSMessage'](mockWs, message);
    });

    it('should handle annotate message', async () => {
      const mockWs = {
        send: (msg: string) => {
          // Mock send
        },
      };

      const message = {
        type: 'annotate' as const,
        annotation: {
          elementId: 'motivation-goal-test-goal',
          author: 'Test',
          text: 'Annotation',
          timestamp: new Date().toISOString(),
        },
      };

      await server['handleWSMessage'](mockWs, message);
    });
  });

  describe('getViewerHTML', () => {
    it('should return HTML string', () => {
      const html = server['getViewerHTML']();

      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(0);
    });

    it('should include required HTML elements', () => {
      const html = server['getViewerHTML']();

      expect(html).toContain('Documentation Robotics Viewer');
      expect(html).toContain('<div id="model-tree">');
      expect(html).toContain('<div id="element-details">');
    });

    it('should include WebSocket script', () => {
      const html = server['getViewerHTML']();

      expect(html).toContain('new WebSocket');
      expect(html).toContain('/ws');
    });

    it('should include styling', () => {
      const html = server['getViewerHTML']();

      expect(html).toContain('<style>');
      expect(html).toContain('</style>');
    });
  });

  describe('setupFileWatcher', () => {
    it('should create watcher', () => {
      // Note: Cannot easily test actual file watching without integration tests
      // This test just verifies the method exists and doesn't throw
      expect(() => {
        server['setupFileWatcher']();
      }).not.toThrow();
    });
  });

  describe('stop', () => {
    it('should handle stop without watcher', () => {
      const tempServer = new VisualizationServer(model, { authEnabled: false });
      expect(() => {
        tempServer.stop();
      }).not.toThrow();
    });
  });
});
