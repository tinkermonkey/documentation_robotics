/**
 * Unit tests for reference path parser
 */

import { describe, it, expect } from "bun:test";
import { parseReferencePath } from "@/utils/reference-path-parser";

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

      it("should throw for qualified path with underscore model name", () => {
        // Model names cannot start with underscore; must start with [a-z0-9]
        expect(() => parseReferencePath("@_auth/api.operation.login")).toThrow();
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

  describe("integration scenarios", () => {
    it("should parse qualified path with all components available", () => {
      const path = "@auth-service/api.operation.authenticate";
      const parsed = parseReferencePath(path);

      expect(parsed.isQualified).toBe(true);
      expect(parsed.modelName).toBe("auth-service");
      expect(parsed.segment).toBe("api.operation.authenticate");
    });

    it("should parse unqualified path with segment available", () => {
      const path = "motivation.goal.increase-revenue";
      const parsed = parseReferencePath(path);

      expect(parsed.isQualified).toBe(false);
      expect(parsed.modelName).toBeUndefined();
      expect(parsed.segment).toBe("motivation.goal.increase-revenue");
    });

    it("should parse UUID with segment available", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const parsed = parseReferencePath(uuid);

      expect(parsed.isQualified).toBe(false);
      expect(parsed.modelName).toBeUndefined();
      expect(parsed.segment).toBe(uuid);
    });
  });
});
