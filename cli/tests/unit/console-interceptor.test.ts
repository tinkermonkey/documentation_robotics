/**
 * Tests for the console interceptor module
 *
 * Tests verify that console methods are wrapped properly while preserving
 * original behavior. The actual telemetry emission is tested through integration
 * tests with the full telemetry module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

// Dynamically import after setting up test environment
let installConsoleInterceptor: any;
let uninstallConsoleInterceptor: any;

beforeEach(async () => {
  // Import fresh for each test to avoid state issues
  const module = await import('../../src/telemetry/console-interceptor.ts');
  installConsoleInterceptor = module.installConsoleInterceptor;
  uninstallConsoleInterceptor = module.uninstallConsoleInterceptor;
});

describe('Console Interceptor Module', () => {
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let originalWarn: typeof console.warn;
  let originalDebug: typeof console.debug;

  beforeEach(() => {
    // Store original methods before each test
    originalLog = console.log;
    originalError = console.error;
    originalWarn = console.warn;
    originalDebug = console.debug;
  });

  afterEach(() => {
    // Restore original methods after each test
    if (uninstallConsoleInterceptor) {
      uninstallConsoleInterceptor();
    }
    // Explicitly restore in case uninstall didn't work
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    console.debug = originalDebug;
  });

  describe('installConsoleInterceptor()', () => {
    it('should wrap console.log method', () => {
      const originalMethod = console.log;
      installConsoleInterceptor();
      const newMethod = console.log;

      // Method should be different after installation
      expect(newMethod).not.toBe(originalMethod);
    });

    it('should wrap console.error method', () => {
      const originalMethod = console.error;
      installConsoleInterceptor();
      const newMethod = console.error;

      expect(newMethod).not.toBe(originalMethod);
    });

    it('should wrap console.warn method', () => {
      const originalMethod = console.warn;
      installConsoleInterceptor();
      const newMethod = console.warn;

      expect(newMethod).not.toBe(originalMethod);
    });

    it('should wrap console.debug method', () => {
      const originalMethod = console.debug;
      installConsoleInterceptor();
      const newMethod = console.debug;

      expect(newMethod).not.toBe(originalMethod);
    });

    it('should not throw when installing interceptor', () => {
      expect(() => {
        installConsoleInterceptor();
      }).not.toThrow();
    });

    it('should preserve original console output behavior', () => {
      const output: string[] = [];
      const mockLog = (...args: any[]) => {
        output.push(args.join(' '));
      };
      console.log = mockLog;

      installConsoleInterceptor();
      console.log('test message');

      // Original method should still be called, so output should be captured
      expect(output).toHaveLength(1);
      expect(output[0]).toBe('test message');
    });

    it('should wrap multiple console methods together', () => {
      const originalLog = console.log;
      const originalError = console.error;
      const originalWarn = console.warn;
      const originalDebug = console.debug;

      installConsoleInterceptor();

      // All methods should be wrapped
      expect(console.log).not.toBe(originalLog);
      expect(console.error).not.toBe(originalError);
      expect(console.warn).not.toBe(originalWarn);
      expect(console.debug).not.toBe(originalDebug);
    });

    it('should allow multiple calls to console methods', () => {
      const output: string[] = [];
      console.log = (...args: any[]) => {
        output.push(args.join(' '));
      };

      installConsoleInterceptor();

      console.log('message 1');
      console.log('message 2');
      console.log('message 3');

      expect(output).toHaveLength(3);
    });

    it('should handle console methods with multiple arguments', () => {
      const output: string[] = [];
      console.log = (...args: any[]) => {
        output.push(JSON.stringify(args));
      };

      installConsoleInterceptor();
      console.log('arg1', 'arg2', { key: 'value' });

      expect(output).toHaveLength(1);
      expect(output[0]).toContain('arg1');
      expect(output[0]).toContain('arg2');
    });

    it('should handle all four console methods independently', () => {
      const output: string[] = [];
      const capture = (...args: any[]) => {
        output.push(args.join(' '));
      };

      console.log = capture;
      console.error = capture;
      console.warn = capture;
      console.debug = capture;

      installConsoleInterceptor();

      console.log('log');
      console.error('error');
      console.warn('warn');
      console.debug('debug');

      expect(output).toHaveLength(4);
      expect(output[0]).toBe('log');
      expect(output[1]).toBe('error');
      expect(output[2]).toBe('warn');
      expect(output[3]).toBe('debug');
    });
  });

  describe('uninstallConsoleInterceptor()', () => {
    it('should restore original console.log method', () => {
      installConsoleInterceptor();
      uninstallConsoleInterceptor();

      expect(console.log).toBe(originalLog);
    });

    it('should restore original console.error method', () => {
      installConsoleInterceptor();
      uninstallConsoleInterceptor();

      expect(console.error).toBe(originalError);
    });

    it('should restore original console.warn method', () => {
      installConsoleInterceptor();
      uninstallConsoleInterceptor();

      expect(console.warn).toBe(originalWarn);
    });

    it('should restore original console.debug method', () => {
      installConsoleInterceptor();
      uninstallConsoleInterceptor();

      expect(console.debug).toBe(originalDebug);
    });

    it('should restore all methods together', () => {
      installConsoleInterceptor();
      uninstallConsoleInterceptor();

      expect(console.log).toBe(originalLog);
      expect(console.error).toBe(originalError);
      expect(console.warn).toBe(originalWarn);
      expect(console.debug).toBe(originalDebug);
    });

    it('should not throw when uninstalling', () => {
      installConsoleInterceptor();

      expect(() => {
        uninstallConsoleInterceptor();
      }).not.toThrow();
    });

    it('should be safe to call multiple times', () => {
      installConsoleInterceptor();
      uninstallConsoleInterceptor();

      expect(() => {
        uninstallConsoleInterceptor();
      }).not.toThrow();
    });

    it('should restore wrapping behavior after uninstall', () => {
      const output: string[] = [];
      console.log = (...args: any[]) => {
        output.push(args.join(' '));
      };

      installConsoleInterceptor();
      console.log('during interception');

      uninstallConsoleInterceptor();
      output.length = 0;

      // After uninstall, console.log should work with just the mock
      console.log('after uninstall');

      // The message should be captured by the mock
      expect(output).toHaveLength(1);
      expect(output[0]).toBe('after uninstall');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty console.log call', () => {
      const output: string[] = [];
      console.log = (...args: any[]) => {
        output.push(args.length === 0 ? '(empty)' : args.join(' '));
      };

      installConsoleInterceptor();
      console.log();

      expect(output).toHaveLength(1);
    });

    it('should handle console.log with null and undefined', () => {
      const output: string[] = [];
      console.log = (...args: any[]) => {
        output.push(args.join(' '));
      };

      installConsoleInterceptor();
      console.log(null, undefined);

      expect(output).toHaveLength(1);
      expect(output[0]).toContain('null');
      expect(output[0]).toContain('undefined');
    });

    it('should handle console.log with objects', () => {
      const output: string[] = [];
      console.log = (...args: any[]) => {
        output.push(args.length);
      };

      installConsoleInterceptor();
      const obj = { a: 1, b: { c: 2 } };
      console.log(obj);

      expect(output).toHaveLength(1);
    });

    it('should handle console.error with Error object', () => {
      const output: string[] = [];
      console.error = (...args: any[]) => {
        output.push(args.length);
      };

      installConsoleInterceptor();
      const error = new Error('test error');
      console.error(error);

      expect(output).toHaveLength(1);
    });

    it('should handle rapid successive calls', () => {
      const output: string[] = [];
      console.log = (...args: any[]) => {
        output.push(args.join(' '));
      };

      installConsoleInterceptor();

      for (let i = 0; i < 10; i++) {
        console.log(`message ${i}`);
      }

      expect(output).toHaveLength(10);
    });

    it('should handle installation when already installed', () => {
      installConsoleInterceptor();
      const firstWrap = console.log;

      installConsoleInterceptor();
      const secondWrap = console.log;

      // Second installation should wrap again (wrapping the wrapper)
      expect(secondWrap).not.toBe(firstWrap);
    });
  });

  describe('Backwards Compatibility', () => {
    it('should maintain console.log signature', () => {
      installConsoleInterceptor();

      // Should accept any arguments like the original
      expect(() => {
        console.log('string', 123, true, { obj: 'ect' }, null, undefined);
      }).not.toThrow();
    });

    it('should maintain console.error signature', () => {
      installConsoleInterceptor();

      expect(() => {
        console.error('error', new Error('test'));
      }).not.toThrow();
    });

    it('should maintain console.warn signature', () => {
      installConsoleInterceptor();

      expect(() => {
        console.warn('warning', 'message');
      }).not.toThrow();
    });

    it('should maintain console.debug signature', () => {
      installConsoleInterceptor();

      expect(() => {
        console.debug('debug', 'info');
      }).not.toThrow();
    });
  });
});
