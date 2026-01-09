/**
 * Chat Utilities
 * 
 * Common utilities for chat client detection and management.
 */

import { BaseChatClient } from './base-chat-client.js';
import { ClaudeCodeClient } from './claude-code-client.js';
import { CopilotClient } from './copilot-client.js';

/**
 * Detect available AI chat clients
 * Checks for Claude Code CLI and GitHub Copilot CLI
 * @returns Array of available client instances
 */
export async function detectAvailableClients(): Promise<BaseChatClient[]> {
  const clients: BaseChatClient[] = [];
  
  const claudeClient = new ClaudeCodeClient();
  if (await claudeClient.isAvailable()) {
    clients.push(claudeClient);
  }
  
  const copilotClient = new CopilotClient();
  if (await copilotClient.isAvailable()) {
    clients.push(copilotClient);
  }
  
  return clients;
}

/**
 * Select a chat client from available clients based on preference
 * @param clients Array of available clients
 * @param preferredClientName Optional preferred client name
 * @returns Selected client or undefined if none available
 */
export function selectChatClient(
  clients: BaseChatClient[],
  preferredClientName?: string | null
): BaseChatClient | undefined {
  if (clients.length === 0) {
    return undefined;
  }
  
  // If a preference is specified, try to find it
  if (preferredClientName) {
    const preferred = clients.find(c => c.getClientName() === preferredClientName);
    if (preferred) {
      return preferred;
    }
  }
  
  // Return first available client
  return clients[0];
}
