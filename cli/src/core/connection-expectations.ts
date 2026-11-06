/**
 * Connection expectations — the connections the spec says a node type is expected to have.
 *
 * Softer than a relationship schema's `required` flag: an unmet expectation is a gap in
 * `changeset_brief` and, with `dr validate --expected`, a warning. Never an error.
 *
 * Read at runtime from the bundled `expectations.json` (compiled from
 * spec/schemas/expectations/ by spec/scripts/build-spec.ts). Loading is tolerant: a missing or
 * unreadable file yields no expectations plus a warning, and any connection whose triple the
 * catalog does not allow is ignored (with a warning), so the spec's relationship refinement can
 * retire predicates without breaking anything here.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RELATIONSHIPS_BY_DESTINATION, RELATIONSHIPS_BY_SOURCE } from "../generated/relationship-index.js";
import { isValidSpecNodeId } from "../generated/node-types.js";

export type ExpectationDirection = "outgoing" | "incoming";

export interface ExpectedConnection {
  direction: ExpectationDirection;
  predicate: string;
  other?: { types?: string[]; layers?: string[] };
  /** The other-end types the catalog allows for this connection; the ones that satisfy it. */
  allowedTypes: string[];
}

export interface ConnectionExpectation {
  id: string;
  layer: string;
  source: string;
  rationale: string;
  anyOf: ExpectedConnection[];
}

export interface ExpectationSet {
  expectations: ConnectionExpectation[];
  /** Problems found while loading. Reported, never thrown. */
  warnings: string[];
  bySource: Map<string, ConnectionExpectation[]>;
}

/** One connection of an element, as the matcher sees it. */
export interface ElementConnection {
  direction: "out" | "in";
  predicate: string;
  /** Spec node id of the element at the other end. */
  otherType: string;
}

function defaultPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "schemas", "bundled", "expectations.json");
}

/**
 * Builds an expectation set from parsed `expectations.json` contents. Exposed for tests and for
 * callers that already hold the data; `loadExpectations` reads the bundled file.
 */
export function buildExpectationSet(data: unknown, warnings: string[] = []): ExpectationSet {
  const expectations: ConnectionExpectation[] = [];
  const list = (data as { expectations?: unknown } | null)?.expectations;
  if (!Array.isArray(list)) {
    warnings.push("expectations.json has no 'expectations' array; no connection expectations are in effect");
    return index(expectations, warnings);
  }

  for (const raw of list) {
    const exp = raw as Partial<ConnectionExpectation> & { anyOf?: unknown };
    if (!exp || typeof exp.id !== "string" || typeof exp.source !== "string" || !Array.isArray(exp.anyOf)) {
      warnings.push(`ignored a malformed expectation: ${JSON.stringify(raw)?.slice(0, 120)}`);
      continue;
    }
    if (!isValidSpecNodeId(exp.source)) {
      warnings.push(`${exp.id}: ignored, source type '${exp.source}' is not in this spec`);
      continue;
    }
    const anyOf: ExpectedConnection[] = [];
    for (const conn of exp.anyOf as Array<Partial<ExpectedConnection>>) {
      if (!conn || (conn.direction !== "outgoing" && conn.direction !== "incoming") || typeof conn.predicate !== "string") {
        warnings.push(`${exp.id}: ignored a malformed connection: ${JSON.stringify(conn)}`);
        continue;
      }
      const allowedTypes = allowedOtherTypes(exp.source, conn.direction, conn.predicate, conn.other);
      if (allowedTypes.length === 0) {
        warnings.push(`${exp.id}: ignored ${conn.direction} '${conn.predicate}', which the catalog no longer allows`);
        continue;
      }
      anyOf.push({
        direction: conn.direction,
        predicate: conn.predicate,
        ...(conn.other ? { other: conn.other } : {}),
        allowedTypes,
      });
    }
    if (anyOf.length === 0) {
      warnings.push(`${exp.id}: ignored, the catalog allows none of its connections`);
      continue;
    }
    expectations.push({
      id: exp.id,
      layer: typeof exp.layer === "string" ? exp.layer : exp.source.split(".")[0],
      source: exp.source,
      rationale: typeof exp.rationale === "string" ? exp.rationale : "",
      anyOf,
    });
  }
  return index(expectations, warnings);
}

