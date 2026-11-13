/**
 * Tier-0 classification of a whole project: every candidate symbol gets a card, its facts and the
 * first matching Tier-0 rule. No network and no model calls. `dr analyzer classify --tier0-only`
 * runs this through the cbm analyzer.
 *
 * With a source root, the JavaScript and TypeScript test cards extraction reads from test files
 * (cards/test-cases.ts: `TestCase` decided, `TestSuite` rejected) come after the graph's cards, so
 * classify and extract count the same cards.
 */
import { matchPattern } from "../heuristic-utils.js";
import type { Tier0Outcome, Tier0Rule } from "../tier0-rules.js";
import { CARD_FIELDS, CARD_LABELS, CARD_VERSION, CardBuilder, VENDOR_EXCLUDE, cardId, isCandidate, withStoredNames } from "./build.js";
import { buildEdgeIndex } from "./edge-index.js";
import { buildFactsIndex, factsFor } from "./facts.js";
import { TEST_CASE_LABEL, TEST_SUITE_LABEL, collectJsTestCases } from "./test-cases.js";
import { tier0ForCard } from "./tier0.js";
import type { CardFacts, CardGraph, SymbolCard } from "./types.js";

export interface ClassifyOptions {
  /**
   * Labels to classify (default {@link CARD_LABELS}, every label a rule names, and with a
   * source root the JS/TS test labels `TestCase` and `TestSuite`).
   */
  labels?: string[];
  /** Only files matching this glob (search_graph file_pattern). */
  filePattern?: string;
  /** Files to leave out, in addition to {@link VENDOR_EXCLUDE}. */
  exclude?: RegExp;
  /** Stop after this many cards, in label order. */
  limit?: number;
  /**
   * Absolute path of the indexed codebase, so source is read from disk (see CardBuilderOptions),
   * and JS/TS test files are read for their test-case cards.
   */
  sourceRoot?: string;
  /** Include each full card (source and neighbourhood) in the results. */
  includeCards?: boolean;
  /** Called after each card, for progress output. */
  onProgress?: (done: number, total: number) => void;
}

export interface ClassifyResult {
  card_id: string;
  label: string;
  name: string;
  qualified_name: string;
  file_path: string | null;
  start_line: number | null;
  end_line: number | null;
  /** The first matching Tier-0 rule's action, or null when no rule covers the symbol. */
  tier0: Tier0Outcome | null;
  facts: CardFacts;
  card?: SymbolCard;
}

export interface ClassifyReport {
  analyzer: string;
  project: string;
  mode: "tier0";
  /** {@link CARD_VERSION} of the cards behind these results. */
  card_version: number;
  rules: number;
  summary: {
    cards: number;
    decided: number;
    rejected: number;
    narrowed: number;
    undecided: number;
    /**
     * Non-route cards built without source (no line range or readable file, and no CBM
     * snippet), on which rules that read the declaration cannot fire.
     */
    no_source: number;
    /** Cards per rule that matched. */
    by_rule: Record<string, number>;
    /** Decided cards per `layer.type`. */
    by_target: Record<string, number>;
  };
  results: ClassifyResult[];
}

/** {@link CARD_LABELS} plus every label a Tier-0 rule names (Type, Enum, Trait, ...). */
export function defaultLabels(rules: Tier0Rule[]): string[] {
  return [...new Set([...CARD_LABELS, ...rules.flatMap((r) => r.labels)])];
}

/** Labels classify accepts that are not graph labels: the JS/TS test cards (cards/test-cases.ts). */
export const TEST_CARD_LABELS: readonly string[] = [TEST_CASE_LABEL, TEST_SUITE_LABEL];

export async function classifyTier0(
  graph: CardGraph,
  rules: Tier0Rule[],
  analyzer: string,
  options: ClassifyOptions = {}
): Promise<ClassifyReport> {
  const labels = options.labels?.length ? options.labels : [...defaultLabels(rules), ...TEST_CARD_LABELS];
  const graphLabels = labels.filter((l) => !TEST_CARD_LABELS.includes(l));
  const exclude = options.exclude
    ? new RegExp(`(?:${VENDOR_EXCLUDE.source})|(?:${options.exclude.source})`, options.exclude.flags.replace("g", ""))
    : VENDOR_EXCLUDE;

  // One card per qualified name (Java overloads share one), deduplicated before the limit.
  const nodes = [];
  const seen = new Set<string>();
  for (const label of graphLabels) {
    for (const node of await withStoredNames(graph, label, await graph.search(label, options.filePattern, CARD_FIELDS[label] ?? []))) {
      if (!isCandidate(node, label, exclude) || seen.has(node.qualified_name)) continue;
      seen.add(node.qualified_name);
      nodes.push(node);
    }
  }
  const selected = options.limit !== undefined ? nodes.slice(0, options.limit) : nodes;

  const edges = await buildEdgeIndex(graph);
  const factsIndex = await buildFactsIndex(graph);
  const builder = new CardBuilder(graph, edges, { scope: graph.project, sourceRoot: options.sourceRoot });

  const results: ClassifyResult[] = [];
  const summary: ClassifyReport["summary"] = { cards: 0, decided: 0, rejected: 0, narrowed: 0, undecided: 0, no_source: 0, by_rule: {}, by_target: {} };
  const record = (card: SymbolCard, facts: CardFacts, tier0: Tier0Outcome | null) => {
    summary.cards++;
    if (card.source === null && card.label !== "Route") summary.no_source++;
    if (!tier0) summary.undecided++;
    else {
      summary.by_rule[tier0.rule] = (summary.by_rule[tier0.rule] ?? 0) + 1;
      if (tier0.kind === "decide") {
        summary.decided++;
        const target = `${tier0.layer}.${tier0.type}`;
        summary.by_target[target] = (summary.by_target[target] ?? 0) + 1;
      } else if (tier0.kind === "reject") summary.rejected++;
      else summary.narrowed++;
    }
    results.push({
      card_id: card.id,
      label: card.label,
      name: card.name,
      qualified_name: card.qualified_name,
      file_path: card.file_path,
      start_line: card.start_line,
      end_line: card.end_line,
      tier0,
      facts,
      ...(options.includeCards ? { card } : {}),
    });
    options.onProgress?.(results.length, total);
  };

  // JS/TS test cases and suites: no graph node, read from the test files' text as extraction does.
  // Collected before the graph cards are built, so progress reports one total throughout.
  const testLabels = [TEST_CASE_LABEL, TEST_SUITE_LABEL].filter((l) => labels.includes(l));
  const room = options.limit !== undefined ? options.limit - selected.length : Infinity;
  let tests: Awaited<ReturnType<typeof collectJsTestCases>>["symbols"] = [];
  if (options.sourceRoot && testLabels.length && room > 0) {
    const { symbols } = await collectJsTestCases(graph, (qn) => cardId(graph.project, qn), {
      sourceRoot: options.sourceRoot,
      edgeTypes: new Set(),
    });
    tests = symbols
      .filter((s) => testLabels.includes(s.card.label))
      .filter((s) => !s.card.file_path || ((!options.filePattern || matchPattern(s.card.file_path, options.filePattern)) && !exclude.test(s.card.file_path)))
      .slice(0, room);
  }
  const total = selected.length + tests.length;

  for (const node of selected) {
    const card = await builder.build(node);
    const facts = factsFor(factsIndex, node.qualified_name, card.file_path);
    record(card, facts, tier0ForCard(card, facts, rules));
  }

  for (const s of tests) record(s.card, s.facts, s.tier0);

  return { analyzer, project: graph.project, mode: "tier0", card_version: CARD_VERSION, rules: rules.length, summary, results };
}
