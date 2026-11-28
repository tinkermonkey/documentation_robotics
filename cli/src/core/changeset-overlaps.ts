/**
 * How staged changesets overlap each other (#1209), before any of them lands.
 *
 * Drift (changeset-base-index.ts) says what the base changed under one changeset. Several staged
 * changesets are in the same position towards each other: whichever lands first becomes the base
 * for the next. So an overlap here is what the drift report would say about the later changeset
 * once the earlier one has landed, with the same reasons and the same consequences, plus the two
 * things a drift report cannot see before a landing: a full-element update that would silently
 * replace another's text, and a link that ends on an element another changeset changes.
 *
 * It reads staged changes only, never the base, and decides nothing: nothing is merged. Where two
 * changes cannot both land as they are it says so, and lists what one combined change would carry
 * (the agent writes it). A landing order is a suggestion that satisfies the constraints it can see.
 */

import type { Changeset, StagedChange } from "./changeset.js";
import { sequenceOf } from "./changeset.js";
import { contentHash, overlapConsequence, type ElementOverlapReason, type RelationshipOverlapReason } from "./changeset-base-index.js";
import { elementFromRecord, relationshipKey, type GraphElement } from "./changeset-graph.js";

export type OverlapReason = ElementOverlapReason | RelationshipOverlapReason | "endpoint-changed-elsewhere" | "endpoint-added-elsewhere";

/**
 * How much the overlap matters:
 * - `conflict`: the two cannot both land as they are; something would be replaced, removed or left dangling.
 * - `ordered`: both can land, in one order only.
 * - `agrees`: both stage the same thing; the later one is skipped or repeats the earlier.
 * - `info`: worth knowing, nothing to do (a link to an element another changeset edits).
 */
export type OverlapSeverity = "conflict" | "ordered" | "agrees" | "info";

/** The fields of an element that differ, for a combined change. */
export interface FieldChange {
  field: string;
  /** The element's value when both changesets staged their change on it (absent when unknown). */
  base?: unknown;
  /** Each changeset's value, by name. */
  values: Record<string, unknown>;
}

export interface CombinedChange {
  /** What each changeset changed, by name. Fields only one of them changed carry no conflict. */
  changedBy: Record<string, string[]>;
  /** Fields both changed to different values: someone has to decide. */
  conflicts: FieldChange[];
  /** Fields only one changed, and who: both are kept in a combined change. */
  keeps: FieldChange[];
  /** What to do, as a sentence. */
  needs: string;
}

export interface ChangesetOverlap {
  of: "element" | "relationship";
  /** An element's id, or a relationship as `source --predicate--> target`. */
  id: string;
  /** The two changesets, as `[earlier, later]` in the suggested landing order. */
  changesets: [string, string];
  /** What each stages: add, update or delete for elements; add or delete for relationships. */
  operations: Record<string, string>;
  reason: OverlapReason;
  severity: OverlapSeverity;
  /** What landing the later one after the earlier one does, in the drift report's words. */
  consequence: string;
  resolve: string;
  /** For a link that ends on an element the other changeset changes: that element. */
  endpoint?: string;
  /** For two full-element changes that differ: what a combined change would carry. */
  combined?: CombinedChange;
}

export interface OverlapChangeset {
  id: string;
  name: string;
  changes: number;
  dependsOn?: string[];
}

export interface OverlapReport {
  changesets: OverlapChangeset[];
  /** Counts over every overlap, whatever page is returned. */
  counts: { total: number; bySeverity: Record<OverlapSeverity, number>; pairs: number };
  /** Pairs with overlaps, with how many of each severity; the pairs without are not listed. */
  pairs: Array<{ changesets: [string, string]; total: number; conflicts: number; ordered: number }>;
  overlaps: ChangesetOverlap[];
  /** A landing order that satisfies the ordering constraints, as names. A suggestion. */
  suggestedOrder: string[];
  /** Why the order is what it is, and what it could not settle. */
  orderNotes: string[];
  /** What this comparison could not see, so an empty list is never read as "no overlap". */
  notChecked: string[];
}

interface ElementTouch {
  /** Net effect: what landing the changeset does to the element. */
  op: "add" | "update" | "delete";
  /** The element as the changeset leaves it (absent for a delete). */
  after?: GraphElement;
  /** The element as the changeset's first change found it (absent for an add). */
  before?: GraphElement;
}

