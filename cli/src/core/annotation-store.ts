/**
 * AnnotationStore - filesystem-backed storage for element annotations.
 *
 * Persists annotations under documentation-robotics/annotations/{id}.yaml, one
 * file per annotation with its replies embedded. This is what gives the MCP
 * annotation_* tools (a separate stdio process per session, with no shared
 * memory with a running `dr server`) the same annotation capabilities as the
 * REST server's in-memory /api/annotations endpoints, backed by durable
 * storage that survives process restarts.
 */

import { readFile, readdir, rm } from "fs/promises";
import { randomBytes } from "crypto";
import path from "path";
import yaml from "yaml";
import { atomicWrite, ensureDir, fileExists } from "../utils/file-io.js";
import { FileLock } from "../utils/file-lock.js";
import { getErrorMessage } from "../utils/errors.js";

export interface AnnotationReply {
  id: string;
  author: string;
  content: string;
  createdAt: string;
}

export interface Annotation {
  id: string;
  elementId: string;
  author: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  tags: string[];
  resolved: boolean;
  replies: AnnotationReply[];
}

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

export class AnnotationStore {
  private annotationsDir: string;

  constructor(rootPath: string) {
    this.annotationsDir = path.join(rootPath, "documentation-robotics", "annotations");
  }

  /** Lists all annotations, optionally filtered to a single element, oldest first. */
  async list(elementId?: string): Promise<Annotation[]> {
    if (!(await fileExists(this.annotationsDir))) {
      return [];
    }

    const entries = await readdir(this.annotationsDir, { withFileTypes: true });
    const annotations: Annotation[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue;
      const annotation = await this.get(entry.name.slice(0, -".yaml".length));
      if (annotation && (!elementId || annotation.elementId === elementId)) {
        annotations.push(annotation);
      }
    }

    return annotations.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(id: string): Promise<Annotation | null> {
    const filePath = this.getPath(id);
    if (!(await fileExists(filePath))) {
      return null;
    }

    try {
      const content = await readFile(filePath, "utf-8");
      return yaml.parse(content) as Annotation;
    } catch (error) {
      throw new Error(`Failed to load annotation '${id}': ${getErrorMessage(error)}`);
    }
  }

  async create(input: AnnotationCreateInput): Promise<Annotation> {
    const annotation: Annotation = {
      id: this.generateAnnotationId(),
      elementId: input.elementId,
      author: input.author?.trim() || "Anonymous",
      content: input.content,
      createdAt: new Date().toISOString(),
      tags: input.tags ?? [],
      resolved: false,
      replies: [],
    };

    await ensureDir(this.annotationsDir);
    await atomicWrite(this.getPath(annotation.id), yaml.stringify(annotation));
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
        updatedAt: new Date().toISOString(),
      };

      await atomicWrite(filePath, yaml.stringify(updated));
      return updated;
    });
  }

  /** Deletes an annotation and its replies. Returns false if it didn't exist. */
  async delete(id: string): Promise<boolean> {
    const filePath = this.getPath(id);
    if (!(await fileExists(filePath))) {
      return false;
    }
    await rm(filePath, { force: true });
    return true;
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
        createdAt: new Date().toISOString(),
      };

      annotation.replies.push(reply);
      await atomicWrite(filePath, yaml.stringify(annotation));
      return reply;
    });
  }

  private getPath(id: string): string {
    return path.join(this.annotationsDir, `${this.sanitizeId(id)}.yaml`);
  }

  /** Strips path-traversal and separator characters so an annotation ID can't escape annotationsDir. */
  private sanitizeId(id: string): string {
    const sanitized = id.replace(/\.\./g, "").replace(/[/\\]/g, "");
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
