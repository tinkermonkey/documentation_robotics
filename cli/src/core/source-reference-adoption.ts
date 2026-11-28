/**
 * Copy the source references verify found on the as-built side onto the plan
 * (`changeset_adopt_source_references`; `changeset_verify` only lists them).
 *
 * A plan's code-level elements are drawn before the code exists, so they carry no source file or
 * symbol. Verify matches them to the as-built elements extraction staged, which do. Landing the plan
 * without copying those references leaves the model unable to tie the elements to the code: the next
 * codebase_extract offers their symbols again, and adding them fails because the ids exist.
 *
 * Each copy is staged into the plan in one write: an element the plan adds has its add rewritten in
 * place (the same fold model_update does); an element the plan updates gets one more update, from
 * its latest staged state with the reference added. Matches against elements extraction didn't
 * stage (`builtByAgent`) are not copied: their reference is the agent's, not evidence. Only exact
 * matches are copied by default: a probable match (same name or source file, different id) may be
 * the wrong element, so it is copied only when the caller confirms it by its planned id.
 *
 * A planned element extraction can't see (a feature, a requirement, a tool the code registers by a
 * name string) never has an as-built match to copy from. For those the caller passes the reference
 * it confirmed in the code (`references`: id, file, symbol), and it is staged the same way, with
 * provenance `manual` (#1159). The file must exist, so a mistyped path records nothing.
 *
 * `adoptVerifiedSourceReferences` is the whole flow from a verify report, shared by
 * `changeset_adopt_source_references` and `dr changeset verify --adopt-source-references`.
 */

import type { Changeset, StagedChange } from "./changeset.js";
import { ChangesetGraph } from "./changeset-graph.js";
import type { Model } from "./model.js";
import type { StagingAreaManager } from "./staging-area.js";
import { setStagedSourceReference } from "./staged-source-reference.js";
import type { SourceReferenceGap, VerifyReport } from "./changeset-verify.js";
import type { SourceLocation, SourceReference } from "../types/source-reference.js";
import { readStagedSourceReference } from "./staged-source-reference.js";
import { CLIError, ErrorCategory } from "../utils/errors.js";
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export interface AdoptionResult {
  adopted: SourceReferenceGap[];
  skipped: Array<{ planned: string; reason: string }>;
  /** Confirmed ids that name none of the gaps (so confirm nothing). */
  unknownIds?: string[];
}

type Rewrite = { elementId: string; change: Omit<StagedChange, "sequenceNumber"> };

export interface AdoptionOptions {
  /** Planned element ids (dotted id, path or UUID) whose probable matches the caller confirmed. */
  confirmed?: readonly string[];
}

