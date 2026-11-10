/**
 * codebase_extract — run the extraction cascade over the indexed code and stage what it finds in
 * an as-built changeset. It never writes the base model and never commits.
 *
 * The cascade (docs/analyzers/CASCADE_DESIGN.md):
 * 1. Tier 0 rules decide what they can; a CBM route is an `api.operation` by the node mapping.
 *    Those decisions are staged, with the relationships the edge mapping gives them.
 * 2. Tier 1 (a decision model) is not wired until the per-project opt-in is settled
 *    (docs/EXTRACTION_STRATEGY.md, B6); it would decide cards between steps 1 and 3.
 * 3. The calling agent gets the rest as cards, paged, and stages its own decisions with model_add.
 *
 * Only what differs from the model is staged (src/analyzers/extraction-plan.ts): existing elements
 * are matched by source file and symbol; a changed match is an update, no match is an add, and an
 * element whose code is gone is listed as a candidate delete, never staged. Re-running on unchanged
 * code stages nothing. `since` limits the run to files changed since a git ref, which is how the
 * verify workflow extracts a branch's build for changeset_verify.
 *
 * It runs inline: on this repository (4,800 cards, 25,000 mapped edges) a run takes a few seconds.
 * The extraction changeset is active afterwards, so the agent's model_add calls stage into it;
 * the one active before is returned as previousActive. A run that stages nothing creates and
 * activates no changeset: its cards wait in pending.json for the changeset the agent creates.
 *
 * "Not an element" decisions are kept per project (.dr/analyzers/extract/decisions.json), by file
 * and symbol: a card or staged symbol the agent rejects (`reject`, which unstages what is still
 * staged for it), and an element this tool staged that the agent then unstaged. Later runs leave
 * those symbols out, and say how many; `clearRejected` forgets them.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { codeChangesSince, inDirs, scopeChanges, type CodeChangesResult } from "../../analyzers/code-changes.js";
import { SOURCE_EXT, VENDOR_EXCLUDE } from "../../analyzers/cards/build.js";
import { ExtractionTimeoutError, type ExtractionGraph } from "../../analyzers/cards/extract.js";
import {
  attributeChangedLines,
  decisionKey,
  needsAttributesCard,
  planElements,
  planRelationships,
  sortUndecided,
  sourceSymbolOf,
  type ElementPlan,
  type PlannedElement,
  type PlannedRelationship,
  type PlannedUpdate,
  type UndecidedCard,
  type UndecidedKind,
} from "../../analyzers/extraction-plan.js";
import { Changeset, type StagedChange } from "../../core/changeset.js";
import { ChangesetGraph } from "../../core/changeset-graph.js";
import { Element } from "../../core/element.js";
import { Layer } from "../../core/layer.js";
import type { Model } from "../../core/model.js";
import { setStagedSourceReference, stagedSourceReference } from "../../core/staged-source-reference.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { getAllLayerIds, isValidLayer } from "../../generated/layer-registry.js";
import { getValidRelationships } from "../../generated/relationship-index.js";
import type { SourceReference } from "../../types/source-reference.js";
import { generateUUID } from "../../utils/id-generator.js";
import { CLIError, ErrorCategory, formatValidOptions } from "../../utils/errors.js";
import { FileLock } from "../../utils/file-lock.js";
import { SchemaValidator } from "../../validators/schema-validator.js";
import { compactJson, jsonResult, loadModel, reloadModel, rootPathSchema, runTool, type McpToolContext, type McpToolDefinition } from "./shared.js";
import { changesetUnstageHandler } from "./changeset-editing.js";
import {
  analyzerNotFoundError,
  canonicalRoots,
  defaultCodebaseToolDeps,
  describeIndex,
  requireFreshIndex,
  type CodebaseToolDeps,
} from "./codebase-shared.js";

const DEFAULT_PAGE_SIZE = 25;
/** The most cards a page holds, whatever pageSize asks: more than this rarely fits the response budget. */
const MAX_PAGE_SIZE = 50;
/**
 * The size a response with cards aims to stay under. Clients save larger tool results to a file
 * (Claude Code does above about 25-30 KB), which the agent then has to search.
 */
const RESPONSE_BUDGET_BYTES = 28 * 1024;
const MAX_LISTED = 100;

const inputSchema = {
  changeset: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Name (or id) of the as-built changeset to stage into. Created when absent, reused when it is staged. " +
        "Default: extract-<short git HEAD>, or extract-<since base>..<HEAD> with since."
    ),
  since: z
    .string()
    .min(1)
    .optional()
    .describe(
      "A git ref (branch, tag or commit). Extract only the files changed since its merge base with HEAD, plus " +
        "uncommitted ones. To verify a branch's build, pass the branch it started from."
    ),
  layers: z.array(z.string()).optional().describe("Only these layers (canonical names). Default: every layer."),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe(
      `Undecided cards per page (default ${DEFAULT_PAGE_SIZE}, at most ${MAX_PAGE_SIZE}). A page that would make the response larger than about ` +
        `${RESPONSE_BUDGET_BYTES / 1024} KB has its cards shortened, and says so.`
    ),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Page of undecided cards (default 1). Page 2 and later read the last run's cards, with its since and layers: nothing is extracted or staged."
    ),
  reject: z
    .array(
      z.object({
        card: z
          .string()
          .min(1)
          .describe("The card's cardId, its symbol (or file#symbol), or the id of an element this extraction staged."),
        reason: z.string().min(1).describe("Why it is not a model element, in a few words."),
      })
    )
    .optional()
    .describe(
      "Code that is not a model element: a card of this extraction (cardId, or a symbol only one card has), a symbol it " +
        "staged (Tier 0 decided it), or the id of an element staged from it. Recorded for the project until cleared, so " +
        "later runs leave them out; an element still staged in the changeset for it is unstaged, with its relationships. " +
        "A call with only reject or clearRejected records and runs nothing."
    ),
  clearRejected: z
    .union([z.literal(true), z.array(z.string().min(1))])
    .optional()
    .describe("Forget not-an-element decisions: true for all, or a list of symbols (or file#symbol) as notElements lists them."),
  rootPath: rootPathSchema,
};

export type CodebaseExtractArgs = z.infer<z.ZodObject<typeof inputSchema>>;

/**
 * The last run on a changeset: its undecided cards, for paging, the arguments and model they came
 * from, and the changeset that was active before the first run.
 */
interface StoredCards {
  changesetId: string;
  changesetName: string;
  gitHead: string;
  since: string | null;
  layers: string[] | null;
  /** The base model's manifest timestamp when the cards were read. */
  baseModified?: string;
  previousActive?: { id: string; name: string } | null;
  createdAt: string;
  cards: UndecidedCard[];
  /** The elements extraction staged into this changeset, by the symbol they came from. */
  staged?: StagedBySymbol[];
  /**
   * Cards earlier runs returned that are no longer undecided (the agent modelled them), so a
   * `reject` can still name them by cardId, e.g. after unstaging the element it added for one.
   */
  earlierCards?: EarlierCard[];
  /**
   * A run that staged nothing and so made no changeset (`changesetId` is empty): its cards, kept
   * in {@link PENDING_FILE} for paging and `reject`, and adopted by the changeset of that name
   * once it exists.
   */
  pending?: true;
  /**
   * Updates extraction itself staged into this changeset, with the fields it changed (an update
   * folded into an add this changeset stages included), accumulated across runs. An entry goes
   * when its change is unstaged or the element is rejected.
   */
  updated?: Array<{
    id: string;
    fields: string[];
    /**
     * The value extraction wrote for each field, keyed as in `fields`: a top-level field by its
     * on-disk name (`description`, `name`, `source_reference`), an attribute as
     * `attributes.<key>` (`attributes.http_path`). The latest run's value wins.
     */
    values?: Record<string, unknown>;
  }>;
  /** Ids extraction listed as candidate deletes for this changeset, accumulated across runs. */
  candidateDeletes?: string[];
}

/** A card of an earlier run, as the card was (older records kept only the identifying fields). */
type EarlierCard = Pick<UndecidedCard, "cardId" | "file" | "symbol" | "label" | "qualifiedName"> & Partial<UndecidedCard>;

interface StagedBySymbol {
  id: string;
  file: string | null;
  symbol: string;
  label: string;
  /** The element name it was staged with. */
  name?: string;
  /** The attributes it was staged with, when it had any. */
  attributes?: Record<string, unknown>;
}

/** An element's name and attributes for its {@link StagedBySymbol} entry. */
function stagedAs(name: string | undefined, attributes: Record<string, unknown> | undefined): Pick<StagedBySymbol, "name" | "attributes"> {
  return { ...(name ? { name } : {}), ...(attributes && Object.keys(attributes).length ? { attributes: structuredClone(attributes) } : {}) };
}

/** Descriptions extraction wrote from docstrings, by element id (see PlanOptions.extractedDescriptions). */
const DESCRIPTIONS_FILE = "descriptions.json";

/** "Not an element" decisions, by {@link decisionKey}. */
const DECISIONS_FILE = "decisions.json";

interface NotElementDecision {
  file: string | null;
  symbol: string;
  label?: string;
  reason: string;
  /** `rejected`: the agent passed it in `reject`. `unstaged`: extraction staged it and it was unstaged. */
  how: "rejected" | "unstaged";
  changeset: string;
  /**
   * The changeset it came from. An `unstaged` decision lasts only while that changeset is staged
   * (discarding or landing it drops the decision); a `rejected` one lasts until cleared.
   */
  changesetId?: string;
  at: string;
}

