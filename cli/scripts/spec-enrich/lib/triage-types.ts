import { z } from "zod";

/** Fixed vocabularies shared by the splitter, the triage backends, the report and the benchmark. */

export const CATEGORIES = {
  attribute_typing: "An attribute's type, required-ness or value format is wrong or inconsistent with how siblings or the standard treat it",
  attribute_naming: "An attribute's name is misleading, collides with another concept, or differs from siblings for no reason",
  enum_gap: "An enum lacks values that real systems need, or mixes values from different axes",
  missing_attribute: "The type cannot capture something essential about its instances because an attribute is absent",
  type_overlap: "Two element types (in this or another layer) cover the same things and need a boundary or precedence rule",
  definition_conflict: "The type's definition contradicts its attributes, its relationships, or its layer's intent",
  relationship_redundant: "Two relationship types between the same pair express the same meaning",
  relationship_direction: "A relationship points the wrong way or uses a predicate whose semantics do not fit",
  relationship_missing: "A relationship that real models need does not exist in the catalog",
  classifier_concern: "The concern is about whether a classifier can recognise instances from code, not about the spec's correctness",
  other: "None of the above",
} as const;
export type Category = keyof typeof CATEGORIES;
export const CATEGORY_IDS = Object.keys(CATEGORIES) as Category[];

export const VALIDITY = {
  real_defect: "The claim identifies a genuine problem in the spec as written; it should be fixed",
  works_as_designed: "The spec intends this; the claim misreads the design or the layer's intent, and at most the definition should say so more clearly",
  judgment_call: "A reasonable modelling choice either way; needs a product decision, not a correction",
  out_of_scope: "The claim is about something the spec deliberately does not model, or about tooling rather than the spec",
} as const;
export type Validity = keyof typeof VALIDITY;
export const VALIDITY_IDS = Object.keys(VALIDITY) as Validity[];

export const SEVERITY_LEVELS = [
  "0 cosmetic: wording or documentation only; nothing a modeller does changes",
  "1 minor: a modeller can work around it; occasional confusion",
  "2 significant: models built today will be inconsistent or lose information because of it",
  "3 blocking: it prevents modelling a common case correctly or makes the CLI reject valid models",
];

export const FIX_SCOPE_LEVELS = [
  "0 wording: change only descriptions or documentation",
  "1 additive: add an attribute, enum value or relationship; existing models stay valid",
  "2 breaking: rename, retype, remove or change required-ness; existing models need migration",
  "3 roadmap: a design change that needs its own proposal",
];

export const ClaimSchema = z.object({
  id: z.string(), // <note id>#<n>
  note_id: z.string(),
  layer: z.string(),
  subject: z.string(), // spec_node_id the note belongs to
  kind: z.enum(["node", "relationships"]),
  text: z.string(), // the atomic claim, in the model's words
  category_hint: z.string(), // splitter's category
  affected_ids: z.array(z.string()), // spec_node_ids / relationship ids / attribute paths
  proposed_change: z.string(),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const DecisionSchema = z.object({
  claim_id: z.string(),
  backend: z.string(),
  validity: z.object({ choice: z.string(), probabilities: z.record(z.string(), z.number()), confidence: z.number().nullable() }),
  category: z.object({ choice: z.string(), probabilities: z.record(z.string(), z.number()), confidence: z.number().nullable() }),
  severity: z.object({ score: z.number(), probabilities: z.array(z.number()).nullable() }),
  fix_scope: z.object({ score: z.number(), probabilities: z.array(z.number()).nullable() }),
  addressed_by_proposal: z.number(), // probability
  classifier_relevant: z.number(), // probability
  latency_ms: z.number(),
  cost_usd: z.number().nullable(),
  error: z.string().nullable(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const GoldSchema = z.object({
  claim_id: z.string(),
  validity: z.enum(VALIDITY_IDS as [Validity, ...Validity[]]),
  category: z.enum(CATEGORY_IDS as [Category, ...Category[]]),
  severity: z.number().int().min(0).max(3),
  fix_scope: z.number().int().min(0).max(3).optional(),
  rationale: z.string(),
  adjudicated_by: z.string().optional(),
});
export type Gold = z.infer<typeof GoldSchema>;
