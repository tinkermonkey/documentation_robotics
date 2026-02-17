import { describe, it, expect } from "bun:test";
import {
  ElementIdSchema,
  AnnotationCreateSchema,
  AnnotationUpdateSchema,
  AnnotationReplyCreateSchema,
  AnnotationFilterSchema,
  IdSchema,
  LayerNameSchema,
} from "../../../src/server/schemas.js";

describe("Server Schemas", () => {
  describe("ElementIdSchema", () => {
    it("should accept valid new format element IDs", () => {
      expect(() => {
        ElementIdSchema.parse("motivation.goal.customer-satisfaction");
      }).not.toThrow();

      expect(() => {
        ElementIdSchema.parse("api.endpoint.create-order");
      }).not.toThrow();
    });

    it("should accept valid legacy format element IDs", () => {
      expect(() => {
        ElementIdSchema.parse("motivation-goal-customer-satisfaction");
      }).not.toThrow();
    });

    it("should accept single character IDs", () => {
      expect(() => {
        ElementIdSchema.parse("a");
      }).not.toThrow();
    });

    it("should reject empty strings", () => {
      expect(() => {
        ElementIdSchema.parse("");
      }).toThrow();
    });

    it("should reject IDs with trailing dots or hyphens", () => {
      expect(() => {
        ElementIdSchema.parse("motivation.goal-");
      }).toThrow();

      expect(() => {
        ElementIdSchema.parse("motivation.goal.");
      }).toThrow();
    });

    it("should reject IDs with uppercase letters", () => {
      expect(() => {
        ElementIdSchema.parse("Motivation.Goal.CustomerSatisfaction");
      }).toThrow();
    });

    it("should reject IDs with special characters", () => {
      expect(() => {
        ElementIdSchema.parse("motivation@goal!customer");
      }).toThrow();
    });
  });

  describe("IdSchema", () => {
    it("should accept valid IDs with alphanumeric, hyphens, and underscores", () => {
      expect(() => {
        IdSchema.parse("annotation-123");
      }).not.toThrow();

      expect(() => {
        IdSchema.parse("changeset_my_feature");
      }).not.toThrow();

      expect(() => {
        IdSchema.parse("id123");
      }).not.toThrow();
    });

    it("should reject empty strings", () => {
      expect(() => {
        IdSchema.parse("");
      }).toThrow();
    });

    it("should reject IDs with special characters", () => {
      expect(() => {
        IdSchema.parse("id.with.dots");
      }).toThrow();

      expect(() => {
        IdSchema.parse("id@example");
      }).toThrow();
    });
  });

  describe("AnnotationCreateSchema", () => {
    it("should accept valid annotation creation data", () => {
      expect(() => {
        AnnotationCreateSchema.parse({
          elementId: "motivation.goal.test",
          author: "Test Author",
          content: "Test content",
          tags: ["tag1", "tag2"],
        });
      }).not.toThrow();
    });

    it("should use default author when not provided", () => {
      const result = AnnotationCreateSchema.parse({
        elementId: "motivation.goal.test",
        content: "Test content",
      });
      expect(result.author).toBe("Anonymous");
    });

    it("should use empty tags array when not provided", () => {
      const result = AnnotationCreateSchema.parse({
        elementId: "motivation.goal.test",
        author: "Test",
        content: "Test content",
      });
      expect(result.tags).toEqual([]);
    });

    it("should reject missing elementId", () => {
      expect(() => {
        AnnotationCreateSchema.parse({
          author: "Test",
          content: "Test content",
        });
      }).toThrow();
    });

    it("should reject missing content", () => {
      expect(() => {
        AnnotationCreateSchema.parse({
          elementId: "motivation.goal.test",
          author: "Test",
        });
      }).toThrow();
    });

    it("should reject empty content", () => {
      expect(() => {
        AnnotationCreateSchema.parse({
          elementId: "motivation.goal.test",
          author: "Test",
          content: "",
        });
      }).toThrow();
    });

    it("should reject content exceeding max length", () => {
      expect(() => {
        AnnotationCreateSchema.parse({
          elementId: "motivation.goal.test",
          author: "Test",
          content: "x".repeat(5001),
        });
      }).toThrow();
    });

    it("should reject author exceeding max length", () => {
      expect(() => {
        AnnotationCreateSchema.parse({
          elementId: "motivation.goal.test",
          author: "x".repeat(101),
          content: "Test content",
        });
      }).toThrow();
    });

    it("should reject extra fields", () => {
      expect(() => {
        AnnotationCreateSchema.parse({
          elementId: "motivation.goal.test",
          author: "Test",
          content: "Test content",
          extraField: "should fail",
        });
      }).toThrow();
    });
  });

  describe("AnnotationUpdateSchema", () => {
    it("should accept partial update with only content", () => {
      expect(() => {
        AnnotationUpdateSchema.parse({
          content: "Updated content",
        });
      }).not.toThrow();
    });

    it("should accept partial update with only tags", () => {
      expect(() => {
        AnnotationUpdateSchema.parse({
          tags: ["new-tag"],
        });
      }).not.toThrow();
    });

    it("should accept partial update with only resolved", () => {
      expect(() => {
        AnnotationUpdateSchema.parse({
          resolved: true,
        });
      }).not.toThrow();
    });

    it("should accept full update with all fields", () => {
      expect(() => {
        AnnotationUpdateSchema.parse({
          content: "Updated content",
          tags: ["tag1", "tag2"],
          resolved: true,
        });
      }).not.toThrow();
    });

    it("should accept empty object for no updates", () => {
      expect(() => {
        AnnotationUpdateSchema.parse({});
      }).not.toThrow();
    });

    it("should reject empty content", () => {
      expect(() => {
        AnnotationUpdateSchema.parse({
          content: "",
        });
      }).toThrow();
    });

    it("should reject extra fields", () => {
      expect(() => {
        AnnotationUpdateSchema.parse({
          content: "Updated",
          extraField: "should fail",
        });
      }).toThrow();
    });
  });

  describe("AnnotationReplyCreateSchema", () => {
    it("should accept valid reply creation data", () => {
      expect(() => {
        AnnotationReplyCreateSchema.parse({
          author: "Test Author",
          content: "Reply content",
        });
      }).not.toThrow();
    });

    it("should reject missing author", () => {
      expect(() => {
        AnnotationReplyCreateSchema.parse({
          content: "Reply content",
        });
      }).toThrow();
    });

    it("should reject missing content", () => {
      expect(() => {
        AnnotationReplyCreateSchema.parse({
          author: "Test Author",
        });
      }).toThrow();
    });

    it("should reject empty author", () => {
      expect(() => {
        AnnotationReplyCreateSchema.parse({
          author: "",
          content: "Reply content",
        });
      }).toThrow();
    });

    it("should reject empty content", () => {
      expect(() => {
        AnnotationReplyCreateSchema.parse({
          author: "Test Author",
          content: "",
        });
      }).toThrow();
    });

    it("should reject extra fields", () => {
      expect(() => {
        AnnotationReplyCreateSchema.parse({
          author: "Test Author",
          content: "Reply content",
          extraField: "should fail",
        });
      }).toThrow();
    });
  });

  describe("AnnotationFilterSchema", () => {
    it("should accept valid element ID filter", () => {
      expect(() => {
        AnnotationFilterSchema.parse({
          elementId: "motivation.goal.test",
        });
      }).not.toThrow();
    });

    it("should accept empty object for no filters", () => {
      expect(() => {
        AnnotationFilterSchema.parse({});
      }).not.toThrow();
    });

    it("should allow passthrough of extra fields like auth token", () => {
      // With .passthrough(), extra fields should be allowed and passed through
      const result = AnnotationFilterSchema.parse({
        elementId: "motivation.goal.test",
        token: "auth-token-value",
      });
      expect(result.elementId).toBe("motivation.goal.test");
      expect((result as any).token).toBe("auth-token-value");
    });

    it("should reject invalid element ID format", () => {
      expect(() => {
        AnnotationFilterSchema.parse({
          elementId: "INVALID_ID",
        });
      }).toThrow();
    });
  });

  describe("LayerNameSchema", () => {
    it("should accept valid canonical layer names", () => {
      const validLayers = [
        "motivation",
        "business",
        "security",
        "application",
        "technology",
        "api",
        "data-model",
        "data-store",
        "ux",
        "navigation",
        "apm",
        "testing",
      ];

      for (const layer of validLayers) {
        expect(() => {
          LayerNameSchema.parse(layer);
        }).not.toThrow();
      }
    });

    it("should reject invalid layer names", () => {
      expect(() => {
        LayerNameSchema.parse("invalid-layer");
      }).toThrow();

      expect(() => {
        LayerNameSchema.parse("Motivation");
      }).toThrow();

      expect(() => {
        LayerNameSchema.parse("datamodel");
      }).toThrow();
    });

    it("should reject underscore variants", () => {
      expect(() => {
        LayerNameSchema.parse("data_model");
      }).toThrow();

      expect(() => {
        LayerNameSchema.parse("data_store");
      }).toThrow();
    });
  });
});
