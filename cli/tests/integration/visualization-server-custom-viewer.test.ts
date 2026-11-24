/**
 * `dr visualize --viewer-path` on the central process (issue 1279, slice 4A).
 *
 * --viewer-path is a start-only option: it is passed to `dr serve` when `dr visualize` starts the
 * farm's central process, and a notice says it was not applied when the process already runs.
 * Each test makes its own scratch farm and stops the process it started (afterEach), whether the
 * test passed, failed or timed out.
 *
 * REQUIRES SERIAL EXECUTION: starts a real process on a live port.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { portAllocator } from "../helpers.ts";
import { CLI_PATH, makeVisualizeFarm, type VisualizeFarm } from "../helpers/visualize-farm.ts";

describe.skipIf(!existsSync(CLI_PATH)).serial("dr visualize --viewer-path", () => {
  let scratch: string;
  let testViewerPath: string;
  const farms: VisualizeFarm[] = [];
  const ports: number[] = [];

  /** A scratch farm with one project, and a port from the allocator for its process. */
  async function farmAndPort(): Promise<{ farm: VisualizeFarm; port: number }> {
    const farm = await makeVisualizeFarm(["alpha"]);
    farms.push(farm);
    const port = await portAllocator.allocatePort();
    ports.push(port);
    return { farm, port };
  }

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "dr-test-custom-viewer-"));
    testViewerPath = join(scratch, "viewer");
    await mkdir(join(testViewerPath, "assets"), { recursive: true });
    await writeFile(
      join(testViewerPath, "index.html"),
      `<!DOCTYPE html>
<html>
<head>
  <title>Test Custom Viewer</title>
  <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
  <h1>Custom Viewer Test</h1>
  <p>This is a test custom viewer</p>
  <script src="/assets/script.js"></script>
</body>
</html>`
    );
    await writeFile(join(testViewerPath, "assets", "style.css"), `body { background: #f0f0f0; }`);
    await writeFile(join(testViewerPath, "assets", "script.js"), `console.log('Custom viewer loaded');`);
  });

  afterEach(async () => {
    for (const farm of farms.splice(0)) await farm.cleanup();
    for (const port of ports.splice(0)) portAllocator.releasePort(port);
  });

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  test("serves the custom viewer when it starts the process with --viewer-path", async () => {
    const { farm, port } = await farmAndPort();
    const started = farm.visualize(farm.projects.alpha, ["--port", String(port), "--viewer-path", testViewerPath]);
    expect(started.started).toBe(true);

    const response = await fetch(`http://127.0.0.1:${started.port}/`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("Custom Viewer Test");

    const css = await fetch(`http://127.0.0.1:${started.port}/assets/style.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toBe("text/css");
    const js = await fetch(`http://127.0.0.1:${started.port}/assets/script.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toBe("application/javascript");
  });

  test("resolves a relative --viewer-path from where dr visualize runs", async () => {
    const { farm, port } = await farmAndPort();
    const run = farm.dr(
      ["visualize", farm.projects.alpha, "--no-browser", "--json", "--port", String(port), "--viewer-path", "viewer"],
      scratch
    );
    expect(run.status).toBe(0);
    const started = JSON.parse(run.stdout) as { port: number };
    expect(await (await fetch(`http://127.0.0.1:${started.port}/`)).text()).toContain("Custom Viewer Test");
  });

  test("prevents path traversal", async () => {
    const { farm, port } = await farmAndPort();
    const started = farm.visualize(farm.projects.alpha, ["--port", String(port), "--viewer-path", testViewerPath]);
    const response = await fetch(`http://127.0.0.1:${started.port}/../../../etc/passwd`);
    expect([403, 404]).toContain(response.status);
  });

  test("serves the bundled viewer without --viewer-path", async () => {
    const { farm, port } = await farmAndPort();
    const started = farm.visualize(farm.projects.alpha, ["--port", String(port)]);
    const html = await (await fetch(`http://127.0.0.1:${started.port}/`)).text();
    expect(html).toContain("Documentation Robotics Viewer");
    expect(html).toContain('<div id="root">');
  });

  test("says --viewer-path was not applied when the process already runs, and keeps serving its viewer", async () => {
    const { farm, port } = await farmAndPort();
    const first = farm.visualize(farm.projects.alpha, ["--port", String(port)]);
    const second = farm.visualize(farm.projects.alpha, ["--viewer-path", testViewerPath]);
    expect(second.started).toBe(false);
    expect(second.pid).toBe(first.pid);
    expect(second.notApplied).toEqual(["--viewer-path"]);
    const html = await (await fetch(`http://127.0.0.1:${first.port}/`)).text();
    expect(html).not.toContain("Custom Viewer Test");

    const text = farm.dr(["visualize", "--no-browser", "--viewer-path", testViewerPath], farm.projects.alpha);
    expect(text.stdout).toContain("Not applied (the DR process was already running): --viewer-path.");
  });
});
