/**
 * Accepted gaps — connections the catalog allows for an element's type that are deliberately
 * absent, recorded on the element (`accepted_gaps`, spec-node.schema.json; #1026).
 *
 * One entry names one triple seen from the element: its direction (`outgoing` when the element
 * would be the source, `incoming` when it would be the target), the predicate and the other end's
 * spec node type, with the reason, who decided, when, and the changeset it was staged in. It tells
 * "decided against" apart from "not modelled yet":
 *
 * - `changeset_brief` lists unwired connections and peer-pattern gaps that match one as accepted,
 *   not open;
 * - extraction does not stage a relationship that matches one, and reports it as contradicted;
 * - `changeset_verify` and `codebase_verify` report an accepted gap the build or the code
 *   contradicts;
 * - validation reports them for information only: a gap never makes validation fail.
 *
 * A gap is accepted only as a staged change in a changeset (`gap_accept`), so the human approves it
 * when the changeset lands, and it can't be accepted for a relationship the catalog marks required.
 * See "Accepted gaps" in docs/CHANGE_MODELING.md.
 */

import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import {
  RELATIONSHIPS_BY_DESTINATION,
  RELATIONSHIPS_BY_SOURCE,
  type RelationshipSpec,
} from "../generated/relationship-index.js";
import { validateSpecNode } from "../generated/compiled-validators.js";

export type GapDirection = "outgoing" | "incoming";

/** The brief's and the graph's spelling of a direction, from the element's side. */
export type ShortDirection = "out" | "in";

/** One accepted gap, as stored on the element (snake_case, as the spec names the fields). */
export interface AcceptedGap {
  direction: GapDirection;
  predicate: string;
  /** Spec node type of the other end, `layer.type`. */
  other_spec_node_id: string;
  reason: string;
  decided_by: string;
  /** ISO 8601 timestamp. */
  decided_at: string;
  /** Id of the changeset the gap was staged in. */
  changeset: string;
}

/** The field on an element (and in a staged snapshot) that holds its accepted gaps. */
export const ACCEPTED_GAPS_FIELD = "accepted_gaps";

export function toShortDirection(direction: GapDirection): ShortDirection {
  return direction === "outgoing" ? "out" : "in";
}

export function toGapDirection(direction: ShortDirection | GapDirection): GapDirection {
  return direction === "out" || direction === "outgoing" ? "outgoing" : "incoming";
}

let entryValidator: ValidateFunction | undefined;

/**
 * The spec's schema for one entry (`accepted_gaps.items` in the bundled spec-node schema), compiled
 * once with the same AJV options as the generated base validators, so an entry is well-formed here
 * exactly when the schema accepts it.
 */
function acceptedGapEntryValidator(): ValidateFunction {
  if (!entryValidator) {
    const properties = (validateSpecNode.schema as { properties?: Record<string, { items?: object }> }).properties;
    const schema = properties?.[ACCEPTED_GAPS_FIELD]?.items;
    if (!schema) throw new Error(`The bundled spec-node schema has no ${ACCEPTED_GAPS_FIELD}.items; rebuild the CLI.`);
    const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: true });
    addFormats(ajv);
    entryValidator = ajv.compile(schema);
  }
  return entryValidator;
}

/** One schema error, in words: the field it is on and what is wrong. */
function describeSchemaError(error: ErrorObject): string {
  const field = error.instancePath.replace(/^\//, "").replace(/\//g, ".");
  const params = error.params as Record<string, unknown>;
  if (error.keyword === "required") return `${String(params.missingProperty)} is missing`;
  if (error.keyword === "additionalProperties") return `unknown field ${String(params.additionalProperty)}`;
  if (error.keyword === "enum") {
    const allowed = (params.allowedValues as unknown[]).map((v) => `'${String(v)}'`).join(" or ");
    return `${field} must be ${allowed}`;
  }
  return field ? `${field} ${error.message ?? "is invalid"}` : (error.message ?? "is invalid");
}

/**
 * What is wrong with one entry, or null when it is a well-formed accepted gap: one the spec's
 * `accepted_gaps.items` schema accepts.
 */
export function acceptedGapProblem(entry: unknown): string | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "not an object";
  const validate = acceptedGapEntryValidator();
  if (validate(entry)) return null;
  return (validate.errors ?? []).map(describeSchemaError).join("; ") || "does not match the accepted_gaps schema";
}

/**
 * The well-formed accepted gaps in a stored value (an element's `accepted_gaps`). Anything else
 * (not a list, malformed entries) is left out here; validation reports it, for information.
 */
export function readAcceptedGaps(value: unknown): AcceptedGap[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => acceptedGapProblem(entry) === null)
    .map((entry) => {
      const e = entry as AcceptedGap;
      return {
        direction: e.direction,
        predicate: e.predicate,
        other_spec_node_id: e.other_spec_node_id,
        reason: e.reason,
        decided_by: e.decided_by,
        decided_at: e.decided_at,
        changeset: e.changeset,
      };
    });
}

/** Key of a triple from the element's side, whichever spelling of the direction. */
export function gapTripleKey(direction: ShortDirection | GapDirection, predicate: string, otherType: string): string {
  return `${toShortDirection(toGapDirection(direction))}|${predicate}|${otherType}`;
}

export function acceptedGapKey(gap: Pick<AcceptedGap, "direction" | "predicate" | "other_spec_node_id">): string {
  return gapTripleKey(gap.direction, gap.predicate, gap.other_spec_node_id);
}

