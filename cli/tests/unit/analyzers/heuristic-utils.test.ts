/**
 * Unit tests for heuristic utilities
 *
 * Tests for evaluating heuristics including:
 * - class_is_service: Service detection via interface implementation, DI, and method count
 * - service_class_naming: Service naming pattern matching
 * - handles_route: Route handler detection
 */

import { describe, it, expect } from "bun:test";
import { evaluateHeuristic, getKnownHeuristicNames } from "@/analyzers/heuristic-utils.js";
import type { AnalyzerHeuristic } from "@/analyzers/types.js";

describe("heuristic-utils", () => {
  describe("getKnownHeuristicNames()", () => {
    it("should return list of all known heuristic names", () => {
      const names = getKnownHeuristicNames();
      expect(Array.isArray(names)).toBe(true);
      expect(names.length).toBeGreaterThan(0);
      expect(names).toContain("class_is_service");
      expect(names).toContain("service_class_naming");
      expect(names).toContain("handles_route");
    });
  });

  describe("evaluateHeuristic", () => {
    describe("class_is_service heuristic", () => {
      it("should detect service class via implements_interface", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "class_is_service",
          parameters: { threshold: 3 },
        };

        const nodeWithInterface = {
          name: "UserService",
          implements_interface: true,
          dependency_injection: false,
          public_methods_count: 1,
        };

        const result = evaluateHeuristic(heuristic, nodeWithInterface);
        expect(result).toBe(true);
      });

      it("should detect service class via dependency_injection", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "class_is_service",
          parameters: { threshold: 3 },
        };

        const nodeWithDI = {
          name: "ProductService",
          implements_interface: false,
          dependency_injection: true,
          public_methods_count: 1,
        };

        const result = evaluateHeuristic(heuristic, nodeWithDI);
        expect(result).toBe(true);
      });

      it("should detect service class via public_methods_count >= threshold", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "class_is_service",
          parameters: { threshold: 3 },
        };

        const nodeWithManyMethods = {
          name: "OrderService",
          implements_interface: false,
          dependency_injection: false,
          public_methods_count: 5,
        };

        const result = evaluateHeuristic(heuristic, nodeWithManyMethods);
        expect(result).toBe(true);
      });

      it("should not detect service when public_methods_count is below threshold", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "class_is_service",
          parameters: { threshold: 3 },
        };

        const nodeWithFewMethods = {
          name: "HelperClass",
          implements_interface: false,
          dependency_injection: false,
          public_methods_count: 2,
        };

        const result = evaluateHeuristic(heuristic, nodeWithFewMethods);
        expect(result).toBe(false);
      });

      it("should use default threshold of 3 when not specified", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "class_is_service",
          parameters: {},
        };

        // Below default threshold (3)
        const nodeBelowThreshold = {
          name: "Helper",
          implements_interface: false,
          dependency_injection: false,
          public_methods_count: 2,
        };

        // At default threshold (3)
        const nodeAtThreshold = {
          name: "Service",
          implements_interface: false,
          dependency_injection: false,
          public_methods_count: 3,
        };

        expect(evaluateHeuristic(heuristic, nodeBelowThreshold)).toBe(false);
        expect(evaluateHeuristic(heuristic, nodeAtThreshold)).toBe(true);
      });

      it("should handle undefined properties gracefully", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "class_is_service",
          parameters: { threshold: 3 },
        };

        const nodeWithUndefined = {
          name: "TestClass",
          // Missing: implements_interface, dependency_injection, public_methods_count
        };

        const result = evaluateHeuristic(heuristic, nodeWithUndefined);
        // Should be false since none of the three conditions are true
        expect(result).toBe(false);
      });

      it("should check implements_interface with strict equality (=== true)", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "class_is_service",
          parameters: { threshold: 3 },
        };

        // Only strictly true value should match
        const nodeWithTrueInterface = {
          name: "Service",
          implements_interface: true, // Strict true
          dependency_injection: false,
          public_methods_count: 0,
        };

        // Truthy but not true should not match
        const nodeWithTruthyInterface = {
          name: "Service",
          implements_interface: 1, // Truthy but not boolean true
          dependency_injection: false,
          public_methods_count: 0,
        };

        expect(evaluateHeuristic(heuristic, nodeWithTrueInterface)).toBe(true);
        expect(evaluateHeuristic(heuristic, nodeWithTruthyInterface)).toBe(false);
      });

      it("should satisfy any one of three ORed conditions", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "class_is_service",
          parameters: { threshold: 5 },
        };

        // All three conditions true
        const allTrue = {
          implements_interface: true,
          dependency_injection: true,
          public_methods_count: 10,
        };

        // Only one condition true (interface)
        const onlyInterface = {
          implements_interface: true,
          dependency_injection: false,
          public_methods_count: 0,
        };

        // Only one condition true (DI)
        const onlyDI = {
          implements_interface: false,
          dependency_injection: true,
          public_methods_count: 0,
        };

        // Only one condition true (methods)
        const onlyMethods = {
          implements_interface: false,
          dependency_injection: false,
          public_methods_count: 5,
        };

        expect(evaluateHeuristic(heuristic, allTrue)).toBe(true);
        expect(evaluateHeuristic(heuristic, onlyInterface)).toBe(true);
        expect(evaluateHeuristic(heuristic, onlyDI)).toBe(true);
        expect(evaluateHeuristic(heuristic, onlyMethods)).toBe(true);
      });
    });

    describe("service_class_naming heuristic", () => {
      it("should match class name with service prefix", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "service_class_naming",
          parameters: { service_method_prefixes: ["service", "impl", "handler"] },
        };

        const nodeWithServicePrefix = {
          name: "ServiceImpl",
        };

        const result = evaluateHeuristic(heuristic, nodeWithServicePrefix);
        expect(result).toBe(true);
      });

      it("should match class name case-insensitively", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "service_class_naming",
          parameters: { service_method_prefixes: ["SERVICE", "IMPL"] },
        };

        const nodeLowercase = {
          name: "serviceImpl",
        };

        const result = evaluateHeuristic(heuristic, nodeLowercase);
        expect(result).toBe(true);
      });

      it("should not match class name without prefix", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "service_class_naming",
          parameters: { service_method_prefixes: ["service", "impl"] },
        };

        const nodeWithoutPrefix = {
          name: "UserController",
        };

        const result = evaluateHeuristic(heuristic, nodeWithoutPrefix);
        expect(result).toBe(false);
      });

      it("should handle multiple prefixes and match any", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "service_class_naming",
          parameters: { service_method_prefixes: ["service", "impl", "manager", "factory"] },
        };

        const nodeMatchingFirst = { name: "ServiceUser" };
        const nodeMatchingSecond = { name: "ImplUser" };
        const nodeMatchingThird = { name: "ManagerUser" };
        const nodeMatchingFourth = { name: "FactoryUser" };
        const nodeMatching = { name: "FactoryHandler" };
        const nodeNotMatching = { name: "Controller" };

        expect(evaluateHeuristic(heuristic, nodeMatchingFirst)).toBe(true);
        expect(evaluateHeuristic(heuristic, nodeMatchingSecond)).toBe(true);
        expect(evaluateHeuristic(heuristic, nodeMatchingThird)).toBe(true);
        expect(evaluateHeuristic(heuristic, nodeMatchingFourth)).toBe(true);
        expect(evaluateHeuristic(heuristic, nodeMatching)).toBe(true);
        expect(evaluateHeuristic(heuristic, nodeNotMatching)).toBe(false);
      });

      it("should handle undefined name property", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "service_class_naming",
          parameters: { service_method_prefixes: ["service"] },
        };

        const nodeWithoutName = {};

        const result = evaluateHeuristic(heuristic, nodeWithoutName);
        expect(result).toBe(false);
      });

      it("should handle empty prefixes array", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "service_class_naming",
          parameters: { service_method_prefixes: [] },
        };

        const node = { name: "ServiceUser" };

        const result = evaluateHeuristic(heuristic, node);
        expect(result).toBe(false);
      });
    });

    describe("handles_route heuristic", () => {
      it("should detect route handler via has_route_handler property", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "handles_route",
        };

        const nodeWithRouteHandler = {
          has_route_handler: true,
          is_decorated: false,
        };

        const result = evaluateHeuristic(heuristic, nodeWithRouteHandler);
        expect(result).toBe(true);
      });

      it("should detect route handler via is_decorated property", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "handles_route",
        };

        const nodeWithDecorator = {
          has_route_handler: false,
          is_decorated: true,
        };

        const result = evaluateHeuristic(heuristic, nodeWithDecorator);
        expect(result).toBe(true);
      });

      it("should return true if either condition is true", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "handles_route",
        };

        const nodeBoth = {
          has_route_handler: true,
          is_decorated: true,
        };

        const result = evaluateHeuristic(heuristic, nodeBoth);
        expect(result).toBe(true);
      });

      it("should return false if neither condition is true", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "handles_route",
        };

        const nodeNeither = {
          has_route_handler: false,
          is_decorated: false,
        };

        const result = evaluateHeuristic(heuristic, nodeNeither);
        expect(result).toBe(false);
      });

      it("should handle undefined properties", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "handles_route",
        };

        const nodeWithUndefined = {};

        const result = evaluateHeuristic(heuristic, nodeWithUndefined);
        expect(result).toBe(false);
      });

      it("should check has_route_handler with strict equality (=== true)", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "handles_route",
        };

        // Only strictly true should match
        const nodeWithTrueHandler = {
          has_route_handler: true,
          is_decorated: false,
        };

        // Truthy but not true should not match
        const nodeWithTruthyHandler = {
          has_route_handler: 1, // Truthy but not boolean true
          is_decorated: false,
        };

        expect(evaluateHeuristic(heuristic, nodeWithTrueHandler)).toBe(true);
        expect(evaluateHeuristic(heuristic, nodeWithTruthyHandler)).toBe(false);
      });

      it("should check is_decorated with strict equality (=== true)", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "handles_route",
        };

        // Only strictly true should match
        const nodeWithTrueDecorated = {
          has_route_handler: false,
          is_decorated: true,
        };

        // Truthy but not true should not match
        const nodeWithTruthyDecorated = {
          has_route_handler: false,
          is_decorated: "Route", // Truthy but not boolean true
        };

        expect(evaluateHeuristic(heuristic, nodeWithTrueDecorated)).toBe(true);
        expect(evaluateHeuristic(heuristic, nodeWithTruthyDecorated)).toBe(false);
      });
    });

    describe("unknown heuristic", () => {
      it("should return false for unknown heuristic names", () => {
        const heuristic: AnalyzerHeuristic = {
          name: "unknown_heuristic",
        };

        const node = { some_property: true };

        const result = evaluateHeuristic(heuristic, node);
        expect(result).toBe(false);
      });
    });
  });
});
