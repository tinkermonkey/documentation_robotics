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
 * the one active before is returned as previousActive.
 *
 * "Not an element" decisions are kept per project (.dr/analyzers/extract/decisions.json), by file
 * and symbol: a card the agent rejects (`reject`), and an element this tool staged that the agent
 * then unstaged. Later runs leave those symbols out, and say how many; `clearRejected` forgets them.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { codeChangesSince, inDirs, scopeChanges, sourceEditsSince, type CodeChangesResult } from "../../analyzers/code-changes.js";
import { SOURCE_EXT, VENDOR_EXCLUDE } from "../../analyzers/cards/build.js";
import { ExtractionTimeoutError, type ExtractionGraph } from "../../analyzers/cards/extract.js";
import {
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
} from "../../analyzers/extraction-plan.js";
import { Changeset, type StagedChange } from "../../core/changeset.js";
import { ChangesetGraph } from "../../core/changeset-graph.js";
import { Element } from "../../core/element.js";
import { Layer } from "../../core/layer.js";
import type { Model } from "../../core/model.js";
import { setStagedSourceReference } from "../../core/staged-source-reference.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { getAllLayerIds, isValidLayer } from "../../generated/layer-registry.js";
import { getValidRelationships } from "../../generated/relationship-index.js";
import type { SourceReference } from "../../types/source-reference.js";
import { generateUUID } from "../../utils/id-generator.js";
import { CLIError, ErrorCategory, formatValidOptions } from "../../utils/errors.js";
import { FileLock } from "../../utils/file-lock.js";
import { SchemaValidator } from "../../validators/schema-validator.js";
import { jsonResult, loadModel, reloadModel, rootPathSchema, runTool, type McpToolContext, type McpToolDefinition } from "./shared.js";
import {
  analyzerNotFoundError,
  canonicalRoots,
  defaultCodebaseToolDeps,
  describeIndex,
  requireFreshIndex,
  type CodebaseToolDeps,
} from "./codebase-shared.js";

const DEFAULT_PAGE_SIZE = 25;
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
  pageSize: z.number().int().min(1).max(200).optional().describe(`Undecided cards per page (default ${DEFAULT_PAGE_SIZE}).`),
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
        card: z.string().min(1).describe("The card's cardId, or its symbol (or file#symbol)."),
        reason: z.string().min(1).describe("Why it is not a model element, in a few words."),
      })
    )
    .optional()
    .describe(
      "Cards from the last run that are not model elements (cardId, or a symbol only one card has). Recorded for the project " +
        "until cleared, so later runs leave them out. A call with only reject or clearRejected records and runs nothing."
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
}

