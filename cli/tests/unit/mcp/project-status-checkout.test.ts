/**
 * project_status's checkout and viewer sections (issue 1279, design section 9): the farm project
 * and checkout the call resolves to, the project's other checkouts (paged), and this checkout's
 * link into the shared viewer when the central process runs. It never starts that process.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { projectStatus, projectStatusList } from "../../../src/mcp/tools/project-status.js";
import { LIST_DEFAULTS } from "../../../src/mcp/tools/project-status-collectors.js";
import type { RunningServer } from "../../../src/server/server-record.js";
import { centralFarm, fakeFind, git, serverRecord, type CentralFarm } from "./central-farm-fixture.js";

let farm: CentralFarm;

beforeEach(async () => {
  clearModelCache();
  farm = await centralFarm("Status Checkout Model");
});

afterEach(async () => {
  clearModelCache();
  await farm.cleanup();
});

/** Status options over the test farm, with the central process `running` (or none). */
function over(running: RunningServer | null = null, cliVersion = "999.0.0") {
  const lookups: string[] = [];
  const find = fakeFind(running);
  return {
    lookups,
    options: {
      central: {
        openRegistry: farm.openRegistry,
        findRunningServer: async (farmRoot: string) => {
          lookups.push(farmRoot);
          return find(farmRoot);
        },
        cliVersion,
      },
    },
  };
}

describe("project_status checkout section", () => {
  it("says a folder no project owns is not in the farm, and registers nothing", async () => {
    const s: any = await projectStatus({ rootPath: farm.project }, over().options);
    expect(s.checkout).toMatchObject({ status: "unregistered", farm: { root: farm.farmRoot, source: "folder" } });
    expect(s.checkout.reason).toContain("review_open");
    expect(s.project).not.toHaveProperty("name");
    expect(s.viewer.status).toBe("none");
    expect(await (await farm.openRegistry(farm.project)).listProjects()).toEqual([]);
  });

  it("names the project and checkout, and lists the project's other checkouts", async () => {
    await farm.register();
    const a = await farm.addWorktree("feature-a");
    const b = await farm.addWorktree("feature-b");
    const planned = (await changesetCreateHandler({ name: "plan-in-a", rootPath: a })) as any;
    const plannedId = JSON.parse(planned.content[0].text).id;

    const s: any = await projectStatus({ rootPath: farm.project }, over().options);
    expect(s.project).toMatchObject({ name: "project", checkout: "main" });
    expect(s.checkout).toMatchObject({
      status: "ok",
      project: "project",
      checkout: "main",
      path: farm.project,
      branch: "main",
      farm: { root: farm.farmRoot, source: "folder" },
    });
    expect(s.checkout.head).toBe(git(farm.project, "rev-parse", "HEAD").trim());
    expect(s.checkout).not.toHaveProperty("more");

    const others = s.checkout.otherCheckouts;
    expect(others.map((c: any) => c.key).sort()).toEqual(["feature-a", "feature-b"]);
    expect(others.find((c: any) => c.key === "feature-a")).toMatchObject({
      path: a,
      branch: "branch-feature-a",
      state: "present",
      activeChangeset: plannedId,
      stagedChangesets: 1,
    });
    expect(others.find((c: any) => c.key === "feature-b")).toMatchObject({
      path: b,
      activeChangeset: null,
      stagedChangesets: 0,
    });

    // From a worktree, main is one of the others.
    const fromA: any = await projectStatus({ rootPath: a }, over().options);
    expect(fromA.checkout).toMatchObject({ project: "project", checkout: "feature-a" });
    expect(fromA.checkout.otherCheckouts.map((c: any) => c.key).sort()).toEqual(["feature-b", "main"]);
  });

  it("shortens a long list of other checkouts, with its true count and the call for the rest", async () => {
    await farm.register();
    const count = LIST_DEFAULTS.otherCheckouts + 2;
    for (let i = 0; i < count; i++) await farm.addWorktree(`wt-${String(i).padStart(2, "0")}`);

    const s: any = await projectStatus({ rootPath: farm.project }, over().options);
    expect(s.checkout.otherCheckouts).toHaveLength(LIST_DEFAULTS.otherCheckouts);
    expect(s.checkout.pages.otherCheckouts).toEqual({
      total: count,
      returned: LIST_DEFAULTS.otherCheckouts,
      offset: 0,
      nextOffset: LIST_DEFAULTS.otherCheckouts,
    });
    expect(s.checkout.more).toContain(`otherCheckouts shows ${LIST_DEFAULTS.otherCheckouts} of ${count}`);
    expect(s.checkout.more).toContain(`list: "otherCheckouts", offset: ${LIST_DEFAULTS.otherCheckouts}`);

    const rest = await projectStatusList(
      { rootPath: farm.project, list: "otherCheckouts", offset: LIST_DEFAULTS.otherCheckouts },
      over().options
    );
    expect(rest.items).toHaveLength(2);
    expect(rest.page).toEqual({ total: count, returned: 2, offset: LIST_DEFAULTS.otherCheckouts });
    expect(rest).not.toHaveProperty("more");

    const first = await projectStatusList({ rootPath: farm.project, list: "otherCheckouts", limit: 3 }, over().options);
    expect(first.page).toEqual({ total: count, returned: 3, offset: 0, nextOffset: 3 });
    expect(first.more).toContain(`${count - 3} more: project_status with list: "otherCheckouts", offset: 3, limit: 3`);
  });
});

describe("project_status viewer section", () => {
  it("says no central process runs, from the record alone, and starts none", async () => {
    await farm.register();
    const { options, lookups } = over(null);
    const s: any = await projectStatus({ rootPath: farm.project }, options);
    expect(s.viewer.status).toBe("none");
    expect(s.viewer.note).toContain("review_open starts it");
    expect(lookups).toEqual([farm.farmRoot]);
  });

  it("gives this checkout's link on the running central process, with the token in the fragment only", async () => {
    await farm.register();
    const worktree = await farm.addWorktree("feature-x");
    const record = serverRecord(farm.farmRoot, { pid: 4321, port: 4567, cliVersion: "999.0.0" });

    const s: any = await projectStatus({ rootPath: worktree }, over({ record, token: "tok-abc" }).options);
    expect(s.viewer).toEqual({
      status: "running",
      url: "http://127.0.0.1:4567/#/p/project/c/feature-x/?token=tok-abc",
      project: "project",
      checkout: "feature-x",
      port: 4567,
      pid: 4321,
      startedAt: record.startedAt,
      cliVersion: "999.0.0",
      outdated: false,
    });
    const url = new URL(s.viewer.url);
    expect(url.search).toBe("");
    expect(url.hash).toContain("token=tok-abc");
  });

  it("says when the central process is older than this CLI, and how to replace it", async () => {
    await farm.register();
    const record = serverRecord(farm.farmRoot, { cliVersion: "0.6.0" });
    const s: any = await projectStatus({ rootPath: farm.project }, over({ record, token: null }, "999.0.0").options);
    expect(s.viewer).toMatchObject({ status: "running", outdated: true, cliVersion: "0.6.0" });
    expect(s.viewer.url).toBe("http://127.0.0.1:4567/#/p/project/c/main/");
    expect(s.viewer.note).toContain("restart: true");
  });
});
