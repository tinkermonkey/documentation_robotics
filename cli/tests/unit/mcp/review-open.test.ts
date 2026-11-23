/**
 * review_open (issue 1279, design section 9): resolves the call's checkout through the project
 * registry and returns a deep link to the changeset on the farm's central process, which it gets
 * through an injected EnsureCentralServer. It spawns nothing of its own.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { changesetCreateHandler, changesetDeactivateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { createReviewOpenHandler, type ReviewOpenDeps } from "../../../src/mcp/tools/review-open.js";
import { followClientRoots, resetProjectRoot } from "../../../src/mcp/project-root.js";
import { centralFarm, fakeEnsure, fakeFind, serverRecord, type CentralFarm } from "./central-farm-fixture.js";

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

let farm: CentralFarm;
let rootPath: string;

beforeEach(async () => {
  clearModelCache();
  farm = await centralFarm("Review Open Test Model");
  rootPath = farm.project;
});

afterEach(async () => {
  clearModelCache();
  await farm.cleanup();
});

/** A handler over the test farm, with a central process that answers on port 4567 with token tok-abc. */
function handlerFor(overrides: Partial<ReviewOpenDeps> = {}) {
  const ensure = fakeEnsure({ record: serverRecord(farm.farmRoot), token: "tok-abc", started: false });
  const stops: string[] = [];
  const handler = createReviewOpenHandler({
    openRegistry: farm.openRegistry,
    findRunningServer: fakeFind(null),
    ensureCentralServer: ensure,
    stopCentralServer: async (cwd) => {
      stops.push(cwd);
    },
    cliVersion: "999.0.0",
    ...overrides,
  });
  return { handler, ensure, stops };
}

describe("review_open", () => {
  it("returns a deep link to the changeset on the central process, with the token in the fragment only", async () => {
    const created = parse(await changesetCreateHandler({ name: "export-orders", rootPath }));
    const { handler, ensure } = handlerFor();

    const result = parse(await handler({ rootPath }));
    expect(result).toMatchObject({
      project: "project",
      checkout: "main",
      changesetId: created.id,
      changesetName: "export-orders",
      port: 4567,
      started: false,
      serverCliVersion: "999.0.0",
    });
    expect(result.url).toBe(`http://127.0.0.1:4567/#/p/project/c/main/changesets/${created.id}?token=tok-abc`);
    expect(result.link).toEqual({ url: result.url, project: "project", checkout: "main", changeset: created.id });

    const url = new URL(result.url);
    expect(url.search).toBe("");
    expect(url.searchParams.has("token")).toBe(false);
    expect(url.hash).toContain("token=tok-abc");

    // The process came from EnsureCentralServer, asked from the project's folder.
    expect(ensure.calls).toEqual([{ cwd: rootPath }]);
    expect(result).not.toHaveProperty("outdated");
    expect(result).not.toHaveProperty("notice");
  });

  it("adds a repository no project owns to the farm before linking into it", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const { handler } = handlerFor();
    expect(await (await farm.openRegistry(rootPath)).resolvePath(rootPath)).toBeNull();

    parse(await handler({ rootPath }));
    expect(await readFile(path.join(farm.farmRoot, "farm.yaml"), "utf8")).toContain("project");
    expect((await (await farm.openRegistry(rootPath)).resolvePath(rootPath))?.ref).toEqual({ project: "project", checkout: "main" });
  });

  it("links a linked worktree as its own checkout", async () => {
    await farm.register();
    const worktree = await farm.addWorktree("feature-x");
    const created = parse(await changesetCreateHandler({ name: "in-worktree", rootPath: worktree }));
    const { handler, ensure } = handlerFor();

    const result = parse(await handler({ rootPath: worktree }));
    expect(result).toMatchObject({ project: "project", checkout: "feature-x", changesetId: created.id });
    expect(result.url).toStartWith(`http://127.0.0.1:4567/#/p/project/c/feature-x/changesets/${created.id}`);
    expect(ensure.calls).toEqual([{ cwd: worktree }]);
  });

  it("leaves the token out of the link when the process runs without one", async () => {
    const created = parse(await changesetCreateHandler({ name: "export-orders", rootPath }));
    const { handler } = handlerFor({
      ensureCentralServer: fakeEnsure({ record: serverRecord(farm.farmRoot), token: "", started: true }),
    });
    const result = parse(await handler({ rootPath }));
    expect(result.url).toBe(`http://127.0.0.1:4567/#/p/project/c/main/changesets/${created.id}`);
    expect(result.started).toBe(true);
  });

  it("opens a named changeset, by id or name, rather than the active one", async () => {
    const first = parse(await changesetCreateHandler({ name: "first-plan", rootPath }));
    await changesetCreateHandler({ name: "second-plan", rootPath });
    const { handler } = handlerFor();

    expect(parse(await handler({ changeset: "first-plan", rootPath }))).toMatchObject({ changesetId: first.id });
    expect(parse(await handler({ changeset: first.id, rootPath })).changesetName).toBe("first-plan");
    expect(parse(await handler({ rootPath })).changesetName).toBe("second-plan");
  });

  it("errors clearly when no changeset is named and none is active, and asks for no process", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    await changesetDeactivateHandler({ rootPath });
    const { handler, ensure } = handlerFor();

    const result = await handler({ rootPath });
    expect(result.isError).toBe(true);
    const error = parse(result);
    expect(error.error).toBe("No changeset named and none is active");
    expect(error.suggestions.join(" ")).toContain('"changeset"');
    expect(ensure.calls).toHaveLength(0);
    expect(parse(await handler({ changeset: "no-such-plan", rootPath })).category).toBe("not_found");
  });

  it("serves the project from the client's roots, not the server's cwd", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    clearModelCache();
    const serverCwd = process.cwd();
    const { handler, ensure } = handlerFor();
    resetProjectRoot(serverCwd);
    try {
      await followClientRoots(async () => ({ roots: [{ uri: pathToFileURL(rootPath).href }] }), { log: () => {} });
      const result = parse(await handler({}));
      expect(result).toMatchObject({ changesetName: "export-orders", project: "project", checkout: "main" });
      expect(ensure.calls).toEqual([{ cwd: rootPath }]);
    } finally {
      process.chdir(serverCwd);
      resetProjectRoot(serverCwd);
      clearModelCache();
    }
  });
});

