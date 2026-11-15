/**
 * Who served a run: the provider asked and, behind a router, the pinned upstream, as the
 * predictions record them. Runs from different adapters (Workers AI, OpenRouter through Cloudflare,
 * OpenRouter through DeepInfra) answer differently even for the same weights, so the reports name
 * each run's serving and refuse a file that mixes them (a resumed run with another backend).
 */
import type { Prediction } from "./types.js";

export interface Serving {
  /** `cloudflare-workers-ai`, `openrouter`; null when no prediction records one (Claude, older runs). */
  provider: string | null;
  /** The pinned upstream (`cloudflare`, `deepinfra/fp8`), or null. */
  upstream: string | null;
  /** The upstreams the responses named (`Cloudflare`), with counts. */
  servedBy: Record<string, number>;
}

/** The serving of a run's predictions; throws when they mix providers or pinned upstreams. */
export function servingOf(preds: readonly Prediction[], name = "the run"): Serving {
  const providers = new Set<string>();
  const upstreams = new Set<string>();
  const servedBy: Record<string, number> = {};
  for (const p of preds) {
    if (p.error) continue;
    if (p.provider) providers.add(p.provider);
    // Rule-decided cards weren't sent anywhere; the pinned upstream is recorded on them all the same.
    if (p.upstream) upstreams.add(p.upstream);
    const u = p.served_by?.upstream;
    if (u) servedBy[u] = (servedBy[u] ?? 0) + 1;
  }
  if (providers.size > 1) throw new Error(`${name} mixes providers (${[...providers].sort().join(", ")}): keep each adapter's run in its own file`);
  if (upstreams.size > 1) throw new Error(`${name} mixes upstreams (${[...upstreams].sort().join(", ")}): keep each upstream's run in its own file`);
  const unpinned = upstreams.size === 1 && preds.some((p) => !p.error && p.provider && !p.upstream);
  if (unpinned) throw new Error(`${name} mixes runs pinned to ${[...upstreams][0]} with unpinned ones: keep each upstream's run in its own file`);
  return { provider: [...providers][0] ?? null, upstream: [...upstreams][0] ?? null, servedBy };
}

/** `cloudflare-workers-ai`, `openrouter via cloudflare (served by Cloudflare 148)`, or `-`. */
export function servingLabel(s: Serving): string {
  if (!s.provider) return "-";
  const served = Object.entries(s.servedBy)
    .sort((a, b) => b[1] - a[1])
    .map(([u, n]) => `${u} ${n}`)
    .join(", ");
  return `${s.provider}${s.upstream ? ` via ${s.upstream}` : ""}${served && s.upstream ? ` (served by ${served})` : ""}`;
}
