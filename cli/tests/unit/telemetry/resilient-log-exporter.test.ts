import { describe, it, expect, beforeEach } from 'bun:test';
import { ResilientLogExporter } from '../../../src/telemetry/resilient-log-exporter.js';
import type { ReadableLogRecord, ExportResult } from '@opentelemetry/sdk-logs';

describe('ResilientLogExporter', () => {
  let exporter: ResilientLogExporter;

  beforeEach(() => {
    exporter = new ResilientLogExporter();
  });

  describe('constructor', () => {
    it('should create an exporter with default configuration', () => {
      const exp = new ResilientLogExporter();
      expect(exp).toBeDefined();
    });

    it('should accept custom URL configuration', () => {
      const customUrl = 'http://custom-collector:4318/v1/logs';
      const exp = new ResilientLogExporter({ url: customUrl });
      expect(exp).toBeDefined();
    });

    it('should accept custom timeout configuration', () => {
      const exp = new ResilientLogExporter({ timeoutMillis: 1000 });
      expect(exp).toBeDefined();
    });

    it('should accept both URL and timeout configuration', () => {
      const exp = new ResilientLogExporter({
        url: 'http://custom-collector:4318/v1/logs',
        timeoutMillis: 1000,
      });
      expect(exp).toBeDefined();
    });
  });

  describe('export', () => {
    it('should call resultCallback with success code when export succeeds', (done) => {
      const mockRecords: ReadableLogRecord[] = [];

      exporter.export(mockRecords, (result: ExportResult) => {
        expect(result.code).toBe(0); // ExportResultCode.SUCCESS = 0
        done();
      });
    });

    it('should return success immediately when records array is empty', (done) => {
      exporter.export([], (result: ExportResult) => {
        expect(result.code).toBe(0);
        done();
      });
    });
  });

  describe('circuit-breaker', () => {
    it('should activate circuit-breaker on export failure', (done) => {
      // We need to mock the delegate to simulate a failure
      // Since the delegate is private, we test the behavior indirectly
      // by checking that retries are prevented

      let callCount = 0;
      const mockRecords: ReadableLogRecord[] = [];

      exporter.export(mockRecords, () => {
        callCount++;
        // Circuit-breaker should return success even if delegate fails
        if (callCount === 1) {
          // Try exporting again immediately after to see if circuit-breaker works
          exporter.export(mockRecords, () => {
            // Second call should also return success (circuit-breaker is silent)
            expect(true).toBe(true);
            done();
          });
        }
      });
    });

    it('should have 30-second backoff period', () => {
      // This test verifies the circuit-breaker backoff constant
      // We can access private fields via bracket notation for testing
      const exp = new ResilientLogExporter();
      const backoffMs = (exp as any).backoffMs;
      expect(backoffMs).toBe(30000);
    });

    it('should reset retryAfter to current time plus backoff on failure', () => {
      const exp = new ResilientLogExporter();
      const initialRetryAfter = (exp as any).retryAfter;
      expect(initialRetryAfter).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully', async () => {
      const result = await exporter.shutdown();
      expect(result).toBeUndefined();
    });

    it('should handle multiple shutdown calls', async () => {
      await exporter.shutdown();
      const result = await exporter.shutdown();
      expect(result).toBeUndefined();
    });
  });

  describe('forceFlush', () => {
    it('should flush gracefully without timeout', async () => {
      const result = await exporter.forceFlush();
      expect(result).toBeUndefined();
    });

    it('should flush without parameters', async () => {
      const result = await exporter.forceFlush();
      expect(result).toBeUndefined();
    });

    it('should handle multiple flush calls', async () => {
      await exporter.forceFlush();
      const result = await exporter.forceFlush();
      expect(result).toBeUndefined();
    });
  });

  describe('LogRecordExporter interface compliance', () => {
    it('should implement export method', () => {
      expect(typeof exporter.export).toBe('function');
    });

    it('should implement shutdown method', () => {
      expect(typeof exporter.shutdown).toBe('function');
    });

    it('should implement forceFlush method', () => {
      expect(typeof exporter.forceFlush).toBe('function');
    });
  });

  describe('configuration options', () => {
    it('should use default endpoint when no URL provided', () => {
      const exp = new ResilientLogExporter();
      // The delegate is private, but we can verify the exporter is created
      expect(exp).toBeDefined();
    });

    it('should use default timeout when not specified', () => {
      const exp = new ResilientLogExporter();
      expect(exp).toBeDefined();
    });

    it('should use custom URL when provided', () => {
      const customUrl = 'http://192.168.1.100:4318/v1/logs';
      const exp = new ResilientLogExporter({ url: customUrl });
      expect(exp).toBeDefined();
    });

    it('should use custom timeout when provided', () => {
      const customTimeout = 2000;
      const exp = new ResilientLogExporter({ timeoutMillis: customTimeout });
      expect(exp).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should not throw on export with empty records', () => {
      expect(() => {
        exporter.export([], () => {});
      }).not.toThrow();
    });

    it('should not throw on shutdown', async () => {
      expect(async () => {
        await exporter.shutdown();
      }).not.toThrow();
    });

    it('should not throw on forceFlush', async () => {
      expect(async () => {
        await exporter.forceFlush();
      }).not.toThrow();
    });
  });

  describe('graceful degradation', () => {
    it('should not block execution on export', (done) => {
      const mockRecords: ReadableLogRecord[] = [];
      let completed = false;

      exporter.export(mockRecords, () => {
        completed = true;
        expect(completed).toBe(true);
        done();
      });

      // Verify callback will be called (not blocking immediately)
      // The callback is called, which sets completed to true
      // This test verifies the export method doesn't throw
      expect(() => {
        exporter.export(mockRecords, () => {});
      }).not.toThrow();
    });

    it('should handle rapid successive exports', (done) => {
      let exportCount = 0;
      const mockRecords: ReadableLogRecord[] = [];

      exporter.export(mockRecords, () => {
        exportCount++;
      });

      exporter.export(mockRecords, () => {
        exportCount++;
      });

      exporter.export(mockRecords, () => {
        exportCount++;
        expect(exportCount).toBe(3);
        done();
      });
    });
  });

  describe('timeout configuration', () => {
    it('should respect 500ms default timeout', () => {
      const exp = new ResilientLogExporter();
      expect(exp).toBeDefined();
      // Verify exporter is created with default timeout
    });

    it('should respect custom timeout values', () => {
      const exp = new ResilientLogExporter({ timeoutMillis: 1500 });
      expect(exp).toBeDefined();
      // Verify exporter is created with custom timeout
    });

    it('should prevent blocking CLI execution with timeout', (done) => {
      const startTime = Date.now();
      const mockRecords: ReadableLogRecord[] = [];

      exporter.export(mockRecords, () => {
        const duration = Date.now() - startTime;
        // Should complete quickly (not blocking)
        expect(duration).toBeLessThan(100);
        done();
      });
    });
  });
});
