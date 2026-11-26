/**
 * codebase_extract — run the extraction cascade over the indexed code and stage what it finds in
 * an as-built changeset. It never writes the base model and never commits.
 *
 * The cascade (docs/analyzers/CASCADE_DESIGN.md):
 * 1. Tier 0 rules decide what they can; a CBM route is an `api.operation` by the node mapping.
 *    Those decisions are staged, with the relationships the edge mapping gives them.
 * 2. Tier 1 (a decision model), when the checkout opted in (`.dr/analyzers/<analyzer>/tier1.json`,
 *    docs/analyzers/TIER1_DESIGN.md): the cards Tier 0 narrowed or left open get its answer as a
 *    hint. In suggest mode (the default) it stages and hides nothing on its own, the accept band
 *    sorted first; `acceptTier1: true` stages the accept band (cached answers only, so exactly what
 *    was shown) like Tier-0 decisions, with their relationships. In stage mode (the model's
 *    defaults are verified on held-out labels, and tier1.json doesn't set `"mode": "suggest"`) the
 *    accept band is staged that way without the agent and the not-element band is hidden, counted
 *    in `unchanged.tier1NotElement`. In hide mode (the not-element band alone is verified) that band is
 *    hidden the same way and the accept band stays a suggestion, as in suggest mode. Staged adds and relationship-adds carry `origin` (who decided
 *    them). See codebase-extract-tier1.ts.
 * 3. The calling agent gets the rest: grouped and counted when there are more than a page
 *    (src/analyzers/triage.ts), to decide in bulk with `decide` by a stated rule
 *    (codebase-extract-decide.ts), then as cards by view and page for what is left, which it
 *    stages with model_add or decides one at a time.
 *
 * A project's own rules (`documentation-robotics/extraction-rules.yaml`, src/analyzers/project-rules.ts)
 * are applied before cards are made: a rule that says `none` ahead of Tier 0, a rule that names a
 * type for what Tier 0 left open. `decide` with `keep: true` writes them.
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
import { z } from "zod";
import { requiredAttributesFor } from "../../utils/required-attributes.js";
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
  ownerTypeResolver,
  impactedElements,
  isTier1Rule,
  tier1Askable,
  withTier1Decided,
  withTier1Hints,
  type ImpactHint,
  needsAttributesCard,
  planElements,
  planRelationships,
  INFERRED_TEST_EDGE,
  INFERRED_TEST_CALL_EDGE,
  sortUndecided,
  sourceSymbolOf,
  symbolChangedInRange,
  type ElementPlan,
  type PlannedElement,
  type PlannedRelationship,
  type PlannedUpdate,
  type UndecidedCard,
  type UndecidedKind,
} from "../../analyzers/extraction-plan.js";
import { relationshipNotInDeclaredSpec, typeNotInDeclaredSpec } from "../../core/declared-spec.js";
import { getCliBundledSpecVersion } from "../../utils/spec-version.js";
import { Changeset, type ChangeOrigin, type StagedChange } from "../../core/changeset.js";
import { ChangesetGraph, changesetRevisionToken } from "../../core/changeset-graph.js";
import { splitByAcceptedGaps } from "../../core/accepted-gaps-verify.js";
import { normalizeNodeType } from "../../generated/node-types.js";
import { stagedRelationshipTriple } from "../../core/relationship-staging.js";
import { Element } from "../../core/element.js";
import type { Model } from "../../core/model.js";
import { setStagedSourceReference, stagedSourceReference } from "../../core/staged-source-reference.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { hashFiles } from "../../core/reconciliation.js";
import {
  decideExtractionPurpose,
  EXTRACTION_PURPOSE_ARGS,
  extractionPurpose,
  purposeOf,
  RECONCILING_PURPOSES,
  readPurpose,
  resolveCommit,
  type ChangesetPurpose,
  type ExtractionPurposeDecision,
} from "../../core/changeset-purpose.js";
import { getAllLayerIds, isValidLayer } from "../../generated/layer-registry.js";
import { validatePlannedAdds } from "../../analyzers/validate-planned.js";
import { getValidRelationships } from "../../generated/relationship-index.js";
import type { SourceReference } from "../../types/source-reference.js";
import { CLIError, ErrorCategory, formatValidOptions } from "../../utils/errors.js";
import { FileLock } from "../../utils/file-lock.js";
import { acquireProjectWriteLock, compactJson, jsonResult, loadModel, reloadModel, rootPathSchema, runTool, type McpToolContext, type McpToolDefinition } from "./shared.js";
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
  compactHint,
  countUncached,
  holdsForWarming,
  openExtractTier1,
  runExtractTier1,
  shownHints,
  skippedBlock,
  tier1DeadlineAt,
  warmingBlock,
  warmingCapacity,
  type ExtractTier1Result,
} from "./codebase-extract-tier1.js";
import { runningFill } from "../../analyzers/index-job.js";
import {
  PROJECT_RULES_FILE,
  PROJECT_RULE_PREFIX,
  applyProjectRules,
  filesMatcher,
  isProjectRule,
  loadProjectRules,
  relationshipRuleFor,
  releaseHeldCards,
  ruleNameFor,
  saveProjectRule,
  subjectOf,
  type CompiledRule,
  type ProjectRule,
} from "../../analyzers/project-rules.js";
import {
  DEFAULT_GROUP_DEPTH,
  DEFAULT_SHARED_BY,
  filterCards,
  groupCards,
  groupPath,
  normFile,
  kindRows,
  pageOf,
  planCoverage,
  sharedHelperGroups,
  type CardFilter,
  type PlanCoverageItem,
  type PlannedElementRef,
  type SharedHelpers,
} from "../../analyzers/triage.js";
import { BATCH_FILE_DESCRIPTION, readBatchFile } from "../batch-file.js";
import { batchReport, verboseSchema, type BatchItemResult } from "./batch-result.js";
import {
  cardsNamed,
  compileDecide,
  namesCode,
  decideItemSchema,
  ruleReport,
  ruleWarnings,
  cardRuleName,
  withCardDecisions,
  type CardRef,
  type DecideResult,
  type RuleReport,
} from "./codebase-extract-decide.js";
import { loadSpecCriteria } from "../../analyzers/classifier/criteria.js";
import type { Tier1Session } from "../../analyzers/classifier/session.js";
import type { Tier1Block } from "../../analyzers/classifier/types.js";
import {
  analyzerNotFoundError,
  canonicalRoots,
  defaultCodebaseToolDeps,
  describeIndex,
  requireFreshIndex,
  type CodebaseToolDeps,
} from "./codebase-shared.js";
import { indexFirst, indexFirstDeadline } from "./codebase-index.js";

const DEFAULT_PAGE_SIZE = 25;
/**
 * The size a response with cards aims to stay under. Clients save larger tool results to a file
 * (Claude Code does above about 25-30 KB), which the agent then has to search.
 */
const RESPONSE_BUDGET_BYTES = 28 * 1024;
const MAX_LISTED = 100;
/** Groups of cards a response lists by default. */
const DEFAULT_GROUPS = 50;
/** Layers that hold intent, not code: a planned element there has no declaration for extraction to find. */
const INTENT_LAYERS: ReadonlySet<string> = new Set(["motivation", "business", "product"]);

const rejectItemSchema = strictItem("A reject[] item", {
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
        predicate: z
          .string()
          .min(1)
          .optional()
          .describe(
            "With files: not the cards in those files but the relationships with this predicate whose source element is sourced there, as a group (files plus predicate \"tests\" is every test link of a test file or folder)."
          ),
        except: z
          .array(z.string().min(1))
          .optional()
          .describe("With files: cards to leave out of it (cardId, symbol or file#symbol), such as the ones you will model."),
        keep: z
          .boolean()
          .optional()
          .describe(
            "true: write it as a rule to documentation-robotics/extraction-rules.yaml (commit that file) instead of recording it in this checkout's .dr/, " +
              "so other checkouts leave it out too. A card becomes a rule on its file and symbol; files a rule on the pattern (not with except); a relationship a relationship rule."
          ),
        reason: z.string().min(1).describe("Why it is not a model element (or relationship), in a few words."),
      });

/**
 * The lists `list` reads from a run's record. Every shortened list's hint names one of these
 * (capped's name is typed by it), so the call the hint gives is one the schema accepts.
 */
const RUN_LISTS = [
  "groups",
  "candidateDeletes",
  "updated",
  "retyped",
  "impacted",
  "ruleDecided",
  "sharedHelpers",
  "planCoverage",
  "unwiredTests",
  "weakCalls",
  "notElements",
  "declaredSpecNotStaged",
  "contradictedGaps",
  "tier1NotElementCards",
  "retiredDecisions",
  "rules",
] as const;

/** A list `list` can read: the name a shortened list's hint gives. */
type RunListName = (typeof RUN_LISTS)[number];

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
  purpose: z
    .enum(EXTRACTION_PURPOSE_ARGS)
    .optional()
    .describe(
      "With since: what the changeset this run makes is for, overriding the rule. By the rule, with a plan active the run is its verification record; with " +
        "no plan active, a since that is the model's last reconciled code commit (project_status codeDrift.reconciledBy.codeCommit) makes a reconcile " +
        "(landing it reconciles the model with the code), and any other since makes a verification record (never landed; it names the staged plan it " +
        "verifies, or says it found none). Use reconcile or verification to say otherwise."
    ),
  layers: z.array(z.string()).optional().describe("Only these layers (canonical names). Default: every layer."),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe(
      `Undecided cards per page (default ${DEFAULT_PAGE_SIZE}). A page that would make the response larger than about ` +
        `${RESPONSE_BUDGET_BYTES / 1024} KB has its cards shortened, then is cut to its first cards, and says so with the call that reads on.`
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
    .array(rejectItemSchema)
    .optional()
    .describe(
      "What is not in the model, each item with one of card, files or relationship, and a reason. card: a card of this " +
        "extraction (cardId, or a symbol only one card has), a symbol it staged (Tier 0 decided it), or the id of an element " +
        "staged from it. files: every undecided card in matching files (a path or glob from the codebase root; * stays in one folder, so use **/*.md for any depth), " +
        "instead of one call per card; a card whose symbol an element now names is left out and counted (modelled), as is one except names. " +
        "With decide in the same call, decide is applied first and files covers only the cards it leaves undecided; a card a decide item names is decide's. " +
        "relationship: {source, predicate, target} of a wrong relationship. Recorded for the project until cleared, so " +
        "later runs leave them out; what is still staged for them in the changeset is unstaged (an element with its relationships). " +
        "An item that names nothing (a pattern no card is in, an unknown card) is listed in reject.attention and the others are still recorded; " +
        "the call is refused only when no item applies. A call with only reject or clearRejected records and runs nothing. " +
        "Recorded decisions are this checkout's (.dr/ is not in git); keep: true writes a rule instead. With preview: true nothing is recorded or unstaged and each item says would-record."
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
        "since refs, without staging or recording anything. Use it before a since run that may reach far back. It asks Tier 1 nothing, so its counts are Tier 0's: " +
        "in stage mode a real run also stages Tier 1's accept band and hides its not-element band, which the preview doesn't count. " +
        "With reject or clearRejected it records, clears and unstages nothing: each reject item says would-record, with its count."
    ),
  clusters: z
    .boolean()
    .optional()
    .describe(
      "Also ask codebase-memory-mcp for its architecture clusters (get_architecture): each card in a cluster that spans several " +
        "files says so (cluster), and the largest clusters come back as clusters.proposals to name or dismiss. Evidence only; it " +
        "decides nothing and can add up to 30 s while the analyzer computes it (never past the run's budget). A preview doesn't ask. Default: off."
    ),
  tier1: z
    .boolean()
    .optional()
    .describe(
      "false skips Tier 1 for this run: Tier 0 only, nothing sent, whatever the checkout's tier1.json says. Default: Tier 1 runs when the checkout opted in."
    ),
  autoIndex: z
    .boolean()
    .optional()
    .describe(
      "Default true: when the code is not indexed, the index is stale or an index run is in flight, a run indexes first (within this call's time budget) " +
        "and says so in index.indexedFirst. false refuses instead, pointing at codebase_index. A preview, page, view, list or reject-only call never indexes."
    ),
  acceptTier1: z
    .literal(true)
    .optional()
    .describe(
      "Stage the cards in Tier 1's accept band (hint band \"accept\") as elements, with their relationships, in a normal run with " +
        "this changeset's since and layers. Uses cached answers only, so it stages exactly what you were shown and sends nothing. " +
        "Pass it only after the user agreed; reject (or model_add differently) any accept card they disagree with first. " +
        "Suggest mode (tier1.mode \"suggest\"): in stage mode the run stages the accept band itself, so acceptTier1 is ignored (next says so)."
    ),
  decide: z
    .array(decideItemSchema)
    .optional()
    .describe(
      "Decide cards in bulk, by a stated rule: each item names where (files, file, label, visibility, nested, name, symbol, declaration, ownerType), " +
        "or one card, or a relationship, and says as (a layer.type, or none) with a reason. The run applies them ahead of the project's " +
        "rules file: a typed item stages every card it covers as that type, named from the card as Tier 0 names them (in a since run, only " +
        "the symbols the range changed, with the item's attributes for what the type requires and the code can't give); none records them as not elements. " +
        "A none item leaves a symbol Tier 0 decided as an element to Tier 0 unless it says overrideTier0: true; ruleWarnings, at the top of the answer, says how many it matched. " +
        "where.name matches the bare name (_copy_grooves), where.symbol the card's symbol (Assembly._copy_grooves). " +
        "With preview: true nothing is written and each item's count " +
        "and a sample come back, which is the step to review before applying. keep: true also writes the item to " +
        `documentation-robotics/${PROJECT_RULES_FILE}, so later runs and other checkouts apply it (and retires the recorded rejections it covers). ` +
        "With view, the answer is that view's first page (page for another) of the cards left once the items apply. The result (decide) gives counts and the items that need attention."
    ),
  file: z
    .string()
    .min(1)
    .optional()
    .describe(`${BATCH_FILE_DESCRIPTION} For codebase_extract the object is {"reject": [...], "decide": [...]}, either or both.`),
  verbose: verboseSchema,
  intent: z
    .string()
    .min(1)
    .optional()
    .describe(
      "What this extraction is for, once the user confirmed it: the description of the changeset the run creates. With it the run creates the " +
        "changeset (under changeset, or the default name) even when it stages nothing, so model_add has a changeset of the right purpose to stage into."
    ),
  view: strictItem("view", {
    files: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional().describe("A file, a folder or a glob from the codebase root, or a list."),
    label: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional().describe("Function, Method, Class, Interface, Type, Enum, Route, ..."),
    visibility: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional().describe("exported, local, public, private, protected."),
    kind: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional().describe("no-rule, narrowed, ambiguous, needs-attributes, unhandled-route, decision-record."),
    nested: z.boolean().optional().describe("Declared inside another function."),
    changed: z.boolean().optional().describe("With a since run: true for symbols the range changed (the default pile), false for the ones it did not touch."),
    planned: z.boolean().optional().describe("With a plan active before a since run: true for cards whose symbol an element of the plan names (card.planned)."),
  })
    .optional()
    .describe(
      "Read the last run's cards by filter, a page at a time (page, pageSize): nothing is extracted or staged. {} lists every card. " +
        "Its groups are those of the filtered cards, so a folder can be opened a level at a time (with groupDepth). " +
        'A candidate list several cards share is given once (undecided.candidateLists) and named on each card (candidateList); groupBy: "file" groups the page by file. ' +
        "With decide, the call is a run: the items apply first and the answer is this view's page of the cards left."
    ),
  list: z
    .enum(RUN_LISTS)
    .optional()
    .describe(
      "Read one list of the last run in full, a page at a time (limit, offset): nothing is extracted or staged. Each list a run shortens says " +
        "which name to pass here. ruleDecided needs rule (the rule's name). notElements reads this checkout's recorded decisions, run or no run."
    ),
  rule: z.string().min(1).optional().describe("With list: \"ruleDecided\": the project rule whose decisions to list."),
  limit: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "With list, or for a run's groups: how many items a page holds (default 50 groups, 100 for other lists). For reject and decide: how many of " +
        "the items that need attention come back in full (default 50); the rest are never dropped, each is listed by position under its reason."
    ),
  offset: z.number().int().min(0).optional().describe("With list (or a run's groups): where the page starts (default 0)."),
  groupDepth: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe(`How many leading folders name a group of cards (default ${DEFAULT_GROUP_DEPTH}, e.g. src/ui/). Raise it, with view.files, to open a folder; groupBy: "file" goes to its files.`),
  groupBy: z
    .enum(["folder", "file"])
    .optional()
    .describe('With list: "groups": "file" gives one group per file (default "folder"). With view (or a page): the page\'s cards grouped by file, or by folder at groupDepth.'),
  sharedBy: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      `A function or component that realizes more than this many services is listed in sharedHelpers (default ${DEFAULT_SHARED_BY}): ` +
        "a shared helper, probably, for you to decide with a relationship rule. Nothing is left out because of it."
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
  /** The purpose the run declared, and for a verification record the plan it verifies (core/changeset-purpose.ts). */
  purpose?: ChangesetPurpose;
  verifies?: string;
  /** Source files with uncommitted changes when the run read the code (#1330): what it modelled may exist in no commit. */
  uncommitted?: Record<string, string | null>;
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
  /** A since run whose changed lines were known: the default pile is the cards the range changed. */
  rangeOnly?: boolean;
  /**
   * The last run's lists in full, by the name `list` reads them under (candidateDeletes, updated,
   * retyped, impacted, sharedHelpers, planCoverage, unwiredTests, ruleDecided:<rule>, ...), so a
   * list the response shortened is still reachable.
   */
  lists?: Record<string, unknown[]>;
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
  /** Attributes whose staged value is a placeholder extraction made up, not read from the code (changeset_verify doesn't compare them). */
  defaulted?: string[];
  /**
   * Who decided it: the origin of the add extraction staged (Tier 0's rule, or Tier 1's decision
   * with its model and probabilities), or `agent` for a card the agent staged. Absent in older records.
   */
  origin?: ChangeOrigin;
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

/** The last preview's cards and lists, read by a later call with preview: true and view or list. */
const PREVIEW_FILE = "preview.json";

/**
 * A preview's response, with every call it names for the rest (a `more`, a `next` step's view or
 * list call) made a read of the preview's own record: `preview: true` added.
 */
function asPreviewReads<T>(preview: boolean, value: T): T {
  if (!preview) return value;
  const fix = (v: unknown): unknown => {
    if (typeof v === "string") {
      return v.replace(/(call codebase_extract with )(?=(?:list|view|limit|offset|groupBy|groupDepth|page)\b)/gi, "$1preview: true, ");
    }
    if (Array.isArray(v)) return v.map(fix);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)]));
    return v;
  };
  return fix(value) as T;
}

/** The cards of the last run that staged nothing, so made no changeset ({@link StoredCards.pending}). */
const PENDING_FILE = "pending.json";

const KEEP_FILES = new Set([DESCRIPTIONS_FILE, DECISIONS_FILE, PENDING_FILE, PREVIEW_FILE]);

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

/** How to read a named list of the last run from an offset: the `more` of a shortened list. */
function listCall(name: RunListName, nextOffset: number): string {
  return `Call codebase_extract with list: "${name}" and offset: ${nextOffset} for the rest (nothing is extracted or staged).`;
}

/**
 * A list of the response at its default length: its true total, the items shown, and, when it is
 * shortened, the call that returns the rest (`list: <name>`, which reads the run's record).
 */
function capped<T>(items: T[], limit = MAX_LISTED, name?: RunListName) {
  return pageOf(items, limit, 0, name ? (next) => listCall(name, next) : undefined);
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
  return {
    ...rest,
    ...open,
    ...evidence,
    ...(card.kind === "ambiguous" || card.kind === "needs-attributes" ? { reason: clip(reason, 200) } : {}),
    ...(card.tier1 ? { tier1: compactHint(card.tier1) } : {}),
  } as Partial<T>;
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
function cutInstruction(p: CardPage, shown: number, prefix = ""): string {
  const next = (p.page - 1) * p.pageSize + shown;
  return (
    `call codebase_extract with ${prefix}page: ${Math.floor(next / shown) + 1} and pageSize: ${shown}` +
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
function fitCards(
  cards: UndecidedCard[],
  p: CardPage,
  render: (items: Array<Partial<UndecidedCard>>, fit: PageFit) => Record<string, unknown>,
  /** What the paging call needs before `page` to read the same cards (`view: {...}, `). */
  prefix = ""
): Record<string, unknown> {
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
      ...(cards.length > 1 ? { shown: 1, readOn: cutInstruction(p, 1, prefix) } : {}),
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
    result = render(compact.slice(0, shown), { ...lists, detail: "compact", note: PAGE_NOTES.compact, shown, readOn: cutInstruction(p, shown, prefix) });
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
            `The lists other than the cards (candidateDeletes, staged.updated, retyped, impacted and the like) show at most ${fit.listLimit} item(s) here, to keep the response small; ` +
            "each total is the full count, and each shortened list's more names the call that reads the rest.",
        }
      : {}),
    ...(fit.overBudget ? { overBudget: `Even shortened, this response is over about ${RESPONSE_BUDGET_BYTES / 1024} KB.` } : {}),
  };
}

