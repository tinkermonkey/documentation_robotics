/**
 * chat.send conversation memory: a send that names a conversation_id runs in that
 * conversation's Claude Code session (--session-id on the first send, --resume after),
 * a new id starts a new session, and a send without one runs fresh as before.
 * The mock-claude-stream fixture stands in for the claude binary.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Model } from "../../../src/core/model.js";
import { VisualizationServer } from "../../../src/server/server.js";
import { ClaudeCodeClient } from "../../../src/coding-agents/claude-code-client.js";
import { createFakeWs, createServerWithoutChatDetection, waitFor } from "./helpers.js";

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
  const server = createServerWithoutChatDetection(model, { authEnabled: false });

  (server as any).selectedChatClient = new ClaudeCodeClient();
  (server as any)._testClaudeCmdOverride = cmd;
  // An empty Claude Code config dir: no session exists on disk unless a test writes one.
  const configDir = join(dir, ".claude-config");
  mkdirSync(configDir, { recursive: true });
  (server as any)._testClaudeConfigDir = configDir;
  servers.push(server);
  return server;
}

/** Sends a JSON-RPC request over the handler without waiting for its response. */
async function request(server: VisualizationServer, ws: ReturnType<typeof createFakeWs>, method: string, params: Record<string, unknown>) {
  const id = `req-${randomUUID()}`;
  await (server as any).handleJSONRPCMessage(ws, { jsonrpc: "2.0", method, params, id });
  return id;
}

/** A command that prints one stream-json tool_use, then runs until it is killed. */
const HANGS_IN_TOOL = [
  "node",
  "-e",
  'process.stdout.write(JSON.stringify({type:"assistant",message:{content:[{type:"tool_use",id:"tool_slow",name:"Bash",input:{command:"dr list api"}}]}})+"\\n"); setTimeout(() => {}, 30000);',
];

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

describe("chat turns in one conversation", () => {
  it("keeps a cancelled conversation busy until its process exits, and tracks the next turn", async () => {
    const server = await createServer(HANGS_IN_TOOL);
    const active: Map<string, unknown> = (server as any).activeChatProcesses;
    const ws = createFakeWs();

    const firstId = await request(server, ws, "chat.send", { message: "Hello", conversation_id: "conv-c" });
    await waitFor(() => ws.sent.find((m) => m.params?.tool_use_id === "tool_slow"));
    const oldProc = active.get("conv-c");

    const cancelId = await request(server, ws, "chat.cancel", { conversation_id: "conv-c" });
    expect(ws.sent.find((m) => m.id === cancelId).result).toMatchObject({ cancelled: true, conversation_id: "conv-c" });
    // The entry stays until the killed process has exited
    expect(active.get("conv-c")).toBe(oldProc);

    // A resend before the old process has exited is refused, not run beside it
    const earlyId = await request(server, ws, "chat.send", { message: "Again", conversation_id: "conv-c" });
    expect(ws.sent.find((m) => m.id === earlyId).error.code).toBe(-32602);

    // Once the old turn has ended, the next send runs and its process is tracked
    await waitFor(() => ws.sent.find((m) => m.id === firstId && m.result));
    expect(active.has("conv-c")).toBe(false);
    (server as any)._testClaudeCmdOverride = ["node", "-e", "setTimeout(() => {}, 600)"];
    const nextId = await request(server, ws, "chat.send", { message: "Again", conversation_id: "conv-c" });
    const newProc = active.get("conv-c");
    expect(newProc).toBeDefined();
    expect(newProc).not.toBe(oldProc);
    const next = await waitFor(() => ws.sent.find((m) => m.id === nextId && (m.result || m.error)));
    expect(next.result.status).toBe("complete");
    expect(active.has("conv-c")).toBe(false);
  });

  it("sends nothing more for a cancelled turn, not even failed tools", async () => {
    const server = await createServer(HANGS_IN_TOOL);
    const ws = createFakeWs();

    const sendId = await request(server, ws, "chat.send", { message: "Hello", conversation_id: "conv-quiet" });
    await waitFor(() => ws.sent.find((m) => m.params?.tool_use_id === "tool_slow"));
    const cancelId = await request(server, ws, "chat.cancel", { conversation_id: "conv-quiet" });
    const afterCancel = ws.sent.findIndex((m) => m.id === cancelId);

    await waitFor(() => ws.sent.find((m) => m.id === sendId && m.result));
    const later = ws.sent.slice(afterCancel + 1).filter((m) => m.method);
    expect(later).toEqual([]);
    expect(ws.sent.filter((m) => m.params?.status === "failed")).toEqual([]);
  });

  it("refuses the second of two quick sends in one conversation", async () => {
    const server = await createServer();
    // Prepare DrBot's MCP config for real (in scratch dirs), so each send awaits before spawning.
    const base = join(scratch, randomUUID());
    mkdirSync(join(base, "tmp"), { recursive: true });
    mkdirSync(join(base, "home"), { recursive: true });
    (server as any)._testDrMcpOptions = {
      tempRoot: join(base, "tmp"),
      homeDir: join(base, "home"),
      drCommand: { command: "dr", args: [] },
    };
    const ws = createFakeWs();

    const [a, b] = await Promise.all([
      request(server, ws, "chat.send", { message: "One", conversation_id: "conv-race" }),
      request(server, ws, "chat.send", { message: "Two", conversation_id: "conv-race" }),
    ]);
    const first = await waitFor(() => ws.sent.find((m) => m.id === a && (m.result || m.error)));
    const second = await waitFor(() => ws.sent.find((m) => m.id === b && (m.result || m.error)));

    expect(first.result.status).toBe("complete");
    expect(second.error.code).toBe(-32602);
    // The refused send didn't hold the conversation: the next one runs
    const third = await send(server, { message: "Three", conversation_id: "conv-race" });
    expect(third.response.result.status).toBe("complete");
  });

  it("releases the conversation when a launch fails", async () => {
    const server = await createServer(["/nonexistent/claude-binary"]);

    const first = await send(server, { message: "Hello", conversation_id: "conv-enoent" });
    expect(first.response.error).toBeDefined();

    (server as any)._testClaudeCmdOverride = ["node", mockClaude];
    const second = await send(server, { message: "Again", conversation_id: "conv-enoent" });
    expect(second.response.result.status).toBe("complete");
  });
});