export async function adoptSourceReferences(
  model: Model,
  manager: StagingAreaManager,
  planned: Changeset,
  gaps: SourceReferenceGap[],
  options: AdoptionOptions = {}
): Promise<AdoptionResult> {
  const adopted: SourceReferenceGap[] = [];
  const skipped: AdoptionResult["skipped"] = [];
  if (gaps.length === 0) {
    return { adopted, skipped, ...(options.confirmed?.length ? { unknownIds: [...options.confirmed] } : {}) };
  }
  if (planned.status !== "staged") {
    return {
      adopted,
      skipped: gaps.map((g) => ({
        planned: g.planned,
        reason:
          `the plan "${planned.name}" is ${planned.status}, so it can't be staged into: set sourceFile and sourceSymbol ` +
          "on the element with model_update instead",
      })),
    };
  }

  const graph = await ChangesetGraph.build(model, planned);
  // Each element's staged changes, in sequence order, keyed by the dotted id verify reports.
  const ordered = [...(planned.changes as StagedChange[])]
    .map((change, index) => ({ change, index }))
    .sort((a, b) => (a.change.sequenceNumber ?? a.index) - (b.change.sequenceNumber ?? b.index))
    .map(({ change }) => change);
  const byElement = new Map<string, StagedChange[]>();
  for (const change of ordered) {
    if (change.type !== "add" && change.type !== "update") continue;
    const id = graph.resolve(change.elementId);
    byElement.set(id, [...(byElement.get(id) ?? []), change]);
  }
  const confirmed = new Set((options.confirmed ?? []).map((id) => graph.resolve(id)));
  const listed = new Set(gaps.map((g) => g.planned));
  const unknownIds = (options.confirmed ?? []).filter((id) => !listed.has(graph.resolve(id)));

  const appended: Array<Omit<StagedChange, "sequenceNumber">> = [];
  const rewrites: Rewrite[] = [];
  for (const gap of gaps) {
    if (gap.builtByAgent) {
      skipped.push({
        planned: gap.planned,
        reason: `its as-built match ${gap.built} was not staged by extraction, so its source reference is no evidence: confirm it in the code`,
      });
      continue;
    }
    if (gap.match !== "exact" && !confirmed.has(gap.planned)) {
      skipped.push({
        planned: gap.planned,
        reason:
          `its match to ${gap.built} is probable, not exact${gap.matchReason ? ` (${gap.matchReason})` : ""}: confirm in ` +
          "the code that it is the same element, then pass its planned id in ids",
      });
      continue;
    }
    const changes = (byElement.get(gap.planned) ?? []).filter((c) => c.after);
    const latest = changes[changes.length - 1];
    if (!latest?.after) {
      skipped.push({ planned: gap.planned, reason: "the plan has no staged add or update of it to carry the reference" });
      continue;
    }
    const withReference = (snapshot: Record<string, unknown>) => {
      const copy = structuredClone(snapshot);
      setStagedSourceReference(copy, structuredClone(gap.adopt));
      return copy;
    };
    // The add is the element's only change (model_update folds edits into it): rewrite it in place.
    // The storage rewrites the first change with this key, so only when that is this add.
    const firstWithKey = (planned.changes as StagedChange[]).find((c) => c.elementId === latest.elementId);
    if (latest.type === "add" && firstWithKey === latest && changes.length === 1) {
      rewrites.push({
        elementId: latest.elementId,
        change: {
          type: "add",
          elementId: latest.elementId,
          layerName: latest.layerName,
          ...(latest.before !== undefined ? { before: latest.before } : {}),
          after: withReference(latest.after),
        },
      });
    } else {
      appended.push({
        type: "update",
        elementId: latest.elementId,
        layerName: latest.layerName,
        before: structuredClone(latest.after),
        after: withReference(latest.after),
      });
    }
    adopted.push(gap);
  }

  if (appended.length > 0 || rewrites.length > 0) {
    await manager.stageMany(planned.id!, appended, rewrites);
  }
  return { adopted, skipped, ...(unknownIds.length > 0 ? { unknownIds } : {}) };
}

/** A source reference the caller confirmed in the code, for a planned element with no as-built match. */
export interface ConfirmedReference {
  /** The planned element (dotted id, path or UUID). */
  id: string;
  /** The file that holds its code, relative to the codebase root. */
  sourceFile: string;
  /** The symbol, or the string the code registers it by. */
  sourceSymbol?: string;
}

export interface ConfirmedAdoptionResult {
  /** Each element that got references from the call: the element, the reference it now carries and how many locations were added. */
  confirmed: Array<{ planned: string; reference: SourceReference; added: number }>;
  /** Locations the element already named (the call changed nothing for them): not a failure. */
  alreadyPresent: Array<{ planned: string; location: string }>;
  skipped: Array<{ planned: string; reason: string }>;
}

/**
 * Stage onto the plan the references the caller confirmed in the code, for elements the plan adds
 * or updates. Each is added to the element's reference as a path relative to the codebase root,
 * and the reference's provenance becomes `manual`: the caller confirmed it by hand. An element may
 * be named several times (one entry per location, #1393): its locations are appended, in order, in
 * one staged change. Skipped, with why: an id the plan doesn't stage, a path that is not a file
 * under the codebase root (a folder, a path outside it, nothing there), and an element with an
 * as-built match to copy from (`copyable`: its reference comes from extraction, not the caller). A
 * location the element already names is reported in `alreadyPresent`, not skipped.
 */
