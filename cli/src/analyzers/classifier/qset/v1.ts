/**
 * Question set dr-qset-1: exactly the classify-eval harness configuration the current numbers
 * measure, `clef@cbm012-kind-tier0` (`classify.ts --kind-narrow --tier0`, full criteria, no facts,
 * no charter). TIER1_DESIGN.md section 3.3.
 *
 * - stage 1: `layer` (choice over the 13 layers and `none`, restricted to Tier 0's layers when it
 *   narrowed), `significance` (score, 5 levels), six `concern_*` yes/no questions;
 * - stage 2, when the layer is not `none` and at least two options remain: `element_type` (choice
 *   within the layer and `none`), restricted by Tier 0's narrowing, else by {@link KIND_CANDIDATES};
 * - the state is `renderState(card, 40)`.
 *
 * The id must change whenever anything here or in `state.ts` changes what is sent; a unit test pins
 * a digest of the builders' output for fixture cards to the id.
 */
import type { Tier0Target } from "../../tier0-rules.js";
import { layerCriteria, NONE_OPTION, typeCriteria, type SpecCriteria } from "../criteria.js";
import type { Question } from "../decision-model/types.js";
import { renderState, type StateCard, type StateFacts, type StateOptions } from "../state.js";

export const QSET_ID: string = "dr-qset-1";

/** Lines of source the state shows. */
export const SOURCE_LINES = 40;

/** Tier-0 narrowing handed to the classifier: the only layer.type answers allowed (type null = any type of that layer). */
export type Narrowing = Tier0Target[];

export const CONCERNS = [
  "authentication",
  "authorization",
  "data_persistence",
  "external_integration",
  "observability",
  "user_interface",
] as const;
export type Concern = (typeof CONCERNS)[number];

export const CONCERN_DEFINITIONS: Record<Concern, string> = {
  authentication: "verifies identity: login, tokens, API keys, sessions, credentials",
  authorization: "decides what an identity may do: roles, permissions, policies, access checks",
  data_persistence: "reads or writes durable storage: files, databases, caches, manifests on disk",
  external_integration: "calls or serves an external system or process: HTTP clients, MCP servers, subprocesses, third-party APIs",
  observability: "telemetry, logging, metrics, tracing, spans",
  user_interface: "renders or drives a user-facing interface: CLI output, web UI, TUI, prompts",
};

export const SIGNIFICANCE_LEVELS = [
  "0: implementation detail (private helper, formatter, trivial wrapper, constant)",
  "1: minor internal unit that only its file cares about",
  "2: notable internal unit a maintainer would name when explaining the module",
  "3: architecturally significant (a service, component, contract, store, policy or integration point)",
  "4: core architectural element: an entry point, system boundary, or central abstraction",
];

/**
 * The kind rule: which element types a given CBM symbol kind can plausibly be, per layer.
 * Structural symbols (classes, modules, interfaces) map to structural types; callable symbols
 * (functions, methods) to behavioural types. Layers not listed are left unrestricted.
 */
export const KIND_CANDIDATES: Record<string, Record<string, string[]>> = {
  application: {
    Class: ["applicationcomponent", "applicationinterface", "applicationservice", "applicationcollaboration", "dataobject", "applicationevent"],
    Module: ["applicationcomponent", "applicationinterface", "applicationservice", "applicationcollaboration", "applicationfunction", "dataobject"],
    Interface: ["dataobject", "applicationinterface", "applicationevent", "applicationservice"],
    Function: ["applicationfunction", "applicationprocess", "applicationservice", "applicationinterface", "applicationevent"],
    Method: ["applicationfunction", "applicationprocess", "applicationservice", "applicationinterface"],
  },
};

/** How dr-qset-1 renders the state: with the line range, neighbours in the card's order. */
export const STATE_OPTIONS: StateOptions = Object.freeze({ lineRange: true, sortNeighbours: false });

