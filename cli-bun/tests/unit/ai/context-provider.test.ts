/**
 * Tests for ModelContextProvider
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { Model } from '../../../src/core/model';
import { Manifest } from '../../../src/core/manifest';
import { ModelContextProvider } from '../../../src/ai/context-provider';
import { Layer } from '../../../src/core/layer';
import { Element } from '../../../src/core/element';

describe('ModelContextProvider', () => {
  let model: Model;
  let provider: ModelContextProvider;

  beforeEach(() => {
    // Create a test model with some layers and elements
    const manifest = new Manifest('Test Model', '1.0.0', 'A test model', 'Test Author');
    model = new Model('/tmp/test', manifest);

    // Add a test layer with elements
    const layer = new Layer('motivation');
    layer.addElement(
      new Element('motivation-goal-test-goal', 'goal', 'Test Goal', 'A test goal')
    );
    layer.addElement(
      new Element('motivation-requirement-test-req', 'requirement', 'Test Requirement', 'A test requirement')
    );
    model.addLayer(layer);

    // Create context provider
    provider = new ModelContextProvider(model);
  });

  describe('generateContext', () => {
    it('should generate context with model information', async () => {
      const context = await provider.generateContext();

      expect(context).toContain('Current Architecture Model');
      expect(context).toContain('Test Model');
      expect(context).toContain('1.0.0');
      expect(context).toContain('A test model');
    });

    it('should include layer information', async () => {
      const context = await provider.generateContext();

      expect(context).toContain('Layers Overview');
      expect(context).toContain('motivation');
    });

    it('should include element summaries', async () => {
      const context = await provider.generateContext();

      expect(context).toContain('Element Summary');
      expect(context).toContain('Test Goal');
      expect(context).toContain('Test Requirement');
    });
  });

  describe('getAvailableLayers', () => {
    it('should return list of available layers', () => {
      const layers = provider.getAvailableLayers();

      expect(layers).toContain('motivation');
      expect(layers).toContain('business');
      expect(layers).toContain('api');
      expect(layers.length).toBe(12);
    });
  });

  describe('getLayerElementCount', () => {
    it('should return element count for a layer', async () => {
      const count = await provider.getLayerElementCount('motivation');
      expect(count).toBe(2);
    });

    it('should return 0 for unloaded layer', async () => {
      const count = await provider.getLayerElementCount('business');
      expect(count).toBe(0);
    });
  });

  describe('getTotalElementCount', () => {
    it('should return total element count', async () => {
      const count = await provider.getTotalElementCount();
      expect(count).toBe(2);
    });
  });
});
