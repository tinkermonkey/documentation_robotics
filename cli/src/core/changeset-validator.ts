/**
 * ChangesetValidator - Validates staged changes against projected model
 *
 * Runs the validation pipeline against a merged view of the base model with
 * staged changes applied, and against the base model itself, so a commit is
 * judged by the errors the changeset introduces rather than by the base's.
 */

import { VirtualProjectionEngine, type ProjectedModel } from "./virtual-projection.js";
import { StagedChangesetStorage } from "./staged-changeset-storage.js";
import { Validator } from "../validators/validator.js";
import { ValidationResult, type ValidationIssue } from "../validators/types.js";
import type { Model } from "./model.js";
import type { Layer } from "./layer.js";
import type { StagedChange } from "./changeset.js";
import { Relationships, elementIdentifiers, type Relationship } from "./relationships.js";
import { getErrorMessage } from "../utils/errors.js";

/**
 * The outcome of judging a changeset: what it introduces, and what was already wrong.
 */
export interface ChangesetValidationReport {
  /**
   * Errors that block the commit: those the projected model has beyond the base
   * model's. Pre-existing errors are carried as warnings.
   */
  result: ValidationResult;
  /** Errors the base model already had that the projected model still has. */
  preExistingErrors: ValidationIssue[];
  /** Set when the base model could not be validated, so every projected error blocks. */
  baseValidationFailure?: string;
}

/** Identity of an error, for comparing the base model's errors with the projection's. */
function errorKey(issue: ValidationIssue): string {
  return `${issue.layer}\u0000${issue.elementId ?? ""}\u0000${issue.message}`;
}

/**
 * Validates changesets by running validation pipeline on projected models
 */
export class ChangesetValidator {
  private projectionEngine: VirtualProjectionEngine;
  private storage: StagedChangesetStorage;
  private validator: Validator;

  constructor(rootPath: string) {
    this.projectionEngine = new VirtualProjectionEngine(rootPath);
    this.storage = new StagedChangesetStorage(rootPath);
    this.validator = new Validator();
  }

  /**
   * Validate a changeset by running the full validation pipeline on its projected model.
   *
   * See {@link validateChangesetReport}: only errors the changeset introduces are
   * returned as errors; errors the base model already had are demoted to warnings.
   */
  async validateChangeset(baseModel: Model, changesetId: string): Promise<ValidationResult> {
    return (await this.validateChangesetReport(baseModel, changesetId)).result;
  }

  /**
   * Judge the change, not the base: validate the committed base model and the
   * projected model (base + staged changes), and block only on errors the
   * projection has beyond the base's. An error is identified by its layer,
   * element and message, and counted, so a changeset that adds another copy of
   * an existing problem still blocks.
   *
   * A model with pre-existing errors (a relationship the catalog has since
   * retired, say) can therefore take a change to the same element; those errors
   * come back as warnings and in `preExistingErrors`.
   */
  async validateChangesetReport(baseModel: Model, changesetId: string): Promise<ChangesetValidationReport> {
    const changeset = await this.storage.load(changesetId);

    // Project the model with staged changes applied
    const projectedModel = await this.projectionEngine.projectModel(baseModel, changesetId);

    // Relationships as committed, without the active changeset's staged changes that
    // Model.load() merges in, so the result does not depend on which changeset is active.
    const baseRelationships = baseModel.getBaseRelationships();

    // Relationships as the changeset leaves them. Those naming an element this changeset
    // deletes are removed at commit (by UUID or by path), so they are left out here too.
    const projectedRelationships = Relationships.fromArray([...baseRelationships]);
    const deletedIdentifiers = new Set<string>();
    for (const change of (changeset?.changes ?? []) as StagedChange[]) {
      if (change.type === "relationship-add" && change.after) {
        const rel = change.after as unknown as Relationship;
        if (projectedRelationships.find(rel.source, rel.target, rel.predicate).length === 0) {
          projectedRelationships.add({ ...rel, category: rel.category ?? "structural" });
        }
      } else if (change.type === "relationship-delete" && change.before) {
        const rel = change.before as { source: string; target: string; predicate?: string };
        projectedRelationships.delete(rel.source, rel.target, rel.predicate);
      } else if (change.type === "delete") {
        const before = (change.before ?? {}) as { id?: unknown; path?: unknown };
        for (const id of elementIdentifiers(before, change.elementId)) {
          deletedIdentifiers.add(id);
        }
      }
    }
    projectedModel.relationships =
      deletedIdentifiers.size > 0
        ? Relationships.fromArray(
            projectedRelationships
              .getAll()
              .filter((rel) => !deletedIdentifiers.has(rel.source) && !deletedIdentifiers.has(rel.target))
          )
        : projectedRelationships;

    const projectedResult = await this.validator.validateModel(projectedModel as unknown as Model);

    // The base model, validated the same way.
    let baseErrors: ValidationIssue[] = [];
    let baseValidationFailure: string | undefined;
    try {
      const baseLayers = new Map<string, Layer>();
      for (const name of baseModel.getLayerNames()) {
        const layer = await baseModel.getBaseLayer(name);
        if (layer) baseLayers.set(name, layer);
      }
      const baseView: ProjectedModel = {
        manifest: baseModel.manifest,
        layers: baseLayers,
        relationships: Relationships.fromArray([...baseRelationships]),
        loadedLayerFilter: baseModel.loadedLayerFilter,
        isProjection: true,
      };
      baseErrors = (await this.validator.validateModel(baseView as unknown as Model)).errors;
    } catch (error) {
      // Without a base to compare against, every projected error blocks (the strict
      // behaviour), and the report says why.
      baseValidationFailure = getErrorMessage(error);
    }

    const remaining = new Map<string, number>();
    for (const issue of baseErrors) {
      const key = errorKey(issue);
      remaining.set(key, (remaining.get(key) ?? 0) + 1);
    }

    const result = new ValidationResult();
    const preExistingErrors: ValidationIssue[] = [];
    for (const issue of projectedResult.errors) {
      const key = errorKey(issue);
      const count = remaining.get(key) ?? 0;
      if (count > 0) {
        remaining.set(key, count - 1);
        preExistingErrors.push(issue);
        result.warnings.push({ ...issue, severity: "warning", message: `(pre-existing) ${issue.message}` });
      } else {
        result.errors.push(issue);
      }
    }
    result.warnings.push(...projectedResult.warnings);

    return { result, preExistingErrors, ...(baseValidationFailure ? { baseValidationFailure } : {}) };
  }
}
