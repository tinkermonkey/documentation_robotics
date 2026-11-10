/**
 * The registry refuses arguments a tool doesn't take instead of dropping them, and suggests the
 * one probably meant (`changeset` and `changesetId` are spelled differently across tools).
 */

import { describe, it, expect } from "bun:test";
import { unknownArgumentsError } from "../../../src/mcp/tool-registry.js";

const BRIEF = ["changesetId", "sections", "rootPath"];

describe("unknownArgumentsError", () => {
  it("accepts calls that use only the tool's arguments", () => {
    expect(unknownArgumentsError("changeset_brief", BRIEF, { changesetId: "x", sections: ["gaps"] })).toBeUndefined();
    expect(unknownArgumentsError("changeset_brief", BRIEF, {})).toBeUndefined();
    expect(unknownArgumentsError("changeset_brief", BRIEF, undefined)).toBeUndefined();
  });

  it("refuses changeset for changesetId, and the other way round", () => {
    expect(unknownArgumentsError("changeset_brief", BRIEF, { changeset: "x" })?.message).toBe(
      "changeset_brief doesn't take 'changeset' (did you mean 'changesetId' for 'changeset'?). It takes: changesetId, sections, rootPath."
    );
    expect(unknownArgumentsError("codebase_extract", ["changeset", "since"], { changesetId: "x" })?.message).toContain(
      "did you mean 'changeset' for 'changesetId'"
    );
  });

  it("lists the arguments the tool takes when it has no guess", () => {
    const error = unknownArgumentsError("changeset_brief", BRIEF, { verbose: true, changesetId: "x" });
    expect(error?.message).toBe("changeset_brief doesn't take 'verbose'. It takes: changesetId, sections, rootPath.");
  });
});
