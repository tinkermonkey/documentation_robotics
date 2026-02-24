/**
 * Base Chat Client Interface
 *
 * Defines the abstraction layer for AI chat clients that can be used with
 * the Documentation Robotics CLI. Implementations include Claude Code CLI
 * and GitHub Copilot CLI.
 */

/**
 * Chat message in a conversation
 */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Session information for maintaining conversation state
 */
export interface ChatSession {
  id: string;
  createdAt: Date;
  lastMessageAt: Date;
}

/**
 * Options for sending a chat message
 */
export interface ChatOptions {
  /** Optional agent/skill name to use */
  agent?: string;
  /** Working directory for the chat */
  workingDirectory?: string;
  /** Optional session ID to continue a conversation */
  sessionId?: string;
  /** Enable dangerous mode (skip permissions for Claude, allow all tools for Copilot) */
  withDanger?: boolean;
}

/**
 * Abstract base class for AI chat clients
 *
 * Provides a common interface for different AI chat CLI tools,
 * handling availability detection, message streaming, and session management.
 */
export abstract class BaseChatClient {
  protected currentSession?: ChatSession;

  /**
   * Check if the chat CLI tool is available on the system
   * @returns Promise that resolves to true if available, false otherwise
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Send a message and stream the response
   * @param message The user's message
   * @param options Chat options including agent, working directory, and session
   * @returns Promise that resolves with the complete assistant response text
   */
  abstract sendMessage(message: string, options?: ChatOptions): Promise<string>;

  /**
   * Get the current session information
   * @returns Current session or undefined if no session exists
   */
  getCurrentSession(): ChatSession | undefined {
    return this.currentSession;
  }

  /**
   * Clear the current session
   */
  clearSession(): void {
    this.currentSession = undefined;
  }

  /**
   * Create a new session
   * @returns The newly created session
   */
  protected createSession(): ChatSession {
    const session: ChatSession = {
      id: this.generateSessionId(),
      createdAt: new Date(),
      lastMessageAt: new Date(),
    };
    this.currentSession = session;
    return session;
  }

  /**
   * Update the last message timestamp for the current session
   */
  protected updateSessionTimestamp(): void {
    if (this.currentSession) {
      this.currentSession.lastMessageAt = new Date();
    }
  }

  /**
   * Generate a unique session ID
   * @returns A unique session identifier
   */
  protected generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Get the name of this chat client (for display purposes)
   */
  abstract getClientName(): string;
}