/** The accepted gap among `gaps` that names this triple, if any. */
export function findAcceptedGap(
  gaps: readonly AcceptedGap[] | undefined,
  direction: ShortDirection | GapDirection,
  predicate: string,
  otherType: string
): AcceptedGap | undefined {
  if (!gaps || gaps.length === 0) return undefined;
  const key = gapTripleKey(direction, predicate, otherType);
  return gaps.find((g) => acceptedGapKey(g) === key);
}

/** The catalog's entry for a triple seen from an element of `elementType`, if the catalog defines it. */
export function catalogEntryForGap(
  elementType: string,
  direction: ShortDirection | GapDirection,
  predicate: string,
  otherType: string
): RelationshipSpec | undefined {
  return toGapDirection(direction) === "outgoing"
    ? (RELATIONSHIPS_BY_SOURCE.get(elementType) ?? []).find(
        (r) => r.predicate === predicate && r.destinationSpecNodeId === otherType
      )
    : (RELATIONSHIPS_BY_DESTINATION.get(elementType) ?? []).find(
        (r) => r.predicate === predicate && r.sourceSpecNodeId === otherType
      );
}

/**
 * Whether a gap may be accepted on an element of `elementType`: the catalog must define the triple
 * (a connection it doesn't model can't be a gap), and must not mark it required.
 */
export function gapCatalogProblem(
  elementType: string,
  gap: Pick<AcceptedGap, "direction" | "predicate" | "other_spec_node_id">
): { kind: "not-in-catalog" | "required"; detail: string } | null {
  const triple = describeTriple(elementType, gap);
  const entry = catalogEntryForGap(elementType, gap.direction, gap.predicate, gap.other_spec_node_id);
  if (!entry) {
    return { kind: "not-in-catalog", detail: `The relationship catalog does not define ${triple}, so there is no gap to accept.` };
  }
  if (entry.required) {
    return { kind: "required", detail: `The catalog marks ${triple} required, so it can't be accepted as a gap.` };
  }
  return null;
}

/** `elementType --predicate--> otherType` (or the reverse for an incoming gap). */
export function describeTriple(
  self: string,
  gap: Pick<AcceptedGap, "direction" | "predicate" | "other_spec_node_id">
): string {
  return gap.direction === "outgoing"
    ? `${self} --${gap.predicate}--> ${gap.other_spec_node_id}`
    : `${gap.other_spec_node_id} --${gap.predicate}--> ${self}`;
}

/** An accepted gap as tools report it: the triple and the decision, camelCase like the rest of their output. */
export interface AcceptedGapView {
  direction: GapDirection;
  predicate: string;
  otherType: string;
  reason: string;
  decidedBy: string;
  decidedAt: string;
  changeset: string;
}

export function acceptedGapView(gap: AcceptedGap): AcceptedGapView {
  return {
    direction: gap.direction,
    predicate: gap.predicate,
    otherType: gap.other_spec_node_id,
    reason: gap.reason,
    decidedBy: gap.decided_by,
    decidedAt: gap.decided_at,
    changeset: gap.changeset,
  };
}

/** A relationship seen from one element: which way it runs, its predicate and the other end's type. */
export interface GapEvidenceEdge {
  direction: ShortDirection;
  predicate: string;
  otherType: string;
}

/**
 * The accepted gaps a set of live connections contradicts: each gap whose triple one of them has.
 * Used where a connection exists that the gap says is deliberately absent.
 */
export function contradictedGaps<E extends GapEvidenceEdge>(
  gaps: readonly AcceptedGap[] | undefined,
  edges: readonly E[]
): Array<{ gap: AcceptedGap; edge: E }> {
  if (!gaps || gaps.length === 0) return [];
  const result: Array<{ gap: AcceptedGap; edge: E }> = [];
  for (const gap of gaps) {
    const key = acceptedGapKey(gap);
    const edge = edges.find((e) => gapTripleKey(e.direction, e.predicate, e.otherType) === key);
    if (edge) result.push({ gap, edge });
  }
  return result;
}

/** An element's accepted gaps as tools show them, each marked with the live relationship that contradicts it. */
export function acceptedGapsWithEvidence(
  gaps: readonly AcceptedGap[] | undefined,
  edges: ReadonlyArray<GapEvidenceEdge & { source: string; target: string }>
): Array<AcceptedGapView & { contradictedBy?: { source: string; predicate: string; target: string } }> {
  if (!gaps || gaps.length === 0) return [];
  const contradicted = new Map(contradictedGaps(gaps, edges).map(({ gap, edge }) => [gap, edge]));
  return gaps.map((gap) => {
    const edge = contradicted.get(gap);
    return {
      ...acceptedGapView(gap),
      ...(edge ? { contradictedBy: { source: edge.source, predicate: edge.predicate, target: edge.target } } : {}),
    };
  });
}

/**
 * Informational notices about an element's stored accepted gaps: malformed entries, triples the
 * catalog doesn't define or marks required, the same triple twice. Never errors.
 */
export function acceptedGapNotices(elementType: string, value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return ["accepted_gaps is not a list; it is ignored."];
  const notices: string[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const problem = acceptedGapProblem(entry);
    if (problem) {
      notices.push(`accepted_gaps[${index}] is ignored: ${problem}.`);
      return;
    }
    const gap = entry as AcceptedGap;
    const key = acceptedGapKey(gap);
    if (seen.has(key)) notices.push(`accepted_gaps[${index}] repeats ${describeTriple(elementType, gap)}.`);
    seen.add(key);
    const catalog = gapCatalogProblem(elementType, gap);
    if (catalog) notices.push(`accepted_gaps[${index}]: ${catalog.detail}`);
  });
  return notices;
}
