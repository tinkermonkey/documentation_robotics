/**
 * `dr validate --layers` takes layer names separated by spaces or commas. A name that isn't a
 * layer is refused: `--layers api,application` used to validate no layer and report success.
 */

import { describe, it, expect } from "bun:test";
import { keepRequestedLayers, parseLayersOption } from "../../../src/commands/validate.js";

describe("parseLayersOption", () => {
  it("leaves the option out when it wasn't given", () => {
    expect(parseLayersOption(undefined)).toBeUndefined();
  });

  it("splits comma-separated names as well as space-separated ones", () => {
    expect(parseLayersOption(["api,application"])).toEqual(["api", "application"]);
    expect(parseLayersOption(["api", "data-model, testing"])).toEqual(["api", "data-model", "testing"]);
  });

  it("refuses a name that isn't a layer, naming it and the layers", () => {
    expect(() => parseLayersOption(["api", "datastore"])).toThrow(/Unknown layer: 'datastore'.*data-store/);
    expect(() => parseLayersOption(["api application"])).toThrow(/Unknown layer: 'api application'/);
  });
});

describe("keepRequestedLayers", () => {
  it("drops the layers an active changeset's projection added beyond --layers", () => {
    // The projection of a changeset that also stages motivation and testing elements.
    const projected = { layers: new Map<string, unknown>([["api", {}], ["application", {}], ["motivation", {}], ["testing", {}]]) };
    keepRequestedLayers(projected, ["api", "application"]);
    expect([...projected.layers.keys()]).toEqual(["api", "application"]);
  });

  it("keeps every layer without --layers", () => {
    const model = { layers: new Map<string, unknown>([["api", {}], ["motivation", {}]]) };
    keepRequestedLayers(model, undefined);
    keepRequestedLayers(model, []);
    expect([...model.layers.keys()]).toEqual(["api", "motivation"]);
  });
});
