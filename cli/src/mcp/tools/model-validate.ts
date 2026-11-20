/**
 * model_validate — run the 5-stage validation pipeline against the model.
 * Mirrors `dr validate`, reusing the shared Validator and ValidationFormatter.
 *
 * Sized to fit one tool result by default: whether the model is valid, the errors whole, and the
 * warnings counted by kind, layer and type. A model of a few thousand elements has hundreds of
 * warnings of about 400 characters each, nearly all of one or two kinds, and the few that matter
 * were lost among them (#1215). `warnings: [...]` lists the kinds named, `orphans: true` reports
 * orphans alone without running the pipeline, and `detail: "full"` returns every warning whole.
 *
 * Nothing is cut off: the list a call returns (errors, the warnings asked for, or orphans) is paged
 * with `limit` and `offset` (core/paging.ts). `valid`, the summary and every count are of the
 * whole set, whatever the page.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Model } from "../../core/model.js";
import { getAllLayerIds, isValidLayer } from "../../generated/layer-registry.js";
import { CLIError, ErrorCategory, findSimilar, formatValidOptions } from "../../utils/errors.js";
import { warningKind, type WarningKind } from "../../validators/model-warnings.js";
import { ValidationFormatter } from "../../validators/validation-formatter.js";
import type { ValidationIssue } from "../../validators/types.js";
import { getCliBundledSpecVersion, modelSpecStanding } from "../../utils/spec-version.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { countByLayerAndType, modelView, orphanIds, validateView } from "./model-view.js";
import { nextPageHint, pageOf, pagingFields, wholePage } from "../../core/paging.js";

/** The kinds of warning `warnings` can list. */
const WARNING_KINDS: WarningKind[] = [
  "orphan",
  "no-source-reference",
  "no-document-reference",
  "no-description",
  "schema",
  "semantic",
  "reference",
  "expected",
  "other",
];

/** Kinds that say one thing about one element: listed as ids, the message and fix given once. */
const PER_ELEMENT_KINDS = new Set<WarningKind>(["orphan", "no-source-reference", "no-document-reference", "no-description"]);

/** The default page of a warnings or orphans listing: about 8 KB of ids. */
export const VALIDATE_LIST_LIMIT = 150;

/** The default page of errors, each whole (about 400 characters): about 40 KB. */
export const VALIDATE_ERROR_LIMIT = 100;

const inputSchema = {
  layers: z.array(z.string()).optional().describe("Restrict validation to these layers. Omit to validate the whole model."),
  strict: z
    .boolean()
    .optional()
    .describe(
      "Also warn about elements with no description, and about motivation, business and product elements with no " +
        "reference to the document that states them. With strict, any warning makes valid false."
    ),
  warnings: z
    .array(z.string())
    .optional()
    .describe(
      "List the warnings of these kinds, e.g. [\"orphan\"] or [\"all\"]; the default only counts them. Kinds: " +
        `${WARNING_KINDS.join(", ")}. A kind about one element each (orphan, no-source-reference, ` +
        "no-document-reference, no-description) is listed as element ids, with its message and fix once. The listing " +
        `is paged with limit and offset (${VALIDATE_LIST_LIMIT} a page by default) across the kinds named; layers narrows it. ` +
        "Errors are counted, not listed, in a warnings listing: call without warnings for them."
    ),
  orphans: z
    .boolean()
    .optional()
    .describe(
      "Return only the orphaned elements (no relationship and no cross-layer reference), counted by layer and type " +
        `and listed by id, paged with limit and offset (${VALIDATE_LIST_LIMIT} a page by default), without running validation. ` +
        "layers narrows it."
    ),
  ...pagingFields(
    "items of the list the call returns (errors; the warnings named by warnings; orphans with orphans: true)",
    `${VALIDATE_ERROR_LIMIT} errors, ${VALIDATE_LIST_LIMIT} warnings or orphans`
  ),
  detail: z
    .enum(["summary", "full"])
    .optional()
    .describe(
      "summary (default): validity, a page of errors whole, warnings counted by kind, layer and type. full: " +
        "everything in one result, unpaged: every error and warning whole (about 400 characters each), or with " +
        "warnings / orphans every match."
    ),
  rootPath: rootPathSchema,
};

export type ModelValidateArgs = z.infer<z.ZodObject<typeof inputSchema>>;

