import { z } from "zod";

/** A symbol "state card" built from the codebase-memory graph. */
export const CardSchema = z.object({
  id: z.string(),
  corpus: z.string(),
  label: z.string(), // CBM label: Class | Interface | Function | Method | Module | Route
  name: z.string(),
  qualified_name: z.string(), // project prefix stripped
  file_path: z.string().nullable(),
  start_line: z.number().nullable(),
  end_line: z.number().nullable(),
  signature: z.string().nullable(),
  docstring: z.string().nullable(),
  is_exported: z.boolean().nullable(),
  is_entry_point: z.boolean().nullable(),
  complexity: z.number().nullable(),
  parent_class: z.string().nullable(),
  base_classes: z.array(z.string()),
  return_type: z.string().nullable(),
  callers: z.array(z.string()),
  callees: z.array(z.string()),
  callers_total: z.number(),
  callees_total: z.number(),
  imports: z.array(z.string()),
  env_vars: z.array(z.string()),
  routes_handled: z.array(z.string()),
  http_calls: z.array(z.string()),
  inherits: z.array(z.string()),
  implements: z.array(z.string()),
  route_method: z.string().nullable(),
  source: z.string().nullable(),
  source_lines_total: z.number().nullable(),
  source_truncated: z.boolean(),
});
export type Card = z.infer<typeof CardSchema>;

export const CONCERNS = [
  "authentication",
  "authorization",
  "data_persistence",
  "external_integration",
  "observability",
  "user_interface",
] as const;
export type Concern = (typeof CONCERNS)[number];

export const ConcernsSchema = z.object({
  authentication: z.boolean(),
  authorization: z.boolean(),
  data_persistence: z.boolean(),
  external_integration: z.boolean(),
  observability: z.boolean(),
  user_interface: z.boolean(),
});

/** Gold label produced by Claude with full context. */
export const GoldSchema = z.object({
  card_id: z.string(),
  layer: z.string(), // layer id or "none"
  element_type: z.string().nullable(), // type id within layer, or null
  element_type_valid: z.boolean(),
  significance: z.number().int().min(0).max(4),
  concerns: ConcernsSchema,
  rationale: z.string(),
  model: z.string(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number(), cache_read_input_tokens: z.number().optional() }).optional(),
});
export type Gold = z.infer<typeof GoldSchema>;

/** A classifier backend's prediction for one card. */
export const PredictionSchema = z.object({
  card_id: z.string(),
  backend: z.string(),
  layer: z.object({
    choice: z.string(),
    probabilities: z.record(z.string(), z.number()),
    confidence: z.number().nullable(),
  }),
  element_type: z.object({
    choice: z.string().nullable(),
    probabilities: z.record(z.string(), z.number()),
    confidence: z.number().nullable(),
  }),
  significance: z.object({
    score: z.number(),
    probabilities: z.array(z.number()).nullable(),
  }),
  concerns: z.record(z.string(), z.number()), // probability per concern
  latency_ms: z.number(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).nullable(),
  cost_usd: z.number().nullable(),
  error: z.string().nullable(),
});
export type Prediction = z.infer<typeof PredictionSchema>;
