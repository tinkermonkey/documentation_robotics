/**
 * model_validate — run the 5-stage validation pipeline against the model.
 * Mirrors `dr validate`, reusing the shared Validator and ValidationFormatter.
 *
 * Sized to fit one tool result by default: whether the model is valid, the errors in full, and
 * the warnings counted by kind, layer and type. A model of a few thousand elements has hundreds of
 * warnings of about 400 characters each, nearly all of one or two kinds, and the few that matter
 * were lost among them (#1215). `warnings: [...]` lists the kinds named, `orphans: true` reports
 * orphans alone without running the pipeline, and `detail: "full"` returns every warning whole.
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

/**
 * The most ids or issues one kind lists (about 8 KB of ids). A kind with more is counted by layer
 * and type unless the caller passes `detail: "full"`.
 */
export const VALIDATE_LIST_LIMIT = 150;

/**
 * The most errors the default returns whole; the rest are counted by layer and type.
 * `allErrors: true` returns every error and still only counts the warnings.
 */
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
        "no-document-reference, no-description) is listed as element ids, with its message and fix once. A kind with " +
        `more than ${VALIDATE_LIST_LIMIT} warnings is counted by layer and type instead: narrow it with layers, or pass detail: "full".`
    ),
  orphans: z
    .boolean()
    .optional()
    .describe(
      "Return only the orphaned elements (no relationship and no cross-layer reference), counted by layer and type " +
        `and listed by id when ${VALIDATE_LIST_LIMIT} or fewer match, without running validation. layers narrows it.`
    ),
  allErrors: z
    .boolean()
    .optional()
    .describe(
      `Return every error whole. The default returns the first ${VALIDATE_ERROR_LIMIT} and counts the rest by layer and ` +
        "type (errorsOmitted, errorsByLayer). Warnings stay counted. layers also narrows the errors."
    ),
  detail: z
    .enum(["summary", "full"])
    .optional()
    .describe(
      `summary (default): validity, the errors whole (the first ${VALIDATE_ERROR_LIMIT}; allErrors: true for the rest), ` +
        "warnings counted by kind, layer and type. full: nothing counted in place of listing: every error and " +
        "warning whole (about 400 characters each), or with warnings / orphans every match listed however many."
    ),
  rootPath: rootPathSchema,
};

export type ModelValidateArgs = z.infer<z.ZodObject<typeof inputSchema>>;

/** Says what the summary left out and how to get it. */
const SUMMARY_MORE =
  "Warnings are counted by kind, layer and type, not listed. Pass warnings: [\"<kind>\"] to list a kind " +
  "(layers narrows it), orphans: true for orphans alone, or detail: \"full\" for every warning whole. " +
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

    if (args.orphans) {
      const orphans = orphanIds(modelToValidate);
      const list = full || orphans.length <= VALIDATE_LIST_LIMIT;
      return jsonResult(
        {
          view,
          ...scope,
          orphanCount: orphans.length,
          byLayer: countByLayerAndType(orphans),
          ...(list ? { orphanedElements: orphans } : {}),
          ...(list
            ? {}
            : {
                more:
                  `${orphans.length} orphans, more than the ${VALIDATE_LIST_LIMIT} listed by id, so these are counts by layer and type. ` +
                  'Pass layers to narrow it or detail: "full" to list them all; model_list with orphans: true ' +
                  "lists them by layer and type with names and descriptions.",
              }),
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

    const errors = full || args.allErrors ? result.errors : result.errors.slice(0, VALIDATE_ERROR_LIMIT);
    const errorsOmitted = result.errors.length - errors.length;
    const byKind = new Map<WarningKind, ValidationIssue[]>();
    for (const warning of result.warnings) {
      const kind = warningKind(warning);
      const ofKind = byKind.get(kind) ?? [];
      ofKind.push(warning);
      byKind.set(kind, ofKind);
    }
    return jsonResult(
      {
        ...header,
        summary: formatted.summary,
        errors,
        ...(errorsOmitted > 0
          ? {
              errorsOmitted,
              errorsByLayer: countByLayerAndType(result.errors.map(issueId)),
              errorsMore:
                `The first ${errors.length} of ${result.errors.length} errors are listed; errorsByLayer counts them all. ` +
                "Pass allErrors: true for every error (warnings stay counted), or layers to validate fewer layers.",
            }
          : {}),
        warningCounts: [...byKind].map(([kind, issues]) => ({
          kind,
          count: issues.length,
          byLayer: countByLayerAndType(issues.map(issueId)),
        })),
        ...(listed.length > 0
          ? { warnings: listed.map((kind) => listKind(kind, byKind.get(kind) ?? [], full)) }
          : {}),
        ...(formatted.acceptedGaps ? { acceptedGaps: formatted.acceptedGaps } : {}),
        ...(listed.length === 0 && result.warnings.length > 0 ? { more: SUMMARY_MORE } : {}),
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

/** One kind's warnings, listed: element ids for a per-element kind, the issues whole for any other. */
function listKind(kind: WarningKind, issues: ValidationIssue[], full: boolean): Record<string, unknown> {
  const base = { kind, count: issues.length };
  if (issues.length === 0) return base;
  if (!full && issues.length > VALIDATE_LIST_LIMIT) {
    return {
      ...base,
      byLayer: countByLayerAndType(issues.map(issueId)),
      more: `More than the ${VALIDATE_LIST_LIMIT} listed: narrow it with layers, or pass detail: "full".`,
    };
  }
  if (!PER_ELEMENT_KINDS.has(kind)) return { ...base, issues };
  return {
    ...base,
    means: issues[0].message.replace(/^Element '[^']*' /, ""),
    ...(issues[0].fixSuggestion ? { fix: issues[0].fixSuggestion } : {}),
    elements: issues.map((issue) => issue.elementId),
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
    "changeset leaves it (view says which). The default fits one result: valid, the errors whole (the first " +
    `${VALIDATE_ERROR_LIMIT}, the rest counted; allErrors: true returns them all), and the warnings ` +
    "counted by kind, layer and type. warnings: [\"<kind>\"] lists a kind as element ids, orphans: true reports the " +
    'orphaned elements alone, and detail: "full" returns every warning whole. Motivation, business and product ' +
    "elements are not asked for a source reference: they have no implementation to point at.",
  inputSchema,
  handler: modelValidateHandler,
};