describe("review_open and an older central process", () => {
  it("passes on the notice when EnsureCentralServer kept an older process", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const notice = "The DR process is older than this CLI and a tab is connected; it was kept.";
    const { handler } = handlerFor({
      ensureCentralServer: fakeEnsure({
        record: serverRecord(farm.farmRoot, { cliVersion: "0.6.0" }),
        token: "tok-abc",
        started: false,
        notice,
      }),
    });
    const result = parse(await handler({ rootPath }));
    expect(result).toMatchObject({ outdated: true, cliVersion: "999.0.0", serverCliVersion: "0.6.0", notice });
  });

  it("says the process is older, and how to replace it, when no notice came", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const { handler } = handlerFor({
      ensureCentralServer: fakeEnsure({ record: serverRecord(farm.farmRoot, { cliVersion: "0.6.0" }), token: "t", started: false }),
    });
    const result = parse(await handler({ rootPath }));
    expect(result.outdated).toBe(true);
    expect(result.notice).toContain("restart: true");
    expect(result.notice).toContain("DrBot");
  });

  it("restart: true stops the running process, then asks for one, and says what it replaced", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const running = { record: serverRecord(farm.farmRoot, { pid: 31337, cliVersion: "0.6.0" }), token: "old" };
    const order: string[] = [];
    const ensure = fakeEnsure({ record: serverRecord(farm.farmRoot, { pid: 31338 }), token: "tok-new", started: true });
    const { handler } = handlerFor({
      findRunningServer: fakeFind(running),
      stopCentralServer: async () => {
        order.push("stop");
      },
      ensureCentralServer: async (options) => {
        order.push("ensure");
        return ensure(options);
      },
    });
    const result = parse(await handler({ rootPath, restart: true }));
    expect(order).toEqual(["stop", "ensure"]);
    expect(result).toMatchObject({ started: true, replaced: { pid: 31337, cliVersion: "0.6.0" } });
    expect(result.url).toContain("token=tok-new");
  });

  it("restart: true with no process running stops nothing and starts one", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const { handler, stops, ensure } = handlerFor();
    const result = parse(await handler({ rootPath, restart: true }));
    expect(stops).toHaveLength(0);
    expect(ensure.calls).toHaveLength(1);
    expect(result).not.toHaveProperty("replaced");
  });

  it("restart: true refuses to stop the process answering the call", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const { handler, stops, ensure } = handlerFor({
      findRunningServer: fakeFind({ record: serverRecord(farm.farmRoot, { pid: process.pid }), token: "t" }),
      selfPid: process.pid,
    });
    const result = await handler({ rootPath, restart: true });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain("from inside it");
    expect(stops).toHaveLength(0);
    expect(ensure.calls).toHaveLength(0);
  });

  it("restart: true fails, and asks for no process, when the stop is refused", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const { handler, ensure } = handlerFor({
      findRunningServer: fakeFind({ record: serverRecord(farm.farmRoot, { pid: 31337 }), token: "t" }),
      stopCentralServer: async () => {
        throw new Error("pid 31337 could not be confirmed to be the DR process, so it was not signalled.");
      },
    });
    const result = await handler({ rootPath, restart: true });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain("not signalled");
    expect(ensure.calls).toHaveLength(0);
  });
});