/** The state the model is sent for a card. `facts` is a harness experiment (`--facts`); dr-qset-1 sends none. */
export function stateOf(card: StateCard, facts?: StateFacts): string {
  return renderState(card, SOURCE_LINES, facts, STATE_OPTIONS);
}

/** Stage 1: layer, significance and the six concerns. */
export function stage1Questions(spec: SpecCriteria, narrow?: Narrowing): Record<string, Question> {
  let criteria = layerCriteria(spec);
  let note = "";
  if (narrow?.length) {
    const layers = new Set(narrow.map((n) => n.layer));
    criteria = Object.fromEntries(Object.entries(criteria).filter(([k]) => k === NONE_OPTION || layers.has(k)));
    note = " Only the layers this kind of symbol can belong to are listed.";
  }
  const stage1: Record<string, Question> = {
    layer: {
      type: "choice",
      instructions: `Which Documentation Robotics architecture layer would this code symbol be recorded in if it were modelled as an element? Choose 'none' if it is not an architecturally meaningful element on its own.${note}`,
      criteria,
    },
    significance: {
      type: "score",
      instructions: "How architecturally significant is this symbol within its codebase?",
      criteria: SIGNIFICANCE_LEVELS,
    },
  };
  for (const c of CONCERNS) {
    stage1[`concern_${c}`] = {
      type: "noul",
      instructions: `This symbol itself implements the ${c.replace(/_/g, " ")} concern (${CONCERN_DEFINITIONS[c]}), not merely calling something that does.`,
    };
  }
  return stage1;
}

/**
 * Stage 2: the element type within `layer`. Tier 0's narrowing for that layer, when it names
 * types, restricts the options; otherwise, with `kindNarrow` (always on in dr-qset-1), the kind rule.
 */
export function stage2Questions(spec: SpecCriteria, layer: string, kind?: string, kindNarrow = false, narrow?: Narrowing): Record<string, Question> {
  let criteria = typeCriteria(spec, layer);
  let kindNote = "";
  const allowedHere = narrow?.filter((n) => n.layer === layer);
  if (allowedHere?.length && !allowedHere.some((n) => n.type === null)) {
    const ids = new Set(allowedHere.map((n) => n.type));
    criteria = Object.fromEntries(Object.entries(criteria).filter(([k]) => k === NONE_OPTION || ids.has(k)));
    kindNote = " Only the element types this symbol can be are listed.";
    kindNarrow = false; // the Tier-0 rule is more specific than the kind rule
  }
  if (kindNarrow && kind) {
    const allowed = KIND_CANDIDATES[layer]?.[kind];
    if (allowed) {
      criteria = Object.fromEntries(Object.entries(criteria).filter(([k]) => k === NONE_OPTION || allowed.includes(k)));
      kindNote = ` The symbol is a ${kind}; only the element types a ${kind} can be are listed.`;
    }
  }
  return {
    element_type: {
      type: "choice",
      instructions: `This symbol belongs to the '${layer}' layer. Which element type within that layer best describes it? Choose 'none' if no listed type fits.${kindNote}`,
      criteria,
    },
  };
}

/** Whether stage 2 is asked: the layer is not `none` and at least two options remain. */
export function asksStage2(layer: string | null, stage2: Record<string, Question>): boolean {
  if (!layer || layer === NONE_OPTION) return false;
  const q = stage2.element_type;
  return q?.type === "choice" && Object.keys(q.criteria).length >= 2;
}

/**
 * The narrowing as it enters the cache key: Tier 0's candidates sorted (`layer.type`, `layer.*`),
 * or null when Tier 0 left the card open. The kind rule's narrowing follows from the symbol kind,
 * which is in the state.
 */
export function narrowingKey(narrow?: Narrowing): string[] | null {
  if (!narrow?.length) return null;
  return [...new Set(narrow.map((n) => `${n.layer}.${n.type ?? "*"}`))].sort();
}
