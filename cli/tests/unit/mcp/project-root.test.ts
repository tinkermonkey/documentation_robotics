/**
 * An MCP session's project (issue 1279, slice 3A): client roots choose it, DR_MCP_ROOT_PATH pins
 * it, tool calls wait until the roots have been asked for, and nothing changes the process's
 * working directory. Each session has its own root; code outside a session gets the process
 * default. (`testing.testcasesketch.mcp-root-resolution`)
 */

import { afterEach, describe, expect, it } from "bun:test";
import { pathToFileURL } from "node:url";
import type { ResolvedCheckout } from "../../../src/core/checkout-types.js";
import {
  currentProjectRoot,
  followClientRoots,
  markEnvProjectRoot,
  McpSessionRoot,
  pickProjectRoot,
  resetProjectRoot,
  rootUrisToPaths,
  runInMcpSession,
  servedRootFor,
  whenProjectRootSettled,
  type SessionCheckoutResolver,
} from "../../../src/mcp/project-root.js";

const START = "/start";
const quiet = () => {};

afterEach(() => resetProjectRoot());

function roots(...paths: string[]) {
  return async () => ({ roots: paths.map((path) => ({ uri: pathToFileURL(path).href })) });
}

function checkout(project: string, key: string, path: string): ResolvedCheckout {
  return {
    ref: { project, checkout: key },
    checkout: { key, path, branch: key, head: "abc", isMain: key === "main", state: "present", locked: false },
    modelPath: `${path}/documentation-robotics/model`,
  };
}

/** A registry with the given checkouts; `register` adds a project for any other path. */
function fakeResolver(known: ResolvedCheckout[], registered: string[] = []): SessionCheckoutResolver {
  return {
    async resolve(target, { register }) {
      const hit = known.find((c) => target === c.checkout.path || target.startsWith(c.checkout.path + "/"));
      if (hit) return hit;
      if (!register) return null;
      registered.push(target);
      const added = checkout(target.split("/").pop()!, "main", target);
      known.push(added);
      return added;
    },
  };
}

describe("rootUrisToPaths", () => {
  it("keeps file roots as paths and skips other schemes", () => {
    expect(
      rootUrisToPaths(["file:///work/app", "https://example.com/repo", "file:///work/with%20space"])
    ).toEqual(["/work/app", "/work/with space"]);
  });
});

describe("pickProjectRoot", () => {
  const hasModel = (paths: string[]) => async (path: string) => (paths.includes(path) ? path : null);

  it("prefers the first root inside a DR project", async () => {
    expect((await pickProjectRoot(["/a", "/b", "/c"], hasModel(["/b", "/c"])))?.root).toBe("/b");
  });

  it("falls back to the first root when none has a model yet", async () => {
    expect((await pickProjectRoot(["/a", "/b"], hasModel([])))?.root).toBe("/a");
  });

  it("is undefined without roots", async () => {
    expect(await pickProjectRoot([], hasModel([]))).toBeUndefined();
  });

  it("with a registry: the first root inside a registered checkout, else registers the first root", async () => {
    const feature = checkout("alpha", "feature", "/nonexistent/feature");
    const registered: string[] = [];
    const resolver = fakeResolver([feature], registered);
    const inCheckout = await pickProjectRoot(["/nonexistent/other", "/nonexistent/feature/src"], undefined, resolver);
    expect(inCheckout?.checkout?.ref).toEqual({ project: "alpha", checkout: "feature" });
    expect(registered).toEqual([]);

    const fresh = await pickProjectRoot(["/nonexistent/new-repo", "/nonexistent/second"], undefined, resolver);
    expect(registered).toEqual(["/nonexistent/new-repo"]);
    expect(fresh?.checkout?.ref).toEqual({ project: "new-repo", checkout: "main" });
    expect(fresh?.root).toBe("/nonexistent/new-repo");
  });
});

describe("servedRootFor", () => {
  it("serves the project root holding the checkout's model when the path is at or above it", () => {
    const c = checkout("alpha", "main", "/nonexistent/alpha");
    c.modelPath = "/nonexistent/alpha/sub/documentation-robotics/model";
    expect(servedRootFor("/nonexistent/alpha", c)).toBe("/nonexistent/alpha/sub");
    expect(servedRootFor("/nonexistent/alpha/sub/deeper", c)).toBe("/nonexistent/alpha/sub/deeper");
    expect(servedRootFor("/nonexistent/loose", null)).toBe("/nonexistent/loose");
  });
});

