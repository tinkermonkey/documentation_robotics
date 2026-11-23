/**
 * The server's checkout contexts, loaded on first use and evicted when idle or when the pool is
 * full (issue 1279, `docs/design/USER_LEVEL_DR.md` section 7, "Lazy loading and eviction").
 * (`application.applicationcomponent.checkout-context-pool`)
 *
 * The pool finds checkouts through an injected `CheckoutResolver`: the project registry provides
 * the real one (slice 2), tests a fake. Eviction drops memory only: everything durable is
 * already in the checkout's files.
 */

import {
  DEFAULT_CONTEXT_POOL_SETTINGS,
  type CheckoutRef,
  type CheckoutResolver,
  type ContextPoolSettings,
  type ResolvedCheckout,
} from "../core/checkout-types.js";
import { getErrorMessage } from "../utils/errors.js";
import { CheckoutContext, checkoutKey } from "./checkout-context.js";

export const MAX_LOADED_ENV = "DR_SERVER_MAX_LOADED";
export const IDLE_MINUTES_ENV = "DR_SERVER_IDLE_MINUTES";

/**
 * The pool's limits: the defaults in checkout-types.ts, overridden by DR_SERVER_MAX_LOADED and
 * DR_SERVER_IDLE_MINUTES. A value that is not a positive whole number is refused with a
 * warning naming it, and the default is used.
 */
export function contextPoolSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): ContextPoolSettings {
  const read = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      console.warn(`[Checkout pool] Ignoring ${name}=${raw}: not a positive whole number. Using ${fallback}.`);
      return fallback;
    }
    return value;
  };
  return {
    maxLoaded: read(MAX_LOADED_ENV, DEFAULT_CONTEXT_POOL_SETTINGS.maxLoaded),
    idleMinutes: read(IDLE_MINUTES_ENV, DEFAULT_CONTEXT_POOL_SETTINGS.idleMinutes),
  };
}

export type EvictionReason = "idle" | "capacity";

export interface Eviction {
  ref: CheckoutRef;
  reason: EvictionReason;
}

export interface CheckoutContextPoolOptions {
  resolver: CheckoutResolver;
  /** Default: contextPoolSettingsFromEnv(). */
  settings?: ContextPoolSettings;
  /** Makes a context for a resolved checkout. Default: CheckoutContext.load from its model path. */
  load?: (resolved: ResolvedCheckout) => Promise<CheckoutContext>;
  /** The clock, for tests. */
  now?: () => number;
}

export class CheckoutContextPool {
  readonly settings: Readonly<ContextPoolSettings>;
  private readonly resolver: CheckoutResolver;
  private readonly load: (resolved: ResolvedCheckout) => Promise<CheckoutContext>;
  private readonly now: () => number;
  private readonly contexts = new Map<string, CheckoutContext>();
  /** Loads under way, so two requests for one checkout share one load. */
  private readonly loading = new Map<string, Promise<CheckoutContext | null>>();
  private sweeper?: ReturnType<typeof setInterval>;

  constructor(options: CheckoutContextPoolOptions) {
    this.resolver = options.resolver;
    this.settings = Object.freeze({ ...(options.settings ?? contextPoolSettingsFromEnv()) });
    this.load = options.load ?? ((resolved) => CheckoutContext.load(resolved.ref, resolved.modelPath));
    this.now = options.now ?? Date.now;
  }

  /** How many contexts are loaded. */
  get size(): number {
    return this.contexts.size;
  }

  /** The loaded context for a checkout, without loading or touching it. */
  peek(ref: CheckoutRef): CheckoutContext | undefined {
    return this.contexts.get(checkoutKey(ref));
  }

  /** The refs of the loaded contexts, least recently used first. */
  loaded(): CheckoutRef[] {
    return this.byLeastRecentUse().map((ctx) => ctx.ref);
  }

