import { describe, it, expect } from "bun:test";
import { formatLayerName, formatLayerNameWithSuffix } from "../../../src/utils/layer-name-formatter.js";

describe("formatLayerName", () => {
  it("should convert single word layer names to title case", () => {
    expect(formatLayerName("motivation")).toBe("Motivation");
    expect(formatLayerName("business")).toBe("Business");
    expect(formatLayerName("security")).toBe("Security");
    expect(formatLayerName("application")).toBe("Application");
    expect(formatLayerName("technology")).toBe("Technology");
    expect(formatLayerName("api")).toBe("API");
    expect(formatLayerName("ux")).toBe("UX");
    expect(formatLayerName("navigation")).toBe("Navigation");
    expect(formatLayerName("apm")).toBe("APM");
    expect(formatLayerName("testing")).toBe("Testing");
  });

  it("should convert hyphenated layer names to title case", () => {
    expect(formatLayerName("data-model")).toBe("Data Model");
    expect(formatLayerName("data-store")).toBe("Data Store");
  });

  it("should handle layer names that are already in title case", () => {
    expect(formatLayerName("Motivation")).toBe("Motivation");
    expect(formatLayerName("Data Model")).toBe("Data Model");
  });

  it("should handle underscore-separated names", () => {
    expect(formatLayerName("data_model")).toBe("Data Model");
  });

  it("should preserve all caps acronyms", () => {
    expect(formatLayerName("api")).toBe("API");
    expect(formatLayerName("ux")).toBe("UX");
    expect(formatLayerName("apm")).toBe("APM");
  });

  it("should handle mixed case input", () => {
    expect(formatLayerName("DaTa-MoDeL")).toBe("Data Model");
    expect(formatLayerName("aPi")).toBe("API");
  });

  it("should handle empty string", () => {
    expect(formatLayerName("")).toBe("");
  });

  it("should handle single character", () => {
    expect(formatLayerName("a")).toBe("A");
  });
});

describe("formatLayerNameWithSuffix", () => {
  it("should format layer name and append 'layer' suffix", () => {
    expect(formatLayerNameWithSuffix("motivation")).toBe("Motivation layer");
    expect(formatLayerNameWithSuffix("business")).toBe("Business layer");
    expect(formatLayerNameWithSuffix("security")).toBe("Security layer");
    expect(formatLayerNameWithSuffix("application")).toBe("Application layer");
    expect(formatLayerNameWithSuffix("technology")).toBe("Technology layer");
    expect(formatLayerNameWithSuffix("api")).toBe("API layer");
    expect(formatLayerNameWithSuffix("ux")).toBe("UX layer");
    expect(formatLayerNameWithSuffix("navigation")).toBe("Navigation layer");
    expect(formatLayerNameWithSuffix("apm")).toBe("APM layer");
    expect(formatLayerNameWithSuffix("testing")).toBe("Testing layer");
  });

  it("should format hyphenated layer names with suffix", () => {
    expect(formatLayerNameWithSuffix("data-model")).toBe("Data Model layer");
    expect(formatLayerNameWithSuffix("data-store")).toBe("Data Store layer");
  });

  it("should handle layer names that are already in title case", () => {
    expect(formatLayerNameWithSuffix("Motivation")).toBe("Motivation layer");
    expect(formatLayerNameWithSuffix("Data Model")).toBe("Data Model layer");
  });

  it("should handle mixed case input", () => {
    expect(formatLayerNameWithSuffix("DaTa-MoDeL")).toBe("Data Model layer");
    expect(formatLayerNameWithSuffix("aPi")).toBe("API layer");
  });

  it("should handle empty string", () => {
    expect(formatLayerNameWithSuffix("")).toBe(" layer");
  });

  it("should handle single character with suffix", () => {
    expect(formatLayerNameWithSuffix("a")).toBe("A layer");
  });

  it("should not double up suffix", () => {
    expect(formatLayerNameWithSuffix("motivation layer")).toBe("Motivation Layer layer");
  });
});
