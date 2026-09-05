/**
 * Tests for qualified reference support in element-reference-shape
 */

import { describe, it, expect } from "bun:test";
import { looksLikeElementReference } from "@/utils/element-reference-shape";

describe("looksLikeElementReference - qualified references", () => {
  describe("qualified paths", () => {
    it("should accept qualified path with simple model name", () => {
      expect(looksLikeElementReference("@auth/api.operation.login")).toBe(
        true
      );
    });

    it("should accept qualified path with hyphenated model name", () => {
      expect(looksLikeElementReference("@auth-service/api.endpoint.get")).toBe(
        true
      );
    });

    it("should accept qualified path with hyphenated layer name", () => {
      expect(
        looksLikeElementReference("@data-service/data-model.entity.user")
      ).toBe(true);
    });

    it("should accept qualified path with underscored model name", () => {
      expect(
        looksLikeElementReference("@payment_service/api.operation.process")
      ).toBe(true);
    });

    it("should reject qualified path with invalid layer", () => {
      expect(looksLikeElementReference("@auth/invalid.operation.login")).toBe(
        false
      );
    });

    it("should reject qualified path with only model name", () => {
      expect(looksLikeElementReference("@auth/")).toBe(false);
    });

    it("should reject qualified path with missing slash", () => {
      expect(looksLikeElementReference("@authapi.operation.login")).toBe(false);
    });
  });

  describe("unqualified paths still work", () => {
    it("should accept unqualified element path", () => {
      expect(looksLikeElementReference("motivation.goal.increase-revenue")).toBe(
        true
      );
    });

    it("should accept UUID", () => {
      expect(
        looksLikeElementReference("550e8400-e29b-41d4-a716-446655440000")
      ).toBe(true);
    });

    it("should reject invalid unqualified path", () => {
      expect(looksLikeElementReference("invalid.reference")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle whitespace in qualified paths", () => {
      expect(
        looksLikeElementReference("  @auth/api.operation.login  ")
      ).toBe(false);
    });

    it("should reject @ without qualified prefix", () => {
      expect(looksLikeElementReference("@api.operation.login")).toBe(false);
    });

    it("should reject empty qualified path", () => {
      expect(looksLikeElementReference("@")).toBe(false);
    });
  });
});
