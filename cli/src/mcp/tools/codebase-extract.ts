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
 * staged for it), and an element this tool staged that the agent then unstaged. An unstaged one
 * lasts while its changeset is staged and after it lands without the element; discarding the
 * changeset drops it. Later runs leave those symbols out, and say how many; `clearRejected` forgets
 * them. A `reject` can also name the files a run's cards are in (a path or glob), and records every
 * undecided card there.
 *
 * "Not a relationship" decisions sit beside them (`notRelationships`), by source, predicate and
 * target: a relationship the agent rejects, and one this tool staged that the agent unstaged. An
 * unstaged one lasts while its changeset is staged and after it lands (landing without it confirms
 * it was wrong); discarding the changeset drops it. Later runs don't stage them, so a rerun on
 * unchanged code after the decision makes no changeset. An unstaged one whose changeset landed is
 * dropped once an end is deleted from the model (or renamed); a rejected one is never dropped.
 *
 * A `since` run that reaches far back (many commits, or many cards) says so and offers narrower
 * ranges with an estimate of their cards; `preview: true` gives those counts without staging or
 * recording anything, before a long run. When most undecided cards sit in a few folders no model
 * element names, `next` suggests listing them in `.cbmignore`.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";
import { z } from "zod";
import { strictItem } from "../strict-schema.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { codeChangesSince, inDirs, scopeChanges, type CodeChangesResult } from "../../analyzers/code-changes.js";
import { INFRA_FILE, SOURCE_EXT, VENDOR_EXCLUDE } from "../../analyzers/cards/build.js";
import { rangeSize as gitRangeSize, type RangeSize } from "../../analyzers/range-size.js";
import { ExtractionTimeoutError, type ExtractionGraph } from "../../analyzers/cards/extract.js";
import type { DocEvidence } from "../../analyzers/cards/docs.js";
import type { AnalyzerBackend } from "../../analyzers/base-analyzer.js";
import type { DetectedChanges, ImpactedSymbol } from "../../analyzers/types.js";
import type { ClusterReport } from "../../analyzers/cards/clusters.js";
import {
  attributeChangedLines,
  decisionKey,
  impactedElements,
  type ImpactHint,
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
import { splitByAcceptedGaps } from "../../core/accepted-gaps-verify.js";
import { normalizeNodeType } from "../../generated/node-types.js";
import { stagedRelationshipTriple } from "../../core/relationship-staging.js";
import { Element } from "../../core/element.js";
import { Layer } from "../../core/layer.js";
import { Model } from "../../core/model.js";
import { setStagedSourceReference, stagedSourceReference } from "../../core/staged-source-reference.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { getAllLayerIds, isValidLayer } from "../../generated/layer-registry.js";
import { getValidRelationships } from "../../generated/relationship-index.js";
import type { SourceReference } from "../../types/source-reference.js";
import { generateUUID } from "../../utils/id-generator.js";
import { CLIError, ErrorCategory, formatValidOptions, getErrorMessage } from "../../utils/errors.js";
import { FileLock } from "../../utils/file-lock.js";
import { SchemaValidator } from "../../validators/schema-validator.js";
import { compactJson, jsonResult, loadModel, reloadModel, rootPathSchema, runTool, type McpToolContext, type McpToolDefinition } from "./shared.js";
import { changesetUnstageHandler } from "./changeset-editing.js";
import {
  crossModelTargets,
  crossRepoRunWarnings,
  declaredTargets,
  hasReference,
  loadCrossRepoConfig,
  planCrossModelReferences,
  undeclaredTargetsWarning,
  type CrossModelPlan,
  type PlannedReference,
} from "../../analyzers/cross-model.js";
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
      strictItem("A reject[] item", {
        card: z
          .string()
          .min(1)
          .optional()
          .describe("The card's cardId, its symbol (or file#symbol), or the id of an element this extraction staged."),
        files: z
          .string()
          .min(1)
          .optional()
          .describe(
            "A file, a folder or a glob relative to the codebase root (docs/**, scripts/, src/test-pages/**/*.tsx): every undecided card of the last run in matching files."
          ),
        relationship: strictItem("A reject[] item's relationship", {
          source: z.string().min(1).describe("The source element id."),
          predicate: z.string().min(1).describe("The predicate, e.g. depends-on."),
          target: z.string().min(1).describe("The target element id."),
        })
          .optional()
          .describe("A relationship extraction staged (or would stage) that the code doesn't have."),
        reason: z.string().min(1).describe("Why it is not a model element (or relationship), in a few words."),
      })
    )
    .optional()
    .describe(
      "What is not in the model, each item with one of card, files or relationship, and a reason. card: a card of this " +
        "extraction (cardId, or a symbol only one card has), a symbol it staged (Tier 0 decided it), or the id of an element " +
        "staged from it. files: every undecided card in matching files (a path or glob from the codebase root; * stays in one folder, so use **/*.md for any depth), " +
        "instead of one call per card. " +
        "relationship: {source, predicate, target} of a wrong relationship. Recorded for the project until cleared, so " +
        "later runs leave them out; what is still staged for them in the changeset is unstaged (an element with its relationships). " +
        "A call with only reject or clearRejected records and runs nothing."
    ),
  clearRejected: z
    .union([z.literal(true), z.array(z.string().min(1))])
    .optional()
    .describe(
      "Forget not-an-element and not-a-relationship decisions: true for all, or a list of symbols (or file#symbol) as notElements " +
        "lists them, and relationships as source::predicate::target."
    ),
  preview: z
    .literal(true)
    .optional()
    .describe(
      "Count what a run with these arguments would stage and how many cards it would leave, with the range's commits and narrower " +
        "since refs, without staging or recording anything. Use it before a since run that may reach far back."
    ),
  clusters: z
    .boolean()
    .optional()
    .describe(
      "Also ask codebase-memory-mcp for its architecture clusters (get_architecture): each card in a cluster that spans several " +
        "files says so (cluster), and the largest clusters come back as clusters.proposals to name or dismiss. Evidence only; it " +
        "decides nothing and can add up to 30 s while the analyzer computes it (never past the run's budget). A preview doesn't ask. Default: off."
    ),
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
  /**
   * The relationships extraction staged into this changeset (`source::predicate::target`), while
   * they are staged. One that goes while both its ends stay was unstaged: a not-a-relationship
   * decision ({@link NotRelationshipDecision}).
   */
  stagedRelationships?: string[];
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
   * The changeset it came from. An `unstaged` decision lasts while that changeset is staged or
   * landed (landing it without the element confirms the unstage); discarding it drops the
   * decision. A `rejected` one lasts until cleared. Keyed by file and symbol, not element id, so a
   * renamed element doesn't orphan it.
   */
  changesetId?: string;
  at: string;
}

/** A relationship that is not in the code, by {@link relationshipKey}. */
interface NotRelationshipDecision {
  source: string;
  predicate: string;
  target: string;
  reason: string;
  /** `rejected`: the agent passed it in `reject`. `unstaged`: extraction staged it and it was unstaged. */
  how: "rejected" | "unstaged";
  changeset: string;
  /**
   * The changeset it came from. An `unstaged` decision lasts while that changeset is staged or
   * landed (landing it without the relationship confirms the unstage); discarding it drops the
   * decision. A `rejected` one lasts until cleared.
   */
  changesetId?: string;
  at: string;
}

interface DecisionsFile {
  version: 1;
  notElements: Record<string, NotElementDecision>;
  /** Absent in files written before relationships could be decided. */
  notRelationships?: Record<string, NotRelationshipDecision>;
}

