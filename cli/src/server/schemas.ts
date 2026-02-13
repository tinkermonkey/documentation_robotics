import { z } from 'zod';
import { CANONICAL_LAYER_NAMES } from '../core/layers.js';

// Base schemas for common types
// Accepts both formats:
// - New spec format: layer.type.name (e.g., motivation.goal.customer-satisfaction)
// - Legacy format: layer-type-name (e.g., motivation-goal-customer-satisfaction)
//
// Regex pattern: /^[a-z0-9][a-z0-9\.\-]*[a-z0-9]$|^[a-z0-9]$/
// - Allows lowercase letters, digits, dots, and hyphens
// - Must start and end with alphanumeric (no trailing dots/hyphens)
// - Single character IDs are allowed (e.g., 'a')
// Known limitation: Does not validate that consecutive dots/hyphens are present
// (e.g., 'a--b' or 'a..b' would pass). More strict validation could be added
// if the element ID format becomes more formally specified.
export const ElementIdSchema = z.string()
  .min(1, 'Element ID is required')
  .regex(/^[a-z0-9][a-z0-9\.\-]*[a-z0-9]$|^[a-z0-9]$/, 'Invalid element ID format');

export const TimestampSchema = z.string().datetime();

// Annotation schemas - for creating annotations
export const AnnotationCreateSchema = z.object({
  elementId: ElementIdSchema,
  author: z.string()
    .min(1, 'Author is required')
    .max(100, 'Author name too long')
    .optional()
    .default('Anonymous'),
  content: z.string()
    .min(1, 'Content is required')
    .max(5000, 'Content too long'),
  tags: z.array(z.string()).optional().default([]),
}).strict(); // Prevent extra fields

// Annotation schemas - for updating annotations
export const AnnotationUpdateSchema = z.object({
  content: z.string()
    .min(1, 'Content is required')
    .max(5000, 'Content too long')
    .optional(),
  tags: z.array(z.string()).optional(),
  resolved: z.boolean().optional(),
}).strict(); // Prevent extra fields

// Annotation schemas - for creating replies
export const AnnotationReplyCreateSchema = z.object({
  author: z.string()
    .min(1, 'Author is required')
    .max(100, 'Author name too long'),
  content: z.string()
    .min(1, 'Content is required')
    .max(5000, 'Content too long'),
}).strict(); // Prevent extra fields

// Layer name schema - validates against canonical layer names
export const LayerNameSchema = z.enum(
  [...CANONICAL_LAYER_NAMES] as unknown as [string, ...string[]]
, {
  message: `Invalid layer name. Must be one of: ${CANONICAL_LAYER_NAMES.join(', ')}`
});

// ID schema - validates generic IDs (annotations, changesets, elements)
// Accepts alphanumeric characters, hyphens, and underscores
export const IdSchema = z.string()
  .min(1, 'ID is required')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid ID format. Must contain only alphanumeric characters, hyphens, and underscores');

// Annotation filter schema - validates query parameters for GET /api/annotations
export const AnnotationFilterSchema = z.object({
  elementId: ElementIdSchema.optional()
}).strict(); // Prevent extra query parameters

// Type inference from input schemas
export type AnnotationCreate = z.infer<typeof AnnotationCreateSchema>;
export type AnnotationUpdate = z.infer<typeof AnnotationUpdateSchema>;
export type AnnotationReplyCreate = z.infer<typeof AnnotationReplyCreateSchema>;
