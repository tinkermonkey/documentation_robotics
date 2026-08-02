/**
 * Shared input field schemas for the annotation_* MCP tools.
 */

import { z } from "zod";

export const annotationIdSchema = z.string().min(1).describe("Annotation ID (e.g. 'ann-1700000000000-a1b2c3d4').");

export const elementIdSchema = z.string().describe("Target element ID (e.g. 'api.endpoint.create-order').");

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