let cached: ExpectationSet | null = null;
let warnedOnce = false;

/**
 * The bundled expectation set, loaded once. Never throws: a missing or unreadable file yields an
 * empty set whose `warnings` say why (and are printed to stderr once).
 */
export function loadExpectations(filePath?: string): ExpectationSet {
  if (!filePath && cached) return cached;
  const target = filePath ?? defaultPath();
  const warnings: string[] = [];
  let set: ExpectationSet;
  try {
    set = buildExpectationSet(JSON.parse(fs.readFileSync(target, "utf-8")), warnings);
  } catch (err) {
    warnings.push(`could not read connection expectations from ${target}: ${(err as Error).message}`);
    set = index([], warnings);
  }
  if (!filePath) {
    cached = set;
    if (warnings.length > 0 && !warnedOnce) {
      warnedOnce = true;
      for (const w of warnings) console.warn(`[dr] connection expectations: ${w}`);
    }
  }
  return set;
}

/** The expectations whose source is `specNodeId`. */
export function expectationsFor(specNodeId: string, set: ExpectationSet = loadExpectations()): ConnectionExpectation[] {
  return set.bySource.get(specNodeId) ?? [];
}

/** Whether `connections` satisfy at least one of the expectation's alternatives. */
export function isExpectationMet(expectation: ConnectionExpectation, connections: ElementConnection[]): boolean {
  return expectation.anyOf.some((alt) => connections.some((c) => connectionMatches(alt, c)));
}

export function connectionMatches(alt: ExpectedConnection, c: ElementConnection): boolean {
  return (
    c.direction === (alt.direction === "outgoing" ? "out" : "in") &&
    c.predicate === alt.predicate &&
    alt.allowedTypes.includes(c.otherType)
  );
}

/** `application.applicationcomponent --assigned-to--> it`, one per alternative. */
export function describeAlternatives(expectation: ConnectionExpectation): string[] {
  return expectation.anyOf.map((alt) => {
    const other = describeOther(alt);
    return alt.direction === "outgoing" ? `it --${alt.predicate}--> ${other}` : `${other} --${alt.predicate}--> it`;
  });
}

function describeOther(alt: ExpectedConnection): string {
  const parts = [...(alt.other?.types ?? []), ...(alt.other?.layers ?? []).map((l) => `any ${l} element`)];
  if (parts.length === 0) return alt.allowedTypes.length <= 3 ? alt.allowedTypes.join(" | ") : "any allowed element";
  return parts.join(" | ");
}

function allowedOtherTypes(
  source: string,
  direction: ExpectationDirection,
  predicate: string,
  other: ExpectedConnection["other"]
): string[] {
  const candidates =
    direction === "outgoing"
      ? (RELATIONSHIPS_BY_SOURCE.get(source) ?? []).filter((r) => r.predicate === predicate).map((r) => r.destinationSpecNodeId)
      : (RELATIONSHIPS_BY_DESTINATION.get(source) ?? []).filter((r) => r.predicate === predicate).map((r) => r.sourceSpecNodeId);
  const unique = [...new Set<string>(candidates)];
  if (!other || (!other.types && !other.layers)) return unique;
  return unique.filter(
    (t) => (other.types ?? []).includes(t) || (other.layers ?? []).includes(t.slice(0, t.indexOf(".")))
  );
}

function index(expectations: ConnectionExpectation[], warnings: string[]): ExpectationSet {
  const bySource = new Map<string, ConnectionExpectation[]>();
  for (const e of expectations) {
    const list = bySource.get(e.source) ?? [];
    list.push(e);
    bySource.set(e.source, list);
  }
  return { expectations, warnings, bySource };
}