/** A relationship's key, as extraction stages it (the staged change's elementId). */
function relationshipKey(r: { source: string; predicate: string; target: string }): string {
  return `${r.source}::${r.predicate}::${r.target}`;
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

/** The clusters report, its proposals shortened with the other lists and its communities left out when they are. */
function clustersSection(report: ClusterReport, listLimit?: number): ClusterReport {
  if (listLimit === undefined || !report.proposals) return report;
  const { communities, ...rest } = report;
  return {
    ...rest,
    proposals: { ...report.proposals, items: report.proposals.items.slice(0, listLimit) },
    ...(communities && listLimit >= 20 ? { communities } : {}),
  };
}

/** How much of each card a page shows: all of it, shortened, or only what deciding needs. */
type CardDetail = "full" | "shortened" | "compact";

/** Kinds whose reason is the same sentence on every card of the kind. */
const GENERIC_REASON: ReadonlySet<UndecidedKind> = new Set(["no-rule", "narrowed"]);

function clip(text: string | undefined, max: number): string | undefined {
  if (!text) return text;
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** A card's documentation evidence at a detail level: excerpts shortened, or only the record's title. */
function docEvidenceAt(card: UndecidedCard, detail: Exclude<CardDetail, "full">): Pick<UndecidedCard, "docs" | "decision"> {
  const { docs, decision } = card;
  if (detail === "compact") return decision ? { decision: { id: decision.id, title: decision.title, status: decision.status } } : {};
  return {
    ...(docs ? { docs: docs.map((d) => (d.excerpt ? { ...d, excerpt: clip(d.excerpt, 100) } : d)) } : {}),
    ...(decision
      ? {
          decision: {
            id: decision.id,
            title: decision.title,
            status: decision.status,
            ...(decision.decision ? { decision: clip(decision.decision, 160) } : {}),
            ...(decision.supersedes ? { supersedes: decision.supersedes } : {}),
            ...(decision.mentions ? { mentions: decision.mentions } : {}),
          },
        }
      : {}),
  };
}

function cardAt<T extends UndecidedCard>(card: T, detail: CardDetail): Partial<T> {
  if (detail === "full") return card;
  const { reason, docstring, signature, decorators, candidates, qualifiedName, docs: _docs, decision: _decision, ...rest } = card;
  const open = candidates.length ? { candidates } : {};
  const evidence = docEvidenceAt(card, detail);
  if (detail === "shortened") {
    return {
      ...rest,
      ...evidence,
      qualifiedName,
      ...open,
      ...(signature ? { signature: clip(signature, 80) } : {}),
      ...(docstring ? { docstring: clip(docstring, 120) } : {}),
      ...(decorators ? { decorators } : {}),
      ...(GENERIC_REASON.has(card.kind) ? {} : { reason }),
    } as Partial<T>;
  }
  return { ...rest, ...open, ...evidence, ...(card.kind === "ambiguous" || card.kind === "needs-attributes" ? { reason: clip(reason, 200) } : {}) } as Partial<T>;
}

const PAGE_NOTES: Record<Exclude<CardDetail, "full">, string> = {
  shortened:
    "Docstrings, signatures, doc excerpts and decisions are shortened, and empty candidates and reasons that only name the card's kind left out, to keep this response small.",
  compact:
    "Docstrings, signatures, decorators, qualified names, doc sections, empty candidates and most reasons are left out (a decision record keeps its id, title and status), to keep this response small.",
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
async function validateAdds(
  adds: PlannedElement[],
  project: string,
  now: string,
  hunks?: CodeChangesResult["hunks"],
  seeds?: Pick<CodeChangesResult, "seeds" | "lineRuleFiles">
) {
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
      if (errs?.length) invalid.push(needsAttributesCard(item.add, project, errs, hunks, seeds));
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

/**
 * Stage cross-model references (src/analyzers/cross-model.ts) on the elements that hold them:
 * into this run's add or update of the element when it has one, else as an update of the element
 * as the changeset has it. A reference the element already has is left alone; a verified one
 * replaces the unverified guess an earlier run staged for the same call.
 *
 * Returns, besides what it staged, the elements it changed that are not this run's adds, so the
 * extraction record lists them as updates extraction made (verify then doesn't take them for the
 * agent's).
 */
async function stageReferences(
  refs: PlannedReference[],
  batch: Array<Omit<StagedChange, "sequenceNumber">>,
  rewrites: Array<{ elementId: string; change: Omit<StagedChange, "sequenceNumber"> }>,
  model: Model,
  graph: ChangesetGraph,
  changeset: Changeset,
  elements: Map<string, { layer: string; type: string }>,
  now: string
): Promise<{ staged: PlannedReference[]; alreadyPresent: number; updated: string[] }> {
  const staged: PlannedReference[] = [];
  const updated: string[] = [];
  let alreadyPresent = 0;
  const bySource = new Map<string, PlannedReference[]>();
  for (const r of refs) (bySource.get(r.source) ?? bySource.set(r.source, []).get(r.source)!).push(r);
  for (const [id, list] of bySource) {
    const layer = elements.get(id)?.layer ?? list[0].sourceLayer;
    const inBatch = batch.find((c) => (c.type === "add" || c.type === "update") && c.elementId === id && c.after);
    let after = inBatch?.after ?? rewrites.find((r) => graph.resolve(r.elementId) === id)?.change.after;
    let stage: (() => void) | undefined;
    if (!after) {
      const current = await currentSnapshot(model, graph, changeset, id, layer);
      if (!current) continue;
      const next = structuredClone(current.snapshot);
      after = next;
      const stagedAdd = current.stagedAdd;
      stage = stagedAdd
        ? () =>
            rewrites.push({
              elementId: stagedAdd.elementId,
              change: {
                type: "add",
                elementId: stagedAdd.elementId,
                layerName: stagedAdd.layerName,
                ...(stagedAdd.before !== undefined ? { before: stagedAdd.before } : {}),
                after: next,
              },
            })
        : () => batch.push({ type: "update", elementId: id, layerName: layer, before: current.snapshot, after: next });
    }
    const references = Array.isArray(after.references) ? [...(after.references as unknown[])] : [];
    let added = 0;
    for (const r of list) {
      if (r.verified) {
        // An earlier run's unverified guess for this call (its description starts with the same evidence).
        const guess = `${r.evidence}. Unverified`;
        const kept = references.filter((x) => !(x && typeof x === "object" && String((x as { description?: unknown }).description ?? "").startsWith(guess)));
        if (kept.length !== references.length) {
          references.splice(0, references.length, ...kept);
          added++;
        }
      }
      if (hasReference(references, r.target, r.type)) {
        alreadyPresent++;
        continue;
      }
      references.push({ source: id, target: r.target, type: r.type, description: r.description });
      staged.push(r);
      added++;
    }
    if (!added) continue;
    after.references = references;
    const metadata = after.metadata as Record<string, unknown> | undefined;
    if (metadata) after.metadata = { ...metadata, updated_at: now };
    stage?.();
    if (inBatch?.type !== "add") updated.push(id);
  }
  return { staged, alreadyPresent, updated };
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

/** Staged adds with no description whose doc evidence the response lists, at most. */
const DESCRIBE_LISTED = 10;

const DOCUMENTATION_NOTE =
  "decision-record cards are architecture decision records: propose a motivation principle, constraint or assessment from each (its decision says what), " +
  "sourced to the record (sourceFile = file, sourceSymbol = symbol), or reject it. Retired records (superseded, deprecated, rejected) get no card. " +
  "A card's docs are doc sections that mention its code: use them for the description you write, and as evidence for upper-layer elements (features, requirements). " +
  "describe lists staged elements with no description whose code the docs mention: model_update their description from the excerpt when it says what the element is.";

/** A staged add with no description, and the doc sections that mention its code. */
interface DescribeItem {
  id: string;
  docs: DocEvidence[];
}

/**
 * The documentation section of a response: decision records (cards, modelled, retired), staged adds
 * a doc describes, and why the evidence couldn't be read, when it couldn't. Absent when there is none.
 */
function documentationResult(plan: ElementPlan, describe: DescribeItem[], error: string | undefined, listLimit?: number): Record<string, unknown> {
  const decisions = plan.decisions;
  if (!decisions && !describe.length && !error) return {};
  const describeLimit = Math.min(DESCRIBE_LISTED, listLimit ?? DESCRIBE_LISTED);
  const shown = describe.slice(0, describeLimit).map((d) => ({ id: d.id, docs: d.docs.slice(0, 1).map((e) => (e.excerpt ? { ...e, excerpt: clip(e.excerpt, 160) } : e)) }));
  return {
    documentation: {
      ...(decisions
        ? { decisionRecords: { cards: decisions.cards, modelled: decisions.modelled, ...(decisions.retired.length ? { retired: capped(decisions.retired, listLimit) } : {}) } }
        : {}),
      ...(describe.length ? { describe: { total: describe.length, items: shown, ...(shown.length < describe.length ? { truncated: true } : {}) } } : {}),
      ...(error ? { error: `Decision records and doc sections couldn't be read, so no card carries them: ${error}` } : {}),
      ...(decisions?.cards || describe.length ? { note: DOCUMENTATION_NOTE } : {}),
    },
  };
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
 * How a `since` run knew which symbols changed: the analyzer's `detect_changes` (its seeds mark
 * the cards, its impacted callers become review hints), or git's changed lines mapped to the cards,
 * with why.
 */
interface ChangeDetection {
  method: "detect_changes" | "git-hunks";
  /** Why the changed lines were mapped instead. */
  fallback?: string;
  /** Changed symbols by full qualified name (detect_changes only). */
  seeds?: Set<string>;
  /** Files the analyzer seeded whole though git places their changed lines: their cards keep the line rule. */
  lineRuleFiles?: Set<string>;
  impacted: ImpactedSymbol[];
}

/**
 * Ask the analyzer which symbols the range changed. Its answer is used only when it can be
 * trusted for this range: the analyzer has the tool and answers, the index has seen every edit
 * (an edit after the index moves lines the index doesn't know), it diffed from the same merge
 * base, and it saw every changed file git did. Otherwise the hunk mapping is used, and says why.
 * This is not a freshness check: requireFreshIndex has passed already.
 */
async function detectChangedSymbols(
  backend: AnalyzerBackend,
  projectRoot: string,
  codebaseRoot: string,
  since: string,
  changes: CodeChangesResult,
  editedSinceIndex: readonly string[]
): Promise<ChangeDetection> {
  const hunks = (fallback: string): ChangeDetection => ({ method: "git-hunks", fallback, impacted: [] });
  if (!backend.detectChanges) return hunks("the analyzer has no detect_changes");
  if (editedSinceIndex.length) {
    return hunks(`${editedSinceIndex.length} source file(s) have uncommitted edits the index hasn't seen, so its symbols' lines there are out of date`);
  }
  let detected: DetectedChanges;
  try {
    detected = await backend.detectChanges(projectRoot, { codebaseRoot, since });
  } catch (error) {
    return hunks(`detect_changes failed: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`);
  }
  if (detected.mergeBase !== changes.base) {
    return hunks(`detect_changes diffed from ${detected.mergeBase.slice(0, 7)}, not the range's merge base ${changes.base.slice(0, 7)}`);
  }
  const seen = new Set(detected.changedFiles);
  const missed = [...changes.changed].filter((f) => !seen.has(f)).sort();
  if (missed.length) {
    return hunks(
      `detect_changes didn't see ${missed.length} changed file(s) (${missed.slice(0, 3).join(", ")}${missed.length > 3 ? ", ..." : ""}), so the index may predate them`
    );
  }
  // CBM 0.12.1 seeds every symbol of a file it can't place a hunk in (`whole_file`; a pure
  // insertion does it). Those seeds are trusted only for a file git says changed whole (new in the
  // range); every other such file's cards keep the line rule, including one git's diff gives no
  // lines for. When git's diff failed outright (hunksError) there are no lines to apply: the
  // whole-file seeds are the only signal left, so they stand.
  const lineRuleFiles = changes.hunksError
    ? new Set<string>()
    : new Set(detected.seeds.filter((s) => s.reason === "whole_file" && s.file && changes.hunks?.get(s.file) !== "all").map((s) => s.file));
  return {
    method: "detect_changes",
    seeds: new Set(detected.seeds.map((s) => s.qualifiedName)),
    ...(lineRuleFiles.size ? { lineRuleFiles } : {}),
    impacted: detected.impacted,
  };
}

function describeDetection(d: ChangeDetection): Record<string, unknown> {
  return d.method === "detect_changes"
    ? {
        method: d.method,
        seeds: d.seeds?.size ?? 0,
        impactedCallers: d.impacted.length,
        ...(d.lineRuleFiles?.size ? { lineRuleFiles: d.lineRuleFiles.size } : {}),
      }
    : { method: d.method, fallback: d.fallback };
}

const IMPACT_NOTE =
  "Not staged: existing elements whose code calls code this range changed (detect_changes; via is the changed symbol, " +
  "or the nearer caller, it reaches it through). Their own code didn't change; review whether each still says what its code does.";

/** The next step for impact hints: review, not stage. */
function impactStep(hints: ImpactHint[]): string[] {
  if (!hints.length) return [];
  const shown = hints.slice(0, 5).map((h) => h.id).join(", ");
  return [
    `${hints.length} existing element(s) call code this range changed (impacted: ${shown}${hints.length > 5 ? ", ..." : ""}). ` +
      "Review whether their descriptions and relationships still hold; nothing was staged for them, and model_update is only for one that is now wrong.",
  ];
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

/**
 * Before waiting cards (pending.json) are removed as stale or replaced by another run's: when the
 * agent has created their changeset, it gets a record of its own, without the cards (they were
 * read at another commit, or belong to the run that replaced them). The record is what keeps the
 * changeset extraction's: landing it is an as-built landing, which stamps the manifest's
 * `reconciled` block (core/reconciliation.ts), and changeset_verify and changeset_commit tell it
 * from a plan by it.
 */
async function keepPendingAsRecord(projectRoot: string, manager: StagingAreaManager, waiting: StoredCards): Promise<void> {
  if (!waiting.changesetName) return;
  const named = await manager.load(waiting.changesetName);
  if (named?.status !== "staged" || !named.id || existsSync(cardsPath(projectRoot, named.id))) return;
  const record: StoredCards = {
    changesetId: named.id,
    changesetName: named.name,
    gitHead: waiting.gitHead,
    since: waiting.since ?? null,
    layers: waiting.layers ?? null,
    baseModified: waiting.baseModified,
    previousActive: waiting.previousActive,
    createdAt: waiting.createdAt,
    cards: [],
    staged: [],
  };
  await writeFile(cardsPath(projectRoot, named.id), JSON.stringify(record), "utf-8");
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

/** The decisions as read: both kinds present. */
type Decisions = DecisionsFile & { notRelationships: Record<string, NotRelationshipDecision> };

async function readDecisions(projectRoot: string): Promise<Decisions> {
  const stored = await readJson<DecisionsFile>(path.join(extractDir(projectRoot), DECISIONS_FILE));
  return {
    version: 1,
    notElements: stored?.notElements && typeof stored.notElements === "object" ? stored.notElements : {},
    notRelationships: stored?.notRelationships && typeof stored.notRelationships === "object" ? stored.notRelationships : {},
  };
}

async function writeDecisions(projectRoot: string, decisions: DecisionsFile): Promise<void> {
  await mkdir(extractDir(projectRoot), { recursive: true });
  const { notRelationships, ...rest } = decisions;
  const out: DecisionsFile = { ...rest, ...(notRelationships && Object.keys(notRelationships).length ? { notRelationships } : {}) };
  await writeFile(path.join(extractDir(projectRoot), DECISIONS_FILE), JSON.stringify(out, null, 2), "utf-8");
}

/**
 * Drops `unstaged` relationship decisions whose end is known to be gone: their changeset landed (so
 * both ends were in the base model then, as recording requires them live), and an end is now in
 * neither the base model, read fresh from disk (the cached model can predate a landing made outside
 * this process), nor any staged changeset's adds (one may stage it again). A `rejected` decision is
 * never dropped: it lasts until clearRejected. Nor is one whose changeset is still staged (an end
 * unstaged and staged again keeps it) or a cross-model end (`@model/…`). A base that can't be read
 * fresh skips pruning. Returns how many went.
 */
async function pruneOrphanedRelationshipDecisions(
  decisions: Decisions,
  rootPath: string,
  changesets: Changeset[],
  landedIds: Set<string | undefined>
): Promise<number> {
  const candidates = Object.entries(decisions.notRelationships).filter(
    ([, d]) => d.how === "unstaged" && !!d.changesetId && landedIds.has(d.changesetId)
  );
  if (!candidates.length) return 0;
  const known = new Set<string>();
  let base: ChangesetGraph;
  try {
    base = await ChangesetGraph.build(await Model.load(rootPath, { lazyLoad: false }), emptyChangeset());
  } catch (error) {
    // Pruning is housekeeping: a model that can't be read fresh leaves the decisions for a later run.
    console.error(`[mcp] codebase_extract skipped pruning orphaned decisions: ${getErrorMessage(error)}`);
    return 0;
  }
  for (const e of base.elements.values()) {
    known.add(e.id);
    if (e.uuid) known.add(e.uuid);
  }
  for (const c of changesets) {
    if (c.status !== "staged") continue;
    for (const change of c.changes ?? []) {
      if (change.type !== "add" && change.type !== "update") continue;
      known.add(change.elementId);
      for (const field of ["path", "id"] as const) {
        const value = change.after?.[field];
        if (typeof value === "string" && value) known.add(value);
      }
    }
  }
  const gone = (id: string) => !id.startsWith("@") && !known.has(id);
  let dropped = 0;
  for (const [key, d] of candidates) {
    if (gone(d.source) || gone(d.target)) {
      delete decisions.notRelationships[key];
      dropped++;
    }
  }
  return dropped;
}

/**
 * Relationships extraction staged into a changeset (its record's `stagedRelationships`) that the
 * changeset no longer stages: unstaged, or (when an end is gone with them) dropped with an element.
 * Returns the ones still staged and those unstaged while both ends are elements: a not-a-relationship
 * decision each. `live` says whether an element id is in the model as the changeset leaves it.
 */
function unstagedRelationships(
  record: StoredCards | null,
  changeset: Changeset | null,
  live: (id: string) => boolean
): { still: string[]; unstaged: Array<{ source: string; predicate: string; target: string; key: string }> } {
  const still: string[] = [];
  const unstaged: Array<{ source: string; predicate: string; target: string; key: string }> = [];
  if (!record?.stagedRelationships?.length || !changeset) return { still, unstaged };
  const staged = stagedRelationshipAdds(changeset);
  for (const key of record.stagedRelationships) {
    if (staged.has(key)) {
      still.push(key);
      continue;
    }
    const [source, predicate, target] = key.split("::");
    if (source && predicate && target && live(source) && live(target)) unstaged.push({ source, predicate, target, key });
  }
  return { still, unstaged };
}

/**
 * Elements extraction staged into a changeset (its record's `staged`) that the changeset no longer
 * adds, while neither the element nor any element naming its symbol is in the model as the
 * changeset leaves it: unstaged. `liveKey` says whether an element names a {@link decisionKey}.
 */
function unstagedElements(
  record: StoredCards | null,
  changeset: Changeset | null,
  live: (id: string) => boolean,
  liveKey: (key: string) => boolean
): StagedBySymbol[] {
  if (!record?.staged?.length || !changeset) return [];
  const added = new Set<string>();
  for (const c of changeset.changes ?? []) {
    if (c.type !== "add") continue;
    added.add(c.elementId);
    const p = c.after?.path;
    if (typeof p === "string" && p) added.add(p);
  }
  return record.staged.filter((st) => !added.has(st.id) && !live(st.id) && !liveKey(decisionKey(st.file, st.symbol)));
}

/**
 * Records, as `unstaged` decisions, the elements and relationships extraction staged into a
 * changeset that landed without them (an unstage with no run between it and the landing). Runs
 * before the landed changeset's record is pruned; the record loses its `staged` and
 * `stagedRelationships` once read, so a decision cleared later isn't recorded again. Returns what
 * it recorded.
 */
async function recordLandedUnstages(
  projectRoot: string,
  manager: StagingAreaManager,
  decisions: Decisions,
  live: (id: string) => boolean,
  liveKey: (key: string) => boolean
): Promise<{
  elements: Array<{ symbol: string; file: string | null; how: "unstaged" }>;
  relationships: Array<{ source: string; predicate: string; target: string; how: "unstaged" }>;
}> {
  const recorded: Array<{ source: string; predicate: string; target: string; how: "unstaged" }> = [];
  const recordedElements: Array<{ symbol: string; file: string | null; how: "unstaged" }> = [];
  const result = { elements: recordedElements, relationships: recorded };
  let entries: string[];
  try {
    entries = await readdir(extractDir(projectRoot));
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json") || KEEP_FILES.has(entry)) continue;
    const file = path.join(extractDir(projectRoot), entry);
    const record = await readJson<StoredCards>(file);
    if (!record || !record.changesetId || record.pending) continue;
    if (!record.stagedRelationships?.length && !record.staged?.length) continue;
    const landed = await manager.load(record.changesetId);
    if (landed?.status !== "committed") continue;
    for (const st of unstagedElements(record, landed, live, liveKey)) {
      const key = decisionKey(st.file, st.symbol);
      if (decisions.notElements[key]) continue;
      decisions.notElements[key] = {
        file: st.file,
        symbol: st.symbol,
        ...(st.label ? { label: st.label } : {}),
        reason: `${st.id} was staged by codebase_extract, unstaged, and '${landed.name}' landed without it`,
        how: "unstaged",
        changeset: landed.name,
        changesetId: landed.id!,
        at: new Date().toISOString(),
      };
      recordedElements.push({ symbol: st.symbol, file: st.file, how: "unstaged" });
    }
    for (const r of unstagedRelationships(record, landed, live).unstaged) {
      if (decisions.notRelationships[r.key]) continue;
      decisions.notRelationships[r.key] = {
        source: r.source,
        predicate: r.predicate,
        target: r.target,
        reason: `staged by codebase_extract, unstaged, and '${landed.name}' landed without it`,
        how: "unstaged",
        changeset: landed.name,
        changesetId: landed.id!,
        at: new Date().toISOString(),
      };
      recorded.push({ source: r.source, predicate: r.predicate, target: r.target, how: "unstaged" });
    }
    const { stagedRelationships: _read, staged: _readElements, ...rest } = record;
    await writeFile(file, JSON.stringify(rest), "utf-8");
  }
  return result;
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

/**
 * Drop decisions: all, or the element decisions whose key, symbol or file#symbol is listed and the
 * relationship decisions whose source::predicate::target is. Returns how many of each.
 */
function clearDecisions(decisions: Decisions, which: true | string[]): { elements: number; relationships: number } {
  let elements = 0;
  for (const [key, d] of Object.entries(decisions.notElements)) {
    if (which === true || which.some((w) => w === key || w === d.symbol || w === `${d.file ?? ""}#${d.symbol}`)) {
      delete decisions.notElements[key];
      elements++;
    }
  }
  let relationships = 0;
  for (const key of Object.keys(decisions.notRelationships)) {
    if (which === true || which.includes(key)) {
      delete decisions.notRelationships[key];
      relationships++;
    }
  }
  return { elements, relationships };
}

type RejectItem = NonNullable<CodebaseExtractArgs["reject"]>[number];
type RelationshipRef = { source: string; predicate: string; target: string };

/** A reject's items by what they name, each naming exactly one of card, files and relationship. */
function splitRejects(items: RejectItem[]) {
  const cards: Array<{ card: string; reason: string }> = [];
  const files: Array<{ files: string; reason: string }> = [];
  const relationships: Array<{ relationship: RelationshipRef; reason: string }> = [];
  const bad: string[] = [];
  items.forEach((item, i) => {
    const named = (["card", "files", "relationship"] as const).filter((k) => item[k] !== undefined);
    if (named.length !== 1) bad.push(`item ${i + 1} names ${named.length ? named.join(" and ") : "none of them"}`);
    else if (item.card !== undefined) cards.push({ card: item.card, reason: item.reason });
    else if (item.files !== undefined) files.push({ files: item.files, reason: item.reason });
    else relationships.push({ relationship: item.relationship!, reason: item.reason });
  });
  if (bad.length) {
    throw new CLIError(`Each reject[] item names one of card, files or relationship: ${bad.join("; ")}. Nothing was recorded`, ErrorCategory.USER, [
      'Split it: {card, reason}, {files: "docs/**", reason} or {relationship: {source, predicate, target}, reason}',
    ]);
  }
  return { cards, files, relationships };
}

/** Whether a codebase-relative file is in a reject's `files`: the file, a folder it is in, or a glob it (or its folder) matches. */
function filesMatcher(pattern: string): (file: string) => boolean {
  const p = pattern.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (/[*?[\]{}]/.test(p)) {
    const folder = `${p.replace(/\/+$/, "")}/**`;
    return (file) => minimatch(file, p, { dot: true }) || minimatch(file, folder, { dot: true });
  }
  const dir = p.replace(/\/+$/, "");
  return (file) => file === dir || file.startsWith(`${dir}/`);
}

/**
 * The cards a `files` reject names: every undecided card of the last run in matching files, as
 * card refs (the first reason wins for a card two patterns match). A pattern that matches no card
 * is refused, so a mistyped path records nothing.
 */
function cardsInFiles(stored: StoredCards | null, refs: Array<{ files: string; reason: string }>, changesetName: string): Array<{ card: string; reason: string }> {
  if (!refs.length) return [];
  const cards = stored?.cards ?? [];
  const out = new Map<string, string>();
  const none: string[] = [];
  for (const ref of refs) {
    const match = filesMatcher(ref.files);
    const hits = cards.filter((c) => {
      const file = normFile(c.file);
      return !!file && match(file);
    });
    if (!hits.length) none.push(`'${ref.files}'`);
    for (const c of hits) if (!out.has(c.cardId)) out.set(c.cardId, ref.reason);
  }
  if (none.length) {
    throw new CLIError(`Can't reject: no undecided card of '${changesetName}' is in ${none.join(", ")}. Nothing was recorded`, ErrorCategory.USER, [
      "Pass a file, folder or glob relative to the codebase root, as the cards' file gives it (docs/**, scripts/)",
    ]);
  }
  return [...out].map(([card, reason]) => ({ card, reason }));
}

/** A relationship with both ends as the graph names them (a UUID becomes its dotted id). */
function resolvedTriple(r: RelationshipRef, graph?: ChangesetGraph | null): RelationshipRef {
  return graph ? { source: graph.resolve(r.source), predicate: r.predicate, target: graph.resolve(r.target) } : r;
}

/** The relationship adds a changeset stages, by {@link relationshipKey}, ends resolved through `graph` when given. */
function stagedRelationshipAdds(changeset: Changeset | null, graph?: ChangesetGraph | null): Set<string> {
  const keys = new Set<string>();
  for (const c of (changeset?.changes ?? []) as StagedChange[]) {
    if (c.type !== "relationship-add") continue;
    const triple = stagedRelationshipTriple(c);
    if (triple) keys.add(relationshipKey(resolvedTriple(triple, graph)));
  }
  return keys;
}

/**
 * The relationships a reject names, each one extraction staged into this changeset (staged now or
 * unstaged since), one the changeset or the base model has, or one a decision already names; a
 * CLIError naming the others, so a mistyped one records nothing. Ends are resolved through the
 * graph (a UUID becomes its dotted id), so the decision is keyed as runs and unstaging key it.
 */
function relationshipsToReject(
  refs: Array<{ relationship: RelationshipRef; reason: string }>,
  stored: StoredCards | null,
  changeset: Changeset | null,
  graph: ChangesetGraph,
  decisions: Decisions,
  changesetName: string
): Array<RelationshipRef & { key: string; reason: string }> {
  const known = new Set([
    ...(stored?.stagedRelationships ?? []).map((k) => {
      const [source, predicate, target] = k.split("::");
      return source && predicate && target ? relationshipKey(resolvedTriple({ source, predicate, target }, graph)) : k;
    }),
    ...stagedRelationshipAdds(changeset, graph),
  ]);
  for (const t of changeset?.unstaged ?? []) {
    if (t.change.type !== "relationship-add") continue;
    const triple = stagedRelationshipTriple(t.change as StagedChange);
    if (triple) known.add(relationshipKey(resolvedTriple(triple, graph)));
  }
  const out: Array<RelationshipRef & { key: string; reason: string }> = [];
  const unknown: string[] = [];
  for (const { relationship: given, reason } of refs) {
    const r = resolvedTriple(given, graph);
    const key = relationshipKey(r);
    if (known.has(key) || graph.getRelationship(r.source, r.predicate, r.target) || decisions.notRelationships[key]) {
      out.push({ source: r.source, predicate: r.predicate, target: r.target, key, reason });
    } else unknown.push(key);
  }
  if (unknown.length) {
    throw new CLIError(
      `Can't reject: not a relationship '${changesetName}' stages or staged, nor one the model has: ${unknown.join(", ")}. Nothing was recorded`,
      ErrorCategory.USER,
      ["Pass source, predicate and target as the staged relationship names them (changeset_show lists them)"]
    );
  }
  return out;
}

function notRelationshipsResult(
  decisions: Decisions,
  skipped: number,
  recorded: Array<RelationshipRef & { how: NotRelationshipDecision["how"] }>,
  cleared: number,
  listLimit = MAX_LISTED
) {
  const total = Object.keys(decisions.notRelationships).length;
  if (!total && !skipped && !recorded.length && !cleared) return {};
  return {
    notRelationships: {
      total,
      skipped,
      ...(recorded.length ? { recorded: capped(recorded, listLimit) } : {}),
      ...(cleared ? { cleared } : {}),
      note: "Relationships decided not to be in the code (rejected, or unstaged after this tool staged them). Runs don't stage them; clearRejected with source::predicate::target forgets one.",
    },
  };
}

// ---------------------------------------------------------------------------
// Folders to ignore, and long ranges
// ---------------------------------------------------------------------------

/** At least this many undecided cards before folders are suggested for .cbmignore. */
const IGNORE_HINT_MIN_CARDS = 20;
/** "A few folders". */
const IGNORE_HINT_MAX_FOLDERS = 3;

interface IgnoreCandidates {
  folders: Array<{ folder: string; cards: number }>;
  /** Cards in those folders. */
  cards: number;
  /** Undecided cards in all. */
  of: number;
}

/**
 * The few folders that hold most of the undecided cards and no file a model element names (the
 * outermost such folder of each card), when together they hold more than half of them. Null when
 * the cards are few, the model names no file to tell product code by, or no few folders hold most.
 */
function ignoreCandidates(cards: UndecidedCard[], referenced: Set<string>): IgnoreCandidates | null {
  if (cards.length < IGNORE_HINT_MIN_CARDS || !referenced.size) return null;
  const referencedDirs = new Set<string>();
  for (const f of referenced) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) referencedDirs.add(parts.slice(0, i).join("/"));
  }
  const counts = new Map<string, number>();
  for (const c of cards) {
    const parts = normFile(c.file)?.split("/") ?? [];
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (referencedDirs.has(dir)) continue;
      counts.set(dir, (counts.get(dir) ?? 0) + 1);
      break;
    }
  }
  const floor = Math.max(5, Math.ceil(cards.length * 0.05));
  const top = [...counts]
    .filter(([, n]) => n >= floor)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, IGNORE_HINT_MAX_FOLDERS);
  const covered = top.reduce((sum, [, n]) => sum + n, 0);
  if (!top.length || covered * 2 <= cards.length) return null;
  return { folders: top.map(([folder, n]) => ({ folder: `${folder}/`, cards: n })), cards: covered, of: cards.length };
}

function ignoreStep(c: IgnoreCandidates): string {
  const list = c.folders.map((f) => `${f.folder} (${f.cards})`).join(", ");
  const lines = c.folders.map((f) => `/${f.folder}`).join(", ");
  return (
    `${c.cards} of the ${c.of} undecided cards are in folders no model element names: ${list}. If they aren't product code (ask the user when unsure), ` +
    `add them to .cbmignore at the codebase root (${lines}; gitignore syntax) so they aren't indexed, re-index with codebase_index and call ` +
    `codebase_extract again; or record their cards with reject: [{files: "${c.folders[0].folder}**", reason}].`
  );
}

/** A since range this long, in commits or in undecided cards, gets a notice and narrower options. */
const LONG_RANGE_COMMITS = 50;
const LONG_RANGE_CARDS = 200;

interface RangeReport {
  /** Commits in the range (absent when git couldn't say). */
  commits?: number;
  changedFiles: number;
  cards: number;
  long: boolean;
  /** Shorter ranges, nearest first, with the cards of this run in the files each changes. */
  narrower: Array<{ since: string; commitsBack: number; estimatedCards: number }>;
}

function describeRange(size: RangeSize | null, changedFiles: number, cards: UndecidedCard[]): RangeReport {
  const narrower = (size?.steps ?? [])
    .map((s) => ({
      since: s.ref.slice(0, 12),
      commitsBack: s.commitsBack,
      estimatedCards: cards.filter((c) => {
        const file = normFile(c.file);
        return !!file && s.files.has(file);
      }).length,
    }))
    .filter((n) => n.estimatedCards < cards.length);
  return {
    ...(size ? { commits: size.commits } : {}),
    changedFiles,
    cards: cards.length,
    long: (size?.commits ?? 0) > LONG_RANGE_COMMITS || cards.length > LONG_RANGE_CARDS,
    narrower,
  };
}

/** Next steps with the range and folder hints right after the first (which says what is active), before the cards are worked through. */
function withCardHints(steps: string[], hints: string[]): string[] {
  return hints.length ? [...steps.slice(0, 1), ...hints, ...steps.slice(1)] : steps;
}

function rangeStep(r: RangeReport, since: string): string {
  const reach = r.commits !== undefined ? `since ${since} reaches back ${r.commits} commit(s)` : `since ${since}`;
  const options = r.narrower.map((n) => `since: "${n.since}" (the last ${n.commitsBack} commits, about ${n.estimatedCards} cards)`).join("; ");
  return (
    `The range ${reach} and changes ${r.changedFiles} file(s), for ${r.cards} undecided card(s). Before working through them, check with the user that ` +
    "they meant all of it" +
    (options
      ? `. Narrower: ${options}. codebase_extract with preview: true and that since counts one without staging; a run with another since needs another changeset name.`
      : ", or narrow the run with layers.")
  );
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
      // A preview counts what a run would do, and stages and records nothing.
      const preview = args.preview === true;
      if (preview && (paging || decisionsOnly)) {
        throw new CLIError("preview counts a run; it can't be combined with page, reject or clearRejected", ErrorCategory.USER, [
          "Call codebase_extract with preview: true and the run's own arguments (since, layers, changeset)",
        ]);
      }
      const rejects = args.reject?.length ? splitRejects(args.reject) : null;

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
        // this call clears, then what it rejects. A preview changes nothing, a stale pending file included.
        if (stalePending && !preview) {
          const again = await readJson<StoredCards>(path.join(extractDir(projectRoot), PENDING_FILE));
          if (again?.pending && again.gitHead !== head) {
            await keepPendingAsRecord(projectRoot, manager, again);
            await rm(path.join(extractDir(projectRoot), PENDING_FILE), { force: true });
          }
        }
        const decisions = await readDecisions(projectRoot);
        const allChangesets = await manager.list();
        const stagedIds = new Set(allChangesets.filter((c) => c.status === "staged").map((c) => c.id));
        const landedIds = new Set(allChangesets.filter((c) => c.status === "committed").map((c) => c.id));
        let pruned = false;
        // An unstaged element or relationship stays decided once its changeset lands without it;
        // discarding the changeset drops the decision.
        for (const [key, d] of Object.entries(decisions.notElements)) {
          if (d.how === "unstaged" && !(d.changesetId && (stagedIds.has(d.changesetId) || landedIds.has(d.changesetId)))) {
            delete decisions.notElements[key];
            pruned = true;
          }
        }
        for (const [key, d] of Object.entries(decisions.notRelationships)) {
          if (d.how === "unstaged" && !(d.changesetId && (stagedIds.has(d.changesetId) || landedIds.has(d.changesetId)))) {
            delete decisions.notRelationships[key];
            pruned = true;
          }
        }
        // An unstaged relationship whose landed end was deleted since (or renamed: a new id) names
        // nothing any run can stage again. Rejections stay until cleared. Not on a page (no run) or a
        // preview (it writes nothing).
        if (!paging && !preview && (await pruneOrphanedRelationshipDecisions(decisions, model.rootPath, allChangesets, landedIds))) {
          pruned = true;
        }
        const recordedNow: Array<{ symbol: string; file: string | null; how: NotElementDecision["how"] }> = [];
        const recordedRelationshipsNow: Array<RelationshipRef & { how: NotRelationshipDecision["how"] }> = [];
        let cleared = 0;
        let clearedRelationships = 0;
        if (args.clearRejected) ({ elements: cleared, relationships: clearedRelationships } = clearDecisions(decisions, args.clearRejected));
        // What a reject names that is staged in the extraction changeset now: unstaged below, after
        // recording. Only a changeset this extraction stages into (it has cards, or adopted the
        // waiting ones) is touched, and in it only extracted elements.
        const toUnstage = new Map<string, string>();
        const inBase: string[] = [];
        const keptElements: Array<{ id: string; alsoNames: string[] }> = [];
        const relationshipsToUnstage: Array<RelationshipRef & { key: string }> = [];
        const relationshipsInBase: string[] = [];
        if (rejects) {
          const now = new Date().toISOString();
          const changesetLabel = changeset?.name ?? stored?.changesetName ?? name;
          const extractionChangeset = changeset && stored ? changeset : null;
          const graph = extractionChangeset ? await ChangesetGraph.build(model, extractionChangeset) : null;
          // Everything is checked before anything is recorded.
          const relationshipGraph = rejects.relationships.length ? (graph ?? (await ChangesetGraph.build(model, changeset ?? emptyChangeset()))) : null;
          const rejectedRelationships = relationshipGraph
            ? relationshipsToReject(rejects.relationships, stored, changeset, relationshipGraph, decisions, changesetLabel)
            : [];
          const cardRefs = [...rejects.cards, ...cardsInFiles(stored, rejects.files, changesetLabel)];
          const rejected = cardRefs.length ? cardsToReject(stored, changesetRejectables(extractionChangeset, graph), changesetLabel, cardRefs) : [];
          // A relationship still staged in the extraction changeset is unstaged; one the base model
          // has stays (rejecting is about what extraction stages).
          const stagedNow = stagedRelationshipAdds(extractionChangeset, relationshipGraph);
          for (const r of rejectedRelationships) {
            decisions.notRelationships[r.key] = {
              source: r.source,
              predicate: r.predicate,
              target: r.target,
              reason: r.reason,
              how: "rejected",
              changeset: changesetLabel,
              ...(changeset ? { changesetId: changeset.id! } : {}),
              at: now,
            };
            recordedRelationshipsNow.push({ source: r.source, predicate: r.predicate, target: r.target, how: "rejected" });
            const inGraph = relationshipGraph!.getRelationship(r.source, r.predicate, r.target);
            if (stagedNow.has(r.key)) relationshipsToUnstage.push(r);
            else if (inGraph && (inGraph.status === "unchanged" || inGraph.alreadyInBase)) relationshipsInBase.push(r.key);
          }
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
        if (!preview && (pruned || cleared || clearedRelationships || recordedNow.length || recordedRelationshipsNow.length)) {
          await writeDecisions(projectRoot, decisions);
        }
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
        const unstagedRels: string[] = [];
        for (const r of relationshipsToUnstage) {
          const result = await changesetUnstageHandler({
            source: r.source,
            predicate: r.predicate,
            target: r.target,
            changesetId: changeset!.id!,
            rootPath: args.rootPath,
          });
          const body = JSON.parse((result.content[0] as { text: string }).text) as { unstaged?: unknown[]; error?: string; message?: string };
          if (result.isError) unstageFailed.push({ id: r.key, error: body.error ?? body.message ?? "unstage failed" });
          else if (body.unstaged?.length) unstagedRels.push(r.key);
        }
        if ((unstaged.length || unstagedRels.length) && stored && changeset) {
          // The record of what extraction staged no longer holds what was unstaged. Waiting cards
          // become this changeset's record here (adopted, as a run would adopt them).
          const gone = new Set(unstaged.map((u) => u.id));
          const goneRels = new Set(unstagedRels);
          const { pending: wasPending, ...rest } = stored;
          const updated = (stored.updated ?? []).filter((u) => !gone.has(u.id));
          const stagedRelationships = (stored.stagedRelationships ?? []).filter((k) => !goneRels.has(k));
          stored = {
            ...rest,
            changesetId: changeset.id!,
            changesetName: changeset.name,
            staged: (stored.staged ?? []).filter((s) => !gone.has(s.id)),
            ...(updated.length ? { updated } : { updated: undefined }),
            ...(stagedRelationships.length ? { stagedRelationships } : { stagedRelationships: undefined }),
          };
          await writeFile(cardsPath(projectRoot, changeset.id!), JSON.stringify(stored), "utf-8");
          if (wasPending) await rm(path.join(extractDir(projectRoot), PENDING_FILE), { force: true });
        }
        if (unstaged.length || unstagedRels.length) await reloadModel(args.rootPath);
        const rejectResult = {
          ...(unstaged.length
            ? {
                unstaged: {
                  items: unstaged,
                  note: `Rejected while staged: unstaged from '${changeset!.name}', with the relationships staged for them (changes counts both).`,
                },
              }
            : {}),
          ...(unstagedRels.length
            ? { unstagedRelationships: { items: unstagedRels, note: `Rejected while staged: unstaged from '${changeset!.name}'.` } }
            : {}),
          ...(unstageFailed.length ? { unstageFailed } : {}),
          ...(inBase.length
            ? { inModel: { ids: [...new Set(inBase)], note: "Already in the base model: rejecting doesn't remove them. model_delete them if they should go." } }
            : {}),
          ...(relationshipsInBase.length
            ? {
                relationshipsInModel: {
                  items: relationshipsInBase,
                  note: "Already in the base model: rejecting doesn't remove them. relationship_delete them if they should go.",
                },
              }
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
              ...notRelationshipsResult(decisions, 0, recordedRelationshipsNow, clearedRelationships),
              ...rejectResult,
              message:
                unstaged.length || unstagedRels.length
                  ? `Recorded, and unstaged ${[
                      ...(unstaged.length ? [`${unstaged.length} element(s)`] : []),
                      ...(unstagedRels.length ? [`${unstagedRels.length} relationship(s)`] : []),
                    ].join(" and ")} it had staged; nothing was extracted.`
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
              ...notRelationshipsResult(decisions, 0, recordedRelationshipsNow, clearedRelationships, fit.listLimit),
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
        // Relationships this tool staged into the changeset that are gone from it while both ends
        // stay (the agent unstaged them), and those of extraction changesets that landed without
        // them: not relationships, so later runs don't stage them again.
        const live = (id: string) => liveIds.has(id);
        const relationshipsBefore = unstagedRelationships(storedBefore, changeset, live);
        for (const r of relationshipsBefore.unstaged) {
          if (decisions.notRelationships[r.key]) continue;
          decisions.notRelationships[r.key] = {
            source: r.source,
            predicate: r.predicate,
            target: r.target,
            reason: "staged by codebase_extract and then unstaged",
            how: "unstaged",
            changeset: changeset!.name,
            changesetId: changeset!.id!,
            at: new Date().toISOString(),
          };
          recordedRelationshipsNow.push({ source: r.source, predicate: r.predicate, target: r.target, how: "unstaged" });
        }
        if (!preview) {
          const landedUnstages = await recordLandedUnstages(projectRoot, manager, decisions, live, (key) => liveKeys.has(key));
          for (const e of landedUnstages.elements) notElementKeys.add(decisionKey(e.file, e.symbol));
          recordedNow.push(...landedUnstages.elements);
          recordedRelationshipsNow.push(...landedUnstages.relationships);
        }
        if (!preview && (recordedNow.some((r) => r.how === "unstaged") || recordedRelationshipsNow.length)) await writeDecisions(projectRoot, decisions);

        // With since: only code and infrastructure (SQL, compose and Kubernetes YAML, Dockerfiles).
        // DR's own folders are out already; leave out other files that no element names (docs,
        // lockfiles). Decision records the range changed come back in below, once extraction has
        // said which files they are.
        let rangeChanges: CodeChangesResult | null = null;
        let inCodeScope: ((file: string) => boolean) | null = null;
        if (changes) {
          const drDirs = [path.join(projectRoot, "documentation-robotics"), path.join(projectRoot, ".dr")]
            .map((d) => path.relative(codebaseRoot, d).split(path.sep).join("/"))
            .filter((d) => d && !d.startsWith(".."));
          rangeChanges = scopeChanges(changes, (f) => !inDirs(f, drDirs));
          inCodeScope = (f) => ((SOURCE_EXT.test(f) || INFRA_FILE.test(f)) && !VENDOR_EXCLUDE.test(f)) || referenced.has(f);
          changes = scopeChanges(rangeChanges, inCodeScope);
        }
        // Which symbols the range changed: the analyzer's detect_changes when it can answer for
        // this range (its seeds mark the cards), else the changed lines mapped to the cards.
        const detection = changes ? await detectChangedSymbols(backend!, projectRoot, codebaseRoot, since!, changes, edited) : null;
        if (changes && detection?.seeds) changes = { ...changes, seeds: detection.seeds, lineRuleFiles: detection.lineRuleFiles };

        const checkFiles = new Set<string>();
        for (const e of before.elements.values()) {
          if (e.status === "deleted" || (layers && !layers.includes(e.layer))) continue;
          for (const l of e.sourceReference?.locations ?? []) {
            const file = l.file?.replace(/\\/g, "/").replace(/^\.\//, "");
            if (file && l.symbol && (!changes || changes.changed.has(file))) checkFiles.add(file);
          }
        }

        // Federation (opt-in, codebase_index crossRepo): read the CROSS_* edges too, for the targets
        // whose model the manifest still declares. An unreadable file or an undeclared model is said.
        const crossRepoLoad = await loadCrossRepoConfig(projectRoot, analyzer);
        const crossDeclared = crossRepoLoad.config ? declaredTargets(crossRepoLoad.config.targets, model.manifest.models) : null;
        const crossRepo = crossRepoLoad.config && crossDeclared?.targets.length ? { ...crossRepoLoad.config, targets: crossDeclared.targets } : null;
        // The last index run's pass: skipped or failed, and targets indexed at another commit than their HEAD.
        const crossLastRun = crossRepoRunWarnings(crossRepoLoad.config?.lastRun, deps.targetGit);
        const crossWarnings = [
          ...(crossRepoLoad.warning ? [crossRepoLoad.warning] : []),
          ...(crossDeclared?.undeclared.length ? [undeclaredTargetsWarning(crossDeclared.undeclared)] : []),
          ...crossLastRun.warnings,
        ];
        let extraction: ExtractionGraph;
        try {
          extraction = await backend!.extract!(projectRoot, {
            codebaseRoot,
            ...(changes ? { files: changes.changed } : {}),
            checkFiles: [...checkFiles],
            deadline,
            // A preview counts what would be staged; cluster evidence is never staged, so it isn't asked for.
            ...(args.clusters && !preview ? { clusters: true } : {}),
            ...(crossRepo ? { crossModel: true } : {}),
          });
        } catch (error) {
          if (error instanceof ExtractionTimeoutError) {
            throw new CLIError(`codebase_extract ran past its ${Math.round((deadline - startedAt) / 1000)} s budget ${error.stage}; nothing was staged`, ErrorCategory.USER, [NARROW]);
          }
          throw error;
        }
        // A decision record (markdown, so not source) the range changed is in scope even when no
        // element names its file yet: its card, or the retirement it records, is the range's.
        if (rangeChanges && inCodeScope && extraction.decisions?.length) {
          const recordFiles = new Set(extraction.decisions.map((r) => r.file));
          const keep = inCodeScope;
          if ([...rangeChanges.changed].some((f) => recordFiles.has(f) && !keep(f))) {
            changes = scopeChanges(rangeChanges, (f) => keep(f) || recordFiles.has(f));
          }
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
        const { valid, invalid } = await validateAdds(plan.adds, extraction.project, now, changes?.hunks, changes ?? undefined);
        const adds = valid.map((v) => v.add);
        // Staged adds with no description that a doc section describes (cards carry their own docs).
        const describe: DescribeItem[] = adds.filter((a) => !a.description && a.symbol.docs?.length).map((a) => ({ id: a.id, docs: a.symbol.docs! }));
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
        const planned = planRelationships(extraction, before, plan.elementOf, elements, hasTriple, layers);
        const { alreadyPresent, weakCalls } = planned;
        // Relationships decided not to be in the code are not staged again.
        const notRejected = planned.relationships.filter((r) => !decisions.notRelationships[relationshipKey(r)]);
        const relationshipsSkipped = planned.relationships.length - notRejected.length;
        // A relationship an accepted gap says is deliberately absent is not staged: it is reported
        // as contradicted (#1026).
        const { kept: relationships, contradicted: contradictedGaps } = splitByAcceptedGaps(
          notRejected,
          (id) => {
            const e = elements.get(id);
            return e ? `${e.layer}.${normalizeNodeType(e.layer, e.type)}` : undefined;
          },
          (id) => before.getElement(id)?.acceptedGaps
        );

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

        // Existing elements whose code calls what the range changed, though their own code didn't
        // change: hints for the agent to review, never staged.
        let impactHints: ImpactHint[] = [];
        if (detection?.method === "detect_changes" && detection.impacted.length) {
          const ownCodeChanged = new Set<string>([...adds.map((a) => a.id), ...plan.updates.map((u) => u.id)]);
          for (const qn of detection.seeds ?? []) {
            const id = plan.elementOf.get(qn);
            if (id) ownCodeChanged.add(id);
          }
          impactHints = impactedElements(before, detection.impacted, extraction.project, { layers, exclude: ownCodeChanged });
        }

        // Cross-model references to the configured repositories' models, on the callers' elements.
        let crossModel: {
          plan: CrossModelPlan;
          staged: PlannedReference[];
          alreadyPresent: number;
          updated: string[];
          unreadable: Array<{ model: string; file: string; error: string }>;
        } | null = null;
        if (crossRepo && extraction.crossEdges) {
          const targetStates = await crossModelTargets(crossRepo, extraction.crossProjects ?? {});
          const crossPlan = planCrossModelReferences({
            extraction,
            existing: before,
            elementOf: plan.elementOf,
            elements,
            hasTriple,
            targets: targetStates,
            layers,
          });
          // Layer files of the other models DR couldn't parse: their elements are unknown, so say so.
          // (One entry per model: a target with several CBM projects shares its model.)
          const externals = new Map([...targetStates.values()].filter((s) => s.external).map((s) => [s.external!, s.target.model]));
          const unreadable = [...externals].flatMap(([external, name]) => external.unreadable.map((u) => ({ model: name, ...u })));
          if (unreadable.length) {
            crossWarnings.push(
              `${unreadable.length} layer file(s) of ${[...new Set(unreadable.map((u) => `@${u.model}`))].join(", ")} could not be parsed; ` +
                "references to their elements can't be verified (unreadableModelFiles)"
            );
          }
          crossModel = {
            plan: crossPlan,
            unreadable,
            ...(await stageReferences(crossPlan.references, batch, rewrites, model, before, changeset ?? emptyChangeset(), elements, now)),
          };
        }

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

        // How far a since range reaches (git can't say: just the counts), and the few folders that
        // hold most of the cards when no element names a file in them.
        let range: RangeReport | null = null;
        if (since && changes) {
          let size: RangeSize | null = null;
          try {
            // Narrower ranges cost a git diff each: only for a long range, or a preview.
            const wantSteps = (commits: number) => !!preview || commits > LONG_RANGE_COMMITS || undecided.length > LONG_RANGE_CARDS;
            size = (deps.rangeSize ?? gitRangeSize)(codebaseRoot, changes.base, wantSteps);
          } catch {
            size = null;
          }
          range = describeRange(size, changes.changed.size, undecided);
        }
        const namedFiles = new Set(referenced);
        for (const a of adds) {
          const file = normFile(a.symbol.card.file_path);
          if (file) namedFiles.add(file);
        }
        const ignore = ignoreCandidates(undecided, namedFiles);

        if (preview) {
          const target = changeset?.name ?? name;
          return jsonResult(
            {
              preview: true,
              message:
                `Preview: nothing was staged or recorded. A run with these arguments would stage ${summary.adds} add(s), ${summary.updates} update(s) ` +
                `and ${summary.relationships} relationship(s) into '${target}', and leave ${summary.cards} card(s) and ${summary.candidateDeletes} candidate delete(s).`,
              changeset: target,
              analyzer,
              index: describeIndex(freshness, indexJudgement),
              scope: {
                since: since ?? null,
                ...(changes ? { base: changes.base, changedFiles: changes.changed.size, deletedFiles: changes.deleted.size } : { files: "all" }),
                ...(detection ? { changedSymbols: describeDetection(detection) } : {}),
                layers: layers ?? "all",
              },
              ...(detection?.method === "detect_changes" ? { impacted: { total: impactHints.length } } : {}),
              ...(range ? { range } : {}),
              wouldStage: {
                adds: summary.adds,
                updates: summary.updates,
                relationships: summary.relationships,
                ...(crossModel?.staged.length ? { references: crossModel.staged.length } : {}),
                byLayer: byLayer(adds, stagedUpdates, relationships),
              },
              // What a run would say about federation: an unreadable cross-repo.json, models no
              // longer declared, model files that couldn't be parsed.
              ...(crossDeclared?.undeclared.length || crossWarnings.length
                ? {
                    crossModel: {
                      ...(crossDeclared?.undeclared.length ? { undeclared: crossDeclared.undeclared } : {}),
                      ...(crossWarnings.length ? { warnings: crossWarnings } : {}),
                    },
                  }
                : {}),
              candidateDeletes: summary.candidateDeletes,
              undecided: { total: summary.cards, ...(changes ? { changedInRange: undecided.filter((c) => c.changedInRange).length } : {}) },
              ...(ignore ? { ignoreCandidates: ignore } : {}),
              ...notElementsResult(decisions, plan.skipped, [], 0),
              ...notRelationshipsResult(decisions, relationshipsSkipped, [], 0),
              next: [
                "To run it, call codebase_extract with the same arguments and no preview.",
                ...(range?.narrower.length
                  ? [
                      `For a narrower range, call it with since set to one of: ${range.narrower
                        .map((n) => `"${n.since}" (the last ${n.commitsBack} commits, about ${n.estimatedCards} cards)`)
                        .join(", ")}; add preview: true to count it first.`,
                    ]
                  : []),
                ...(ignore ? [ignoreStep(ignore)] : []),
              ],
              durationMs: Date.now() - startedAt,
            },
            { compact: true }
          );
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
              `As-built extraction of the code at ${head.slice(0, 7)}${since ? `, files changed since ${since}` : ""}. Staged by codebase_extract.`,
              { kind: "extract" }
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
        // Cross-model references staged on existing elements are extraction's updates too (no value:
        // verify compares the fields it reads, and references isn't one).
        for (const id of crossModel?.updated ?? []) {
          const fields = updatedFields.get(id) ?? updatedFields.set(id, new Map()).get(id)!;
          if (!fields.has("references")) fields.set("references", undefined);
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
          const stagedRelationships = [...new Set([...relationshipsBefore.still, ...relationships.map(relationshipKey)])];
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
            ...(stagedRelationships.length ? { stagedRelationships } : {}),
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
          // Another run's waiting cards, whose changeset the agent may have created: it stays extraction's.
          const replaced = await readJson<StoredCards>(pendingPath);
          if (replaced?.pending && replaced.changesetName !== name) await keepPendingAsRecord(projectRoot, manager, replaced);
          await writeFile(pendingPath, JSON.stringify(record), "utf-8");
        } else if (pending?.changesetName === name) {
          await rm(pendingPath, { force: true });
        }
        await pruneCardFiles(projectRoot, manager);

        const cards = page(undecided, 1, effectivePageSize);
        const changedCards = undecided.filter((c) => c.changedInRange).length;
        const changesetRef = changeset ? { id: changeset.id!, name: changeset.name } : null;
        const verifyMode = !!since && !!recordedPrevious;
        // Relationships held back because an accepted gap says they are absent: the model and the
        // code disagree, so a run that stages nothing else must not say they agree.
        const contradiction = contradictedGaps.length
          ? `${contradictedGaps.length} relationship(s) the code shows contradict an accepted gap and were not staged ` +
            "(acceptedGaps.contradicted): ask the user whether the decision is stale or the code drifted."
          : "";
        const message = !hasWork
          ? verifyMode && !changeset
            ? contradiction
              ? `Nothing staged, but the code disagrees with the model: ${contradiction} No as-built changeset was created; ${previousActive ? `'${previousActive.name}' is still active.` : `the plan is '${recordedPrevious!.name}'.`}`
              : `Nothing to stage: nothing in the range is observable to extraction or differs from the model. No as-built changeset was created; ${previousActive ? `'${previousActive.name}' is still active.` : `the plan is '${recordedPrevious!.name}'.`}`
            : changeset
              ? contradiction
                ? `Nothing more staged in '${changeset.name}', but the code disagrees with it: ${contradiction}`
                : `Nothing more to stage: '${changeset.name}' already says what this code says.`
              : contradiction
                ? `Nothing staged, but the code disagrees with the model: ${contradiction} No changeset was created or activated.`
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
                  hunksWarning: changes.seeds
                    ? `The range's changed lines couldn't be read (${changes.hunksError}), so no module, route or test card of a file the range didn't add ` +
                      "says changedInRange; detect_changes marked the others, a file it seeded whole (whole_file) included."
                    : `The range's changed lines couldn't be read (${changes.hunksError}), so no card of a file the range didn't add says changedInRange; ` +
                      "the cards are those of every changed file.",
                }
              : {}),
            analyzer,
            // The shared judgement: `fresh-with-uncommitted-edits` when the warning above is given.
            index: describeIndex(freshness, indexJudgement),
            scope: {
              since: since ?? null,
              ...(changes ? { base: changes.base, changedFiles: changes.changed.size, deletedFiles: changes.deleted.size } : { files: "all" }),
              ...(detection ? { changedSymbols: describeDetection(detection) } : {}),
              layers: layers ?? "all",
            },
            ...(detection?.method === "detect_changes"
              ? {
                  impacted: {
                    ...capped(
                      impactHints.map(({ id, symbol, hop, via, viaEdge, rolledUp }) => ({ id, symbol, hop, via, viaEdge, ...(rolledUp ? { rolledUp } : {}) })),
                      fit.listLimit
                    ),
                    note: IMPACT_NOTE,
                  },
                }
              : {}),
            cards: { ...extraction.summary, needsAttributes: invalid.length },
            staged: {
              adds: adds.length,
              updates: stagedUpdates.length,
              relationships: relationships.length,
              byLayer: byLayer(adds, stagedUpdates, relationships),
              ...(stagedUpdates.length ? { updated: capped(stagedUpdates.map((u) => ({ id: u.id, fields: Object.keys(u.fields) })), fit.listLimit) } : {}),
            },
            ...(crossModel || crossWarnings.length
              ? {
                  crossModel: {
                    ...(crossModel
                      ? {
                          staged: crossModel.staged.length,
                          unverified: crossModel.staged.filter((r) => !r.verified).length,
                          alreadyPresent: crossModel.alreadyPresent,
                          references: capped(
                            crossModel.staged.map((r) => ({ source: r.source, type: r.type, target: r.target, verified: r.verified })),
                            fit.listLimit
                          ),
                          ...(crossModel.plan.unresolved.length ? { unresolved: capped(crossModel.plan.unresolved, fit.listLimit) } : {}),
                          ...(Object.keys(crossModel.plan.skipped).length ? { skipped: crossModel.plan.skipped } : {}),
                          ...(crossModel.plan.unknownProjects.length ? { unknownProjects: crossModel.plan.unknownProjects } : {}),
                          ...(crossModel.unreadable.length ? { unreadableModelFiles: capped(crossModel.unreadable, fit.listLimit) } : {}),
                        }
                      : { staged: 0 }),
                    ...(crossDeclared?.undeclared.length ? { undeclared: crossDeclared.undeclared } : {}),
                    ...(crossLastRun.stale.length ? { stale: crossLastRun.stale.map(({ message: _m, ...s }) => s) } : {}),
                    ...(crossWarnings.length ? { warnings: crossWarnings } : {}),
                    note:
                      "References to other models (@model/...) from codebase-memory-mcp's cross-repository edges, staged on the calling element " +
                      "(its references field, not a relationship). verified: false means that model was not on disk to check, so the target is " +
                      "the id extraction gives that route there. A caller that is not an element yet gets its reference on a later run.",
                  },
                }
              : {}),
            unchanged: {
              elements: plan.unchanged,
              modelled: plan.modelled,
              relationships: alreadyPresent,
              // Calls the index matched by name only, with nothing to corroborate them: not staged.
              ...(weakCalls ? { weakCalls } : {}),
              rejected: plan.rejected,
              ...(plan.outsideLayers ? { outsideLayers: plan.outsideLayers } : {}),
            },
            ...(contradictedGaps.length
              ? {
                  acceptedGaps: {
                    contradicted: capped(contradictedGaps, fit.listLimit),
                    note:
                      "Not staged: the code shows a connection the element accepted as a gap. Either the decision is stale " +
                      "(gap_reopen in a changeset, then extract again) or the code drifted; ask the user which.",
                  },
                }
              : {}),
            candidateDeletes: {
              ...capped(plan.candidateDeletes, fit.listLimit),
              note: "Not staged: deleting is left to you. Each has its evidence.",
            },
            ...(plan.retyped.length ? { retyped: capped(plan.retyped, fit.listLimit) } : {}),
            ...notElementsResult(decisions, plan.skipped, recordedNow, cleared, fit.listLimit),
            ...notRelationshipsResult(decisions, relationshipsSkipped, recordedRelationshipsNow, 0, fit.listLimit),
            ...(range?.long ? { range } : {}),
            ...(ignore ? { ignoreCandidates: ignore } : {}),
            undecided: undecidedSection(cards, items, fit, pageSize, changes ? { changedInRange: changedCards } : {}),
            ...documentationResult(plan, describe, extraction.docsError, fit.listLimit),
            ...(extraction.clusters ? { clusters: clustersSection(extraction.clusters, fit.listLimit) } : {}),
            tier1: "not wired: cards Tier 0 can't decide come to you (docs/EXTRACTION_STRATEGY.md, B6)",
            durationMs: Date.now() - startedAt,
            next: [
              ...(!hasWork
                ? verifyMode
                  ? changesetRef
                    ? nextSteps(changesetRef, recordedPrevious, 0, plan, 0, since)
                    : verifyNothingSteps(recordedPrevious!, since!)
                  : []
                : withCardHints(
                    changesetRef
                      ? nextSteps(changesetRef, recordedPrevious, cards.pages, plan, changedCards, since, fit.readOn)
                      : pendingSteps(name, recordedPrevious, cards.pages, plan, changedCards, since, fit.readOn),
                    [...(range?.long && undecided.length ? [rangeStep(range, since!)] : []), ...(ignore ? [ignoreStep(ignore)] : [])]
                  )),
              ...impactStep(impactHints),
            ],
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
    "With since, scope.changedSymbols says how changed symbols were found (the analyzer's detect_changes, or git's changed " +
    "lines, with why), and impacted lists existing elements whose code calls changed code: review hints, never staged. " +
    "Code that is not an element goes in reject (with a reason): a card, or a symbol or element it staged, which is then " +
    "unstaged; or files (a path or glob) for every undecided card in them. A wrong relationship goes in reject as " +
    "relationship: {source, predicate, target}. Kept until clearRejected, later runs leave them out. An element " +
    "or relationship it staged that you unstage from a changeset is also left out, while that changeset is staged and " +
    "after it lands; discarding it forgets that. " +
    "A long since range says so (range) with narrower since refs; preview: true counts a run without staging anything. " +
    "When most cards sit in a few folders no element names, next suggests .cbmignore. " +
    "A run or page into an extraction changeset keeps that run's since and layers. " +
    "The changeset (default extract-<sha>) is created and made active only when the run stages something; a run that only " +
    "leaves cards or candidate deletes creates nothing and says which changeset to create first. previousActive is the one " +
    "active before the first run. Needs a fresh index (codebase_index). Never writes the base model or commits.",
  inputSchema,
  handler: codebaseExtractHandler,
};
