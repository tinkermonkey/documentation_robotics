/**
 * The checkout context pool (#1279, slice 1B): lazy loading through the resolver, eviction when
 * idle or past maxLoaded (least recently used first, never a context with a websocket subscriber
 * or a running DrBot turn), closing a removed checkout, and its settings from the environment.
 * (`testing.testcoveragetarget.context-eviction`, `testing.testcasesketch.context-eviction-sketch`)
 */

import { describe, expect, it } from "bun:test";
import type { ChildProcess } from "child_process";
import {
  DEFAULT_CONTEXT_POOL_SETTINGS,
  type CheckoutRef,
  type CheckoutResolver,
  type ContextPoolSettings,
} from "../../../src/core/checkout-types.js";
import type { Model } from "../../../src/core/model.js";
import { CHECKOUT_REMOVED_MESSAGE, CheckoutContext } from "../../../src/server/checkout-context.js";
import { CheckoutContextPool, contextPoolSettingsFromEnv } from "../../../src/server/checkout-context-pool.js";
import { createFakeWs } from "./helpers.js";

const ref = (checkout: string, project = "alpha"): CheckoutRef => ({ project, checkout });

/** A pool over fake checkouts: every ref in `known` resolves, contexts are made without a model on disk. */
function makePool(settings: Partial<ContextPoolSettings> = {}, known: string[] = ["main", "one", "two", "three"]) {
  let clock = 1_000_000;
  const resolved: string[] = [];
  const resolver: CheckoutResolver = async (r) => {
    resolved.push(r.checkout);
    if (!known.includes(r.checkout)) return null;
    const path = `/fake/${r.project}/${r.checkout}`;
    return {
      ref: r,
      modelPath: path,
      checkout: { key: r.checkout, path, branch: r.checkout, head: "abc", isMain: r.checkout === "main", state: "present", locked: false },
    };
  };
  const pool = new CheckoutContextPool({
    resolver,
    settings: { ...DEFAULT_CONTEXT_POOL_SETTINGS, ...settings },
    load: async (r) => new CheckoutContext(r.ref, { rootPath: r.modelPath } as Model),
    now: () => clock,
  });
  const advance = (ms: number) => {
    clock += ms;
  };
  return { pool, resolved, advance };
}

