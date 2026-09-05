import { describe, it, expect } from "bun:test";
import { getErrorMessage } from "../../../src/utils/errors.js";

describe("getErrorMessage", () => {
  it("should extract message from Error instances", () => {
    const error = new Error("Test error message");
    const message = getErrorMessage(error);
    expect(message).toBe("Test error message");
  });

  it("should handle TypeError instances", () => {
    const error = new TypeError("Type error message");
    const message = getErrorMessage(error);
    expect(message).toBe("Type error message");
  });

  it("should handle custom Error subclasses", () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "CustomError";
      }
    }

    const error = new CustomError("Custom error");
    const message = getErrorMessage(error);
    expect(message).toBe("Custom error");
  });

  it("should convert string errors to string", () => {
    const message = getErrorMessage("String error");
    expect(message).toBe("String error");
  });

  it("should convert null to string", () => {
    const message = getErrorMessage(null);
    expect(message).toBe("null");
  });

  it("should convert undefined to string", () => {
    const message = getErrorMessage(undefined);
    expect(message).toBe("undefined");
  });

  it("should convert objects to string representation", () => {
    const error = { message: "Object error", code: 500 };
    const message = getErrorMessage(error);
    expect(message).toContain("Object");
  });

  it("should convert numbers to string", () => {
    const message = getErrorMessage(42);
    expect(message).toBe("42");
  });

  it("should convert boolean to string", () => {
    const message = getErrorMessage(true);
    expect(message).toBe("true");
  });

  it("should handle Error with empty message", () => {
    const error = new Error("");
    const message = getErrorMessage(error);
    expect(message).toBe("");
  });

  it("should handle object with toString method", () => {
    const error = {
      toString: () => "Custom toString message",
    };
    const message = getErrorMessage(error);
    expect(message).toBe("Custom toString message");
  });
});
