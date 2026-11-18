/**
 * A missing required attribute's error says what the attribute takes (#1153): its allowed values
 * and default, from the schema, so one retry of model_add can supply it.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import type { ErrorObject } from "ajv";
import { SchemaValidator } from "../../../src/validators/schema-validator.js";
import { Element } from "../../../src/core/element.js";

describe("SchemaValidator: missing required attributes", () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    SchemaValidator.reset();
    validator = new SchemaValidator();
  });

  it("lists the allowed values of a missing required attribute in the message and the fix", async () => {
    const element = new Element({
      id: "550e8400-e29b-41d4-a716-446655440000",
      path: "application.applicationcomponent.graph-degree",
      spec_node_id: "application.applicationcomponent",
      type: "applicationcomponent",
      layer_id: "application",
      name: "graph-degree",
      attributes: {},
    });
    const result = await validator.validateElement(element, "application");
    const missing = result.errors.find((e) => e.message.includes("missing required property 'type'"));
    expect(missing).toBeDefined();
    expect(missing!.message).toContain("one of [generic, external, internal, service-component]");
    expect(missing!.fixSuggestion).toBe("Add required field: type, one of [generic, external, internal, service-component]");
  });

  it("gives the default when the schema has one, and nothing extra when it says neither", () => {
    const format = (error: Partial<ErrorObject>) => ({
      message: (validator as any).formatAjvError(error),
      fix: (validator as any).generateFixSuggestion(error),
    });
    const parentSchema = {
      required: ["mode", "label"],
      properties: { mode: { type: "string", enum: ["a", "b"], default: "a" }, label: { type: "string" } },
    };
    expect(format({ keyword: "required", instancePath: "/attributes", params: { missingProperty: "mode" }, parentSchema })).toEqual({
      message: "At /attributes: missing required property 'mode' (one of [a, b]; default: a)",
      fix: "Add required field: mode, one of [a, b]; default: a",
    });
    expect(format({ keyword: "required", instancePath: "/attributes", params: { missingProperty: "label" }, parentSchema })).toEqual({
      message: "At /attributes: missing required property 'label'",
      fix: "Add required field: label",
    });
    // Without verbose's parentSchema, the message is as before.
    expect(format({ keyword: "required", instancePath: "/", params: { missingProperty: "id" } }).message).toBe(
      "At /: missing required property 'id'"
    );
  });
});