describe("a session Claude Code already has", () => {
  it("retries once with --resume when --session-id is already in use", async () => {
    const stateFile = join(scratch, `${randomUUID()}.runs`);
    const server = await createServer(["node", join(import.meta.dir, "../../fixtures/mock-claude-session-in-use.cjs"), stateFile]);

    const { response, args } = await send(server, { message: "Hello", conversation_id: "conv-in-use" });

    expect(response.result.status).toBe("complete");
    expect(readFileSync(stateFile, "utf-8")).toBe("2");
    const session = (server as any).chatSessions.get("conv-in-use");
    expect(session.started).toBe(true);
    expect(valueOf(args, "--resume")).toBe(session.sessionId);

    const next = await send(server, { message: "Again", conversation_id: "conv-in-use" });
    expect(valueOf(next.args, "--resume")).toBe(session.sessionId);
  });

  it("resumes when an earlier failed send left the session file on disk", async () => {
    const server = await createServer(["node", "-e", "process.exit(3)"]);

    const first = await send(server, { message: "Hello", conversation_id: "conv-on-disk" });
    expect(first.response.result.status).toBe("error");
    const sessionId = valueOf(first.args, "--session-id")!;

    // Claude Code keeps a session at <config>/projects/<cwd, non-alphanumerics as "-">/<id>.jsonl
    const rootPath: string = (server as any).model.rootPath;
    const projectDir = join(
      (server as any)._testClaudeConfigDir,
      "projects",
      realpathSync(rootPath).replace(/[^a-zA-Z0-9]/g, "-")
    );
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), "");

    (server as any)._testClaudeCmdOverride = ["node", mockClaude];
    const second = await send(server, { message: "Again", conversation_id: "conv-on-disk" });
    expect(valueOf(second.args, "--resume")).toBe(sessionId);
    expect(second.args).not.toContain("--session-id");
  });
});