describe("followClientRoots", () => {
  it("serves the client's root and reports the change, without moving the process", async () => {
    resetProjectRoot(START);
    const cwd = process.cwd();
    const changes: string[] = [];
    await followClientRoots(roots("/nonexistent/opened"), {
      onChange: (root) => {
        changes.push(root);
      },
      log: quiet,
    });
    expect(changes).toEqual(["/nonexistent/opened"]);
    expect(currentProjectRoot()).toEqual({ root: "/nonexistent/opened", source: "client-roots" });
    expect(process.cwd()).toBe(cwd);
  });

  it("does not report a change when the root is the one already served", async () => {
    resetProjectRoot(START);
    let changed = false;
    await followClientRoots(roots(START), {
      onChange: () => {
        changed = true;
      },
      log: quiet,
    });
    expect(changed).toBe(false);
    expect(currentProjectRoot().source).toBe("client-roots");
  });

  it("leaves a launcher's DR_MCP_ROOT_PATH in place", async () => {
    resetProjectRoot(START);
    markEnvProjectRoot("/pinned");
    let asked = false;
    await followClientRoots(
      async () => {
        asked = true;
        return { roots: [{ uri: "file:///other" }] };
      },
      { log: quiet }
    );
    expect(asked).toBe(false);
    expect(currentProjectRoot()).toEqual({ root: "/pinned", source: "env" });
  });

  it("stays put when the client fails or never answers", async () => {
    resetProjectRoot(START);
    const logs: string[] = [];
    await followClientRoots(async () => Promise.reject(new Error("boom")), { log: (m) => logs.push(m) });
    await followClientRoots(() => new Promise(() => {}), { log: (m) => logs.push(m), timeoutMs: 20 });
    expect(currentProjectRoot()).toEqual({ root: START, source: "cwd" });
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain("boom");
    expect(logs[1]).toContain("no answer");
  });

  it("makes a tool call that arrives meanwhile wait for the roots", async () => {
    resetProjectRoot(START);
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    void followClientRoots(
      async () => {
        await answered;
        return { roots: [{ uri: "file:///opened" }] };
      },
      { log: quiet }
    );

    let rootSeenByTool: string | undefined;
    const toolCall = whenProjectRootSettled().then(() => {
      rootSeenByTool = currentProjectRoot().root;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rootSeenByTool).toBeUndefined();

    answer();
    await toolCall;
    expect(rootSeenByTool).toBe("/opened");
  });
});

describe("McpSessionRoot", () => {
  const alphaMain = checkout("alpha", "main", "/nonexistent/alpha");
  const alphaFeature = checkout("alpha", "feature", "/nonexistent/alpha-feature");
  const beta = checkout("beta", "main", "/nonexistent/beta");

  it("keeps two sessions in two checkouts apart, each seeing only its own", async () => {
    const resolver = fakeResolver([alphaMain, alphaFeature, beta]);
    const one = new McpSessionRoot({ fallback: START, resolver, log: quiet });
    const two = new McpSessionRoot({ fallback: START, resolver, log: quiet });
    const three = new McpSessionRoot({ fallback: START, resolver, log: quiet });
    await one.follow(roots("/nonexistent/alpha"));
    await two.follow(roots("/nonexistent/alpha-feature"));
    await three.follow(roots("/nonexistent/beta/src"));

    const seen = await Promise.all(
      [one, two, three].map((session) =>
        runInMcpSession(session, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          await whenProjectRootSettled();
          return currentProjectRoot();
        })
      )
    );
    expect(seen.map((r) => r.checkout)).toEqual([
      { project: "alpha", checkout: "main" },
      { project: "alpha", checkout: "feature" },
      { project: "beta", checkout: "main" },
    ]);
    expect(seen.map((r) => r.root)).toEqual(["/nonexistent/alpha", "/nonexistent/alpha-feature", "/nonexistent/beta/src"]);
    // Outside any session: the process default, untouched by all three.
    expect(currentProjectRoot()).toEqual({ root: process.cwd(), source: "cwd" });
  });

  it("pins DR_MCP_ROOT_PATH ahead of the client's roots, registering an unowned path", async () => {
    const registered: string[] = [];
    const resolver = fakeResolver([alphaMain], registered);
    const pinned = new McpSessionRoot({ fallback: START, resolver, log: quiet });
    await pinned.pin("/nonexistent/fresh");
    pinned.markRootsStale();
    expect(pinned.needsRoots).toBe(false);
    await pinned.follow(roots("/nonexistent/alpha"));
    expect(pinned.get()).toEqual({
      root: "/nonexistent/fresh",
      source: "env",
      checkout: { project: "fresh", checkout: "main" },
    });
    expect(registered).toEqual(["/nonexistent/fresh"]);
  });

  it("asks for roots again after the client says they changed", async () => {
    const resolver = fakeResolver([alphaMain, beta]);
    const session = new McpSessionRoot({ fallback: START, resolver, log: quiet });
    expect(session.needsRoots).toBe(false);
    session.markRootsStale();
    expect(session.needsRoots).toBe(true);
    await session.follow(roots("/nonexistent/alpha"));
    expect(session.needsRoots).toBe(false);
    session.markRootsStale();
    await session.follow(roots("/nonexistent/beta"));
    expect(session.get().checkout).toEqual({ project: "beta", checkout: "main" });
  });

  it("resolves its fallback to the checkout it is in, without registering it", async () => {
    const registered: string[] = [];
    const session = new McpSessionRoot({
      fallback: "/nonexistent/alpha",
      resolver: fakeResolver([alphaMain], registered),
      log: quiet,
    });
    await session.resolveFallback();
    expect(session.get()).toEqual({ root: "/nonexistent/alpha", source: "cwd", checkout: { project: "alpha", checkout: "main" } });
    const loose = new McpSessionRoot({ fallback: "/nonexistent/loose", resolver: fakeResolver([], registered), log: quiet });
    await loose.resolveFallback();
    expect(loose.get()).toEqual({ root: "/nonexistent/loose", source: "cwd" });
    expect(registered).toEqual([]);
  });
});
