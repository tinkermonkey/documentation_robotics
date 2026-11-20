/**
 * Upgrade fills - values for attributes a new spec version made required, derived from what the
 * element already says and staged for review (#1166).
 *
 * A migration can leave elements without an attribute the new spec requires. Some of those values
 * follow plainly from the element itself: an operation's `operationId` from its name, a `title`
 * from the name. The upgrade derives only those, never guesses, and never writes them to the base
 * model: they go into a staged changeset, `upgrade-fills-<spec version>`, one staged update per
 * element, each naming the rule that produced its values. It is an ordinary plan changeset: the
 * user reviews it, edits or unstages what is wrong, and lands it. What no rule covers stays in the
 * upgrade's checklist of required attributes left empty.
 */

import { Model } from "./model.js";
import type { Element } from "./element.js";
import type { Change } from "./changeset.js";
import { StagingAreaManager } from "./staging-area.js";
import { StagedChangesetStorage } from "./staged-changeset-storage.js";
import { getNodeType, type SpecNodeId } from "../generated/node-types.js";
import { getErrorMessage } from "../utils/errors.js";
import type { UnfilledRequired } from "./upgrade-validation.js";

/** Upgrade fill changesets are named `upgrade-fills-<spec version>` (then `-2`, `-3`, ...) */
export const FILLS_NAME_PREFIX = "upgrade-fills-";

/** A value derived for one required attribute an element leaves empty */
export interface DerivedFill {
  elementId: string;
  layer: string;
  attribute: string;
  value: string;
  /** How the value was derived, in words */
  rule: string;
}

/** What the upgrade derived, and the changeset it staged the values in */
export interface UpgradeFills {
  /** The changeset's name; with `error` set, the name it would have had */
  name: string;
  /** The changeset's id; absent in a preview, or when it could not be written */
  id?: string;
  /** Values derived */
  count: number;
  /** Elements they are on */
  elements: number;
  fills: DerivedFill[];
  /** Why the changeset could not be written: the values are only in `fills` */
  error?: string;
}

/** The last segment of an element's dotted path: its kebab-case name */
function nameSegment(element: Element): string {
  const id = element.path || element.id;
  return id.split(".").slice(2).join(".");
}

/** `create-order` to `createOrder`; undefined when nothing usable is left */
export function camelCaseOf(kebab: string): string | undefined {
  const words = kebab.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return undefined;
  const camel = words
    .map((word, index) => (index === 0 ? word.charAt(0).toLowerCase() : word.charAt(0).toUpperCase()) + word.slice(1))
    .join("");
  return /^[A-Za-z_]/.test(camel) ? camel : undefined;
}

/** The first sentence of a text, on one line; undefined for an empty one */
export function firstSentence(text: string | undefined): string | undefined {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  const end = /[.!?](\s|$)/.exec(flat);
  return end ? flat.slice(0, end.index + 1) : flat;
}

interface FillRule {
  /** How the value is derived, in words: written to the staged change's origin */
  rule: string;
  derive: (element: Element) => string | undefined;
}

/**
 * The derivations, by attribute name. Each takes its value from the element's own name or
 * description and nothing else. An attribute not listed here is never filled.
 */
const FILL_RULES: Record<string, FillRule> = {
  operationId: {
    rule: "operationId: the element's name in camelCase",
    derive: (element) => camelCaseOf(nameSegment(element)),
  },
  summary: {
    rule: "summary: the first sentence of the element's description, else its name",
    derive: (element) => firstSentence(element.description) ?? (element.name?.trim() || undefined),
  },
  title: {
    rule: "title: the element's name",
    derive: (element) => element.name?.trim() || undefined,
  },
  label: {
    rule: "label: the element's name",
    derive: (element) => element.name?.trim() || undefined,
  },
  description: {
    rule: "description: the element's description",
    derive: (element) => element.description?.trim() || undefined,
  },
};

/** The attributes the upgrade has a derivation for */
export const DERIVABLE_ATTRIBUTES = Object.keys(FILL_RULES);

