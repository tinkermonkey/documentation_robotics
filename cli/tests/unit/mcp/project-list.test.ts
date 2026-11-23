/**
 * project_list (issue 1279): every project of the farm in use with its checkouts, paged with true
 * totals and the call for the next page.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Model } from "../../../src/core/model.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { createProjectListHandler, PROJECT_LIST_PAGE_DEFAULT, projectList } from "../../../src/mcp/tools/project-list.js";
import { centralFarm, git, type CentralFarm } from "./central-farm-fixture.js";

let farm: CentralFarm;

beforeEach(async () => {
  clearModelCache();
  farm = await centralFarm("Project List Model");
});

afterEach(async () => {
  clearModelCache();
  await farm.cleanup();
});

/** Adds `count` more git projects, each with a model, to the farm, named p-00, p-01, ... */
async function addProjects(count: number): Promise<void> {
  const registry = await farm.openRegistry(farm.farmRoot);
  for (let i = 0; i < count; i++) {
    const dir = path.join(farm.farmRoot, `p-${String(i).padStart(2, "0")}`);
    await mkdir(dir, { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    await Model.init(dir, { name: `P ${i}`, version: "0.1.0" });
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "init");
    await registry.registerProject(dir);
  }
}

describe("project_list", () => {
  it("lists every project with its checkouts and says the list is whole", async () => {
    await farm.register();
    const worktree = await farm.addWorktree("feature-a");
    const result = await projectList({ rootPath: farm.project }, { openRegistry: farm.openRegistry });

    expect(result.farm).toEqual({ root: farm.farmRoot, source: "folder" });
    expect(result.page).toEqual({ total: 1, returned: 1, offset: 0 });
    expect(result).not.toHaveProperty("more");
    const [entry] = result.projects;
    expect(entry).toMatchObject({ name: "project", repository: farm.project });
    expect(entry.checkouts.map((c) => c.key).sort()).toEqual(["feature-a", "main"]);
    expect(entry.checkouts.find((c) => c.key === "feature-a")).toMatchObject({
      path: worktree,
      branch: "branch-feature-a",
      state: "present",
      activeChangeset: null,
      stagedChangesets: 0,
    });
  });

  it("lists an empty farm as empty, with a total of 0", async () => {
    const result = await projectList({ rootPath: farm.project }, { openRegistry: farm.openRegistry });
    expect(result.projects).toEqual([]);
    expect(result.page).toEqual({ total: 0, returned: 0, offset: 0 });
  });

  it("pages with limit and offset, gives the true total, and names the next call", async () => {
    await farm.register();
    await addProjects(4); // 5 projects: p-00..p-03 and project, in name order

    const handler = createProjectListHandler({ openRegistry: farm.openRegistry });
    const first = JSON.parse(((await handler({ limit: 2, rootPath: farm.project })) as any).content[0].text);
    expect(first.projects.map((p: any) => p.name)).toEqual(["p-00", "p-01"]);
    expect(first.page).toEqual({ total: 5, returned: 2, offset: 0, nextOffset: 2 });
    expect(first.more).toBe(`3 more projects: project_list with offset: 2, limit: 2, rootPath: "${farm.project}" returns the next page.`);

    const last = await projectList({ limit: 2, offset: 4, rootPath: farm.project }, { openRegistry: farm.openRegistry });
    expect(last.projects.map((p) => p.name)).toEqual(["project"]);
    expect(last.page).toEqual({ total: 5, returned: 1, offset: 4 });
    expect(last).not.toHaveProperty("more");

    const past = await projectList({ offset: 9, rootPath: farm.project }, { openRegistry: farm.openRegistry });
    expect(past.projects).toEqual([]);
    expect(past.page).toEqual({ total: 5, returned: 0, offset: 5 });
  });

  it(`returns ${PROJECT_LIST_PAGE_DEFAULT} projects by default and says how many more there are`, async () => {
    await addProjects(PROJECT_LIST_PAGE_DEFAULT + 1);
    const result = await projectList({ rootPath: farm.project }, { openRegistry: farm.openRegistry });
    expect(result.projects).toHaveLength(PROJECT_LIST_PAGE_DEFAULT);
    expect(result.page.total).toBe(PROJECT_LIST_PAGE_DEFAULT + 1);
    expect(result.more).toStartWith(`1 more project: project_list with offset: ${PROJECT_LIST_PAGE_DEFAULT}`);
  }, 60_000);
});
