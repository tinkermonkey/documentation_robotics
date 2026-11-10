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
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { codeChangesSince, type CodeChangesResult } from "../../analyzers/code-changes.js";
import type { ExtractionGraph } from "../../analyzers/cards/extract.js";
import {
  needsAttributesCard,
  planElements,
  planRelationships,
  sortUndecided,
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
import { SchemaValidator } from "../../validators/schema-validator.js";
import { jsonResult, loadModel, reloadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
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
        "Default: extract-<short git HEAD>."
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
    .describe("Page of undecided cards (default 1). Page 2 and later read the last run's cards: nothing is extracted or staged."),
  rootPath: rootPathSchema,
};

export type CodebaseExtractArgs = z.infer<z.ZodObject<typeof inputSchema>>;

/** The undecided cards of the last run on a changeset, for paging. */
interface StoredCards {
  changesetId: string;
  changesetName: string;
  gitHead: string;
  since: string | null;
  layers: string[] | null;
  createdAt: string;
  cards: UndecidedCard[];
}

function cardsPath(projectRoot: string, changesetId: string): string {
  return path.join(projectRoot, ".dr", "analyzers", "extract", `${changesetId.replace(/[^\w.-]/g, "_")}.json`);
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
async function validateAdds(adds: PlannedElement[], project: string, now: string) {
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
      if (errs?.length) invalid.push(needsAttributesCard(item.add, project, errs));
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

function nextSteps(
  changeset: { id: string; name: string },
  previous: { id: string; name: string } | null,
  undecidedPages: number,
  plan: Pick<ElementPlan, "candidateDeletes" | "retyped">
): string[] {
  const steps = [
    `The as-built changeset '${changeset.name}' is active: model_add, model_update, model_delete and relationship_add stage into it. Nothing reaches the base model until the user lands it.`,
  ];
  if (undecidedPages > 0) {
    steps.push(
      "Decide the undecided cards: for each one that is a model element, call model_add with a layer and type from its candidates " +
        "(or its hint; spec_type says what a type needs), a name, sourceFile = file, sourceSymbol = symbol and sourceProvenance: \"extracted\". " +
        `Skip the ones that are not elements. Read further pages with page: 2 and on (${undecidedPages} in all).`,
      `Then call codebase_extract again with changeset: "${changeset.name}". It finds your elements by their source reference and stages the relationships the edge mapping gives them.`
    );
  }
  if (plan.candidateDeletes.length) {
    steps.push("Check candidateDeletes: call model_delete only for elements whose code is really gone (replacedBy names the element staged for a renamed file).");
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

export function createCodebaseExtractHandler(deps: CodebaseToolDeps = defaultCodebaseToolDeps) {
  return async function codebaseExtractHandler(args: CodebaseExtractArgs): Promise<CallToolResult> {
    return runTool(async () => {
      const startedAt = Date.now();
      const model = await loadModel(args.rootPath);
      const { projectRoot, codebaseRoot } = await canonicalRoots(model);

      const layers = args.layers?.length ? [...new Set(args.layers)] : undefined;
      const unknownLayers = (layers ?? []).filter((l) => !isValidLayer(l));
      if (unknownLayers.length) {
        throw new CLIError(`Unknown layer${unknownLayers.length > 1 ? "s" : ""}: ${unknownLayers.join(", ")}`, ErrorCategory.USER, [
          `Use canonical layer names: ${formatValidOptions(getAllLayerIds())}`,
        ]);
      }

      const { analyzer, freshness } = await requireFreshIndex(projectRoot, codebaseRoot, deps, "codebase_extract");
      const head = freshness.currentGitHead;
      const manager = new StagingAreaManager(model.rootPath, model);
      let name = args.changeset ?? `extract-${head.slice(0, 7)}`;
      let changeset = await manager.load(name);
      // A default name already landed (or discarded) at this commit: take the next free one.
      for (let n = 2; !args.changeset && changeset && changeset.status !== "staged"; n++) {
        name = `extract-${head.slice(0, 7)}-${n}`;
        changeset = await manager.load(name);
      }
      if (changeset && changeset.status !== "staged") {
        throw new CLIError(`Changeset '${changeset.name}' is ${changeset.status} and can't take the extraction`, ErrorCategory.USER, [
          "Pass another name in changeset",
        ]);
      }
      const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;

      // Later pages: the last run's cards, marking any the agent has modelled since.
      if ((args.page ?? 1) > 1) {
        if (!changeset) {
          throw new CLIError(`No extraction changeset '${name}' yet`, ErrorCategory.USER, ["Call codebase_extract without page first"]);
        }
        let stored: StoredCards;
        try {
          stored = JSON.parse(await readFile(cardsPath(projectRoot, changeset.id!), "utf-8")) as StoredCards;
        } catch {
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
        const p = page(stored.cards, args.page!, pageSize);
        return jsonResult(
          {
            changeset: { id: changeset.id, name: changeset.name },
            undecided: {
              ...p,
              items: p.items.map((c) => {
                const modelled = c.file ? modelledAt.get(`${c.file}#${c.symbol}`) : undefined;
                return modelled ? { ...c, modelled } : c;
              }),
            },
            ...(args.page! < p.pages ? { next: `Call codebase_extract with page: ${args.page! + 1} for the next cards.` } : {}),
          },
          { compact: true }
        );
      }

      const backend = await deps.getAnalyzer(analyzer);
      if (!backend) throw analyzerNotFoundError(analyzer);
      if (!backend.extract) {
        throw new CLIError(`The ${analyzer} analyzer can't extract (it has no Tier-0 rules)`, ErrorCategory.USER);
      }

      // The scope: every file, or the files changed since a ref.
      let changes: CodeChangesResult | null = null;
      if (args.since) changes = await (deps.codeChanges ?? codeChangesSince)(codebaseRoot, args.since);

      // What the model has: the base, plus the extraction changeset's own changes when it exists.
      const before = await ChangesetGraph.build(model, changeset ?? emptyChangeset());
      const checkFiles = new Set<string>();
      for (const e of before.elements.values()) {
        if (e.status === "deleted" || (layers && !layers.includes(e.layer))) continue;
        for (const l of e.sourceReference?.locations ?? []) {
          const file = l.file?.replace(/\\/g, "/").replace(/^\.\//, "");
          if (file && l.symbol && (!changes || changes.changed.has(file))) checkFiles.add(file);
        }
      }

      const extraction: ExtractionGraph = await backend.extract(projectRoot, {
        codebaseRoot,
        ...(changes ? { files: changes.changed } : {}),
        checkFiles: [...checkFiles],
      });
      const plan = planElements(extraction, before, {
        layers,
        changes,
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
      const { valid, invalid } = await validateAdds(plan.adds, extraction.project, now);
      const adds = valid.map((v) => v.add);
      const undecided = sortUndecided([...plan.undecided, ...invalid]);
      const kept = new Set(adds);
      for (const add of plan.adds) {
        if (!kept.has(add)) plan.elementOf.delete(add.symbol.qualifiedName);
      }

      const elements = new Map<string, { layer: string; type: string }>();
      for (const e of before.elements.values()) if (e.status !== "deleted") elements.set(e.id, { layer: e.layer, type: e.type });
      for (const a of adds) elements.set(a.id, { layer: a.layer, type: a.type });
      const { relationships, alreadyPresent } = planRelationships(extraction, before, plan.elementOf, elements, hasTriple, layers);

      // The changeset: create it when absent, and make it the active one.
      const previousActiveId = await manager.getActiveId();
      let created = false;
      if (!changeset) {
        changeset = await manager.create(
          name,
          `As-built extraction of the code at ${head.slice(0, 7)}${args.since ? `, files changed since ${args.since}` : ""}. Staged by codebase_extract.`
        );
        created = true;
      }
      const changesetId = changeset.id!;
      let previousActive: { id: string; name: string } | null = null;
      if (previousActiveId !== changesetId) {
        if (previousActiveId) {
          const prev = await manager.load(previousActiveId);
          previousActive = { id: previousActiveId, name: prev?.name ?? previousActiveId };
        }
        await manager.setActive(changesetId);
      }

      // Stage: adds, updates (an update of an element this changeset adds rewrites the add), relationships.
      const batch: Array<Omit<StagedChange, "sequenceNumber">> = [];
      for (const { add, element } of valid) {
        batch.push({ type: "add", elementId: add.id, layerName: add.layer, after: element.toJSON() as unknown as Record<string, unknown> });
      }
      const stagedUpdates: PlannedUpdate[] = [];
      for (const update of plan.updates) {
        const current = await currentSnapshot(model, before, changeset, update.id, update.layer);
        if (!current) continue;
        const after = patched(current.snapshot, update, now);
        if (current.stagedAdd) {
          await manager.restage(changesetId, current.stagedAdd.elementId, {
            type: "add",
            elementId: current.stagedAdd.elementId,
            layerName: current.stagedAdd.layerName,
            ...(current.stagedAdd.before !== undefined ? { before: current.stagedAdd.before } : {}),
            after,
          });
        } else {
          batch.push({ type: "update", elementId: update.id, layerName: update.layer, before: current.snapshot, after });
        }
        stagedUpdates.push(update);
      }
      for (const r of relationships) batch.push(relationshipChange(r));
      await manager.stageMany(changesetId, batch);
      await reloadModel(args.rootPath);

      // Keep the cards for later pages.
      const stored: StoredCards = {
        changesetId,
        changesetName: changeset.name,
        gitHead: head,
        since: args.since ?? null,
        layers: layers ?? null,
        createdAt: now,
        cards: undecided,
      };
      const file = cardsPath(projectRoot, changesetId);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(stored), "utf-8");

      const cards = page(undecided, 1, pageSize);
      const changesetRef = { id: changesetId, name: changeset.name };
      return jsonResult(
        {
          changeset: { ...changesetRef, created, active: true },
          previousActive,
          analyzer,
          index: describeIndex(freshness),
          scope: {
            since: args.since ?? null,
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
          undecided: cards,
          tier1: "not wired: cards Tier 0 can't decide come to you (docs/EXTRACTION_STRATEGY.md, B6)",
          durationMs: Date.now() - startedAt,
          next: nextSteps(changesetRef, previousActive, cards.pages, plan),
        },
        { compact: true }
      );
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
    "files changed since then, for verifying a branch. The changeset (default extract-<sha>) is created if absent and " +
    "left active; previousActive is the one active before. Needs a fresh index (codebase_index). Never writes the base " +
    "model or commits.",
  inputSchema,
  handler: codebaseExtractHandler,
};
