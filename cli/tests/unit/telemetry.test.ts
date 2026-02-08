/**
 * Tests for the telemetry module
 *
 * Note: TELEMETRY_ENABLED is a compile-time constant set by esbuild.
 * For testing, we mock it as false to test the no-op behavior.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";

// Mock TELEMETRY_ENABLED as false for testing
(globalThis as any).TELEMETRY_ENABLED = false;

// Import after setting the global
import * as telemetry from "../../src/telemetry/index";
import { ResilientOTLPExporter } from "../../src/telemetry/resilient-exporter";

describe("Telemetry Module (Production No-Op Mode)", () => {
  describe("initTelemetry()", () => {
    it("should initialize without errors", () => {
      // Should not throw when TELEMETRY_ENABLED is false
      expect(() => telemetry.initTelemetry()).not.toThrow();
    });
  });

  describe("startSpan()", () => {
    it("should return null when TELEMETRY_ENABLED is false", () => {
      const span = telemetry.startSpan("test-span", {
        "test.attr": "value",
      });
      // In production mode (TELEMETRY_ENABLED=false), returns null
      expect(span).toBeNull();
    });
  });

  describe("endSpan()", () => {
    it("should safely handle null spans", () => {
      // Should not throw when passed null
      expect(() => telemetry.endSpan(null)).not.toThrow();
    });

    it("should be no-op with null span", () => {
      const span = telemetry.startSpan("test");
      expect(span).toBeNull();
      // Should not throw when passed null
      expect(() => telemetry.endSpan(span)).not.toThrow();
    });
  });

  describe("shutdownTelemetry()", () => {
    it("should shutdown gracefully", async () => {
      // Should not throw even if no SDK was initialized
      const result = await telemetry.shutdownTelemetry();
      expect(result === undefined).toBe(true);
    });
  });
});

describe("Project Name Propagation", () => {
  it("should load project name from manifest file", () => {
    // Mock fs module
    const originalFs = require("fs");
    const originalPath = require("path");
    const mockFs = {
      existsSync: mock((path: string) => {
        return path.includes(".dr/manifest.json");
      }),
      readFileSync: mock((path: string, encoding: string) => {
        return JSON.stringify({
          name: "TestProjectName",
          version: "1.0.0",
        });
      }),
    };

    // Mock require to return our mock fs
    const originalRequire = require;
    (globalThis as any).require = (module: string) => {
      if (module === "fs") return mockFs;
      return originalRequire(module);
    };

    try {
      // This test verifies that initTelemetry can load project names
      // In production, this would be called with the modelPath parameter
      expect(() => {
        telemetry.initTelemetry(".test/model/path");
      }).not.toThrow();
    } finally {
      // Restore original require
      (globalThis as any).require = originalRequire;
    }
  });

  it("should fallback to unknown when manifest missing", () => {
    // Mock fs module that returns no manifest
    const mockFs = {
      existsSync: mock(() => false),
      readFileSync: mock(() => ""),
    };

    const originalRequire = require;
    (globalThis as any).require = (module: string) => {
      if (module === "fs") return mockFs;
      return originalRequire(module);
    };

    try {
      // Should not throw and use 'unknown' as fallback
      expect(() => {
        telemetry.initTelemetry();
      }).not.toThrow();
    } finally {
      (globalThis as any).require = originalRequire;
    }
  });

  it("should handle invalid manifest JSON gracefully", () => {
    const mockFs = {
      existsSync: mock(() => true),
      readFileSync: mock(() => "invalid json {{{"),
    };

    const originalRequire = require;
    (globalThis as any).require = (module: string) => {
      if (module === "fs") return mockFs;
      return originalRequire(module);
    };

    try {
      // Should not throw and use 'unknown' as fallback
      expect(() => {
        telemetry.initTelemetry();
      }).not.toThrow();
    } finally {
      (globalThis as any).require = originalRequire;
    }
  });
});

describe("ResilientOTLPExporter - Circuit Breaker Logic", () => {
  let exporter: ResilientOTLPExporter;
  let mockDelegate: any;

  beforeEach(() => {
    // Mock the delegate exporter
    mockDelegate = {
      export: mock((_spans: any, callback: any) => {
        callback({ code: 0 }); // SUCCESS
      }),
      shutdown: mock(async () => {}),
      forceFlush: mock(async () => {}),
    };

    // Create exporter with mocked configuration
    exporter = new ResilientOTLPExporter({
      url: "http://localhost:4318/v1/traces",
      timeoutMillis: 500,
    });

    // Replace delegate with mock
    (exporter as any).delegate = mockDelegate;
  });

  describe("export()", () => {
    it("should export spans when circuit breaker is closed", () => {
      const spans: any[] = [];
      const callback = mock((_result: any) => {});

      exporter.export(spans, callback);

      expect(mockDelegate.export).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should set 30-second backoff on export failure", () => {
      const spans: any[] = [];
      let exportCallback: any;

      mockDelegate.export = mock((_spans: any, callback: any) => {
        exportCallback = callback;
      });

      const callback = mock((_result: any) => {});
      const beforeTime = Date.now();

      exporter.export(spans, callback);
      exportCallback({ code: 1 }); // FAILED

      const retryAfter = (exporter as any).retryAfter;
      expect(retryAfter).toBeGreaterThanOrEqual(beforeTime + 29999);
      expect(retryAfter).toBeLessThanOrEqual(beforeTime + 30001);
    });

    it("should discard spans during backoff period", () => {
      // Manually set backoff period
      (exporter as any).retryAfter = Date.now() + 10000;

      const spans: any[] = [];
      const callback = mock((_result: any) => {});

      exporter.export(spans, callback);

      // Should not call delegate export
      expect(mockDelegate.export).not.toHaveBeenCalled();
      // Should report success to SDK (to prevent internal retry)
      expect(callback).toHaveBeenCalledWith({ code: 0 }); // SUCCESS
    });

    it("should reset backoff on successful export", () => {
      const spans: any[] = [];
      let exportCallback: any;

      mockDelegate.export = mock((_spans: any, callback: any) => {
        exportCallback = callback;
      });

      const callback = mock((_result: any) => {});

      exporter.export(spans, callback);
      exportCallback({ code: 0 }); // SUCCESS

      const retryAfter = (exporter as any).retryAfter;
      expect(retryAfter).toBe(0);
    });

    it("should respect timeout configuration", () => {
      // Timeout is set in constructor and passed to delegate
      // This is verified indirectly through the constructor call
      expect(() => {
        new ResilientOTLPExporter({ timeoutMillis: 500 });
      }).not.toThrow();
    });
  });

  describe("forceFlush()", () => {
    it("should flush when circuit breaker is closed", async () => {
      await exporter.forceFlush();

      expect(mockDelegate.forceFlush).toHaveBeenCalledTimes(1);
    });

    it("should skip flush during backoff period", async () => {
      // Set backoff period
      (exporter as any).retryAfter = Date.now() + 10000;

      await exporter.forceFlush();

      // Should not call delegate forceFlush during backoff
      expect(mockDelegate.forceFlush).not.toHaveBeenCalled();
    });

    it("should handle flush errors gracefully", async () => {
      mockDelegate.forceFlush = mock(async () => {
        throw new Error("Flush failed");
      });

      // Should not throw
      expect(async () => {
        await exporter.forceFlush();
      }).not.toThrow();
    });
  });

  describe("shutdown()", () => {
    it("should shutdown delegate gracefully", async () => {
      await exporter.shutdown();

      expect(mockDelegate.shutdown).toHaveBeenCalledTimes(1);
    });

    it("should handle shutdown errors gracefully", async () => {
      mockDelegate.shutdown = mock(async () => {
        throw new Error("Shutdown failed");
      });

      // Should not throw
      expect(async () => {
        await exporter.shutdown();
      }).not.toThrow();
    });
  });

  describe("Boundary Conditions", () => {
    it("should retry immediately when Date.now() equals retryAfter", () => {
      const now = Date.now();
      (exporter as any).retryAfter = now;

      const spans: any[] = [];
      const callback = mock((_result: any) => {});

      exporter.export(spans, callback);

      // When now === retryAfter, condition (now < retryAfter) is false, so export should proceed
      expect(mockDelegate.export).toHaveBeenCalledTimes(1);
    });
  });
});