interface StagedBySymbol {
  id: string;
  file: string | null;
  symbol: string;
  label: string;
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

const KEEP_FILES = new Set([DESCRIPTIONS_FILE, DECISIONS_FILE]);

function extractDir(projectRoot: string): string {
  return path.join(projectRoot, ".dr", "analyzers", "extract");
}

function cardsPath(projectRoot: string, changesetId: string): string {
  return path.join(extractDir(projectRoot), `${changesetId.replace(/[^\w.-]/g, "_")}.json`);
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

function capped<T>(items: T[]): { total: number; items: T[]; truncated?: true } {
  return items.length > MAX_LISTED ? { total: items.length, items: items.slice(0, MAX_LISTED), truncated: true } : { total: items.length, items };
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
  cleared: number
) {
  const total = Object.keys(decisions.notElements).length;
  if (!total && !skipped && !recorded.length && !cleared) return {};
  return {
    notElements: {
      total,
      skipped,
      ...(recorded.length ? { recorded: capped(recorded) } : {}),
      ...(cleared ? { cleared } : {}),
      note: "Symbols decided not to be elements (rejected, or unstaged after this tool staged them). Runs leave them out; clearRejected forgets them.",
    },
  };
}

function nextSteps(
  changeset: { id: string; name: string },
  previous: { id: string; name: string } | null,
  undecidedPages: number,
  plan: Pick<ElementPlan, "candidateDeletes" | "retyped">,
  changedCards = 0,
  since?: string
): string[] {
  const steps = [
    `The as-built changeset '${changeset.name}' is active: model_add, model_update, model_delete and relationship_add stage into it. Nothing reaches the base model until the user lands it.`,
  ];
  if (changedCards > 0) {
    steps.push(
      `${changedCards} card(s) have changedInRange: their lines are new or changed in the range, so they come first. The rest are symbols in the same files that the range didn't touch.`
    );
  }
  if (undecidedPages > 0) {
    steps.push(
      "Decide the undecided cards: for each one that is a model element, call model_add with a layer and type from its candidates " +
        "(or its hint; spec_type says what a type needs), a name (the card's name when it has one), sourceFile = file, sourceSymbol = symbol and sourceProvenance: \"extracted\". " +
        `Read further pages with page: 2 and on (${undecidedPages} in all).`,
      "For cards that are not elements, call codebase_extract with reject: [{card: cardId, reason}] so later runs leave them out.",
      `Then call codebase_extract again with changeset: "${changeset.name}"${since ? `, since: "${since}"` : ""} (it keeps that run's since and layers). It finds your elements by their source reference and stages the relationships the edge mapping gives them.`
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

async function readDecisions(projectRoot: string): Promise<DecisionsFile> {
  const stored = await readJson<DecisionsFile>(path.join(extractDir(projectRoot), DECISIONS_FILE));
  return { version: 1, notElements: stored?.notElements && typeof stored.notElements === "object" ? stored.notElements : {} };
}

async function writeDecisions(projectRoot: string, decisions: DecisionsFile): Promise<void> {
  await mkdir(extractDir(projectRoot), { recursive: true });
  await writeFile(path.join(extractDir(projectRoot), DECISIONS_FILE), JSON.stringify(decisions, null, 2), "utf-8");
}

/** The stored cards a `reject` names, or a CLIError naming the ones it can't find. */
function cardsToReject(stored: StoredCards | null, changesetName: string, refs: Array<{ card: string; reason: string }>) {
  if (!stored) {
    throw new CLIError(`No cards recorded for '${changesetName}' to reject from`, ErrorCategory.USER, [
      "Call codebase_extract first, then pass the cardId (or symbol) of each card that is not an element",
    ]);
  }
  const found: Array<{ card: UndecidedCard; reason: string }> = [];
  const unknown: string[] = [];
  const ambiguous: string[] = [];
  for (const ref of refs) {
    const byId = stored.cards.find((c) => c.cardId === ref.card);
    const matches = byId
      ? [byId]
      : stored.cards.filter((c) => c.symbol === ref.card || `${c.file ?? ""}#${c.symbol}` === ref.card || c.qualifiedName === ref.card);
    if (matches.length === 1) found.push({ card: matches[0], reason: ref.reason });
    else if (matches.length > 1) ambiguous.push(`${ref.card} (cards ${matches.map((c) => c.cardId).join(", ")})`);
    else unknown.push(ref.card);
  }
  if (unknown.length || ambiguous.length) {
    const parts = [
      ...(unknown.length ? [`not among the cards of '${changesetName}': ${unknown.join(", ")}`] : []),
      ...(ambiguous.length ? [`names more than one card: ${ambiguous.join("; ")}`] : []),
    ];
    throw new CLIError(`Can't reject: ${parts.join("; ")}. Nothing was recorded`, ErrorCategory.USER, [
      "Pass the cardId (or file#symbol) of each card the last run returned",
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

      const { analyzer, freshness } = await requireFreshIndex(projectRoot, codebaseRoot, deps, "codebase_extract");
      const head = freshness.currentGitHead;

      const manager = new StagingAreaManager(model.rootPath, model);
      const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
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
        }
      }
      let stored = changeset ? await readJson<StoredCards>(cardsPath(projectRoot, changeset.id!)) : null;

      // A run or page into an extraction changeset keeps its run's since and layers; a call that
      // names others is refused.
      let since = args.since;
      let layers = argLayers;
      if (stored && changeset?.status === "staged" && !decisionsOnly) {
        const conflicts: string[] = [];
        if (args.since !== undefined && args.since !== (stored.since ?? undefined)) {
          conflicts.push(`since: ${args.since} (its run had since: ${stored.since ?? "none"})`);
        }
        if (argLayers && !sameLayers(stored.layers, argLayers)) {
          conflicts.push(`layers: ${argLayers.join(", ")} (its run had layers: ${stored.layers?.join(", ") ?? "all"})`);
        }
        if (conflicts.length) {
          throw new CLIError(`'${changeset.name}' holds another run's extraction: this call names ${conflicts.join(" and ")}`, ErrorCategory.USER, [
            "Leave since and layers out to use that run's",
            "Or pass another changeset name for a run with these arguments",
          ]);
        }
        since = stored.since ?? undefined;
        layers = stored.layers ?? undefined;
      }

      // The scope: every file, or the files changed since a ref (a run, or a default name to find).
      let changes: CodeChangesResult | null = null;
      if (since && (!(paging || decisionsOnly) || !changeset)) changes = await (deps.codeChanges ?? codeChangesSince)(codebaseRoot, since);

      if (!changeset && !args.changeset) {
        // A whole-codebase run and a `since` run at the same commit are different changesets.
        const defaultName = changes ? `extract-${changes.base.slice(0, 7)}..${head.slice(0, 7)}` : `extract-${head.slice(0, 7)}`;
        name = defaultName;
        changeset = await manager.load(name);
        // A default name already landed (or discarded) at this commit: take the next free one.
        for (let n = 2; changeset && changeset.status !== "staged"; n++) {
          name = `${defaultName}-${n}`;
          changeset = await manager.load(name);
        }
        stored = changeset ? await readJson<StoredCards>(cardsPath(projectRoot, changeset.id!)) : null;
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
        if (args.reject?.length) {
          const now = new Date().toISOString();
          for (const { card, reason } of cardsToReject(stored, changeset?.name ?? name, args.reject)) {
            decisions.notElements[decisionKey(card.file, card.symbol)] = {
              file: card.file,
              symbol: card.symbol,
              label: card.label,
              reason,
              how: "rejected",
              changeset: changeset!.name,
              changesetId: changeset!.id!,
              at: now,
            };
            recordedNow.push({ symbol: card.symbol, file: card.file, how: "rejected" });
          }
        }
        if (pruned || cleared || recordedNow.length) await writeDecisions(projectRoot, decisions);
        const notElementKeys = new Set(Object.keys(decisions.notElements));

        if (decisionsOnly) {
          const rerun = changeset ? `changeset: "${changeset.name}"` : "the arguments of the last run";
          return jsonResult(
            {
              changeset: changeset ? { id: changeset.id, name: changeset.name } : null,
              ...notElementsResult(decisions, 0, recordedNow, cleared),
              message: "Recorded; nothing was extracted or staged.",
              next: [`Call codebase_extract with ${rerun} to refresh the cards: it leaves out what is recorded, and says how many.`],
            },
            { compact: true }
          );
        }

        // Later pages: the last run's cards, marking any the agent has modelled since.
        if (paging) {
          if (!changeset) {
            throw new CLIError(`No extraction changeset '${name}' yet`, ErrorCategory.USER, ["Call codebase_extract without page first"]);
          }
          if (!stored) {
            throw new CLIError(`No cards recorded for '${changeset.name}'`, ErrorCategory.USER, ["Call codebase_extract without page first"]);
          }
          if (stored.gitHead !== head) {
            throw new CLIError(`The cards for '${changeset.name}' were read at ${stored.gitHead.slice(0, 7)}; the code is now at ${head.slice(0, 7)}`, ErrorCategory.USER, [
              "Call codebase_extract without page to extract again",
            ]);
          }
          const graph = await ChangesetGraph.build(model, changeset);
          const modelledAt = new Map<string, string>();
          for (const e of graph.elements.values()) {
            if (e.status === "deleted") continue;
            for (const l of e.sourceReference?.locations ?? []) if (l.symbol) modelledAt.set(`${l.file}#${l.symbol}`, e.id);
          }
          const cards = stored.cards.filter((c) => !notElementKeys.has(decisionKey(c.file, c.symbol)));
          const p = page(cards, args.page!, pageSize);
          return jsonResult(
            {
              changeset: { id: changeset.id, name: changeset.name },
              scope: { since: stored.since, layers: stored.layers ?? "all" },
              undecided: {
                ...p,
                items: p.items.map((c) => {
                  const modelled = c.file ? modelledAt.get(`${c.file}#${c.symbol}`) : undefined;
                  return modelled ? { ...c, modelled } : c;
                }),
              },
              ...notElementsResult(decisions, stored.cards.length - cards.length, recordedNow, cleared),
              ...(stored.baseModified !== baseModified
                ? { warning: "The base model changed since these cards were read; call codebase_extract without page to refresh them." }
                : {}),
              ...(args.page! < p.pages ? { next: `Call codebase_extract with page: ${args.page! + 1} for the next cards.` } : {}),
            },
            { compact: true }
          );
        }
        // Edits since the index was taken: freshness only compares commits.
        // TODO(PR 1060): use requireFreshIndex(..., { uncommittedEdits: true }) and its
        // index.editedSince instead of this check, once judgeIndex in codebase-shared.ts lands.
        const indexedAt = Date.parse(freshness.meta.timestamp);
        const edited = Number.isNaN(indexedAt)
          ? []
          : await (deps.sourceEdits ?? sourceEditsSince)(codebaseRoot, indexedAt, (f) => SOURCE_EXT.test(f));

        // What the model has: the base, plus the extraction changeset's own changes when it exists.
        const before = await ChangesetGraph.build(model, changeset ?? emptyChangeset());
        const referenced = new Set<string>();
        const liveKeys = new Set<string>();
        const liveIds = new Set<string>();
        for (const e of before.elements.values()) {
          if (e.status === "deleted") continue;
          liveIds.add(e.id);
          for (const l of e.sourceReference?.locations ?? []) {
            const file = l.file?.replace(/\\/g, "/").replace(/^\.\//, "");
            if (file) referenced.add(file);
            if (l.symbol) liveKeys.add(decisionKey(file || null, l.symbol));
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
        const undecided = sortUndecided([...plan.undecided, ...invalid]);
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

        const hasWork = batch.length > 0 || rewrites.length > 0 || undecided.length > 0 || plan.candidateDeletes.length > 0;
        let created = false;
        let active = !!changeset && activeId === changeset.id;
        if (hasWork) {
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
        if (changeset) {
          const staged = [...stillStaged];
          for (const a of adds) {
            staged.push({ id: a.id, file: a.symbol.card.file_path, symbol: sourceSymbolOf(a.symbol, extraction.project), label: a.symbol.card.label });
          }
          const record: StoredCards = {
            changesetId: changeset.id!,
            changesetName: changeset.name,
            gitHead: head,
            since: since ?? null,
            layers: layers ?? null,
            baseModified,
            previousActive,
            createdAt: now,
            cards: undecided,
            staged,
          };
          await writeFile(cardsPath(projectRoot, changeset.id!), JSON.stringify(record), "utf-8");
        }
        await pruneCardFiles(projectRoot, manager);

        const cards = page(undecided, 1, pageSize);
        const changedCards = undecided.filter((c) => c.changedInRange).length;
        const changesetRef = changeset ? { id: changeset.id!, name: changeset.name } : null;
        return jsonResult(
          {
            changeset: changesetRef ? { ...changesetRef, created, active } : null,
            previousActive,
            ...(hasWork ? {} : { message: "Nothing to stage: the model already says what this code says. No changeset was created or activated." }),
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
            index: describeIndex(freshness),
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
              ...(stagedUpdates.length ? { updated: capped(stagedUpdates.map((u) => ({ id: u.id, fields: Object.keys(u.fields) }))) } : {}),
            },
            unchanged: {
              elements: plan.unchanged,
              modelled: plan.modelled,
              relationships: alreadyPresent,
              rejected: plan.rejected,
              ...(plan.outsideLayers ? { outsideLayers: plan.outsideLayers } : {}),
            },
            candidateDeletes: {
              ...capped(plan.candidateDeletes),
              note: "Not staged: deleting is left to you. Each has its evidence.",
            },
            ...(plan.retyped.length ? { retyped: capped(plan.retyped) } : {}),
            ...notElementsResult(decisions, plan.skipped, recordedNow, cleared),
            undecided: changes ? { ...cards, changedInRange: changedCards } : cards,
            tier1: "not wired: cards Tier 0 can't decide come to you (docs/EXTRACTION_STRATEGY.md, B6)",
            durationMs: Date.now() - startedAt,
            next: changesetRef && hasWork ? nextSteps(changesetRef, previousActive, cards.pages, plan, changedCards, since) : [],
          },
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
    "Cards that are not elements go in reject (with a reason): kept until clearRejected, later runs leave them out. An element " +
    "it staged that you unstage from a changeset is also left out, but only while that changeset is staged: discarding or " +
    "landing it forgets that. A run or page into an extraction changeset keeps that run's since and layers. " +
    "The changeset (default extract-<sha>) is created if absent and " +
    "left active when there is anything to stage or decide; previousActive is the one active before the first run. Needs a fresh index (codebase_index). Never writes the base " +
    "model or commits.",
  inputSchema,
  handler: codebaseExtractHandler,
};
