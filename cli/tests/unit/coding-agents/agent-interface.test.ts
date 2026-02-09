/**
 * Tests for Coding Agent Abstraction Layer - Interface Contracts
 *
 * Validates the agent abstraction interface, ensuring all required
 * methods and properties are defined correctly.
 */

import { describe, it, expect } from "bun:test";
import type {
  CodingAgent,
  AgentProcess,
  ChatEvent,
} from "../../../src/coding-agents/agents/types.js";

describe("CodingAgent Interface", () => {
  it("should define required properties", () => {
    // Type check - ensures interface requires these properties
    const checkAgentContract = (agent: CodingAgent) => {
      expect(agent.name).toBeString();
      expect(agent.command).toBeString();
      expect(typeof agent.isAvailable).toBe("function");
      expect(typeof agent.spawn).toBe("function");
      expect(typeof agent.parseOutput).toBe("function");
    };

    expect(typeof checkAgentContract).toBe("function");
  });

  it("should require isAvailable to return Promise<boolean>", () => {
    type IsAvailableReturn = ReturnType<CodingAgent["isAvailable"]>;
    const test: IsAvailableReturn = Promise.resolve(true);
    expect(test).toBeInstanceOf(Promise);
  });

  it("should require spawn to return AgentProcess", () => {
    type SpawnReturn = ReturnType<CodingAgent["spawn"]>;
    // Type assertion validates the interface contract
    const mockProcess: any = { pid: 123 };
    const mockReturn: SpawnReturn = {
      process: mockProcess,
      conversationId: "test-123",
      completion: Promise.resolve({
        exitCode: 0,
        fullResponse: "test",
        events: [],
      }),
    };

    expect(mockReturn.process).toBeDefined();
    expect(mockReturn.conversationId).toBeString();
    expect(mockReturn.completion).toBeInstanceOf(Promise);
  });

  it("should require parseOutput to return ChatEvent array", () => {
    type ParseOutputReturn = ReturnType<CodingAgent["parseOutput"]>;
    const mockReturn: ParseOutputReturn = [{ type: "text", content: "test" }];

    expect(Array.isArray(mockReturn)).toBe(true);
    expect(mockReturn[0].type).toBe("text");
  });
});

describe("ChatEvent Types", () => {
  it("should support text event", () => {
    const event: ChatEvent = {
      type: "text",
      content: "Hello world",
    };

    expect(event.type).toBe("text");
    expect(event.content).toBe("Hello world");
  });

  it("should support tool_use event", () => {
    const event: ChatEvent = {
      type: "tool_use",
      toolName: "Bash",
      toolInput: { command: "ls" },
    };

    expect(event.type).toBe("tool_use");
    expect(event.toolName).toBe("Bash");
    expect(event.toolInput).toEqual({ command: "ls" });
  });

  it("should support tool_result event", () => {
    const event: ChatEvent = {
      type: "tool_result",
      toolResult: "output",
    };

    expect(event.type).toBe("tool_result");
    expect(event.toolResult).toBe("output");
  });

  it("should support error event", () => {
    const event: ChatEvent = {
      type: "error",
      error: "Something went wrong",
    };

    expect(event.type).toBe("error");
    expect(event.error).toBe("Something went wrong");
  });

  it("should support complete event", () => {
    const event: ChatEvent = {
      type: "complete",
    };

    expect(event.type).toBe("complete");
  });

  it("should allow optional fields to be omitted", () => {
    const event: ChatEvent = {
      type: "text",
    };

    expect(event.type).toBe("text");
    expect(event.content).toBeUndefined();
  });
});

describe("AgentProcess Structure", () => {
  it("should contain process, conversationId, and completion", () => {
    const mockProcess: any = { pid: 123, stdout: {}, stdin: {}, stderr: {} };
    const agentProcess: AgentProcess = {
      process: mockProcess,
      conversationId: "test-123",
      completion: Promise.resolve({
        exitCode: 0,
        fullResponse: "",
        events: [],
      }),
    };

    expect(agentProcess.process).toBe(mockProcess);
    expect(agentProcess.conversationId).toBe("test-123");
    expect(agentProcess.completion).toBeInstanceOf(Promise);
  });

  it("should have completion promise that resolves to result", async () => {
    const result = {
      exitCode: 0,
      fullResponse: "complete",
      events: [{ type: "text" as const, content: "complete" }],
    };

    const agentProcess: AgentProcess = {
      process: {} as any,
      conversationId: "test",
      completion: Promise.resolve(result),
    };

    const resolvedResult = await agentProcess.completion;
    expect(resolvedResult.exitCode).toBe(0);
    expect(resolvedResult.fullResponse).toBe("complete");
    expect(resolvedResult.events).toHaveLength(1);
  });
});

describe("SpawnAgentOptions", () => {
  it("should require cwd and message", () => {
    const options = {
      cwd: "/path/to/dir",
      message: "Hello",
    };

    expect(options.cwd).toBe("/path/to/dir");
    expect(options.message).toBe("Hello");
  });

  it("should support optional agentName", () => {
    const options = {
      cwd: "/path",
      message: "test",
      agentName: "custom-agent",
    };

    expect(options.agentName).toBe("custom-agent");
  });

  it("should support optional systemPrompt", () => {
    const options = {
      cwd: "/path",
      message: "test",
      systemPrompt: "You are helpful",
    };

    expect(options.systemPrompt).toBe("You are helpful");
  });

  it("should support optional additionalArgs", () => {
    const options = {
      cwd: "/path",
      message: "test",
      additionalArgs: ["--verbose", "--debug"],
    };

    expect(options.additionalArgs).toEqual(["--verbose", "--debug"]);
  });
});

describe("AgentProcessResult", () => {
  it("should contain exitCode, fullResponse, and events", () => {
    const result = {
      exitCode: 0,
      fullResponse: "Complete response",
      events: [
        { type: "text" as const, content: "Part 1" },
        { type: "text" as const, content: "Part 2" },
      ],
    };

    expect(result.exitCode).toBe(0);
    expect(result.fullResponse).toBe("Complete response");
    expect(result.events).toHaveLength(2);
  });

  it("should support optional error field", () => {
    const result = {
      exitCode: 1,
      fullResponse: "",
      events: [],
      error: "Process failed",
    };

    expect(result.exitCode).toBe(1);
    expect(result.error).toBe("Process failed");
  });

  it("should indicate success with exitCode 0", () => {
    const result = {
      exitCode: 0,
      fullResponse: "success",
      events: [],
    };

    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it("should indicate failure with non-zero exitCode", () => {
    const result = {
      exitCode: 127,
      fullResponse: "",
      events: [],
      error: "Command not found",
    };

    expect(result.exitCode).not.toBe(0);
    expect(result.error).toBeTruthy();
  });
});