describe("CheckoutContextPool", () => {
  it("loads a context on first use only, and shares a load already under way", async () => {
    const { pool, resolved } = makePool();
    expect(pool.size).toBe(0);
    expect(resolved).toEqual([]);

    const [a, b] = await Promise.all([pool.acquire(ref("main")), pool.acquire(ref("main"))]);
    expect(a).toBe(b!);
    expect(await pool.acquire(ref("main"))).toBe(a!);
    expect(resolved).toEqual(["main"]);
    expect(pool.size).toBe(1);
    expect(a!.ref).toEqual(ref("main"));
  });

  it("refuses a checkout the resolver does not list", async () => {
    const { pool } = makePool();
    expect(await pool.acquire(ref("gone"))).toBeNull();
    expect(pool.size).toBe(0);
  });

  it("keeps contexts of different projects apart even with the same checkout key", async () => {
    const { pool } = makePool();
    const alpha = await pool.acquire(ref("main", "alpha"));
    const beta = await pool.acquire(ref("main", "beta"));
    expect(alpha).not.toBe(beta);
    expect(pool.size).toBe(2);
  });

  it("evicts the least recently used past maxLoaded", async () => {
    const { pool, advance } = makePool({ maxLoaded: 2 });
    const one = (await pool.acquire(ref("one")))!;
    advance(1000);
    await pool.acquire(ref("two"));
    advance(1000);
    await pool.acquire(ref("three"));

    expect(pool.loaded()).toEqual([ref("two"), ref("three")]);
    expect(one.closed).toBe(true);
  });

  it("counts every acquire as a use", async () => {
    const { pool, advance } = makePool({ maxLoaded: 2 });
    await pool.acquire(ref("one"));
    advance(1000);
    const two = (await pool.acquire(ref("two")))!;
    advance(1000);
    await pool.acquire(ref("one"));
    advance(1000);
    await pool.acquire(ref("three"));

    expect(pool.loaded()).toEqual([ref("one"), ref("three")]);
    expect(two.closed).toBe(true);
  });

  it("never evicts a context with a websocket subscriber", async () => {
    const { pool, advance } = makePool({ maxLoaded: 2 });
    const one = (await pool.acquire(ref("one")))!;
    one.subscribers.add(createFakeWs());
    advance(1000);
    const two = (await pool.acquire(ref("two")))!;
    advance(1000);
    await pool.acquire(ref("three"));

    expect(one.closed).toBe(false);
    expect(two.closed).toBe(true);
    expect(pool.loaded()).toEqual([ref("one"), ref("three")]);
  });

  it("never evicts a context with a running DrBot turn", async () => {
    const { pool, advance } = makePool({ maxLoaded: 2 });
    const one = (await pool.acquire(ref("one")))!;
    one.busyChatConversations.set("conv-1", Symbol("turn"));
    advance(1000);
    await pool.acquire(ref("two"));
    advance(1000);
    await pool.acquire(ref("three"));

    expect(one.closed).toBe(false);
    expect(pool.peek(ref("two"))).toBeUndefined();

    // Once the turn ends, it is the least recently used again.
    one.busyChatConversations.clear();
    advance(1000);
    await pool.acquire(ref("two"));
    expect(one.closed).toBe(true);
    expect(pool.loaded()).toEqual([ref("three"), ref("two")]);
  });

  it("stays above maxLoaded while every other context is busy, but keeps the one being acquired", async () => {
    const { pool, advance } = makePool({ maxLoaded: 1 });
    const one = (await pool.acquire(ref("one")))!;
    one.subscribers.add(createFakeWs());
    advance(1000);
    const two = (await pool.acquire(ref("two")))!;

    expect(pool.size).toBe(2);
    expect(one.closed).toBe(false);
    expect(two.closed).toBe(false);
  });

  it("evicts contexts idle for idleMinutes, unless busy", async () => {
    const { pool, advance } = makePool({ idleMinutes: 30 });
    const one = (await pool.acquire(ref("one")))!;
    const two = (await pool.acquire(ref("two")))!;
    two.subscribers.add(createFakeWs());
    advance(29 * 60_000);
    expect(await pool.evict()).toEqual([]);

    const three = (await pool.acquire(ref("three")))!;
    advance(60_000);
    expect(await pool.evict()).toEqual([{ ref: ref("one"), reason: "idle" }]);
    expect(one.closed).toBe(true);
    expect(two.closed).toBe(false);
    expect(three.closed).toBe(false);
  });

  it("an evicted checkout loads again on its next use", async () => {
    const { pool, resolved, advance } = makePool({ idleMinutes: 1 });
    const first = (await pool.acquire(ref("one")))!;
    advance(2 * 60_000);
    await pool.evict();
    const second = (await pool.acquire(ref("one")))!;
    expect(second).not.toBe(first);
    expect(second.closed).toBe(false);
    expect(resolved).toEqual(["one", "one"]);
  });

  it("closes a removed checkout: tells its subscribers, ends its DrBot turns, drops it even when busy", async () => {
    const { pool } = makePool();
    const ctx = (await pool.acquire(ref("one")))!;
    const ws = createFakeWs();
    let closedSockets = 0;
    ws.close = () => void closedSockets++;
    ctx.subscribers.add(ws);
    const signals: string[] = [];
    const proc = { kill: (signal: string) => void signals.push(signal) } as unknown as ChildProcess;
    ctx.chatProcesses.set("conv-1", proc);
    ctx.busyChatConversations.set("conv-1", Symbol("turn"));

    expect(pool.close(ref("one"))).toBe(true);

    expect(ws.sent).toEqual([
      expect.objectContaining({ type: CHECKOUT_REMOVED_MESSAGE, project: "alpha", checkout: "one" }),
    ]);
    expect(closedSockets).toBe(1);
    expect(signals).toEqual(["SIGTERM"]);
    expect(ctx.cancelledChatProcesses.has(proc)).toBe(true);
    expect(ctx.hasRunningTurn()).toBe(false);
    expect(ctx.subscribers.size).toBe(0);
    expect(pool.peek(ref("one"))).toBeUndefined();
    expect(pool.close(ref("one"))).toBe(false);
  });

  it("stop closes every context", async () => {
    const { pool } = makePool();
    const one = (await pool.acquire(ref("one")))!;
    const two = (await pool.acquire(ref("two")))!;
    pool.startSweeping(10_000);
    pool.stop();
    expect(pool.size).toBe(0);
    expect(one.closed && two.closed).toBe(true);
  });
});

describe("contextPoolSettingsFromEnv", () => {
  it("defaults to the shared contract's settings", () => {
    expect(contextPoolSettingsFromEnv({})).toEqual({ maxLoaded: 4, idleMinutes: 30 });
  });

  it("reads DR_SERVER_MAX_LOADED and DR_SERVER_IDLE_MINUTES", () => {
    expect(contextPoolSettingsFromEnv({ DR_SERVER_MAX_LOADED: "8", DR_SERVER_IDLE_MINUTES: "5" })).toEqual({
      maxLoaded: 8,
      idleMinutes: 5,
    });
  });

  it("keeps the default for a value that is not a positive whole number", () => {
    expect(contextPoolSettingsFromEnv({ DR_SERVER_MAX_LOADED: "0", DR_SERVER_IDLE_MINUTES: "soon" })).toEqual(
      DEFAULT_CONTEXT_POOL_SETTINGS
    );
  });
});
