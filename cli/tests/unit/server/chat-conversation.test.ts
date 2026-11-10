/**
 * chat.send conversation memory: a send that names a conversation_id runs in that
 * conversation's Claude Code session (--session-id on the first send, --resume after),
 * a new id starts a new session, and a send without one runs fresh as before.
 * The mock-claude-stream fixture stands in for the claude binary.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, spyOn } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Model } from "../../../src/core/model.js";
import { VisualizationServer } from "../../../src/server/server.js";
import { ClaudeCodeClient } from "../../../src/coding-agents/claude-code-client.js";
import { createFakeWs, waitFor } from "./helpers.js";

const mockClaude = join(import.meta.dir, "../../fixtures/mock-claude-stream.cjs");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let scratch: string;
const servers: VisualizationServer[] = [];

beforeAll(() => {
  scratch = join(tmpdir(), `dr-chat-conv-${randomUUID()}`);
  mkdirSync(scratch, { recursive: true });
});

afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

async function createServer(cmd: string[] = ["node", mockClaude]): Promise<VisualizationServer> {
  const dir = join(scratch, randomUUID());
  mkdirSync(dir, { recursive: true });
  const model = await Model.init(dir, { name: "Chat Conversation Test", version: "0.1.0" }, { lazyLoad: false });

  // Keep the server from detecting the real chat CLIs, which would race the client set below.
  const detect = spyOn(VisualizationServer.prototype as any, "initializeChatClients").mockResolvedValue(undefined);
  const server = new VisualizationServer(model, { authEnabled: false });
  detect.mockRestore();

  (server as any).selectedChatClient = new ClaudeCodeClient();
  (server as any)._testClaudeCmdOverride = cmd;
  servers.push(server);
  return server;
}

/** Sends chat.send over the JSON-RPC handler and waits for its response. */
async function send(server: VisualizationServer, params: Record<string, unknown>): Promise<{ response: any; args: string[] }> {
  const ws = createFakeWs();
  const id = `req-${randomUUID()}`;
  await (server as any).handleJSONRPCMessage(ws, { jsonrpc: "2.0", method: "chat.send", params, id });
  const response = await waitFor(() => ws.sent.find((m) => m.id === id && (m.result || m.error)));
  return { response, args: [...((server as any)._testLastClaudeChatArgs ?? [])] };
}

function valueOf(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe("chat.send conversation_id", () => {
  it("starts the session with --session-id on the first send and resumes it on the second", async () => {
    const server = await createServer();

    const first = await send(server, { message: "What does api.operation.x do?", conversation_id: "conv-a" });
    expect(first.response.result.status).toBe("complete");
    expect(first.response.result.conversation_id).toBe("conv-a");
    const sessionId = valueOf(first.args, "--session-id");
    expect(sessionId).toMatch(UUID);
    expect(first.args).not.toContain("--resume");

    const second = await send(server, { message: "And its references?", conversation_id: "conv-a" });
    expect(valueOf(second.args, "--resume")).toBe(sessionId);
    expect(second.args).not.toContain("--session-id");

    const third = await send(server, { message: "Thanks", conversation_id: "conv-a" });
    expect(valueOf(third.args, "--resume")).toBe(sessionId);
  });

  it("starts a fresh session for a new conversation id", async () => {
    const server = await createServer();

    const first = await send(server, { message: "Hello", conversation_id: "conv-1" });
    await send(server, { message: "More", conversation_id: "conv-1" });
    const fresh = await send(server, { message: "New topic", conversation_id: "conv-2" });

    const newSession = valueOf(fresh.args, "--session-id");
    expect(newSession).toMatch(UUID);
    expect(newSession).not.toBe(valueOf(first.args, "--session-id"));
    expect(fresh.args).not.toContain("--resume");
  });

  it("runs a send without conversation_id in a fresh session, as before", async () => {
    const server = await createServer();

    const first = await send(server, { message: "Hello" });
    const second = await send(server, { message: "Again" });

    for (const { args } of [first, second]) {
      expect(args).not.toContain("--session-id");
      expect(args).not.toContain("--resume");
    }
    expect(first.response.result.conversation_id).not.toBe(second.response.result.conversation_id);
  });

  it("keeps --session-id when the first send failed before Claude Code created the session", async () => {
    const server = await createServer(["node", "-e", "process.exit(3)"]);

    const first = await send(server, { message: "Hello", conversation_id: "conv-fail" });
    expect(first.response.result.status).toBe("error");

    (server as any)._testClaudeCmdOverride = ["node", mockClaude];
    const retry = await send(server, { message: "Hello again", conversation_id: "conv-fail" });
    expect(valueOf(retry.args, "--session-id")).toBe(valueOf(first.args, "--session-id"));
    expect(retry.args).not.toContain("--resume");
  });

  it("resumes after a failed first send once Claude Code reported the session", async () => {
    const server = await createServer(["node", mockClaude, "--emit-init", "--exit-code", "1"]);

    const first = await send(server, { message: "Hello", conversation_id: "conv-init" });
    expect(first.response.result.status).toBe("error");

    const second = await send(server, { message: "Again", conversation_id: "conv-init" });
    expect(valueOf(second.args, "--resume")).toBe(valueOf(first.args, "--session-id"));
  });

  it("rejects a conversation_id that isn't a non-empty string", async () => {
    const server = await createServer();

    for (const conversation_id of ["", "   ", 42, "x".repeat(201)]) {
      const { response } = await send(server, { message: "Hello", conversation_id });
      expect(response.error.code).toBe(-32602);
    }
  });
});
