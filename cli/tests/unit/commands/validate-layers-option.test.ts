/**
 * `dr validate --layers` takes layer names separated by spaces or commas. A name that isn't a
 * layer is refused: `--layers api,application` used to validate no layer and report success.
 */

import { describe, it, expect } from "bun:test";
import { parseLayersOption } from "../../../src/commands/validate.js";

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
