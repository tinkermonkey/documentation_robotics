/**
 * Tier 1's result types (TIER1_DESIGN.md section 3.3): a card's decision, the run's numbers, and
 * the `tier1` block a run reports (section 2.4).
 */
import type { Band, Thresholds, Tier1Mode } from "./bands.js";

/**
 * Where Tier 1 stands for a run (section 2.4): `off` (no `tier1.json`), `misconfigured`,
 * `no-credentials`, `on`, `unavailable` (the provider failed), `capped` (the month's cap is
 * reached), `warming` (on, while the `codebase_index` job's cache fill runs; section 4.4).
 */
export type Tier1State = "off" | "misconfigured" | "no-credentials" | "on" | "unavailable" | "capped" | "warming";

/**
 * The `codebase_index` job's Tier-1 cache fill (section 4.4), as its job record and the warming
 * views show it. Never holds a key, an account id or a notice naming one.
 *
 * - `running`: the `classifying` phase is under way.
 * - `done`: every card was answered from the cache or asked.
 * - `stopped`: it ended early on its own terms (`stoppedBy`: the cap, or the provider unavailable);
 *   the index is still done.
 * - `cancelled`: the job was stopped (a forced or newer index run); what it asked is cached.
 * - `skipped`: opted in but not ready (misconfigured, no credentials, the cap reached): nothing sent.
 * - `failed`: an error of DR's own, or the process died; the index is still done.
 */
export interface Tier1Fill {
  state: "running" | "done" | "stopped" | "cancelled" | "skipped" | "failed";
  /** Why it was skipped, stopped, cancelled or failed. */
  reason?: string;
  stoppedBy?: "cap" | "unavailable" | "cancelled";
  provider?: string;
  model?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  /** Tier-1 cards done (answered from the cache, asked, or skipped) of those Tier 0 left undecided; null until they are built. */
  cards: { done: number; total: number } | null;
  /** Sent to the provider: `sent` (answered and cached) plus `failed`. */
  asked?: number;
  cached: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Spent so far by this fill (also in the ledger, source `index`). */
  costUsd: number;
  /**
   * Made before the first request: cards without a cached answer (`misses`), how many of them the
   * month's remainder covers (`cards`), their estimated cost and time (section 4.4).
   */
  estimate?: { misses: number; cards: number; costUsd: number; seconds: number };
  /** While running: about how many seconds are left, from the rate so far (or the estimate). */
  etaSeconds?: number;
  /** When finished: the month's spend against the cap. */
  month?: Tier1Month;
  /** The run's output folder (`.dr/analyzers/<analyzer>/classify/<run-id>`), relative to the project root. */
  run?: string;
  durationMs?: number;
}

/** What `warming` adds to a status or a run's block: the fill's progress (section 4.4). */
export interface Tier1Warming {
  jobId: string;
  startedAt: string;
  cards: { done: number; total: number } | null;
  costUsd: number;
  etaSeconds?: number;
}

/** Why a run stopped asking the provider (section 4.6). */
/** `payment`: no credits, or a spending budget on the provider's side is spent. */
export type Tier1Unavailable = "auth" | "payment" | "provider" | "routing" | "api";

/** One card's Tier-1 decision. */
export interface Tier1Decision {
  band: Band;
  /** `answered` (from the provider or the cache), `failed` (asked, no usable answer) or `skipped` (not asked). */
  status: "answered" | "failed" | "skipped";
  /** The chosen layer (`none` for not an element), or null without an answer. */
  layer: string | null;
  /** The chosen element type within the layer, or null. */
  type: string | null;
  p: { layer: number | null; type: number | null };
  /** Up to two runners-up: `layer.type p` within the chosen layer, then `layer p`. */
  alt?: string[];
  /** Stage 1's significance score (0-4). */
  significance?: number;
  /** Concerns answered yes (p >= 0.5). */
  concerns?: string[];
  /** Answered from the cache. */
  cached: boolean;
  /** Why a failed or skipped card has no answer. */
  reason?: string;
  servedBy?: { upstream?: string; model?: string };
}

