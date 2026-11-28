/**
 * AnnotationStore - filesystem-backed storage for element annotations.
 *
 * Persists annotations under documentation-robotics/annotations/{id}.yaml, one
 * file per annotation with its replies embedded. It is the one annotation store:
 * the viewer server's /api/annotations routes and the MCP annotation_* tools (a
 * separate process per session) both read and write it, so each sees the other's
 * annotations and replies, and they survive restarts. The viewer server watches
 * the directory and broadcasts changes other processes make.
 */

import { readFile, readdir, rm } from "fs/promises";
import { randomBytes } from "crypto";
import path from "path";
import yaml from "yaml";
import { z } from "zod";
import { atomicWrite, ensureDir, fileExists } from "../utils/file-io.js";
import { FileLock } from "../utils/file-lock.js";
import { getErrorMessage } from "../utils/errors.js";
import { stringifyDrYaml } from "./dr-yaml.js";

const AnnotationReplySchema = z.object({
  id: z.string(),
  author: z.string(),
  content: z.string(),
  createdAt: z.string(),
});

/**
 * Runtime schema for an annotation file on disk, used to validate parsed YAML
 * before it is trusted as an `Annotation` — hand-edited files can otherwise
 * omit required fields (e.g. `tags`) and crash downstream consumers.
 */
const AnnotationSchema = z.object({
  id: z.string(),
  elementId: z.string(),
  author: z.string(),
  content: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  tags: z.array(z.string()),
  resolved: z.boolean(),
  replies: z.array(AnnotationReplySchema),
});

export type AnnotationReply = z.infer<typeof AnnotationReplySchema>;

export type Annotation = z.infer<typeof AnnotationSchema>;

export interface AnnotationCreateInput {
  elementId: string;
  author?: string;
  content: string;
  tags?: string[];
}

export interface AnnotationUpdateInput {
  content?: string;
  tags?: string[];
  resolved?: boolean;
}

export interface AnnotationReplyCreateInput {
  author: string;
  content: string;
}

let lastCreatedAt = 0;

/**
 * A creation time that never repeats within this process. Annotations list oldest first by
 * createdAt, so two made in the same millisecond (a viewer comment and its follow-up, say) would
 * otherwise come back in directory order.
 */
function nextCreatedAt(): string {
  lastCreatedAt = Math.max(Date.now(), lastCreatedAt + 1);
  return new Date(lastCreatedAt).toISOString();
}

/** Now, or the given time if the clock is behind it (nextCreatedAt can run ahead in a burst). */
function notBefore(iso: string): string {
  return new Date(Math.max(Date.now(), Date.parse(iso) || 0)).toISOString();
}

/** The folder of a changeset that holds its staged annotations, one file each, as the base store does. */
export const STAGED_ANNOTATIONS_DIR = "annotations";

export class AnnotationStore {
  private annotationsDir: string;

  constructor(rootPath: string) {
    this.annotationsDir = path.join(rootPath, "documentation-robotics", "annotations");
  }

  /**
   * The store of the annotations staged in a changeset: `{changeset folder}/annotations/`, the same
   * file format as the base store. A changeset made before annotations could be staged has no such
   * folder and reads as having none.
   */
  static forChangeset(changesetPath: string): AnnotationStore {
    const store = new AnnotationStore("");
    store.annotationsDir = path.join(changesetPath, STAGED_ANNOTATIONS_DIR);
    return store;
  }

  /**
   * Lands a changeset's staged annotations: writes each into the base store (an id already there
   * is left alone), keeping the staged copies as the plan's record. Returns how many were written.
   */
  async landInto(base: AnnotationStore): Promise<{ landed: number; problems: string[] }> {
    let landed = 0;
    const { annotations, problems } = await this.listWithProblems();
    for (const annotation of annotations) {
      try {
        if (await base.get(annotation.id)) continue;
        await base.put(annotation);
        landed++;
      } catch (error) {
        problems.push(`${annotation.id}: ${getErrorMessage(error)}`);
      }
    }
    return { landed, problems };
  }

  /** Writes an annotation as it is (the id and times it already has). */
  async put(annotation: Annotation): Promise<void> {
    await ensureDir(this.annotationsDir);
    await atomicWrite(this.getPath(annotation.id), stringifyDrYaml(annotation));
  }

  /** Lists all annotations, optionally filtered to a single element, oldest first. Skips (and warns on) individual files that fail to load rather than failing the whole list. */
  async list(elementId?: string): Promise<Annotation[]> {
    return (await this.listWithProblems(elementId)).annotations;
  }

