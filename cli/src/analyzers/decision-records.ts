/**
 * Architecture decision records in the extraction plan.
 *
 * A record CBM indexes (an `ADR` node, cards/docs.ts) states intent, which the rules never decide:
 * each active record becomes a `decision-record` card for the calling agent (Tier 2) to propose a
 * motivation principle, constraint or assessment from, with the record as its source reference
 * (file and record id). A record that is superseded, deprecated or rejected is retired: it gets no
 * card, and an element sourced only from retired records (every location one) is a candidate
 * delete. A record that already has an element (one names its file) is modelled and gets no card
 * either. With `since`, a record is the range's when its file changed; a retired one also when a
 * record that supersedes it changed. Only the range's retired records are listed.
 */
import type { GraphElement } from "../core/changeset-graph.js";
import { cardId } from "./cards/build.js";
import type { DecisionRecord } from "./cards/docs.js";
import { shortQualifiedName } from "./cards/extract.js";
import type { CandidateDelete, CodeChanges, UndecidedCard } from "./extraction-plan.js";

/**
 * Records under test, fixture or vendored paths are a fixture's or a dependency's decisions, not
 * the project's: they get no card and retire nothing.
 */
export const NOT_PROJECT_RECORD = /(^|\/)(tests?|__tests__|fixtures?|__fixtures__|testdata|test-data|node_modules|vendor|dist|build)(\/|$)/;

/** The motivation types a decision record can state (spec/schemas/nodes/motivation). */
export const DECISION_RECORD_TYPES: readonly string[] = Object.freeze(["motivation.principle", "motivation.constraint", "motivation.assessment"]);

/** A record the plan leaves out because it no longer holds. */
export interface RetiredDecision {
  id: string;
  title: string;
  file: string;
  status: string;
  /** Ids of the records that supersede it. */
  supersededBy?: string[];
}

export interface DecisionPlan {
  cards: UndecidedCard[];
  /** Active records that already have an element. */
  modelled: number;
  /** Records someone rejected (`reject`), with no element. */
  skipped: number;
  /** Records left out because `layers` leaves out the motivation layer. */
  outsideLayers: number;
  /** Retired records in the run's scope (every one without `since`). */
  retired: RetiredDecision[];
  candidateDeletes: CandidateDelete[];
}

export interface DecisionPlanOptions {
  /** Only these layers (null for every layer). */
  layers: ReadonlySet<string> | null;
  /** With `since`: only records whose file the range changed. */
  changes: CodeChanges | null;
  /** Whether someone decided this file and symbol is not an element. */
  rejected: (file: string, symbol: string) => boolean;
}

function filesOf(e: GraphElement): string[] {
  return (e.sourceReference?.locations ?? [])
    .map((l) => (typeof l.file === "string" ? l.file.replace(/\\/g, "/").replace(/^\.\//, "") : ""))
    .filter(Boolean);
}

function reasonFor(r: DecisionRecord): string {
  const status = r.status ? `status ${r.status}` : "no status";
  return (
    `An architecture decision record (${status}). Propose the motivation element it states, named for what it decides: ` +
    "a principle (a general rule for how choices are made), a constraint (a fixed limit on the solution) or an assessment (a finding about the current state). " +
    "Write its description from decision.decision, stage it with sourceFile = file and sourceSymbol = symbol, and relate it to the elements of the code decision.mentions names. " +
    (r.status === "proposed" ? "It is only proposed: model it only if the code already follows it. " : "") +
    "Reject it if it records no lasting intent."
  );
}

/** The record's evidence on its card: the decision, its context, and the records and code it names. */
function evidenceOf(r: DecisionRecord): NonNullable<UndecidedCard["decision"]> {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    ...(r.date ? { date: r.date } : {}),
    ...(r.deciders ? { deciders: r.deciders } : {}),
    ...(r.decision ? { decision: r.decision } : {}),
    ...(r.context ? { context: r.context } : {}),
    ...(r.consequences ? { consequences: r.consequences } : {}),
    ...(r.supersedes.length ? { supersedes: r.supersedes.map((s) => `${s.id} (${s.title})`) } : {}),
    ...(r.mentions.length ? { mentions: r.mentions } : {}),
  };
}

export function planDecisionRecords(records: DecisionRecord[], live: GraphElement[], project: string, options: DecisionPlanOptions): DecisionPlan {
  const plan: DecisionPlan = { cards: [], modelled: 0, skipped: 0, outsideLayers: 0, retired: [], candidateDeletes: [] };
  if (!records.length) return plan;
  const { layers, changes } = options;
  const changed = (file: string) => !changes || changes.changed.has(file);
  // A retired record is the range's when it changed, or a record that supersedes it did.
  const inScope = (r: DecisionRecord) => changed(r.file) || (r.retired && r.supersededBy.some((s) => changed(s.file)));
  const motivation = !layers || layers.has("motivation");
  const byFile = new Map<string, GraphElement[]>();
  for (const e of live) {
    for (const f of new Set(filesOf(e))) (byFile.get(f) ?? byFile.set(f, []).get(f)!).push(e);
  }
  const retiredFiles = new Set(records.filter((r) => r.retired).map((r) => r.file));

  for (const r of records) {
    if (NOT_PROJECT_RECORD.test(r.file)) continue;
    if (r.retired) {
      if (!inScope(r)) continue;
      plan.retired.push({
        id: r.id,
        title: r.title,
        file: r.file,
        status: r.status || "superseded",
        ...(r.supersededBy.length ? { supersededBy: r.supersededBy.map((s) => s.id) } : {}),
      });
      // An element sourced only from retired records (every location one) no longer holds; one
      // that also names code or an active record is kept.
      for (const e of byFile.get(r.file) ?? []) {
        if (layers && !layers.has(e.layer)) continue;
        if (!filesOf(e).every((f) => retiredFiles.has(f))) continue;
        if (plan.candidateDeletes.some((d) => d.id === e.id)) continue;
        const why = r.supersededBy.length ? `superseded by ${r.supersededBy.map((s) => `${s.id} (${s.title})`).join(", ")}` : r.status || "retired";
        plan.candidateDeletes.push({
          id: e.id,
          layer: e.layer,
          type: e.type,
          file: r.file,
          symbol: r.id,
          evidence: "decision-superseded",
          detail: `${r.id} (${r.title}) is ${why}: a retired decision yields no active element. Delete the element, or source it from the record that replaced it.`,
        });
      }
      continue;
    }
    if (!inScope(r)) continue;
    if (byFile.has(r.file)) {
      plan.modelled++;
      continue;
    }
    if (!motivation) {
      plan.outsideLayers++;
      continue;
    }
    if (options.rejected(r.file, r.id)) {
      plan.skipped++;
      continue;
    }
    const ranges = changes?.hunks?.get(r.file);
    plan.cards.push({
      cardId: cardId(project, r.qualifiedName),
      kind: "decision-record",
      label: "ADR",
      symbol: r.id,
      ...(changes && ranges ? { changedInRange: true as const } : {}),
      file: r.file,
      lines: r.lines,
      qualifiedName: shortQualifiedName(r.qualifiedName, project),
      candidates: DECISION_RECORD_TYPES.filter((t) => !layers || layers.has(t.split(".")[0])),
      reason: reasonFor(r),
      decision: evidenceOf(r),
    });
  }
  return plan;
}
