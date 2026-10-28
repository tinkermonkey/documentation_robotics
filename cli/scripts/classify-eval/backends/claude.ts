/**
 * Claude classify backend: same state card, same questions, answered in one
 * structured-output call with self-reported confidences. The comparison point
 * for the decision models (cost, latency, accuracy, calibration).
 */
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, claudeCost } from "../lib/claude.js";
import { layerIds, NONE_OPTION, specReferenceText } from "../lib/spec.js";
import { CONCERNS, type Prediction } from "../lib/types.js";

const schema = () =>
  z.object({
    layer: z.enum([...layerIds(), NONE_OPTION] as unknown as [string, ...string[]]),
    layer_confidence: z.number(),
    element_type: z.string().nullable(),
    element_type_confidence: z.number(),
    significance: z.enum(["0", "1", "2", "3", "4"]),
    concerns: z.object({
      authentication: z.number(),
      authorization: z.number(),
      data_persistence: z.number(),
      external_integration: z.number(),
      observability: z.number(),
      user_interface: z.number(),
    }),
  });

let systemCache: Anthropic.TextBlockParam[] | null = null;
function system(): Anthropic.TextBlockParam[] {
  if (systemCache) return systemCache;
  const text = [
    "You classify code symbols into the Documentation Robotics 13-layer architecture model. You see only a state card (signature, docstring, call graph neighbours, imports, a source excerpt).",
    "Answer every field:",
    "- layer: the layer the symbol would be recorded in, or 'none' if it is not an architecturally meaningful element on its own. Ordinary application code structure belongs to 'application'; pick a more specific layer only when the symbol is that concern.",
    "- layer_confidence: your probability (0-1) that the layer is correct.",
    "- element_type: the lowercase element type id within that layer (null if layer is none or nothing fits).",
    "- element_type_confidence: probability (0-1) that the element type is correct.",
    "- significance: 0-4 on the scale below.",
    "- concerns: for each cross-cutting concern, the probability (0-1) that the symbol itself implements it.",
    "Report calibrated probabilities: 0.5 means a coin flip, 0.95 means you would be surprised to be wrong.",
    "",
    specReferenceText(),
  ].join("\n");
  systemCache = [{ type: "text", text, cache_control: { type: "ephemeral" } }];
  return systemCache;
}

export async function classifyWithClaude(backend: string, model: string, effort: "low" | "medium" | "high", cardId: string, state: string): Promise<Prediction> {
  const t0 = Date.now();
  const client = anthropic();
  const res = await client.messages.parse({
    model,
    max_tokens: 4000,
    system: system(),
    output_config: { effort, format: zodOutputFormat(schema()) },
    messages: [{ role: "user", content: `Classify this symbol.\n\n${state}` }],
  });
  if (res.stop_reason === "refusal") throw new Error(`refusal: ${res.stop_details?.category ?? "?"}`);
  const out = res.parsed_output;
  if (!out) throw new Error(`no parsed_output (stop_reason ${res.stop_reason})`);
  const concerns: Record<string, number> = {};
  for (const c of CONCERNS) concerns[c] = out.concerns[c];
  const layerProbs: Record<string, number> = { [out.layer]: out.layer_confidence };
  return {
    card_id: cardId,
    backend,
    layer: { choice: out.layer, probabilities: layerProbs, confidence: out.layer_confidence },
    element_type: {
      choice: out.layer === NONE_OPTION ? null : out.element_type,
      probabilities: out.element_type ? { [out.element_type]: out.element_type_confidence } : {},
      confidence: out.element_type_confidence,
    },
    significance: { score: Number(out.significance), probabilities: null },
    concerns,
    latency_ms: Date.now() - t0,
    usage: { input_tokens: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0), output_tokens: res.usage.output_tokens },
    cost_usd: claudeCost(model, res.usage),
    error: null,
  };
}
