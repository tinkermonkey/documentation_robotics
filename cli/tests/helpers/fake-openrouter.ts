/**
 * A fake of OpenRouter's Decisions API for tests: a `fetch` that answers whatever it is asked in
 * OpenRouter's documented shape, from the upstream a function picks. Never reaches the network.
 */
import type { FetchLike, Question } from "../../src/analyzers/classifier/index.js";

export interface SentDecision {
  url: string;
  init: RequestInit;
  body: { model: string; state: string; questions: Record<string, Question>; provider: Record<string, unknown> };
}

export const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/**
 * Answers every question: the layer with `layers`' probabilities for the options named there (the
 * rest share what is left), other choices 0.7 to the first option, scores 2, nouls 0.1; usage 5,000
 * input tokens at $0.0012. `provider` names the serving upstream, from the request body if a function.
 */
export function answeringFetch(
  provider: string | ((body: SentDecision["body"]) => string) = "Cloudflare",
  layers: Record<string, number> = { application: 0.8 },
  extra: { model?: string; usage?: Record<string, unknown> } = {}
): { fetch: FetchLike; sent: SentDecision[] } {
  const sent: SentDecision[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(String(init.body)) as SentDecision["body"];
    sent.push({ url, init, body });
    const answers: Record<string, unknown> = {};
    for (const [k, q] of Object.entries(body.questions)) {
      if (q.type === "choice") {
        const keys = Object.keys(q.criteria);
        const fixed = Object.fromEntries(keys.filter((o) => k === "layer" && o in layers).map((o) => [o, layers[o]]));
        const rest = keys.filter((o) => !(o in fixed));
        const left = Math.max(0, 1 - Object.values(fixed).reduce((a, b) => a + b, 0));
        const probabilities: Record<string, number> = { ...fixed };
        if (k === "layer") for (const o of rest) probabilities[o] = left / rest.length;
        else rest.forEach((o, i) => (probabilities[o] = i === 0 ? 0.7 : 0.3 / Math.max(1, rest.length - 1)));
        const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
        answers[k] = { type: "choice", choice, confidence: 0.5, probabilities };
      } else if (q.type === "score") answers[k] = { type: "score", score: 2, confidence: 0.5, probabilities: { "0": 0, "1": 0, "2": 1, "3": 0, "4": 0 } };
      else answers[k] = { type: "noul", noul: 0.1 };
    }
    const served = typeof provider === "function" ? provider(body) : provider;
    return jsonResponse({
      id: "gen-dec-123456789",
      model: extra.model ?? body.model,
      provider: served,
      answers,
      usage: extra.usage ?? { input_tokens: 5000, output_tokens: 0, cost: 0.0012 },
    });
  };
  return { fetch, sent };
}
