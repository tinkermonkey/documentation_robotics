// Integration tests for read-safe permissions in Claude Code launch paths
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ClaudeCodeClient } from "../../src/coding-agents/claude-code-client.js";
import { ChatOptions } from "../../src/coding-agents/base-chat-client.js";
import {
  CHANGESET_ONLY_ENV,
  formatForClaudeCode,
  formatForClaudeCodeWithChangesets,
} from "../../src/coding-agents/default-permissions.js";
import { startTestFarmServer, type TestFarmServer, type TestFarmServerOptions } from "../helpers/test-farm-server.js";
import { Model } from "../../src/core/model.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";

describe("Read-Safe Permissions in Claude Code Launch Paths", () => {
  let workdir: any;
  let testModel: Model;
  const farms: TestFarmServer[] = [];

  /** A central server whose one project is the test workdir (the model is already on disk). */
  async function startServer(server: TestFarmServerOptions["server"]): Promise<TestFarmServer> {
    const t = await startTestFarmServer(workdir.path, { server });
    farms.push(t);
    return t;
  }

  beforeEach(async () => {
    workdir = await createTestWorkdir();
    testModel = await Model.load(workdir.path);
    expect(testModel).toBeDefined();
  });

  afterEach(async () => {
    for (const t of farms.splice(0)) await t.stop();
    await workdir.cleanup();
  });

  describe("ClaudeCodeClient (dr chat)", () => {
    let client: ClaudeCodeClient;

    beforeEach(() => {
      client = new ClaudeCodeClient();
    });

    describe("Default mode permission handling", () => {
      it("should include --allowedTools in process args when withDanger is false", async () => {
        const options: ChatOptions = {
          withDanger: false,
          workingDirectory: workdir.path,
        };

        // Access the private method via type casting for testing
        const args = (client as any).getProcessArgs(options, true);

        expect(args).toContain("--allowedTools");
        const allowedToolsIndex = args.indexOf("--allowedTools");
        expect(allowedToolsIndex).toBeGreaterThanOrEqual(0);
        expect(args[allowedToolsIndex + 1]).toBeDefined();

        // Verify the format matches the expected allowlist
        const allowedTools = args[allowedToolsIndex + 1];
        expect(allowedTools).toEqual(formatForClaudeCode());
      });

      it("should include read-safe permissions in allowlist", async () => {
        const options: ChatOptions = {
          withDanger: false,
          workingDirectory: workdir.path,
        };

        const args = (client as any).getProcessArgs(options, true);
        const allowedToolsIndex = args.indexOf("--allowedTools");
        const allowedTools = args[allowedToolsIndex + 1];

        // Verify it contains all read-safe tool permissions
        expect(allowedTools).toContain("Bash(dr show:*)");
        expect(allowedTools).toContain("Read(");
        expect(allowedTools).toContain("Read(documentation-robotics)");
        expect(allowedTools).toContain("Read(.dr)");
      });

      it("should NOT include write/edit/delete tools in allowlist", async () => {
        const options: ChatOptions = {
          withDanger: false,
          workingDirectory: workdir.path,
        };

        const args = (client as any).getProcessArgs(options, true);
        const allowedToolsIndex = args.indexOf("--allowedTools");
        const allowedTools = args[allowedToolsIndex + 1];

        // Verify write tools are NOT included
        expect(allowedTools).not.toContain("Edit");
        expect(allowedTools).not.toContain("Write");
        expect(allowedTools).not.toContain("Delete");
      });
    });

    describe("Danger mode handling (--with-danger)", () => {
      it("should use --dangerously-skip-permissions when withDanger is true", async () => {
        const options: ChatOptions = {
          withDanger: true,
          workingDirectory: workdir.path,
        };

        const args = (client as any).getProcessArgs(options, true);

        expect(args).toContain("--dangerously-skip-permissions");
      });

      it("should NOT include --allowedTools when withDanger is true", async () => {
        const options: ChatOptions = {
          withDanger: true,
          workingDirectory: workdir.path,
        };

        const args = (client as any).getProcessArgs(options, true);

        expect(args).not.toContain("--allowedTools");
      });
    });

    describe("Fallback when withDanger is undefined", () => {
      it("should default to read-safe allowlist when withDanger is undefined", async () => {
        const options: ChatOptions = {
          workingDirectory: workdir.path,
        };

        const args = (client as any).getProcessArgs(options, true);

        // Should include --allowedTools because withDanger defaults to false
        expect(args).toContain("--allowedTools");
        expect(args).not.toContain("--dangerously-skip-permissions");
      });
    });

    describe("First message vs subsequent messages", () => {
      it("should include --allowedTools for first message in default mode", async () => {
        const sessionId = "test-session-123";
        const options: ChatOptions = {
          sessionId,
          withDanger: false,
          workingDirectory: workdir.path,
        };

        const args = (client as any).getProcessArgs(options, true);

        expect(args).toContain("--allowedTools");
        expect(args).toContain("--session-id");
      });

      it("should include --allowedTools for subsequent messages in default mode", async () => {
        const sessionId = "test-session-123";
        const options: ChatOptions = {
          sessionId,
          withDanger: false,
          workingDirectory: workdir.path,
        };

        const args = (client as any).getProcessArgs(options, false);

        expect(args).toContain("--allowedTools");
        expect(args).toContain("--resume");
      });
    });
  });

  describe("VisualizationServer (dr visualize)", () => {
    let t: TestFarmServer;
    let server: any;

    beforeEach(async () => {
      t = await startServer({ withDanger: false });
      server = t.server;
    });

    describe("Default mode permission handling", () => {
      it("should include --allowedTools in launch args when withDanger is false", async () => {
        // Call the actual buildClaudeChatArgs method via type casting for testing
        const args = (server as any).drBot.buildClaudeChatArgs();

        expect(args).toContain("--allowedTools");
        const allowedToolsIndex = args.indexOf("--allowedTools");
        expect(args[allowedToolsIndex + 1]).toBeDefined();
        expect(args[allowedToolsIndex + 1]).toEqual(formatForClaudeCode());
      });

      it("should NOT include --dangerously-skip-permissions in default mode", async () => {
        // Call the actual buildClaudeChatArgs method via type casting for testing
        const args = (server as any).drBot.buildClaudeChatArgs();

        expect(args).not.toContain("--dangerously-skip-permissions");
      });
    });

    describe("Danger mode handling", () => {
      it("should use --dangerously-skip-permissions when withDanger is true", async () => {
        const dangerServer = (await startServer({ withDanger: true })).server;

        // Call the actual buildClaudeChatArgs method on the danger server
        const args = (dangerServer as any).drBot.buildClaudeChatArgs();

        expect(args).toContain("--dangerously-skip-permissions");
        expect(args).not.toContain("--allowedTools");
      });
    });

    describe("Changeset mode handling (--with-changesets)", () => {
      it("should pass the changeset allowlist and set DR_CHANGESET_ONLY for the agent", async () => {
        const changesetFarm = await startServer({ withChangesets: true });
        const changesetServer = changesetFarm.server;

        const args = (changesetServer as any).drBot.buildClaudeChatArgs();
        const allowlist = args[args.indexOf("--allowedTools") + 1];
        expect(allowlist).toBe(formatForClaudeCodeWithChangesets());
        expect(args).not.toContain("--dangerously-skip-permissions");

        const env = (changesetServer as any).drBot.buildChatEnv(await changesetFarm.context());
        expect(env[CHANGESET_ONLY_ENV]).toBe("true");
      });

      it("should not set DR_CHANGESET_ONLY in default mode", async () => {
        const env = (server as any).drBot.buildChatEnv(await t.context());
        expect(env[CHANGESET_ONLY_ENV]).toBeUndefined();
      });

      it("should let danger mode win over changeset mode", async () => {
        const bothFarm = await startServer({ withDanger: true, withChangesets: true });
        const both = bothFarm.server;

        expect((both as any).drBot.buildClaudeChatArgs()).toContain("--dangerously-skip-permissions");
        expect((both as any).drBot.buildChatEnv(await bothFarm.context())[CHANGESET_ONLY_ENV]).toBeUndefined();
      });
    });
  });

  describe("Acceptance Criteria Verification", () => {
    describe("dr chat default mode can read without prompts", () => {
      it("should include Bash tool for dr CLI execution", async () => {
        const client = new ClaudeCodeClient();
        const options: ChatOptions = { withDanger: false };

        const args = (client as any).getProcessArgs(options, true);
        const allowedTools = args[args.indexOf("--allowedTools") + 1];

        // Should allow running dr CLI
        expect(allowedTools).toContain("Bash(dr show:*)");
      });

      it("should include Read tool for codebase access", async () => {
        const client = new ClaudeCodeClient();
        const options: ChatOptions = { withDanger: false };

        const args = (client as any).getProcessArgs(options, true);
        const allowedTools = args[args.indexOf("--allowedTools") + 1];

        // Should allow reading the codebase
        expect(allowedTools).toContain("Read(.)");
      });

      it("should include Read tool for documentation-robotics folder", async () => {
        const client = new ClaudeCodeClient();
        const options: ChatOptions = { withDanger: false };

        const args = (client as any).getProcessArgs(options, true);
        const allowedTools = args[args.indexOf("--allowedTools") + 1];

        // Should allow reading documentation-robotics
        expect(allowedTools).toContain("Read(documentation-robotics)");
      });

      it("should include Read tool for .dr folder", async () => {
        const client = new ClaudeCodeClient();
        const options: ChatOptions = { withDanger: false };

        const args = (client as any).getProcessArgs(options, true);
        const allowedTools = args[args.indexOf("--allowedTools") + 1];

        // Should allow reading .dr folder
        expect(allowedTools).toContain("Read(.dr)");
      });
    });

    describe("dr visualize default mode exhibits same read behavior", () => {
      it("should include all four read-safe capabilities", async () => {
        const allowedTools = formatForClaudeCode();

        expect(allowedTools).toContain("Bash(dr show:*)");
        expect(allowedTools).toContain("Read(.");
        expect(allowedTools).toContain("Read(documentation-robotics)");
        expect(allowedTools).toContain("Read(.dr)");
      });
    });

    describe("Default mode cannot write/edit/delete files", () => {
      it("should NOT include Edit tool", async () => {
        const allowedTools = formatForClaudeCode();
        expect(allowedTools).not.toContain("Edit");
      });

      it("should NOT include Write tool", async () => {
        const allowedTools = formatForClaudeCode();
        expect(allowedTools).not.toContain("Write");
      });

      it("should NOT include Delete tool", async () => {
        const allowedTools = formatForClaudeCode();
        expect(allowedTools).not.toContain("Delete");
      });

      it("should not include dangerous Bash commands", async () => {
        const allowedTools = formatForClaudeCode();
        // Bash is scoped to "dr *" only
        expect(allowedTools).toContain("Bash(dr show:*)");
      });
    });

    describe("--with-danger behavior unchanged in both paths", () => {
      it("should still use --dangerously-skip-permissions in claude-code-client", async () => {
        const client = new ClaudeCodeClient();
        const options: ChatOptions = { withDanger: true };

        const args = (client as any).getProcessArgs(options, true);

        expect(args).toContain("--dangerously-skip-permissions");
        expect(args).not.toContain("--allowedTools");
      });

      it("should still use --dangerously-skip-permissions in server", async () => {
        const dangerServer = (await startServer({ withDanger: true })).server;

        // Call the actual buildClaudeChatArgs method on the danger server
        const args = (dangerServer as any).drBot.buildClaudeChatArgs();

        expect(args).toContain("--dangerously-skip-permissions");
        expect(args).not.toContain("--allowedTools");
      });
    });
  });
});
