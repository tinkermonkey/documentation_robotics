/**
 * What belongs to a milestone (#1389): the elements scheduled for it (`scheduled-for`, whatever
 * their type: features, capabilities) and everything in the plan that realizes, serves or composes
 * them, followed transitively (a service that realizes a feature, the operation that realizes the
 * service). The set is read from the relationships the view holds, so inside an active changeset it
 * is the plan as it leaves the model.
 *
 * This is a lookup over the model's own links, a starting set for a person or agent to check, not a
 * rule about how anything must be modelled: what the links don't say (code that serves a feature
 * with no link yet) is not in the set, and `changeset_brief` / `model_trace` show what is around it.
 *
 * Used by changeset_brief, changeset_verify, changeset_adopt_source_references, model_search and
 * changeset_commit (a milestone's elements as the subset to land).
 */

import { CLIError, ErrorCategory } from "../utils/errors.js";

/** The predicate that puts an element on a milestone. */
export const SCHEDULED_FOR = "scheduled-for";
/** Predicates followed from an element in the set to what is in the plan for it: source realizes/serves/composes target. */
export const MILESTONE_FOLLOWED = ["realizes", "serves", "composes"] as const;

export interface ScopeEdge {
  source: string;
  predicate: string;
  target: string;
}

/** What a milestone scope reads: the elements and the live relationships, with ids resolved to dotted paths. */
export interface ScopeView {
  /** Every live element (id, name, layer, type). */
  elements(): Iterable<{ id: string; name: string; layer: string; type: string }>;
  /** Every live relationship. */
  edges(): Iterable<ScopeEdge>;
  /** A UUID or path to the element's path. */
  resolve(id: string): string;
}

export interface MilestoneRef {
  id: string;
  name: string;
}

export interface MilestoneScope {
  milestones: MilestoneRef[];
  /** The elements scheduled for the milestones. */
  scheduled: string[];
  /** Every element in the scope (scheduled first, then what reaches them), sorted by discovery. */
  elements: string[];
  /** Why each element is in the scope: `scheduled-for <milestone>` or `<predicate> <element it reaches>`. */
  via: Record<string, string>;
}

/** The milestones a name, id or path argument names, or a refusal that lists the milestones there are. */
export function resolveMilestones(view: ScopeView, args: string[]): MilestoneRef[] {
  const all = [...view.elements()].filter((e) => e.layer === "product" && e.type === "milestone");
  const found: MilestoneRef[] = [];
  for (const arg of args) {
    const key = arg.trim();
    const path = view.resolve(key);
    const lower = key.toLowerCase();
    const match =
      all.find((e) => e.id === path) ??
      all.find((e) => e.id === `product.milestone.${key}`) ??
      all.find((e) => e.name.toLowerCase() === lower) ??
      all.find((e) => e.id.split(".").slice(2).join(".") === lower);
    if (!match) {
      throw new CLIError(`No milestone "${arg}" in the model`, ErrorCategory.USER, [
        all.length > 0
          ? `Milestones: ${all.map((e) => e.id).join(", ")}`
          : "The model has no product.milestone elements: add them, or select by ids instead",
        'Pass a milestone as its id ("product.milestone.<name>") or its name',
      ]);
    }
    if (!found.some((m) => m.id === match.id)) found.push({ id: match.id, name: match.name });
  }
  return found;
}

/**
 * The scope of the milestones `args` name (one or several; the scopes are joined). Elements are
 * found by `scheduled-for` edges into the milestone, then by following incoming realizes, serves
 * and composes edges until nothing new is reached. A milestone element itself is not in the scope.
 */
export function milestoneScope(view: ScopeView, args: string[]): MilestoneScope {
  const milestones = resolveMilestones(view, args);
  const wanted = new Set(milestones.map((m) => m.id));
  const incoming = new Map<string, ScopeEdge[]>();
  const scheduled: string[] = [];
  const via: Record<string, string> = {};
  for (const raw of view.edges()) {
    const edge = { source: view.resolve(raw.source), predicate: raw.predicate, target: view.resolve(raw.target) };
    if (edge.predicate === SCHEDULED_FOR && wanted.has(edge.target)) {
      if (!(edge.source in via)) {
        via[edge.source] = `${SCHEDULED_FOR} ${edge.target}`;
        scheduled.push(edge.source);
      }
    } else if ((MILESTONE_FOLLOWED as readonly string[]).includes(edge.predicate)) {
      const list = incoming.get(edge.target);
      if (list) list.push(edge);
      else incoming.set(edge.target, [edge]);
    }
  }
  const elements = [...scheduled];
  for (let i = 0; i < elements.length; i++) {
    for (const edge of incoming.get(elements[i]) ?? []) {
      if (edge.source in via || wanted.has(edge.source)) continue;
      via[edge.source] = `${edge.predicate} ${edge.target}`;
      elements.push(edge.source);
    }
  }
  return { milestones, scheduled, elements, via };
}

/** A short label for text: `milestone a, b`. */
export function milestoneLabel(scope: Pick<MilestoneScope, "milestones">): string {
  return `milestone ${scope.milestones.map((m) => m.id).join(", ")}`;
}

/** The scope view of a changeset's projection: the plan as it leaves the model (deleted elements and links are gone). */
export function scopeViewOfGraph(graph: import("./changeset-graph.js").ChangesetGraph): ScopeView {
  return {
    elements: () => [...graph.elements.values()].filter((e) => e.status !== "deleted"),
    edges: () => graph.relationships().filter((r) => r.status !== "deleted"),
    resolve: (id) => graph.resolve(id),
  };
}

/** The scope view of the model as it reads now (the active changeset's staged changes included, as every read shows them). */
export async function scopeViewOfModel(model: import("./model.js").Model): Promise<ScopeView> {
  const elements: Array<{ id: string; name: string; layer: string; type: string }> = [];
  const uuids = new Map<string, string>();
  for (const layerName of model.getLayerNames()) {
    const layer = await model.getLayer(layerName);
    if (!layer) continue;
    for (const element of layer.listElements()) {
      const id = element.path || element.id;
      elements.push({ id, name: element.name, layer: layerName, type: element.type });
      if (element.id && element.id !== id) uuids.set(element.id, id);
    }
  }
  return {
    elements: () => elements,
    edges: () => model.relationships.getAll(),
    resolve: (id) => uuids.get(id) ?? id,
  };
}
