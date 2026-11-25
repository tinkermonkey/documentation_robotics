/**
 * Unit tests for the layer and type filter the compact reads share (core/element-filter.ts):
 * layers and types narrow together, excludes take away, a type may name its layer, and a layer
 * that is not one is named rather than silently matching nothing.
 */

import { describe, it, expect } from "bun:test";
import { elementFilter, isKnownType, unknownFilterNote } from "../../../src/core/element-filter.js";
import { changeLine } from "../../../src/core/changeset-summary.js";

const SERVICE = "application.applicationservice.orders";
const FUNCTION = "application.applicationfunction.write";
const GOAL = "motivation.goal.faster";
const SKETCH = "testing.testcasesketch.writes-rows";

describe("elementFilter", () => {
  it("keeps everything when given nothing", () => {
    const filter = elementFilter();
    expect(filter.active).toBe(false);
    expect([SERVICE, GOAL, SKETCH].every((id) => filter.keeps(id))).toBe(true);
    expect(filter.applied).toEqual({});
  });

  it("narrows by layers and types together, a type bare or with its layer", () => {
    const services = elementFilter({ layers: ["application"], types: ["applicationservice"] });
    expect([SERVICE, FUNCTION, GOAL].filter((id) => services.keeps(id))).toEqual([SERVICE]);
    const qualified = elementFilter({ types: ["application.applicationfunction", "goal"] });
    expect([SERVICE, FUNCTION, GOAL].filter((id) => qualified.keeps(id))).toEqual([FUNCTION, GOAL]);
    // A qualified type in another layer is not the same type.
    expect(elementFilter({ types: ["business.applicationservice"] }).keeps(SERVICE)).toBe(false);
  });

  it("takes excluded layers and types away", () => {
    const noTests = elementFilter({ excludeLayers: ["testing"] });
    expect([SERVICE, SKETCH].filter((id) => noTests.keeps(id))).toEqual([SERVICE]);
    const noSketches = elementFilter({ layers: ["application", "testing"], excludeTypes: ["testing.testcasesketch", "applicationfunction"] });
    expect([SERVICE, FUNCTION, SKETCH].filter((id) => noSketches.keeps(id))).toEqual([SERVICE]);
    expect(noSketches.keepsLayerType("testing", "testcasesketch")).toBe(false);
    expect(noSketches.applied).toEqual({
      layers: ["application", "testing"],
      excludeTypes: ["testing.testcasesketch", "applicationfunction"],
    });
  });

  it("names a layer that is not one", () => {
    const filter = elementFilter({ layers: ["aplication"], excludeLayers: ["testing", "nope"] });
    expect(filter.unknownLayers).toEqual(["aplication", "nope"]);
    expect(unknownFilterNote(filter)).toContain("Not a layer: aplication, nope");
    expect(unknownFilterNote(elementFilter({ layers: ["api"] }))).toBeUndefined();
  });

  it("names a type the spec does not have, bare or with its layer, with the closest real one", () => {
    expect(isKnownType("applicationfunction")).toBe(true);
    expect(isKnownType("application.applicationfunction")).toBe(true);
    expect(isKnownType("business.applicationfunction")).toBe(false);
    const filter = elementFilter({ types: ["aplicationfunction", "goal"], excludeTypes: ["business.applicationfunction"] });
    expect(filter.unknownTypes).toEqual(["aplicationfunction", "business.applicationfunction"]);
    const note = unknownFilterNote(filter)!;
    expect(note).toContain("Not an element type: aplicationfunction (did you mean applicationfunction?)");
    expect(note).toContain("it keeps nothing");
    expect(unknownFilterNote(elementFilter({ types: ["goal", "motivation.goal"] }))).toBeUndefined();
  });
});

describe("changeLine", () => {
  it("writes an element change, a relationship change and who decided it on one line each", () => {
    expect(changeLine({ type: "add", elementId: SERVICE, layerName: "application", after: { type: "applicationservice" } }, 4)).toBe(
      `#4 add ${SERVICE}`
    );
    expect(
      changeLine({
        type: "update",
        elementId: SERVICE,
        layerName: "application",
        before: { name: "Orders", attributes: { a: 1 } },
        after: { name: "Orders!", attributes: { a: 2 } },
        sequenceNumber: 7,
      } as any)
    ).toBe(`#7 update ${SERVICE} (attributes.a, name)`);
    expect(
      changeLine({
        type: "relationship-add",
        elementId: `${FUNCTION}::realizes::${SERVICE}`,
        layerName: "application",
        after: { source: FUNCTION, predicate: "realizes", target: SERVICE },
        origin: { by: "agent" },
      } as any)
    ).toBe(`#0 relationship-add ${FUNCTION} --realizes--> ${SERVICE} [agent]`);
    expect(changeLine({ type: "delete", elementId: GOAL, layerName: "motivation" }, 2, { sequence: false })).toBe(`delete ${GOAL}`);
  });
});
