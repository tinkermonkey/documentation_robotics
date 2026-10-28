import Anthropic from "@anthropic-ai/sdk";
import { loadDotEnv } from "./env.js";

export const MODEL_IDS: Record<string, string> = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
};

/** USD per million tokens (input, output). Cache reads are billed at 0.1x input here as an approximation. */
export const CLAUDE_PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export function claudeCost(model: string, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }, batch = false): number {
  const p = CLAUDE_PRICES[model];
  if (!p) return 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  let usd = (usage.input_tokens * p.input + cacheWrite * p.input * 1.25 + cacheRead * p.input * 0.1 + usage.output_tokens * p.output) / 1e6;
  if (batch) usd *= 0.5;
  return usd;
}

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!client) {
    loadDotEnv();
    client = new Anthropic({ maxRetries: 3, timeout: 10 * 60 * 1000 });
  }
  return client;
}

/** Run `fn` over items with bounded concurrency, preserving order of completion callbacks. */
export async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
