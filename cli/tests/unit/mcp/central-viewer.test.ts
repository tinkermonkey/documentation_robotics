/**
 * The links the tools hand out into the shared viewer (issue 1279, design section 9), and the one
 * changeset_commit's refusal carries.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { changesetLinkIfRunning } from "../../../src/mcp/tools/central-viewer.js";
import { otherWaysToLand } from "../../../src/mcp/tools/changeset-commit.js";
import { centralFarm, fakeFind, serverRecord, type CentralFarm } from "./central-farm-fixture.js";

let farm: CentralFarm;

beforeEach(async () => {
  farm = await centralFarm("Central Viewer Model");
});

afterEach(async () => {
  await farm.cleanup();
});

describe("changesetLinkIfRunning", () => {
  it("links to the changeset in this checkout when the central process runs, token in the fragment", async () => {
    await farm.register();
    const worktree = await farm.addWorktree("feature-x");
    const link = await changesetLinkIfRunning(worktree, "changeset-123", {
      openRegistry: farm.openRegistry,
      findRunningServer: fakeFind({ record: serverRecord(farm.farmRoot), token: "tok-abc" }),
      cliVersion: "999.0.0",
    });
    expect(link).toEqual({
      url: "http://127.0.0.1:4567/#/p/project/c/feature-x/changesets/changeset-123?token=tok-abc",
      project: "project",
      checkout: "feature-x",
      changeset: "changeset-123",
    });
    expect(new URL(link!.url).search).toBe("");
  });

  it("gives nothing, and starts nothing, when no central process runs or no project owns the folder", async () => {
    const deps = { openRegistry: farm.openRegistry, findRunningServer: fakeFind(null), cliVersion: "999.0.0" };
    expect(await changesetLinkIfRunning(farm.project, "changeset-123", deps)).toBeNull();
    await farm.register();
    expect(await changesetLinkIfRunning(farm.project, "changeset-123", deps)).toBeNull();
  });

  it("never throws: a farm that can't be read gives no link", async () => {
    const link = await changesetLinkIfRunning(farm.project, "x", {
      openRegistry: async () => {
        throw new Error("farm.yaml is broken");
      },
      findRunningServer: fakeFind(null),
      cliVersion: "999.0.0",
    });
    expect(link).toBeNull();
  });
});

describe("changeset_commit's refusal", () => {
  it("hands the user the link when there is one, else names review_open", () => {
    const url = "http://127.0.0.1:4567/#/p/project/c/main/changesets/cs-1?token=t";
    expect(otherWaysToLand(url)[0]).toContain(url);
    expect(otherWaysToLand(url)[0]).toContain("Apply");
    expect(otherWaysToLand(url)[0]).not.toContain("review_open");
    expect(otherWaysToLand()[0]).toContain("call review_open");
  });
});
