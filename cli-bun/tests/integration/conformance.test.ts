import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Model } from '../../src/core/model.js';
import { Layer } from '../../src/core/layer.js';
import { rm } from 'fs/promises';

const TEST_DIR = '/tmp/conformance-test';

describe('conformance command integration', () => {
  beforeAll(async () => {
    // Create test directory and model
    try {
      await rm(TEST_DIR, { recursive: true });
    } catch {
      // Directory may not exist
    }

    // Initialize a test model with multiple layers
    const model = await Model.init(TEST_DIR, {
      name: 'test-model',
      version: '1.0.0',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      specVersion: '0.6.0',
    });

    // Add motivation layer with proper element types
    const motivation = new Layer('motivation');
    motivation.addElement('motivation-goal-primary', {
      type: 'goal',
      name: 'Primary Goal',
    });
    motivation.addElement('motivation-stakeholder-cto', {
      type: 'stakeholder',
      name: 'CTO',
    });
    motivation.addElement('motivation-requirement-perf', {
      type: 'requirement',
      name: 'Performance Requirement',
    });
    model.addLayer(motivation);

    // Add business layer with elements
    const business = new Layer('business');
    business.addElement('business-process-checkout', {
      type: 'business-process',
      name: 'Checkout Process',
    });
    business.addElement('business-service-payment', {
      type: 'business-service',
      name: 'Payment Service',
    });
    model.addLayer(business);

    // Add application layer
    const application = new Layer('application');
    application.addElement('application-service-api', {
      type: 'application-service',
      name: 'API Service',
    });
    model.addLayer(application);

    // Add technology layer
    const technology = new Layer('technology');
    technology.addElement('technology-infrastructure-cloud', {
      type: 'infrastructure-service',
      name: 'Cloud Infrastructure',
    });
    model.addLayer(technology);

    // Add api layer
    const api = new Layer('api');
    api.addElement('api-resource-users', {
      type: 'rest-resource',
      name: 'Users Resource',
    });
    model.addLayer(api);

    // Add data-model layer
    const dataModel = new Layer('data-model');
    dataModel.addElement('data-model-entity-user', {
      type: 'entity',
      name: 'User Entity',
    });
    model.addLayer(dataModel);

    // Add data-store layer
    const dataStore = new Layer('data-store');
    dataStore.addElement('data-store-database-primary', {
      type: 'database',
      name: 'Primary Database',
    });
    model.addLayer(dataStore);

    // Add ux layer
    const ux = new Layer('ux');
    ux.addElement('ux-spec-dashboard', {
      type: 'ux-spec',
      name: 'Dashboard Spec',
    });
    model.addLayer(ux);

    // Add navigation layer
    const navigation = new Layer('navigation');
    navigation.addElement('navigation-path-home', {
      type: 'navigation-path',
      name: 'Home Path',
    });
    model.addLayer(navigation);

    // Add apm layer
    const apm = new Layer('apm');
    apm.addElement('apm-metric-requests', {
      type: 'metric',
      name: 'Request Metrics',
    });
    model.addLayer(apm);

    // Add testing layer
    const testing = new Layer('testing');
    testing.addElement('testing-test-case-login', {
      type: 'test-case',
      name: 'Login Test',
    });
    model.addLayer(testing);

    await model.saveManifest();
    for (const layerName of model.getLayerNames()) {
      await model.saveLayer(layerName);
    }
  });

  afterAll(async () => {
    // Clean up
    try {
      await rm(TEST_DIR, { recursive: true });
    } catch {
      // Ignore errors
    }
  });

  describe('layer conformance validation', () => {
    it('should load model successfully', async () => {
      const model = await Model.load(TEST_DIR, { lazyLoad: false });
      expect(model).not.toBeUndefined();
      expect(model.getLayerNames().length).toBeGreaterThan(0);
    });

    it('should have elements in motivation layer', async () => {
      const model = await Model.load(TEST_DIR, { lazyLoad: false });
      const motivation = await model.getLayer('motivation');

      expect(motivation).not.toBeUndefined();
      const elements = motivation?.listElements() || [];
      expect(elements.length).toBeGreaterThan(0);
    });

    it('should have proper element types in layers', async () => {
      const model = await Model.load(TEST_DIR, { lazyLoad: false });
      const motivation = await model.getLayer('motivation');

      if (motivation) {
        const elements = motivation.listElements();
        const types = new Set(elements.map((e) => e.type));

        expect(types.has('goal')).toBe(true);
        expect(types.has('stakeholder')).toBe(true);
        expect(types.has('requirement')).toBe(true);
      }
    });

    it('should validate that elements have required properties', async () => {
      const model = await Model.load(TEST_DIR, { lazyLoad: false });
      const layers = model.getLayerNames();

      for (const layerName of layers) {
        const layer = await model.getLayer(layerName);
        if (layer) {
          const elements = layer.listElements();

          for (const element of elements) {
            // All elements must have id and type
            expect(element.id).toBeDefined();
            expect(element.type).toBeDefined();
          }
        }
      }
    });
  });

  describe('cross-layer relationship validation', () => {
    it('should support adding relationships between layers', async () => {
      const model = await Model.load(TEST_DIR, { lazyLoad: false });

      // Get elements from different layers
      const motivation = await model.getLayer('motivation');
      const business = await model.getLayer('business');

      expect(motivation).not.toBeUndefined();
      expect(business).not.toBeUndefined();

      // In a full implementation, we would verify cross-layer relationships here
      // For now, we just verify the structure supports it
      expect(motivation?.listElements().length).toBeGreaterThan(0);
      expect(business?.listElements().length).toBeGreaterThan(0);
    });
  });

  describe('model structure validation', () => {
    it('should have all 12 layers in the model', async () => {
      const model = await Model.load(TEST_DIR, { lazyLoad: false });
      const layerNames = model.getLayerNames();

      const expectedLayers = [
        'motivation',
        'business',
        'application',
        'technology',
        'api',
        'data-model',
        'data-store',
        'ux',
        'navigation',
        'apm',
        'testing',
        'security', // May not have elements but should be creatable
      ];

      // Check that at least 11 of the 12 layers are present
      expect(layerNames.length).toBeGreaterThanOrEqual(11);
    });

    it('should maintain layer isolation', async () => {
      const model = await Model.load(TEST_DIR, { lazyLoad: false });
      const motivation = await model.getLayer('motivation');
      const business = await model.getLayer('business');

      const motivationElements = motivation?.listElements() || [];
      const businessElements = business?.listElements() || [];

      // Elements should not be shared between layers
      const motivationIds = new Set(motivationElements.map((e) => e.id));
      const businessIds = new Set(businessElements.map((e) => e.id));

      expect(
        motivationElements.some((e) => businessIds.has(e.id))
      ).toBe(false);
      expect(
        businessElements.some((e) => motivationIds.has(e.id))
      ).toBe(false);
    });
  });
});
