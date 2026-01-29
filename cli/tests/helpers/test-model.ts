import { Model } from '../../src/core/model.js';
import { Layer } from '../../src/core/layer.js';
import { Element } from '../../src/core/element.js';

/**
 * Creates a test model with standard test data for WebSocket/visualization server tests.
 *
 * This helper is used by WebSocket test files (visualization-server-websocket-advanced.test.ts).
 * Other visualization server tests have their own createTestModel functions with
 * different element configurations for their specific test requirements.
 *
 * @param rootPath - Root path where the model should be created
 * @returns The created Model instance
 */
export async function createTestModel(rootPath: string): Promise<Model> {
  // Initialize model
  // Eager loading required: WebSocket test helper creates model with multiple cross-layer elements
  // and requires all layers loaded for proper element indexing and reference resolution
  const model = await Model.init(rootPath, {
    name: 'WebSocket Advanced Test Model',
    version: '0.1.0',
    description: 'Model for advanced WebSocket testing',
    specVersion: '0.6.0',
    created: new Date().toISOString(),
  }, { lazyLoad: false });

  // Create motivation layer with multiple elements
  const motivationLayer = new Layer('motivation');
  motivationLayer.addElement(new Element({
    id: 'motivation-goal-ws-1',
    name: 'WebSocket Test Goal 1',
    type: 'goal',
    description: 'First goal for WebSocket testing',
    properties: {},
    relationships: [],
    references: [],
    layer: 'motivation'
  }));

  motivationLayer.addElement(new Element({
    id: 'motivation-goal-ws-2',
    name: 'WebSocket Test Goal 2',
    type: 'goal',
    description: 'Second goal for WebSocket testing',
    properties: {},
    relationships: [],
    references: [],
    layer: 'motivation'
  }));

  model.addLayer(motivationLayer);

  // Create business layer
  const businessLayer = new Layer('business');
  businessLayer.addElement(new Element({
    id: 'business-service-ws-1',
    name: 'WebSocket Test Service',
    type: 'service',
    description: 'Service for WebSocket testing',
    properties: {},
    relationships: [],
    references: ['motivation-goal-ws-1'],
    layer: 'business'
  }));

  model.addLayer(businessLayer);

  // Save layers
  await model.saveLayer('motivation');
  await model.saveLayer('business');
  await model.saveManifest();

  return model;
}
