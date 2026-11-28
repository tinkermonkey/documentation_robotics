/**
 * Shared input field schemas for the annotation_* MCP tools.
 */

import { z } from "zod";
import { AnnotationStore, type Annotation } from "../../core/annotation-store.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import type { Model } from "../../core/model.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";

export const annotationIdSchema = z.string().min(1).describe("Annotation ID (e.g. 'ann-1700000000000-a1b2c3d4').");

export const elementIdSchema = z
  .string()
  .min(1)
  .describe("Target element ID (e.g. 'api.operation.create-order').");

export const annotationContentSchema = z
  .string()
  .min(1, "Content is required")
  .max(5000, "Content too long (max 5000 characters)");

export const annotationAuthorSchema = z
  .string()
  .max(100, "Author name too long (max 100 characters)")
  .optional()
  .describe("Author name. Defaults to 'Anonymous'.");

export const annotationTagsSchema = z
  .array(z.string())
  .optional()
  .describe("Tags to attach to the annotation.");

export const annotationChangesetSchema = z
  .string()
  .optional()
  .describe(
    "The changeset (ID or name) to stage the annotation in. Default: the active changeset, if there is one; " +
      "with none, the annotation is written to the base model straight away. A staged annotation lands with the " +
      "plan and is discarded with it."
  );

/** Where an annotation lives: the base store, or a staged changeset's. */
export interface AnnotationHome {
  store: AnnotationStore;
  /** Set when the annotation is staged in a changeset. */
  changeset?: { id: string; name: string };
}

/**
 * Where a new annotation goes: the named changeset, else the active one, else the base (with
 * `reading`, the changeset to look in, which never refuses for a landed one). A named
 * changeset that is not staged is refused, since nothing lands from it.
 */
export async function annotationWriteTarget(model: Model, changesetArg?: string, reading = false): Promise<AnnotationHome> {
  const manager = new StagingAreaManager(model.rootPath, model);
  let changeset;
  if (changesetArg !== undefined) {
    changeset = await manager.load(changesetArg);
    if (!changeset) {
      throw new CLIError(`Changeset ${changesetArg} not found`, ErrorCategory.NOT_FOUND, [
        'Use "changeset_list" to see the staged changesets',
      ]);
    }
    if (changeset.status !== "staged") {
      throw new CLIError(`Changeset '${changeset.name}' is ${changeset.status}; an annotation can only be staged in a staged changeset`, ErrorCategory.USER);
    }
  } else {
    // A read never refuses for a landed active changeset; a write does (it must not reach the base in its place).
    changeset = reading ? await manager.getActive() : await manager.getWriteTarget();
  }
  if (!changeset) return { store: new AnnotationStore(model.rootPath) };
  return {
    store: AnnotationStore.forChangeset(manager.changesetPath(changeset.id!)),
    changeset: { id: changeset.id!, name: changeset.name },
  };
}

/**
 * Finds an annotation by id: in the named or active changeset's staged annotations first, then the
 * base. Null when neither has it.
 */
export async function findAnnotation(
  model: Model,
  annotationId: string,
  changesetArg?: string
): Promise<(AnnotationHome & { annotation: Annotation }) | null> {
  const staged = await annotationWriteTarget(model, changesetArg, true);
  if (staged.changeset) {
    const annotation = await staged.store.get(annotationId);
    if (annotation) return { ...staged, annotation };
  }
  const base = new AnnotationStore(model.rootPath);
  const annotation = await base.get(annotationId);
  return annotation ? { store: base, annotation } : null;
}

/** What a tool returns for an annotation: staged ones say which changeset holds them. */
export function annotationResult<T extends object>(value: T, home: AnnotationHome): T | (T & { staged: { changeset: string } }) {
  return home.changeset ? { ...value, staged: { changeset: home.changeset.name } } : value;
}

export const NOT_FOUND_HINT = 'Use "annotation_list" to find existing annotations';
