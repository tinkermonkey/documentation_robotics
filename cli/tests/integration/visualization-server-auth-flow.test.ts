/**
 * Integration tests for the visualization server authenticated token flow.
 *
 * Covers the full auth path: CLI spawns server with auth enabled → HTTP/WebSocket
 * requests with the correct token succeed → wrong/missing tokens are rejected.
 *
 * This is the regression suite for the bug where Bun's pipe buffering batched
 * the "running at http://localhost" and "TOKEN:xxx" stdout lines into one data
 * chunk, causing startsWith("TOKEN:") to fail, the token to be lost, the browser
 * to open without a valid token, and the server to return 403.
 *
 * Tests use the --token flag to pre-specify a known token so they don't depend
 * on stdout stream timing (consistent with the pattern in visualization-server-api.test.ts).
 *
 * REQUIRES SERIAL EXECUTION: starts a real server subprocess on a live port.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { spawnSync } from "bun";
import { portAllocator } from "../helpers.ts";

const CLI_ROOT = join(import.meta.dir, "../..");
const CLI_PATH = join(CLI_ROOT, "dist/cli.js");
const STARTUP_TIMEOUT = 20000; // ms – generous for CI

// Known token injected via --token flag so tests don't need to read stdout
const TEST_TOKEN = "test-auth-token-dr-integration";
const WRONG_TOKEN = "definitely-wrong-token-value";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function initializeTestModel(dir: string): Promise<void> {
  const result = spawnSync({
    cmd: ["node", CLI_PATH, "init", "--name", "Auth Flow Test", "--description", "Auth integration test model"],
    cwd: dir,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to init model: ${result.stderr?.toString()}`);
  }
}

/**
 * Poll /health until 200 or timeout.
 */
async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server at port ${port} did not become healthy within ${timeoutMs}ms`);
}

/**
 * Spawn the visualization server with auth enabled and a pre-specified token.
 * Waits for the health endpoint before returning.
 */
async function startAuthServer(
  cwd: string,
  port: number,
  token: string
): Promise<ReturnType<typeof Bun.spawn>> {
  const proc = Bun.spawn({
    cmd: ["bun", CLI_PATH, "visualize", "--port", String(port), "--no-browser", "--token", token],
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHealth(port, STARTUP_TIMEOUT);
  return proc;
}

// ---------------------------------------------------------------------------
// Suite – shared server
// ---------------------------------------------------------------------------

describe.serial("Visualization Server — authenticated token flow", () => {
  let testDir: string;
  let testPort: number;
  let serverProc: ReturnType<typeof Bun.spawn> | null = null;

  beforeAll(async () => {
    testDir = join("/tmp", `dr-auth-flow-${Date.now()}`);
    testPort = await portAllocator.allocatePort();
    await mkdir(testDir, { recursive: true });
    await initializeTestModel(testDir);
    serverProc = await startAuthServer(testDir, testPort, TEST_TOKEN);
  });

  afterAll(async () => {
    if (serverProc) {
      try { serverProc.kill(); } catch { /* ignore */ }
      serverProc = null;
    }
    portAllocator.releasePort(testPort);
    try { await rm(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ── Unauthenticated endpoints ──────────────────────────────────────────────

  it("serves root / with 200 — no auth required for the viewer page", async () => {
    const res = await fetch(`http://localhost:${testPort}/`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<!DOCTYPE html>");
  });

  it("serves /health with 200 — no auth required", async () => {
    const res = await fetch(`http://localhost:${testPort}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("ok");
  });

  // ── Authenticated endpoints — correct token ────────────────────────────────

  it("accepts /api/model with correct token in Authorization header → 200", async () => {
    const res = await fetch(`http://localhost:${testPort}/api/model`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toBeDefined();
  });

  it("accepts /api/model with correct token as ?token= query param → 200", async () => {
    const res = await fetch(`http://localhost:${testPort}/api/model?token=${TEST_TOKEN}`);
    expect(res.status).toBe(200);
  });

  it("accepts /api/annotations with correct token → 200", async () => {
    const res = await fetch(`http://localhost:${testPort}/api/annotations`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  // ── Authenticated endpoints — wrong / missing token ────────────────────────

  it("rejects /api/model with no token → 401", async () => {
    const res = await fetch(`http://localhost:${testPort}/api/model`);
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error).toContain("Authentication required");
  });

  it("rejects /api/model with wrong token → 403", async () => {
    const res = await fetch(`http://localhost:${testPort}/api/model`, {
      headers: { Authorization: `Bearer ${WRONG_TOKEN}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toBe("Invalid authentication token");
  });

  it("rejects /api/model with wrong ?token= query param → 403", async () => {
    const res = await fetch(`http://localhost:${testPort}/api/model?token=${WRONG_TOKEN}`);
    expect(res.status).toBe(403);
  });

  it("rejects /api/annotations with no token → 401", async () => {
    const res = await fetch(`http://localhost:${testPort}/api/annotations`);
    expect(res.status).toBe(401);
  });

  // ── WebSocket authentication ───────────────────────────────────────────────

  it("accepts WebSocket upgrade with correct token → receives model data", async () => {
    const wsUrl = `ws://localhost:${testPort}/ws?token=${encodeURIComponent(TEST_TOKEN)}`;
    const ws = new WebSocket(wsUrl);

    const message = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for WebSocket model message")),
        10000
      );

      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ type: "subscribe" }));
      });
      ws.addEventListener("message", (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === "model" || msg.type === "model-update") {
            clearTimeout(timeout);
            ws.close();
            resolve(msg);
          }
        } catch { /* wait for valid message */ }
      });
      ws.addEventListener("error", () => {
        // error fires before close; the close handler will reject with the code
      });
      ws.addEventListener("close", (event) => {
        if (event.code !== 1000 && event.code !== 1005) {
          clearTimeout(timeout);
          reject(new Error(`WebSocket closed unexpectedly: code=${event.code}`));
        }
      });
    });

    expect(message.type).toMatch(/^model/);
    expect(message.data).toBeDefined();
  });

  it("rejects WebSocket upgrade with wrong token → connection closes with error", async () => {
    const wsUrl = `ws://localhost:${testPort}/ws?token=${WRONG_TOKEN}`;
    const ws = new WebSocket(wsUrl);

    const closed = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 5000);
      ws.addEventListener("close", () => { clearTimeout(timeout); resolve(true); });
      ws.addEventListener("error", () => { /* close event follows */ });
    });

    expect(closed).toBe(true);
  });

  it("rejects WebSocket upgrade with no token → connection closes with error", async () => {
    const wsUrl = `ws://localhost:${testPort}/ws`;
    const ws = new WebSocket(wsUrl);

    const closed = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 5000);
      ws.addEventListener("close", () => { clearTimeout(timeout); resolve(true); });
      ws.addEventListener("error", () => { /* close event follows */ });
    });

    expect(closed).toBe(true);
  });
});
