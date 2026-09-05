/**
 * Attribute-collision repair — finds and best-effort-recovers data lost to a fixed bug in
 * Model.saveLayer(): a hardcoded, type-blind "internal fields" blocklist unconditionally
 * stripped any attribute literally named "source" or "x-source-reference" from EVERY element's
 * attributes before writing YAML, regardless of whether the element's own schema declared it as
 * a real domain attribute. 41 of 191 node schemas across 8 layers do (3 mark it required).
 *
 * Once an element was saved under the buggy code, the value is gone from the base model YAML —
 * this module can't un-delete data that was never persisted. What it CAN do:
 *
 * 1. Detect every element that's missing a schema-declared "source"/"x-source-reference"
 *    attribute — the fingerprint of damage from this bug (as opposed to the attribute simply
 *    never having been set, which looks identical for the base model alone).
 * 2. Attempt recovery from changeset history: StagedChangesetStorage writes changes.yaml
 *    directly (`yaml.stringify(changeset.changes)`), with NO pass through saveLayer()'s
 *    stripping — so an add/update recorded while this bug was active can still hold the
 *    original, un-stripped value, for as long as that changeset file hasn't been deleted
 *    (committing a changeset does NOT delete it — see StagingAreaManager.commit()).
 *
 * Elements with no recoverable value are reported, never fabricated — this is a best-effort
 * repair, not a guarantee, and the report is only advisory for optional attributes (there's no
 * way to distinguish "this bug stripped it" from "this was never set" from the base model alone).
 */

import { Model } from "./model.js";
import { StagedChangesetStorage } from "./staged-changeset-storage.js";
import type { Change } from "./changeset.js";
import { getNodeType } from "../generated/node-types.js";
import type { SpecNodeId } from "../generated/node-types.js";

/** The exact two attribute names the pre-fix INTERNAL_FIELDS blocklist unconditionally
 *  stripped, despite being legitimate schema-declared attributes on some node types. Kept as an
 *  explicit historical constant, not derived from current code — the whole point of this module
 *  is to find damage from a bug that no longer exists in model.ts, so it can't reconstruct this
 *  list by reading the (now-fixed) stripping logic. `__references__`/`__relationships__` are
 *  NOT included: those were, and remain, genuinely internal on every node type (zero schema
 *  collisions), so their absence is never damage from this bug. */
export const HISTORICALLY_COLLIDING_ATTRIBUTE_NAMES = ["source", "x-source-reference"] as const;

export interface CollisionCandidate {
  /** Element path (preferred, human-readable) or id if no path is set. */
  elementRef: string;
  elementId: string;
  layerName: string;
  specNodeId: string;
  attribute: (typeof HISTORICALLY_COLLIDING_ATTRIBUTE_NAMES)[number];
  /** Whether the schema marks this attribute required — a required+missing attribute means the
   *  element currently FAILS validation, not just a silent gap. */
  required: boolean;
  recovered?: {
    value: unknown;
    changesetId: string;
    changesetName: string;
    changeTimestamp?: string;
  };
}

/**
 * Scan every element in the model for one of the two historically-colliding attribute names
 * being declared by its schema but absent from its current, persisted attributes.
 */
export function scanForAttributeCollisionDamage(model: Model): CollisionCandidate[] {
  const candidates: CollisionCandidate[] = [];

  for (const layerName of model.getLayerNames()) {
    const layer = model.layers.get(layerName);
    if (!layer) continue;

    for (const element of layer.elements.values()) {
      if (!element.spec_node_id) continue;
      const nodeType = getNodeType(element.spec_node_id as SpecNodeId);
      if (!nodeType) continue;

      for (const attribute of HISTORICALLY_COLLIDING_ATTRIBUTE_NAMES) {
        const required = nodeType.requiredAttributes.includes(attribute);
        const optional = nodeType.optionalAttributes.includes(attribute);
        if (!required && !optional) continue; // Not declared by this type — nothing to check.

        const hasValue =
          element.attributes != null &&
          Object.prototype.hasOwnProperty.call(element.attributes, attribute) &&
          element.attributes[attribute] !== undefined;
        if (hasValue) continue; // Present — unaffected.

        candidates.push({
          elementRef: element.path || element.id,
          elementId: element.id,
          layerName,
          specNodeId: element.spec_node_id,
          attribute,
          required,
        });
      }
    }
  }

  return candidates;
}

/**
 * Attempt to recover each candidate's original value from changeset history. Mutates and
 * returns the same array with `.recovered` filled in where a value was found — searches every
 * changeset (active, committed, or discarded; committing does not delete the changeset file),
 * newest-first, for the most recent add/update change touching this element that carried a
 * non-empty value for the missing attribute.
 */
export async function attemptRecovery(
  candidates: CollisionCandidate[],
  storage: StagedChangesetStorage
): Promise<CollisionCandidate[]> {
  if (candidates.length === 0) return candidates;

  const changesets = await storage.list();
  // Newest-first by last-modified, so the first match found is the most recent one.
  changesets.sort((a, b) => (b.modified || "").localeCompare(a.modified || ""));

  for (const candidate of candidates) {
    for (const changeset of changesets) {
      const changes = [...changeset.changes].sort(
        (a, b) => (b.timestamp || "").localeCompare(a.timestamp || "")
      );

      const match = changes.find((change: Change) => {
        if (change.type !== "add" && change.type !== "update") return false;
        if (change.elementId !== candidate.elementRef && change.elementId !== candidate.elementId) {
          return false;
        }
        const afterAttrs = (change.after as { attributes?: Record<string, unknown> } | undefined)
          ?.attributes;
        return afterAttrs != null && afterAttrs[candidate.attribute] !== undefined;
      });

      if (match) {
        const afterAttrs = (match.after as { attributes: Record<string, unknown> }).attributes;
        candidate.recovered = {
          value: afterAttrs[candidate.attribute],
          changesetId: changeset.id,
          changesetName: changeset.name,
          changeTimestamp: match.timestamp,
        };
        break;
      }
    }
  }

  return candidates;
}

/**
 * Apply recovered values back onto the live model (in memory — caller is responsible for
 * saving the affected layers). Returns the list of candidates actually repaired.
 */
export function applyRecovery(model: Model, candidates: CollisionCandidate[]): CollisionCandidate[] {
  const repaired: CollisionCandidate[] = [];

  for (const candidate of candidates) {
    if (!candidate.recovered) continue;
    const layer = model.layers.get(candidate.layerName);
    if (!layer) continue;
    const element = layer.getElement(candidate.elementRef) ?? layer.getElement(candidate.elementId);
    if (!element) continue;

    element.attributes = { ...element.attributes, [candidate.attribute]: candidate.recovered.value };
    layer.updateElement(element);
    repaired.push(candidate);
  }

  return repaired;
}
