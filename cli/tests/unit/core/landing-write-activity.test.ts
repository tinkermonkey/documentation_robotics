/**
 * `dr changeset commit` and `dr changeset apply` say, before landing, when there is evidence that
 * something is still writing into the changeset (#1437, review of PR 1455 finding 6).
 */

import { describe, it, expect, spyOn } from "bun:test";
import { landsOverOverlaps } from "../../../src/commands/changeset.js";
import { Changeset } from "../../../src/core/changeset.js";

function changeset(): Changeset {
  const now = new Date().toISOString();
  return new Changeset({ id: "c1", name: "wire-tests", created: now, modified: now, status: "staged", baseSnapshot: "", changes: [] });
}

const noDrift = async () => ({ isDrifted: false, baseSnapshotId: "a", currentSnapshotId: "a", warnings: [] });

describe("the CLI landing check and write activity (#1437)", () => {
  it("prints the evidence before landing, and nothing without it", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      const writing = { detectDrift: noDrift, writeActivityWarning: async () => "Something is writing into 'wire-tests' now. Let it finish." };
      expect(await landsOverOverlaps(writing as any, changeset(), { interactive: false })).toBe(true);
      expect(log.mock.calls.some((call) => String(call[0]).includes("Something is writing into 'wire-tests' now"))).toBe(true);

      log.mockClear();
      const quiet = { detectDrift: noDrift, writeActivityWarning: async () => undefined };
      expect(await landsOverOverlaps(quiet as any, changeset(), { interactive: false })).toBe(true);
      expect(log.mock.calls.some((call) => String(call[0]).includes("writing into"))).toBe(false);
    } finally {
      log.mockRestore();
    }
  });
});
