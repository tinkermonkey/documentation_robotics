/**
 * Triage views over an extraction run's undecided cards: the groups an agent decides by before it
 * reads any card, the cards by filter, the functions many services share, and (when verifying) the
 * planned elements with no as-built candidate yet. Pure: `codebase_extract` renders them, and the
 * CLI and the viewer can call the same functions.
 *
 * Every count here is over the whole set given, never over a page of it (the "no unseen limits"
 * principle): {@link pageOf} is the one place a list is shortened, and it always says so.
 */
import type { UndecidedCard } from "./extraction-plan.js";
import { filesMatcher } from "./project-rules.js";

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

/** A list shortened to a page, with its true total and how to get the rest. */
export interface Paged<T> {
  /** Items in the whole list. */
  total: number;
  /** Items in this page. */
  returned: number;
  /** Where this page starts, when not at 0. */
  offset?: number;
  /** The offset of the next page; absent when nothing is left. */
  nextOffset?: number;
  items: T[];
  /** The call that returns the next page, in words; absent when nothing is left. */
  more?: string;
}

/**
 * One page of a list. `more` says, given the next offset, the exact call for the next page.
 * A `limit` of 0 returns no items and the total, with the call that lists them.
 */
export function pageOf<T>(items: readonly T[], limit: number, offset = 0, more?: (nextOffset: number) => string): Paged<T> {
  const start = Math.max(0, Math.min(offset, items.length));
  const page = items.slice(start, start + Math.max(0, limit));
  const next = start + page.length;
  return {
    total: items.length,
    returned: page.length,
    ...(start ? { offset: start } : {}),
    items: page,
    ...(next < items.length ? { nextOffset: next, ...(more ? { more: more(next) } : {}) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Cards by filter
// ---------------------------------------------------------------------------

/** Which cards a view lists. Every condition given must hold. */
export interface CardFilter {
  /** A file, a folder or a glob from the codebase root, or several. */
  files?: string | string[];
  label?: string | string[];
  visibility?: string | string[];
  /** The card's kind: no-rule, narrowed, ambiguous, needs-attributes, unhandled-route, decision-record. */
  kind?: string | string[];
  nested?: boolean;
  /** With a since run: true for the symbols the range changed, false for the ones it did not touch. */
  changed?: boolean;
  /** With a plan active before a since run: true for cards an element of the plan names (`planned`), false for the rest. */
  planned?: boolean;
}

function asList(v: string | string[] | undefined): string[] | undefined {
  return v === undefined ? undefined : Array.isArray(v) ? v : [v];
}

export function filterCards<T extends UndecidedCard>(cards: readonly T[], filter: CardFilter): T[] {
  const files = asList(filter.files)?.map(filesMatcher);
  const labels = asList(filter.label);
  const visibility = asList(filter.visibility);
  const kinds = asList(filter.kind);
  return cards.filter((c) => {
    if (files && !(c.file && files.some((m) => m(c.file!.replace(/\\/g, "/").replace(/^\.\//, ""))))) return false;
    if (labels && !labels.includes(c.label)) return false;
    if (visibility && !(c.visibility && visibility.includes(c.visibility))) return false;
    if (kinds && !kinds.includes(c.kind)) return false;
    if (filter.nested !== undefined && !!c.nested !== filter.nested) return false;
    if (filter.changed !== undefined && !!c.changedInRange !== filter.changed) return false;
    if (filter.planned !== undefined && !!c.planned !== filter.planned) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/** Undecided cards in one folder (or one file), counted by what a rule can name. */
export interface TriageGroup {
  /** The folder, ending in `/`, or the file when the group is one file. `(no file)` for cards without one. */
  path: string;
  cards: number;
  files: number;
  /** With a since run: cards the range changed. */
  changed?: number;
  /** Cards by label (`Function`, `Method`, `Interface`, ...). */
  labels: Record<string, number>;
  /** Cards by visibility, `nested` counted on its own; cards with none are left out. */
  visibility: Record<string, number>;
  /** Model elements sourced to a file in this group. */
  elements: number;
  /** No model element names a file here, while the model names files elsewhere: perhaps not product code. */
  noElement?: true;
}

/** Cards by label and visibility: the shape of a rule (`where: {label, visibility}`). */
export interface KindRow {
  label: string;
  /** `nested` for a nested function, else the visibility, else `-`. */
  visibility: string;
  cards: number;
  changed?: number;
}

export interface GroupOptions {
  /** How many leading folders name a group (default 2: `cli/src/`). */
  depth?: number;
  /** Group by file instead of by folder: one group per file. */
  byFile?: boolean;
  /** Whether the run is a `since` run, so groups count changed cards. */
  since?: boolean;
}

export const DEFAULT_GROUP_DEPTH = 2;

/** A codebase-relative path as cards and rules compare it: forward slashes, no leading `./`; null stays null. */
export function normFile(file: string): string;
export function normFile(file: string | null | undefined): string | null;
export function normFile(file: string | null | undefined): string | null {
  return file ? file.replace(/\\/g, "/").replace(/^\.\//, "") : null;
}

export function groupPath(file: string | null, depth: number, byFile = false): string {
  if (!file) return "(no file)";
  if (byFile) return normFile(file);
  const parts = normFile(file).split("/");
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, Math.min(depth, parts.length - 1)).join("/")}/`;
}

/**
 * The cards grouped by folder, largest group first. `referenced` is every file a model element is
 * sourced to (with the number of elements): it gives each group's `elements`, and `noElement`
 * marks a group the model names no file in, when it names files at all.
 */
export function groupCards(cards: readonly UndecidedCard[], referenced: ReadonlyMap<string, number>, options: GroupOptions = {}): TriageGroup[] {
  const depth = Math.max(1, options.depth ?? DEFAULT_GROUP_DEPTH);
  const groups = new Map<string, TriageGroup & { fileSet: Set<string> }>();
  for (const c of cards) {
    const key = groupPath(c.file, depth, options.byFile);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { path: key, cards: 0, files: 0, labels: {}, visibility: {}, elements: 0, fileSet: new Set() }));
    g.cards++;
    if (c.file) g.fileSet.add(normFile(c.file));
    g.labels[c.label] = (g.labels[c.label] ?? 0) + 1;
    const v = c.nested ? "nested" : c.visibility;
    if (v) g.visibility[v] = (g.visibility[v] ?? 0) + 1;
    if (options.since && c.changedInRange) g.changed = (g.changed ?? 0) + 1;
  }
  const elementsUnder = new Map<string, number>();
  for (const [file, n] of referenced) {
    const key = groupPath(file, depth, options.byFile);
    elementsUnder.set(key, (elementsUnder.get(key) ?? 0) + n);
  }
  const anyReferenced = referenced.size > 0;
  return [...groups.values()]
    .map(({ fileSet, ...g }) => {
      const elements = elementsUnder.get(g.path) ?? 0;
      // A group that is a single file is named by the file.
      const only = fileSet.size === 1 ? [...fileSet][0] : null;
      return {
        ...g,
        path: only && g.path.endsWith("/") && g.cards > 0 && only.split("/").length - 1 <= depth ? only : g.path,
        files: fileSet.size,
        elements,
        ...(anyReferenced && !elements && g.path !== "(no file)" ? { noElement: true as const } : {}),
      };
    })
    .sort((a, b) => b.cards - a.cards || a.path.localeCompare(b.path));
}

/** The cards by label and visibility, largest first. */
export function kindRows(cards: readonly UndecidedCard[], since = false): KindRow[] {
  const rows = new Map<string, KindRow>();
  for (const c of cards) {
    const visibility = c.nested ? "nested" : (c.visibility ?? "-");
    const key = `${c.label}|${visibility}`;
    let row = rows.get(key);
    if (!row) rows.set(key, (row = { label: c.label, visibility, cards: 0 }));
    row.cards++;
    if (since && c.changedInRange) row.changed = (row.changed ?? 0) + 1;
  }
  return [...rows.values()].sort((a, b) => b.cards - a.cards || a.label.localeCompare(b.label) || a.visibility.localeCompare(b.visibility));
}

// ---------------------------------------------------------------------------
// Functions many services share
// ---------------------------------------------------------------------------

/** A function or component that realizes more services than the threshold: a shared helper, probably. */
export interface SharedHelperGroup {
  id: string;
  /** Services it realizes, by the calls extraction read. */
  services: number;
  /** Of those links, how many this run stages (the rest are in the model or the changeset already). */
  staging: number;
}

export interface SharedHelpers {
  /** A function is listed when it realizes more than this many services. */
  sharedBy: number;
  /** The listed functions' links, in all, and how many of them this run stages. */
  links: number;
  staging: number;
  helpers: SharedHelperGroup[];
}

export const DEFAULT_SHARED_BY = 5;

/**
 * The elements that realize more than `sharedBy` services, from the relationships extraction
 * reads (`all`: every `realizes <service>` link the code shows; `staging`: the subset this run
 * stages). Nothing is dropped here: the caller decides, by a rule or a reject, on record.
 */
export function sharedHelperGroups(
  all: ReadonlyArray<{ source: string; predicate: string; target: string }>,
  staging: ReadonlyArray<{ source: string; predicate: string; target: string }>,
  isService: (id: string) => boolean,
  sharedBy = DEFAULT_SHARED_BY
): SharedHelpers {
  const count = (list: ReadonlyArray<{ source: string; predicate: string; target: string }>) => {
    const by = new Map<string, Set<string>>();
    for (const r of list) {
      if (r.predicate !== "realizes" || !isService(r.target)) continue;
      (by.get(r.source) ?? by.set(r.source, new Set()).get(r.source)!).add(r.target);
    }
    return by;
  };
  const allBy = count(all);
  const stagingBy = count(staging);
  const helpers = [...allBy]
    .filter(([, services]) => services.size > sharedBy)
    .map(([id, services]) => ({ id, services: services.size, staging: stagingBy.get(id)?.size ?? 0 }))
    .sort((a, b) => b.services - a.services || a.id.localeCompare(b.id));
  return {
    sharedBy,
    links: helpers.reduce((n, h) => n + h.services, 0),
    staging: helpers.reduce((n, h) => n + h.staging, 0),
    helpers,
  };
}

// ---------------------------------------------------------------------------
// Plan coverage (verify)
// ---------------------------------------------------------------------------

/** A planned element and what the as-built side has for it. */
export interface PlanCoverageItem {
  /** The planned element's id. */
  planned: string;
  type: string;
  /**
   * `staged`: the as-built changeset (or the model) has an element for it. `candidates`: it has
   * none, and cards in its source files (or of its name) could be staged as it. `none`: nothing
   * in the run's scope is a candidate.
   */
  status: "staged" | "candidates" | "none";
  /** For `staged`: the as-built element. */
  asBuilt?: string;
  /** For `candidates`: the cards, each with the type the plan gives the element. */
  candidates?: Array<{ cardId: string; symbol: string; file: string | null; label: string; changedInRange?: true }>;
}

export interface PlannedElementRef {
  id: string;
  layer: string;
  type: string;
  name: string;
  /** Files (and symbols) its source reference names, when it has one. */
  locations: Array<{ file: string; symbol?: string }>;
}

function slug(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/**
 * For each element a plan adds: whether the as-built side has it, and if not, which cards could be
 * it. A planned element is `staged` when an as-built element has its id, or names one of its
 * source locations (file and symbol), or (in another layer than any card suggests) shares its
 * source file and type. A card is a candidate when it is in one of the planned element's source
 * files, or its symbol reads as the planned element's name.
 *
 * `asBuilt`: live elements of the as-built side, with their source locations.
 */
export function planCoverage(
  planned: readonly PlannedElementRef[],
  asBuilt: ReadonlyArray<{ id: string; layer: string; type: string; locations: Array<{ file: string; symbol?: string }> }>,
  cards: readonly UndecidedCard[]
): PlanCoverageItem[] {
  const byId = new Map(asBuilt.map((e) => [e.id, e]));
  const byLocation = new Map<string, Array<{ id: string; layer: string; type: string }>>();
  for (const e of asBuilt) {
    for (const l of e.locations) {
      const key = `${normFile(l.file)}#${l.symbol ?? ""}`;
      (byLocation.get(key) ?? byLocation.set(key, []).get(key)!).push(e);
    }
  }
  const cardsByFile = new Map<string, UndecidedCard[]>();
  const cardsBySlug = new Map<string, UndecidedCard[]>();
  for (const c of cards) {
    if (c.file) (cardsByFile.get(normFile(c.file)) ?? cardsByFile.set(normFile(c.file), []).get(normFile(c.file))!).push(c);
    const key = slug(c.symbol);
    (cardsBySlug.get(key) ?? cardsBySlug.set(key, []).get(key)!).push(c);
  }
  const out: PlanCoverageItem[] = [];
  for (const p of planned) {
    const type = `${p.layer}.${p.type}`;
    const same = (e: { layer: string; type: string }) => e.layer === p.layer && e.type === p.type;
    const direct = byId.get(p.id);
    const located = p.locations.flatMap((l) => byLocation.get(`${normFile(l.file)}#${l.symbol ?? ""}`) ?? []).find(same);
    if (direct || located) {
      out.push({ planned: p.id, type, status: "staged", asBuilt: (direct ?? located)!.id });
      continue;
    }
    const nameSlug = p.id.split(".").slice(2).join(".");
    const found = new Map<string, UndecidedCard>();
    for (const l of p.locations) {
      for (const c of cardsByFile.get(normFile(l.file)) ?? []) {
        // With a symbol on the location only that symbol's card; a file-only location offers the file's cards.
        if (!l.symbol || c.symbol === l.symbol || c.symbol.endsWith(`.${l.symbol}`)) found.set(c.cardId, c);
      }
    }
    for (const c of [...(cardsBySlug.get(nameSlug) ?? []), ...(cardsBySlug.get(slug(p.name)) ?? [])]) found.set(c.cardId, c);
    if (found.size) {
      out.push({
        planned: p.id,
        type,
        status: "candidates",
        candidates: [...found.values()].map((c) => ({
          cardId: c.cardId,
          symbol: c.symbol,
          file: c.file,
          label: c.label,
          ...(c.changedInRange ? { changedInRange: true as const } : {}),
        })),
      });
    } else out.push({ planned: p.id, type, status: "none" });
  }
  return out;
}