interface DecisionsFile {
  version: 1;
  notElements: Record<string, NotElementDecision>;
}

/** The cards of the last run that staged nothing, so made no changeset ({@link StoredCards.pending}). */
const PENDING_FILE = "pending.json";

const KEEP_FILES = new Set([DESCRIPTIONS_FILE, DECISIONS_FILE, PENDING_FILE]);

function extractDir(projectRoot: string): string {
  return path.join(projectRoot, ".dr", "analyzers", "extract");
}

function cardsPath(projectRoot: string, changesetId: string): string {
  return path.join(extractDir(projectRoot), `${changesetId.replace(/[^\w.-]/g, "_")}.json`);
}

/**
 * Whether a changeset is one codebase_extract stages into: it has the extraction's record (its
 * cards file, which a run or a reject writes, adopted waiting cards included), or, given its name,
 * it is the changeset the waiting cards of a run that staged nothing name.
 */
export async function isExtractionChangeset(projectRoot: string, changesetId: string, changesetName?: string): Promise<boolean> {
  const stored = await readJson<StoredCards>(cardsPath(projectRoot, changesetId));
  if (stored && !stored.pending && stored.changesetId === changesetId) return true;
  if (!changesetName) return false;
  const pending = await readJson<StoredCards>(path.join(extractDir(projectRoot), PENDING_FILE));
  return !!pending?.pending && pending.changesetName === changesetName;
}

/** A catalog check by triple id (`layer.type.predicate.layer.type`). */
function hasTriple(id: string): boolean {
  const parts = id.split(".");
  if (parts.length !== 5) return false;
  return getValidRelationships(`${parts[0]}.${parts[1]}`, parts[2], `${parts[3]}.${parts[4]}`).length > 0;
}

function emptyChangeset(): Changeset {
  const now = new Date().toISOString();
  return new Changeset({ id: "extract-preview", name: "extract", created: now, modified: now, status: "staged", baseSnapshot: "", changes: [] });
}

function page<T>(items: T[], pageNumber: number, pageSize: number) {
  const pages = Math.ceil(items.length / pageSize);
  return {
    total: items.length,
    page: pageNumber,
    pageSize,
    pages,
    items: items.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
  };
}

function capped<T>(items: T[], limit = MAX_LISTED): { total: number; items: T[]; truncated?: true } {
  return items.length > limit ? { total: items.length, items: items.slice(0, limit), truncated: true } : { total: items.length, items };
}

/** How much of each card a page shows: all of it, shortened, or only what deciding needs. */
type CardDetail = "full" | "shortened" | "compact";

/** Kinds whose reason is the same sentence on every card of the kind. */
const GENERIC_REASON: ReadonlySet<UndecidedKind> = new Set(["no-rule", "narrowed"]);

