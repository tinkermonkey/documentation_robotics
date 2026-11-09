/**
 * The MCP server's default project: client roots move it, DR_MCP_ROOT_PATH pins it, and tool
 * calls wait until the roots have been asked for.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { pathToFileURL } from "node:url";
import {
  currentProjectRoot,
  followClientRoots,
  markEnvProjectRoot,
  pickProjectRoot,
  resetProjectRoot,
  rootUrisToPaths,
  whenProjectRootSettled,
} from "../../../src/mcp/project-root.js";

const START = "/start";
const quiet = () => {};

afterEach(() => resetProjectRoot());

function roots(...paths: string[]) {
  return async () => ({ roots: paths.map((path) => ({ uri: pathToFileURL(path).href })) });
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
    expect(await pickProjectRoot(["/a", "/b", "/c"], hasModel(["/b", "/c"]))).toBe("/b");
  });

  it("falls back to the first root when none has a model yet", async () => {
    expect(await pickProjectRoot(["/a", "/b"], hasModel([]))).toBe("/a");
  });

  it("is undefined without roots", async () => {
    expect(await pickProjectRoot([], hasModel([]))).toBeUndefined();
  });
});

describe("followClientRoots", () => {
  it("moves the server to the client's root and reports the change", async () => {
    resetProjectRoot(START);
    const moves: string[] = [];
    const changes: string[] = [];
    await followClientRoots(roots("/nonexistent/opened"), {
      chdir: (path) => moves.push(path),
      onChange: (root) => {
        changes.push(root);
      },
      log: quiet,
    });
    expect(moves).toEqual(["/nonexistent/opened"]);
    expect(changes).toEqual(["/nonexistent/opened"]);
    expect(currentProjectRoot()).toEqual({ root: "/nonexistent/opened", source: "client-roots" });
  });

  it("does not move or reload when the root is where the server already is", async () => {
    resetProjectRoot(START);
    const moves: string[] = [];
    let changed = false;
    await followClientRoots(roots(START), {
      chdir: (path) => moves.push(path),
      onChange: () => {
        changed = true;
      },
      log: quiet,
    });
    expect(moves).toEqual([]);
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
      { chdir: () => {}, log: quiet }
    );
    expect(asked).toBe(false);
    expect(currentProjectRoot()).toEqual({ root: "/pinned", source: "env" });
  });

  it("stays put when the client fails or never answers", async () => {
    resetProjectRoot(START);
    const logs: string[] = [];
    await followClientRoots(async () => Promise.reject(new Error("boom")), {
      chdir: () => {},
      log: (m) => logs.push(m),
    });
    await followClientRoots(() => new Promise(() => {}), {
      chdir: () => {},
      log: (m) => logs.push(m),
      timeoutMs: 20,
    });
    expect(currentProjectRoot()).toEqual({ root: START, source: "cwd" });
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain("boom");
    expect(logs[1]).toContain("no answer");
  });

  it("stays put when the chosen root can't be entered", async () => {
    resetProjectRoot(START);
    const logs: string[] = [];
    await followClientRoots(roots("/gone"), {
      chdir: () => {
        throw new Error("ENOENT");
      },
      log: (m) => logs.push(m),
    });
    expect(currentProjectRoot()).toEqual({ root: START, source: "cwd" });
    expect(logs[0]).toContain("/gone");
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
      { chdir: () => {}, log: quiet }
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
