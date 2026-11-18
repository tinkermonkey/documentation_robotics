import { describe, it, expect } from "bun:test";
import { errorsByElement, unfilledRequired } from "../../../src/core/upgrade-validation.js";
import { countDroppedRelationships } from "../../../src/core/upgrade-plan.js";
import type { ValidationIssue } from "../../../src/validators/types.js";

/** A schema error as the schema validator reports a required attribute an element leaves out */
function missing(elementId: string, attribute: string, location = "/attributes"): ValidationIssue {
  return {
    layer: elementId.split(".")[0],
    elementId,
    message: `Element '${elementId}': At ${location}: missing required property '${attribute}'`,
    location,
    severity: "error",
  };
}

describe("errorsByElement (#1166)", () => {
  it("groups the required attributes each element leaves out, apart from its other errors", () => {
    const op = "api.operation.list-orders";
    const errors: ValidationIssue[] = [
      missing(op, "operationId"),
      missing(op, "summary"),
      { layer: "api", elementId: op, message: "Broken reference: target 'x' does not exist", severity: "error" },
      missing("api.response.ok", "description"),
      missing(op, "tags"),
      { layer: "api", message: "Relationship file unreadable", severity: "error" },
    ];

    expect(errorsByElement(errors)).toEqual([
      {
        elementId: op,
        layer: "api",
        missingAttributes: ["operationId", "summary", "tags"],
        messages: ["Broken reference: target 'x' does not exist"],
      },
      { elementId: "api.response.ok", layer: "api", missingAttributes: ["description"], messages: [] },
      { layer: "api", missingAttributes: [], messages: ["Relationship file unreadable"] },
    ]);
  });

  it("names a nested required attribute by its path under attributes", () => {
    const id = "api.openapidocument.shop";
    expect(errorsByElement([missing(id, "title", "/attributes/info")])[0].missingAttributes).toEqual(["info.title"]);
  });
});

describe("unfilledRequired (#1166)", () => {
  it("lists only the elements that leave a required attribute empty", () => {
    const errors: ValidationIssue[] = [
      missing("api.operation.list-orders", "operationId"),
      missing("api.operation.list-orders", "operationId"),
      { layer: "api", elementId: "api.operation.other", message: "Something else", severity: "error" },
    ];
    expect(unfilledRequired(errors)).toEqual([
      { elementId: "api.operation.list-orders", layer: "api", attributes: ["operationId"] },
    ]);
  });
});

describe("countDroppedRelationships (#1164)", () => {
  const change = (action: string, source: string, predicate: string, target: string) => ({
    action,
    before: { source, predicate, target },
  });

  it("counts drops by predicate and source and target type, most first, leaving out duplicates", () => {
    expect(
      countDroppedRelationships([
        change("dropped", "api.callback.notify", "uses", "api.server.prod"),
        change("dropped", "api.operation.a", "delivers", "api.response.ok"),
        change("dropped", "api.operation.b", "delivers", "api.response.created"),
        change("dropped-duplicate", "api.operation.c", "delivers", "api.response.ok"),
        change("rewritten", "api.operation.d", "delivers", "api.response.ok"),
      ])
    ).toEqual([
      { sourceType: "api.operation", predicate: "delivers", targetType: "api.response", count: 2 },
      { sourceType: "api.callback", predicate: "uses", targetType: "api.server", count: 1 },
    ]);
  });
});