/** How a page of cards is laid out: by file, or by folder at a depth (groupBy), or a flat list. */
interface PageLayout {
  groupBy?: "file" | "folder";
  depth?: number;
}

/** The page layout a call asks for (groupBy, groupDepth). */
function pageLayout(args: Pick<CodebaseExtractArgs, "groupBy" | "groupDepth">): PageLayout {
  return args.groupBy ? { groupBy: args.groupBy, ...(args.groupDepth ? { depth: args.groupDepth } : {}) } : {};
}

/** What a paging call names before `page` to read the same cards: the view and the layout (`view: {...}, groupBy: "file", `). */
function viewCallArgs(args: Pick<CodebaseExtractArgs, "view" | "groupBy" | "groupDepth">): string {
  return (
    `${args.view ? `view: ${JSON.stringify(args.view)}, ` : ""}${args.groupBy ? `groupBy: "${args.groupBy}", ` : ""}` +
    `${args.groupBy && args.groupDepth ? `groupDepth: ${args.groupDepth}, ` : ""}`
  );
}

/** The order a page grouped by file or folder needs: the cards of one group together, each group's cards in their own order. */
function inLayoutOrder<T extends UndecidedCard>(cards: T[], layout: PageLayout): T[] {
  if (!layout.groupBy) return cards;
  const key = (c: T) => groupPath(c.file, layout.depth ?? DEFAULT_GROUP_DEPTH, layout.groupBy === "file");
  const first = new Map<string, number>();
  cards.forEach((c, i) => {
    if (!first.has(key(c))) first.set(key(c), i);
  });
  return cards.map((c, i) => ({ c, i })).sort((a, b) => first.get(key(a.c))! - first.get(key(b.c))! || a.i - b.i).map((x) => x.c);
}

/**
 * A page of cards with each candidate list that two or more of them share stated once (#1298): the
 * page's `candidateLists` holds it under a short name and each such card names it (`candidateList`)
 * instead of repeating it. A list of one type, or one only one card has, stays on its card.
 */
export function sharedCandidateLists(items: Array<Partial<UndecidedCard>>): {
  items: Array<Partial<UndecidedCard> & { candidateList?: string }>;
  candidateLists?: Record<string, string[]>;
} {
  const counts = new Map<string, number>();
  for (const c of items) if ((c.candidates?.length ?? 0) > 1) counts.set(JSON.stringify(c.candidates), (counts.get(JSON.stringify(c.candidates)) ?? 0) + 1);
  const shared = [...counts].filter(([, n]) => n > 1).map(([k]) => k);
  if (!shared.length) return { items };
  const names = new Map(shared.map((k, i) => [k, `L${i + 1}`] as const));
  const candidateLists = Object.fromEntries(shared.map((k) => [names.get(k)!, JSON.parse(k) as string[]]));
  return {
    candidateLists,
    items: items.map((c) => {
      const name = c.candidates ? names.get(JSON.stringify(c.candidates)) : undefined;
      if (!name) return c;
      const { candidates: _candidates, ...rest } = c;
      return { ...rest, candidateList: name };
    }),
  };
}

/** The undecided section of a response: the page, how it was fitted, and how to read on. */
function undecidedSection(
  p: CardPage,
  items: Array<Partial<UndecidedCard>>,
  fit: PageFit,
  requestedPageSize: number,
  extra: Record<string, unknown> = {},
  layout: PageLayout = {}
): Record<string, unknown> {
  // What each type the page's cards name (candidates, hint, Tier 1's type) requires, once per
  // type, so the first model_add from these cards sends valid attributes (#1153).
  const requiredAttributes = requiredAttributesFor(
    items.flatMap((c) => [
      ...(c.candidates ?? []),
      ...(c.hint ? [c.hint] : []),
      ...(c.tier1?.layer && c.tier1.type ? [`${c.tier1.layer}.${c.tier1.type}`] : []),
    ])
  );
  const shared = sharedCandidateLists(items);
  // Grouped by file (or folder): the file is said once per group, not on every card.
  let groups: Array<{ path: string; items: Array<Partial<UndecidedCard>> }> | undefined;
  if (layout.groupBy) {
    const byPath = new Map<string, Array<Partial<UndecidedCard>>>();
    for (const c of shared.items) {
      const key = groupPath(c.file ?? null, layout.depth ?? DEFAULT_GROUP_DEPTH, layout.groupBy === "file");
      const { file: _file, ...rest } = c;
      (byPath.get(key) ?? byPath.set(key, []).get(key)!).push(layout.groupBy === "file" ? rest : c);
    }
    groups = [...byPath].map(([path, cards]) => ({ path, items: cards }));
  }
  return {
    ...p,
    items: groups ? undefined : shared.items,
    ...(groups ? { [layout.groupBy === "file" ? "byFile" : "byFolder"]: groups } : {}),
    ...(shared.candidateLists ? { candidateLists: shared.candidateLists } : {}),
    ...(Object.keys(requiredAttributes).length > 0 ? { requiredAttributes } : {}),
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

/** Adds whose attributes validate, and the rest as cards with what they lack. */
async function validateAdds(
  adds: PlannedElement[],
  now: string,
  hunks?: CodeChangesResult["hunks"],
  seeds?: Pick<CodeChangesResult, "seeds" | "lineRuleFiles">
) {
  const valid: Array<{ add: PlannedElement; element: Element }> = [];
  const invalid: UndecidedCard[] = [];
  for (const { add, element, errors } of await validatePlannedAdds(adds, now)) {
    if (errors.length) invalid.push(needsAttributesCard(add, errors, hunks, seeds));
    else valid.push({ add, element });
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

function relationshipChange(r: PlannedRelationship, origin: ChangeOrigin): Omit<StagedChange, "sequenceNumber"> {
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
    origin,
  };
}

/**
 * A staged relationship's origin: the decision that created its end (section 7). An end Tier 1
 * decided wins, then an end Tier 0 decided in this run; between elements the run didn't add, the
 * edge mapping (`edge:<CBM edge>`), which is Tier 0's.
 */
function relationshipOrigin(r: PlannedRelationship, addOrigins: ReadonlyMap<string, ChangeOrigin>): ChangeOrigin {
  // A tests link inferred from a test file's name says so, whoever decided its ends.
  if (r.edge === INFERRED_TEST_EDGE || r.edge === INFERRED_TEST_CALL_EDGE) return { by: "tier0", rule: `edge:${r.edge}` };
  const ends = [addOrigins.get(r.source), addOrigins.get(r.target)].filter((o): o is ChangeOrigin => !!o);
  return structuredClone(ends.find((o) => o.by === "tier1") ?? ends[0] ?? { by: "tier0", rule: `edge:${r.edge}` });
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
        ? { decisionRecords: { cards: decisions.cards, modelled: decisions.modelled, ...(decisions.retired.length ? { retired: capped(decisions.retired, listLimit, "retiredDecisions") } : {}) } }
        : {}),
      ...(describe.length ? { describe: { total: describe.length, items: shown, ...(shown.length < describe.length ? { truncated: true } : {}) } } : {}),
      ...(error ? { error: `Decision records and doc sections couldn't be read, so no card carries them: ${error}` } : {}),
      ...(decisions?.cards || describe.length ? { note: DOCUMENTATION_NOTE } : {}),
    },
  };
}

/**
 * What a call recorded, as counts (#1182): the decisions the caller asked for are counted, not
 * echoed; the ones this tool inferred (an element or relationship it staged that was unstaged) are
 * listed, since nobody sent them. `verbose` lists every one.
 */
function recordedSummary<T extends { how: "rejected" | "unstaged" }>(recorded: T[], verbose: boolean | undefined) {
  const inferred = recorded.filter((r) => r.how === "unstaged");
  const listed = verbose ? recorded : inferred;
  return {
    total: recorded.length,
    rejected: recorded.length - inferred.length,
    unstaged: inferred.length,
    // Never shortened: an inferred decision is one nobody sent, so each is shown.
    ...(listed.length ? { items: listed } : {}),
    ...(!verbose && recorded.length > inferred.length ? { note: "The rejected ones are counted, not listed; verbose: true lists every one." } : {}),
  };
}

function notElementsResult(
  decisions: DecisionsFile,
  skipped: number,
  recorded: Array<{ symbol: string; file: string | null; how: NotElementDecision["how"] }>,
  cleared: number,
  _listLimit = MAX_LISTED,
  verbose?: boolean
) {
  const total = Object.keys(decisions.notElements).length;
  if (!total && !skipped && !recorded.length && !cleared) return {};
  return {
    notElements: {
      total,
      skipped,
      ...(recorded.length ? { recorded: recordedSummary(recorded, verbose) } : {}),
      ...(cleared ? { cleared } : {}),
      note: 'Symbols decided not to be elements (rejected, or unstaged after this tool staged them). Runs leave them out; clearRejected forgets them; list: "notElements" lists them.',
    },
  };
}

/** Verify mode, the card step: stage cards as the code names them, never as the plan does. */
function verifyCardStep(undecidedPages: number, readOn?: string, grouped = false): string {
  return (
    "Stage the element cards with model_add, named after the card's symbol (the card's name when it has one), never the plan's element, and never copy plan elements here: " +
    'a layer and type from its candidates (or the undecided.candidateLists entry its candidateList names) or hint, sourceFile = file, sourceSymbol = symbol, sourceProvenance: "extracted". ' +
    `Ask the user about cards you can't place, in one short list. ${readFurther(undecidedPages, readOn, grouped)}`
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
 * What staging depends on, as one string: the base model's manifest timestamp, and the extraction
 * changeset's revision token (or, before it exists, whether a changeset of its name does). Read
 * before Tier 1's network time and again before staging.
 */
async function stagingState(manager: StagingAreaManager, changesetId: string | null, name: string, baseModified: string | undefined): Promise<string> {
  const changeset = changesetId ? await manager.load(changesetId) : await manager.load(name);
  const revision = changeset ? `${changeset.id}@${changeset.status}@${changesetRevisionToken(changeset)}` : "none";
  return `${baseModified ?? ""}|${revision}`;
}

/** The next steps Tier 1's block calls for: relay the notice, the accept band, a configuration to fix. */
function tier1Steps(
  block: Tier1Block | null,
  ctx: { acceptTier1: boolean; accept: number; changeset: string; notShown?: number; uncached?: number; acceptTier1Ignored?: boolean }
): string[] {
  if (!block) return [];
  const steps: string[] = [];
  if (block.state === "misconfigured" || block.state === "no-credentials") {
    steps.push(
      `Tier 1 is ${block.state} for this checkout, so this run was Tier 0 only (tier1.reason). Tell the user; they fix it with \`dr analyzer tier1 status\` and \`dr analyzer tier1 enable\` (no tool changes tier1.json).`
    );
    return steps;
  }
  const asked = (block.sent ?? 0) + (block.failed ?? 0);
  if (asked > 0 || block.state === "capped" || block.state === "unavailable") {
    steps.push("Tell the user what tier1.notice says: who received code from this run, and this month's Tier-1 spend against the cap.");
  }
  if (block.mode === "hide" && block.hidden) {
    steps.push(
      `${block.hidden} card(s) in Tier 1's not-element band were hidden (hide mode: that band is verified on held-out labels; unchanged.tier1NotElement, names in unchanged.tier1NotElementCards). ` +
        "Tell the user; `dr analyzer tier1 set mode suggest` turns the hiding off."
    );
    steps.push(
      `To look at the hidden cards themselves, call codebase_extract with changeset: "${ctx.changeset}" and tier1: false (Tier 0 only, nothing hidden).`
    );
  }
  if (block.mode === "stage") {
    const parts: string[] = [];
    if (block.staged) {
      parts.push(
        `${block.staged} element(s) from Tier 1's accept band were staged without you, with their relationships (stage mode: the model's thresholds are verified on held-out labels; origin.by "tier1", confirmed "auto")`
      );
    }
    if (block.hidden) {
      parts.push(`${block.hidden} card(s) in Tier 1's not-element band were hidden (unchanged.tier1NotElement; their names are in unchanged.tier1NotElementCards)`);
    }
    if (parts.length) {
      steps.push(
        `${parts.join("; ")}. Tell the user: they review the staged elements in the changeset (changeset_unstage removes any they disagree with), ` +
          "and `dr analyzer tier1 set mode suggest` returns Tier 1 to suggestions."
      );
    }
    if (block.hidden) {
      steps.push(
        `To look at the hidden cards themselves (as cards, with Tier 1's hint), call codebase_extract with changeset: "${ctx.changeset}" and tier1: false: Tier 0 only, nothing hidden, ` +
          "or ask the user to run `dr analyzer tier1 set mode suggest` first so they come back as cards with their hint."
      );
    }
    if (ctx.acceptTier1Ignored) {
      steps.push("acceptTier1 was ignored: Tier 1 is in stage mode for this checkout, so this run staged its accept band itself (tier1.modeReason).");
    }
    return steps;
  }
  if (ctx.acceptTier1) {
    if (block.staged) {
      steps.push(
        `${block.staged} element(s) from Tier 1's accept band were staged with their relationships; each staged change's origin says Tier 1 decided it and you confirmed it.`
      );
    }
    const notShown = ctx.notShown ?? 0;
    const uncached = ctx.uncached ?? 0;
    if (notShown || uncached) {
      steps.push(
        `acceptTier1 stages only what an earlier run showed you, from cached answers: ${[
          ...(notShown ? [`${notShown} accept-band answer(s) weren't shown that way before (their cards now say why)`] : []),
          ...(uncached ? [`${uncached} card(s) had no cached answer`] : []),
        ].join(", and ")}. Call codebase_extract with changeset: "${ctx.changeset}" and no acceptTier1 to see Tier 1's answers, show them to the user, then call it with acceptTier1: true again.`
      );
    }
  } else if (ctx.accept > 0) {
    steps.push(
      `${ctx.accept} card(s) carry Tier 1's accept band (tier1.band "accept", listed first). They are suggestions (mode "${block.mode === "hide" ? "hide" : "suggest"}"): show the user each one's tier1 layer and type. ` +
        `Reject, or model_add as you judge, any they disagree with, then call codebase_extract with changeset: "${ctx.changeset}" and acceptTier1: true to stage the rest with their relationships (cached answers only, nothing sent). ` +
        (block.mode === "hide" ? "" : 'Cards with tier1.band "not-element" (listed last) are probably not elements: reject them if you agree.')
    );
  }
  return steps;
}

/**
 * Verify mode with nothing to stage or decide: no as-built changeset exists, so the plan is
 * verified against the model, with extraction's blind spots applied.
 */
function verifyNothingSteps(plan: { id: string; name: string }, since: string): string[] {
  return [
    `Nothing in the range since ${since} is observable to extraction or differs from the model, so no as-built changeset was created: there is none to verify against. '${plan.name}' is still active.`,
    `Call changeset_verify with changeset: "${plan.id}" and against: {base: true, extracted: true}: it compares the plan with the model, and what extraction can't see is unverifiable rather than missing.`,
  ];
}

/** The step for a run whose cards are grouped: decide in bulk before reading any card. */
function triageStep(cards: number, anyNoElement: boolean): string {
  return (
    `${cards} cards is more than a page, so decide them by group first (undecided.groups and byKind), not one at a time: call codebase_extract with ` +
    "decide: [{where: {files, label, visibility, nested, name, ownerType}, as: \"none\" or a layer.type, reason}] and preview: true to get each item's count and a sample, " +
    "then the same without preview to apply it. Add keep: true for a decision that should hold on every later run and checkout (it is written to " +
    `documentation-robotics/${PROJECT_RULES_FILE}). ` +
    (anyNoElement ? "A group marked noElement is in a folder no model element names: ask the user whether it is product code, and decide it none by files when it is not. " : "") +
    "Read what is left with view."
  );
}

function untouchedStep(untouched: number): string {
  return (
    `The cards are the symbols the range changed. ${untouched} more symbol(s) in the changed files have no element and were not touched by the range: ` +
    "they are counted (undecided.untouched), not listed, and rules that name a type did not stage them. view: {changed: false} lists them."
  );
}

function coverageStep(c: { total: number; staged: number; candidates: number; none: number }): string {
  return (
    `Of the ${c.total} element(s) the plan adds that code can show, the as-built side has ${c.staged}: ${c.candidates} have candidate cards and ${c.none} have none (planCoverage). ` +
    "Stage the candidates that are those elements before verifying, at the plan's granularity (one element per module, not one symbol picked to stand for a file); " +
    "a thin as-built makes verify report planned elements and their relationships as missing when they were built."
  );
}

/** Verify mode: cards whose symbol an element of the plan names, and how to stage them as built. */
function plannedStep(cards: number): string {
  return (
    `${cards} card(s) are code an element of the plan names (card.planned; view: {planned: true} lists them): they are those elements as built. ` +
    "Stage each with decide: [{card: <cardId>, as: <the planned element's layer.type>, reason}] (one call for all of them), named after the card, " +
    "so changeset_verify matches them; reject only those the build dropped."
  );
}

function helpersStep(h: SharedHelpers): string {
  return (
    `${h.helpers.length} function(s) or component(s) each realize more than ${h.sharedBy} services (sharedHelpers: ${h.links} links, ${h.staging} staged by this run). ` +
    "Ask the user whether shared helpers belong to every service that calls them; to leave one's links out, decide its relationship as none with keep: true."
  );
}

/** How to read the cards after this page: the cut's paging call when the page was cut. */
/** Where a card's type's required attributes are: on this page, or on the card pages a grouped run points to. */
function requiredWhere(grouped: boolean): string {
  return grouped
    ? "each page of cards, from view: {}, lists them under undecided.requiredAttributes"
    : "undecided.requiredAttributes lists them; spec_type for a type it does not list";
}

