/**
 * The free finders that need only the model and the catalog (no code index, no model call).
 * Each returns findings at its own level of precision:
 *
 * - `relationship`: this source, predicate and target.
 * - `link`: these two elements should be related; `candidates` are the relationship types the
 *   catalog allows between them.
 * - `shape`: this element lacks a relationship of this predicate to (or from) some element of a type.
 * - `type`: the model lacks (or barely uses) this relationship type.
 * - `pair`: the two layers have no relationships.
 * - `element`: code that looks like a missing element.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  HARNESS_DIR,
  layerOf,
  pairKey,
  triplesBetween,
  type Catalog
} from "./catalog.js";
import type { Ledger } from "./ledger-core.js";
import {
  shapeKey,
  unorderedKey,
  type El,
  type Model,
  type ModelIndex
} from "./model.js";

export type Level =
  | "relationship"
  | "link"
  | "shape"
  | "type"
  | "pair"
  | "element";

export interface Finding {
  finder: string;
  level: Level;
  /** Identity within the finder, for comparing two runs. */
  key: string;
  /** relationship */
  source?: string;
  predicate?: string;
  target?: string;
  /** link: the two elements, and the triple ids allowed between their types. */
  ends?: [string, string];
  candidates?: string[];
  /** shape */
  element?: string;
  direction?: "out" | "in";
  otherType?: string;
  /** type */
  triple?: string;
  /** pair */
  pair?: string;
  /** element: code nodes (qualified names) that may be a missing element. */
  nodes?: string[];
  file?: string;
  rank?: number;
  evidence: string;
}

export interface FinderContext {
  model: Model;
  idx: ModelIndex;
  catalog: Catalog;
  ledger: Ledger;
  /** Other models' used and instantiable triples, for the fleet prior. */
  fleet: Array<{ name: string; types: Set<string>; used: Set<string> }>;
}

export type Finder = (ctx: FinderContext) => Finding[];

const shapeFinding = (
  finder: string,
  el: El,
  direction: "out" | "in",
  predicate: string,
  otherType: string,
  evidence: string
): Finding => ({
  finder,
  level: "shape",
  key: shapeKey(el.id, direction, predicate, otherType),
  element: el.id,
  direction,
  predicate,
  otherType,
  evidence
});

/** The ledger's own rows, as the questions a reviewer would be asked. */
export const emptyPairs: Finder = ({ ledger }) =>
  ledger.pairs
    .filter((p) => p.state === "empty")
    .map((p) => ({
      finder: "ledger-empty-pair",
      level: "pair",
      key: p.key,
      pair: p.key,
      evidence: `${p.instantiable} instantiable types, 0 relationships`
    }));

export const unusedTypes: Finder = ({ ledger }) =>
  ledger.types
    .filter((t) => t.crossLayer && t.state !== "used")
    .map((t) => ({
      finder: "ledger-open-type",
      level: "type",
      key: t.triple.id,
      triple: t.triple.id,
      evidence: `${t.participating} of ${t.sources} sources have it`
    }));

/** S4: a relationship shape most of a type's elements have, and the elements that lack it. */
export const PEER_MIN_ELEMENTS = 5;
export const PEER_SHARE = 0.8;

export const peerPatterns: Finder = ({ model, idx }) => {
  const have = new Map<string, Set<string>>(); // `${type}|${dir}|${pred}|${otherType}` -> elements
  for (const r of model.rels) {
    const s = model.elements.get(r.source)!;
    const t = model.elements.get(r.target)!;
    for (const [el, dir, other] of [
      [s, "out", t.type],
      [t, "in", s.type]
    ] as const) {
      const key = `${el.type}|${dir}|${r.predicate}|${other}`;
      const set = have.get(key) ?? new Set<string>();
      set.add(el.id);
      have.set(key, set);
    }
  }
  const out: Finding[] = [];
  for (const [key, set] of have) {
    const [type, dir, predicate, otherType] = key.split("|");
    const all = idx.byType.get(type) ?? [];
    if (
      all.length < PEER_MIN_ELEMENTS ||
      set.size === all.length ||
      set.size / all.length < PEER_SHARE
    )
      continue;
    for (const el of all) {
      if (!set.has(el.id))
        out.push(
          shapeFinding(
            "peer-pattern",
            el,
            dir as "out" | "in",
            predicate,
            otherType,
            `${set.size} of ${all.length} ${type} have it`
          )
        );
    }
  }
  return out;
};

/** S1-prior: a relationship type this model does not use and most other models with both types do. */
export const FLEET_MIN_SUPPORT = 2;
export const FLEET_SHARE = 0.5;

export const fleetPrior: Finder = ({ ledger, fleet }) => {
  const out: Finding[] = [];
  for (const row of ledger.types) {
    if (row.state === "used") continue;
    const t = row.triple;
    const support = fleet.filter(
      (m) => m.types.has(t.source) && m.types.has(t.destination)
    );
    const hits = support.filter((m) => m.used.has(t.id));
    if (
      support.length < FLEET_MIN_SUPPORT ||
      hits.length / support.length < FLEET_SHARE
    )
      continue;
    out.push({
      finder: "fleet-prior",
      level: "type",
      key: t.id,
      triple: t.id,
      evidence: `${hits.length} of ${support.length} other models use it (${hits.map((m) => m.name).join(", ")})`
    });
  }
  return out;
};

