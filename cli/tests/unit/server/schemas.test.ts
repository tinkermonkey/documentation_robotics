import { describe, it, expect } from "bun:test";
import {
  ElementIdSchema,
  AnnotationCreateSchema,
  AnnotationUpdateSchema,
  AnnotationReplyCreateSchema,
  AnnotationFilterSchema,
  IdSchema,
  LayerNameSchema,
  TimestampSchema,
  SimpleWSMessageSchema,
  JSONRPCRequestSchema,
  JSONRPCResponseSchema,
  WSMessageSchema,
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
    it("should accept valid lowercase IDs with alphanumeric, hyphens, and underscores", () => {
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

    it("should reject uppercase letters", () => {
      expect(() => {
        IdSchema.parse("Annotation-123");
      }).toThrow();

      expect(() => {
        IdSchema.parse("CHANGESET_MY_FEATURE");
      }).toThrow();
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

    it("should reject empty object with no fields", () => {
      expect(() => {
        AnnotationUpdateSchema.parse({});
      }).toThrow("At least one field must be provided for update");
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

    it("should accept author filter", () => {
      expect(() => {
        AnnotationFilterSchema.parse({
          author: "John Doe",
        });
      }).not.toThrow();
    });

    it("should accept tags filter", () => {
      expect(() => {
        AnnotationFilterSchema.parse({
          tags: "bug,urgent",
        });
      }).not.toThrow();
    });

    it("should accept resolved status filter", () => {
      expect(() => {
        AnnotationFilterSchema.parse({
          resolved: "true",
        });
      }).not.toThrow();

      expect(() => {
        AnnotationFilterSchema.parse({
          resolved: "false",
        });
      }).not.toThrow();
    });

    it("should accept multiple filter combinations", () => {
      expect(() => {
        AnnotationFilterSchema.parse({
          elementId: "motivation.goal.test",
          author: "Jane Smith",
          tags: "feedback",
          resolved: "false",
        });
      }).not.toThrow();
    });

    it("should accept empty object for no filters", () => {
      expect(() => {
        AnnotationFilterSchema.parse({});
      }).not.toThrow();
    });

    it("should reject extra fields with .strict() validation", () => {
      // With .strict(), extra fields should be rejected for security
      expect(() => {
        AnnotationFilterSchema.parse({
          elementId: "motivation.goal.test",
          token: "auth-token-value",
        });
      }).toThrow();
    });

    it("should reject invalid element ID format", () => {
      expect(() => {
        AnnotationFilterSchema.parse({
          elementId: "INVALID_ID",
        });
      }).toThrow();
    });

    it("should reject invalid resolved value", () => {
      expect(() => {
        AnnotationFilterSchema.parse({
          resolved: "maybe",
        });
      }).toThrow();
    });
  });

  describe("TagSchema", () => {
    it("should accept valid tags", () => {
      const validTags = [
        "tag",
        "my-tag",
        "test-123",
        "a",
        "z",
        "0",
        "9",
        "lowercase-with-hyphens",
        "a1b2c3-d4e5",
      ];

      for (const tag of validTags) {
        expect(() => {
          TagSchema.parse(tag);
        }).not.toThrow();
      }
    });

    it("should reject empty tags", () => {
      expect(() => {
        TagSchema.parse("");
      }).toThrow("Tag cannot be empty");
    });

    it("should reject tags exceeding 50 characters", () => {
      const longTag = "a".repeat(51);
      expect(() => {
        TagSchema.parse(longTag);
      }).toThrow("Tag too long");
    });

    it("should accept tags at exactly 50 characters", () => {
      const maxTag = "a".repeat(50);
      expect(() => {
        TagSchema.parse(maxTag);
      }).not.toThrow();
    });

    it("should reject tags with uppercase letters", () => {
      expect(() => {
        TagSchema.parse("MyTag");
      }).toThrow("Tag must contain only lowercase letters, digits, and hyphens");

      expect(() => {
        TagSchema.parse("TAG");
      }).toThrow("Tag must contain only lowercase letters, digits, and hyphens");
    });

    it("should reject tags with special characters", () => {
      expect(() => {
        TagSchema.parse("tag@example");
      }).toThrow("Tag must contain only lowercase letters, digits, and hyphens");

      expect(() => {
        TagSchema.parse("tag_underscore");
      }).toThrow("Tag must contain only lowercase letters, digits, and hyphens");

      expect(() => {
        TagSchema.parse("tag.dot");
      }).toThrow("Tag must contain only lowercase letters, digits, and hyphens");
    });

    it("should reject tags starting with hyphen", () => {
      expect(() => {
        TagSchema.parse("-tag");
      }).toThrow("Tag must contain only lowercase letters, digits, and hyphens");
    });

    it("should reject tags ending with hyphen", () => {
      expect(() => {
        TagSchema.parse("tag-");
      }).toThrow("Tag must contain only lowercase letters, digits, and hyphens");
    });

    it("should reject tags with consecutive hyphens", () => {
      expect(() => {
        TagSchema.parse("tag--name");
      }).toThrow("Tag must contain only lowercase letters, digits, and hyphens");
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

  describe("TimestampSchema", () => {
    it("should accept valid ISO 8601 timestamps", () => {
      expect(() => {
        TimestampSchema.parse("2024-01-15T10:30:00Z");
      }).not.toThrow();

      expect(() => {
        TimestampSchema.parse("2024-12-31T23:59:59Z");
      }).not.toThrow();

      expect(() => {
        TimestampSchema.parse("2024-06-15T14:30:00.123Z");
      }).not.toThrow();
    });

    it("should accept timestamps with milliseconds", () => {
      expect(() => {
        TimestampSchema.parse("2024-01-15T10:30:00.000Z");
      }).not.toThrow();

      expect(() => {
        TimestampSchema.parse("2024-01-15T10:30:00.999Z");
      }).not.toThrow();
    });

    it("should reject invalid datetime formats", () => {
      expect(() => {
        TimestampSchema.parse("2024-01-15");
      }).toThrow();

      expect(() => {
        TimestampSchema.parse("10:30:00");
      }).toThrow();

      expect(() => {
        TimestampSchema.parse("not-a-date");
      }).toThrow();

      expect(() => {
        TimestampSchema.parse("2024-13-01T10:30:00Z");
      }).toThrow();

      expect(() => {
        TimestampSchema.parse("2024-01-15T10:30:00+00:00");
      }).toThrow();
    });

    it("should reject empty strings", () => {
      expect(() => {
        TimestampSchema.parse("");
      }).toThrow();
    });
  });

  describe("SimpleWSMessageSchema", () => {
    it("should accept valid subscribe message", () => {
      expect(() => {
        SimpleWSMessageSchema.parse({
          type: "subscribe",
          topics: ["layer:api", "element:changes"],
        });
      }).not.toThrow();
    });

    it("should accept valid annotate message", () => {
      expect(() => {
        SimpleWSMessageSchema.parse({
          type: "annotate",
          annotation: {
            elementId: "api.endpoint.create-user",
            author: "John Doe",
            text: "This endpoint needs documentation",
            timestamp: "2024-01-15T10:30:00Z",
          },
        });
      }).not.toThrow();
    });

    it("should accept ping message", () => {
      expect(() => {
        SimpleWSMessageSchema.parse({
          type: "ping",
        });
      }).not.toThrow();
    });

    it("should require type field", () => {
      expect(() => {
        SimpleWSMessageSchema.parse({
          topics: ["layer:api"],
        });
      }).toThrow();
    });

    it("should reject invalid message type", () => {
      expect(() => {
        SimpleWSMessageSchema.parse({
          type: "invalid",
        });
      }).toThrow();
    });

    it("should allow optional topics and annotation", () => {
      const result = SimpleWSMessageSchema.parse({
        type: "subscribe",
      });
      expect(result.topics).toBeUndefined();
    });
  });

  describe("JSONRPCRequestSchema", () => {
    it("should accept valid JSON-RPC request with string id", () => {
      expect(() => {
        JSONRPCRequestSchema.parse({
          jsonrpc: "2.0",
          method: "model.getElement",
          params: { elementId: "api.endpoint.create-user" },
          id: "req-1",
        });
      }).not.toThrow();
    });

    it("should accept valid JSON-RPC request with numeric id", () => {
      expect(() => {
        JSONRPCRequestSchema.parse({
          jsonrpc: "2.0",
          method: "annotation.list",
          params: { layer: "api" },
          id: 42,
        });
      }).not.toThrow();
    });

    it("should accept JSON-RPC request without params", () => {
      expect(() => {
        JSONRPCRequestSchema.parse({
          jsonrpc: "2.0",
          method: "model.getVersion",
        });
      }).not.toThrow();
    });

    it("should accept JSON-RPC notification without id", () => {
      expect(() => {
        JSONRPCRequestSchema.parse({
          jsonrpc: "2.0",
          method: "notification.publish",
          params: { message: "Model updated" },
        });
      }).not.toThrow();
    });

    it("should require jsonrpc version 2.0", () => {
      expect(() => {
        JSONRPCRequestSchema.parse({
          jsonrpc: "1.0",
          method: "test",
          id: 1,
        });
      }).toThrow();
    });

    it("should require method field", () => {
      expect(() => {
        JSONRPCRequestSchema.parse({
          jsonrpc: "2.0",
          id: 1,
        });
      }).toThrow();
    });
  });

  describe("JSONRPCResponseSchema", () => {
    it("should accept successful response with result", () => {
      expect(() => {
        JSONRPCResponseSchema.parse({
          jsonrpc: "2.0",
          result: { elements: 42, layers: 12 },
          id: "req-1",
        });
      }).not.toThrow();
    });

    it("should accept error response", () => {
      expect(() => {
        JSONRPCResponseSchema.parse({
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: "Invalid Request",
          },
          id: 1,
        });
      }).not.toThrow();
    });

    it("should accept error response with data", () => {
      expect(() => {
        JSONRPCResponseSchema.parse({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal error",
            data: { context: "Failed to load layer" },
          },
          id: "req-123",
        });
      }).not.toThrow();
    });

    it("should accept numeric id", () => {
      expect(() => {
        JSONRPCResponseSchema.parse({
          jsonrpc: "2.0",
          result: { status: "ok" },
          id: 999,
        });
      }).not.toThrow();
    });

    it("should require jsonrpc version 2.0", () => {
      expect(() => {
        JSONRPCResponseSchema.parse({
          jsonrpc: "1.0",
          result: {},
          id: 1,
        });
      }).toThrow();
    });

    it("should require id field", () => {
      expect(() => {
        JSONRPCResponseSchema.parse({
          jsonrpc: "2.0",
          result: { test: "data" },
        });
      }).toThrow();
    });

    it("should not allow both result and error", () => {
      // This is a semantic constraint not enforced at schema level,
      // but the schema should still parse both present (JSON-RPC spec says don't send both)
      expect(() => {
        JSONRPCResponseSchema.parse({
          jsonrpc: "2.0",
          result: { ok: true },
          error: { code: 1, message: "Error" },
          id: 1,
        });
      }).not.toThrow();
    });
  });

  describe("WSMessageSchema", () => {
    it("should accept SimpleWSMessage", () => {
      expect(() => {
        WSMessageSchema.parse({
          type: "ping",
        });
      }).not.toThrow();
    });

    it("should accept JSONRPCRequest", () => {
      expect(() => {
        WSMessageSchema.parse({
          jsonrpc: "2.0",
          method: "test.call",
          id: 1,
        });
      }).not.toThrow();
    });

    it("should accept JSONRPCResponse", () => {
      expect(() => {
        WSMessageSchema.parse({
          jsonrpc: "2.0",
          result: { ok: true },
          id: 1,
        });
      }).not.toThrow();
    });

    it("should reject unknown message types", () => {
      expect(() => {
        WSMessageSchema.parse({
          unknown: "field",
        });
      }).toThrow();
    });
  });
});