  /** As list, and with the files it could not load, one line each (list only warns on stderr). */
  async listWithProblems(elementId?: string): Promise<{ annotations: Annotation[]; problems: string[] }> {
    const problems: string[] = [];
    if (!(await fileExists(this.annotationsDir))) {
      return { annotations: [], problems };
    }

    const entries = await readdir(this.annotationsDir, { withFileTypes: true });
    const annotations: Annotation[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue;
      const id = entry.name.slice(0, -".yaml".length);

      let annotation: Annotation | null;
      try {
        annotation = await this.get(id);
      } catch (error) {
        process.stderr.write(`Warning: Skipping annotation '${id}': ${getErrorMessage(error)}\n`);
        problems.push(`${id}: ${getErrorMessage(error)}`);
        continue;
      }

      if (annotation && (!elementId || annotation.elementId === elementId)) {
        annotations.push(annotation);
      }
    }

    return { annotations: annotations.sort((a, b) => a.createdAt.localeCompare(b.createdAt)), problems };
  }

  async get(id: string): Promise<Annotation | null> {
    const filePath = this.getPath(id);
    if (!(await fileExists(filePath))) {
      return null;
    }

    let parsed: unknown;
    try {
      const content = await readFile(filePath, "utf-8");
      parsed = yaml.parse(content);
    } catch (error) {
      throw new Error(`Failed to load annotation '${id}': ${getErrorMessage(error)}`);
    }

    const result = AnnotationSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Failed to load annotation '${id}': invalid annotation data - ${result.error.message}`
      );
    }
    return result.data;
  }

  async create(input: AnnotationCreateInput): Promise<Annotation> {
    const annotation: Annotation = {
      id: this.generateAnnotationId(),
      elementId: input.elementId,
      author: input.author?.trim() || "Anonymous",
      content: input.content,
      createdAt: nextCreatedAt(),
      tags: input.tags ?? [],
      resolved: false,
      replies: [],
    };

    await ensureDir(this.annotationsDir);
    await atomicWrite(this.getPath(annotation.id), stringifyDrYaml(annotation));
    return annotation;
  }

  /** Partially updates an annotation's content, tags, and/or resolved state. Returns null if not found. */
  async update(id: string, updates: AnnotationUpdateInput): Promise<Annotation | null> {
    const filePath = this.getPath(id);
    await ensureDir(this.annotationsDir);
    const lock = new FileLock(filePath);

    return lock.withLock(async () => {
      const annotation = await this.get(id);
      if (!annotation) return null;

      const updated: Annotation = {
        ...annotation,
        content: updates.content ?? annotation.content,
        tags: updates.tags ?? annotation.tags,
        resolved: updates.resolved ?? annotation.resolved,
        updatedAt: notBefore(annotation.createdAt),
      };

      await atomicWrite(filePath, stringifyDrYaml(updated));
      return updated;
    });
  }

  /**
   * Deletes an annotation and its replies. Returns false if it didn't exist. Holds the same lock
   * as update and addReply, so a write in flight can't bring the annotation back.
   */
  async delete(id: string): Promise<boolean> {
    const filePath = this.getPath(id);
    if (!(await fileExists(filePath))) {
      return false;
    }
    const lock = new FileLock(filePath);
    return lock.withLock(async () => {
      if (!(await fileExists(filePath))) return false;
      await rm(filePath, { force: true });
      return true;
    });
  }

  /** Appends a reply to an annotation. Returns null if the annotation doesn't exist. */
  async addReply(id: string, input: AnnotationReplyCreateInput): Promise<AnnotationReply | null> {
    const filePath = this.getPath(id);
    await ensureDir(this.annotationsDir);
    const lock = new FileLock(filePath);

    return lock.withLock(async () => {
      const annotation = await this.get(id);
      if (!annotation) return null;

      const reply: AnnotationReply = {
        id: this.generateReplyId(),
        author: input.author,
        content: input.content,
        createdAt: notBefore(annotation.createdAt),
      };

      annotation.replies.push(reply);
      await atomicWrite(filePath, stringifyDrYaml(annotation));
      return reply;
    });
  }

  private getPath(id: string): string {
    return path.join(this.annotationsDir, `${this.sanitizeId(id)}.yaml`);
  }

  /** Whitelists safe characters so an annotation ID can't escape annotationsDir via path traversal. */
  private sanitizeId(id: string): string {
    const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!sanitized) {
      throw new Error(`Invalid annotation ID '${id}'`);
    }
    return sanitized;
  }

  private generateAnnotationId(): string {
    return `ann-${Date.now()}-${randomBytes(4).toString("hex")}`;
  }

  private generateReplyId(): string {
    return `reply-${Date.now()}-${randomBytes(4).toString("hex")}`;
  }
}