  /**
   * The context for a checkout, loading its model on first use. Null when the resolver does not
   * list the checkout (unknown project or checkout, or not present on disk). Each acquire counts
   * as a use; loading one may evict another past maxLoaded.
   * (`application.applicationfunction.acquire-checkout-context`)
   */
  async acquire(ref: CheckoutRef): Promise<CheckoutContext | null> {
    const key = checkoutKey(ref);
    const loaded = this.contexts.get(key);
    if (loaded) {
      loaded.touch(this.now());
      return loaded;
    }
    const pending = this.loading.get(key);
    if (pending) return pending;

    const load = (async () => {
      const resolved = await this.resolver(ref);
      if (!resolved) return null;
      const context = await this.load(resolved);
      context.touch(this.now());
      this.contexts.set(key, context);
      await this.evict({ keep: context });
      return context;
    })();
    this.loading.set(key, load);
    try {
      return await load;
    } finally {
      this.loading.delete(key);
    }
  }

  /**
   * Closes the contexts idle for idleMinutes, then the least recently used ones past maxLoaded.
   * A context with a websocket subscriber or a running DrBot turn is never evicted, so the pool
   * may stay above maxLoaded while they are busy. `keep` (the context being acquired) is never
   * evicted for capacity either.
   * (`application.applicationfunction.evict-checkout-contexts`)
   */
  async evict(options: { keep?: CheckoutContext } = {}): Promise<Eviction[]> {
    const now = this.now();
    const idleMs = this.settings.idleMinutes * 60_000;
    const evicted: Eviction[] = [];

    for (const ctx of this.byLeastRecentUse()) {
      if (ctx.isBusy() || now - ctx.lastUsedAt < idleMs) continue;
      evicted.push(this.drop(ctx, "idle"));
    }
    for (const ctx of this.byLeastRecentUse()) {
      if (this.contexts.size <= this.settings.maxLoaded) break;
      if (ctx.isBusy() || ctx === options.keep) continue;
      evicted.push(this.drop(ctx, "capacity"));
    }
    for (const eviction of evicted) await recordEviction(eviction, this.contexts.size);
    return evicted;
  }

  /**
   * Closes a removed checkout's context: ends its DrBot turns, tells its subscribers the
   * checkout is gone and drops it from the pool, busy or not. False when it was not loaded.
   * (`application.applicationfunction.close-checkout-context`)
   */
  close(ref: CheckoutRef): boolean {
    const key = checkoutKey(ref);
    const ctx = this.contexts.get(key);
    if (!ctx) return false;
    this.contexts.delete(key);
    ctx.close({ reason: "removed" });
    return true;
  }

  /** Runs evict every intervalMs (default one minute) until stop. The timer doesn't hold the process open. */
  startSweeping(intervalMs: number = 60_000): void {
    this.stopSweeping();
    this.sweeper = setInterval(() => {
      this.evict().catch((error) => {
        console.warn(`[Checkout pool] Eviction failed: ${getErrorMessage(error)}`);
      });
    }, intervalMs);
    this.sweeper.unref?.();
  }

  stopSweeping(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = undefined;
  }

  /** Stops sweeping and closes every context (the server is stopping). */
  stop(options: { processExiting?: boolean } = {}): void {
    this.stopSweeping();
    for (const ctx of this.contexts.values()) {
      ctx.close({ reason: "stopped", processExiting: options.processExiting });
    }
    this.contexts.clear();
  }

  private byLeastRecentUse(): CheckoutContext[] {
    return [...this.contexts.values()].sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  }

  private drop(ctx: CheckoutContext, reason: EvictionReason): Eviction {
    this.contexts.delete(ctx.key);
    ctx.close({ reason: "evicted" });
    return { ref: ctx.ref, reason };
  }
}

/** The `checkout_context.evict` span (`apm.span.checkout-context-evict`), when telemetry is built in. */
async function recordEviction(eviction: Eviction, loaded: number): Promise<void> {
  // @ts-ignore - TELEMETRY_ENABLED is a global constant defined at build time
  const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;
  if (!isTelemetryEnabled) return;
  try {
    const { startSpan, endSpan } = await import("../telemetry/index.js");
    endSpan(
      startSpan("checkout_context.evict", {
        "dr.project": eviction.ref.project,
        "dr.checkout": eviction.ref.checkout,
        reason: eviction.reason,
        loaded,
      })
    );
  } catch (error) {
    console.warn(`[Telemetry] Failed to record checkout eviction: ${getErrorMessage(error)}`);
  }
}
