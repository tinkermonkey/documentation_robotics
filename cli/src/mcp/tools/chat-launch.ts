/**
 * chat_launch — send a single prompt to an installed AI coding agent (Claude
 * Code or GitHub Copilot) in run-to-completion (`--print`) mode and return its
 * full response. Reuses `BaseChatClient.sendMessage()`, the same call `dr
 * chat` makes per turn, but as a single request/response instead of an
 * interactive REPL — there is no multi-turn session across separate
 * `chat_launch` calls.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { detectAvailableClients } from "../../coding-agents/chat-utils.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

export interface ChatLaunchArgs {
  prompt: string;
  client?: string;
  agent?: string;
  rootPath?: string;
}

const inputSchema = {
  prompt: z.string().min(1).describe("The message to send to the AI coding agent."),
  client: z
    .string()
    .optional()
    .describe(
      'Exact client name to use ("Claude Code" or "GitHub Copilot"). Defaults to the first available client.'
    ),
  agent: z
    .string()
    .optional()
    .describe('Optional agent/skill name to invoke. Defaults to "dr-architect".'),
  rootPath: rootPathSchema,
};

export async function chatLaunchHandler(args: ChatLaunchArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath, { lazyLoad: true });
    const availableClients = await detectAvailableClients();

    if (availableClients.length === 0) {
      return jsonResult({
        status: "unavailable",
        message: "No AI coding agent is installed. Install Claude Code or GitHub Copilot.",
      });
    }

    let selected = availableClients[0];
    if (args.client) {
      const match = availableClients.find((client) => client.getClientName() === args.client);
      if (!match) {
        return jsonResult({
          status: "unavailable",
          message: `"${args.client}" is not installed or not available. Available: ${availableClients
            .map((client) => client.getClientName())
            .join(", ")}`,
        });
      }
      selected = match;
    }

    const response = await selected.sendMessage(args.prompt, {
      workingDirectory: model.rootPath,
      agent: args.agent ?? "dr-architect",
      outputStream: null,
    });

    return jsonResult({
      status: "ok",
      client: selected.getClientName(),
      response,
    });
  });
}

export const chatLaunchTool: McpToolDefinition<ChatLaunchArgs> = {
  name: "chat_launch",
  description:
    "Send a single prompt to an installed AI coding agent (Claude Code or GitHub Copilot) in run-to-completion mode and return its full response.",
  inputSchema,
  handler: chatLaunchHandler,
};
