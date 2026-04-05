import { describe, it, expect } from "bun:test";
import { createAnchor } from "../../../src/utils/markdown-anchor.js";

describe("createAnchor", () => {
  it("should convert text to lowercase", () => {
    expect(createAnchor("Hello World")).toBe("hello-world");
    expect(createAnchor("UPPERCASE")).toBe("uppercase");
  });

  it("should replace spaces with hyphens", () => {
    expect(createAnchor("Hello World")).toBe("hello-world");
    expect(createAnchor("One Two Three")).toBe("one-two-three");
  });

  it("should replace multiple consecutive non-alphanumeric characters with single hyphen", () => {
    expect(createAnchor("Hello...World")).toBe("hello-world");
    expect(createAnchor("Test---Value")).toBe("test-value");
    expect(createAnchor("A__B__C")).toBe("a-b-c");
  });

  it("should strip leading hyphens", () => {
    expect(createAnchor("---hello")).toBe("hello");
    expect(createAnchor("-world")).toBe("world");
  });

  it("should strip trailing hyphens", () => {
    expect(createAnchor("hello---")).toBe("hello");
    expect(createAnchor("world-")).toBe("world");
  });

  it("should handle empty string", () => {
    expect(createAnchor("")).toBe("");
  });

  it("should handle only non-alphanumeric characters", () => {
    expect(createAnchor("---")).toBe("");
    expect(createAnchor("!!!")).toBe("");
  });

  it("should handle numbers", () => {
    expect(createAnchor("Section 1")).toBe("section-1");
    expect(createAnchor("Test 123")).toBe("test-123");
  });

  it("should handle special markdown characters", () => {
    expect(createAnchor("Test #Heading")).toBe("test-heading");
    expect(createAnchor("Code `example`")).toBe("code-example");
    expect(createAnchor("Link [text]")).toBe("link-text");
  });

  it("should handle mixed case with numbers", () => {
    expect(createAnchor("MySection123")).toBe("mysection123");
    expect(createAnchor("API-Integration")).toBe("api-integration");
  });

  it("should handle common heading patterns", () => {
    expect(createAnchor("## Layer Introduction")).toBe("layer-introduction");
    expect(createAnchor("Inter-Layer Dependencies")).toBe("inter-layer-dependencies");
    expect(createAnchor("Node Reference")).toBe("node-reference");
  });
});
