/**
 * Upgrade validation - how the model stands against the spec after `dr upgrade` or the
 * `project_upgrade` MCP tool applied a migration.
 *
 * A new spec version can make attributes required that the migrated elements don't have. The
 * upgrade doesn't invent values for them: it stages the ones that follow plainly from the element
 * for review (upgrade-fills.ts) and lists what is left to fill in, per element and attribute, so
 * the follow-up is a checklist rather than a validation run.
 */

import type { Model } from "./model.js";
import { Relationships } from "./relationships.js";
import { Validator } from "../validators/validator.js";
import { addModelWarnings } from "../validators/model-warnings.js";
import type { ValidationIssue, ValidationResult } from "../validators/types.js";

/** How many errors and warnings validationSummary lists by default; errorCount and warningCount are of all of them */
export const MAX_VALIDATION_ISSUES = 20;

/** How many elements validationSummary lists under unfilledRequired by default */
const MAX_UNFILLED_LISTED = 200;

/** How to get what a shortened validation list leaves out */
const VALIDATION_MORE =
  'model_validate lists every error and warning; project_upgrade with detail: "full" returns every item with its result.';

/** Required attributes an element leaves out */
export interface UnfilledRequired {
  elementId: string;
  layer: string;
  /** Attribute names, relative to the element's attributes (nested ones dotted) */
  attributes: string[];
}

/** The validation errors on one element; elementId is absent for errors on no element */
export interface ElementIssues {
  elementId?: string;
  layer: string;
  /** Required attributes the element leaves out */
  missingAttributes: string[];
  /** Its other errors */
  messages: string[];
}

/**
 * Validate the committed model only, with the warnings `dr validate` adds (orphaned elements, no
 * source reference), so the counts match it. Model.load merges an active changeset's staged
 * relationship adds and deletes into `relationships` (its layers stay the base), so the check
 * swaps the committed relationships back in rather than validate a mix of base and plan.
 */
export async function validateBaseModel(model: Model): Promise<ValidationResult> {
  const base = { ...model, relationships: new Relationships(model.getBaseRelationships()) } as unknown as Model;
  const result = await new Validator().validateModel(base);
  addModelWarnings(result, base);
  return result;
}

/** The required attribute an error says is missing, or null when it says something else */
function missingAttribute(issue: ValidationIssue): string | null {
  const match = /missing required property '([^']+)'/.exec(issue.message);
  if (!match) return null;
  const segments = (issue.location ?? "").split("/").filter(Boolean);
  if (segments[0] === "attributes") segments.shift();
  return [...segments, match[1]].join(".");
}

/** The validation errors grouped per element, in the order the elements first appear */
export function errorsByElement(errors: ValidationIssue[]): ElementIssues[] {
  const groups = new Map<string, ElementIssues>();
  for (const error of errors) {
    const key = error.elementId ?? `\0${error.layer}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        ...(error.elementId ? { elementId: error.elementId } : {}),
        layer: error.layer,
        missingAttributes: [],
        messages: [],
      };
      groups.set(key, group);
    }
    const attribute = error.elementId ? missingAttribute(error) : null;
    if (attribute) {
      if (!group.missingAttributes.includes(attribute)) group.missingAttributes.push(attribute);
    } else {
      group.messages.push(error.message);
    }
  }
  return [...groups.values()];
}

/** The required attributes each element leaves out, for elements that leave any out */
export function unfilledRequired(errors: ValidationIssue[]): UnfilledRequired[] {
  return errorsByElement(errors)
    .filter((group) => group.elementId && group.missingAttributes.length > 0)
    .map((group) => ({ elementId: group.elementId!, layer: group.layer, attributes: group.missingAttributes }));
}

/** Derived values staged for review in one changeset (upgrade-fills.ts) */
export interface StagedFills {
  name: string;
  error?: string;
  fills: Array<{ elementId: string; attribute: string }>;
}

/** Drop the attributes that have a value staged for review; elements left with none are dropped too */
export function withoutStaged(
  unfilled: UnfilledRequired[],
  staged: Array<{ elementId: string; attribute: string }>
): UnfilledRequired[] {
  const keys = new Set(staged.map((fill) => `${fill.elementId} ${fill.attribute}`));
  return unfilled
    .map((item) => ({ ...item, attributes: item.attributes.filter((attribute) => !keys.has(`${item.elementId} ${attribute}`)) }))
    .filter((item) => item.attributes.length > 0);
}

/**
 * The base model's validation as the upgrade reports it: counts, the first errors and warnings,
 * and every required attribute left empty (unfilledRequired), per element. Attributes with a
 * derived value staged for review (`fills`, upgrade-fills.ts) still fail validation until that
 * changeset lands, but are counted apart (stagedForReview), not listed as left to fill in.
 */
export async function validationSummary(
  model: Model,
  maxIssues: number = MAX_VALIDATION_ISSUES,
  fills?: StagedFills | StagedFills[],
  options: { full?: boolean } = {}
) {
  // The counts and the verdict are of the whole model. The lists are shortened by default and say
  // so; `full` lists every error, warning and element.
  const issueLimit = options.full ? Infinity : maxIssues;
  const unfilledLimit = options.full ? Infinity : MAX_UNFILLED_LISTED;
  const result = await validateBaseModel(model);
  const issue = (item: { layer: string; elementId?: string; message: string }) => ({
    layer: item.layer,
    ...(item.elementId ? { elementId: item.elementId } : {}),
    message: item.message,
  });
  const errors = result.errors.slice(0, issueLimit).map(issue);
  const warnings = result.warnings.slice(0, issueLimit).map(issue);
  const shortened = result.errors.length > errors.length || result.warnings.length > warnings.length;
  const stagedIn = (Array.isArray(fills) ? fills : fills ? [fills] : []).filter(
    (entry) => !entry.error && entry.fills.length > 0
  );
  const staged = stagedIn.flatMap((entry) => entry.fills);
  const unfilled = withoutStaged(unfilledRequired(result.errors), staged);
  return {
    scope: "base model (staged changesets not included)",
    valid: result.isValid(),
    errorCount: result.errors.length,
    warningCount: result.warnings.length,
    ...(staged.length > 0
      ? {
          stagedForReview: {
            note: "Required attributes with a derived value staged for review. They stay validation errors on the base model until the user lands the changeset.",
            changeset: stagedIn[0].name,
            ...(stagedIn.length > 1 ? { changesets: stagedIn.map((entry) => entry.name) } : {}),
            attributeCount: staged.length,
          },
        }
      : {}),
    ...(unfilled.length > 0
      ? {
          unfilledRequired: {
            note: "Required attributes these elements leave empty and the upgrade has no value to derive for. It doesn't invent values: fill them in from the code or the user.",
            elementCount: unfilled.length,
            attributeCount: unfilled.reduce((n, item) => n + item.attributes.length, 0),
            elements: unfilled.slice(0, unfilledLimit),
            ...(unfilled.length > unfilledLimit
              ? { shown: unfilledLimit, omitted: unfilled.length - unfilledLimit, more: VALIDATION_MORE }
              : {}),
          },
        }
      : {}),
    ...(errors.length > 0 ? { errors } : {}),
    ...(result.errors.length > errors.length ? { moreErrors: result.errors.length - errors.length } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(result.warnings.length > warnings.length ? { moreWarnings: result.warnings.length - warnings.length } : {}),
    ...(shortened ? { more: VALIDATION_MORE } : {}),
  };
}
