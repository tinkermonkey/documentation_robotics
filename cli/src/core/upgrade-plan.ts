/**
 * Upgrade plan - what `dr upgrade` and the `project_upgrade` MCP tool would change in a project,
 * as data. The CLI prints it and asks; the MCP tool returns it as the preview.
 *
 * It covers the spec reference (.dr/) and the model. Installed integrations (Claude Code,
 * Copilot) are scanned by `dr upgrade` itself: the MCP tool leaves them alone.
 */

import { getSpecReferencePath, getModelPath } from "../utils/project-paths.js";
import { getCliBundledSpecVersion, getInstalledSpecVersion, getModelSpecVersion } from "../utils/spec-version.js";
import { MigrationRegistry } from "./migration-registry.js";
import { Model } from "./model.js";
import { applyCatalogMigrations, type CatalogMigrationResult } from "./catalog-migration.js";
import { summarizeRetiredAttributeChanges } from "./attribute-migration.js";
import { droppedRelationshipsOf, planDropRecord, type UpgradeDropRecord } from "./upgrade-drop-record.js";
import { relayoutModelFiles, type RelayoutResult } from "./model-relayout.js";
import { getErrorMessage } from "../utils/errors.js";
import { fileExists } from "../utils/file-io.js";
import { join } from "path";

export interface UpgradeAction {
  /** relayout: model files an earlier dr wrote, laid out in dr's layout with their data unchanged (#1439) */
  type: "spec" | "model" | "relayout" | "integration";
  description: string;
  fromVersion?: string;
  toVersion: string;
  details?: string[];
  integrationName?: "claude" | "copilot";
  versionBumpOnly?: boolean;
  /** Model already at the target version, but with catalog changes it has not received */
  catalogOnly?: boolean;
}

/** A migration step between two spec versions */
export interface UpgradeStep {
  from: string;
  to: string;
  description: string;
  /** The step renames element types and rewrites relationships from the generated table */
  rewritesCatalog?: boolean;
}

export type UpgradeModelState =
  | { state: "missing" }
  | { state: "no-spec-version" }
  | { state: "found"; specVersion: string; targetSpecVersion: string };

export interface UpgradeScan {
  projectRoot: string;
  bundledSpecVersion: string;
  /** The spec reference's (.dr/) version; null when it is missing or has no manifest */
  installedSpecVersion: string | null;
  model: UpgradeModelState;
  /** Spec reference and model actions, in the order they run. Integrations are not included. */
  actions: UpgradeAction[];
  /** The migration steps from the model's version to the target; empty when there are none */
  steps: UpgradeStep[];
  /** Set when the model is behind and no migration leads to the target (and force is off) */
  noMigrationPath?: { from: string; to: string; available: UpgradeStep[] };
  /**
   * The catalog dry run, when the scan ran one: a model at the target version is checked for
   * element types, attributes and relationships the catalog has retired
   */
  catalogPreview?: CatalogMigrationResult;
  /** The catalog check failed; the scan goes on without a catalog action */
  catalogCheckError?: string;
  /**
   * The model's element files not in dr's layout (written by an earlier dr, or laid out by
   * prettier): a relayout action lays them out when the scan was asked for one (#1439)
   */
  relayout?: RelayoutResult;
}

export interface UpgradeScanOptions {
  force?: boolean;
  /**
   * Migrate the model to the spec version this CLI carries even when the installed spec
   * reference is older or missing, so one run moves both. Without it the model targets the
   * installed reference's version. `dr upgrade` and the MCP tool both set it.
   */
  targetBundledSpec?: boolean;
  /**
   * Plan a relayout of the model's element files not in dr's layout, data unchanged, as an action
   * of its own (#1439). Without it the scan only counts them (`relayout`): an upgrade otherwise
   * writes no model file whose data does not change.
   */
  relayout?: boolean;
}

/** An error reading the spec reference or model manifest; `dr upgrade` prints it before failing. */
export class UpgradeScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpgradeScanError";
  }
}