interface Footprint {
  changeset: Changeset;
  elements: Map<string, ElementTouch>;
  /** Net relationship operations by key `source::predicate::target`. */
  relationships: Map<string, "add" | "delete">;
}

function parseRelationship(change: StagedChange): { source: string; predicate: string; target: string } | undefined {
  const data = (change.type === "relationship-delete" ? (change.before ?? change.after) : change.after) as
    | { source?: string; predicate?: string; target?: string }
    | undefined;
  const [source, predicate, target] =
    data?.source && data.predicate && data.target ? [data.source, data.predicate, data.target] : change.elementId.split("::");
  return source && predicate && target ? { source, predicate, target } : undefined;
}

/** What a changeset does to each element and relationship, in the order it staged it. */
function footprintOf(changeset: Changeset): Footprint {
  const elements = new Map<string, ElementTouch>();
  const relationships = new Map<string, "add" | "delete">();
  const ordered = (changeset.changes as StagedChange[])
    .map((change, index) => ({ change, sequence: sequenceOf(change, index) }))
    .sort((a, b) => a.sequence - b.sequence);
  for (const { change } of ordered) {
    if (change.type === "relationship-add" || change.type === "relationship-delete") {
      const rel = parseRelationship(change);
      if (rel) relationships.set(relationshipKey(rel), change.type === "relationship-add" ? "add" : "delete");
      continue;
    }
    const id = change.elementId;
    const known = elements.get(id);
    const record = (value: unknown) =>
      value && typeof value === "object" ? elementFromRecord(value as Record<string, unknown>, change.layerName, id) : undefined;
    if (change.type === "add") {
      // A delete then an add leaves an element the base had, replaced.
      elements.set(id, known?.op === "delete" ? { op: "update", before: known.before, after: record(change.after) } : { op: "add", after: record(change.after) });
    } else if (change.type === "update") {
      elements.set(id, { op: known?.op === "add" ? "add" : "update", before: known?.before ?? record(change.before), after: record(change.after) ?? known?.after });
    } else {
      // An element the changeset added and deletes again is nothing to land.
      if (known?.op === "add") elements.delete(id);
      else elements.set(id, { op: "delete", before: known?.before ?? record(change.before) });
    }
  }
  return { changeset, elements, relationships };
}

const CONTENT_FIELDS = ["type", "name", "description", "sourceReference"] as const;

