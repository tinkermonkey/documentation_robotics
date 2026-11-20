/**
 * A process the viewer's chat started never writes the base model: DR_CHAT_MODE alone implies
 * changeset-only, whatever DR_CHANGESET_ONLY says (second review of PR 1267, finding 2).
 */

import { describe, it, expect } from "bun:test";
import { assertBaseModelWritable, isChangesetOnly } from "../../../src/core/changeset-only-guard.js";

describe("isChangesetOnly with a chat mode", () => {
  it("is on in either chat mode, even when DR_CHANGESET_ONLY says off", () => {
    for (const mode of ["changesets", "read-safe", "anything"]) {
      expect(isChangesetOnly({ DR_CHAT_MODE: mode })).toBe(true);
      expect(isChangesetOnly({ DR_CHAT_MODE: mode, DR_CHANGESET_ONLY: "false" })).toBe(true);
      expect(() => assertBaseModelWritable({ DR_CHAT_MODE: mode })).toThrow(/only change the model through a changeset/);
    }
  });

  it("is unchanged outside a chat", () => {
    expect(isChangesetOnly({})).toBe(false);
    expect(isChangesetOnly({ DR_CHAT_MODE: "  " })).toBe(false);
    expect(isChangesetOnly({ DR_CHANGESET_ONLY: "true" })).toBe(true);
  });
});
