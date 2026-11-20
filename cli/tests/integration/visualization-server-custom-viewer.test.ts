/**
 * Tests for custom viewer path feature in visualization server
 *
 * Each test starts a real `dr visualize` on a port from the allocator and stops it in afterEach,
 * waiting for it to exit, whether the test passed, failed or timed out (#1236). The launcher is
 * started with --exit-with-parent, so a run that is killed outright leaves no server behind.
 *
 * REQUIRES SERIAL EXECUTION: starts a real server subprocess on a live port.
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "fs/promises";
import { join } from "path";
import { spawn, type ChildProcess } from "child_process";
import { tmpdir } from "os";
import { isProcessRunning, portAllocator, stopServerProcess } from "../helpers.ts";
import { viewerRecordPath } from "../../src/server/viewer-registry.js";

const CLI_PATH = join(import.meta.dir, "../../dist/cli.js");
const PROJECT_DIR = join(import.meta.dir, "../../../cli-validation/test-project/baseline");
const STARTUP_TIMEOUT = 20000;

interface StartedServer {
  proc: ChildProcess;
  port: number;
  output: () => string;
}

describe.serial("Visualization Server - Custom Viewer", () => {
  let scratch: string;
  let testViewerPath: string;
  let stateDir: string;
  const started: StartedServer[] = [];

  /**
   * Starts `dr visualize` on a port from the allocator and waits until it is listening there.
   * The launcher takes another port when the one it was given is taken, so "something answers
   * on the port" proves nothing: the port is read from the record this launcher wrote.
   */
  async function startServer(extraArgs: string[]): Promise<StartedServer> {
    const port = await portAllocator.allocatePort();
    let output = "";
    const proc = spawn(
      "node",
      [CLI_PATH, "visualize", ...extraArgs, "--no-browser", "--no-auth", "--exit-with-parent", "--port", String(port)],
      {
        cwd: PROJECT_DIR,
        env: { ...process.env, DR_STATE_DIR: stateDir },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    proc.stdout?.on("data", (chunk) => (output += chunk.toString()));
    proc.stderr?.on("data", (chunk) => (output += chunk.toString()));
    const server: StartedServer = { proc, port, output: () => output };
    // Registered before anything can throw, so afterEach stops it whatever happens next.
    started.push(server);

    const recordPath = viewerRecordPath(PROJECT_DIR, proc.pid!, { DR_STATE_DIR: stateDir });
    const deadline = Date.now() + STARTUP_TIMEOUT;
    let record: { port: number } | null = null;
    while (!record && Date.now() < deadline) {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        throw new Error(`dr visualize exited before it was listening (code ${proc.exitCode}):\n${output}`);
      }
      record = await readFile(recordPath, "utf8").then(JSON.parse, () => null);
      if (!record) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!record) throw new Error(`dr visualize was not listening within ${STARTUP_TIMEOUT}ms:\n${output}`);
    if (record.port !== port) {
      throw new Error(
        `dr visualize was asked for port ${port} and is listening on ${record.port}: ` +
          `port ${port} was taken, so requests to it would reach another server.\n${output}`
      );
    }
    return server;
  }

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "dr-test-custom-viewer-"));
    stateDir = join(scratch, "state");
    testViewerPath = join(scratch, "viewer");

    // Create test viewer directory
    await mkdir(join(testViewerPath, "assets"), { recursive: true });

    // Create test index.html
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

    // Create test CSS file
    await writeFile(join(testViewerPath, "assets", "style.css"), `body { background: #f0f0f0; }`);

    // Create test JS file
    await writeFile(
      join(testViewerPath, "assets", "script.js"),
      `console.log('Custom viewer loaded');`
    );
  });

  afterEach(async () => {
    // Stop every server the test started and wait for each to exit
    for (const server of started.splice(0)) {
      await stopServerProcess(server.proc);
      portAllocator.releasePort(server.port);
    }
  });

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  test("should serve custom viewer when --viewer-path is provided", async () => {
    const { port } = await startServer(["--viewer-path", testViewerPath]);

    // Fetch index.html
    const response = await fetch(`http://localhost:${port}/`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Custom Viewer Test");
    expect(html).toContain("This is a test custom viewer");

    // Verify CSS is served with correct content type
    const cssResponse = await fetch(`http://localhost:${port}/assets/style.css`);
    expect(cssResponse.status).toBe(200);
    expect(cssResponse.headers.get("content-type")).toBe("text/css");

    // Verify JS is served with correct content type
    const jsResponse = await fetch(`http://localhost:${port}/assets/script.js`);
    expect(jsResponse.status).toBe(200);
    expect(jsResponse.headers.get("content-type")).toBe("application/javascript");
  });

  test("should prevent path traversal attacks", async () => {
    const { port } = await startServer(["--viewer-path", testViewerPath]);

    // Try path traversal
    const response = await fetch(`http://localhost:${port}/../../../etc/passwd`);

    // Should return 403 or 404, not the actual file
    expect([403, 404]).toContain(response.status);
  });

  test("should serve default inline viewer when no --viewer-path is provided", async () => {
    const { port } = await startServer([]);

    // Fetch index.html
    const response = await fetch(`http://localhost:${port}/`);
    const html = await response.text();

    expect(response.status).toBe(200);
    // Should serve the bundled React viewer
    expect(html).toContain("Documentation Robotics Viewer");
    expect(html).toContain('<div id="root">');
    expect(html).toContain(".js");
  });

  test("fails clearly when the port it asked for is taken, instead of testing another server", async () => {
    const first = await startServer([]);
    const holderPort = first.port;
    // A second launcher asked for the same port moves to the next free one.
    const original = portAllocator.allocatePort.bind(portAllocator);
    portAllocator.allocatePort = async () => holderPort;
    try {
      await expect(startServer([])).rejects.toThrow(
        new RegExp(`asked for port ${holderPort} and is listening on \\d+`)
      );
    } finally {
      portAllocator.allocatePort = original;
    }
  });

  test("the launcher and its server exit when the process that started them is gone", async () => {
    // A stand-in for an interrupted test run: a parent that starts dr visualize and is then
    // killed without stopping it.
    const port = await portAllocator.allocatePort();
    const parentScript = `
      const { spawn } = require("node:child_process");
      const child = spawn("node", ${JSON.stringify([CLI_PATH, "visualize", "--no-browser", "--no-auth", "--exit-with-parent", "--port", String(port)])}, { stdio: "ignore" });
      console.log(child.pid);
      setInterval(() => {}, 1000);
    `;
    const parent = spawn("node", ["-e", parentScript], {
      cwd: PROJECT_DIR,
      env: { ...process.env, DR_STATE_DIR: stateDir },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let launcherPid = 0;
    // Not a signal-0 check alone: the orphaned launcher is handed to PID 1, and where PID 1 does
    // not reap (the release gate's container) it stays a zombie once it has exited.
    const isAlive = isProcessRunning;
    const healthy = async () => {
      try {
        return (await fetch(`http://localhost:${port}/health`)).ok;
      } catch {
        return false;
      }
    };
    const waitFor = async (check: () => boolean | Promise<boolean>, timeoutMs: number) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await check()) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    };
    try {
      launcherPid = await new Promise<number>((resolve, reject) => {
        parent.stdout?.once("data", (chunk) => resolve(Number(chunk.toString().trim())));
        parent.once("exit", () => reject(new Error("the parent exited before it started dr visualize")));
      });
      expect(await waitFor(healthy, STARTUP_TIMEOUT)).toBe(true);

      parent.kill("SIGKILL");

      expect(await waitFor(() => !isAlive(launcherPid), 15000)).toBe(true);
      expect(await waitFor(async () => !(await healthy()), 10000)).toBe(true);
    } finally {
      parent.kill("SIGKILL");
      if (launcherPid && isAlive(launcherPid)) process.kill(launcherPid, "SIGKILL");
      portAllocator.releasePort(port);
    }
  }, 60000);
});
