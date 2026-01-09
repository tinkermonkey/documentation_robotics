/**
 * Coding Agent Abstraction Layer
 * 
 * Provides a unified interface for integrating multiple coding agent CLIs
 * (Claude Code, GitHub Copilot, etc.) with consistent availability checking,
 * process spawning, and output parsing.
 * 
 * @module ai/agents
 */

// Types
export type {
  CodingAgent,
  AgentProcess,
  AgentProcessResult,
  ChatEvent,
  ChatEventType,
  SpawnAgentOptions,
} from './types.js';

// Implementations
export { ClaudeCodeAgent } from './claude-code.js';