export async function adoptConfirmedReferences(
  model: Model,
  manager: StagingAreaManager,
  planned: Changeset,
  references: readonly ConfirmedReference[],
  options: { copyable?: ReadonlySet<string> } = {}
): Promise<ConfirmedAdoptionResult> {
  const confirmed: ConfirmedAdoptionResult["confirmed"] = [];
  const alreadyPresent: ConfirmedAdoptionResult["alreadyPresent"] = [];
  const skipped: ConfirmedAdoptionResult["skipped"] = [];
  if (references.length === 0) return { confirmed, alreadyPresent, skipped };
  if (planned.status !== "staged") {
    return {
      confirmed,
      alreadyPresent,
      skipped: references.map((r) => ({ planned: r.id, reason: `the plan "${planned.name}" is ${planned.status}, so it can't be staged into` })),
    };
  }
  const graph = await ChangesetGraph.build(model, planned);
  const changes = planned.changes as StagedChange[];
  const appended: Array<Omit<StagedChange, "sequenceNumber">> = [];
  const rewrites: Rewrite[] = [];
  // Each element's state as this call leaves it, so several references to one element build on each other.
  const working = new Map<string, { latest: StagedChange; own: StagedChange[]; after: Record<string, unknown>; added: number }>();
  const root = path.resolve(model.codebaseRoot);
  for (const ref of references) {
    const id = graph.resolve(ref.id);
    const file = ref.sourceFile.trim();
    let state = working.get(id);
    if (!state) {
      const own = changes.filter((c) => (c.type === "add" || c.type === "update") && c.after && graph.resolve(c.elementId) === id);
      const latest = own[own.length - 1];
      if (!latest?.after) {
        skipped.push({ planned: ref.id, reason: "the plan stages no add or update of this element to carry the reference" });
        continue;
      }
      if (options.copyable?.has(id)) {
        skipped.push({ planned: id, reason: "it has an as-built match to copy the reference from (sourceReferences.missing): leave it out of references" });
        continue;
      }
      state = { latest, own, after: structuredClone(latest.after), added: 0 };
    }
    // The reference is stored as the model keeps every other one: a file path relative to the
    // codebase root, with forward slashes. An absolute path inside the root and a path with `..`
    // segments are brought to that form; a path outside the root, a directory, or nothing there
    // is refused.
    const abs = path.resolve(root, file);
    const relative = path.relative(root, abs).split(path.sep).join("/");
    const within = (p: string) => !!p && !p.startsWith("../") && p !== ".." && !path.isAbsolute(p);
    // A symbolic link is followed to where it points: that must be inside the root too, so a link
    // to a file elsewhere (`src/link.ts` -> `/etc/hosts`) is refused like the file itself would be.
    let real: string | null = null;
    try {
      real = existsSync(abs) ? realpathSync(abs) : null;
    } catch {
      real = null;
    }
    const realRoot = (() => {
      try {
        return realpathSync(root);
      } catch {
        return root;
      }
    })();
    const inside = !!file && within(relative) && !!real && within(path.relative(realRoot, real).split(path.sep).join("/"));
    const kind = !inside ? "none" : statSync(real!).isFile() ? "file" : "other";
    if (kind !== "file") {
      skipped.push({
        planned: id,
        reason:
          kind === "other"
            ? `${ref.sourceFile} is a folder, not a file: name the file that holds the element's code`
            : `${ref.sourceFile} is not a file under the codebase root: pass the path as the code has it, relative to the root`,
      });
      continue;
    }
    const current = readStagedSourceReference(state.after).value;
    const location: SourceLocation = { file: relative, ...(ref.sourceSymbol ? { symbol: ref.sourceSymbol } : {}) };
    const locations = (current?.locations ?? []).filter((l) => typeof l?.file === "string");
    // Already there: the same file and symbol, or this file at all when no symbol is given.
    if (locations.some((l) => l.file === location.file && (!location.symbol || l.symbol === location.symbol))) {
      alreadyPresent.push({ planned: id, location: `${location.file}${location.symbol ? `#${location.symbol}` : ""}` });
      working.set(id, state);
      continue;
    }
    // A location naming only this file is sharpened by one that names its symbol too.
    const kept = location.symbol ? locations.filter((l) => !(l.file === location.file && !l.symbol)) : locations;
    // The caller confirmed this location by hand, so the reference is `manual` from here on,
    // whatever it was: it no longer rests on extraction alone.
    const reference: SourceReference = {
      ...(current ? structuredClone(current) : {}),
      provenance: "manual",
      locations: [...kept, location],
    };
    setStagedSourceReference(state.after, reference);
    state.added++;
    working.set(id, state);
  }
  for (const [id, state] of working) {
    if (state.added === 0) continue;
    const { latest, own, after } = state;
    const firstWithKey = changes.find((c) => c.elementId === latest.elementId);
    if (latest.type === "add" && firstWithKey === latest && own.length === 1) {
      rewrites.push({
        elementId: latest.elementId,
        change: {
          type: "add",
          elementId: latest.elementId,
          layerName: latest.layerName,
          ...(latest.before !== undefined ? { before: latest.before } : {}),
          after,
        },
      });
    } else {
      appended.push({ type: "update", elementId: latest.elementId, layerName: latest.layerName, before: structuredClone(latest.after!), after });
    }
    confirmed.push({ planned: id, reference: readStagedSourceReference(after).value as SourceReference, added: state.added });
  }
  if (appended.length > 0 || rewrites.length > 0) await manager.stageMany(planned.id!, appended, rewrites);
  return { confirmed, alreadyPresent, skipped };
}

/**
 * Why a confirmed id names none of the listed references: what verify found for that planned element,
 * and what to do. changeset_adopt_source_references takes a match only when verify lists it in
 * sourceReferences.missing: a match whose as-built element names a file and symbol the plan lacks.
 */
export function explainUnknownId(id: string, elements: VerifyReport["elements"] | undefined): string {
  if (!elements) return "verify lists no source reference to copy for it";
  const matched = [...elements.matched, ...elements.divergent].find((m) => m.planned === id);
  if (matched) {
    return matched.match === "exact"
      ? `its match to ${matched.built} is exact and the plan already names every source location it has: nothing to copy`
      : `its match to ${matched.built} is probable, but that element names no source file and symbol the plan lacks: nothing to copy. If it is the element, set sourceFile and sourceSymbol on the plan with model_update`;
  }
  const unverifiable = elements.unverifiable.find((u) => u.planned === id);
  if (unverifiable?.op === "update") {
    return "it is matched, but only fields extraction doesn't write were compared: nothing to copy";
  }
  if (elements.missing.some((m) => m.planned === id) || unverifiable) {
    return "it has no as-built match to copy from: pass the file and symbol you confirmed in the code in references ({id, sourceFile, sourceSymbol})";
  }
  return "it is not a planned element verify compared (check the id as changeset_verify lists it)";
}

/** What adopting the references a verify report lists did: changeset_adopt_source_references' result. */
export interface VerifiedAdoptionReport {
  plannedChangeset: { id?: string; name: string };
  adopted: SourceReferenceGap[];
  /** Why each listed reference that was not copied was skipped. */
  skipped?: AdoptionResult["skipped"];
  /** The listed references still not on the plan. */
  missing?: SourceReferenceGap[];
  /** Confirmed ids that name no listed reference: nothing to confirm for them. */
  unknownIds?: string[];
  /** Why each of unknownIds is not taken, and what to do instead (#1253). */
  unknownIdReasons?: Array<{ id: string; reason: string }>;
  /** The references the caller confirmed in the code, staged onto planned elements with no as-built match. */
  confirmed?: ConfirmedAdoptionResult["confirmed"];
  /** Locations from references the element already named: nothing was written for them. */
  alreadyPresent?: ConfirmedAdoptionResult["alreadyPresent"];
  /** What was written (#1324): references copied from the as-built side, and locations set from references. */
  written: { copied: number; fromReferences: number; elementsFromReferences: number };
  next: string;
}

export interface VerifiedAdoptionInputs {
  planned: Changeset;
  /** The as-built changeset verify compared against, when it compared against one (not the base). */
  asBuilt?: Changeset;
  /** The verify report of planned against what was built (its elements let an id that is not taken say why). */
  report: Pick<VerifyReport, "sourceReferences"> & Partial<Pick<VerifyReport, "elements">>;
  /** Planned element ids whose probable matches the caller confirmed. */
  confirmed?: readonly string[];
  /** References the caller confirmed in the code, for planned elements extraction can't see. */
  references?: readonly ConfirmedReference[];
  /** The hint for the refusal when planned and asBuilt are the same changeset (wording per caller). */
  sameChangesetHint: string;
}

/**
 * Copy onto the plan the source references a verify report lists in `sourceReferences.missing`:
 * the flow `changeset_adopt_source_references` and `dr changeset verify --adopt-source-references`
 * share. Refuses when the plan and the as-built changeset are the same changeset: codebase_extract
 * leaves its as-built changeset active, so an omitted plan resolves to it, and copying would write
 * the as-built side instead of the plan.
 */
export async function adoptVerifiedSourceReferences(
  model: Model,
  manager: StagingAreaManager,
  inputs: VerifiedAdoptionInputs
): Promise<VerifiedAdoptionReport> {
  const { planned, asBuilt, report } = inputs;
  if (asBuilt && asBuilt.id === planned.id) {
    throw new CLIError(
      `the plan and against name the same changeset ('${planned.name}'): nothing to copy onto a plan`,
      ErrorCategory.USER,
      [inputs.sameChangesetHint]
    );
  }
  const gaps = report.sourceReferences?.missing ?? [];
  const { adopted, skipped, unknownIds } = await adoptSourceReferences(model, manager, planned, gaps, {
    confirmed: inputs.confirmed,
  });
  const adoptedIds = new Set(adopted.map((g) => g.planned));
  const left = gaps.filter((g) => !adoptedIds.has(g.planned));
  // The copies were staged: read the plan again, so the confirmed references build on them.
  const references = inputs.references ?? [];
  const current = references.length > 0 && adopted.length > 0 ? ((await manager.load(planned.id!)) ?? planned) : planned;
  const own = await adoptConfirmedReferences(model, manager, current, references, {
    copyable: new Set(gaps.filter((g) => !g.builtByAgent).map((g) => g.planned)),
  });
  const allSkipped = [...skipped, ...own.skipped];
  const fromReferences = own.confirmed.reduce((n, c) => n + c.added, 0);
  const written = { copied: adopted.length, fromReferences, elementsFromReferences: own.confirmed.length };
  const total = written.copied + fromReferences;
  const parts: string[] = [];
  if (total > 0) {
    const how = [
      written.copied > 0 ? `${written.copied} copied from the as-built side (provenance as extraction recorded it)` : "",
      fromReferences > 0 ? `${fromReferences} location(s) of ${own.confirmed.length} element(s) set from references (provenance manual)` : "",
    ].filter(Boolean);
    parts.push(`Wrote ${total} source reference(s) onto the plan "${planned.name}": ${how.join("; ")}. The plan lands with them.`);
  } else if (gaps.length === 0 && references.length === 0) {
    parts.push("No matched plan element lacks its as-built match's source reference: nothing to copy.");
  } else {
    parts.push("Nothing was written.");
  }
  if (own.alreadyPresent.length > 0) parts.push(`${own.alreadyPresent.length} location(s) from references were already on the plan (alreadyPresent).`);
  if (left.length > 0) parts.push(`${left.length} listed reference(s) were not copied (skipped says why).`);
  if (own.skipped.length > 0) parts.push(`${own.skipped.length} of references were not set (skipped says why).`);
  return {
    plannedChangeset: { id: planned.id, name: planned.name },
    adopted,
    written,
    ...(own.confirmed.length > 0 ? { confirmed: own.confirmed } : {}),
    ...(own.alreadyPresent.length > 0 ? { alreadyPresent: own.alreadyPresent } : {}),
    ...(allSkipped.length > 0 ? { skipped: allSkipped } : {}),
    ...(left.length > 0 ? { missing: left } : {}),
    ...(unknownIds && unknownIds.length > 0
      ? { unknownIds, unknownIdReasons: unknownIds.map((id) => ({ id, reason: explainUnknownId(id, report.elements) })) }
      : {}),
    next: parts.join(" "),
  };
}
