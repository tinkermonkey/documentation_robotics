/**
 * Which end of a relationship depends on the other.
 *
 * A relationship's direction and meaning come from its predicate, never from the layers of its
 * ends (spec/DESIGN_CHARTER.md, "What a relationship models"). Most predicates run from the
 * dependent to what it depends on: `uses`, `depends-on`, `accesses`, `composes`, `tests`,
 * `monitors`. Five run the other way, from what is depended on to what depends on it:
 *
 * - `serves` runs provider -> consumer: the technology that serves a component is what the
 *   component needs to run.
 * - `realizes` runs from the realizing element to what it realizes: the function, component or
 *   artifact that realizes an element is what that element is implemented by.
 * - `satisfies` and `delivers` are the same relation toward intent, which the catalog aligns with
 *   ArchiMate Realization as it does `realizes`: the feature that satisfies a requirement, or
 *   delivers a value, is what the requirement or value is met by.
 * - `supports` runs from what contributes to what it contributes to: the capability or operation
 *   that supports a goal is part of what the goal rests on. Left the other way, a capability that
 *   supports a goal had the goal, and through it everything that implements the goal, among its
 *   own dependencies.
 *
 * So `A serves B`, `A realizes B`, `A satisfies B`, `A delivers B` and `A supports B` all make A a
 * dependency of B and B a dependent of A (#1204). Downward from a goal or requirement is everything
 * that implements it; upward from code is the intent it stands under. The rule is used wherever a
 * trace asks what an element depends on (`model_trace`, `dr trace`), so they agree. No edge puts
 * an element on both sides.
 *
 * Left running source -> target, as the charter does not call them a dependency in either
 * direction: `governs`, `constrains` and `protects` (controller -> controlled), `triggers` and
 * `flows-to` (cause -> effect). `provides` and `exposes` point at the functionality made
 * available, not at a consumer. The predicate catalog has no field for this (every predicate's
 * `semantics.directionality` is "bidirectional"), so the set is kept here by name.
 */

import Graph from "graphology";

/** Predicates whose source is what the target depends on. */
export const SOURCE_IS_DEPENDENCY_PREDICATES: ReadonlySet<string> = new Set([
  "serves",
  "realizes",
  "satisfies",
  "delivers",
  "supports",
]);

/** Which end of an edge depends on the other, by its predicate. */
export function dependencyEnds(edge: { source: string; predicate: string; target: string }): {
  dependent: string;
  dependency: string;
} {
  return SOURCE_IS_DEPENDENCY_PREDICATES.has(edge.predicate)
    ? { dependent: edge.target, dependency: edge.source }
    : { dependent: edge.source, dependency: edge.target };
}

/**
 * A directed graph with an edge from each dependent to what it depends on, for
 * `DependencyTracker`. One edge per pair of elements, as the tracker expects.
 */
export function buildDependencyGraph(
  edges: Iterable<{ source: string; predicate: string; target: string }>
): Graph {
  const graph = new Graph({ type: "directed" });
  for (const edge of edges) {
    const { dependent, dependency } = dependencyEnds(edge);
    if (!graph.hasNode(dependent)) graph.addNode(dependent);
    if (!graph.hasNode(dependency)) graph.addNode(dependency);
    if (!graph.hasEdge(dependent, dependency)) graph.addEdge(dependent, dependency, { type: edge.predicate });
  }
  return graph;
}