/** Says what the summary left out and how to get it. */
const SUMMARY_MORE =
  "Warnings are counted by kind, layer and type, not listed. Pass warnings: [\"<kind>\"] to list a kind " +
  "(paged; layers narrows it), orphans: true for orphans alone, or detail: \"full\" for every warning whole. " +
  "model_list with orphans: true lists orphaned elements with their names and descriptions.";

export async function modelValidateHandler(args: ModelValidateArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const listed = listedKinds(args.warnings);
    const model = await loadModel(args.rootPath);
    const { model: whole, view } = await modelView(model);
    let modelToValidate = whole;

    // Ends outside a `layers` scope that exist nowhere in the full model (see danglingOutOfScopeEnds).
    let outOfScopeIssues: Array<Omit<ValidationIssue, "severity">> = [];

    // `loadModel()` returns the full cached model (all layers), so a `layers` scope
    // is applied here rather than at load time. Copies the layers Map onto a new
    // object instead of mutating `model.layers` directly, since that Map is the
    // shared cached instance other tool calls read from.
    if (args.layers && args.layers.length > 0) {
      const unknownLayers = args.layers.filter((name) => !isValidLayer(name));
      if (unknownLayers.length > 0) {
        const validLayers = getAllLayerIds();
        const suggestions: string[] = [`Use a valid layer name: ${formatValidOptions(validLayers)}`];
        for (const unknown of unknownLayers) {
          const similar = findSimilar(unknown, validLayers, 3);
          if (similar.length > 0) suggestions.unshift(`Did you mean "${similar.join(" or ")}" instead of "${unknown}"?`);
        }
        throw new CLIError(`Unknown layer(s): ${unknownLayers.join(", ")}`, ErrorCategory.USER, suggestions);
      }

      const requestedLayers = new Set(args.layers);
      outOfScopeIssues = danglingOutOfScopeEnds(modelToValidate, requestedLayers);
      // Relationships stay whole, as in `dr validate --layers`, which loads only the requested
      // layers. `loadedLayerFilter` is what tells the validators that elements outside it were
      // left out on purpose: a relationship or reference whose other end lies outside the scope
      // is then skipped instead of reported as pointing at a missing element.
      modelToValidate = {
        ...modelToValidate,
        layers: new Map(
          Array.from(modelToValidate.layers.entries()).filter(([name]) => requestedLayers.has(name))
        ),
        loadedLayerFilter: [...requestedLayers],
      } as unknown as Model;
    }
    const full = args.detail === "full";
    const scope = args.layers && args.layers.length > 0 ? { layers: args.layers } : {};

    const paging = { limit: args.limit, offset: args.offset };

    if (args.orphans) {
      const orphans = orphanIds(modelToValidate);
      const { items, page } = full ? wholePage(orphans) : pageOf(orphans, paging, VALIDATE_LIST_LIMIT);
      const next = nextPageHint("model_validate", "orphans", page);
      return jsonResult(
        {
          view,
          ...scope,
          orphanCount: orphans.length,
          byLayer: countByLayerAndType(orphans),
          orphanedElements: items,
          page: { of: "orphans", ...page },
          ...(next
            ? {
                more:
                  `${next} byLayer counts them all. layers narrows the list; model_list with orphans: true lists ` +
                  "them by layer and type with names and descriptions.",
              }
            : {}),
        },
        { compact: true }
      );
    }

    const result = await validateView(modelToValidate, { strict: args.strict });
    for (const issue of outOfScopeIssues) result.addError(issue);

    // Includes acceptedGaps: informational, reported beside the result, never as errors or warnings.
    const formatted = ValidationFormatter.toJSON(result, modelToValidate);
    const valid = result.isValid() && !(args.strict && result.warnings.length > 0);
    const specVersion = specVersionNotice(model.manifest.specVersion);
    const header = { ...(specVersion ? { specVersion } : {}), valid, view, ...scope };

    // The whole report, as the tool returned it before the summary default.
    if (full && listed.length === 0) return jsonResult({ ...header, ...formatted, valid });

    const byKind = new Map<WarningKind, ValidationIssue[]>();
    for (const warning of result.warnings) {
      const kind = warningKind(warning);
      const ofKind = byKind.get(kind) ?? [];
      ofKind.push(warning);
      byKind.set(kind, ofKind);
    }
    // Counted over every warning, whatever the page.
    const warningCounts = [...byKind].map(([kind, issues]) => ({
      kind,
      count: issues.length,
      byLayer: countByLayerAndType(issues.map(issueId)),
    }));
    const errorsByLayer = countByLayerAndType(result.errors.map(issueId));
    const acceptedGaps = formatted.acceptedGaps ? { acceptedGaps: formatted.acceptedGaps } : {};

    // A warnings listing: the kinds named, paged as one list in the order named. Errors are
    // counted here and listed by the call without `warnings`, so each call pages one list.
    if (listed.length > 0) {
      const all = listed.flatMap((kind) => (byKind.get(kind) ?? []).map((issue) => ({ kind, issue })));
      const { items, page } = full ? wholePage(all) : pageOf(all, paging, VALIDATE_LIST_LIMIT);
      const next = nextPageHint("model_validate", "warnings of the kinds listed", page);
      return jsonResult(
        {
          ...header,
          summary: formatted.summary,
          ...(result.errors.length > 0
            ? {
                errorsByLayer,
                errorsMore: `${result.errors.length} errors are counted here, not listed: call model_validate without warnings for them.`,
              }
            : {}),
          warningCounts,
          warnings: listed.map((kind) =>
            listKind(
              kind,
              (byKind.get(kind) ?? []).length,
              items.filter((entry) => entry.kind === kind).map((entry) => entry.issue)
            )
          ),
          page: { of: "warnings", ...page },
          ...acceptedGaps,
          ...(next ? { more: `${next} count on each kind is its total; layers or fewer kinds narrow the list.` } : {}),
        },
        { compact: true }
      );
    }

    const { items: errors, page } = pageOf(result.errors, paging, VALIDATE_ERROR_LIMIT);
    const next = nextPageHint("model_validate", "errors", page);
    const more = [
      ...(next ? [`${next} errorsByLayer counts them all, and layers validates fewer layers.`] : []),
      ...(result.warnings.length > 0 ? [SUMMARY_MORE] : []),
    ];
    return jsonResult(
      {
        ...header,
        summary: formatted.summary,
        errors,
        page: { of: "errors", ...page },
        ...(page.returned < page.total ? { errorsByLayer } : {}),
        warningCounts,
        ...acceptedGaps,
        ...(more.length > 0 ? { more: more.join(" ") } : {}),
      },
      { compact: true }
    );
  });
}

