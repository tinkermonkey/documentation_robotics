import { describe, it, expect } from "bun:test";
import { looksLikeElementReference } from "@/utils/element-reference-shape";

describe("looksLikeElementReference", () => {
  it("accepts a UUIDv4", () => {
    expect(looksLikeElementReference("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("accepts a dot-separated id whose first segment is a known layer", () => {
    expect(looksLikeElementReference("business.service.user-management")).toBe(true);
    expect(looksLikeElementReference("data-model.entity.order")).toBe(true);
  });

  it("rejects a URL fragment, even one ending in a Ref-convention shape", () => {
    // The real api.link.operationRef collision: a schema-declared OpenAPI URL fragment.
    expect(looksLikeElementReference("#/paths/~1users/get")).toBe(false);
  });

  it("rejects a plain URL", () => {
    expect(looksLikeElementReference("https://example.com/foo")).toBe(false);
  });

  it("rejects a string with no dot and no known layer prefix", () => {
    expect(looksLikeElementReference("not-a-reference")).toBe(false);
  });

  it("rejects a dot-separated string whose first segment is not a known layer", () => {
    expect(looksLikeElementReference("notalayer.type.slug")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(looksLikeElementReference("")).toBe(false);
  });
});
