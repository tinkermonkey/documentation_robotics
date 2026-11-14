/**
 * Tier 1's result types (TIER1_DESIGN.md section 3.3): a card's decision, the run's numbers, and
 * the `tier1` block a run reports (section 2.4).
 */
import type { Band, Thresholds, Tier1Mode } from "./bands.js";

/**
 * Where Tier 1 stands for a run (section 2.4): `off` (no `tier1.json`), `misconfigured`,
 * `no-credentials`, `on`, `unavailable` (the provider failed), `capped` (the month's cap is
 * reached). `warming` (the index job's cache fill) is rollout PR 7.
 */
export type Tier1State = "off" | "misconfigured" | "no-credentials" | "on" | "unavailable" | "capped";

/** Why a run stopped asking the provider (section 4.6). */
export type Tier1Unavailable = "auth" | "provider" | "routing" | "api";

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

/** The `tier1` block of a run's report (section 2.4). Never holds a key. */
export interface Tier1Block {
  state: Tier1State;
  /** Why Tier 1 is off, misconfigured, without credentials or unavailable. */
  reason?: string;
  provider?: string;
  model?: string;
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
  /** Said to the user: who received card text and why, the month's spend, and any warning. */
  notice: string;
  warnings?: string[];
}