/** The kinds `warnings` names (`all` is every kind), refusing one that is not a kind. */
function listedKinds(requested: string[] | undefined): WarningKind[] {
  if (!requested || requested.length === 0) return [];
  if (requested.includes("all")) return WARNING_KINDS;
  const unknown = requested.filter((kind) => !(WARNING_KINDS as string[]).includes(kind));
  if (unknown.length > 0) {
    const suggestions = unknown.flatMap((kind) => {
      const similar = findSimilar(kind, WARNING_KINDS, 3);
      return similar.length > 0 ? [`Did you mean "${similar.join(" or ")}" instead of "${kind}"?`] : [];
    });
    throw new CLIError(`Unknown warning kind(s): ${unknown.join(", ")}`, ErrorCategory.USER, [
      ...suggestions,
      `Kinds: ${formatValidOptions(WARNING_KINDS)}, or "all"`,
    ]);
  }
  return [...new Set(requested)] as WarningKind[];
}

/** The id an issue is counted under: its element's, else a placeholder in its layer. */
function issueId(issue: ValidationIssue): string {
  return issue.elementId && issue.elementId.includes(".") ? issue.elementId : `${issue.layer}.(no element)`;
}

/**
 * One kind in a warnings listing: its total, and the warnings of it on this page (element ids for a
 * per-element kind with the message and fix once, the issues whole for any other).
 */
function listKind(kind: WarningKind, count: number, onPage: ValidationIssue[]): Record<string, unknown> {
  const base = { kind, count };
  if (onPage.length === 0) return base;
  if (!PER_ELEMENT_KINDS.has(kind)) return { ...base, issues: onPage };
  return {
    ...base,
    means: onPage[0].message.replace(/^Element '[^']*' /, ""),
    ...(onPage[0].fixSuggestion ? { fix: onPage[0].fixSuggestion } : {}),
    elements: onPage.map((issue) => issue.elementId),
  };
}

