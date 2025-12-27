/**
 * Tests for the telemetry module
 *
 * Note: TELEMETRY_ENABLED is a compile-time constant set by esbuild.
 * For testing, we mock it as false to test the no-op behavior.
 */

import { describe, it, expect } from 'bun:test';

// Mock TELEMETRY_ENABLED as false for testing
(globalThis as any).TELEMETRY_ENABLED = false;

// Import after setting the global
import * as telemetry from '../../src/telemetry/index';

describe('Telemetry Module (Production No-Op Mode)', () => {
  describe('initTelemetry()', () => {
    it('should initialize without errors', () => {
      // Should not throw when TELEMETRY_ENABLED is false
      expect(() => telemetry.initTelemetry()).not.toThrow();
    });
  });

  describe('startSpan()', () => {
    it('should return null when TELEMETRY_ENABLED is false', () => {
      const span = telemetry.startSpan('test-span', {
        'test.attr': 'value',
      });
      // In production mode (TELEMETRY_ENABLED=false), returns null
      expect(span).toBeNull();
    });
  });

  describe('endSpan()', () => {
    it('should safely handle null spans', () => {
      // Should not throw when passed null
      expect(() => telemetry.endSpan(null)).not.toThrow();
    });

    it('should be no-op with null span', () => {
      const span = telemetry.startSpan('test');
      expect(span).toBeNull();
      // Should not throw when passed null
      expect(() => telemetry.endSpan(span)).not.toThrow();
    });
  });

  describe('shutdownTelemetry()', () => {
    it('should shutdown gracefully', async () => {
      // Should not throw even if no SDK was initialized
      const result = await telemetry.shutdownTelemetry();
      expect(result === undefined).toBe(true);
    });
  });
});
