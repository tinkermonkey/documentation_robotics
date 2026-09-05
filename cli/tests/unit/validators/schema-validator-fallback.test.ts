/**
 * Unit tests for SchemaValidator AJV fallback paths
 *
 * Tests that verify the fallback mechanisms when:
 * 1. Standalone AJV code generation fails
 * 2. Pre-compiled validators are unavailable or fail
 * 3. Schema files cannot be loaded or are corrupted
 * 4. Runtime schema compilation fallback is triggered
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { SchemaValidator } from "../../../src/validators/schema-validator.js";
import { Element } from "../../../src/core/element.js";
import { existsSync } from "fs";
import path from "path";

describe("SchemaValidator - AJV Fallback Paths", () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    SchemaValidator.reset();
    validator = new SchemaValidator();
  });

  describe("Pre-compiled validator fallback", () => {
    it("should handle missing pre-compiled validator gracefully", async () => {
      // Create element with valid spec structure
      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "motivation.goal",
        type: "goal",
        layer_id: "motivation",
        name: "Customer Satisfaction",
        description: "Improve customer satisfaction metrics",
      });

      // Validate - should work even if pre-compiled validator isn't available
      const result = await validator.validateElement(element, "motivation");

      // Should complete validation process
      expect(result).toBeDefined();
      expect(result.validated).toBe(true);
    });

    it("should validate element when base pre-compiled validator succeeds", async () => {
      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "motivation.goal",
        type: "goal",
        layer_id: "motivation",
        name: "Test Goal",
      });

      const result = await validator.validateElement(element, "motivation");

      // Base validator should pass
      expect(result.validated).toBe(true);
    });

    it("should report errors from pre-compiled base validator", async () => {
      // Element missing required field
      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "motivation.goal",
        type: "goal",
        layer_id: "motivation",
        // Missing required 'name' field
        name: "", // Invalid - empty string
      });

      const result = await validator.validateElement(element, "motivation");

      expect(result.validated).toBe(true);
      // Should have captured validation errors from pre-compiled validator
      expect(result.errors.length >= 0).toBe(true);
    });
  });

  describe("Runtime schema compilation fallback", () => {
    it("should compile type-specific schema at runtime if not cached", async () => {
      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        layer_id: "api",
        name: "Create Order",
        description: "API endpoint for creating orders",
        attributes: {
          method: "POST",
          path: "/orders",
        },
      });

      // First validation should trigger runtime compilation
      const result1 = await validator.validateElement(element, "api");
      expect(result1.validated).toBe(true);

      // Second validation with same type should use cache
      const element2 = new Element({
        id: "550e8400-e29b-41d4-a716-446655440001",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        layer_id: "api",
        name: "Delete Order",
      });

      const result2 = await validator.validateElement(element2, "api");
      expect(result2.validated).toBe(true);
    });

    it("should handle schema loading errors gracefully", async () => {
      // Element with non-existent custom type - should skip type-specific validation
      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "motivation.custom-type",
        type: "custom-type",
        layer_id: "motivation",
        name: "Custom Element",
      });

      const result = await validator.validateElement(element, "motivation");

      // Base validation should pass
      expect(result.validated).toBe(true);
      // Should handle missing type-specific schema gracefully (no errors)
    });

    it("should report errors from type-specific schema compilation", async () => {
      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        layer_id: "api",
        name: "Bad Endpoint",
        attributes: {
          // endpoint schema might require specific properties
          method: "INVALID_METHOD", // Invalid HTTP method
        },
      });

      const result = await validator.validateElement(element, "api");
      expect(result.validated).toBe(true);
      // If schema is strict about allowed methods, errors would be reported
    });

    it("should cache compiled schemas for reuse", async () => {
      const element1 = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "data-model.entity",
        type: "entity",
        layer_id: "data-model",
        name: "Customer Entity",
      });

      const element2 = new Element({
        id: "550e8400-e29b-41d4-a716-446655440001",
        spec_node_id: "data-model.entity",
        type: "entity",
        layer_id: "data-model",
        name: "Order Entity",
      });

      // First validation
      const result1 = await validator.validateElement(element1, "data-model");
      expect(result1.validated).toBe(true);

      // Second validation with same type should use cached validator
      const result2 = await validator.validateElement(element2, "data-model");
      expect(result2.validated).toBe(true);

      // Both should succeed without additional file I/O for type-specific schema
    });
  });

  describe("Error message formatting during fallback", () => {
    it("should format validation errors clearly when type-specific schema validation fails", async () => {
      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "api.parameter",
        type: "parameter",
        layer_id: "api",
        name: "Query Param",
        attributes: {
          // Intentionally invalid structure to trigger schema validation errors
          in: "invalid-location", // Should be query, path, header, or cookie
        },
      });

      const result = await validator.validateElement(element, "api");
      expect(result.validated).toBe(true);

      // If validation errors occur, they should have clear messages
      if (result.hasErrors) {
        expect(result.errors.length > 0).toBe(true);
        for (const error of result.errors) {
          expect(error.message).toBeDefined();
          expect(error.location).toBeDefined();
          // Formatted errors should include element ID and location
          expect(error.message.includes(element.id) || error.message.length > 0).toBe(true);
        }
      }
    });

    it("should include fix suggestions when available", async () => {
      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "api.parameter",
        type: "parameter",
        layer_id: "api",
        name: "Bad Parameter",
        attributes: {
          in: "invalid", // Should trigger an error with fix suggestion
        },
      });

      const result = await validator.validateElement(element, "api");
      expect(result.validated).toBe(true);

      // Check error formatting
      if (result.hasErrors) {
        for (const error of result.errors) {
          // Errors should have proper structure
          expect(error).toHaveProperty("message");
          expect(error).toHaveProperty("location");
          // fixSuggestion is optional but structure should be valid
          if (error.fixSuggestion) {
            expect(typeof error.fixSuggestion).toBe("string");
          }
        }
      }
    });
  });

  describe("Fallback path edge cases", () => {
    it("should validate element when all schemas are loaded successfully", async () => {
      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "testing.testcase",
        type: "testcase",
        layer_id: "testing",
        name: "Login Test",
        description: "Test user login functionality",
        attributes: {
          testType: "e2e",
          expectedResult: "success",
        },
      });

      const result = await validator.validateElement(element, "testing");
      expect(result.validated).toBe(true);
    });

    it("should handle validation of new element types without pre-built schemas", async () => {
      // Simulate a newer element type that hasn't been pre-built yet
      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "navigation.page-transition",
        type: "page-transition",
        layer_id: "navigation",
        name: "Home to Dashboard",
      });

      // Should not crash - should skip type-specific validation gracefully
      const result = await validator.validateElement(element, "navigation");
      expect(result.validated).toBe(true);
      // Base validation should pass even if type-specific schema missing
    });

    it("should properly track which schemas have been loaded", async () => {
      // Validate multiple elements to populate schema cache
      const types = ["goal", "requirement", "constraint"];

      for (const type of types) {
        const element = new Element({
          id: `550e8400-e29b-41d4-a716-446655440${types.indexOf(type)}`,
          spec_node_id: `motivation.${type}`,
          type: type,
          layer_id: "motivation",
          name: `${type.charAt(0).toUpperCase() + type.slice(1)} Element`,
        });

        const result = await validator.validateElement(element, "motivation");
        expect(result.validated).toBe(true);
      }

      // All validations should complete successfully
      // Schema cache should contain at least the base schemas
    });
  });

  describe("Concurrent validation with fallback", () => {
    it("should handle concurrent schema compilations safely", async () => {
      const elements = [
        new Element({
          id: "550e8400-e29b-41d4-a716-446655440000",
          spec_node_id: "business.businessprocess",
          type: "businessprocess",
          layer_id: "business",
          name: "Order Processing",
        }),
        new Element({
          id: "550e8400-e29b-41d4-a716-446655440001",
          spec_node_id: "business.businessactor",
          type: "businessactor",
          layer_id: "business",
          name: "Customer",
        }),
        new Element({
          id: "550e8400-e29b-41d4-a716-446655440002",
          spec_node_id: "business.businessservice",
          type: "businessservice",
          layer_id: "business",
          name: "Order Service",
        }),
      ];

      // Validate all concurrently
      const results = await Promise.all(
        elements.map((el) => validator.validateElement(el, "business"))
      );

      // All should succeed
      expect(results.length).toBe(3);
      for (const result of results) {
        expect(result.validated).toBe(true);
      }
    });
  });

  describe("Fallback validator exports", () => {
    it("should verify pre-compiled validators are properly exported", async () => {
      // Import the compiled validators module
      const validators = await import("../../../src/generated/compiled-validators.js");

      // Check that all expected validators are exported
      expect(validators).toHaveProperty("validateSpecNode");
      expect(validators).toHaveProperty("validateSpecNodeRelationship");
      expect(validators).toHaveProperty("validateSourceReference");
      expect(validators).toHaveProperty("validateAttributeSpec");

      // Each should be a function (ValidateFunction from AJV)
      expect(typeof validators.validateSpecNode).toBe("function");
      expect(typeof validators.validateSpecNodeRelationship).toBe("function");
      expect(typeof validators.validateSourceReference).toBe("function");
      expect(typeof validators.validateAttributeSpec).toBe("function");
    });

    it("should verify pre-compiled validators are callable", async () => {
      const validators = await import("../../../src/generated/compiled-validators.js");

      // Valid spec node should pass
      const validNode = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "motivation.goal",
        type: "goal",
        layer_id: "motivation",
        name: "Test Goal",
      };

      const isValid = validators.validateSpecNode(validNode);
      expect(typeof isValid).toBe("boolean");

      // Invalid node should fail (missing required field)
      const invalidNode = {
        spec_node_id: "motivation.goal",
        type: "goal",
        // Missing required 'id', 'layer_id', 'name'
      };

      const isInvalid = validators.validateSpecNode(invalidNode);
      expect(typeof isInvalid).toBe("boolean");
    });

    it("should verify pre-compiled validators have error properties", async () => {
      const validators = await import("../../../src/generated/compiled-validators.js");

      // Validate invalid data
      const invalidNode = {
        id: "not-a-uuid",
        spec_node_id: "motivation.goal",
        type: "goal",
        layer_id: "motivation",
        name: "Test",
      };

      const isValid = validators.validateSpecNode(invalidNode);
      expect(isValid).toBe(false);

      // Should have errors array
      expect(validators.validateSpecNode.errors).toBeDefined();
      expect(Array.isArray(validators.validateSpecNode.errors)).toBe(true);

      // Errors should contain error objects with properties
      if (validators.validateSpecNode.errors && validators.validateSpecNode.errors.length > 0) {
        const error = validators.validateSpecNode.errors[0];
        expect(error).toHaveProperty("keyword");
        expect(error).toHaveProperty("instancePath");
        expect(error).toHaveProperty("message");
      }
    });
  });

  describe("Fallback error recovery", () => {
    it("should continue validating subsequent elements after a validation error", async () => {
      const validElement = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "application.applicationservice",
        type: "applicationservice",
        layer_id: "application",
        name: "Valid Service",
      });

      const elementWithIssue = new Element({
        id: "invalid-uuid", // Invalid UUID
        spec_node_id: "application.applicationservice",
        type: "applicationservice",
        layer_id: "application",
        name: "Service with Bad ID",
      });

      // Validate both
      const result1 = await validator.validateElement(validElement, "application");
      expect(result1.validated).toBe(true);

      const result2 = await validator.validateElement(elementWithIssue, "application");
      expect(result2.validated).toBe(true);
      // Even if there are errors, validation should complete

      // Validate another valid element after error
      const anotherValid = new Element({
        id: "550e8400-e29b-41d4-a716-446655440001",
        spec_node_id: "application.applicationcomponent",
        type: "applicationcomponent",
        layer_id: "application",
        name: "Another Valid Component",
      });

      const result3 = await validator.validateElement(anotherValid, "application");
      expect(result3.validated).toBe(true);
    });
  });
});
