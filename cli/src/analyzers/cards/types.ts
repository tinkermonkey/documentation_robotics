/**
 * Symbol cards: what the classification cascade knows about one code symbol.
 *
 * A card is built from the codebase-memory-mcp (CBM) graph: the node's own fields, its source
 * (from `get_code_snippet`), and its neighbourhood (callers, callees, imports, routes, env vars,
 * inheritance). Facts are a few extra structural counts and the symbol's decorators, kept apart
 * from the card so that labelled card sets stay valid when facts are added or changed.
 *
 * See docs/analyzers/CASCADE_DESIGN.md.
 */

/** A graph node as the card builder reads it: CBM's node fields flattened onto one object. */
export interface GraphNode {
  label: string;
  /** Symbol name; for a Route, the full route qualified name (`__route__GET__/owners`). */
  name: string;
  /** Qualified name including the CBM project prefix (none for routes). */
  qualified_name: string;
  file_path: string;
  [field: string]: unknown;
}

export interface SymbolCard {
  id: string;
  /** CBM label: Class | Interface | Function | Method | Module | Route | ... */
  label: string;
  name: string;
  /** Qualified name with the project prefix stripped. */
  qualified_name: string;
  file_path: string | null;
  start_line: number | null;
  end_line: number | null;
  signature: string | null;
  docstring: string | null;
  is_exported: boolean | null;
  is_entry_point: boolean | null;
  complexity: number | null;
  parent_class: string | null;
  base_classes: string[];
  return_type: string | null;
  /** First 12 callers (for a Route, the handler first). */
  callers: string[];
  /** First 12 callees. */
  callees: string[];
  callers_total: number;
  callees_total: number;
  /** First 15 files (or symbols) the card's file imports. */
  imports: string[];
  env_vars: string[];
  routes_handled: string[];
  /** First 8 outbound HTTP call paths. */
  http_calls: string[];
  inherits: string[];
  implements: string[];
  route_method: string | null;
  /** Source, cut to the builder's `sourceLines`; a Route borrows its handler's source. */
  source: string | null;
  source_lines_total: number | null;
  source_truncated: boolean;
}

/** Structural facts for a card, read by the Tier-0 rules. */
export interface CardFacts {
  /** Decorator texts as written (`@GetMapping("/owners")`). */
  decorators: string[];
  /** The same, reduced to the decorator's name (`GetMapping`, `router.get`). */
  decorator_names: string[];
  /** Distinct other files that import the card's file. */
  file_importers: number;
  /** Methods the symbol defines (DEFINES_METHOD), for classes. */
  methods: number;
  /** Distinct other files that use the symbol (USAGE edges into it). */
  usage_files: number;
}

/**
 * The CBM graph a card is built from: one indexed project. {@link cbmCardGraph} implements it
 * over the analyzer's CBM tools; tests can supply their own.
 */
export interface CardGraph {
  /** CBM project name, which prefixes every code symbol's qualified name. */
  readonly project: string;
  /** Every node with this label, optionally limited to files matching a glob, with extra fields. */
  search(label: string, filePattern: string | undefined, fields: string[]): Promise<GraphNode[]>;
  /** A Cypher query's rows, all pages. */
  rows(cypher: string): Promise<unknown[][]>;
  /** A symbol's source, or null when CBM has none. */
  snippet(qualifiedName: string): Promise<{ source: string } | null>;
}
