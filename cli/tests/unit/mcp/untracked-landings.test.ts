/**
 * project_status warns when a landed (committed or recorded) changeset's folder is untracked in git
 * (#1367): the landing's files go in the PR with the code, the changeset folder among them.
 */

import { describe, it, expect } from "bun:test";
import { collectUntrackedLandings } from "../../../src/mcp/tools/project-status-collectors.js";
import type { Changeset } from "../../../src/core/changeset.js";
import type { GitRunner } from "../../../src/mcp/tools/codebase-shared.js";

const changesets = [
  { id: "cs-landed", name: "landed", status: "committed", changes: [] },
  { id: "cs-record", name: "record", status: "recorded", changes: [] },
  { id: "cs-staged", name: "staged", status: "staged", changes: [] },
  { id: "cs-tracked", name: "tracked", status: "committed", changes: [] },
] as unknown as Changeset[];

const ctx = (stdout: string, ok = true) => ({
  projectRoot: "/repo",
  git: (async () => (ok ? { ok: true as const, stdout } : { ok: false as const, error: "not a repo" })) as unknown as GitRunner,
});

describe("collectUntrackedLandings", () => {
  it("names landed and recorded changeset folders git doesn't track, not staged ones", async () => {
    const out = await collectUntrackedLandings(
      ctx(
        [
          "?? documentation-robotics/changesets/cs-landed/changes.yaml",
          "?? documentation-robotics/changesets/cs-landed/metadata.yaml",
          "?? documentation-robotics/changesets/cs-record/metadata.yaml",
          "?? documentation-robotics/changesets/cs-staged/metadata.yaml",
          " M documentation-robotics/changesets/cs-tracked/metadata.yaml",
        ].join("\n")
      ),
      changesets
    );
    expect(out?.folders).toEqual([
      "documentation-robotics/changesets/cs-landed",
      "documentation-robotics/changesets/cs-record",
    ]);
    expect(out?.note).toContain("2 landed changeset folder(s) are not tracked by git");
    expect(out?.note).toContain("git add documentation-robotics");
  });

  it("says nothing when every landed folder is tracked, or git can't say", async () => {
    expect(await collectUntrackedLandings(ctx(""), changesets)).toBeNull();
    expect(await collectUntrackedLandings(ctx("", false), changesets)).toBeNull();
  });
});