function clip(text: string | undefined, max: number): string | undefined {
  if (!text) return text;
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function cardAt<T extends UndecidedCard>(card: T, detail: CardDetail): Partial<T> {
  if (detail === "full") return card;
  const { reason, docstring, signature, decorators, candidates, qualifiedName, ...rest } = card;
  const open = candidates.length ? { candidates } : {};
  if (detail === "shortened") {
    return {
      ...rest,
      qualifiedName,
      ...open,
      ...(signature ? { signature: clip(signature, 80) } : {}),
      ...(docstring ? { docstring: clip(docstring, 120) } : {}),
      ...(decorators ? { decorators } : {}),
      ...(GENERIC_REASON.has(card.kind) ? {} : { reason }),
    } as Partial<T>;
  }
  return { ...rest, ...open, ...(card.kind === "ambiguous" || card.kind === "needs-attributes" ? { reason: clip(reason, 200) } : {}) } as Partial<T>;
}

const PAGE_NOTES: Record<Exclude<CardDetail, "full">, string> = {
  shortened:
    "Docstrings and signatures are shortened, and empty candidates and reasons that only name the card's kind left out, to keep this response small.",
  compact: "Docstrings, signatures, decorators, qualified names, empty candidates and most reasons are left out, to keep this response small.",
};

/** How a response was fitted under the budget. */
interface PageFit {
  /** The cards' detail, when less than full, with a note saying what was left out. */
  detail?: Exclude<CardDetail, "full">;
  note?: string;
  /** The page was cut to its first `shown` cards; `readOn` says how to read the ones after. */
  shown?: number;
  readOn?: string;
  /** The lists other than the cards (candidate deletes, updates, retyped, recorded decisions) show at most this many items. */
  listLimit?: number;
  /** Nothing fitted: even this, the smallest response, is over the budget. */
  overBudget?: true;
}

type CardPage = ReturnType<typeof page<UndecidedCard>>;

/** How many items the other lists show, largest first, when they alone would fill the budget. */
const LIST_LIMITS = [MAX_LISTED, 20, 5, 0];

/** The paging call that continues after a page cut to its first `shown` cards. */
function cutInstruction(p: CardPage, shown: number): string {
  const next = (p.page - 1) * p.pageSize + shown;
  return (
    `call codebase_extract with page: ${Math.floor(next / shown) + 1} and pageSize: ${shown}` +
    `${next % shown ? " (its first cards may repeat ones you have)" : ""}`
  );
}

/**
 * The response with a page of cards, at the most detail that keeps it under the budget. The other
 * lists come first: when they alone would fill it, they are shortened (`listLimit`). Then the
 * cards: shortened, then compact, then the page cut short (`shown`, with `readOn`). When even one
 * compact card and empty lists don't fit, the smallest response is returned with `overBudget`.
 * `render` builds the whole response from the page's cards and how it fitted them.
 */
function fitCards(cards: UndecidedCard[], p: CardPage, render: (items: Array<Partial<UndecidedCard>>, fit: PageFit) => Record<string, unknown>): Record<string, unknown> {
  const fits = (result: Record<string, unknown>) => Buffer.byteLength(compactJson(result), "utf-8") <= RESPONSE_BUDGET_BYTES;
  let lists: PageFit = {};
  let listsFit = false;
  for (const limit of LIST_LIMITS) {
    lists = limit < MAX_LISTED ? { listLimit: limit } : {};
    if (fits(render([], lists))) {
      listsFit = true;
      break;
    }
  }
  const compact = cards.map((c) => cardAt(c, "compact"));
  const smallest = (): Record<string, unknown> =>
    render(compact.slice(0, 1), {
      ...lists,
      ...(cards.length ? { detail: "compact", note: PAGE_NOTES.compact } : {}),
      ...(cards.length > 1 ? { shown: 1, readOn: cutInstruction(p, 1) } : {}),
      overBudget: true,
    });
  if (!listsFit) return smallest();
  let result = render(cards, lists);
  if (fits(result)) return result;
  for (const detail of ["shortened", "compact"] as const) {
    result = render(
      cards.map((c) => cardAt(c, detail)),
      { ...lists, detail, note: PAGE_NOTES[detail] }
    );
    if (fits(result)) return result;
  }
  for (let shown = compact.length - 1; shown >= 1; shown--) {
    result = render(compact.slice(0, shown), { ...lists, detail: "compact", note: PAGE_NOTES.compact, shown, readOn: cutInstruction(p, shown) });
    if (fits(result)) return result;
  }
  return smallest();
}

/** The response's notes on what fitting it left out, at its top level. */
function fitNotes(fit: PageFit): Record<string, unknown> {
  return {
    ...(fit.listLimit !== undefined
      ? {
          listsShortened:
            `candidateDeletes, staged.updated, retyped and notElements.recorded list at most ${fit.listLimit} item(s) here, to keep the response small; ` +
            "each total is the full count. Narrow the run with layers or since to list the rest.",
        }
      : {}),
    ...(fit.overBudget ? { overBudget: `Even shortened, this response is over about ${RESPONSE_BUDGET_BYTES / 1024} KB.` } : {}),
  };
}

/** The undecided section of a response: the page, how it was fitted, and how to read on. */
function undecidedSection(p: CardPage, items: Array<Partial<UndecidedCard>>, fit: PageFit, requestedPageSize: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...p,
    items,
    ...extra,
    ...(requestedPageSize > p.pageSize ? { pageSizeCapped: `pageSize ${requestedPageSize} was capped at ${p.pageSize}; use page: 2 and on for more.` } : {}),
    ...(fit.detail ? { detail: fit.detail, detailNote: `${fit.note} A smaller pageSize gives full cards.` } : {}),
    ...(fit.shown !== undefined
      ? { cut: `This page was cut to its first ${fit.shown} of ${p.items.length} cards to keep the response small. For the rest, ${fit.readOn}.` }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

function elementOfAdd(add: PlannedElement, now: string): Element {
  const element = new Element({
    id: generateUUID(),
    path: add.id,
    spec_node_id: `${add.layer}.${add.type}`,
    layer_id: add.layer,
    type: add.type,
    name: add.name,
    description: add.description,
    attributes: add.attributes,
    metadata: { created_at: now, updated_at: now, version: 1 },
    layer: add.layer,
  });
  if (add.sourceReference) element.setSourceReference(add.sourceReference);
  return element;
}

/** Adds whose attributes validate, and the rest as cards with what they lack. */
async function validateAdds(adds: PlannedElement[], project: string, now: string, hunks?: CodeChangesResult["hunks"]) {
  const valid: Array<{ add: PlannedElement; element: Element }> = [];
  const invalid: UndecidedCard[] = [];
  const validator = new SchemaValidator();
  const byLayer = new Map<string, Array<{ add: PlannedElement; element: Element }>>();
  for (const add of adds) {
    const list = byLayer.get(add.layer) ?? byLayer.set(add.layer, []).get(add.layer)!;
    list.push({ add, element: elementOfAdd(add, now) });
  }
  for (const [layerName, items] of byLayer) {
    const layer = new Layer(layerName);
    for (const item of items) layer.addElement(item.element);
    const result = await validator.validateLayer(layer);
    const errors = new Map<string, string[]>();
    for (const e of result.errors) {
      if (!e.elementId) continue;
      (errors.get(e.elementId) ?? errors.set(e.elementId, []).get(e.elementId)!).push(e.message);
    }
    for (const item of items) {
      const errs = errors.get(item.add.id);
      if (errs?.length) invalid.push(needsAttributesCard(item.add, project, errs, hunks));
      else valid.push(item);
    }
  }
  return { valid, invalid };
}

/** The element as the changeset currently has it, in the on-disk shape. */
async function currentSnapshot(model: Model, graph: ChangesetGraph, changeset: Changeset, id: string, layer: string) {
  const element = graph.getElement(id);
  if (element && element.status !== "unchanged") {
    const changes = (changeset.changes as StagedChange[]).filter(
      (c) => (c.type === "add" || c.type === "update") && c.after && graph.resolve(c.elementId) === id
    );
    const last = changes[changes.length - 1];
    if (last?.after) return { snapshot: structuredClone(last.after), stagedAdd: element.status === "added" ? changes.find((c) => c.type === "add") : undefined };
  }
  const base = (await model.getBaseLayer(layer))?.getElement(id);
  return base ? { snapshot: structuredClone(base.toJSON() as unknown as Record<string, unknown>), stagedAdd: undefined } : null;
}

function patched(snapshot: Record<string, unknown>, update: PlannedUpdate, now: string): Record<string, unknown> {
  const after = structuredClone(snapshot);
  for (const [field, value] of Object.entries(update.fields)) {
    if (field === "source_reference") setStagedSourceReference(after, value as SourceReference);
    else if (field.startsWith("attributes.")) {
      after.attributes = { ...((after.attributes as Record<string, unknown>) ?? {}), [field.slice("attributes.".length)]: value };
    } else after[field] = value;
  }
  const metadata = after.metadata as Record<string, unknown> | undefined;
  if (metadata) after.metadata = { ...metadata, updated_at: now };
  return after;
}

function relationshipChange(r: PlannedRelationship): Omit<StagedChange, "sequenceNumber"> {
  return {
    type: "relationship-add",
    elementId: `${r.source}::${r.predicate}::${r.target}`,
    layerName: r.sourceLayer,
    after: {
      source: r.source,
      target: r.target,
      predicate: r.predicate,
      layer: r.sourceLayer,
      ...(r.targetLayer !== r.sourceLayer ? { targetLayer: r.targetLayer } : {}),
      category: "structural",
    },
  };
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

function byLayer(adds: PlannedElement[], updates: PlannedUpdate[], relationships: PlannedRelationship[]) {
  const out: Record<string, { adds: number; updates: number; relationships: number }> = {};
  const at = (layer: string) => (out[layer] ??= { adds: 0, updates: 0, relationships: 0 });
  for (const a of adds) at(a.layer).adds++;
  for (const u of updates) at(u.layer).updates++;
  for (const r of relationships) at(r.sourceLayer).relationships++;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function notElementsResult(
  decisions: DecisionsFile,
  skipped: number,
  recorded: Array<{ symbol: string; file: string | null; how: NotElementDecision["how"] }>,
  cleared: number,
  listLimit = MAX_LISTED
) {
  const total = Object.keys(decisions.notElements).length;
  if (!total && !skipped && !recorded.length && !cleared) return {};
  return {
    notElements: {
      total,
      skipped,
      ...(recorded.length ? { recorded: capped(recorded, listLimit) } : {}),
      ...(cleared ? { cleared } : {}),
      note: "Symbols decided not to be elements (rejected, or unstaged after this tool staged them). Runs leave them out; clearRejected forgets them.",
    },
  };
}

/** Verify mode, the card step: stage cards as the code names them, never as the plan does. */
function verifyCardStep(undecidedPages: number, readOn?: string): string {
  return (
    "Stage the element cards with model_add, named after the card's symbol (the card's name when it has one), never the plan's element, and never copy plan elements here: " +
    'a layer and type from its candidates or hint, sourceFile = file, sourceSymbol = symbol, sourceProvenance: "extracted". ' +
    `Ask the user about cards you can't place, in one short list. ${readFurther(undecidedPages, readOn)}`
  );
}

/** Verify mode, after verify: the plan lands, not the as-built changeset. */
function verifyLandStep(plan: { id: string; name: string }, why = ""): string {
  return (
    `After verify, the plan '${plan.name}' lands (changeset_commit when the user asks), not this changeset: discard this one or keep it as a record. ` +
    `Landing it first drifts the plan's base, so the plan would need force. Call changeset_activate with "${plan.id}" to resume the plan${why}.`
  );
}

/**
 * Verify mode with nothing to stage or decide: no as-built changeset exists, so the plan is
 * verified against the model, with extraction's blind spots applied.
 */
function verifyNothingSteps(plan: { id: string; name: string }, since: string): string[] {
  return [
    `Nothing in the range since ${since} is observable to extraction or differs from the model, so no as-built changeset was created: there is none to verify against. '${plan.name}' is still active.`,
    `Call changeset_verify with planned: "${plan.id}" and against: {base: true, extracted: true}: it compares the plan with the model, and what extraction can't see is unverifiable rather than missing.`,
  ];
}

/** How to read the cards after this page: the cut's paging call when the page was cut. */
function readFurther(undecidedPages: number, readOn?: string): string {
  return readOn
    ? `This page was cut to keep the response small: for the cards after it, ${readOn}, and page on with that pageSize.`
    : `Read further pages with page: 2 and on (${undecidedPages} in all).`;
}

function nextSteps(
  changeset: { id: string; name: string },
  previous: { id: string; name: string } | null,
  undecidedPages: number,
  plan: Pick<ElementPlan, "candidateDeletes" | "retyped">,
  changedCards = 0,
  since?: string,
  readOn?: string
): string[] {
  const steps = [
    `The as-built changeset '${changeset.name}' is active: model_add, model_update, model_delete and relationship_add stage into it. Nothing reaches the base model until the user lands it.`,
  ];
  if (changedCards > 0) {
    steps.push(
      `${changedCards} card(s) have changedInRange: their lines are new or changed in the range, so they come first. The rest are symbols in the same files that the range didn't touch.`
    );
  }
  // A since run with a plan active before it is the verify workflow: this changeset is the
  // as-built side the plan is checked against, not a change to land.
  const verify = !!since && !!previous;
  const rerun = `codebase_extract again with changeset: "${changeset.name}"${since ? `, since: "${since}"` : ""}`;
  if (undecidedPages > 0) {
    steps.push(
      verify
        ? verifyCardStep(undecidedPages, readOn)
        : "Decide the undecided cards: for each one that is a model element, call model_add with a layer and type from its candidates " +
            "(or its hint; spec_type says what a type needs), a name (the card's name when it has one), sourceFile = file, sourceSymbol = symbol and sourceProvenance: \"extracted\". " +
            readFurther(undecidedPages, readOn),
      "For cards that are not elements, call codebase_extract with reject: [{card: cardId, reason}] so later runs leave them out.",
      verify
        ? `Call ${rerun} for their relationships.`
        : `Then call ${rerun} (it keeps that run's since and layers). It finds your elements by their source reference and stages the relationships the edge mapping gives them.`
    );
  }
  if (plan.candidateDeletes.length) {
    steps.push(
      "Check candidateDeletes: call model_delete only for elements whose code is really gone (replacedBy names the element staged for a renamed file). " +
        "reference-never-matched means the element's reference was wrong before the range: the range removed nothing, so fix or delete the element without blaming the range."
    );
  }
  if (plan.retyped.length) {
    steps.push("retyped lists elements whose type the rules now decide differently. Leave them unless the rule is right; changing a type means adding the new element and deleting the old.");
  }
  if (verify) {
    steps.push(
      `Then call changeset_verify with planned: "${previous!.id}" and against: {changesetId: "${changeset.id}"}.`,
      verifyLandStep(previous!)
    );
    return steps;
  }
  steps.push("Call changeset_brief to see what the changeset covers and its gaps, then review_open and give the user the link.");
  if (previous) {
    steps.push(
      `'${previous.name}' was active before this call. To check it against this build, call changeset_verify with planned: "${previous.id}" and against: {changesetId: "${changeset.id}"}. Call changeset_activate with "${previous.id}" to resume it.`
    );
  } else {
    steps.push("The user lands the changeset with changeset_commit (they confirm in a dialog) or in the viewer.");
  }
  return steps;
}

/**
 * Next steps for a run that staged nothing but left cards or candidate deletes: no changeset was
 * made, so the agent makes one before staging anything for them.
 */
function pendingSteps(
  name: string,
  active: { id: string; name: string } | null,
  undecidedPages: number,
  plan: Pick<ElementPlan, "candidateDeletes">,
  changedCards: number,
  since?: string,
  readOn?: string
): string[] {
  // A since run with a plan active is the verify workflow: the changeset to create is the
  // as-built side, and creating it deactivates the plan.
  const verify = !!since && !!active;
  const steps = [
    verify
      ? `Nothing was staged, so no as-built changeset was created and '${active!.name}' is still active. Before you stage a card or delete a candidate, call changeset_create with name: "${name}" ` +
        `(it becomes active, so model_add and model_delete stage into it and not into the plan).`
      : `Nothing was staged, so no changeset was created or activated. Before you model a card or delete a candidate, call changeset_create with name: "${name}" ` +
        `(it becomes active, and model_add and model_delete stage into it); without it they would ${active ? `stage into '${active.name}'` : "write the base model"}.`,
  ];
  if (changedCards > 0) {
    steps.push(`${changedCards} card(s) have changedInRange: their lines are new or changed in the range, so they come first. The rest are symbols in the same files that the range didn't touch.`);
  }
  if (undecidedPages > 0) {
    steps.push(
      verify
        ? verifyCardStep(undecidedPages, readOn)
        : "For each card that is a model element, call model_add (into that changeset) with a layer and type from its candidates (or its hint), a name (the card's name when it has one), " +
            `sourceFile = file, sourceSymbol = symbol and sourceProvenance: "extracted". ${readFurther(undecidedPages, readOn)}`,
      "For cards that are not elements, call codebase_extract with reject: [{card: cardId, reason}] so later runs leave them out; that needs no changeset.",
      verify
        ? `Call codebase_extract again with changeset: "${name}", since: "${since}" for their relationships.`
        : `After adding elements, call codebase_extract with changeset: "${name}"${since ? `, since: "${since}"` : ""}: it keeps this run's since and layers, and stages the relationships the edge mapping gives them.`
    );
  }
  if (plan.candidateDeletes.length) {
    steps.push(
      "Check candidateDeletes: call model_delete (into that changeset) only for elements whose code is really gone. " +
        "reference-never-matched means the element's reference was wrong before the range: the range removed nothing."
    );
  }
  if (verify) {
    steps.push(
      `Then call changeset_verify with planned: "${active!.id}" and against: {changesetId: "${name}"}.`,
      verifyLandStep(active!, " (changeset_create deactivated it)"),
      `If no card is an element and nothing is deleted, there is no as-built changeset to verify against: call changeset_verify with planned: "${active!.id}" and against: {base: true, extracted: true} instead.`
    );
    return steps;
  }
  steps.push("If none of these need modelling now, there is nothing to land and nothing to clean up.");
  return steps;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const DEFAULT_BUDGET_MS = 100_000;
const NARROW = "Narrow the run with layers, or with since (a git ref), and call codebase_extract again";

function sameLayers(a: string[] | null, b: string[] | null): boolean {
  return JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

/** Drop the cards files of changesets that are no longer staged. */
async function pruneCardFiles(projectRoot: string, manager: StagingAreaManager): Promise<void> {
  const dir = extractDir(projectRoot);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  const staged = new Set((await manager.list()).filter((c) => c.status === "staged").map((c) => c.id));
  for (const entry of entries) {
    if (!entry.endsWith(".json") || KEEP_FILES.has(entry)) continue;
    const stored = await readJson<StoredCards>(path.join(dir, entry));
    if (!stored || !staged.has(stored.changesetId)) await rm(path.join(dir, entry), { force: true });
  }
}

/** The staged changesets with an extraction run at this commit. */
async function runsAt(projectRoot: string, manager: StagingAreaManager, head: string): Promise<Changeset[]> {
  let entries: string[];
  try {
    entries = await readdir(extractDir(projectRoot));
  } catch {
    return [];
  }
  const out: Changeset[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json") || KEEP_FILES.has(entry)) continue;
    const stored = await readJson<StoredCards>(path.join(extractDir(projectRoot), entry));
    if (!stored || stored.pending || stored.gitHead !== head || !stored.changesetId) continue;
    const changeset = await manager.load(stored.changesetId);
    if (changeset?.status === "staged") out.push(changeset);
  }
  return out;
}

async function readDecisions(projectRoot: string): Promise<DecisionsFile> {
  const stored = await readJson<DecisionsFile>(path.join(extractDir(projectRoot), DECISIONS_FILE));
  return { version: 1, notElements: stored?.notElements && typeof stored.notElements === "object" ? stored.notElements : {} };
}

async function writeDecisions(projectRoot: string, decisions: DecisionsFile): Promise<void> {
  await mkdir(extractDir(projectRoot), { recursive: true });
  await writeFile(path.join(extractDir(projectRoot), DECISIONS_FILE), JSON.stringify(decisions, null, 2), "utf-8");
}

/**
 * A piece of code a `reject` may name: a card of this extraction (this run's or an earlier one's),
 * a symbol it staged, or an element of its changeset that names code (staged now, or unstaged).
 */
interface Rejectable {
  file: string | null;
  symbol: string;
  label?: string;
  cardId?: string;
  qualifiedName?: string;
  elementId?: string;
}

function normFile(file: string | null | undefined): string | null {
  return file ? file.replace(/\\/g, "/").replace(/^\.\//, "") : null;
}

/**
 * The code an extraction changeset's own extracted elements name: its staged adds, and the adds
 * unstaged from it. Only `extracted` provenance: an element someone wrote by hand (a planned one,
 * with a manual reference) is never a rejection target.
 */
function changesetRejectables(changeset: Changeset | null, graph: ChangesetGraph | null): Rejectable[] {
  const out: Rejectable[] = [];
  for (const e of graph?.elements.values() ?? []) {
    if (e.status !== "added" || e.sourceReference?.provenance !== "extracted") continue;
    for (const l of e.sourceReference.locations ?? []) {
      if (l.symbol) out.push({ file: normFile(l.file), symbol: l.symbol, elementId: e.id });
    }
  }
  for (const t of changeset?.unstaged ?? []) {
    if (t.rewritten || t.change.type !== "add") continue;
    const ref = stagedSourceReference(t.change.after as Record<string, unknown> | undefined);
    if (ref?.provenance !== "extracted") continue;
    for (const l of ref.locations ?? []) {
      if (l.symbol) out.push({ file: normFile(l.file), symbol: l.symbol, elementId: t.change.elementId });
    }
  }
  return out;
}

/**
 * What a `reject` names, one symbol per entry, or a CLIError naming the entries it can't place.
 * An entry may be a cardId (of the last run, or an earlier run's card the agent has modelled
 * since), an element id the extraction staged, or a symbol (bare, file#symbol or qualified name)
 * that only one of those has.
 */
function cardsToReject(
  stored: StoredCards | null,
  fromChangeset: Rejectable[],
  changesetName: string,
  refs: Array<{ card: string; reason: string }>
): Array<{ file: string | null; symbol: string; label?: string; reason: string }> {
  const known: Rejectable[] = [
    ...(stored?.cards ?? []).map((c) => ({ file: c.file, symbol: c.symbol, label: c.label, cardId: c.cardId, qualifiedName: c.qualifiedName })),
    ...(stored?.earlierCards ?? []).map((c) => ({ file: c.file, symbol: c.symbol, label: c.label, cardId: c.cardId, qualifiedName: c.qualifiedName })),
    ...(stored?.staged ?? []).map((s) => ({ file: s.file, symbol: s.symbol, label: s.label, elementId: s.id })),
    ...fromChangeset,
  ];
  if (!known.length) {
    throw new CLIError(`No cards recorded for '${changesetName}' to reject from`, ErrorCategory.USER, [
      "Call codebase_extract first, then pass the cardId (or symbol) of each card that is not an element",
    ]);
  }
  const found: Array<{ file: string | null; symbol: string; label?: string; reason: string }> = [];
  const unknown: string[] = [];
  const ambiguous: string[] = [];
  // The same symbol can be known several ways (a card, then the element staged for it).
  const distinctSymbols = (matches: Rejectable[]): Rejectable[] => {
    const bySymbol = new Map<string, Rejectable>();
    for (const m of matches) {
      const key = decisionKey(m.file, m.symbol);
      const seen = bySymbol.get(key);
      if (!seen || (!seen.label && m.label)) bySymbol.set(key, m);
    }
    return [...bySymbol.values()];
  };
  for (const ref of refs) {
    // An element id names the element: every symbol it names (one per source location).
    const ofElement = known.filter((k) => k.elementId === ref.card);
    if (ofElement.length) {
      for (const d of distinctSymbols(ofElement)) found.push({ file: d.file, symbol: d.symbol, label: d.label, reason: ref.reason });
      continue;
    }
    const byCard = known.filter((k) => k.cardId === ref.card);
    const matches = byCard.length
      ? byCard
      : known.filter((k) => k.symbol === ref.card || `${k.file ?? ""}#${k.symbol}` === ref.card || k.qualifiedName === ref.card);
    const distinct = distinctSymbols(matches);
    if (distinct.length === 1) found.push({ file: distinct[0].file, symbol: distinct[0].symbol, label: distinct[0].label, reason: ref.reason });
    else if (distinct.length > 1) {
      ambiguous.push(`${ref.card} (${distinct.map((d) => d.cardId ?? `${d.file ?? ""}#${d.symbol}`).join(", ")})`);
    } else unknown.push(ref.card);
  }
  if (unknown.length || ambiguous.length) {
    const parts = [
      ...(unknown.length ? [`not among the cards or staged symbols of '${changesetName}': ${unknown.join(", ")}`] : []),
      ...(ambiguous.length ? [`names more than one card: ${ambiguous.join("; ")}`] : []),
    ];
    throw new CLIError(`Can't reject: ${parts.join("; ")}. Nothing was recorded`, ErrorCategory.USER, [
      "Pass the cardId (or file#symbol) of a card, or the id of an element this extraction staged",
    ]);
  }
  return found;
}

/** Drop decisions: all, or those whose key, symbol or file#symbol is listed. Returns how many. */
function clearDecisions(decisions: DecisionsFile, which: true | string[]): number {
  let n = 0;
  for (const [key, d] of Object.entries(decisions.notElements)) {
    if (which === true || which.some((w) => w === key || w === d.symbol || w === `${d.file ?? ""}#${d.symbol}`)) {
      delete decisions.notElements[key];
      n++;
    }
  }
  return n;
}

export function createCodebaseExtractHandler(deps: CodebaseToolDeps = defaultCodebaseToolDeps) {
  return async function codebaseExtractHandler(args: CodebaseExtractArgs, context?: McpToolContext): Promise<CallToolResult> {
    return runTool(async () => {
      const startedAt = Date.now();
      const deadline = startedAt + (deps.budgetMs ?? DEFAULT_BUDGET_MS);
      const model = await loadModel(args.rootPath);
      const { projectRoot, codebaseRoot } = await canonicalRoots(model);

      const argLayers = args.layers?.length ? [...new Set(args.layers)] : undefined;
      const unknownLayers = (argLayers ?? []).filter((l) => !isValidLayer(l));
      if (unknownLayers.length) {
        throw new CLIError(`Unknown layer${unknownLayers.length > 1 ? "s" : ""}: ${unknownLayers.join(", ")}`, ErrorCategory.USER, [
          `Use canonical layer names: ${formatValidOptions(getAllLayerIds())}`,
        ]);
      }

      const { analyzer, freshness, index: indexJudgement } = await requireFreshIndex(projectRoot, codebaseRoot, deps, "codebase_extract", {
        uncommittedEdits: true,
      });
      const head = freshness.currentGitHead;

      const manager = new StagingAreaManager(model.rootPath, model);
      const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
      const effectivePageSize = Math.min(pageSize, MAX_PAGE_SIZE);
      const baseModified = model.manifest.modified;
      const paging = (args.page ?? 1) > 1;
      // A call that only rejects cards or clears decisions records them and runs nothing.
      const decisionsOnly = !paging && (!!args.reject?.length || args.clearRejected !== undefined);

      // The changeset: the one named; else, for a page or decisions call, the active extraction
      // changeset (it has a cards file); else the default name for this commit (and range).
      let name = args.changeset ?? "";
      let changeset: Changeset | null = args.changeset ? await manager.load(args.changeset) : null;
      if (!args.changeset && (paging || decisionsOnly)) {
        const activeId = await manager.getActiveId();
        const active = activeId ? await manager.load(activeId) : null;
        if (active?.status === "staged" && existsSync(cardsPath(projectRoot, active.id!))) {
          changeset = active;
          name = active.name;
        } else {
          // The extraction changeset isn't the active one (the agent switched back to its plan):
          // the run at this commit into a staged changeset, when there is only one. With several,
          // guessing could reject (and unstage) from the wrong one, so the call is refused.
          const runs = await runsAt(projectRoot, manager, head);
          if (runs.length === 1) {
            changeset = runs[0];
            name = runs[0].name;
          } else if (runs.length > 1) {
            throw new CLIError(
              `Several extraction changesets have runs at this commit (${runs.map((r) => `'${r.name}'`).sort().join(", ")}), and none is active`,
              ErrorCategory.USER,
              ["Pass changeset with the name of the one you mean"]
            );
          }
        }
      }
      // The last run that staged nothing made no changeset; its cards wait under its name until
      // that changeset exists (the agent creates it to stage its decisions), which adopts them.
      // Cards read at another commit are stale: not adopted (their since would be another run's),
      // and removed under the lock below.
      const pendingRecord = await readJson<StoredCards>(path.join(extractDir(projectRoot), PENDING_FILE));
      const pending = pendingRecord?.pending && pendingRecord.gitHead === head ? pendingRecord : null;
      const stalePending = !!pendingRecord?.pending && pendingRecord.gitHead !== head;
      const pendingFor = (n: string | undefined) => (pending && n && pending.changesetName === n ? pending : null);
      let stored = changeset ? await readJson<StoredCards>(cardsPath(projectRoot, changeset.id!)) : null;
      stored ??= pendingFor(changeset?.name ?? args.changeset);
      if (
        !args.changeset &&
        (paging || decisionsOnly) &&
        pending &&
        (!changeset || !stored || stored.createdAt < pending.createdAt)
      ) {
        // A page or decisions call after a run that made no changeset (later than the active
        // extraction changeset's last run): that run's cards, in the changeset of its name once the
        // agent has created it.
        const named = await manager.load(pending.changesetName);
        changeset = named?.status === "staged" ? named : null;
        name = pending.changesetName;
        stored = pending;
      }

      // A run or page into an extraction changeset (or the cards waiting for it) keeps its run's
      // since and layers; a call that names others is refused.
      let since = args.since;
      let layers = argLayers;
      if (stored && (changeset ? changeset.status === "staged" : !!stored.pending) && !decisionsOnly) {
        const conflicts: string[] = [];
        if (args.since !== undefined && args.since !== (stored.since ?? undefined)) {
          conflicts.push(`since: ${args.since} (its run had since: ${stored.since ?? "none"})`);
        }
        if (argLayers && !sameLayers(stored.layers, argLayers)) {
          conflicts.push(`layers: ${argLayers.join(", ")} (its run had layers: ${stored.layers?.join(", ") ?? "all"})`);
        }
        if (conflicts.length) {
          throw new CLIError(`'${stored.changesetName}' holds another run's extraction: this call names ${conflicts.join(" and ")}`, ErrorCategory.USER, [
            "Leave since and layers out to use that run's",
            "Or pass another changeset name for a run with these arguments",
          ]);
        }
        since = stored.since ?? undefined;
        layers = stored.layers ?? undefined;
      }

      // The scope: every file, or the files changed since a ref (a run, or a default name to find).
      let changes: CodeChangesResult | null = null;
      if (since && (!(paging || decisionsOnly) || (!changeset && !stored))) changes = await (deps.codeChanges ?? codeChangesSince)(codebaseRoot, since);

      if (!changeset && !args.changeset && !stored?.pending) {
        // A whole-codebase run and a `since` run at the same commit are different changesets. A
        // range with no commits (only uncommitted edits) is named for the working tree.
        const defaultName = !changes
          ? `extract-${head.slice(0, 7)}`
          : changes.base === head
            ? `extract-${head.slice(0, 7)}+worktree`
            : `extract-${changes.base.slice(0, 7)}..${head.slice(0, 7)}`;
        name = defaultName;
        changeset = await manager.load(name);
        // A default name already landed (or discarded) at this commit: take the next free one.
        for (let n = 2; changeset && changeset.status !== "staged"; n++) {
          name = `${defaultName}-${n}`;
          changeset = await manager.load(name);
        }
        stored = (changeset ? await readJson<StoredCards>(cardsPath(projectRoot, changeset.id!)) : null) ?? pendingFor(name);
      }
      if (changeset && changeset.status !== "staged") {
        throw new CLIError(`Changeset '${changeset.name}' is ${changeset.status} and can't take the extraction`, ErrorCategory.USER, [
          "Pass another name in changeset",
        ]);
      }

      const backend = paging || decisionsOnly ? null : await deps.getAnalyzer(analyzer);
      if (!paging && !decisionsOnly) {
        if (!backend) throw analyzerNotFoundError(analyzer);
        if (!backend.extract) {
          throw new CLIError(`The ${analyzer} analyzer can't extract (it has no Tier-0 rules)`, ErrorCategory.USER);
        }
      }

      // One call per project at a time, from reading the decisions and the model to staging.
      await mkdir(extractDir(projectRoot), { recursive: true });
      const lock = new FileLock(path.join(extractDir(projectRoot), "run"));
      try {
        await lock.acquire({ timeout: 2000, staleLockThreshold: (deps.budgetMs ?? DEFAULT_BUDGET_MS) + 60_000 });
      } catch {
        throw new CLIError("Another codebase_extract run is in progress for this project", ErrorCategory.USER, [
          "Wait for it to finish, then call codebase_extract again",
        ]);
      }
      try {
        // Decisions, read under the lock: drop inferred ones whose changeset is gone, then what
        // this call clears, then what it rejects.
        if (stalePending) {
          const again = await readJson<StoredCards>(path.join(extractDir(projectRoot), PENDING_FILE));
          if (again?.pending && again.gitHead !== head) await rm(path.join(extractDir(projectRoot), PENDING_FILE), { force: true });
        }
        const decisions = await readDecisions(projectRoot);
        const stagedIds = new Set((await manager.list()).filter((c) => c.status === "staged").map((c) => c.id));
        let pruned = false;
        for (const [key, d] of Object.entries(decisions.notElements)) {
          if (d.how === "unstaged" && !(d.changesetId && stagedIds.has(d.changesetId))) {
            delete decisions.notElements[key];
            pruned = true;
          }
        }
        const recordedNow: Array<{ symbol: string; file: string | null; how: NotElementDecision["how"] }> = [];
        let cleared = 0;
        if (args.clearRejected) cleared = clearDecisions(decisions, args.clearRejected);
        // What a reject names that is staged in the extraction changeset now: unstaged below, after
        // recording. Only a changeset this extraction stages into (it has cards, or adopted the
        // waiting ones) is touched, and in it only extracted elements.
        const toUnstage = new Map<string, string>();
        const inBase: string[] = [];
        const keptElements: Array<{ id: string; alsoNames: string[] }> = [];
        if (args.reject?.length) {
          const now = new Date().toISOString();
          const extractionChangeset = changeset && stored ? changeset : null;
          const graph = extractionChangeset ? await ChangesetGraph.build(model, extractionChangeset) : null;
          const rejected = cardsToReject(stored, changesetRejectables(extractionChangeset, graph), changeset?.name ?? stored?.changesetName ?? name, args.reject);
          const rejectedKeys = new Map<string, string>();
          for (const card of rejected) {
            const key = decisionKey(card.file, card.symbol);
            rejectedKeys.set(key, card.symbol);
            decisions.notElements[key] = {
              file: card.file,
              symbol: card.symbol,
              ...(card.label ? { label: card.label } : {}),
              reason: card.reason,
              how: "rejected",
              changeset: changeset?.name ?? stored?.changesetName ?? name,
              ...(changeset ? { changesetId: changeset.id! } : {}),
              at: now,
            };
            recordedNow.push({ symbol: card.symbol, file: card.file, how: "rejected" });
          }
          // Elements that name a rejected symbol. One the changeset adds is unstaged when every
          // symbol it names is rejected; one that also names other code stays, and is listed. One
          // the base model has stays (rejecting is about what extraction stages, not what the
          // model says).
          const stagedByExtraction = new Map<string, string>();
          for (const st of stored?.staged ?? []) {
            const key = decisionKey(st.file, st.symbol);
            if (rejectedKeys.has(key)) stagedByExtraction.set(st.id, key);
          }
          for (const e of graph?.elements.values() ?? []) {
            if (e.status === "deleted") continue;
            const keys = new Set(
              (e.sourceReference?.locations ?? []).filter((l) => l.symbol).map((l) => decisionKey(normFile(l.file), l.symbol!))
            );
            const hit = stagedByExtraction.get(e.id) ?? [...keys].find((k) => rejectedKeys.has(k));
            if (!hit) continue;
            if (!stagedByExtraction.has(e.id) && e.sourceReference?.provenance !== "extracted") continue;
            if (e.status !== "added" || e.alreadyInBase) {
              inBase.push(e.id);
              continue;
            }
            const others = [...keys].filter((k) => !rejectedKeys.has(k));
            if (others.length) keptElements.push({ id: e.id, alsoNames: others });
            else toUnstage.set(e.id, rejectedKeys.get(hit)!);
          }
        }
        if (pruned || cleared || recordedNow.length) await writeDecisions(projectRoot, decisions);
        const notElementKeys = new Set(Object.keys(decisions.notElements));

        // Unstage what was rejected while staged, with the relationships staged for it, so the
        // decision holds now and not only once the changeset lands.
        const unstaged: Array<{ id: string; symbol: string; changes: number }> = [];
        const unstageFailed: Array<{ id: string; error: string }> = [];
        for (const [id, symbol] of toUnstage) {
          const result = await changesetUnstageHandler({ elementId: id, changesetId: changeset!.id!, rootPath: args.rootPath });
          const body = JSON.parse((result.content[0] as { text: string }).text) as { unstaged?: unknown[]; error?: string; message?: string };
          if (result.isError) unstageFailed.push({ id, error: body.error ?? body.message ?? "unstage failed" });
          else if (body.unstaged?.length) unstaged.push({ id, symbol, changes: body.unstaged.length });
        }
        if (unstaged.length && stored && changeset) {
          // The record of what extraction staged no longer holds what was unstaged. Waiting cards
          // become this changeset's record here (adopted, as a run would adopt them).
          const gone = new Set(unstaged.map((u) => u.id));
          const { pending: wasPending, ...rest } = stored;
          const updated = (stored.updated ?? []).filter((u) => !gone.has(u.id));
          stored = {
            ...rest,
            changesetId: changeset.id!,
            changesetName: changeset.name,
            staged: (stored.staged ?? []).filter((s) => !gone.has(s.id)),
            ...(updated.length ? { updated } : { updated: undefined }),
          };
          await writeFile(cardsPath(projectRoot, changeset.id!), JSON.stringify(stored), "utf-8");
          if (wasPending) await rm(path.join(extractDir(projectRoot), PENDING_FILE), { force: true });
        }
        if (unstaged.length) await reloadModel(args.rootPath);
        const rejectResult = {
          ...(unstaged.length
            ? {
                unstaged: {
                  items: unstaged,
                  note: `Rejected while staged: unstaged from '${changeset!.name}', with the relationships staged for them (changes counts both).`,
                },
              }
            : {}),
          ...(unstageFailed.length ? { unstageFailed } : {}),
          ...(inBase.length
            ? { inModel: { ids: [...new Set(inBase)], note: "Already in the base model: rejecting doesn't remove them. model_delete them if they should go." } }
            : {}),
          ...(keptElements.length
            ? {
                kept: {
                  items: keptElements,
                  note: "Still staged: each also names code that wasn't rejected (alsoNames). Unstage it with changeset_unstage, or drop the rejected location with model_update, if it should change.",
                },
              }
            : {}),
        };

        if (decisionsOnly) {
          const rerunName = changeset?.name ?? stored?.changesetName;
          const rerun = rerunName ? `changeset: "${rerunName}"` : "the arguments of the last run";
          return jsonResult(
            {
              changeset: changeset ? { id: changeset.id, name: changeset.name } : null,
              ...notElementsResult(decisions, 0, recordedNow, cleared),
              ...rejectResult,
              message: unstaged.length
                ? `Recorded, and unstaged ${unstaged.length} element(s) it had staged; nothing was extracted.`
                : "Recorded; nothing was extracted or staged.",
              next: [`Call codebase_extract with ${rerun} to refresh the cards: it leaves out what is recorded, and says how many.`],
            },
            { compact: true }
          );
        }

        // Later pages: the last run's cards, marking any the agent has modelled since.
        if (paging) {
          if (!stored) {
            throw new CLIError(
              changeset ? `No cards recorded for '${changeset.name}'` : `No extraction changeset '${name}' yet`,
              ErrorCategory.USER,
              ["Call codebase_extract without page first"]
            );
          }
          const runName = changeset?.name ?? stored.changesetName;
          if (stored.gitHead !== head) {
            throw new CLIError(`The cards for '${runName}' were read at ${stored.gitHead.slice(0, 7)}; the code is now at ${head.slice(0, 7)}`, ErrorCategory.USER, [
              "Call codebase_extract without page to extract again",
            ]);
          }
          const graph = await ChangesetGraph.build(model, changeset ?? emptyChangeset());
          const modelledAt = new Map<string, string>();
          for (const e of graph.elements.values()) {
            if (e.status === "deleted") continue;
            for (const l of e.sourceReference?.locations ?? []) if (l.symbol) modelledAt.set(`${l.file}#${l.symbol}`, e.id);
          }
          const cards = stored.cards
            .filter((c) => !notElementKeys.has(decisionKey(c.file, c.symbol)))
            .map((c) => {
              const modelled = c.file ? modelledAt.get(`${c.file}#${c.symbol}`) : undefined;
              return modelled ? { ...c, modelled } : c;
            });
          const p = page(cards, args.page!, effectivePageSize);
          return jsonResult(
            fitCards(p.items, p, (items, fit) => ({
              changeset: changeset ? { id: changeset.id, name: changeset.name } : null,
              ...(changeset ? {} : { pending: `No changeset yet: the run that read these cards staged nothing. Call changeset_create with name: "${runName}" before staging.` }),
              ...fitNotes(fit),
              scope: { since: stored!.since, layers: stored!.layers ?? "all" },
              undecided: undecidedSection(p, items, fit, pageSize),
              ...notElementsResult(decisions, stored!.cards.length - cards.length, recordedNow, cleared, fit.listLimit),
              ...rejectResult,
              ...(stored!.baseModified !== baseModified
                ? { warning: "The base model changed since these cards were read; call codebase_extract without page to refresh them." }
                : {}),
              ...(fit.readOn
                ? { next: `This page was cut to keep the response small: for the cards after it, ${fit.readOn}.` }
                : args.page! < p.pages
                  ? { next: `Call codebase_extract with page: ${args.page! + 1} for the next cards.` }
                  : {}),
            })),
            { compact: true }
          );
        }
        // Uncommitted source edits, deletes and renames the index hasn't seen, from the shared
        // freshness rule (judgeIndex, which honours deps.sourceEdits).
        const edited = indexJudgement.editedSince;

        // What the model has: the base, plus the extraction changeset's own changes when it exists.
        const before = await ChangesetGraph.build(model, changeset ?? emptyChangeset());
        const referenced = new Set<string>();
        const liveKeys = new Set<string>();
        const liveIds = new Set<string>();
        // The elements this changeset adds, by the symbols they name: a card the agent staged.
        const addedAt = new Map<string, string>();
        for (const e of before.elements.values()) {
          if (e.status === "deleted") continue;
          liveIds.add(e.id);
          for (const l of e.sourceReference?.locations ?? []) {
            const file = l.file?.replace(/\\/g, "/").replace(/^\.\//, "");
            if (file) referenced.add(file);
            if (!l.symbol) continue;
            const key = decisionKey(file || null, l.symbol);
            liveKeys.add(key);
            if (e.status === "added" && !e.alreadyInBase && !addedAt.has(key)) addedAt.set(key, e.id);
          }
        }

        // Elements this tool staged into the changeset that the agent unstaged from it (the
        // changeset keeps a tombstone of the unstaged add): not elements, while it stays staged.
        const storedBefore = stored;
        const unstagedAdds = new Set(
          (changeset?.unstaged ?? []).filter((t) => !t.rewritten && t.change.type === "add").map((t) => t.change.elementId)
        );
        const stillStaged: StagedBySymbol[] = [];
        for (const st of storedBefore?.staged ?? []) {
          const key = decisionKey(st.file, st.symbol);
          if (liveIds.has(st.id) || liveKeys.has(key)) {
            stillStaged.push(st);
          } else if (unstagedAdds.has(st.id) && !decisions.notElements[key]) {
            decisions.notElements[key] = {
              file: st.file,
              symbol: st.symbol,
              label: st.label,
              reason: `${st.id} was staged by codebase_extract and then unstaged`,
              how: "unstaged",
              changeset: changeset!.name,
              changesetId: changeset!.id!,
              at: new Date().toISOString(),
            };
            notElementKeys.add(key);
            recordedNow.push({ symbol: st.symbol, file: st.file, how: "unstaged" });
          }
        }
        // Cards of earlier runs the agent has staged since (model_add with the card's file and
        // symbol): recorded with the element staged for them, so the record of what extraction
        // staged covers what came from its cards too (changeset_verify reads it).
        const recorded = new Set(stillStaged.map((st) => `${st.id} ${decisionKey(st.file, st.symbol)}`));
        for (const c of [...(storedBefore?.cards ?? []), ...(storedBefore?.earlierCards ?? [])]) {
          const key = decisionKey(c.file, c.symbol);
          const id = addedAt.get(key);
          if (!id || recorded.has(`${id} ${key}`)) continue;
          recorded.add(`${id} ${key}`);
          const element = before.getElement(id);
          stillStaged.push({ id, file: c.file, symbol: c.symbol, label: c.label, ...stagedAs(element?.name, element?.attributes) });
        }
        if (recordedNow.some((r) => r.how === "unstaged")) await writeDecisions(projectRoot, decisions);

        // With since: only code. DR's own folders are out already; leave out files that are not
        // source and that no element names (configs, docs, lockfiles).
        if (changes) {
          const drDirs = [path.join(projectRoot, "documentation-robotics"), path.join(projectRoot, ".dr")]
            .map((d) => path.relative(codebaseRoot, d).split(path.sep).join("/"))
            .filter((d) => d && !d.startsWith(".."));
          changes = scopeChanges(changes, (f) => !inDirs(f, drDirs) && ((SOURCE_EXT.test(f) && !VENDOR_EXCLUDE.test(f)) || referenced.has(f)));
        }

        const checkFiles = new Set<string>();
        for (const e of before.elements.values()) {
          if (e.status === "deleted" || (layers && !layers.includes(e.layer))) continue;
          for (const l of e.sourceReference?.locations ?? []) {
            const file = l.file?.replace(/\\/g, "/").replace(/^\.\//, "");
            if (file && l.symbol && (!changes || changes.changed.has(file))) checkFiles.add(file);
          }
        }

        let extraction: ExtractionGraph;
        try {
          extraction = await backend!.extract!(projectRoot, {
            codebaseRoot,
            ...(changes ? { files: changes.changed } : {}),
            checkFiles: [...checkFiles],
            deadline,
          });
        } catch (error) {
          if (error instanceof ExtractionTimeoutError) {
            throw new CLIError(`codebase_extract ran past its ${Math.round((deadline - startedAt) / 1000)} s budget ${error.stage}; nothing was staged`, ErrorCategory.USER, [NARROW]);
          }
          throw error;
        }

        const descriptionsFile = path.join(extractDir(projectRoot), DESCRIPTIONS_FILE);
        const extractedDescriptions = (await readJson<Record<string, string>>(descriptionsFile)) ?? {};
        const plan = planElements(extraction, before, {
          layers,
          changes,
          extractedDescriptions,
          notElements: notElementKeys,
          fileExists: (file) => existsSync(path.join(codebaseRoot, file)),
          fileText: (file) => {
            try {
              return readFileSync(path.join(codebaseRoot, file), "utf-8");
            } catch {
              return null;
            }
          },
        });

        const now = new Date().toISOString();
        const { valid, invalid } = await validateAdds(plan.adds, extraction.project, now, changes?.hunks);
        const adds = valid.map((v) => v.add);
        const undecided = sortUndecided(attributeChangedLines([...plan.undecided, ...invalid], changes?.hunks));
        const kept = new Set(adds);
        for (const add of plan.adds) {
          if (!kept.has(add)) {
            plan.elementOf.delete(add.symbol.qualifiedName);
            delete plan.descriptions[add.id];
          }
        }

        const elements = new Map<string, { layer: string; type: string }>();
        for (const e of before.elements.values()) if (e.status !== "deleted") elements.set(e.id, { layer: e.layer, type: e.type });
        for (const a of adds) elements.set(a.id, { layer: a.layer, type: a.type });
        const { relationships, alreadyPresent } = planRelationships(extraction, before, plan.elementOf, elements, hasTriple, layers);

        // Everything staged in one write: adds, updates (an update of an element this changeset
        // adds rewrites the add in place), relationships.
        const batch: Array<Omit<StagedChange, "sequenceNumber">> = [];
        const rewrites: Array<{ elementId: string; change: Omit<StagedChange, "sequenceNumber"> }> = [];
        for (const { add, element } of valid) {
          batch.push({ type: "add", elementId: add.id, layerName: add.layer, after: element.toJSON() as unknown as Record<string, unknown> });
        }
        const stagedUpdates: PlannedUpdate[] = [];
        for (const update of plan.updates) {
          const current = await currentSnapshot(model, before, changeset ?? emptyChangeset(), update.id, update.layer);
          if (!current) continue;
          const after = patched(current.snapshot, update, now);
          if (current.stagedAdd) {
            rewrites.push({
              elementId: current.stagedAdd.elementId,
              change: {
                type: "add",
                elementId: current.stagedAdd.elementId,
                layerName: current.stagedAdd.layerName,
                ...(current.stagedAdd.before !== undefined ? { before: current.stagedAdd.before } : {}),
                after,
              },
            });
          } else {
            batch.push({ type: "update", elementId: update.id, layerName: update.layer, before: current.snapshot, after });
          }
          stagedUpdates.push(update);
        }
        for (const r of relationships) batch.push(relationshipChange(r));

        const summary = {
          adds: adds.length,
          updates: stagedUpdates.length,
          relationships: relationships.length,
          cards: undecided.length,
          candidateDeletes: plan.candidateDeletes.length,
        };
        if (Date.now() > deadline) {
          throw new CLIError(
            `codebase_extract ran past its ${Math.round((deadline - startedAt) / 1000)} s budget before staging. It had planned ${summary.adds} adds, ` +
              `${summary.updates} updates and ${summary.relationships} relationships, with ${summary.cards} cards; nothing was staged`,
            ErrorCategory.USER,
            [NARROW]
          );
        }
        if (context?.signal?.aborted) {
          throw new CLIError("codebase_extract was cancelled before staging; nothing was staged", ErrorCategory.USER);
        }

        // The changeset active before: the one active now, or (on a later run, when the extraction
        // changeset is already active) the one the first run replaced, while it is still staged.
        const activeId = await manager.getActiveId();
        let previousActive: { id: string; name: string } | null = null;
        if (activeId && activeId !== changeset?.id) {
          const prev = await manager.load(activeId);
          previousActive = { id: activeId, name: prev?.name ?? activeId };
        } else if (storedBefore?.previousActive) {
          const prev = await manager.load(storedBefore.previousActive.id);
          if (prev?.status === "staged") previousActive = { id: prev.id!, name: prev.name };
        }
        // The record keeps the plan the first run replaced: that is the plan this as-built side
        // verifies, even when a later run happens while another changeset is active. The next
        // steps verify against it too; the result's previousActive still says what this run replaced.
        let recordedPrevious = previousActive;
        if (storedBefore?.previousActive && storedBefore.previousActive.id !== previousActive?.id) {
          const first = await manager.load(storedBefore.previousActive.id);
          if (first?.status === "staged") recordedPrevious = { id: first.id!, name: first.name };
        }

        // A run makes a changeset only to stage into it: a run that stages nothing leaves its cards
        // and candidate deletes for the agent without creating or activating an empty changeset
        // (which would then sit in project_status as the next thing to resume).
        const stages = batch.length > 0 || rewrites.length > 0;
        const hasWork = stages || undecided.length > 0 || plan.candidateDeletes.length > 0;
        let created = false;
        let active = !!changeset && activeId === changeset.id;
        if (changeset ? hasWork : stages) {
          if (!changeset) {
            changeset = await manager.create(
              name,
              `As-built extraction of the code at ${head.slice(0, 7)}${since ? `, files changed since ${since}` : ""}. Staged by codebase_extract.`
            );
            created = true;
          }
          try {
            await manager.stageMany(changeset.id!, batch, rewrites);
          } catch (error) {
            // A changeset this run made and couldn't fill is not left behind.
            if (created) await manager.delete(changeset.id!).catch(() => undefined);
            throw error;
          }
          // Activate last, once staging has succeeded.
          if (activeId !== changeset.id) await manager.setActive(changeset.id!);
          active = true;
          await reloadModel(args.rootPath);
          if (Object.keys(plan.descriptions).length) {
            await writeFile(descriptionsFile, JSON.stringify({ ...extractedDescriptions, ...plan.descriptions }), "utf-8");
          }
        }
        // Cards earlier runs returned that this one doesn't (the agent modelled them), so reject
        // can still name them.
        const nowCards = new Set(undecided.map((c) => c.cardId));
        const earlierCards = new Map<string, EarlierCard>();
        for (const c of [...(storedBefore?.earlierCards ?? []), ...(storedBefore?.cards ?? [])]) {
          // The whole card (candidates, name, proposed), so verify can check type and name against it.
          if (!nowCards.has(c.cardId)) earlierCards.set(c.cardId, c);
        }
        // Updates extraction staged: earlier runs' while their change is still staged, merged with
        // this run's, one entry per element with the union of its fields and the value extraction
        // wrote for each (this run's wins), so verify can tell a later hand edit from it.
        const updatedFields = new Map<string, Map<string, unknown>>();
        for (const u of storedBefore?.updated ?? []) {
          const status = before.getElement(u.id)?.status;
          if (status !== "updated" && status !== "added") continue;
          updatedFields.set(u.id, new Map(u.fields.map((f) => [f, u.values && Object.prototype.hasOwnProperty.call(u.values, f) ? u.values[f] : undefined])));
        }
        for (const u of stagedUpdates) {
          const fields = updatedFields.get(u.id) ?? updatedFields.set(u.id, new Map()).get(u.id)!;
          for (const [f, value] of Object.entries(u.fields)) fields.set(f, structuredClone(value));
        }
        const updatedRecord = [...updatedFields].map(([id, fields]) => {
          const names = [...fields.keys()].sort();
          const values = Object.fromEntries(names.filter((f) => fields.get(f) !== undefined).map((f) => [f, fields.get(f)]));
          return { id, fields: names, ...(Object.keys(values).length ? { values } : {}) };
        });
        const candidateDeleteIds = [...new Set([...(storedBefore?.candidateDeletes ?? []), ...plan.candidateDeletes.map((d) => d.id)])];
        const accumulated = {
          ...(updatedRecord.length ? { updated: updatedRecord } : {}),
          ...(candidateDeleteIds.length ? { candidateDeletes: candidateDeleteIds } : {}),
        };
        const pendingPath = path.join(extractDir(projectRoot), PENDING_FILE);
        if (changeset) {
          const staged = [...stillStaged];
          for (const a of adds) {
            staged.push({
              id: a.id,
              file: a.symbol.card.file_path,
              symbol: sourceSymbolOf(a.symbol, extraction.project),
              label: a.symbol.card.label,
              ...stagedAs(a.name, a.attributes),
            });
          }
          const record: StoredCards = {
            changesetId: changeset.id!,
            changesetName: changeset.name,
            gitHead: head,
            since: since ?? null,
            layers: layers ?? null,
            baseModified,
            previousActive: recordedPrevious,
            createdAt: now,
            cards: undecided,
            staged,
            ...(earlierCards.size ? { earlierCards: [...earlierCards.values()] } : {}),
            ...accumulated,
          };
          await writeFile(cardsPath(projectRoot, changeset.id!), JSON.stringify(record), "utf-8");
          // Waiting cards this changeset now holds.
          if (pending?.changesetName === changeset.name) await rm(pendingPath, { force: true });
        } else if (undecided.length || plan.candidateDeletes.length) {
          const record: StoredCards = {
            changesetId: "",
            changesetName: name,
            gitHead: head,
            since: since ?? null,
            layers: layers ?? null,
            baseModified,
            previousActive,
            createdAt: now,
            cards: undecided,
            staged: [],
            ...(earlierCards.size ? { earlierCards: [...earlierCards.values()] } : {}),
            ...accumulated,
            pending: true,
          };
          await writeFile(pendingPath, JSON.stringify(record), "utf-8");
        } else if (pending?.changesetName === name) {
          await rm(pendingPath, { force: true });
        }
        await pruneCardFiles(projectRoot, manager);

        const cards = page(undecided, 1, effectivePageSize);
        const changedCards = undecided.filter((c) => c.changedInRange).length;
        const changesetRef = changeset ? { id: changeset.id!, name: changeset.name } : null;
        const verifyMode = !!since && !!recordedPrevious;
        const message = !hasWork
          ? verifyMode && !changeset
            ? `Nothing to stage: nothing in the range is observable to extraction or differs from the model. No as-built changeset was created; ${previousActive ? `'${previousActive.name}' is still active.` : `the plan is '${recordedPrevious!.name}'.`}`
            : changeset
              ? `Nothing more to stage: '${changeset.name}' already says what this code says.`
              : "Nothing to stage: the model already says what this code says. No changeset was created or activated."
          : !changeset
            ? `Nothing to stage, so no changeset was created or activated. ${undecided.length} card(s)` +
              `${changedCards ? ` (${changedCards} changed in the range)` : ""} and ${plan.candidateDeletes.length} candidate delete(s) are left for you to decide; ` +
              `to stage any, first call changeset_create with name: "${name}".`
            : undefined;
        return jsonResult(
          fitCards(cards.items, cards, (items, fit) => ({
            changeset: changesetRef ? { ...changesetRef, created, active } : null,
            previousActive,
            ...(message ? { message } : {}),
            ...fitNotes(fit),
            ...(edited.length
              ? {
                  warning:
                    `${edited.length} source file(s) have uncommitted edits made after the index was taken, which this run may not have seen ` +
                    `(${edited.slice(0, 5).join(", ")}${edited.length > 5 ? ", ..." : ""}). Re-index with codebase_index, then call codebase_extract again.`,
                }
              : {}),
            ...(changes?.hunksError
              ? {
                  hunksWarning: `The range's changed lines couldn't be read (${changes.hunksError}), so no card says changedInRange; the cards are those of every changed file.`,
                }
              : {}),
            analyzer,
            // The shared judgement: `fresh-with-uncommitted-edits` when the warning above is given.
            index: describeIndex(freshness, indexJudgement),
            scope: {
              since: since ?? null,
              ...(changes ? { base: changes.base, changedFiles: changes.changed.size, deletedFiles: changes.deleted.size } : { files: "all" }),
              layers: layers ?? "all",
            },
            cards: { ...extraction.summary, needsAttributes: invalid.length },
            staged: {
              adds: adds.length,
              updates: stagedUpdates.length,
              relationships: relationships.length,
              byLayer: byLayer(adds, stagedUpdates, relationships),
              ...(stagedUpdates.length ? { updated: capped(stagedUpdates.map((u) => ({ id: u.id, fields: Object.keys(u.fields) })), fit.listLimit) } : {}),
            },
            unchanged: {
              elements: plan.unchanged,
              modelled: plan.modelled,
              relationships: alreadyPresent,
              rejected: plan.rejected,
              ...(plan.outsideLayers ? { outsideLayers: plan.outsideLayers } : {}),
            },
            candidateDeletes: {
              ...capped(plan.candidateDeletes, fit.listLimit),
              note: "Not staged: deleting is left to you. Each has its evidence.",
            },
            ...(plan.retyped.length ? { retyped: capped(plan.retyped, fit.listLimit) } : {}),
            ...notElementsResult(decisions, plan.skipped, recordedNow, cleared, fit.listLimit),
            undecided: undecidedSection(cards, items, fit, pageSize, changes ? { changedInRange: changedCards } : {}),
            tier1: "not wired: cards Tier 0 can't decide come to you (docs/EXTRACTION_STRATEGY.md, B6)",
            durationMs: Date.now() - startedAt,
            next: !hasWork
              ? verifyMode
                ? changesetRef
                  ? nextSteps(changesetRef, recordedPrevious, 0, plan, 0, since)
                  : verifyNothingSteps(recordedPrevious!, since!)
                : []
              : changesetRef
                ? nextSteps(changesetRef, recordedPrevious, cards.pages, plan, changedCards, since, fit.readOn)
                : pendingSteps(name, recordedPrevious, cards.pages, plan, changedCards, since, fit.readOn),
          })),
          { compact: true }
        );
      } finally {
        await lock.release().catch(() => undefined);
      }
    });
  };
}

export const codebaseExtractHandler = createCodebaseExtractHandler();

export const codebaseExtractTool: McpToolDefinition<typeof inputSchema> = {
  name: "codebase_extract",
  description:
    "Model the indexed code as an as-built changeset: Tier-0 rules decide what they can and those elements and " +
    "their relationships are staged; the rest come back as undecided cards (paged) for you to stage with model_add. " +
    "Stages only what differs from the model (matched by source file and symbol): new symbols are adds, changed ones " +
    "updates; elements whose code is gone are listed as candidateDeletes, not staged. since (a git ref) limits it to " +
    "files changed since then, for verifying a branch; cards whose lines the range changed say changedInRange and come first. " +
    "Code that is not an element goes in reject (with a reason): a card, or a symbol or element it staged, which is then " +
    "unstaged; kept until clearRejected, later runs leave them out. An element " +
    "it staged that you unstage from a changeset is also left out, but only while that changeset is staged: discarding or " +
    "landing it forgets that. A run or page into an extraction changeset keeps that run's since and layers. " +
    "The changeset (default extract-<sha>) is created and made active only when the run stages something; a run that only " +
    "leaves cards or candidate deletes creates nothing and says which changeset to create first. previousActive is the one " +
    "active before the first run. Needs a fresh index (codebase_index). Never writes the base model or commits.",
  inputSchema,
  handler: codebaseExtractHandler,
};