function readFurther(undecidedPages: number, readOn?: string, grouped = false): string {
  if (grouped) return `view: {} lists the cards a page at a time (${undecidedPages} pages).`;
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
  readOn?: string,
  grouped = false
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
        ? verifyCardStep(undecidedPages, readOn, grouped)
        : "Decide the undecided cards: for each one that is a model element, call model_add with a layer and type from its candidates " +
            `(the undecided.candidateLists entry its candidateList names, or its hint), the attributes that type requires (${requiredWhere(grouped)}), a name (the card's name when it has one), sourceFile = file, sourceSymbol = symbol and sourceProvenance: "extracted". ` +
            readFurther(undecidedPages, readOn, grouped),
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
      `Then call changeset_verify with changeset: "${previous!.id}" and against: {changeset: "${changeset.id}"}.`,
      verifyLandStep(previous!)
    );
    return steps;
  }
  steps.push("Call changeset_brief to see what the changeset covers and its gaps, then review_open and give the user the link.");
  if (previous) {
    steps.push(
      `'${previous.name}' was active before this call. To check it against this build, call changeset_verify with changeset: "${previous.id}" and against: {changeset: "${changeset.id}"}. Call changeset_activate with "${previous.id}" to resume it.`
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
  readOn?: string,
  grouped = false
): string[] {
  // A since run with a plan active is the verify workflow: the changeset to create is the
  // as-built side, and creating it deactivates the plan.
  const verify = !!since && !!active;
  const steps = [
    verify
      ? `Nothing was staged, so no as-built changeset was created and '${active!.name}' is still active. Before you stage a card or delete a candidate, call changeset_create with name: "${name}" ` +
        `(it becomes active, so model_add and model_delete stage into it and not into the plan).`
      : `Nothing was staged, so no changeset was created or activated. Before you model a card or delete a candidate, call codebase_extract again with ` +
        `changeset: "${name}" and intent (what the user confirmed it is for): it creates that changeset with the extraction's purpose and makes it active, ` +
        `so model_add and model_delete stage into it. changeset_create with name: "${name}" does the same with no intent; without either they would ${active ? `stage into '${active.name}'` : "write the base model"}.`,
  ];
  if (changedCards > 0) {
    steps.push(`${changedCards} card(s) have changedInRange: their lines are new or changed in the range, so they come first. The rest are symbols in the same files that the range didn't touch.`);
  }
  if (undecidedPages > 0) {
    steps.push(
      verify
        ? verifyCardStep(undecidedPages, readOn, grouped)
        : `For each card that is a model element, call model_add (into that changeset) with a layer and type from its candidates (the undecided.candidateLists entry its candidateList names, or its hint), the attributes that type requires (${requiredWhere(grouped)}), ` +
            `a name (the card's name when it has one), sourceFile = file, sourceSymbol = symbol and sourceProvenance: "extracted". ${readFurther(undecidedPages, readOn, grouped)}`,
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
      `Then call changeset_verify with changeset: "${active!.id}" and against: {changeset: "${name}"}.`,
      verifyLandStep(active!, " (changeset_create deactivated it)"),
      `If no card is an element and nothing is deleted, there is no as-built changeset to verify against: call changeset_verify with changeset: "${active!.id}" and against: {base: true, extracted: true} instead.`
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
    ...(waiting.purpose ? { purpose: waiting.purpose } : {}),
    ...(waiting.verifies ? { verifies: waiting.verifies } : {}),
    createdAt: waiting.createdAt,
    cards: [],
    staged: [],
  };
  await writeFile(cardsPath(projectRoot, named.id), JSON.stringify(record), "utf-8");
  await declareExtractionPurpose(manager, named, record);
}

/**
 * Declares a changeset with an extraction record extraction's, by the record's run (a verification
 * record, a reconcile or a bootstrap: extractionPurpose), unless it already declares one of those.
 * A changeset created for waiting cards declared it at creation (creationPurpose); this covers one
 * made otherwise, or before purposes were declared, that a run stages into.
 */
async function declareExtractionPurpose(
  manager: StagingAreaManager,
  changeset: Changeset,
  record: Pick<StoredCards, "since" | "gitHead" | "previousActive" | "purpose" | "verifies">
): Promise<void> {
  if (changeset.purpose && EXTRACTION_PURPOSES.has(changeset.purpose)) return;
  const declared = record.purpose && EXTRACTION_PURPOSES.has(record.purpose) ? readPurpose({ purpose: record.purpose, verifies: record.verifies, scope: record.since ? { since: record.since, codeCommit: record.gitHead } : undefined }) : undefined;
  const declaration = extractionPurpose({ ...record, declared });
  await manager.declarePurpose(changeset.id!, declaration);
  Object.assign(changeset, { purpose: declaration.purpose, verifies: declaration.verifies, scope: declaration.scope });
}

/** The purpose fields a run's record keeps (StoredCards.purpose, .verifies); none for a run with no since. */
function recordedPurpose(decision: ExtractionPurposeDecision | undefined): Pick<StoredCards, "purpose" | "verifies"> {
  if (!decision) return {};
  return { purpose: decision.declaration.purpose, ...(decision.declaration.verifies ? { verifies: decision.declaration.verifies } : {}) };
}

/** The purposes of the changesets codebase_extract stages. */
const EXTRACTION_PURPOSES = new Set<ChangesetPurpose>(["bootstrap", "reconcile", "verification"]);

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
 * neither the base model (as on disk now: the caller passes loadModel's, reread after a landing
 * made outside this process) nor any staged changeset's adds (one may stage it again). A `rejected`
 * decision is never dropped: it lasts until clearRejected. Nor is one whose changeset is still
 * staged (an end unstaged and staged again keeps it) or a cross-model end (`@model/…`). Returns how
 * many went.
 */
async function pruneOrphanedRelationshipDecisions(
  decisions: Decisions,
  model: Model,
  changesets: Changeset[],
  landedIds: Set<string | undefined>
): Promise<number> {
  const candidates = Object.entries(decisions.notRelationships).filter(
    ([, d]) => d.how === "unstaged" && !!d.changesetId && landedIds.has(d.changesetId)
  );
  if (!candidates.length) return 0;
  const known = new Set<string>();
  const base = await ChangesetGraph.build(model, emptyChangeset());
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
 * What a `reject` names, one symbol per entry, and the entries it can't place ({@link RejectProblem}).
 * An entry may be a cardId (of the last run, or an earlier run's card the agent has modelled
 * since), an element id the extraction staged, or a symbol (bare, file#symbol or qualified name)
 * that only one of those has.
 */
function cardsToReject(
  stored: StoredCards | null,
  fromChangeset: Rejectable[],
  changesetName: string,
  refs: Array<{ card: string; reason: string; index: number }>
): { found: Array<{ file: string | null; symbol: string; label?: string; reason: string; index: number }>; problems: RejectProblem[] } {
  const known: Rejectable[] = [
    ...(stored?.cards ?? []).map((c) => ({ file: c.file, symbol: c.symbol, label: c.label, cardId: c.cardId, qualifiedName: c.qualifiedName })),
    ...(stored?.earlierCards ?? []).map((c) => ({ file: c.file, symbol: c.symbol, label: c.label, cardId: c.cardId, qualifiedName: c.qualifiedName })),
    ...(stored?.staged ?? []).map((s) => ({ file: s.file, symbol: s.symbol, label: s.label, elementId: s.id })),
    ...fromChangeset,
  ];
  const found: Array<{ file: string | null; symbol: string; label?: string; reason: string; index: number }> = [];
  const problems: RejectProblem[] = [];
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
    if (!known.length) {
      problems.push({ index: ref.index, item: `card: ${ref.card}`, status: "unknown", message: `no cards recorded for '${changesetName}' to reject from` });
      continue;
    }
    // An element id names the element: every symbol it names (one per source location).
    const ofElement = known.filter((k) => k.elementId === ref.card);
    if (ofElement.length) {
      for (const d of distinctSymbols(ofElement)) found.push({ file: d.file, symbol: d.symbol, label: d.label, reason: ref.reason, index: ref.index });
      continue;
    }
    const byCard = known.filter((k) => k.cardId === ref.card);
    const matches = byCard.length
      ? byCard
      : known.filter((k) => namesCode(k, ref.card));
    const distinct = distinctSymbols(matches);
    if (distinct.length === 1) found.push({ file: distinct[0].file, symbol: distinct[0].symbol, label: distinct[0].label, reason: ref.reason, index: ref.index });
    else if (distinct.length > 1) {
      problems.push({
        index: ref.index,
        item: `card: ${ref.card}`,
        status: "ambiguous",
        message: `names more than one card: ${distinct.map((d) => d.cardId ?? `${d.file ?? ""}#${d.symbol}`).join(", ")}`,
      });
    } else {
      problems.push({ index: ref.index, item: `card: ${ref.card}`, status: "unknown", message: `not among the cards or staged symbols of '${changesetName}'` });
    }
  }
  return { found, problems };
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

/**
 * A `reject` item that was not applied: it is malformed, or names nothing this extraction has. The
 * other items of the call are still recorded (#1213).
 */
interface RejectProblem {
  /** The item's place in the call's `reject` list, from 0. */
  index: number;
  /** What the item named, as sent (`files: docs/**`). */
  item: string;
  status: "malformed" | "no-match" | "unknown" | "ambiguous" | "decided";
  message: string;
}

/** A reject's items by what they name; an item that doesn't name exactly one of card, files and relationship is a problem. */
function splitRejects(items: RejectItem[]) {
  const cards: Array<{ card: string; reason: string; index: number }> = [];
  const files: FilesRef[] = [];
  const relationships: Array<{ relationship: RelationshipRef; reason: string; index: number }> = [];
  /** `files` plus `predicate`: every relationship with the predicate whose source is sourced in those files. */
  const groups: Array<{ files: string; predicate: string; reason: string; index: number }> = [];
  const problems: RejectProblem[] = [];
  items.forEach((item, index) => {
    if (item.predicate !== undefined) {
      if (item.files === undefined || item.card !== undefined || item.relationship !== undefined || item.except !== undefined || item.keep) {
        problems.push({ index, item: `predicate: ${item.predicate}`, status: "malformed", message: "predicate goes with files alone (no card, relationship, except or keep): files plus predicate rejects the relationships of that predicate staged now, in this checkout" });
      } else groups.push({ files: item.files, predicate: item.predicate, reason: item.reason, index });
      return;
    }
    const named = (["card", "files", "relationship"] as const).filter((k) => item[k] !== undefined);
    if (named.length !== 1) {
      problems.push({
        index,
        item: named.length ? named.join(" and ") : "(nothing)",
        status: "malformed",
        message: `names ${named.length ? named.join(" and ") : "none of card, files and relationship"}: each item names exactly one of them`,
      });
    } else if (item.except !== undefined && item.files === undefined) {
      problems.push({
        index,
        item: "card or relationship with except",
        status: "malformed",
        message: "except goes with files: it leaves cards out of a files item",
      });
    } else if (item.keep && item.except?.length) {
      problems.push({
        index,
        item: `files: ${item.files}`,
        status: "malformed",
        message: "keep can't carry except: a kept rule covers its whole pattern. Keep a narrower pattern, or decide with a where",
      });
    } else if (item.card !== undefined) cards.push({ card: item.card, reason: item.reason, index });
    else if (item.files !== undefined) files.push({ files: item.files, reason: item.reason, index, ...(item.except ? { except: item.except } : {}) });
    else relationships.push({ relationship: item.relationship!, reason: item.reason, index });
  });
  return { cards, files, relationships, groups, problems };
}

/** A `files` reject item: the pattern, and the cards it must leave out (`except`). */
type FilesRef = { files: string; reason: string; index: number; except?: string[] };

/** Why a files reject leaves a card out: an element names it, the plan names it, this call's decide items decided it, or except names it. */
type FilesSkip = "modelled" | "planned" | "decided" | "excepted";
type FilesSkipped = Partial<Record<FilesSkip, number>>;

/**
 * The one files reject (#1254, #1394): the cards given (the last run's, or the ones a run's decide
 * items left) in matching files, as card refs (the first reason wins for a card two patterns match),
 * less the cards it must leave out. `skip` says why a card is left out (an element or the plan names
 * it, or this call's decide items decided it); the item's `except` names more. Each left-out card is
 * counted under its reason. A pattern no card is in, or an `except` entry that names none of its
 * cards, is a problem: that item records nothing, so a typo never records the card it meant to keep,
 * and the other items still apply.
 */
function filesReject(
  cards: readonly UndecidedCard[],
  refs: FilesRef[],
  changesetName: string,
  skip: (card: UndecidedCard) => Exclude<FilesSkip, "excepted"> | null
): { refs: Array<{ card: string; reason: string; index: number }>; problems: RejectProblem[]; skipped: Map<number, FilesSkipped> } {
  const out = new Map<string, { reason: string; index: number }>();
  const problems: RejectProblem[] = [];
  const skipped = new Map<number, FilesSkipped>();
  for (const ref of refs) {
    const match = filesMatcher(ref.files);
    const hits = cards.filter((c) => {
      const file = normFile(c.file);
      return !!file && match(file);
    });
    if (!hits.length) {
      problems.push({ index: ref.index, item: `files: ${ref.files}`, status: "no-match", message: `no undecided card of '${changesetName}' is in '${ref.files}'` });
      continue;
    }
    const unmatched = (ref.except ?? []).filter((x) => !cardsNamed(hits, x).length);
    if (unmatched.length) {
      problems.push({
        index: ref.index,
        item: `files: ${ref.files}`,
        status: "no-match",
        message:
          `except names no card in '${ref.files}': ${unmatched.join(", ")}. Nothing was recorded for this item, so no card meant to be kept was taken; ` +
          "send it again with the cardId, symbol or file#symbol the cards list",
      });
      continue;
    }
    const excepted = new Set((ref.except ?? []).flatMap((x) => cardsNamed(hits, x).map((c) => c.cardId)));
    const counts: FilesSkipped = {};
    for (const c of hits) {
      const why: FilesSkip | null = excepted.has(c.cardId) ? "excepted" : skip(c);
      if (why) counts[why] = (counts[why] ?? 0) + 1;
      else if (!out.has(c.cardId)) out.set(c.cardId, { reason: ref.reason, index: ref.index });
    }
    if (Object.keys(counts).length) skipped.set(ref.index, counts);
  }
  return { refs: [...out].map(([card, { reason, index }]) => ({ card, reason, index })), problems, skipped };
}

/** A "not an element" decision for one symbol, as every path that records one writes it. */
function notElementRecord(
  card: { file: string | null; symbol: string; label?: string },
  reason: string,
  how: NotElementDecision["how"],
  changeset: { name: string; id?: string | null },
  at: string
): NotElementDecision {
  return {
    file: card.file,
    symbol: card.symbol,
    ...(card.label ? { label: card.label } : {}),
    reason,
    how,
    changeset: changeset.name,
    ...(changeset.id ? { changesetId: changeset.id } : {}),
    at,
  };
}

/**
 * Why a rejected card can't be kept as a rule, so it is recorded in this checkout instead (#1332):
 * a decision record's card (rules decide code symbols; decision records are planned apart), or a card
 * with no file (a rule on its symbol alone would hide that symbol in every file). Null when it can.
 */
function unkeepable(card: { file: string | null; label?: string }): string | null {
  if (card.label === "ADR") return "a decision record's card: rules decide code symbols, not decision records";
  if (!card.file) return "it has no file, and a rule on its symbol alone would match that symbol in every file";
  return null;
}

/** The `file#symbol` keys ({@link decisionKey}) the live elements of a graph name: code an element models. */
function modelledKeys(graph: ChangesetGraph, into = new Set<string>()): Set<string> {
  for (const e of graph.elements.values()) {
    if (e.status === "deleted") continue;
    for (const l of e.sourceReference?.locations ?? []) if (l.symbol) into.add(decisionKey(normFile(l.file), l.symbol));
  }
  return into;
}

/**
 * The code a plan's elements name, by {@link decisionKey}, with the planned element's id: the
 * source references of the elements it adds or updates.
 */
function plannedKeys(plan: Changeset | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of (plan?.changes ?? []) as StagedChange[]) {
    if ((c.type !== "add" && c.type !== "update") || !c.after) continue;
    const after = c.after as Record<string, unknown>;
    const id = typeof after.path === "string" && after.path ? after.path : c.elementId;
    for (const l of stagedSourceReference(after)?.locations ?? []) {
      if (!l.symbol || !l.file) continue;
      const key = decisionKey(normFile(l.file), l.symbol);
      if (!out.has(key)) out.set(key, id);
    }
  }
  return out;
}

/** A regular expression that matches exactly this text. */
function exactly(text: string): string {
  return `^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
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
 * unstaged since), one the changeset or the base model has, or one a decision already names; the
 * others are problems, so a mistyped one records nothing. Ends are resolved through the graph (a
 * UUID becomes its dotted id), so the decision is keyed as runs and unstaging key it.
 */
function relationshipsToReject(
  refs: Array<{ relationship: RelationshipRef; reason: string; index: number }>,
  stored: StoredCards | null,
  changeset: Changeset | null,
  graph: ChangesetGraph,
  decisions: Decisions,
  changesetName: string
): { found: Array<RelationshipRef & { key: string; reason: string; index: number }>; problems: RejectProblem[] } {
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
  const found: Array<RelationshipRef & { key: string; reason: string; index: number }> = [];
  const problems: RejectProblem[] = [];
  for (const { relationship: given, reason, index } of refs) {
    const r = resolvedTriple(given, graph);
    const key = relationshipKey(r);
    if (known.has(key) || graph.getRelationship(r.source, r.predicate, r.target) || decisions.notRelationships[key]) {
      found.push({ source: r.source, predicate: r.predicate, target: r.target, key, reason, index });
    } else {
      problems.push({
        index,
        item: `relationship: ${key}`,
        status: "unknown",
        message: `not a relationship '${changesetName}' stages or staged, nor one the model has`,
      });
    }
  }
  return { found, problems };
}

/**
 * The live relationships with `predicate` whose source element names code in `files` (a path or
 * glob): a file's test links as a group (#1412).
 */
function relationshipsInFiles(graph: ChangesetGraph, files: string, predicate: string): RelationshipRef[] {
  const match = filesMatcher(files);
  const out: RelationshipRef[] = [];
  for (const r of graph.relationships()) {
    // Links the base model already has (wired by hand, or landed) are not extraction's to reject as a group.
    if (r.predicate !== predicate || r.status === "deleted" || r.status === "unchanged") continue;
    const source = graph.getElement(r.source);
    const hit = (source?.sourceReference?.locations ?? []).some((l) => typeof l.file === "string" && match(normFile(l.file) ?? ""));
    if (hit) out.push({ source: r.source, predicate: r.predicate, target: r.target });
  }
  return out;
}

function notRelationshipsResult(
  decisions: Decisions,
  skipped: number,
  recorded: Array<RelationshipRef & { how: NotRelationshipDecision["how"] }>,
  cleared: number,
  _listLimit = MAX_LISTED,
  verbose?: boolean
) {
  const total = Object.keys(decisions.notRelationships).length;
  if (!total && !skipped && !recorded.length && !cleared) return {};
  return {
    notRelationships: {
      total,
      skipped,
      ...(recorded.length ? { recorded: recordedSummary(recorded, verbose) } : {}),
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
    `add them to .cbmignore at the codebase root (${lines}; gitignore syntax) so they aren't indexed, and have the user commit it ` +
    "(git add -f .cbmignore: DR's local exclude hides it until it is tracked, and an uncommitted line reaches no other checkout or clone), " +
    `re-index with codebase_index and call codebase_extract again; or record their cards with reject: [{files: "${c.folders[0].folder}**", reason}].`
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

/**
 * Whether a call indexes first (#1347), the one place that decides it: only a run does, unless
 * autoIndex is false. A preview never does, since it changes nothing and an index run writes .dr/
 * (and may write .cbmignore); a page, view or list reads the last run's record; a call that only
 * rejects or clears decisions records them. Those are refused on a stale index, as before. A batch
 * file may hold decide items, so a call with one counts as a run. decide with view is a run that
 * answers with the view's page of the cards left (#1350), so it indexes first like any run.
 */
export function indexesFirst(args: CodebaseExtractArgs): boolean {
  if (args.autoIndex === false || args.preview === true || args.list !== undefined) return false;
  const mayDecide = !!args.decide?.length || !!args.file;
  if (args.view !== undefined) return mayDecide;
  if ((args.page ?? 1) > 1) return false;
  return !(!mayDecide && (!!args.reject?.length || args.clearRejected !== undefined));
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

      // The recorded decisions are the checkout's, not a run's: listed with or without a run, whatever
      // the index or the commit (#1332). Only decisions.json is read.
      if (args.list === "notElements" && !args.reject?.length && !args.decide?.length && args.clearRejected === undefined && !args.file) {
        const decisions = await readDecisions(projectRoot);
        const limit = args.limit ?? MAX_LISTED;
        const items = Object.entries(decisions.notElements).map(([key, d]) => ({ key, symbol: d.symbol, file: d.file, how: d.how, reason: d.reason }));
        return jsonResult(
          {
            list: "notElements",
            note:
              "This checkout's recorded not-an-element decisions (.dr/analyzers/extract/decisions.json; git ignores it). " +
              "decide with keep: true turns them into rules other checkouts apply, and retires the records its rule covers.",
            ...pageOf(items, limit, args.offset ?? 0, (next) => `Call codebase_extract with list: "notElements", limit: ${limit} and offset: ${next} for the next ones.`),
          },
          { compact: true }
        );
      }

      // A run builds a missing or stale index first, within its budget (#1347); other calls refuse as before.
      const indexing = indexesFirst(args)
        ? await indexFirst({ projectRoot, codebaseRoot }, deps, {
            tool: "codebase_extract",
            deadline: indexFirstDeadline(startedAt, deadline),
            uncommittedEdits: true,
            signal: context?.signal,
          })
        : null;
      const { analyzer, freshness, index: indexJudgement } = await requireFreshIndex(projectRoot, codebaseRoot, deps, "codebase_extract", {
        uncommittedEdits: true,
        ...(indexing ? { assessment: indexing.assessment, indexedFirst: indexing.indexedFirst } : {}),
      });
      const head = freshness.currentGitHead;

      const manager = new StagingAreaManager(model.rootPath, model);
      const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
      // The page size asked for is the page size: a page too large for the response budget is cut, and says how to read on.
      const effectivePageSize = pageSize;
      const baseModified = model.manifest.modified;
      // reject and decide items, inline or from a file (batch-file.ts: one JSON object holding the lists).
      let rejectItems: RejectItem[] = args.reject ?? [];
      let decideItems = args.decide ?? [];
      if (args.file) {
        if (args.reject?.length || args.decide?.length) {
          throw new CLIError("codebase_extract: send either file or the inline reject and decide lists, not both", ErrorCategory.USER, [
            'Put both lists in the file ({"reject": [...], "decide": [...]}), or send them inline',
          ]);
        }
        const fromFile = await readBatchFile("codebase_extract", args.file, model.rootPath, {
          reject: z.array(rejectItemSchema).optional(),
          decide: z.array(decideItemSchema).optional(),
        });
        rejectItems = fromFile.reject ?? [];
        decideItems = fromFile.decide ?? [];
      }
      // decide with view is a run that answers with that view's page of the cards left (#1350).
      const viewAfterRun = decideItems.length > 0 && args.view !== undefined && args.list === undefined;
      // A view or a list reads the last run's record, as a later page does: nothing is extracted or staged.
      const reading = !viewAfterRun && (args.view !== undefined || args.list !== undefined);
      const paging = !viewAfterRun && ((args.page ?? 1) > 1 || reading);
      if (paging && decideItems.length) {
        throw new CLIError("decide is applied in a run; it can't be combined with list, or with page without view", ErrorCategory.USER, [
          "Call codebase_extract with decide and the run's own arguments (changeset, or since and layers); add view: {} (and page) to get the cards left",
        ]);
      }
      // A call that only rejects cards or clears decisions records them and runs nothing.
      const decisionsOnly = !paging && !decideItems.length && (rejectItems.length > 0 || args.clearRejected !== undefined);
      // A preview counts what a run would do, and stages and records nothing: with reject or
      // clearRejected only, it says what they would record or clear (#1322).
      const preview = args.preview === true;
      // preview with page, view or list reads the last preview's record.
      const previewRead = preview && paging;
      // acceptTier1 is a run: it stages Tier 1's accept band, so it needs Tier 1 and a run to stage in.
      let acceptTier1 = args.acceptTier1 === true;
      // acceptTier1 in stage mode: run as a normal run (which stages the accept band) and say so.
      let acceptTier1Ignored = false;
      if (acceptTier1 && (paging || decisionsOnly || preview || args.tier1 === false)) {
        throw new CLIError("acceptTier1 stages Tier 1's accept band in a run; it can't be combined with page, reject, clearRejected, preview or tier1: false", ErrorCategory.USER, [
          "Call codebase_extract with acceptTier1: true and the run's own arguments (changeset, or since and layers)",
        ]);
      }
      const rejects = rejectItems.length ? splitRejects(rejectItems) : null;
      // The project's own rules (documentation-robotics/extraction-rules.yaml), for a run.
      let fileRules = paging || decisionsOnly ? [] : await loadProjectRules(projectRoot);

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
        if (args.purpose && stored.purpose && args.purpose !== stored.purpose) {
          conflicts.push(`purpose: ${args.purpose} (its run was a ${stored.purpose})`);
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
      // Refused before anything runs, spends or writes (a preview included).
      if (args.purpose && !since) {
        throw new CLIError("codebase_extract: purpose says what a since run is for; this run has no since (it is a bootstrap)", ErrorCategory.USER, [
          "Pass since (the ref the work started from), or leave purpose out",
        ]);
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

      // Tier 1, for a run (not a page, a decisions call or a preview, which ask it nothing):
      // tier1.json resolved and the model built from it, without a request. tier1: false reads no
      // tier1.json at all.
      const tier1Session: Tier1Session | null =
        paging || decisionsOnly || preview || args.tier1 === false ? null : await openExtractTier1(projectRoot, analyzer, codebaseRoot, { ...(deps.tier1 ?? {}), ...(deps.tier1Spec ? { spec: deps.tier1Spec } : {}) });
      if (acceptTier1) {
        if (tier1Session?.state !== "ready") {
          throw new CLIError(
            `acceptTier1 needs Tier 1, which is ${tier1Session?.state ?? "off"} for this checkout${tier1Session?.block.reason ? `: ${tier1Session.block.reason}` : ""}`,
            ErrorCategory.USER,
            ["Stage the cards with model_add instead; the user enables Tier 1 with `dr analyzer tier1 enable`"]
          );
        }
        if (!tier1Session.thresholds) {
          throw new CLIError(
            `acceptTier1 needs Tier 1's accept band, and ${tier1Session.model.id.canonicalModel} has no thresholds for ${tier1Session.qset}: every card escalates with its hint`,
            ErrorCategory.USER,
            ["Stage the cards with model_add, using their tier1 hints"]
          );
        }
        if (tier1Session.mode === "stage") {
          // Stage mode stages the accept band itself: the call is a normal run, and says so.
          acceptTier1 = false;
          acceptTier1Ignored = true;
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
      // The project's write lock (shared.ts), taken before the check that the model didn't move and
      // held through staging and activation, so no other tool's write lands in between.
      let releaseWriteLock: (() => void) | undefined;
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
        const landedIds = new Set(allChangesets.filter((c) => c.status === "committed" || c.status === "recorded").map((c) => c.id));
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
        if (!paging && !preview && (await pruneOrphanedRelationshipDecisions(decisions, await loadModel(args.rootPath), allChangesets, landedIds))) {
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
        const rejectProblems: RejectProblem[] = [];
        /** Cards a files item covered, by the item's index. */
        const rejectedPerItem = new Map<number, number>();
        /** Cards a files item left out, by why (#1254, #1394), by the item's index. */
        const skippedPerItem = new Map<number, FilesSkipped>();
        /** Items written as rules (keep: true), by index, with the rule's name (#1332). */
        const keptRejects = new Map<number, string>();
        /** A kept item's cards no rule can hold, recorded in this checkout instead: how many, and why. */
        const notKept = new Map<number, { cards: number; why: string }>();
        /** Rules the kept reject items write, once the call's checks pass (none in a preview). */
        const rulesToKeep: ProjectRule[] = [];
        const rejectedAt = new Date().toISOString();
        const keepAt = (index: number) => rejectItems[index]?.keep === true;
        // A files item in a call with decide waits for the run: decide applies first, and the item
        // covers only the cards it left undecided (#1394).
        const deferredFiles: FilesRef[] = decideItems.length && rejects ? rejects.files : [];
        // Names a kept rule may not take: the rules file's (a rule of the same name would be replaced).
        const keepsRules = rejectItems.some((r) => r.keep);
        const takenRuleNames = new Set(keepsRules ? (await loadProjectRules(projectRoot)).map((r) => r.rule.name) : []);
        const keptRuleFor = (index: number, rule: Omit<ProjectRule, "name">): void => {
          const ruleName = ruleNameFor(rule, takenRuleNames);
          takenRuleNames.add(ruleName);
          rulesToKeep.push({ name: ruleName, ...rule });
          keptRejects.set(index, keptRejects.has(index) ? `${keptRejects.get(index)}, ${ruleName}` : ruleName);
        };
        // A kept rule the file already holds under another name is reported under that name.
        const keptUnder = (ruleName: string, existing: string | undefined) => {
          if (!existing) return;
          for (const [index, names] of keptRejects) keptRejects.set(index, names.split(", ").map((n) => (n === ruleName ? existing : n)).join(", "));
        };
        const noteNotKept = (index: number, why: string) => {
          const n = notKept.get(index);
          notKept.set(index, { cards: (n?.cards ?? 0) + 1, why: n?.why ?? why });
        };
        /** Kept files items no rule may be written for, with why: their cards are recorded here. */
        const refusedFiles = new Map<number, string>();
        /**
         * The kept files items whose cards a rule can hold (#1332): a rule on the pattern is written
         * for each, once, when one of its cards is code. Not when the item left out cards the plan
         * names or this call's decide items decided: a none rule on the pattern would take those on
         * the next run (the planned ones verify needs staged; a typed item sent again loses to a none
         * rule). The others' cards are recorded here, and refusedFiles says why.
         */
        const keepFilesRules = (items: FilesRef[], taken: ReadonlyArray<{ index: number; card: { file: string | null; label?: string } }>, label: string) => {
          const ruled = new Set<number>();
          for (const f of items) {
            if (!keepAt(f.index) || rejectProblems.some((p) => p.index === f.index)) continue;
            const skipped = skippedPerItem.get(f.index);
            if (skipped?.planned || skipped?.decided) {
              const what = [
                ...(skipped.planned ? [`${skipped.planned} card(s) the plan names`] : []),
                ...(skipped.decided ? [`${skipped.decided} card(s) this call's decide items decided`] : []),
              ].join(" and ");
              refusedFiles.set(f.index, `its pattern also covers ${what}, which a rule on it would take from the next run on`);
              continue;
            }
            if (!taken.some((t) => t.index === f.index && !unkeepable(t.card))) continue;
            keptRuleFor(f.index, { where: { files: f.files }, as: "none", reason: f.reason, decided: { at: rejectedAt, changeset: label } });
            ruled.add(f.index);
          }
          return ruled;
        };
        const NO_CODE_CARD = "its pattern covers no code card for a rule to hold";
        if (rejects) {
          const changesetLabel = changeset?.name ?? stored?.changesetName ?? name;
          const changesetRef = { name: changesetLabel, id: changeset?.id ?? null };
          const extractionChangeset = changeset && stored ? changeset : null;
          const graph = extractionChangeset ? await ChangesetGraph.build(model, extractionChangeset) : null;
          // Everything is checked before anything is recorded.
          const relationshipGraph = rejects.relationships.length || rejects.groups.length ? (graph ?? (await ChangesetGraph.build(model, changeset ?? emptyChangeset()))) : null;
          // A files + predicate item stands for each relationship of that predicate whose source element is sourced in those files.
          const groupProblems: RejectProblem[] = [];
          const groupRefs: typeof rejects.relationships = [];
          for (const g of rejects.groups) {
            const hits = relationshipGraph ? relationshipsInFiles(relationshipGraph, g.files, g.predicate) : [];
            if (!hits.length) {
              groupProblems.push({ index: g.index, item: `files: ${g.files}, predicate: ${g.predicate}`, status: "no-match", message: `no '${g.predicate}' relationship of '${changesetLabel}' or the model has a source element in '${g.files}'` });
            }
            for (const relationship of hits) groupRefs.push({ relationship, reason: g.reason, index: g.index });
          }
          const fromRelationships = relationshipGraph
            ? relationshipsToReject([...rejects.relationships, ...groupRefs], stored, changeset, relationshipGraph, decisions, changesetLabel)
            : { found: [], problems: [] };
          fromRelationships.problems.push(...groupProblems);
          for (const r of fromRelationships.found) if (rejects.groups.some((g) => g.index === r.index)) rejectedPerItem.set(r.index, (rejectedPerItem.get(r.index) ?? 0) + 1);
          // The code an element names now, in the extraction changeset (or the base) and in the
          // active changeset when it is another (a plan): a files item leaves those cards out, and
          // the cards a plan's elements name (card.planned).
          const filesNow = deferredFiles.length ? [] : rejects.files;
          let modelled: Set<string> | null = null;
          if (filesNow.length) {
            modelled = modelledKeys(graph ?? (await ChangesetGraph.build(model, changeset ?? emptyChangeset())));
            const activeId = await manager.getActiveId();
            const active = activeId && activeId !== changeset?.id ? await manager.load(activeId) : null;
            if (active?.status === "staged") modelledKeys(await ChangesetGraph.build(model, active), modelled);
          }
          const inFiles = filesReject(stored?.cards ?? [], filesNow, changesetLabel, (c) =>
            c.planned ? "planned" : modelled?.has(decisionKey(normFile(c.file), c.symbol)) ? "modelled" : null
          );
          for (const [index, counts] of inFiles.skipped) skippedPerItem.set(index, counts);
          // A card a decide item of this call names is decide's: the reject item says so and records nothing.
          const decideKeys = new Set<string>();
          for (const d of decideItems) {
            if (d.card === undefined) continue;
            const known = [...(stored?.cards ?? []), ...((stored?.earlierCards ?? []) as CardRef[])];
            for (const c of cardsNamed(known, d.card)) decideKeys.add(decisionKey(normFile(c.file), c.symbol));
            decideKeys.add(d.card);
          }
          const cardRefs = [...rejects.cards, ...inFiles.refs];
          const fromCards = cardRefs.length
            ? cardsToReject(stored, changesetRejectables(extractionChangeset, graph), changesetLabel, cardRefs)
            : { found: [], problems: [] };
          const decidedHere: RejectProblem[] = [];
          if (decideKeys.size) {
            const decidedItems = new Set(rejects.cards.filter((c) => decideKeys.has(c.card)).map((c) => c.index));
            fromCards.found = fromCards.found.filter((f) => {
              const decided = decidedItems.has(f.index) || decideKeys.has(decisionKey(normFile(f.file), f.symbol));
              if (decided && !decidedHere.some((p) => p.index === f.index)) {
                decidedHere.push({
                  index: f.index,
                  item: `card: ${f.symbol}`,
                  status: "decided",
                  message: "a decide item of this call names the same card, and decide wins: nothing recorded for it",
                });
              }
              return !decided;
            });
          }
          // An item that names nothing is reported and the rest are recorded (#1213); a call in
          // which no item applies is refused, as a mistyped single reject was before.
          rejectProblems.push(...rejects.problems, ...fromRelationships.problems, ...inFiles.problems, ...fromCards.problems, ...decidedHere);
          rejectProblems.sort((a, b) => a.index - b.index);
          if (rejectProblems.length && !fromRelationships.found.length && !fromCards.found.length && !deferredFiles.length && !decidedHere.length) {
            throw new CLIError(
              `Can't reject: ${rejectProblems.map((p) => `${p.item} (${p.message})`).join("; ")}. Nothing was recorded`,
              ErrorCategory.USER,
              [
                "Pass the cardId (or file#symbol) of a card, or the id of an element this extraction staged",
                "For files, a file, folder or glob relative to the codebase root, as the cards' file gives it (docs/**, scripts/)",
                "For a relationship, source, predicate and target as the staged relationship names them (changeset_show lists them)",
              ]
            );
          }
          const rejectedRelationships = fromRelationships.found;
          const rejected = fromCards.found;
          for (const ref of inFiles.refs) rejectedPerItem.set(ref.index, (rejectedPerItem.get(ref.index) ?? 0) + 1);
          // A kept files item is a rule on its pattern; the cards it covers now are that rule's.
          const filesItems = new Set(filesNow.map((f) => f.index));
          const ruledFiles = keepFilesRules(
            filesNow,
            rejected.map((card) => ({ index: card.index, card })),
            changesetLabel
          );
          // A relationship still staged in the extraction changeset is unstaged; one the base model
          // has stays (rejecting is about what extraction stages).
          const stagedNow = stagedRelationshipAdds(extractionChangeset, relationshipGraph);
          for (const r of rejectedRelationships) {
            if (keepAt(r.index)) {
              keptRuleFor(r.index, {
                relationship: { source: r.source, predicate: r.predicate, target: r.target },
                as: "none",
                reason: r.reason,
                decided: { at: rejectedAt, changeset: changesetLabel },
              });
            } else {
              decisions.notRelationships[r.key] = {
                source: r.source,
                predicate: r.predicate,
                target: r.target,
                reason: r.reason,
                how: "rejected",
                changeset: changesetLabel,
                ...(changeset ? { changesetId: changeset.id! } : {}),
                at: rejectedAt,
              };
              recordedRelationshipsNow.push({ source: r.source, predicate: r.predicate, target: r.target, how: "rejected" });
            }
            const inGraph = relationshipGraph!.getRelationship(r.source, r.predicate, r.target);
            if (stagedNow.has(r.key)) relationshipsToUnstage.push(r);
            else if (inGraph && (inGraph.status === "unchanged" || inGraph.alreadyInBase)) relationshipsInBase.push(r.key);
          }
          const rejectedKeys = new Map<string, string>();
          for (const card of rejected) {
            const key = decisionKey(card.file, card.symbol);
            rejectedKeys.set(key, card.symbol);
            if (keepAt(card.index)) {
              const why = unkeepable(card);
              if (!why && filesItems.has(card.index) && ruledFiles.has(card.index)) continue;
              if (!why && !filesItems.has(card.index)) {
                // A card kept is a rule on its file and symbol. It was named one at a time, as a recorded
                // decision is, so it holds over Tier 0 as that decision did (overrideTier0).
                keptRuleFor(card.index, {
                  // The file exactly: a path with glob characters names only itself.
                  where: { file: card.file!, symbol: exactly(card.symbol) },
                  as: "none",
                  reason: card.reason,
                  overrideTier0: true,
                  decided: { at: rejectedAt, changeset: changesetLabel },
                });
                continue;
              }
              noteNotKept(card.index, why ?? refusedFiles.get(card.index) ?? NO_CODE_CARD);
            }
            decisions.notElements[key] = notElementRecord(card, card.reason, "rejected", changesetRef, rejectedAt);
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
        // Kept reject items go in the project's rules file (a preview writes nothing), and a run applies them.
        if (!preview && rulesToKeep.length) {
          for (const rule of rulesToKeep) keptUnder(rule.name, (await saveProjectRule(projectRoot, rule)).duplicateOf);
          if (!paging && !decisionsOnly) fileRules = await loadProjectRules(projectRoot);
        }
        if (!preview && (pruned || cleared || clearedRelationships || recordedNow.length || recordedRelationshipsNow.length)) {
          await writeDecisions(projectRoot, decisions);
        }
        const notElementKeys = new Set(Object.keys(decisions.notElements));

        // Unstage what was rejected while staged, with the relationships staged for it, so the
        // decision holds now and not only once the changeset lands. A preview unstages nothing.
        const unstaged: Array<{ id: string; symbol: string; changes: number }> = [];
        const unstageFailed: Array<{ id: string; error: string }> = [];
        for (const [id, symbol] of preview ? [] : toUnstage) {
          const result = await changesetUnstageHandler({ elementId: id, changeset: changeset!.id!, rootPath: args.rootPath });
          const body = JSON.parse((result.content[0] as { text: string }).text) as {
            unstaged?: unknown[];
            unstagedCount?: number;
            error?: string;
            message?: string;
          };
          // unstagedCount is every change removed; unstaged lists only the first of them.
          const removed = body.unstagedCount ?? body.unstaged?.length ?? 0;
          if (result.isError) unstageFailed.push({ id, error: body.error ?? body.message ?? "unstage failed" });
          else if (removed > 0) unstaged.push({ id, symbol, changes: removed });
        }
        const unstagedRels: string[] = [];
        for (const r of preview ? [] : relationshipsToUnstage) {
          const result = await changesetUnstageHandler({
            source: r.source,
            predicate: r.predicate,
            target: r.target,
            changeset: changeset!.id!,
            rootPath: args.rootPath,
          });
          const body = JSON.parse((result.content[0] as { text: string }).text) as {
            unstagedCount?: number;
            error?: string;
            message?: string;
          };
          if (result.isError) unstageFailed.push({ id: r.key, error: body.error ?? body.message ?? "unstage failed" });
          else if ((body.unstagedCount ?? 0) > 0) unstagedRels.push(r.key);
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
        // Each reject item's result, in the shape of the other batch writes (batch-result.ts): counts
        // over the whole call, and in full only the items that did nothing. A preview's say what a
        // call without preview would do (#1322). A files item deferred until the run's decide items
        // applied gets its result once they have.
        const problemAt = new Map(rejectProblems.map((p) => [p.index, p] as const));
        type RejectResult = BatchItemResult & FilesSkipped & { item?: string; recorded?: number; rule?: string; recordedLocally?: number; notKept?: string };
        const rejectItemResult = (index: number): RejectResult => {
          const item = rejectItems[index];
          const problem = problemAt.get(index);
          if (problem) return { index, status: problem.status, item: problem.item, reason: problem.message };
          const kept = keptRejects.get(index);
          const local = notKept.get(index);
          return {
            index,
            status: kept ? (preview ? "would-keep" : "kept") : preview ? "would-record" : "recorded",
            ...(kept ? { rule: kept } : {}),
            ...(item.files !== undefined ? { recorded: rejectedPerItem.get(index) ?? 0 } : {}),
            ...skippedPerItem.get(index),
            // A kept item's cards no rule can hold: recorded in this checkout, with why (#1332).
            ...(local
              ? { recordedLocally: local.cards, notKept: `${local.cards} card(s) recorded in this checkout, not as a rule: ${local.why}` }
              : refusedFiles.has(index)
                ? { notKept: `No rule written: ${refusedFiles.get(index)}` }
                : {}),
          };
        };
        const rejectSection = () => {
          const results = rejectItems.map((_, index) => rejectItemResult(index));
          const recordedLocally = !preview && results.some((r) => r.status === "recorded" || r.recordedLocally);
          const skippedModelled = results.reduce((n, r) => n + (r.modelled ?? 0) + (r.planned ?? 0) + (r.decided ?? 0), 0);
          return {
            ...(rejectItems.length
              ? {
                  reject: {
                    ...batchReport(results, { verbose: args.verbose, limit: args.limit, written: ["recorded", "kept", "would-record", "would-keep"] }),
                    ...(preview ? { preview: "Nothing was recorded, kept or unstaged: each item says what it would do." } : {}),
                    ...(skippedModelled
                      ? {
                          leftOut:
                            `${skippedModelled} card(s) in the files named were left out, counted per item: modelled (an element names the symbol now), ` +
                            "planned (an element of the plan names it: stage it as the plan's type) or decided (this call's decide items decided it).",
                        }
                      : {}),
                    ...(recordedLocally
                      ? {
                          local:
                            "Recorded in .dr/analyzers/extract/decisions.json, which git ignores: only this checkout leaves them out. keep: true on an item writes it " +
                            `as a rule to documentation-robotics/${PROJECT_RULES_FILE} instead (commit that file), and decide with keep: true retires the recorded decisions its rule covers.`,
                        }
                      : {}),
                  },
                }
              : {}),
            ...(unstaged.length
              ? {
                  unstaged: {
                    items: unstaged,
                    note: `Rejected while staged: unstaged from '${changeset!.name}', with the relationships staged for them (changes counts both).`,
                  },
                }
              : {}),
            ...(preview && (toUnstage.size || relationshipsToUnstage.length)
              ? {
                  wouldUnstage: {
                    elements: [...toUnstage.keys()],
                    relationships: relationshipsToUnstage.map((r) => r.key),
                    note: `Staged in '${changeset?.name ?? name}' now: a call without preview unstages them.`,
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
        };

        // What a preview reports as recorded is what the checkout holds, not what it would hold.
        const onDisk = preview ? await readDecisions(projectRoot) : decisions;
        if (decisionsOnly) {
          const rerunName = changeset?.name ?? stored?.changesetName;
          const rerun = rerunName ? `changeset: "${rerunName}"` : "the arguments of the last run";
          const applied = rejectItems.length - problemAt.size;
          return jsonResult(
            {
              changeset: changeset ? { id: changeset.id, name: changeset.name } : null,
              ...(preview ? { preview: true } : {}),
              ...notElementsResult(onDisk, 0, preview ? [] : recordedNow, preview ? 0 : cleared, MAX_LISTED, args.verbose),
              ...notRelationshipsResult(onDisk, 0, preview ? [] : recordedRelationshipsNow, preview ? 0 : clearedRelationships, MAX_LISTED, args.verbose),
              ...(preview && (cleared || clearedRelationships) ? { wouldClear: { elements: cleared, relationships: clearedRelationships } } : {}),
              ...rejectSection(),
              message: preview
                ? `Preview: nothing was recorded, cleared, kept or unstaged. ${applied} of ${rejectItems.length} reject item(s) would apply` +
                  `${cleared || clearedRelationships ? `, and ${cleared + clearedRelationships} decision(s) would be cleared` : ""}.`
                : unstaged.length || unstagedRels.length
                  ? `Recorded, and unstaged ${[
                      ...(unstaged.length ? [`${unstaged.length} element(s)`] : []),
                      ...(unstagedRels.length ? [`${unstagedRels.length} relationship(s)`] : []),
                    ].join(" and ")} it had staged; nothing was extracted.`
                  : rejectProblems.length
                    ? `Recorded ${applied} of ${rejectItems.length} reject item(s); ${problemAt.size} named nothing (reject.attention). Nothing was extracted or staged.`
                    : "Recorded; nothing was extracted or staged.",
              next: preview
                ? ["To record them, call codebase_extract with the same arguments and no preview."]
                : [
                    `Call codebase_extract with ${rerun} to refresh the cards: it leaves out what is recorded, and says how many.`,
                    ...(keptRejects.size ? [`This call kept rule(s) in documentation-robotics/${PROJECT_RULES_FILE}: commit that file with the model, so other checkouts apply them.`] : []),
                  ],
            },
            { compact: true }
          );
        }

        // Later pages, views and lists: the last run's record, marking any card the agent has modelled since.
        if (paging) {
          if (previewRead) {
            stored = await readJson<StoredCards>(path.join(extractDir(projectRoot), PREVIEW_FILE));
            changeset = null;
            if (!stored) {
              throw new CLIError("No preview to read: preview: true with view, list or page reads the last preview's cards and lists", ErrorCategory.USER, [
                "Call codebase_extract with preview: true and the run's arguments first",
              ]);
            }
          }
          if (!stored) {
            throw new CLIError(
              changeset ? `No cards recorded for '${changeset.name}'` : `No extraction changeset '${name}' yet`,
              ErrorCategory.USER,
              ["Call codebase_extract without page, view or list first"]
            );
          }
          const runName = changeset?.name ?? stored.changesetName;
          if (stored.gitHead !== head) {
            throw new CLIError(`The cards for '${runName}' were read at ${stored.gitHead.slice(0, 7)}; the code is now at ${head.slice(0, 7)}`, ErrorCategory.USER, [
              "Call codebase_extract without page, view or list to extract again",
            ]);
          }
          const graph = await ChangesetGraph.build(model, changeset ?? emptyChangeset());
          const modelledAt = new Map<string, string>();
          const referencedCount = new Map<string, number>();
          for (const e of graph.elements.values()) {
            if (e.status === "deleted") continue;
            for (const l of e.sourceReference?.locations ?? []) {
              if (l.symbol) modelledAt.set(`${l.file}#${l.symbol}`, e.id);
              const file = normFile(l.file);
              if (file) referencedCount.set(file, (referencedCount.get(file) ?? 0) + 1);
            }
          }
          const live = stored.cards
            .filter((c) => !notElementKeys.has(decisionKey(c.file, c.symbol)))
            .map((c) => {
              const modelled = c.file ? modelledAt.get(`${c.file}#${c.symbol}`) : undefined;
              return modelled ? { ...c, modelled } : c;
            });
          // A since run's pile is what the range changed, unless the view asks for the rest.
          const view: CardFilter = { ...(args.view ?? {}) };
          if (stored.rangeOnly && view.changed === undefined) view.changed = true;
          const cards = filterCards(live, view);
          // What the default pile leaves out: cards of the same view that the range did not touch.
          const untouched = stored.rangeOnly && view.changed === true ? filterCards(live, { ...view, changed: false }).length : 0;
          const readHeader = {
            changeset: changeset ? { id: changeset.id, name: changeset.name } : null,
            ...(previewRead
              ? { preview: true, note: "The last preview's cards and lists: nothing was staged or recorded." }
              : changeset
                ? {}
                : { pending: `No changeset yet: the run that read these cards staged nothing. Call changeset_create with name: "${runName}" before staging.` }),
            scope: { since: stored.since, layers: stored.layers ?? "all" },
            ...(stored.baseModified !== baseModified
              ? { warning: "The base model changed since these cards were read; call codebase_extract without page, view or list to refresh them." }
              : {}),
          };
          const filtered = args.view && Object.keys(args.view).length ? { view: args.view } : {};
          if (args.list !== undefined) {
            const limit = args.limit ?? (args.list === "groups" ? DEFAULT_GROUPS : MAX_LISTED);
            const offset = args.offset ?? 0;
            const storedLists: Record<string, unknown[]> = {
              ...(stored.lists ?? {}),
              groups: groupCards(cards, referencedCount, { depth: args.groupDepth ?? DEFAULT_GROUP_DEPTH, since: !!stored.since, byFile: args.groupBy === "file" }),
              notElements: Object.entries(decisions.notElements).map(([key, d]) => ({ key, symbol: d.symbol, file: d.file, how: d.how, reason: d.reason })),
            };
            const listName = args.list === "ruleDecided" ? (args.rule ? `ruleDecided:${args.rule}` : "") : args.list;
            const items = storedLists[listName];
            if (!items) {
              const available = Object.keys(storedLists).sort();
              throw new CLIError(
                args.list === "ruleDecided"
                  ? args.rule
                    ? `No rule '${args.rule}' decided anything in the last run of '${runName}'`
                    : 'list: "ruleDecided" needs rule: the name of the project rule whose decisions to list'
                  : `The last run of '${runName}' has no list '${args.list}'`,
                ErrorCategory.USER,
                [`Lists it has: ${available.join(", ") || "none"}`]
              );
            }
            const extra =
              args.list === "groups"
                ? `${args.groupBy ? `, groupBy: "${args.groupBy}"` : ""}${args.groupDepth ? `, groupDepth: ${args.groupDepth}` : ""}${args.view ? `, view: ${JSON.stringify(args.view)}` : ""}`
                : args.rule
                  ? `, rule: "${args.rule}"`
                  : "";
            return jsonResult(
              asPreviewReads(previewRead, {
                ...readHeader,
                list: args.list,
                ...(args.rule ? { rule: args.rule } : {}),
                ...filtered,
                ...(args.list === "groups" ? { cards: cards.length, ...(untouched ? { untouched } : {}) } : {}),
                ...pageOf(items, limit, offset, (next) => `Call codebase_extract with list: "${args.list}"${extra}, limit: ${limit} and offset: ${next} for the next ones.`),
              }),
              { compact: true }
            );
          }
          const pageNumber = args.page ?? 1;
          const layout = pageLayout(args);
          const p = page(inLayoutOrder(cards, layout), pageNumber, effectivePageSize);
          const viewArg = viewCallArgs(args);
          return jsonResult(
            asPreviewReads(previewRead, fitCards(p.items, p, (items, fit) => ({
              ...readHeader,
              ...fitNotes(fit),
              ...filtered,
              undecided: undecidedSection(
                p,
                items,
                fit,
                pageSize,
                {
                  ...(untouched
                    ? { untouched: { total: untouched, more: `Symbols in the changed files that the range did not touch: call codebase_extract with view: ${JSON.stringify({ ...(args.view ?? {}), changed: false })} to list them.` } }
                    : {}),
                },
                layout
              ),
              ...notElementsResult(onDisk, stored!.cards.length - live.length, preview ? [] : recordedNow, preview ? 0 : cleared, fit.listLimit, args.verbose),
              ...notRelationshipsResult(onDisk, 0, preview ? [] : recordedRelationshipsNow, preview ? 0 : clearedRelationships, fit.listLimit, args.verbose),
              ...rejectSection(),
              ...(fit.readOn
                ? { next: `This page was cut to keep the response small: for the cards after it, ${fit.readOn}.` }
                : pageNumber < p.pages
                  ? { next: `Call codebase_extract with ${viewArg}page: ${pageNumber + 1} for the next cards.` }
                  : {}),
            }), viewArg)),
            { compact: true }
          );
        }
        // Uncommitted source edits, deletes and renames the index hasn't seen, from the shared
        // freshness rule (judgeIndex, which honours deps.sourceEdits).
        const edited = indexJudgement.editedSince;

        // What the model has: the base, plus the extraction changeset's own changes when it exists.
        const before = await ChangesetGraph.build(model, changeset ?? emptyChangeset());
        const referenced = new Set<string>();
        /** Elements sourced to each file: what the triage groups say the model already has there. */
        const referencedCount = new Map<string, number>();
        const liveKeys = new Set<string>();
        const liveIds = new Set<string>();
        // The elements this changeset adds, by the symbols they name: a card the agent staged.
        const addedAt = new Map<string, string>();
        for (const e of before.elements.values()) {
          if (e.status === "deleted") continue;
          liveIds.add(e.id);
          for (const l of e.sourceReference?.locations ?? []) {
            const file = l.file?.replace(/\\/g, "/").replace(/^\.\//, "");
            if (file) {
              referenced.add(file);
              referencedCount.set(file, (referencedCount.get(file) ?? 0) + 1);
            }
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
          stillStaged.push({ id, file: c.file, symbol: c.symbol, label: c.label, ...stagedAs(element?.name, element?.attributes), origin: { by: "agent" } });
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
        // The call's decide items, as rules ahead of the project's file, and decisions on single cards.
        // Cards a decide item may name: the last run's, else the waiting ones, else the last preview's at this commit.
        const lastPreview = decideItems.some((d) => d.card !== undefined) && !storedBefore?.cards && !pendingFor(name)?.cards
          ? await readJson<StoredCards>(path.join(extractDir(projectRoot), PREVIEW_FILE))
          : null;
        const previewCards = lastPreview && lastPreview.gitHead === head ? [...lastPreview.cards, ...((lastPreview.earlierCards ?? []) as UndecidedCard[])] : [];
        // A card item not among those is looked for among this run's symbols (#1394): its cardId, symbol or file#symbol.
        const runCards: CardRef[] = decideItems.some((d) => d.card !== undefined)
          ? extraction.symbols.map((s) => ({
              cardId: s.card.id,
              file: s.card.file_path,
              symbol: sourceSymbolOf(s),
              label: s.card.label,
              qualifiedName: s.card.qualified_name,
            }))
          : [];
        const decided = compileDecide(
          decideItems,
          storedBefore?.cards ?? pendingFor(name)?.cards ?? previewCards,
          new Set(fileRules.map((r) => r.rule.name)),
          runCards
        );
        const rules: CompiledRule[] = [...decided.rules.map((r) => r.compiled), ...fileRules];
        // A member's owner for ownerType: the element the model (or this changeset) has for its class.
        const ownerTypeOf = ownerTypeResolver(before, extraction.project);
        // With a range whose changed lines are known, a rule that names a type stages only what the range changed.
        // Without the changed lines (git couldn't give them) nothing says which symbols the range touched: every card is listed.
        const rangeChanged = changes && changes.hunks && !changes.hunksError ? changes : null;
        let ruleUntouched = new Map<string, number>();
        let ruleOverrode = new Map<string, { decided: number; rejected: number; types?: Record<string, number> }>();
        // Symbols a none rule matched that Tier 0 decided as elements: Tier 0's unless they end up cards (#1424).
        let ruleHeld = new Map<string, { rule: string; type: string }>();
        const planFrom = (graph: ExtractionGraph) => {
          const applied = applyProjectRules(withCardDecisions(graph, decided.byCard), rules, {
            decidedCards: new Set(decided.byCard.keys()),
            ownerTypeOf,
            ...(rangeChanged ? { changed: (s) => symbolChangedInRange(s, rangeChanged.hunks, rangeChanged) } : {}),
          });
          ruleUntouched = applied.untouched;
          ruleOverrode = applied.overrode;
          ruleHeld = applied.held;
          return planWith(applied.extraction);
        };
        const planWith = (graph: ExtractionGraph) =>
          planElements(graph, before, {
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
        const planStartedAt = Date.now();
        let plan = planFrom(extraction);
        const planningMs = Date.now() - planStartedAt;

        // Tier 1 (TIER1_DESIGN.md section 1.1): the first pass says which cards Tier 0 narrowed or
        // left open; Tier 1 answers those (suggest mode: hints). With acceptTier1 the accept band
        // (and, with debug.applyNotElement, the not-element band) changes the plan, so a second
        // pass plans it through the same code as Tier-0 decisions.
        let tier1Block: Tier1Block | null = args.tier1 === false ? skippedBlock() : tier1Session && tier1Session.state !== "ready" ? tier1Session.block : null;
        let tier1Run: ExtractTier1Result | null = null;
        // Time Tier 1 took: never counted against the run's budget when the run is checked before
        // staging, so Tier 1 running long can't stop Tier 0's decisions from being staged (§4.6).
        let tier1Ms = 0;
        // What the model and the changeset were before Tier 1's network time: checked again before staging.
        let stagedState: string | null = null;
        const recordedByTier1: Array<{ symbol: string; file: string | null; how: NotElementDecision["how"] }> = [];
        // Held for warming (TIER1_DESIGN.md section 4.4): the index job's cache fill runs and this
        // run's uncached cards are more than its time lets Tier 1 ask. Nothing is sent or staged.
        let heldForWarming = false;
        // The index job's cache fill, while it runs (warming).
        const warming = tier1Session?.state === "ready" ? await runningFill(projectRoot, analyzer, deps.isAlive ? { isAlive: deps.isAlive } : {}) : null;
        const askable = tier1Session?.state === "ready" ? tier1Askable(plan.undecided) : [];
        const symbolsByCard = new Map(tier1Session?.state === "ready" ? extraction.symbols.map((s) => [s.card.id, s] as const) : []);
        if (tier1Session?.state === "ready" && warming && !acceptTier1) {
          const uncached = await countUncached(tier1Session, askable, symbolsByCard, deps.tier1Spec ?? (await loadSpecCriteria()));
          const capacity = deps.warmingCapacity ?? warmingCapacity(tier1DeadlineAt(startedAt, deadline, planningMs), tier1Session.config.concurrency);
          if (holdsForWarming(uncached.requests, capacity)) {
            heldForWarming = true;
            tier1Block = warmingBlock(tier1Session, warming, { cards: askable.length, uncached: uncached.cards, capacity });
          }
        }
        if (tier1Session?.state === "ready" && !heldForWarming) {
          stagedState = await stagingState(manager, changeset?.id ?? null, name, baseModified);
          const tier1StartedAt = Date.now();
          tier1Run = await runExtractTier1(tier1Session, {
            cards: askable,
            symbols: symbolsByCard,
            deadlineAt: tier1DeadlineAt(startedAt, deadline, planningMs),
            accept: acceptTier1,
            // What the agent was shown: the extraction record's cards, this run's and earlier ones'.
            shown: shownHints([...(storedBefore?.earlierCards ?? []), ...(storedBefore?.cards ?? [])]),
            layers: layers ?? null,
            ...(context?.signal ? { signal: context.signal } : {}),
            ...(deps.tier1Spec ? { spec: deps.tier1Spec } : {}),
          });
          tier1Ms = Date.now() - tier1StartedAt;
          tier1Block = tier1Run.block;
          if (warming && tier1Block.state === "on") {
            // Answered what it could itself; the fill goes on in the background.
            tier1Block.state = "warming";
            tier1Block.warming = warming;
          }
          if (tier1Run.notElement.length) {
            const at = new Date().toISOString();
            for (const { cardId, decision } of tier1Run.notElement) {
              const s = symbolsByCard.get(cardId)!;
              const symbol = sourceSymbolOf(s);
              const key = decisionKey(s.card.file_path, symbol);
              if (decisions.notElements[key]) continue;
              decisions.notElements[key] = {
                file: s.card.file_path,
                symbol,
                label: s.card.label,
                reason: `Tier 1's not-element band (p ${decision.p.layer?.toFixed(2)}), recorded by acceptTier1 with debug.applyNotElement`,
                how: "rejected",
                changeset: changeset?.name ?? name,
                ...(changeset ? { changesetId: changeset.id! } : {}),
                at,
              };
              notElementKeys.add(key);
              recordedByTier1.push({ symbol, file: s.card.file_path, how: "rejected" });
            }
            // Written with the staging, after the deadline and cancellation checks.
            tier1Block.notElementRecorded = recordedByTier1.length;
          }
          if (tier1Run.accepted.size || recordedByTier1.length) {
            extraction = withTier1Decided(extraction, tier1Run.accepted);
            plan = planFrom(extraction);
          }
        }

        const now = new Date().toISOString();
        const { valid: validAll, invalid: invalidAll } = await validateAdds(plan.adds, now, changes?.hunks, changes ?? undefined);
        // A type or relationship type the spec the model declares lacks is not staged: a landing
        // would refuse it (#1411). Against the version assumed for a manifest with no spec_version
        // it is staged, as model_add stages it, with the warning. Leaving an element out also
        // leaves out its relationships: they are planned from the staged elements only.
        const notInDeclaredSpec: Array<{ kind: "element" | "relationship"; id: string; type: string; since: string }> = [];
        const assumedSpecWarnings: string[] = [];
        const valid = validAll.filter(({ add }) => {
          const type = `${add.layer}.${normalizeNodeType(add.layer, add.type)}`;
          const gap = typeNotInDeclaredSpec(model.manifest, type);
          if (gap?.assumed) assumedSpecWarnings.push(gap.message);
          if (!gap || gap.assumed) return true;
          notInDeclaredSpec.push({ kind: "element", id: add.id, type, since: gap.since });
          return false;
        });
        const adds = valid.map((v) => v.add);
        // A symbol a none rule held for Tier 0 that Tier 0 could not stage after all (a needs-attributes
        // or ambiguous card) is the rule's, as a card no Tier-0 rule covers would be (#1424).
        const heldInvalid = releaseHeldCards(invalidAll, ruleHeld);
        const heldOpen = releaseHeldCards(plan.undecided, ruleHeld);
        const invalid = heldInvalid.cards;
        plan.undecided = heldOpen.cards;
        for (const { rule, card } of [...heldInvalid.released, ...heldOpen.released]) {
          const byRule = plan.byRule.get(rule) ?? plan.byRule.set(rule, { none: [], staged: [] }).get(rule)!;
          byRule.none.push({ symbol: card.symbol, file: card.file, label: card.label });
          plan.rejected++;
          plan.tally.ruleNone++;
        }
        plan.tally.tier0Staged -= heldInvalid.released.length;
        plan.tally.open -= heldOpen.released.length;
        // What Tier 0 staged that a none rule matched and left to it, per rule and type: said at the top of the answer.
        const tier0Kept = new Map<string, number>();
        const tier0KeptTypes = new Map<string, Record<string, number>>();
        for (const a of adds) {
          const h = ruleHeld.get(a.symbol.card.id);
          if (!h) continue;
          tier0Kept.set(h.rule, (tier0Kept.get(h.rule) ?? 0) + 1);
          const types = tier0KeptTypes.get(h.rule) ?? tier0KeptTypes.set(h.rule, {}).get(h.rule)!;
          types[h.type] = (types[h.type] ?? 0) + 1;
        }
        // An add a rule decided whose attributes don't validate is a needs-attributes card, not something the rule staged.
        const validAddIds = new Set(adds.map((a) => a.id));
        const needsAttributesByRule = new Map<string, number>();
        for (const [ruleName, d] of plan.byRule) {
          const kept = d.staged.filter((id) => validAddIds.has(id));
          if (kept.length !== d.staged.length) needsAttributesByRule.set(ruleName, d.staged.length - kept.length);
          d.staged = kept;
        }
        // Staged adds with no description that a doc section describes (cards carry their own docs).
        const describe: DescribeItem[] = adds.filter((a) => !a.description && a.symbol.docs?.length).map((a) => ({ id: a.id, docs: a.symbol.docs! }));
        // Stage and hide mode hide the not-element band (TIER1_DESIGN.md section 1.3): counted, not carded,
        // and not recorded as a decision, so it is asked (from the cache) and hidden again next run.
        const hiddenByTier1 = new Set(tier1Run?.hidden ?? []);
        const hinted = withTier1Hints(sortUndecided(attributeChangedLines([...plan.undecided, ...invalid], changes?.hunks)), tier1Run?.hints ?? new Map());
        let undecided = hiddenByTier1.size ? hinted.filter((c) => !(hiddenByTier1.has(c.cardId) && c.tier1?.band === "not-element")) : hinted;
        const tier1NotElement = hinted.length - undecided.length;
        // A since run with a plan active (verify mode): a card whose symbol an element of the plan
        // names is that planned element as built, and says so (#1394).
        const activeNow = await manager.getActiveId();
        const planForCards = since ? (activeNow && activeNow !== changeset?.id ? activeNow : storedBefore?.previousActive?.id) : undefined;
        const plannedAt = planForCards ? plannedKeys(await manager.load(planForCards)) : new Map<string, string>();
        if (plannedAt.size) {
          undecided = undecided.map((c) => {
            const planned = plannedAt.get(decisionKey(normFile(c.file), c.symbol));
            return planned ? { ...c, planned } : c;
          });
        }
        // A files reject in this call covers the cards its decide items left undecided (#1394): those
        // cards are recorded (or kept as a rule) once the run is staged, and are not cards of this run.
        let deferredTaken: Array<{ card: UndecidedCard; reason: string; index: number }> = [];
        /** The deferred kept files items a rule holds (their code cards are the rule's, not records). */
        let deferredRuled = new Set<number>();
        const keptBeforeDeferred = rulesToKeep.length;
        if (deferredFiles.length) {
          if (heldForWarming) {
            for (const f of deferredFiles) {
              problemAt.set(f.index, {
                index: f.index,
                item: `files: ${f.files}`,
                status: "no-match",
                message: "the run was held while Tier 1 warms, so its decide items didn't apply and this item recorded nothing: send it again with the run",
              });
            }
          } else {
            // The cards this call's decide items decided are theirs, a needs-attributes card among
            // them (sent again with attributes, it must still be a card), and the plan's are the plan's.
            const callRules = new Set([
              ...decided.rules.map((r) => `${PROJECT_RULE_PREFIX}${r.compiled.rule.name}`),
              ...[...decided.byCard.values()].map((d) => d.rule),
            ]);
            const inFiles = filesReject(undecided, deferredFiles, changeset?.name ?? name, (c) =>
              decided.byCard.has(c.cardId) || (c.rule && callRules.has(c.rule)) ? "decided" : c.planned ? "planned" : null
            );
            for (const p of inFiles.problems) problemAt.set(p.index, { ...p, message: `${p.message} once this call's decide items applied` });
            for (const [index, counts] of inFiles.skipped) skippedPerItem.set(index, counts);
            const byId = new Map(undecided.map((c) => [c.cardId, c] as const));
            deferredTaken = inFiles.refs.map((r) => ({ card: byId.get(r.card)!, reason: r.reason, index: r.index }));
            for (const r of inFiles.refs) rejectedPerItem.set(r.index, (rejectedPerItem.get(r.index) ?? 0) + 1);
            deferredRuled = keepFilesRules(
              deferredFiles.filter((f) => !problemAt.has(f.index)),
              deferredTaken,
              changeset?.name ?? name
            );
            for (const t of deferredTaken) {
              if (keepAt(t.index) && !deferredRuled.has(t.index)) noteNotKept(t.index, unkeepable(t.card) ?? refusedFiles.get(t.index) ?? NO_CODE_CARD);
            }
            for (const t of deferredTaken) if (keepAt(t.index) && deferredRuled.has(t.index) && unkeepable(t.card)) noteNotKept(t.index, unkeepable(t.card)!);
            const taken = new Set(inFiles.refs.map((r) => r.card));
            undecided = undecided.filter((c) => !taken.has(c.cardId));
            plan.tally.recorded += taken.size;
          }
        }
        // A since run's pile is what the range changed. Symbols it did not touch in the same files
        // are counted and kept in the record (view: {changed: false} lists them), not listed.
        const rangeOnly = !!rangeChanged;
        const shown = rangeOnly ? undecided.filter((c) => c.changedInRange) : undecided;
        const untouchedCards = undecided.length - shown.length;
        // What stage or hide mode hid, by name, so the agent can say what was left out (and show it if asked).
        const tier1NotElementCards = hiddenByTier1.size
          ? hinted.filter((c) => hiddenByTier1.has(c.cardId) && c.tier1?.band === "not-element").map((c) => ({ symbol: c.symbol, file: c.file, p: c.tier1?.p?.layer }))
          : [];
        if (tier1Block && tier1Run && (tier1Block.mode === "stage" || tier1Block.mode === "hide")) tier1Block.hidden = tier1NotElement;
        const kept = new Set(adds);
        for (const add of plan.adds) {
          if (!kept.has(add)) {
            plan.elementOf.delete(add.symbol.qualifiedName);
            delete plan.descriptions[add.id];
          }
        }
        // Who decided each add (section 7): Tier 0's rule, or Tier 1's accepted decision.
        const addOrigins = new Map<string, ChangeOrigin>();
        for (const a of adds) {
          const accepted = isTier1Rule(a.rule) ? tier1Run?.accepted.get(a.symbol.card.id) : undefined;
          // A project rule, or a decide item of this call, is the agent's decision applied by rule.
          addOrigins.set(a.id, accepted ? accepted.origin : isProjectRule(a.rule) ? { by: "agent", rule: a.rule } : { by: "tier0", rule: a.rule });
        }
        if (tier1Block && tier1Run) tier1Block.staged = adds.filter((a) => isTier1Rule(a.rule)).length;
        recordedNow.push(...recordedByTier1);

        const elements = new Map<string, { layer: string; type: string }>();
        for (const e of before.elements.values()) if (e.status !== "deleted") elements.set(e.id, { layer: e.layer, type: e.type });
        for (const a of adds) elements.set(a.id, { layer: a.layer, type: a.type });
        const planned = planRelationships(extraction, before, plan.elementOf, elements, hasTriple, layers, { includePresent: true });
        const { alreadyPresent, weakCalls } = planned;
        // Relationships decided not to be in the code are not staged again: by a recorded decision, or by a rule.
        const notDecided = planned.relationships.filter((r) => !decisions.notRelationships[relationshipKey(r)]);
        const relationshipsByRule = new Map<string, string[]>();
        const notRejected = notDecided.filter((r) => {
          const rule = relationshipRuleFor(rules, r);
          if (!rule) return true;
          (relationshipsByRule.get(rule.rule.name) ?? relationshipsByRule.set(rule.rule.name, []).get(rule.rule.name)!).push(relationshipKey(r));
          return false;
        });
        const relationshipsSkipped = planned.relationships.length - notDecided.length;
        // Relationships this extraction staged earlier that a decide item of this call now rules out: unstaged below.
        const callRules = new Set(decided.rules.map((r) => r.compiled.rule.name));
        const ruledOutStaged: Array<{ source: string; predicate: string; target: string; rule: string }> = [];
        if (callRules.size && changeset) {
          const stagedByExtraction = new Set(storedBefore?.stagedRelationships ?? []);
          for (const r of planned.present ?? []) {
            const rule = relationshipRuleFor(rules, r);
            if (!rule || !callRules.has(rule.rule.name) || !stagedByExtraction.has(relationshipKey(r))) continue;
            ruledOutStaged.push({ source: r.source, predicate: r.predicate, target: r.target, rule: rule.rule.name });
            (relationshipsByRule.get(rule.rule.name) ?? relationshipsByRule.set(rule.rule.name, []).get(rule.rule.name)!).push(relationshipKey(r));
          }
        }
        // A relationship an accepted gap says is deliberately absent is not staged: it is reported
        // as contradicted (#1026).
        const specOfEnd = (id: string) => {
          const e = elements.get(id);
          return e ? `${e.layer}.${normalizeNodeType(e.layer, e.type)}` : undefined;
        };
        const { kept: keptByGaps, contradicted: contradictedGaps } = splitByAcceptedGaps(
          notRejected,
          specOfEnd,
          (id) => before.getElement(id)?.acceptedGaps
        );
        // Likewise a relationship type the declared spec lacks (#1411)
        const relationships = keptByGaps.filter((r) => {
          const source = specOfEnd(r.source);
          const target = specOfEnd(r.target);
          const gap = source && target ? relationshipNotInDeclaredSpec(model.manifest, source, r.predicate, target) : null;
          if (gap?.assumed) assumedSpecWarnings.push(gap.message);
          if (!gap || gap.assumed) return true;
          notInDeclaredSpec.push({
            kind: "relationship",
            id: `${r.source} --[${r.predicate}]--> ${r.target}`,
            type: `${source}.${r.predicate}.${target}`,
            since: gap.since,
          });
          return false;
        });

        // What each rule decided, and how each decide item of this call fared.
        // Every rule, one that decided nothing included: a rule that matches nothing may be mistyped.
        const ruleReports: RuleReport[] = rules.map((r) => ruleReport(r.rule, plan, ruleUntouched, relationshipsByRule, undefined, ruleOverrode, tier0Kept));
        const reportedSomething = (r: RuleReport) => r.notElements + r.staged + (r.relationships ?? 0) + (r.untouched ?? 0) > 0;
        // A kept none item covers symbols already recorded as not elements: the rule holds them now,
        // so those records are retired (#1332). Not one Tier 0 decided, unless the rule overrides it.
        const retiredByRule = new Map<string, string[]>();
        for (const d of decided.rules) {
          const r = d.compiled;
          if (!d.keep || r.decision.kind !== "none" || !r.rule.where) continue;
          const keys: string[] = [];
          for (const s of extraction.symbols) {
            const key = decisionKey(s.card.file_path, sourceSymbolOf(s));
            if (decisions.notElements[key]?.how !== "rejected" || keys.includes(key)) continue;
            if (s.tier0?.kind === "decide" && !r.rule.overrideTier0) continue;
            if (r.matches(subjectOf(s, ownerTypeOf(s)))) keys.push(key);
          }
          if (keys.length) retiredByRule.set(r.rule.name, keys);
        }
        const decideResults: DecideResult[] = [...decided.problems];
        // What a type requires, and the item's attributes: what a needs-attributes card lacks (#1380).
        const NEEDS = (n: number, as: string) =>
          `${n} card(s) it covers need attributes the code can't give for ${as}: they are needs-attributes cards, not staged. ` +
          "Send the item again with attributes (requiredAttributes says what the type requires and the values each takes).";
        const required = (as: string) => {
          const attrs = requiredAttributesFor([as]);
          return Object.keys(attrs).length ? { requiredAttributes: attrs } : {};
        };
        for (const d of decided.rules) {
          const r = d.compiled.rule;
          const found = ruleReports.find((x) => x.rule === r.name);
          const report = found && reportedSomething(found) ? found : undefined;
          const needs = needsAttributesByRule.get(r.name) ?? 0;
          const retired = retiredByRule.get(r.name)?.length ?? 0;
          if (!report && !needs && !retired) {
            decideResults.push({
              index: d.index,
              status: "no-match",
              rule: r.name,
              as: r.as,
              reason: r.relationship
                ? "covers no relationship this run would stage or has staged"
                : found?.tier0Kept
                  ? `covers no undecided card: the ${found.tier0Kept} symbol(s) it matches were decided by Tier 0 as elements and stay Tier 0's (overrideTier0: true takes them)`
                  : "covers no undecided card (a symbol that already has an element is never touched by a rule)",
              ...(found?.tier0Kept ? { tier0Kept: found.tier0Kept } : {}),
              ...(d.keep ? { notes: ["Not kept: a rule that matches nothing now may be mistyped. Add it to the rules file by hand if it is meant for code to come."] } : {}),
            });
            continue;
          }
          decideResults.push({
            index: d.index,
            status: preview ? "would-apply" : d.keep ? "kept" : "applied",
            rule: r.name,
            as: r.as,
            matched: (report?.notElements ?? 0) + (report?.staged ?? 0),
            staged: report?.staged ?? 0,
            notElements: report?.notElements ?? 0,
            ...(report?.relationships ? { relationships: report.relationships } : {}),
            ...(report?.untouched ? { untouched: report.untouched } : {}),
            ...(found?.tier0Kept ? { tier0Kept: found.tier0Kept } : {}),
            ...(found?.overrodeTier0?.decided ? { tier0Overridden: found.overrodeTier0.decided } : {}),
            ...(retired ? { retired } : {}),
            sample: report?.sample ?? [],
            ...(needs ? { warnings: [NEEDS(needs, r.as)], ...required(r.as) } : {}),
            ...(d.keep && !preview ? { kept: true } : {}),
          });
        }
        for (const d of decided.byCard.values()) {
          const got = plan.byRule.get(cardRuleName(d.index));
          const needs = needsAttributesByRule.get(cardRuleName(d.index)) ?? 0;
          const done = (got?.staged.length ?? 0) + (got?.none.length ?? 0);
          decideResults.push({
            index: d.index,
            status: done ? (preview ? "would-apply" : "applied") : needs ? "needs-attributes" : "no-match",
            as: d.decision.kind === "none" ? "none" : `${d.decision.layer}.${d.decision.type}`,
            ...(got?.staged.length ? { id: got.staged[0], staged: 1 } : {}),
            ...(got?.none.length ? { notElements: 1 } : {}),
            ...(done
              ? {}
              : {
                  reason: needs
                    ? `${d.card.symbol} needs attributes the code can't give for that type: it is a needs-attributes card. Send the item again with attributes ` +
                      "(requiredAttributes says what the type requires and the values each takes)"
                    : `${d.card.symbol} is no longer an undecided card of this run (it has an element, or a recorded decision)`,
                  ...(needs && d.decision.kind === "type" ? required(`${d.decision.layer}.${d.decision.type}`) : {}),
                }),
          });
        }
        decideResults.sort((a, b) => a.index - b.index);

        // Everything staged in one write: adds, updates (an update of an element this changeset
        // adds rewrites the add in place), relationships.
        const batch: Array<Omit<StagedChange, "sequenceNumber">> = [];
        const rewrites: Array<{ elementId: string; change: Omit<StagedChange, "sequenceNumber"> }> = [];
        for (const { add, element } of valid) {
          batch.push({
            type: "add",
            elementId: add.id,
            layerName: add.layer,
            after: element.toJSON() as unknown as Record<string, unknown>,
            // A copy each, so changes.yaml spells each one out rather than aliasing a shared object.
            origin: structuredClone(addOrigins.get(add.id)!),
          });
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
        // A relationship's end may be an element an earlier run staged (a Tier-1 accept among
        // them): its origin comes from the record. An end the agent staged gives no origin of its
        // own: the edge mapping decided the relationship.
        const endOrigins = new Map(addOrigins);
        for (const st of stillStaged) if (st.origin && st.origin.by !== "agent" && !endOrigins.has(st.id)) endOrigins.set(st.id, st.origin);
        for (const r of relationships) batch.push(relationshipChange(r, relationshipOrigin(r, endOrigins)));

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
          cards: shown.length,
          candidateDeletes: plan.candidateDeletes.length,
        };
        // Tier 1's time is left out: it stops asking at its own deadline, and a run that would have
        // fitted without it is staged even when Tier 1 ran long (Tier 1 never fails the run, §4.6).
        if (Date.now() - tier1Ms > deadline) {
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
        if (!preview && !heldForWarming) releaseWriteLock = await acquireProjectWriteLock(args.rootPath);
        // Tier 1's network time is a window in which the agent (or the user) may have staged into
        // the changeset or landed something: refuse rather than stage over a model that moved.
        if (stagedState !== null && !preview && (await stagingState(manager, changeset?.id ?? null, name, (await loadModel(args.rootPath)).manifest.modified)) !== stagedState) {
          throw new CLIError(
            `The model or '${changeset?.name ?? name}' changed while Tier 1 was answering, so codebase_extract staged nothing rather than stage over it`,
            ErrorCategory.USER,
            ["Call codebase_extract again with the same arguments: Tier 1's answers are cached, so the rerun sends nothing and costs nothing"]
          );
        }
        if (recordedByTier1.length) await writeDecisions(projectRoot, decisions);
        // What this call's decide items settle beyond staging. A kept rule goes in the project's
        // rules file; one not kept records each symbol or relationship it ruled out, as reject does,
        // so later runs in this checkout leave them out.
        if (!preview && !heldForWarming && (decided.rules.length || decided.byCard.size)) {
          const decidedIn = changeset?.name ?? name;
          let wrote = false;
          const recordNone = (ruleName: string, reason: string) => {
            for (const n of plan.byRule.get(ruleName)?.none ?? []) {
              const key = decisionKey(n.file, n.symbol);
              if (decisions.notElements[key]) continue;
              decisions.notElements[key] = notElementRecord(n, reason, "rejected", { name: decidedIn, id: changeset?.id ?? null }, now);
              recordedNow.push({ symbol: n.symbol, file: n.file, how: "rejected" });
              wrote = true;
            }
          };
          for (const d of decided.rules) {
            const r = d.compiled.rule;
            if (decideResults.find((x) => x.index === d.index)?.status === "no-match") continue;
            if (d.keep) {
              const saved = await saveProjectRule(projectRoot, { ...r, decided: { at: now, changeset: decidedIn } });
              if (saved.duplicateOf) {
                const result = decideResults.find((x) => x.index === d.index);
                if (result) result.notes = [...(result.notes ?? []), `The rules file already holds this rule as '${saved.duplicateOf}': not written again.`];
              }
              // The records the kept rule now holds go: the rule decides those symbols on every checkout.
              for (const key of retiredByRule.get(r.name) ?? []) {
                delete decisions.notElements[key];
                wrote = true;
              }
              continue;
            }
            recordNone(r.name, r.reason);
            for (const key of relationshipsByRule.get(r.name) ?? []) {
              const [source, predicate, target] = key.split("::");
              if (!source || !predicate || !target || decisions.notRelationships[key]) continue;
              decisions.notRelationships[key] = {
                source,
                predicate,
                target,
                reason: r.reason,
                how: "rejected",
                changeset: decidedIn,
                ...(changeset ? { changesetId: changeset.id! } : {}),
                at: now,
              };
              recordedRelationshipsNow.push({ source, predicate, target, how: "rejected" });
              wrote = true;
            }
          }
          for (const d of decided.byCard.values()) if (d.decision.kind === "none") recordNone(cardRuleName(d.index), d.reason);
          if (wrote) await writeDecisions(projectRoot, decisions);
        }
        // The files rejects that waited for this call's decide items: recorded now, or kept as rules.
        if (!preview && !heldForWarming && deferredTaken.length) {
          const decidedIn = changeset?.name ?? name;
          let wrote = false;
          for (const { card, reason, index } of deferredTaken) {
            if (keepAt(index) && deferredRuled.has(index) && !unkeepable(card)) continue;
            const key = decisionKey(card.file, card.symbol);
            if (decisions.notElements[key]) continue;
            decisions.notElements[key] = notElementRecord(card, reason, "rejected", { name: decidedIn, id: changeset?.id ?? null }, now);
            recordedNow.push({ symbol: card.symbol, file: card.file, how: "rejected" });
            wrote = true;
          }
          if (wrote) await writeDecisions(projectRoot, decisions);
        }
        if (!preview && !heldForWarming) {
          for (const rule of rulesToKeep.slice(keptBeforeDeferred)) keptUnder(rule.name, (await saveProjectRule(projectRoot, rule)).duplicateOf);
        }

        // How far a since range reaches (git can't say: just the counts), and the few folders that
        // hold most of the cards when no element names a file in them.
        let range: RangeReport | null = null;
        if (since && changes) {
          let size: RangeSize | null = null;
          try {
            // Narrower ranges cost a git diff each: only for a long range, or a preview.
            const wantSteps = (commits: number) => !!preview || commits > LONG_RANGE_COMMITS || shown.length > LONG_RANGE_CARDS;
            size = (deps.rangeSize ?? gitRangeSize)(codebaseRoot, changes.base, wantSteps);
          } catch {
            size = null;
          }
          range = describeRange(size, changes.changed.size, shown);
        }
        const namedFiles = new Set(referenced);
        for (const a of adds) {
          const file = normFile(a.symbol.card.file_path);
          if (file) namedFiles.add(file);
        }
        const ignore = ignoreCandidates(shown, namedFiles);

        // The triage views: the cards grouped and counted, the functions many services share, what
        // each rule decided. All computed over the whole run, then listed a page at a time.
        const isService = (id: string) => {
          const e = elements.get(id);
          return !!e && e.layer === "application" && e.type === "applicationservice";
        };
        const helpers: SharedHelpers = sharedHelperGroups([...relationships, ...(planned.present ?? [])], relationships, isService, args.sharedBy ?? DEFAULT_SHARED_BY);
        const groupLimit = args.limit ?? DEFAULT_GROUPS;
        const groupDepth = args.groupDepth ?? DEFAULT_GROUP_DEPTH;
        const allGroups = groupCards(shown, referencedCount, { depth: groupDepth, since: !!since });
        const byKind = kindRows(shown, !!since && !rangeOnly);
        const untouchedSection = untouchedCards
          ? {
              untouched: {
                total: untouchedCards,
                more: "Symbols in the changed files that the range did not touch: they are not cards of this run. Call codebase_extract with view: {changed: false} to list them.",
              },
            }
          : {};
        const groupsSection = (listLimit?: number) => ({
          groups: {
            ...pageOf(
              allGroups,
              Math.min(groupLimit, listLimit ?? groupLimit),
              args.offset ?? 0,
              (next) => `Call codebase_extract with list: "groups"${args.groupDepth ? `, groupDepth: ${groupDepth}` : ""}, limit: ${groupLimit} and offset: ${next} for the next groups.`
            ),
            depth: groupDepth,
          },
          byKind,
        });
        const rulesSection = (listLimit?: number) =>
          fileRules.length || ruleReports.length
            ? {
                rules: {
                  file: `documentation-robotics/${PROJECT_RULES_FILE}`,
                  inFile: fileRules.length,
                  decided: capped(ruleReports, listLimit, "rules"),
                  ...(ruleReports.length
                    ? {
                        note:
                          "What each rule decided in this run, before cards were made: notElements, staged, relationships kept from staging, and a sample. " +
                          'list: "ruleDecided" with rule: <name> lists everything one rule decided.',
                      }
                    : {}),
                },
              }
            : {};
        // Where every symbol went, in one line that sums to the symbols read (the run's budget).
        const invalidByRule = invalid.filter((c) => isProjectRule(c.rule)).length;
        const t = plan.tally;
        const budgetParts = {
          recorded: t.recorded,
          modelled: t.modelled,
          outsideLayers: t.outsideLayers,
          decidedByRules: { notElements: t.ruleNone, staged: t.ruleStaged - invalidByRule },
          decidedByTier0: { notElements: t.tier0Rejected, staged: t.tier0Staged - (invalid.length - invalidByRule) },
          ...(tier1NotElement ? { hiddenByTier1: tier1NotElement } : {}),
          open: shown.length,
          ...(untouchedCards ? { untouched: untouchedCards } : {}),
        };
        const overrodeTotals = [...ruleOverrode.values()].reduce((o, x) => ({ decided: o.decided + x.decided, rejected: o.rejected + x.rejected }), { decided: 0, rejected: 0 });
        const budgetSection = {
          budget: {
            symbols:
              budgetParts.recorded +
              budgetParts.modelled +
              budgetParts.outsideLayers +
              budgetParts.decidedByRules.notElements +
              budgetParts.decidedByRules.staged +
              budgetParts.decidedByTier0.notElements +
              budgetParts.decidedByTier0.staged +
              (budgetParts.hiddenByTier1 ?? 0) +
              budgetParts.open +
              (budgetParts.untouched ?? 0),
            ...budgetParts,
            ...(overrodeTotals.decided || overrodeTotals.rejected ? { rulesOverrodeTier0: overrodeTotals } : {}),
            note:
              "Every symbol this run read, once: recorded (a decision recorded earlier), modelled (an element names it), outsideLayers, decided by the project's rules or by Tier 0 " +
              "(staged counts symbols, so infrastructure merged into one element counts each), " +
              (untouchedCards ? "untouched (in changed files, not changed by the range), " : "") +
              "and open: the cards left for you (needs-attributes cards included). The parts sum to symbols. rulesOverrodeTier0 counts what a none rule took from Tier 0's decisions (per rule in rules.decided).",
          },
        };
        const decideSection = decideItems.length
          ? { decide: batchReport(decideResults, { verbose: args.verbose, limit: args.limit, written: ["applied", "kept", "would-apply"] }) }
          : {};
        // What a none rule did to Tier 0's decisions, where the answer starts, never only as a nested count (#1424).
        const warnings = ruleWarnings(ruleReports, tier0KeptTypes, preview || heldForWarming, new Set(fileRules.map((r) => r.rule.name)));
        const helpersSection = (listLimit?: number) =>
          helpers.helpers.length
            ? {
                sharedHelpers: {
                  sharedBy: helpers.sharedBy,
                  links: helpers.links,
                  staging: helpers.staging,
                  helpers: capped(helpers.helpers, Math.min(listLimit ?? 20, 20), "sharedHelpers"),
                  note:
                    `Each of these realizes more than ${helpers.sharedBy} services (sharedBy; pass another number to move the line): shared helpers, probably, not the behaviour of any one service. ` +
                    `Nothing is left out because of it: ${helpers.staging} of their ${helpers.links} 'realizes' links are staged by this run. To leave a helper's links out, on record: ` +
                    'decide: [{relationship: {source: "<its id>", predicate: "realizes"}, as: "none", reason, keep: true}] (preview: true counts what it removes).',
                },
              }
            : {};

        // The run's lists in full, so one the response shortens is reachable with list: <name>.
        const updatedList = stagedUpdates.map((u) => ({ id: u.id, fields: Object.keys(u.fields) }));
        const impactedList = impactHints.map(({ id, symbol, hop, via, viaEdge, rolledUp }) => ({ id, symbol, hop, via, viaEdge, ...(rolledUp ? { rolledUp } : {}) }));
        const runLists: Record<string, unknown[]> = {};
        const keepList = (listName: string, items: unknown[]) => {
          if (items.length) runLists[listName] = items;
        };
        keepList("candidateDeletes", plan.candidateDeletes);
        keepList("retyped", plan.retyped);
        keepList("updated", updatedList);
        keepList("impacted", impactedList);
        keepList("rules", ruleReports);
        keepList("sharedHelpers", helpers.helpers);
        keepList("unwiredTests", planned.unwiredTests);
        keepList("weakCalls", planned.weakCallPairs);
        keepList("tier1NotElementCards", tier1NotElementCards);
        keepList("contradictedGaps", contradictedGaps);
        keepList("declaredSpecNotStaged", notInDeclaredSpec);
        keepList("retiredDecisions", plan.decisions?.retired ?? []);
        for (const r of rules) {
          const d = plan.byRule.get(r.rule.name);
          keepList(`ruleDecided:${r.rule.name}`, [
            ...(d?.staged ?? []).map((id) => ({ staged: id })),
            ...(d?.none ?? []).map((n) => ({ notElement: `${n.file ?? ""}#${n.symbol}`, label: n.label })),
            ...(relationshipsByRule.get(r.rule.name) ?? []).map((key) => ({ relationship: key })),
          ]);
        }
        // A preview, and a run held while the index job fills Tier 1's cache (warming), stage and
        // record nothing: they say what a run would do.
        if (preview || heldForWarming) {
          const target = changeset?.name ?? name;
          if (preview) {
            // The preview's cards and lists, so every list it shortens can be read in full with
            // preview: true and list or view. Not a decision, not staged: the next preview replaces it.
            const record: StoredCards = {
              changesetId: "",
              changesetName: target,
              gitHead: head,
              since: since ?? null,
              layers: layers ?? null,
              baseModified,
              createdAt: now,
              cards: undecided,
              // Cards this preview's card items decided, so a run that applies them still finds them.
              ...(decided.byCard.size ? { earlierCards: [...decided.byCard.values()].map((d) => d.card) } : {}),
              ...(rangeOnly ? { rangeOnly: true } : {}),
              ...(Object.keys(runLists).length ? { lists: runLists } : {}),
            };
            await writeFile(path.join(extractDir(projectRoot), PREVIEW_FILE), JSON.stringify(record), "utf-8");
          }
          const would =
            `A run with these arguments would stage ${summary.adds} add(s), ${summary.updates} update(s) ` +
            `and ${summary.relationships} relationship(s) into '${target}', and leave ${summary.cards} card(s) and ${summary.candidateDeletes} candidate delete(s).`;
          return jsonResult(
            asPreviewReads(preview, {
              ...(warnings.length ? { ruleWarnings: warnings } : {}),
              ...(preview
                ? { preview: true, message: `Preview: nothing was staged or recorded. ${would}` }
                : {
                    warming: true,
                    message:
                      "Tier 1 is warming: the codebase_index job is filling its answer cache, and this run has more cards without a cached answer " +
                      `than it could ask in its time, so nothing was sent to Tier 1 and nothing was staged (tier1.notice). ${would}`,
                  }),
              ...(heldForWarming && tier1Block ? { tier1: tier1Block } : {}),
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
              undecided: {
                total: summary.cards,
                ...(changes ? { changedInRange: shown.filter((c) => c.changedInRange).length } : {}),
                ...untouchedSection,
                ...groupsSection(),
              },
              ...budgetSection,
              ...rulesSection(),
              ...decideSection,
              ...rejectSection(),
              ...helpersSection(),
              ...(ignore ? { ignoreCandidates: ignore } : {}),
              ...notElementsResult(onDisk, plan.skipped, [], 0),
              ...notRelationshipsResult(onDisk, relationshipsSkipped, [], 0),
              next: [
                ...(preview
                  ? ["To run it, call codebase_extract with the same arguments and no preview."]
                  : [
                      "Tell the user Tier 1 is filling its answer cache in the background (tier1.warming: cards done of total, cost so far, about how long is left). " +
                        "Wait for it: call codebase_index with status: true and wait: 30 until job.tier1.state isn't running (project_status shows it too), " +
                        "then call codebase_extract again with the same arguments: every card is then answered from the cache, at no cost. " +
                        "Or, if the user doesn't want to wait, call it with tier1: false for a Tier-0-only run now.",
                    ]),
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
            }),
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

        // The purpose of the changeset this run makes (#1370): decided once and kept in the run's
        // record, so a changeset created later for waiting cards declares the same. A run into a
        // changeset that already holds one keeps the purpose recorded then.
        let purposeDecision: ExtractionPurposeDecision | undefined;
        if (since) {
          const earlier = stored?.purpose
            ? readPurpose({ purpose: stored.purpose, verifies: stored.verifies, scope: stored.since ? { since: stored.since, codeCommit: stored.gitHead } : undefined })
            : undefined;
          const planNamed = (id?: string) => (id ? { id, name: allKnownNames.get(id) ?? id } : undefined);
          const allKnownNames = new Map<string, string>();
          const stagedPlans: Array<{ id: string; name: string }> = [];
          for (const other of await manager.list()) {
            allKnownNames.set(other.id!, other.name);
            if (other.status !== "staged" || other.id === changeset?.id) continue;
            if ((await purposeOf(projectRoot, other)).purpose === "plan") stagedPlans.push({ id: other.id!, name: other.name });
          }
          purposeDecision = earlier
            ? {
                declaration: earlier,
                note:
                  earlier.purpose === "verification"
                    ? `A verification record, never landed.${earlier.verifies ? ` It verifies the plan '${planNamed(earlier.verifies)!.name}'.` : " It found no staged plan to verify."}`
                    : "A reconcile: landing it reconciles the model with the code it read.",
              }
            : decideExtractionPurpose({
                since,
                gitHead: head,
                explicit: args.purpose,
                previousActive: recordedPrevious,
                sinceCommit: (deps.resolveCommit ?? resolveCommit)(codebaseRoot, since),
                reconciledCommit: model.manifest.reconciled?.code_commit,
                stagedPlans,
              });
        }

        // A run makes a changeset only to stage into it: a run that stages nothing leaves its cards
        // and candidate deletes for the agent without creating or activating an empty changeset
        // (which would then sit in project_status as the next thing to resume).
        const stages = batch.length > 0 || rewrites.length > 0;
        const hasWork = stages || undecided.length > 0 || plan.candidateDeletes.length > 0;
        let created = false;
        let active = !!changeset && activeId === changeset.id;
        // With intent the caller has a confirmed purpose for the changeset: it is created for the
        // cards too, so their elements are staged into one of the right purpose, with no changeset_create detour.
        // A reconcile or bootstrap the caller asked for (intent, or a changeset named) is made even when it
        // stages nothing (#1331): landing it as it is records that the model matches the code it read.
        // A verification record of a plan that staged nothing is not: there is nothing to record.
        const declaredPurpose = purposeDecision?.declaration.purpose ?? (since ? "reconcile" : "bootstrap");
        const emptyReconcile = !changeset && !stages && (!!args.intent || !!args.changeset) && RECONCILING_PURPOSES.includes(declaredPurpose as ChangesetPurpose);
        if (changeset ? hasWork : stages || (!!args.intent && hasWork) || emptyReconcile) {
          if (!changeset) {
            // Its purpose: a verification record of the plan active before (verify mode), a
            // reconcile (since, no plan) or a bootstrap (the whole code).
            changeset = await manager.create(
              name,
              args.intent ?? `As-built extraction of the code at ${head.slice(0, 7)}${since ? `, files changed since ${since}` : ""}. Staged by codebase_extract.`,
              { kind: "extract" },
              purposeDecision?.declaration ?? extractionPurpose({ since, gitHead: head, previousActive: recordedPrevious })
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
        // Verify mode: which planned elements the as-built side has, and which cards could be the others.
        let coverage: PlanCoverageItem[] = [];
        if (since && recordedPrevious) {
          const planChangeset = await manager.load(recordedPrevious.id);
          const plannedRefs: PlannedElementRef[] = [];
          for (const c of (planChangeset?.changes ?? []) as StagedChange[]) {
            // Only what code can show: an intent-layer element has no declaration to stage.
            if (c.type !== "add" || !c.after || INTENT_LAYERS.has(c.layerName) || (layers && !layers.includes(c.layerName))) continue;
            const after = c.after as Record<string, unknown>;
            const id = typeof after.path === "string" && after.path ? after.path : c.elementId;
            plannedRefs.push({
              id,
              layer: c.layerName,
              type: typeof after.type === "string" ? after.type : (id.split(".")[1] ?? ""),
              name: typeof after.name === "string" ? after.name : id,
              locations: (stagedSourceReference(after)?.locations ?? [])
                .filter((l) => !!l.file)
                .map((l) => ({ file: normFile(l.file)!, ...(l.symbol ? { symbol: l.symbol } : {}) })),
            });
          }
          const asBuilt = [...before.elements.values()]
            .filter((e) => e.status !== "deleted")
            .map((e) => ({
              id: e.id,
              layer: e.layer,
              type: e.type,
              locations: (e.sourceReference?.locations ?? []).filter((l) => !!l.file).map((l) => ({ file: normFile(l.file)!, ...(l.symbol ? { symbol: l.symbol } : {}) })),
            }));
          for (const a of adds) {
            asBuilt.push({
              id: a.id,
              layer: a.layer,
              type: a.type,
              locations: (a.sourceReference?.locations ?? []).map((l) => ({ file: normFile(l.file)!, ...(l.symbol ? { symbol: l.symbol } : {}) })),
            });
          }
          const rank = { candidates: 0, none: 1, staged: 2 } as const;
          coverage = planCoverage(plannedRefs, asBuilt, undecided).sort((a, b) => rank[a.status] - rank[b.status] || a.planned.localeCompare(b.planned));
        }
        const coverageCounts = {
          total: coverage.length,
          staged: coverage.filter((c) => c.status === "staged").length,
          candidates: coverage.filter((c) => c.status === "candidates").length,
          none: coverage.filter((c) => c.status === "none").length,
        };
        keepList("planCoverage", coverage);
        const pendingPath = path.join(extractDir(projectRoot), PENDING_FILE);
        // The files with uncommitted changes the run read: those the index saw and those it didn't.
        const uncommittedFiles = [...new Set([...indexJudgement.editedSince, ...(indexJudgement.uncommittedRead ?? [])])].sort();
        const uncommittedRecord: Pick<StoredCards, "uncommitted"> = uncommittedFiles.length ? { uncommitted: await hashFiles(codebaseRoot, uncommittedFiles) } : {};
        if (changeset) {
          const staged = [...stillStaged];
          for (const a of adds) {
            staged.push({
              id: a.id,
              file: a.symbol.card.file_path,
              symbol: sourceSymbolOf(a.symbol),
              label: a.symbol.card.label,
              ...stagedAs(a.name, a.attributes),
              ...(a.defaulted?.length ? { defaulted: a.defaulted } : {}),
              origin: addOrigins.get(a.id)!,
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
            ...recordedPurpose(purposeDecision),
            ...uncommittedRecord,
            createdAt: now,
            cards: undecided,
            staged,
            ...(earlierCards.size ? { earlierCards: [...earlierCards.values()] } : {}),
            ...accumulated,
            ...(rangeOnly ? { rangeOnly: true } : {}),
            ...(Object.keys(runLists).length ? { lists: runLists } : {}),
            ...(stagedRelationships.length ? { stagedRelationships } : {}),
          };
          await writeFile(cardsPath(projectRoot, changeset.id!), JSON.stringify(record), "utf-8");
          // The record makes a changeset this run didn't create extraction's: it declares so.
          await declareExtractionPurpose(manager, changeset, record);
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
            ...recordedPurpose(purposeDecision),
            ...uncommittedRecord,
            createdAt: now,
            cards: undecided,
            staged: [],
            ...(earlierCards.size ? { earlierCards: [...earlierCards.values()] } : {}),
            ...accumulated,
            ...(rangeOnly ? { rangeOnly: true } : {}),
            ...(Object.keys(runLists).length ? { lists: runLists } : {}),
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
        // A real run supersedes the last preview: its store (cards and lists, about 2 MB on a large codebase) goes.
        await rm(path.join(extractDir(projectRoot), PREVIEW_FILE), { force: true });

        // Relationships this extraction staged in an earlier run that a decide item of this call
        // rules out: unstaged now, so the decision holds in the changeset and not only in later runs.
        let ruledOutUnstaged = 0;
        if (ruledOutStaged.length && changeset) {
          releaseWriteLock?.();
          releaseWriteLock = undefined;
          const result = await changesetUnstageHandler({
            changes: ruledOutStaged.map(({ source, predicate, target }) => ({ source, predicate, target })),
            changeset: changeset.id!,
            rootPath: args.rootPath,
          });
          const body = JSON.parse((result.content[0] as { text: string }).text) as { results?: Array<{ status?: string }>; unstaged?: unknown[] };
          ruledOutUnstaged = result.isError ? 0 : (body.results?.filter((r) => r.status === "unstaged").length ?? body.unstaged?.length ?? 0);
          const gone = new Set(ruledOutStaged.map(relationshipKey));
          const record = await readJson<StoredCards>(cardsPath(projectRoot, changeset.id!));
          if (record?.stagedRelationships) {
            record.stagedRelationships = record.stagedRelationships.filter((k) => !gone.has(k));
            await writeFile(cardsPath(projectRoot, changeset.id!), JSON.stringify(record), "utf-8");
          }
          await reloadModel(args.rootPath);
        }

        // decide with view: the answer is that view's page of the cards left (#1350); a later page is a read.
        const layout = pageLayout(args);
        const viewFilter: CardFilter = { ...(args.view ?? {}) };
        if (rangeOnly && viewFilter.changed === undefined) viewFilter.changed = true;
        const viewed = viewAfterRun ? inLayoutOrder(filterCards(undecided, viewFilter), layout) : shown;
        const viewArg = viewAfterRun ? viewCallArgs(args) : "";
        const cards = page(viewed, viewAfterRun ? (args.page ?? 1) : 1, effectivePageSize);
        // More cards than a page: the answer is the groups, and the cards are read by view and page.
        const grouped = !viewAfterRun && shown.length > effectivePageSize;
        // Cards the plan's elements name (verify mode): stage them as the planned type, by card.
        const plannedCards = shown.filter((c) => c.planned).length;
        const changedCards = rangeOnly ? 0 : shown.filter((c) => c.changedInRange).length;
        const changesetRef = changeset ? { id: changeset.id!, name: changeset.name } : null;
        // The impacted list in full once per extraction: a later run with the same list gives its count (#1350).
        const impactedRepeated =
          impactedList.length > 0 && !!storedBefore?.lists?.impacted && JSON.stringify(storedBefore.lists.impacted) === JSON.stringify(impactedList);
        const verifyMode = !!since && !!recordedPrevious;
        // Relationships held back because an accepted gap says they are absent: the model and the
        // code disagree, so a run that stages nothing else must not say they agree.
        const contradiction = contradictedGaps.length
          ? `${contradictedGaps.length} relationship(s) the code shows contradict an accepted gap and were not staged ` +
            "(acceptedGaps.contradicted): ask the user whether the decision is stale or the code drifted."
          : "";
        // A layers filter that left symbols out: "nothing to stage" is then about those layers only,
        // and must not read as "the model is complete".
        const outsideNote =
          layers && plan.outsideLayers
            ? ` This is for the layer(s) asked for (${layers.join(", ")}) only: ${plan.outsideLayers} symbol(s) belong to other layers and were left out ` +
              "(unchanged.outsideLayers), so it says nothing about the rest of the model. A run without layers shows them (a changeset keeps its run's layers, so name another one if this run has one)."
            : "";
        const baseMessage = !hasWork
          ? verifyMode && !changeset
            ? contradiction
              ? `Nothing staged, but the code disagrees with the model: ${contradiction} No as-built changeset was created; ${previousActive ? `'${previousActive.name}' is still active.` : `the plan is '${recordedPrevious!.name}'.`}`
              : `Nothing to stage: nothing in the range is observable to extraction or differs from the model. No as-built changeset was created; ${previousActive ? `'${previousActive.name}' is still active.` : `the plan is '${recordedPrevious!.name}'.`}`
            : changeset && created
              ? `Nothing to stage: the model already says what this code says${contradiction ? `, except that ${contradiction}` : ""}. '${changeset.name}' was created and made active, empty, as asked: ` +
                `landing it as it is records that the model matches the code at ${head.slice(0, 7)} (changeset_commit_preview says so) and moves the drift baseline there.`
              : changeset
              ? contradiction
                ? `Nothing more staged in '${changeset.name}', but the code disagrees with it: ${contradiction}`
                : `Nothing more to stage: '${changeset.name}' already says what this code says.`
              : contradiction
                ? `Nothing staged, but the code disagrees with the model: ${contradiction} No changeset was created or activated.`
                : "Nothing to stage: the model already says what this code says. No changeset was created or activated."
          : !changeset
            ? `Nothing to stage, so no changeset was created or activated. ${shown.length} card(s)` +
              `${changedCards ? ` (${changedCards} changed in the range)` : ""} and ${plan.candidateDeletes.length} candidate delete(s) are left for you to decide; ` +
              `to stage any, first call changeset_create with name: "${name}".`
            : undefined;
        const message = baseMessage && !hasWork ? `${baseMessage}${outsideNote}` : baseMessage;
        return jsonResult(
          fitCards(grouped ? [] : cards.items, cards, (items, fit) => ({
            changeset: changesetRef ? { ...changesetRef, created, active, ...(changeset?.purpose ? { purpose: changeset.purpose } : {}) } : null,
            previousActive,
            ...(message ? { message } : {}),
            ...(purposeDecision ? { purposeNote: purposeDecision.note } : {}),
            ...(warnings.length ? { ruleWarnings: warnings } : {}),
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
                  impacted: impactedRepeated
                    ? {
                        total: impactedList.length,
                        unchanged: `The same ${impactedList.length} element(s) as the last run of '${changesetRef?.name ?? name}': list: "impacted" lists them.`,
                      }
                    : { ...capped(impactedList, fit.listLimit, "impacted"), note: IMPACT_NOTE },
                }
              : {}),
            cards: {
              ...extraction.summary,
              needsAttributes: invalid.length,
              note: "What the analyzer and Tier 0 alone made of the symbols, before the project's rules and recorded decisions: budget says where every symbol went.",
            },
            staged: {
              adds: adds.length,
              updates: stagedUpdates.length,
              relationships: relationships.length,
              byLayer: byLayer(adds, stagedUpdates, relationships),
              ...(stagedUpdates.length ? { updated: capped(updatedList, fit.listLimit, "updated") } : {}),
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
              // Links the index matched by name only, with nothing to corroborate them: not staged,
              // listed for the agent to check against the code.
              ...(weakCalls
                ? {
                    weakCalls,
                    weakCallPairs: capped(planned.weakCallPairs, Math.min(fit.listLimit ?? 20, 20), "weakCalls"),
                    weakCallsNote:
                      "Call-graph links left out because the index matched them by name: reason name-matched is a low-confidence call nothing corroborates; " +
                      "member-of-unreferenced-class is a read, write or call of a class member (Xform.pts) from a file that never imports, calls or names the class. " +
                      "They are hints, not drift: read the code, and wire a real one with relationship_add.",
                  }
                : {}),
              rejected: plan.rejected,
              ...(plan.outsideLayers ? { outsideLayers: plan.outsideLayers } : {}),
              // Stage mode: cards in Tier 1's not-element band, hidden rather than carded.
              ...(tier1NotElement ? { tier1NotElement, tier1NotElementCards: capped(tier1NotElementCards, fit.listLimit, "tier1NotElementCards") } : {}),
            },
            ...(notInDeclaredSpec.length || assumedSpecWarnings.length
              ? {
                  declaredSpec: {
                    ...(notInDeclaredSpec.length
                      ? {
                          modelVersion: model.manifest.specVersion,
                          notStaged: capped(notInDeclaredSpec, fit.listLimit, "declaredSpecNotStaged"),
                          note:
                            `Not staged: the code shows these elements and relationships, but spec ` +
                            `${model.manifest.specVersion}, the model's version, has no such type or relationship ` +
                            "type (each exists from the spec version given as since), so a landing would refuse " +
                            `them. project_upgrade moves the model to spec ${getCliBundledSpecVersion()}; extract ` +
                            "again after it.",
                        }
                      : {}),
                    ...(assumedSpecWarnings.length ? { warnings: [...new Set(assumedSpecWarnings)] } : {}),
                  },
                }
              : {}),
            ...(contradictedGaps.length
              ? {
                  acceptedGaps: {
                    contradicted: capped(contradictedGaps, fit.listLimit, "contradictedGaps"),
                    note:
                      "Not staged: the code shows a connection the element accepted as a gap. Either the decision is stale " +
                      "(gap_reopen in a changeset, then extract again) or the code drifted; ask the user which.",
                  },
                }
              : {}),
            candidateDeletes: {
              ...capped(plan.candidateDeletes, fit.listLimit, "candidateDeletes"),
              note: "Not staged: deleting is left to you. Each has its evidence.",
            },
            ...(plan.retyped.length ? { retyped: capped(plan.retyped, fit.listLimit, "retyped") } : {}),
            ...notElementsResult(decisions, plan.skipped, recordedNow, cleared, fit.listLimit, args.verbose),
            ...notRelationshipsResult(decisions, relationshipsSkipped, recordedRelationshipsNow, 0, fit.listLimit, args.verbose),
            ...(range?.long ? { range } : {}),
            ...(ignore ? { ignoreCandidates: ignore } : {}),
            undecided: grouped
              ? {
                  total: shown.length,
                  pageSize: cards.pageSize,
                  pages: cards.pages,
                  ...(changes && !rangeOnly ? { changedInRange: changedCards } : {}),
                  ...untouchedSection,
                  ...groupsSection(fit.listLimit),
                  cards:
                    `${shown.length} cards are more than a page (${cards.pageSize}), so they are grouped here and not listed. ` +
                    'Call codebase_extract with view: {} for the cards a page at a time, or view: {files: "<a group\'s path>"} (with label, visibility or kind) for some of them.',
                }
              : undecidedSection(
                  cards,
                  items,
                  fit,
                  pageSize,
                  {
                    ...(changes && !rangeOnly ? { changedInRange: changedCards } : {}),
                    ...untouchedSection,
                    ...(plannedCards ? { planned: plannedCards } : {}),
                    ...(viewAfterRun
                      ? {
                          view: args.view,
                          ofAll: shown.length,
                          ...(cards.page < cards.pages && !fit.readOn
                            ? { more: `Call codebase_extract with ${viewArg}page: ${cards.page + 1} for the next cards (a read: nothing is extracted).` }
                            : {}),
                        }
                      : {}),
                  },
                  layout
                ),
            ...(planned.unwiredTests.length || planned.inferredTests || planned.sharedTestHelpers.length
              ? {
                  testLinks: {
                    ...(planned.inferredTests ? { inferredFromFileName: planned.inferredTests } : {}),
                    ...(planned.sharedTestHelpers.length ? { sharedHelpers: { total: planned.sharedTestHelpers.length, listed: planned.sharedTestHelpers.slice(0, 20) } } : {}),
                    unwired: {
                      cases: planned.unwiredTests.reduce((n, f) => n + f.cases, 0),
                      files: capped(planned.unwiredTests, Math.min(fit.listLimit ?? 20, 20), "unwiredTests"),
                    },
                    note:
                      "Test cases with an element that test nothing: no call from the test reaches an element, and no source file is named as the test file is. " +
                      "inferredFromFileName counts links made from the name alone (foo.spec.ts tests the element that owns foo.ts; origin rule edge:TEST_FILE_NAME); a link made by following a test's calls through a symbol a rule rejected has origin rule edge:TEST_CALL_VIA_REJECTED. " +
                      "sharedHelpers are elements many test files call and none is named after: no tests link was staged for them. " +
                      "Each unwired file lists candidates, the elements its calls or its name point at: work for you to check, then wire with relationship_add (testcasesketch tests <element>). " +
                      "A wrong group of test links goes in reject as {files: <test file or glob>, predicate: \"tests\", reason}.",
                  },
                }
              : {}),
            ...rejectSection(),
            ...budgetSection,
            ...rulesSection(fit.listLimit),
            ...decideSection,
            ...helpersSection(fit.listLimit),
            ...(coverage.length
              ? {
                  planCoverage: {
                    plan: recordedPrevious!.name,
                    ...coverageCounts,
                    items: capped(
                      coverage.filter((c) => c.status !== "staged"),
                      Math.min(fit.listLimit ?? 30, 30),
                      "planCoverage"
                    ),
                    note:
                      "The plan's added elements that code can show, against this as-built side. candidates: no as-built element yet, and these cards could be it " +
                      "(stage a card with decide: [{card, as: <the planned type>, reason}] when it is that element). none: nothing in the range is a candidate. " +
                      "items lists those two; the staged ones are counted. One file can back elements in several layers, so staging one does not cover another.",
                  },
                }
              : {}),
            ...(ruledOutUnstaged
              ? { unstagedByRule: { relationships: ruledOutUnstaged, note: `Staged by an earlier run and ruled out by this call's decide: unstaged from '${changeset!.name}'.` } }
              : {}),
            ...documentationResult(plan, describe, extraction.docsError, fit.listLimit),
            ...(extraction.clusters ? { clusters: clustersSection(extraction.clusters, fit.listLimit) } : {}),
            ...(tier1Block ? { tier1: tier1Block } : {}),
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
                      ? nextSteps(changesetRef, recordedPrevious, cards.pages, plan, changedCards, since, fit.readOn, grouped)
                      : pendingSteps(name, recordedPrevious, cards.pages, plan, changedCards, since, fit.readOn, grouped),
                    [
                      ...(range?.long && shown.length ? [rangeStep(range, since!)] : []),
                      ...(grouped ? [triageStep(shown.length, allGroups.some((g) => g.noElement))] : []),
                      ...(untouchedCards ? [untouchedStep(untouchedCards)] : []),
                      ...(coverageCounts.candidates || coverageCounts.none ? [coverageStep(coverageCounts)] : []),
                      ...(plannedCards ? [plannedStep(plannedCards)] : []),
                      ...(helpers.helpers.length ? [helpersStep(helpers)] : []),
                      ...(decided.rules.some((r) => r.keep) && decideResults.some((r) => r.status === "kept")
                        ? [`This call kept rule(s) in documentation-robotics/${PROJECT_RULES_FILE}: commit that file with the model, so other checkouts apply them.`]
                        : []),
                      ...(ignore ? [ignoreStep(ignore)] : []),
                    ]
                  )),
              ...(impactedRepeated ? [] : impactStep(impactHints)),
              ...tier1Steps(tier1Block, {
                acceptTier1,
                accept: undecided.filter((c) => c.tier1?.band === "accept").length,
                changeset: changesetRef?.name ?? name,
                notShown: tier1Run?.notShown ?? 0,
                uncached: tier1Run?.uncached ?? 0,
                acceptTier1Ignored,
              }),
            ],
          }), viewArg),
          { compact: true }
        );
      } finally {
        releaseWriteLock?.();
        await lock.release().catch(() => undefined);
      }
    });
  };
}

export const codebaseExtractHandler = createCodebaseExtractHandler();

export const codebaseExtractTool: McpToolDefinition<typeof inputSchema> = {
  name: "codebase_extract",
  description:
    "Model the indexed code as an as-built changeset: the project's rules and the Tier-0 rules decide what they can and those elements and " +
    "their relationships are staged; the rest come back as undecided cards for you to decide. A page of cards comes with undecided.requiredAttributes: " +
    "what each type its cards name (candidates, hint, Tier 1) requires, with the values each attribute takes, for the model_add that stages a card. " +
    "More cards than a page come back grouped, not listed: undecided.groups (by folder: counts by label and visibility, what the model has there, " +
    "noElement for a folder no element names) and byKind, with the totals over every card. Decide them in bulk with decide: [{where, as, reason}] " +
    "(as: a layer.type, or none; where: files (a path, folder or glob), file (a path, exactly), label, visibility, nested, name (the bare name), symbol (the card's Class.method), declaration, ownerType; " +
    "attributes for what a type requires): with preview: true it returns each item's count " +
    "and a sample and changes nothing; without, it stages or records what the items cover, and keep: true writes an item to " +
    `documentation-robotics/${PROJECT_RULES_FILE} (commit it) so every later run and checkout applies it. Each run reports what every rule decided (rules). ` +
    "A none rule leaves a symbol Tier 0 decided as an element to Tier 0 unless it says overrideTier0: true; ruleWarnings, first in the answer, names each rule " +
    "that matched such symbols and the key to add. decide with view answers with that view's page of the cards left. " +
    "Read cards with view (a filter; {} for all) and page; read any shortened list in full with list, limit and offset. Every list gives its true total " +
    "and, when shortened, the call for the rest. " +
    "Stages only what differs from the model (matched by source file and symbol): new symbols are adds, changed ones " +
    "updates; elements whose code is gone are listed as candidateDeletes, not staged. since (a git ref) limits it to " +
    "files changed since then, for verifying a branch: its cards are the symbols the range changed, and the symbols it did not touch are counted " +
    "(undecided.untouched; view: {changed: false} lists them). With a plan active before a since run, planCoverage lists the plan's elements that have " +
    "no as-built element yet, with the cards that could be them. " +
    "With since, scope.changedSymbols says how changed symbols were found (the analyzer's detect_changes, or git's changed " +
    "lines, with why), and impacted lists existing elements whose code calls changed code: review hints, never staged. " +
    "Code that is not an element goes in reject (with a reason): a card, or a symbol or element it staged, which is then " +
    "unstaged; or files (a path or glob) for every undecided card in them, except what an element or the plan names, what except lists, and, " +
    "with decide in the call, what decide decided. keep: true writes a reject as a rule instead of this checkout's record (not for a files item that left out " +
    "planned or decided cards, a decision record or a card with no file: those are recorded, and notKept says why). A wrong relationship goes in reject as " +
    "relationship: {source, predicate, target}, or a file's links of one predicate as a group in files + predicate (a test file's tests links). Kept until clearRejected in this checkout, later runs leave them out. An element " +
    "or relationship it staged that you unstage from a changeset is also left out, while that changeset is staged and " +
    "after it lands; discarding it forgets that. reject and decide items can come from a JSON file (file); their results are counts and the items " +
    "that need attention (verbose: true for every item). sharedHelpers lists functions that realize more services than sharedBy: decide their relationship none if they are shared helpers. " +
    "A long since range says so (range) with narrower since refs; preview: true counts a run, with its groups, without staging anything. " +
    "A run or page into an extraction changeset keeps that run's since and layers. " +
    "The changeset (default extract-<sha>) is created and made active when the run stages something, or when intent is given (the confirmed purpose, used as its description); " +
    "a run that only leaves cards or candidate deletes creates nothing and says which changeset to create first. previousActive is the one " +
    "active before the first run. A run indexes first when the code is not indexed or the index is stale (index.indexedFirst says why and how long it took; " +
    "a run that outlasts this call's budget is left running and the error says how to wait; autoIndex: false refuses instead). Never writes the base model or commits. " +
    "When the checkout opted in to Tier 1 (a decision model; the user enables it), cards Tier 0 narrowed or left open carry its " +
    "suggestion (tier1: band, layer, type, p), the accept band first, and the tier1 block says who received code and the month's " +
    "spend (tell the user its notice). In suggest mode (tier1.mode) Tier 1 alone stages nothing: acceptTier1: true stages the accept band once the user agrees " +
    "(cached answers, nothing sent). In stage mode (the model's thresholds are verified on held-out labels) the accept band is staged " +
    "without you (origin.confirmed \"auto\") and the not-element band is hidden (unchanged.tier1NotElement counts it); in hide mode " +
    "only the not-element band is hidden and the accept band stays a suggestion for acceptTier1. The user turns " +
    "either off with `dr analyzer tier1 set mode suggest`. tier1: false skips Tier 1. While the codebase_index job fills Tier 1's cache, tier1.state is warming; " +
    "a run with more uncached cards than it could ask returns warming: true and stages nothing (wait for the fill, or tier1: false). " +
    "Staged adds and relationships carry origin (tier0, tier1 or agent; a rule's adds are the agent's, with the rule's name).",
  inputSchema,
  handler: codebaseExtractHandler,
};