/** The content of an element as `field → value`, attributes one field each. */
function fieldsOf(element: GraphElement | undefined): Map<string, unknown> {
  const fields = new Map<string, unknown>();
  if (!element) return fields;
  for (const field of CONTENT_FIELDS) fields.set(field, element[field] ?? null);
  for (const [key, value] of Object.entries(element.attributes ?? {})) fields.set(`attributes.${key}`, value);
  return fields;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The fields where `a` and `b` differ, any of the fields either has. */
function differing(a: Map<string, unknown>, b: Map<string, unknown>): string[] {
  return [...new Set([...a.keys(), ...b.keys()])].filter((field) => !same(a.get(field), b.get(field))).sort();
}

/**
 * What one combined update of an element would carry, given two changesets' full-element changes of
 * it. Each staged update carries the whole element, so whichever lands last restores the base's value
 * of every field the earlier one changed: the fields are compared with the element as both found it.
 */
function combine(
  name: Record<"a" | "b", string>,
  a: ElementTouch,
  b: ElementTouch
): CombinedChange {
  const baseElement = a.before ?? b.before;
  const base = fieldsOf(baseElement);
  const fa = fieldsOf(a.after);
  const fb = fieldsOf(b.after);
  const changedByA = baseElement ? differing(base, fa) : [...fa.keys()];
  const changedByB = baseElement ? differing(base, fb) : [...fb.keys()];
  const both = changedByA.filter((f) => changedByB.includes(f));
  const conflicts: FieldChange[] = both
    .filter((f) => !same(fa.get(f), fb.get(f)))
    .map((field) => ({ field, ...(base.has(field) ? { base: base.get(field) } : {}), values: { [name.a]: fa.get(field), [name.b]: fb.get(field) } }));
  const keeps: FieldChange[] = [
    ...changedByA.filter((f) => !changedByB.includes(f)).map((field) => ({ field, ...(base.has(field) ? { base: base.get(field) } : {}), values: { [name.a]: fa.get(field) } })),
    ...changedByB.filter((f) => !changedByA.includes(f)).map((field) => ({ field, ...(base.has(field) ? { base: base.get(field) } : {}), values: { [name.b]: fb.get(field) } })),
  ];
  const needs =
    conflicts.length > 0
      ? `Both change ${conflicts.map((c) => c.field).join(", ")} to different values: decide each, and stage one update carrying them` +
        (keeps.length > 0 ? ` along with the fields only one changes (${keeps.map((k) => k.field).join(", ")})` : "") +
        ". Then unstage the element from the other."
      : `They change different fields (${keeps.map((k) => k.field).join(", ") || "none that differ"}), but each stages the whole element, so the one that lands last puts back the base's value of what the first changed: stage one update carrying both changes in one of them, and unstage the element from the other.`;
  return { changedBy: { [name.a]: changedByA, [name.b]: changedByB }, conflicts, keeps, needs };
}

/** Whether two elements' content is the same, as drift compares it. */
function sameContent(a?: GraphElement, b?: GraphElement): boolean {
  return !!a && !!b && contentHash(a) === contentHash(b);
}

interface RawOverlap {
  of: "element" | "relationship";
  id: string;
  a: string;
  b: string;
  opA: string;
  opB: string;
  /** Severity once the order is known may differ: updates and deletes are decided by the order. */
  endpoint?: string;
  kind:
    | "same-add"
    | "both-full-change"
    | "delete-vs-change"
    | "both-delete"
    | "link-same-add"
    | "link-same-delete"
    | "link-add-delete"
    | "link-to-deleted"
    | "link-to-added"
    | "link-to-changed";
  /** The changeset that must land before the other, when the pair has such a constraint. */
  before?: "a" | "b";
  /** The changeset that must land last (a delete), when it is not an ordering of necessity. */
  last?: "a" | "b";
  combined?: CombinedChange;
}

function endpointsOf(key: string): [string, string] {
  const [source, , target] = key.split("::");
  return [source, target];
}

const tripleOf = (key: string): string => {
  const [source, predicate, target] = key.split("::");
  return `${source} --${predicate}--> ${target}`;
};

function comparePair(fa: Footprint, fb: Footprint): RawOverlap[] {
  const out: RawOverlap[] = [];
  const a = fa.changeset.name;
  const b = fb.changeset.name;
  const names = { a, b };

  for (const [id, ta] of fa.elements) {
    const tb = fb.elements.get(id);
    if (!tb) continue;
    const base = { of: "element" as const, id, a, b, opA: ta.op, opB: tb.op };
    if (ta.op === "delete" && tb.op === "delete") {
      out.push({ ...base, kind: "both-delete" });
    } else if (ta.op === "delete" || tb.op === "delete") {
      // The delete lands last: what the other stages for the element is then lost with it, or it
      // would have nothing to apply to.
      out.push({ ...base, kind: "delete-vs-change", last: ta.op === "delete" ? "a" : "b" });
    } else if (ta.op === "add" && tb.op === "add") {
      out.push({ ...base, kind: sameContent(ta.after, tb.after) ? "same-add" : "both-full-change", ...(sameContent(ta.after, tb.after) ? {} : { combined: combine(names, ta, tb) }) });
    } else if (sameContent(ta.after, tb.after)) {
      out.push({ ...base, kind: "same-add" });
    } else {
      const raw: RawOverlap = { ...base, kind: "both-full-change", combined: combine(names, ta, tb) };
      // An update of an element the other adds can only land after that add.
      if (ta.op === "add" && tb.op === "update") raw.before = "a";
      if (ta.op === "update" && tb.op === "add") raw.before = "b";
      out.push(raw);
    }
  }

  for (const [key, opA] of fa.relationships) {
    const opB = fb.relationships.get(key);
    if (!opB) continue;
    const kind = opA === opB ? (opA === "add" ? "link-same-add" : "link-same-delete") : "link-add-delete";
    out.push({ of: "relationship", id: tripleOf(key), a, b, opA, opB, kind });
  }

  // Links that end on an element the other changeset changes.
  const linkEnds = (holder: Footprint, other: Footprint, holderIsA: boolean): void => {
    for (const [key, op] of holder.relationships) {
      for (const end of new Set(endpointsOf(key))) {
        const touched = other.elements.get(end);
        if (!touched) continue;
        const mine = holder.elements.get(end);
        // An element both stage is already an element overlap.
        if (mine) continue;
        const raw: RawOverlap = {
          of: "relationship",
          id: tripleOf(key),
          a: holderIsA ? holder.changeset.name : other.changeset.name,
          b: holderIsA ? other.changeset.name : holder.changeset.name,
          opA: "",
          opB: "",
          endpoint: end,
          kind: touched.op === "delete" ? "link-to-deleted" : touched.op === "add" ? "link-to-added" : "link-to-changed",
        };
        const otherName = other.changeset.name;
        raw.opA = holderIsA ? `${op} link` : `${touched.op} ${end}`;
        raw.opB = holderIsA ? `${touched.op} ${end}` : `${op} link`;
        // Which of the two the constraint names: the adder before the holder; the delete last.
        const side = (name: string): "a" | "b" => (name === raw.a ? "a" : "b");
        if (touched.op === "add" && op === "add") raw.before = side(otherName);
        if (touched.op === "delete" && op === "add") raw.last = side(otherName);
        if (touched.op === "delete" && op === "delete") raw.kind = "link-to-changed";
        out.push(raw);
      }
    }
  };
  linkEnds(fa, fb, true);
  linkEnds(fb, fa, false);
  return out;
}

/**
 * The order the constraints allow: dependencies first, an adder before what links to its element,
 * a delete last, otherwise the given order. Names the constraints it could not satisfy.
 */
function orderChangesets(
  footprints: Footprint[],
  raws: RawOverlap[]
): { order: string[]; notes: string[] } {
  const names = footprints.map((f) => f.changeset.name);
  const idToName = new Map(footprints.map((f) => [f.changeset.id, f.changeset.name]));
  const edges: Array<[string, string, string]> = []; // [first, then, why]
  for (const f of footprints) {
    for (const dep of f.changeset.dependsOn ?? []) {
      const depName = idToName.get(dep);
      if (depName) edges.push([depName, f.changeset.name, `'${f.changeset.name}' depends on '${depName}'`]);
    }
  }
  for (const raw of raws) {
    if (raw.before) {
      const [first, then] = raw.before === "a" ? [raw.a, raw.b] : [raw.b, raw.a];
      edges.push([first, then, `'${then}' stages a change to ${raw.endpoint ?? raw.id} that '${first}' adds`]);
    }
    if (raw.last) {
      const [then, first] = raw.last === "a" ? [raw.a, raw.b] : [raw.b, raw.a];
      edges.push([first, then, `'${then}' deletes ${raw.endpoint ?? raw.id}, which '${first}' also changes or links to: the delete lands last`]);
    }
  }
  const notes: string[] = [];
  const placed: string[] = [];
  const remaining = [...names];
  const unique = new Map<string, [string, string, string]>();
  for (const e of edges) if (!unique.has(`${e[0]}\u0000${e[1]}`)) unique.set(`${e[0]}\u0000${e[1]}`, e);
  const constraints = [...unique.values()].filter(([x, y]) => x !== y);
  while (remaining.length > 0) {
    const ready = remaining.find((n) => !constraints.some(([first, then]) => then === n && remaining.includes(first)));
    if (ready === undefined) {
      const stuck = constraints.filter(([first, then]) => remaining.includes(first) && remaining.includes(then));
      notes.push(
        `These must each land before the other, so no order satisfies them: ${stuck.map(([, , why]) => why).join("; ")}. ` +
          "One of the changesets has to change (a combined changeset, or a dependsOn)."
      );
      placed.push(...remaining);
      break;
    }
    placed.push(ready);
    remaining.splice(remaining.indexOf(ready), 1);
  }
  for (const [first, then, why] of constraints) {
    if (placed.indexOf(first) < placed.indexOf(then)) notes.push(`'${first}' before '${then}': ${why}.`);
  }
  return { order: placed, notes };
}

/** The overlap as the later changeset meets it once the earlier one has landed. */
function describe(raw: RawOverlap, earlier: "a" | "b", names: { earlier: string; later: string }): Pick<ChangesetOverlap, "reason" | "severity" | "consequence" | "resolve"> {
  const laterOp = earlier === "a" ? raw.opB : raw.opA;
  const prefix = `After '${names.earlier}' lands, '${names.later}' overlaps it. `;
  const ofDrift = (kind: "element" | "relationship", reason: ElementOverlapReason | RelationshipOverlapReason, op?: string) => {
    const { consequence, resolve } = overlapConsequence(kind, reason, op);
    return { consequence: prefix + consequence.replace(/\bThe base\b/g, `'${names.earlier}'`).replace(/\bthe base's\b/g, `'${names.earlier}'s`).replace(/\bthe base\b/g, `'${names.earlier}'`), resolve: resolve.replace(/\bthe base's\b/g, `'${names.earlier}'s`).replace(/\bthe base\b/g, `'${names.earlier}'`) };
  };
  switch (raw.kind) {
    case "same-add":
      return { reason: "already-in-base", severity: "agrees", ...ofDrift("element", "already-in-base", "add") };
    case "both-full-change":
      // The later one's whole-element change replaces what the earlier one landed.
      return {
        reason: raw.opA === "add" && raw.opB === "add" ? "already-in-base" : "changed-in-base",
        severity: "conflict",
        ...(raw.opA === "add" && raw.opB === "add"
          ? {
              consequence: `${prefix}Both add this element with different content: '${names.later}''s add is skipped, so '${names.earlier}''s version stands and '${names.later}''s text is lost.`,
              resolve: "Stage one add that carries what both need, and unstage it from the other.",
            }
          : {
              consequence: `${prefix}Each stages the whole element, so '${names.later}' replaces what '${names.earlier}' landed, silently, including the fields only '${names.earlier}' changed.`,
              resolve: "Stage one update that carries both changes (see combined), and unstage the element from the other.",
            }),
      };
    case "delete-vs-change": {
      const deleterIsLater = laterOp === "delete";
      return deleterIsLater
        ? { reason: "changed-in-base", severity: "conflict", ...ofDrift("element", "changed-in-base", "delete") }
        : { reason: "removed-in-base", severity: "conflict", ...ofDrift("element", "removed-in-base", laterOp) };
    }
    case "both-delete":
      return { reason: "already-removed", severity: "agrees", ...ofDrift("element", "already-removed", "delete") };
    case "link-same-add":
      return { reason: "already-in-base", severity: "agrees", ...ofDrift("relationship", "already-in-base", "add") };
    case "link-same-delete":
      return { reason: "already-removed", severity: "agrees", ...ofDrift("relationship", "already-removed", "delete") };
    case "link-add-delete":
      return { reason: "already-removed", severity: "conflict", ...ofDrift("relationship", "already-removed", laterOp.startsWith("add") ? "add" : "delete") };
    case "link-to-deleted":
    case "link-to-added":
    case "link-to-changed":
      return describeLink(raw, earlier, names, prefix);
  }
}

function describeLink(
  raw: RawOverlap,
  earlier: "a" | "b",
  names: { earlier: string; later: string },
  prefix: string
): Pick<ChangesetOverlap, "reason" | "severity" | "consequence" | "resolve"> {
  const end = raw.endpoint!;
  if (raw.kind === "link-to-added") {
    return earlier === (raw.before ?? earlier)
      ? {
          reason: "endpoint-added-elsewhere",
          severity: "ordered",
          consequence: `${prefix}The link ends on ${end}, which '${names.earlier}' adds, so it lands after it.`,
          resolve: `Land '${names.earlier}' first, or make '${names.later}' depend on it (changeset_update with dependsOn).`,
        }
      : {
          reason: "endpoint-added-elsewhere",
          severity: "conflict",
          consequence: `${prefix}The link ends on ${end}, which '${names.later}' adds and '${names.earlier}' lands first: the link has nothing to end on.`,
          resolve: `Land '${names.later}' first.`,
        };
  }
  if (raw.kind === "link-to-deleted") {
    const deleterIsEarlier = (earlier === "a" ? raw.opA : raw.opB).startsWith("delete");
    return deleterIsEarlier
      ? {
          reason: "endpoint-removed-in-base",
          severity: "conflict",
          consequence: `${prefix}'${names.earlier}' deletes ${end}, which is an end of this link: landing writes a link to an element that no longer exists, which validation may refuse.`,
          resolve: `Point the link at the element that replaces ${end}, or unstage it.`,
        }
      : {
          reason: "linked-in-base",
          severity: "conflict",
          consequence: `${prefix}'${names.earlier}' links ${end}, which '${names.later}' deletes; landing the delete takes that link with it, without a word.`,
          resolve: `Stage the link's delete in '${names.later}' too if it should go, or unstage the delete of ${end}.`,
        };
  }
  return {
    reason: "endpoint-changed-elsewhere",
    severity: "info",
    consequence: `${prefix}The link ends on ${end}, which the other changeset changes. The element keeps its id, so the link is as right as it was.`,
    resolve: "Nothing to do.",
  };
}

export interface OverlapOptions {
  /** The most overlaps listed (default: all). A page size: counts are always whole. */
  limit?: number;
  offset?: number;
}

/**
 * Compares the changesets pairwise. `changesets` are staged plans in the order the caller wants them
 * considered (the suggested order starts from it).
 */
export function computeChangesetOverlaps(changesets: Changeset[], options: OverlapOptions = {}): OverlapReport {
  const footprints = changesets.map(footprintOf);
  const raws: RawOverlap[] = [];
  for (let i = 0; i < footprints.length; i++) {
    for (let j = i + 1; j < footprints.length; j++) raws.push(...comparePair(footprints[i], footprints[j]));
  }
  const { order, notes } = orderChangesets(footprints, raws);
  const position = new Map(order.map((n, i) => [n, i]));

  // A changeset that depends on the other builds on it, so the two are ordered, not in conflict.
  const idByName = new Map(changesets.map((c) => [c.name, c.id]));
  const dependsOnOther = (x: string, y: string): boolean => !!changesets.find((c) => c.name === x)?.dependsOn?.includes(idByName.get(y) ?? "");

  const overlaps: ChangesetOverlap[] = raws.map((raw) => {
    const earlier: "a" | "b" = (position.get(raw.a) ?? 0) <= (position.get(raw.b) ?? 0) ? "a" : "b";
    const names = earlier === "a" ? { earlier: raw.a, later: raw.b } : { earlier: raw.b, later: raw.a };
    const described = describe(raw, earlier, names);
    const ordered = dependsOnOther(names.later, names.earlier);
    return {
      of: raw.of,
      id: raw.id,
      changesets: [names.earlier, names.later],
      operations: { [raw.a]: raw.opA, [raw.b]: raw.opB },
      ...described,
      // Built on the other: the later one's change was staged on the earlier one's, not over it.
      ...(ordered && described.severity === "conflict" && raw.kind === "both-full-change" ? { severity: "ordered" as const } : {}),
      ...(raw.endpoint ? { endpoint: raw.endpoint } : {}),
      ...(raw.combined && !(ordered && raw.kind === "both-full-change") ? { combined: raw.combined } : {}),
    };
  });

  const bySeverity: Record<OverlapSeverity, number> = { conflict: 0, ordered: 0, agrees: 0, info: 0 };
  for (const o of overlaps) bySeverity[o.severity]++;
  const pairMap = new Map<string, { changesets: [string, string]; total: number; conflicts: number; ordered: number }>();
  for (const o of overlaps) {
    const key = [...o.changesets].sort().join("\u0000");
    const pair = pairMap.get(key) ?? { changesets: o.changesets, total: 0, conflicts: 0, ordered: 0 };
    pair.total++;
    if (o.severity === "conflict") pair.conflicts++;
    if (o.severity === "ordered") pair.ordered++;
    pairMap.set(key, pair);
  }

  // Conflicts first, then what is ordered, so the first page is what needs a decision.
  const rank: Record<OverlapSeverity, number> = { conflict: 0, ordered: 1, agrees: 2, info: 3 };
  const sorted = [...overlaps].sort((x, y) => rank[x.severity] - rank[y.severity]);
  const offset = Math.max(0, options.offset ?? 0);
  const page = options.limit === undefined ? sorted.slice(offset) : sorted.slice(offset, offset + Math.max(1, options.limit));

  return {
    changesets: changesets.map((c) => ({
      id: c.id,
      name: c.name,
      changes: c.changes.length,
      ...(c.dependsOn?.length ? { dependsOn: c.dependsOn } : {}),
    })),
    counts: { total: overlaps.length, bySeverity, pairs: pairMap.size },
    pairs: [...pairMap.values()],
    overlaps: page,
    suggestedOrder: order,
    orderNotes: notes,
    notChecked: [
      "Only the staged changes are compared. What each changeset would do to the base is the drift report's (changeset_brief with sections: [\"drift\"]).",
      "Elements are matched by id: two changesets that stage the same thing under different names are not seen as overlapping.",
    ],
  };
}