/** Scan the project at projectRoot for spec reference and model upgrades. Changes nothing. */
export async function scanUpgrades(projectRoot: string, options: UpgradeScanOptions = {}): Promise<UpgradeScan> {
  const bundledSpecVersion = getCliBundledSpecVersion();
  const actions: UpgradeAction[] = [];
  const scan: UpgradeScan = {
    projectRoot,
    bundledSpecVersion,
    installedSpecVersion: null,
    model: { state: "missing" },
    actions,
    steps: [],
  };

  // Spec reference (.dr/ folder)
  const drPath = await getSpecReferencePath(projectRoot);
  let currentSpecVersion: string | null = null;

  if (!drPath) {
    actions.push({
      type: "spec",
      description: "Install spec reference",
      toVersion: bundledSpecVersion,
      details: ["Create .dr/ folder", "Install schema files", `Set spec version to ${bundledSpecVersion}`],
    });
  } else {
    let installedSpecVersion: string | null = null;
    try {
      installedSpecVersion = await getInstalledSpecVersion(drPath);
    } catch (error) {
      // Manifest file exists but is corrupted or unreadable
      throw new UpgradeScanError(getErrorMessage(error));
    }
    currentSpecVersion = installedSpecVersion;
    scan.installedSpecVersion = installedSpecVersion;

    if (!installedSpecVersion && !(await fileExists(join(drPath, "spec")))) {
      // .dr/ holds only other per-checkout state (the analyzers' index, a fresh checkout's
      // changesets): the spec reference was never installed here, so nothing is broken
      actions.push({
        type: "spec",
        description: "Install spec reference",
        toVersion: bundledSpecVersion,
        details: ["Install schema files", `Set spec version to ${bundledSpecVersion}`],
      });
    } else if (!installedSpecVersion) {
      actions.push({
        type: "spec",
        description: "Reinstall spec reference (manifest missing)",
        toVersion: bundledSpecVersion,
        details: ["Recreate .dr/manifest.json", "Update schema files", `Set spec version to ${bundledSpecVersion}`],
      });
    } else if (installedSpecVersion !== bundledSpecVersion || options.force) {
      actions.push({
        type: "spec",
        description:
          installedSpecVersion !== bundledSpecVersion ? "Upgrade spec reference" : "Reinstall spec reference (forced)",
        fromVersion: installedSpecVersion,
        toVersion: bundledSpecVersion,
        details: ["Update schema files", "Update .dr/manifest.json"],
      });
    }
  }

  // Model
  const modelPath = await getModelPath(projectRoot);
  if (!modelPath) {
    return scan;
  }

  let modelSpecVersion: string | null = null;
  try {
    modelSpecVersion = await getModelSpecVersion(modelPath);
  } catch (error) {
    // Manifest file exists but is corrupted or unreadable
    throw new UpgradeScanError(getErrorMessage(error));
  }

  if (!modelSpecVersion) {
    scan.model = { state: "no-spec-version" };
    return scan;
  }

  const targetSpecVersion = options.targetBundledSpec
    ? bundledSpecVersion
    : currentSpecVersion || bundledSpecVersion;
  scan.model = { state: "found", specVersion: modelSpecVersion, targetSpecVersion };

  if (modelSpecVersion !== targetSpecVersion) {
    const registry = new MigrationRegistry();
    const summary = registry.getMigrationSummary(modelSpecVersion, targetSpecVersion);

    if (summary.migrationsNeeded === 0) {
      if (options.force) {
        // No migration path exists, but --force allows bumping the model version directly.
        // This is safe for additive spec changes (new node types / relationships) that
        // require no structural data changes.
        actions.push({
          type: "model",
          description: "Force-update model spec version (no migration required)",
          fromVersion: modelSpecVersion,
          toVersion: targetSpecVersion,
          details: ["Update manifest.yaml specVersion (no data changes needed)"],
          versionBumpOnly: true,
        });
      } else {
        scan.noMigrationPath = {
          from: modelSpecVersion,
          to: targetSpecVersion,
          available: registry.getMigrationSummary("0.5.0").migrations,
        };
      }
      return scan;
    }

    scan.steps = summary.migrations;
    actions.push({
      type: "model",
      description: "Migrate model data",
      fromVersion: modelSpecVersion,
      toVersion: targetSpecVersion,
      details: summary.migrations.map((m) => `${m.from} → ${m.to}: ${m.description}`),
    });
  } else {
    // Same spec version, but the relationship catalog can change between version bumps: a
    // model stamped with the current version before a catalog change still needs it
    try {
      scan.catalogPreview = await previewCatalogMigration(projectRoot);
    } catch (error) {
      scan.catalogCheckError = getErrorMessage(error);
    }
    const catalogAction = scan.catalogPreview ? catalogActionFor(scan.catalogPreview, targetSpecVersion) : null;
    if (catalogAction) {
      actions.push(catalogAction);
    }
  }

  // Model files an earlier dr laid out (long strings folded at 80 columns): counted, and with the
  // relayout option laid out as a step of their own, so the next landing that touches one carries
  // only its own changes (#1439)
  const relayout = await relayoutModelFiles(projectRoot, { dryRun: true });
  if (relayout.files.length > 0) {
    scan.relayout = relayout;
    if (options.relayout) actions.push(relayoutAction(relayout, targetSpecVersion));
  }

  return scan;
}

/** How many files the relayout action names in its details before counting the rest. */
const RELAYOUT_FILES_NAMED = 10;

function relayoutAction(relayout: RelayoutResult, toVersion: string): UpgradeAction {
  const { files } = relayout;
  return {
    type: "relayout",
    description: `Lay out ${files.length} model file(s) as this dr writes them (data unchanged)`,
    toVersion,
    details: [
      `${files.length} of ${relayout.total} element files are in an earlier dr's layout (long strings folded at 80 ` +
        "columns). Re-laying them out now keeps that out of later landings: commit it on its own.",
      ...files.slice(0, RELAYOUT_FILES_NAMED),
      ...(files.length > RELAYOUT_FILES_NAMED
        ? [`and ${files.length - RELAYOUT_FILES_NAMED} more (project_upgrade's relayout.files and dr upgrade --full list them all)`]
        : []),
    ],
  };
}

