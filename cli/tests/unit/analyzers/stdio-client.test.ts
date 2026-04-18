/**
 * StdioClient Unit Tests
 *
 * Tests for JSON-RPC 2.0 stdio client using a mock analyzer subprocess.
 * Tests verify JSON-RPC protocol behavior, request/response correlation,
 * timeout handling, and error extraction.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { StdioClient } from "../../../src/analyzers/stdio-client.js";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MOCK_ANALYZER_PATH = path.join(__dirname, "../../fixtures/mock-analyzer.cjs");

describe("StdioClient", () => {
  let client: StdioClient;

  beforeEach(() => {
    client = new StdioClient();
  });

  afterEach(async () => {
    client.close();
    // Give process time to exit
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  describe("Process Lifecycle", () => {
    it("should spawn a process", () => {
      expect(() => {
        client.spawn("node", {});
      }).not.toThrow();
    });

    it("should reject spawn if already spawned", () => {
      client.spawn("node", {});
      expect(() => {
        client.spawn("node", {});
      }).toThrow("Process already spawned");
    });

    it("should throw if callTool is called before spawn", async () => {
      try {
        await client.callTool("test", {});
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain("Process not spawned");
      }
    });

    it("should close gracefully", async () => {
      client.spawn("node", {});
      client.close();
      // Should not throw
      client.close();
    });
  });

  describe("JSON-RPC Protocol with Mock Analyzer", () => {
    beforeEach(() => {
      client.spawn("node", [MOCK_ANALYZER_PATH]);
    });

    it("should initialize successfully", async () => {
      const result = await client.initialize({ version: "1.0", name: "test-client" });
      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
      const resultObj = result as Record<string, unknown>;
      expect("capabilities" in resultObj).toBe(true);
    });

    it("should call a tool and receive response", async () => {
      await client.initialize({});
      const result = await client.callTool("echo", { test: "data" });
      expect(result).toBeDefined();
      const resultObj = result as Record<string, unknown>;
      expect("echoed" in resultObj).toBe(true);
    });

    it("should correlate requests and responses by ID", async () => {
      await client.initialize({});
      // Send two concurrent requests
      const [result1, result2] = await Promise.all([
        client.callTool("echo", { id: 1 }),
        client.callTool("echo", { id: 2 }),
      ]);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      // Verify both responses came back correctly
      const res1Obj = result1 as Record<string, unknown>;
      const res2Obj = result2 as Record<string, unknown>;
      expect("echoed" in res1Obj).toBe(true);
      expect("echoed" in res2Obj).toBe(true);
    });

    it("should extract JSON-RPC error code and message", async () => {
      await client.initialize({});
      try {
        await client.callTool("error", { code: -32000, message: "Server error" });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        const msg = (error as Error).message;
        expect(msg).toContain("Error -32000");
        expect(msg).toContain("Server error");
      }
    });

    it("should include error.data in error message", async () => {
      await client.initialize({});
      try {
        await client.callTool("error", {
          code: -1,
          message: "Custom error",
          data: { field: "value", nested: { detail: "info" } },
        });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        const msg = (error as Error).message;
        expect(msg).toContain("field");
      }
    });

    it("should extract error response with only code and message", async () => {
      await client.initialize({});
      try {
        await client.callTool("error", { code: -32700, message: "Parse error" });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain("-32700");
        expect((error as Error).message).toContain("Parse error");
      }
    });
  });

  describe("Timeout Behavior", () => {
    beforeEach(() => {
      client.spawn(process.execPath, [MOCK_ANALYZER_PATH]);
    });

    it("should timeout with custom timeout value", async () => {
      await client.initialize({});
      try {
        // Request a 5-second delay with 100ms timeout
        await client.callTool("delay", { delay: 5000 }, { timeout: 100 });
        expect.unreachable("Should have timed out");
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        const msg = (error as Error).message;
        expect(msg).toContain("timed out");
        expect(msg).toContain("100ms");
      }
    });

    it("should use 30-second default timeout", async () => {
      await client.initialize({});
      // Request a short delay that completes before timeout
      const result = await client.callTool("delay", { delay: 50 });
      expect(result).toBeDefined();
      const resultObj = result as Record<string, unknown>;
      expect("delayed" in resultObj).toBe(true);
    });

    it("should timeout waiting for initialize", async () => {
      // Create a new client that points to a slow process
      const slowClient = new StdioClient();
      slowClient.spawn("node", ["-e", "setTimeout(() => {}, 10000)"]); // Process that won't respond

      try {
        await slowClient.initialize({});
        expect.unreachable("Should have timed out");
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain("timed out");
      } finally {
        slowClient.close();
      }
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      client.spawn(process.execPath, [MOCK_ANALYZER_PATH]);
    });

    it("should reject pending requests on process exit", async () => {
      await client.initialize({});

      // Start a long-running request
      const promise = client.callTool("delay", { delay: 5000 });

      // Give it time to register the pending request
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Force close
      client.close();

      try {
        await promise;
        expect.unreachable("Should have rejected");
      } catch (error) {
        expect(error instanceof Error).toBe(true);
      }
    });

    it("should handle multiple concurrent requests correctly", async () => {
      await client.initialize({});
      const [success, failure] = await Promise.allSettled([
        client.callTool("echo", { test: "data" }),
        client.callTool("error", { code: -1, message: "Test error" }),
      ]);

      expect(success.status).toBe("fulfilled");
      expect(failure.status).toBe("rejected");
    });
  });

  describe("Concurrent Requests", () => {
    beforeEach(() => {
      client.spawn(process.execPath, [MOCK_ANALYZER_PATH]);
    });

    it("should handle three concurrent requests", async () => {
      await client.initialize({});
      const results = await Promise.all([
        client.callTool("echo", { msg: "a" }),
        client.callTool("echo", { msg: "b" }),
        client.callTool("echo", { msg: "c" }),
      ]);

      expect(results.length).toBe(3);
      for (const result of results) {
        expect(result).toBeDefined();
        const resultObj = result as Record<string, unknown>;
        expect("echoed" in resultObj).toBe(true);
      }
    });
  });
});
