/**
 * Tests for the console interceptor module
 *
 * Tests verify that console methods are wrapped properly while preserving
 * original behavior. The actual telemetry emission is tested through integration
 * tests with the full telemetry module.
 *
 * Note: When TELEMETRY_ENABLED is false (CI environment), the interceptor
 * is a no-op and these tests verify that console methods remain unwrapped.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

// Dynamically import after setting up test environment
let installConsoleInterceptor: any;
let uninstallConsoleInterceptor: any;

// Detect telemetry state from environment
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

beforeEach(async () => {
  // Import fresh for each test to avoid state issues
  const module = await import("../../src/telemetry/console-interceptor.ts");
  installConsoleInterceptor = module.installConsoleInterceptor;
  uninstallConsoleInterceptor = module.uninstallConsoleInterceptor;
});

describe("Console Interceptor Module", () => {
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

  describe("installConsoleInterceptor()", () => {
    it("should wrap console.log method when telemetry is enabled", async () => {
      const originalMethod = console.log;
      await installConsoleInterceptor();
      const newMethod = console.log;

      if (isTelemetryEnabled) {
        // When telemetry is enabled, method should be wrapped
        expect(newMethod).not.toBe(originalMethod);
      } else {
        // When telemetry is disabled, method should remain unchanged
        expect(newMethod).toBe(originalMethod);
      }
    });

    it("should wrap console.error method when telemetry is enabled", async () => {
      const originalMethod = console.error;
      await installConsoleInterceptor();
      const newMethod = console.error;

      if (isTelemetryEnabled) {
        expect(newMethod).not.toBe(originalMethod);
      } else {
        expect(newMethod).toBe(originalMethod);
      }
    });

    it("should wrap console.warn method when telemetry is enabled", async () => {
      const originalMethod = console.warn;
      await installConsoleInterceptor();
      const newMethod = console.warn;

      if (isTelemetryEnabled) {
        expect(newMethod).not.toBe(originalMethod);
      } else {
        expect(newMethod).toBe(originalMethod);
      }
    });

    it("should wrap console.debug method when telemetry is enabled", async () => {
      const originalMethod = console.debug;
      await installConsoleInterceptor();
      const newMethod = console.debug;

      if (isTelemetryEnabled) {
        expect(newMethod).not.toBe(originalMethod);
      } else {
        expect(newMethod).toBe(originalMethod);
      }
    });

    it("should not throw when installing interceptor", async () => {
      await expect(async () => {
        await installConsoleInterceptor();
      }).not.toThrow();
    });

    it("should preserve original console output behavior", async () => {
      const output: string[] = [];
      const mockLog = (...args: any[]) => {
        output.push(args.join(" "));
      };
      console.log = mockLog;

      await installConsoleInterceptor();
      console.log("test message");

      // Original method should still be called, so output should be captured
      expect(output).toHaveLength(1);
      expect(output[0]).toBe("test message");
    });

    it("should wrap multiple console methods together when telemetry is enabled", async () => {
      const originalLog = console.log;
      const originalError = console.error;
      const originalWarn = console.warn;
      const originalDebug = console.debug;

      await installConsoleInterceptor();

      if (isTelemetryEnabled) {
        // All methods should be wrapped when telemetry is enabled
        expect(console.log).not.toBe(originalLog);
        expect(console.error).not.toBe(originalError);
        expect(console.warn).not.toBe(originalWarn);
        expect(console.debug).not.toBe(originalDebug);
      } else {
        // All methods should remain unchanged when telemetry is disabled
        expect(console.log).toBe(originalLog);
        expect(console.error).toBe(originalError);
        expect(console.warn).toBe(originalWarn);
        expect(console.debug).toBe(originalDebug);
      }
    });

    it("should allow multiple calls to console methods", async () => {
      const output: string[] = [];
      console.log = (...args: any[]) => {
        output.push(args.join(" "));
      };

      await installConsoleInterceptor();

      console.log("message 1");
      console.log("message 2");
      console.log("message 3");

      expect(output).toHaveLength(3);
    });

    it("should handle console methods with multiple arguments", async () => {
      const output: string[] = [];
      console.log = (...args: any[]) => {
        output.push(JSON.stringify(args));
      };

      await installConsoleInterceptor();
      console.log("arg1", "arg2", { key: "value" });

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("arg1");
      expect(output[0]).toContain("arg2");
    });

    it("should handle all four console methods independently", async () => {
      const output: string[] = [];
      const capture = (...args: any[]) => {
        output.push(args.join(" "));
      };

      console.log = capture;
      console.error = capture;
      console.warn = capture;
      console.debug = capture;

      await installConsoleInterceptor();

      console.log("log");
      console.error("error");
      console.warn("warn");
      console.debug("debug");

      expect(output).toHaveLength(4);
      expect(output[0]).toBe("log");
      expect(output[1]).toBe("error");
      expect(output[2]).toBe("warn");
      expect(output[3]).toBe("debug");
    });
  });

  describe("uninstallConsoleInterceptor()", () => {
    it("should restore original console.log method", async () => {
      await installConsoleInterceptor();
      uninstallConsoleInterceptor();

      expect(console.log).toBe(originalLog);
    });

    it("should restore original console.error method", async () => {
      await installConsoleInterceptor();
      uninstallConsoleInterceptor();

      expect(console.error).toBe(originalError);
    });

    it("should restore original console.warn method", async () => {
      await installConsoleInterceptor();
      uninstallConsoleInterceptor();

      expect(console.warn).toBe(originalWarn);
    });

    it("should restore original console.debug method", async () => {
      await installConsoleInterceptor();
      uninstallConsoleInterceptor();

      expect(console.debug).toBe(originalDebug);
    });

    it("should restore all methods together", async () => {
      await installConsoleInterceptor();
      uninstallConsoleInterceptor();

      expect(console.log).toBe(originalLog);
      expect(console.error).toBe(originalError);
      expect(console.warn).toBe(originalWarn);
      expect(console.debug).toBe(originalDebug);
    });

    it("should not throw when uninstalling", async () => {
      await installConsoleInterceptor();

      expect(() => {
        uninstallConsoleInterceptor();
      }).not.toThrow();
    });

    it("should be safe to call multiple times", async () => {
      await installConsoleInterceptor();
      uninstallConsoleInterceptor();

      expect(() => {
        uninstallConsoleInterceptor();
      }).not.toThrow();
    });

    it("should restore wrapping behavior after uninstall", async () => {
      await installConsoleInterceptor();
      const interceptedMethod = console.log;

      uninstallConsoleInterceptor();
      const restoredMethod = console.log;

      // After uninstall, console.log should be restored to original
      expect(restoredMethod).toBe(originalLog);

      if (isTelemetryEnabled) {
        // When telemetry was enabled, method should have changed during interception
        expect(interceptedMethod).not.toBe(originalLog);
      } else {
        // When telemetry disabled, method never changed
        expect(interceptedMethod).toBe(originalLog);
      }
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty console.log call", async () => {
      const output: string[] = [];
      console.log = (...args: any[]) => {
        output.push(args.length === 0 ? "(empty)" : args.join(" "));
      };

      await installConsoleInterceptor();
      console.log();

      expect(output).toHaveLength(1);
    });

    it("should handle console.log with null and undefined", async () => {
      const output: string[] = [];
      console.log = (...args: any[]) => {
        output.push(args.length);
      };

      await installConsoleInterceptor();

      // Should not throw when called with null and undefined
      expect(() => {
        console.log(null, undefined);
      }).not.toThrow();
      expect(output).toHaveLength(1);
    });

    it("should handle console.log with objects", async () => {
      const output: string[] = [];
      console.log = (...args: any[]) => {
        output.push(args.length);
      };

      await installConsoleInterceptor();
      const obj = { a: 1, b: { c: 2 } };
      console.log(obj);

      expect(output).toHaveLength(1);
    });

    it("should handle console.error with Error object", async () => {
      const output: string[] = [];
      console.error = (...args: any[]) => {
        output.push(args.length);
      };

      await installConsoleInterceptor();
      const error = new Error("test error");
      console.error(error);

      expect(output).toHaveLength(1);
    });

    it("should handle rapid successive calls", async () => {
      const output: string[] = [];
      console.log = (...args: any[]) => {
        output.push(args.join(" "));
      };

      await installConsoleInterceptor();

      for (let i = 0; i < 10; i++) {
        console.log(`message ${i}`);
      }

      expect(output).toHaveLength(10);
    });

    it("should handle installation when already installed", async () => {
      await installConsoleInterceptor();
      const firstWrap = console.log;

      await installConsoleInterceptor();
      const secondWrap = console.log;

      if (isTelemetryEnabled) {
        // When telemetry enabled, second installation should wrap again
        expect(secondWrap).not.toBe(firstWrap);
      } else {
        // When telemetry disabled, both should be the same (original)
        expect(secondWrap).toBe(firstWrap);
      }
    });
  });

  describe("Backwards Compatibility", () => {
    it("should maintain console.log signature", async () => {
      const output: string[] = [];
      console.log = (...args: any[]) => {
        output.push(args.length);
      };

      await installConsoleInterceptor();

      // Should accept any arguments like the original
      expect(() => {
        console.log("string", 123, true, { obj: "ect" }, null, undefined);
      }).not.toThrow();
      expect(output).toHaveLength(1);
    });

    it("should maintain console.error signature", async () => {
      const output: string[] = [];
      console.error = (...args: any[]) => {
        output.push(args.length);
      };

      await installConsoleInterceptor();

      expect(() => {
        console.error("error", new Error("test"));
      }).not.toThrow();
      expect(output).toHaveLength(1);
    });

    it("should maintain console.warn signature", async () => {
      const output: string[] = [];
      console.warn = (...args: any[]) => {
        output.push(args.length);
      };

      await installConsoleInterceptor();

      expect(() => {
        console.warn("warning", "message");
      }).not.toThrow();
      expect(output).toHaveLength(1);
    });

    it("should maintain console.debug signature", async () => {
      const output: string[] = [];
      console.debug = (...args: any[]) => {
        output.push(args.length);
      };

      await installConsoleInterceptor();

      expect(() => {
        console.debug("debug", "info");
      }).not.toThrow();
      expect(output).toHaveLength(1);
    });
  });
});
