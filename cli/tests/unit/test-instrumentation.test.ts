/**
 * Unit tests for test instrumentation module.
 *
 * Tests the test span creation utilities with telemetry disabled
 * (production mode) and verifies graceful fallback behavior.
 */

import { describe, it, expect, beforeEach } from 'bun:test';

// Mock TELEMETRY_ENABLED as false for testing no-op behavior
(globalThis as any).TELEMETRY_ENABLED = false;

import * as testInstrumentation from '../../src/telemetry/test-instrumentation.js';

describe('Test Instrumentation (Production No-Op Mode)', () => {
  describe('startTestFileSpan()', () => {
    it('should return null when TELEMETRY_ENABLED is false', () => {
      const span = testInstrumentation.startTestFileSpan(
        'tests/unit/example.test.ts'
      );
      expect(span).toBeNull();
    });

    it('should not throw with empty file path', () => {
      expect(() => {
        testInstrumentation.startTestFileSpan('');
      }).not.toThrow();
    });

    it('should not throw with absolute file path', () => {
      expect(() => {
        testInstrumentation.startTestFileSpan(
          '/absolute/path/to/test.ts'
        );
      }).not.toThrow();
    });

    it('should not throw with relative file path', () => {
      expect(() => {
        testInstrumentation.startTestFileSpan(
          '../relative/path/to/test.ts'
        );
      }).not.toThrow();
    });
  });

  describe('endTestFileSpan()', () => {
    it('should not throw when called', () => {
      expect(() => {
        testInstrumentation.endTestFileSpan();
      }).not.toThrow();
    });

    it('should be safe to call multiple times', () => {
      expect(() => {
        testInstrumentation.endTestFileSpan();
        testInstrumentation.endTestFileSpan();
        testInstrumentation.endTestFileSpan();
      }).not.toThrow();
    });

    it('should not throw even if startTestFileSpan was not called', () => {
      expect(() => {
        testInstrumentation.endTestFileSpan();
      }).not.toThrow();
    });
  });

  describe('createTestCaseSpan()', () => {
    it('should return null when TELEMETRY_ENABLED is false', () => {
      const span = testInstrumentation.createTestCaseSpan('test name');
      expect(span).toBeNull();
    });

    it('should return null with test name only', () => {
      const span = testInstrumentation.createTestCaseSpan(
        'should do something'
      );
      expect(span).toBeNull();
    });

    it('should return null with test name and suite name', () => {
      const span = testInstrumentation.createTestCaseSpan(
        'should do something',
        'MyTestSuite'
      );
      expect(span).toBeNull();
    });

    it('should not throw with empty test name', () => {
      expect(() => {
        testInstrumentation.createTestCaseSpan('');
      }).not.toThrow();
    });

    it('should not throw with empty suite name', () => {
      expect(() => {
        testInstrumentation.createTestCaseSpan('test', '');
      }).not.toThrow();
    });

    it('should not throw with special characters in names', () => {
      expect(() => {
        testInstrumentation.createTestCaseSpan(
          "should handle 'special' characters & symbols!",
          'Suite.with.dots/and\\slashes'
        );
      }).not.toThrow();
    });
  });

  describe('recordTestResult()', () => {
    it('should handle null span gracefully', () => {
      expect(() => {
        testInstrumentation.recordTestResult(null, 'pass');
      }).not.toThrow();
    });

    it('should handle pass status', () => {
      expect(() => {
        testInstrumentation.recordTestResult(null, 'pass');
      }).not.toThrow();
    });

    it('should handle fail status without error', () => {
      expect(() => {
        testInstrumentation.recordTestResult(null, 'fail');
      }).not.toThrow();
    });

    it('should handle fail status with error', () => {
      const error = new Error('Test failed');
      expect(() => {
        testInstrumentation.recordTestResult(null, 'fail', error);
      }).not.toThrow();
    });

    it('should handle skip status', () => {
      expect(() => {
        testInstrumentation.recordTestResult(null, 'skip');
      }).not.toThrow();
    });

    it('should handle error without message', () => {
      const error = new Error();
      expect(() => {
        testInstrumentation.recordTestResult(null, 'fail', error);
      }).not.toThrow();
    });

    it('should handle error without stack', () => {
      const error = new Error('Test error');
      error.stack = undefined;
      expect(() => {
        testInstrumentation.recordTestResult(null, 'fail', error);
      }).not.toThrow();
    });
  });

  describe('instrumentTest()', () => {
    it('should return a function', () => {
      const wrapped = testInstrumentation.instrumentTest('test', () => {});
      expect(typeof wrapped).toBe('function');
    });

    it('should return an async function', async () => {
      const wrapped = testInstrumentation.instrumentTest('test', () => {});
      expect(wrapped instanceof Promise || wrapped.constructor.name === 'AsyncFunction').toBe(true);
    });

    it('should execute sync test functions', async () => {
      let executed = false;
      const wrapped = testInstrumentation.instrumentTest('test', () => {
        executed = true;
      });
      await wrapped();
      expect(executed).toBe(true);
    });

    it('should execute async test functions', async () => {
      let executed = false;
      const wrapped = testInstrumentation.instrumentTest('test', async () => {
        executed = true;
      });
      await wrapped();
      expect(executed).toBe(true);
    });

    it('should re-throw errors from test function', async () => {
      const testError = new Error('Test failed intentionally');
      const wrapped = testInstrumentation.instrumentTest('test', () => {
        throw testError;
      });

      let caughtError: Error | null = null;
      try {
        await wrapped();
      } catch (error) {
        caughtError = error as Error;
      }

      expect(caughtError).toBe(testError);
    });

    it('should handle async errors', async () => {
      const testError = new Error('Async test failed');
      const wrapped = testInstrumentation.instrumentTest('test', async () => {
        throw testError;
      });

      let caughtError: Error | null = null;
      try {
        await wrapped();
      } catch (error) {
        caughtError = error as Error;
      }

      expect(caughtError).toBe(testError);
    });

    it('should accept optional suite name', () => {
      const wrapped = testInstrumentation.instrumentTest(
        'test name',
        () => {},
        'Suite Name'
      );
      expect(typeof wrapped).toBe('function');
    });

    it('should not throw with special characters in names', () => {
      const wrapped = testInstrumentation.instrumentTest(
        "should handle 'quotes' and \"double quotes\"",
        () => {},
        'Suite-with.dots/and\\slashes'
      );
      expect(typeof wrapped).toBe('function');
    });

    it('should handle undefined error in catch', async () => {
      const wrapped = testInstrumentation.instrumentTest('test', async () => {
        throw undefined;
      });

      let caughtError: unknown = null;
      try {
        await wrapped();
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeUndefined();
    });
  });

  describe('Integration: File and Case Spans', () => {
    it('should handle file span lifecycle', async () => {
      expect(() => {
        testInstrumentation.startTestFileSpan('test.ts');
        testInstrumentation.endTestFileSpan();
      }).not.toThrow();
    });

    it('should handle case spans within file span', async () => {
      expect(() => {
        testInstrumentation.startTestFileSpan('test.ts');

        const span1 = testInstrumentation.createTestCaseSpan(
          'test 1',
          'Suite'
        );
        testInstrumentation.recordTestResult(span1, 'pass');

        const span2 = testInstrumentation.createTestCaseSpan(
          'test 2',
          'Suite'
        );
        testInstrumentation.recordTestResult(span2, 'fail', new Error('Failed'));

        testInstrumentation.endTestFileSpan();
      }).not.toThrow();
    });

    it('should handle multiple test files sequentially', async () => {
      expect(() => {
        // File 1
        testInstrumentation.startTestFileSpan('file1.test.ts');
        const span1 = testInstrumentation.createTestCaseSpan('test1');
        testInstrumentation.recordTestResult(span1, 'pass');
        testInstrumentation.endTestFileSpan();

        // File 2
        testInstrumentation.startTestFileSpan('file2.test.ts');
        const span2 = testInstrumentation.createTestCaseSpan('test2');
        testInstrumentation.recordTestResult(span2, 'pass');
        testInstrumentation.endTestFileSpan();
      }).not.toThrow();
    });
  });
});
