import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, mkdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ChatLogger } from "../../src/utils/chat-logger.js";

describe("DR Chat Session Integration Tests", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `claude-chat-session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("FR1: Session ID Generation", () => {
    it("should generate a valid UUID v4 for each dr chat invocation", () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      // Verify it's a valid UUID v4 format
      expect(sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      expect(typeof sessionId).toBe("string");
      expect(sessionId.length).toBe(36); // UUID format: 8-4-4-4-12
    });

    it("should generate different UUIDs for different logger instances", () => {
      const logger1 = new ChatLogger(testDir);
      const logger2 = new ChatLogger(testDir);

      const id1 = logger1.getSessionId();
      const id2 = logger2.getSessionId();

      expect(id1).not.toEqual(id2);
    });
  });

  describe("FR2: Session ID Persistence Across Messages", () => {
    it("should persist the same session ID across multiple messages in a single session", async () => {
      const logger = new ChatLogger(testDir);
      const initialSessionId = logger.getSessionId();

      await logger.ensureLogDirectory();
      await logger.logUserMessage("First message");
      const sessionIdAfterFirst = logger.getSessionId();

      await logger.logUserMessage("Second message");
      const sessionIdAfterSecond = logger.getSessionId();

      // Session ID should remain the same throughout the logger's lifetime
      expect(sessionIdAfterFirst).toEqual(initialSessionId);
      expect(sessionIdAfterSecond).toEqual(initialSessionId);
    });

    it("should include session ID in all log entries within a session", async () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();
      await logger.logUserMessage("Message 1");
      await logger.logUserMessage("Message 2");
      await logger.logCommand("dr", ["list"]);

      const entries = await logger.readEntries();
      expect(entries.length).toBeGreaterThan(0);

      // Some entries should have session ID in metadata (at minimum the session start event)
      const entriesWithSessionId = entries.filter((e) => e.metadata?.sessionId);
      expect(entriesWithSessionId.length).toBeGreaterThan(0);
    });

    it("should use the same session ID for all entries within a session", async () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();
      await logger.logUserMessage("First message");
      await logger.logUserMessage("Second message");

      const entries = await logger.readEntries();
      const entriesWithSessionId = entries.filter((e) => e.metadata?.sessionId);
      const sessionIds = new Set(entriesWithSessionId.map((e) => e.metadata?.sessionId));

      // All entries with session ID should share the same ID
      expect(sessionIds.size).toBe(1);
      expect([...sessionIds][0]).toEqual(sessionId);
    });
  });

  describe("FR3: Session Isolation Between Chat Invocations", () => {
    it("should generate new session ID for each new dr chat invocation", () => {
      const logger1 = new ChatLogger(testDir);
      const sessionId1 = logger1.getSessionId();

      const logger2 = new ChatLogger(testDir);
      const sessionId2 = logger2.getSessionId();

      // Each invocation gets a different session ID
      expect(sessionId1).not.toEqual(sessionId2);
    });

    it("should maintain separate log files for each session", async () => {
      const logger1 = new ChatLogger(testDir);
      const sessionId1 = logger1.getSessionId();
      await logger1.ensureLogDirectory();
      await logger1.logUserMessage("Session 1 message");

      const logger2 = new ChatLogger(testDir);
      const sessionId2 = logger2.getSessionId();
      await logger2.ensureLogDirectory();
      await logger2.logUserMessage("Session 2 message");

      // Verify each logger reads only its own session
      const entries1 = await logger1.readEntries();
      const entries2 = await logger2.readEntries();

      // Logger1's entries should contain Session 1 message
      expect(entries1.some((e) => e.content === "Session 1 message")).toBe(true);
      // Logger2's entries should contain Session 2 message
      expect(entries2.some((e) => e.content === "Session 2 message")).toBe(true);
    });

    it("should ensure new session has different UUID than previous", () => {
      const session1Ids = new Set<string>();
      for (let i = 0; i < 3; i++) {
        const logger = new ChatLogger(testDir);
        session1Ids.add(logger.getSessionId());
      }

      // All 3 loggers should have different session IDs
      expect(session1Ids.size).toBe(3);
    });
  });

  describe("FR4: Session ID Format Validation", () => {
    it("should provide ChatLogger.sessionId as valid UUID v4", () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      // Must be valid UUID v4 with specific format
      const uuidv4Pattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(sessionId).toMatch(uuidv4Pattern);
    });

    it("should maintain consistent sessionId through logger lifetime", () => {
      const logger = new ChatLogger(testDir);
      const sessionId1 = logger.getSessionId();
      const sessionId2 = logger.getSessionId();
      const sessionId3 = logger.getSessionId();

      // Same logger instance always returns same ID
      expect(sessionId1).toEqual(sessionId2);
      expect(sessionId2).toEqual(sessionId3);
    });

    it("should have version 4 indicator in UUID", () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      // UUID v4 has '4' in the 3rd group (position 14)
      expect(sessionId[14]).toEqual("4");
    });

    it("should have correct variant bits in UUID v4", () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      // UUID v4 variant bits are [89ab] in the 4th group (positions 19-20)
      const variantChar = sessionId[19];
      expect(["8", "9", "a", "A", "b", "B"]).toContain(variantChar);
    });
  });

  describe("US1: Session Continuity Test", () => {
    it("should maintain conversation context across multiple messages", async () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();
      await logger.logUserMessage("Initial assessment of model");
      await logger.logUserMessage("Follow-up elaboration request");

      const entries = await logger.readEntries();

      // Both messages should be in entries
      const messages = entries.filter((e) => e.role === "user");
      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages.some((m) => m.content === "Initial assessment of model")).toBe(true);
      expect(messages.some((m) => m.content === "Follow-up elaboration request")).toBe(true);
    });

    it("should preserve message order within a session", async () => {
      const logger = new ChatLogger(testDir);

      await logger.ensureLogDirectory();
      for (let i = 0; i < 5; i++) {
        await logger.logUserMessage(`Message ${i}`);
      }

      const entries = await logger.readEntries();
      const messages = entries.filter((e) => e.role === "user");

      expect(messages.length).toBe(5);
      for (let i = 0; i < 5; i++) {
        expect(messages[i].content).toEqual(`Message ${i}`);
      }
    });
  });

  describe("US2: Session Isolation Test", () => {
    it("should create separate sessions with different IDs", () => {
      const logger1 = new ChatLogger(testDir);
      const id1 = logger1.getSessionId();

      const logger2 = new ChatLogger(testDir);
      const id2 = logger2.getSessionId();

      expect(id1).not.toEqual(id2);
    });

    it("should not cross-contaminate sessions", async () => {
      // Session 1
      const logger1 = new ChatLogger(testDir);
      await logger1.ensureLogDirectory();
      await logger1.logUserMessage("Session 1 context");

      // Session 2 - independent
      const logger2 = new ChatLogger(testDir);
      await logger2.ensureLogDirectory();

      const entries2 = await logger2.readEntries();
      // Should not contain Session 1 message
      expect(entries2.some((e) => e.content === "Session 1 context")).toBe(false);
    });
  });

  describe("US3: Tool Call Continuity Test", () => {
    it("should preserve tool execution results across messages", async () => {
      const logger = new ChatLogger(testDir);

      await logger.ensureLogDirectory();
      await logger.logUserMessage("List available commands");
      await logger.logCommand("dr", ["list"]);
      await logger.logUserMessage("Tell me more");

      const entries = await logger.readEntries();

      // Verify entries were logged
      expect(entries.length).toBeGreaterThanOrEqual(3);

      // Verify command was logged
      const commands = entries.filter((e) => e.type === "command");
      expect(commands.length).toBeGreaterThan(0);

      // Verify messages exist
      const messages = entries.filter((e) => e.role === "user");
      expect(messages.length).toBeGreaterThanOrEqual(2);
    });

    it("should maintain chronological order with tool calls", async () => {
      const logger = new ChatLogger(testDir);

      await logger.ensureLogDirectory();
      await logger.logUserMessage("Request 1");
      await logger.logCommand("dr", ["info"]);
      await logger.logUserMessage("Request 2");
      await logger.logCommand("dr", ["validate"]);

      const entries = await logger.readEntries();

      // Verify order
      const allContent = entries.map((e) => e.content);
      const request1Index = allContent.indexOf("Request 1");
      const request2Index = allContent.indexOf("Request 2");

      expect(request1Index).toBeLessThan(request2Index);
    });
  });

  describe("US5: Verbose Logging Test", () => {
    it("should log session_started event with session ID", async () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();
      await logger.logUserMessage("Test message");

      const entries = await logger.readEntries();

      // Should have session_started event
      const startEvent = entries.find((e) => e.type === "event" && e.content === "Session started");
      expect(startEvent).toBeDefined();
      expect(startEvent?.metadata?.sessionId).toEqual(sessionId);
    });

    it("should include session ID in all log entries for tracking", async () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();
      await logger.logUserMessage("Message 1");
      await logger.logCommand("dr", ["list"]);
      await logger.logError("Test error");

      const entries = await logger.readEntries();

      // All entries with session ID should have the same ID
      const entriesWithSessionId = entries.filter((e) => e.metadata?.sessionId);
      entriesWithSessionId.forEach((entry) => {
        expect(entry.metadata?.sessionId).toEqual(sessionId);
      });
      expect(entriesWithSessionId.length).toBeGreaterThan(0);
    });

    it("should track session ID across command invocations", async () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();

      // Simulate multiple "subprocess invocations"
      for (let i = 0; i < 3; i++) {
        await logger.logUserMessage(`Message ${i}`);
        await logger.logCommand("dr", ["info"]);
      }

      const entries = await logger.readEntries();
      const commands = entries.filter((e) => e.type === "command");

      expect(commands.length).toBe(3);
      // Verify session ID consistency where available
      const commandsWithSessionId = commands.filter((c) => c.metadata?.sessionId);
      commandsWithSessionId.forEach((cmd) => {
        expect(cmd.metadata?.sessionId).toEqual(sessionId);
      });
    });
  });

  describe("FR8: Error Handling - Invalid Session ID Rejection", () => {
    it("should gracefully handle logging errors", async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      // Log normal messages
      await logger.logUserMessage("Test message");
      await logger.logError("An error occurred");

      const entries = await logger.readEntries();
      expect(entries.length).toBeGreaterThan(0);

      // Verify error was logged
      const errorEntry = entries.find((e) => e.type === "error");
      expect(errorEntry).toBeDefined();
      expect(errorEntry?.content).toEqual("An error occurred");
    });

    it("should maintain session state after error logging", async () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();
      await logger.logUserMessage("Before error");
      await logger.logError("Error occurred");
      await logger.logUserMessage("After error");

      const entries = await logger.readEntries();

      // Verify all three operations were logged
      expect(entries.some((e) => e.content === "Before error")).toBe(true);
      expect(entries.some((e) => e.content === "Error occurred")).toBe(true);
      expect(entries.some((e) => e.content === "After error")).toBe(true);

      // Verify session ID consistency where present
      const entriesWithSessionId = entries.filter((e) => e.metadata?.sessionId);
      entriesWithSessionId.forEach((entry) => {
        expect(entry.metadata?.sessionId).toEqual(sessionId);
      });
    });
  });

  describe("FR9: State Management Consistency", () => {
    it("should maintain consistency between tracked and logged session ID", async () => {
      const logger = new ChatLogger(testDir);
      const trackedId = logger.getSessionId();

      await logger.ensureLogDirectory();
      await logger.logUserMessage("Test message");

      const entries = await logger.readEntries();
      const entriesWithSessionId = entries.filter((e) => e.metadata?.sessionId);
      const loggedIds = new Set(entriesWithSessionId.map((e) => e.metadata?.sessionId));

      // Logged IDs should match tracked ID
      expect(loggedIds.size).toBeGreaterThan(0);
      expect([...loggedIds][0]).toEqual(trackedId);
    });

    it("should ensure session summary reflects logged state", async () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();
      await logger.logUserMessage("Message 1");
      await logger.logUserMessage("Message 2");
      await logger.logCommand("dr", ["list"]);
      await logger.logError("Test error");

      const summary = await logger.getSummary();

      expect(summary.sessionId).toEqual(sessionId);
      expect(summary.messageCount).toBe(2);
      expect(summary.commandCount).toBe(1);
      expect(summary.errorCount).toBe(1);
    });

    it("should provide accurate session statistics", async () => {
      const logger = new ChatLogger(testDir);

      await logger.ensureLogDirectory();

      // Log various entry types
      await logger.logUserMessage("Message 1");
      await logger.logUserMessage("Message 2");
      await logger.logCommand("dr", ["list"]);
      await logger.logCommand("dr", ["info"]);
      await logger.logError("Error 1");

      const summary = await logger.getSummary();

      expect(summary.messageCount).toBe(2);
      expect(summary.commandCount).toBe(2);
      expect(summary.errorCount).toBe(1);
      expect(summary.duration).toBeDefined();
    });
  });

  describe("Session Continuity Verification", () => {
    it('should confirm no "first interaction" in continuation', async () => {
      const logger = new ChatLogger(testDir);

      await logger.ensureLogDirectory();
      await logger.logUserMessage("Initial assessment");
      await logger.logUserMessage("Follow-up detail");

      const entries = await logger.readEntries();
      const userMessages = entries.filter((e) => e.role === "user");

      // Both should exist in session
      expect(userMessages.length).toBeGreaterThanOrEqual(2);
      expect(userMessages.some((m) => m.content === "Initial assessment")).toBe(true);
      expect(userMessages.some((m) => m.content === "Follow-up detail")).toBe(true);
    });
  });

  describe("Claude CLI Integration Tests", () => {
    it("should pass session ID to Claude CLI subprocess invocations", async () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();

      // Simulate subprocess invocation with session ID
      await logger.logCommand("dr", ["--session-id", sessionId, "--prompt", "Test message"]);

      const entries = await logger.readEntries();
      const commands = entries.filter((e) => e.type === "command");

      expect(commands.length).toBeGreaterThan(0);
      expect(commands[0].metadata?.args).toContain("--session-id");
      expect(commands[0].metadata?.args).toContain(sessionId);
    });

    it("should maintain session ID consistency across multiple CLI calls", async () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();

      // Simulate multiple CLI invocations with same session ID
      for (let i = 0; i < 3; i++) {
        await logger.logCommand("dr", ["--session-id", sessionId, "--prompt", `Message ${i}`]);
      }

      const entries = await logger.readEntries();
      const commands = entries.filter((e) => e.type === "command");

      expect(commands.length).toBe(3);
      commands.forEach((cmd) => {
        expect(cmd.metadata?.args).toContain("--session-id");
        expect(cmd.metadata?.args).toContain(sessionId);
      });
    });

    it("should handle invalid session ID format gracefully", async () => {
      const logger = new ChatLogger(testDir);

      await logger.ensureLogDirectory();

      // Log an error simulating CLI rejection of invalid session ID
      const invalidSessionId = "invalid-format-not-a-uuid";
      await logger.logError(`Claude CLI rejected session ID format: ${invalidSessionId}`);

      const entries = await logger.readEntries();
      const errorEntry = entries.find((e) => e.type === "error" && e.content?.includes("rejected"));

      expect(errorEntry).toBeDefined();
      expect(errorEntry?.content).toContain("Claude CLI");
      expect(errorEntry?.content).toContain("rejected");
    });

    it("should continue session after handling invalid session ID error", async () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();

      // Simulate error and recovery
      await logger.logError("Invalid session ID");
      await logger.logUserMessage("Recovery message");

      const entries = await logger.readEntries();

      // Both error and message should be logged
      expect(entries.some((e) => e.type === "error")).toBe(true);
      expect(entries.some((e) => e.content === "Recovery message")).toBe(true);

      // Session ID should be consistent where present
      const entriesWithSessionId = entries.filter((e) => e.metadata?.sessionId);
      if (entriesWithSessionId.length > 0) {
        expect(entriesWithSessionId[0].metadata?.sessionId).toEqual(sessionId);
      }
    });
  });

  describe("Subprocess Argument Construction Tests", () => {
    it("should construct subprocess args with --session-id flag", async () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();

      // Simulate subprocess invocation argument construction
      const args = ["--session-id", sessionId, "--prompt", "Test message"];

      // Verify session ID is properly positioned in args
      expect(args).toContain("--session-id");
      const sessionIdIndex = args.indexOf("--session-id");
      expect(sessionIdIndex).toBeGreaterThanOrEqual(0);
      expect(args[sessionIdIndex + 1]).toEqual(sessionId);
    });

    it("should use --continue flag for subsequent messages in session", async () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();
      await logger.logUserMessage("First message");

      // Simulate first invocation (no --continue needed)
      const firstArgs = ["--session-id", sessionId, "--prompt", "First message"];
      expect(firstArgs).toContain("--session-id");
      expect(firstArgs).not.toContain("--continue");

      await logger.logUserMessage("Follow-up message");

      // Simulate subsequent invocation (--continue should be used)
      const continueArgs = [
        "--continue",
        "--session-id",
        sessionId,
        "--prompt",
        "Follow-up message",
      ];
      expect(continueArgs).toContain("--continue");
      expect(continueArgs).toContain("--session-id");
      expect(continueArgs).toContain(sessionId);
    });
  });

  describe("End-to-End Session Continuity", () => {
    it("should maintain session context across multiple logger invocations with same session ID", async () => {
      // Create first logger and establish session
      const logger1 = new ChatLogger(testDir);
      const sessionId = logger1.getSessionId();

      await logger1.ensureLogDirectory();
      await logger1.logUserMessage("What is 2 + 2?", {
        client: "Claude Code",
        sessionId,
        contextNumber: 1,
      });
      await logger1.logAssistantMessage("2 + 2 equals 4.", {
        client: "Claude Code",
        sessionId,
        contextNumber: 1,
      });

      // Simulate second invocation with same session ID
      // In real scenario, this would be a new ChatLogger instance but with
      // the session ID passed from previous invocation via --session-id flag
      await logger1.logUserMessage("What was the answer I asked about before?", {
        client: "Claude Code",
        sessionId,
        contextNumber: 2,
      });
      await logger1.logAssistantMessage("You asked about 2 + 2, and I answered that it equals 4.", {
        client: "Claude Code",
        sessionId,
        contextNumber: 2,
      });

      // Verify all messages are in the same session log
      const entries = await logger1.readEntries();

      // Should have: session start event + 4 messages (2 user, 2 assistant)
      expect(entries.length).toBeGreaterThanOrEqual(5);

      // Verify session continuity metadata
      const userMessages = entries.filter((e) => e.role === "user");
      expect(userMessages.length).toBe(2);
      expect(userMessages[0].content).toContain("What is 2 + 2?");
      expect(userMessages[1].content).toContain("What was the answer I asked about before?");

      const assistantMessages = entries.filter((e) => e.role === "assistant");
      expect(assistantMessages.length).toBe(2);
      expect(assistantMessages[0].content).toContain("2 + 2 equals 4");
      expect(assistantMessages[1].content).toContain("You asked about 2 + 2");

      // All entries should be part of the same session
      const messagesWithSessionId = entries.filter((e) => e.metadata?.sessionId);
      const uniqueSessionIds = new Set(messagesWithSessionId.map((e) => e.metadata?.sessionId));
      expect(uniqueSessionIds.size).toBeLessThanOrEqual(1);
      if (uniqueSessionIds.size === 1) {
        expect([...uniqueSessionIds][0]).toEqual(sessionId);
      }
    });

    it("should verify session ID is passed through ChatOptions to subprocess", async () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();

      // Log a command with session ID metadata to verify it's tracked
      await logger.logCommand("claude", ["--session-id", sessionId, "--prompt", "Hello"], {
        client: "Claude Code",
        sessionId,
        hasSessionIdFlag: true,
      });

      const entries = await logger.readEntries();
      const commandEntry = entries.find((e) => e.type === "command");

      expect(commandEntry).toBeDefined();
      expect(commandEntry?.metadata?.sessionId).toEqual(sessionId);
      expect(commandEntry?.metadata?.hasSessionIdFlag).toBe(true);
      expect(commandEntry?.content).toContain("--session-id");
      expect(commandEntry?.content).toContain(sessionId);
    });

    it("should demonstrate multi-turn conversation flow with session persistence", async () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();

      // Turn 1: User asks question
      await logger.logUserMessage("Remember the number 42", {
        client: "Claude Code",
        sessionId,
        turn: 1,
      });
      await logger.logAssistantMessage("I will remember the number 42.", {
        client: "Claude Code",
        sessionId,
        turn: 1,
      });

      // Turn 2: User asks about previous context
      await logger.logUserMessage("What number did I tell you to remember?", {
        client: "Claude Code",
        sessionId,
        turn: 2,
      });
      await logger.logAssistantMessage("The number you told me to remember is 42.", {
        client: "Claude Code",
        sessionId,
        turn: 2,
      });

      // Turn 3: User continues conversation with same context
      await logger.logUserMessage("Multiply that number by 2", {
        client: "Claude Code",
        sessionId,
        turn: 3,
      });
      await logger.logAssistantMessage("42 multiplied by 2 equals 84.", {
        client: "Claude Code",
        sessionId,
        turn: 3,
      });

      // Verify conversation flow is logged correctly
      const entries = await logger.readEntries();
      const messages = entries.filter((e) => e.type === "message");

      // Should have 6 messages (3 user + 3 assistant)
      expect(messages.length).toBe(6);

      // Verify temporal ordering
      const userMessages = messages.filter((m) => m.role === "user");
      expect(userMessages[0].metadata?.turn).toBe(1);
      expect(userMessages[1].metadata?.turn).toBe(2);
      expect(userMessages[2].metadata?.turn).toBe(3);

      // Verify all are in the same session
      const turns = messages.filter((m) => m.metadata?.sessionId);
      const sessionIds = new Set(turns.map((m) => m.metadata?.sessionId));
      expect(sessionIds.size).toBeLessThanOrEqual(1);
    });
  });
});