/** The card hint (section 1.3): what an agent is shown. */
export interface Tier1Hint {
  band: Band;
  layer: string | null;
  type: string | null;
  p: { layer: number | null; type: number | null };
  alt?: string[];
  significance?: number;
  concerns?: string[];
  /** Why a card Tier 1 couldn't answer (failed, or not asked) has no answer. */
  reason?: string;
}

/** The numbers of one `classifyTier1` run. */
export interface Tier1RunStats {
  /** `on`, `capped` (cards went unasked because of the cap) or `unavailable` (the provider stopped the run). */
  state: "on" | "capped" | "unavailable";
  unavailable?: { kind: Tier1Unavailable; reason: string };
  /** Cards Tier 1 was given. */
  cards: number;
  /** Answered from the cache. */
  cached: number;
  /** Asked of the provider and answered. */
  sent: number;
  /** Asked, no usable answer (they escalate). */
  failed: number;
  /** Not asked (they escalate), by reason. */
  skipped: number;
  /** `cacheOnly`: the run answered from the cache alone (`codebase_extract` with `acceptTier1`). */
  skippedFor: { cap: number; deadline: number; unavailable: number; cacheOnly: number };
  bands: { accept: number; notElement: number; escalate: number };
  costUsd: number;
  inputTokens: number;
  /** Responses per serving upstream or model, for the notice. */
  servedBy: Record<string, number>;
  /**
   * Cards per upstream a response named (OpenRouter), whatever came of them: answered, unusable,
   * refused, or served from outside the allowed upstreams. Every party that received card text.
   */
  receivedBy?: Record<string, number>;
  /** Of {@link receivedBy}: cards answered by an upstream outside the allowed ones (the run stopped at the first). */
  outside?: Record<string, number>;
  /**
   * The served model changed: this run's responses named a model that no cached entry of the same
   * host and model recorded (OpenRouter resolving an id to a new dated version, say).
   */
  modelChange?: { cached: string[]; fresh: string[] };
  durationMs: number;
  /** The pool's size at the start and the end (a 429 halves it). */
  concurrency: { start: number; end: number };
  /** Cache lines repaired and operations that failed (neither is an error for the run). */
  cache: { repaired: number; errors: number };
}

/** The month's spend against the cap (section 4.3). */
export interface Tier1Month {
  spentUsd: number;
  capUsd: number;
  remainingUsd: number;
  /** ISO time the window resets (the first of next month, 00:00 UTC). */
  resetsAt: string;
  /** Cards asked this month. */
  cards: number;
}

/** OpenRouter's routing, as every request sends it (section 3.2): the allowed upstreams, never fallbacks, no data collection. */
export interface Tier1Routing {
  only: string[];
  allowFallbacks: false;
  dataCollection: "deny";
  zdr?: true;
}

/** The `tier1` block of a run's report (section 2.4). Never holds a key. */
export interface Tier1Block {
  state: Tier1State;
  /** Why Tier 1 is off, misconfigured, without credentials or unavailable. */
  reason?: string;
  provider?: string;
  model?: string;
  /** OpenRouter: the routing every request carried. */
  routing?: Tier1Routing;
  qset?: string;
  mode?: Tier1Mode;
  thresholds?: (Thresholds & { source: "default" | "override"; fit: "in-sample" | "held-out" | "override" }) | null;
  cards?: number;
  cached?: number;
  sent?: number;
  failed?: number;
  skipped?: number;
  bands?: { accept: number; notElement: number; escalate: number };
  /** `codebase_extract`: accept-band elements this run staged (only with `acceptTier1`, in suggest mode). */
  staged?: number;
  /** `codebase_extract` with `debug.applyNotElement`: not-element cards recorded as not elements. */
  notElementRecorded?: number;
  costUsd?: number;
  month?: Tier1Month;
  servedBy?: Record<string, number>;
  durationMs?: number;
  cache?: { repaired: number; errors: number };
  /** State `warming`: the index job's cache fill, as far as it has got. */
  warming?: Tier1Warming;
  /** Said to the user: who received card text and why, the month's spend, and any warning. */
  notice: string;
  warnings?: string[];
}
