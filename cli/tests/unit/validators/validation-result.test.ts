import { describe, it, expect } from "bun:test";
import { ValidationResult } from "@/validators/types";

describe("ValidationResult", () => {
  it("should create an empty validation result", () => {
    const result = new ValidationResult();
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.isValid()).toBe(true);
  });

  it("should add errors", () => {
    const result = new ValidationResult();
    result.addError({
      layer: "motivation",
      elementId: "test-element",
      message: "Test error",
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].severity).toBe("error");
    expect(result.errors[0].message).toBe("Test error");
    expect(result.isValid()).toBe(false);
  });

  it("should add warnings", () => {
    const result = new ValidationResult();
    result.addWarning({
      layer: "motivation",
      message: "Test warning",
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].severity).toBe("warning");
    expect(result.isValid()).toBe(true);
  });

  it("should merge results with prefix", () => {
    const result1 = new ValidationResult();
    result1.addError({
      layer: "motivation",
      message: "Error 1",
    });

    const result2 = new ValidationResult();
    result2.addError({
      layer: "business",
      message: "Error 2",
    });
    result2.addWarning({
      layer: "business",
      message: "Warning 1",
    });

    result1.merge(result2, "[Test]");

    expect(result1.errors).toHaveLength(2);
    expect(result1.warnings).toHaveLength(1);
    expect(result1.errors[1].message).toBe("[Test]: Error 2");
    expect(result1.warnings[0].message).toBe("[Test]: Warning 1");
    expect(result1.isValid()).toBe(false);
  });

  it("should merge results without prefix", () => {
    const result1 = new ValidationResult();
    const result2 = new ValidationResult();
    result2.addError({
      layer: "business",
      message: "Error 2",
    });

    result1.merge(result2);

    expect(result1.errors[0].message).toBe("Error 2");
  });

  it("should convert to dictionary", () => {
    const result = new ValidationResult();
    result.addError({
      layer: "motivation",
      message: "Error 1",
    });
    result.addWarning({
      layer: "business",
      message: "Warning 1",
    });

    const dict = result.toDict();

    expect(dict.valid).toBe(false);
    expect(dict.errorCount).toBe(1);
    expect(dict.warningCount).toBe(1);
    expect((dict.errors as any[]).length).toBe(1);
    expect((dict.warnings as any[]).length).toBe(1);
  });

  it("should indicate valid when no errors", () => {
    const result = new ValidationResult();
    result.addWarning({
      layer: "business",
      message: "Just a warning",
    });

    expect(result.isValid()).toBe(true);
    expect(result.toDict().valid).toBe(true);
  });
});