/** What the catalog migration would change in the model at projectRoot, without changing it. */
export async function previewCatalogMigration(projectRoot: string): Promise<CatalogMigrationResult> {
  return applyCatalogMigrations(await Model.load(projectRoot, { lazyLoad: false }), { dryRun: true });
}

/** Catalog migration details with no changes */
export function emptyCatalogDetails(): CatalogMigrationResult["details"] {
  return {
    elementTypeChanges: [],
    retiredAttributeChanges: [],
    stagedRetiredAttributeChanges: [],
    relationshipChanges: [],
    stagedRelationshipChanges: [],
  };
}

/**
 * The catalog changes the scanned plan makes: from the scan, or a dry run when a migration step
 * rewrites the catalog. A failed dry run is reported in errors, with no changes.
 */
export async function previewCatalog(
  projectRoot: string,
  scan: UpgradeScan
): Promise<{ details: CatalogMigrationResult["details"]; errors: string[] }> {
  if (scan.catalogPreview) {
    return { details: scan.catalogPreview.details, errors: scan.catalogPreview.errors };
  }
  if (!scan.steps.some((step) => step.rewritesCatalog)) {
    return { details: emptyCatalogDetails(), errors: [] };
  }
  try {
    const preview = await previewCatalogMigration(projectRoot);
    return { details: preview.details, errors: preview.errors };
  } catch (error) {
    return {
      details: emptyCatalogDetails(),
      errors: [`Could not preview the catalog changes: ${getErrorMessage(error)}`],
    };
  }
}

/**
 * The upgrade record the scanned plan would write for the relationships its catalog changes drop
 * (upgrade-drop-record.ts): its name, the count and the drops by type with the routes the catalog
 * still has. Undefined when the plan drops nothing, or the model's target version is unknown.
 */
export async function previewDropRecord(
  projectRoot: string,
  scan: UpgradeScan,
  details: CatalogMigrationResult["details"]
): Promise<UpgradeDropRecord | undefined> {
  if (scan.model.state !== "found") {
    return undefined;
  }
  return planDropRecord(projectRoot, scan.model.targetSpecVersion, droppedRelationshipsOf(details));
}

/** Relationships the migration drops, counted by predicate and source and target element type */
export interface DroppedRelationshipCount {
  sourceType: string;
  predicate: string;
  targetType: string;
  count: number;
}

/** The element type (`{layer}.{type}`) an element id names */
function elementTypeOf(elementId: string): string {
  return elementId.split(".").slice(0, 2).join(".");
}

/**
 * Count the relationships a catalog migration drops for want of a replacement, by predicate and
 * source and target type, most first. Relationships dropped as duplicates of a rewritten one
 * aren't lost, so they aren't counted.
 */
export function countDroppedRelationships(
  changes: Array<{ action: string; before: { source: string; predicate: string; target: string } }>
): DroppedRelationshipCount[] {
  const counts = new Map<string, DroppedRelationshipCount>();
  for (const change of changes) {
    if (change.action !== "dropped") continue;
    const sourceType = elementTypeOf(change.before.source);
    const targetType = elementTypeOf(change.before.target);
    const key = `${sourceType} ${change.before.predicate} ${targetType}`;
    const entry = counts.get(key) ?? { sourceType, predicate: change.before.predicate, targetType, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  return [...counts.values()].sort(
    (a, b) =>
      b.count - a.count ||
      a.sourceType.localeCompare(b.sourceType) ||
      a.predicate.localeCompare(b.predicate) ||
      a.targetType.localeCompare(b.targetType)
  );
}

/**
 * A model action when a model at the current spec version still names element types,
 * attributes or relationship types the catalog has retired; null when it is in line with the
 * catalog
 */
function catalogActionFor(preview: CatalogMigrationResult, version: string): UpgradeAction | null {
  const elementTypes = preview.details.elementTypeChanges.length;
  const retiredAttributes = preview.details.retiredAttributeChanges.length;
  const stagedRetiredAttributes = preview.details.stagedRetiredAttributeChanges.length;
  const relationships = preview.details.relationshipChanges.length;
  const stagedRelationships = preview.details.stagedRelationshipChanges.length;
  const details = [
    ...(elementTypes > 0 ? [`Rename ${elementTypes} element(s) whose type was renamed`] : []),
    ...(retiredAttributes > 0
      ? [`Remove retired attributes from ${retiredAttributes} element(s): ${summarizeRetiredAttributeChanges(preview.details.retiredAttributeChanges)}`]
      : []),
    ...(stagedRetiredAttributes > 0
      ? [`Remove retired attributes from ${stagedRetiredAttributes} staged change(s)`]
      : []),
    ...(relationships > 0 ? [`Rewrite or drop ${relationships} relationship(s) of retired types`] : []),
    ...(stagedRelationships > 0 ? [`Rewrite ${stagedRelationships} staged relationship change(s)`] : []),
  ];
  if (details.length === 0) {
    return null;
  }
  return {
    type: "model",
    description: `Apply catalog changes to the model (spec v${version})`,
    fromVersion: version,
    toVersion: version,
    details,
    catalogOnly: true,
  };
}
