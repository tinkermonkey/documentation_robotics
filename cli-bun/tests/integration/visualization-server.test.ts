/**
 * Integration tests for VisualizationServer
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Model } from '../../src/core/model.js';
import { VisualizationServer } from '../../src/server/server.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { sleep } from '../helpers.ts';

// Test fixture setup
async function createTestModel(rootPath: string): Promise<Model> {
  mkdirSync(join(rootPath, '.dr', 'layers'), { recursive: true });

  const manifest = {
    name: 'Integration Test Model',
    version: '0.1.0',
    description: 'Integration Test',
    author: 'Test Suite',
    specVersion: '0.6.0',
    created: new Date().toISOString(),
  };

  writeFileSync(
    join(rootPath, '.dr', 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  const motivationLayer = {
    elements: [
      {
        id: 'motivation-goal-integration-test',
        type: 'goal',
        name: 'Integration Test Goal',
        description: 'Goal for integration testing',
      },
      {
        id: 'motivation-requirement-integration-test',
        type: 'requirement',
        name: 'Integration Test Requirement',
        description: 'Requirement for integration testing',
      },
    ],
  };

  writeFileSync(
    join(rootPath, '.dr', 'layers', 'motivation.json'),
    JSON.stringify(motivationLayer, null, 2)
  );

  const applicationLayer = {
    elements: [
      {
        id: 'application-service-integration-test',
        type: 'service',
        name: 'Integration Test Service',
        description: 'Service for integration testing',
      },
    ],
  };

  writeFileSync(
    join(rootPath, '.dr', 'layers', 'application.json'),
    JSON.stringify(applicationLayer, null, 2)
  );

  return Model.load(rootPath, { lazyLoad: false });
}

describe('VisualizationServer Integration Tests', () => {
  let testDir: string;
  let model: Model;
  let server: VisualizationServer;

  beforeAll(async () => {
    testDir = join(tmpdir(), `dr-integration-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    model = await createTestModel(testDir);
    server = new VisualizationServer(model);
  });

  afterAll(() => {
    server.stop();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('REST API - Model Endpoint', () => {
    it('should serialize complete model correctly', async () => {
      const modelData = await server['serializeModel']();

      expect(modelData.manifest.name).toBe('Integration Test Model');
      expect(Object.keys(modelData.layers)).toContain('motivation');
      expect(Object.keys(modelData.layers)).toContain('application');
    });

    it('should count elements accurately', async () => {
      const modelData = await server['serializeModel']();

      const motivationCount = modelData.layers.motivation.elements.length;
      const applicationCount = modelData.layers.application.elements.length;
      const total = modelData.totalElements;

      expect(motivationCount).toBe(2);
      expect(applicationCount).toBe(1);
      expect(total).toBe(3);
    });
  });

  describe('REST API - Layer Endpoint', () => {
    it('should retrieve specific layer', async () => {
      const layer = await model.getLayer('motivation');

      expect(layer).toBeDefined();
      expect(layer?.name).toBe('motivation');
    });

    it('should list elements in layer', async () => {
      const layer = await model.getLayer('motivation');
      const elements = layer?.listElements() ?? [];

      expect(elements.length).toBe(2);
      expect(elements[0].id).toContain('motivation-');
    });

    it('should return null for non-existent layer', async () => {
      const layer = await model.getLayer('non-existent-layer');

      expect(layer).toBeUndefined();
    });
  });

  describe('REST API - Element Endpoint', () => {
    it('should find elements across layers', async () => {
      const element = await server['findElement'](
        'motivation-goal-integration-test'
      );

      expect(element).toBeDefined();
      expect(element?.name).toBe('Integration Test Goal');
      expect(element?.type).toBe('goal');
    });

    it('should find elements in different layers', async () => {
      const element = await server['findElement'](
        'application-service-integration-test'
      );

      expect(element).toBeDefined();
      expect(element?.type).toBe('service');
    });

    it('should return null for missing elements', async () => {
      const element = await server['findElement']('missing-element-id');

      expect(element).toBeNull();
    });
  });

  describe('Annotation System', () => {
    it('should store annotations by element ID', async () => {
      const annotation1 = {
        elementId: 'motivation-goal-integration-test',
        author: 'User 1',
        text: 'First annotation',
        timestamp: new Date().toISOString(),
      };

      if (!server['annotations'].has('motivation-goal-integration-test')) {
        server['annotations'].set('motivation-goal-integration-test', []);
      }

      server['annotations']
        .get('motivation-goal-integration-test')!
        .push(annotation1);

      const stored = server['annotations'].get(
        'motivation-goal-integration-test'
      );

      expect(stored).toBeDefined();
      expect(stored?.length).toBe(1);
      expect(stored?.[0].author).toBe('User 1');
    });

    it('should support multiple annotations per element', async () => {
      const elementId = 'motivation-requirement-integration-test';

      if (!server['annotations'].has(elementId)) {
        server['annotations'].set(elementId, []);
      }

      const annotations = [
        {
          elementId,
          author: 'User 1',
          text: 'First note',
          timestamp: new Date().toISOString(),
        },
        {
          elementId,
          author: 'User 2',
          text: 'Second note',
          timestamp: new Date().toISOString(),
        },
      ];

      for (const ann of annotations) {
        server['annotations'].get(elementId)!.push(ann);
      }

      const stored = server['annotations'].get(elementId);

      expect(stored?.length).toBe(2);
      expect(stored?.[0].author).toBe('User 1');
      expect(stored?.[1].author).toBe('User 2');
    });

    it('should include annotations in serialized model', async () => {
      const elementId = 'motivation-goal-integration-test';
      const annotation = {
        elementId,
        author: 'Test User',
        text: 'Integration test annotation',
        timestamp: new Date().toISOString(),
      };

      if (!server['annotations'].has(elementId)) {
        server['annotations'].set(elementId, []);
      }
      server['annotations'].get(elementId)!.push(annotation);

      const modelData = await server['serializeModel']();
      const element = modelData.layers.motivation.elements.find(
        (e: any) => e.id === elementId
      );

      expect(element).toBeDefined();
      expect(element?.annotations.length).toBeGreaterThan(0);
    });
  });

  describe('WebSocket Message Handling', () => {
    it('should handle subscribe messages', async () => {
      let receivedMessage: any = null;

      const mockWs = {
        send: (msg: string) => {
          receivedMessage = JSON.parse(msg);
        },
      };

      const subscribeMsg = { type: 'subscribe' as const };
      await server['handleWSMessage'](mockWs, subscribeMsg);

      expect(receivedMessage).toBeDefined();
      expect(receivedMessage.type).toBe('model');
      expect(receivedMessage.data).toHaveProperty('manifest');
      expect(receivedMessage.data).toHaveProperty('layers');
    });

    it('should handle annotate messages', async () => {
      let broadcastCalled = false;

      // Store original broadcast method
      const originalBroadcast = server['broadcastAnnotation'];

      // Mock broadcast method
      server['broadcastAnnotation'] = async () => {
        broadcastCalled = true;
      };

      const annotateMsg = {
        type: 'annotate' as const,
        annotation: {
          elementId: 'test-element',
          author: 'Test User',
          text: 'Test message',
          timestamp: new Date().toISOString(),
        },
      };

      const mockWs = { send: () => {} };
      await server['handleWSMessage'](mockWs, annotateMsg);

      expect(broadcastCalled).toBe(true);

      // Restore original method
      server['broadcastAnnotation'] = originalBroadcast;
    });

    it('should handle invalid messages gracefully', async () => {
      let errorResponse: any = null;

      const mockWs = {
        send: (msg: string) => {
          errorResponse = JSON.parse(msg);
        },
      };

      const invalidMsg = { type: 'invalid' } as any;
      await server['handleWSMessage'](mockWs, invalidMsg);

      expect(errorResponse).toBeDefined();
      expect(errorResponse.type).toBe('error');
    });
  });

  describe('Multi-Layer Support', () => {
    it('should serialize all layers correctly', async () => {
      const modelData = await server['serializeModel']();

      expect(Object.keys(modelData.layers).length).toBeGreaterThanOrEqual(2);
      expect(modelData.layers.motivation).toBeDefined();
      expect(modelData.layers.application).toBeDefined();
    });

    it('should find elements across different layers', async () => {
      const motivationElement = await server['findElement'](
        'motivation-goal-integration-test'
      );
      const applicationElement = await server['findElement'](
        'application-service-integration-test'
      );

      expect(motivationElement?.type).toBe('goal');
      expect(applicationElement?.type).toBe('service');
    });

    it('should maintain element isolation within layers', async () => {
      const motivationLayer = await model.getLayer('motivation');
      const applicationLayer = await model.getLayer('application');

      const motivationIds = motivationLayer?.listElements().map(e => e.id) ?? [];
      const applicationIds = applicationLayer?.listElements().map(e => e.id) ?? [];

      // Ensure no overlap
      const overlap = motivationIds.filter(id => applicationIds.includes(id));
      expect(overlap.length).toBe(0);
    });
  });

  describe('HTML Viewer', () => {
    it('should generate valid HTML', () => {
      const html = server['getViewerHTML']();

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('should include model visualization elements', () => {
      const html = server['getViewerHTML']();

      expect(html).toContain('id="model-tree"');
      expect(html).toContain('id="element-details"');
      expect(html).toContain('id="status"');
    });

    it('should include WebSocket connection handling', () => {
      const html = server['getViewerHTML']();

      expect(html).toContain('new WebSocket');
      expect(html).toContain('addEventListener(\'open\'');
      expect(html).toContain('addEventListener(\'message\'');
      expect(html).toContain('addEventListener(\'close\'');
    });

    it('should include annotation functionality', () => {
      const html = server['getViewerHTML']();

      expect(html).toContain('addAnnotation');
      expect(html).toContain('POST');
      expect(html).toContain('/api/elements/');
      expect(html).toContain('annotations');
    });
  });
});
