import { describe, it, expect } from "bun:test";
import { requiredAttributesFor, requiredAttributesLine, requiredAttributesOf } from "../../../src/utils/required-attributes.js";

describe("required attributes of a type (#1153)", () => {
  it("gives each required attribute with what it takes", () => {
    expect(requiredAttributesOf("motivation.goal")).toEqual({ priority: "one of [critical, high, medium, low, informational]" });
    expect(requiredAttributesOf("api.operation")).toEqual({ operationId: "string", summary: "string", tags: "string" });
  });

  it("gives nothing for an unknown type", () => {
    expect(requiredAttributesOf("application.nosuchtype")).toBeUndefined();
  });

  it("lists several types once each, skipping wildcards and unknown types", () => {
    expect(
      requiredAttributesFor(["application.applicationservice", "application.*", "application.applicationservice", "application.nosuchtype"])
    ).toEqual({ "application.applicationservice": { serviceType: "one of [synchronous, asynchronous, event-driven, batch]" } });
  });

  it("says it in one line for a refusal", () => {
    expect(requiredAttributesLine("application.applicationcomponent")).toBe(
      "application.applicationcomponent requires: type (one of [generic, external, internal, service-component])"
    );
    expect(requiredAttributesLine("application.nosuchtype")).toBeUndefined();
  });
});
