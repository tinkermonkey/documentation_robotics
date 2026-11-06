/**
 * DR_CHANGESET_ONLY parsing: the documented "true" was the only accepted value, so
 * DR_CHANGESET_ONLY=1 silently let base-model writes through (dogfood bug 1).
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import {
  CHANGESET_ONLY_ENV,
  isChangesetOnly,
  assertBaseModelWritable,
  resetChangesetOnlyWarnings,
  ChangesetOnlyError,
} from "../../../src/core/changeset-only-guard.js";

const env = (value?: string): NodeJS.ProcessEnv => (value === undefined ? {} : { [CHANGESET_ONLY_ENV]: value });

describe("isChangesetOnly", () => {
  let errorSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    resetChangesetOnlyWarnings();
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it.each(["true", "1", "yes", "on", "TRUE", "Yes", "ON", " on "])("treats %p as on", (value) => {
    expect(isChangesetOnly(env(value))).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "false", "0", "no", "off", "False", "OFF"])("treats %p as off", (value) => {
    expect(isChangesetOnly(env(value))).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("fails safe on an unrecognised value and warns once, naming it", () => {
    expect(isChangesetOnly(env("enabled"))).toBe(true);
    expect(isChangesetOnly(env("enabled"))).toBe(true);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain('"enabled"');
    expect(String(errorSpy.mock.calls[0][0])).toContain(CHANGESET_ONLY_ENV);
  });

  it("refuses base-model saves for DR_CHANGESET_ONLY=1", () => {
    expect(() => assertBaseModelWritable(env("1"))).toThrow(ChangesetOnlyError);
  });
});
