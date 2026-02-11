import { describe, it, expect } from "bun:test";
import { formatLayerName, formatLayerNameWithSuffix } from "../../../src/utils/layer-name-formatter.js";

describe("formatLayerName", () => {
  it("should convert single word layer names to title case", () => {
    expect(formatLayerName("motivation")).toBe("Motivation");
    expect(formatLayerName("business")).toBe("Business");
    expect(formatLayerName("security")).toBe("Security");
    expect(formatLayerName("application")).toBe("Application");
    expect(formatLayerName("technology")).toBe("Technology");
    expect(formatLayerName("api")).toBe("Api");
    expect(formatLayerName("ux")).toBe("Ux");
    expect(formatLayerName("navigation")).toBe("Navigation");
    expect(formatLayerName("apm")).toBe("Apm");
    expect(formatLayerName("testing")).toBe("Testing");
  });

  it("should convert hyphenated layer names to title case", () => {
    expect(formatLayerName("data-model")).toBe("Data Model");
    expect(formatLayerName("data-store")).toBe("Data Store");
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
    expect(formatLayerNameWithSuffix("api")).toBe("Api layer");
    expect(formatLayerNameWithSuffix("ux")).toBe("Ux layer");
    expect(formatLayerNameWithSuffix("navigation")).toBe("Navigation layer");
    expect(formatLayerNameWithSuffix("apm")).toBe("Apm layer");
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
