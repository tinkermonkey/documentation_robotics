/**
 * The DrBot launcher (server/dr-bot-launcher.ts), with a fake agent command
 * (tests/fixtures/mock-drbot-where.cjs) that reports its working directory and environment:
 * - each turn runs in its checkout, with DR_MCP_ROOT_PATH set to that checkout;
 * - conversations are keyed by {project, checkout, conversationId};
 * - at most maxTurns turns run at once, the rest wait and the chat says so;
 * - a removed checkout ends its running and queued turns.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Model } from "../../../src/core/model.js";
import { CheckoutContext } from "../../../src/server/checkout-context.js";
import {
  DrBotLauncher,
  drBotTurnCap,
  type DrBotTurnRequest,
} from "../../../src/server/dr-bot-launcher.js";
import { DEFAULT_DRBOT_TURN_CAP, DRBOT_TURN_CAP_ENV } from "../../../src/server/central-mcp-contract.js";
import { ClaudeCodeClient } from "../../../src/coding-agents/claude-code-client.js";
import { createFakeWs, waitFor } from "./helpers.js";

const fakeAgent = join(import.meta.dir, "../../fixtures/mock-drbot-where.cjs");

let scratch: string;
const contexts: CheckoutContext[] = [];

beforeAll(() => {
  scratch = join(tmpdir(), `dr-drbot-launcher-${randomUUID()}`);
  mkdirSync(scratch, { recursive: true });
});

afterAll(() => {
  for (const context of contexts) context.close();
  rmSync(scratch, { recursive: true, force: true });
});

/** A checkout of project "demo" in its own folder, with a model. */
async function checkout(name: string): Promise<CheckoutContext> {
  const rootPath = join(scratch, randomUUID(), name);
  mkdirSync(rootPath, { recursive: true });
  const model = await Model.init(rootPath, { name: "Launcher Test", version: "0.1.0" }, { lazyLoad: false });
  const context = new CheckoutContext({ project: "demo", checkout: name }, model);
  contexts.push(context);
  return context;
}

function launcher(options: { maxTurns?: number; hold?: string; stampCheckout?: boolean } = {}): DrBotLauncher {
  const drBot = new DrBotLauncher({
    withChangesets: true,
    maxTurns: options.maxTurns,
    stampCheckout: options.stampCheckout,
  });
  drBot.chatClient = new ClaudeCodeClient();
  drBot._testClaudeCmdOverride = ["node", fakeAgent, ...(options.hold ? ["--hold", options.hold] : [])];
  return drBot;
}

function request(
  context: CheckoutContext,
  ws: ReturnType<typeof createFakeWs>,
  conversationId: string,
  requestId: string,
  resumable = true
): DrBotTurnRequest {
  return { context, channel: ws, conversationId, message: "where are you?", requestId, resumable };
}

/** The send's final JSON-RPC answer (result or error). */
function answerTo(ws: ReturnType<typeof createFakeWs>, requestId: string): Promise<any> {
  return waitFor(() => ws.sent.find((m) => m.id === requestId && (m.result || m.error)));
}

function valueOf(args: string[] | undefined, flag: string): string | undefined {
  const index = args?.indexOf(flag) ?? -1;
  return index === -1 ? undefined : args![index + 1];
}

