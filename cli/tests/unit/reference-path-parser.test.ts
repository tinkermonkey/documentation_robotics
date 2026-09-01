/**
 * Unit tests for reference path parser
 */

import { describe, it, expect } from "bun:test";
import {
  parseReferencePath,
  isQualifiedReferencePath,
  extractModelNameFromPath,
  extractSegmentFromPath,
} from "@/utils/reference-path-parser";

describe("Reference Path Parser", () => {
  describe("parseReferencePath", () => {
    describe("unqualified paths", () => {
      it("should parse dot-separated element path", () => {
        const result = parseReferencePath("motivation.goal.increase-revenue");
        expect(result.modelName).toBeUndefined();
        expect(result.segment).toBe("motivation.goal.increase-revenue");
        expect(result.isQualified).toBe(false);
      });

      it("should parse multi-segment element path", () => {
        const result = parseReferencePath("api.endpoint.create-customer");
        expect(result.modelName).toBeUndefined();
        expect(result.segment).toBe("api.endpoint.create-customer");
        expect(result.isQualified).toBe(false);
      });

      it("should parse element path with hyphenated layer name", () => {
        const result = parseReferencePath("data-model.entity.user");
        expect(result.modelName).toBeUndefined();
        expect(result.segment).toBe("data-model.entity.user");
        expect(result.isQualified).toBe(false);
      });

      it("should parse element path with underscored layer name", () => {
        const result = parseReferencePath("data_model.entity.order");
        expect(result.modelName).toBeUndefined();
        expect(result.segment).toBe("data_model.entity.order");
        expect(result.isQualified).toBe(false);
      });

      it("should parse UUIDv4", () => {
        const uuid = "550e8400-e29b-41d4-a716-446655440000";
        const result = parseReferencePath(uuid);
        expect(result.modelName).toBeUndefined();
        expect(result.segment).toBe(uuid);
        expect(result.isQualified).toBe(false);
      });

      it("should parse UUIDv4 case-insensitively", () => {
        const uuid = "550E8400-E29B-41D4-A716-446655440000";
        const result = parseReferencePath(uuid);
        expect(result.modelName).toBeUndefined();
        expect(result.segment).toBe(uuid);
        expect(result.isQualified).toBe(false);
      });

      it("should trim whitespace from unqualified paths", () => {
        const result = parseReferencePath(
          "  motivation.goal.increase-revenue  "
        );
        expect(result.segment).toBe("motivation.goal.increase-revenue");
      });
    });

    describe("qualified paths", () => {
      it("should parse qualified path with simple model name", () => {
        const result = parseReferencePath("@auth/api.operation.authenticate");
        expect(result.modelName).toBe("auth");
        expect(result.segment).toBe("api.operation.authenticate");
        expect(result.isQualified).toBe(true);
      });

      it("should parse qualified path with hyphenated model name", () => {
        const result = parseReferencePath(
          "@auth-service/api.operation.login"
        );
        expect(result.modelName).toBe("auth-service");
        expect(result.segment).toBe("api.operation.login");
        expect(result.isQualified).toBe(true);
      });

      it("should parse qualified path with underscored model name", () => {
        const result = parseReferencePath(
          "@payment_service/api.operation.process"
        );
        expect(result.modelName).toBe("payment_service");
        expect(result.segment).toBe("api.operation.process");
        expect(result.isQualified).toBe(true);
      });

      it("should parse qualified path with numeric model name", () => {
        const result = parseReferencePath("@service1/api.endpoint.get-data");
        expect(result.modelName).toBe("service1");
        expect(result.segment).toBe("api.endpoint.get-data");
        expect(result.isQualified).toBe(true);
      });

      it("should parse qualified path with hyphenated layer and model names", () => {
        const result = parseReferencePath(
          "@data-service/data-model.entity.customer"
        );
        expect(result.modelName).toBe("data-service");
        expect(result.segment).toBe("data-model.entity.customer");
        expect(result.isQualified).toBe(true);
      });

      it("should trim whitespace from qualified paths", () => {
        const result = parseReferencePath(
          "  @auth-service/api.operation.login  "
        );
        expect(result.modelName).toBe("auth-service");
        expect(result.segment).toBe("api.operation.login");
        expect(result.isQualified).toBe(true);
      });

      it("should preserve case-insensitive model name matching", () => {
        const result = parseReferencePath("@Auth-Service/api.operation.login");
        expect(result.modelName).toBe("Auth-Service");
      });
    });

    describe("error cases - malformed qualified paths", () => {
      it("should throw for empty string", () => {
        expect(() => parseReferencePath("")).toThrow();
        const error = (() => {
          try {
            parseReferencePath("");
          } catch (e) {
            return e;
          }
        })();
        expect((error as any).kind).toBe("malformed-qualified-path");
      });

      it("should throw for whitespace-only string", () => {
        expect(() => parseReferencePath("   ")).toThrow();
      });

      it("should throw for qualified path with missing segment", () => {
        expect(() => parseReferencePath("@auth/")).toThrow();
        const error = (() => {
          try {
            parseReferencePath("@auth/");
          } catch (e) {
            return e;
          }
        })();
        expect((error as any).kind).toBe("malformed-qualified-path");
        expect((error as any).message).toContain("missing segment");
      });

      it("should throw for qualified path with empty model name", () => {
        expect(() => parseReferencePath("@/api.operation.login")).toThrow();
      });

      it("should throw for qualified UUID (not supported)", () => {
        const uuid = "550e8400-e29b-41d4-a716-446655440000";
        expect(() => parseReferencePath(`@auth/${uuid}`)).toThrow();
        const error = (() => {
          try {
            parseReferencePath(`@auth/${uuid}`);
          } catch (e) {
            return e;
          }
        })();
        expect((error as any).kind).toBe("malformed-qualified-path");
        expect((error as any).message).toContain("UUID");
      });

      it("should throw for qualified path with invalid element segment", () => {
        expect(() => parseReferencePath("@auth/invalid-path")).toThrow();
        const error = (() => {
          try {
            parseReferencePath("@auth/invalid-path");
          } catch (e) {
            return e;
          }
        })();
        expect((error as any).kind).toBe("malformed-qualified-path");
      });

      it("should throw for qualified path with only layer (no type/name)", () => {
        expect(() => parseReferencePath("@auth/api")).toThrow();
      });

      it("should parse qualified path with layer.type (valid element path)", () => {
        const result = parseReferencePath("@auth/api.operation");
        expect(result.modelName).toBe("auth");
        expect(result.segment).toBe("api.operation");
        expect(result.isQualified).toBe(true);
      });

      it("should throw for malformed model name (starting with hyphen)", () => {
        expect(() => parseReferencePath("@-auth/api.operation.login")).toThrow();
      });

      it("should parse qualified path with underscore model name", () => {
        // Underscores are allowed in model names
        const result = parseReferencePath("@_auth/api.operation.login");
        expect(result.modelName).toBe("_auth");
        expect(result.segment).toBe("api.operation.login");
        expect(result.isQualified).toBe(true);
      });
    });

    describe("error cases - invalid unqualified paths", () => {
      it("should throw for invalid unqualified path", () => {
        expect(() => parseReferencePath("not-valid-element-path")).toThrow();
      });

      it("should throw for path with only layer name", () => {
        expect(() => parseReferencePath("motivation")).toThrow();
      });

      it("should parse path with layer.type (valid element path)", () => {
        const result = parseReferencePath("motivation.goal");
        expect(result.segment).toBe("motivation.goal");
        expect(result.isQualified).toBe(false);
      });

      it("should throw for path with invalid characters", () => {
        expect(() => parseReferencePath("motivation.goal.invalid@name")).toThrow();
      });
    });

    describe("error cases - null/undefined/non-string", () => {
      it("should throw for null", () => {
        expect(() => parseReferencePath(null as any)).toThrow();
      });

      it("should throw for undefined", () => {
        expect(() => parseReferencePath(undefined as any)).toThrow();
      });

      it("should throw for number", () => {
        expect(() => parseReferencePath(123 as any)).toThrow();
      });

      it("should throw for object", () => {
        expect(() => parseReferencePath({} as any)).toThrow();
      });

      it("should throw for array", () => {
        expect(() => parseReferencePath([] as any)).toThrow();
      });
    });
  });

  describe("isQualifiedReferencePath", () => {
    it("should return true for qualified path", () => {
      expect(isQualifiedReferencePath("@auth/api.operation.login")).toBe(true);
    });

    it("should return true for qualified path with hyphenated model", () => {
      expect(isQualifiedReferencePath("@auth-service/api.endpoint.get")).toBe(
        true
      );
    });

    it("should return false for unqualified element path", () => {
      expect(isQualifiedReferencePath("motivation.goal.increase-revenue")).toBe(
        false
      );
    });

    it("should return false for unqualified UUID", () => {
      expect(
        isQualifiedReferencePath("550e8400-e29b-41d4-a716-446655440000")
      ).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isQualifiedReferencePath("")).toBe(false);
    });

    it("should return false for null", () => {
      expect(isQualifiedReferencePath(null as any)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isQualifiedReferencePath(undefined as any)).toBe(false);
    });

    it("should return false for non-string", () => {
      expect(isQualifiedReferencePath({} as any)).toBe(false);
    });

    it("should handle whitespace in qualified paths", () => {
      expect(isQualifiedReferencePath("  @auth/api.operation.login  ")).toBe(
        true
      );
    });

    it("should handle whitespace in unqualified paths", () => {
      expect(
        isQualifiedReferencePath("  motivation.goal.increase-revenue  ")
      ).toBe(false);
    });
  });

  describe("extractModelNameFromPath", () => {
    it("should extract model name from qualified path", () => {
      expect(extractModelNameFromPath("@auth/api.operation.login")).toBe(
        "auth"
      );
    });

    it("should extract hyphenated model name", () => {
      expect(extractModelNameFromPath("@auth-service/api.endpoint.get")).toBe(
        "auth-service"
      );
    });

    it("should extract underscored model name", () => {
      expect(extractModelNameFromPath("@payment_service/api.operation.process")).toBe(
        "payment_service"
      );
    });

    it("should return undefined for unqualified path", () => {
      expect(
        extractModelNameFromPath("motivation.goal.increase-revenue")
      ).toBeUndefined();
    });

    it("should return undefined for UUID", () => {
      expect(
        extractModelNameFromPath("550e8400-e29b-41d4-a716-446655440000")
      ).toBeUndefined();
    });

    it("should return undefined for empty string", () => {
      expect(extractModelNameFromPath("")).toBeUndefined();
    });

    it("should return undefined for null", () => {
      expect(extractModelNameFromPath(null as any)).toBeUndefined();
    });

    it("should return undefined for undefined", () => {
      expect(extractModelNameFromPath(undefined as any)).toBeUndefined();
    });

    it("should return undefined for non-string", () => {
      expect(extractModelNameFromPath({} as any)).toBeUndefined();
    });

    it("should handle whitespace in qualified paths", () => {
      expect(extractModelNameFromPath("  @auth/api.operation.login  ")).toBe(
        "auth"
      );
    });
  });

  describe("extractSegmentFromPath", () => {
    it("should extract segment from qualified path", () => {
      expect(extractSegmentFromPath("@auth/api.operation.login")).toBe(
        "api.operation.login"
      );
    });

    it("should extract segment from qualified path with hyphenated names", () => {
      expect(extractSegmentFromPath("@auth-service/data-model.entity.user")).toBe(
        "data-model.entity.user"
      );
    });

    it("should return unqualified path unchanged", () => {
      expect(extractSegmentFromPath("motivation.goal.increase-revenue")).toBe(
        "motivation.goal.increase-revenue"
      );
    });

    it("should return UUID unchanged", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      expect(extractSegmentFromPath(uuid)).toBe(uuid);
    });

    it("should throw for empty string", () => {
      expect(() => extractSegmentFromPath("")).toThrow();
    });

    it("should throw for qualified path with missing segment", () => {
      expect(() => extractSegmentFromPath("@auth/")).toThrow();
    });

    it("should throw for null", () => {
      expect(() => extractSegmentFromPath(null as any)).toThrow();
    });

    it("should throw for undefined", () => {
      expect(() => extractSegmentFromPath(undefined as any)).toThrow();
    });

    it("should handle whitespace in qualified paths", () => {
      expect(extractSegmentFromPath("  @auth/api.operation.login  ")).toBe(
        "api.operation.login"
      );
    });

    it("should handle whitespace in unqualified paths", () => {
      expect(
        extractSegmentFromPath("  motivation.goal.increase-revenue  ")
      ).toBe("motivation.goal.increase-revenue");
    });
  });

  describe("integration scenarios", () => {
    it("should parse and extract components from qualified path", () => {
      const path = "@auth-service/api.operation.authenticate";
      const parsed = parseReferencePath(path);

      expect(parsed.isQualified).toBe(true);
      expect(parsed.modelName).toBe("auth-service");
      expect(parsed.segment).toBe("api.operation.authenticate");

      expect(isQualifiedReferencePath(path)).toBe(true);
      expect(extractModelNameFromPath(path)).toBe("auth-service");
      expect(extractSegmentFromPath(path)).toBe("api.operation.authenticate");
    });

    it("should parse and extract components from unqualified path", () => {
      const path = "motivation.goal.increase-revenue";
      const parsed = parseReferencePath(path);

      expect(parsed.isQualified).toBe(false);
      expect(parsed.modelName).toBeUndefined();
      expect(parsed.segment).toBe("motivation.goal.increase-revenue");

      expect(isQualifiedReferencePath(path)).toBe(false);
      expect(extractModelNameFromPath(path)).toBeUndefined();
      expect(extractSegmentFromPath(path)).toBe("motivation.goal.increase-revenue");
    });

    it("should parse and extract components from UUID", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const parsed = parseReferencePath(uuid);

      expect(parsed.isQualified).toBe(false);
      expect(parsed.modelName).toBeUndefined();
      expect(parsed.segment).toBe(uuid);

      expect(isQualifiedReferencePath(uuid)).toBe(false);
      expect(extractModelNameFromPath(uuid)).toBeUndefined();
      expect(extractSegmentFromPath(uuid)).toBe(uuid);
    });
  });
});
