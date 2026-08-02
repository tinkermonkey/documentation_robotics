/**
 * Unit tests for the MCP chat tool handlers — chat_status and chat_launch.
 *
 * `detectAvailableClients()` shells out to `which claude` / `copilot
 * --version`, which are not guaranteed to be installed wherever these tests
 * run. Each scenario mocks `../../../src/coding-agents/chat-utils.js` via
 * `bun:test`'s `mock.module()` (same pattern as
 * `tests/unit/audit/ai/claude-invoker.test.ts`) and re-imports the handler
 * fresh so it picks up the mocked module.
 */

import { describe, it, expect, mock } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

async function withProject(fn: (rootPath: string) => Promise<void>): Promise<void> {
  const rootPath = join(
    tmpdir(),
    `dr-mcp-chat-tools-unit-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "MCP Chat Tools Unit Test Model", version: "0.1.0" });

  try {
    await fn(rootPath);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
}

function fakeClient(name: string, response: string) {
  return {
    getClientName: () => name,
    isAvailable: async () => true,
    sendMessage: async (_message: string, _options?: unknown) => response,
  };
}

describe("MCP chat tools", () => {
  describe("chat_status", () => {
    it("reports unavailable when no chat client is installed", async () => {
      mock.module("../../../src/coding-agents/chat-utils.js", () => ({
        detectAvailableClients: async () => [],
        selectChatClient: () => undefined,
      }));
      const { chatStatusHandler } = await import("../../../src/mcp/tools/chat-status.js");

      const result = await chatStatusHandler({});
      const data = parse(result);

      expect(data.sdk_available).toBe(false);
      expect(data.available).toEqual([]);
      expect(data.selected).toBeNull();
      expect(data.error_message).toContain("No chat client available");
    });

    it("reports installed clients and the selected default", async () => {
      const claude = fakeClient("Claude Code", "");
      const copilot = fakeClient("GitHub Copilot", "");
      mock.module("../../../src/coding-agents/chat-utils.js", () => ({
        detectAvailableClients: async () => [claude, copilot],
        selectChatClient: (clients: any[]) => clients[0],
      }));
      const { chatStatusHandler } = await import("../../../src/mcp/tools/chat-status.js");

      const result = await chatStatusHandler({});
      const data = parse(result);

      expect(data.sdk_available).toBe(true);
      expect(data.available).toEqual(["Claude Code", "GitHub Copilot"]);
      expect(data.selected).toBe("Claude Code");
      expect(data.error_message).toBeNull();
    });
  });

  describe("chat_launch", () => {
    it("returns a clear not-available result when no client is installed", async () => {
      mock.module("../../../src/coding-agents/chat-utils.js", () => ({
        detectAvailableClients: async () => [],
        selectChatClient: () => undefined,
      }));
      const { chatLaunchHandler } = await import("../../../src/mcp/tools/chat-launch.js");

      await withProject(async (rootPath) => {
        const result = await chatLaunchHandler({ prompt: "hello", rootPath });
        expect(result.isError).toBeFalsy();
        const data = parse(result);
        expect(data.status).toBe("unavailable");
        expect(data.message).toContain("No AI coding agent is installed");
      });
    });

    it("returns a not-available result when the requested client isn't installed", async () => {
      const copilot = fakeClient("GitHub Copilot", "");
      mock.module("../../../src/coding-agents/chat-utils.js", () => ({
        detectAvailableClients: async () => [copilot],
        selectChatClient: (clients: any[]) => clients[0],
      }));
      const { chatLaunchHandler } = await import("../../../src/mcp/tools/chat-launch.js");

      await withProject(async (rootPath) => {
        const result = await chatLaunchHandler({ prompt: "hello", client: "Claude Code", rootPath });
        expect(result.isError).toBeFalsy();
        const data = parse(result);
        expect(data.status).toBe("unavailable");
        expect(data.message).toContain("Claude Code");
        expect(data.message).toContain("GitHub Copilot");
      });
    });

    it("launches the selected client and returns its full response", async () => {
      const claude = fakeClient("Claude Code", "The architecture looks good.");
      let capturedOptions: any;
      claude.sendMessage = async (_message: string, options?: any) => {
        capturedOptions = options;
        return "The architecture looks good.";
      };
      mock.module("../../../src/coding-agents/chat-utils.js", () => ({
        detectAvailableClients: async () => [claude],
        selectChatClient: (clients: any[]) => clients[0],
      }));
      const { chatLaunchHandler } = await import("../../../src/mcp/tools/chat-launch.js");

      await withProject(async (rootPath) => {
        const result = await chatLaunchHandler({ prompt: "Describe the model", rootPath });
        const data = parse(result);

        expect(data.status).toBe("ok");
        expect(data.client).toBe("Claude Code");
        expect(data.response).toBe("The architecture looks good.");
        expect(capturedOptions.workingDirectory).toBe(rootPath);
        expect(capturedOptions.agent).toBe("dr-architect");
        expect(capturedOptions.outputStream).toBeNull();
      });
    });

    it("selects the explicitly requested client when multiple are available", async () => {
      const claude = fakeClient("Claude Code", "claude response");
      const copilot = fakeClient("GitHub Copilot", "copilot response");
      mock.module("../../../src/coding-agents/chat-utils.js", () => ({
        detectAvailableClients: async () => [claude, copilot],
        selectChatClient: (clients: any[]) => clients[0],
      }));
      const { chatLaunchHandler } = await import("../../../src/mcp/tools/chat-launch.js");

      await withProject(async (rootPath) => {
        const result = await chatLaunchHandler({
          prompt: "hello",
          client: "GitHub Copilot",
          rootPath,
        });
        const data = parse(result);
        expect(data.client).toBe("GitHub Copilot");
        expect(data.response).toBe("copilot response");
      });
    });
  });
});
