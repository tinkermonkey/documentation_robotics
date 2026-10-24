/**
 * Cloudflare Clef / Clef-flash decision-model backend (Workers AI REST API).
 * Jev-compatible request shape: { model, state, questions } where each question is
 * { type: "choice"|"score"|"noul", instructions, criteria }.
 *
 * Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (Workers AI permission).
 */
import { loadDotEnv, requireEnv } from "../lib/env.js";
import { CONCERN_DEFINITIONS, layerCriteria, NONE_OPTION, SIGNIFICANCE_LEVELS, typeCriteria } from "../lib/spec.js";
import { CONCERNS, type Prediction } from "../lib/types.js";

export const CLEF_MODELS: Record<string, { id: string; model: string; inputPerM: number }> = {
  clef: { id: "@cf/cloudflare/clef", model: "clef", inputPerM: 0.24 },
  "clef-flash": { id: "@cf/cloudflare/clef-flash", model: "clef-flash", inputPerM: 0.09 },
};

type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "noul"; instructions: string };

interface ClefAnswer {
  type?: string;
  choice?: string;
  answer?: string;
  probabilities?: Record<string, number> | number[];
  distribution?: number[];
  confidence?: number;
  score?: number;
  noul?: number;
  probability?: number;
  value?: unknown;
  [k: string]: unknown;
}

interface ClefResponse {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: { model?: string; answers?: Record<string, ClefAnswer>; usage?: { input_tokens?: number; output_tokens?: number } };
  // some deployments return the result unwrapped
  answers?: Record<string, ClefAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

async function callClef(backend: string, state: string, questions: Record<string, Question>): Promise<{ answers: Record<string, ClefAnswer>; usage: { input_tokens: number; output_tokens: number }; raw: unknown }> {
  loadDotEnv();
  const account = requireEnv("CLOUDFLARE_ACCOUNT_ID", "Add it to the repo .env (Cloudflare dashboard -> account id).");
  const token = requireEnv("CLOUDFLARE_API_TOKEN", "Create a token with the 'Workers AI' template and add it to the repo .env.");
  const cfg = CLEF_MODELS[backend];
  if (!cfg) throw new Error(`Unknown Clef backend ${backend}`);
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${cfg.id}`;
  const body = JSON.stringify({ model: cfg.model, state, questions });
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body });
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    const json = (await res.json()) as ClefResponse;
    if (!res.ok || json.success === false) {
      throw new Error(`Clef error HTTP ${res.status}: ${JSON.stringify(json.errors ?? json).slice(0, 500)}`);
    }
    const answers = json.result?.answers ?? json.answers ?? {};
    const usage = json.result?.usage ?? json.usage ?? {};
    return { answers, usage: { input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0 }, raw: json };
  }
  throw lastErr instanceof Error ? lastErr : new Error("Clef request failed");
}

function choiceOf(a: ClefAnswer | undefined): { choice: string | null; probabilities: Record<string, number>; confidence: number | null } {
  if (!a) return { choice: null, probabilities: {}, confidence: null };
  const probs = a.probabilities && !Array.isArray(a.probabilities) ? a.probabilities : {};
  let choice = typeof a.choice === "string" ? a.choice : typeof a.answer === "string" ? a.answer : typeof a.value === "string" ? a.value : null;
  if (!choice && Object.keys(probs).length) choice = Object.entries(probs).sort((x, y) => y[1] - x[1])[0][0];
  return { choice, probabilities: probs, confidence: typeof a.confidence === "number" ? a.confidence : null };
}

function noulOf(a: ClefAnswer | undefined): number {
  if (!a) return NaN;
  for (const k of ["noul", "probability", "value", "score"]) {
    const v = a[k];
    if (typeof v === "number") return v;
  }
  return NaN;
}

function scoreOf(a: ClefAnswer | undefined, levels: number): { score: number; probabilities: number[] | null } {
  if (!a) return { score: NaN, probabilities: null };
  const dist = Array.isArray(a.probabilities) ? a.probabilities : Array.isArray(a.distribution) ? a.distribution : null;
  let score = typeof a.score === "number" ? a.score : typeof a.value === "number" ? a.value : NaN;
  if (Number.isNaN(score) && dist) score = dist.reduce((acc, p, i) => acc + p * i, 0);
  // If the model reports an index on a 1..N scale, normalize to 0..N-1
  if (!Number.isNaN(score) && dist == null && score >= levels) score = levels - 1;
  return { score, probabilities: dist };
}

/** The stage-1 question set (layer, significance, concerns); exported for --dry-run. */
export function stage1Questions(): Record<string, Question> {
  const stage1: Record<string, Question> = {
    layer: {
      type: "choice",
      instructions: "Which Documentation Robotics architecture layer would this code symbol be recorded in if it were modelled as an element? Choose 'none' if it is not an architecturally meaningful element on its own.",
      criteria: layerCriteria(),
    },
    significance: {
      type: "score",
      instructions: "How architecturally significant is this symbol within its codebase?",
      criteria: SIGNIFICANCE_LEVELS,
    },
  };
  for (const c of CONCERNS) {
    stage1[`concern_${c}`] = { type: "noul", instructions: `This symbol itself implements the ${c.replace(/_/g, " ")} concern (${CONCERN_DEFINITIONS[c]}), not merely calling something that does.` };
  }
  return stage1;
}

export function stage2Questions(layer: string): Record<string, Question> {
  return {
    element_type: {
      type: "choice",
      instructions: `This symbol belongs to the '${layer}' layer. Which element type within that layer best describes it? Choose 'none' if no listed type fits.`,
      criteria: typeCriteria(layer),
    },
  };
}

export async function classifyWithClef(backend: string, cardId: string, state: string): Promise<Prediction> {
  const t0 = Date.now();
  const cfg = CLEF_MODELS[backend];
  const stage1 = stage1Questions();
  const r1 = await callClef(backend, state, stage1);
  const layer = choiceOf(r1.answers.layer);
  const sig = scoreOf(r1.answers.significance, SIGNIFICANCE_LEVELS.length);
  const concerns: Record<string, number> = {};
  for (const c of CONCERNS) concerns[c] = noulOf(r1.answers[`concern_${c}`]);
  let usage = { ...r1.usage };

  let etype: { choice: string | null; probabilities: Record<string, number>; confidence: number | null } = { choice: null, probabilities: {}, confidence: null };
  if (layer.choice && layer.choice !== NONE_OPTION) {
    const stage2 = stage2Questions(layer.choice);
    if (Object.keys(stage2.element_type.type === "choice" ? stage2.element_type.criteria : {}).length >= 2) {
      const r2 = await callClef(backend, state, stage2);
      etype = choiceOf(r2.answers.element_type);
      usage = { input_tokens: usage.input_tokens + r2.usage.input_tokens, output_tokens: usage.output_tokens + r2.usage.output_tokens };
    }
  }
  return {
    card_id: cardId,
    backend,
    layer: { choice: layer.choice ?? NONE_OPTION, probabilities: layer.probabilities, confidence: layer.confidence },
    element_type: { choice: etype.choice === NONE_OPTION ? null : etype.choice, probabilities: etype.probabilities, confidence: etype.confidence },
    significance: sig,
    concerns,
    latency_ms: Date.now() - t0,
    usage,
    cost_usd: (usage.input_tokens * cfg.inputPerM) / 1e6,
    error: null,
  };
}