const NAME_STOP = new Set([
  "schema",
  "schemas",
  "table",
  "tables",
  "collection",
  "view",
  "page",
  "screen",
  "route",
  "component",
  "service",
  "store",
  "api",
  "endpoint",
  "operation",
  "model",
  "entity",
  "dto",
  "record",
  "type",
  "interface",
  "handler",
  "controller",
  "repository",
  "the",
  "a",
  "of",
  "for"
]);

export function normalizeName(name: string): string {
  const tokens = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !NAME_STOP.has(t))
    .map((t) =>
      t.length > 3 && t.endsWith("ies")
        ? `${t.slice(0, -3)}y`
        : t.length > 3 && t.endsWith("s") && !t.endsWith("ss")
          ? t.slice(0, -1)
          : t
    );
  return tokens.join("");
}

function linkFinding(
  finder: string,
  a: El,
  b: El,
  catalog: Catalog,
  idx: ModelIndex,
  evidence: string
): Finding | null {
  // Only relationship types the pair does not already have.
  const candidates = triplesBetween(catalog, a.type, b.type)
    .filter((t) => {
      const [s, d] =
        t.source === a.type && t.destination === b.type ? [a, b] : [b, a];
      const forward = !idx.relKeys.has(`${s.id}|${t.predicate}|${d.id}`);
      // Same-type pairs: either direction counts as having it.
      return a.type === b.type
        ? forward && !idx.relKeys.has(`${d.id}|${t.predicate}|${s.id}`)
        : forward;
    })
    .map((t) => t.id);
  if (!candidates.length) return null;
  return {
    finder,
    level: "link",
    key: unorderedKey(a.id, b.id),
    ends: [a.id, b.id],
    candidates,
    evidence
  };
}

/** Elements in different layers with the same name once type words and plurals are dropped. */
export const nameJoin: Finder = ({ model, idx, catalog }) => {
  const byName = new Map<string, El[]>();
  for (const el of model.elements.values()) {
    const n = normalizeName(el.name);
    if (n.length < 3) continue;
    byName.set(n, [...(byName.get(n) ?? []), el]);
  }
  const out: Finding[] = [];
  for (const [name, els] of byName) {
    if (els.length < 2 || els.length > 8) continue;
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        if (els[i].layer === els[j].layer) continue;
        const f = linkFinding(
          "name-join",
          els[i],
          els[j],
          catalog,
          idx,
          `both named "${name}"`
        );
        if (f) out.push(f);
      }
    }
  }
  return out;
};

/** Elements in different layers whose source reference is the same file and symbol. */
export const sameSymbol: Finder = ({ model, idx, catalog }) => {
  const bySymbol = new Map<string, El[]>();
  for (const el of model.elements.values()) {
    for (const loc of el.locations) {
      if (!loc.symbol) continue;
      const key = `${loc.file}#${loc.symbol}`;
      const list = bySymbol.get(key) ?? [];
      if (!list.includes(el)) list.push(el);
      bySymbol.set(key, list);
    }
  }
  const out = new Map<string, Finding>();
  for (const [symbol, els] of bySymbol) {
    if (els.length < 2 || els.length > 6) continue;
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        if (els[i].layer === els[j].layer) continue;
        const f = linkFinding(
          "same-symbol",
          els[i],
          els[j],
          catalog,
          idx,
          `both from ${symbol}`
        );
        if (f && !out.has(f.key)) out.set(f.key, f);
      }
    }
  }
  return [...out.values()];
};

interface Check {
  id: string;
  question: string;
  type: string;
  anyOf: Array<{
    direction: "out" | "in";
    predicate: string;
    otherType: string;
  }>;
}

let checksCache: Check[] | null = null;
export function loadChecks(): Check[] {
  checksCache ??= (
    JSON.parse(readFileSync(path.join(HARNESS_DIR, "checks.json"), "utf8")) as {
      checks: Check[];
    }
  ).checks;
  return checksCache;
}

/** S3, deterministic part: each review question as a check over the model. */
export const reviewChecks: Finder = ({ idx }) => {
  const out: Finding[] = [];
  for (const check of loadChecks()) {
    const els = idx.byType.get(check.type) ?? [];
    const applicable = check.anyOf.filter((a) => idx.byType.has(a.otherType));
    if (!els.length || !applicable.length) continue;
    for (const el of els) {
      // Any alternative satisfies the question, whether or not the model has its other type.
      if (
        check.anyOf.some((a) =>
          idx.shapes.has(shapeKey(el.id, a.direction, a.predicate, a.otherType))
        )
      )
        continue;
      for (const a of applicable)
        out.push(
          shapeFinding(
            "review-check",
            el,
            a.direction,
            a.predicate,
            a.otherType,
            `${check.id}: ${check.question}`
          )
        );
    }
  }
  return out;
};

export const MODEL_FINDERS: Record<string, Finder> = {
  "ledger-empty-pair": emptyPairs,
  "ledger-open-type": unusedTypes,
  "peer-pattern": peerPatterns,
  "fleet-prior": fleetPrior,
  "review-check": reviewChecks,
  "name-join": nameJoin,
  "same-symbol": sameSymbol
};

/** What a model contributes to another model's fleet prior. */
export function fleetEntry(
  model: Model,
  idx: ModelIndex
): FinderContext["fleet"][number] {
  return {
    name: model.name,
    types: new Set(idx.byType.keys()),
    used: new Set(idx.usedTriples.keys())
  };
}

export { layerOf, pairKey };
