/**
 * chat_status — report which AI coding agents (Claude Code, GitHub Copilot)
 * are installed and available. Mirrors the REST/WebSocket `chat.status`
 * JSON-RPC method (`cli/src/server/server.ts`).
 */

import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { detectAvailableClients, selectChatClient } from "../../coding-agents/chat-utils.js";
import { jsonResult, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {};

export type ChatStatusArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function chatStatusHandler(_args: ChatStatusArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const availableClients = await detectAvailableClients();
    const selected = selectChatClient(availableClients);

    return jsonResult({
      available: availableClients.map((client) => client.getClientName()),
      selected: selected ? selected.getClientName() : null,
      sdk_available: availableClients.length > 0,
      sdk_version: selected ? selected.getClientName() : null,
      error_message:
        availableClients.length === 0
          ? "No chat client available. Install Claude Code or GitHub Copilot."
          : null,
    });
  });
}

export const chatStatusTool: McpToolDefinition<typeof inputSchema> = {
  name: "chat_status",
  description: "Report which AI coding agents (Claude Code, GitHub Copilot) are installed and available.",
  inputSchema,
  handler: chatStatusHandler,
};
