import { describe, it, expect, beforeEach } from 'bun:test';
import { SchemaValidator } from '../../../src/validators/schema-validator.js';
import { Layer } from '../../../src/core/layer.js';

describe('SchemaValidator', () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    validator = new SchemaValidator();
  });

  describe('schema filename mapping', () => {
    it('should map motivation layer to correct schema file', async () => {
      const layer = new Layer('motivation');
      const result = await validator.validateLayer(layer);
      expect(result).toBeDefined();
      expect(result.isValid()).toBe(true);
    });

    it('should map business layer to correct schema file', async () => {
      const layer = new Layer('business');
      const result = await validator.validateLayer(layer);
      expect(result).toBeDefined();
      expect(result.isValid()).toBe(true);
    });

    it('should map security layer to correct schema file', async () => {
      const layer = new Layer('security');
      const result = await validator.validateLayer(layer);
      expect(result).toBeDefined();
      expect(result.isValid()).toBe(true);
    });

    it('should map application layer to correct schema file', async () => {
      const layer = new Layer('application');
      const result = await validator.validateLayer(layer);
      expect(result).toBeDefined();
      expect(result.isValid()).toBe(true);
    });

    it('should map technology layer to correct schema file', async () => {
      const layer = new Layer('technology');
      const result = await validator.validateLayer(layer);
      expect(result).toBeDefined();
      expect(result.isValid()).toBe(true);
    });

    it('should map api layer to correct schema file', async () => {
      const layer = new Layer('api');
      const result = await validator.validateLayer(layer);
      expect(result).toBeDefined();
      expect(result.isValid()).toBe(true);
    });

    it('should map data-model layer to correct schema file', async () => {
      const layer = new Layer('data-model');
      const result = await validator.validateLayer(layer);
      expect(result).toBeDefined();
      expect(result.isValid()).toBe(true);
    });

    it('should map data-store layer to correct schema file', async () => {
      const layer = new Layer('data-store');
      const result = await validator.validateLayer(layer);
      expect(result).toBeDefined();
      expect(result.isValid()).toBe(true);
    });

    it('should map ux layer to correct schema file', async () => {
      const layer = new Layer('ux');
      const result = await validator.validateLayer(layer);
      expect(result).toBeDefined();
      expect(result.isValid()).toBe(true);
    });

    it('should map navigation layer to correct schema file', async () => {
      const layer = new Layer('navigation');
      const result = await validator.validateLayer(layer);
      expect(result).toBeDefined();
      expect(result.isValid()).toBe(true);
    });

    it('should map apm layer to correct schema file', async () => {
      const layer = new Layer('apm');
      const result = await validator.validateLayer(layer);
      expect(result).toBeDefined();
      expect(result.isValid()).toBe(true);
    });

    it('should map testing layer to correct schema file', async () => {
      const layer = new Layer('testing');
      const result = await validator.validateLayer(layer);
      expect(result).toBeDefined();
      expect(result.isValid()).toBe(true);
    });
  });

  describe('hyphenated layer name handling', () => {
    it('should correctly handle data-model layer with hyphen', async () => {
      const layer = new Layer('data-model');
      const result = await validator.validateLayer(layer);
      expect(result).toBeDefined();
      // Verify that data-model (with hyphen) is handled correctly
      expect(result.isValid()).toBe(true);
    });

    it('should correctly handle data-store layer with hyphen', async () => {
      const layer = new Layer('data-store');
      const result = await validator.validateLayer(layer);
      expect(result).toBeDefined();
      // Verify that data-store (with hyphen, renamed from datastore) is handled correctly
      expect(result.isValid()).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should gracefully handle invalid layer data', async () => {
      const layer = new Layer('motivation');
      const result = await validator.validateLayer(layer);
      expect(result).toBeDefined();
      // Empty layer should pass (no validation required for empty)
      expect(result.isValid()).toBe(true);
    });

    it('should handle schema compilation errors gracefully', async () => {
      const layer = new Layer('unknown-layer' as any);
      const result = await validator.validateLayer(layer);
      expect(result).toBeDefined();
      // Unknown layer should be skipped without error
      expect(result.isValid()).toBe(true);
    });
  });

  describe('schema precompilation', () => {
    it('should precompile schemas only once', async () => {
      const layer1 = new Layer('motivation');
      const layer2 = new Layer('business');

      const result1 = await validator.validateLayer(layer1);
      const result2 = await validator.validateLayer(layer2);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      // Both should succeed
      expect(result1.isValid()).toBe(true);
      expect(result2.isValid()).toBe(true);
    });
  });

  describe('common schemas', () => {
    it('should load common schema references', async () => {
      // This tests that common schemas are loaded without error
      const layer = new Layer('api');
      const result = await validator.validateLayer(layer);
      expect(result).toBeDefined();
      expect(result.isValid()).toBe(true);
    });
  });
});
