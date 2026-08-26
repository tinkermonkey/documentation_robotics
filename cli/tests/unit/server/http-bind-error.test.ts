/**
 * Regression test for VisualizationServer.start()'s HTTP bind-error handling.
 *
 * Before the Bun -> Node runtime migration (PR #803), a bind failure surfaced
 * synchronously: Bun.serve() threw directly, which start() propagated out to
 * server-entry.ts's main() try/catch for a clean, actionable error message.
 *
 * @hono/node-server's serve() wraps Node's http.Server, which reports bind
 * failures (most realistically EADDRINUSE, e.g. from a still-running previous
 * `dr visualize` instance) asynchronously via an 'error' event instead. Without
 * waiting on that event, the failure would instead surface as an unhandled
 * 'error' event -> uncaughtException -> a full process crash with a generic
 * Node stack dump, rather than a clean rejection through the existing startup
 * error path.
 */

import { describe, it, expect, afterAll } from "bun:test";
import { Model } from "../../../src/core/model.js";
import { VisualizationServer } from "../../../src/server/server.js";
import { portAllocator } from "../../helpers/port-allocator.js";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";
import { randomUUID } from "crypto";

async function makeServer(label: string): Promise<{ server: VisualizationServer; testDir: string }> {
  const testDir = join(tmpdir(), `dr-bind-err-${label}-${randomUUID()}`);
  mkdirSync(testDir, { recursive: true });
  const model = await Model.init(
    testDir,
    {
      name: `Bind Error Test (${label})`,
      version: "0.1.0",
      description: "Model for start() EADDRINUSE regression test",
      specVersion: "0.6.0",
      created: new Date().toISOString(),
    },
    { lazyLoad: false }
  );
  return { server: new VisualizationServer(model, { authEnabled: false }), testDir };
}

describe("VisualizationServer.start() bind error handling", () => {
  const cleanup: Array<() => void> = [];

  afterAll(() => {
    for (const fn of cleanup) fn();
  });

  it("rejects cleanly with an actionable message when the port is already in use", async () => {
    const port = await portAllocator.allocatePort();

    const { server: server1, testDir: dir1 } = await makeServer("first");
    await server1.start(port);
    cleanup.push(() => {
      server1.stop();
      rmSync(dir1, { recursive: true, force: true });
    });

    const { server: server2, testDir: dir2 } = await makeServer("second");
    cleanup.push(() => rmSync(dir2, { recursive: true, force: true }));

    let caught: Error | undefined;
    try {
      await server2.start(port);
      // If we get here, start() didn't reject - fail explicitly rather than via a
      // missing assertion, and make sure we don't leak a second bound server.
      server2.stop();
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeDefined();
    expect(caught?.message).toMatch(/already in use/i);
    expect(caught?.message).toContain(String(port));

    // The first server must still be alive and unaffected by the second's failed start.
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);

    portAllocator.releasePort(port);
  });
});