/**
 * One line when the model's spec version isn't the one this server validates against: errors
 * from a version gap read as model errors otherwise
 */
function specVersionNotice(modelSpecVersion: string | undefined): string | null {
  const bundled = getCliBundledSpecVersion();
  switch (modelSpecStanding(modelSpecVersion)) {
    case "behind":
      return `The model is at spec v${modelSpecVersion}; this validation is against v${bundled}. project_upgrade previews the migration.`;
    case "ahead":
      return `The model is at spec v${modelSpecVersion}, newer than the v${bundled} this server validates against. The dr plugin needs updating to validate it.`;
    default:
      return null;
  }
}

/**
 * The relationships and references that leave a `layers` scope and point at an element that
 * exists nowhere in the model. The validators skip an end outside the scope (as `dr validate
 * --layers` does, having loaded only those layers); the MCP server holds the whole model, so it
 * can still tell a real dangling end from one that is merely out of scope. A relationship with
 * both ends outside the scope isn't looked at, as in the CLI.
 */
function danglingOutOfScopeEnds(model: Model, scope: Set<string>): Array<Omit<ValidationIssue, "severity">> {
  const known = new Set<string>();
  for (const layer of model.layers.values()) {
    for (const element of layer.listElements()) {
      known.add(element.id);
      if (element.path) known.add(element.path);
    }
  }
  const layerOf = (id: string) => id.split(".")[0] ?? "";
  // The layer the reference validator reads from a target (reference-validator.ts
  // extractLayerFromId): a known layer the id starts with, else its first segment.
  const referenceLayerOf = (id: string) => {
    const separator = id.includes(".") ? "." : "-";
    const layer = [...getAllLayerIds()]
      .sort((a, b) => b.length - a.length)
      .find((name) => id.startsWith(name + separator));
    return layer ?? id.split(separator)[0] ?? "";
  };
  const issues: Array<Omit<ValidationIssue, "severity">> = [];

  for (const rel of model.relationships.getAll()) {
    // An id with no layer segment is looked up, and reported, by the relationship validator
    // whatever the scope (relationship-schema-validator.ts extractLayerFromElementId).
    if (!rel.source.includes(".") || !rel.target.includes(".")) continue;
    const sourceIn = scope.has(layerOf(rel.source));
    const targetIn = scope.has(layerOf(rel.target));
    if (sourceIn === targetIn) continue; // both in scope: the validators check it; neither: skipped
    const [end, role] = sourceIn ? [rel.target, "target"] : [rel.source, "source"];
    if (known.has(end)) continue;
    issues.push({
      layer: rel.layer || layerOf(rel.source),
      elementId: end,
      message: `[Relationship Schema]: Relationship ${role} element '${end}' not found (outside the validated layers, and not in the model)`,
      category: "reference",
    });
  }

  for (const [layerName, layer] of model.layers) {
    if (!scope.has(layerName)) continue;
    for (const element of layer.listElements()) {
      for (const ref of element.references ?? []) {
        const destination = ref.target;
        if (!destination || destination.startsWith("@") || scope.has(referenceLayerOf(destination)) || known.has(destination)) continue;
        issues.push({
          layer: layerName,
          elementId: element.path || element.id,
          message: `Broken reference: target '${destination}' does not exist (outside the validated layers, and not in the model)`,
          fixSuggestion: `Remove reference or create element '${destination}'`,
          category: "reference",
        });
      }
    }
  }
  return issues;
}

export const modelValidateTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_validate",
  description:
    "Run the full schema/naming/reference/semantic/relationship validation pipeline against the model, as the active " +
    "changeset leaves it (view says which). The default fits one result: valid, a page of errors whole, and the " +
    "warnings counted by kind, layer and type. warnings: [\"<kind>\"] lists a kind as element ids, orphans: true " +
    'reports the orphaned elements alone, and detail: "full" returns everything whole. The list a call returns is ' +
    `paged, never cut off: limit and offset (default ${VALIDATE_ERROR_LIMIT} errors, ${VALIDATE_LIST_LIMIT} warnings or orphans), ` +
    "with page.total the true count and page.nextOffset the next page; valid and every count are of the whole " +
    "model. Motivation, business and product elements are not asked for a source reference: they have no " +
    "implementation to point at.",
  inputSchema,
  handler: modelValidateHandler,
};
