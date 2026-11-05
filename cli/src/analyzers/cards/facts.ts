/**
 * Tier-0 structural facts: decorators and a few reuse counts, from one graph query per fact.
 */
import type { CardFacts, CardGraph } from "./types.js";

/** `@field_validator("X", mode="before")` -> `field_validator`; `@router.get('/')` -> `router.get`. */
export function decoratorName(text: string): string {
  return text.trim().replace(/^@/, "").replace(/\s*#.*$/, "").replace(/\(.*$/s, "").trim();
}

/** CBM stores decorators as a JSON-encoded list (or, in some builds, a real one). */
function parseList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== "string" || !v.trim()) return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}

export interface FactsIndex {
  /** full qualified name -> decorator texts */
  decorators: Map<string, string[]>;
  /** file path -> other files importing it */
  importers: Map<string, Set<string>>;
  /** full qualified name -> DEFINES_METHOD count */
  methods: Map<string, number>;
  /** full qualified name -> other files with USAGE edges into it */
  usage: Map<string, Set<string>>;
}

export async function buildFactsIndex(graph: CardGraph): Promise<FactsIndex> {
  const decorators = new Map<string, string[]>();
  for (const [qn, decs] of await graph.rows("MATCH (b) WHERE b.decorators IS NOT NULL RETURN b.qualified_name, b.decorators")) {
    if (typeof qn === "string") decorators.set(qn, parseList(decs));
  }
  const importers = new Map<string, Set<string>>();
  for (const [afile, bfile] of await graph.rows("MATCH (a)-[r:IMPORTS]->(b) RETURN a.file_path, b.file_path")) {
    if (typeof afile !== "string" || typeof bfile !== "string" || !bfile || afile === bfile) continue;
    if (!importers.has(bfile)) importers.set(bfile, new Set());
    importers.get(bfile)!.add(afile);
  }
  const methods = new Map<string, number>();
  for (const [a] of await graph.rows("MATCH (a)-[r:DEFINES_METHOD]->(m) RETURN a.qualified_name, m.qualified_name")) {
    if (typeof a === "string") methods.set(a, (methods.get(a) ?? 0) + 1);
  }
  const usage = new Map<string, Set<string>>();
  for (const [afile, b, bfile] of await graph.rows("MATCH (a)-[r:USAGE]->(b) RETURN a.file_path, b.qualified_name, b.file_path")) {
    if (typeof afile !== "string" || typeof b !== "string" || afile === bfile) continue;
    if (!usage.has(b)) usage.set(b, new Set());
    usage.get(b)!.add(afile);
  }
  return { decorators, importers, methods, usage };
}

/** Facts for one symbol, by its full (project-prefixed) qualified name and file. */
export function factsFor(idx: FactsIndex, fullQualifiedName: string, filePath: string | null): CardFacts {
  const decorators = idx.decorators.get(fullQualifiedName) ?? [];
  return {
    decorators,
    decorator_names: decorators.map(decoratorName),
    file_importers: filePath ? (idx.importers.get(filePath)?.size ?? 0) : 0,
    methods: idx.methods.get(fullQualifiedName) ?? 0,
    usage_files: idx.usage.get(fullQualifiedName)?.size ?? 0,
  };
}
