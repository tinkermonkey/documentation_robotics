/**
 * Coding Agent Abstraction Types
 *
 * Defines the interface for coding agent integrations that support
 * chat-based architecture model exploration via CLI subprocess invocation.
 */

import { ChildProcess } from 'child_process';

/**
 * Chat event types emitted during agent interaction
 */
export type ChatEventType =
  | 'text'           // Text content from agent
  | 'tool_use'       // Agent is using a tool
  | 'tool_result'    // Result from tool execution
  | 'error'          // Error occurred
  | 'complete';      // Conversation completed

/**
 * Chat event structure
 */
export interface ChatEvent {
  type: ChatEventType;
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
  error?: string;
}

/**
 * Agent process wrapper
 * Provides access to the spawned subprocess and its streams
 */
export interface AgentProcess {
  /** The underlying child process */
  process: ChildProcess;

  /** Conversation/session identifier */
  conversationId: string;

  /** Promise that resolves when process completes */
  completion: Promise<AgentProcessResult>;
}

/**
 * Result of agent process execution
 */
export interface AgentProcessResult {
  /** Exit code (0 for success) */
  exitCode: number;

  /** Complete response text accumulated from the conversation */
  fullResponse: string;

  /** All events emitted during the conversation */
  events: ChatEvent[];

  /** Error message if process failed */
  error?: string;
}

/**
 * Options for spawning an agent process
 */
export interface SpawnAgentOptions {
  /** Working directory for the process */
  cwd: string;

  /** User message/prompt */
  message: string;

  /** Optional agent name (for multi-agent systems like GitHub Copilot) */
  agentName?: string;

  /** Optional system prompt override */
  systemPrompt?: string;

  /** Additional command-line arguments */
  additionalArgs?: string[];
}

/**
 * Coding Agent interface
 *
 * Defines the contract for coding agent CLI integrations.
 * Implementations must provide:
 * 1. Availability detection
 * 2. Process spawning with configuration
 * 3. Output parsing to structured events
 */
export interface CodingAgent {
  /** Human-readable agent name */
  readonly name: string;

  /** CLI command used to invoke this agent */
  readonly command: string;

  /**
   * Check if the agent CLI is available on the system
   *
   * Should be fast (< 100ms) and return boolean indicating availability.
   * Typically implemented by checking if command exists in PATH.
   *
   * @returns Promise resolving to true if agent is available, false otherwise
   */
  isAvailable(): Promise<boolean>;

  /**
   * Spawn agent process with given options
   *
   * Creates a subprocess, sends the initial message, and sets up
   * stream monitoring. Returns immediately with process wrapper.
   *
   * @param options Spawn configuration options
   * @returns Agent process wrapper with completion promise
   */
  spawn(options: SpawnAgentOptions): AgentProcess;

  /**
   * Parse raw output chunk into structured chat events
   *
   * Different agents have different output formats:
   * - Claude Code CLI: Line-delimited JSON events
   * - GitHub Copilot: Plain text/markdown
   * - Custom agents: Implementation-specific
   *
   * This method transforms agent-specific output into standardized
   * ChatEvent objects for consistent handling.
   *
   * @param chunk Raw output string from agent stdout
   * @returns Array of parsed chat events (may be empty if chunk incomplete)
   */
  parseOutput(chunk: string): ChatEvent[];
}