/** Whether the spec takes a plain string for the attribute, and this value in particular */
function fitsSchema(specNodeId: string, attribute: string, value: string): boolean {
  const constraint = getNodeType(specNodeId as SpecNodeId)?.attributeConstraints[attribute] as
    | { type?: unknown; enum?: unknown; pattern?: unknown; minLength?: unknown; maxLength?: unknown }
    | undefined;
  if (!constraint || constraint.type !== "string" || constraint.enum !== undefined) return false;
  if (typeof constraint.minLength === "number" && value.length < constraint.minLength) return false;
  if (typeof constraint.maxLength === "number" && value.length > constraint.maxLength) return false;
  if (typeof constraint.pattern === "string") {
    try {
      if (!new RegExp(constraint.pattern).test(value)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function findElement(model: Model, elementId: string): Element | undefined {
  for (const layer of model.layers.values()) {
    for (const element of layer.listElements()) {
      if (element.path === elementId || element.id === elementId) return element;
    }
  }
  return undefined;
}

/**
 * Derive values for the required attributes the model's elements leave empty. Returns the values
 * a rule gives (`fills`) and what is still empty after them (`left`), per element.
 *
 * An `operationId` must be unique in its model, so one that another operation already has, or
 * that two elements would both get, is not derived.
 */
export function deriveFills(
  model: Model,
  unfilled: UnfilledRequired[]
): { fills: DerivedFill[]; left: UnfilledRequired[] } {
  const operationIds = new Map<string, number>();
  const countOperationId = (value: unknown) => {
    if (typeof value === "string") operationIds.set(value, (operationIds.get(value) ?? 0) + 1);
  };
  for (const layer of model.layers.values()) {
    for (const element of layer.listElements()) countOperationId(element.attributes?.operationId);
  }

  const candidates: Array<DerivedFill | null> = [];
  const order: Array<{ item: UnfilledRequired; attribute: string; index: number }> = [];
  for (const item of unfilled) {
    const element = findElement(model, item.elementId);
    for (const attribute of item.attributes) {
      const rule = FILL_RULES[attribute];
      const value = element && rule ? rule.derive(element) : undefined;
      const specNodeId = element ? element.spec_node_id || `${element.layer_id ?? item.layer}.${element.type}` : "";
      const fill =
        element && rule && value !== undefined && fitsSchema(specNodeId.toLowerCase(), attribute, value)
          ? { elementId: item.elementId, layer: item.layer, attribute, value, rule: rule.rule }
          : null;
      if (fill?.attribute === "operationId") countOperationId(fill.value);
      order.push({ item, attribute, index: candidates.push(fill) - 1 });
    }
  }

  const fills: DerivedFill[] = [];
  const left = new Map<string, UnfilledRequired>();
  for (const { item, attribute, index } of order) {
    const fill = candidates[index];
    if (fill && !(attribute === "operationId" && (operationIds.get(fill.value) ?? 0) > 1)) {
      fills.push(fill);
      continue;
    }
    const entry = left.get(item.elementId) ?? { elementId: item.elementId, layer: item.layer, attributes: [] };
    entry.attributes.push(attribute);
    left.set(item.elementId, entry);
  }
  return { fills, left: [...left.values()] };
}

/** The fills grouped per element, in the order the elements first appear */
function byElement(fills: DerivedFill[]): Map<string, DerivedFill[]> {
  const groups = new Map<string, DerivedFill[]>();
  for (const fill of fills) groups.set(fill.elementId, [...(groups.get(fill.elementId) ?? []), fill]);
  return groups;
}

/** The changeset's description: what it is and what to do with it */
export function describeFills(versions: { fromVersion: string; toVersion: string }, fills: DerivedFill[]): string {
  const rules = [...new Set(fills.map((fill) => fill.rule))].sort();
  return [
    `Values the upgrade derived for ${fills.length} required attribute(s) on ${byElement(fills).size} element(s) ` +
      `that spec ${versions.toVersion} requires and the model, moved from spec ${versions.fromVersion}, left empty. ` +
      "Each staged update fills attributes on one element from that element's own name or description; its origin names the rule.",
    "Nothing here is in the base model yet. Review the values, correct or unstage the ones that are wrong, " +
      "then land the changeset, or discard it and fill the attributes by hand.",
    "",
    "Derived by:",
    ...rules.map((rule) => `- ${rule}`),
  ].join("\n");
}

/**
 * The name the next fills changeset takes: `upgrade-fills-<spec version>`, with `-2`, `-3`, ...
 * when a changeset of that name already exists.
 */
export async function nextFillsName(rootPath: string, toVersion: string): Promise<string> {
  const taken = new Set((await new StagedChangesetStorage(rootPath).list()).map((changeset) => changeset.name));
  const base = `${FILLS_NAME_PREFIX}${toVersion}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

function summarize(name: string, fills: DerivedFill[]): UpgradeFills {
  return { name, count: fills.length, elements: byElement(fills).size, fills };
}

/**
 * What the fills changeset would be, without writing it. Undefined when nothing was derived.
 */
export async function planFills(
  rootPath: string,
  toVersion: string,
  fills: DerivedFill[]
): Promise<UpgradeFills | undefined> {
  if (fills.length === 0) return undefined;
  return summarize(await nextFillsName(rootPath, toVersion), fills);
}

/**
 * Stage the derived values in a new changeset, one update per element. It is not made active and
 * the base model is not written. Call after the upgraded model is saved. Undefined when nothing
 * was derived (no changeset is written); with `error` set, the changeset could not be written.
 *
 * @param rootPath - the project root (Model.rootPath)
 */
export async function stageFills(
  rootPath: string,
  versions: { fromVersion: string; toVersion: string },
  fills: DerivedFill[]
): Promise<UpgradeFills | undefined> {
  const planned = await planFills(rootPath, versions.toVersion, fills);
  if (!planned) return undefined;

  try {
    // The upgraded model, read from disk: the changeset's base snapshot is the model it fills
    const model = await Model.load(rootPath, { lazyLoad: false });
    const timestamp = new Date().toISOString();
    const changes: Change[] = [];
    for (const [elementId, elementFills] of byElement(fills)) {
      const element = findElement(model, elementId);
      if (!element) continue;
      const before = element.toJSON() as unknown as Record<string, unknown>;
      const after = structuredClone(before);
      after.attributes = {
        ...((before.attributes as Record<string, unknown> | undefined) ?? {}),
        ...Object.fromEntries(elementFills.map((fill) => [fill.attribute, fill.value])),
      };
      changes.push({
        type: "update",
        elementId,
        layerName: elementFills[0].layer,
        before,
        after,
        timestamp,
        origin: { by: "upgrade", rule: elementFills.map((fill) => fill.rule).join("; ") },
      });
    }
    if (changes.length === 0) return undefined;

    const manager = new StagingAreaManager(model.rootPath, model);
    const changeset = await manager.create(
      planned.name,
      describeFills(versions, fills),
      { kind: "upgrade", detail: `spec ${versions.fromVersion} -> ${versions.toVersion}` },
      { purpose: "plan" }
    );
    await new StagedChangesetStorage(model.rootPath).addChanges(changeset.id!, changes);
    return { ...planned, id: changeset.id };
  } catch (error) {
    return { ...planned, error: getErrorMessage(error) };
  }
}
