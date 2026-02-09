/**
 * Tests for custom viewer path feature in visualization server
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { spawn } from "child_process";
import { tmpdir } from "os";

const testPort = 19998;
const testViewerPath = join(tmpdir(), "dr-test-custom-viewer");

describe("Visualization Server - Custom Viewer", () => {
  let serverProcess: any;

  beforeAll(async () => {
    // Create test viewer directory
    await mkdir(testViewerPath, { recursive: true });
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

  afterAll(async () => {
    // Clean up test viewer directory
    await rm(testViewerPath, { recursive: true, force: true });

    // Kill server if still running
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  test("should serve custom viewer when --viewer-path is provided", async () => {
    // Start server with custom viewer path
    const drPath = join(__dirname, "../../dist/cli.js");
    serverProcess = spawn(
      "node",
      [
        drPath,
        "visualize",
        "--viewer-path",
        testViewerPath,
        "--no-browser",
        "--no-auth",
        "--port",
        String(testPort),
      ],
      {
        cwd: join(__dirname, "../../../cli-validation/test-project/baseline"),
        stdio: "pipe",
      }
    );

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Fetch index.html
    const response = await fetch(`http://localhost:${testPort}/`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Custom Viewer Test");
    expect(html).toContain("This is a test custom viewer");

    // Verify CSS is served with correct content type
    const cssResponse = await fetch(`http://localhost:${testPort}/assets/style.css`);
    expect(cssResponse.status).toBe(200);
    expect(cssResponse.headers.get("content-type")).toBe("text/css");

    // Verify JS is served with correct content type
    const jsResponse = await fetch(`http://localhost:${testPort}/assets/script.js`);
    expect(jsResponse.status).toBe(200);
    expect(jsResponse.headers.get("content-type")).toBe("application/javascript");

    // Stop server
    serverProcess.kill();
    serverProcess = null;
  });

  test("should prevent path traversal attacks", async () => {
    // Start server with custom viewer path
    const drPath = join(__dirname, "../../dist/cli.js");
    serverProcess = spawn(
      "node",
      [
        drPath,
        "visualize",
        "--viewer-path",
        testViewerPath,
        "--no-browser",
        "--no-auth",
        "--port",
        String(testPort + 1),
      ],
      {
        cwd: join(__dirname, "../../../cli-validation/test-project/baseline"),
        stdio: "pipe",
      }
    );

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Try path traversal
    const response = await fetch(`http://localhost:${testPort + 1}/../../../etc/passwd`);

    // Should return 403 or 404, not the actual file
    expect([403, 404]).toContain(response.status);

    // Stop server
    serverProcess.kill();
    serverProcess = null;
  });

  test("should serve default inline viewer when no --viewer-path is provided", async () => {
    // Start server without custom viewer path
    const drPath = join(__dirname, "../../dist/cli.js");
    serverProcess = spawn(
      "node",
      [drPath, "visualize", "--no-browser", "--no-auth", "--port", String(testPort + 2)],
      {
        cwd: join(__dirname, "../../../cli-validation/test-project/baseline"),
        stdio: "pipe",
      }
    );

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Fetch index.html
    const response = await fetch(`http://localhost:${testPort + 2}/`);
    const html = await response.text();

    expect(response.status).toBe(200);
    // Should contain default viewer elements
    expect(html).toContain("Documentation Robotics Viewer");
    expect(html).toContain("model-tree");

    // Stop server
    serverProcess.kill();
    serverProcess = null;
  });
});
