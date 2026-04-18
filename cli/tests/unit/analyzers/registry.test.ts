/**
 * Analyzer Registry Unit Tests
 *
 * Tests for loading analyzers from manifest and registry construction
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { AnalyzerRegistry } from "@/analyzers/registry";
import { CbmAnalyzer } from "@/analyzers/cbm-analyzer";
import { CLIError, ErrorCategory } from "@/utils/errors";

describe("AnalyzerRegistry", () => {
  let registry: AnalyzerRegistry;

  beforeEach(() => {
    // Create a fresh instance for each test
    registry = AnalyzerRegistry.getInstance();
  });

  describe("getAnalyzer()", () => {
    it("should return CbmAnalyzer instance for 'cbm'", async () => {
      const analyzer = await registry.getAnalyzer("cbm");
      expect(analyzer).toBeDefined();
      expect(analyzer).toBeInstanceOf(CbmAnalyzer);
    });

    it("should return undefined for unknown analyzer names", async () => {
      const analyzer = await registry.getAnalyzer("unknown-analyzer");
      expect(analyzer).toBeUndefined();
    });

    it("should cache analyzer instances", async () => {
      const analyzer1 = await registry.getAnalyzer("cbm");
      const analyzer2 = await registry.getAnalyzer("cbm");
      expect(analyzer1).toBe(analyzer2); // Same instance
    });
  });

  describe("getAllAnalyzers()", () => {
    it("should return array of analyzer instances", async () => {
      const analyzers = await registry.getAllAnalyzers();
      expect(Array.isArray(analyzers)).toBe(true);
      expect(analyzers.length).toBeGreaterThan(0);
    });

    it("should include CbmAnalyzer", async () => {
      const analyzers = await registry.getAllAnalyzers();
      const cbmAnalyzer = analyzers.find((a) => a instanceof CbmAnalyzer);
      expect(cbmAnalyzer).toBeDefined();
    });
  });

  describe("getAnalyzerNames()", () => {
    it("should return array of analyzer names", async () => {
      await registry.initialize();
      const names = registry.getAnalyzerNames();
      expect(Array.isArray(names)).toBe(true);
      expect(names.length).toBeGreaterThan(0);
    });

    it("should include 'cbm' in the list", async () => {
      await registry.initialize();
      const names = registry.getAnalyzerNames();
      expect(names).toContain("cbm");
    });

    it("should throw CLIError if not initialized", () => {
      // Create a new registry instance that hasn't been initialized
      const newRegistry = new (AnalyzerRegistry as any)();
      expect(() => newRegistry.getAnalyzerNames()).toThrow();
    });
  });

  describe("initialize()", () => {
    it("should load the manifest successfully", async () => {
      await registry.initialize();
      const names = registry.getAnalyzerNames();
      expect(names.length).toBeGreaterThan(0);
    });

    it("should be idempotent", async () => {
      await registry.initialize();
      await registry.initialize(); // Should not throw
      const names = registry.getAnalyzerNames();
      expect(names.length).toBeGreaterThan(0);
    });
  });

  describe("getInstance()", () => {
    it("should return singleton instance", () => {
      const instance1 = AnalyzerRegistry.getInstance();
      const instance2 = AnalyzerRegistry.getInstance();
      expect(instance1).toBe(instance2);
    });
  });
});
