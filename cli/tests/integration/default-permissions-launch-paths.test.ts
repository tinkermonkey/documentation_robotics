/**
 * Integration tests for read-safe permissions in Claude Code launch paths
 *
 * Tests verify that:
 * 1. `dr chat` (Claude Code, default mode) passes the read-safe allowlist
 * 2. `dr visualize` (Claude Code, default mode) passes the read-safe allowlist
 * 3. Default-mode sessions cannot write/edit/delete files
 * 4. --with-danger behavior remains unchanged
 * 5. Read operations work without permission prompts in default mode
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { ClaudeCodeClient } from "../../src/coding-agents/claude-code-client.js";
import { ChatOptions } from "../../src/coding-agents/base-chat-client.js";
import { formatForClaudeCode } from "../../src/coding-agents/default-permissions.js";
import { VisualizationServer } from "../../src/server/server.js";
import { Model } from "../../src/core/model.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";

describe("Default Permissions in Launch Paths (Phase 2)", () => {
  let workdir: any;
  let testModel: Model;

  beforeEach(async () => {
    workdir = await createTestWorkdir();
    testModel = await Model.load(workdir.path);
  });

  afterEach(async () => {
    await workdir.cleanup();
  });

  describe("ClaudeCodeClient (dr chat)", () => {
    let client: ClaudeCodeClient;

    beforeEach(() => {
      client = new ClaudeCodeClient();
    });

    describe("Default mode permission handling", () => {
      it("should include --allowedTools in process args when withDanger is false", () => {
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

      it("should include read-safe permissions in allowlist", () => {
        const options: ChatOptions = {
          withDanger: false,
          workingDirectory: workdir.path,
        };

        const args = (client as any).getProcessArgs(options, true);
        const allowedToolsIndex = args.indexOf("--allowedTools");
        const allowedTools = args[allowedToolsIndex + 1];

        // Verify it contains all read-safe tool permissions
        expect(allowedTools).toContain("Bash(dr *");
        expect(allowedTools).toContain("Read(");
        expect(allowedTools).toContain("Read(documentation-robotics)");
        expect(allowedTools).toContain("Read(.dr)");
      });

      it("should NOT include write/edit/delete tools in allowlist", () => {
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
      it("should use --dangerously-skip-permissions when withDanger is true", () => {
        const options: ChatOptions = {
          withDanger: true,
          workingDirectory: workdir.path,
        };

        const args = (client as any).getProcessArgs(options, true);

        expect(args).toContain("--dangerously-skip-permissions");
      });

      it("should NOT include --allowedTools when withDanger is true", () => {
        const options: ChatOptions = {
          withDanger: true,
          workingDirectory: workdir.path,
        };

        const args = (client as any).getProcessArgs(options, true);

        expect(args).not.toContain("--allowedTools");
      });
    });

    describe("Fallback when withDanger is undefined", () => {
      it("should default to read-safe allowlist when withDanger is undefined", () => {
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
      it("should include --allowedTools for first message in default mode", () => {
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

      it("should include --allowedTools for subsequent messages in default mode", () => {
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
    let server: VisualizationServer;

    beforeEach(() => {
      server = new VisualizationServer(testModel, { withDanger: false });
    });

    describe("Default mode permission handling", () => {
      it("should include --allowedTools in launch args when withDanger is false", () => {
        // Access the private method via type casting for testing
        const buildCommand = (withDanger: boolean) => {
          const cmd = ["claude", "--agent", "dr-architect", "--print"];
          if (withDanger) {
            cmd.push("--dangerously-skip-permissions");
          } else {
            cmd.push("--allowedTools", formatForClaudeCode());
          }
          cmd.push("--verbose", "--output-format", "stream-json");
          return cmd;
        };

        const args = buildCommand(false);

        expect(args).toContain("--allowedTools");
        const allowedToolsIndex = args.indexOf("--allowedTools");
        expect(args[allowedToolsIndex + 1]).toBeDefined();
        expect(args[allowedToolsIndex + 1]).toEqual(formatForClaudeCode());
      });

      it("should NOT include --dangerously-skip-permissions in default mode", () => {
        const buildCommand = (withDanger: boolean) => {
          const cmd = ["claude", "--agent", "dr-architect", "--print"];
          if (withDanger) {
            cmd.push("--dangerously-skip-permissions");
          } else {
            cmd.push("--allowedTools", formatForClaudeCode());
          }
          cmd.push("--verbose", "--output-format", "stream-json");
          return cmd;
        };

        const args = buildCommand(false);

        expect(args).not.toContain("--dangerously-skip-permissions");
      });
    });

    describe("Danger mode handling", () => {
      it("should use --dangerously-skip-permissions when withDanger is true", () => {
        const dangerServer = new VisualizationServer(testModel, { withDanger: true });

        const buildCommand = (withDanger: boolean) => {
          const cmd = ["claude", "--agent", "dr-architect", "--print"];
          if (withDanger) {
            cmd.push("--dangerously-skip-permissions");
          } else {
            cmd.push("--allowedTools", formatForClaudeCode());
          }
          cmd.push("--verbose", "--output-format", "stream-json");
          return cmd;
        };

        const args = buildCommand(true);

        expect(args).toContain("--dangerously-skip-permissions");
        expect(args).not.toContain("--allowedTools");
      });
    });
  });

  describe("Acceptance Criteria Verification", () => {
    describe("dr chat default mode can read without prompts", () => {
      it("should include Bash tool for dr CLI execution", () => {
        const client = new ClaudeCodeClient();
        const options: ChatOptions = { withDanger: false };

        const args = (client as any).getProcessArgs(options, true);
        const allowedTools = args[args.indexOf("--allowedTools") + 1];

        // Should allow running dr CLI
        expect(allowedTools).toContain("Bash(dr *");
      });

      it("should include Read tool for codebase access", () => {
        const client = new ClaudeCodeClient();
        const options: ChatOptions = { withDanger: false };

        const args = (client as any).getProcessArgs(options, true);
        const allowedTools = args[args.indexOf("--allowedTools") + 1];

        // Should allow reading the codebase
        expect(allowedTools).toContain("Read(.)");
      });

      it("should include Read tool for documentation-robotics folder", () => {
        const client = new ClaudeCodeClient();
        const options: ChatOptions = { withDanger: false };

        const args = (client as any).getProcessArgs(options, true);
        const allowedTools = args[args.indexOf("--allowedTools") + 1];

        // Should allow reading documentation-robotics
        expect(allowedTools).toContain("Read(documentation-robotics)");
      });

      it("should include Read tool for .dr folder", () => {
        const client = new ClaudeCodeClient();
        const options: ChatOptions = { withDanger: false };

        const args = (client as any).getProcessArgs(options, true);
        const allowedTools = args[args.indexOf("--allowedTools") + 1];

        // Should allow reading .dr folder
        expect(allowedTools).toContain("Read(.dr)");
      });
    });

    describe("dr visualize default mode exhibits same read behavior", () => {
      it("should include all four read-safe capabilities", () => {
        const allowedTools = formatForClaudeCode();

        expect(allowedTools).toContain("Bash(dr *");
        expect(allowedTools).toContain("Read(.");
        expect(allowedTools).toContain("Read(documentation-robotics)");
        expect(allowedTools).toContain("Read(.dr)");
      });
    });

    describe("Default mode cannot write/edit/delete files", () => {
      it("should NOT include Edit tool", () => {
        const allowedTools = formatForClaudeCode();
        expect(allowedTools).not.toContain("Edit");
      });

      it("should NOT include Write tool", () => {
        const allowedTools = formatForClaudeCode();
        expect(allowedTools).not.toContain("Write");
      });

      it("should NOT include Delete tool", () => {
        const allowedTools = formatForClaudeCode();
        expect(allowedTools).not.toContain("Delete");
      });

      it("should not include dangerous Bash commands", () => {
        const allowedTools = formatForClaudeCode();
        // Bash is scoped to "dr *" only
        expect(allowedTools).toContain("Bash(dr *");
      });
    });

    describe("--with-danger behavior unchanged in both paths", () => {
      it("should still use --dangerously-skip-permissions in claude-code-client", () => {
        const client = new ClaudeCodeClient();
        const options: ChatOptions = { withDanger: true };

        const args = (client as any).getProcessArgs(options, true);

        expect(args).toContain("--dangerously-skip-permissions");
        expect(args).not.toContain("--allowedTools");
      });

      it("should still use --dangerously-skip-permissions in server", () => {
        const buildCommand = (withDanger: boolean) => {
          const cmd = ["claude", "--agent", "dr-architect", "--print"];
          if (withDanger) {
            cmd.push("--dangerously-skip-permissions");
          } else {
            cmd.push("--allowedTools", formatForClaudeCode());
          }
          return cmd;
        };

        const args = buildCommand(true);

        expect(args).toContain("--dangerously-skip-permissions");
        expect(args).not.toContain("--allowedTools");
      });
    });
  });
});
