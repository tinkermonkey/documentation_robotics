/**
 * A relationship the catalog refuses names the predicates it does allow between the two types, in
 * both directions, so the agent can pick one in the same turn (#1354).
 */

import { describe, it, expect } from "bun:test";
import {
  predicatesBetween,
  predicatesBetweenLine,
  validateRelationshipCombination,
} from "../../../src/core/relationship-staging.js";
import { getValidRelationships } from "../../../src/generated/relationship-index.js";

const SERVICE = "application.applicationservice";
const FUNCTION = "application.applicationfunction";

describe("a refused relationship names the predicates the catalog allows (#1354)", () => {
  it("lists the predicates between two types, each way, as the catalog has them", () => {
    const { forward, reverse } = predicatesBetween(SERVICE, FUNCTION);
    const catalog = (from: string, to: string) =>
      [...new Set(getValidRelationships(from, undefined, to).map((r) => r.predicate))].sort();
    expect(forward).toEqual(catalog(SERVICE, FUNCTION));
    expect(reverse).toEqual(catalog(FUNCTION, SERVICE));
    // The issue's case: a function realizes the service it builds.
    expect(reverse).toContain("realizes");
    expect(forward).not.toContain("depends-on");
  });

  it("puts that line first in a refusal's suggestions", () => {
    const refused = validateRelationshipCombination(SERVICE, "depends-on", FUNCTION);
    expect(refused.valid).toBe(false);
    expect(refused.suggestions![0]).toBe(predicatesBetweenLine(SERVICE, FUNCTION));
    expect(refused.suggestions![0]).toContain(`${FUNCTION} --[`);
    expect(refused.suggestions![0]).toContain("realizes");
  });

  it("says when the catalog allows nothing between the two types", () => {
    expect(predicatesBetweenLine(SERVICE, "product.nothing")).toBe(
      `The catalog allows no relationship between ${SERVICE} and product.nothing, in either direction`
    );
  });
});