describe("DrBotLauncher", () => {
  it("runs each turn in its checkout, with DR_MCP_ROOT_PATH set to that checkout", async () => {
    const main = await checkout("main");
    const worktree = await checkout("feature-x");
    const drBot = launcher();
    const ws = createFakeWs();

    await drBot.startTurn(request(main, ws, "conv-1", "req-main"));
    await drBot.startTurn(request(worktree, ws, "conv-1", "req-worktree"));
    const fromMain = JSON.parse((await answerTo(ws, "req-main")).result.full_response);
    const fromWorktree = JSON.parse((await answerTo(ws, "req-worktree")).result.full_response);

    expect(realpathSync(fromMain.cwd)).toBe(realpathSync(main.rootPath));
    expect(fromMain.mcpRoot).toBe(main.rootPath);
    expect(fromMain.chatRoot).toBe(main.rootPath);
    expect(realpathSync(fromWorktree.cwd)).toBe(realpathSync(worktree.rootPath));
    expect(fromWorktree.mcpRoot).toBe(worktree.rootPath);
    expect(fromWorktree.chatRoot).toBe(worktree.rootPath);
    expect(drBot.runningTurns).toBe(0);
  });

  it("keys conversations by project, checkout and conversation id", async () => {
    const main = await checkout("main");
    const worktree = await checkout("feature-y");
    const drBot = launcher();
    const ws = createFakeWs();

    await drBot.startTurn(request(main, ws, "conv-shared", "req-1"));
    const firstArgs = drBot._testLastClaudeChatArgs;
    await answerTo(ws, "req-1");

    // The same conversation id in another checkout is another conversation: a new session.
    await drBot.startTurn(request(worktree, ws, "conv-shared", "req-2"));
    const otherArgs = drBot._testLastClaudeChatArgs;
    await answerTo(ws, "req-2");

    const mainSession = drBot.session({ project: "demo", checkout: "main", conversationId: "conv-shared" });
    const worktreeSession = drBot.session({ project: "demo", checkout: "feature-y", conversationId: "conv-shared" });
    expect(mainSession).toBeDefined();
    expect(worktreeSession).toBeDefined();
    expect(worktreeSession!.sessionId).not.toBe(mainSession!.sessionId);
    expect(valueOf(firstArgs, "--session-id")).toBe(mainSession!.sessionId);
    expect(valueOf(otherArgs, "--session-id")).toBe(worktreeSession!.sessionId);
    expect(otherArgs).not.toContain("--resume");

    // The conversation in its own checkout resumes its own session.
    await drBot.startTurn(request(main, ws, "conv-shared", "req-3"));
    expect(valueOf(drBot._testLastClaudeChatArgs, "--resume")).toBe(mainSession!.sessionId);
    await answerTo(ws, "req-3");
  });

  it("queues a turn over the cap, tells the chat, and starts it when a slot frees", async () => {
    const main = await checkout("main");
    const hold = join(scratch, `hold-${randomUUID()}`);
    const drBot = launcher({ maxTurns: 1, hold });
    const first = createFakeWs();
    const second = createFakeWs();

    expect(await drBot.startTurn(request(main, first, "conv-a", "req-a"))).toEqual({ status: "started" });
    expect(await drBot.startTurn(request(main, second, "conv-b", "req-b"))).toEqual({ status: "queued", position: 1 });
    expect(drBot.runningTurns).toBe(1);
    expect(drBot.queuedTurns).toBe(1);

    const queued = second.sent.find((m) => m.method === "chat.turn.queued");
    expect(queued.params).toMatchObject({ conversation_id: "conv-b", position: 1, running: 1, max_turns: 1 });
    expect(queued.params.message).toContain("Queued");
    expect(queued.params.message).toContain(DRBOT_TURN_CAP_ENV);
    expect(queued.params.message).toContain("1st in line");
    // The notice is not repeated as reply text: a client showing it would show it twice.
    expect(second.sent.filter((m) => m.method === "chat.response.chunk")).toEqual([]);

    // A send to the queued conversation is refused, like one to a running conversation.
    expect((await drBot.startTurn(request(main, second, "conv-b", "req-b2"))).status).toBe("refused");

    writeFileSync(hold, "");
    expect((await answerTo(first, "req-a")).result.status).toBe("complete");
    const started = await waitFor(() => second.sent.find((m) => m.method === "chat.turn.started"));
    expect(started.params.conversation_id).toBe("conv-b");
    expect(typeof started.params.waited_ms).toBe("number");
    expect(second.sent.some((m) => m.method === "chat.response.chunk" && String(m.params.content).includes("Starting now"))).toBe(false);
    expect((await answerTo(second, "req-b")).result.status).toBe("complete");
    await waitFor(() => drBot.runningTurns === 0);
    expect(drBot.queuedTurns).toBe(0);
  });

  it("cancels a queued turn before it starts", async () => {
    const main = await checkout("main");
    const hold = join(scratch, `hold-${randomUUID()}`);
    const drBot = launcher({ maxTurns: 1, hold });
    const ws = createFakeWs();

    await drBot.startTurn(request(main, ws, "conv-run", "req-run"));
    await drBot.startTurn(request(main, ws, "conv-wait", "req-wait"));
    expect(drBot.cancel(main, "conv-wait")).toEqual({ cancelled: true, conversation_id: "conv-wait" });
    expect((await answerTo(ws, "req-wait")).error.message).toContain("cancelled before it started");
    expect(drBot.queuedTurns).toBe(0);
    expect(main.busyChatConversations.has("conv-wait")).toBe(false);

    writeFileSync(hold, "");
    await answerTo(ws, "req-run");
    await waitFor(() => drBot.runningTurns === 0);
  });

  it("ends a removed checkout's running and queued turns, and forgets its conversations", async () => {
    const removed = await checkout("gone");
    const kept = await checkout("main");
    const hold = join(scratch, `hold-${randomUUID()}`);
    const drBot = launcher({ maxTurns: 1, hold });
    const ws = createFakeWs();

    await drBot.startTurn(request(removed, ws, "conv-running", "req-running"));
    await drBot.startTurn(request(removed, ws, "conv-queued", "req-queued"));
    await drBot.startTurn(request(kept, ws, "conv-kept", "req-kept"));
    expect(drBot.queuedTurns).toBe(2);
    await waitFor(() => removed.chatProcesses.size === 1);

    removed.close({ reason: "removed" });

    expect((await answerTo(ws, "req-queued")).error.message).toContain("was removed");
    // The running turn's agent is stopped; its slot goes to the other checkout's queued turn.
    expect((await answerTo(ws, "req-running")).result.status).toBe("error");
    expect(drBot.session({ project: "demo", checkout: "gone", conversationId: "conv-running" })).toBeUndefined();

    await waitFor(() => ws.sent.find((m) => m.method === "chat.turn.started" && m.params.conversation_id === "conv-kept"));
    expect(drBot.session({ project: "demo", checkout: "main", conversationId: "conv-kept" })).toBeDefined();
    writeFileSync(hold, "");
    expect((await answerTo(ws, "req-kept")).result.status).toBe("complete");
    await waitFor(() => drBot.runningTurns === 0);
  });

  it("names the checkout on every chat frame when asked (the central server)", async () => {
    const main = await checkout("main");
    const worktree = await checkout("feature-z");
    const hold = join(scratch, `hold-${randomUUID()}`);
    const drBot = launcher({ maxTurns: 1, hold, stampCheckout: true });
    const ws = createFakeWs();

    // One socket, the same conversation id in two checkouts: the second waits for the first.
    await drBot.startTurn(request(main, ws, "conv-same", "req-main"));
    await drBot.startTurn(request(worktree, ws, "conv-same", "req-worktree"));
    writeFileSync(hold, "");
    await answerTo(ws, "req-main");
    await answerTo(ws, "req-worktree");

    const frames = ws.sent.filter((m) => (m.params ?? m.result)?.conversation_id === "conv-same");
    const methods = new Set(frames.map((m) => m.method ?? "result"));
    for (const method of [
      "chat.response.chunk",
      "chat.response.complete",
      "chat.turn.queued",
      "chat.turn.started",
      "result",
    ]) {
      expect(methods.has(method)).toBe(true);
    }
    for (const frame of frames) {
      const part = frame.params ?? frame.result;
      expect(part.project).toBe("demo");
      expect(["main", "feature-z"]).toContain(part.checkout);
    }
    const resultFor = (id: string) => ws.sent.find((m) => m.id === id && m.result).result;
    expect(resultFor("req-main").checkout).toBe("main");
    expect(resultFor("req-worktree").checkout).toBe("feature-z");
    expect(JSON.parse(resultFor("req-worktree").full_response).mcpRoot).toBe(worktree.rootPath);
    const queued = ws.sent.find((m) => m.method === "chat.turn.queued");
    expect(queued.params.checkout).toBe("feature-z");
  });

  it("leaves chat frames as they were without it (a per-project server)", async () => {
    const main = await checkout("main");
    const drBot = launcher();
    const ws = createFakeWs();
    await drBot.startTurn(request(main, ws, "conv-plain", "req-plain"));
    await answerTo(ws, "req-plain");
    for (const frame of ws.sent) {
      expect((frame.params ?? frame.result)?.project).toBeUndefined();
    }
  });

  it("reads the cap from DR_DRBOT_MAX_TURNS, default 3", () => {
    expect(DEFAULT_DRBOT_TURN_CAP).toBe(3);
    expect(drBotTurnCap({})).toBe(3);
    expect(drBotTurnCap({ [DRBOT_TURN_CAP_ENV]: "5" })).toBe(5);
    expect(drBotTurnCap({ [DRBOT_TURN_CAP_ENV]: "0" })).toBe(3);
    expect(drBotTurnCap({ [DRBOT_TURN_CAP_ENV]: "two" })).toBe(3);
  });
});
